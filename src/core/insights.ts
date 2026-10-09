/**
 * 图谱洞察 (graph insights): surprising connections + knowledge gaps.
 *
 * Everything here is pure analysis over an already-built `WikiGraph` — no I/O
 * and no Obsidian imports — so the same engine runs from the tests, from the
 * rebuild pipeline and from the view without any host setup.
 */

import type {
  CommunityInfo,
  ConnectionReason,
  GapType,
  GraphNode,
  CoverageGap,
  UnexpectedLink,
  WikiGraph,
} from "../types";
import {
  computeGraphDensity,
  isSparseCommunity as isSparseFromMetrics,
} from "./communities";
import { edgeKey } from "./graph-keys";

export interface InsightOptions {
  /** Max surprising connections returned. Default 6. */
  readonly connectionLimit?: number;
  /** Max knowledge gaps returned. Default 10. */
  readonly gapLimit?: number;
  /** Minimum composite surprise score. Default 3. */
  readonly minScore?: number;
}

export interface GraphInsights {
  readonly connections: readonly UnexpectedLink[];
  readonly gaps: readonly CoverageGap[];
}

const DEFAULT_CONNECTION_LIMIT = 6;
const DEFAULT_GAP_LIMIT = 10;
const DEFAULT_MIN_SCORE = 3;

/** Labels inlined in a gap description before it is summarised as "等 N 个". */
const LABEL_PREVIEW = 5;
/** Neighbour clusters a page must span before it counts as a bridge. */
const MIN_BRIDGE_CLUSTERS = 3;
/** Bridges reported per analysis; more than this is noise, not insight. */
const BRIDGE_LIMIT = 3;

/** Per-signal weights of the composite surprise score. */
const CONTRIBUTION: Readonly<Record<ConnectionReason, number>> = {
  "cross-community": 3,
  "distant-types": 2,
  "cross-type": 1,
  "peripheral-hub": 2,
  "weak-tie": 1,
  "source-overlap": 2,
};

/** Unordered type pair, so lookups do not depend on edge direction. */
function typePair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Type combinations that rarely share vocabulary — the most interesting edges. */
const DISTANT_TYPE_PAIRS: ReadonlySet<string> = new Set([
  typePair("source", "concept"),
  typePair("source", "synthesis"),
  typePair("query", "entity"),
  typePair("source", "thesis"),
  typePair("source", "methodology"),
]);

const ISOLATED_SUGGESTION =
  "这些页面几乎没有关联，建议在正文中补充 [[wikilinks]] 指向相关主题，先建立连接再逐步扩充内容。";
const SPARSE_SUGGESTION =
  "该领域内部交叉引用不足，建议在这些页面之间补充 [[wikilinks]]，把同一主题的笔记串联起来。";
const BRIDGE_SUGGESTION =
  "这是跨领域的关键枢纽，建议保持内容更新与完整，并持续补充指向各个集群的 [[wikilinks]]。";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Run both analyses with one shared option bag. */
export function analyzeGraph(graph: WikiGraph, options: InsightOptions = {}): GraphInsights {
  return {
    connections: rankUnexpectedLinks(graph, options),
    gaps: findCoverageGaps(graph, options),
  };
}

// ---------------------------------------------------------------------------
// Surprising connections
// ---------------------------------------------------------------------------

/**
 * Score every edge by how unexpected its endpoints are together and keep the
 * strongest ones. Signals are additive so a card can explain *why* a pair was
 * surfaced via `contributions`.
 */
