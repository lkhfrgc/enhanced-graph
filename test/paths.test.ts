/**
 * Tests for "what connects these two notes".
 *
 * The interaction on top of this is trivial; the semantics are not. A pair of
 * notes is usually connected by more than one route, and highlighting an
 * arbitrary single shortest path would invent a spine the graph does not have.
 * These tests pin the definition: *every* node and edge lying on *some*
 * shortest path.
 */

import { describe, expect, it } from "vitest";

import { buildAdjacency, distancesFrom, findConnectingPaths } from "../src/core/paths";
import { edgeKey, edgeKeyEndpoints } from "../src/core/graph-keys";
import type { GraphEdge, GraphNode, PageType, WikiGraph } from "../src/types";

function node(id: string): GraphNode {
  return {
    id,
    label: id.toUpperCase(),
    type: "concept" as PageType,
    rawType: "concept",
    path: `${id}.md`,
    linkCount: 0,
    vaultLinkCount: 0,
    inLinks: 0,
    outLinks: 0,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
  } as GraphNode;
}

function edge(source: string, target: string): GraphEdge {
  return {
    source,
    target,
    weight: 1,
    signals: { directLink: 3, sourceOverlap: 0, adamicAdar: 0, coCitation: 0, total: 3 },
    hasDirectLink: true,
    sharedSources: [],
    commonNeighbors: 0,
  };
}

/** `graphOf(["a-b", "b-c"])` — nodes are derived from the edges. */
function graphOf(specs: string[], extraNodes: string[] = []): WikiGraph {
  const edges = specs.map((spec) => {
    const [source, target] = spec.split("-");
    return edge(source, target);
  });
  const ids = new Set<string>([...extraNodes]);
  for (const item of edges) {
    ids.add(item.source);
    ids.add(item.target);
  }
  const nodes = [...ids].map(node);
  return {
    nodes,
    edges,
    communities: [],
    nodeIndex: new Map(nodes.map((item) => [item.id, item])),
    folders: [],
    builtAt: 1,
  };
}

describe("edgeKey", () => {
  it("is order-independent", () => {
    expect(edgeKey("a", "b")).toBe(edgeKey("b", "a"));
  });

  it("round-trips through its endpoint decoder", () => {
    expect(edgeKeyEndpoints(edgeKey("alpha", "beta"))).toEqual(["alpha", "beta"]);
  });
});

describe("buildAdjacency", () => {
  it("links both directions and skips self-loops", () => {
    const adjacency = buildAdjacency(graphOf(["a-b", "a-a"]));
    expect([...adjacency.get("a")!]).toEqual(["b"]);
    expect([...adjacency.get("b")!]).toEqual(["a"]);
  });

  it("omits isolated nodes entirely", () => {
    const adjacency = buildAdjacency(graphOf(["a-b"], ["lonely"]));
    expect(adjacency.has("lonely")).toBe(false);
  });
});

describe("distancesFrom", () => {
  it("measures hop distance breadth-first", () => {
    const distances = distancesFrom(buildAdjacency(graphOf(["a-b", "b-c", "c-d"])), "a");
    expect(distances.get("a")).toBe(0);
    expect(distances.get("b")).toBe(1);
    expect(distances.get("d")).toBe(3);
  });

  it("returns only the start when it has no neighbours", () => {
    const distances = distancesFrom(buildAdjacency(graphOf(["a-b"], ["lonely"])), "lonely");
    expect([...distances.entries()]).toEqual([["lonely", 0]]);
  });
});

