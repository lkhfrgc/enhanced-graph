/**
 * Visibility rules for the standalone graph.
 *
 * These used to be three inline `if`s inside `EnhancedGraphView.visibleNodes()`
 * — correct, but untestable, and adding tag filtering would have meant editing
 * view internals rather than a rule. Kept pure so the rules can be specified
 * and tested without a browser, and so the view only assembles them.
 *
 * Filtering is **subtractive and conjunctive**: a node is drawn unless some rule
 * excludes it. Hide-rules compose; nothing here has "show only" semantics.
 */

import type { GraphEdge, GraphNode, PageType } from "../types";

export interface VisibilityFilters {
  /** Page types to exclude. */
  readonly hiddenTypes: ReadonlySet<PageType>;
  /** Tags to exclude; a page carrying ANY of them is hidden. */
  readonly hiddenTags: ReadonlySet<string>;
  readonly hideStructural: boolean;
  readonly hideIsolated: boolean;
}

export const NO_FILTERS: VisibilityFilters = {
  hiddenTypes: new Set(),
  hiddenTags: new Set(),
  hideStructural: false,
  hideIsolated: false,
};

export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

/** True when the page is not excluded by any rule. */
export function isNodeVisible(node: GraphNode, filters: VisibilityFilters): boolean {
  if (filters.hiddenTypes.has(node.type)) return false;
  if (filters.hideStructural && node.isStructural) return false;
  if (filters.hideIsolated && node.linkCount === 0) return false;
  if (filters.hiddenTags.size > 0 && node.tags.some((tag) => filters.hiddenTags.has(tag))) {
    return false;
  }
  return true;
}

/** The visible subset, preserving the input order. */
export function filterNodes(
  nodes: readonly GraphNode[],
  filters: VisibilityFilters,
): GraphNode[] {
  return nodes.filter((node) => isNodeVisible(node, filters));
}

/** Edges with both ends among `nodes`; a dangling edge would break the layout. */
export function filterEdges(
  edges: readonly GraphEdge[],
  nodes: readonly GraphNode[],
): GraphEdge[] {
  const allowed = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
}

/**
 * Every tag in the graph with the number of pages carrying it.
 *
 * Sorted by count descending so the panel leads with the tags that actually
 * partition the graph, then alphabetically for a stable order at equal counts.
 */
export function collectTags(nodes: readonly GraphNode[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const tag of new Set(node.tags)) {
      if (tag.length === 0) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

/** Case-insensitive substring match for the tag list's own search box. */
export function tagMatches(tag: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return tag.toLowerCase().includes(needle);
}