export function rankUnexpectedLinks(
  graph: WikiGraph,
  options: InsightOptions = {},
): UnexpectedLink[] {
  const limit = resolveLimit(options.connectionLimit, DEFAULT_CONNECTION_LIMIT);
  if (limit === 0 || graph.edges.length === 0) return [];

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const nodeById = resolveNodes(graph);
  let maxDegree = 1;
  for (const node of uniqueNodes(graph)) maxDegree = Math.max(maxDegree, node.linkCount);

  const seen = new Set<string>();
  const scored: UnexpectedLink[] = [];

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (source.isStructural || target.isStructural) continue;

    // Multi-edges and reversed duplicates describe one relationship, and a
    // duplicate card would inflate the ranking with the same pair.
    const key = connectionKey(source.id, target.id);
    if (seen.has(key)) continue;
    seen.add(key);

    const reasons: ConnectionReason[] = [];
    const contributions: Partial<Record<ConnectionReason, number>> = {};
    const add = (reason: ConnectionReason): void => {
      contributions[reason] = (contributions[reason] ?? 0) + CONTRIBUTION[reason];
      reasons.push(reason);
    };

    if (source.community !== target.community) add("cross-community");

    if (source.type !== target.type) {
      // Exactly one of the two type signals fires, so the card can say either
      // "different types" or the stronger "distant types".
      add(DISTANT_TYPE_PAIRS.has(typePair(source.type, target.type)) ? "distant-types" : "cross-type");
    }

    const minDeg = Math.min(source.linkCount, target.linkCount);
    const maxDeg = Math.max(source.linkCount, target.linkCount);
    if (minDeg <= 2 && maxDeg >= maxDegree * 0.5) add("peripheral-hub");

    if (edge.weight > 0 && edge.weight < 2) add("weak-tie");

    // 来源重叠 is the heaviest association signal (weight 4.0); surfacing it
    // here explains why unrelated-looking pages ended up connected.
    if (edge.sharedSources.length >= 2) add("source-overlap");

    const score = reasons.reduce((sum, reason) => sum + CONTRIBUTION[reason], 0);
    if (reasons.length === 0 || score < minScore) continue;

    scored.push({ key, source, target, score, weight: edge.weight, reasons, contributions });
  }

  scored.sort(
    (a, b) => b.score - a.score || b.weight - a.weight || compareStrings(a.key, b.key),
  );
  return scored.slice(0, limit);
}

/** Stable dismiss key for a connection card; see {@link edgeKey}. */
export function connectionKey(a: string, b: string): string {
  return edgeKey(a, b);
}

// ---------------------------------------------------------------------------
// Knowledge gaps
// ---------------------------------------------------------------------------

/**
 * Detect the three actionable gap types, ordered by how cheap they are to fix:
 * orphan pages, then loose clusters, then the bridges holding them together.
 */
export function findCoverageGaps(
  graph: WikiGraph,
  options: InsightOptions = {},
): CoverageGap[] {
  const limit = resolveLimit(options.gapLimit, DEFAULT_GAP_LIMIT);
  if (limit === 0) return [];

  const nodeById = resolveNodes(graph);
  const gaps: CoverageGap[] = [];

  // Vault-wide degree, for the same reason the visibility switch uses it: a note
  // whose links all point outside the current scope is not an isolated page, and
  // reporting it as one would be a claim about the vault that is not true.
  const isolated = uniqueNodes(graph)
    .filter((node) => !node.isStructural && node.vaultLinkCount <= 1)
    .sort(compareByLabel);

  if (isolated.length > 0) {
    const head = isolated
      .slice(0, LABEL_PREVIEW)
      .map((node) => node.label)
      .join("、");
    const hidden = isolated.length - LABEL_PREVIEW;
    const nodeIds = isolated.map((node) => node.id);
    const title = `${isolated.length} 个孤立页面`;
    gaps.push({
      key: gapKey("isolated", title, nodeIds),
      type: "isolated",
      title,
      description: hidden > 0 ? `${head} 等 ${hidden} 个` : head,
      suggestion: ISOLATED_SUGGESTION,
      nodeIds,
    });
  }

  // Relative to this graph's own density, exactly as the community engine decides
  // it: an absolute threshold would flag nothing in a densely linked vault.
  const density = computeGraphDensity(graph.nodes.length, graph.edges.length);
  const sparse = graph.communities
    .filter((community) => isSparseCommunity(community, density))
    .sort((a, b) => a.cohesion - b.cohesion || a.id - b.id);

  for (const community of sparse) {
    const title = `稀疏知识领域：${community.topNodes[0] ?? `社区 ${community.id}`}`;
    // The ratio is what the flag is decided on, so it belongs in the card — but only
    // when there is a baseline to divide by. A vault with no links at all has none.
    const ratio =
      density > 0 ? `；约为仓库平均密度的 ${(community.cohesion / density).toFixed(2)} 倍` : "";
    gaps.push({
      key: gapKey("sparse", title, community.nodeIds),
      type: "sparse",
      title,
      description:
        `${community.nodeCount} 个页面，内聚度 ${(community.cohesion * 100).toFixed(1)}%，` +
        `平均每页 ${community.meanIntraDegree.toFixed(1)} 条内部链接${ratio}`,
      suggestion: SPARSE_SUGGESTION,
      nodeIds: community.nodeIds,
    });
  }

  for (const bridge of findBridgeNodes(nodeById, graph)) {
    const nodeIds = [bridge.node.id];
    const title = `关键桥接：${bridge.node.label}`;
    gaps.push({
      key: gapKey("bridge", title, nodeIds),
      type: "bridge",
      title,
      description: `连接 ${bridge.clusterCount} 个知识集群，是维系多个领域的关键枢纽`,
      suggestion: BRIDGE_SUGGESTION,
      nodeIds,
      clusterCount: bridge.clusterCount,
    });
  }

  return gaps.slice(0, limit);
}

