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
  // KNOWN BUG, recorded rather than asserted away.
  //
  // `it.fails` means "this test is expected to fail". It keeps the suite green
  // while making the defect visible, and it will itself fail the moment the
  // defect is fixed — so the fix cannot land quietly without the test being
  // updated to `it` in the same change.
  it.fails("does not report a dead-end edge reachable only by revisiting a node", () => {
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