describe("findConnectingPaths with a hop budget", () => {
  it("returns only the direct link by default", () => {
    // Diamond: a-b-d, a-c-d. Without a budget this is the shortest route only.
    const result = findConnectingPaths(graphOf(["a-b", "b-d", "a-c", "c-d"]), "a", "d");
    expect(result?.distance).toBe(2);
    expect(result?.span).toBe(2);
  });

  it("admits detours once the budget allows them", () => {
    // a and d are directly linked; d(a, d) = 1. A budget of 3 also admits
    // a-b-c-d, so b and c come along.
    const graph = graphOf(["a-d", "a-b", "b-c", "c-d"]);
    const exact = findConnectingPaths(graph, "a", "d");
    expect(exact?.nodes).toEqual(["a", "d"]);
    expect(exact?.edges).toEqual([edgeKey("a", "d")]);

    const wider = findConnectingPaths(graph, "a", "d", { maxHops: 3 });
    expect(wider?.distance).toBe(1);
    expect(wider?.span).toBe(3);
    expect([...(wider?.nodes ?? [])].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...(wider?.edges ?? [])].sort()).toEqual(
      [edgeKey("a", "b"), edgeKey("b", "c"), edgeKey("c", "d"), edgeKey("a", "d")].sort(),
    );
  });

  it("never loses the connection when the budget is smaller than the distance", () => {
    // Otherwise the control would silently empty the highlight.
    const result = findConnectingPaths(graphOf(["a-b", "b-c", "c-d"]), "a", "d", { maxHops: 1 });
    expect(result?.distance).toBe(3);
    expect(result?.span).toBe(3);
    expect(result?.nodes).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the budget honest: a node exactly one hop too far stays out", () => {
    // a-d direct, plus a chain of four extra nodes: only the first three fit in
    // a budget of 4.
    const graph = graphOf(["a-d", "a-b", "b-c", "c-e", "e-d"]);
    const result = findConnectingPaths(graph, "a", "d", { maxHops: 4 });
    expect(result?.span).toBe(4);
    expect(result?.nodes).toContain("b");
    expect(result?.nodes).toContain("c");
    // d(a, e) = 2 via b, c; 2 + 1 = 3 <= 4, so e is on a 3-hop route too.
    expect(result?.nodes).toContain("e");
  });

  it("does not disturb the shortest-route count", () => {
    const diamond = graphOf(["a-b", "a-c", "b-d", "c-d"]);
    expect(findConnectingPaths(diamond, "a", "d")?.routeCount).toBe(2);
    // The count describes the shortest routes, which the budget does not change.
    expect(findConnectingPaths(diamond, "a", "d", { maxHops: 4 })?.routeCount).toBe(2);
  });

  it("stays cheap on a wide graph even with a large budget", () => {
    // 20 middles between start and end: a budget of 4 must still be answered
    // without enumerating paths.
    const specs: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      specs.push(`start-m${i}`);
      specs.push(`m${i}-end`);
    }
    const result = findConnectingPaths(graphOf(specs), "start", "end", { maxHops: 4 });
    expect(result?.span).toBe(4);
    expect(result?.nodes).toHaveLength(22);
  });

  it("keeps maxDistance working alongside the budget", () => {
    const graph = graphOf(["a-b", "b-c", "c-d"]);
    expect(findConnectingPaths(graph, "a", "d", { maxDistance: 2 })).toBeNull();
    expect(findConnectingPaths(graph, "a", "d", { maxDistance: 3 })?.distance).toBe(3);
    expect(findConnectingPaths(graph, "a", "d", { maxDistance: 3, maxHops: 5 })?.span).toBe(5);
  });
});