interface BridgeCandidate {
  readonly node: GraphNode;
  readonly clusterCount: number;
}

/** Pages whose neighbours live in 3+ different clusters, strongest first. */
function findBridgeNodes(nodeById: ReadonlyMap<string, GraphNode>, graph: WikiGraph): BridgeCandidate[] {
  const clusters = new Map<string, Set<number>>();

  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue; // a self-link spans nothing
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    addCluster(clusters, source.id, target.community);
    addCluster(clusters, target.id, source.community);
  }

  const candidates: BridgeCandidate[] = [];
  for (const [id, communityIds] of clusters) {
    const node = nodeById.get(id);
    if (!node || node.isStructural) continue;
    if (communityIds.size < MIN_BRIDGE_CLUSTERS) continue;
    candidates.push({ node, clusterCount: communityIds.size });
  }

  candidates.sort(
    (a, b) =>
      b.clusterCount - a.clusterCount ||
      b.node.linkCount - a.node.linkCount ||
      compareStrings(a.node.id, b.node.id),
  );
  return candidates.slice(0, BRIDGE_LIMIT);
}

function addCluster(clusters: Map<string, Set<number>>, id: string, community: number): void {
  const existing = clusters.get(id);
  if (existing) existing.add(community);
  else clusters.set(id, new Set([community]));
}

function isSparseCommunity(community: CommunityInfo, graphDensity: number): boolean {
  // `isSparse` is precomputed by the community engine; recomputing from the raw
  // metrics keeps cached or hand-built graphs working when the flag is absent.
  return (
    community.isSparse ||
    isSparseFromMetrics(community.cohesion, community.nodeCount, graphDensity)
  );
}

/** Stable dismiss key for a gap card. */
export function knowledgeGapKey(gap: CoverageGap): string {
  return gapKey(gap.type, gap.title, gap.nodeIds);
}

function gapKey(type: GapType, title: string, nodeIds: readonly string[]): string {
  return `gap:${type}:${title}:${nodeIds.join(",")}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Node lookup that tolerates a graph whose index covers a superset of `nodes`. */
function resolveNodes(graph: WikiGraph): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  for (const [id, node] of graph.nodeIndex) byId.set(id, node);
  return byId;
}

/**
 * The unique nodes of a graph, in a stable order.
 *
 * `nodeIndex` deliberately aliases each node under both its lower-cased id and
 * its original-case `rawId`, so iterating `resolveNodes(...).values()` visits
 * mixed-case pages twice — which double-counted orphans and produced dismiss
 * keys containing the same id two times.
 */
function uniqueNodes(graph: WikiGraph): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  return [...byId.values()];
}

function resolveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Pinned locale: dismiss keys must not depend on the machine's default locale. */
function compareByLabel(a: GraphNode, b: GraphNode): number {
  return a.label.localeCompare(b.label, "zh") || compareStrings(a.id, b.id);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
