/**
 * ForceAtlas2 layout + the position cache that stops the graph from jumping.
 *
 * The reference runs one-shot `forceAtlas2.assign` calls with a fixed
 * iteration budget rather than the continuous web-worker supervisor. We keep
 * that model — it makes layouts reproducible — but chunk the iterations and
 * yield between chunks so a 2000-node vault never freezes Obsidian's UI.
 */

import type Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

export interface LayoutOptions {
  readonly iterations: number;
  /**
   * ForceAtlas2 gravity (0.2 – 5). Higher pulls every node toward the centre,
   * making clusters tighter; lower lets repulsion spread them out.
   */
  readonly gravity: number;
  readonly nodeCount: number;
  /** Return true to abandon the remaining iterations. */
  readonly shouldCancel?: () => boolean;
}

/** Iteration budget by graph size; larger graphs need fewer, cheaper passes. */
export function layoutIterations(nodeCount: number): number {
  if (nodeCount > 2500) return 28;
  if (nodeCount > 1200) return 40;
  if (nodeCount > 600) return 65;
  if (nodeCount > 250) return 90;
  return 140;
}

/**
 * ForceAtlas2 parameters.
 *
 * `gravity` is the knob the user gets, and it is the only one that visibly
 * changes the layout. The obvious-looking alternative, `scalingRatio`, is a
 * trap: it scales every repulsion uniformly, which is a pure global resize of
 * the whole graph. Measured on the demo vault, spacing 0.5 → 2.5 grew the
 * bounding box 2.3× while leaving edge-length ÷ bounding-box constant to within
 * 0.6% — and since the view fits the graph to the canvas, that resize is
 * cancelled entirely and nothing appears to happen.
 *
 * Gravity is not scale-invariant: it pulls nodes toward the centre while
 * repulsion pushes them apart, so changing it changes cluster tightness relative
 * to node spread. The same measurement gives 0.163 → 0.275 on that ratio across
 * gravity 0.2 → 5.0, i.e. a real, visible difference.
 */
function fa2Settings(gravity: number, nodeCount: number): Record<string, unknown> {
  return {
    gravity,
    // Fixed: this one only rescales, so it is left at a sensible constant.
    scalingRatio: nodeCount > 400 ? 3 : 2,
    strongGravityMode: true,
    barnesHutOptimize: nodeCount > 50,
  };
}

/** Blocking layout, used for small graphs where a single pass is instant. */
export function runLayoutSync(graph: Graph, options: LayoutOptions): void {
  if (graph.order <= 1) return;
  const inferred = forceAtlas2.inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations: options.iterations,
    settings: { ...inferred, ...fa2Settings(options.gravity, options.nodeCount) },
  });
}

/** Chunked layout: yields to the event loop between batches of iterations. */
export async function runLayoutAsync(graph: Graph, options: LayoutOptions): Promise<void> {
  if (graph.order <= 1) return;
  const inferred = forceAtlas2.inferSettings(graph);
  const settings = { ...inferred, ...fa2Settings(options.gravity, options.nodeCount) };

  const chunk = options.iterations > 60 ? 20 : Math.max(1, options.iterations);
  let done = 0;
  while (done < options.iterations) {
    if (options.shouldCancel?.()) return;
    const batch = Math.min(chunk, options.iterations - done);
    forceAtlas2.assign(graph, { iterations: batch, settings });
    done += batch;
    if (done < options.iterations) await yieldToEventLoop();
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    // `window.` prefixed: a bare call resolves against the main window, so a
    // graph in a popout would never get its frame.
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

// ---------------------------------------------------------------------------
// Adopting an externally computed layout
// ---------------------------------------------------------------------------

/** Coordinates produced outside this module, plus where they came from. */
export interface ExternalLayout {
  /** Keyed by our node id. */
  readonly positions: ReadonlyMap<string, { x: number; y: number }>;
  /** Human-readable origin, shown in the status bar (e.g. `"graph"`). */
  readonly source: string;
  /** Share of the requested nodes the snapshot covers, 0–1. */
  readonly coverage: number;
}

/**
 * Supplies pre-computed coordinates, if anything can.
 *
 * The view layer defines this interface but never implements it: the built-in
 * graph integration does, and the plugin injects it. Keeping it here is what
 * stops `view/` from having to know that Obsidian's internals exist — the
 * dependency arrow points from `integrate/` into `view/`, never the other way.
 */
export interface LayoutSource {
  /** Returns `null` when nothing usable is available right now. */
  capture(nodeIds: readonly string[]): ExternalLayout | null;
}

export interface ExternalLayoutResult {
  /** Nodes that received a coordinate straight from the snapshot. */
  readonly placed: number;
  /** Nodes that had to be interpolated because the snapshot did not cover them. */
  readonly extrapolated: number;
}

/**
 * Seed `graph` from an externally computed layout (the built-in graph's worker
 * simulation), then fill any gaps.
 *
 * Gap filling mirrors what Obsidian's own engine does for a node it has never
 * seen: park it at the centroid of its already-placed neighbours with a small
 * deterministic jitter. Nodes with no placed neighbour at all fall back to a
 * golden-angle spiral. Nothing here is random, so the same snapshot always
 * produces the same picture.
 */
export function applyExternalLayout(
  graph: Graph,
  positions: ReadonlyMap<string, { x: number; y: number }>,
): ExternalLayoutResult {
  const placed = new Set<string>();
  graph.forEachNode((id) => {
    const point = positions.get(id);
    if (!point) return;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    graph.setNodeAttribute(id, "x", point.x);
    graph.setNodeAttribute(id, "y", point.y);
    placed.add(id);
  });

  const bounds = placedBounds(graph, placed);
  const jitterScale = Math.max(1, bounds.diagonal * 0.02);

  let extrapolated = 0;
  const pending = graph.nodes().filter((id) => !placed.has(id));

  // Repeat until nothing more can be resolved: a node whose neighbours are all
  // pending only becomes placeable once one of them has been placed.
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const id = pending[index];
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      graph.forEachNeighbor(id, (neighbour) => {
        if (!placed.has(neighbour)) return;
        sumX += Number(graph.getNodeAttribute(neighbour, "x")) || 0;
        sumY += Number(graph.getNodeAttribute(neighbour, "y")) || 0;
        count += 1;
      });
      if (count === 0) continue;
      graph.setNodeAttribute(id, "x", sumX / count + stableJitter(id, jitterScale));
      graph.setNodeAttribute(id, "y", sumY / count + stableJitter(`${id}#y`, jitterScale));
      placed.add(id);
      pending.splice(index, 1);
      extrapolated += 1;
      progressed = true;
    }
  }

  // Still unplaced: the node has no neighbour anywhere in the snapshot.
  pending.forEach((id, index) => {
    const radius = Math.max(1, bounds.diagonal * 0.5) * Math.sqrt(index + 1);
    const angle = index * 2.399963229728653;
    graph.setNodeAttribute(id, "x", Math.cos(angle) * radius);
    graph.setNodeAttribute(id, "y", Math.sin(angle) * radius);
    placed.add(id);
    extrapolated += 1;
  });

  return { placed: placed.size - extrapolated, extrapolated };
}

