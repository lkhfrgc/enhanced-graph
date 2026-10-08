/**
 * Tests for adopting the built-in graph's worker-computed layout.
 *
 * The built-in simulation writes `nodeLookup[id].{x,y}` on the main thread every
 * frame; `captureOfficialLayout` samples that, and `applyExternalLayout` seeds
 * our sigma graph from it. The fixture mirrors the shape read out of Obsidian
 * 1.9.10, including the two view types and their differing id spellings.
 */

import { describe, expect, it } from "vitest";
import Graph from "graphology";

import {
  MIN_LAYOUT_COVERAGE,
  captureOfficialLayout,
  hasOfficialGraphView,
} from "../src/integrate/official-layout";
import { normalizeOfficialNodeId } from "../src/integrate/official-internals";
import { applyExternalLayout } from "../src/view/layout";
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FakeOfficialNode {
  id: string;
  x: number | null;
  y: number | null;
}

function makeRenderer(nodes: FakeOfficialNode[]): {
  nodeLookup: Record<string, FakeOfficialNode>;
} {
  const nodeLookup: Record<string, FakeOfficialNode> = {};
  for (const node of nodes) nodeLookup[node.id] = node;
  return { nodeLookup };
}

function makeApp(leaves: Record<string, unknown[]>): {
  workspace: { getLeavesOfType(type: string): unknown[] };
} {
  return { workspace: { getLeavesOfType: (type: string) => leaves[type] ?? [] } };
}

function leafWith(nodes: FakeOfficialNode[]): { view: { renderer: unknown } } {
  return { view: { renderer: makeRenderer(nodes) } };
}

