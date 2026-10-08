/**
 * Render tuning that depends only on graph size.
 *
 * Kept free of any `sigma` import on purpose: `renderer.ts` pulls in the whole
 * WebGL renderer (which touches `WebGL2RenderingContext` at module load), and
 * these are pure decisions that should be testable — and importable — without a
 * graphics context.
 */

/**
 * Label density and the screen-size threshold below which a label is skipped.
 * Denser labels are affordable while the graph is small.
 */
export function labelTuning(nodeCount: number): { density: number; threshold: number } {
  if (nodeCount > 2500) return { density: 0.08, threshold: 18 };
  if (nodeCount > 1200) return { density: 0.14, threshold: 14 };
  if (nodeCount > 600) return { density: 0.24, threshold: 10 };
  return { density: 0.4, threshold: 4 };
}

/**
 * Whether to drop edges/labels while the camera is moving.
 *
 * Sigma's own defaults are `false` for both, and that is the right answer for a
 * normal vault — this bit us once: the flags were copied unconditionally from
 * the reference implementation, where graphs are far larger, and the result was
 * that the graph visibly emptied out during a pan drag. `hideLabelsOnMove`
 * short-circuits sigma's `render()` before the label, edge-label **and
 * highlight** passes; `hideEdgesOnMove` skips the entire edge pass.
 *
 * They only pay for themselves once there is enough geometry to make a frame
 * expensive, so they are enabled by size rather than unconditionally.
 */
export function movePerformanceFlags(nodeCount: number): {
  hideEdgesOnMove: boolean;
  hideLabelsOnMove: boolean;
} {
  if (nodeCount > 1500) return { hideEdgesOnMove: true, hideLabelsOnMove: true };
  if (nodeCount > 600) return { hideEdgesOnMove: true, hideLabelsOnMove: false };
  return { hideEdgesOnMove: false, hideLabelsOnMove: false };
}
