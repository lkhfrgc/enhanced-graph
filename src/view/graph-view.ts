/**
 * The Enhanced Graph `ItemView`.
 *
 * Owns the state, the sigma canvas and the layout pipeline. The chrome around
 * the canvas is *composed* rather than built here: the toolbar, the legend and
 * the filters panel each live in their own pure DOM builder (`graph-toolbar`,
 * `graph-legend`, `graph-filters`) and are handed the little they need as
 * options plus callbacks. The insights panel (惊奇连接 / 知识空白) keeps its own
 * module too.
 *
 * What stays here is everything that is genuinely about the view: the layout
 * orchestration (`applyGraphData` / `runLayout` / `tryExternalLayout` /
 * `persistPositions`), focus and highlight, search matching, the node
 * context menu, the status bar and the position cache.
 */

import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import Graph from "graphology";
import type { Attributes } from "graphology-types";
import type { PluginHost } from "../plugin-host";
import {
  EMPTY_GRAPH,
  type ColorMode,
  type GapType,
  type GraphEdge,
  type GraphNode,
  type PageType,
  type WikiGraph,
  DEFAULT_RELEVANCE_WEIGHTS,
  type RelevanceWeights,
} from "../types";
import { t } from "../i18n";
import { renderWeights } from "./graph-weights";

import { analyzeGraph, type GraphInsights } from "../core/insights";
import { edgeKey } from "../core/graph-keys";
import {
  NO_FOCUS,
  applyFocus,
  highlightFor,
  type FocusState,
} from "./selection";
import { type FilterSection, renderFilters } from "./graph-filters";
import { renderAppearance } from "./graph-appearance";
import { renderLegend } from "./graph-legend";
import { renderToolbar, renderZoomControls, type PanelMode } from "./graph-toolbar";
import { countUndismissed, renderInsightsPanel, type InsightSection } from "./insights-panel";
import type { EdgeScoreSummary } from "./renderer";
import {
  GraphRenderer,
  labelTuning,
  toEdgeAttributes,
  toNodeAttributes,
  type EnhancedSigmaGraph,
  type GraphEdgeAttributes,
  type GraphNodeAttributes,
  type RendererOptions,
} from "./renderer";
import {
  applyExternalLayout,
  graphDataKey,
  layoutIterations,
  PositionCache,
  runLayoutAsync,
  runLayoutSync,
} from "./layout";
import { collectTags, filterEdges, filterNodes, type VisibilityFilters } from "./visibility";

/**
 * ForceAtlas2 steps taken per gravity-drag event.
 *
 * Small on purpose: these run on every pointer step so the layout can follow
 * the drag; the full relayout happens on release.
 */
const GRAVITY_PREVIEW_ITERATIONS = 12;


/** Coalesce rapid weight edits: each rebuild re-reads and re-scores the vault. */
const WEIGHT_REBUILD_DEBOUNCE_MS = 700;

export const VIEW_TYPE_ENHANCED_GRAPH = "enhanced-graph-view";

const MAIN_THREAD_LAYOUT_LIMIT = 220;

