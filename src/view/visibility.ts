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

import { pageTypeKey } from "../core/parse";
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
  /**
   * Page types to exclude, keyed by the type as the user declared it.
   *
   * A canonical id is also accepted, and checked as well, because settings written
   * before custom types had rows of their own store canonical ids — a vault that
   * declares `type: 概念` must still honour a stored `concept`.
   */
  readonly hiddenTypes: ReadonlySet<string>;
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
  /**
   * The tags include mode keeps, or `null` when none have been picked yet.
   *
   * The two are different states on purpose: `null` is "nothing chosen", which
   * keeps everything, while an empty set is a choice — keep nothing.
   */
  readonly includedTags: ReadonlySet<string> | null;
  readonly tagFilterMode: TagFilterMode;
  readonly hideStructural: boolean;
  readonly hideIsolated: boolean;
}

export const NO_FILTERS: VisibilityFilters = {
  hiddenTypes: new Set(),
  hiddenCommunities: new Set(),
  hiddenTags: new Set(),
  includedTags: null,
  tagFilterMode: "exclude",
  hideStructural: false,
  hideIsolated: false,
};

export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

/** One row of the type list: the declared type, how it is written, and its size. */
export interface TypeCount {
  /** Lower-cased declared type; `node.type` when the note declares none. */
  readonly key: string;
  /** The declared spelling, for display — the user's own words, not a canonical id. */
  readonly label: string;
  readonly count: number;
}

/**
 * The types present in the graph, by how many pages declare each one.
 *
 * Built from the nodes rather than from `PAGE_TYPES`: a vault with twenty custom
 * types used to get one row (其他) that could not separate them. Sorted by size so
 * the rows a user reaches for are at the top, with the key as the tie-break — by code
 * unit, not `localeCompare`, so the order is the same on every machine.
 */
export function collectTypes(nodes: readonly GraphNode[]): TypeCount[] {
  const byKey = new Map<string, TypeCount>();
  for (const node of nodes) {
    const declared = node.rawType.trim();
    const key = pageTypeKey(declared, node.type);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, count: existing.count + 1 });
    } else {
      byKey.set(key, { key, label: declared || node.type, count: 1 });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** The type a node is filtered, coloured and listed by. */
export function nodeTypeKey(node: Pick<GraphNode, "rawType" | "type">): string {
  return pageTypeKey(node.rawType, node.type);
}

/** True when the page is not excluded by any rule. */
export function isNodeVisible(node: GraphNode, filters: VisibilityFilters): boolean {
  // The declared type, and the normalised one: a stored canonical id has to keep
  // working now that the rows are keyed by what the user wrote.
  if (filters.hiddenTypes.has(nodeTypeKey(node)) || filters.hiddenTypes.has(node.type)) return false;
  if (filters.hiddenCommunities.has(node.community)) return false;
  if (filters.hideStructural && node.isStructural) return false;
  // Vault-wide, not build-wide: a note whose only links point outside the current
  // scope is a linked note that happens to have no visible neighbours, and the
  // switch is for notes that link to nothing at all.
  //
  // Structural pages are left to the switch that names them. An index with no links
  // yet is still an index, and the isolated-page insight already excludes them for
  // the same reason — a filter that hid them here would disagree with the report
  // the panel shows.
  if (filters.hideIsolated && !node.isStructural && node.vaultLinkCount === 0) return false;
  if (filters.tagFilterMode === "include") {
    const keep = filters.includedTags;
    // `null` is "nothing picked yet", which keeps everything; an EMPTY selection is
    // a real choice — the user cleared every tick and means to keep nothing.
    if (keep !== null && !node.tags.some((tag) => keep.has(tag))) return false;
  } else if (filters.hiddenTags.size > 0 && node.tags.some((tag) => filters.hiddenTags.has(tag))) {
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
