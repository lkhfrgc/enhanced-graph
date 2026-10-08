/**
 * Graph construction: `VaultAdapter` → `WikiGraph`.
 *
 * The pipeline: read every markdown file, drop hidden page types, resolve
 * `[[wikilinks]]` through a case-insensitive key index, collapse the directed
 * links into unique undirected pairs, score every pair with the association
 * engine and finally detect communities.
 *
 * Deliberate choices here:
 *  - ids are lower-cased, so graph identity never depends on the filesystem's
 *    case sensitivity;
 *  - link counting de-duplicates `(source, target)` first, so `[[x]] [[x]]`
 *    inside one note counts once instead of twice;
 *  - edge endpoints are stored in canonical (sorted) order, which keeps an
 *    edge's identity stable no matter which side happened to declare the link
 *    first — the four association signals are symmetric in the pair.
 */

import { EMPTY_GRAPH } from "../types";
import type {
  CommunityInfo,
  GraphEdge,
  GraphNode,
  PageType,
  RelevanceWeights,
  WikiGraph,
} from "../types";
import { deriveCommunities } from "./communities";
import { parseNote } from "./parse";
import type { ParsedNote } from "./parse";
import { computeRelevance, createRelevanceContext } from "./relevance";
import type { RawLink, RelevanceContext } from "./relevance";
import { normalizeVaultPath } from "./vault";
import type { VaultAdapter } from "./vault";

// ---------------------------------------------------------------------------
// Public option / result types
// ---------------------------------------------------------------------------

export interface BuildGraphOptions {
  readonly vault: VaultAdapter;
  /** Page types excluded from the graph entirely. Default: {"query"}. */
  readonly hiddenTypes?: ReadonlySet<PageType>;
  /** Skip files whose path starts with these prefixes. */
  readonly excludeFolders?: readonly string[];
  readonly weights?: RelevanceWeights;
  /** Parallel file reads. Default 16. */
  readonly concurrency?: number;
  /** Max file size in bytes before a note is skipped. Default 2_000_000. */
  readonly maxFileBytes?: number;
  readonly onProgress?: (done: number, total: number) => void;
  /**
   * Communities from the previous build. Supplying them keeps cluster ids —
   * and therefore the colour palette — stable as the vault evolves.
   */
  readonly previousCommunities?: readonly CommunityInfo[];
}

export interface LinkIndex {
  /** Every lookup key -> node id (lower-cased id). First writer wins. */
  readonly byKey: ReadonlyMap<string, string>;
  readonly ids: readonly string[];
}

const DEFAULT_CONCURRENCY = 16;
const DEFAULT_MAX_FILE_BYTES = 2_000_000;

/** Obsidian's own bookkeeping folders never contain knowledge pages. */
const IGNORED_FOLDER_PREFIXES: readonly string[] = [".obsidian/", ".trash/", ".git/"];

/**
 * Research artefacts ("saved chat answers") are intermediate products: the
 * entities/concepts extracted from them are what belongs in the graph.
 */
const DEFAULT_HIDDEN_TYPES: ReadonlySet<PageType> = new Set<PageType>(["query"]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Code-unit comparison: `localeCompare` would make ordering locale-dependent. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clampConcurrency(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/** The reference's `normalizeLinkKey`: whitespace collapses onto a hyphen. */
function normalizeLinkKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/** The inverse spelling, so `[[note-two]]` also reaches `Note Two.md`. */
function spacedLinkKey(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, " ");
}

/** UTF-8 length of a code point. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * `true` when `content` occupies more than `maxBytes` bytes as UTF-8.
 *
 * The plugin runs in Obsidian's renderer, where Node's `Buffer` is not
 * guaranteed, so the encoded length is derived arithmetically. Two cheap
 * guards keep the scan off the hot path: bytes >= UTF-16 length and
 * bytes <= 3 × UTF-16 length, so only the ambiguous band is counted (and that
 * count stops at the first byte over budget).
 */
function exceedsByteBudget(content: string, maxBytes: number): boolean {
  if (content.length > maxBytes) return true;
  if (content.length * 3 <= maxBytes) return false;
  let bytes = 0;
  for (const char of content) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) return true;
  }
  return false;
}

/**
 * Bounded worker pool: `limit` readers pull from a shared cursor, so a slow
 * file never blocks the others and results keep their input order.
 */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  const workerCount = Math.min(clampConcurrency(limit, 1), values.length);
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Discovery + loading
// ---------------------------------------------------------------------------

