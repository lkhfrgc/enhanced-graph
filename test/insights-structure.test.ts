/**
 * Structural analytics: cut vertices, bridges, k-core, brokerage.
 *
 * These are the findings whose ground truth is definitional — a cut vertex either
 * exists or does not — so unlike the ranking work they can be tested against a
 * hand-built graph instead of a rating. The fixtures are therefore small enough that
 * the right answer is obvious by inspection, which is what makes the assertions
 * meaningful rather than a restatement of the implementation.
 *
 * Every group also carries a negative control: a graph where the feature is absent
 * must produce nothing. A detector that fires on everything looks identical to one
 * that fires correctly until you show it not firing.
 */

import { describe, expect, it } from "vitest";

import { createContext, type AnalysisContext } from "../src/core/insights/input";
import {
  clusterGateways,
  constraint,
  coreNumbers,
  cutAnalysis,
  structureFindings,
} from "../src/core/insights/structure";
import type { GraphNode, WikiGraph } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(id: string, community = 0): GraphNode {
  return {
    id,
    label: id,
    type: "concept",
    rawType: "",
    path: `${id}.md`,
    linkCount: 0,
    vaultLinkCount: 0,
    inLinks: 0,
    outLinks: 0,
    community,
    sources: [],
    tags: [],
    isStructural: false,
  };
}

/** A graph from ids and undirected edges, with degrees filled in from them. */
function graphOf(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>, communities?: ReadonlyMap<string, number>): WikiGraph {
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const nodes = ids.map((id) => {
    const base = node(id, communities?.get(id) ?? 0);
    return { ...base, linkCount: degree.get(id) ?? 0, vaultLinkCount: degree.get(id) ?? 0 };
  });
  return {
    nodes,
    edges: edges.map(([source, target]) => ({ source, target }) as WikiGraph["edges"][number]),
    communities: [],
    nodeIndex: new Map(nodes.map((entry) => [entry.id, entry])),
    folders: [],
    builtAt: 0,
  };
}

function ctxOf(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>, communities?: ReadonlyMap<string, number>): AnalysisContext {
  return createContext({ graph: graphOf(ids, edges, communities) });
}

// ---------------------------------------------------------------------------
// Cut vertices and bridges
// ---------------------------------------------------------------------------

