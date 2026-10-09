import { describe, expect, it } from "vitest";

import type {
  CommunityInfo,
  GraphEdge,
  GraphNode,
  CoverageGap,
  PageType,
  WikiGraph,
} from "../src/types";
import { SPARSE_MIN_MEMBERS, computeCommunityConnectivity } from "../src/core/communities";
import {
  analyzeGraph,
  connectionKey,
  findCoverageGaps,
  rankUnexpectedLinks,
  knowledgeGapKey,
} from "../src/core/insights";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface NodeOverrides {
  readonly id: string;
  readonly label?: string;
  readonly type?: PageType;
  readonly linkCount?: number;
  readonly community?: number;
  readonly sources?: readonly string[];
  readonly isStructural?: boolean;
}

function makeNode(overrides: NodeOverrides): GraphNode {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    type: overrides.type ?? "other",
    rawType: "",
    path: `${overrides.id}.md`,
    linkCount: overrides.linkCount ?? 0,
    inLinks: overrides.linkCount ?? 0,
    outLinks: 0,
    community: overrides.community ?? 0,
    sources: overrides.sources ?? [],
    tags: [],
    isStructural: overrides.isStructural ?? false,
  };
}

interface EdgeOverrides {
  readonly weight?: number;
  readonly sharedSources?: readonly string[];
  readonly commonNeighbors?: number;
}

function makeEdge(source: string, target: string, overrides: EdgeOverrides = {}): GraphEdge {
  const weight = overrides.weight ?? 5;
  return {
    source,
    target,
    weight,
    signals: { directLink: 0, sourceOverlap: 0, adamicAdar: 0, coCitation: 0, total: weight },
    hasDirectLink: true,
    sharedSources: overrides.sharedSources ?? [],
    commonNeighbors: overrides.commonNeighbors ?? 0,
  };
}

function makeCommunity(
  id: number,
  nodeIds: readonly string[],
  intraEdges: number,
  overrides: { readonly topNodes?: readonly string[]; readonly isSparse?: boolean } = {},
): CommunityInfo {
  const nodeCount = nodeIds.length;
  const { cohesion, meanIntraDegree } = computeCommunityConnectivity(nodeCount, intraEdges);
  return {
    id,
    nodeCount,
    intraEdges,
    cohesion,
    meanIntraDegree,
    topNodes: overrides.topNodes ?? nodeIds.slice(0, 5),
    // This fixture builds communities by hand, so it decides the flag the same way
    // the engine does: relative to the density of the graph it is put into.
    isSparse: overrides.isSparse ?? false,
    nodeIds,
  };
}

function makeGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[] = [],
  communities: readonly CommunityInfo[] = [],
  extraIndexKeys: ReadonlyMap<string, GraphNode> = new Map(),
): WikiGraph {
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  for (const [key, node] of extraIndexKeys) nodeIndex.set(key, node);
  return { nodes, edges, communities, nodeIndex, folders: [], builtAt: 1 };
}

function keysOf(connections: readonly { readonly key: string }[]): string[] {
  return connections.map((connection) => connection.key);
}

// ---------------------------------------------------------------------------
// Surprising connections
// ---------------------------------------------------------------------------

