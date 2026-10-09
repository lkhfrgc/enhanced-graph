/**
 * Louvain community detection + cohesion scoring.
 *
 * Community ids are remapped so that id 0 is always the largest cluster: this
 * makes the 12-colour palette stable across rebuilds and keeps the legend
 * ordered by importance (the reference implementation does the same).
 */

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { CommunityInfo } from "../types";

/**
 * How many times the graph's own density a community must reach to count as
 * connected enough.
 *
 * An absolute cohesion does not travel between vaults: a densely linked vault puts
 * every community above any fixed number, and a thinly linked one puts every
 * community below it. Measured on the demo vault, the flagged cluster sat at 1.05×
 * the vault's density while the next-lowest was 2.20×, so 1.5 separates them with
 * room on both sides — and it says the same thing in any vault: "no denser than the
 * graph it lives in".
 */
export const SPARSE_DENSITY_RATIO = 1.5;
/** A community needs at least this many pages before sparseness is meaningful. */
export const SPARSE_MIN_MEMBERS = 3;

/** Undirected density: edges present over edges possible. */
export function computeGraphDensity(nodeCount: number, edgeCount: number): number {
  if (nodeCount < 2) return 0;
  return edgeCount / ((nodeCount * (nodeCount - 1)) / 2);
}

/**
 * Bounds for the exposed resolution.
 *
 * Below 0.5 the whole vault collapses into a few blobs, and above 3 the clusters
 * break into pairs — both measured on a 79-note vault. The bounds are where the
 * knob stops being useful, not where the algorithm stops working.
 */
export const MIN_RESOLUTION = 0.5;
export const MAX_RESOLUTION = 3;

export function clampResolution(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, value));
}

/**
 * Louvain's random walk uses `Math.random` by default, which reshuffles
 * community ids on every rebuild of an unchanged vault — and because the node
 * colour palette is indexed by community id, that would repaint the whole
 * graph on every file save. A fixed seed makes rebuilds reproducible.
 */
const COMMUNITY_SEED = 0x9e3779b9;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CommunityNodeInput {
  readonly id: string;
  readonly label: string;
  readonly linkCount: number;
}

export interface CommunityEdgeInput {
  readonly source: string;
  readonly target: string;
  readonly weight: number;
}

export interface CommunityDetectionResult {
  readonly assignments: Map<string, number>;
  readonly communities: CommunityInfo[];
}

export function computeCommunityConnectivity(
  nodeCount: number,
  intraEdges: number,
): { cohesion: number; meanIntraDegree: number } {
  const possibleEdges = nodeCount > 1 ? (nodeCount * (nodeCount - 1)) / 2 : 1;
  return {
    cohesion: intraEdges / possibleEdges,
    meanIntraDegree: nodeCount > 0 ? (2 * intraEdges) / nodeCount : 0,
  };
}

/**
 * Whether a community is sparser than the graph it lives in.
 *
 * `graphDensity` comes from {@link computeGraphDensity} over the whole graph, so the
 * question is relative: "this cluster is no denser than the vault as a whole", which
 * is what makes the flag mean the same thing in a densely linked vault as in a
 * thinly linked one.
 */
export function isSparseCommunity(
  cohesion: number,
  nodeCount: number,
  graphDensity: number,
): boolean {
  return nodeCount >= SPARSE_MIN_MEMBERS && cohesion < graphDensity * SPARSE_DENSITY_RATIO;
}

export interface DetectCommunitiesOptions {
  /** Louvain resolution; >1 yields more, smaller clusters. */
  readonly resolution?: number;
  /** Bypass Louvain and use these assignments (used by tests). */
  readonly forcedAssignments?: ReadonlyMap<string, number>;
  /**
   * Communities from the previous build. When supplied, ids are re-used so
   * that a cluster keeps its colour as the vault evolves.
   */
  readonly previousCommunities?: readonly CommunityInfo[];
  /** Override the Louvain RNG seed (tests only). */
  readonly seed?: number;
}

export function deriveCommunities(
  nodes: readonly CommunityNodeInput[],
  edges: readonly CommunityEdgeInput[],
  options: DetectCommunitiesOptions = {},
): CommunityDetectionResult {
  if (nodes.length === 0) return { assignments: new Map(), communities: [] };

  const assignments = options.forcedAssignments
    ? new Map(options.forcedAssignments)
    : runLouvain(nodes, edges, options.resolution ?? 1, options.seed ?? COMMUNITY_SEED);

  return summarise(nodes, edges, assignments, options.previousCommunities);
}

function runLouvain(
  nodes: readonly CommunityNodeInput[],
  edges: readonly CommunityEdgeInput[],
  resolution: number,
  seed: number,
): Map<string, number> {
  const graph = new Graph({ type: "undirected", multi: false });
  for (const node of nodes) {
    if (!graph.hasNode(node.id)) graph.addNode(node.id);
  }
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    // Coerce to a finite positive weight: a zero/NaN weight makes Louvain's
    // modularity pass produce degenerate single-node communities.
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    if (graph.hasEdge(edge.source, edge.target)) {
      graph.updateEdge(edge.source, edge.target, (current) => ({
        weight: (current.weight ?? 1) + weight,
      }));
    } else {
      graph.addEdge(edge.source, edge.target, { weight });
    }
  }

  if (graph.order === 0) return new Map();
  if (graph.size === 0) {
    // No edges: Louvain would put every node in one community; isolate instead.
    return new Map(nodes.map((node) => [node.id, 0]));
  }

  const raw = louvain(graph, { resolution, rng: mulberry32(seed), randomWalk: true }) as Record<string, number>;
  return new Map(Object.entries(raw));
}

