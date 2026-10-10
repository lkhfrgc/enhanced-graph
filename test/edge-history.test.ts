/**
 * Edge history and burst detection.
 *
 * The history file is written before it is needed, because a vault's timestamps record
 * when a *note* changed and never when a *link* appeared — so "which links did I add
 * this month" is unanswerable forever without a snapshot taken now. That makes the
 * parser's tolerance a correctness property, not a nicety: it holds the only copy of
 * something that cannot be reconstructed, so a truncated last line (the expected shape
 * of a crash mid-append) must cost one line, not the file.
 *
 * The burst detector is Kleinberg's two-state model. It is tested against an injected
 * burst, which is the only way to know a detector fires when it should *and* stays
 * quiet when it should not.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_HISTORY,
  deliberateNonLinks,
  firstSeenSeries,
  linksSince,
  observeEdges,
  parseEdgeHistory,
} from "../src/core/edge-history";
import { detectBursts } from "../src/core/insights/trend";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 10);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parseEdgeHistory", () => {
  it("reads one record per line", () => {
    const text = [
      JSON.stringify({ key: "a:::b", firstSeen: 1, lastSeen: 2 }),
      JSON.stringify({ key: "b:::c", firstSeen: 3, lastSeen: 4 }),
    ].join("\n");

    const history = parseEdgeHistory(text);
    expect(history.records.size).toBe(2);
    expect(history.records.get("a:::b")?.firstSeen).toBe(1);
  });

  it("keeps the rest of the file when the last line is truncated", () => {
    // The shape of a crash during an append. Losing the whole history here would throw
    // away the only copy of data that cannot be rebuilt.
    const text = [
      JSON.stringify({ key: "a:::b", firstSeen: 1, lastSeen: 1 }),
      '{"key":"broken:::line","first',
    ].join("\n");

    const history = parseEdgeHistory(text);
    expect(history.records.size).toBe(1);
    expect(history.records.has("a:::b")).toBe(true);
  });

  it("ignores blank lines and records missing a key", () => {
    const text = ["", "   ", JSON.stringify({ firstSeen: 5 }), JSON.stringify({ key: "x:::y", firstSeen: 7 })].join("\n");

    const history = parseEdgeHistory(text);
    expect([...history.records.keys()]).toEqual(["x:::y"]);
  });

  it("defaults lastSeen to firstSeen when the field is absent", () => {
    const history = parseEdgeHistory(JSON.stringify({ key: "a:::b", firstSeen: 9 }));
    expect(history.records.get("a:::b")?.lastSeen).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Observing
// ---------------------------------------------------------------------------

describe("observeEdges", () => {
  it("records a pair the first time it is seen", () => {
    const result = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "b" }], NOW);

    expect(result.discovered).toBe(1);
    expect(result.appended).toHaveLength(1);
    expect(result.history.records.get("a:::b")?.firstSeen).toBe(NOW);
  });

  it("never moves firstSeen once it is set", () => {
    // The whole value of the file is *when the link appeared*; refreshing it on every
    // rebuild would make every link look new and the history worthless.
    const first = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "b" }], NOW - 30 * DAY);
    const second = observeEdges(first.history, [{ source: "a", target: "b" }], NOW);

    expect(second.history.records.get("a:::b")?.firstSeen).toBe(NOW - 30 * DAY);
    expect(second.history.records.get("a:::b")?.lastSeen).toBe(NOW);
    // And nothing is appended for a pair already recorded, so the file grows by the
    // delta rather than being rewritten.
    expect(second.appended).toEqual([]);
    expect(second.discovered).toBe(0);
  });

  it("keys a pair the same way round either way", () => {
    const forward = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "b" }], NOW);
    const backward = observeEdges(EMPTY_HISTORY, [{ source: "b", target: "a" }], NOW);

    expect([...forward.history.records.keys()]).toEqual([...backward.history.records.keys()]);
  });

  it("ignores a self-link", () => {
    const result = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "a" }], NOW);
    expect(result.discovered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Series and negatives
// ---------------------------------------------------------------------------

describe("firstSeenSeries", () => {
  it("buckets links by when they first appeared, anchored to now", () => {
    const history = observeEdges(
      EMPTY_HISTORY,
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
      NOW - DAY,
    ).history;

    const series = firstSeenSeries(history, NOW, 4, 7 * DAY);
    expect(series.reduce((sum, value) => sum + value, 0)).toBe(2);
    // The last bucket is the most recent window, which is where a link added yesterday
    // has to land for a burst to mean "recently".
    expect(series[series.length - 1]).toBe(2);
  });

  it("ignores links older than the window", () => {
    const history = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "b" }], NOW - 400 * DAY).history;
    const series = firstSeenSeries(history, NOW, 4, 7 * DAY);
    expect(series.reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("finds links since a cutoff", () => {
    const history = observeEdges(EMPTY_HISTORY, [{ source: "a", target: "b" }], NOW - 5 * DAY).history;
    expect(linksSince(history, NOW - 10 * DAY)).toHaveLength(1);
    expect(linksSince(history, NOW - DAY)).toHaveLength(0);
  });
});

describe("deliberateNonLinks", () => {
  const history = observeEdges(EMPTY_HISTORY, [{ source: "x", target: "y" }], NOW - 200 * DAY).history;

  it("returns a high-scoring pair the history has never seen", () => {
    // This is the negative class a held-out-link protocol cannot see: a pair a user has
    // had every chance to link and has not.
    const result = deliberateNonLinks([{ key: "a:::b", score: 0.9 }], history, NOW - 100 * DAY, 0.5);
    expect(result.map((entry) => entry.key)).toEqual(["a:::b"]);
  });

  it("excludes a pair that is or was a link", () => {
    const result = deliberateNonLinks([{ key: "x:::y", score: 0.9 }], history, NOW - 100 * DAY, 0.5);
    expect(result).toEqual([]);
  });

  it("excludes a pair below the score bar", () => {
    const result = deliberateNonLinks([{ key: "a:::b", score: 0.1 }], history, NOW - 100 * DAY, 0.5);
    expect(result).toEqual([]);
  });

  it("returns nothing when the history had not started yet", () => {
    // Negative control: absence of a link only means rejection if the file was already
    // running. Without this, a freshly installed plugin would report every candidate in
    // the vault as a deliberate non-link.
    const fresh = observeEdges(EMPTY_HISTORY, [{ source: "x", target: "y" }], NOW - DAY).history;
    const result = deliberateNonLinks([{ key: "a:::b", score: 0.9 }], fresh, NOW - 100 * DAY, 0.5);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bursts
// ---------------------------------------------------------------------------

describe("detectBursts", () => {
  it("finds an injected burst window", () => {
    // A flat baseline with a spike in one window: the detector has to point at the
    // spike, which is the only claim a burst card makes.
    const counts = [1, 1, 1, 1, 1, 1, 9, 1, 1, 1, 1, 1];
    const bursts = detectBursts(counts);

    expect(bursts.length).toBeGreaterThan(0);
    expect(bursts.some((burst) => burst.start <= 6 && burst.end >= 6)).toBe(true);
  });

  it("finds nothing in a flat series", () => {
    // Negative control. A detector that fires on any series is the same as no detector,
    // and a personal vault is mostly flat.
    expect(detectBursts([2, 2, 2, 2, 2, 2, 2, 2])).toEqual([]);
  });

  it("finds nothing in an all-zero series", () => {
    expect(detectBursts([0, 0, 0, 0, 0, 0])).toEqual([]);
  });

  it("refuses a series too short to have a baseline", () => {
    expect(detectBursts([5, 5])).toEqual([]);
  });

  it("reports the sharpest burst first", () => {
    const counts = [1, 1, 8, 1, 1, 1, 1, 4, 1, 1];
    const bursts = detectBursts(counts);
    if (bursts.length > 1) {
      expect(bursts[0]!.weight).toBeGreaterThanOrEqual(bursts[1]!.weight);
    }
  });
});
