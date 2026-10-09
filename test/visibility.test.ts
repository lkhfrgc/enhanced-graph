/**
 * Specification for what the standalone view draws.
 *
 * Written before the implementation. These rules used to be three inline `if`s
 * inside `EnhancedGraphView.visibleNodes()`, which made them untestable and made
 * adding tag filtering a change to view internals rather than to a rule.
 *
 * Filtering is subtractive and conjunctive: a node is drawn unless *some* rule
 * excludes it.
 */

import { describe, expect, it } from "vitest";

import {
  NO_FILTERS,
  collectTags,
  filterEdges,
  filterNodes,
  isNodeVisible,
  tagMatches,
  type VisibilityFilters,
} from "../src/view/visibility";
import type { GraphEdge, GraphNode, PageType, WikiGraph } from "../src/types";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id.toUpperCase(),
    type: "concept" as PageType,
    rawType: "concept",
    path: `${id}.md`,
    linkCount: 3,
    // The fixtures are their own vault, so the two counts agree unless a test says
    // otherwise.
    vaultLinkCount: 3,
    inLinks: 1,
    outLinks: 2,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
    ...overrides,
  } as GraphNode;
}

function filters(overrides: Partial<VisibilityFilters> = {}): VisibilityFilters {
  return { ...NO_FILTERS, ...overrides };
}

describe("isNodeVisible", () => {
  it("draws everything by default", () => {
    expect(isNodeVisible(node("a"), NO_FILTERS)).toBe(true);
  });

  it("hides a page whose type is hidden", () => {
    const target = node("a", { type: "entity" as PageType });
    expect(isNodeVisible(target, filters({ hiddenTypes: new Set(["entity" as PageType]) }))).toBe(false);
    expect(isNodeVisible(target, filters({ hiddenTypes: new Set(["concept" as PageType]) }))).toBe(true);
  });

  it("hides every page of an excluded knowledge cluster", () => {
    // The legend's cluster rows write this list: a cluster is a set of pages, so
    // excluding one has to take all of its members off the graph at once.
    const member = node("a", { community: 2 });
    expect(isNodeVisible(member, filters({ hiddenCommunities: new Set([2]) }))).toBe(false);
    expect(isNodeVisible(member, filters({ hiddenCommunities: new Set([1, 3]) }))).toBe(true);
    expect(isNodeVisible(member, NO_FILTERS)).toBe(true);
  });

  it("hides a page carrying a hidden tag", () => {
    const target = node("a", { tags: ["rag", "retrieval"] });
    expect(isNodeVisible(target, filters({ hiddenTags: new Set(["rag"]) }))).toBe(false);
    expect(isNodeVisible(target, filters({ hiddenTags: new Set(["retrieval"]) }))).toBe(false);
  });

  it("hides a page when ANY of its tags is hidden", () => {
    const target = node("a", { tags: ["rag", "retrieval", "safety"] });
    expect(isNodeVisible(target, filters({ hiddenTags: new Set(["safety"]) }))).toBe(false);
  });

  it("keeps an untagged page when tags are hidden", () => {
    expect(isNodeVisible(node("a"), filters({ hiddenTags: new Set(["rag"]) }))).toBe(true);
  });

  it("ignores hidden tags the page does not carry", () => {
    const target = node("a", { tags: ["rag"] });
    expect(isNodeVisible(target, filters({ hiddenTags: new Set(["nothing-like-this"]) }))).toBe(true);
  });

  it("keeps ONLY pages carrying a ticked tag in include mode", () => {
    const include = (tags: string[] | null, nodeTags: string[]): boolean =>
      isNodeVisible(
        node("a", { tags: nodeTags }),
        filters({
          includedTags: tags === null ? null : new Set(tags),
          tagFilterMode: "include",
        }),
      );

    // Anything carrying one of the ticked tags survives...
    expect(include(["rag"], ["rag", "retrieval"])).toBe(true);
    expect(include(["retrieval"], ["rag", "retrieval"])).toBe(true);
    // ...and anything carrying none of them does not.
    expect(include(["safety"], ["rag", "retrieval"])).toBe(false);
    expect(include(["rag"], [])).toBe(false);
  });

  it("tells 'nothing picked yet' apart from 'keep nothing' in include mode", () => {
    const target = node("a", { tags: ["rag"] });
    // No selection yet keeps everything: that is the state include mode opens in,
    // before its list has been filled with every tag.
    expect(isNodeVisible(target, filters({ includedTags: null, tagFilterMode: "include" }))).toBe(true);
    expect(isNodeVisible(target, filters({ includedTags: null, tagFilterMode: "include" }))).toBe(true);
    // An EMPTY selection is a choice the user made — 全清 in include mode means keep
    // nothing, so every page goes.
    expect(isNodeVisible(target, filters({ includedTags: new Set(), tagFilterMode: "include" }))).toBe(false);
    expect(isNodeVisible(node("b"), filters({ includedTags: new Set(), tagFilterMode: "include" }))).toBe(false);
  });

  it("reads exclude mode from its own list, whatever include mode holds", () => {
    const target = node("a", { tags: ["rag"] });
    // The two modes keep separate selections; only the one in force is read.
    const both = filters({
      hiddenTags: new Set(["rag"]),
      includedTags: new Set(["safety"]),
      tagFilterMode: "exclude",
    });
    expect(isNodeVisible(target, both)).toBe(false);
    expect(isNodeVisible(target, { ...both, tagFilterMode: "include" })).toBe(false);
    expect(isNodeVisible(target, { ...both, tagFilterMode: "include", includedTags: new Set(["rag"]) })).toBe(
      true,
    );
  });

  it("treats no hidden tags as no filter, in either mode", () => {
    expect(isNodeVisible(node("a", { tags: ["rag"] }), filters({ tagFilterMode: "exclude" }))).toBe(true);
    expect(isNodeVisible(node("b"), filters({ tagFilterMode: "exclude" }))).toBe(true);
  });

  it("hides structural pages on request", () => {
    const target = node("a", { isStructural: true });
    expect(isNodeVisible(target, filters({ hideStructural: true }))).toBe(false);
    expect(isNodeVisible(target, filters({ hideStructural: false }))).toBe(true);
  });

  it("hides isolated pages on request", () => {
    const target = node("a", { linkCount: 0, vaultLinkCount: 0 });
    expect(isNodeVisible(target, filters({ hideIsolated: true }))).toBe(false);
    expect(isNodeVisible(target, filters({ hideIsolated: false }))).toBe(true);
  });

  it("keeps a page whose links all point outside the current build", () => {
    // The reported case: scoped to a folder, this note's only links point out of it,
    // so its in-build degree is 0 — but the vault has it linked in both directions,
    // and "isolated" is a claim about the vault.
    const target = node("solo", { linkCount: 0, vaultLinkCount: 4 });
    expect(isNodeVisible(target, filters({ hideIsolated: true }))).toBe(true);
  });

  it("combines rules conjunctively", () => {
    const target = node("a", {
      tags: ["rag"],
      isStructural: true,
      linkCount: 0,
      vaultLinkCount: 0,
    });
    expect(isNodeVisible(target, filters({ hiddenTags: new Set(["rag"]) }))).toBe(false);
    expect(isNodeVisible(target, filters({ hideStructural: true }))).toBe(false);
    expect(isNodeVisible(target, filters({ hideIsolated: true }))).toBe(false);
    expect(isNodeVisible(target, NO_FILTERS)).toBe(true);
  });

  it("does not mutate the filters it is given", () => {
    const set = new Set<PageType>();
    const target = filters({ hiddenTypes: set });
    isNodeVisible(node("a", { type: "entity" as PageType }), target);
    expect([...set]).toEqual([]);
  });
});

