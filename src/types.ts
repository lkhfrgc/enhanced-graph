/**
 * Shared type contract for the Enhanced Graph plugin.
 *
 * Everything that crosses a module boundary is declared here so that the data
 * layer, the association engine, the community/insight analysis and the sigma
 * view can be developed and tested independently.
 */

// ---------------------------------------------------------------------------
// Page types
// ---------------------------------------------------------------------------

/** Canonical page types. Chinese and English frontmatter values both map here. */
export type PageType =
  | "entity"
  | "concept"
  | "source"
  | "synthesis"
  | "query"
  | "comparison"
  | "finding"
  | "thesis"
  | "methodology"
  | "overview"
  | "other";

export const PAGE_TYPES: readonly PageType[] = [
  "entity",
  "concept",
  "source",
  "synthesis",
  "query",
  "comparison",
  "finding",
  "thesis",
  "methodology",
  "overview",
  "other",
];

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export interface GraphNode {
  /** Stable id: vault-relative path without the `.md` extension. */
  readonly id: string;
  /** Display title (frontmatter `title` → first `# heading` → file basename). */
  readonly label: string;
  readonly type: PageType;
  /** Frontmatter `type` exactly as written ("" when absent). */
  readonly rawType: string;
  /** Vault-relative path including `.md`. */
  readonly path: string;
  /** inbound + outbound resolved links, within the current build. */
  readonly linkCount: number;
  /**
   * Links in and out counted against the WHOLE vault rather than this build.
   *
   * `linkCount` only counts links whose target is part of the current build, so it
   * answers "how connected is this note on screen". Isolation is not that question:
   * a note whose only links point outside the working folder, or at a page type the
   * build hides, is still a linked note, and hiding it under 隐藏孤立节点 was wrong.
   * This count resolves link targets against every markdown file the vault has.
   *
   * Non-markdown targets (attachments) are not counted: the vault adapter lists
   * markdown only, so a note linked solely to an image still reads as isolated.
   */
  readonly vaultLinkCount: number;
  readonly inLinks: number;
  readonly outLinks: number;
  /** Louvain community id, remapped so 0 is the largest cluster. */
  readonly community: number;
  /** Normalised `sources[]` keys from frontmatter. */
  readonly sources: readonly string[];
  readonly tags: readonly string[];
  /** index / overview / log / purpose / schema — noise for insight analysis. */
  readonly isStructural: boolean;
  /**
   * File timestamps in epoch milliseconds, when the host supplied them.
   *
   * Optional, and absent means *unknown*: the trend analysers skip a note whose age
   * is not known rather than treating it as ancient. A memory vault in a test has
   * none, so every age-based insight must be able to return nothing.
   */
  readonly created?: number;
  readonly modified?: number;
}

/**
 * Per-signal contribution of the association engine, kept for the tooltip.
 *
 * Every field except `total` is already multiplied by its weight, and every one
 * of them is a 0…1 signal times a weight — so the numbers can be compared with
 * each other, which is the whole point of showing a breakdown.
 */
export interface RelevanceBreakdown {
  /** directLink weight × (forward + backward) / 2. */
  readonly directLink: number;
  /** sourceOverlap weight × saturate(shared `sources[]`). */
  readonly sourceOverlap: number;
  /** commonNeighbor weight × saturate(Σ 1/ln(max(degree, 2))). */
  readonly adamicAdar: number;
  /** coCitation weight × saturate(notes linking to both). */
  readonly coCitation: number;
  readonly total: number;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  /** Association score, = signals.total. */
  readonly weight: number;
  readonly signals: RelevanceBreakdown;
  /** True when a direct `[[wikilink]]` (either direction) exists. */
  readonly hasDirectLink: boolean;
  /** Shared `sources[]` keys. */
  readonly sharedSources: readonly string[];
  /** Number of shared neighbours. */
  readonly commonNeighbors: number;
}

export interface CommunityInfo {
  readonly id: number;
  readonly nodeCount: number;
  /** Edges whose both endpoints sit in this community. */
  readonly intraEdges: number;
  /** intraEdges / (n·(n−1)/2). */
  readonly cohesion: number;
  /** 2·intraEdges / n — scale-independent companion metric. */
  readonly meanIntraDegree: number;
  /** Up to 5 member labels, highest linkCount first. */
  readonly topNodes: readonly string[];
  /** cohesion < SPARSE_COHESION && nodeCount >= 3. */
  readonly isSparse: boolean;
  /** Member node ids. */
  readonly nodeIds: readonly string[];
}

/**
 * A folder the workspace picker can offer.
 *
 * `count` is the notes in this folder AND everything below it, so choosing a
 * folder shows how much of the vault it stands for — the only number that helps
 * when a vault has dozens of nested folders.
 */
