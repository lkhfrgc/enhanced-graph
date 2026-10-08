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
/**
 * Every node and edge on a SIMPLE path from `from` to `to` of at most `span` hops.
 *
 * Needed because the distance condition above describes WALKS, not paths. The two
 * agree while `span` equals the shortest distance — a shortest route cannot
 * revisit a node — and diverge as soon as the budget is widened: in `s - x - t`
 * with a dead-end `x - y`, edge `x-y` satisfies `d(s,x) + 1 + d(y,t) = 4 <= 4`,
 * yet every walk that uses it must come back through `x`. It is on no path.
 *
 * Edges are recorded only once the walk has actually reached `to`, so a route
 * that dies in a dead end contributes nothing.
 *
 * The `backward` distances prune hard: from `next`, `to` must still be reachable
 * within the remaining budget. `STEPS_LIMIT` bounds the work regardless — a path
 * budget is small (four hops covers three intermediates) but a hub node's degree
 * is not, and an unbounded enumeration would be a worse bug than the one this
 * replaces.
 */
function simplePathSet(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  backward: ReadonlyMap<string, number>,
  from: string,
  to: string,
  span: number,
): { nodes: Set<string>; edges: Set<string>; complete: boolean } {
  const nodes = new Set<string>([from]);
  const edges = new Set<string>();
  const stack: string[] = [from];
  const visited = new Set<string>([from]);
  let steps = 0;
  let complete = true;

  const walk = (at: string, used: number): void => {
    if (!complete) return;
    if (at === to) {
      for (let i = 0; i + 1 < stack.length; i += 1) {
        edges.add(edgeKey(stack[i], stack[i + 1]));
        nodes.add(stack[i + 1]);
      }
      return;
    }
    if (used >= span) return;
    for (const next of adjacency.get(at) ?? []) {
      if (steps >= STEPS_LIMIT) {
        complete = false;
        return;
      }
      if (visited.has(next)) continue;
      const remaining = backward.get(next);
      if (remaining === undefined || used + 1 + remaining > span) continue;
      steps += 1;
      visited.add(next);
      stack.push(next);
      walk(next, used + 1);
      stack.pop();
      visited.delete(next);
    }
  };

  walk(from, 0);
  return { nodes, edges, complete };
}

/** Enumeration budget, so a dense graph cannot stall the render. */
const STEPS_LIMIT = 200_000;

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

  // Shortest-path subgraph: exact for the distance condition, and what
  // `routeCount` is defined over.
  const shortestNodes: string[] = [];
  for (const [id, ahead] of forward) {
    const behind = backward.get(id);
    if (behind !== undefined && ahead + behind <= total) shortestNodes.push(id);
  }
  const onShortest = new Set(shortestNodes);

  let nodes: string[];
  let edges: string[];
  if (span === total) {
    // Budget equals the shortest distance, so the condition is exact here and
    // costs two BFS passes instead of an enumeration.
    nodes = [...shortestNodes];
    edges = [];
    for (const edge of graph.edges) {
      if (edge.source === edge.target) continue;
      if (!onShortest.has(edge.source) || !onShortest.has(edge.target)) continue;
      const a = forward.get(edge.source);
      const b = backward.get(edge.target);
      const c = forward.get(edge.target);
      const d = backward.get(edge.source);
      if (
        (a !== undefined && b !== undefined && a + 1 + b <= span) ||
        (c !== undefined && d !== undefined && c + 1 + d <= span)
      ) {
        edges.push(edgeKey(edge.source, edge.target));
      }
    }
  } else {
    // Widened budget: enumerate the simple paths. See `simplePathSet`.
    const result = simplePathSet(adjacency, backward, from, to, span);
    nodes = [...result.nodes];
    edges = [...result.edges];
    if (!result.complete) {
      // The enumeration hit its budget. Fall back to the condition, which
      // over-includes rather than dropping the highlight entirely — a wrong edge
      // is a smaller failure than a route that does not light up at all.
      for (const id of shortestNodes) if (!result.nodes.has(id)) nodes.push(id);
      for (const edge of graph.edges) {
        if (edge.source === edge.target) continue;
        if (!result.nodes.has(edge.source) || !result.nodes.has(edge.target)) continue;
        const a = forward.get(edge.source);
        const b = backward.get(edge.target);
        const c = forward.get(edge.target);
        const d = backward.get(edge.source);
        if (
          (a !== undefined && b !== undefined && a + 1 + b <= span) ||
          (c !== undefined && d !== undefined && c + 1 + d <= span)
        ) {
          edges.push(edgeKey(edge.source, edge.target));
        }
      }
    }
  }

  nodes.sort((a, b) => (forward.get(a) ?? 0) - (forward.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
  edges.sort();

  return {
    from,
    to,
    distance: total,
    span,
    nodes,
    edges,
    routeCount: countRoutes(adjacency, forward, onShortest, from, to, total),
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
