// @vitest-environment jsdom
/**
 * Tests for the built-in graph adapter.
 *
 * Obsidian's graph view has no public API, so `src/integrate/official-graph.ts`
 * talks to undocumented instance fields. These tests run it against a
 * **faithful mock of the surface that was read out of Obsidian 1.9.10's
 * `app.js`** — the field names, the callback signatures and the `{a, rgb}`
 * colour shape are all taken verbatim from the shipped bundle. If Obsidian
 * changes that surface, this file is where the contract is written down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom provides real elements but NOT Obsidian's DOM extensions
// (`createDiv`, `empty`, `addClass`, …); this installs the same polyfill the
// browser harness uses, so the view code runs unmodified.
import "../harness/dom-polyfill";

import { RING_GAP_PX, RING_MAX_PX, RING_MIN_PX, FOCUS_EDGE_DRAWN, GRAPH_MENU_SOURCE, SAFETY_NET_MS } from "../src/integrate/official-graph";
import { OfficialMarkerLayer } from "../src/integrate/official-markers";
import { t } from "../src/i18n";
import { typeColor } from "../src/view/palette";
import {
  OfficialGraphEnhancer,
  OFFICIAL_GRAPH_VIEW_TYPES,
  probeOfficialGraph,
} from "../src/integrate/official-graph";
import { createNodeResolver } from "../src/integrate/official-internals";
import type { GraphInsights } from "../src/core/insights";
import { EMPTY_GRAPH, type CommunityInfo, type GraphNode, type PageType, type WikiGraph } from "../src/types";
import { communityColor, hexToRgbInt, NODE_TYPE_COLORS } from "../src/view/palette";
import { setLanguage } from "../src/i18n";

// `setIcon` comes from "obsidian", which is types-only in this project, so the
// module is mocked. `renderInsightsPanel` receives it through `setIconImpl`.
vi.mock("obsidian", () => ({
  setIcon: (el: HTMLElement, icon: string) => {
    el.setAttribute("data-icon", icon);
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FakeOfficialNode {
  id: string;
  /** `setData` stores each link here, keyed by the OTHER endpoint.'s id. */
  forward?: Record<string, { line?: { alpha: number } }>;
  type: string;
  x: number;
  y: number;
  weight: number;
  color: { a: number; rgb: number } | null;
}

/**
 * Mirrors the real renderer: `setData` lives on the prototype, the callback
 * slots are own properties pre-owned by the data engine.
 */
class FakeOfficialRenderer {
  nodes: FakeOfficialNode[] = [];
  nodeLookup: Record<string, FakeOfficialNode> = {};
  colors: Record<string, { a: number; rgb: number }> = {
    fill: { a: 1, rgb: 0x999999 },
    line: { a: 0.8, rgb: 0x888888 },
    lineHighlight: { a: 1, rgb: 0xffffff },
  };
  containerEl: HTMLElement;
  highlightNode: FakeOfficialNode | null = null;
  /** Live link objects, as the render loop iterates them. */
  links: Array<{ line?: { alpha: number } }> = [];
  mouseX: number | null = 12;
  mouseY: number | null = 34;
  scale = 2;
  panX = 100;
  panY = 50;
  onNodeHover: ((event: MouseEvent, id: string, type: string) => void) | null = null;
  onNodeUnhover: (() => void) | null = null;

  hoverCalls: Array<{ id: string; type: string }> = [];
  unhoverCalls = 0;
  changedCount = 0;
  lastData: unknown = undefined;

  constructor(ids: Array<{ id: string; type?: string; color?: { a: number; rgb: number } | null }>) {
    this.containerEl = document.createElement("div");
    document.body.appendChild(this.containerEl);
    for (const entry of ids) {
      const node: FakeOfficialNode = {
        id: entry.id,
        type: entry.type ?? "",
        x: 10,
        y: 20,
        weight: 1,
        color: entry.color ?? null,
      };
      this.nodes.push(node);
      this.nodeLookup[entry.id] = node;
    }
  }

  /** On the prototype on purpose — restoring must delete the shadow property. */
  setData(data: unknown): string {
    this.lastData = data;
    return "set";
  }

  changed(): void {
    this.changedCount += 1;
  }
}

function makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    label: overrides.id,
    type: "concept" as PageType,
    rawType: "concept",
    path: `${overrides.id}.md`,
    linkCount: 3,
    inLinks: 2,
    outLinks: 1,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
    ...overrides,
  } as GraphNode;
}

function makeCommunity(id: number, nodeCount = 3): CommunityInfo {
  return {
    id,
    nodeCount,
    intraEdges: 3,
    cohesion: 0.5,
    meanIntraDegree: 2,
    topNodes: [`cluster-${id}`],
    isSparse: false,
    nodeIds: [],
  };
}

function makeEdge(source: string, target: string): WikiGraph["edges"][number] {
  return { source, target, weight: 1 } as WikiGraph["edges"][number];
}

function makeGraph(
  nodes: GraphNode[],
  communities: CommunityInfo[] = [],
  edges: Array<WikiGraph["edges"][number]> = [],
): WikiGraph {
  return {
    nodes,
    edges,
    communities,
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
    builtAt: 1,
  };
}

function makeApp(leaves: Record<string, unknown[]>): {
  workspace: { getLeavesOfType(type: string): unknown[] };
} {
  return { workspace: { getLeavesOfType: (type: string) => leaves[type] ?? [] } };
}

function makeLeaf(renderer: unknown, engine?: unknown): { view: unknown } {
  return { view: { renderer, engine } };
}

interface Harness {
  renderer: FakeOfficialRenderer;
  enhancer: OfficialGraphEnhancer;
  graph: WikiGraph;
  dismissed: string[];
  disableCalls: number;
  opened: string[];
  hiddenTypes: string[];
  toggled: string[];
  intermediates: number;
  typeColors: Record<string, string>;
  communityColors: Record<string, string>;
  lineColor: string | null;
  mode: string;
  rebuilds: number;
  weights: { directLink: number; sourceOverlap: number; commonNeighbor: number; coCitation: number };
  hiddenTags: string[];
  hideStructural: boolean;
  hideIsolated: boolean;
  leaf: unknown;
  /**
   * The insights the plugin currently exposes.
   *
   * A stable reference, replaced wholesale when a build finishes — which is what
   * the real `getData()` does. Rebuilding it per call would make every tick look
   * like a data change.
   */
  insights: GraphInsights;
}

