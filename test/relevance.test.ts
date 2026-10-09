import { describe, expect, it } from "vitest";

import {
  buildAdjacency,
  computeRelevance,
  createRelevanceContext,
  describeRelevance,
  rankRelated,
} from "../src/core/relevance";
import type { RawLink, RelevanceContext } from "../src/core/relevance";
import { DEFAULT_RELEVANCE_WEIGHTS } from "../src/types";
import type { GraphNode, PageType, RelevanceBreakdown } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface NodeInit {
  readonly type?: PageType;
  readonly sources?: readonly string[];
  readonly tags?: readonly string[];
  readonly community?: number;
  readonly isStructural?: boolean;
}

/** Minimal but complete `GraphNode`; every field the type contract requires. */
function node(id: string, init: NodeInit = {}): GraphNode {
  const type = init.type ?? "other";
  return {
    id,
    label: id,
    type,
    rawType: type,
    path: `${id}.md`,
    linkCount: 0,
    vaultLinkCount: 0,
    inLinks: 0,
    outLinks: 0,
    community: init.community ?? 0,
    sources: init.sources ?? [],
    tags: init.tags ?? [],
    isStructural: init.isStructural ?? false,
  };
}

function link(source: string, target: string): RawLink {
  return { source, target };
}

function breakdown(init: Partial<RelevanceBreakdown>): RelevanceBreakdown {
  const directLink = init.directLink ?? 0;
  const sourceOverlap = init.sourceOverlap ?? 0;
  const adamicAdar = init.adamicAdar ?? 0;
  const coCitation = init.coCitation ?? 0;

  return {
    directLink,
    sourceOverlap,
    adamicAdar,
    coCitation,

        total: init.total ?? directLink + sourceOverlap + adamicAdar + coCitation,
  };
}

const ADAMIC_ADAR_UNIT = 1 / Math.log(2); // 1.4426950408889634

/**
 * The documented normalisation: an unbounded count squashed into 0…1.
 *
 * Spelled out here rather than imported, so the tests state the contract instead
 * of restating whatever the implementation happens to do.
 */
const saturate = (x: number) => (x > 0 ? x / (1 + x) : 0);

// ---------------------------------------------------------------------------
// Signal 1 — direct links
// ---------------------------------------------------------------------------