describe("rankUnexpectedLinks", () => {
  it("scores a bare cross-community edge 3 with cross-community as the only reason", () => {
    const graph = makeGraph([
      makeNode({ id: "a", community: 0 }),
      makeNode({ id: "b", community: 1 }),
    ], [makeEdge("a", "b", { weight: 3 })]);

    const connections = rankUnexpectedLinks(graph);

    expect(connections).toHaveLength(1);
    expect(connections[0]?.score).toBe(3);
    expect(connections[0]?.reasons).toEqual(["cross-community"]);
    expect(connections[0]?.contributions).toEqual({ "cross-community": 3 });
    expect(connections[0]?.weight).toBe(3);
    expect(connections[0]?.key).toBe("a:::b");
  });

  it("adds distant-types (+2) to a cross-community source↔concept edge for a score of 5", () => {
    const graph = makeGraph([
      makeNode({ id: "src", type: "source", community: 0 }),
      makeNode({ id: "con", type: "concept", community: 1 }),
    ], [makeEdge("src", "con")]);

    const connections = rankUnexpectedLinks(graph);

    expect(connections[0]?.score).toBe(5);
    expect(connections[0]?.reasons).toEqual(["cross-community", "distant-types"]);
    expect(connections[0]?.contributions).toEqual({ "cross-community": 3, "distant-types": 2 });
  });

  it("treats the distant set as unordered and emits only one of cross-type / distant-types", () => {
    const graph = makeGraph([
      makeNode({ id: "the", type: "thesis", community: 0 }),
      makeNode({ id: "src", type: "source", community: 1 }),
      makeNode({ id: "met", type: "methodology", community: 2 }),
      makeNode({ id: "ent", type: "entity", community: 3 }),
      makeNode({ id: "que", type: "query", community: 4 }),
      makeNode({ id: "con", type: "concept", community: 5 }),
      makeNode({ id: "fin", type: "finding", community: 6 }),
    ], [
      makeEdge("src", "the"), // distant, reversed relative to the table
      makeEdge("src", "met"), // distant
      makeEdge("ent", "que"), // distant
      makeEdge("con", "fin"), // cross-type only
    ]);

    const byKey = new Map(rankUnexpectedLinks(graph).map((c) => [c.key, c]));

    expect(byKey.get(connectionKey("src", "the"))?.reasons).toEqual(["cross-community", "distant-types"]);
    expect(byKey.get(connectionKey("src", "met"))?.reasons).toEqual(["cross-community", "distant-types"]);
    expect(byKey.get(connectionKey("ent", "que"))?.reasons).toEqual(["cross-community", "distant-types"]);
    expect(byKey.get(connectionKey("con", "fin"))?.reasons).toEqual(["cross-community", "cross-type"]);
    expect(byKey.get(connectionKey("con", "fin"))?.score).toBe(4);
  });

  it("fires peripheral-hub only when the hub holds at least half of maxDegree", () => {
    const graph = makeGraph([
      makeNode({ id: "hub", community: 0, linkCount: 10 }),
      makeNode({ id: "leaf", community: 1, linkCount: 1 }),
      makeNode({ id: "mid", community: 2, linkCount: 4 }),
      makeNode({ id: "low", community: 3, linkCount: 3 }),
    ], [makeEdge("hub", "leaf"), makeEdge("mid", "low")]);

    const byKey = new Map(rankUnexpectedLinks(graph).map((c) => [c.key, c]));

    // maxDegree 10 → a hub needs ≥ 5 links for the peripheral↔core signal.
    expect(byKey.get(connectionKey("hub", "leaf"))?.reasons).toEqual([
      "cross-community",
      "peripheral-hub",
    ]);
    expect(byKey.get(connectionKey("hub", "leaf"))?.score).toBe(5);
    expect(byKey.get(connectionKey("mid", "low"))?.reasons).toEqual(["cross-community"]);
    expect(byKey.get(connectionKey("mid", "low"))?.contributions["peripheral-hub"]).toBeUndefined();
  });

  it("does not fire peripheral-hub when the edge joins two high-degree nodes", () => {
    const graph = makeGraph([
      makeNode({ id: "a", community: 0, linkCount: 8 }),
      makeNode({ id: "b", community: 1, linkCount: 8 }),
    ], [makeEdge("a", "b")]);

    expect(rankUnexpectedLinks(graph)[0]?.reasons).toEqual(["cross-community"]);
  });

  it("requires two shared sources for source-overlap, adding exactly 2", () => {
    const graph = makeGraph([
      makeNode({ id: "a", community: 0 }),
      makeNode({ id: "b", community: 1 }),
      makeNode({ id: "c", community: 0 }),
      makeNode({ id: "d", community: 1 }),
      makeNode({ id: "e", community: 2 }),
      makeNode({ id: "f", community: 2 }),
    ], [
      makeEdge("a", "b", { sharedSources: ["s1"] }),
      makeEdge("c", "d", { sharedSources: ["s1", "s2"] }),
      makeEdge("e", "f", { sharedSources: ["s1", "s2"] }),
    ]);

    const byKey = new Map(rankUnexpectedLinks(graph).map((c) => [c.key, c]));

    const oneShared = byKey.get(connectionKey("a", "b"));
    expect(oneShared?.reasons).toEqual(["cross-community"]);
    expect(oneShared?.score).toBe(3);

    const twoShared = byKey.get(connectionKey("c", "d"));
    expect(twoShared?.reasons).toEqual(["cross-community", "source-overlap"]);
    expect(twoShared?.contributions["source-overlap"]).toBe(2);
    expect(twoShared?.score).toBe(5);

    // Same signal without a cross-community hop stays under the default minScore.
    expect(byKey.has(connectionKey("e", "f"))).toBe(false);
  });

  it("adds weak-tie only for weights strictly between 0 and 2", () => {
    const graph = makeGraph([
      makeNode({ id: "a", community: 0 }),
      makeNode({ id: "b", community: 1 }),
      makeNode({ id: "c", community: 0 }),
      makeNode({ id: "d", community: 1 }),
      makeNode({ id: "e", community: 0 }),
      makeNode({ id: "f", community: 1 }),
    ], [
      makeEdge("a", "b", { weight: 1.5 }),
      makeEdge("c", "d", { weight: 2 }),
      makeEdge("e", "f", { weight: 0 }),
    ]);

    const byKey = new Map(rankUnexpectedLinks(graph).map((c) => [c.key, c]));

    expect(byKey.get(connectionKey("a", "b"))?.reasons).toEqual(["cross-community", "weak-tie"]);
    expect(byKey.get(connectionKey("a", "b"))?.score).toBe(4);
    expect(byKey.get(connectionKey("c", "d"))?.reasons).toEqual(["cross-community"]);
    expect(byKey.get(connectionKey("e", "f"))?.reasons).toEqual(["cross-community"]);
  });

  it("skips every edge touching a structural node", () => {
    const graph = makeGraph([
      makeNode({ id: "index", community: 0, linkCount: 20, isStructural: true }),
      makeNode({ id: "a", community: 1, linkCount: 3 }),
      makeNode({ id: "b", community: 2, linkCount: 3, isStructural: true }),
      makeNode({ id: "c", community: 3, linkCount: 3 }),
    ], [makeEdge("index", "a"), makeEdge("b", "c")]);

    expect(rankUnexpectedLinks(graph)).toEqual([]);
  });

  it("collapses duplicate and reversed edges into one connection", () => {
    const graph = makeGraph([
      makeNode({ id: "a", community: 0 }),
      makeNode({ id: "b", community: 1 }),
    ], [makeEdge("a", "b"), makeEdge("a", "b", { weight: 9 }), makeEdge("b", "a")]);

    const connections = rankUnexpectedLinks(graph);

    expect(connections).toHaveLength(1);
    expect(connections[0]?.weight).toBe(5);
  });

  it("filters by minScore and slices by connectionLimit", () => {
    const graph = makeGraph([
      makeNode({ id: "s1", type: "source", community: 0 }),
      makeNode({ id: "c1", type: "concept", community: 1 }),
      makeNode({ id: "e1", type: "entity", community: 0 }),
      makeNode({ id: "q1", type: "query", community: 1 }),
      makeNode({ id: "o1", community: 0 }),
      makeNode({ id: "o2", community: 1 }),
    ], [makeEdge("o1", "o2"), makeEdge("e1", "q1"), makeEdge("s1", "c1")]);

    // score desc, then key asc: both 5s precede the 3.
    expect(keysOf(rankUnexpectedLinks(graph))).toEqual(["c1:::s1", "e1:::q1", "o1:::o2"]);
    expect(keysOf(rankUnexpectedLinks(graph, { connectionLimit: 2 }))).toEqual([
      "c1:::s1",
      "e1:::q1",
    ]);
    expect(keysOf(rankUnexpectedLinks(graph, { connectionLimit: 1 }))).toEqual(["c1:::s1"]);
    expect(keysOf(rankUnexpectedLinks(graph, { minScore: 5 }))).toEqual([
      "c1:::s1",
      "e1:::q1",
    ]);
    expect(keysOf(rankUnexpectedLinks(graph, { minScore: 6 }))).toEqual([]);
    expect(rankUnexpectedLinks(graph, { connectionLimit: 0 })).toEqual([]);
  });

  it("orders deterministically regardless of edge order", () => {
    const nodes = [
      makeNode({ id: "n1", community: 0 }),
      makeNode({ id: "n2", community: 1 }),
      makeNode({ id: "n3", community: 0 }),
      makeNode({ id: "n4", community: 1 }),
    ];
    const forward = makeGraph(nodes, [makeEdge("n1", "n2"), makeEdge("n3", "n4")]);
    const reversed = makeGraph(nodes, [makeEdge("n3", "n4"), makeEdge("n1", "n2")]);

    expect(keysOf(rankUnexpectedLinks(forward))).toEqual(["n1:::n2", "n3:::n4"]);
    expect(keysOf(rankUnexpectedLinks(reversed))).toEqual(["n1:::n2", "n3:::n4"]);
  });
});