function isExcludedPath(path: string, excludeFolders: readonly string[]): boolean {
  if (IGNORED_FOLDER_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return excludeFolders.some((prefix) => path.startsWith(prefix));
}

async function discoverMarkdownFiles(
  vault: VaultAdapter,
  excludeFolders: readonly string[],
): Promise<string[]> {
  let listed: readonly string[];
  try {
    listed = await vault.listMarkdownFiles();
  } catch {
    // An unreadable vault degrades to an empty graph instead of a crash.
    return [];
  }

  const unique = new Set<string>();
  for (const raw of listed) {
    const path = normalizeVaultPath(raw);
    if (!/\.md$/i.test(path)) continue;
    if (isExcludedPath(path, excludeFolders)) continue;
    unique.add(path);
  }
  // Sorted, so link-index collisions ("first writer wins") and the resulting
  // graph are reproducible across rebuilds.
  return [...unique].sort(compareStrings);
}

/**
 * Read every markdown file in the vault and parse it.
 *
 * Filters applied here (in this order): discovery excludes, the byte budget,
 * then `hiddenTypes`. Type filtering happens *before* link resolution on
 * purpose — links pointing at a hidden page must be reported as unresolved
 * rather than silently producing dangling edges.
 *
 * `options.vault` is ignored: the explicit `vault` argument always wins, so a
 * whole `BuildGraphOptions` object can be forwarded unchanged.
 */
export async function loadNotes(
  vault: VaultAdapter,
  options: Partial<BuildGraphOptions> = {},
): Promise<ParsedNote[]> {
  const excludeFolders = (options.excludeFolders ?? [])
    .map((prefix) => normalizeVaultPath(prefix))
    .filter(Boolean);
  const hiddenTypes = options.hiddenTypes ?? DEFAULT_HIDDEN_TYPES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const concurrency = clampConcurrency(options.concurrency, DEFAULT_CONCURRENCY);
  const { onProgress } = options;

  const paths = await discoverMarkdownFiles(vault, excludeFolders);
  const total = paths.length;
  let done = 0;

  const parsed = await mapWithConcurrency(paths, concurrency, async (path) => {
    let note: ParsedNote | null = null;
    try {
      const content = await vault.read(path);
      if (!exceedsByteBudget(content, maxFileBytes)) note = parseNote(path, content);
    } catch {
      // One unreadable (or deleted mid-build) file must never fail the build.
      note = null;
    }
    done += 1;
    onProgress?.(done, total);
    return note;
  });

  const notes = parsed.filter((note): note is ParsedNote => note !== null);
  if (hiddenTypes.size === 0) return notes;
  return notes.filter((note) => !hiddenTypes.has(note.type));
}

// ---------------------------------------------------------------------------
// Link index
// ---------------------------------------------------------------------------

/**
 * Build the `[[wikilink]]` lookup table.
 *
 * Registration order *is* the resolution priority, because the first writer
 * wins: full ids, then path-level separator variants, then basenames and their
 * variants, and finally frontmatter aliases. That ordering is what makes
 * `[[folder/note]]` reach the note inside `folder/` before a same-named note
 * elsewhere, while a real file name always outranks an alias.
 */
export function buildLinkIndex(notes: readonly ParsedNote[]): LinkIndex {
  const byKey = new Map<string, string>();
  const ids: string[] = [];
  const seenIds = new Set<string>();

  const idOf = (note: ParsedNote): string => (note.id || note.rawId).toLowerCase();
  const claim = (key: string, id: string): void => {
    if (key && !byKey.has(key)) byKey.set(key, id);
  };

  // 1. Exact lower-cased vault ids (`folder/note`).
  for (const note of notes) {
    const id = idOf(note);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
    claim(id, id);
  }

  // 2. Path-level variants of those ids. Still longer than a bare basename, so
  //    they must be claimed before the basename pass.
  for (const id of ids) {
    claim(normalizeLinkKey(id), id);
    claim(spacedLinkKey(id), id);
  }

  // 3. Basenames, then their separator variants (`Note Two` ↔ `note-two`).
  for (const note of notes) {
    const id = idOf(note);
    const basename = note.basename.replace(/\.md$/i, "").trim().toLowerCase();
    claim(basename, id);
    claim(normalizeLinkKey(basename), id);
    claim(spacedLinkKey(basename), id);
  }

  // 4. Aliases are the weakest signal; they only fill keys nobody else took.
  for (const note of notes) {
    const id = idOf(note);
    for (const alias of note.aliases) {
      const key = alias.trim().replace(/^\.\//, "").toLowerCase();
      if (!key) continue;
      claim(key, id);
      claim(normalizeLinkKey(key), id);
    }
  }

  return Object.freeze({ byKey, ids: Object.freeze(ids) });
}

/**
 * Resolve one raw link target to a graph node id, or `null` when nothing
 * matches. Candidates are tried in decreasing specificity and every candidate
 * is lower-cased first, so resolution is case-insensitive.
 */
export function resolveLinkTarget(raw: string, index: LinkIndex): string | null {
  // Callers may hand us an untrimmed wikilink body, so the alias/fragment
  // syntax that `parseNote` already strips is stripped again defensively.
  const target = raw
    .trim()
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!target) return null;

  const lower = target.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const candidates: string[] = [];

  // `[[Note Two.md]]` is valid Obsidian even though ids never carry the suffix.
  if (lower.endsWith(".md")) candidates.push(lower.slice(0, -3));
  candidates.push(
    lower, // exact id, basename or alias
    basename, // `[[some/deep/Note Two]]`
    normalizeLinkKey(lower), // spaces -> hyphens
    spacedLinkKey(lower), // hyphens -> spaces
    normalizeLinkKey(basename),
    spacedLinkKey(basename),
  );

  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || tried.has(candidate)) continue;
    tried.add(candidate);
    const hit = index.byKey.get(candidate);
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * Unresolved link targets, grouped by the note that referenced them.
 *
 * Keyed by the referencing note's `id` (lower-cased vault path without `.md`,
 * i.e. the `GraphNode.id` the view already uses); duplicates are collapsed and
 * the original spelling is preserved for display.
 */