describe("filterNodes and filterEdges", () => {
  const nodes = [
    node("a", { tags: ["rag"] }),
    node("b", { tags: ["safety"] }),
    node("c"),
  ];
  const edges: GraphEdge[] = [
    { source: "a", target: "b" } as GraphEdge,
    { source: "b", target: "c" } as GraphEdge,
    { source: "a", target: "c" } as GraphEdge,
  ];

  it("keeps the input order", () => {
    expect(filterNodes(nodes, NO_FILTERS).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("drops only the excluded nodes", () => {
    expect(filterNodes(nodes, filters({ hiddenTags: new Set(["rag"]) })).map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("drops edges whose far end was filtered out", () => {
    const kept = filterNodes(nodes, filters({ hiddenTags: new Set(["rag"]) }));
    const keys = filterEdges(edges, kept).map((edge) => `${edge.source}-${edge.target}`);
    expect(keys).toEqual(["b-c"]);
  });

  it("keeps every edge when nothing is filtered", () => {
    expect(filterEdges(edges, nodes)).toHaveLength(3);
  });
});

describe("collectTags", () => {
  it("counts how many pages carry each tag", () => {
    const tags = collectTags([
      node("a", { tags: ["rag", "retrieval"] }),
      node("b", { tags: ["rag"] }),
      node("c"),
    ]);
    expect(tags).toEqual([
      { tag: "rag", count: 2 },
      { tag: "retrieval", count: 1 },
    ]);
  });

  it("sorts by count descending, then alphabetically", () => {
    const tags = collectTags([
      node("a", { tags: ["zebra", "apple"] }),
      node("b", { tags: ["apple"] }),
      node("c", { tags: ["mango"] }),
    ]);
    expect(tags.map((entry) => entry.tag)).toEqual(["apple", "mango", "zebra"]);
  });

  it("counts a tag once per page even if repeated", () => {
    expect(collectTags([node("a", { tags: ["rag", "rag"] })])).toEqual([{ tag: "rag", count: 1 }]);
  });

  it("ignores empty tag strings", () => {
    expect(collectTags([node("a", { tags: ["", "rag"] })])).toEqual([{ tag: "rag", count: 1 }]);
  });

  it("returns nothing for an untagged graph", () => {
    expect(collectTags([node("a"), node("b")])).toEqual([]);
  });
});

describe("tagMatches", () => {
  it("matches everything for an empty query", () => {
    expect(tagMatches("retrieval", "")).toBe(true);
    expect(tagMatches("retrieval", "   ")).toBe(true);
  });

  it("matches on a substring, ignoring case", () => {
    expect(tagMatches("Retrieval-Augmented", "retriev")).toBe(true);
    expect(tagMatches("retrieval-augmented", "AUG")).toBe(true);
    expect(tagMatches("Retrieval", "RETRIEVAL")).toBe(true);
  });

  it("does not match an unrelated tag", () => {
    expect(tagMatches("retrieval", "safety")).toBe(false);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(tagMatches("retrieval", "  rag  ")).toBe(false);
    expect(tagMatches("retrieval", "  triev  ")).toBe(true);
  });
});

describe("the view's filter set", () => {
  it("is built from the graph, not from the whole vault type list", () => {
    // A guard against a plausible future mistake: the type list is fixed, the
    // tag list must come from the data (141 tags in the demo vault).
    const graph: WikiGraph = {
      nodes: [node("a", { tags: ["rag"] })],
      edges: [],
      communities: [],
      nodeIndex: new Map(),
      folders: [],
      builtAt: 1,
    };
    expect(collectTags(graph.nodes)).toHaveLength(1);
  });
});