function setup(
  ids: Array<{ id: string; type?: string; color?: { a: number; rgb: number } | null }>,
  graphNodes: GraphNode[],
  mode: "off" | "community" | "type" = "community",
): Harness {
  const renderer = new FakeOfficialRenderer(ids);
  const graph = makeGraph(graphNodes, [makeCommunity(0), makeCommunity(1)]);
  // Stands in for Obsidian's data engine: `render()` recomputes and hands the
  // renderer a fresh payload, which is how a late-attaching filter gets applied.
  const leaf = makeLeaf(renderer, {
    render: () => renderer.setData({ nodes: Object.fromEntries(ids.map((e) => [e.id, { type: "concept" }])) }),
  });
  const state: Harness = {
    renderer,
    graph,
    dismissed: [],
    disableCalls: 0,
    opened: [],
    hiddenTypes: [],
    toggled: [],
    intermediates: 0,
    typeColors: {},
    communityColors: {},
    lineColor: null,
    mode,
    rebuilds: 0,
    weights: { directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 },
    hiddenTags: [],
    hideStructural: false,
    hideIsolated: false,
    leaf,
    insights: { connections: [], gaps: [] },
    enhancer: null as unknown as OfficialGraphEnhancer,
  };
  state.enhancer = new OfficialGraphEnhancer({
    app: makeApp({ graph: [leaf] }) as never,
    getData: () => ({ graph: state.graph, insights: state.insights }),
    // Read through the state, not the `setup` argument: the toolbar and the colour
    // tabs change the mode at runtime, and a frozen closure would hide that.
    getMode: () => state.mode as "off" | "community" | "type",
    getDismissed: () => state.dismissed,
    onSetMode: (mode) => {
      state.mode = mode;
    },
    onRebuild: () => {
      state.rebuilds += 1;
    },
    getWeights: () => state.weights,
    onSetWeight: (key, value) => {
      state.weights = { ...state.weights, [key]: value };
    },
    onResetWeights: () => {
      state.weights = { directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 };
    },
    getVisibility: () => ({
      hiddenTypes: new Set(state.hiddenTypes as never[]),
      hiddenTags: new Set(state.hiddenTags),
      hideStructural: state.hideStructural,
      hideIsolated: state.hideIsolated,
    }),
    onSetVisibility: (patch) => {
      Object.assign(state, patch);
    },
    getTypeColors: () => state.typeColors,
    getCommunityColors: () => state.communityColors,
    onSetTypeColor: (type, color) => {
      if (color === null) delete state.typeColors[type];
      else state.typeColors[type] = color;
    },
    onSetCommunityColor: (community, color) => {
      const key = String(community);
      if (color === null) delete state.communityColors[key];
      else state.communityColors[key] = color;
    },
    onSetLineColor: (color) => {
      state.lineColor = color;
    },
    getLineColor: () => state.lineColor,
    getFocusIntermediates: () => state.intermediates,
    onSetFocusIntermediates: (value) => {
      state.intermediates = value;
    },
    getHiddenTypes: () => state.hiddenTypes,
    onToggleType: (pageType) => {
      state.toggled.push(pageType);
      const at = state.hiddenTypes.indexOf(pageType);
      if (at === -1) state.hiddenTypes.push(pageType);
      else state.hiddenTypes.splice(at, 1);
    },
    onDismiss: (key) => {
      state.dismissed.push(key);
    },
    onOpenNode: (nodeId) => {
      state.opened.push(nodeId);
    },
  });
  return state;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setLanguage("zh");
  document.body.innerHTML = "";
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Id resolution
// ---------------------------------------------------------------------------

describe("createNodeResolver", () => {
  const graph = makeGraph([
    makeNode({ id: "concepts/检索增强生成" }),
    makeNode({ id: "concepts/splade 稀疏向量" }),
    makeNode({ id: "entities/llama 3" }),
  ]);
  const resolve = createNodeResolver(graph);

  it("resolves an official path id, with or without the extension", () => {
    expect(resolve("concepts/检索增强生成.md")?.id).toBe("concepts/检索增强生成");
    expect(resolve("concepts/检索增强生成")?.id).toBe("concepts/检索增强生成");
  });

  it("is case-insensitive and normalises backslashes and ./", () => {
    expect(resolve("Concepts/SPLADE 稀疏向量.MD")?.id).toBe("concepts/splade 稀疏向量");
    expect(resolve(".\\concepts\\检索增强生成.md")?.id).toBe("concepts/检索增强生成");
  });

  it("falls back to the basename when the path differs", () => {
    expect(resolve("some/other/folder/llama 3.md")?.id).toBe("entities/llama 3");
  });

  it("returns undefined for virtual nodes and unknown ids", () => {
    // The official graph also carries tag / unresolved / attachment nodes.
    expect(resolve("#tag")).toBeUndefined();
    expect(resolve("未被引用的页面")).toBeUndefined();
    expect(resolve("")).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Colouring
// ---------------------------------------------------------------------------

describe("OfficialGraphEnhancer colouring", () => {
  it("paints every resolvable node with its community colour", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", community: 0 }), makeNode({ id: "b", community: 1 })],
    );

    h.enhancer.start();

    expect(h.renderer.nodeLookup["a.md"].color).toEqual({ a: 1, rgb: hexToRgbInt(communityColor(0)) });
    expect(h.renderer.nodeLookup["b.md"].color).toEqual({ a: 1, rgb: hexToRgbInt(communityColor(1)) });
  });

  it("uses the type palette when the mode says so", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", type: "source" })], "type");
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt(NODE_TYPE_COLORS.source));
  });

  it("leaves virtual and unknown nodes untouched", () => {
    const tagColor = { a: 1, rgb: 0x123456 };
    const h = setup(
      [{ id: "#tag", type: "tag", color: tagColor }, { id: "a.md" }],
      [makeNode({ id: "a" })],
    );

    h.enhancer.start();

    expect(h.renderer.nodeLookup["#tag"].color).toEqual(tagColor);
  });

  it("restores an official colour-group colour exactly on stop()", () => {
    const groupColor = { a: 1, rgb: 0xff00ff };
    const h = setup([{ id: "a.md", color: groupColor }], [makeNode({ id: "a" })]);

    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color).not.toEqual(groupColor);

    h.enhancer.stop();
    expect(h.renderer.nodeLookup["a.md"].color).toEqual(groupColor);
  });

  it("deletes the colour again when there was none to begin with", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color).not.toBeNull();
    h.enhancer.stop();
    // `delete` rather than `= null`, so the official default fill applies again.
    expect(h.renderer.nodeLookup["a.md"].color).toBeUndefined();
  });

  it("restores the official colours as soon as the mode turns off", () => {
    let mode: "off" | "community" = "community";
    const renderer = new FakeOfficialRenderer([{ id: "a.md" }]);
    const graph = makeGraph([makeNode({ id: "a", community: 1 })]);
    const enhancer = new OfficialGraphEnhancer({
      app: makeApp({ graph: [makeLeaf(renderer)] }) as never,
      getData: () => ({ graph, insights: { connections: [], gaps: [] } }),
      getMode: () => mode,
      getDismissed: () => [],
      onSetMode: () => {},
      onRebuild: () => {},
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      onSetWeight: () => {},
      onResetWeights: () => {},
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenTags: new Set(),
        hideStructural: false,
        hideIsolated: false,
      }),
      onSetVisibility: () => {},
      getTypeColors: () => ({}),
      getCommunityColors: () => ({}),
      onSetTypeColor: () => {},
      onSetCommunityColor: () => {},
      onSetLineColor: () => {},
      getLineColor: () => null,
      getFocusIntermediates: () => 0,
      onSetFocusIntermediates: () => {},
      getHiddenTypes: () => [],
      onToggleType: () => {},
      onDismiss: () => {},
      onOpenNode: () => {},
    });
    enhancer.start();
    expect(renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt(communityColor(1)));

    mode = "off";
    enhancer.refresh();

    // The node had no colour of its own, so restoring means deleting ours.
    expect(renderer.nodeLookup["a.md"].color).toBeUndefined();
    enhancer.stop();
  });
});

