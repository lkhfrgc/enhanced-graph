import { describe, expect, it } from "vitest";

import type { CommunityInfo } from "../src/types";
import {
  SPARSE_COHESION_THRESHOLD,
  SPARSE_MIN_MEMBERS,
  computeCommunityConnectivity,
  deriveCommunities,
  isSparseCommunity,
} from "../src/core/communities";
import type {
  CommunityDetectionResult,
  CommunityEdgeInput,
  CommunityNodeInput,
} from "../src/core/communities";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(id: string, linkCount = 0): CommunityNodeInput {
  return { id, label: id.toUpperCase(), linkCount };
}

function edge(source: string, target: string, weight = 1): CommunityEdgeInput {
  return { source, target, weight };
}

/** Every unordered pair of `ids`, i.e. a clique over them. */
function clique(ids: readonly string[]): CommunityEdgeInput[] {
  const edges: CommunityEdgeInput[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      edges.push(edge(ids[i], ids[j]));
    }
  }
  return edges;
}

/**
 * `clusterCount` cliques of `size` nodes, wired into a ring by one edge between
 * consecutive clusters so the graph is connected.
 */
function ringOfCliques(clusterCount: number, size: number) {
  const nodes: CommunityNodeInput[] = [];
  const edges: CommunityEdgeInput[] = [];
  const clusters: string[][] = [];

  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const ids = Array.from({ length: size }, (_, index) => `c${cluster}-n${index}`);
    clusters.push(ids);
    ids.forEach((id, index) => nodes.push(makeNode(id, size - index)));
    edges.push(...clique(ids));
  }
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const next = (cluster + 1) % clusterCount;
    edges.push(edge(clusters[cluster][0], clusters[next][0]));
  }

  return { nodes, edges, clusters };
}

/** Sorted members per community id, for structural comparisons. */
function partition(result: CommunityDetectionResult): Map<number, string[]> {
  return new Map(result.communities.map((c) => [c.id, [...c.nodeIds].sort()]));
}

/** The previous community sharing the most members with `community`. */
function bestOverlap(
  community: CommunityInfo,
  previous: readonly CommunityInfo[],
): { id: number; overlap: number } {
  let bestId = -1;
  let bestCount = -1;
  for (const prior of previous) {
    const members = new Set(prior.nodeIds);
    const overlap = community.nodeIds.filter((id) => members.has(id)).length;
    if (overlap > bestCount) {
      bestId = prior.id;
      bestCount = overlap;
    }
  }
  return { id: bestId, overlap: bestCount };
}

