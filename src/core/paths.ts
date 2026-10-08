/**
 * Connectivity between two notes.
 *
 * Pure breadth-first search over the built graph — no Obsidian, no DOM — so the
 * "highlight what connects these two nodes" interaction is a testable function
 * rather than view logic.
 *
 * The interesting part is that a pair of notes is usually connected by **more
 * than one** route. Reporting only a single arbitrary shortest path makes the
 * graph look like it has a spine it does not have, so this module reports every
 * node and every edge that lies on *some* shortest path.
 */

import { edgeKey } from "./graph-keys";
import type { WikiGraph } from "../types";

export interface ConnectingPaths {
  readonly from: string;
  readonly to: string;
  /** Number of hops on a shortest path. */
  readonly distance: number;
  /**
   * The hop budget actually applied, i.e. the longest path included.
   * Equal to {@link distance} unless the caller widened it.
   */
  readonly span: number;
  /** Every node lying on some included path, nearest to `from` first. */
  readonly nodes: readonly string[];
  /** Every edge lying on some included path. */
  readonly edges: readonly string[];
  /**
   * How many distinct *shortest* routes exist, counted as the product of the
   * branchings along the way. 1 means the connection is unique.
   *
   * Deliberately still about the shortest routes: with a wider budget the
   * number of longer routes grows combinatorially and stops being informative.
   */
  readonly routeCount: number;
}

export interface PathOptions {
  /**
   * Give up past this many hops and return `null`. Unbounded by default: a long
   * chain is still a real answer, and the caller can decide how to present it.
   */
  readonly maxDistance?: number;
  /**
   * Longest path to include, in hops. Defaults to the shortest distance, which
   * reproduces "shortest paths only".
   *
   * Budgets below the shortest distance are raised to it rather than returning
   * nothing — a control that silently empties the highlight is worse than one
   * that clamps.
   */
  readonly maxHops?: number;
}

/** Undirected adjacency, built once per call from the graph's edge list. */
export function buildAdjacency(graph: WikiGraph): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const existing = adjacency.get(from);
    if (existing) existing.add(to);
    else adjacency.set(from, new Set([to]));
  };
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return adjacency;
}

/** Hop distance from `start` to every reachable node. */
export function distancesFrom(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
): Map<string, number> {
  const distance = new Map<string, number>([[start, 0]]);
  if (!adjacency.has(start)) return distance;
  let frontier: string[] = [start];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return distance;
}

/**
 * Every node and edge on a path between `from` and `to` no longer than `span`
 * hops. With the default budget (`span === distance`) that is exactly the set of
 * shortest paths.
 *
 * A node lies on such a path exactly when `d(s,v) + d(v,t) <= span`; an edge
 * lies on one exactly when `d(s,u) + 1 + d(v,t) <= span` in either orientation.
 * Two BFS passes are therefore enough to describe *all* of them, without
 * enumerating paths — which matters, because the number of paths grows
 * combinatorially with the budget while the number of *nodes* they touch does
 * not.
 *
 * Returns `null` when either node is unknown or the two are not connected.
 */
export function findConnectingPaths(
  graph: WikiGraph,
  from: string,
  to: string,
  options: PathOptions = {},
): ConnectingPaths | null {
  if (!graph.nodeIndex.has(from) || !graph.nodeIndex.has(to)) return null;

  if (from === to) {
    return { from, to, distance: 0, span: 0, nodes: [from], edges: [], routeCount: 1 };
  }

  const adjacency = buildAdjacency(graph);
  const forward = distancesFrom(adjacency, from);
  const total = forward.get(to);
  if (total === undefined) return null;
  if (options.maxDistance !== undefined && total > options.maxDistance) return null;

  // A budget below the distance would describe nothing, so it is raised.
  const span = options.maxHops === undefined ? total : Math.max(total, Math.round(options.maxHops));

  const backward = distancesFrom(adjacency, to);

  const nodes: string[] = [];
  for (const [id, ahead] of forward) {
    const behind = backward.get(id);
    if (behind !== undefined && ahead + behind <= span) nodes.push(id);
  }
  nodes.sort((a, b) => (forward.get(a) ?? 0) - (forward.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  const onPath = new Set(nodes);

  const edges: string[] = [];
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    if (!onPath.has(edge.source) || !onPath.has(edge.target)) continue;
    const forwardSource = forward.get(edge.source);
    const backwardTarget = backward.get(edge.target);
    const forwardTarget = forward.get(edge.target);
    const backwardSource = backward.get(edge.source);
    const withinBudget =
      (forwardSource !== undefined && backwardTarget !== undefined && forwardSource + 1 + backwardTarget <= span) ||
      (forwardTarget !== undefined && backwardSource !== undefined && forwardTarget + 1 + backwardSource <= span);
    if (withinBudget) edges.push(edgeKey(edge.source, edge.target));
  }
  edges.sort();

  return {
    from,
    to,
    distance: total,
    span,
    nodes,
    edges,
    routeCount: countRoutes(adjacency, forward, onPath, from, to, total),
  };
}

/** Cap for the route count, so a dense graph cannot produce an absurd number. */
const MAX_ROUTE_COUNT = 1_000_000;

/**
 * Number of distinct shortest routes from `from` to `to`, counted as
 * `ways[v] = Σ ways[u]` over the neighbours `u` one layer closer to `from`.
 *
 * Only the path subgraph is walked, so this stays proportional to the number of
 * highlighted nodes rather than to the size of the graph.
 */
function countRoutes(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  forward: ReadonlyMap<string, number>,
  onPath: ReadonlySet<string>,
  from: string,
  to: string,
  total: number,
): number {
  if (total === 0) return 1;

  const layers: string[][] = [];
  for (const id of onPath) {
    const depth = forward.get(id);
    if (depth === undefined || depth > total) continue;
    (layers[depth] ??= []).push(id);
  }

  const ways = new Map<string, number>([[from, 1]]);
  for (let depth = 1; depth <= total; depth += 1) {
    for (const id of layers[depth] ?? []) {
      let count = 0;
      for (const neighbour of adjacency.get(id) ?? []) {
        if (!onPath.has(neighbour)) continue;
        if (forward.get(neighbour) !== depth - 1) continue;
        count += ways.get(neighbour) ?? 0;
        if (count >= MAX_ROUTE_COUNT) break;
      }
      ways.set(id, Math.min(count, MAX_ROUTE_COUNT));
    }
  }
  return ways.get(to) ?? 1;
}
