/**
 * Browser harness entry point.
 *
 * Mounts the *real* `EnhancedGraphView` — no test doubles for the view, the
 * renderer, the palette or the layout — against a snapshot produced by
 * `scripts/verify-vault.ts`, with `obsidian` aliased to a stub.
 *
 * The goal is to verify the parts a Node test cannot reach: that sigma mounts,
 * that the reducers colour and dim correctly, that the legend/insights DOM
 * renders, and that hovering shows the association score.
 */

import "./dom-polyfill";
import { TFile, WorkspaceLeaf } from "obsidian";
import { EnhancedGraphView } from "../src/view/graph-view";
import { captureOfficialLayout } from "../src/integrate/official-layout";
import { DEFAULT_RELEVANCE_WEIGHTS, type ColorMode, type WikiGraph } from "../src/types";
import type { GraphInsights } from "../src/core/insights";
import { analyzeGraph } from "../src/core/insights";
import type { EnhancedGraphSettings } from "../src/settings-model";

// `main.ts` is only referenced by the view through a type-only import, so the
// harness never pulls the Obsidian plugin lifecycle in.
interface Snapshot {
  generatedAt: string;
  vaultRoot: string;
  graph: WikiGraph;
  insights: GraphInsights;
}

const NOTICES: string[] = [];
(window as unknown as { __NOTICES__: string[] }).__NOTICES__ = NOTICES;

const raw = (await fetch("./graph.json").then((response) => response.json())) as Snapshot & {
  graph: { nodeIndex: Record<string, unknown> };
};

// `WikiGraph.nodeIndex` is a Map in the engine but JSON has no Map type, so it
// arrives as a plain object — rebuild it rather than shipping a graph whose
// lookups would throw.
const snapshot: Snapshot = {
  ...raw,
  graph: {
    ...raw.graph,
    nodeIndex: new Map(Object.entries(raw.graph.nodeIndex ?? {})),
    // A snapshot written before the folder list existed has no `folders`, and the
    // workspace picker iterates it. `verify:vault` regenerates the file, so this
    // only covers a harness run against a stale one.
    folders: raw.graph.folders ?? [],
  } as WikiGraph,
};

/**
 * The insights are analysed here rather than read from the snapshot.
 *
 * The snapshot's saved `insights` predates the finding model, so a panel reading it
 * would render nothing and every card assertion in `harness-check.mjs` would pass
 * vacuously against an empty panel. Analysing the loaded graph keeps the bundle
 * structurally identical to the one the plugin produces, and it cannot go stale
 * when the analysis changes — only the graph has to be regenerated.
 */
const insights: GraphInsights = analyzeGraph(snapshot.graph);
snapshot.insights = insights;

/**
 * A settings object shaped like the plugin's.
 *
 * MUST stay in step with `src/settings-model.ts`. A key that is missing here
 * arrives at the renderer as `undefined` and silently poisons whatever it feeds
 * — a missing `edgeWidthScale` made every edge render at the same width, which
 * looked like a rendering bug rather than a fixture gap.
 */
const settings: EnhancedGraphSettings = {
  language: "zh" as const,
  weights: { ...DEFAULT_RELEVANCE_WEIGHTS },
  excludeFolders: [] as string[],
  resolution: 1,
  workingFolder: "",
  hiddenTypes: [] as string[],
  hiddenCommunities: [] as number[],
  hiddenTags: [] as string[],
  includedTags: null,
  tagFilterMode: "exclude" as const,
  hideIsolated: false,
  hideStructural: true,
  showLabels: true,
  colorMode: "type" as ColorMode,
  nodeScale: 1,
  gravity: 1,
  edgeWeakColor: null as string | null,
  edgeStrongColor: null as string | null,
  edgeWeakWidth: 0.5,
  edgeStrongWidth: 4,
  customNodeColor: "#60a5fa",
  autoHideLabels: true,
  labelSize: 12,
  labelOpacity: 1,
  focusMaxIntermediates: 0,
  typeColorOverrides: {} as Record<string, string>,
  typeColorAssignments: {} as Record<string, string>,
  communityColorOverrides: {} as Record<string, string>,
  // The standalone harness drives the view, not the built-in graph enhancement.
  officialGraphEnabled: false,
  officialGraphColorMode: "community" as const,
  officialLineColor: null,
  // Off by default so the existing checks exercise the ForceAtlas2 path; the
  // layout-reuse check flips this on and installs a fake built-in graph.
  reuseOfficialLayout: false,
  positions: {} as Record<string, { x: number; y: number }>,
  dismissedInsights: [] as string[],
};

/** Rebuilds the fake plugin was asked for; the workspace check reads it. */
let rebuilds = 0;

/**
 * A markdown file for the stubbed vault.
 *
 * Built the way Obsidian's own type demands — its `TFile` constructor takes no
 * arguments, and the vault supplies the path — rather than the stub's one-argument
 * shortcut, so the harness type-checks against the real API.
 */
function makeFile(path: string): TFile {
  const file = new TFile();
  (file as { path: string }).path = path;
  return file;
}