// ---------------------------------------------------------------------------
// Knowledge gaps — isolated nodes
// ---------------------------------------------------------------------------

describe("findCoverageGaps / isolated-node", () => {
  it("collects degree 0 and 1 pages, excludes structural ones and lists every id", () => {
    const graph = makeGraph([
      makeNode({ id: "alpha", label: "Alpha", linkCount: 0 }),
      makeNode({ id: "beta", label: "Beta", linkCount: 1 }),
      makeNode({ id: "gamma", label: "Gamma", linkCount: 2 }),
      makeNode({ id: "index", label: "Index", linkCount: 0, isStructural: true }),
    ]);

    const gaps = findCoverageGaps(graph);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.type).toBe("isolated");
    expect(gaps[0]?.title).toBe("2 个孤立页面");
    expect(gaps[0]?.description).toBe("Alpha、Beta");
    expect(gaps[0]?.nodeIds).toEqual(["alpha", "beta"]);
    expect(gaps[0]?.suggestion).toContain("[[wikilinks]]");
    expect(gaps[0]?.key).toBe(knowledgeGapKey(gaps[0] as CoverageGap));
  });

  it("summarises more than five labels with 等 N 个", () => {
    const nodes = Array.from({ length: 8 }, (_, index) =>
      makeNode({ id: `p${index + 1}`, label: `P${index + 1}`, linkCount: index % 2 }),
    );

    const gap = findCoverageGaps(makeGraph(nodes))[0];

    expect(gap?.title).toBe("8 个孤立页面");
    expect(gap?.description).toBe("P1、P2、P3、P4、P5 等 3 个");
    expect(gap?.nodeIds).toEqual([
      "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8",
    ]);
  });

  it("keeps the key stable when the node list arrives in a different order", () => {
    const ordered = makeGraph([
      makeNode({ id: "a", label: "Alpha" }),
      makeNode({ id: "b", label: "Beta" }),
    ]);
    const shuffled = makeGraph([
      makeNode({ id: "b", label: "Beta" }),
      makeNode({ id: "a", label: "Alpha" }),
    ]);

    const first = findCoverageGaps(ordered)[0];
    const second = findCoverageGaps(shuffled)[0];

    expect(first?.key).toBe(second?.key);
    expect(first?.nodeIds).toEqual(second?.nodeIds);
  });

  it("emits no isolated gap when every page has two or more links", () => {
    const graph = makeGraph([
      makeNode({ id: "a", linkCount: 2 }),
      makeNode({ id: "b", linkCount: 7 }),
    ]);

    expect(findCoverageGaps(graph)).toEqual([]);
  });

  it("counts a mixed-case page once even though nodeIndex aliases its rawId", () => {
    // Regression: nodeIndex maps both `concepts/splade` and `concepts/SPLADE`
    // to the same node, so iterating the index used to report it twice.
    const node = makeNode({ id: "concepts/splade", label: "SPLADE", linkCount: 1 });
    const graph = makeGraph(
      [node, makeNode({ id: "b", label: "Beta", linkCount: 1 })],
      [],
      [],
      new Map([["concepts/SPLADE", node]]),
    );

    const gap = findCoverageGaps(graph)[0];

    expect(gap?.title).toBe("2 个孤立页面");
    // Sorted by label: "Beta" before "SPLADE".
    expect(gap?.nodeIds).toEqual(["b", "concepts/splade"]);
    expect(new Set(gap?.nodeIds).size).toBe(gap?.nodeIds.length);
  });
});