// ---------------------------------------------------------------------------
// Hover chaining
// ---------------------------------------------------------------------------

describe("OfficialGraphEnhancer hover", () => {
  it("chains to the engine's own handlers instead of replacing them", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", label: "Alpha" })]);
    h.renderer.onNodeHover = (_event, id, type) => h.renderer.hoverCalls.push({ id, type });
    h.renderer.onNodeUnhover = () => {
      h.renderer.unhoverCalls += 1;
    };

    h.enhancer.start();
    const event = new MouseEvent("mousemove");
    h.renderer.onNodeHover?.(event, "a.md", "");
    h.renderer.onNodeUnhover?.();

    expect(h.renderer.hoverCalls).toEqual([{ id: "a.md", type: "" }]);
    expect(h.renderer.unhoverCalls).toBe(1);
  });

  it("shows the node with its top related pages and their scores", () => {
    const a = makeNode({ id: "a", label: "Alpha", community: 0 });
    const b = makeNode({ id: "b", label: "Beta", community: 1 });
    const c = makeNode({ id: "c", label: "Gamma", community: 0 });
    const graph: WikiGraph = {
      ...makeGraph([a, b, c]),
      edges: [
        { source: "a", target: "b", weight: 9.5, signals: zeroSignals(), hasDirectLink: true, sharedSources: [], commonNeighbors: 0 },
        { source: "a", target: "c", weight: 3.25, signals: zeroSignals(), hasDirectLink: true, sharedSources: [], commonNeighbors: 0 },
      ],
    };
    const renderer = new FakeOfficialRenderer([{ id: "a.md" }]);
    const enhancer = new OfficialGraphEnhancer({
      app: makeApp({ graph: [makeLeaf(renderer)] }) as never,
      getData: () => ({ graph, insights: { connections: [], gaps: [] } }),
      getMode: () => "community",
      getDismissed: () => [],
      onSetMode: () => {},
      onRebuild: () => {},
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      onSetWeight: () => {},
      onResetWeights: () => {},
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenTags: new Set(),
        hideStructural: false,
        hideIsolated: false,
      }),
      onSetVisibility: () => {},
      getTypeColors: () => ({}),
      getCommunityColors: () => ({}),
      onSetTypeColor: () => {},
      onSetCommunityColor: () => {},
      onSetLineColor: () => {},
      getLineColor: () => null,
      getFocusIntermediates: () => 0,
      onSetFocusIntermediates: () => {},
      getHiddenTypes: () => [],
      onToggleType: () => {},
      onDismiss: () => {},
      onOpenNode: () => {},
    });
    enhancer.start();

    renderer.onNodeHover?.(new MouseEvent("mousemove"), "a.md", "");

    const tooltip = renderer.containerEl.querySelector(".enhanced-graph-official-tooltip") as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.classList.contains("is-hidden")).toBe(false);
    const text = tooltip.textContent ?? "";
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("9.50");
    expect(text).toContain("Gamma");
    expect(text).toContain("3.25");
    // Highest weight first.
    expect(text.indexOf("Beta")).toBeLessThan(text.indexOf("Gamma"));

    renderer.onNodeUnhover?.();
    expect(tooltip.classList.contains("is-hidden")).toBe(true);
    enhancer.stop();
  });

  it("still renders a minimal card for virtual nodes", () => {
    const h = setup([{ id: "#tag", type: "tag" }], [makeNode({ id: "a" })]);
    h.enhancer.start();

    h.renderer.onNodeHover?.(new MouseEvent("mousemove"), "#tag", "tag");

    const tooltip = h.renderer.containerEl.querySelector(".enhanced-graph-official-tooltip") as HTMLElement;
    expect(tooltip.textContent).toContain("#tag");
    expect(tooltip.classList.contains("is-hidden")).toBe(false);
  });

  it("never lets a throwing engine handler break our tooltip", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.renderer.onNodeHover = () => {
      throw new Error("engine blew up");
    };
    h.enhancer.start();

    expect(() => h.renderer.onNodeHover?.(new MouseEvent("mousemove"), "a.md", "")).not.toThrow();
    const tooltip = h.renderer.containerEl.querySelector(".enhanced-graph-official-tooltip") as HTMLElement;
    expect(tooltip.classList.contains("is-hidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Panel + lifecycle
// ---------------------------------------------------------------------------

describe("OfficialGraphEnhancer panel and lifecycle", () => {
  it("injects one panel per graph view and removes it on stop()", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();

    const panels = h.renderer.containerEl.querySelectorAll(".enhanced-graph-official-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain("官方图谱增强");

    h.enhancer.stop();
    expect(h.renderer.containerEl.querySelectorAll(".enhanced-graph-official-panel")).toHaveLength(0);
  });

  it("renders the community legend with cohesion and member counts", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();

    const legend = h.renderer.containerEl.querySelector(".enhanced-graph-official-legend") as HTMLElement;
    expect(legend).toBeTruthy();
    expect(legend.querySelectorAll(".enhanced-graph-legend-row")).toHaveLength(2);
    expect(legend.textContent).toContain("cluster-0");
    expect(legend.textContent).toContain("内聚度");
  });

  it("hides the panel entirely when the mode is off", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "off");
    h.enhancer.start();
    const panel = h.renderer.containerEl.querySelector(".enhanced-graph-official-panel") as HTMLElement;
    expect(panel.classList.contains("is-hidden")).toBe(true);
  });

  it("recolours without re-wrapping when setData replaces the nodes", async () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", community: 1 })]);
    h.enhancer.start();
    const wrapped = h.renderer.setData;

    // A refresh must reuse the single wrapper rather than stacking another one.
    h.renderer.setData({ nodes: {} });
    expect(h.renderer.setData).toBe(wrapped);

    // The re-colour pass is deferred a tick so the engine can finish first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt(communityColor(1)));
  });

  it("is idempotent: starting twice wraps setData once", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const once = h.renderer.setData;
    h.enhancer.start();
    expect(h.renderer.setData).toBe(once);
  });

  it("restores setData to the prototype and the callbacks to null", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    const prototypeSetData = FakeOfficialRenderer.prototype.setData;
    h.enhancer.start();
    expect(Object.prototype.hasOwnProperty.call(h.renderer, "setData")).toBe(true);

    h.enhancer.stop();

    expect(Object.prototype.hasOwnProperty.call(h.renderer, "setData")).toBe(false);
    expect(h.renderer.setData).toBe(prototypeSetData);
    expect(h.renderer.onNodeHover).toBeNull();
    expect(h.renderer.onNodeUnhover).toBeNull();
    expect(h.renderer.changedCount).toBeGreaterThan(0);
  });

  it("detaches from a leaf whose renderer disappeared", () => {
    const renderer = new FakeOfficialRenderer([{ id: "a.md" }]);
    const leaf = makeLeaf(renderer);
    const app = { workspace: { getLeavesOfType: (type: string) => (type === "graph" ? [leaf] : []) } };
    const graph = makeGraph([makeNode({ id: "a" })]);
    const enhancer = new OfficialGraphEnhancer({
      app: app as never,
      getData: () => ({ graph, insights: { connections: [], gaps: [] } }),
      getMode: () => "community",
      getDismissed: () => [],
      onSetMode: () => {},
      onRebuild: () => {},
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      onSetWeight: () => {},
      onResetWeights: () => {},
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenTags: new Set(),
        hideStructural: false,
        hideIsolated: false,
      }),
      onSetVisibility: () => {},
      getTypeColors: () => ({}),
      getCommunityColors: () => ({}),
      onSetTypeColor: () => {},
      onSetCommunityColor: () => {},
      onSetLineColor: () => {},
      getLineColor: () => null,
      getFocusIntermediates: () => 0,
      onSetFocusIntermediates: () => {},
      getHiddenTypes: () => [],
      onToggleType: () => {},
      onDismiss: () => {},
      onOpenNode: () => {},
    });
    enhancer.start();
    expect(renderer.containerEl.querySelectorAll(".enhanced-graph-official-panel")).toHaveLength(1);

    // The view was closed / reshaped: the renderer object is gone.
    (leaf as { view: unknown }).view = {};
    enhancer.sync();

    expect(renderer.containerEl.querySelectorAll(".enhanced-graph-official-panel")).toHaveLength(0);
    enhancer.stop();
  });

  it("supports both documented view types", () => {
    expect([...OFFICIAL_GRAPH_VIEW_TYPES]).toEqual(["graph", "localgraph"]);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics + degradation
// ---------------------------------------------------------------------------

describe("probeOfficialGraph", () => {
  it("reports every seam when the built-in view is fully shaped", () => {
    const renderer = new FakeOfficialRenderer([{ id: "a.md" }]);
    const probes = probeOfficialGraph(makeApp({ graph: [makeLeaf(renderer)] }) as never);

    const globalProbe = probes.find((probe) => probe.viewType === "graph");
    expect(globalProbe).toMatchObject({
      leafFound: true,
      rendererFound: true,
      nodesFound: true,
      containerFound: true,
    });
    expect(globalProbe?.missing).toEqual([]);
  });

  it("lists the missing seams instead of throwing when nothing is open", () => {
    const probes = probeOfficialGraph(makeApp({}) as never);
    expect(probes).toHaveLength(2);
    for (const probe of probes) {
      expect(probe.leafFound).toBe(false);
      expect(probe.missing).toContain("leaf");
    }
  });

  it("flags a renderer without a node array", () => {
    const probes = probeOfficialGraph(makeApp({ graph: [makeLeaf({ containerEl: document.createElement("div") })] }) as never);
    expect(probes[0].missing).toContain("renderer.nodes");
    expect(probes[0].engineFound).toBe(false);
  });
});

describe("degradation", () => {
  it("does nothing at all when there is no graph leaf", () => {
    const graph = makeGraph([makeNode({ id: "a" })]);
    const enhancer = new OfficialGraphEnhancer({
      app: makeApp({}) as never,
      getData: () => ({ graph, insights: { connections: [], gaps: [] } }),
      getMode: () => "community",
      getDismissed: () => [],
      onSetMode: () => {},
      onRebuild: () => {},
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      onSetWeight: () => {},
      onResetWeights: () => {},
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenTags: new Set(),
        hideStructural: false,
        hideIsolated: false,
      }),
      onSetVisibility: () => {},
      getTypeColors: () => ({}),
      getCommunityColors: () => ({}),
      onSetTypeColor: () => {},
      onSetCommunityColor: () => {},
      onSetLineColor: () => {},
      getLineColor: () => null,
      getFocusIntermediates: () => 0,
      onSetFocusIntermediates: () => {},
      getHiddenTypes: () => [],
      onToggleType: () => {},
      onDismiss: () => {},
      onOpenNode: () => {},
    });

    expect(() => {
      enhancer.start();
      enhancer.refresh();
      enhancer.sync();
      enhancer.stop();
    }).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("survives a renderer whose containerEl is missing", () => {
    const leaf = { view: { renderer: { nodes: [] } } };
    const graph = makeGraph([makeNode({ id: "a" })]);
    const enhancer = new OfficialGraphEnhancer({
      app: makeApp({ graph: [leaf] }) as never,
      getData: () => ({ graph, insights: { connections: [], gaps: [] } }),
      getMode: () => "community",
      getDismissed: () => [],
      onSetMode: () => {},
      onRebuild: () => {},
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      onSetWeight: () => {},
      onResetWeights: () => {},
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenTags: new Set(),
        hideStructural: false,
        hideIsolated: false,
      }),
      onSetVisibility: () => {},
      getTypeColors: () => ({}),
      getCommunityColors: () => ({}),
      onSetTypeColor: () => {},
      onSetCommunityColor: () => {},
      onSetLineColor: () => {},
      getLineColor: () => null,
      getFocusIntermediates: () => 0,
      onSetFocusIntermediates: () => {},
      getHiddenTypes: () => [],
      onToggleType: () => {},
      onDismiss: () => {},
      onOpenNode: () => {},
    });

    expect(() => enhancer.start()).not.toThrow();
    enhancer.stop();
  });

  it("reports an empty graph without colouring anything", () => {
    const h = setup([{ id: "a.md" }], []);
    h.graph = EMPTY_GRAPH;
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color).toBeNull();
  });
});