const app = {
  vault: {
    getAbstractFileByPath: (path: string) => (path.endsWith(".md") ? makeFile(path) : null),
    getMarkdownFiles: () => [] as TFile[],
  },
  workspace: {
    getLeaf: () => ({ openFile: async () => undefined }),
    // Empty until the layout-reuse check installs a fake built-in graph.
    getLeavesOfType: (type: string): unknown[] => fakeOfficialLeaves[type] ?? [],
  },
};

/**
 * Stand-in for the built-in graph's renderer. `nodeLookup` is keyed by vault
 * path with the extension, exactly like Obsidian's, so the id mapping under
 * test is the real one.
 */
const fakeOfficialLeaves: Record<string, unknown[]> = {};

function resetFakeOfficialGraph(): void {
  delete fakeOfficialLeaves.graph;
  delete fakeOfficialLeaves.localgraph;
}

const plugin = {
  settings,
  app,
  async saveSettings() {
    /* harness: settings are in-memory */
  },
  async getGraph() {
    return { graph: snapshot.graph, insights: snapshot.insights };
  },
  async copyRelevanceReport() {
    NOTICES.push("copied");
  },
  /** Counted so a check can tell an applied workspace from a staged one. */
  requestGraphRebuild() {
    rebuilds += 1;
  },
  refreshViews() {},
  /**
   * Mirrors what the plugin injects: the real provider reads Obsidian's
   * built-in graph, gated on the user's preference. Without this the view has
   * no external layout to adopt and always falls back to ForceAtlas2 — which is
   * exactly how the layout-reuse checks would silently stop testing anything.
   */
  layoutSource: {
    capture: (nodeIds: readonly string[]) => {
      if (!settings.reuseOfficialLayout) return null;
      const snapshot = captureOfficialLayout(app as never, nodeIds);
      if (!snapshot) return null;
      return {
        positions: snapshot.positions,
        source: snapshot.viewType,
        coverage: snapshot.coverage,
      };
    },
  },
};

const leaf = new WorkspaceLeaf();
const view = new EnhancedGraphView(leaf as never, plugin as never);
(view as unknown as { app: unknown }).app = app;

const host = document.getElementById("app");
if (!host) throw new Error("missing #app");
host.appendChild(view.containerEl);

await view.onOpen();
// One extra frame so sigma's first render has definitely committed.
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

interface HarnessApi {
  view: EnhancedGraphView;
  settings: typeof settings;
  snapshot: Snapshot;
  /** Screen position of a node relative to the sigma container. */
  nodePosition(nodeId: string): { x: number; y: number; clientX: number; clientY: number } | null;
  /** The edge with the highest association score, for tooltip assertions. */
  strongestEdge(): { source: string; target: string; weight: number } | null;
  notices: string[];
  setTheme(theme: "dark" | "light"): void;
  /** Install a fake built-in graph carrying a deliberately synthetic layout. */
  installFakeOfficialGraph(viewType?: string): Record<string, { x: number; y: number }>;
  resetFakeOfficialGraph(): void;
  setReuseOfficialLayout(value: boolean): void;
  /** Current coordinates of every node in the sigma graph, by our node id. */
  sigmaPositions(): Record<string, { x: number; y: number }>;
  layoutSource(): string | null;
  /** Node ids the view has focused, in the order they were focused. */
  focusedNodeIds(): string[];
  /** Node ids the renderer is emphasising. */
  highlightedNodes(): string[];
  /** Canonical edge keys (`a:::b`) the renderer is emphasising. */
  highlightedEdges(): string[];
  /**
   * Clear the focus by emitting sigma's `clickStage`, as a real click on empty
   * canvas does. Convenience for checks that only need the state reset; the
   * focus checks themselves drive the real pointer.
   */
  clickStage(): void;
  /** Node ids the view currently draws (after type/tag/structural filters). */
  visibleNodeIds(): string[];
  /** Node ids the legend's right-click dotted on the graph. */
  markedNodeIds(): string[];
  /** The node sigma's hit test currently reports under the pointer. */
  hoveredNode(): string | null;
  /**
   * Drive the same focus path the node context menu calls.
   *
   * Exists because some nodes cannot be aimed at with a real pointer in this
   * environment (they are visible but never appear in the picking buffer), and
   * the behaviour under test is the focus state machine, not the harness's
   * ability to hit a three-pixel node in a dense cluster.
   */
  focusNode(nodeId: string): void;
  /** Sigma's own hit test at a container-relative point; see the implementation. */
  hitTest(x: number, y: number): string | null;
  /** How many times the view has asked for a rebuild. */
  rebuilds(): number;
}

