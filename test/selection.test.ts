/**
 * Specification for the focus state machine.
 *
 * The behaviour, driven from the node context menu:
 *   - 「聚焦邻居」              → highlight that node's links
 *   - 「查看与「A」的连通路径」 → highlight the links connecting the two
 *   - 「取消聚焦」              → clear (as do clicking empty space and Escape)
 *
 * Written before the implementation. The state machine is a pure function of
 * `(graph, state, nodeId)`, so none of this needs a browser.
 */

import { describe, expect, it } from "vitest";

import { NO_FOCUS, applyFocus, neighbourhoodHighlight } from "../src/view/selection";
import { edgeKey } from "../src/core/graph-keys";
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

function graphOf(specs: string[], extraNodes: string[] = []): WikiGraph {
  const edges: GraphEdge[] = specs.map((spec) => {
    const [source, target] = spec.split("-");
    return {
      source,
      target,
      weight: 1,
      signals: { directLink: 3, sourceOverlap: 0, adamicAdar: 0, coCitation: 0,
  typeAffinity: 0, total: 3 },
      hasDirectLink: true,
      sharedSources: [],
      commonNeighbors: 0,
    };
  });
  const ids = new Set<string>(extraNodes);
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

/** a-b-c-d chain plus a separate x-y pair and one isolated note. */
const GRAPH = graphOf(["a-b", "b-c", "c-d", "x-y"], ["lonely"]);

describe("neighbourhoodHighlight", () => {
  it("includes the node itself and every direct neighbour", () => {
    const highlight = neighbourhoodHighlight(GRAPH, "b");
    expect([...highlight.nodes].sort()).toEqual(["a", "b", "c"]);
  });

  it("includes exactly the edges incident to the node", () => {
    const highlight = neighbourhoodHighlight(GRAPH, "b");
    expect([...highlight.edges].sort()).toEqual([edgeKey("a", "b"), edgeKey("b", "c")].sort());
  });

  it("follows edges backwards as well as forwards", () => {
    // "b" is the target of a-b; its neighbourhood must still include "a".
    expect(neighbourhoodHighlight(GRAPH, "c").nodes.has("b")).toBe(true);
    expect(neighbourhoodHighlight(GRAPH, "c").nodes.has("d")).toBe(true);
  });

  it("keeps a leaf's single link", () => {
    const highlight = neighbourhoodHighlight(GRAPH, "a");
    expect([...highlight.nodes].sort()).toEqual(["a", "b"]);
    expect([...highlight.edges]).toEqual([edgeKey("a", "b")]);
  });

  it("returns just the node when it has no links", () => {
    const highlight = neighbourhoodHighlight(GRAPH, "lonely");
    expect([...highlight.nodes]).toEqual(["lonely"]);
    expect([...highlight.edges]).toEqual([]);
  });
});

describe("applyFocus: first use", () => {
  it("highlights the neighbourhood", () => {
    const outcome = applyFocus(GRAPH, NO_FOCUS, "b");
    expect(outcome.kind).toBe("neighbourhood");
    expect(outcome.state.nodeIds).toEqual(["b"]);
    expect(outcome.state.connection).toBeNull();
    expect([...outcome.highlight.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...outcome.highlight.edges].sort()).toEqual([edgeKey("a", "b"), edgeKey("b", "c")].sort());
  });

  it("connects instead of replacing when the second node is reachable", () => {
    // a and c are two hops apart through b, so this is a connection — not a
    // silent replacement of the first selection.
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const second = applyFocus(GRAPH, first.state, "c");
    expect(second.kind).toBe("connection");
    expect(second.state.nodeIds).toEqual(["a", "c"]);
    expect(second.highlight.nodes.has("b")).toBe(true);
  });
});

describe("applyFocus: second use", () => {
  it("highlights every link connecting the two nodes", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const second = applyFocus(GRAPH, first.state, "d");
    expect(second.kind).toBe("connection");
    expect(second.state.nodeIds).toEqual(["a", "d"]);
    expect(second.state.connection?.distance).toBe(3);
    expect([...second.highlight.nodes].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...second.highlight.edges].sort()).toEqual(
      [edgeKey("a", "b"), edgeKey("b", "c"), edgeKey("c", "d")].sort(),
    );
  });

  it("keeps both routes of a diamond", () => {
    const diamond = graphOf(["a-b", "a-c", "b-d", "c-d"]);
    const first = applyFocus(diamond, NO_FOCUS, "a");
    const second = applyFocus(diamond, first.state, "d");
    expect(second.kind).toBe("connection");
    expect(second.state.connection?.routeCount).toBe(2);
    expect([...second.highlight.edges].sort()).toEqual(
      [edgeKey("a", "b"), edgeKey("a", "c"), edgeKey("b", "d"), edgeKey("c", "d")].sort(),
    );
  });

  it("reports an unreachable pair and changes NOTHING", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const second = applyFocus(GRAPH, first.state, "x");

    expect(second.kind).toBe("unreachable");
    // The first selection survives, so the user can pick a different target
    // instead of having to start over.
    expect(second.state).toBe(first.state);
    expect([...second.highlight.nodes].sort()).toEqual(["a", "b"]);
    expect([...second.highlight.edges]).toEqual([edgeKey("a", "b")]);
  });

  it("reports an unreachable pair when the target is isolated", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    expect(applyFocus(GRAPH, first.state, "lonely").kind).toBe("unreachable");
  });

  it("connects two directly linked nodes", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const second = applyFocus(GRAPH, first.state, "b");
    expect(second.kind).toBe("connection");
    expect(second.state.connection?.distance).toBe(1);
    expect([...second.highlight.nodes].sort()).toEqual(["a", "b"]);
  });
});

