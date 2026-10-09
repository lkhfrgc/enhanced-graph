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

import { MARKER_RADIUS_PX, FOCUS_EDGE_DRAWN, GRAPH_MENU_SOURCE, SAFETY_NET_MS } from "../src/integrate/official-graph";
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
import {
  EMPTY_GRAPH,
  type CommunityInfo,
  type GraphNode,
  type PageType,
  type UnexpectedLink,
  type WikiGraph,
} from "../src/types";
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
  folders: readonly string[] = [],
): WikiGraph {
  return {
    nodes,
    edges,
    communities,
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
    folders,
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
  includedTags: string[] | null;
  tagFilterMode: "exclude" | "include";
  /** The applied workspace, and what the panel has asked to apply. */
  workingFolder: string;
  excludeFolders: string[];
  appliedWorkspaces: Array<{ folder: string; excluded: string[] }>;
  /** Knowledge clusters the user has excluded, by id. */
  hiddenCommunities: number[];
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
  /** Graph metadata the workspace group reads: the vault's folders, and what is applied. */
  workspace: { folders?: readonly string[]; workingFolder?: string; excludeFolders?: readonly string[] } = {},
): Harness {
  const renderer = new FakeOfficialRenderer(ids);
  const graph = makeGraph(
    graphNodes,
    [makeCommunity(0), makeCommunity(1)],
    [],
    workspace.folders ?? [],
  );
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
    includedTags: null,
    tagFilterMode: "exclude",
    workingFolder: workspace.workingFolder ?? "",
    excludeFolders: [...(workspace.excludeFolders ?? [])],
    appliedWorkspaces: [],
    hiddenCommunities: [],
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
    getWeights: () => state.weights,
    getVisibility: () => ({
      hiddenTypes: new Set(state.hiddenTypes as never[]),
      hiddenCommunities: new Set(state.hiddenCommunities),
      hiddenTags: new Set(state.hiddenTags),
      includedTags: state.includedTags === null ? null : new Set(state.includedTags),
      tagFilterMode: state.tagFilterMode,
      hideStructural: state.hideStructural,
      hideIsolated: state.hideIsolated,
    }),
    onSetVisibility: async (patch) => {
      Object.assign(state, patch);
      // `main.ts` awaits the settings write and then calls `refreshViews()`. The
      // delay is not decoration: a re-render requested while the click that
      // caused it is still in flight behaves differently from one that lands
      // afterwards, and a fixture that skips it hides exactly that.
      await Promise.resolve();
      state.enhancer.refresh();
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
    getTagFilterMode: () => state.tagFilterMode,
    getWorkspace: () => ({ folder: state.workingFolder, excluded: state.excludeFolders }),
    onApplyWorkspace: (folder, excluded) => {
      state.appliedWorkspaces.push({ folder, excluded: [...excluded] });
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
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenCommunities: new Set(),
        hiddenTags: new Set(),
        tagFilterMode: "exclude",
        includedTags: null,
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
      getTagFilterMode: () => "exclude" as const,
      getWorkspace: () => ({ folder: "", excluded: [] }),
      onApplyWorkspace: () => undefined,
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
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenCommunities: new Set(),
        hiddenTags: new Set(),
        tagFilterMode: "exclude",
        includedTags: null,
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
      getTagFilterMode: () => "exclude" as const,
      getWorkspace: () => ({ folder: "", excluded: [] }),
      onApplyWorkspace: () => undefined,
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
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenCommunities: new Set(),
        hiddenTags: new Set(),
        tagFilterMode: "exclude",
        includedTags: null,
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
      getTagFilterMode: () => "exclude" as const,
      getWorkspace: () => ({ folder: "", excluded: [] }),
      onApplyWorkspace: () => undefined,
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
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenCommunities: new Set(),
        hiddenTags: new Set(),
        tagFilterMode: "exclude",
        includedTags: null,
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
      getTagFilterMode: () => "exclude" as const,
      getWorkspace: () => ({ folder: "", excluded: [] }),
      onApplyWorkspace: () => undefined,
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
      getWeights: () => ({ directLink: 3, sourceOverlap: 4, commonNeighbor: 1.5, coCitation: 1 }),
      getVisibility: () => ({
        hiddenTypes: new Set(),
        hiddenCommunities: new Set(),
        hiddenTags: new Set(),
        tagFilterMode: "exclude",
        includedTags: null,
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
      getTagFilterMode: () => "exclude" as const,
      getWorkspace: () => ({ folder: "", excluded: [] }),
      onApplyWorkspace: () => undefined,
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
      // The marker is OURS: a fixed size pinned at the centre, derived from
      // nothing about the node. That is the whole point of the change — four
      // formulas for the node's drawn radius were each contradicted by what was
      // on screen, because the renderer does not expose it. A centre marker
      // never needed to know it.
      expect(points[0].radius).toBe(MARKER_RADIUS_PX);
      // The position, by contrast, MUST follow the zoom — that part was always
      // right and is what keeps the marker on the node.
      expect(points[0].x).not.toBe(0);
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

  it("lights a route whose links are stored on the far endpoint", async () => {
    const h = chain();
    h.enhancer.start();
    // `setData` puts a link on ONE endpoint and which one has nothing to do with
    // the order a route walks it. Here both are stored on the far side, so
    // looking only at `from.forward[to]` finds neither and the route stays dark.
    // The fixture could not express this before, which is why it went unnoticed.
    const aToX = { line: { alpha: 1 } };
    const xToB = { line: { alpha: 1 } };
    h.renderer.nodeLookup["x.md"].forward = { "a.md": aToX };
    h.renderer.nodeLookup["b.md"].forward = { "x.md": xToB };
    h.renderer.links = [aToX, xToB];

    // BOTH endpoints, so the route a -> x -> b is what is being lit. Focusing a
    // single node only lights that node's own edges, and asserting on the far
    // edge of the chain then fails for a reason that has nothing to do with
    // storage direction — which is what the first version of this test did.
    focusViaMenu(h, "concepts/a");
    focusViaMenu(h, "concepts/b");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const drawn = (written: number): number => written * 0.9 + 0.1;
    expect(drawn(aToX.line.alpha)).toBeCloseTo(1, 6);
    expect(drawn(xToB.line.alpha)).toBeCloseTo(1, 6);
  });

  it("lights every edge of a route that branches, not just the ones in order", async () => {
    // A diamond: a -> x -> b and a -> y -> b. The path search reports the nodes
    // on SOME route ordered by distance from `a`, so that list reads
    // [a, x, y, b] — and x is not connected to y. Pairing consecutive entries
    // therefore invents the edge x-y, drops a-y, and drops x-b: four real edges
    // become two lit plus one that does not exist.
    //
    // The single-chain fixture could not tell the two implementations apart,
    // because there the node order happens to equal the edge order. That is why
    // the bug survived a passing test suite.
    const h = setup(
      [{ id: "a.md" }, { id: "x.md" }, { id: "y.md" }, { id: "b.md" }],
      [makeNode({ id: "a" }), makeNode({ id: "x" }), makeNode({ id: "y" }), makeNode({ id: "b" })],
    );
    h.graph = makeGraph(
      [...h.graph.nodes],
      [...h.graph.communities],
      [makeEdge("a", "x"), makeEdge("x", "b"), makeEdge("a", "y"), makeEdge("y", "b")],
    );
    h.enhancer.start();

    const links = {
      ax: { line: { alpha: 1 } },
      xb: { line: { alpha: 1 } },
      ay: { line: { alpha: 1 } },
      yb: { line: { alpha: 1 } },
    };
    h.renderer.nodeLookup["a.md"].forward = { "x.md": links.ax, "y.md": links.ay };
    h.renderer.nodeLookup["x.md"].forward = { "b.md": links.xb };
    h.renderer.nodeLookup["y.md"].forward = { "b.md": links.yb };
    h.renderer.links = Object.values(links);

    focusViaMenu(h, "concepts/a");
    focusViaMenu(h, "concepts/b");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const drawn = (written: number): number => written * 0.9 + 0.1;
    for (const [name, link] of Object.entries(links)) {
      expect(drawn(link.line.alpha), name).toBeCloseTo(1, 6);
    }
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

  /**
   * The reported bug: switching the theme left the built-in graph's edges the
   * wrong ink — near-white on a white page, near-black on a black one — until the
   * graph was closed and reopened.
   *
   * Switching the theme makes the built-in graph rewrite its own shared edge
   * colours. The plugin used to write a copy it had taken at attach time back over
   * them on the very next refresh, undoing the theme. Nothing but a refresh in
   * between is needed to reproduce it, so this drives exactly that.
   */
  it("does not put its own copy back over the theme's line colour after a theme switch", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();
    const atAttach = h.renderer.colors.line.rgb;

    // The theme switch: the built-in graph repaints its own colours.
    h.renderer.colors.line.rgb = 0x0a141c;
    h.renderer.colors.lineHighlight.rgb = 0x0a141c;
    h.enhancer.refresh();

    expect(h.renderer.colors.line.rgb).toBe(0x0a141c);
    expect(h.renderer.colors.lineHighlight.rgb).toBe(0x0a141c);
    expect(h.renderer.colors.line.rgb).not.toBe(atAttach);
  });

  it("clears a chosen line colour back to the theme in force at the time", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })]);
    h.enhancer.start();

    // The theme moves to the light one while nothing is chosen...
    h.renderer.colors.line.rgb = 0xf4f8fa;
    h.enhancer.refresh();

    // ...then a colour is chosen, and cleared again.
    h.lineColor = "#123456";
    h.enhancer.refresh();
    expect(h.renderer.colors.line.rgb).toBe(hexToRgbInt("#123456"));

    h.lineColor = null;
    h.enhancer.refresh();
    // The light theme's ink, not the one captured when the plugin attached.
    expect(h.renderer.colors.line.rgb).toBe(0xf4f8fa);
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

  it("marks the line colour as the theme's own until one is chosen", () => {
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "type");
    h.enhancer.start();
    const panel = panelOf(h);
    openPanel(h, t("toolbar.appearance"));
    // The line row is the last one: the type rows come first.
    const themeButton = (): Element | null => {
      const rows = panel.querySelectorAll(".enhanced-graph-colour-row");
      return rows[rows.length - 1]?.querySelector(".enhanced-graph-link") ?? null;
    };
    const following = (): boolean => themeButton()?.classList.contains("is-active") ?? false;

    // Nothing chosen: the built-in graph's own theme colour is in charge, and the
    // panel says so rather than showing a colour as if it had been picked.
    expect(following()).toBe(true);

    h.lineColor = "#123456";
    h.enhancer.refresh();
    expect(following()).toBe(false);
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
    expect(buttonSaying(bar, t("toolbar.filter"))).toBeTruthy();

    // And nothing that does not belong here. Weights are tuned in the settings tab
    // and in the standalone view, and the built-in graph keeps itself in step with
    // the vault — so neither a weights toggle nor a rebuild button is offered.
    expect(buttonSaying(bar, t("toolbar.weights"))).toBeUndefined();
    expect(bar.querySelector(`[aria-label="${t("toolbar.rebuild")}"]`)).toBeNull();
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

  /**
   * The reported bug, second time around: 全部恢复 restored most tags and left a
   * few unchecked, and a second click finished the job.
   *
   * The first fix for this was written from reasoning, because nothing in the
   * suite could reproduce it — five attempts, all passing with the bug present.
   * What every one of them was missing is focus. A real click on a checkbox
   * leaves it focused, `isEditingWithin` counts an INPUT as an interaction, and
   * so the panel's re-render is deferred for as long as the user keeps working
   * inside it. The filters body is then the only record of what the user has
   * done, and everything it captured at render time is stale:
   *
   *   - each toggle rebuilt the whole set from the render-time copy, so three
   *     unchecks in a row left only the last tag in the settings;
   *   - the restore button's "is anything hidden?" test read the same copy, and
   *     the copy said "nothing" while three boxes sat unticked on screen.
   *
   * The click itself is the second half. Flushing the deferred re-render on
   * `focusout` happens while the button is held down, and rebuilding the panel
   * then destroys the button mid-click: measured in Chromium, a 120ms press
   * dispatches no `click` at all, which is why the gesture had to be repeated.
   */
  it("hides several tags in a row without losing any, and restores them in one click", async () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }, { id: "c.md" }, { id: "d.md" }],
      [
        makeNode({ id: "a", tags: ["alpha"] }),
        makeNode({ id: "b", tags: ["beta"] }),
        makeNode({ id: "c", tags: ["gamma"] }),
        makeNode({ id: "d", tags: ["delta"] }),
      ],
    );
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.filter"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    // The groups switch like tabs, so the tags are behind their own button.
    selectTab(panel, t("filter.tags"));

    // Re-queried every time: the panel replaces its body whenever it re-renders,
    // so a list captured once goes stale exactly when it matters.
    const tagBoxes = (): HTMLInputElement[] =>
      Array.from(panel.querySelectorAll<HTMLInputElement>(".enhanced-graph-tag-list input[type=checkbox]"));
    const boxFor = (tag: string): HTMLInputElement => {
      const box = tagBoxes().find((candidate) => candidate.closest("label")?.textContent?.includes(tag));
      if (!box) throw new Error(`no tag row for ${tag}`);
      return box;
    };
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    /**
     * Presses a control the way a person and Chromium do.
     *
     * `mousedown` (which is also what focuses the button), a held press, the
     * release, and only then the click — and, the rule this bug turned on, an
     * element that is gone by the end of the press receives NO `click` at all.
     * Both halves are measured in Edge rather than assumed: a 120ms press whose
     * button was rebuilt on mousedown reached nothing, and so did a rebuild on
     * mouseup or 0ms after it, because the click arrives in a later task than the
     * release. jsdom has no such rule — it dispatches at a detached node happily
     * — so it is written out here. `scripts/verify-click-during-rebuild.mjs`
     * holds the measurements; `scripts/verify-official-filters.mjs` presses the
     * real panel in a real browser.
     */
    const press = async (control: HTMLElement): Promise<void> => {
      control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      control.focus();
      await settle();
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await settle();
      if (!control.isConnected) return;
      control.click();
      await settle();
      await settle();
    };

    // Three ticks in a row, each focusing its box the way a real click does.
    // The settings write and the deferred re-render follow inside the fixture.
    for (const tag of ["alpha", "beta", "gamma"]) {
      const box = boxFor(tag);
      box.focus();
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    }
    // The premise of the test: the panel has NOT been rebuilt under the user.
    expect(document.activeElement).toBe(boxFor("gamma"));
    expect([...h.hiddenTags].sort()).toEqual(["alpha", "beta", "gamma"]);

    // One press of 全清. It has to land, and it has to be enough.
    const restore = Array.from(panel.querySelectorAll("button")).find((candidate) =>
      (candidate.textContent ?? "").includes(t("filter.clearTags")),
    );
    expect(restore).toBeTruthy();
    await press(restore!);

    expect(h.hiddenTags).toEqual([]);
    expect(tagBoxes().filter((box) => box.checked)).toHaveLength(0);
  });

  it("ticks every listed tag with 全选, and gives each mode its own default selection", async () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }, { id: "c.md" }],
      [
        makeNode({ id: "a", tags: ["alpha"] }),
        makeNode({ id: "b", tags: ["beta"] }),
        makeNode({ id: "c", tags: ["gamma"] }),
      ],
    );
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.filter"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    selectTab(panel, t("filter.tags"));
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const panelButton = (label: string): HTMLButtonElement =>
      Array.from(panel.querySelectorAll("button")).find((candidate) =>
        (candidate.textContent ?? "").includes(label),
      )!;

    // 全选 ticks everything the list is showing, in one go.
    panelButton(t("filter.selectAllTags")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect([...h.hiddenTags].sort()).toEqual(["alpha", "beta", "gamma"]);

    // Each mode owns its own selection, so switching back and forth never rewrites
    // the other one. Include mode opens fully ticked the first time it is entered —
    // everything kept — and the exclude ticks are exactly as they were left.
    panelButton(t("filter.tagModeInclude")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(h.tagFilterMode).toBe("include");
    expect([...h.includedTags!].sort()).toEqual(["alpha", "beta", "gamma"]);
    expect([...h.hiddenTags].sort()).toEqual(["alpha", "beta", "gamma"]);

    // Clearing the ticks while including means keep NOTHING — an empty selection is
    // a choice, not the absence of one.
    panelButton(t("filter.clearTags")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(h.includedTags).toEqual([]);
    expect([...h.hiddenTags].sort()).toEqual(["alpha", "beta", "gamma"]);

    panelButton(t("filter.tagModeExclude")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(h.tagFilterMode).toBe("exclude");
    expect([...h.hiddenTags].sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("stages a workspace and applies it only on the button", async () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }, { id: "c.md" }],
      [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })],
      "community",
      // The folder list the builder reports: every folder holding a note, plus its
      // ancestors — collected before the scope narrowed anything.
      { folders: ["notes", "notes/deep", "archive"] },
    );
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.filter"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    selectTab(panel, t("filter.workspace"));
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    const picker = (): HTMLSelectElement =>
      panel.querySelector<HTMLSelectElement>(".enhanced-graph-folder-select")!;
    const excludedRows = (): HTMLLabelElement[] =>
      Array.from(panel.querySelectorAll<HTMLLabelElement>(".enhanced-graph-workspace-excluded label"));
    const applyButton = (): HTMLButtonElement =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === t("filter.workspaceApply"),
      )!;

    // Every folder is offered, with the whole vault first, and nothing is staged
    // yet — so Apply has nothing to do.
    expect(Array.from(picker().options).map((option) => option.value)).toEqual([
      "",
      "notes",
      "notes/deep",
      "archive",
    ]);
    expect(picker().value).toBe("");
    expect(excludedRows().map((row) => row.textContent)).toEqual(["notes/", "notes/deep/", "archive/"]);
    expect(applyButton().disabled).toBe(true);

    // Choosing and ticking only stages: the host is told nothing, and the graph is
    // asked for no rebuild, until the button is pressed.
    picker().value = "notes";
    picker().dispatchEvent(new Event("change", { bubbles: true }));
    const deepRow = excludedRows().find((row) => row.textContent === "notes/deep/")!;
    const deepBox = deepRow.querySelector<HTMLInputElement>("input")!;
    deepBox.checked = true;
    deepBox.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(h.appliedWorkspaces).toEqual([]);
    expect(applyButton().disabled).toBe(false);

    applyButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    // One write, carrying both halves: the folder to read and the folders to leave
    // out of it. Excluded prefixes are written in the form the builder reads.
    expect(h.appliedWorkspaces).toEqual([{ folder: "notes", excluded: ["notes/deep/"] }]);
  });

  it("keeps an excluded prefix that is not a folder in the vault", async () => {
    // A prefix can be hand-written into a settings file, or name a folder that has
    // since gone. Applying must not silently drop it.
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" })], "community", {
      folders: ["notes"],
      excludeFolders: ["gone/"],
    });
    h.enhancer.start();
    buttonSaying(toolbarOf(h), t("toolbar.filter"))?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    selectTab(panel, t("filter.workspace"));

    const rows = Array.from(
      panel.querySelectorAll<HTMLLabelElement>(".enhanced-graph-workspace-excluded label"),
    );
    expect(rows.map((row) => row.textContent)).toEqual(["notes/", "gone/"]);
    expect(rows[1].querySelector<HTMLInputElement>("input")!.checked).toBe(true);

    // Staging something else and applying keeps it.
    const picker = panel.querySelector<HTMLSelectElement>(".enhanced-graph-folder-select")!;
    picker.value = "notes";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    const apply = Array.from(panel.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === t("filter.workspaceApply"),
    )!;
    apply.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.appliedWorkspaces).toEqual([{ folder: "notes", excluded: ["gone/"] }]);
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

  /**
   * A connection card focuses BOTH of its ends, in the plugin's own sense of
   * "focused" — the state the context menu's 「聚焦邻居」 produces: the notes are
   * ringed, the route between them is lit, the rest is dimmed, and a focused PAIR
   * offers the connection-range control.
   *
   * The built-in renderer's own highlight (`renderer.highlightNode`) holds exactly
   * one node, so that path could never mark more than the first end. The focus is
   * a set, and it is what the rest of the plugin already means by a focused pair.
   */
  it("focuses both ends of a connection when its card is clicked", async () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = setup(
        [{ id: "a.md" }, { id: "b.md" }, { id: "far.md" }],
        [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "far" })],
      );
      h.graph = makeGraph([...h.graph.nodes], [...h.graph.communities], [makeEdge("a", "b")]);
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
      h.enhancer.start();

      const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
      const alphaOf = (id: string): number | undefined => h.renderer.nodeLookup[`${id}.md`]?.color?.a;
      const cardOf = (): HTMLElement => {
        const card = panel.querySelector<HTMLElement>(".enhanced-graph-card");
        if (!card) throw new Error("no insight card was rendered");
        return card;
      };
      /** Ringed notes, as the focus ticker actually draws them. */
      const rings = (): number => {
        const calls = draw.mock.calls;
        return (calls[calls.length - 1]?.[0] ?? []).length;
      };
      const hopChoices = (): number => panel.querySelectorAll(".enhanced-graph-hop-button").length;
      const settle = (): Promise<void> =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

      expect(hopChoices()).toBe(0);

      cardOf().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();

      // Both ends bright, everything else dimmed...
      expect(alphaOf("a")).toBe(1);
      expect(alphaOf("b")).toBe(1);
      expect(alphaOf("far")).toBeLessThan(1);
      // ...both of them ringed, which is what "focused" looks like...
      expect(rings()).toBe(2);
      // ...and a focused pair, so the route control is offered exactly as it is
      // after two notes are focused from the context menu.
      expect(hopChoices()).toBeGreaterThan(0);

      // Clicking the active card again is the unfocus gesture.
      cardOf().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();
      expect(alphaOf("far")).toBe(1);
      expect(hopChoices()).toBe(0);
    } finally {
      draw.mockRestore();
    }
  });

  it("replaces the focus when another card is clicked", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }, { id: "c.md" }, { id: "d.md" }],
      [makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" }), makeNode({ id: "d" })],
    );
    h.graph = makeGraph(
      [...h.graph.nodes],
      [...h.graph.communities],
      [makeEdge("a", "b"), makeEdge("c", "d")],
    );
    const connection = (source: string, target: string): UnexpectedLink => ({
      key: `${source}:::${target}`,
      source: { id: source, label: source, type: "concept", community: 0 } as never,
      target: { id: target, label: target, type: "entity", community: 1 } as never,
      score: 9,
      weight: 4,
      reasons: ["cross-community"],
      contributions: { "cross-community": 4 },
    });
    h.insights = { connections: [connection("a", "b"), connection("c", "d")], gaps: [] };
    h.enhancer.start();

    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    const alphaOf = (id: string): number | undefined => h.renderer.nodeLookup[`${id}.md`]?.color?.a;
    // Re-queried every time: the panel replaces its body whenever it re-renders.
    const cards = (): HTMLElement[] => Array.from(panel.querySelectorAll<HTMLElement>(".enhanced-graph-card"));
    const click = (index: number): void => {
      cards()[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };

    expect(cards()).toHaveLength(2);
    click(0);
    expect(alphaOf("a")).toBe(1);
    expect(alphaOf("b")).toBe(1);
    expect(alphaOf("c")).toBeLessThan(1);

    // The second card is what the user is looking at now — the same "one card at
    // a time" the panel already shows by marking only the last card active. The
    // first card's connection must not stay lit behind it, and the anchors must
    // not pile up (the focus runs a route search for every PAIR of them).
    click(1);
    expect(alphaOf("c")).toBe(1);
    expect(alphaOf("d")).toBe(1);
    expect(alphaOf("a")).toBeLessThan(1);
    expect(alphaOf("b")).toBeLessThan(1);
  });

  it("says nothing when a card names a note the built-in graph is not drawing", () => {
    // The renderer holds `a.md` only, while the card names both ends — the shape
    // of a card whose other end a filter has hidden. The focus reports a failure
    // with a Notice, which is right when the USER asked for that note from the
    // context menu; a card click must not pop one at them for a note the graph is
    // not drawing.
    const h = setup([{ id: "a.md" }], [makeNode({ id: "a" }), makeNode({ id: "b" })]);
    h.graph = makeGraph([...h.graph.nodes], [...h.graph.communities], [makeEdge("a", "b")]);
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
    h.enhancer.start();

    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    const card = panel.querySelector<HTMLElement>(".enhanced-graph-card");
    expect(card).toBeTruthy();
    errorSpy.mockClear();
    card!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The end that IS drawn is still focused...
    expect(h.renderer.nodeLookup["a.md"]?.color?.a).toBe(1);
    // ...and nothing was reported. `reportFocusFailure` also builds a Notice, and
    // this file mocks `obsidian` down to `setIcon`, so reaching it throws — which
    // is why the console is checked rather than the popup.
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("focusing a built-in graph node failed");
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
  it("switches the insights groups by tab in the built-in panel", () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a" }), makeNode({ id: "b" })],
    );
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
      gaps: [
        {
          key: "gap:isolated:2 个孤立页面:a,b",
          type: "isolated",
          title: "2 个孤立页面",
          description: "A、B",
          suggestion: "补充链接。",
          nodeIds: ["a", "b"],
        },
      ],
    };
    h.enhancer.start();
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    const cardCount = (): number => panel.querySelectorAll(".enhanced-graph-card").length;

    // Opens on the connections, and only that group's card is drawn.
    expect(panel.querySelector('[data-section="connections"]')).not.toBeNull();
    expect(panel.querySelector('[data-section="gaps"]')).toBeNull();
    expect(cardCount()).toBe(1);

    selectTab(panel, t("insights.gaps"));
    expect(panel.querySelector('[data-section="gaps"]')).not.toBeNull();
    expect(panel.querySelector('[data-section="connections"]')).toBeNull();
    expect(cardCount()).toBe(1);
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

  it("marks the pages matching the search box instead of filtering the graph", () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = setup(
        [{ id: "a.md" }, { id: "b.md" }],
        [makeNode({ id: "a", label: "alpha" }), makeNode({ id: "b", label: "beta" })],
      );
      h.enhancer.start();
      const input = toolbarOf(h).querySelector<HTMLInputElement>(".enhanced-graph-search input");
      expect(input).toBeTruthy();
      input!.value = "alpha";
      input!.dispatchEvent(new Event("input", { bubbles: true }));

      // The graph keeps every node. Searching says where things are; removing
      // everything else would answer a different question.
      const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "concept" } } };
      h.renderer.setData(payload);
      expect(Object.keys(received(h).nodes).sort()).toEqual(["a.md", "b.md"]);

      // And the match is marked, at the same transform the focus marker uses.
      const calls = draw.mock.calls;
      const points = calls[calls.length - 1]?.[0] ?? [];
      const dpr = window.devicePixelRatio || 1;
      expect(points).toHaveLength(1);
      expect(points[0].x).toBeCloseTo((10 * 2 + 100) / dpr, 6);
      expect(points[0].y).toBeCloseTo((20 * 2 + 50) / dpr, 6);
    } finally {
      draw.mockRestore();
    }
  });

  it("keeps the search marks on their nodes when the canvas moves", async () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = setup(
        [{ id: "a.md" }, { id: "b.md" }],
        [makeNode({ id: "a", label: "alpha" }), makeNode({ id: "b", label: "beta" })],
      );
      h.enhancer.start();
      const input = toolbarOf(h).querySelector<HTMLInputElement>(".enhanced-graph-search input");
      input!.value = "alpha";
      input!.dispatchEvent(new Event("input", { bubbles: true }));

      const dpr = window.devicePixelRatio || 1;
      const lastPoint = (): { x: number; y: number } => {
        const calls = draw.mock.calls;
        return (calls[calls.length - 1]?.[0] ?? [])[0];
      };
      expect(lastPoint().x).toBeCloseTo((10 * 2 + 100) / dpr, 6);

      // The user pans the canvas. Nothing else changes: no focus is set, and the
      // query is untouched. The marks are drawn in SCREEN space, so a redraw is
      // the only thing that can keep them on their nodes.
      h.renderer.panX = 220;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      expect(lastPoint().x).toBeCloseTo((10 * 2 + 220) / dpr, 6);
    } finally {
      draw.mockRestore();
    }
  });

  it("stops marking once the search box is cleared", () => {
    const draw = vi.spyOn(OfficialMarkerLayer.prototype, "draw").mockImplementation(() => {});
    try {
      const h = setup(
        [{ id: "a.md" }, { id: "b.md" }],
        [makeNode({ id: "a", label: "alpha" }), makeNode({ id: "b", label: "beta" })],
      );
      h.enhancer.start();
      const input = toolbarOf(h).querySelector<HTMLInputElement>(".enhanced-graph-search input");
      input!.value = "alpha";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      expect((draw.mock.calls[draw.mock.calls.length - 1]?.[0] ?? []).length).toBe(1);

      input!.value = "";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      expect((draw.mock.calls[draw.mock.calls.length - 1]?.[0] ?? []).length).toBe(0);
    } finally {
      draw.mockRestore();
    }
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

  it("excludes a knowledge cluster from the filters panel, and restores it there", async () => {
    const h = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", community: 0 }), makeNode({ id: "b", community: 1 })],
      "community",
    );
    h.enhancer.start();
    const payload = { nodes: { "a.md": { type: "concept" }, "b.md": { type: "concept" } } };
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual(["a.md", "b.md"]);

    pressToolbar(h, t("toolbar.filter"));
    const panel = h.renderer.containerEl.querySelector<HTMLElement>(".enhanced-graph-official-panel")!;
    selectTab(panel, t("filter.clusters"));
    const clusterSection = (): HTMLElement => {
      const section = panel.querySelector<HTMLElement>('[data-section="clusters"]');
      if (!section) throw new Error("no cluster group in the panel");
      return section;
    };
    const clusterBoxes = (): HTMLInputElement[] =>
      Array.from(clusterSection().querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
    const showAllOf = (): HTMLButtonElement => {
      const button = Array.from(clusterSection().querySelectorAll("button")).find((candidate) =>
        (candidate.textContent ?? "").includes(t("legend.showAll")),
      );
      if (!button) throw new Error("no show-all button");
      return button;
    };
    // The settings write is awaited before the views are re-rendered, exactly as
    // `main.ts` does it, so a switch is followed by a tick rather than a repaint.
    const settle = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    };

    // One row per cluster, all of them on, and the button that clears them sits
    // there from the start — inert until there is something to undo.
    expect(clusterBoxes()).toHaveLength(h.graph.communities.length);
    expect(clusterBoxes().every((box) => box.checked)).toBe(true);
    expect(showAllOf().disabled).toBe(true);

    // Unticking the first cluster takes every member of it off the graph, and the
    // panel is where that happens — the legend's cards are not controls.
    clusterBoxes()[0].checked = false;
    clusterBoxes()[0].dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(h.hiddenCommunities).toEqual([0]);
    // The button wakes up immediately, without waiting for a repaint: the panel is
    // not redrawn while its own checkbox has focus.
    expect(showAllOf().disabled).toBe(false);
    h.enhancer.refresh();
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual(["b.md"]);

    // And "show all" puts it back.
    showAllOf().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(h.hiddenCommunities).toEqual([]);
    expect(showAllOf().disabled).toBe(true);
    h.renderer.setData(payload);
    expect(Object.keys(received(h).nodes)).toEqual(["a.md", "b.md"]);
  });

  /**
   * The cards say what the colours and clusters mean, and they are also controls:
   * a click excludes or restores that type or cluster, and the header's "show all"
   * puts the group back. They write the same shared visibility the filters panel
   * does, so the two can never disagree about what is on screen.
   */
  it("excludes and restores a cluster by clicking its card in the built-in graph", async () => {
    const community = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", community: 0 }), makeNode({ id: "b", community: 1 })],
      "community",
    );
    community.enhancer.start();
    const rows = (): HTMLElement[] =>
      Array.from(legendOf(community).querySelectorAll<HTMLElement>(".enhanced-graph-legend-row"));
    expect(rows()).toHaveLength(2);
    expect(rows()[0].classList.contains("is-interactive")).toBe(true);

    // The row stays in place, shaded, so it can be clicked straight back.
    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(community.hiddenCommunities).toEqual([0]);
    expect(rows()[0].classList.contains("is-hidden-cluster")).toBe(true);

    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(community.hiddenCommunities).toEqual([]);

    // "Show all" is always there, and disabled while there is nothing to restore.
    const showAll = (): HTMLButtonElement =>
      legendOf(community).querySelector<HTMLButtonElement>("button")!;
    expect(showAll().disabled).toBe(true);
    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showAll().disabled).toBe(false);
    showAll().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(community.hiddenCommunities).toEqual([]);
  });

  it("excludes and restores a page type by clicking its card in the built-in graph", async () => {
    const types = setup(
      [{ id: "a.md" }, { id: "b.md" }],
      [makeNode({ id: "a", type: "concept" }), makeNode({ id: "b", type: "entity" })],
      "type",
    );
    types.enhancer.start();
    const rowFor = (label: string): HTMLElement =>
      Array.from(legendOf(types).querySelectorAll<HTMLElement>(".enhanced-graph-legend-row")).find(
        (row) => row.textContent?.includes(label),
      )!;

    rowFor(t("type.concept")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(types.hiddenTypes).toEqual(["concept"]);

    rowFor(t("type.concept")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(types.hiddenTypes).toEqual([]);
  });
});
/** The payload the built-in renderer was actually handed. */
function received(h: Harness): { nodes: Record<string, unknown> } {
  return h.renderer.lastData as { nodes: Record<string, unknown> };
}

/**
 * Clicks the panel tab whose label contains `label`.
 *
 * The filter and insight groups switch like tabs, so a control that used to sit
 * under a heading of its own now needs its button pressed first.
 */
function selectTab(panel: HTMLElement, label: string): void {
  const tab = Array.from(
    panel.querySelectorAll<HTMLButtonElement>(".enhanced-graph-panel-tabs button"),
  ).find((candidate) => (candidate.textContent ?? "").includes(label));
  if (!tab) throw new Error(`no panel tab saying ${label}`);
  tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function zeroSignals() {
  return { directLink: 0, sourceOverlap: 0, adamicAdar: 0, coCitation: 0,
  typeAffinity: 0, total: 0 };
}