export function collectUnresolvedLinks(
  notes: readonly ParsedNote[],
  index: LinkIndex,
): Map<string, string[]> {
  const unresolved = new Map<string, string[]>();
  for (const note of notes) {
    const targets: string[] = [];
    const seen = new Set<string>();
    for (const raw of note.links) {
      // A link to a hidden (filtered-out) page counts as unresolved: the page
      // is not part of the graph, so there is nothing to draw an edge to.
      if (resolveLinkTarget(raw, index) !== null) continue;
      const label = raw.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      targets.push(label);
    }
    if (targets.length > 0) unresolved.set(note.id, targets);
  }
  return unresolved;
}

// ---------------------------------------------------------------------------
// Association signals that live outside the relevance engine
// ---------------------------------------------------------------------------

/** Shared normalised `sources[]` keys, sorted for stable tooltips. */
function sharedSourceKeys(a: GraphNode, b: GraphNode): string[] {
  const inB = new Set(b.sources);
  const shared = new Set<string>();
  for (const source of a.sources) {
    if (inB.has(source)) shared.add(source);
  }
  return [...shared].sort(compareStrings);
}

/**
 * Number of shared neighbours, using the engine's own neighbour definition
 * (out-links ∪ in-links) so this field always agrees with the Adamic-Adar
 * term of `computeRelevance`.
 */
