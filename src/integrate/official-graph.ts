/**
 * Layers the enhanced-graph engine onto Obsidian's **built-in** graph view.
 *
 * This module owns the *behaviour* — when to attach, how to colour, when to
 * restore. The two presentational halves live next door: the hover card in
 * `./official-hover` and the side panel in `./official-panel`. Neither imports
 * this module, and the state only the panel cares about (collapse, active ids)
 * never passes through here.
 *
 * It owns none of the *knowledge* about Obsidian's internals either: every
 * fragile field name and structural type comes from `./official-internals`,
 * which is the one file to edit when Obsidian changes.
 *
 * Design rules, in priority order:
 *  1. **Never break the official graph.** Everything is feature-detected and
 *     wrapped in try/catch; a missing seam disables that feature only.
 *  2. **Never own the render loop.** We do not patch `renderCallback`; we hook
 *     `setData` (the one deterministic update point) plus a slow safety-net
 *     timer, and rely on the official renderer reading `node.color` every frame.
 *  3. **Leave no trace.** Colouring goes through the same `node.color` field the
 *     official colour groups use, and the original value is stashed on the node
 *     so `stop()` restores it exactly.
 */

import { App, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type { GraphInsights } from "../core/insights";
import { edgeKey, edgeKeyEndpoints } from "../core/graph-keys";
import { findConnectingPaths } from "../core/paths";
import { type FilterSection, renderFilters } from "../view/graph-filters";
import { renderClustering } from "../view/graph-clustering";
import { collectTags, filterNodes, type TagFilterMode, type VisibilityFilters } from "../view/visibility";
import { isInWorkspace } from "../core/workspace";
import type { GraphNode, OfficialGraphMode, RelevanceWeights, WikiGraph } from "../types";
import { t } from "../i18n";
import { countUndismissed } from "../view/insights-panel";
import { communityColor, hexToRgbInt, themePalette, typeColor } from "../view/palette";
import { OfficialHoverTooltip, type HoverTooltipOptions } from "./official-hover";
import { OfficialLegend } from "./official-legend";
import { OfficialMarkerLayer, type MarkerLine, type MarkerPoint } from "./official-markers";
import { OfficialToolbar } from "./official-toolbar";
import { OfficialSidePanel, type OfficialPanelOptions, type PanelTab } from "./official-panel";
import {
  createNodeResolver,
  officialNodes,
  officialRendererOf,
  officialViewOf,
  OFFICIAL_GRAPH_VIEW_TYPES,
  type NodeResolver,
  type OfficialColor,
  type OfficialNode,
  type OfficialRenderer,
} from "./official-internals";

export { probeOfficialGraph, OFFICIAL_GRAPH_VIEW_TYPES } from "./official-internals";

/**
 * The `source` Obsidian passes when it opens a built-in graph node's context
 * menu. Verified against the shipped app: `onNodeRightClick` fires
 * `workspace.trigger("file-menu", menu, file, "graph-context-menu", leaf)`
 * before showing the menu, so plugins can contribute items through that public
 * event instead of replacing the handler.
 */
export const GRAPH_MENU_SOURCE = "graph-context-menu";

/**
 * Alpha multiplier for nodes outside the focus set.
 *
 * Pushed down from 0.18 after the focused route proved hard to pick out. The lit
 * edges were already at full alpha, so the only lever left was contrast: the
 * route reads as a route because everything else recedes, not because the route
 * itself can get any brighter.
 */
const FOCUS_NODE_DIM = 0.12;
/**
 * Alpha multiplier applied to every edge while something is focused.
 *
 * Exported so the test asserts the mechanism against this value instead of
 * hard-coding it.
 *
 * The same reasoning as `FOCUS_NODE_DIM`. 0.2 left the surrounding mesh visible
 * enough to compete with the lit path; at 0.05 the lit edges are the only ones
 * with any presence, and the shape of the route is what the eye follows.
 */
export const FOCUS_EDGE_DRAWN = 0.10;
/**
 * Radius of the focus marker, in CSS pixels.
 *
 * Ours rather than the node's. Four attempts to derive the node's drawn radius
 * were each contradicted by what was on screen — it is not readable from
 * \`nodeLookup\` — and a marker pinned at the centre never needed it.
 */
export const MARKER_RADIUS_PX = 6;
/** Shown in the line-colour picker while the theme's own colour is in use. */
const LINE_COLOR_FALLBACK = "#888888";
/**
 * The link render animates its alpha toward a target: `alpha = alpha*0.9 + c*0.1`.
 *
 * Writing `alpha` back every frame therefore holds the drawn value at
 * `written*0.9 + c*0.1`. Inverting that gives the value to write for a fully
 * bright edge — which is how the route keeps its own edges lit without
 * overriding any of Obsidian's drawing code.
 */
const EDGE_ALPHA_LERP = 0.9;
export type { OfficialGraphProbe, NodeResolver } from "./official-internals";

// ---------------------------------------------------------------------------
// Extension slots and constants
// ---------------------------------------------------------------------------

/** Property the original colour is stashed under, so restore needs no bookkeeping. */
const ORIGINAL_COLOR = Symbol.for("enhanced-graph.official.originalColor");
/** Marks a `setData` wrapper so double-attaching is impossible. */
const WRAPPED_SET_DATA = Symbol.for("enhanced-graph.official.wrappedSetData");

/** How often the safety-net pass re-checks for uncoloured nodes. */
/** Exported so tests can drive the safety-net pass without hard-coding it. */
export const SAFETY_NET_MS = 1200;

/** A node that also carries our restore slot. */
type NodeWithRestore = OfficialNode & { [ORIGINAL_COLOR]?: OfficialColor | null };
/** A renderer that also carries our idempotency marker. */
type RendererWithMarker = OfficialRenderer & { [WRAPPED_SET_DATA]?: boolean };

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function sameOfficialColor(a: OfficialColor | null | undefined, b: OfficialColor): boolean {
  if (!a) return false;
  return a.a === b.a && a.rgb === b.rgb;
}

/** Live nodes, widened with our colour-restore slot. */
function nodesWithRestore(renderer: OfficialRenderer): NodeWithRestore[] {
  return officialNodes(renderer) as NodeWithRestore[];
}

// ---------------------------------------------------------------------------
// Enhancer
// ---------------------------------------------------------------------------

export interface OfficialGraphDeps {
  readonly app: App;
  /** Current graph snapshot; called lazily so we never hold stale data. */
  readonly getData: () => { graph: WikiGraph; insights: GraphInsights };
  readonly getMode: () => OfficialGraphMode;
  readonly getDismissed: () => readonly string[];
  readonly onDismiss: (key: string, nodeIds: readonly string[]) => Promise<void> | void;
  /** Open a note by our node id (vault path without the extension). */
  readonly onOpenNode: (nodeId: string) => void;
  /**
   * Visibility filters, shared with the standalone view.
   *
   * The official graph is filtered with the very same predicate the standalone
   * view uses (`isNodeVisible`), so the two can never disagree about what is
   * hidden.
   */
  readonly getVisibility: () => VisibilityFilters;
  readonly onSetVisibility: (patch: Partial<Record<string, unknown>>) => Promise<void> | void;
  /** Colour overrides, shared with the standalone view so both agree. */
  readonly getTypeColors: () => Readonly<Record<string, string>>;
  readonly getCommunityColors: () => Readonly<Record<string, string>>;
  readonly onSetTypeColor: (type: string, color: string | null) => Promise<void> | void;
  readonly onSetCommunityColor: (community: number, color: string | null) => Promise<void> | void;
  readonly onSetLineColor: (color: string | null) => Promise<void> | void;
  /** Toolbar actions. */
  readonly onSetMode: (mode: OfficialGraphMode) => Promise<void> | void;
  /** Relevance coefficients, read for the scoring the graph itself displays. */
  readonly getWeights: () => RelevanceWeights;
  /** Chosen line colour, or null to keep the theme's. */
  readonly getLineColor: () => string | null;
  /** Hop budget for routes between focused notes; shared with the standalone view. */
  readonly getFocusIntermediates: () => number;
  readonly onSetFocusIntermediates: (intermediates: number) => Promise<void> | void;
  /** Page types the user has hidden; shared with the standalone view. */
  readonly getHiddenTypes: () => readonly string[];
  /** Hide or show a page type, from the graph's own context menu. */
  readonly onToggleType: (pageType: string) => Promise<void> | void;
  /** Whether the ticked tags are hidden or kept; shared with the standalone view. */
  readonly getTagFilterMode: () => TagFilterMode;
  /**
   * The workspace: the folder being read and the folders left out of it.
   *
   * Shared with the standalone view and the settings, and unlike the visibility
   * filters it changes which notes are read at all — so it is applied by
   * {@link onApplyWorkspace}, which writes the settings and rebuilds.
   */
  readonly getWorkspace: () => { readonly folder: string; readonly excluded: readonly string[] };
  readonly onApplyWorkspace: (folder: string, excluded: readonly string[]) => Promise<void> | void;
  /**
   * What the clustering is made of right now: the association coefficients and
   * Louvain's resolution. Both are build inputs, shared with the standalone view.
   */
  readonly getClustering: () => { readonly weights: RelevanceWeights; readonly resolution: number };
  readonly onApplyClustering: (choice: {
    readonly weights: RelevanceWeights;
    readonly resolution: number;
  }) => Promise<void> | void;
}

interface Attachment {
  readonly viewType: string;
  renderer: OfficialRenderer;
  originalHover: OfficialRenderer["onNodeHover"];
  originalUnhover: OfficialRenderer["onNodeUnhover"];
  originalSetData: OfficialRenderer["setData"];
  /** True when `setData` was an own property; false means it came from the prototype. */
  setDataWasOwn: boolean;
  panel: OfficialSidePanel;
  tooltip: OfficialHoverTooltip;
  legend: OfficialLegend;
  markers: OfficialMarkerLayer;
  /**
   * Holds the toolbar and the panel in one flow.
   *
   * Positioning them independently meant guessing the toolbar's height, and the
   * panel overlapped it as soon as the toolbar grew — a search that matches
   * nothing adds a line, and a narrow view wraps it.
   */
  overlay: HTMLElement;
  toolbar: OfficialToolbar;
  /** The engine behind this graph, when it exposes one. */
  engine: { render?: () => void } | null;
  syncTimer: number | null;
  /**
   * The `insights` object the panel was last rendered from.
   *
   * Held so `tick()` can tell when a build has finished and redraw the panel —
   * at attach time the plugin's graph is usually still empty, so the insights
   * card list would otherwise stay blank.
   */
  lastInsights: GraphInsights | null;
  /**
   * How many notes were focused when the panel was last drawn.
   *
   * The focus-range control only exists while two or more are focused, and the
   * panel was previously repainted only when the insights changed. Focusing a
   * second note therefore left the control missing until something unrelated
   * caused a repaint — the control looked like it appeared and disappeared at
   * random.
   */
  lastFocusCount: number;
  /**
   * The payload of the last `setData` call. Kept so that changing a filter can
   * re-apply it: the built-in engine has no idea our filter changed and would
   * otherwise not push new data until the vault does.
   */
  lastData: unknown;
  /** Theme edge colours, stashed before overriding so they can be restored. */
  originalEdgeColor: { line?: OfficialColor; lineHighlight?: OfficialColor };
  /**
   * The line colour the plugin has written into the graph's shared edge colours,
   * or `null` while it has written none.
   *
   * With no colour chosen, those objects belong to the built-in graph and the
   * theme rewrites them; the plugin must leave them alone. This is what tells the
   * two states apart, so clearing a chosen colour still puts the theme's back
   * while a plain theme switch is not undone.
   */
  ownedLineColor: string | null;
}

export class OfficialGraphEnhancer {
  private readonly attachments = new Map<number, Attachment>();
  private safetyTimer: number | null = null;
  private started = false;
  /** Per-snapshot adjacency, so hover stays O(deg) instead of O(E). */
  private neighbourCache: { graph: WikiGraph; map: Map<string, Array<{ id: string; weight: number }>> } | null = null;
  /** Per-snapshot id folding, for the same reason: hover must not rebuild it. */
  private resolverCache: { graph: WikiGraph; resolve: NodeResolver } | null = null;
  /** Toolbar state: the search box and which panel is open. */
  private searchQuery = "";
  /**
   * Which panel the toolbar has open.
   *
   * Starts on the insights because that is what the panel shows before anything
   * is clicked: the toolbar has to agree with it, or its highlight lies.
   */
  private panelMode: "none" | "insights" | "filters" | "appearance" | "clustering" = "insights";

  /**
   * Nodes the user asked to focus, per renderer.
   *
   * The built-in graph dims by `getHighlightNode()`, which holds exactly ONE
   * node — it cannot express "these two notes and the route between them". So
   * the focus is expressed through `node.color.a` instead: the render multiplies
   * that into each node's alpha (`v = fadeAlpha * color.a`), which gives us a
   * per-node lever for an arbitrary set while leaving Obsidian's drawing alone.
   *
   * The consequence is that EDGES cannot be dimmed selectively — their alpha is
   * derived solely from the single highlight node — so a focus dims all edges
   * together and lets the bright nodes carry the shape of the route.
   */
  private readonly focusIds = new Map<OfficialRenderer, Set<string>>();
  /** Keeps the marker canvas in step with the camera; see `marksAreDrawn`. */
  private markerTicker: number | null = null;
  /** Re-applies the focus the moment the window becomes visible again. */
  private visibilityHandler: (() => void) | null = null;
  /** Filter group the user is looking at, in the built-in graph's panel. */
  private filterSection: FilterSection = "types";
  /**
   * Edges of the focused route, as `edgeKey` strings rather than link graphics.
   *
   * It used to hold the `line` objects, and `forceLitEdges` matched them against
   * `renderer.links` by reference. That silently broke whenever the graph was
   * rebuilt: the objects reachable through `nodeLookup[..].forward[..]` come from
   * one `setData` and `renderer.links` holds another, so almost nothing matched.
   * Measured in a real vault: 49 edges collected, **2** ended up lit.
   *
   * A key is stable across rebuilds; the graphics object is resolved fresh each
   * frame instead.
   */
  private readonly litEdges = new Map<OfficialRenderer, Set<string>>();

  constructor(private readonly deps: OfficialGraphDeps) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sync();
    if (typeof window !== "undefined") {
      this.safetyTimer = window.setInterval(() => this.tick(), SAFETY_NET_MS);
      // Browsers do not run requestAnimationFrame while the window is hidden, and
      // the focus ticker is built on it. Any repaint during that time resets the
      // link alphas to the renderer's own values, so the highlight came back
      // missing its edges while the nodes — dimmed once, not per frame — stayed
      // bright. Measured: stopping the ticker and forcing one repaint moved the
      // lit count from 38 to 542, i.e. the edges lost their highlight entirely.
      //
      // Re-applying on the way back in closes that window without waiting for a
      // frame that may not come.
      this.visibilityHandler = () => {
        if (typeof document !== "undefined" && document.hidden) return;
        this.reapplyMarks();
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("focus", this.visibilityHandler);
    }
  }

  stop(): void {
    this.started = false;
    if (this.visibilityHandler) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.visibilityHandler);
      if (typeof window !== "undefined") window.removeEventListener("focus", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.safetyTimer !== null) {
      window.clearInterval(this.safetyTimer);
      this.safetyTimer = null;
    }
    this.clearAllFocus();
    for (const attachment of [...this.attachments.values()]) this.detach(attachment);
    this.attachments.clear();
  }

  /** Attach to any open official graph leaf, detach from leaves that closed. */
  sync(): void {
    if (!this.started) return;
    const alive = new Set<number>();
    for (const viewType of OFFICIAL_GRAPH_VIEW_TYPES) {
      for (const leaf of this.deps.app.workspace.getLeavesOfType(viewType)) {
        const key = leafKey(leaf);
        const renderer = officialRendererOf(leaf);
        // A closed or reshaped view means the renderer object is gone; drop the
        // attachment and let the next tick re-create it if the leaf comes back.
        const existing = this.attachments.get(key);
        if (!renderer || !renderer.containerEl) {
          if (existing) {
            this.detach(existing);
            this.attachments.delete(key);
          }
          continue;
        }
        if (existing && existing.renderer === renderer) {
          alive.add(key);
          continue;
        }
        if (existing) this.detach(existing);
        const view = officialViewOf(leaf);
        const engine = view?.dataEngine ?? view?.engine ?? null;
        const attachment = this.attach(viewType, renderer, engine);
        if (attachment) {
          this.attachments.set(key, attachment);
          alive.add(key);
        }
      }
    }
    for (const [key, attachment] of [...this.attachments]) {
      if (!alive.has(key)) {
        this.detach(attachment);
        this.attachments.delete(key);
      }
    }
  }

  /** Re-render the chrome and recolour after settings or graph data changed. */
  refresh(): void {
    for (const attachment of this.attachments.values()) {
      const { renderer } = attachment;
      this.applyColors(attachment);
      attachment.panel.render();
      // The toolbar carries the state of what is on: without this the graph
      // recoloured but the active toggle stayed on the old mode.
      attachment.toolbar.render();
      attachment.legend.render();
      // Filters are applied inside the `setData` wrapper, so changing one does
      // nothing until the data goes through again: the engine has no idea our
      // settings moved and would only refresh when the vault does.
      if (typeof attachment.engine?.render === "function") {
        // Ask the engine for a fresh payload. Re-applying the one we captured only
        // works if we ever captured one, and we attach AFTER the graph has already
        // rendered — so `lastData` is null until the vault next changes, and the
        // filters silently did nothing until then.
        try {
          attachment.engine.render();
        } catch (error) {
          console.error("[enhanced-graph] asking the built-in graph to re-render failed:", error);
        }
      } else if (attachment.lastData != null && typeof renderer.setData === "function") {
        try {
          renderer.setData(attachment.lastData);
        } catch (error) {
          console.error("[enhanced-graph] re-applying the built-in graph data failed:", error);
        }
      }
      // Colours live on `node.color`, which the render loop reads per frame — so
      // writing them changes nothing until something asks for a frame. Without
      // this the new colours only appeared once an unrelated click woke the loop.
      renderer.changed?.();
    }
  }

  /** Cheap periodic pass: catches replace-in-place updates we did not hook. */
  private tick(): void {
    this.sync();
    // Read once per pass, not once per attachment: `getData()` builds a fresh
    // wrapper object every call, so comparing the wrapper would always differ.
    // The `insights` inside it is the stable reference that changes only when a
    // build finishes.
    const { insights } = this.deps.getData();
    for (const attachment of this.attachments.values()) {
      this.applyColors(attachment);
      // The panel is drawn from the graph data, which is usually NOT ready when
      // the view is first attached — the plugin is still building, and the
      // insights arrive afterwards. Nothing else re-rendered the panel on that
      // transition, so it stayed blank until an unrelated action (switching the
      // colour mode) forced a refresh.
      const focusCount = this.focusIds.get(attachment.renderer)?.size ?? 0;
      if (attachment.lastInsights !== insights || attachment.lastFocusCount !== focusCount) {
        attachment.lastInsights = insights;
        attachment.lastFocusCount = focusCount;
        attachment.panel.render();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Attach / detach
  // -------------------------------------------------------------------------

  private attach(
    viewType: string,
    renderer: OfficialRenderer,
    engine: { render?: () => void } | null,
  ): Attachment | null {
    const containerEl = renderer.containerEl;
    if (!containerEl) return null;
    try {
      const overlay = containerEl.createDiv({ cls: "enhanced-graph-official-overlay" });
      const attachment: Attachment = {
        viewType,
        overlay,
        renderer,
        engine,
        originalHover: renderer.onNodeHover ?? null,
        originalUnhover: renderer.onNodeUnhover ?? null,
        originalSetData: renderer.setData,
        setDataWasOwn: false,
        panel: new OfficialSidePanel(overlay, this.panelOptions(renderer)),
        tooltip: new OfficialHoverTooltip(containerEl, this.hoverOptions()),
        legend: new OfficialLegend(containerEl, () => this.legendOptions()),
        markers: new OfficialMarkerLayer(containerEl),
        toolbar: new OfficialToolbar(overlay, this.toolbarOptions(renderer)),
        syncTimer: null,
        lastData: null,
        /** The insights the panel currently shows; see `tick()`. */
        lastInsights: null,
      lastFocusCount: 0,
        originalEdgeColor: {},
        ownedLineColor: null,
      };

      // Toolbar first. Both live in the overlay, which is a flex COLUMN, so DOM
      // order is visual order — mounting the panel first put it above the toolbar
      // and pushed the bar to the bottom of the view. (It did not matter while
      // the two were positioned independently, which is how this survived.)
      attachment.toolbar.mount();
      attachment.panel.mount();
      attachment.tooltip.mount();
      attachment.markers.mount();
      attachment.legend.mount();
      attachment.legend.render();
      attachment.toolbar.render();
      this.wrapSetData(attachment);
      this.wrapHover(attachment);
      this.applyColors(attachment);
      attachment.panel.render();
      return attachment;
    } catch (error) {
      console.error("[enhanced-graph] could not attach to the built-in graph view:", error);
      return null;
    }
  }

  private detach(attachment: Attachment): void {
    const { renderer } = attachment;
    try {
      // Restore colours first: this is the only change the user can see.
      this.restoreLineColor(attachment);
      for (const node of nodesWithRestore(renderer)) {
        const original = node[ORIGINAL_COLOR];
        if (original === undefined) continue;
        if (original === null) delete node.color;
        else node.color = original;
        delete node[ORIGINAL_COLOR];
      }
      if (attachment.originalHover !== undefined) renderer.onNodeHover = attachment.originalHover;
      if (attachment.originalUnhover !== undefined) renderer.onNodeUnhover = attachment.originalUnhover;
      if ((renderer as RendererWithMarker)[WRAPPED_SET_DATA] && typeof attachment.originalSetData === "function") {
        if (attachment.setDataWasOwn) renderer.setData = attachment.originalSetData;
        else delete renderer.setData;
        delete (renderer as RendererWithMarker)[WRAPPED_SET_DATA];
      }
      this.focusIds.delete(renderer);
      this.syncMarkerTicker();
      if (renderer.highlightNode) renderer.highlightNode = null;
      renderer.changed?.();
    } catch (error) {
      console.error("[enhanced-graph] failed to restore the built-in graph view:", error);
    } finally {
      if (attachment.syncTimer !== null) window.clearTimeout(attachment.syncTimer);
      attachment.panel.destroy();
      attachment.tooltip.destroy();
      attachment.toolbar.destroy();
      attachment.legend.destroy();
      attachment.markers.destroy();
      attachment.overlay.remove();
    }
  }

  // -------------------------------------------------------------------------
  // Colouring
  // -------------------------------------------------------------------------

  private applyColors(attachment: Attachment): void {
    const mode = this.deps.getMode();
    const { renderer } = attachment;
    try {
      // The line colour is independent of the node-colouring mode, so it is
      // applied (or restored) before that mode is considered.
      this.applyLineColor(attachment);
      if (mode === "off") {
        // Turning the feature off must give the official colours back at once.
        for (const node of nodesWithRestore(renderer)) {
          const original = node[ORIGINAL_COLOR];
          if (original === undefined) continue;
          if (original === null) delete node.color;
          else node.color = original;
          delete node[ORIGINAL_COLOR];
        }
        return;
      }

      const { graph } = this.deps.getData();
      if (graph.nodes.length === 0) return;
      const resolve = this.resolverFor(graph);
      const focus = this.focusSet(renderer);

      for (const node of nodesWithRestore(renderer)) {
        // Tags, unresolved links and attachments are virtual nodes with no
        // frontmatter, so they keep the official colours.
        const graphNode = resolve(node.id);
        if (!graphNode) continue;

        // `node.color.a` is multiplied into the node's alpha by the renderer,
        // which is what makes an arbitrary focus set expressible at all.
        const wanted: OfficialColor = {
          a: focus && !focus.has(graphNode.id) ? FOCUS_NODE_DIM : 1,
          rgb: hexToRgbInt(this.nodeColorFor(mode, graphNode.community, graphNode.type)),
        };

        if (!(ORIGINAL_COLOR in node)) {
          node[ORIGINAL_COLOR] = node.color ?? null;
        }
        if (!sameOfficialColor(node.color, wanted)) node.color = wanted;
      }
    } catch (error) {
      console.error("[enhanced-graph] community colouring failed:", error);
    }
  }

  /**
   * The colour rows for one tab.
   *
   * Built from what the graph actually contains: a row for a type or community
   * that is not in the vault would be a control that cannot do anything.
   */
  private colorEntries(
    tab: "type" | "community",
  ): Array<{ key: string; label: string; color: string; isOverride: boolean }> {
    const { graph } = this.deps.getData();
    if (tab === "community") {
      const overrides = this.deps.getCommunityColors();
      return graph.communities.map((community) => {
        const key = String(community.id);
        return {
          key,
          label: `#${community.id + 1} (${community.nodeCount})`,
          color: overrides[key] ?? communityColor(community.id),
          isOverride: overrides[key] !== undefined,
        };
      });
    }
    const overrides = this.deps.getTypeColors();
    return [...new Set(graph.nodes.map((node) => node.type))].sort().map((type) => ({
      key: type,
      label: t(`type.${type}` as never),
      color: overrides[type] ?? typeColor(type as Parameters<typeof typeColor>[0]),
      isOverride: overrides[type] !== undefined,
    }));
  }
  /**
   * The filters body, drawn by the standalone view's own renderer.
   *
   * Every switch writes the shared settings, so a filter set here hides the same
   * notes in both views — there is one `isNodeVisible` behind them.
   *
   * The hidden tags are handed over as a LIVE view and the toggles read the
   * settings at the moment they fire, not from the copy this body was built with.
   * The panel is deliberately not re-rendered while one of its controls has focus
   * (a real click focuses the checkbox, and rebuilding the list under the pointer
   * would take the caret out of the search box), so that copy is the only thing
   * this body would ever see: a second uncheck then rewrote the whole set as
   * "the first render's set, plus this one tag" and dropped the tag hidden a
   * moment earlier, and the restore button's "is anything hidden?" test answered
   * from a set that predated every toggle the user had made. Measured: three
   * unchecks in a row left the settings holding one tag while three boxes sat
   * unticked on screen, which is "点击后总是剩下几个没有勾选".
   */
  private renderFiltersBody(el: HTMLElement): void {
    const { graph } = this.deps.getData();
    const filters = this.deps.getVisibility();
    const hiddenTypes = new Set([...filters.hiddenTypes].filter((type) => graph.nodes.some((n) => n.type === type)));
    const excluding = filters.tagFilterMode === "exclude";
    /** The ticks on screen: whichever list the mode on screen reads. */
    const selection = (): ReadonlySet<string> => {
      if (excluding) return this.deps.getVisibility().hiddenTags;
      const included = this.deps.getVisibility().includedTags;
      // No selection yet keeps everything, and that is what the list shows: every
      // tag ticked until one is taken away.
      return included ?? new Set(collectTags(graph.nodes).map((entry) => entry.tag));
    };
    /** Write ticks back to the list the mode on screen owns; never the other one. */
    const setSelection = (tags: string[]): Promise<void> | void =>
      this.deps.onSetVisibility(excluding ? { hiddenTags: tags } : { includedTags: tags });
    renderFilters(el, {
      graph,
      hiddenTypes: hiddenTypes as never,
      communities: graph.communities,
      hiddenCommunities: liveSet(() => this.deps.getVisibility().hiddenCommunities),
      selectedTags: liveSet(() => selection()),
      hideIsolated: filters.hideIsolated,
      hideStructural: filters.hideStructural,
      onToggleType: (type, visible) => {
        const next = new Set(this.deps.getVisibility().hiddenTypes);
        if (visible) next.delete(type);
        else next.add(type);
        void this.deps.onSetVisibility({ hiddenTypes: [...next] });
      },
      onToggleCommunity: (id, visible) => {
        const next = new Set(this.deps.getVisibility().hiddenCommunities);
        if (visible) next.delete(id);
        else next.add(id);
        void this.deps.onSetVisibility({ hiddenCommunities: [...next] });
      },
      onClearCommunities: () => void this.deps.onSetVisibility({ hiddenCommunities: [] }),
      onToggleTag: (tag, selected) => {
        const next = new Set(selection());
        if (selected) next.add(tag);
        else next.delete(tag);
        void setSelection([...next]);
      },
      // Tags only. The buttons live in the tag group and act on what that group
      // did; the hidden-type and visibility switches are separate decisions the
      // user made elsewhere, and clearing them here would silently overrule them.
      //
      // 全清 empties the selection in the mode on screen: excluding nothing more, or
      // — while including — keeping nothing at all. Each mode owns its own list, so
      // this cannot disturb the other one's ticks.
      //
      // Redrawn once the write lands: the boxes are ticked in place as well, but
      // a tag that was pinned to the top because it was selected has to move back
      // into its place in the list, and only a redraw does that.
      onClearTags: () => {
        void Promise.resolve(setSelection([])).then(() => {
          el.empty();
          this.renderFiltersBody(el);
        });
      },
      onSelectAllTags: (tags) => {
        const next = new Set(selection());
        for (const tag of tags) if (tag.length > 0) next.add(tag);
        void Promise.resolve(setSelection([...next])).then(() => {
          el.empty();
          this.renderFiltersBody(el);
        });
      },
      tagFilterMode: this.deps.getTagFilterMode(),
      workspace: () => ({
        folder: this.deps.getWorkspace().folder,
        excluded: this.deps.getWorkspace().excluded,
        folders: graph.folders,
      }),
      // Applying re-reads the vault, so the panel is redrawn once the rebuild has
      // been asked for rather than before it: the counts and the folder list in the
      // other groups all come from the graph.
      onApplyWorkspace: (folder, excluded) => {
        void Promise.resolve(this.deps.onApplyWorkspace(folder, excluded)).then(() => {
          el.empty();
          this.renderFiltersBody(el);
        });
      },
      // Each mode keeps its own selection, so switching back and forth never
      // rewrites the other one. Include mode opens fully ticked the first time it is
      // entered — everything kept — because a fresh include list is `null`, and an
      // empty one means the opposite: keep nothing. Written in one call, so the
      // panel is redrawn once and never shows a half-applied state.
      onSetTagFilterMode: (mode) => {
        const firstTimeIncluding =
          mode === "include" && this.deps.getVisibility().includedTags === null;
        void Promise.resolve(
          this.deps.onSetVisibility(
            firstTimeIncluding
              ? { tagFilterMode: mode, includedTags: collectTags(graph.nodes).map((e) => e.tag) }
              : { tagFilterMode: mode },
          ),
        ).then(() => {
          el.empty();
          this.renderFiltersBody(el);
        });
      },
      onToggleIsolated: (value) => void this.deps.onSetVisibility({ hideIsolated: value }),
      // Repaints just this body rather than the whole panel: the element is in hand,
      // and the tag search text lives at module level so it survives.
      activeSection: this.filterSection,
      onSelectSection: (section) => {
        this.filterSection = section;
        el.empty();
        this.renderFiltersBody(el);
      },
      onToggleStructural: (value) => void this.deps.onSetVisibility({ hideStructural: value }),
    });
  }
  /**
   * What the colours mean, for the mode currently in use.
   *
   * Hidden while colouring is off: there is nothing to explain then, and an empty
   * box in the corner is worse than none.
   *
   * The rows are controls, exactly as they are in the standalone view: a click
   * excludes or restores that type or cluster, and the header carries a "show all"
   * for the group on screen. Both views write the same visibility settings, so the
   * legend is a shortcut to the same switches the filters panel offers — not a
   * second, competing filter.
   */
  private legendOptions(): ConstructorParameters<typeof OfficialLegend>[1] extends () => infer R
    ? R
    : never {
    const { graph } = this.deps.getData();
    const mode = this.deps.getMode();
    const filters = this.deps.getVisibility();
    return {
      visible: mode !== "off",
      graph,
      colorMode: mode === "community" ? "community" : mode === "type" ? "type" : "custom",
      customNodeColor: "#888888",
      typeColorOverrides: this.deps.getTypeColors(),
      // Read through the live filters, so a row that is currently excluded is
      // drawn as excluded — the legend explains the state, it does not set it.
      hiddenTypes: filters.hiddenTypes,
      hiddenCommunities: filters.hiddenCommunities,
      // The rows are controls too. They write the same shared visibility the
      // filters panel does, so a click here and a tick there are one setting, and
      // the header's "show all" clears the group the legend is currently showing.
      onToggleType: (type) => {
        const next = new Set(this.deps.getVisibility().hiddenTypes);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        void this.deps.onSetVisibility({ hiddenTypes: [...next] });
      },
      onShowAllTypes: () => void this.deps.onSetVisibility({ hiddenTypes: [] }),
      onToggleCommunity: (id) => {
        const next = new Set(this.deps.getVisibility().hiddenCommunities);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        void this.deps.onSetVisibility({ hiddenCommunities: [...next] });
      },
      onShowAllCommunities: () => void this.deps.onSetVisibility({ hiddenCommunities: [] }),
    };
  }

  /** Change the colouring mode, then re-colour with it. */
  private async setMode(mode: OfficialGraphMode): Promise<void> {
    await this.deps.onSetMode(mode);
    this.refresh();
  }
  private toolbarOptions(renderer: OfficialRenderer): ConstructorParameters<typeof OfficialToolbar>[1] {
    return {
      colorMode: () => {
        const mode = this.deps.getMode();
        // "off" is neither by-type nor by-community; the toolbar highlights a
        // toggle only when its mode is the active one.
        return mode === "off" ? "custom" : mode;
      },
      searchQuery: () => this.searchQuery,
      insightCount: () => countUndismissed(this.deps.getData().insights, new Set(this.deps.getDismissed())),
      panel: () => this.panelMode,
      onColorMode: (mode) => {
        if (mode === "custom") return;
        void this.setMode(mode);
      },
      onSearch: (query) => {
        this.searchQuery = query.trim().toLowerCase();
        // Marked, not filtered. Drawn here as well as on the ticker so the marks
        // appear on the keystroke; the ticker is what keeps them on their nodes
        // once the canvas is panned or zoomed — the marks live in screen space,
        // and nothing else redraws them.
        for (const attachment of this.attachments.values()) {
          if (attachment.renderer !== renderer) continue;
          this.drawMarkers(attachment.renderer);
          break;
        }
        this.syncMarkerTicker();
      },
      onPanel: (mode) => {
        if (mode !== "insights" && mode !== "filters" && mode !== "appearance" && mode !== "clustering") {
          return;
        }
        this.panelMode = this.panelMode === mode ? "none" : mode;
        for (const attachment of this.attachments.values()) {
          if (attachment.renderer !== renderer) continue;
          const tab: PanelTab =
            this.panelMode === "appearance"
              ? "colors"
              : this.panelMode === "filters"
                ? "filters"
                : this.panelMode === "clustering"
                  ? "clustering"
                  : "insights";
          attachment.panel.showTab(tab, this.panelMode !== "none");
          attachment.toolbar.render();
          return;
        }
      },
      // The panels this graph actually has, and no rebuild button either: see
      // `OfficialToolbar`'s panel list and `ToolbarOptions.onRebuild`.
      onZoomIn: () => this.zoomBy(renderer, 1.3),
      onZoomOut: () => this.zoomBy(renderer, 1 / 1.3),
      onFit: () => renderer.zoomTo?.(1),
    };
  }

  private zoomBy(renderer: OfficialRenderer, factor: number): void {
    const current = renderer.targetScale ?? renderer.scale ?? 1;
    renderer.zoomTo?.(Math.min(8, Math.max(1 / 128, current * factor)));
  }
  /**
   * A node's colour: the user's override when there is one, otherwise the
   * palette default for the current mode.
   *
   * The overrides are the same settings the standalone view writes, so choosing a
   * colour in either view changes both — they are two renderings of one graph,
   * not two independent colour schemes.
   */
  private nodeColorFor(mode: OfficialGraphMode, community: number, type: string): string {
    if (mode === "community") {
      const override = this.deps.getCommunityColors()[String(community)];
      return override ?? communityColor(community);
    }
    const override = this.deps.getTypeColors()[type];
    return override ?? typeColor(type as Parameters<typeof typeColor>[0]);
  }
  // -------------------------------------------------------------------------
  // Hover wiring
  // -------------------------------------------------------------------------

  /**
   * The engine assigns the hover slots itself, so chain rather than replace and
   * hand the card itself to `OfficialHoverTooltip`.
   */
  private wrapHover(attachment: Attachment): void {
    const { renderer, tooltip } = attachment;
    const originalHover = attachment.originalHover;
    const originalUnhover = attachment.originalUnhover;

    renderer.onNodeHover = (event: MouseEvent, id: string, type: string) => {
      try {
        originalHover?.call(undefined, event, id, type);
      } catch (error) {
        console.error("[enhanced-graph] the built-in hover handler threw:", error);
      }
      if (this.deps.getMode() === "off") return;
      // The engine keeps its own pointer position; fall back to the event when
      // it has not recorded one.
      tooltip.show(event, id, type, {
        x: typeof renderer.mouseX === "number" ? renderer.mouseX : null,
        y: typeof renderer.mouseY === "number" ? renderer.mouseY : null,
      });
    };
    renderer.onNodeUnhover = () => {
      try {
        originalUnhover?.call(undefined);
      } catch (error) {
        console.error("[enhanced-graph] the built-in unhover handler threw:", error);
      }
      tooltip.hide();
    };
  }

  /**
   * Late-bound tooltip options: the graph is rebuilt on every analysis run, so
   * the resolver and the neighbour ranking are read through `deps` on each call
   * rather than captured once at attach time.
   */
  private hoverOptions(): HoverTooltipOptions {
    const graph = (): WikiGraph => this.deps.getData().graph;
    return {
      graph,
      resolve: (officialId) => this.resolverFor(graph())(officialId),
      topNeighbours: (nodeId, limit) => this.topNeighbours(graph(), nodeId, limit),
    };
  }

  // -------------------------------------------------------------------------
  // Snapshot lookups
  // -------------------------------------------------------------------------

  /** Id folding for one snapshot, cached by graph identity like the neighbours. */
  private resolverFor(graph: WikiGraph): NodeResolver {
    if (this.resolverCache?.graph !== graph) {
      this.resolverCache = { graph, resolve: createNodeResolver(graph) };
    }
    return this.resolverCache.resolve;
  }

  private neighbourIndex(graph: WikiGraph): Map<string, Array<{ id: string; weight: number }>> {
    if (this.neighbourCache?.graph === graph) return this.neighbourCache.map;
    const map = new Map<string, Array<{ id: string; weight: number }>>();
    const push = (from: string, to: string, weight: number) => {
      const list = map.get(from);
      if (list) list.push({ id: to, weight });
      else map.set(from, [{ id: to, weight }]);
    };
    for (const edge of graph.edges) {
      push(edge.source, edge.target, edge.weight);
      push(edge.target, edge.source, edge.weight);
    }
    this.neighbourCache = { graph, map };
    return map;
  }

  private topNeighbours(
    graph: WikiGraph,
    nodeId: string,
    limit: number,
  ): Array<{ label: string; weight: number }> {
    const entries = this.neighbourIndex(graph).get(nodeId);
    if (!entries || entries.length === 0) return [];
    return [...entries]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
      .map((entry) => ({
        label: graph.nodeIndex.get(entry.id)?.label ?? entry.id,
        weight: entry.weight,
      }));
  }

  // -------------------------------------------------------------------------
  // setData wrapper and panel wiring
  // -------------------------------------------------------------------------

  private wrapSetData(attachment: Attachment): void {
    const { renderer } = attachment;
    const original = attachment.originalSetData;
    if (typeof original !== "function" || (renderer as RendererWithMarker)[WRAPPED_SET_DATA]) return;
    (renderer as RendererWithMarker)[WRAPPED_SET_DATA] = true;
    // `setData` lives on the prototype, so restoring means deleting the shadow
    // property rather than assigning the method back onto the instance.
    attachment.setDataWasOwn = Object.prototype.hasOwnProperty.call(renderer, "setData");
    const enhancer = this;

    renderer.setData = function wrapped(this: OfficialRenderer, ...args: unknown[]) {
      const payload = args[0];
      // Stash the untouched payload: it is what a later filter change re-applies,
      // and it has to still hold the nodes we are currently hiding.
      attachment.lastData = payload;
      const filtered = enhancer.filterData(payload);
      const result = original.apply(this, [filtered, ...args.slice(1)]);
      // `setData` replaces every node object, so colours must be re-applied —
      // deferred a tick so the engine finishes wiring the new nodes up.
      if (attachment.syncTimer !== null) window.clearTimeout(attachment.syncTimer);
      attachment.syncTimer = window.setTimeout(() => {
        attachment.syncTimer = null;
        enhancer.applyColors(attachment);
        attachment.panel.render();
      }, 0);
      return result;
    };
  }

  // -------------------------------------------------------------------------
  // Context menu (public `file-menu` event)
  // -------------------------------------------------------------------------

  /**
   * Contribute items to the built-in graph's node context menu.
   *
   * Obsidian opens that menu itself and fires the public `file-menu` workspace
   * event first, so the plugin registers the event and forwards it here. Nothing
   * is monkey-patched: if Obsidian ever stops firing it, we simply get no menu
   * items instead of a broken graph.
   */
  handleFileMenu(menu: Menu, file: TFile, source: string, leaf: WorkspaceLeaf | undefined): void {
    if (source !== GRAPH_MENU_SOURCE) return;
    if (this.deps.getMode() === "off") return;
    const node = this.nodeForFile(file);
    if (!node) return;
    const hidden = this.deps.getHiddenTypes().includes(node.type);
    try {
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(t("menu.highlightNeighbors"))
          .setIcon("lucide-focus")
          .onClick(() => this.focusNodeInGraph(node.id, leaf)),
      );
      menu.addItem((item) =>
        item
          .setSection("action")
          .setTitle(`${t("menu.hideType")}：${t(`type.${node.type}` as never)}`)
          .setIcon(hidden ? "lucide-eye" : "lucide-eye-off")
          .onClick(async () => {
            await this.deps.onToggleType(node.type);
            this.reapply(leaf);
          }),
      );
      // Only offered while something is focused: an item that cannot do
      // anything is worse than no item.
      if (this.hasFocus()) {
        menu.addItem((item) =>
          item
            .setSection("action")
            .setTitle(t("menu.clearFocus"))
            .setIcon("lucide-circle-off")
            .onClick(() => this.clearFocusFor(leaf)),
        );
      }    } catch (error) {
      console.error("[enhanced-graph] could not extend the built-in graph menu:", error);
    }
  }

  /**
   * Focus one node in the built-in graph, from the context menu.
   *
   * Two things make this less direct than it looks:
   *
   *  1. The leaf is the reliable way to find the renderer, but it is not
   *     guaranteed — `file-menu` is a public event and the 4th argument is only
   *     passed by callers that have a leaf. Falling back to "whichever attached
   *     renderer actually holds this node" means the menu still works if that
   *     changes.
   *  2. `highlightNode` is the renderer's HOVER slot, and the render loop clears
   *     it every frame unless `mouseX`/`mouseY` still sit on that node. Setting
   *     it alone produced a highlight that vanished before the next paint, so the
   *     pointer position is pinned to the node as well — which is precisely the
   *     state we want to express: "treat this node as hovered". A later real
   *     hover overwrites both, so hovering elsewhere still takes over normally.
   *
   * This is the gesture that ACCUMULATES: focusing a second note from the menu is
   * how the route between two notes is asked for. An insight card is the opposite
   * — see `focusCardNodes`.
   */
  private focusNodeInGraph(nodeId: string, leaf: WorkspaceLeaf | undefined): void {
    try {
      const { graph } = this.deps.getData();
      const graphNode = graph.nodeIndex.get(nodeId);
      if (!graphNode) return this.reportFocusFailure(nodeId, "node is not in the current graph");
      const resolve = this.resolverFor(graph);

      const candidates: OfficialRenderer[] = [];
      const fromLeaf = officialRendererOf(leaf);
      if (fromLeaf) candidates.push(fromLeaf);
      for (const attachment of this.attachments.values()) {
        if (attachment.renderer !== fromLeaf) candidates.push(attachment.renderer);
      }

      for (const renderer of candidates) {
        const lookup = renderer.nodeLookup ?? {};
        const officialId = Object.keys(lookup).find((candidate) => resolve(candidate)?.id === graphNode.id);
        if (!officialId) continue;
        const target = lookup[officialId];
        if (!target) continue;
        const set = this.focusIds.get(renderer) ?? new Set<string>();
        set.add(graphNode.id);
        this.focusIds.set(renderer, set);
        this.assertFocus(renderer);
        this.syncMarkerTicker();
        return;
      }
      this.reportFocusFailure(nodeId, "no attached built-in graph holds this node");
    } catch (error) {
      console.error("[enhanced-graph] focusing a built-in graph node failed:", error);
    }
  }

  /**
   * Focus every note an insight card names — both ends of a connection, at once.
   *
   * This REPLACES the focus rather than adding to it. The panel marks only the
   * last card as active, so the graph has to agree with it: adding left the first
   * card's connection lit behind the second one, and the anchors piled up — the
   * focus runs a route search for every PAIR of them, and `drawMarkers` re-runs it
   * on every frame. `clearFocusRenderer`'s own repaint would be wasted work here,
   * so the set is written and applied in one pass.
   *
   * Notes the built-in graph is not drawing (filtered out, or not loaded yet) are
   * skipped without a word: a card is not a request for one named note, so unlike
   * the context menu there is nothing to report.
   */
  private focusCardNodes(renderer: OfficialRenderer, nodeIds: readonly string[]): void {
    const { graph } = this.deps.getData();
    const resolve = this.resolverFor(graph);
    const drawn = new Set<string>();
    for (const officialId of Object.keys(renderer.nodeLookup ?? {})) {
      const ours = resolve(officialId);
      if (ours) drawn.add(ours.id);
    }
    const ids = nodeIds.filter((id) => graph.nodeIndex.has(id) && drawn.has(id));
    if (ids.length === 0) {
      this.clearFocusRenderer(renderer);
      return;
    }
    this.focusIds.set(renderer, new Set(ids));
    this.assertFocus(renderer);
    this.syncMarkerTicker();
  }

  /**
   * The set of nodes that should stay bright.
   *
   * With ONE note focused: that note and its neighbours. With two or more: the
   * focused notes and every node on a route between them — and deliberately NOT
   * their neighbours, which would sweep in the surrounding cluster and leave
   * bright nodes whose edges are not part of any connecting route.
   *
   * Returns null when nothing is focused, so callers can skip the whole path.
   */
  private focusSet(renderer: OfficialRenderer): Set<string> | null {
    const focused = this.focusIds.get(renderer);
    if (!focused || focused.size === 0) return null;
    const { graph } = this.deps.getData();
    const display = new Set<string>(focused);
    // "Focus neighbours" is about ONE note, so its neighbours belong in the set.
    // With two or more focused the user is looking at the route BETWEEN them, and
    // lighting every endpoint's neighbours would sweep in the whole surrounding
    // cluster — the route would be lost in the noise.
    if (focused.size === 1) {
      for (const id of focused) {
        for (const edge of graph.edges) {
          if (edge.source === id) display.add(edge.target);
          else if (edge.target === id) display.add(edge.source);
        }
      }
    }
    // Routes between every pair of focused notes, so focusing a second note
    // shows how it connects to the first.
    const ids = [...focused];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const paths = findConnectingPaths(graph, ids[i], ids[j], this.pathOptions());
        if (!paths) continue;
        for (const id of paths.nodes) display.add(id);
      }
    }
    return display;
  }

  /**
   * Re-apply colours so the focus multiplier takes effect, and dim the edges.
   *
   * Called whenever the focused set changes. Nothing here runs per frame: the
   * alpha lives on `node.color`, which the renderer reads every frame, so the
   * focus simply stays put.
   */
  private assertFocus(renderer: OfficialRenderer): void {
    for (const attachment of this.attachments.values()) {
      if (attachment.renderer !== renderer) continue;
      this.applyColors(attachment);
      this.applyLineColor(attachment);
      this.refreshLitEdges(renderer);
      // Redrawn rather than wiped: the focus's dots are only some of what this
      // layer carries, and a search's marks have to survive a focus change.
      this.drawMarkers(renderer);
      attachment.panel.render();
      renderer.changed?.();
      return;
    }
  }

  /**
   * Apply the chosen line colour, or leave the theme's alone.
   *
   * The built-in graph paints every edge from these two shared objects, so a
   * single colour is all it can express — there is no weight ramp to drive the
   * way the standalone view does.
   *
   * With nothing chosen, these objects are NOT ours to write. They are the
   * built-in graph's own, and the theme rewrites them when the user switches
   * between light and dark: writing a stashed copy back on the next refresh put
   * the previous theme's ink on the new theme's canvas — near-white edges on a
   * white page, near-black ones on a black one — and it stayed that way until the
   * graph was closed and reopened, which is what re-read them. Reading them here
   * instead of writing keeps the stash current, so choosing a colour and then
   * clearing it still lands on the theme that is on screen at the time.
   */
  private applyLineColor(attachment: Attachment): void {
    const colors = attachment.renderer.colors;
    if (!colors) return;
    const chosen = this.deps.getLineColor() ?? null;
    const owned = attachment.ownedLineColor !== null;
    for (const key of ["line", "lineHighlight"] as const) {
      const color = colors[key];
      if (!color) continue;
      if (!chosen) {
        if (owned) {
          // The colour was just cleared: put the theme's back.
          const themed = attachment.originalEdgeColor[key];
          if (themed) {
            color.a = themed.a;
            color.rgb = themed.rgb;
          }
        } else {
          // Never touched by us. Read where the theme has it — a theme switch
          // rewrites this object, and writing an older copy back here is what left
          // the edges the wrong ink until the graph was reopened. Reading also
          // keeps the stash current for a colour chosen later.
          attachment.originalEdgeColor[key] = { a: color.a, rgb: color.rgb };
        }
        continue;
      }
      if (!owned) {
        // First write over the theme's own value: keep it, so clearing the colour
        // can put it back.
        attachment.originalEdgeColor[key] = { a: color.a, rgb: color.rgb };
      }
      color.rgb = hexToRgbInt(chosen);
    }
    attachment.ownedLineColor = chosen;
  }

  /**
   * "N intermediate notes" means a path of N+1 hops, matching the standalone
   * view so the same setting reads the same way in both.
   */
  private pathOptions(): { maxHops: number } {
    return { maxHops: Math.max(1, this.deps.getFocusIntermediates() + 1) };
  }

  /**
   * The edges that belong to the focus.
   *
   * One focused note: its incident edges. Two or more: exactly the steps of the
   * routes between them, so the highlight is the connecting subgraph and nothing
   * outside it.
   *
   * Returned as pairs of OUR node ids; resolving to official ids happens in
   * {@link collectLitEdges}.
   */
  private focusEdgePairs(renderer: OfficialRenderer): Array<[string, string]> {
    const focused = this.focusIds.get(renderer);
    if (!focused || focused.size === 0) return [];
    const { graph } = this.deps.getData();
    const pairs: Array<[string, string]> = [];
    const seen = new Set<string>();
    const push = (a: string, b: string): void => {
      const key = a < b ? `${a}${b}` : `${b}${a}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([a, b]);
    };

    // A SINGLE focused note lights the edges that touch it, and nothing else.
    //
    // Lighting every edge between bright neighbours as well — the induced
    // subgraph — was tried and rejected: with one note focused it lit 175 extra
    // edges running between its neighbours, which is not what "focus this note"
    // means. The neighbourhood is shown by the bright NODES; the bright EDGES are
    // the connections to the focused note.
    if (focused.size === 1) {
      for (const edge of graph.edges) {
        if (focused.has(edge.source) || focused.has(edge.target)) push(edge.source, edge.target);
      }
    }
    const ids = [...focused];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const paths = findConnectingPaths(graph, ids[i], ids[j], this.pathOptions());
        if (!paths) continue;
        // The edges the search already identified — NOT consecutive entries of
        // `nodes`.
        //
        // `nodes` is every node on SOME included path, ordered by distance from
        // `from`. Two entries next to each other in that list therefore need not
        // share an edge at all, so pairing them up both invented edges that do
        // not exist and skipped the real ones — which showed up as a focused
        // route lighting only a scattered few of its edges.
        for (const key of paths.edges) push(...edgeKeyEndpoints(key));
      }
    }
    return pairs;
  }

  /**
   * Resolve those pairs to the renderer's link graphics.
   *
   * `setData` stores each link on its source node as `forward[targetId]`, so the
   * object is reachable without touching anything private to the render loop.
   */
  /**
   * Edge keys of the focused route, in OUR id space.
   *
   * `forceLitEdges` maps them to official ids and graphics every frame, so this
   * does not depend on how far the built-in graph has loaded.
   */
  private collectLitEdges(renderer: OfficialRenderer): Set<string> {
    // Keys in OUR id space, deliberately built without reading nodeLookup.
    //
    // It used to map our ids to official ones here, which made the result depend
    // on how much of the built-in graph had loaded at that instant: two runs of
    // the same diagnostic on the same focused pair produced 31 and then 35 keys,
    // and the edges dropped in the first case never came back. Mapping happens in
    // `forceLitEdges` instead, every frame, against the lookup as it is then.
    const out = new Set<string>();
    for (const [a, b] of this.focusEdgePairs(renderer)) {
      // Whether the built-in graph has drawn this edge, and under which ids, is
      // a rendering question answered at apply time.
      out.add(edgeKey(a, b));
    }
    return out;
  }

  /** Put the theme's own line colour back, whatever the setting now says. */
  private restoreLineColor(attachment: Attachment): void {
    // Nothing of ours to undo: the graph's own objects were never written to, and
    // the theme owns whatever they hold now.
    if (attachment.ownedLineColor === null) return;
    attachment.ownedLineColor = null;
    const colors = attachment.renderer.colors;
    if (!colors) return;
    for (const key of ["line", "lineHighlight"] as const) {
      const color = colors[key];
      const original = attachment.originalEdgeColor[key];
      if (!color || !original) continue;
      color.a = original.a;
      color.rgb = original.rgb;
    }
  }
  /** Recompute which edges stay lit, and make sure the graph repaints. */
  private refreshLitEdges(renderer: OfficialRenderer): void {
    // Keys, so a rebuild only changes what they resolve to.
    this.litEdges.set(renderer, this.collectLitEdges(renderer));
  }

  /**
   * Hold the lit edges at full alpha.
   *
   * Every link animates its alpha toward `c` each frame; this writes the value
   * that makes the DRAWN result come out where we want it, in both directions.
   *
   * Inverting the render's own lerp (`drawn = written*0.9 + c*0.1`) with `c` left
   * at 1 — the theme colours are deliberately no longer dimmed — puts both targets
   * inside [0, 1], so nothing is clamped and the results are exact.
   */
  private forceLitEdges(renderer: OfficialRenderer): void {
    const links = renderer.links;
    if (!Array.isArray(links) || links.length === 0) return;
    const lit = this.litEdges.get(renderer);
    if (!lit || lit.size === 0) return;
    const litWritten = (1 - (1 - EDGE_ALPHA_LERP)) / EDGE_ALPHA_LERP;
    const dimWritten = (FOCUS_EDGE_DRAWN - (1 - EDGE_ALPHA_LERP)) / EDGE_ALPHA_LERP;

    // Resolve the lit keys against the CURRENT graphics, every call.
    //
    // This is the whole fix: the set holds keys, and the objects they refer to
    // are looked up here rather than stored. Storing them meant a graph rebuild
    // left the set pointing at the previous `setData`'s objects while
    // `renderer.links` held the new ones, and the reference comparison then
    // matched almost nothing.
    const litLines = new Set<object>();
    const lookup = renderer.nodeLookup ?? {};
    const { graph } = this.deps.getData();
    const resolve = this.resolverFor(graph);
    const officialIdOf = new Map<string, string>();
    for (const officialId of Object.keys(lookup)) {
      const ours = resolve(officialId);
      if (ours) officialIdOf.set(ours.id, officialId);
    }
    for (const key of lit) {
      const [a, b] = edgeKeyEndpoints(key);
      const from = officialIdOf.get(a);
      const to = officialIdOf.get(b);
      if (!from || !to) continue;
      const link =
        (lookup[from] as { forward?: Record<string, { line?: object }> } | undefined)?.forward?.[to] ??
        (lookup[to] as { forward?: Record<string, { line?: object }> } | undefined)?.forward?.[from];
      if (link?.line) litLines.add(link.line);
    }

    for (const link of links) {
      const line = link?.line;
      if (!line) continue;
      try {
        line.alpha = litLines.has(line) ? litWritten : dimWritten;
      } catch {
        /* the link was rebuilt mid-iteration; the next frame resolves again */
      }
    }
  }

  /** Put every edge back to the renderer's own target at once. */
  private releaseEdges(renderer: OfficialRenderer): void {
    const links = renderer.links;
    if (!Array.isArray(links)) return;
    for (const link of links) {
      try {
        if (link?.line) link.line.alpha = 1;
      } catch {
        /* the link is already gone */
      }
    }
  }

  /**
   * Keeps the renderer's own single-node highlight out of the way while a focus
   * is active: hovering would otherwise re-dim everything through `ZU` and undo
   * the focus set we just painted.
   */
  /**
   * Re-apply the focus highlight and the search marks immediately.
   *
   * Called when the window becomes visible again. The ticker alone is not enough
   * because it runs on requestAnimationFrame, which does not fire while hidden —
   * and a repaint in that time drops the edge highlight while the node dimming
   * survives.
   */
  private reapplyMarks(): void {
    if (!this.marksAreDrawn()) return;
    for (const attachment of this.attachments.values()) {
      const focused = this.focusIds.get(attachment.renderer);
      try {
        if (focused && focused.size > 0) this.forceLitEdges(attachment.renderer);
        this.drawMarkers(attachment.renderer);
      } catch {
        /* the renderer is gone; the next sync drops it */
      }
    }
    this.syncMarkerTicker();
  }

  /**
   * Whether anything has to be kept in step with the canvas from frame to frame.
   *
   * The marks are drawn onto a canvas of our own, in screen space, so they only
   * stay on their nodes if they are redrawn as the camera moves. Two things put
   * marks on screen — a focus and a search — and a search is a state of its own:
   * this used to be decided by the focus alone, so the search's marks were drawn
   * once when the query changed and then stayed exactly where they were put while
   * the graph moved under them.
   */
  private marksAreDrawn(): boolean {
    return this.attachments.size > 0 && (this.hasFocus() || this.searchQuery !== "");
  }

  /** Keep the marker ticker running exactly while there is something to keep in step. */
  private syncMarkerTicker(): void {
    if (this.marksAreDrawn()) this.startMarkerTicker();
    else this.stopMarkerTicker();
  }

  private startMarkerTicker(): void {
    if (this.markerTicker !== null) return;
    if (typeof window === "undefined") return;
    const tick = (): void => {
      if (!this.marksAreDrawn()) {
        this.stopMarkerTicker();
        return;
      }
      // Every attached graph, not just the focused ones: a search marks its
      // matches in all of them.
      for (const attachment of this.attachments.values()) {
        const renderer = attachment.renderer;
        const focused = this.focusIds.get(renderer);
        try {
          if (focused && focused.size > 0) {
            // The renderer's own single-node highlight is kept out of the way
            // while a focus is active: hovering would otherwise re-dim everything
            // through `ZU` and undo the focus set we just painted.
            if (renderer.highlightNode) {
              renderer.highlightNode = null;
              renderer.changed?.();
            }
            this.forceLitEdges(renderer);
          }
          this.drawMarkers(renderer);
        } catch {
          /* the renderer is already gone */
        }
      }
      this.markerTicker = window.requestAnimationFrame(tick);
    };
    this.markerTicker = window.requestAnimationFrame(tick);
  }

  private stopMarkerTicker(): void {
    if (this.markerTicker === null) return;
    window.cancelAnimationFrame(this.markerTicker);
    this.markerTicker = null;
  }

  /**
   * Ring the focused notes.
   *
   * Projection mirrors the render loop's own maths: it maps a node with
   * `(x * scale + panX) / devicePixelRatio`, and draws it at
     * the camera moves.
   */
  private drawMarkers(renderer: OfficialRenderer): void {
    const focused = this.focusIds.get(renderer);
    const attachment = [...this.attachments.values()].find(
      (candidate) => candidate.renderer === renderer,
    );
    if (!attachment) return;
    const query = this.searchQuery;
    const hasFocus = Boolean(focused && focused.size > 0);
    if (!hasFocus && query === "") {
      attachment.markers.draw([], [], this.markerPalette());
      return;
    }

    const { graph } = this.deps.getData();
    const resolve = this.resolverFor(graph);
    const lookup = renderer.nodeLookup ?? {};
    const officialIdOf = new Map<string, string>();
    for (const officialId of Object.keys(lookup)) {
      const ours = resolve(officialId);
      if (ours) officialIdOf.set(ours.id, officialId);
    }

    const scale = renderer.scale ?? 1;
    const panX = renderer.panX ?? 0;
    const panY = renderer.panY ?? 0;
    const dpr = window.devicePixelRatio || 1;

    const screenOf = (id: string): { x: number; y: number } | null => {
      const officialId = officialIdOf.get(id);
      const node = officialId ? lookup[officialId] : undefined;
      if (!node || typeof node.x !== "number" || typeof node.y !== "number") return null;
      return { x: (node.x * scale + panX) / dpr, y: (node.y * scale + panY) / dpr };
    };

    // Every edge of the focus, as a segment. See the note in OfficialMarkerLayer:
    // the built-in graph's own edge brightness is not something this plugin can
    // reliably drive, so the focus draws its edges here instead.
    // Centre to centre. Insetting the ends so they finish under the node discs was
    // tried and dropped: the drawn radius is not readable, so the inset can only be
    // a guess, and a guess that is wrong leaves the edge the wrong length at every
    // node. A line that reaches the centre is at least consistently right about
    // where the edge is.
    const lines: MarkerLine[] = [];
    for (const [a, b] of this.focusEdgePairs(renderer)) {
      const start = screenOf(a);
      const end = screenOf(b);
      if (!start || !end) continue;
      lines.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    }

    const points: MarkerPoint[] = [];
    for (const id of focused ?? []) {
      const position = screenOf(id);
      if (!position) continue;
      points.push({
        x: position.x,
        y: position.y,
        // A fixed size of our own, in CSS pixels, and deliberately not derived
        // from the node. Pinned at the centre it does not have to match anything,
        // which is the point: four attempts to compute the node's drawn radius
        // were each contradicted by what was on screen, because the renderer
        // does not expose it.
        radius: MARKER_RADIUS_PX,
      });
    }

    // Search matches, marked the same way. A search says where the matches are
    // rather than taking everything else off the screen, so the picture keeps its
    // context and the matches stand out against it.
    if (query !== "") {
      for (const node of graph.nodes) {
        if (!node.label.toLowerCase().includes(query)) continue;
        const position = screenOf(node.id);
        if (!position) continue;
        points.push({ x: position.x, y: position.y, radius: MARKER_RADIUS_PX });
      }
    }

    attachment.markers.draw(points, lines, this.markerPalette());
  }

  private markerPalette(): { ring: string; halo: string } {
    const palette = themePalette(this.isDarkTheme());
    return { ring: palette.markerRing, halo: palette.markerRingHalo };
  }

  private isDarkTheme(): boolean {
    return typeof document !== "undefined" && document.body.classList.contains("theme-dark");
  }
  /** True while any built-in graph holds a focus. */
  private hasFocus(): boolean {
    for (const ids of this.focusIds.values()) {
      if (ids.size > 0) return true;
    }
    return false;
  }

  /**
   * Drop the focus from the graph the menu belongs to.
   *
   * Cancelling is deliberately explicit — a right-click item — rather than a
   * click on empty space: the focus is meant to survive moving the pointer
   * across the graph to reach another node's menu, and an empty-space click is
   * far too easy to do by accident while doing that.
   */
  private clearFocusFor(leaf: WorkspaceLeaf | undefined): void {
    const renderer = officialRendererOf(leaf);
    if (renderer && this.focusIds.has(renderer)) {
      this.clearFocusRenderer(renderer);
      return;
    }
    // No usable leaf: clear whichever graph is holding one.
    for (const candidate of [...this.focusIds.keys()]) this.clearFocusRenderer(candidate);
  }
  /** Drop one renderer's focus and put its colours back. */
  private clearFocusRenderer(renderer: OfficialRenderer): void {
    this.focusIds.delete(renderer);
    this.litEdges.delete(renderer);
    this.syncMarkerTicker();
    // Snap the edges back rather than waiting for the lerp to converge.
    this.releaseEdges(renderer);
    for (const attachment of this.attachments.values()) {
      if (attachment.renderer !== renderer) continue;
      this.applyColors(attachment);
      this.applyLineColor(attachment);
      this.refreshLitEdges(renderer);
      // Redrawn rather than wiped: a search's marks are on this layer too, and
      // clearing them here would take them off the screen until the next frame
      // put them back — or for good, if no focus is left to keep the ticker
      // running.
      this.drawMarkers(renderer);
      attachment.panel.render();
      renderer.changed?.();
      return;
    }
  }

  private clearAllFocus(): void {
    for (const renderer of [...this.focusIds.keys()]) this.clearFocusRenderer(renderer);
    this.focusIds.clear();
    this.syncMarkerTicker();
  }
  /**
   * Move the renderer's notion of the pointer onto this node.
   *
   * Mirrors the render loop's own maths: it compares the node against
   * `(mouseX * devicePixelRatio - panX) / scale`, so writing those two fields
   * keeps the comparison inside the node's radius.
   */
  private pinPointerTo(renderer: OfficialRenderer, node: OfficialNode): void {
    const scale = renderer.scale;
    const panX = renderer.panX;
    const panY = renderer.panY;
    if (typeof scale !== "number" || typeof panX !== "number" || typeof panY !== "number") return;
    if (scale <= 0 || typeof node.x !== "number" || typeof node.y !== "number") return;
    const dpr = window.devicePixelRatio || 1;
    renderer.mouseX = (node.x * scale + panX) / dpr;
    renderer.mouseY = (node.y * scale + panY) / dpr;
  }

  /** Never fail silently: a menu item that does nothing is worse than an error. */
  private reportFocusFailure(nodeId: string, why: string): void {
    console.warn(`[enhanced-graph] could not focus "${nodeId}" in the built-in graph: ${why}`);
    new Notice(`${t("menu.highlightNeighbors")}：${why}`);
  }
  /** Our graph node behind a vault file, or undefined when it is filtered out. */
  private nodeForFile(file: TFile): GraphNode | undefined {
    const { graph } = this.deps.getData();
    const resolve = this.resolverFor(graph);
    return resolve(file.path) ?? resolve(file.basename);
  }

  /**
   * The `setData` payload with everything the filters exclude taken out.
   *
   * Returns a COPY rather than editing in place. The caller's object is also what
   * we re-apply later, so pruning it would be irreversible: a node deleted from
   * it could never come back when the user un-hides its type. The built-in
   * renderer drops any node missing from `data.nodes` and tears its edges down
   * with it, so handing it a copy is all it takes.
   */
  private filterData(payload: unknown): unknown {
    const source = payload as { nodes?: Record<string, unknown> } | null | undefined;
    const nodes = source?.nodes;
    if (!nodes) return payload;

    const filters = this.deps.getVisibility();
    const workspace = this.deps.getWorkspace();
    const scoped = workspace.folder !== "" || workspace.excluded.length > 0;
    const anyHidden =
      scoped ||
      filters.hiddenTypes.size > 0 ||
      filters.hiddenCommunities.size > 0 ||
      filters.hiddenTags.size > 0 ||
      // Include mode hides by NOT keeping: a selection that is not null narrows the
      // graph even when the exclude list is empty, and an empty one is the narrowest
      // selection there is — keep nothing. Missing this made the fast path hand the
      // whole graph back as if no filter were in force.
      (filters.tagFilterMode === "include" && filters.includedTags !== null) ||
      filters.hideStructural ||
      filters.hideIsolated;
    // The search query is deliberately NOT part of this. Searching marks the
    // matching nodes instead of removing the rest, so what is on screen keeps
    // showing where the matches sit relative to everything else.
    if (!anyHidden) {
      return payload;
    }

    try {
      const { graph } = this.deps.getData();
      const resolve = this.resolverFor(graph);
      const visible = new Set(filterNodes(graph.nodes, filters).map((node) => node.id));
      const kept: Record<string, unknown> = {};
      for (const officialId of Object.keys(nodes)) {
        // The workspace first, and by PATH: this payload is Obsidian's own node set,
        // which the plugin's build never touched — a node outside the workspace is
        // simply absent from our graph, and dropping "what we do not know" would be
        // wrong for every other reason a node can be unknown (attachments, notes the
        // analysis skipped). Judging it by its path keeps those, and still takes the
        // out-of-workspace ones off the screen.
        if (scoped && !isInWorkspace(officialId, workspace.folder, workspace.excluded)) continue;
        const ours = resolve(officialId);
        if (ours && !visible.has(ours.id)) continue;
        kept[officialId] = nodes[officialId];
      }
      return { ...source, nodes: kept };
    } catch (error) {
      console.error("[enhanced-graph] filtering the built-in graph failed:", error);
      return payload;
    }
  }

  /** Push the last payload through again, so a filter change takes effect. */
  private reapply(leaf: WorkspaceLeaf | undefined): void {
    const renderer = officialRendererOf(leaf);
    if (!renderer) return;
    const attachment = [...this.attachments.values()].find((candidate) => candidate.renderer === renderer);
    if (!attachment || attachment.lastData == null || typeof renderer.setData !== "function") return;
    try {
      renderer.setData(attachment.lastData);
    } catch (error) {
      console.error("[enhanced-graph] re-applying the built-in graph data failed:", error);
    }
  }
  private panelOptions(renderer: OfficialRenderer): OfficialPanelOptions {
    return {
      graph: () => this.deps.getData().graph,
      insights: () => this.deps.getData().insights,
      dismissed: () => new Set(this.deps.getDismissed()),
      mode: () => this.deps.getMode(),
      // An empty id list is the panel's "unfocus" gesture.
      //
      // `focusNodeInGraph`, once per id, rather than `focusNodes`. A connection
      // card hands over BOTH endpoints and `focusNodes` stops at the first one it
      // can resolve — it assigns the renderer's own single-node `highlightNode`
      // and breaks out of the loop — so clicking a card lit one end and left the
      // other dark. This writes `focusIds`, which is the set the ticker keeps
      // re-applying, so both ends stay lit.
      onFocusNodes: (nodeIds) => {
        if (nodeIds.length === 0) this.clearFocusRenderer(renderer);
        else this.focusCardNodes(renderer, nodeIds);
      },
      focusCount: () => {
        const ids = this.focusIds.get(renderer);
        return ids ? ids.size : 0;
      },
      activeColorTab: () => {
        const mode = this.deps.getMode();
        return mode === "community" ? "community" : mode === "type" ? "type" : null;
      },
      colorEntries: (tab) => this.colorEntries(tab),
      // Refresh once the host has applied the mode: it may be async (the plugin
      // saves settings first), and re-colouring before that would use the old one.
      onSelectColorTab: (tab) => void this.setMode(tab),
      onSetColor: (tab, key, color) => {
        if (tab === "type") void this.deps.onSetTypeColor(key, color);
        else void this.deps.onSetCommunityColor(Number(key), color);
      },
      lineColor: () => this.deps.getLineColor() ?? LINE_COLOR_FALLBACK,
      isLineColorThemed: () => (this.deps.getLineColor() ?? null) === null,
      onSetLineColor: (color) => void this.deps.onSetLineColor(color),
      intermediates: () => this.deps.getFocusIntermediates(),
      onSetIntermediates: (intermediates) => {
        void this.deps.onSetFocusIntermediates(intermediates);
        // The paths themselves change, so the focus has to be recomputed.
        this.assertFocus(renderer);
      },
      onDismiss: (key, nodeIds) => void this.deps.onDismiss(key, nodeIds),
      renderFilters: (el) => this.renderFiltersBody(el),
      renderClustering: (el) => this.renderClusteringBody(el),
    };
  }

  /**
   * The clustering body, the standalone view's own component.
   *
   * Redrawn once the host has written the settings: the coefficients and the
   * resolution are both build inputs, so applying them means a rebuild, and the
   * panel should show what is actually in force rather than the draft.
   */
  private renderClusteringBody(el: HTMLElement): void {
    renderClustering(el, {
      applied: () => this.deps.getClustering(),
      onApply: (choice) => {
        void Promise.resolve(this.deps.onApplyClustering(choice)).then(() => {
          el.empty();
          this.renderClusteringBody(el);
        });
      },
    });
  }

  // -------------------------------------------------------------------------
  // Focus
  // -------------------------------------------------------------------------

  /** Use the official renderer's own focus highlight, which dims non-neighbours. */
  private focusNodes(renderer: OfficialRenderer, nodeIds: readonly string[]): void {
    const { graph } = this.deps.getData();
    const resolve = this.resolverFor(graph);
    const officialIds = Object.keys(renderer.nodeLookup ?? {});
    let target: OfficialNode | null = null;
    for (const id of nodeIds) {
      const graphNode = graph.nodeIndex.get(id);
      if (!graphNode) continue;
      const officialId = officialIds.find((candidate) => resolve(candidate)?.id === graphNode.id);
      if (officialId) {
        target = renderer.nodeLookup?.[officialId] ?? null;
        break;
      }
    }
    try {
      renderer.highlightNode = target;
      renderer.changed?.();
    } catch (error) {
      console.error("[enhanced-graph] focusing a built-in graph node failed:", error);
    }
  }
}

/**
 * A `ReadonlySet` that reads its source on every access instead of holding a copy.
 *
 * The filters panel is not re-rendered while a control inside it has focus, so a
 * set captured at render time is stale by the next click — and `graph-filters`
 * reads `hiddenTags` later than that, both to decide whether the restore button
 * has anything to do and to keep its own visibility in step. Handing it the live
 * settings is what makes those reads answer for the state the user is looking at.
 */
function liveSet<T>(source: () => ReadonlySet<T>): ReadonlySet<T> {
  const view: ReadonlySet<T> = {
    get size(): number {
      return source().size;
    },
    has: (value: T): boolean => source().has(value),
    keys: (): IterableIterator<T> => source().keys(),
    values: (): IterableIterator<T> => source().values(),
    entries: (): IterableIterator<[T, T]> => source().entries(),
    // The third argument is this view rather than the source, so a callback that
    // keeps it cannot end up holding the underlying set.
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void => {
      for (const value of source()) callback.call(thisArg, value, value, view);
    },
    [Symbol.iterator]: (): IterableIterator<T> => source()[Symbol.iterator](),
  };
  return view;
}

function leafKey(leaf: WorkspaceLeaf): number {
  // Leaves have no stable public id; the object identity is enough while the
  // leaf is alive, and detached leaves are pruned by `sync()`.
  return leafId(leaf);
}

const leafIds = new WeakMap<object, number>();
let nextLeafId = 1;
function leafId(leaf: WorkspaceLeaf): number {
  const key = leaf as unknown as object;
  let id = leafIds.get(key);
  if (id === undefined) {
    id = nextLeafId++;
    leafIds.set(key, id);
  }
  return id;
}