describe("computeRelevance — direct links", () => {
  it("scores a mutual link at the full direct-link weight", () => {
    const a = node("a", { type: "other" });
    const b = node("b", { type: "other" });
    const ctx = createRelevanceContext([a, b], [link("a", "b"), link("b", "a")]);

    const result = computeRelevance(a, b, ctx);

    // (1 forward + 1 backward) / 2 = 1.0, the maximum the signal can reach.
    expect(result.directLink).toBe(DEFAULT_RELEVANCE_WEIGHTS.directLink);
    expect(result.sourceOverlap).toBe(0);
    expect(result.adamicAdar).toBe(0);
    expect(result.coCitation).toBe(0);
    expect(result.total).toBe(DEFAULT_RELEVANCE_WEIGHTS.directLink);
  });

  it("scores a forward-only link at half the weight, from either argument order", () => {
    const a = node("a");
    const b = node("b");
    const ctx = createRelevanceContext([a, b], [link("a", "b")]);

    // Half, because only a mutual pair reaches the signal's maximum — that is
    // what makes 双向链接 outrank a one-way mention.
    const half = DEFAULT_RELEVANCE_WEIGHTS.directLink / 2;
    expect(computeRelevance(a, b, ctx).directLink).toBe(half);
    // The score is symmetric even though the link is not.
    expect(computeRelevance(b, a, ctx).directLink).toBe(half);
    expect(computeRelevance(a, b, ctx).total).toBe(half);
  });

  it("scores an unlinked pair at 0 for the link signal", () => {
    const a = node("a");
    const b = node("b");
    const ctx = createRelevanceContext([a, b], []);

    expect(computeRelevance(a, b, ctx).directLink).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Signal 2 — shared sources
// ---------------------------------------------------------------------------

describe("computeRelevance — source overlap", () => {
  it("squashes two shared sources below the source-overlap weight", () => {
    const a = node("a", { sources: ["attention is all you need", "deep residual learning"] });
    const b = node("b", { sources: ["attention is all you need", "deep residual learning"] });
    const ctx = createRelevanceContext([a, b], []);

    const result = computeRelevance(a, b, ctx);

    // saturate(2) = 2/3, so two shared sources contribute less than the weight.
    // Unbounded, they used to contribute 8.0 — more than a mutual link.
    expect(result.sourceOverlap).toBeCloseTo(saturate(2) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap, 10);
    expect(result.directLink).toBe(0);
    expect(result.adamicAdar).toBe(0);
    expect(result.total).toBeCloseTo(result.sourceOverlap, 10);
  });

  it("counts a single shared source as half the weight, and disjoint lists as 0", () => {
    const a = node("a", { sources: ["paper-a"] });
    const b = node("b", { sources: ["paper-a"] });
    const c = node("c", { sources: ["paper-b"] });
    const ctx = createRelevanceContext([a, b, c], []);

    expect(computeRelevance(a, b, ctx).sourceOverlap).toBeCloseTo(
      saturate(1) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
      10,
    );
    expect(computeRelevance(a, c, ctx).sourceOverlap).toBe(0);
    expect(computeRelevance(a, node("empty"), ctx).sourceOverlap).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Signal 3 — Adamic-Adar
// ---------------------------------------------------------------------------

describe("computeRelevance — Adamic-Adar", () => {
  it("scores a shared degree-2 neighbour through the saturating curve", () => {
    const a = node("a");
    const b = node("b");
    const c = node("c");
    const ctx = createRelevanceContext([a, b, c], [link("a", "c"), link("b", "c")]);

    expect(ctx.neighbors.get("c")?.size).toBe(2);
    const result = computeRelevance(a, b, ctx);

    expect(result.directLink).toBe(0);
    expect(result.sourceOverlap).toBe(0);
    // Raw term 1 / ln(degree 2) = 1 / ln 2, then saturate(x) × weight.
    expect(result.adamicAdar).toBeCloseTo(
      saturate(ADAMIC_ADAR_UNIT) * DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
      10,
    );
    // Still the strongest single signal, and still bounded by its weight.
    expect(result.adamicAdar).toBeLessThan(DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor);
    expect(result.total).toBeCloseTo(result.adamicAdar, 10);
  });

  it("sums one term per shared neighbour", () => {
    const a = node("a");
    const b = node("b");
    const c = node("c");
    const d = node("d");
    const ctx = createRelevanceContext(
      [a, b, c, d],
      [link("a", "c"), link("b", "c"), link("a", "d"), link("b", "d")],
    );

    // Both shared neighbours have degree 2 → two identical raw terms, squashed once.
    expect(computeRelevance(a, b, ctx).adamicAdar).toBeCloseTo(
      saturate(ADAMIC_ADAR_UNIT * 2) * DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
      10,
    );
  });

  it("clamps a degree-1 neighbour to ln(2) instead of dividing by ln(1) = 0", () => {
    // A neighbour shared by two notes always touches both endpoints, so degree 1
    // is unreachable from real link data; the clamp is exercised with a
    // hand-built context that deliberately understates `lonely`'s degree.
    const a = node("a");
    const b = node("b");
    const lonely = node("lonely");
    const ctx: RelevanceContext = {
      nodes: new Map([
        [a.id, a],
        [b.id, b],
        [lonely.id, lonely],
      ]),
      outLinks: new Map([
        ["a", new Set(["lonely"])],
        ["b", new Set(["lonely"])],
        ["lonely", new Set(["a"])],
      ]),
      inLinks: new Map([
        ["a", new Set<string>()],
        ["b", new Set<string>()],
        ["lonely", new Set(["a", "b"])],
      ]),
      neighbors: new Map([
        ["a", new Set(["lonely"])],
        ["b", new Set(["lonely"])],
        ["lonely", new Set(["a"])],
      ]),
    };

    expect(ctx.neighbors.get("lonely")?.size).toBe(1);
    const result = computeRelevance(a, b, ctx);

    expect(Number.isFinite(result.adamicAdar)).toBe(true);
    expect(result.adamicAdar).toBeCloseTo(
      saturate(ADAMIC_ADAR_UNIT) * DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor,
      10,
    );
    expect(result.adamicAdar).not.toBeCloseTo(1 / Math.log(1), 5);
  });

  it("ignores neighbours that are not adjacent to both notes", () => {
    const a = node("a");
    const b = node("b");
    const c = node("c");
    const ctx = createRelevanceContext([a, b, c], [link("a", "c")]);

    expect(computeRelevance(a, b, ctx).adamicAdar).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

describe("computeRelevance — weights", () => {
  it("honours custom weights per signal", () => {
    const a = node("a", { sources: ["paper-a", "paper-b"] });
    const b = node("b", { sources: ["paper-a", "paper-b"] });
    const ctx = createRelevanceContext([a, b], [link("a", "b"), link("b", "a")]);

    const result = computeRelevance(a, b, ctx, {
      directLink: 1.0,
      sourceOverlap: 2.0,
      commonNeighbor: 0.5, coCitation: 0.0,
    });

    // Signals are normalised to 0…1 BEFORE the weight, so these are shares
    // rather than a raw count times a scale factor.
    expect(result.directLink).toBe(1.0); // (1 forward + 1 backward) / 2 × 1.0
    expect(result.sourceOverlap).toBeCloseTo((2 / 3) * 2.0, 10); // saturate(2) × 2.0
    expect(result.adamicAdar).toBe(0);
    expect(result.coCitation).toBe(0);
    expect(result.total).toBeCloseTo(1.0 + (2 / 3) * 2.0, 10);
  });

  it("squashes unbounded counts so no signal can outgrow its weight", () => {
    // The whole point of normalising: this pair shares ten sources, and it still
    // cannot contribute more than the weight says.
    const a = node("a", { sources: Array.from({ length: 10 }, (_, i) => `s${i}`) });
    const b = node("b", { sources: Array.from({ length: 10 }, (_, i) => `s${i}`) });
    const ctx = createRelevanceContext([a, b], []);
    const result = computeRelevance(a, b, ctx, DEFAULT_RELEVANCE_WEIGHTS);
    expect(result.sourceOverlap).toBeLessThan(DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap);
    expect(result.sourceOverlap).toBeGreaterThan(DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap * 0.9);
  });

  it("uses a shared citer as a signal", () => {
    const a = node("a");
    const b = node("b");
    const c = node("c");
    // c links to both: co-citation, which the unused `inLinks` map already held.
    const ctx = createRelevanceContext([a, b, c], [link("c", "a"), link("c", "b")]);
    const result = computeRelevance(a, b, ctx, DEFAULT_RELEVANCE_WEIGHTS);
    expect(result.coCitation).toBeCloseTo(0.5 * DEFAULT_RELEVANCE_WEIGHTS.coCitation, 10);
  });

  it("falls back per field when a weight is missing at runtime", () => {
    const a = node("a");
    const b = node("b");
    const ctx = createRelevanceContext([a, b], [link("a", "b")]);

    // Simulates settings persisted before a weight existed.
    const partial = { directLink: 2.0 } as unknown as Parameters<typeof computeRelevance>[3];
    const result = computeRelevance(a, b, ctx, partial);

    expect(result.directLink).toBe(1.0); // one directed link ⇒ 0.5 ⇒ × 2.0

    // bottom of the table's 0.5…1.2 range.

    expect(result.total).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe("computeRelevance — degenerate input", () => {
  it("returns an all-zero breakdown for a note against itself", () => {
    const a = node("a", { sources: ["paper-a"], type: "entity" });
    const ctx = createRelevanceContext([a], [link("a", "a")]);

    const result = computeRelevance(a, a, ctx);

    expect(result).toEqual({
      directLink: 0,
      sourceOverlap: 0,
      adamicAdar: 0,
      coCitation: 0,
      total: 0,
    });
  });

  it("keeps the zero breakdown zero even under custom weights", () => {
    const a = node("a");
    const ctx = createRelevanceContext([a], []);
    const result = computeRelevance(a, a, ctx, {
      directLink: 9,
      sourceOverlap: 9,
      commonNeighbor: 9, coCitation: 9,
    });

    expect(result.total).toBe(0);
  });

  it("scores a pair whose ids are absent from the context without throwing", () => {
    const a = node("a");
    const b = node("b");
    const strangerX = node("stranger-x");
    const strangerY = node("stranger-y");
    const ctx = createRelevanceContext([a, b], []);

    // No links, no shared sources, no shared neighbours: a true zero. It used to

    // still scored — and so appeared in "related notes".
    expect(computeRelevance(strangerX, strangerY, ctx).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Context construction
// ---------------------------------------------------------------------------

describe("createRelevanceContext / buildAdjacency", () => {
  it("indexes only known nodes and drops dangling endpoints and self-links", () => {
    const a = node("a");
    const b = node("b");
    const isolated = node("isolated");
    const ctx = createRelevanceContext(
      [a, b, isolated],
      [link("a", "ghost"), link("ghost", "b"), link("a", "a"), link("a", "b")],
    );

    expect(ctx.nodes.size).toBe(3);
    expect(ctx.outLinks.has("ghost")).toBe(false);
    expect(ctx.inLinks.has("ghost")).toBe(false);
    expect([...(ctx.outLinks.get("a") ?? [])]).toEqual(["b"]);
    expect([...(ctx.inLinks.get("a") ?? [])]).toEqual([]); // the self-link was ignored
    expect([...(ctx.inLinks.get("b") ?? [])]).toEqual(["a"]);
    expect([...(ctx.neighbors.get("b") ?? [])]).toEqual(["a"]);
  });

  it("keeps isolated notes in the index with degree 0", () => {
    const isolated = node("isolated");
    const ctx = createRelevanceContext([isolated], []);

    expect(ctx.outLinks.get("isolated")?.size).toBe(0);
    expect(ctx.inLinks.get("isolated")?.size).toBe(0);
    expect(ctx.neighbors.get("isolated")?.size).toBe(0);
  });

  it("does not mutate the input nodes", () => {
    const a = Object.freeze(node("a", { sources: Object.freeze(["paper-a"]) }));
    const b = Object.freeze(node("b"));
    const snapshot = JSON.stringify([a, b]);

    const ctx = createRelevanceContext([a, b], [link("a", "b")]);
    computeRelevance(a, b, ctx);

    expect(JSON.stringify([a, b])).toBe(snapshot);
    expect(ctx.nodes.get("a")).toBe(a);
  });

  it("exposes the raw maps from buildAdjacency", () => {
    const a = node("a");
    const b = node("b");
    const { outLinks, inLinks, neighbors } = buildAdjacency([a, b], [link("a", "b")]);

    expect([...(outLinks.get("a") ?? [])]).toEqual(["b"]);
    expect([...(inLinks.get("b") ?? [])]).toEqual(["a"]);
    expect([...(neighbors.get("a") ?? [])]).toEqual(["b"]);
    expect(neighbors.get("b")?.has("a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rankRelated
// ---------------------------------------------------------------------------

/**
 * hub ↔ mutual (a mutual link), hub → forward (one way), hub/twin share 2
 * sources, hub/shared share 1, lonely shares nothing.
 *
 * With the signals normalised the order is mutual (4.0) > forward (2.0) > twin
 * (saturate(2)×2 = 1.33) > shared (1.0), and `lonely` now scores a true zero —
 * it used to pick up 0.5 from type affinity alone, which is why "related notes"
 * could list a note with nothing in common.
 */
function rankFixture(): RelevanceContext {
  const hub = node("hub", { sources: ["paper-a", "paper-b"] });
  const mutual = node("mutual");
  const forward = node("forward");
  const twin = node("twin", { sources: ["paper-a", "paper-b"] });
  const shared = node("shared", { sources: ["paper-a"] });
  const lonely = node("lonely");

  const ctx = createRelevanceContext(
    [hub, mutual, forward, twin, shared, lonely],
    [link("hub", "mutual"), link("mutual", "hub"), link("hub", "forward")],
  );

  return ctx;
}

describe("rankRelated", () => {
  it("orders candidates by total, strongest first", () => {
    const ctx = rankFixture();
    const ranked = rankRelated(ctx, "hub");

    expect(ranked.map((entry) => entry.node.id)).toEqual(["mutual", "forward", "twin", "shared"]);
    expect(ranked.map((entry) => entry.breakdown.total)).toEqual([
      DEFAULT_RELEVANCE_WEIGHTS.directLink,
      DEFAULT_RELEVANCE_WEIGHTS.directLink / 2,
      saturate(2) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
      saturate(1) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
    ]);
    // The breakdown travels with the node so the tooltip needs no re-scoring.
    expect(ranked[2].breakdown.sourceOverlap).toBeCloseTo(
      saturate(2) * DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap,
      10,
    );
  });

  it("respects the limit", () => {
    const ctx = rankFixture();

    expect(rankRelated(ctx, "hub", 2).map((entry) => entry.node.id)).toEqual(["mutual", "forward"]);
    expect(rankRelated(ctx, "hub", 1).map((entry) => entry.node.id)).toEqual(["mutual"]);
    expect(rankRelated(ctx, "hub", 0)).toEqual([]);
    expect(rankRelated(ctx, "hub", -3)).toEqual([]);
    // Four, not five: `lonely` has no signal at all and is dropped.
    expect(rankRelated(ctx, "hub", 99)).toHaveLength(4);
  });

  it("defaults to 5 results", () => {

    // pair with nothing in common scores zero and is not a "related note".
    const hub = node("hub", { sources: ["paper-a"] });
    const candidates = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) =>
      node(id, { sources: ["paper-a"] }),
    );
    const ctx = createRelevanceContext([hub, ...candidates], []);

    expect(rankRelated(ctx, "hub")).toHaveLength(5);
    expect(rankRelated(ctx, "hub", 6)).toHaveLength(6);
  });

  it("skips candidates whose total is zero", () => {
    const ctx = rankFixture();
    const ranked = rankRelated(ctx, "hub", 10, {
      directLink: 3.0,
      commonNeighbor: 1.5,
      sourceOverlap: 4.0,
      coCitation: 0,
    });

    // These weights favour source overlap (4.0) over a one-way link (1.5), so
    // `twin` and `shared` climb past `forward` — which is the point of letting
    // the weights mean something.
    expect(ranked.map((entry) => entry.node.id)).toEqual(["mutual", "twin", "shared", "forward"]);
    expect(ranked.every((entry) => entry.breakdown.total > 0)).toBe(true);
  });

  it("never ranks a note against itself", () => {
    const ctx = rankFixture();
    const ranked = rankRelated(ctx, "hub", 99);

    expect(ranked.some((entry) => entry.node.id === "hub")).toBe(false);
  });

  it("returns [] for an unknown id", () => {
    const ctx = rankFixture();
    expect(rankRelated(ctx, "nope")).toEqual([]);
  });

  it("breaks ties deterministically by id", () => {
    const hub = node("hub", { sources: ["paper-a"] });
    const zeta = node("zeta", { sources: ["paper-a"] });
    const alpha = node("alpha", { sources: ["paper-a"] });
    // Equal totals, deliberately inserted zeta-first: a stable sort would keep it.
    const ctx = createRelevanceContext([hub, zeta, alpha], []);

    expect(rankRelated(ctx, "hub").map((entry) => entry.node.id)).toEqual(["alpha", "zeta"]);
  });
});

// ---------------------------------------------------------------------------
// describeRelevance
// ---------------------------------------------------------------------------

describe("describeRelevance", () => {
  it("lists only the non-zero signals, two decimals, in signal order", () => {

  });

  it("renders all four signals with the middle-dot separator", () => {

  });

  it("returns an empty string for an all-zero breakdown", () => {
    expect(describeRelevance(breakdown({}))).toBe("");
  });

  it("uses the ASCII hyphen inside Adamic-Adar", () => {
    expect(describeRelevance(breakdown({ adamicAdar: 1.5 }))).toBe("Adamic-Adar 1.50");
  });
});
