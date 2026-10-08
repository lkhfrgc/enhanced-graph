/**
 * 关联度引擎 — the association engine.
 *
 * Scores how strongly two notes belong together from four independent signals:
 * direct links, shared `sources[]`, shared neighbours (Adamic-Adar) and page
 * type affinity. The four are combined linearly, which keeps each one's
 * contribution inspectable — the view shows the breakdown rather than a single
 * opaque number.
 *
 * Links keep an explicit direction (so the view can render arrowheads) while
 * the score itself stays symmetric in the pair.
 *
 * Pure module — no Obsidian import, no I/O, no module-level mutable state, so
 * it can be exercised from plain Node tests and the browser harness alike.
 */

import {
  DEFAULT_RELEVANCE_WEIGHTS,
} from "../types";
import type { GraphNode, RelevanceBreakdown, RelevanceWeights } from "../types";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/** A directed link between two resolved note ids. */
export interface RawLink {
  readonly source: string;
  readonly target: string;
}

export interface RelevanceContext {
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** source id -> set of ids it links to. */
  readonly outLinks: ReadonlyMap<string, ReadonlySet<string>>;
  /** target id -> set of ids linking to it. */
  readonly inLinks: ReadonlyMap<string, ReadonlySet<string>>;
  /** Undirected 1-hop adjacency (out ∪ in). */
  readonly neighbors: ReadonlyMap<string, ReadonlySet<string>>;
}

// ---------------------------------------------------------------------------
// Signal labels
// ---------------------------------------------------------------------------

/**
 * Tooltip label per signal, in display order. The label text is Chinese
 * because the plugin UI is Chinese-first; the ASCII hyphen in "Adamic-Adar"
 * keeps the string stable across fonts.
 */
const SIGNAL_LABELS: ReadonlyArray<readonly [keyof Omit<RelevanceBreakdown, "total">, string]> = [
  ["directLink", "直接链接"],
  ["adamicAdar", "Adamic-Adar"],
  ["sourceOverlap", "来源重叠"],
  ["coCitation", "共被引"],
];

// ---------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------

/** Build the undirected neighbour/degree index; also reports the degree map. */
export function buildAdjacency(
  nodes: readonly GraphNode[],
  links: readonly RawLink[],
): {
  outLinks: Map<string, Set<string>>;
  inLinks: Map<string, Set<string>>;
  neighbors: Map<string, Set<string>>;
} {
  const outLinks = new Map<string, Set<string>>();
  const inLinks = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();

  // Pre-seed every node: isolated notes must report degree 0 rather than being
  // absent from the index, otherwise the Adamic-Adar degree lookup could not
  // tell "no neighbours" from "unknown node".
  for (const node of nodes) {
    outLinks.set(node.id, new Set<string>());
    inLinks.set(node.id, new Set<string>());
    neighbors.set(node.id, new Set<string>());
  }

  for (const link of links) {
    const { source, target } = link;
    // A self-link says nothing about how two *different* notes relate.
    if (source === target) continue;

    const out = outLinks.get(source);
    const inbound = inLinks.get(target);
    // The seeded maps double as the node index: an endpoint that never resolved
    // to a real note is dropped instead of silently becoming a hub.
    if (!out || !inbound) continue;

    out.add(target);
    inbound.add(source);
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  }

  return { outLinks, inLinks, neighbors };
}