function graphOf(entries: Array<[string, string[]]>): Graph {
  const graph = new Graph({ multi: false, type: "undirected" });
  for (const [id] of entries) graph.addNode(id, { x: 0, y: 0 });
  for (const [id, neighbours] of entries) {
    for (const neighbour of neighbours) {
      if (!graph.hasNode(neighbour)) continue;
      if (graph.hasEdge(id, neighbour)) continue;
      graph.addEdge(id, neighbour);
    }
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Id normalisation
// ---------------------------------------------------------------------------

describe("normalizeOfficialNodeId", () => {
  it("strips the extension, lower-cases and normalises separators", () => {
    expect(normalizeOfficialNodeId("concepts/检索增强生成.md")).toBe("concepts/检索增强生成");
    expect(normalizeOfficialNodeId("Concepts\\SPLADE 稀疏向量.MD")).toBe("concepts/splade 稀疏向量");
    expect(normalizeOfficialNodeId("./folder/Note.md")).toBe("folder/note");
    expect(normalizeOfficialNodeId("note")).toBe("note");
  });

  it("lower-cases unconditionally (vault paths are case-sensitive on disk)", () => {
    // Our ids are lower-cased vault paths, so the official path must fold too.
    expect(normalizeOfficialNodeId("Folder/Note.md")).toBe("folder/note");
  });
});

// ---------------------------------------------------------------------------
// Snapshot capture
// ---------------------------------------------------------------------------

describe("captureOfficialLayout", () => {
  const required = ["a", "b", "c", "d"];

  it("returns null when no built-in graph is open", () => {
    expect(captureOfficialLayout(makeApp({}) as never, required)).toBeNull();
  });

  it("returns null for an empty request", () => {
    const app = makeApp({ graph: [leafWith([{ id: "a.md", x: 1, y: 2 }])] });
    expect(captureOfficialLayout(app as never, [])).toBeNull();
  });

  it("maps official paths onto our ids and keeps their coordinates", () => {
    const app = makeApp({
      graph: [
        leafWith([
          { id: "a.md", x: 10, y: -4 },
          { id: "b.md", x: 20, y: 8 },
          { id: "c.md", x: -3, y: 0 },
        ]),
      ],
    });

    const snapshot = captureOfficialLayout(app as never, required, { minCoverage: 0 });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.viewType).toBe("graph");
    expect(snapshot?.positions.get("a")).toEqual({ x: 10, y: -4 });
    expect(snapshot?.positions.get("c")).toEqual({ x: -3, y: 0 });
    expect(snapshot?.coverage).toBeCloseTo(3 / 4);
  });

  it("ignores nodes the simulation has not placed yet", () => {
    const app = makeApp({
      graph: [
        leafWith([
          { id: "a.md", x: 1, y: 1 },
          { id: "b.md", x: null, y: 2 },
          { id: "c.md", x: Number.NaN, y: 0 },
          { id: "d.md", x: 0, y: Number.POSITIVE_INFINITY },
        ]),
      ],
    });

    const snapshot = captureOfficialLayout(app as never, required, { minCoverage: 0 });

    expect([...snapshot!.positions.keys()]).toEqual(["a"]);
    expect(snapshot?.officialNodeCount).toBe(4);
  });

  it("rejects a snapshot below the coverage threshold", () => {
    const app = makeApp({ graph: [leafWith([{ id: "a.md", x: 1, y: 1 }])] });
    // 1 of 4 nodes = 0.25, well under the 0.6 default.
    expect(captureOfficialLayout(app as never, required)).toBeNull();
    expect(MIN_LAYOUT_COVERAGE).toBeGreaterThan(0.25);
  });

  it("accepts a snapshot exactly at the threshold", () => {
    const app = makeApp({
      graph: [
        leafWith([
          { id: "a.md", x: 1, y: 1 },
          { id: "b.md", x: 2, y: 2 },
          { id: "c.md", x: 3, y: 3 },
        ]),
      ],
    });
    // 3 / 5 = 0.6
    const snapshot = captureOfficialLayout(app as never, ["a", "b", "c", "d", "e"]);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.coverage).toBeCloseTo(0.6);
  });

  it("ignores nodes that are not part of our graph", () => {
    const app = makeApp({
      graph: [
        leafWith([
          { id: "a.md", x: 1, y: 1 },
          { id: "#tag", x: 9, y: 9 },
          { id: "unresolved", x: 9, y: 9 },
        ]),
      ],
    });

    const snapshot = captureOfficialLayout(app as never, ["a"], { minCoverage: 0 });

    expect([...snapshot!.positions.keys()]).toEqual(["a"]);
  });

  it("prefers whichever open view covers our graph best", () => {
    const app = makeApp({
      graph: [leafWith([{ id: "a.md", x: 1, y: 1 }])],
      // The local graph happens to hold more of the vault in this fixture.
      localgraph: [
        leafWith([
          { id: "a.md", x: 5, y: 5 },
          { id: "b.md", x: 6, y: 6 },
          { id: "c.md", x: 7, y: 7 },
        ]),
      ],
    });

    const snapshot = captureOfficialLayout(app as never, required, { minCoverage: 0 });

    expect(snapshot?.viewType).toBe("localgraph");
    expect(snapshot?.positions.get("a")).toEqual({ x: 5, y: 5 });
  });

  it("survives a renderer without a nodeLookup object", () => {
    const app = makeApp({ graph: [{ view: { renderer: { nodes: [] } } }] });
    expect(captureOfficialLayout(app as never, required)).toBeNull();
  });

  it("detects an open built-in graph regardless of coverage", () => {
    expect(hasOfficialGraphView(makeApp({}) as never)).toBe(false);
    expect(hasOfficialGraphView(makeApp({ graph: [leafWith([])] }) as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Seeding our own graph
// ---------------------------------------------------------------------------

describe("applyExternalLayout", () => {
  it("places mapped nodes exactly where the snapshot says", () => {
    const graph = graphOf([
      ["a", ["b"]],
      ["b", ["a"]],
      ["c", ["b"]],
    ]);
    const positions = new Map([
      ["a", { x: 10, y: 0 }],
      ["b", { x: 0, y: 20 }],
      ["c", { x: -10, y: 0 }],
    ]);

    const result = applyExternalLayout(graph, positions);

    expect(result).toEqual({ placed: 3, extrapolated: 0 });
    expect(graph.getNodeAttribute("a", "x")).toBe(10);
    expect(graph.getNodeAttribute("b", "y")).toBe(20);
  });

  it("parks an unmapped node at the centroid of its placed neighbours", () => {
    const graph = graphOf([
      ["a", ["b", "missing"]],
      ["b", ["a", "missing"]],
      ["missing", ["a", "b"]],
    ]);
    const positions = new Map([
      ["a", { x: 10, y: 0 }],
      ["b", { x: 0, y: 10 }],
    ]);

    const result = applyExternalLayout(graph, positions);
    const x = graph.getNodeAttribute("missing", "x") as number;
    const y = graph.getNodeAttribute("missing", "y") as number;

    expect(result.placed).toBe(2);
    expect(result.extrapolated).toBe(1);
    // Centroid of (10,0) and (0,10) is (5,5); the jitter is small but non-zero.
    expect(Math.abs(x - 5)).toBeLessThan(2);
    expect(Math.abs(y - 5)).toBeLessThan(2);
  });

  it("resolves a chain of unmapped nodes iteratively", () => {
    const graph = graphOf([
      ["root", ["n1"]],
      ["n1", ["root", "n2"]],
      ["n2", ["n1", "n3"]],
      ["n3", ["n2"]],
    ]);
    const positions = new Map([["root", { x: 100, y: 100 }]]);

    const result = applyExternalLayout(graph, positions);

    expect(result.placed).toBe(1);
    expect(result.extrapolated).toBe(3);
    for (const id of ["n1", "n2", "n3"]) {
      expect(Number.isFinite(graph.getNodeAttribute(id, "x"))).toBe(true);
      expect(Number.isFinite(graph.getNodeAttribute(id, "y"))).toBe(true);
    }
  });

  it("gives a fully isolated unmapped node a finite position", () => {
    const graph = graphOf([
      ["a", []],
      ["lonely", []],
    ]);

    const result = applyExternalLayout(graph, new Map([["a", { x: 0, y: 0 }]]));

    expect(result.extrapolated).toBe(1);
    const x = graph.getNodeAttribute("lonely", "x") as number;
    const y = graph.getNodeAttribute("lonely", "y") as number;
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(Math.hypot(x, y)).toBeGreaterThan(0);
  });

  it("is deterministic: the same snapshot always yields the same picture", () => {
    const build = () => {
      const graph = graphOf([
        ["a", ["b", "x"]],
        ["b", ["a", "x"]],
        ["x", ["a", "b", "orphan"]],
        ["orphan", ["x"]],
        ["detached", []],
      ]);
      applyExternalLayout(
        graph,
        new Map([
          ["a", { x: 3, y: 1 }],
          ["b", { x: -2, y: 4 }],
        ]),
      );
      return graph.nodes().map((id) => [id, graph.getNodeAttribute(id, "x"), graph.getNodeAttribute(id, "y")]);
    };

    expect(build()).toEqual(build());
  });

  it("treats every node as extrapolated when the snapshot is empty", () => {
    const graph = graphOf([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);

    const result = applyExternalLayout(graph, new Map());

    expect(result.placed).toBe(0);
    expect(result.extrapolated).toBe(2);
    for (const id of ["a", "b"]) {
      expect(Number.isFinite(graph.getNodeAttribute(id, "x"))).toBe(true);
    }
  });

  it("does not blow up on a single-node graph", () => {
    const graph = graphOf([["only", []]]);
    const result = applyExternalLayout(graph, new Map([["only", { x: 1, y: 1 }]]));
    expect(result).toEqual({ placed: 1, extrapolated: 0 });
  });

  it("keeps the official layout's relative geometry", () => {
    // An affine-preserving seed must keep the ordering along any axis.
    const graph = graphOf([
      ["a", []],
      ["b", []],
      ["c", []],
    ]);
    applyExternalLayout(
      graph,
      new Map([
        ["a", { x: -50, y: 0 }],
        ["b", { x: 0, y: 0 }],
        ["c", { x: 50, y: 0 }],
      ]),
    );

    const xs = ["a", "b", "c"].map((id) => graph.getNodeAttribute(id, "x") as number);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
  });
});