describe("applyFocus: clearing", () => {
  it("clears when the focused node is acted on again", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "b");
    const second = applyFocus(GRAPH, first.state, "b");
    expect(second.kind).toBe("cleared");
    expect(second.state).toEqual(NO_FOCUS);
    expect([...second.highlight.nodes]).toEqual([]);
    expect([...second.highlight.edges]).toEqual([]);
  });

  it("clears when either node of a pair is acted on", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const pair = applyFocus(GRAPH, first.state, "d");

    const viaFirst = applyFocus(GRAPH, pair.state, "a");
    expect(viaFirst.kind).toBe("cleared");
    expect([...viaFirst.highlight.nodes]).toEqual([]);

    const viaSecond = applyFocus(GRAPH, pair.state, "d");
    expect(viaSecond.kind).toBe("cleared");
  });

  it("clears when an unknown node id is acted on", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const second = applyFocus(GRAPH, first.state, "ghost");
    expect(second.kind).toBe("cleared");
    expect(second.state).toEqual(NO_FOCUS);
  });
});

describe("applyFocus: a third use", () => {
  it("starts a fresh neighbourhood selection", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const pair = applyFocus(GRAPH, first.state, "d");
    const third = applyFocus(GRAPH, pair.state, "x");

    expect(third.kind).toBe("neighbourhood");
    expect(third.state.nodeIds).toEqual(["x"]);
    expect(third.state.connection).toBeNull();
    expect([...third.highlight.nodes].sort()).toEqual(["x", "y"]);
  });
});

describe("applyFocus on a filtered graph", () => {
  /** The view hands the state machine the graph as drawn, not the whole vault. */
  it("treats a pair as unconnected when the only route goes through a removed node", () => {
    const full = graphOf(["a-bridge", "bridge-z"]);
    expect(applyFocus(full, { nodeIds: ["a"], connection: null }, "z").kind).toBe("connection");

    // Same actions once "bridge" is hidden: the route is gone, so the pair must
    // be reported as unconnected rather than highlighting an invisible node.
    const visible = graphOf([], ["a", "z"]);
    const first = applyFocus(visible, NO_FOCUS, "a");
    const second = applyFocus(visible, first.state, "z");
    expect(second.kind).toBe("unreachable");
    expect([...second.highlight.nodes]).toEqual(["a"]);
  });

  it("ignores edges whose far end was removed", () => {
    const visible = graphOf([], ["a", "z"]);
    expect([...neighbourhoodHighlight(visible, "a").edges]).toEqual([]);
  });
});

describe("invariants", () => {
  it("never mutates the state it was given", () => {
    const first = applyFocus(GRAPH, NO_FOCUS, "a");
    const snapshot = [...first.state.nodeIds];
    applyFocus(GRAPH, first.state, "d");
    expect([...first.state.nodeIds]).toEqual(snapshot);
  });

  it("returns a fresh highlight object each time", () => {
    const a = applyFocus(GRAPH, NO_FOCUS, "b");
    const b = applyFocus(GRAPH, NO_FOCUS, "b");
    expect(a.highlight).not.toBe(b.highlight);
    expect([...a.highlight.nodes].sort()).toEqual([...b.highlight.nodes].sort());
  });

  it("keys edges identically regardless of which endpoint is the node", () => {
    const viaSource = neighbourhoodHighlight(GRAPH, "a");
    const viaTarget = neighbourhoodHighlight(GRAPH, "b");
    expect([...viaSource.edges]).toEqual([edgeKey("a", "b")]);
    expect([...viaTarget.edges]).toContain(edgeKey("a", "b"));
  });
});