/** Invariants every non-empty detection result has to satisfy. */
function expectWellFormedPartition(
  result: CommunityDetectionResult,
  nodes: readonly CommunityNodeInput[],
): void {
  const ids = result.communities.map((community) => community.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(ids.map((_, index) => index));

  const counts = result.communities.map((community) => community.nodeCount);
  expect(counts.length).toBeGreaterThan(0);
  expect(result.communities[0].nodeCount).toBe(Math.max(...counts));

  const seen: string[] = [];
  for (const community of result.communities) {
    expect(community.nodeCount).toBe(community.nodeIds.length);
    expect(community.topNodes.length).toBeLessThanOrEqual(5);
    seen.push(...community.nodeIds);
  }
  expect(seen).toHaveLength(nodes.length);
  expect(new Set(seen).size).toBe(nodes.length);
  expect([...seen].sort()).toEqual(nodes.map((node) => node.id).sort());
  expect(result.assignments.size).toBe(nodes.length);

  for (const community of result.communities) {
    for (const id of community.nodeIds) {
      expect(result.assignments.get(id)).toBe(community.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity metrics
// ---------------------------------------------------------------------------

describe("computeCommunityConnectivity", () => {
  it("reports cohesion 1/6 and mean intra degree 0.5 for a 4-node cluster with 1 edge", () => {
    const { cohesion, meanIntraDegree } = computeCommunityConnectivity(4, 1);

    expect(cohesion).toBe(1 / 6);
    expect(meanIntraDegree).toBe(0.5);
  });

  it("reports cohesion 0.1 and mean intra degree 0.4 for a 5-node cluster with 1 edge", () => {
    const { cohesion, meanIntraDegree } = computeCommunityConnectivity(5, 1);

    expect(cohesion).toBe(0.1);
    expect(meanIntraDegree).toBe(0.4);
  });

  it("reports zero for a single node and for an edgeless cluster", () => {
    expect(computeCommunityConnectivity(1, 0)).toEqual({ cohesion: 0, meanIntraDegree: 0 });
    expect(computeCommunityConnectivity(3, 0).cohesion).toBe(0);
    expect(computeCommunityConnectivity(3, 0).meanIntraDegree).toBe(0);

    // nodeCount 0 also divides by the 1-edge fallback rather than by zero.
    expect(computeCommunityConnectivity(0, 0)).toEqual({ cohesion: 0, meanIntraDegree: 0 });
  });

  it("reports cohesion 1 and mean intra degree 2 for a 3-node triangle", () => {
    const { cohesion, meanIntraDegree } = computeCommunityConnectivity(3, 3);

    expect(cohesion).toBe(1);
    expect(meanIntraDegree).toBe(2);
  });
});

describe("isSparseCommunity", () => {
  it("uses the documented thresholds", () => {
    expect(SPARSE_COHESION_THRESHOLD).toBe(0.15);
    expect(SPARSE_MIN_MEMBERS).toBe(3);
  });

  it("is a strict < comparison against the cohesion threshold", () => {
    expect(isSparseCommunity(0.1499, 3)).toBe(true);
    expect(isSparseCommunity(0.15, 3)).toBe(false);
    expect(isSparseCommunity(0.1500001, 3)).toBe(false);
    expect(isSparseCommunity(0.5, 10)).toBe(false);
  });

  it("requires the minimum member count", () => {
    expect(isSparseCommunity(0.0, 2)).toBe(false);
    expect(isSparseCommunity(0.0, 3)).toBe(true);
    expect(isSparseCommunity(0.1499, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two triangles joined by a single bridge edge
// ---------------------------------------------------------------------------

describe("deriveCommunities / two cliques", () => {
  const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => makeNode(id, 1));
  const edges = [
    edge("a", "b"), edge("b", "c"), edge("a", "c"),
    edge("d", "e"), edge("e", "f"), edge("d", "f"),
    edge("c", "d"),
  ];

  it("splits the graph into exactly two communities with ids 0 and 1", () => {
    const result = deriveCommunities(nodes, edges);

    expect(result.communities).toHaveLength(2);
    expect(result.communities.map((community) => community.id)).toEqual([0, 1]);
    expect(partition(result)).toEqual(
      new Map([
        [0, ["a", "b", "c"]],
        [1, ["d", "e", "f"]],
      ]),
    );
    expectWellFormedPartition(result, nodes);
  });

  it("keeps community 0 the larger (or equal) one and assigns every node", () => {
    const result = deriveCommunities(nodes, edges);

    expect(result.communities[0].nodeCount).toBeGreaterThanOrEqual(result.communities[1].nodeCount);
    expect(result.communities.map((community) => community.nodeCount)).toEqual([3, 3]);
    expect([...result.assignments.keys()].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("separates the two bridge nodes into different communities", () => {
    const result = deriveCommunities(nodes, edges);
    const ofC = result.assignments.get("c");
    const ofD = result.assignments.get("d");

    expect(ofC).toBeDefined();
    expect(ofD).toBeDefined();
    expect(ofC).not.toBe(ofD);
    expect(result.communities.map((community) => community.id).sort()).toEqual([ofC, ofD].sort());
  });

  it("reports 3 intra edges, cohesion 1 and mean intra degree 2 for each triangle", () => {
    const result = deriveCommunities(nodes, edges);

    for (const community of result.communities) {
      expect(community.nodeCount).toBe(3);
      expect(community.intraEdges).toBe(3);
      expect(community.cohesion).toBe(1);
      expect(community.meanIntraDegree).toBe(2);
      expect(community.isSparse).toBe(false);
    }
    // The bridge edge is the only edge that is not internal to a community.
    expect(result.communities.reduce((sum, community) => sum + community.intraEdges, 0)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("deriveCommunities / determinism", () => {
  it("returns identical assignments on five runs over one unchanged graph", () => {
    const { nodes, edges } = ringOfCliques(6, 6);

    const runs = Array.from({ length: 5 }, () => deriveCommunities(nodes, edges));
    const first = runs[0];

    for (const run of runs) {
      expect([...run.assignments.entries()]).toEqual([...first.assignments.entries()]);
      expect(run.communities).toEqual(first.communities);
    }

    expect(first.communities).toHaveLength(6);
    expect(first.communities.map((community) => community.nodeCount)).toEqual([6, 6, 6, 6, 6, 6]);
    expect(first.communities.map((community) => community.intraEdges)).toEqual([15, 15, 15, 15, 15, 15]);
    expectWellFormedPartition(first, nodes);
  });

  it("does not depend on object identity between two identical builds", () => {
    const a = ringOfCliques(6, 6);
    const b = ringOfCliques(6, 6);

    expect([...deriveCommunities(a.nodes, a.edges).assignments.entries()]).toEqual(
      [...deriveCommunities(b.nodes, b.edges).assignments.entries()],
    );
  });
});

// ---------------------------------------------------------------------------
// Id stability across rebuilds
// ---------------------------------------------------------------------------

describe("deriveCommunities / ids across rebuilds", () => {
  it("keeps previous ids for the clusters that survive a one-file rename", () => {
    const { nodes, edges, clusters } = ringOfCliques(6, 6);
    const first = deriveCommunities(nodes, edges);

    const renamedFrom = clusters[0][0];
    const renamedTo = "c0-n0-renamed";
    const renamedNodes = nodes.map((node) =>
      node.id === renamedFrom ? { ...node, id: renamedTo } : node,
    );
    const renamedEdges = edges.map((e) => ({
      ...e,
      source: e.source === renamedFrom ? renamedTo : e.source,
      target: e.target === renamedFrom ? renamedTo : e.target,
    }));

    const second = deriveCommunities(renamedNodes, renamedEdges, {
      previousCommunities: first.communities,
    });

    expect(second.communities).toHaveLength(first.communities.length);
    expect(second.assignments.has(renamedTo)).toBe(true);

    const large = second.communities.filter((community) => community.nodeCount >= 3);
    expect(large).toHaveLength(6);

    for (const community of large) {
      const best = bestOverlap(community, first.communities);
      expect(best.overlap).toBeGreaterThanOrEqual(5);
      expect(community.id).toBe(best.id);
    }

    const ids = second.communities.map((community) => community.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expectWellFormedPartition(second, renamedNodes);
  });

  it("treats an empty previous list like no history at all", () => {
    const { nodes, edges } = ringOfCliques(6, 6);

    const plain = deriveCommunities(nodes, edges);
    const withEmpty = deriveCommunities(nodes, edges, { previousCommunities: [] });

    expect(withEmpty.communities.map((community) => community.id)).toEqual(
      plain.communities.map((community) => community.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Forced assignments
// ---------------------------------------------------------------------------

describe("deriveCommunities / forcedAssignments", () => {
  it("bypasses Louvain and remaps forced ids by descending size", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => makeNode(id));
    // Louvain would pair a/d, b/e and c/f along these edges; the forced map wins.
    const edges = [edge("a", "d"), edge("b", "e"), edge("c", "f"), edge("a", "e")];
    const forced = new Map([
      ["a", 7], ["b", 7], ["c", 7],
      ["d", 2], ["e", 2],
      ["f", 5],
    ]);

    const result = deriveCommunities(nodes, edges, { forcedAssignments: forced });

    expect(partition(result)).toEqual(
      new Map([
        [0, ["a", "b", "c"]],
        [1, ["d", "e"]],
        [2, ["f"]],
      ]),
    );
    expect(result.communities.map((community) => community.id)).toEqual([0, 1, 2]);
    expect(result.communities.map((community) => community.nodeCount)).toEqual([3, 2, 1]);
    expectWellFormedPartition(result, nodes);
  });

  it("does not mutate the caller's assignment map", () => {
    const forced = new Map([
      ["a", 7],
      ["b", 7],
    ]);

    deriveCommunities([makeNode("a"), makeNode("b")], [], { forcedAssignments: forced });

    expect([...forced.entries()]).toEqual([
      ["a", 7],
      ["b", 7],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe("deriveCommunities / degenerate input", () => {
  it("returns an empty result for an empty graph", () => {
    expect(deriveCommunities([], [])).toEqual({ assignments: new Map(), communities: [] });
  });

  it("puts every node in community 0 when there are no edges", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => makeNode(id, 1));

    const result = deriveCommunities(nodes, []);

    expect(result.communities).toHaveLength(1);
    expect(result.communities[0].id).toBe(0);
    expect(result.communities[0].nodeCount).toBe(4);
    expect(result.communities[0].intraEdges).toBe(0);
    expect(result.communities[0].cohesion).toBe(0);
    expect(result.communities[0].isSparse).toBe(true);
    expect([...result.assignments.entries()]).toEqual([
      ["a", 0], ["b", 0], ["c", 0], ["d", 0],
    ]);
    expectWellFormedPartition(result, nodes);
  });

  it("ignores edges that reference unknown nodes", () => {
    const nodes = [makeNode("a"), makeNode("b")];

    const result = deriveCommunities(nodes, [
      edge("a", "b"),
      edge("a", "ghost"),
      edge("ghost", "b"),
    ]);

    expect(result.communities).toHaveLength(1);
    expect(result.communities[0].intraEdges).toBe(1);
    expect(result.communities[0].cohesion).toBe(1);
    expect([...result.assignments.keys()].sort()).toEqual(["a", "b"]);
  });

  it("ignores self-loops when partitioning", () => {
    const nodes = [makeNode("a"), makeNode("b")];

    const result = deriveCommunities(nodes, [edge("a", "a"), edge("a", "b"), edge("b", "b")]);

    expect(partition(result)).toEqual(new Map([[0, ["a", "b"]]]));
    expect(result.communities).toHaveLength(1);
  });

  it("still counts self-loops as intra edges, so cohesion can exceed 1", () => {
    // FINDING: `runLouvain` drops `source === target` edges, but `summarise`
    // counts internal edges straight from the raw edge list, and a self-loop
    // trivially has both endpoints in the same community. A graph whose only
    // edges are self-loops therefore reports perfect cohesion, and cohesion
    // (which is meant to be a density in [0,1]) can be > 1.
    const loopsOnly = deriveCommunities(
      [makeNode("a"), makeNode("b"), makeNode("c")],
      [edge("a", "a"), edge("b", "b"), edge("c", "c")],
    );

    expect(loopsOnly.communities).toHaveLength(1);
    expect(loopsOnly.communities[0].intraEdges).toBe(3);
    expect(loopsOnly.communities[0].cohesion).toBe(1);

    const withLoop = deriveCommunities([makeNode("a"), makeNode("b")], [
      edge("a", "a"),
      edge("a", "b"),
    ]);

    // possibleEdges for 2 nodes is 1, so 2 counted edges give cohesion 2.
    expect(withLoop.communities[0].intraEdges).toBe(2);
    expect(withLoop.communities[0].cohesion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Summary invariants
// ---------------------------------------------------------------------------

describe("deriveCommunities / summary invariants", () => {
  it("orders communities by size and covers every node exactly once", () => {
    const big = ["a1", "a2", "a3", "a4", "a5"];
    const small = ["b1", "b2", "b3"];
    const nodes = [...big, ...small, "z"].map((id, index) => makeNode(id, index));

    const result = deriveCommunities(nodes, [...clique(big), ...clique(small)]);

    expect(result.communities.map((community) => community.nodeCount)).toEqual([5, 3, 1]);
    expect(result.communities[0].nodeCount).toBe(
      Math.max(...result.communities.map((community) => community.nodeCount)),
    );
    expectWellFormedPartition(result, nodes);
  });

  it("keeps at most five topNodes, ordered by descending linkCount", () => {
    const nodes = Array.from({ length: 7 }, (_, index) => makeNode(`n${index}`, 10 - index));
    const forced = new Map(nodes.map((node) => [node.id, 0]));

    const result = deriveCommunities(nodes, [], { forcedAssignments: forced });

    expect(result.communities[0].topNodes).toEqual(["N0", "N1", "N2", "N3", "N4"]);
    expect(result.communities[0].topNodes).toHaveLength(5);
  });

  it("keeps cohesion finite for zero, negative and non-finite edge weights", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => makeNode(id));

    const result = deriveCommunities(nodes, [
      edge("a", "b", 0),
      edge("b", "c", Number.NaN),
      edge("c", "a", Number.POSITIVE_INFINITY),
      edge("d", "e", -3),
      edge("e", "f", 0.5),
      edge("d", "f", 0),
    ]);

    expect(result.communities).toHaveLength(2);
    for (const community of result.communities) {
      expect(Number.isNaN(community.cohesion)).toBe(false);
      expect(Number.isFinite(community.cohesion)).toBe(true);
      expect(Number.isFinite(community.meanIntraDegree)).toBe(true);
      expect(community.nodeCount).toBe(3);
      expect(community.intraEdges).toBe(3);
      expect(community.cohesion).toBe(1);
      expect(community.meanIntraDegree).toBe(2);
    }
    expectWellFormedPartition(result, nodes);
  });
});