function countCommonNeighbors(a: string, b: string, ctx: RelevanceContext): number {
  const neighborsA = ctx.neighbors.get(a);
  const neighborsB = ctx.neighbors.get(b);
  if (!neighborsA || !neighborsB) return 0;
  const [small, large] =
    neighborsA.size <= neighborsB.size ? [neighborsA, neighborsB] : [neighborsB, neighborsA];
  let shared = 0;
  for (const id of small) {
    if (large.has(id)) shared += 1;
  }
  return shared;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildWikiGraph(options: BuildGraphOptions): Promise<WikiGraph> {
  const notes = await loadNotes(options.vault, options);
  if (notes.length === 0) return EMPTY_GRAPH;

  const index = buildLinkIndex(notes);

  // --- Directed links -----------------------------------------------------
  // De-duplicated per (source, target) so `[[x]] [[x]]` counts once, but kept
  // directed: the association engine needs the orientation for its
  // forward/backward direct-link signal.
  const directedLinks: RawLink[] = [];
  const directedKeys = new Set<string>();
  const outCounts = new Map<string, number>();
  const inCounts = new Map<string, number>();

  for (const note of notes) {
    const targets = new Set<string>();
    for (const raw of note.links) {
      const targetId = resolveLinkTarget(raw, index);
      if (targetId === null || targetId === note.id) continue; // self-links dropped
      if (targets.has(targetId)) continue;
      targets.add(targetId);
      directedLinks.push({ source: note.id, target: targetId });
      directedKeys.add(`${note.id}\u0000${targetId}`);
      outCounts.set(note.id, (outCounts.get(note.id) ?? 0) + 1);
      inCounts.set(targetId, (inCounts.get(targetId) ?? 0) + 1);
    }
  }

  // --- Nodes --------------------------------------------------------------
  // Community ids only exist after Louvain has run, so nodes are built with a
  // placeholder and rebuilt once the assignments are known.
  const preliminary: GraphNode[] = notes.map((note) => {
    const inLinks = inCounts.get(note.id) ?? 0;
    const outLinks = outCounts.get(note.id) ?? 0;
    return Object.freeze({
      id: note.id,
      label: note.title,
      type: note.type,
      rawType: note.rawType,
      path: normalizeVaultPath(note.path),
      linkCount: inLinks + outLinks,
      inLinks,
      outLinks,
      community: 0,
      sources: Object.freeze([...note.sources]),
      tags: Object.freeze([...note.tags]),
      isStructural: note.isStructural,
    });
  });
  const nodeById = new Map<string, GraphNode>(preliminary.map((node) => [node.id, node]));

  const ctx = createRelevanceContext(preliminary, directedLinks);

  // --- Undirected pairs ---------------------------------------------------
  const pairs: Array<readonly [string, string]> = [];
  const seenPairs = new Set<string>();
  for (const link of directedLinks) {
    const pair: readonly [string, string] =
      compareStrings(link.source, link.target) <= 0
        ? [link.source, link.target]
        : [link.target, link.source];
    const [a, b] = pair;
    const key = `${a}\u0000${b}`;
    if (seenPairs.has(key)) continue; // both directions -> exactly one edge
    seenPairs.add(key);
    pairs.push(pair);
  }

  const edges: GraphEdge[] = [];
  for (const [a, b] of pairs) {
    const nodeA = nodeById.get(a);
    const nodeB = nodeById.get(b);
    if (!nodeA || !nodeB) continue; // unreachable: every target came from the index
    const signals = computeRelevance(nodeA, nodeB, ctx, options.weights);
    edges.push(
      Object.freeze({
        source: a,
        target: b,
        weight: signals.total,
        signals: Object.freeze({ ...signals }),
        hasDirectLink:
          directedKeys.has(`${a}\u0000${b}`) || directedKeys.has(`${b}\u0000${a}`),
        sharedSources: Object.freeze(sharedSourceKeys(nodeA, nodeB)),
        commonNeighbors: countCommonNeighbors(a, b, ctx),
      }),
    );
  }

  // --- Communities --------------------------------------------------------
  const { assignments, communities } = deriveCommunities(
    preliminary.map((node) => ({ id: node.id, label: node.label, linkCount: node.linkCount })),
    edges.map((edge) => ({ source: edge.source, target: edge.target, weight: edge.weight })),
    options.previousCommunities ? { previousCommunities: options.previousCommunities } : undefined,
  );

  const nodes: GraphNode[] = preliminary.map((node) =>
    Object.freeze({ ...node, community: assignments.get(node.id) ?? 0 }),
  );

  // --- Ordering + lookup --------------------------------------------------
  // The view renders both arrays verbatim, so the sort order is part of the
  // contract; ties fall back to ids to stay deterministic across rebuilds.
  const sortedNodes = [...nodes].sort(
    (a, b) => b.linkCount - a.linkCount || compareStrings(a.id, b.id),
  );
  const sortedEdges = [...edges].sort(
    (a, b) =>
      b.weight - a.weight ||
      compareStrings(a.source, b.source) ||
      compareStrings(a.target, b.target),
  );

  // Both spellings are indexed: `id` is stable identity, `rawId` is what the
  // user sees in a `[[link]]` / file tree.
  const nodeIndex = new Map<string, GraphNode>();
  notes.forEach((note, position) => {
    const node = nodes[position];
    if (!node) return;
    if (!nodeIndex.has(note.id)) nodeIndex.set(note.id, node);
    if (!nodeIndex.has(note.rawId)) nodeIndex.set(note.rawId, node);
  });

  return Object.freeze({
    nodes: Object.freeze(sortedNodes),
    edges: Object.freeze(sortedEdges),
    communities: Object.freeze(communities),
    nodeIndex,
    builtAt: Date.now(),
  });
}