describe("cut analysis", () => {
  it("finds the bridge note between two clusters", () => {
    // Two triangles joined only through `middle`.
    const ctx = ctxOf(
      ["a", "b", "c", "middle", "x", "y", "z"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["a", "middle"],
        ["middle", "x"],
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ],
    );

    const { cutVertices, bridges } = cutAnalysis(ctx);

    expect(cutVertices.has("middle")).toBe(true);
    // Both of its edges are bridges: nothing reaches around it.
    expect(bridges.has("a:::middle")).toBe(true);
    expect(bridges.has("middle:::x")).toBe(true);
    // `a` is also a cut vertex, and that is not a bug: the triangle reaches the rest
    // of the graph only through it, so removing it strands `b` and `c`. The first
    // version of this test asserted the opposite, on the intuition that a triangle
    // vertex is too well connected to be a single point of failure — connectivity
    // inside a triangle says nothing about the routes leaving it.
    expect(cutVertices.has("a")).toBe(true);
    // The other two triangle vertices are not: `b` and `c` each keep a route through
    // `a`, and the triangle stays whole without them.
    expect(cutVertices.has("b")).toBe(false);
    expect(cutVertices.has("c")).toBe(false);
  });

  it("finds nothing in a ring, which has no single point of failure", () => {
    // Negative control: every node has two disjoint routes onward.
    const ctx = ctxOf(["a", "b", "c", "d"], [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
    ]);

    const { cutVertices, bridges } = cutAnalysis(ctx);
    expect([...cutVertices]).toEqual([]);
    expect([...bridges]).toEqual([]);
  });

  it("reports how many notes a cut vertex holds back", () => {
    // A hub with three leaves: removing it strands all three.
    const ctx = ctxOf(["hub", "l1", "l2", "l3"], [
      ["hub", "l1"],
      ["hub", "l2"],
      ["hub", "l3"],
    ]);

    const { separatedBy } = cutAnalysis(ctx);
    expect(separatedBy.get("hub")).toBeGreaterThanOrEqual(2);
  });

  it("does not treat the root of a single chain as a cut vertex more than once", () => {
    const ctx = ctxOf(["a", "b", "c"], [
      ["a", "b"],
      ["b", "c"],
    ]);

    const { cutVertices } = cutAnalysis(ctx);
    expect(cutVertices.has("b")).toBe(true);
    expect(cutVertices.has("a")).toBe(false);
    expect(cutVertices.has("c")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// k-core
// ---------------------------------------------------------------------------

describe("core numbers", () => {
  it("gives every vertex of a triangle a core number of 2", () => {
    const ctx = ctxOf(["a", "b", "c"], [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);

    const core = coreNumbers(ctx);
    expect(core.get("a")).toBe(2);
    expect(core.get("b")).toBe(2);
    expect(core.get("c")).toBe(2);
  });

  it("gives a leaf hanging off a triangle a core number of 1", () => {
    const ctx = ctxOf(["a", "b", "c", "leaf"], [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["a", "leaf"],
    ]);

    const core = coreNumbers(ctx);
    expect(core.get("leaf")).toBe(1);
    expect(core.get("a")).toBe(2);
  });

  it("gives an isolated note a core number of 0", () => {
    const ctx = ctxOf(["a", "alone"], [["a", "a"]]);
    expect(coreNumbers(ctx).get("alone")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Brokerage
// ---------------------------------------------------------------------------

describe("constraint", () => {
  it("is high for a node whose neighbours all know each other", () => {
    // A clique: every tie is redundant, so there is no structural hole.
    const ctx = ctxOf(["a", "b", "c", "d"], [
      ["a", "b"],
      ["a", "c"],
      ["a", "d"],
      ["b", "c"],
      ["b", "d"],
      ["c", "d"],
    ]);

    expect(constraint(ctx).get("a") ?? 0).toBeGreaterThan(0.3);
  });

  it("is lower for a node bridging groups that do not talk", () => {
    // Two pairs, joined only through `a`: its neighbours are not connected.
    const ctx = ctxOf(["a", "b", "c", "d", "e"], [
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
      ["a", "d"],
      ["a", "e"],
      ["d", "e"],
    ]);

    const clique = ctxOf(["x", "y", "z"], [
      ["x", "y"],
      ["x", "z"],
      ["y", "z"],
    ]);

    // `a` has a non-redundant tie to two separate pairs, so its constraint is lower
    // than a node embedded in one tight triangle of the same size.
    expect(constraint(ctx).get("a") ?? 0).toBeLessThan(constraint(clique).get("x") ?? 1);
  });

  it("is zero for a node with no neighbours", () => {
    const ctx = ctxOf(["alone"], []);
    expect(constraint(ctx).get("alone")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cluster gateways
// ---------------------------------------------------------------------------

describe("cluster gateways", () => {
  it("finds a cluster reachable through one page", () => {
    const communities = new Map([
      ["a", 0],
      ["b", 0],
      ["door", 1],
      ["c", 1],
    ]);
    const ctx = ctxOf(
      ["a", "b", "door", "c"],
      [
        ["a", "b"],
        ["a", "door"],
        ["door", "c"],
      ],
      communities,
    );

    const gateways = clusterGateways(ctx);
    // Community 1 has exactly one page with an edge leaving it: `door`.
    expect(gateways.map((gateway) => gateway.community)).toContain(1);
    const one = gateways.find((gateway) => gateway.community === 1);
    expect(one?.exitNodes).toEqual(["door"]);
  });

  it("finds none when a cluster has several doors", () => {
    // Negative control: two independent exits means no single page is the gateway.
    const communities = new Map([
      ["a", 0],
      ["b", 0],
      ["d1", 1],
      ["d2", 1],
    ]);
    const ctx = ctxOf(
      ["a", "b", "d1", "d2"],
      [
        ["a", "b"],
        ["a", "d1"],
        ["b", "d2"],
      ],
      communities,
    );

    expect(clusterGateways(ctx).map((gateway) => gateway.community)).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

describe("structure findings", () => {
  it("produces one card per cut vertex, keyed on the page", () => {
    const ctx = ctxOf(
      ["a", "b", "c", "middle", "x", "y", "z"],
      [
        ["a", "b"],
        ["b", "c"],
        ["c", "a"],
        ["a", "middle"],
        ["middle", "x"],
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ],
    );

    const findings = structureFindings(ctx);
    const cuts = findings.filter((finding) => finding.kind === "single-point-of-failure");

    expect(cuts.map((finding) => finding.key)).toContain("node:single-point-of-failure:middle");
    // Severity 3 and a score that is not left at zero: a card that displays 0.00 for
    // every structural finding makes its own ordering meaningless.
    expect(cuts[0]?.severity).toBe(3);
    expect(cuts[0]?.score).toBeGreaterThan(0);
  });

  it("produces nothing for a fully connected ring", () => {
    // Negative control for the whole phase: no cut vertex, no bridge, no gateway.
    const ctx = ctxOf(["a", "b", "c", "d"], [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "a"],
    ]);

    const findings = structureFindings(ctx);
    expect(findings.filter((finding) => finding.kind === "single-point-of-failure")).toEqual([]);
    expect(findings.filter((finding) => finding.kind === "cluster-gateway")).toEqual([]);
  });

  it("never reports a structural page as a single point of failure", () => {
    // An index page is *expected* to be load-bearing; reporting it as a risk is noise
    // the user cannot act on, because the page is not content.
    const base = graphOf(
      ["a", "b", "index", "x", "y"],
      [
        ["a", "b"],
        ["a", "index"],
        ["index", "x"],
        ["x", "y"],
      ],
    );
    const withStructural: WikiGraph = {
      ...base,
      nodes: base.nodes.map((entry) =>
        entry.id === "index" ? { ...entry, isStructural: true } : entry,
      ),
      nodeIndex: new Map(
        base.nodes.map((entry) =>
          entry.id === "index" ? [entry.id, { ...entry, isStructural: true }] : [entry.id, entry],
        ),
      ),
    };

    const findings = structureFindings(createContext({ graph: withStructural }));
    expect(findings.some((finding) => finding.anchors.nodeIds.includes("index"))).toBe(false);
  });
});