describe("built-in graph context menu", () => {
  interface FakeMenuItem {
    title: string;
    click: () => void;
  }

  /** Minimal stand-in for Obsidian's `Menu`: only `addItem` is used. */
  function makeMenu(): { items: FakeMenuItem[]; addItem: (build: (item: unknown) => unknown) => void } {
    const items: FakeMenuItem[] = [];
    const addItem = (build: (item: unknown) => unknown): void => {
      const item = {
        title: "",
        click: () => {},
        setSection: () => item,
        setIcon: () => item,
        setTitle(value: string) {
          item.title = value;
          return item;
        },
        onClick(fn: () => void) {
          item.click = fn;
          return item;
        },
      };
      build(item);
      items.push(item);
    };
    return { items, addItem };
  }

  const file = { path: "concepts/a.md", basename: "a" } as never;

  it("stays out of menus that are not the built-in graph's node menu", () => {
    const h = setup([{ id: "concepts/a.md" }], [makeNode({ id: "concepts/a" })]);
    h.enhancer.start();
    const menu = makeMenu();
    h.enhancer.handleFileMenu(menu as never, file, "file-menu", undefined);
    h.enhancer.handleFileMenu(menu as never, file, "", undefined);
    expect(menu.items).toHaveLength(0);
  });

  it("offers focus and hide-type for a graph node", () => {
    const h = setup([{ id: "concepts/a.md" }], [makeNode({ id: "concepts/a" })]);
    h.enhancer.start();
    const menu = makeMenu();
    h.enhancer.handleFileMenu(menu as never, file, GRAPH_MENU_SOURCE, undefined);
    expect(menu.items).toHaveLength(2);
    expect(menu.items[1].title).toContain("概念");
  });

  it("toggling the type reports the node's page type", () => {
    const h = setup([{ id: "concepts/a.md" }], [makeNode({ id: "concepts/a" })]);
    h.enhancer.start();
    const menu = makeMenu();
    h.enhancer.handleFileMenu(menu as never, file, GRAPH_MENU_SOURCE, undefined);
    menu.items[1].click();
    expect(h.toggled).toEqual(["concept"]);
  });

  it("does nothing when the enhancement is off", () => {
    const h = setup([{ id: "concepts/a.md" }], [makeNode({ id: "concepts/a" })], "off");
    h.enhancer.start();
    const menu = makeMenu();
    h.enhancer.handleFileMenu(menu as never, file, GRAPH_MENU_SOURCE, undefined);
    expect(menu.items).toHaveLength(0);
  });

  it("removes hidden page types from the data handed to the built-in renderer", () => {
    const h = setup(
      [{ id: "concepts/a.md" }, { id: "entities/b.md" }],
      [makeNode({ id: "concepts/a", type: "concept" }), makeNode({ id: "entities/b", type: "entity" })],
    );
    h.enhancer.start();
    h.hiddenTypes.push("concept");
    const payload = { nodes: { "concepts/a.md": { type: "concept" }, "entities/b.md": { type: "entity" } } };
    h.renderer.setData(payload);
    // What the RENDERER received, not what we passed: filtering hands it a copy so
    // the pristine payload stays re-appliable.
    expect(Object.keys(received(h).nodes)).toEqual(["entities/b.md"]);
    expect(Object.keys(payload.nodes)).toHaveLength(2);
  });

  it("keeps every node when nothing is hidden", () => {
    const h = setup(
      [{ id: "concepts/a.md" }, { id: "entities/b.md" }],
      [makeNode({ id: "concepts/a", type: "concept" }), makeNode({ id: "entities/b", type: "entity" })],
    );
    h.enhancer.start();
    const payload = { nodes: { "concepts/a.md": { type: "concept" }, "entities/b.md": { type: "entity" } } };
    h.renderer.setData(payload);
    expect(Object.keys(payload.nodes)).toHaveLength(2);
  });
});

