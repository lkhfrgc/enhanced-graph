/**
 * Reads the layout the built-in graph view has already computed.
 *
 * Obsidian runs its force simulation in a dedicated worker (`sim.js`) and writes
 * the result straight onto the live node objects every frame:
 *
 *     nodeLookup[id].x = positions[2 * i]
 *     nodeLookup[id].y = positions[2 * i + 1]
 *
 * Those coordinates are therefore readable from a plugin, which lets our own
 * sigma view adopt the official layout instead of paying for a second
 * ForceAtlas2 pass on the main thread — and makes the two views agree.
 *
 * This is a **snapshot**, not a live mirror: the built-in simulation keeps
 * running while its view is open, so positions are sampled when our graph is
 * rebuilt (or when the user asks to re-sync).
 */

import type { App } from "obsidian";
import {
  OFFICIAL_GRAPH_VIEW_TYPES,
  normalizeOfficialNodeId,
  officialRendererOf,
} from "./official-internals";

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface OfficialLayoutSnapshot {
  /** Keyed by OUR node id (lower-cased vault path without `.md`). */
  readonly positions: ReadonlyMap<string, LayoutPoint>;
  /** Which built-in view the positions came from. */
  readonly viewType: string;
  /** Nodes the built-in graph currently holds, mapped or not. */
  readonly officialNodeCount: number;
  /** `positions.size / requested` — how much of our graph the snapshot covers. */
  readonly coverage: number;
}

/**
 * Below this share of mapped nodes the snapshot is rejected and ForceAtlas2
 * runs instead. A partially-mapped seed would leave the unmapped half
 * extrapolated from very little, which looks worse than a real layout.
 */
export const MIN_LAYOUT_COVERAGE = 0.6;

export interface CaptureOptions {
  /** Reject snapshots below this coverage. Defaults to {@link MIN_LAYOUT_COVERAGE}. */
  readonly minCoverage?: number;
}

/**
 * Snapshot the built-in layout for the given node ids.
 *
 * Returns `null` when no built-in graph is open, when it holds no usable
 * coordinates, or when it covers too little of `requiredIds`.
 */
export function captureOfficialLayout(
  app: App,
  requiredIds: readonly string[],
  options: CaptureOptions = {},
): OfficialLayoutSnapshot | null {
  if (requiredIds.length === 0) return null;
  const minCoverage = options.minCoverage ?? MIN_LAYOUT_COVERAGE;
  const wanted = new Set(requiredIds);

  let best: OfficialLayoutSnapshot | null = null;
  for (const viewType of OFFICIAL_GRAPH_VIEW_TYPES) {
    for (const leaf of app.workspace.getLeavesOfType(viewType)) {
      const renderer = officialRendererOf(leaf);
      const lookup = renderer?.nodeLookup;
      if (!lookup || typeof lookup !== "object") continue;

      const positions = new Map<string, LayoutPoint>();
      let officialNodeCount = 0;
      for (const [officialId, node] of Object.entries(lookup)) {
        if (!node) continue;
        officialNodeCount += 1;
        const x = node.x;
        const y = node.y;
        if (typeof x !== "number" || typeof y !== "number") continue;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const id = normalizeOfficialNodeId(node.id ?? officialId);
        if (!wanted.has(id) || positions.has(id)) continue;
        positions.set(id, { x, y });
      }
      if (positions.size === 0) continue;

      const snapshot: OfficialLayoutSnapshot = {
        positions,
        viewType,
        officialNodeCount,
        coverage: positions.size / wanted.size,
      };
      // Prefer whichever open view covers our graph best.
      if (!best || snapshot.coverage > best.coverage) best = snapshot;
    }
  }

  if (!best || best.coverage < minCoverage) return null;
  return best;
}

/**
 * Re-exported so the settings screen can keep importing it from here; the
 * implementation lives with the other view-type knowledge in
 * `official-internals`.
 */
export { hasOfficialGraphView } from "./official-internals";
