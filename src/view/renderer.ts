/**
 * Sigma renderer wrapper.
 *
 * Owns the WebGL renderer, the node/edge reducers that implement hover and
 * highlight semantics, the zoom controls, the edge/score tooltip and the
 * resize handling. Deliberately free of any Obsidian import so the harness
 * page can mount the exact same code in a plain browser.
 */

import Sigma from "sigma";
import type Graph from "graphology";
import type { Attributes } from "graphology-types";
import type { EdgeDisplayData, NodeDisplayData } from "sigma/types";
import type { ColorMode } from "../types";
import { labelTuning, movePerformanceFlags } from "./tuning";
import {
  communityColor,
  nodeColorForMode,
  resolveEdgeStyle,
  edgeAlphaForWeight,
  edgeColorForWeight,
  edgeWidthForWeight,
  hexToRgba,
  mixColor,
  nodeSize,
  themePalette,
  typeColor,
  DEFAULT_EDGE_WIDTHS,
  type EdgeStyle,
  type GraphThemePalette,
} from "./palette";

export interface GraphNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  pageType: string;
  pageTitle: string;
  nodePath: string;
  linkCount: number;
  community: number;
}

export interface GraphEdgeAttributes {
  size: number;
  color: string;
  weight: number;
  /** 0…1, the input to the width and colour ramps. */
  normalizedWeight: number;
  /** Alpha the ramp assigns before hover/highlight dimming is applied. */
  baseAlpha: number;
  sourceNode: string;
  targetNode: string;
  label: string;
}

export interface EdgeScoreSummary {
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly weight: number;
  readonly directLink: number;
  readonly sourceOverlap: number;
  readonly adamicAdar: number;
  readonly coCitation: number;
  readonly sharedSources: readonly string[];
  readonly hasDirectLink: boolean;
}

export interface RendererCallbacks {
  onNodeDoubleClick?: (nodeId: string) => void;
  onNodeContextMenu?: (nodeId: string, clientX: number, clientY: number) => void;
  onStageClick?: () => void;
  onStageContextMenu?: (clientX: number, clientY: number) => void;
  /** Resolve the score breakdown of an edge key `a:::b` for the tooltip. */
  describeEdge?: (edgeKey: string) => EdgeScoreSummary | undefined;
  /** Top incident edges of a node, strongest first. */
  describeIncidentEdges?: (nodeId: string, limit: number) => readonly EdgeScoreSummary[];
  /** Localised labels for the tooltip. */
  labels: TooltipLabels;
}

export interface TooltipLabels {
  score: string;
  direct: string;
  sources: string;
  adamicAdar: string;
  coCitation: string;
  pages: string;
  links: string;
  community: string;
}

export interface RendererOptions {
  colorMode: ColorMode;
  showLabels: boolean;
  nodeCount: number;
  /** Weak end of the edge colour ramp; `null` follows the theme. */
  edgeWeakColor: string | null;
  /** Strong end of the edge colour ramp; `null` follows the theme. */
  edgeStrongColor: string | null;
  /** Edge width at normalizedWeight 0. */
  edgeWeakWidth: number;
  /** Edge width at normalizedWeight 1. */
  edgeStrongWidth: number;
  /**
   * Whether a label is dropped once its node shrinks below the size threshold.
   * That is what makes labels disappear while zooming out.
   */
  autoHideLabels: boolean;
  /** Label font size in pixels. */
  labelSize: number;
  /** Label colour; `null` follows the theme. */
  labelColor: string | null;
  /** Node colour used when `colorMode` is `"custom"`. */
  customNodeColor: string;
  /** Per-page-type colour overrides, keyed by page type. */
  typeColorOverrides: Readonly<Record<string, string>>;
  /** Per-community colour overrides, keyed by community id. */
  communityColorOverrides: Readonly<Record<number, string>>;
}

/** The label face, matching sigma's own default minus the weight v4 stopped taking. */
const LABEL_FAMILY = "Arial, sans-serif";

export interface HighlightState {
  /** Nodes emphasised by an insight card or the search box. */
  nodes: ReadonlySet<string>;
  /** Edge keys (`a:::b`, ids sorted) emphasised by an insight card. */
  edges: ReadonlySet<string>;
  /**
   * Nodes the user explicitly acted on — the ones a marker ring is drawn
   * around. Deliberately a subset of {@link nodes}: the focus also emphasises
   * every neighbour, but only the clicked nodes are "the thing I picked".
   */
  anchors: ReadonlySet<string>;
}