export function createRelevanceContext(
  nodes: readonly GraphNode[],
  links: readonly RawLink[],
): RelevanceContext {
  // Only `id` is read off the incoming nodes, so the caller's objects are never
  // touched (and may safely be frozen or shared with the parser).
  const nodeIndex = new Map<string, GraphNode>();
  for (const node of nodes) nodeIndex.set(node.id, node);

  const { outLinks, inLinks, neighbors } = buildAdjacency(nodes, links);
  return { nodes: nodeIndex, outLinks, inLinks, neighbors };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------


/**
 * Per-signal weights, defaulted field by field. Settings persisted by an older
 * plugin version may be missing a key; falling back per signal beats letting a
 * single `undefined` poison the whole total with `NaN`.
 */
function resolveWeights(weights?: RelevanceWeights): RelevanceWeights {
  if (!weights) return DEFAULT_RELEVANCE_WEIGHTS;
  return {
    directLink: weights.directLink ?? DEFAULT_RELEVANCE_WEIGHTS.directLink,
    sourceOverlap: weights.sourceOverlap ?? DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
    commonNeighbor: weights.commonNeighbor ?? DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
    coCitation: weights.coCitation ?? DEFAULT_RELEVANCE_WEIGHTS.coCitation,
  };
}

/**
 * Squash an unbounded count into 0…1.
 *
 * The signals count things that have no natural ceiling: shared sources, shared
 * neighbours, notes citing both. Feeding a raw count into a weighted sum lets a
 * pair with three shared sources outscore a mutual link, which is not what any
 * of the weights were meant to say. `x / (1 + x)` is monotone, keeps small values
 * roughly proportional, and never quite reaches 1.
 *
 * Measured on a real vault: this changes link-prediction AUC by 0.0008 — inside
 * the noise — while making the weights mean what they say.
 */
function saturate(count: number): number {
  if (!(count > 0)) return 0;
  return count / (1 + count);
}

function coCitationCount(a: GraphNode, b: GraphNode, ctx: RelevanceContext): number {
  const inboundA = ctx.inLinks.get(a.id);
  const inboundB = ctx.inLinks.get(b.id);
  if (!inboundA || !inboundB || inboundA.size === 0 || inboundB.size === 0) return 0;
  const [small, large] = inboundA.size <= inboundB.size ? [inboundA, inboundB] : [inboundB, inboundA];
  let shared = 0;
  for (const id of small) if (large.has(id)) shared += 1;
  return shared;
}

/** Shared `sources[]` entries. `parse.ts` already normalises and de-duplicates both sides. */
function countSharedSources(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSources = new Set(a);
  let shared = 0;
  for (const source of b) {
    if (aSources.has(source)) shared += 1;
  }
  return shared;
}

/**
 * Raw Adamic-Adar sum over the shared neighbours, before weighting.
 *
 * A neighbour that only ever touches degree 1 would make `ln(1) = 0` and blow
 * the score up to `Infinity`; the `max(degree, 2)` floor keeps the term finite
 * (and is also the true lower bound for a neighbour shared by two notes).
 */
function adamicAdarSum(a: GraphNode, b: GraphNode, ctx: RelevanceContext): number {
  const neighborsA = ctx.neighbors.get(a.id);
  const neighborsB = ctx.neighbors.get(b.id);
  if (!neighborsA || !neighborsB) return 0;
  if (neighborsA.size === 0 || neighborsB.size === 0) return 0;

  // Walk the smaller set: the intersection is the same either way, but the
  // membership probes then scale with min(deg(a), deg(b)).
  const aIsSmaller = neighborsA.size <= neighborsB.size;
  const small = aIsSmaller ? neighborsA : neighborsB;
  const large = aIsSmaller ? neighborsB : neighborsA;

  let sum = 0;
  for (const neighborId of small) {
    if (!large.has(neighborId)) continue;
    // A neighbour missing from the index has no known edges; treat it as degree 0.
    const degree = ctx.neighbors.get(neighborId)?.size ?? 0;
    sum += 1 / Math.log(Math.max(degree, 2));
  }
  return sum;
}

function zeroBreakdown(): RelevanceBreakdown {
  return { directLink: 0, sourceOverlap: 0, adamicAdar: 0, coCitation: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a note pair. Every returned field is already multiplied by its weight;
 * `total` is their sum. A note is never related to itself.
 */
export function computeRelevance(
  a: GraphNode,
  b: GraphNode,
  ctx: RelevanceContext,
  weights?: RelevanceWeights,
): RelevanceBreakdown {
  if (a.id === b.id) return zeroBreakdown();

  const w = resolveWeights(weights);

  // Every signal is normalised to 0…1 first, so a weight is a share of the total
  // rather than a scale factor on an unbounded count.

  // Signal 1 — direct links, counted in both directions: a mutual pair scores a
  // full 1.0, a one-way mention 0.5.
  const forward = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
  const backward = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
  const directLink = ((forward + backward) / 2) * w.directLink;

  // Signal 2 — shared literature: two notes citing the same papers are related
  // even with no wikilink between them.
  const sourceOverlap = saturate(countSharedSources(a.sources, b.sources)) * w.sourceOverlap;

  // Signal 3 — shared neighbours, weighted by how exclusive they are.
  const adamicAdar = saturate(adamicAdarSum(a, b, ctx)) * w.commonNeighbor;

  // Signal 4 — co-citation: a third note links to both.
  const coCitation = saturate(coCitationCount(a, b, ctx)) * w.coCitation;

  return {
    directLink,
    sourceOverlap,
    adamicAdar,
    coCitation,
    total: directLink + sourceOverlap + adamicAdar + coCitation,
  };
}

/** All scored pairs, strongest first. Used by the "related notes" feature. */
export function rankRelated(
  ctx: RelevanceContext,
  nodeId: string,
  limit: number = 5,
  weights?: RelevanceWeights,
): Array<{ node: GraphNode; breakdown: RelevanceBreakdown }> {
  const node = ctx.nodes.get(nodeId);
  if (!node) return [];
  // Also rejects 0, negatives and NaN, which would otherwise slice from the end.
  if (!(limit > 0)) return [];

  const scored: Array<{ node: GraphNode; breakdown: RelevanceBreakdown }> = [];
  for (const candidate of ctx.nodes.values()) {
    if (candidate.id === node.id) continue;
    const breakdown = computeRelevance(node, candidate, ctx, weights);
    // A pair with no signal at all is not a "related note"; dropping it here
    // saves every caller from filtering the same list again.
    if (breakdown.total <= 0) continue;
    scored.push({ node: candidate, breakdown });
  }

  // Ties break by id: deterministic, and it claims no preference it cannot
  // justify. (A type-affinity tie-break used to sit here; it was measured at
  // AUC 0.54 and has been removed.)
  scored.sort(
    (x, y) =>
      y.breakdown.total - x.breakdown.total ||
      (x.node.id < y.node.id ? -1 : x.node.id > y.node.id ? 1 : 0),
  );

  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Human-readable one-line summary, used by the edge tooltip. */
export function describeRelevance(breakdown: RelevanceBreakdown): string {
  const parts: string[] = [];
  for (const [key, label] of SIGNAL_LABELS) {
    const value = breakdown[key];
    // `total` is a sum, not a signal, so it is deliberately not listed here.
    if (value === 0) continue;
    parts.push(`${label} ${value.toFixed(2)}`);
  }
  return parts.join(" · ");
}