describe("focus on the built-in graph", () => {
  /** Clicks one menu item by label; defaults to the first (focus neighbours). */
  function menuClick(h: Harness, id: string, label?: string): boolean {
    let clicked = false;
    h.enhancer.handleFileMenu(
      {
        addItem: (build: (item: unknown) => unknown) => {
          const item = {
            title: "",
            click: () => {},
            setSection: () => item,
            setIcon: () => item,
            setTitle(value: string) {
              item.title = value;
              return item;
            },
            onClick(fn: () => void) {
              item.click = fn;
              return item;
            },
          };
          build(item);
          if (label === undefined ? !clicked : item.title.includes(label)) {
            item.click();
            clicked = true;
          }
        },
      } as never,
      { path: `${id}.md`, basename: id.split("/").pop() } as never,
      GRAPH_MENU_SOURCE,
      h.leaf as never,
    );
    return clicked;
  }

  function focusViaMenu(h: Harness, id: string): void {
    menuClick(h, id);
  }

  function alphaOf(h: Harness, id: string): number | undefined {
    return h.renderer.nodeLookup[`${id}.md`]?.color?.a;
  }

  /** a - x - b, plus an unrelated `far`, so a and b are two hops apart. */
  function chain(): Harness {
    const h = setup(
      [{ id: "a.md" }, { id: "x.md" }, { id: "b.md" }, { id: "far.md" }],
      [makeNode({ id: "a" }), makeNode({ id: "x" }), makeNode({ id: "b" }), makeNode({ id: "far" })],
    );
    h.graph = makeGraph([...h.graph.nodes], [...h.graph.communities], [makeEdge("a", "x"), makeEdge("x", "b")]);
    return h;
  }

  it("brightens the focused node and dims the rest", () => {
    const h = chain();
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    expect(alphaOf(h, "a")).toBe(1);
    expect(alphaOf(h, "x")).toBe(1);
    expect(alphaOf(h, "far")).toBeLessThan(1);
  });

  it("brings the route along when a second note is focused", () => {
    const h = chain();
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    expect(alphaOf(h, "b")).toBeLessThan(1);

    focusViaMenu(h, "concepts/b");
    // Both endpoints AND the node between them stay bright.
    expect(alphaOf(h, "a")).toBe(1);
    expect(alphaOf(h, "b")).toBe(1);
    expect(alphaOf(h, "x")).toBe(1);
  });

  it("rings the focused note where the renderer actually draws it", async () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = chain();
      h.enhancer.start();
      focusViaMenu(h, "concepts/a");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const calls = draw.mock.calls;
      const points = calls[calls.length - 1]?.[0] ?? [];
      // The fake renderer: node at (10, 20), scale 2, pan (100, 50), dpr 1 — so
      // screen = (x*scale + pan) / dpr. Off-by-anything here puts the ring beside
      // the node instead of on it.
      expect(points).toHaveLength(1);
      expect(points[0].x).toBeCloseTo((10 * 2 + 100) / (window.devicePixelRatio || 1), 6);
      expect(points[0].y).toBeCloseTo((20 * 2 + 50) / (window.devicePixelRatio || 1), 6);
      // The ring sits just outside the node's own radius. What matters is that
      // it does NOT depend on the zoom: the two earlier attempts multiplied by
      // `scale` or `nodeScale`, and across the zoom range `nodeScale` grows by
      // 10.6 while `scale` shrinks by 111 — neither tracks the node's drawn
      // size, which is not readable from `nodeLookup` at all.
      //
      // The fake node has no `getSize`, so the fallback of 6 applies.
      expect(points[0].radius).toBeCloseTo(6 + RING_GAP_PX, 6);
      expect(points[0].radius).toBeGreaterThanOrEqual(RING_MIN_PX);
      expect(points[0].radius).toBeLessThanOrEqual(RING_MAX_PX);
    } finally {
      draw.mockRestore();
    }
  });

  it("wipes the marker rings when the focus is dropped", async () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = chain();
      h.enhancer.start();
      focusViaMenu(h, "concepts/a");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const withRings = draw.mock.calls[draw.mock.calls.length - 1]?.[0] ?? [];
      expect(withRings.length).toBeGreaterThan(0);

      // The ticker stops as soon as the focus is gone, so the last frame it drew
      // would otherwise stay on the canvas for good.
      menuClick(h, "concepts/a", "取消聚焦");
      const afterClear = draw.mock.calls[draw.mock.calls.length - 1]?.[0] ?? null;
      expect(afterClear).toEqual([]);
    } finally {
      draw.mockRestore();
    }
  });
  it("mounts the marker layer and takes it away again", () => {
    const h = chain();
    h.enhancer.start();
    expect(h.renderer.containerEl.querySelector(".enhanced-graph-marker-layer")).not.toBeNull();
    h.enhancer.stop();
    expect(h.renderer.containerEl.querySelector(".enhanced-graph-marker-layer")).toBeNull();
  });
  it("leaves unrelated neighbours dark when viewing a connection", () => {
    // `u` hangs off `a` but has nothing to do with the route a - x - b.
    const h = setup(
      [{ id: "a.md" }, { id: "x.md" }, { id: "b.md" }, { id: "u.md" }],
      ["a", "x", "b", "u"].map((id) => makeNode({ id })),
    );
    h.graph = makeGraph([...h.graph.nodes], [...h.graph.communities], [
      makeEdge("a", "x"),
      makeEdge("x", "b"),
      makeEdge("a", "u"),
    ]);
    h.enhancer.start();

    // One note focused: "focus neighbours" is exactly its neighbours, so `u`
    // belongs in the highlight.
    focusViaMenu(h, "concepts/a");
    expect(alphaOf(h, "u")).toBe(1);

    // A second note focused: now it is about the ROUTE, and `u` is noise.
    focusViaMenu(h, "concepts/b");
    expect(alphaOf(h, "u")).toBeLessThan(1);
    expect(alphaOf(h, "a")).toBe(1);
    expect(alphaOf(h, "x")).toBe(1);
    expect(alphaOf(h, "b")).toBe(1);
  });
  it("widens the route when a larger hop budget is chosen", () => {
    // Two ways from a to b: a - x - b (2 hops) and a - p - q - r - b (4 hops).
    // `q` is the only node that is neither on the shortest route nor a direct
    // neighbour of a focused note, so it is the only one a wider budget can
    // reach — anywhere else and the assertion would pass for the wrong reason.
    const h = setup(
      [{ id: "a.md" }, { id: "x.md" }, { id: "b.md" }, { id: "p.md" }, { id: "q.md" }, { id: "r.md" }],
      ["a", "x", "b", "p", "q", "r"].map((id) => makeNode({ id })),
    );
    h.graph = makeGraph([...h.graph.nodes], [...h.graph.communities], [
      makeEdge("a", "x"),
      makeEdge("x", "b"),
      makeEdge("a", "p"),
      makeEdge("p", "q"),
      makeEdge("q", "r"),
      makeEdge("r", "b"),
    ]);
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    focusViaMenu(h, "concepts/b");

    // Default budget: only the shortest route, so the detour stays dark.
    expect(alphaOf(h, "q")).toBeLessThan(1);

    h.intermediates = 3; // -> maxHops 4, wide enough for the detour
    (h.enhancer as unknown as { assertFocus(r: unknown): void }).assertFocus(h.renderer);

    expect(alphaOf(h, "q")).toBe(1);
  });
  it("never touches the shared theme colours", () => {
    const h = chain();
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    // Dimming is per edge now; the shared `colors.line` must stay untouched,
    // which is what keeps `c` at 1 and both lerp targets in range.
    expect(h.renderer.colors.line.a).toBeCloseTo(0.8, 6);
    expect(h.renderer.colors.lineHighlight.a).toBeCloseTo(1, 6);
  });

  it("offers 取消聚焦 only while something is focused", () => {
    const h = chain();
    h.enhancer.start();
    expect(menuClick(h, "concepts/a", "取消聚焦")).toBe(false);
    focusViaMenu(h, "concepts/a");
    expect(menuClick(h, "concepts/a", "取消聚焦")).toBe(true);
  });

  it("clears the focus from the context menu", () => {
    const h = chain();
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    expect(alphaOf(h, "far")).toBeLessThan(1);
    menuClick(h, "concepts/a", "取消聚焦");
    expect(alphaOf(h, "far")).toBe(1);
    expect(alphaOf(h, "a")).toBe(1);
  });

  it("keeps the route's edges lit and dims the rest, exactly", async () => {
    const h = chain();
    h.enhancer.start();
    // Stand in for what `setData` builds: a link object on each source node and
    // the flat list the render loop iterates.
    const routeLink = { line: { alpha: 1 } };
    const otherLink = { line: { alpha: 1 } };
    h.renderer.nodeLookup["a.md"].forward = { "x.md": routeLink };
    h.renderer.nodeLookup["x.md"].forward = { "b.md": routeLink };
    h.renderer.links = [routeLink, otherLink];

    focusViaMenu(h, "concepts/a");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // The render draws `written*0.9 + c*0.1` and `c` is left at 1, so inverting
    // it puts both results exactly where they belong without any clamping.
    const drawn = (written: number): number => written * 0.9 + 0.1;
    expect(drawn(routeLink.line.alpha)).toBeCloseTo(1, 6);
    // The dimmed target is read from the module rather than written out here.
    // Hard-coding 0.2 made this test fail the moment the contrast was raised,
    // which said nothing about whether the mechanism still worked — the thing
    // under test is that the route and the rest land on DIFFERENT, ordered
    // levels, and that the lit one is the brighter.
    expect(drawn(otherLink.line.alpha)).toBeCloseTo(FOCUS_EDGE_DRAWN, 6);
    expect(drawn(routeLink.line.alpha)).toBeGreaterThan(drawn(otherLink.line.alpha));
  });
  it("survives the pointer travelling to another node", async () => {
    const h = chain();
    h.enhancer.start();
    focusViaMenu(h, "concepts/a");
    // Crossing the graph fires hover on the way; the focus has to survive it,
    // and the renderer's own single-node highlight must not take over.
    h.renderer.onNodeHover?.(new MouseEvent("mousemove"), "b.md", "");
    h.renderer.highlightNode = h.renderer.nodeLookup["b.md"];
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(alphaOf(h, "far")).toBeLessThan(1);
    expect(h.renderer.highlightNode).toBeNull();
  });
});
describe("colour options on the built-in graph", () => {
  it("uses the user's per-type colour instead of the palette default", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", type: "concept" })], "type");
    h.typeColors["concept"] = "#ff0000";
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt("#ff0000"));
  });

  it("falls back to the palette while no override is set", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", type: "concept" })], "type");
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt(typeColor("concept")));
  });

  it("uses the user's per-community colour in community mode", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", community: 1 })]);
    h.communityColors["1"] = "#00ff00";
    h.enhancer.start();
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt("#00ff00"));
  });

  it("applies the chosen line colour to the shared edge colours", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.lineColor = "#123456";
    h.enhancer.start();
    expect(h.renderer.colors.line.rgb).toBe(hexToRgbInt("#123456"));
    expect(h.renderer.colors.lineHighlight.rgb).toBe(hexToRgbInt("#123456"));
  });

  it("puts the theme's line colour back when the enhancement stops", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.lineColor = "#123456";
    h.enhancer.start();
    const themed = hexToRgbInt("#888888");
    h.enhancer.stop();
    // `stop()` restores node colours, and the theme's line colour with them.
    expect(h.renderer.colors.line.rgb).toBe(themed);
  });

  it("leaves the line colour alone when none is chosen", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    expect(h.renderer.colors.line.rgb).toBe(0x888888);
  });
});