/** Golden-angle spiral: deterministic, well-spread seeds for new nodes. */
function scatterPosition(index: number): { x: number; y: number } {
  const angle = index * 2.399963229728653;
  const radius = 6 * Math.sqrt(index + 1);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export class EnhancedGraphView extends ItemView {
  private readonly plugin: PluginHost;

  private renderer: GraphRenderer | null = null;
  private sigmaGraph: EnhancedSigmaGraph | null = null;
  private positionCache: PositionCache | null = null;

  private graph: WikiGraph = EMPTY_GRAPH;
  private insights: GraphInsights = { connections: [], gaps: [] };

  private colorMode: ColorMode = "type";
  private searchQuery = "";
  private hiddenTypes = new Set<PageType>();
  /** Tags to exclude; only read while the tag filter is in exclude mode. */
  private hiddenTags = new Set<string>();
  /** Tags to keep, or `null` before anything has been ticked in include mode. */
  private includedTags: Set<string> | null = null;
  private showLabels = true;
  private panelMode: PanelMode = "insights";
  private showDismissed = false;
  /** Card group the user is looking at; see `InsightSection`. */
  private insightSection: InsightSection = "connections";
  /** Filter group the user is looking at, in this view's filters tab. */
  private filterSection: FilterSection = "types";

  private highlightNodes: ReadonlySet<string> = new Set<string>();
  private highlightEdges: ReadonlySet<string> = new Set<string>();
  private focus: FocusState = NO_FOCUS;

  private lastLayoutKey = "";
  private pendingLayoutKey = "";
  private building = false;
  /** Which layout produced the current coordinates, for the status bar. */
  private layoutSource: "official" | "forceatlas2" | null = null;
  /** Which built-in view the layout was adopted from. */
  private layoutSourceDetail = "";

  // DOM handles
  private rootEl!: HTMLElement;
  private canvasWrapEl!: HTMLElement;
  private canvasEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  /** Whether the current query matches nothing; drives the toolbar message. */
  private panelEl!: HTMLElement;
  private legendEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private nodeMenuEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PluginHost) {
    super(leaf);
    this.plugin = plugin;
    this.colorMode = plugin.settings.colorMode;
  }

  getViewType(): string {
    return VIEW_TYPE_ENHANCED_GRAPH;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "git-fork";
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onOpen(): Promise<void> {
    this.colorMode = this.plugin.settings.colorMode;
    this.showLabels = this.plugin.settings.showLabels;
    this.buildLayout();
    this.positionCache = new PositionCache(
      this.plugin.settings.positions,
      (snapshot) => {
        this.plugin.settings.positions = snapshot;
        void this.plugin.saveSettings();
      },
    );
    this.render();
    await this.reload(false);
  }

  async onClose(): Promise<void> {
    this.positionCache?.flush();
    this.renderer?.destroy();
    this.renderer = null;
    this.sigmaGraph = null;
  }

  /** Called by the plugin when new graph data is available. */
  setGraph(graph: WikiGraph, insights: GraphInsights): void {
    this.graph = graph;
    this.insights = insights;
    this.building = false;
    if (this.positionCache) {
      this.positionCache.prune(new Set(graph.nodes.map((node) => node.id)));
    }
    // A rebuild can add or delete notes, so re-derive the highlight from the
    // focus against the new graph instead of keeping stale ids on screen.
    if (this.focus.nodeIds.length > 0) {
      const visible = this.visibleGraph();
      const alive = this.focus.nodeIds.every((id) => visible.nodeIndex.has(id));
      this.focus = alive ? this.focus : NO_FOCUS;
      const highlight = highlightFor(visible, this.focus);
      this.highlightNodes = highlight.nodes;
      this.highlightEdges = highlight.edges;
    }
    this.render();
    // Rendering is deliberately fire-and-forget, but a failure here would
    // otherwise be silent — surface it instead of leaving a blank canvas.
    void this.applyGraphData().catch((error) => this.reportRenderFailure(error));
  }

  private reportRenderFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[enhanced-graph] graph render failed:", error);
    new Notice(`Enhanced Graph: ${message}`, 8000);
  }

  setBuilding(building: boolean, progress?: { done: number; total: number }): void {
    this.building = building;
    this.renderStatus(progress);
    if (building) this.render();
  }

  /** Re-fetch graph data from the plugin and redraw. */
  async setGraphFromPlugin(): Promise<void> {
    await this.reload(false);
  }

  /** Weight edits re-score the whole vault, so they are coalesced. */
  private weightTimer: number | null = null;

  /** Intermediate-node counts offered by the connection-range control. */
  private static readonly FOCUS_CHOICES = [0, 1, 2, 3] as const;

  /** Re-render everything (language change, settings change). */
  refresh(): void {
    this.renderer?.applyTheme();
    this.colorMode = this.plugin.settings.colorMode;
    this.showLabels = this.plugin.settings.showLabels;
    if (this.renderer) {
      this.renderer.setOptions({ colorMode: this.colorMode, showLabels: this.showLabels });
    }
    this.render();
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private buildLayout(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("enhanced-graph-content");

    this.rootEl = container.createDiv({ cls: "enhanced-graph-root" });
    this.toolbarEl = this.rootEl.createDiv({ cls: "enhanced-graph-toolbar" });

    const body = this.rootEl.createDiv({ cls: "enhanced-graph-body" });
    this.canvasWrapEl = body.createDiv({ cls: "enhanced-graph-canvas-wrap" });
    this.canvasEl = this.canvasWrapEl.createDiv({ cls: "enhanced-graph-canvas" });
    this.legendEl = this.canvasWrapEl.createDiv({ cls: "enhanced-graph-legend" });
    this.statusEl = this.canvasWrapEl.createDiv({ cls: "enhanced-graph-status" });

    // 缩放控件：放大 / 缩小 / 适应屏幕
    const zoomEl = this.canvasWrapEl.createDiv({ cls: "enhanced-graph-zoom" });
    renderZoomControls(zoomEl, {
      onZoomIn: () => this.renderer?.zoomIn(),
      onZoomOut: () => this.renderer?.zoomOut(),
      onFit: () => this.renderer?.fit(),
    });
    this.panelEl = body.createDiv({ cls: "enhanced-graph-panel" });

    this.canvasWrapEl.addEventListener("mousemove", (event) => {
      this.renderer?.trackPointer(event.clientX, event.clientY);
    });
    this.canvasWrapEl.addEventListener("contextmenu", (event) => {
      // Right-click on empty canvas closes the node menu.
      if (event.target === this.canvasEl || event.target === this.canvasWrapEl) {
        this.closeNodeMenu();
      }
    });
    this.canvasWrapEl.setAttribute("tabindex", "0");
    this.canvasWrapEl.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.canvasEl.addEventListener("click", () => this.closeNodeMenu());

    this.renderer = new GraphRenderer(
      this.canvasEl,
      {
        labels: {
          score: t("edge.score"),
          direct: t("edge.direct"),
          sources: t("edge.sources"),
          adamicAdar: t("edge.adamicAdar"),
          coCitation: t("edge.coCitation"),
          pages: t("status.nodes"),
          links: t("status.edges"),
          community: t("legend.communities"),
        },
        describeEdge: (key) => this.describeEdge(key),
        describeIncidentEdges: (nodeId, limit) => this.describeIncidentEdges(nodeId, limit),
        onNodeDoubleClick: (nodeId) => void this.openNode(nodeId),
        onNodeContextMenu: (nodeId, x, y) => this.openNodeMenu(nodeId, x, y),
        onStageClick: () => {
          this.clearHighlight();
          this.closeNodeMenu();
        },
      },
      () => document.body.classList.contains("theme-dark"),
    );
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.clearHighlight();
      this.closeNodeMenu();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      this.renderer?.zoomIn();
      event.preventDefault();
    } else if (event.key === "-" || event.key === "_") {
      this.renderer?.zoomOut();
      event.preventDefault();
    } else if (event.key === "0") {
      this.renderer?.fit();
      event.preventDefault();
    }
  }

  // -------------------------------------------------------------------------
  // Graph data -> sigma
  // -------------------------------------------------------------------------

  private async reload(rebuild: boolean): Promise<void> {
    this.setBuilding(true);
    try {
      const { graph, insights } = await this.plugin.getGraph((done: number, total: number) =>
        this.setBuilding(true, { done, total }),
      );
      this.setGraph(graph, insights);
      if (rebuild) new Notice(t("notice.rebuilt", { nodes: graph.nodes.length, edges: graph.edges.length }));
    } catch (error) {
      this.setBuilding(false);
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Enhanced Graph: ${message}`, 8000);
    }
  }

  /** The active filter set, assembled from view state and persisted settings. */
  private visibilityFilters(): VisibilityFilters {
    return {
      hiddenTypes: this.hiddenTypes,
      // Clusters live in the settings rather than in view state: the same
      // knowledge cluster has to disappear from the built-in graph too, and the
      // two views share nothing else about what is on screen.
      hiddenCommunities: new Set(this.plugin.settings.hiddenCommunities),
      hiddenTags: this.hiddenTags,
      includedTags: this.includedTags,
      tagFilterMode: this.plugin.settings.tagFilterMode,
      hideStructural: this.plugin.settings.hideStructural,
      hideIsolated: this.plugin.settings.hideIsolated,
    };
  }

  /**
   * The tag list the current mode reads, as the panel's ticks.
   *
   * Include mode with no selection yet shows everything ticked, which is what it
   * means — every tag is kept until one is taken away.
   */
  private activeTagSelection(): ReadonlySet<string> {
    if (this.plugin.settings.tagFilterMode === "exclude") return this.hiddenTags;
    if (this.includedTags !== null) return this.includedTags;
    return new Set(collectTags(this.graph.nodes).map((entry) => entry.tag));
  }

  /**
   * Write the ticks back to the list the current mode owns.
   *
   * Mutated IN PLACE, never replaced: the filters panel captures this set when it
   * renders and deliberately does not re-render on every toggle (that would rebuild
   * the list under the pointer and steal focus from the search box). Handing it a
   * new set would leave it reading a stale empty one, and its own bulk buttons would
   * then decide there was nothing to do.
   */
  private setTagSelection(tags: Iterable<string>): void {
    const target = this.plugin.settings.tagFilterMode === "exclude" ? this.hiddenTags : this.includeSet();
    target.clear();
    for (const tag of tags) target.add(tag);
  }

  /** Include mode's own list, created on first use so it can be mutated in place. */
  private includeSet(): Set<string> {
    if (this.includedTags === null) this.includedTags = new Set();
    return this.includedTags;
  }

  private visibleNodes(): GraphNode[] {
    return filterNodes(this.graph.nodes, this.visibilityFilters());
  }

  private visibleEdges(nodes: readonly GraphNode[]): GraphEdge[] {
    return filterEdges(this.graph.edges, nodes);
  }

  /**
   * The graph as currently drawn.
   *
   * Connection lookups must run against this rather than `this.graph`: a route
   * through a hidden node would otherwise be reported as a valid connection and
   * highlight nodes that are not on screen, i.e. nothing at all.
   */
  private visibleGraph(): WikiGraph {
    const nodes = this.visibleNodes();
    return {
      nodes,
      edges: this.visibleEdges(nodes),
      communities: this.graph.communities,
      nodeIndex: new Map(nodes.map((node) => [node.id, node])),
      // Carried through unchanged: the workspace picker offers the vault's folders,
      // which do not depend on which nodes are currently visible.
      folders: this.graph.folders,
      builtAt: this.graph.builtAt,
    };
  }

  private async applyGraphData(): Promise<void> {
    const nodes = this.visibleNodes();
    const edges = this.visibleEdges(nodes);
    const gravity = this.plugin.settings.gravity;
    const dataKey = graphDataKey(nodes, edges, gravity);
    const needsLayout = dataKey !== this.lastLayoutKey && dataKey !== this.pendingLayoutKey;

    const options: RendererOptions = {
      colorMode: this.colorMode,
      showLabels: this.showLabels,
      nodeCount: nodes.length,
      edgeWeakColor: this.plugin.settings.edgeWeakColor,
      edgeStrongColor: this.plugin.settings.edgeStrongColor,
      edgeWeakWidth: this.plugin.settings.edgeWeakWidth,
      edgeStrongWidth: this.plugin.settings.edgeStrongWidth,
      autoHideLabels: this.plugin.settings.autoHideLabels,
      labelSize: this.plugin.settings.labelSize,
      labelOpacity: this.plugin.settings.labelOpacity,
      customNodeColor: this.plugin.settings.customNodeColor,
      typeColorOverrides: this.plugin.settings.typeColorOverrides,
      communityColorOverrides: this.plugin.settings.communityColorOverrides,
    };

    const existing = this.renderer?.instance;
    // Reuse the live graph instance rather than swapping a fresh one in; see
    // `buildSigmaGraph`. `refresh()` alone suffices because sigma already holds
    // this very object.
    const sigmaGraph = this.buildSigmaGraph(
      nodes,
      edges,
      existing?.getGraph() as EnhancedSigmaGraph | undefined,
    );
    this.sigmaGraph = sigmaGraph;
    if (existing) {
      this.renderer?.setOptions(options);
      existing.refresh();
    } else {
      this.renderer?.mount(sigmaGraph, options);
    }

    if (needsLayout && nodes.length > 1) {
      // Prefer an externally computed layout when one is on offer (in practice
      // the built-in graph's worker): it is free, runs off the main thread, and
      // makes the two views agree.
      const reused = this.tryExternalLayout(sigmaGraph, dataKey, nodes);
      if (!reused) await this.runLayout(sigmaGraph, dataKey, nodes.length);
    }
    this.renderStatus();
  }

  /**
   * Seed the sigma graph from an externally computed layout — in practice the
   * built-in graph's worker simulation, injected by the plugin.
   *
   * Returns false when nothing usable is available, so the caller runs
   * ForceAtlas2. The view has no idea where the coordinates come from; it only
   * knows that some `LayoutSource` may offer them.
   */
  private tryExternalLayout(
    sigmaGraph: EnhancedSigmaGraph,
    dataKey: string,
    nodes: readonly GraphNode[],
  ): boolean {
    const source = this.plugin.layoutSource;
    if (!source) {
      this.layoutSource = "forceatlas2";
      return false;
    }

    let external = null;
    try {
      external = source.capture(nodes.map((node) => node.id));
    } catch (error) {
      // A broken provider must never take the view down with it.
      console.error("[enhanced-graph] the layout source threw; using ForceAtlas2:", error);
      external = null;
    }
    if (!external) {
      this.layoutSource = "forceatlas2";
      return false;
    }

    applyExternalLayout(sigmaGraph, external.positions);
    this.layoutSource = "official";
    this.layoutSourceDetail = external.source;
    this.lastLayoutKey = dataKey;
    this.persistPositions(sigmaGraph);
    this.renderer?.refresh();
    // No console line: the status bar already names the layout source and the
    // coverage, which is where a user would look for it.
    return true;
  }

  /** Copy sigma's current coordinates into the persisted position cache. */
  private persistPositions(sigmaGraph: EnhancedSigmaGraph): void {
    const cache = this.positionCache;
    if (!cache) return;
    sigmaGraph.forEachNode((node, attributes) => {
      cache.set(node, attributes.x as number, attributes.y as number);
    });
  }

  /** Force a fresh adoption of the built-in layout (command entry point). */
  syncLayoutFromOfficial(): void {
    this.lastLayoutKey = "";
    void this.applyGraphData();
  }

  /**
   * Fill a sigma graph from the visible node/edge sets.
   *
   * `target` is reused when given, and that reuse is load-bearing rather than an
   * optimisation: sigma v4's node-drag manager captures the graph by reference
   * when the renderer is constructed and `Sigma.setGraph` does **not** rebind it
   * (verified in 4.0.0-beta.8 — `new DragManager(graph, …)` happens once in the
   * constructor, and `setGraph` only swaps `internals.graph`). Swapping in a new
   * graph object therefore left dragging writing into the discarded graph:
   * pointer events fired, coordinates advanced, and the visible nodes never
   * moved. Refilling the same instance keeps the reference valid.
   */
  private buildSigmaGraph(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    target?: EnhancedSigmaGraph,
  ): EnhancedSigmaGraph {
    const graph =
      target ?? new Graph<GraphNodeAttributes, GraphEdgeAttributes, Attributes>({
        multi: false,
        type: "undirected",
      });
    graph.clear();
    const positions = this.positionCache;
    const maxLinks = Math.max(...nodes.map((node) => node.linkCount), 1);
    let index = 0;

    for (const node of nodes) {
      const cached = positions?.get(node.id) ?? scatterPosition(index);
      index += 1;
      graph.addNode(
        node.id,
        toNodeAttributes({
          x: cached.x,
          y: cached.y,
          linkCount: node.linkCount,
          maxLinkCount: maxLinks,
          nodeCount: nodes.length,
          nodeScale: this.plugin.settings.nodeScale,
          pageType: node.type,
          pageTitle: node.label,
          nodePath: node.path,
          community: node.community,
          colorMode: this.colorMode,
          label: node.label,
        }),
      );
    }

    const maxWeight = Math.max(...edges.map((edge) => edge.weight), 1);
    for (const edge of edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const sourceLabel = this.graph.nodeIndex.get(edge.source)?.label ?? edge.source;
      const targetLabel = this.graph.nodeIndex.get(edge.target)?.label ?? edge.target;
      graph.addEdgeWithKey(
        `${edge.source}->${edge.target}`,
        edge.source,
        edge.target,
        toEdgeAttributes({
          source: edge.source,
          target: edge.target,
          weight: edge.weight,
          normalizedWeight: edge.weight / maxWeight,
          label: `${sourceLabel} ↔ ${targetLabel}`,
        }),
      );
    }
    return graph;
  }

  private async runLayout(sigmaGraph: EnhancedSigmaGraph, dataKey: string, nodeCount: number): Promise<void> {
    const gravity = this.plugin.settings.gravity;
    const iterations = layoutIterations(nodeCount);
    this.pendingLayoutKey = dataKey;
    this.layoutSource = "forceatlas2";
    this.layoutSourceDetail = "";

    try {
      if (nodeCount < MAIN_THREAD_LAYOUT_LIMIT) {
        runLayoutSync(sigmaGraph, { iterations, gravity, nodeCount });
        this.persistPositions(sigmaGraph);
        this.lastLayoutKey = dataKey;
        this.renderer?.refresh();
      } else {
        await runLayoutAsync(sigmaGraph, {
          iterations,
          gravity,
          nodeCount,
          shouldCancel: () => this.pendingLayoutKey !== dataKey,
        });
        if (this.pendingLayoutKey !== dataKey) return;
        this.persistPositions(sigmaGraph);
        this.lastLayoutKey = dataKey;
        this.renderer?.refresh();
        // Re-fit only after the first layout of a fresh graph.
        if (this.renderer?.instance) this.renderer.fit();
      }
    } finally {
      if (this.pendingLayoutKey === dataKey) this.pendingLayoutKey = "";
    }
  }

  // -------------------------------------------------------------------------
  // Edge score lookups (renderer tooltip)
  // -------------------------------------------------------------------------

  private describeEdge(key: string): EdgeScoreSummary | undefined {
    const edge = this.graph.edges.find((candidate) => edgeKey(candidate.source, candidate.target) === key);
    if (!edge) return undefined;
    return this.toSummary(edge);
  }

  private describeIncidentEdges(nodeId: string, limit: number): EdgeScoreSummary[] {
    const out: EdgeScoreSummary[] = [];
    for (const edge of this.graph.edges) {
      if (edge.source !== nodeId && edge.target !== nodeId) continue;
      out.push(this.toSummary(edge));
    }
    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, limit);
  }

  private toSummary(edge: GraphEdge): EdgeScoreSummary {
    const sourceLabel = this.graph.nodeIndex.get(edge.source)?.label ?? edge.source;
    const targetLabel = this.graph.nodeIndex.get(edge.target)?.label ?? edge.target;
    return {
      sourceLabel,
      targetLabel,
      weight: edge.weight,
      directLink: edge.signals.directLink,
      sourceOverlap: edge.signals.sourceOverlap,
      adamicAdar: edge.signals.adamicAdar,
      coCitation: edge.signals.coCitation,
      sharedSources: edge.sharedSources,
      hasDirectLink: edge.hasDirectLink,
    };
  }

  // -------------------------------------------------------------------------
  // Focus / highlight
  // -------------------------------------------------------------------------

  /**
   * 「聚焦邻居」 from the node context menu, interpreted against the current
   * focus. This is the only entry point into the focus interaction — a plain
   * left click on a node deliberately does nothing.
   *
   *   1st use  → highlight that node and everything directly attached to it
   *   2nd use  → highlight every link that connects it to the focused node
   *   on a focused node → clear
   *
   * The rules live in `./selection` as a pure function so they are unit-tested
   * without a browser; this method only applies the outcome.
   *
   * Other ways to clear: click empty canvas, press Escape, or press the
   * 「取消高亮」 button the insights panel shows while something is focused.
   */
  private focusNode(nodeId: string): void {
    const outcome = applyFocus(this.visibleGraph(), this.focus, nodeId, {
      // "via N nodes" is N + 1 hops.
      maxHops: this.plugin.settings.focusMaxIntermediates + 1,
    });

    if (outcome.kind === "unreachable") {
      // Leave the focus alone so another second node can be tried.
      new Notice(
        t("notice.notConnected", {
          a: this.labelOf(this.focus.nodeIds[0]),
          b: this.labelOf(nodeId),
        }),
      );
      return;
    }

    this.focus = outcome.state;
    // Marker the node(s) the menu acted on, not the whole neighbourhood.
    this.setHighlight(
      outcome.highlight.nodes,
      outcome.highlight.edges,
      new Set(outcome.state.nodeIds),
    );
    this.renderPanel();
    this.renderStatus();
  }

  private labelOf(nodeId: string | undefined): string {
    if (!nodeId) return "";
    return this.graph.nodeIndex.get(nodeId)?.label ?? nodeId;
  }

  /**
   * Apply an emphasis. `anchors` are the nodes the user actually picked — they
   * get a marker ring, while the rest of `nodes` is only emphasised. Insight
   * cards and legend rows leave it empty: those highlight a *set*, and ringing
   * every member would be noise.
   */
  private setHighlight(
    nodes: ReadonlySet<string>,
    edges: ReadonlySet<string>,
    anchors: ReadonlySet<string> = new Set(),
  ): void {
    this.highlightNodes = nodes;
    this.highlightEdges = edges;
    this.renderer?.setHighlight({ nodes, edges, anchors });
  }

  private clearHighlight(): void {
    this.focus = NO_FOCUS;
    this.highlightNodes = new Set();
    this.highlightEdges = new Set();
    this.renderer?.clearHighlight();
    this.renderPanel();
    this.renderStatus();
  }

  /** Highlight an explicit node set (insight cards, legend rows, context menu). */
  private highlightNodeIds(ids: readonly string[]): void {
    const set = new Set(ids);
    const edges = new Set<string>();
    for (const edge of this.graph.edges) {
      if (set.has(edge.source) && set.has(edge.target)) edges.add(edgeKey(edge.source, edge.target));
    }
    // These come from outside the menu, so the focus no longer describes what
    // is on screen.
    this.focus = NO_FOCUS;
    this.setHighlight(set, edges);
    this.renderStatus();
  }

  private async openNode(nodeId: string): Promise<void> {
    const node = this.graph.nodeIndex.get(nodeId);
    if (!node) return;
    const file = this.app.vault.getAbstractFileByPath(node.path);
    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.renderToolbar();
    this.renderLegend();
    this.renderPanel();
    this.renderStatus();
  }

  /** Wires view state into the toolbar builder; the markup lives there. */
  private renderToolbar(): void {
    renderToolbar(this.toolbarEl, {
      colorMode: this.colorMode,
      searchQuery: this.searchQuery,
      insightCount: this.undismissedCount(),
      panelMode: this.panelMode,
      onColorMode: (mode) => this.setColorMode(mode),
      onSearch: (query) => {
        this.searchQuery = query;
        this.applySearch();
      },
      onPanel: (mode) => this.setPanelMode(mode),
      onRebuild: () => {
        this.lastLayoutKey = "";
        void this.reload(true);
      },
      onZoomIn: () => this.renderer?.zoomIn(),
      onZoomOut: () => this.renderer?.zoomOut(),
      onFit: () => this.renderer?.fit(),
    });
  }

  private setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.plugin.settings.colorMode = mode;
    void this.plugin.saveSettings();
    this.renderer?.setOptions({ colorMode: mode });
    this.renderToolbar();
    this.renderLegend();
    // The appearance panel shows the colour picker only in custom mode, so it
    // has to be re-rendered when the mode changes from there.
    if (this.panelMode === "appearance") this.renderPanel();
  }

  private setPanelMode(mode: PanelMode): void {
    this.panelMode = this.panelMode === mode ? "none" : mode;
    if (this.panelMode === "none") this.clearHighlight();
    this.renderToolbar();
    this.renderPanel();
  }

  // -------------------------------------------------------------------------
  // Legend
  // -------------------------------------------------------------------------

  /** Wires view state into the legend builder; the markup lives there. */
  private renderLegend(): void {
    renderLegend(this.legendEl, {
      graph: this.graph,
      colorMode: this.colorMode,
      customNodeColor: this.plugin.settings.customNodeColor,
      typeColorOverrides: this.plugin.settings.typeColorOverrides,
      hiddenTypes: this.hiddenTypes,
      onToggleType: (type) => {
        if (this.hiddenTypes.has(type)) this.hiddenTypes.delete(type);
        else this.hiddenTypes.add(type);
        void this.applyGraphData();
        this.renderLegend();
      },
      onShowAllTypes: () => {
        this.hiddenTypes.clear();
        void this.applyGraphData();
        this.renderLegend();
      },
      hiddenCommunities: new Set(this.plugin.settings.hiddenCommunities),
      onToggleCommunity: (id) => void this.toggleCommunity(id),
      onShowAllCommunities: () => void this.showAllCommunities(),
    });
  }

  /**
   * Persist a cluster change and redraw everything that shows it.
   *
   * Clusters are stored in the settings rather than in view state, like the
   * context menu's "hide this type": the same cluster has to disappear from the
   * built-in graph too, and both legends read the same list.
   */
  private async saveCommunities(): Promise<void> {
    await this.plugin.saveSettings();
    await this.applyGraphData();
    this.renderPanel();
    this.renderLegend();
  }

  /**
   * Exclude a knowledge cluster, or bring it back.
   *
   * Written to the settings, like the context menu's "hide this type": a cluster
   * is a property of the analysis, not of this view, and the built-in graph reads
   * the very same list through `isNodeVisible`.
   */
  private async toggleCommunity(id: number): Promise<void> {
    const hidden = this.plugin.settings.hiddenCommunities;
    const at = hidden.indexOf(id);
    if (at === -1) hidden.push(id);
    else hidden.splice(at, 1);
    await this.saveCommunities();
  }

  private async showAllCommunities(): Promise<void> {
    this.plugin.settings.hiddenCommunities = [];
    await this.saveCommunities();
  }

  // -------------------------------------------------------------------------
  // Side panel: insights / filters
  // -------------------------------------------------------------------------

  private renderPanel(): void {
    const el = this.panelEl;
    el.empty();
    if (this.panelMode === "none") {
      el.addClass("is-hidden");
      return;
    }
    el.removeClass("is-hidden");

    const titles: Record<Exclude<PanelMode, "none">, string> = {
      insights: t("insights.title"),
      filters: t("toolbar.filter"),
      appearance: t("toolbar.appearance"),
      weights: t("toolbar.weights"),
    };
    const header = el.createDiv({ cls: "enhanced-graph-panel-header" });
    header.createSpan({ text: titles[this.panelMode] });
    const close = header.createEl("button", { cls: "enhanced-graph-link" });
    setIcon(close, "x");
    close.addEventListener("click", () => this.setPanelMode("none"));

    if (this.panelMode === "filters") {
      this.renderFilters(el);
      return;
    }
    if (this.panelMode === "appearance") {
      this.renderAppearancePanel(el);
      return;
    }
    if (this.panelMode === "weights") {
      this.renderWeightsPanel(el);
      return;
    }
    this.renderInsights(el);
  }

  /**
   * Quick access to the four relevance coefficients.
   *
   * Unlike appearance, these cannot be applied by repainting: every pair score
   * depends on them, so the graph has to be rebuilt. The rebuild is debounced so
   * dragging a slider re-scores once at the end rather than on every step.
   */
  private renderWeightsPanel(el: HTMLElement): void {
    renderWeights(el, {
      weights: this.plugin.settings.weights,
      onChange: (key, value) => void this.setWeight(key, value),
      onReset: () => void this.resetWeights(),
    });
  }

  private async setWeight(key: keyof RelevanceWeights, value: number): Promise<void> {
    this.plugin.settings.weights[key] = value;
    await this.plugin.saveSettings();
    this.requestWeightRebuild();
    this.renderStatus();
  }

  private async resetWeights(): Promise<void> {
    this.plugin.settings.weights = { ...DEFAULT_RELEVANCE_WEIGHTS };
    await this.plugin.saveSettings();
    this.requestWeightRebuild();
    this.renderPanel();
  }

  /**
   * Coalesce rapid weight edits into one rebuild.
   *
   * A rebuild re-reads the vault and re-scores every pair, which is far too
   * expensive to run per slider step; the panel's number box and the debounce
   * together make it land on the value the user actually stopped at.
   */
  private requestWeightRebuild(): void {
    if (this.weightTimer !== null) window.clearTimeout(this.weightTimer);
    this.weightTimer = window.setTimeout(() => {
      this.weightTimer = null;
      this.plugin.requestGraphRebuild(true);
    }, WEIGHT_REBUILD_DEBOUNCE_MS);
  }

  /**
   * Wires view state into the filters builder; the markup lives there. The
   * builder appends to `el` so the panel header rendered just above stays put.
   */
  private renderFilters(el: HTMLElement): void {
    renderFilters(el, {
      graph: this.graph,
      hiddenTypes: this.hiddenTypes,
      // The ticks the panel shows are whichever list the CURRENT mode reads.
      selectedTags: this.activeTagSelection(),
      hideIsolated: this.plugin.settings.hideIsolated,
      hideStructural: this.plugin.settings.hideStructural,
      onToggleType: (type, visible) => {
        if (visible) this.hiddenTypes.delete(type);
        else this.hiddenTypes.add(type);
        void this.applyGraphData();
        this.renderLegend();
      },
      onToggleTag: (tag, selected) => {
        const next = new Set(this.activeTagSelection());
        if (selected) next.add(tag);
        else next.delete(tag);
        this.setTagSelection(next);
        void this.applyGraphData();
        this.renderLegend();
      },
      // 全清 empties the selection IN THE MODE ON SCREEN: excluding nothing more,
      // or — while including — keeping nothing at all. Each mode has its own list,
      // so this cannot disturb the other one's ticks.
      onClearTags: () => {
        this.setTagSelection(new Set());
        void this.applyGraphData();
        this.renderLegend();
      },
      tagFilterMode: this.plugin.settings.tagFilterMode,
      workspace: {
        folder: this.plugin.settings.workingFolder,
        excluded: this.plugin.settings.excludeFolders,
        folders: this.graph.folders,
      },
      // Applying changes which notes exist, so it is a settings write plus a
      // rebuild — the same pair the settings tab used to do for these two keys.
      onApplyWorkspace: (folder, excluded) => {
        this.plugin.settings.workingFolder = folder;
        this.plugin.settings.excludeFolders = [...excluded];
        void this.plugin.saveSettings().then(() => this.plugin.requestGraphRebuild());
      },
      onSelectAllTags: (tags) => {
        const next = new Set(this.activeTagSelection());
        for (const tag of tags) if (tag.length > 0) next.add(tag);
        this.setTagSelection(next);
        void this.applyGraphData();
        this.renderLegend();
      },
      // Each mode keeps its own selection, so switching back and forth never
      // rewrites the other one. Include mode opens fully ticked the first time it is
      // entered — everything kept — because a fresh include list is `null`, and an
      // empty one would mean the opposite: keep nothing.
      onSetTagFilterMode: (mode) => {
        this.plugin.settings.tagFilterMode = mode;
        if (mode === "include" && this.includedTags === null) {
          this.includedTags = new Set(collectTags(this.graph.nodes).map((entry) => entry.tag));
        }
        void this.plugin.saveSettings().then(() => this.applyGraphData());
        this.renderPanel();
        this.renderLegend();
      },
      communities: this.graph.communities,
      // A fresh copy per render: this panel is rebuilt after every switch, unlike
      // the built-in graph's (which defers while a control has focus and so gets a
      // live view instead).
      hiddenCommunities: new Set(this.plugin.settings.hiddenCommunities),
      onToggleCommunity: (id, visible) => {
        const hidden = this.plugin.settings.hiddenCommunities;
        const at = hidden.indexOf(id);
        if (visible && at !== -1) hidden.splice(at, 1);
        else if (!visible && at === -1) hidden.push(id);
        void this.saveCommunities();
      },
      onClearCommunities: () => {
        this.plugin.settings.hiddenCommunities = [];
        void this.saveCommunities();
      },
      onToggleIsolated: async (value) => {
        this.plugin.settings.hideIsolated = value;
        await this.plugin.saveSettings();
        await this.applyGraphData();
      },
      activeSection: this.filterSection,
      onSelectSection: (section) => {
        this.filterSection = section;
        el.empty();
        this.renderFilters(el);
      },
      onToggleStructural: async (value) => {
        this.plugin.settings.hideStructural = value;
        await this.plugin.saveSettings();
        await this.applyGraphData();
      },
    });
  }

  /**
   * Wires view state into the appearance builder; the markup lives there.
   *
   * Node size and node colour need the graph rebuilt (the size is baked into the
   * sigma attributes), edge thickness and edge colour only need a redraw — the
   * reducers apply those. Spacing invalidates the layout key.
   */
  private renderAppearancePanel(el: HTMLElement): void {
    renderAppearance(el, {
      graph: this.graph,
      colorMode: this.colorMode,
      customNodeColor: this.plugin.settings.customNodeColor,
      typeColorOverrides: this.plugin.settings.typeColorOverrides,
      communityColorOverrides: this.plugin.settings.communityColorOverrides,
      nodeScale: this.plugin.settings.nodeScale,
      gravity: this.plugin.settings.gravity,
      edgeWeakColor: this.plugin.settings.edgeWeakColor,
      edgeStrongColor: this.plugin.settings.edgeStrongColor,
      edgeWeakWidth: this.plugin.settings.edgeWeakWidth,
      edgeStrongWidth: this.plugin.settings.edgeStrongWidth,
      showLabels: this.showLabels,
      autoHideLabels: this.plugin.settings.autoHideLabels,
      labelSize: this.plugin.settings.labelSize,
      labelOpacity: this.plugin.settings.labelOpacity,
      onColorMode: (mode) => void this.setColorMode(mode),
      onNodeScale: async (value) => {
        this.plugin.settings.nodeScale = value;
        await this.plugin.saveSettings();
        await this.applyGraphData();
      },
      onGravity: async (value) => {
        this.plugin.settings.gravity = value;
        await this.plugin.saveSettings();
        this.lastLayoutKey = "";
        await this.applyGraphData();
      },
      // Live feedback while the slider is dragged; the full relayout happens on
      // release (see `onGravity` above).
      onGravityPreview: (value) => this.previewGravity(value),
      onCustomNodeColor: (color) => void this.setCustomNodeColor(color),
      onTypeColor: (type, color) => void this.setTypeColor(type, color),
      onCommunityColor: (community, color) => void this.setCommunityColor(community, color),
      // Edge look is applied by the reducer, so these only need a redraw.
      onEdgeWeakColor: (color) => void this.setEdgeStyle({ edgeWeakColor: color }),
      onEdgeStrongColor: (color) => void this.setEdgeStyle({ edgeStrongColor: color }),
      onEdgeWeakWidth: (width) => void this.setEdgeStyle({ edgeWeakWidth: width }),
      onEdgeStrongWidth: (width) => void this.setEdgeStyle({ edgeStrongWidth: width }),
      onAutoHideLabels: (value) => void this.setLabelLook({ autoHideLabels: value }),
      onLabelSize: (value) => void this.setLabelLook({ labelSize: value }),
      onLabelOpacity: (value) => void this.setLabelLook({ labelOpacity: value }),
      onToggleLabels: (value) => {
        this.showLabels = value;
        // The view keeps its own copy for re-renders, but the setting is the
        // source of truth — without this the toggle was lost on every reload.
        this.plugin.settings.showLabels = value;
        void this.plugin.saveSettings();
        this.renderer?.setOptions({ showLabels: value });
      },
    });
  }

  /** Persist one or more edge-look settings and re-apply them to the live view. */
  private async setEdgeStyle(patch: Partial<RendererOptions>): Promise<void> {
    Object.assign(this.plugin.settings, patch);
    await this.plugin.saveSettings();
    this.renderer?.setOptions(patch);
  }

  /** Persist a label-look change and apply it without rebuilding the graph. */
  private async setLabelLook(patch: Partial<RendererOptions>): Promise<void> {
    Object.assign(this.plugin.settings, patch);
    await this.plugin.saveSettings();
    this.renderer?.setOptions(patch);
  }

  /**
   * Live gravity feedback while the slider is being dragged.
   *
   * A full relayout is far too expensive to run per pointer step (it is
   * hundreds of ForceAtlas2 iterations and a position-cache write), so this takes
   * a handful of steps from wherever the graph currently sits: enough for the
   * clusters to visibly tighten or spread under the drag. Releasing the slider
   * runs the real layout.
   *
   * The setting is updated but deliberately NOT saved — a drag would otherwise
   * write to disk on every step; the release path persists it.
   */
  private previewGravity(value: number): void {
    this.plugin.settings.gravity = value;
    const sigmaGraph = this.renderer?.instance?.getGraph();
    if (!sigmaGraph || sigmaGraph.order <= 1) return;
    runLayoutSync(sigmaGraph, {
      iterations: GRAVITY_PREVIEW_ITERATIONS,
      gravity: value,
      nodeCount: sigmaGraph.order,
    });
    this.renderer?.refresh();
  }

  private async setCustomNodeColor(color: string): Promise<void> {
    this.plugin.settings.customNodeColor = color;
    await this.plugin.saveSettings();
    this.renderer?.setOptions({ customNodeColor: color });
    this.renderLegend();
  }

  private async setTypeColor(type: PageType, color: string | null): Promise<void> {
    const overrides = { ...this.plugin.settings.typeColorOverrides };
    if (color === null) delete overrides[type];
    else overrides[type] = color;
    this.plugin.settings.typeColorOverrides = overrides;
    await this.plugin.saveSettings();
    this.renderer?.setOptions({ typeColorOverrides: overrides });
    this.renderLegend();
  }

  private async setCommunityColor(community: number, color: string | null): Promise<void> {
    const overrides = { ...this.plugin.settings.communityColorOverrides };
    if (color === null) delete overrides[String(community)];
    else overrides[String(community)] = color;
    this.plugin.settings.communityColorOverrides = overrides;
    await this.plugin.saveSettings();
    this.renderer?.setOptions({ communityColorOverrides: overrides });
    this.renderLegend();
  }

  private undismissedCount(): number {
    return countUndismissed(this.insights, new Set(this.plugin.settings.dismissedInsights));
  }

  /** Thin adapter: the card DOM itself lives in `insights-panel`. */
  private renderInsights(el: HTMLElement): void {
    renderInsightsPanel(el, {
      graph: this.graph,
      insights: this.insights,
      dismissed: new Set(this.plugin.settings.dismissedInsights),
      showDismissed: this.showDismissed,
      activeNodeIds: this.highlightNodes,
      onToggleFocus: (ids, edgeKeys) => {
        if (ids.length === 0) {
          this.clearHighlight();
          return;
        }
        // An explicit focus set does not come from clicking, so the click
        // describes what is on screen.
        this.focus = NO_FOCUS;
        this.setHighlight(new Set(ids), new Set(edgeKeys));
        this.renderPanel();
        this.renderStatus();
      },
      // `toggleDismissed` mutates the plugin settings, so it stays on the view.
      onDismiss: (key, ids) => void this.toggleDismissed(key, new Set(ids)),
      onToggleShowDismissed: () => {
        this.showDismissed = !this.showDismissed;
        this.renderPanel();
      },
      activeSection: this.insightSection,
      onSelectSection: (section) => {
        this.insightSection = section;
        this.renderPanel();
      },
    });
  }

  private async toggleDismissed(key: string, ids: Set<string>): Promise<void> {
    const list = this.plugin.settings.dismissedInsights;
    const index = list.indexOf(key);
    if (index >= 0) list.splice(index, 1);
    else list.push(key);
    await this.plugin.saveSettings();
    if (index < 0 && sameSet(this.highlightNodes, ids)) this.clearHighlight();
    this.renderToolbar();
    this.renderPanel();
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private renderStatus(progress?: { done: number; total: number }): void {
    const el = this.statusEl;
    el.empty();
    if (this.building) {
      el.createDiv({ cls: "enhanced-graph-spinner" });
      el.createSpan({
        text: progress ? t("status.progress", progress) : t("status.building"),
      });
      return;
    }
    if (this.graph.nodes.length === 0) {
      el.createSpan({ text: t("status.empty") });
      return;
    }
    const nodes = this.visibleNodes();
    const edges = this.visibleEdges(nodes);
    const hidden = this.graph.nodes.length - nodes.length;
    const parts = [
      `${nodes.length}/${this.graph.nodes.length} ${t("status.nodes")}`,
      `${edges.length}/${this.graph.edges.length} ${t("status.edges")}`,
    ];
    if (hidden > 0) parts.push(`${hidden} ${t("status.hidden")}`);
    if (this.layoutSource === "official") {
      parts.push(t("status.layoutOfficial", { view: this.layoutSourceDetail || "graph" }));
    } else if (this.layoutSource === "forceatlas2") {
      parts.push(t("status.layoutForce"));
    }
    parts.push(...this.focusStatus());
    el.createSpan({ text: parts.join(" · ") });
    this.renderFocusRange(el);
  }

  /**
   * The hop-budget control, shown only while a pair is focused.
   *
   * It lives in the status bar because that is where the "shortest N hops" text
   * already is: the control and the number it changes are in the same place, so
   * the effect of clicking is immediately visible right next to the buttons.
   */
  private renderFocusRange(el: HTMLElement): void {
    if (this.focus.nodeIds.length !== 2) return;
    const distance = this.focus.connection?.distance ?? 0;
    const row = el.createDiv({ cls: "enhanced-graph-focus-range" });
    row.createSpan({ cls: "enhanced-graph-focus-range-label", text: t("focus.range") });
    const active = this.plugin.settings.focusMaxIntermediates;
    for (const intermediates of EnhancedGraphView.FOCUS_CHOICES) {
      // Each choice describes a path of `intermediates + 1` hops. A choice at or
      // below the shortest distance would reproduce what is already drawn, so it
      // is left out — every button on screen then actually changes the result.
      if (intermediates > 0 && intermediates + 1 <= distance) continue;
      const label =
        intermediates === 0 ? t("focus.shortest") : t("focus.viaN", { n: intermediates });
      const button = row.createEl("button", { cls: "enhanced-graph-hop-button", text: label });
      if (intermediates === active) button.addClass("is-active");
      button.addEventListener("click", () => void this.setFocusRange(intermediates));
    }
  }

  /**
   * Change how far the connection may wander, and re-derive the highlight for
   * the pair already focused — the paths themselves change, so the focus has to
   * be recomputed rather than just repainted.
   */
  private async setFocusRange(intermediates: number): Promise<void> {
    this.plugin.settings.focusMaxIntermediates = intermediates;
    await this.plugin.saveSettings();

    const [from, to] = this.focus.nodeIds;
    if (!from || !to) {
      this.renderStatus();
      return;
    }
    this.focus = NO_FOCUS;
    this.focusNode(from);
    this.focusNode(to);
  }

  /**
   * What the current focus means, so the highlight is never a
   * mystery: which node is selected, or which two and how far apart.
   */
  private focusStatus(): string[] {
    const [from, to] = this.focus.nodeIds;
    if (!from) return [];
    if (!to) return [t("status.selected", { label: this.labelOf(from) })];

    const connection = this.focus.connection;
    const distance = connection?.distance ?? 0;
    const span = connection?.span ?? distance;
    const labels = { a: this.labelOf(from), b: this.labelOf(to), distance };
    // Once the budget is widened the route count no longer describes what is
    // drawn, so report the span instead of a number that would be wrong.
    if (span > distance) {
      return [t("status.connectionWide", { ...labels, span })];
    }
    const routes = connection?.routeCount ?? 1;
    return [
      routes > 1 ? t("status.connectionMulti", { ...labels, routes }) : t("status.connection", labels),
    ];
  }

  // -------------------------------------------------------------------------
  // Node context menu
  // -------------------------------------------------------------------------

  private openNodeMenu(nodeId: string, clientX: number, clientY: number): void {
    this.closeNodeMenu();
    const node = this.graph.nodeIndex.get(nodeId);
    if (!node) return;
    const bounds = this.rootEl.getBoundingClientRect();
    const menu = this.rootEl.createDiv({ cls: "enhanced-graph-menu" });
    menu.style.left = `${clientX - bounds.left}px`;
    menu.style.top = `${clientY - bounds.top}px`;
    this.nodeMenuEl = menu;

    const head = menu.createDiv({ cls: "enhanced-graph-menu-head" });
    head.createDiv({ cls: "enhanced-graph-menu-title", text: node.label });
    head.createDiv({
      cls: "enhanced-graph-menu-meta",
      text: `${t("status.edges")}: ${node.linkCount} · ${t("type." + node.type as never)}`,
    });

    this.menuItem(menu, "file-text", t("menu.openNote"), () => void this.openNode(nodeId));

    // The focus item is the whole interaction, so its label says what it will
    // actually do: focus this node's links, connect it to the node already
    // focused, or undo the focus if this node is the one focused.
    const focused = this.focus.nodeIds;
    const isFocused = focused.includes(nodeId);
    const connectedTo = focused.length === 1 && !isFocused ? this.labelOf(focused[0]) : null;
    const focusLabel = isFocused
      ? t("menu.clearFocus")
      : connectedTo !== null
        ? t("menu.connectTo", { label: connectedTo })
        : t("menu.highlightNeighbors");
    this.menuItem(menu, isFocused ? "x" : "share-2", focusLabel, () => this.focusNode(nodeId));

    this.menuItem(menu, "eye-off", t("menu.hideType"), () => {
      this.hiddenTypes.add(node.type);
      void this.applyGraphData();
      this.renderLegend();
    });
    this.menuItem(menu, "clipboard-copy", t("command.copyReport"), () => {
      void this.plugin.copyRelevanceReport(node.id);
    });
  }

  private menuItem(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
    const item = parent.createEl("button", { cls: "enhanced-graph-menu-item" });
    setIcon(item.createSpan({ cls: "enhanced-graph-button-icon" }), icon);
    item.createSpan({ text: label });
    item.addEventListener("click", () => {
      this.closeNodeMenu();
      onClick();
    });
  }

  private closeNodeMenu(): void {
    this.nodeMenuEl?.remove();
    this.nodeMenuEl = null;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  private applySearch(): void {
    const query = this.searchQuery.trim().toLowerCase();
    if (!query) {
        this.clearHighlight();
      return;
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    const matched = new Set<string>();
    for (const node of this.graph.nodes) {
      const haystack = `${node.label} ${node.id} ${node.type} ${node.path}`.toLowerCase();
      if (tokens.every((token) => haystack.includes(token))) matched.add(node.id);
    }
    this.setHighlight(matched, new Set());
    // A persistent message in the toolbar rather than a Notice: the search runs
    // on every keystroke, so a Notice fired once per character and stacked up
    // the side of the screen.
  }

  /**
   * Toggle the "no matching nodes" line under the search box.
   *
   * Updates the existing element instead of re-rendering the toolbar — a
   * re-render would replace the input and steal focus mid-typing.
   */
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Re-exported for the harness page. */
export { edgeKey, scatterPosition, labelTuning, analyzeGraph };
export type { GapType };
