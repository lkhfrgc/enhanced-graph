/**
 * Focus state machine for the standalone graph.
 *
 * The behaviour, as driven from the node context menu (`focusNode` in
 * `graph-view.ts`):
 *   - 「聚焦邻居」                → focus that node and everything attached to it
 *   - 「查看与「A」的连通路径」   → focus every link connecting it to A
 *   - 「取消聚焦」                → clear
 *
 * A plain left click on a node deliberately does nothing; the menu is the only
 * entry point.
 *
 * Kept as a pure function of `(graph, state, nodeId)` rather than living in the
 * `ItemView`, so the rules are specified and tested without a browser. The view
 * only applies the returned highlight.
 */

import { edgeKey } from "../core/graph-keys";
import { findConnectingPaths, type ConnectingPaths } from "../core/paths";
import type { WikiGraph } from "../types";

/** What the renderer should emphasise. */
export interface Highlight {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

/** Which nodes are focused, and how they are connected. */
export interface FocusState {
  /** 0, 1 or 2 node ids, in the order they were focused. */
  readonly nodeIds: readonly string[];
  /** Set only when two nodes are focused and at least one route exists. */
  readonly connection: ConnectingPaths | null;
}

export const NO_FOCUS: FocusState = { nodeIds: [], connection: null };

export interface FocusOptions {
  /**
   * Longest path to include when connecting two nodes, in hops. Omitted means
   * shortest paths only. `1 + intermediates` is the value the UI produces:
   * "via one node" is 2 hops.
   */
  readonly maxHops?: number;
}

export type FocusKind =
  /** One node focused: it and its direct neighbourhood. */
  | "neighbourhood"
  /** Two nodes focused: every link on a shortest route between them. */
  | "connection"
  /** Focus cleared. */
  | "cleared"
  /** The two nodes are not connected; the previous focus is kept. */
  | "unreachable";

export interface FocusOutcome {
  readonly kind: FocusKind;
  readonly state: FocusState;
  readonly highlight: Highlight;
}

function emptyHighlight(): Highlight {
  return { nodes: new Set(), edges: new Set() };
}

/** A node, its direct neighbours, and the edges joining them. */
export function neighbourhoodHighlight(graph: WikiGraph, nodeId: string): Highlight {
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      nodes.add(edge.target);
      edges.add(edgeKey(edge.source, edge.target));
    } else if (edge.target === nodeId) {
      nodes.add(edge.source);
      edges.add(edgeKey(edge.source, edge.target));
    }
  }
  return { nodes, edges };
}

/**
 * The highlight a state implies. Used to re-derive emphasis after the graph is
 * rebuilt, and to keep an unreachable pair from disturbing the current focus.
 */
export function highlightFor(graph: WikiGraph, state: FocusState): Highlight {
  if (state.nodeIds.length === 2 && state.connection) {
    return { nodes: new Set(state.connection.nodes), edges: new Set(state.connection.edges) };
  }
  if (state.nodeIds.length === 1) return neighbourhoodHighlight(graph, state.nodeIds[0]);
  return emptyHighlight();
}

/**
 * Advance the focus by one menu action on `nodeId`.
 *
 * Never mutates `state`: the view keeps the returned state, and the
 * `unreachable` outcome hands the same object back so "keep the first node
 * focused" is visible in the return value rather than being an implicit side
 * effect.
 */
export function applyFocus(
  graph: WikiGraph,
  state: FocusState,
  nodeId: string,
  options: FocusOptions = {},
): FocusOutcome {
  // A stale id means the node is gone from the graph; treat it as a clear.
  if (!graph.nodeIndex.has(nodeId)) {
    return { kind: "cleared", state: NO_FOCUS, highlight: emptyHighlight() };
  }

  // Acting on anything already focused clears — the same menu item on one node
  // and on either end of a pair.
  if (state.nodeIds.includes(nodeId)) {
    return { kind: "cleared", state: NO_FOCUS, highlight: emptyHighlight() };
  }

  if (state.nodeIds.length === 1) {
    const from = state.nodeIds[0];
    const connection = findConnectingPaths(graph, from, nodeId, { maxHops: options.maxHops });
    if (!connection) {
      // Keep the first focus so a different second node can be tried without
      // starting over.
      return { kind: "unreachable", state, highlight: highlightFor(graph, state) };
    }
    return {
      kind: "connection",
      state: { nodeIds: [from, nodeId], connection },
      highlight: { nodes: new Set(connection.nodes), edges: new Set(connection.edges) },
    };
  }

  // Nothing focused, or a completed pair: start again from this node.
  return {
    kind: "neighbourhood",
    state: { nodeIds: [nodeId], connection: null },
    highlight: neighbourhoodHighlight(graph, nodeId),
  };
}
