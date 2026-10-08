/**
 * ============================================================================
 *  THE ONLY MODULE THAT TALKS TO OBSIDIAN'S BUILT-IN GRAPH.
 * ============================================================================
 *
 * Obsidian ships no public API for its core graph plugin, so the integration is
 * based on the behaviour observed at the version recorded in
 * `npm run verify:obsidian` output. None of it is contractual, and any of it can
 * change between releases.
 *
 * Keep that risk in ONE place:
 *
 *   - Every fragile string (view types, field names) and every structural type
 *     for the built-in graph lives here and nowhere else.
 *   - `official-graph.ts` (layering onto the view) and `official-layout.ts`
 *     (reading its layout) are pure consumers.
 *   - When Obsidian changes, this file is the only one that should need edits —
 *     and `npm run architecture` reports which modules reach past it.
 *
 * Anything that fails a shape check here returns `null`/`false` rather than
 * throwing, so a mismatch degrades to "the feature does nothing" instead of
 * "the plugin breaks".
 */

import type { App, WorkspaceLeaf } from "obsidian";
import type { GraphNode, WikiGraph } from "../types";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/**
 * Registered by the core `graph` plugin via `registerViewType`.
 * `"local-graph"` does NOT exist in the bundle — the string is `"localgraph"`.
 */
export const OFFICIAL_GRAPH_VIEW_TYPES = ["graph", "localgraph"] as const;

export type OfficialGraphViewType = (typeof OFFICIAL_GRAPH_VIEW_TYPES)[number];

// ---------------------------------------------------------------------------
// Structural types for the internal objects
// ---------------------------------------------------------------------------

/** Obsidian's colour shape, also used by `graph.json` colour groups. */
export interface OfficialColor {
  a: number;
  rgb: number;
}

/**
 * A live node. Ids are **vault paths with the extension** (`concepts/Note.md`);
 * tags, unresolved links and attachments are virtual nodes with a `type`.
 */
export interface OfficialNode {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  weight?: number;
  /** Radius in graph units; the renderer draws it scaled by `nodeScale`. */
  getSize?: () => number;
  /** Set by the official colour groups; `getFillColor()` returns it verbatim. */
  color?: OfficialColor | null;
}

/**
 * The graph renderer. All of these are plain writable instance properties with
 * unmangled names — the class itself is minified, so never test by identity.
 */
export interface OfficialRenderer {
  nodes?: OfficialNode[];
  /** Live link objects; each carries the PIXI graphics the render loop animates. */
  links?: Array<{ source?: OfficialNode; target?: OfficialNode; line?: { alpha: number } }>;
  nodeLookup?: Record<string, OfficialNode>;
  colors?: Record<string, OfficialColor>;
  containerEl?: HTMLElement;
  highlightNode?: OfficialNode | null;
  mouseX?: number | null;
  mouseY?: number | null;
  /** Camera control; the built-in view's own zoom buttons call this. */
  zoomTo?: (scale: number, center?: { x: number; y: number }) => void;
  targetScale?: number;
  /** Camera state; the render loop uses it to decide if the pointer still sits on `highlightNode`. */
  scale?: number;
  panX?: number;
  panY?: number;
  /** Single slot, pre-owned by the data engine: chain, never replace. */
  onNodeHover?: ((event: MouseEvent, id: string, type: string) => void) | null;
  /** Single slot, pre-owned by the data engine. */
  onNodeUnhover?: (() => void) | null;
  /** The one deterministic data-update point; the graph emits no events. */
  setData?: (...args: unknown[]) => unknown;
  changed?: () => void;
}

/** The view object behind a graph leaf. */
export interface OfficialGraphView {
  renderer?: OfficialRenderer;
  /** Present on the GLOBAL graph view. */
  /**
   * The data engine. `render()` makes it recompute and hand a fresh payload to
   * `setData` — the same call its own filter panel makes on every change, and
   * the only way to get our filters applied to a graph we attached to late.
   */
  dataEngine?: { render?: () => void };
  /** Present on the LOCAL graph view — deliberately a different name. */
  /** The local graph's engine, deliberately under a different name. */
  engine?: { render?: () => void };
  contentEl?: HTMLElement;
}

// ---------------------------------------------------------------------------
// Safe accessors
// ---------------------------------------------------------------------------

/** The internal view object behind a leaf, or null when the shape moved. */
export function officialViewOf(leaf: WorkspaceLeaf | undefined): OfficialGraphView | null {
  const view = (leaf as unknown as { view?: unknown } | undefined)?.view;
  return view && typeof view === "object" ? (view as OfficialGraphView) : null;
}

