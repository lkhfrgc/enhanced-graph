/**
 * Tests for the render-loop tuning that depends on graph size.
 *
 * `movePerformanceFlags` exists because sigma's `hideEdgesOnMove` /
 * `hideLabelsOnMove` were copied unconditionally from the reference
 * implementation, where graphs are much larger. On a normal vault they make the
 * graph visibly empty out during a pan drag: `hideLabelsOnMove` short-circuits
 * `render()` before the label, edge-label AND highlight passes, and
 * `hideEdgesOnMove` skips the entire edge pass.
 */

import { describe, expect, it } from "vitest";

import { labelTuning, movePerformanceFlags } from "../src/view/tuning";

describe("movePerformanceFlags", () => {
  it("leaves both passes alone for a normal vault", () => {
    for (const nodeCount of [0, 1, 79, 300, 600]) {
      expect(movePerformanceFlags(nodeCount)).toEqual({
        hideEdgesOnMove: false,
        hideLabelsOnMove: false,
      });
    }
  });

  it("drops only the edges for a medium graph", () => {
    for (const nodeCount of [601, 900, 1500]) {
      expect(movePerformanceFlags(nodeCount)).toEqual({
        hideEdgesOnMove: true,
        hideLabelsOnMove: false,
      });
    }
  });

  it("drops both only for a genuinely large graph", () => {
    for (const nodeCount of [1501, 5000, 50_000]) {
      expect(movePerformanceFlags(nodeCount)).toEqual({
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
      });
    }
  });

  it("is a pure function of the node count", () => {
    expect(movePerformanceFlags(1200)).toEqual(movePerformanceFlags(1200));
  });

  it("keeps labels visible up to the point where the frame cost justifies it", () => {
    // Regression guard: labels must never be dropped on a graph the built-in
    // view handles comfortably (~600 nodes is well inside its budget).
    expect(movePerformanceFlags(600).hideLabelsOnMove).toBe(false);
  });
});

describe("labelTuning", () => {
  it("gets denser as the graph gets smaller", () => {
    const dense = labelTuning(100);
    const sparse = labelTuning(5000);
    expect(dense.density).toBeGreaterThan(sparse.density);
    expect(dense.threshold).toBeLessThan(sparse.threshold);
  });

  it("never returns a non-positive density", () => {
    for (const nodeCount of [0, 10, 600, 1200, 2500, 10_000]) {
      const tuning = labelTuning(nodeCount);
      expect(tuning.density).toBeGreaterThan(0);
      expect(tuning.threshold).toBeGreaterThanOrEqual(0);
    }
  });
});