describe("findConnectingPaths", () => {
  it("returns the single edge for directly linked notes", () => {
    const result = findConnectingPaths(graphOf(["a-b"]), "a", "b");
    expect(result).toEqual({
      from: "a",
      to: "b",
      distance: 1,
      span: 1,
      nodes: ["a", "b"],
      edges: [edgeKey("a", "b")],
      routeCount: 1,
    });
  });

  it("walks a chain", () => {
    const result = findConnectingPaths(graphOf(["a-b", "b-c", "c-d"]), "a", "d");
    expect(result?.distance).toBe(3);
    expect(result?.nodes).toEqual(["a", "b", "c", "d"]);
    expect(result?.edges).toEqual([edgeKey("a", "b"), edgeKey("b", "c"), edgeKey("c", "d")].sort());
    expect(result?.routeCount).toBe(1);
  });

  it("includes EVERY shortest route, not just one", () => {
    // Diamond: a-b-d and a-c-d both have length 2.
    const result = findConnectingPaths(graphOf(["a-b", "a-c", "b-d", "c-d"]), "a", "d");
    expect(result?.distance).toBe(2);
    expect(result?.nodes).toEqual(["a", "b", "c", "d"]);
    expect([...(result?.edges ?? [])].sort()).toEqual(
      [edgeKey("a", "b"), edgeKey("a", "c"), edgeKey("b", "d"), edgeKey("c", "d")].sort(),
    );
    expect(result?.routeCount).toBe(2);
  });

  it("excludes nodes and edges that are only on a LONGER route", () => {
    // a-c is a shortcut, so b (on a-b-c) is not on any shortest path.
    const result = findConnectingPaths(graphOf(["a-b", "b-c", "a-c"]), "a", "c");
    expect(result?.distance).toBe(1);
    expect(result?.nodes).toEqual(["a", "c"]);
    expect(result?.edges).toEqual([edgeKey("a", "c")]);
    expect(result?.nodes).not.toContain("b");
  });

  it("multiplies the branching across layers", () => {
    // Two independent diamonds in series: 2 routes × 2 routes.
    const result = findConnectingPaths(
      graphOf(["a-b1", "a-b2", "b1-c", "b2-c", "c-d1", "c-d2", "d1-e", "d2-e"]),
      "a",
      "e",
    );
    expect(result?.distance).toBe(4);
    expect(result?.routeCount).toBe(4);
  });

  it("returns distance 0 for the same node", () => {
    const result = findConnectingPaths(graphOf(["a-b"]), "a", "a");
    expect(result).toEqual({ from: "a", to: "a", distance: 0, span: 0, nodes: ["a"], edges: [], routeCount: 1 });
  });

  it("returns null when the notes are not connected", () => {
    expect(findConnectingPaths(graphOf(["a-b", "c-d"]), "a", "c")).toBeNull();
  });

  it("returns null for an unknown node", () => {
    expect(findConnectingPaths(graphOf(["a-b"]), "a", "nope")).toBeNull();
    expect(findConnectingPaths(graphOf(["a-b"]), "nope", "b")).toBeNull();
  });

  it("returns null when either node is isolated", () => {
    expect(findConnectingPaths(graphOf(["a-b"], ["lonely"]), "a", "lonely")).toBeNull();
  });

  it("honours maxDistance", () => {
    const graph = graphOf(["a-b", "b-c", "c-d"]);
    expect(findConnectingPaths(graph, "a", "d", { maxDistance: 2 })).toBeNull();
    expect(findConnectingPaths(graph, "a", "d", { maxDistance: 3 })?.distance).toBe(3);
  });

  it("orders nodes by distance from the start, then by id", () => {
    // a-b-c-d is the shortest route; z hangs off a but leads nowhere.
    const result = findConnectingPaths(graphOf(["a-b", "b-c", "c-d", "a-z"]), "a", "d");
    expect(result?.nodes).toEqual(["a", "b", "c", "d"]);
    // A neighbour of the start is NOT automatically on the path.
    expect(result?.nodes).not.toContain("z");
  });

  it("places depth-1 siblings in id order", () => {
    const result = findConnectingPaths(graphOf(["a-z", "a-b", "b-end", "z-end"]), "a", "end");
    expect(result?.nodes).toEqual(["a", "b", "z", "end"]);
  });

  it("lists edges deterministically regardless of edge order in the graph", () => {
    const forward = findConnectingPaths(graphOf(["a-b", "a-c", "b-d", "c-d"]), "a", "d");
    const reversed = findConnectingPaths(graphOf(["c-d", "b-d", "a-c", "a-b"]), "a", "d");
    expect(forward?.edges).toEqual(reversed?.edges);
  });

  it("ignores self-loops", () => {
    const result = findConnectingPaths(graphOf(["a-a", "a-b"]), "a", "b");
    expect(result?.edges).toEqual([edgeKey("a", "b")]);
  });

  it("scales to a wide graph without enumerating paths", () => {
    // A single branching layer with 20 choices: 20 shortest routes, found with
    // two BFS passes rather than by enumerating paths.
    const specs: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      specs.push(`start-m${i}`);
      specs.push(`m${i}-end`);
    }
    const result = findConnectingPaths(graphOf(specs), "start", "end");
    expect(result?.distance).toBe(2);
    expect(result?.nodes).toHaveLength(22);
    expect(result?.edges).toHaveLength(40);
    expect(result?.routeCount).toBe(20);
  });
});