// ---------------------------------------------------------------------------
// Knowledge gaps — sparse communities
// ---------------------------------------------------------------------------

describe("findCoverageGaps / sparse-community", () => {
  function sparseFixture(ids: readonly string[]): GraphNode[] {
    return ids.map((id) => makeNode({ id, label: id.toUpperCase(), community: 0, linkCount: 3 }));
  }

  it("does not flag a 4-page cluster with one internal edge (cohesion 1/6)", () => {
    const community = makeCommunity(0, ["a", "b", "c", "d"], 1);

    expect(community.cohesion).toBeCloseTo(1 / 6, 6);
    expect(community.isSparse).toBe(false);

    const gaps = findCoverageGaps(makeGraph(sparseFixture(["a", "b", "c", "d"]), [], [community]));
    expect(gaps.filter((gap) => gap.type === "sparse")).toEqual([]);
  });

  it("flags the same 4-page cluster once it has no internal edges", () => {
    // `isSparse` is what the community engine decides — now against the graph's own
    // density — so this fixture states it rather than deriving it. The derivation
    // itself is covered in `communities.test.ts`, including the two-vault case.
    const community = makeCommunity(0, ["a", "b", "c", "d"], 0, {
      topNodes: ["Alpha"],
      isSparse: true,
    });

    expect(community.cohesion).toBe(0);

    const gaps = findCoverageGaps(makeGraph(sparseFixture(["a", "b", "c", "d"]), [], [community]));

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.type).toBe("sparse");
    expect(gaps[0]?.title).toBe("稀疏知识领域：Alpha");
    expect(gaps[0]?.description).toBe("4 个页面，内聚度 0.0%，平均每页 0.0 条内部链接");
    expect(gaps[0]?.nodeIds).toEqual(["a", "b", "c", "d"]);
    expect(gaps[0]?.suggestion).toContain("[[wikilinks]]");
  });

  it("flags a 5-page cluster with one internal edge (cohesion 0.1)", () => {
    const community = makeCommunity(0, ["v", "w", "x", "y", "z"], 1, {
      topNodes: ["V"],
      isSparse: true,
    });

    expect(community.cohesion).toBeCloseTo(0.1, 6);

    const gaps = findCoverageGaps(makeGraph(sparseFixture(["v", "w", "x", "y", "z"]), [], [community]));

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.description).toBe("5 个页面，内聚度 10.0%，平均每页 0.4 条内部链接");
  });

  it("ignores clusters below the minimum member count", () => {
    const community = makeCommunity(0, ["a", "b"], 0);

    expect(community.nodeCount).toBeLessThan(SPARSE_MIN_MEMBERS);
    expect(community.isSparse).toBe(false);

    const gaps = findCoverageGaps(makeGraph(sparseFixture(["a", "b"]), [], [community]));
    expect(gaps).toEqual([]);
  });

  it("falls back to 社区 <id> when a cluster has no top nodes", () => {
    const community = makeCommunity(7, ["a", "b", "c"], 0, { topNodes: [], isSparse: true });

    const gaps = findCoverageGaps(makeGraph(sparseFixture(["a", "b", "c"]), [], [community]));
    expect(gaps[0]?.title).toBe("稀疏知识领域：社区 7");
  });

  it("reports the worst cohesion first", () => {
    const worst = makeCommunity(0, ["a", "b", "c"], 0, { topNodes: ["Worst"], isSparse: true });
    const better = makeCommunity(1, ["d", "e", "f", "g", "h"], 1, {
      topNodes: ["Better"],
      isSparse: true,
    });

    const gaps = findCoverageGaps(
      makeGraph(sparseFixture(["a", "b", "c", "d", "e", "f", "g", "h"]), [], [better, worst]),
    );

    expect(gaps.map((gap) => gap.title)).toEqual(["稀疏知识领域：Worst", "稀疏知识领域：Better"]);
  });
});