describe("the built-in graph panel", () => {
  /** Opens a panel the way a user now does: the toolbar is the only switch. */
  function openPanel(h: Harness, label: string): void {
    const bar = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-toolbar");
    const button = Array.from(bar?.querySelectorAll("button") ?? []).find((candidate) =>
      (candidate.textContent ?? "").includes(label),
    );
    if (!button) throw new Error(`no toolbar button saying ${label}`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function panelOf(h: Harness): HTMLElement {
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel");
    if (!panel) throw new Error("panel not mounted");
    return panel;
  }

  function tabButton(panel: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(panel.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!button) throw new Error(`no tab named ${label}`);
    return button;
  }

  it("leaves the header without its own close and collapse buttons", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const header = panelOf(h).querySelector<HTMLElement>(".enhanced-graph-official-panel-header");
    // Closing the panel and turning the enhancement off are the toolbar's and the
    // settings tab's jobs; two extra buttons in the header just duplicated them.
    expect(header?.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps the toolbar and the panel in one flow", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const overlay = h.renderer.containerEl.querySelector<HTMLElement>(
      ".enhanced-graph-official-overlay",
    );
    // Both live in the same column, so the panel sits below the toolbar whatever
    // height the toolbar takes — positioning them separately made the panel
    // overlap the toolbar as soon as it grew.
    expect(overlay).not.toBeNull();
    expect(overlay!.querySelector(".enhanced-graph-official-toolbar")).not.toBeNull();
    expect(overlay!.querySelector(".enhanced-graph-official-panel")).not.toBeNull();

    // The overlay is a flex COLUMN, so DOM order is visual order: the toolbar has
    // to come first or it is pushed to the bottom of the view by the panel.
    const children = Array.from(overlay!.children);
    expect(children.indexOf(overlay!.querySelector(".enhanced-graph-official-toolbar")!)).toBeLessThan(
      children.indexOf(overlay!.querySelector(".enhanced-graph-official-panel")!),
    );
  });
  it("opens on the insights and keeps the colours out of them", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const panel = panelOf(h);
    // The colour rows used to sit in the insights flow, pushing them off screen.
    expect(panel.querySelectorAll(".enhanced-graph-colour-row")).toHaveLength(0);
    // The panel carries only its own header: opening a view is the toolbar's job,
    // and a second set of switches here just duplicated it.
    expect(panel.querySelectorAll(".enhanced-graph-official-tabs")).toHaveLength(0);
  });

  it("shows the colours, and only the colours, on their own tab", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));
    expect(panel.querySelectorAll(".enhanced-graph-colour-row").length).toBeGreaterThan(0);
    // One row per page type, plus the line colour.
    expect(panel.querySelectorAll(".enhanced-graph-colour-row")).toHaveLength(2);
  });

  it("does not destroy the colour picker while it is being used", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));

    const picker = panel.querySelector<HTMLInputElement>(
      ".enhanced-graph-colour-row input[type=color]",
    );
    expect(picker).toBeTruthy();
    // Clicking a swatch opens a NATIVE dialog attached to this very element, and
    // picking a colour fires `input`, which saves and refreshes. Rebuilding the
    // panel then removed the element and the dialog vanished mid-interaction.
    picker!.focus();
    picker!.value = "#ff0000";
    picker!.dispatchEvent(new Event("input", { bubbles: true }));
    h.enhancer.refresh();

    const after = panel.querySelector(".enhanced-graph-colour-row input[type=color]");
    expect(after).toBe(picker);
  });

  it("catches up once the interaction is over", async () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));
    const picker = panel.querySelector<HTMLInputElement>(
      ".enhanced-graph-colour-row input[type=color]",
    )!;
    picker.focus();
    h.enhancer.refresh();
    picker.blur();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // The deferred render still happens, so the panel is never left stale.
    expect(panel.querySelectorAll(".enhanced-graph-colour-row").length).toBeGreaterThan(0);
  });

  it("switches the colouring mode from the colour tabs", async () => {
    const h = setup(
      [{ id: "a.md" }],
      [makeNode({ id: "a", type: "concept", community: 1 })],
      "type",
    );
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));

    // The list and the colouring are one decision, not two: picking the
    // community list has to actually colour by community.
    tabButton(panel, t("appearance.colorByCommunity")).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(h.mode).toBe("community");
    // The re-colour happens once the host has applied the mode, so it lands a
    // microtask later.
    await Promise.resolve();
    expect(h.renderer.nodeLookup["a.md"].color?.rgb).toBe(hexToRgbInt(communityColor(1)));
  });

  it("marks the tab matching the current mode, and neither when colouring is off", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", community: 1 })], "community");
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));
    const active = (label: string): boolean =>
      Boolean(tabButton(panel, label).classList.contains("is-active"));
    expect(active(t("appearance.colorByCommunity"))).toBe(true);
    expect(active(t("appearance.colorByType"))).toBe(false);
  });
});
describe("the built-in graph's toolbar", () => {
  function toolbarOf(h: Harness): HTMLElement {
    const bar = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-toolbar");
    if (!bar) throw new Error("toolbar not mounted");
    return bar;
  }

  function buttonSaying(bar: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(bar.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(text));
  }

  it("mounts the standalone toolbar, with only the panels it actually has", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const bar = toolbarOf(h);
    // Same component and classes as the standalone view, so the chrome matches.
    expect(bar.querySelector(".enhanced-graph-segmented")).not.toBeNull();
    expect(buttonSaying(bar, t("toolbar.colorByType"))).toBeTruthy();
    expect(buttonSaying(bar, t("toolbar.insights"))).toBeTruthy();
    expect(buttonSaying(bar, t("toolbar.appearance"))).toBeTruthy();
    // Every panel the standalone view has is ported now, so every toggle is here.
    expect(buttonSaying(bar, t("toolbar.filter"))).toBeTruthy();
    expect(buttonSaying(bar, t("toolbar.weights"))).toBeTruthy();
  });

  it("opens the weights panel and writes the shared coefficients", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.weights"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".enhanced-graph-stepper"));
    expect(rows.length).toBeGreaterThanOrEqual(4);

    const field = rows[0].querySelector<HTMLInputElement>("input[type=number]")!;
    field.value = "5";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    // The same setting the settings tab and the standalone view read.
    expect(h.weights.directLink).toBe(5);
  });
  it("opens the filters panel, which drives the shared filter state", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
    );
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.filter"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".enhanced-graph-checkbox"));
    expect(rows.length).toBeGreaterThan(0);

    // Unticking a page type writes the SAME setting the standalone view reads, so
    // the two cannot drift apart.
    const conceptRow = rows.find((row) => row.textContent?.includes(t("type.concept")));
    const input = conceptRow?.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(input?.checked).toBe(true);
    input!.checked = false;
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.hiddenTypes).toContain("concept");
  });

  it("hides a filtered type from the built-in graph itself", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
    );
    h.enhancer.start();
    h.hiddenTypes.push("concept");
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "entity" } } };
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual(["b.md"]);
  });

  it("filters a graph we attached to AFTER it had already rendered", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
    );
    h.enhancer.start();
    // Nothing has gone through our wrapper yet, so there is no captured payload to
    // re-apply — the situation a freshly attached graph is always in. The filters
    // used to do nothing at all until the vault next changed.
    expect(h.renderer.lastData).toBeFalsy();

    h.hiddenTypes.push("concept");
    h.enhancer.refresh();
    // The engine was asked for a fresh payload, which our wrapper then filtered.
    expect(Object.keys(received(h).nodes)).toEqual(["b.md"]);
  });
  it("applies a filter change without waiting for the engine to update", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
    );
    h.enhancer.start();
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "entity" } } };
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toHaveLength(2);

    // The user ticks a filter. Nothing tells the built-in engine; our own refresh
    // has to push the data through again or the graph does not change.
    h.hiddenTypes.push("concept");
    h.enhancer.refresh();
    expect(Object.keys(received(h).nodes)).toEqual(["b.md"]);
  });

  it("can bring a filtered type back", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
    );
    h.enhancer.start();
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "entity" } } };
    h.renderer.setData(payload);
    h.hiddenTypes.push("concept");
    h.enhancer.refresh();
    expect(Object.keys(received(h).nodes)).toEqual(["b.md"]);

    // Un-hiding has to work too — which it cannot if filtering pruned the payload
    // it later re-applies.
    h.hiddenTypes.length = 0;
    h.enhancer.refresh();
    expect(Object.keys(received(h).nodes)).toEqual(["a.md", "b.md"]);
  });
  it("applies the tag and structural filters too, from the same predicate", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [
        makeNode({ id: "a", tags: ["secret"] }),
        makeNode({ id: "b", isStructural: true }),
      ],
    );
    h.enhancer.start();
    h.hiddenTags.push("secret");
    h.hideStructural = true;
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "concept" } } };
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual([]);
  });
  it("switches the colour mode from the toolbar", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.colorByCommunity"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(h.mode).toBe("community");
  });

  it("fills the insights panel when the build finishes after attaching", () => {
    // Fake timers so the safety-net pass can be driven directly: it is the only
    // thing that notices the data arriving.
    vi.useFakeTimers();
    try {
      const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
      h.enhancer.start();

      const panel = h.renderer.containerEl.querySelector<HTMLElement>(
        ".enhanced-graph-official-panel",
      )!;
      expect(panel.querySelectorAll(".enhanced-graph-card").length).toBe(0);

      // The plugin finishes building while the graph is already on screen.
      // A minimal but structurally faithful insight, so the panel renders a card
      // rather than throwing on a missing field.
      h.insights = {
        connections: [
          {
            key: "a:::b",
            source: { id: "a", label: "A", type: "concept", community: 0 } as never,
            target: { id: "b", label: "B", type: "entity", community: 1 } as never,
            score: 9,
            weight: 4,
            reasons: ["cross-community"],
            contributions: { "cross-community": 4 },
          },
        ],
        gaps: [],
      };
      vi.advanceTimersByTime(SAFETY_NET_MS + 50);

      // Nothing else re-rendered the panel on that transition, so it used to
      // stay blank until the colour mode was switched.
      expect(panel.querySelectorAll(".enhanced-graph-card").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves the toolbar highlight to the mode that was just picked", async () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    h.renderer.changedCount = 0;
    const active = (label: string): boolean =>
      Boolean(buttonSaying(toolbarOf(h), label)?.classList.contains("is-active"));
    expect(active(t("toolbar.colorByType"))).toBe(true);
    expect(active(t("toolbar.colorByCommunity"))).toBe(false);

    const communityButton = buttonSaying(toolbarOf(h), t("toolbar.colorByCommunity"))!;
    // A real click leaves the button focused. Treating that like "the user is
    // editing" deferred the re-render that moves the highlight.
    communityButton.focus();
    communityButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(communityButton);
    await Promise.resolve();

    // The graph recoloured AND the button that says so moved: refresh() used to
    // re-render only the panel, leaving the highlight on the old mode.
    expect(active(t("toolbar.colorByCommunity"))).toBe(true);
    expect(active(t("toolbar.colorByType"))).toBe(false);
    // And it asked for a frame. Colours sit on `node.color`, which the render
    // loop only reads while it is running — without `changed()` the new colours
    // waited for an unrelated click to wake it.
    expect(h.renderer.changedCount).toBeGreaterThan(0);
  });

  it("has no no-matches line under the search box", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const input = toolbarOf(h).querySelector<HTMLInputElement>(".enhanced-graph-search input")!;
    input.value = "nothing matches this";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Removed from the shared toolbar, so both views are without it: the line
    // duplicates what an empty graph already shows, and over the canvas it landed
    // on top of the panel below.
    expect(toolbarOf(h).querySelector(".enhanced-graph-search-empty")).toBeNull();
  });
  it("leaves the search box alone while it has focus", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const bar = toolbarOf(h);
    const input = bar.querySelector<HTMLInputElement>(".enhanced-graph-search input")!;
    input.focus();
    input.value = "abc";
    h.enhancer.refresh();
    // Rebuilding would have thrown focus out on every keystroke.
    expect(bar.querySelector(".enhanced-graph-search input")).toBe(input);
  });
  it("opens the colours panel from the appearance toggle", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    expect(panel.querySelectorAll(".enhanced-graph-colour-row")).toHaveLength(0);

    buttonSaying(toolbarOf(h), t("toolbar.appearance"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(panel.querySelectorAll(".enhanced-graph-colour-row").length).toBeGreaterThan(0);
  });

  it("filters the built-in graph by the search box", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", label: "alpha" }), makeNode({ id: "b", label: "beta" })],
    );
    h.enhancer.start();
    const input = toolbarOf(h).querySelector<HTMLInputElement>(".enhanced-graph-search input");
    expect(input).toBeTruthy();
    input!.value = "alpha";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    // The search reaches the renderer through the same data filter the hidden
    // types use, so the node really leaves the graph.
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "concept" } } };
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual(["a.md"]);
  });
});
describe("the built-in graph's legend", () => {
  function pressToolbar(h: Harness, label: string): void {
    const bar = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-toolbar");
    const button = Array.from(bar?.querySelectorAll("button") ?? []).find((candidate) =>
      (candidate.textContent ?? "").includes(label),
    );
    if (!button) throw new Error(`no toolbar button saying ${label}`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function legendOf(h: Harness): HTMLElement {
    const legend = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-legend");
    if (!legend) throw new Error("legend not mounted");
    return legend;
  }

  it("explains the colours the mode is actually using", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a", type: "concept" })], "type");
    h.enhancer.start();
    expect(legendOf(h).textContent).toContain(t("type.concept"));
  });

  it("lists clusters instead once colouring is by community", async () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    pressToolbar(h, t("toolbar.colorByCommunity"));
    await Promise.resolve();
    // Legend and graph stay in step: no type rows while colouring by community.
    expect(legendOf(h).textContent).not.toContain(t("type.concept"));
  });

  it("is gone when colouring is off", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "off");
    h.enhancer.start();
    expect(legendOf(h).classList.contains("is-hidden")).toBe(true);
  });
});
/** The payload the built-in renderer was actually handed. */
function received(h: Harness): { nodes: Record<string, unknown> } {
  return h.renderer.lastData as { nodes: Record<string, unknown> };
}

function zeroSignals() {
  return { directLink: 0, sourceOverlap: 0, adamicAdar: 0, coCitation: 0,
  typeAffinity: 0, total: 0 };
}