const EMPTY_HIGHLIGHT: HighlightState = { nodes: new Set(), edges: new Set(), anchors: new Set() };

/** The concrete graphology/sigma generic instantiation used across the plugin. */
export type EnhancedSigmaGraph = Graph<GraphNodeAttributes, GraphEdgeAttributes, Attributes>;

export class GraphRenderer {
  private sigma: Sigma<GraphNodeAttributes, GraphEdgeAttributes, Attributes> | null = null;
  private palette: GraphThemePalette;
  private hoveredNode: string | null = null;
  private hoverNeighbors: ReadonlySet<string> = new Set();
  private highlight: HighlightState = EMPTY_HIGHLIGHT;
  /** Our own 2D layer for marker rings, above sigma's canvases. */
  private markerLayer: HTMLCanvasElement | null = null;
  /** Where the current press started, in client pixels; null between presses. */
  private pressOrigin: { x: number; y: number } | null = null;
  /** Furthest the pointer travelled during the current press. */
  private pressTravel = 0;
  private options: RendererOptions = {
    colorMode: "type",
    showLabels: true,
    nodeCount: 0,
    edgeWeakColor: null,
    edgeStrongColor: null,
    edgeWeakWidth: DEFAULT_EDGE_WIDTHS.weakWidth,
    edgeStrongWidth: DEFAULT_EDGE_WIDTHS.strongWidth,
    autoHideLabels: true,
    labelSize: 12,
    labelColor: null,
    customNodeColor: "#60a5fa",
    typeColorOverrides: {},
    communityColorOverrides: {},
  };
  private tooltip: HTMLElement | null = null;
  private tooltipVisible = false;
  private pointer = { x: 0, y: 0 };
  private pendingFrame = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: RendererCallbacks,
    private readonly isDark: () => boolean = () => document.body.classList.contains("theme-dark"),
  ) {
    this.palette = themePalette(this.isDark());
    this.buildTooltip();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  get instance(): Sigma<GraphNodeAttributes, GraphEdgeAttributes, Attributes> | null {
    return this.sigma;
  }

  /** (Re)create the sigma instance around a freshly built graphology graph. */
  mount(graph: EnhancedSigmaGraph, options: RendererOptions): void {
    this.destroyRenderer();
    this.options = options;
    this.palette = themePalette(this.isDark());

    if (this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      // Sigma throws on a zero-sized container; wait for layout instead.
      requestAnimationFrame(() => {
        if (this.container.clientWidth > 0 && this.container.clientHeight > 0) this.mount(graph, options);
      });
      return;
    }

    const labels = labelTuning(options.nodeCount);
    const move = movePerformanceFlags(options.nodeCount);
    // v4 nests every renderer setting under `settings` (v3 took them at the top
    // level). `labelColor` and `labelSize` are gone from here entirely — they are
    // per-node display data now and are emitted by `reduceNode`.
    this.sigma = new Sigma(graph, this.container, {
      settings: {
        renderEdgeLabels: false,
        // See `movePerformanceFlags`: these are a large-graph trick, NOT defaults.
        hideEdgesOnMove: move.hideEdgesOnMove,
        hideLabelsOnMove: move.hideLabelsOnMove,
        renderLabels: options.showLabels,
        enableEdgeEvents: true,
        labelDensity: labels.density,
        labelRenderedSizeThreshold: options.autoHideLabels ? labels.threshold : 0,
        stagePadding: 40,
        // Raised well above sigma's default of 3: that default counts mousemove
        // events, and an ordinary click with a real hand produces several, so the
        // click was discarded before we ever saw it. Long drags are still caught
        // here; everything shorter is adjudicated by real pointer travel in
        // `bindEvents`, which is what actually distinguishes a click from a drag.
        draggedEventsTolerance: 25,
        minCameraRatio: 0.05,
        // v4 defaults this to "positions", which reinterprets node sizes as graph
        // units and lets the camera blow them up: the graph became enormous
        // overlapping blobs with the labels lost inside them. `nodeSize()` is
        // written in screen pixels (8…28px, √-scaled), so the v3 default is the
        // correct reference for this plugin.
        itemSizesReference: "screen",
        // Kept generous because node and label sizes are screen-referenced and so
        // do not shrink with the camera; this only bounds how far the LAYOUT may
        // be zoomed out.
        maxCameraRatio: 60,
        // Obsidian reshapes the leaf constantly (sidebars, tab switches); sigma
        // must tolerate a transient 0×0 container instead of throwing.
        allowInvalidContainer: true,
      },
      nodeReducer: (node, data, attrs) => this.reduceNode(node, data, attrs),
      edgeReducer: (edge, data, attrs) => this.reduceEdge(edge, data, attrs),
    });

    this.bindEvents();
    this.observeResize();
  }

  /**
   * Swap in a new graphology graph without recreating the renderer, so the
   * camera and the reducers survive a data refresh.
   */
  setGraph(graph: EnhancedSigmaGraph): void {
    if (!this.sigma) {
      return;
    }
    this.hoveredNode = null;
    this.hoverNeighbors = new Set();
    this.hideTooltip();
    this.sigma.setGraph(graph);
    this.sigma.refresh();
  }

  destroy(): void {
    this.destroyRenderer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.tooltip?.remove();
    this.tooltip = null;
  }

  private destroyRenderer(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.sigma) {
      this.sigma.kill();
      this.sigma = null;
    }
    // sigma's layers live inside the container; clear them but put our tooltip
    // back, since `empty()` would otherwise detach it for good.
    this.container.empty();
    if (this.tooltip) this.container.appendChild(this.tooltip);
    this.hoveredNode = null;
    this.hoverNeighbors = new Set();
  }

  private observeResize(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.sigma) return;
      this.sigma.resize();
      this.sigma.refresh();
    });
    this.resizeObserver.observe(this.container);
  }

  /** Re-read the theme after Obsidian's `css-change` event. */
  applyTheme(): void {
    if (!this.sigma) return;
    this.palette = themePalette(this.isDark());
    // Nothing theme-related is a sigma setting any more: label colour, edge
    // colour and the hover backdrop are all emitted per item by the reducers, so
    // re-running them against the new palette is the whole update.
    this.sigma.refresh();
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  setHighlight(highlight: HighlightState): void {
    this.highlight = highlight;
    this.sigma?.refresh();
    // The marker layer lives outside sigma's own canvases, so it has to be
    // repainted whenever the emphasis changes — `afterRender` covers camera
    // moves, this covers the graph standing still.
    this.drawMarkers();
  }

  /**
   * Ring the nodes the user explicitly picked.
   *
   * Drawn on our own 2D layer rather than through sigma: sigma's `highlighted`
   * display flag routes into `renderHighlightedNodes`, which calls
   * `defaultDrawNodeHover` — that paints the hover label pill, not a marker.
   *
   * Hooked to `afterRender`, so the ring tracks pan, zoom and every relayout
   * for free.
   */
  /**
   * Create the marker canvas as a sibling of sigma's layers.
   *
   * It must not intercept pointer events: sigma's own picking canvas has to stay
   * the topmost hit target or hovering, right-clicking and node dragging all
   * break.
   */
  private mountMarkerLayer(): void {
    if (this.markerLayer && this.markerLayer.parentElement === this.container) return;
    const canvas = document.createElement("canvas");
    canvas.className = "enhanced-graph-marker-layer";
    canvas.setAttribute("aria-hidden", "true");
    this.container.appendChild(canvas);
    this.markerLayer = canvas;
  }

  private drawMarkers(): void {
    const canvas = this.markerLayer;
    const sigma = this.sigma;
    if (!canvas || !sigma) return;

    const { width, height } = sigma.getDimensions();
    if (width <= 0 || height <= 0) return;

    const ratio = window.devicePixelRatio || 1;
    const backingWidth = Math.round(width * ratio);
    const backingHeight = Math.round(height * ratio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const anchors = this.highlight.anchors;
    if (anchors.size === 0) return;

    // Use the same projection sigma uses to draw the hover pill
    // (`framedGraphToViewport` + `scaleSize`). Deriving the radius by projecting
    // `x + size` looks equivalent but is not: sigma scales node sizes by the
    // camera in a way `graphToViewport` does not model, so that produced a ring
    // several times too large and centred slightly off.
    const projection = sigma as unknown as {
      framedGraphToViewport?: (point: { x: number; y: number }) => { x: number; y: number };
      scaleSize?: (size: number) => number;
    };

    for (const nodeId of anchors) {
      const data = sigma.getNodeDisplayData(nodeId);
      if (!data || data.visibility === "hidden" || data.x === undefined || data.y === undefined) continue;
      const centre =
        projection.framedGraphToViewport?.({ x: data.x, y: data.y }) ??
        sigma.graphToViewport({ x: data.x, y: data.y });
      const radius = (projection.scaleSize?.(data.size ?? 8) ?? data.size ?? 8) + 3;

      // Two rings: a dark halo so the marker reads against a bright node, and a
      // bright ring so it reads against a dark one.
      context.beginPath();
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      context.lineWidth = 5;
      context.strokeStyle = this.palette.markerRingHalo;
      context.stroke();

      context.beginPath();
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = this.palette.markerRing;
      context.stroke();
    }
  }

  clearHighlight(): void {
    this.setHighlight(EMPTY_HIGHLIGHT);
  }

  setOptions(options: Partial<RendererOptions>): void {
    const next = { ...this.options, ...options };
    const colorModeChanged = next.colorMode !== this.options.colorMode;
    // The override maps are replaced wholesale on every edit, so a reference
    // check is enough — and it has to be here: a per-type or per-cluster colour
    // that changes without a colour-mode change still needs a repaint.
    const colorChanged =
      colorModeChanged ||
      next.customNodeColor !== this.options.customNodeColor ||
      next.typeColorOverrides !== this.options.typeColorOverrides ||
      next.communityColorOverrides !== this.options.communityColorOverrides;
    const labelsChanged = next.showLabels !== this.options.showLabels;
    const sizeChanged = next.nodeCount !== this.options.nodeCount;
    // Label look is cheap to change: a sigma setting plus a redraw, no rebuild.
    const labelLookChanged =
      next.labelSize !== this.options.labelSize ||
      next.labelColor !== this.options.labelColor ||
      next.autoHideLabels !== this.options.autoHideLabels;
    this.options = next;
    if (labelsChanged) this.sigma?.setSetting("renderLabels", next.showLabels);
    if (colorChanged) this.applyColorMode();
    if (labelLookChanged) this.sigma?.setSettings(this.labelSettings(next));
    if (sizeChanged) {
      // Label density AND the hide-on-move behaviour both depend on graph size.
      const labels = labelTuning(next.nodeCount);
      const move = movePerformanceFlags(next.nodeCount);
      this.sigma?.setSettings({
        labelDensity: labels.density,
        labelRenderedSizeThreshold: this.thresholdFor(next),
        hideEdgesOnMove: move.hideEdgesOnMove,
        hideLabelsOnMove: move.hideLabelsOnMove,
      });
    }
    this.sigma?.refresh();
  }

  /**
   * The label look, as sigma settings.
   *
   * Only the *culling* is still a global setting. Label size and colour became
   * per-node display fields in v4, so changing those is a matter of re-running
   * the reducers (`refresh`), not of writing a setting.
   */
  private labelSettings(options: RendererOptions): Record<string, unknown> {
    return {
      labelRenderedSizeThreshold: this.thresholdFor(options),
    };
  }

  private thresholdFor(options: RendererOptions): number {
    return options.autoHideLabels ? labelTuning(options.nodeCount).threshold : 0;
  }

  /** Recolour every node without rebuilding the layout. */
  applyColorMode(): void {
    const graph = this.sigma?.getGraph();
    if (!graph) return;
    graph.forEachNode((node, attributes) => {
      graph.setNodeAttribute(node, "color", this.nodeColor(attributes));
    });
  }

  /** The node colour for the active mode; one definition for every call site. */
  private nodeColor(attributes: GraphNodeAttributes): string {
    return nodeColorForMode({
      colorMode: this.options.colorMode,
      pageType: attributes.pageType,
      community: attributes.community,
      customColor: this.options.customNodeColor,
      typeOverrides: this.options.typeColorOverrides,
      communityOverrides: this.options.communityColorOverrides,
    });
  }

  /** The edge look in force: the theme's ramp, with the user's ends applied. */
  private edgeStyle(): EdgeStyle {
    return resolveEdgeStyle(this.palette.edgeRamp, {
      weakColor: this.options.edgeWeakColor,
      strongColor: this.options.edgeStrongColor,
      weakWidth: this.options.edgeWeakWidth,
      strongWidth: this.options.edgeStrongWidth,
    });
  }

  // -------------------------------------------------------------------------
  // Reducers
  // -------------------------------------------------------------------------

  /**
   * NOTE: sigma v4 differs from v3 in two ways that matter here.
   *
   * 1. The reducer receives the *display* data (already resolved) plus the graph
   *    attributes separately. v3 handed over the raw attributes and **replaced**
   *    the node's data with the return value, which is why the old code had to
   *    spread `{...data}` to avoid losing `x`/`y`. v4 merges the partial back in,
   *    so the spread is not just unnecessary — it would freeze the resolved
   *    display values over the top of sigma's own resolution.
   * 2. Label size and colour are per-node display fields now, not global
   *    settings, so they are emitted from here.
   */
  private reduceNode(
    node: string,
    data: NodeDisplayData,
    attributes: GraphNodeAttributes,
  ): Partial<NodeDisplayData> {
    const result: Partial<NodeDisplayData> = {
      labelColor: this.options.labelColor ?? this.palette.label,
      labelSize: this.options.labelSize,
      // `labelFont` carries the face and weight ONLY — no size. sigma parses it
      // with `parseFontString`, which extracts the weight/style keywords and
      // treats everything after them as the family name; a "600 12px Arial"
      // string therefore makes the family literally "12px Arial, sans-serif",
      // and the label renders in a fallback face at a fallback size. The size
      // travels in `labelSize`.
      labelFont: `600 ${LABEL_FAMILY}`,
    };

    const hovered = this.hoveredNode;
    const highlighted = this.highlight.nodes;
    const hasHover = hovered !== null;
    const hasHighlight = highlighted.size > 0;
    if (!hasHover && !hasHighlight) return result;

    const isHoverNode = node === hovered;
    const isHoverNeighbor = this.hoverNeighbors.has(node);
    const isHighlighted = highlighted.has(node);

    if (isHighlighted) {
      // Emphasised by colour, label and stacking only — deliberately NOT by
      // size. The focus is persistent, so a permanent 1.5× would fight both the
      // √ size encoding and the user's own 节点大小 setting.
      result.labelVisibility = "visible";
      result.zIndex = 10;
    }
    if (isHoverNode) {
      result.size = data.size * 1.45;
      result.labelVisibility = "visible";
      result.zIndex = 11;
      // The hover pill used to be a hand-drawn 2D overlay via
      // `defaultDrawNodeHover`, which v4 removed. It is a backdrop now, which is
      // both less code and correctly clipped/scaled by the renderer.
      result.backdropVisibility = "visible";
      result.backdropColor = this.palette.hoverLabelBackground;
      result.backdropBorderColor = this.palette.hoverLabelBorder;
      result.backdropBorderWidth = 1;
      result.backdropPadding = 3;
      // `label` rather than the default `both`: v4's backdrop wraps the node AND
      // its label into one plate, painting a large square over the node and hiding
      // whatever is beneath — the v3 pill this replaces sat behind the label only.
      result.backdropArea = "label";
      result.backdropCornerRadius = 9;
      result.backdropShadowColor = this.palette.hoverLabelShadow;
      result.backdropShadowBlur = 10;
    }

    const dimmedByHover = hasHover && !isHoverNode && !isHoverNeighbor;
    const dimmedByHighlight = hasHighlight && !isHighlighted;
    if (dimmedByHover || dimmedByHighlight) {
      result.color = mixColor(data.color, this.palette.mutedNodeMixTarget, this.palette.mutedNodeMixRatio);
      result.size = data.size * 0.8;
      result.label = "";
      result.zIndex = 0;
    }
    return result;
  }

  /** Same v4 contract as {@link reduceNode}: partial merge, attributes separate. */
  private reduceEdge(
    edge: string,
    data: EdgeDisplayData,
    attributes: GraphEdgeAttributes,
  ): Partial<EdgeDisplayData> {
    // Colour and width both depend on the theme and on the user's two ends, so
    // both are applied here rather than when the graph is built: a change
    // re-runs the reducer instead of rebuilding every edge attribute.
    const style = this.edgeStyle();
    const strength = edgeColorForWeight(attributes.normalizedWeight, style);
    const width = edgeWidthForWeight(attributes.normalizedWeight, style);
    const result: Partial<EdgeDisplayData> = {
      size: width,
      color: hexToRgba(strength, attributes.baseAlpha),
    };
    void edge;
    const source = attributes.sourceNode;
    const target = attributes.targetNode;
    const hovered = this.hoveredNode;
    const hasHover = hovered !== null;
    const hasHighlight = this.highlight.nodes.size > 0;

    const incident = hasHover && (source === hovered || target === hovered);
    const highlightedEdge =
      hasHighlight && this.highlight.nodes.has(source) && this.highlight.nodes.has(target);

    if (!hasHover && !hasHighlight) return result;

    if (incident || highlightedEdge) {
      // Keep the weight colour, take it to full opacity and thicken it: the
      // weak→strong ramp stays readable while the hovered neighbourhood pops.
      result.color = hexToRgba(strength, 1);
      result.size = width * 2.2;
      result.zIndex = 5;
      return result;
    }

    if (hasHover) {
      result.color = hexToRgba("#64748b", this.isDark() ? 0.05 : 0.08);
      result.size = 0.3;
      return result;
    }

    result.color = hexToRgba("#64748b", this.isDark() ? 0.08 : 0.12);
    result.size = 0.3;
    return result;
  }


  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private bindEvents(): void {
    const sigma = this.sigma;
    if (!sigma) return;

    this.mountMarkerLayer();
    sigma.on("afterRender", () => this.drawMarkers());

    // ---------------------------------------------------------------------
    // Click vs drag
    //
    // Only `clickStage` is adjudicated here: clicking empty canvas clears the
    // focus, so releasing a pan must not be mistaken for it.
    //
    // sigma decides by counting `mousemove` events between press and release
    // and discarding the click when there are 3 or more
    // (`draggedEventsTolerance`). An ordinary click with a real hand always
    // produces a few, so real clicks were being thrown away — measured: six
    // 0.5px moves during a press was enough to lose the click entirely.
    //
    // So the tolerance is raised out of the way (it still catches long drags
    // before we ever see the event) and the decision is made here on the thing
    // that actually distinguishes the two gestures: how far the pointer moved.
    // ---------------------------------------------------------------------
    const CLICK_SLOP_PX = 6;
    this.container.addEventListener("pointerdown", (event) => {
      this.pressOrigin = { x: event.clientX, y: event.clientY };
      this.pressTravel = 0;
    });
    this.container.addEventListener("pointermove", (event) => {
      if (!this.pressOrigin) return;
      const travel = Math.hypot(event.clientX - this.pressOrigin.x, event.clientY - this.pressOrigin.y);
      if (travel > this.pressTravel) this.pressTravel = travel;
    });
    /** True when the press that produced this click was really a drag. */
    const wasDrag = (): boolean => this.pressTravel > CLICK_SLOP_PX;

    sigma.on("enterNode", ({ node }) => {
      this.container.style.cursor = "pointer";
      this.hoveredNode = node;
      // Resolved lazily: the view can swap the graph without rebinding events.
      const current = this.sigma?.getGraph();
      this.hoverNeighbors = current ? new Set(current.neighbors(node)) : new Set();
      this.showNodeTooltip(node);
      sigma.refresh();
    });

    sigma.on("leaveNode", () => {
      this.container.style.cursor = "default";
      if (this.hoveredNode === null) return;
      this.hoveredNode = null;
      this.hoverNeighbors = new Set();
      this.hideTooltip();
      sigma.refresh();
    });

    sigma.on("enterEdge", ({ edge }) => {
      this.showEdgeTooltip(edge);
    });

    sigma.on("leaveEdge", () => {
      if (this.hoveredNode) this.showNodeTooltip(this.hoveredNode);
      else this.hideTooltip();
    });

    sigma.on("doubleClickNode", (payload) => {
      payload.preventSigmaDefault();
      this.callbacks.onNodeDoubleClick?.(payload.node);
    });
    sigma.on("rightClickNode", (payload) => {
      payload.preventSigmaDefault();
      const event = payload.event.original;
      event.preventDefault();
      const point = clientPoint(event);
      this.callbacks.onNodeContextMenu?.(payload.node, point.x, point.y);
    });
    sigma.on("clickStage", () => {
      if (wasDrag()) return;
      this.callbacks.onStageClick?.();
    });
    sigma.on("rightClickStage", (payload) => {
      payload.preventSigmaDefault();
      payload.event.original.preventDefault();
      const point = clientPoint(payload.event.original);
      this.callbacks.onStageContextMenu?.(point.x, point.y);
    });
    sigma.on("moveBody", (payload) => {
      const point = clientPoint(payload.event.original);
      this.moveTooltip(point.x, point.y);
    });
  }

  // -------------------------------------------------------------------------
  // Tooltip
  // -------------------------------------------------------------------------

  private buildTooltip(): void {
    const tooltip = document.createElement("div");
    tooltip.addClass("enhanced-graph-tooltip");
    tooltip.style.display = "none";
    this.container.appendChild(tooltip);
    this.tooltip = tooltip;
  }

  private showNodeTooltip(nodeId: string): void {
    const graph = this.sigma?.getGraph();
    if (!graph) return;
    const attributes = graph.getNodeAttributes(nodeId);
    if (!attributes) return;
    if (!this.tooltip) return;
    const labels = this.callbacks.labels;

    const tooltip = this.tooltip;
    tooltip.empty();
    const header = tooltip.createDiv({ cls: "enhanced-graph-tooltip-title" });
    header.setText(attributes.pageTitle || attributes.label);

    const meta = tooltip.createDiv({ cls: "enhanced-graph-tooltip-meta" });
    meta.setText(`${labels.links}: ${attributes.linkCount} · ${labels.community}: ${attributes.community}`);

    const incident = this.callbacks.describeIncidentEdges?.(nodeId, 5) ?? [];
    if (incident.length > 0) {
      const list = tooltip.createDiv({ cls: "enhanced-graph-tooltip-scores" });
      for (const summary of incident) {
        const row = list.createDiv({ cls: "enhanced-graph-tooltip-row" });
        const other = summary.sourceLabel === (attributes.pageTitle || attributes.label)
          ? summary.targetLabel
          : summary.sourceLabel;
        row.createSpan({ cls: "enhanced-graph-tooltip-name", text: other });
        row.createSpan({
          cls: "enhanced-graph-tooltip-value",
          text: formatScore(summary.weight),
        });
      }
    }
    this.showTooltip();
  }

  private showEdgeTooltip(edgeKey: string): void {
    if (!this.tooltip) return;
    const summary = this.callbacks.describeEdge?.(edgeKey);
    if (!summary) {
      this.hideTooltip();
      return;
    }
    const labels = this.callbacks.labels;
    const tooltip = this.tooltip;
    tooltip.empty();

    tooltip
      .createDiv({ cls: "enhanced-graph-tooltip-title" })
      .setText(`${summary.sourceLabel} ↔ ${summary.targetLabel}`);

    const score = tooltip.createDiv({ cls: "enhanced-graph-tooltip-score" });
    score.createSpan({ text: `${labels.score} ` });
    score.createSpan({ cls: "enhanced-graph-tooltip-value", text: formatScore(summary.weight) });

    const table = tooltip.createDiv({ cls: "enhanced-graph-tooltip-table" });
    // Every row is a share of the score, so they can be read against each other.
    // Type affinity is not here: it decides ties rather than contributing, and
    // showing it beside the real signals was the thing that made this table lie.
    const rows: Array<[string, number]> = [
      [labels.direct, summary.directLink],
      [labels.adamicAdar, summary.adamicAdar],
      [labels.sources, summary.sourceOverlap],
      [labels.coCitation, summary.coCitation],
    ];
    for (const [label, value] of rows) {
      const row = table.createDiv({ cls: `enhanced-graph-tooltip-row${value > 0 ? "" : " is-zero"}` });
      row.createSpan({ cls: "enhanced-graph-tooltip-name", text: label });
      row.createSpan({ cls: "enhanced-graph-tooltip-value", text: value.toFixed(2) });
    }

    if (summary.sharedSources.length > 0) {
      tooltip
        .createDiv({ cls: "enhanced-graph-tooltip-meta" })
        .setText(labels.sources.replace(/[：:]$/, "") + ": " + summary.sharedSources.join("、"));
    }
    this.showTooltip();
  }

  private showTooltip(): void {
    if (!this.tooltip) return;
    this.tooltipVisible = true;
    this.tooltip.style.display = "block";
    this.positionTooltip();
  }

  private hideTooltip(): void {
    if (!this.tooltip) return;
    this.tooltipVisible = false;
    this.tooltip.style.display = "none";
  }

  private moveTooltip(clientX: number, clientY: number): void {
    this.pointer = { x: clientX, y: clientY };
    if (!this.tooltipVisible) return;
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = 0;
      this.positionTooltip();
    });
  }

  private positionTooltip(): void {
    if (!this.tooltip || !this.tooltipVisible) return;
    const bounds = this.container.getBoundingClientRect();
    const x = this.pointer.x - bounds.left + 14;
    const y = this.pointer.y - bounds.top + 14;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  /** Called from the container's mousemove; keeps the tooltip under the cursor. */
  trackPointer(clientX: number, clientY: number): void {
    this.moveTooltip(clientX, clientY);
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  zoomIn(): void {
    void this.sigma?.getCamera().zoomIn({ factor: 1.5, duration: 220 });
  }

  zoomOut(): void {
    void this.sigma?.getCamera().zoomOut({ factor: 1.5, duration: 220 });
  }

  /** Fit the whole graph into the viewport. */
  fit(): void {
    const sigma = this.sigma;
    if (!sigma) return;
    sigma.setCustomBBox(null);
    sigma.refresh();
    void sigma.getCamera().reset({ duration: 320 });
  }

  /** Screen position (relative to the container) of a node, or null. */
  nodeViewportPosition(nodeId: string): { x: number; y: number } | null {
    const sigma = this.sigma;
    if (!sigma) return null;
    const graph = sigma.getGraph();
    if (!graph.hasNode(nodeId)) return null;
    const x = graph.getNodeAttribute(nodeId, "x") as number;
    const y = graph.getNodeAttribute(nodeId, "y") as number;
    // `graphToViewport` takes the RAW `x`/`y` graph attributes. Do not be tempted
    // to pass the display data's `x`/`y` instead: those are normalised to a
    // different range, and doing so moves every computed position by hundreds of
    // pixels. (Tried it; a grid scan of sigma's own hit test showed the raw
    // attributes land exactly on the node and the display pair does not.)
    const position = sigma.graphToViewport({ x, y });
    const dimensions = sigma.getDimensions();
    if (dimensions.width === 0 || dimensions.height === 0) return null;
    return {
      x: (position.x / dimensions.width) * this.container.clientWidth,
      y: (position.y / dimensions.height) * this.container.clientHeight,
    };
  }

  /** Centre the camera on a node without changing the zoom level. */
  focusNode(nodeId: string): void {
    const sigma = this.sigma;
    if (!sigma) return;
    const graph = sigma.getGraph();
    if (!graph.hasNode(nodeId)) return;
    const x = graph.getNodeAttribute(nodeId, "x") as number;
    const y = graph.getNodeAttribute(nodeId, "y") as number;
    const position = sigma.graphToViewport({ x, y });
    const dimensions = sigma.getDimensions();
    void sigma.getCamera().animate(
      { x: position.x / dimensions.width, y: position.y / dimensions.height },
      { duration: 300 },
    );
  }

  refresh(): void {
    this.sigma?.refresh();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatScore(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
  }
  const mouse = event as MouseEvent;
  return { x: mouse.clientX ?? 0, y: mouse.clientY ?? 0 };
}

/** Label density/threshold tuning by graph size, from the reference. */
export { labelTuning, movePerformanceFlags } from "./tuning";


/** Build the sigma-facing attributes for one node. */
export function toNodeAttributes(input: {
  x: number;
  y: number;
  linkCount: number;
  maxLinkCount: number;
  nodeCount: number;
  nodeScale: number;
  pageType: string;
  pageTitle: string;
  nodePath: string;
  community: number;
  colorMode: ColorMode;
  label: string;
}): GraphNodeAttributes {
  return {
    x: input.x,
    y: input.y,
    size: nodeSize(input.linkCount, input.maxLinkCount, input.nodeCount, input.nodeScale),
    color: input.colorMode === "community" ? communityColor(input.community) : typeColor(input.pageType),
    label: input.label,
    pageType: input.pageType,
    pageTitle: input.pageTitle,
    nodePath: input.nodePath,
    linkCount: input.linkCount,
    community: input.community,
  };
}

/** Build the sigma-facing attributes for one edge. */
export function toEdgeAttributes(input: {
  source: string;
  target: string;
  weight: number;
  normalizedWeight: number;
  label: string;
}): GraphEdgeAttributes {
  return {
    // Reference width only: `reduceEdge` assigns the user's real width, which is
    // theme- and setting-dependent.
    size: edgeWidthForWeight(input.normalizedWeight, DEFAULT_EDGE_WIDTHS),
    // Placeholder only: `reduceEdge` assigns the real colour, because the ramp
    // depends on the theme and the reducer is re-run on every theme change.
    color: "rgba(0,0,0,0)",
    weight: input.weight,
    normalizedWeight: input.normalizedWeight,
    baseAlpha: edgeAlphaForWeight(input.normalizedWeight),
    sourceNode: input.source,
    targetNode: input.target,
    label: input.label,
  };
}