// ---------------------------------------------------------------------------
// Knowledge gaps — bridge nodes
// ---------------------------------------------------------------------------

describe("findCoverageGaps / bridge-node", () => {
  it("qualifies a page touching three clusters, but not one touching two", () => {
    const graph = makeGraph([
      makeNode({ id: "hub", label: "Hub", community: 0, linkCount: 8 }),
      makeNode({ id: "n1", label: "N1", community: 0, linkCount: 3 }),
      makeNode({ id: "n2", label: "N2", community: 1, linkCount: 3 }),
      makeNode({ id: "n3", label: "N3", community: 2, linkCount: 3 }),
      makeNode({ id: "two", label: "Two", community: 0, linkCount: 3 }),
      makeNode({ id: "n4", label: "N4", community: 3, linkCount: 3 }),
      makeNode({ id: "index", label: "Index", community: 0, linkCount: 20, isStructural: true }),
    ], [
      makeEdge("hub", "n1"), makeEdge("hub", "n2"), makeEdge("hub", "n3"),
      makeEdge("two", "n1"), makeEdge("two", "n2"),
      // A structural page spanning four clusters must stay out of the report.
      makeEdge("index", "n1"), makeEdge("index", "n2"),
      makeEdge("index", "n3"), makeEdge("index", "n4"),
    ]);

    const gaps = findCoverageGaps(graph);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.type).toBe("bridge");
    expect(gaps[0]?.title).toBe("关键桥接：Hub");
    expect(gaps[0]?.description).toBe("连接 3 个知识集群，是维系多个领域的关键枢纽");
    expect(gaps[0]?.clusterCount).toBe(3);
    expect(gaps[0]?.nodeIds).toEqual(["hub"]);
    expect(gaps[0]?.suggestion).toContain("[[wikilinks]]");
  });

  it("keeps the three strongest bridges, by cluster count then link count", () => {
    function spoke(id: string, label: string, linkCount: number, clusters: readonly number[]) {
      const nodes = [makeNode({ id, label, community: 0, linkCount })];
      const edges: GraphEdge[] = [];
      clusters.forEach((community, index) => {
        const leafId = `${id}-leaf${index}`;
        nodes.push(makeNode({ id: leafId, label: leafId, community, linkCount: 3 }));
        edges.push(makeEdge(id, leafId));
      });
      return { nodes, edges };
    }

    const b1 = spoke("b1", "B1", 5, [10, 11, 12]);
    const b2 = spoke("b2", "B2", 9, [13, 14, 15]);
    const b3 = spoke("b3", "B3", 4, [16, 17, 18, 19]);
    const b4 = spoke("b4", "B4", 2, [20, 21, 22]);

    const graph = makeGraph(
      [...b1.nodes, ...b2.nodes, ...b3.nodes, ...b4.nodes],
      [...b1.edges, ...b2.edges, ...b3.edges, ...b4.edges],
    );

    const bridges = findCoverageGaps(graph).filter((gap) => gap.type === "bridge");

    expect(bridges.map((gap) => gap.title)).toEqual([
      "关键桥接：B3",
      "关键桥接：B2",
      "关键桥接：B1",
    ]);
    expect(bridges.map((gap) => gap.clusterCount)).toEqual([4, 3, 3]);
  });

  it("ignores self-links when counting clusters", () => {
    const graph = makeGraph([
      makeNode({ id: "solo", label: "Solo", community: 0, linkCount: 4 }),
      makeNode({ id: "x", label: "X", community: 1, linkCount: 3 }),
      makeNode({ id: "y", label: "Y", community: 2, linkCount: 3 }),
    ], [makeEdge("solo", "solo"), makeEdge("solo", "x"), makeEdge("solo", "y")]);

    const bridges = findCoverageGaps(graph).filter((gap) => gap.type === "bridge");

    // The self-link is ignored, so Solo only spans the two neighbour clusters.
    expect(bridges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gap ordering and limits
// ---------------------------------------------------------------------------

describe("findCoverageGaps / ordering and limits", () => {
  function mixedGraph(): WikiGraph {
    const nodes = [
      makeNode({ id: "iso", label: "Iso", community: 0, linkCount: 0 }),
      makeNode({ id: "s1", label: "S1", community: 5, linkCount: 3 }),
      makeNode({ id: "s2", label: "S2", community: 5, linkCount: 3 }),
      makeNode({ id: "s3", label: "S3", community: 5, linkCount: 3 }),
      makeNode({ id: "hub", label: "Hub", community: 0, linkCount: 6 }),
      makeNode({ id: "b1", label: "B1", community: 1, linkCount: 3 }),
      makeNode({ id: "b2", label: "B2", community: 2, linkCount: 3 }),
      makeNode({ id: "b3", label: "B3", community: 3, linkCount: 3 }),
    ];
    return makeGraph(
      nodes,
      [makeEdge("hub", "b1"), makeEdge("hub", "b2"), makeEdge("hub", "b3")],
      [makeCommunity(5, ["s1", "s2", "s3"], 0, { topNodes: ["S1"] })],
    );
  }

  it("orders isolated-node, then sparse communities, then bridge nodes", () => {
    const gaps = findCoverageGaps(mixedGraph());

    expect(gaps.map((gap) => gap.type)).toEqual([
      "isolated",
      "sparse",
      "bridge",
    ]);
    expect(gaps[0]?.title).toBe("1 个孤立页面");
    expect(gaps[2]?.title).toBe("关键桥接：Hub");
  });

  it("slices to gapLimit only after ordering", () => {
    const graph = mixedGraph();

    expect(findCoverageGaps(graph, { gapLimit: 1 }).map((gap) => gap.type)).toEqual([
      "isolated",
    ]);
    expect(findCoverageGaps(graph, { gapLimit: 2 }).map((gap) => gap.type)).toEqual([
      "isolated",
      "sparse",
    ]);
    expect(findCoverageGaps(graph, { gapLimit: 0 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Keys and the combined entry point
// ---------------------------------------------------------------------------

describe("keys", () => {
  it("builds an order-independent connection key", () => {
    expect(connectionKey("a", "b")).toBe("a:::b");
    expect(connectionKey("b", "a")).toBe("a:::b");
    expect(connectionKey("b", "a")).toBe(connectionKey("a", "b"));
    expect(connectionKey("b", "b")).toBe("b:::b");
  });

  it("builds the documented gap key", () => {
    const built: CoverageGap = {
      key: "",
      type: "isolated",
      title: "2 个孤立页面",
      description: "",
      suggestion: "",
      nodeIds: ["a", "b"],
    };

    expect(knowledgeGapKey(built)).toBe("gap:isolated:2 个孤立页面:a,b");
  });
});

describe("analyzeGraph", () => {
  it("returns both analyses with one shared option bag", () => {
    const nodes = [
      makeNode({ id: "a", type: "source", community: 0, linkCount: 3 }),
      makeNode({ id: "b", type: "concept", community: 1, linkCount: 3 }),
      makeNode({ id: "iso", label: "Iso", community: 0, linkCount: 0 }),
    ];
    const graph = makeGraph(nodes, [makeEdge("a", "b")]);

    const insights = analyzeGraph(graph);

    expect(insights.connections).toEqual(rankUnexpectedLinks(graph));
    expect(insights.gaps).toEqual(findCoverageGaps(graph));
    expect(insights.connections).toHaveLength(1);
    expect(insights.gaps.map((entry) => entry.type)).toEqual(["isolated"]);
  });

  it("applies the option bag to both halves", () => {
    const graph = makeGraph([
      makeNode({ id: "a", type: "source", community: 0, linkCount: 0 }),
      makeNode({ id: "b", type: "concept", community: 1, linkCount: 0 }),
      makeNode({ id: "iso", community: 0, linkCount: 0 }),
    ], [makeEdge("a", "b")]);

    const capped = analyzeGraph(graph, { connectionLimit: 0, gapLimit: 0 });
    expect(capped.connections).toEqual([]);
    expect(capped.gaps).toEqual([]);

    const strict = analyzeGraph(graph, { minScore: 6 });
    expect(strict.connections).toEqual([]);
  });
});
