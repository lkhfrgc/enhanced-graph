// @vitest-environment node
import { describe, expect, it } from "vitest";

import { findConnectingPaths } from "../src/core/paths";
import { EMPTY_GRAPH, type GraphNode, type WikiGraph } from "../src/types";

/**
 * Does `findConnectingPaths` really return only edges that lie on a PATH within
 * the budget — or does it also return edges that merely lie on a WALK?
 *
 * The test is the requirement stated plainly: every edge reported must be
 * usable by some simple route from `from` to `to` no longer than `span` hops.
 * That is checked here by brute force — enumerate every simple path up to the
 * budget and compare the union of their edges against what was returned. Brute
 * force is the point: it is an independent implementation of the requirement,
 * so agreeing with it means something.
 */
const node = (id: string): GraphNode =>
  ({ id, label: id, path: `${id}.md`, type: "concept" }) as unknown as GraphNode;

const graphOf = (ids: string[], links: Array<[string, string]>): WikiGraph =>
  ({
    ...EMPTY_GRAPH,
    nodes: ids.map(node),
    edges: links.map(([source, target]) => ({ source, target, weight: 1 })),
    nodeIndex: new Map(ids.map((id) => [id, node(id)])),
  }) as unknown as WikiGraph;

/** Every simple path from `from` to `to` of at most `maxHops` hops. */
function simplePathsWithin(
  links: Array<[string, string]>,
  from: string,
  to: string,
  maxHops: number,
): Array<Array<[string, string]>> {
  const adjacency = new Map<string, string[]>();
  for (const [a, b] of links) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  const found: Array<Array<[string, string]>> = [];
  const walk = (at: string, visited: Set<string>, used: Array<[string, string]>): void => {
    if (at === to) {
      found.push([...used]);
      return;
    }
    if (used.length >= maxHops) return;
    for (const next of adjacency.get(at) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      used.push([at, next]);
      walk(next, visited, used);
      used.pop();
      visited.delete(next);
    }
  };
  walk(from, new Set([from]), []);
  return found;
}

const keyOf = (a: string, b: string): string => (a < b ? `${a}:::${b}` : `${b}:::${a}`);

describe("findConnectingPaths returns edges on real paths", () => {
  // Was `it.fails` while the walk-versus-path defect was open: the enumeration
  // below is what the fix was measured against, and `it.fails` would itself fail
  // now that it passes — which is how the two were kept in step.
  it("does not report a dead-end edge reachable only by revisiting a node", () => {
    // s - x - t, plus a dead-end branch x - y.
    //
    // The shortest distance s..t is 2. With a 4-hop budget, edge x-y satisfies
    // `d(s,x) + 1 + d(y,t) = 1 + 1 + 2 = 4`, so a condition-based test includes
    // it — but every route that uses x-y must return through x, so no SIMPLE
    // path of 4 hops or fewer contains it.
    const links: Array<[string, string]> = [
      ["s", "x"],
      ["x", "t"],
      ["x", "y"],
    ];
    const graph = graphOf(["s", "x", "t", "y"], links);
    const span = 4;

    const result = findConnectingPaths(graph, "s", "t", { maxHops: span });
    expect(result).not.toBeNull();

    // Independent answer: union the edges of every simple path within the budget.
    const truth = new Set<string>();
    for (const path of simplePathsWithin(links, "s", "t", span)) {
      for (const [a, b] of path) truth.add(keyOf(a, b));
    }

    const reported = new Set(result!.edges);
    const extra = [...reported].filter((edge) => !truth.has(edge));
    const missing = [...truth].filter((edge) => !reported.has(edge));

    expect({ extra, missing }).toEqual({ extra: [], missing: [] });
  });

  // The strongest check available: for several topologies and every budget, the
  // function's edges must equal the union computed by brute force. One hand-built
  // case proved the defect existed; this is what says the fix is general.
  const cases: Array<{ name: string; links: Array<[string, string]>; s: string; t: string }> = [
    {
      name: "dead end off a chain",
      links: [["s", "x"], ["x", "t"], ["x", "y"]],
      s: "s",
      t: "t",
    },
    {
      name: "diamond",
      links: [["s", "x"], ["x", "t"], ["s", "y"], ["y", "t"], ["x", "y"]],
      s: "s",
      t: "t",
    },
    {
      name: "two-hop chain with a shortcut",
      links: [["s", "a"], ["a", "b"], ["b", "t"], ["s", "t"]],
      s: "s",
      t: "t",
    },
    {
      name: "cycle plus tail",
      links: [["s", "a"], ["a", "b"], ["b", "s"], ["b", "t"], ["t", "c"]],
      s: "s",
      t: "t",
    },
  ];

  for (const testCase of cases) {
    for (let budget = 1; budget <= 5; budget += 1) {
      it(`matches brute force: ${testCase.name}, budget ${budget}`, () => {
        const ids = [...new Set(testCase.links.flat())];
        const graph = graphOf(ids, testCase.links);
        const result = findConnectingPaths(graph, testCase.s, testCase.t, { maxHops: budget });
        if (!result) return; // not connected: nothing to compare

        // Compare against the budget the function actually applied, not the one
        // asked for: a budget below the shortest distance is raised to it rather
        // than returning nothing, and `span` reports the result. Using the raw
        // budget made this test wrong at budget 1 for every pair further apart.
        const truth = new Set<string>();
        for (const path of simplePathsWithin(testCase.links, testCase.s, testCase.t, result.span)) {
          for (const [a, b] of path) truth.add(keyOf(a, b));
        }

        expect([...result.edges].sort()).toEqual([...truth].sort());
      });
    }
  }

  it("does not report a branch edge when the budget is the shortest distance", () => {
    // Same shape, but the budget is the shortest distance, where the condition
    // is the textbook one and should be exact.
    const links: Array<[string, string]> = [
      ["s", "x"],
      ["x", "t"],
      ["x", "y"],
    ];
    const graph = graphOf(["s", "x", "t", "y"], links);
    const result = findConnectingPaths(graph, "s", "t", {});
    expect(result!.edges.slice().sort()).toEqual([keyOf("s", "x"), keyOf("x", "t")].sort());
  });
});