export interface FolderInfo {
  /** Vault-relative path; empty means the vault root. */
  readonly path: string;
  /** Notes in this folder and its subfolders. */
  readonly count: number;
}

export interface WikiGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly communities: readonly CommunityInfo[];
  readonly nodeIndex: ReadonlyMap<string, GraphNode>;
  /**
   * Every folder in the vault that holds a note, plus its ancestors, sorted, with
   * the vault root first.
   *
   * Collected BEFORE the working folder narrows the build, so the scope can always
   * be widened again from the panel: a list built from the scoped notes would only
   * ever offer the folders already inside it, and there would be no way back up.
   */
  readonly folders: readonly FolderInfo[];
  readonly builtAt: number;
}

export const EMPTY_GRAPH: WikiGraph = Object.freeze({
  nodes: [],
  edges: [],
  communities: [],
  nodeIndex: new Map(),
  folders: [],
  builtAt: 0,
});

// ---------------------------------------------------------------------------
// Association engine configuration
// ---------------------------------------------------------------------------

/**
 * Per-signal weights.
 *
 * These really are relative importance, because every signal is normalised to
 * 0…1 before it is multiplied (see `core/relevance`). That was not true of the
 * first design: the weights scaled a raw, unbounded count, so "source overlap 4"
 * could contribute 12 while "direct link 3" could contribute at most 6 — the
 * number on the slider did not mean what it said, and the tooltip reported the
 * inflated figure as if it were a comparable contribution.
 */
export interface RelevanceWeights {
  directLink: number;
  sourceOverlap: number;
  commonNeighbor: number;
  coCitation: number;
}

/**
 * Chosen so the ordering matches how strong the evidence is: an actual link
 * beats a shared neighbour, which beats a shared source, which beats both notes
 * being cited by the same third note. Measured on a 79-note vault, the exact
 * values are not load-bearing — five very different vectors land within one
 * standard deviation of each other — so they are picked to be explainable.
 */
export const DEFAULT_RELEVANCE_WEIGHTS: RelevanceWeights = {
  directLink: 4.0,
  commonNeighbor: 2.0,
  sourceOverlap: 2.0,
  coCitation: 1.0,
};

/*
 * There used to be a hand-written 11×11 `DEFAULT_TYPE_AFFINITY` table here,
 * mapping a pair of page types to a 0.5…1.2 "how compatible are these kinds of
 * note" figure.
 *
 * It is gone, for two reasons that happened to point the same way:
 *
 *  - Measured, it did almost nothing. On its own it ranked held-out links at
 *    AUC 0.54 — barely above a coin flip — and across random pairs it spanned
 *    only 1.05…1.20, so weighting it produced a near-constant offset that could
 *    not reorder anything. It had no slider and no editor; it was 121 invisible
 *    numbers.
 *  - It was also the largest piece of hand-set expression in the project that
 *    matched the reference implementation: 22 of the 25 cells it shared with it
 *    were identical. Values chosen by hand, with no formula behind them, are
 *    exactly the kind of thing copyright covers — unlike an algorithm.
 *
 * Ties are now broken by id alone, which is deterministic and claims nothing.
 */
// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type ConnectionReason =
  | "cross-community"
  | "cross-type"
  | "distant-types"
  | "peripheral-hub"
  | "weak-tie"
  | "source-overlap";

export interface UnexpectedLink {
  /** Stable key for dismiss tracking: `[a,b].sort().join(":::")`. */
  readonly key: string;
  readonly source: GraphNode;
  readonly target: GraphNode;
  readonly score: number;
  /** Association score of the underlying edge. */
  readonly weight: number;
  readonly reasons: readonly ConnectionReason[];
  /** Per-signal scores that produced `score`, for the expanded card view. */
  readonly contributions: Readonly<Partial<Record<ConnectionReason, number>>>;
}

export type GapType = "isolated" | "sparse" | "bridge";

export interface CoverageGap {
  /** Stable key for dismiss tracking: `gap:<type>:<title>:<ids>`. */
  readonly key: string;
  readonly type: GapType;
  readonly title: string;
  readonly description: string;
  readonly suggestion: string;
  readonly nodeIds: readonly string[];
  /** How many clusters a bridge node spans (bridge-node only). */
  readonly clusterCount?: number;
}

// ---------------------------------------------------------------------------
// Graph view settings
// ---------------------------------------------------------------------------

export type ColorMode = "type" | "community" | "custom";

/**
 * How far to go when layering onto Obsidian's built-in graph view.
 * `off` leaves the official view completely untouched.
 */
export type OfficialGraphMode = "off" | "community" | "type";