function summarise(
  nodes: readonly CommunityNodeInput[],
  edges: readonly CommunityEdgeInput[],
  assignments: Map<string, number>,
  previousCommunities?: readonly CommunityInfo[],
): CommunityDetectionResult {
  const nodeInfo = new Map(nodes.map((node) => [node.id, node]));

  const groups = new Map<number, string[]>();
  for (const node of nodes) {
    const communityId = assignments.get(node.id) ?? 0;
    const members = groups.get(communityId);
    if (members) members.push(node.id);
    else groups.set(communityId, [node.id]);
  }

  // Counting internal edges directly is O(E); comparing member pairs is O(N²)
  // and dominates large vaults.
  const intraEdgesByCommunity = new Map<number, number>();
  for (const edge of edges) {
    const sourceCommunity = assignments.get(edge.source);
    if (sourceCommunity === undefined) continue;
    if (sourceCommunity !== assignments.get(edge.target)) continue;
    intraEdgesByCommunity.set(sourceCommunity, (intraEdgesByCommunity.get(sourceCommunity) ?? 0) + 1);
  }

  // The core note is the one the cluster is named after, so it has to be measured
  // the way the cluster was BUILT: Louvain partitions a graph weighted by the
  // association score, and ranking members by raw link count instead can name a
  // page the clustering itself barely used. Ties fall back to link count and then
  // to id, so the name is stable across rebuilds.
  const weightedDegree = new Map<string, number>();
  for (const edge of edges) {
    const weight = Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    weightedDegree.set(edge.source, (weightedDegree.get(edge.source) ?? 0) + weight);
    weightedDegree.set(edge.target, (weightedDegree.get(edge.target) ?? 0) + weight);
  }

  const communities: CommunityInfo[] = [];
  // The baseline the sparseness question is asked against: this graph's own density.
  const graphDensity = computeGraphDensity(nodes.length, edges.length);
  for (const [communityId, memberIds] of groups) {
    const nodeCount = memberIds.length;
    const intraEdges = intraEdgesByCommunity.get(communityId) ?? 0;
    const { cohesion, meanIntraDegree } = computeCommunityConnectivity(nodeCount, intraEdges);
    const topNodes = [...memberIds]
      .sort(
        (a, b) =>
          (weightedDegree.get(b) ?? 0) - (weightedDegree.get(a) ?? 0) ||
          (nodeInfo.get(b)?.linkCount ?? 0) - (nodeInfo.get(a)?.linkCount ?? 0) ||
          (a < b ? -1 : a > b ? 1 : 0),
      )
      .slice(0, 5)
      .map((id) => nodeInfo.get(id)?.label ?? id);
    communities.push({
      id: communityId,
      nodeCount,
      intraEdges,
      cohesion,
      meanIntraDegree,
      topNodes,
      isSparse: isSparseCommunity(cohesion, nodeCount, graphDensity),
      nodeIds: [...memberIds],
    });
  }

  // Largest first, then remap so palette index 0 is the biggest cluster.
  communities.sort((a, b) => b.nodeCount - a.nodeCount || a.id - b.id);
  const idRemap = previousCommunities?.length
    ? stableIdMapping(communities, previousCommunities)
    : new Map(communities.map((community, index) => [community.id, index]));
  const remapped: CommunityInfo[] = communities.map((community) => ({
    ...community,
    id: idRemap.get(community.id) ?? 0,
  }));
  remapped.sort((a, b) => a.id - b.id);
  for (const [nodeId, oldId] of assignments) {
    assignments.set(nodeId, idRemap.get(oldId) ?? 0);
  }

  return { assignments, communities: remapped };
}

/**
 * Map new community ids onto the previous build's ids by member overlap, so a
 * cluster that survives a rebuild keeps the colour the user already learned.
 * Greedy maximum-overlap matching; unmatched clusters take the free slots in
 * descending size order.
 */
function stableIdMapping(
  communities: readonly CommunityInfo[],
  previous: readonly CommunityInfo[],
): Map<number, number> {
  const previousMembers = new Map<number, Set<string>>();
  for (const community of previous) previousMembers.set(community.id, new Set(community.nodeIds));

  interface Pair {
    newId: number;
    previousId: number;
    overlap: number;
  }
  const pairs: Pair[] = [];
  for (const community of communities) {
    for (const prior of previous) {
      const members = previousMembers.get(prior.id);
      if (!members) continue;
      let overlap = 0;
      for (const id of community.nodeIds) if (members.has(id)) overlap += 1;
      if (overlap > 0) pairs.push({ newId: community.id, previousId: prior.id, overlap });
    }
  }
  pairs.sort((a, b) => b.overlap - a.overlap || a.newId - b.newId || a.previousId - b.previousId);

  const mapping = new Map<number, number>();
  const claimedPrevious = new Set<number>();
  for (const pair of pairs) {
    if (mapping.has(pair.newId) || claimedPrevious.has(pair.previousId)) continue;
    mapping.set(pair.newId, pair.previousId);
    claimedPrevious.add(pair.previousId);
  }

  // Free slots: ids the previous build used that no new cluster claimed, plus
  // fresh ids above everything seen so far.
  const used = new Set(mapping.values());
  const highestSeen = Math.max(-1, ...previous.map((community) => community.id));
  const free: number[] = [];
  for (let id = 0; id <= highestSeen; id += 1) if (!used.has(id)) free.push(id);
  let nextFresh = highestSeen + 1;
  for (const community of communities) {
    if (mapping.has(community.id)) continue;
    const slot = free.length > 0 ? (free.shift() as number) : nextFresh++;
    mapping.set(community.id, slot);
  }
  return mapping;
}