const api: HarnessApi = {
  view,
  settings,
  snapshot,
  notices: NOTICES,
  rebuilds: () => rebuilds,
  nodePosition(nodeId: string) {
    const renderer = (view as unknown as {
      renderer: { nodeViewportPosition(id: string): { x: number; y: number } | null } | null;
    }).renderer;
    const position = renderer?.nodeViewportPosition(nodeId) ?? null;
    if (!position) return null;
    const canvas = document.querySelector<HTMLElement>(".enhanced-graph-canvas");
    const bounds = canvas?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      ...position,
      clientX: bounds.left + position.x,
      clientY: bounds.top + position.y,
    };
  },
  strongestEdge() {
    let best: { source: string; target: string; weight: number } | null = null;
    for (const edge of snapshot.graph.edges) {
      if (!best || edge.weight > best.weight) {
        best = { source: edge.source, target: edge.target, weight: edge.weight };
      }
    }
    return best;
  },
  setTheme(theme: "dark" | "light") {
    document.body.classList.toggle("theme-dark", theme === "dark");
    document.body.classList.toggle("theme-light", theme === "light");
  },
  installFakeOfficialGraph(viewType = "graph") {
    const expected: Record<string, { x: number; y: number }> = {};
    const nodeLookup: Record<string, { id: string; type: string; x: number; y: number }> = {};
    snapshot.graph.nodes.forEach((node, index) => {
      // Deliberately not a force layout: a linear ramp on x and a modular
      // scatter on y, so adopting it is unmistakable.
      const x = index * 7 - 200;
      const y = ((index * 37) % 101) * 4 - 200;
      expected[node.id] = { x, y };
      nodeLookup[`${node.id}.md`] = { id: `${node.id}.md`, type: "", x, y };
    });
    resetFakeOfficialGraph();
    fakeOfficialLeaves[viewType] = [
      {
        view: {
          renderer: {
            nodeLookup,
            nodes: [],
            containerEl: document.createElement("div"),
            changed() {},
          },
        },
      },
    ];
    return expected;
  },
  resetFakeOfficialGraph,
  setReuseOfficialLayout(value: boolean) {
    settings.reuseOfficialLayout = value;
  },
  sigmaPositions() {
    const sigma = (view as unknown as { renderer: { instance: unknown } | null }).renderer?.instance as
      | { getGraph(): { nodes(): string[]; getNodeAttribute(id: string, name: string): unknown } }
      | null;
    if (!sigma) return {};
    const graph = sigma.getGraph();
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of graph.nodes()) {
      out[id] = {
        x: Number(graph.getNodeAttribute(id, "x")),
        y: Number(graph.getNodeAttribute(id, "y")),
      };
    }
    return out;
  },
  layoutSource() {
    return ((view as unknown as { layoutSource?: string | null }).layoutSource ?? null);
  },
  focusedNodeIds() {
    // Reads the view's private `focus` field by name. Keep the two in step: a
    // rename on one side without the other silently returns an empty list, and
    // the focus checks then fail with a correct-looking highlight.
    const focus = (view as unknown as { focus?: { nodeIds?: readonly string[] } }).focus;
    return [...(focus?.nodeIds ?? [])];
  },
  highlightedNodes() {
    const set = (view as unknown as { highlightNodes?: ReadonlySet<string> }).highlightNodes;
    return [...(set ?? [])];
  },
  highlightedEdges() {
    const set = (view as unknown as { highlightEdges?: ReadonlySet<string> }).highlightEdges;
    return [...(set ?? [])];
  },
  clickStage() {
    const sigma = (view as unknown as {
      renderer?: { instance?: { emit(event: string, payload: unknown): void } };
    }).renderer?.instance;
    sigma?.emit("clickStage", { event: new MouseEvent("click") });
  },
  visibleNodeIds() {
    const nodes = (view as unknown as { visibleNodes(): Array<{ id: string }> }).visibleNodes();
    return nodes.map((node) => node.id);
  },
  markedNodeIds() {
    const marked = (view as unknown as { markedNodeIds?: () => string[] }).markedNodeIds;
    return marked ? marked.call(view) : [];
  },
  hoveredNode() {
    const renderer = (view as unknown as { renderer?: { hoveredNode?: string | null } }).renderer;
    return renderer?.hoveredNode ?? null;
  },
  focusNode(nodeId: string) {
    (view as unknown as { focusNode?: (id: string) => void }).focusNode?.(nodeId);
  },
  /**
   * Ask sigma's own hit test what is at a container-relative point.
   *
   * Preferred over `hoveredNode()` for locating nodes: v4 resolves hover
   * asynchronously (`HoverResolver` reads the picking framebuffer after the
   * frame), so a hover read right after a pointer move is a race. This is the
   * same test, taken synchronously.
   *
   * `getHitAtPosition` is private in the v4 types but is exactly what sigma
   * calls before emitting `clickNode` / `rightClickNode`.
   */
  hitTest(x: number, y: number) {
    const sigma = (
      view as unknown as {
        renderer?: {
          instance?: { getHitAtPosition?: (p: { x: number; y: number }) => { key?: string } | null };
        };
      }
    ).renderer?.instance;
    if (!sigma || typeof sigma.getHitAtPosition !== "function") return null;
    try {
      const hit = sigma.getHitAtPosition({ x, y });
      return hit && typeof hit.key === "string" ? hit.key : null;
    } catch {
      return null;
    }
  },
};

(window as unknown as { __HARNESS__: HarnessApi }).__HARNESS__ = api;
(window as unknown as { __HARNESS_READY__: boolean }).__HARNESS_READY__ = true;