/** The renderer behind a leaf, or null. */
export function officialRendererOf(leaf: WorkspaceLeaf | undefined): OfficialRenderer | null {
  const renderer = officialViewOf(leaf)?.renderer;
  return renderer && typeof renderer === "object" ? renderer : null;
}

/**
 * Every live node, from `nodes` or `nodeLookup` — whichever the build exposes.
 * `nodeLookup` is the authoritative map for lookups, `nodes` for iteration.
 */
export function officialNodes(renderer: OfficialRenderer): OfficialNode[] {
  if (Array.isArray(renderer.nodes)) return renderer.nodes;
  const lookup = renderer.nodeLookup;
  return lookup && typeof lookup === "object" ? Object.values(lookup) : [];
}

/** Open leaves of both graph view types. */
export function officialGraphLeaves(app: App): WorkspaceLeaf[] {
  return OFFICIAL_GRAPH_VIEW_TYPES.flatMap((viewType) => app.workspace.getLeavesOfType(viewType));
}

/** True when any built-in graph view is open, regardless of how usable it is. */
export function hasOfficialGraphView(app: App): boolean {
  return OFFICIAL_GRAPH_VIEW_TYPES.some((viewType) => app.workspace.getLeavesOfType(viewType).length > 0);
}

// ---------------------------------------------------------------------------
// Id resolution
// ---------------------------------------------------------------------------

/**
 * Fold an official node id onto our key space: vault paths are lower-cased and
 * stripped of the extension (`Concepts\Note.MD` → `concepts/note`).
 */
export function normalizeOfficialNodeId(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").toLowerCase();
}

export interface NodeResolver {
  (officialId: string | undefined): GraphNode | undefined;
}

/**
 * Build an official-id → our-node resolver.
 *
 * Official ids are vault paths with the extension; our ids are lower-cased
 * paths without it, so resolve through a few normalised keys. Virtual nodes
 * (tags, unresolved links) simply do not resolve.
 */
export function createNodeResolver(graph: WikiGraph): NodeResolver {
  const byKey = new Map<string, GraphNode>();
  const byBasename = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    byKey.set(node.id, node);
    byKey.set(`${node.id}.md`, node);
    const basename = node.id.split("/").pop();
    if (basename && !byBasename.has(basename)) {
      // First writer wins so the index stays stable across rebuilds.
      byBasename.set(basename, node);
    }
  }

  return (officialId) => {
    if (typeof officialId !== "string" || officialId.length === 0) return undefined;
    const normalized = normalizeOfficialNodeId(officialId);
    const direct = byKey.get(normalized);
    if (direct) return direct;
    const slash = normalized.lastIndexOf("/");
    return byBasename.get(slash === -1 ? normalized : normalized.slice(slash + 1));
  };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface OfficialGraphProbe {
  readonly viewType: string;
  readonly leafFound: boolean;
  readonly rendererFound: boolean;
  readonly nodesFound: boolean;
  readonly containerFound: boolean;
  readonly engineFound: boolean;
  /** Seams the enhancer needs and could not find; empty means compatible. */
  readonly missing: readonly string[];
}

/**
 * Inspect every open built-in graph leaf and report which seams were found.
 *
 * Only the seams the enhancer actually uses can make `missing` non-empty; the
 * engine field is reported informationally, because its name differs between
 * the two view types and the enhancer never touches it.
 */
export function probeOfficialGraph(app: App): OfficialGraphProbe[] {
  return OFFICIAL_GRAPH_VIEW_TYPES.map((viewType) => {
    const leaves = app.workspace.getLeavesOfType(viewType);
    const view = officialViewOf(leaves[0]);
    const renderer = view?.renderer;
    const missing: string[] = [];
    if (!leaves.length) missing.push("leaf");
    if (!view) missing.push("view");
    if (!renderer) missing.push("renderer");
    if (renderer && !Array.isArray(renderer.nodes)) missing.push("renderer.nodes");
    if (!renderer?.containerEl) missing.push("renderer.containerEl");
    return {
      viewType,
      leafFound: leaves.length > 0,
      rendererFound: Boolean(renderer),
      nodesFound: Array.isArray(renderer?.nodes),
      containerFound: Boolean(renderer?.containerEl),
      engineFound: Boolean(view?.dataEngine ?? view?.engine),
      missing,
    };
  });
}
