/**
 * Visibility rules for the standalone graph.
 *
 * These used to be three inline `if`s inside `EnhancedGraphView.visibleNodes()`
 * — correct, but untestable, and adding tag filtering would have meant editing
 * view internals rather than a rule. Kept pure so the rules can be specified
 * and tested without a browser, and so the view only assembles them.
 *
 * Filtering is **subtractive and conjunctive**: a node is drawn unless some rule
 * excludes it, and every rule has to let it through. The one exception is the tag
 * rule in `"include"` mode, which is a "show only" rule and is spelled out at
 * {@link isNodeVisible}.
 */

import type { GraphEdge, GraphNode, PageType } from "../types";

/**
 * What the ticked tags mean.
 *
 * `"exclude"`: a page carrying any ticked tag is hidden — the original rule.
 * `"include"`: only pages carrying a ticked tag survive.
 *
 * The ticks themselves mean one thing in both modes — "the tags this filter acts
 * on" — which is what makes the same selection readable either way round.
 */
export type TagFilterMode = "exclude" | "include";

export interface VisibilityFilters {
  /** Page types to exclude. */
  readonly hiddenTypes: ReadonlySet<PageType>;
  /**
   * Louvain clusters to exclude, by id; every member of one is hidden.
   *
   * A cluster is a set of pages rather than a property of one, so this is the
   * rule behind the legend's cluster rows — clicking one takes that whole
   * knowledge cluster off the graph, and clicking it again brings it back.
   */
  readonly hiddenCommunities: ReadonlySet<number>;
  /**
   * The tags the tag filter acts on. What that means depends on
   * {@link tagFilterMode}; the name is kept because in the default mode it is
   * still exactly "the tags to hide", so stored settings keep their meaning.
   */
  readonly hiddenTags: ReadonlySet<string>;
  readonly tagFilterMode: TagFilterMode;
  readonly hideStructural: boolean;
  readonly hideIsolated: boolean;
}

export const NO_FILTERS: VisibilityFilters = {
  hiddenTypes: new Set(),
  hiddenCommunities: new Set(),
  hiddenTags: new Set(),
  tagFilterMode: "exclude",
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
  if (filters.hiddenCommunities.has(node.community)) return false;
  if (filters.hideStructural && node.isStructural) return false;
  if (filters.hideIsolated && node.linkCount === 0) return false;
  if (filters.hiddenTags.size > 0) {
    const carriesATickedTag = node.tags.some((tag) => filters.hiddenTags.has(tag));
    if (filters.tagFilterMode === "include") {
      // Show only what carries one. An empty selection is not an empty graph:
      // nothing ticked means the filter is not in use.
      if (!carriesATickedTag) return false;
    } else if (carriesATickedTag) {
      return false;
    }
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