function placedBounds(graph: Graph, placed: ReadonlySet<string>): { diagonal: number } {
  if (placed.size === 0) return { diagonal: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of placed) {
    const x = Number(graph.getNodeAttribute(id, "x")) || 0;
    const y = Number(graph.getNodeAttribute(id, "y")) || 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { diagonal: Math.hypot(maxX - minX, maxY - minY) };
}

/** Deterministic value in [-scale, scale) derived from an id. */
function stableJitter(seed: string, scale: number): number {
  const hash = parseInt(hashParts([seed]), 36);
  if (!Number.isFinite(hash)) return 0;
  return ((hash % 2000) / 1000 - 1) * scale;
}

// ---------------------------------------------------------------------------
// Layout invalidation key
// ---------------------------------------------------------------------------

export interface LayoutKeyNode {
  readonly id: string;
}
export interface LayoutKeyEdge {
  readonly source: string;
  readonly target: string;
  readonly weight: number;
}

/**
 * A cheap FNV-1a digest of everything that should trigger a re-layout.
 * Colour mode, node scale and filters are deliberately absent: changing them
 * must rebuild the graph *without* moving a single node.
 */
export function graphDataKey(
  nodes: readonly LayoutKeyNode[],
  edges: readonly LayoutKeyEdge[],
  gravity: number,
): string {
  const nodeIds = nodes.map((node) => node.id).sort();
  const edgeIds = edges
    .map((edge) => `${edge.source}->${edge.target}:${Math.round(edge.weight * 1000)}`)
    .sort();
  return `${hashParts(nodeIds)}:${hashParts(edgeIds)}:${nodes.length}:${edges.length}:${gravity.toFixed(2)}`;
}

export function hashParts(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash ^= part.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Position cache
// ---------------------------------------------------------------------------

export interface CachedPosition {
  x: number;
  y: number;
}

export interface PositionSnapshot {
  [id: string]: CachedPosition;
}

/**
 * In-memory position cache with debounced persistence.
 *
 * Seeding new nodes from random coordinates keeps ForceAtlas2 from stacking
 * them on the origin, while every node that already has a position keeps it —
 * that is what prevents the "everything flies around" effect on each rebuild.
 */
export class PositionCache {
  private readonly positions: Map<string, CachedPosition>;
  private dirty = false;
  private timer: number | null = null;

  constructor(
    initial: PositionSnapshot,
    private readonly persist: (snapshot: PositionSnapshot) => void,
    private readonly debounceMs = 1500,
  ) {
    this.positions = new Map();
    for (const [id, position] of Object.entries(initial ?? {})) {
      if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
        this.positions.set(id, { x: position.x, y: position.y });
      }
    }
  }

  has(id: string): boolean {
    return this.positions.has(id);
  }

  get(id: string): CachedPosition | undefined {
    return this.positions.get(id);
  }

  set(id: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.positions.set(id, { x, y });
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Drop positions for notes that no longer exist so the file cannot grow forever. */
  prune(validIds: ReadonlySet<string>): number {
    let removed = 0;
    for (const id of [...this.positions.keys()]) {
      if (!validIds.has(id)) {
        this.positions.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      this.scheduleFlush();
    }
    return removed;
  }

  get size(): number {
    return this.positions.size;
  }

  snapshot(): PositionSnapshot {
    const out: PositionSnapshot = {};
    for (const [id, position] of this.positions) out[id] = position;
    return out;
  }

  /** Persist immediately; call from `onunload`. */
  flush(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.persist(this.snapshot());
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }
}
