/**
 * Measures whether the association model actually ranks related notes well, and
 * whether a different weighting or a different signal set would do better.
 *
 * Method — link prediction against the vault's own wikilinks:
 *
 *   1. build the graph from a real vault;
 *   2. hold out a fifth of the links;
 *   3. rebuild the adjacency WITHOUT them, so the held-out pairs have no direct
 *      link left to give the answer away;
 *   4. score every held-out pair and a large sample of truly unconnected pairs;
 *   5. AUC = how often a held-out (genuinely related) pair outscores a random
 *      unrelated one. 0.5 is a coin flip, 1.0 is perfect.
 *
 * The question "are the weights well chosen?" then has an answer in numbers,
 * separately for each signal and for each candidate combination, instead of an
 * argument about which constant feels right.
 *
 * Usage: npm run eval:weights -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";
import { buildWikiGraph } from "../src/core/graph-builder";
import {
  computeRelevance,
  createRelevanceContext,
  type RawLink,
  type RelevanceContext,
} from "../src/core/relevance";
import {
  DEFAULT_RELEVANCE_WEIGHTS,
  type GraphNode,
  type RelevanceWeights,
} from "../src/types";
import type { VaultAdapter } from "../src/core/vault";

const vaultRoot = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"),
);
const HOLDOUT_RATIO = 0.2;
const NEGATIVE_SAMPLES = 20000;
const SEED = 20261007;

class NodeVault implements VaultAdapter {
  async listMarkdownFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith(".md")) {
          out.push(path.relative(vaultRoot, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(vaultRoot);
    return out.sort();
  }
  async read(relative: string): Promise<string> {
    return fs.readFileSync(path.join(vaultRoot, relative), "utf8");
  }
  async exists(relative: string): Promise<boolean> {
    return fs.existsSync(path.join(vaultRoot, relative));
  }
}

/** Deterministic PRNG, so two runs of the same experiment are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

function auc(positives: number[], negatives: number[]): number {
  // Rank-based: equal to the probability that a positive outscores a negative,
  // with ties counting half. Sorting once beats comparing every pair.
  const all = [
    ...positives.map((score) => ({ score, positive: true })),
    ...negatives.map((score) => ({ score, positive: false })),
  ].sort((x, y) => x.score - y.score);

  let rank = 0;
  let positiveRankSum = 0;
  let index = 0;
  while (index < all.length) {
    let end = index;
    while (end + 1 < all.length && all[end + 1].score === all[index].score) end += 1;
    const averageRank = (index + end) / 2 + 1;
    for (let i = index; i <= end; i += 1) {
      if (all[i].positive) positiveRankSum += averageRank;
    }
    rank += end - index + 1;
    index = end + 1;
  }
  const n1 = positives.length;
  const n0 = negatives.length;
  if (n1 === 0 || n0 === 0) return 0.5;
  return (positiveRankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

function describe(label: string, values: number[]): string {
  if (values.length === 0) return `${label} (no values)`;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    `${label}: mean ${mean.toFixed(2)}  p50 ${pick(0.5).toFixed(2)}  ` +
    `p99 ${pick(0.99).toFixed(2)}  max ${sorted[sorted.length - 1].toFixed(2)}`
  );
}

// --- alternative signal formulations --------------------------------------

/** Shared sources as a Jaccard ratio rather than a raw count. */
function sourceJaccard(a: GraphNode, b: GraphNode): number {
  if (a.sources.length === 0 || b.sources.length === 0) return 0;
  const setA = new Set(a.sources);
  let shared = 0;
  for (const source of b.sources) if (setA.has(source)) shared += 1;
  if (shared === 0) return 0;
  const union = new Set([...a.sources, ...b.sources]).size;
  return shared / union;
}

/** Adamic-Adar divided by the geometric mean degree — a cosine on neighbours. */
function adamicAdarNormalised(a: GraphNode, b: GraphNode, ctx: RelevanceContext): number {
  const na = ctx.neighbors.get(a.id);
  const nb = ctx.neighbors.get(b.id);
  if (!na || !nb || na.size === 0 || nb.size === 0) return 0;
  let sum = 0;
  const [small, large] = na.size <= nb.size ? [na, nb] : [nb, na];
  for (const id of small) {
    if (!large.has(id)) continue;
    const degree = ctx.neighbors.get(id)?.size ?? 0;
    sum += 1 / Math.log(Math.max(degree, 2));
  }
  return sum / Math.sqrt(na.size * nb.size);
}

/** Co-citation: notes that both link TO the same target. Uses the `inLinks` map. */
function coCitation(a: GraphNode, b: GraphNode, ctx: RelevanceContext): number {
  const ia = ctx.inLinks.get(a.id);
  const ib = ctx.inLinks.get(b.id);
  if (!ia || !ib || ia.size === 0 || ib.size === 0) return 0;
  let shared = 0;
  const [small, large] = ia.size <= ib.size ? [ia, ib] : [ib, ia];
  for (const id of small) if (large.has(id)) shared += 1;
  return shared;
}

/** Shared-source count, exposed for the raw-signal comparison. */
function countSharedSourcesPublic(a: GraphNode, b: GraphNode): number {
  if (a.sources.length === 0 || b.sources.length === 0) return 0;
  const setA = new Set(a.sources);
  let shared = 0;
  for (const source of b.sources) if (setA.has(source)) shared += 1;
  return shared;
}

/** Raw Adamic-Adar, unweighted and unnormalised. */
function adamicAdarRaw(a: GraphNode, b: GraphNode, ctx: RelevanceContext): number {
  const na = ctx.neighbors.get(a.id);
  const nb = ctx.neighbors.get(b.id);
  if (!na || !nb) return 0;
  let sum = 0;
  const [small, large] = na.size <= nb.size ? [na, nb] : [nb, na];
  for (const id of small) {
    if (!large.has(id)) continue;
    sum += 1 / Math.log(Math.max(ctx.neighbors.get(id)?.size ?? 0, 2));
  }
  return sum;
}
async function main() {
  const vault = new NodeVault();
  const files = await vault.listMarkdownFiles();
  const graph = await buildWikiGraph({ vault });

  console.log(`vault: ${vaultRoot}`);
  console.log(`notes: ${graph.nodes.length}   links: ${graph.edges.length}\n`);

  const random = mulberry32(SEED);
  const shuffled = [...graph.edges].sort(() => random() - 0.5);
  const holdoutCount = Math.floor(shuffled.length * HOLDOUT_RATIO);
  const heldOut = shuffled.slice(0, holdoutCount);
  const kept = shuffled.slice(holdoutCount);
  const heldOutKeys = new Set(heldOut.map((edge) => pairKey(edge.source, edge.target)));

  // Adjacency WITHOUT the held-out links: the scorer must rediscover them from
  // shared sources, shared neighbours and type alone.
  const keptLinks: RawLink[] = kept.map((edge) => ({ source: edge.source, target: edge.target }));
  const ctx = createRelevanceContext(graph.nodes, keptLinks);

  const heldOutPairs: Array<[GraphNode, GraphNode]> = [];
  for (const edge of heldOut) {
    const a = ctx.nodes.get(edge.source);
    const b = ctx.nodes.get(edge.target);
    if (a && b) heldOutPairs.push([a, b]);
  }

  const edgeKeys = new Set(graph.edges.map((edge) => pairKey(edge.source, edge.target)));
  const ids = [...ctx.nodes.keys()];
  const negativePairs: Array<[GraphNode, GraphNode]> = [];
  let guard = 0;
  while (negativePairs.length < NEGATIVE_SAMPLES && guard < NEGATIVE_SAMPLES * 20) {
    guard += 1;
    const a = ctx.nodes.get(ids[Math.floor(random() * ids.length)]);
    const b = ctx.nodes.get(ids[Math.floor(random() * ids.length)]);
    if (!a || !b || a.id === b.id) continue;
    if (edgeKeys.has(pairKey(a.id, b.id))) continue;
    if (heldOutKeys.has(pairKey(a.id, b.id))) continue;
    negativePairs.push([a, b]);
  }

  console.log(
    `held-out links: ${heldOutPairs.length}   random unrelated pairs: ${negativePairs.length}\n`,
  );

  // --- where each signal actually lives -------------------------------------
  console.log("=== signal scale (on the held-out pairs) ===");
  const weights = DEFAULT_RELEVANCE_WEIGHTS;
  const parts = {
    directLink: [] as number[],
    sourceOverlap: [] as number[],
    adamicAdar: [] as number[],
  };
  for (const [a, b] of heldOutPairs) {
    const breakdown = computeRelevance(a, b, ctx, weights);
    parts.directLink.push(breakdown.directLink);
    parts.sourceOverlap.push(breakdown.sourceOverlap);
    parts.adamicAdar.push(breakdown.adamicAdar);
  }
  for (const [name, values] of Object.entries(parts)) console.log("  " + describe(name, values));

  const rawSources = heldOutPairs.map(([a, b]) =>
    computeRelevance(a, b, ctx, { ...weights, sourceOverlap: 1, directLink: 0, commonNeighbor: 0, typeAffinity: 0 }).sourceOverlap,
  );
  const rawAA = heldOutPairs.map(([a, b]) =>
    computeRelevance(a, b, ctx, { ...weights, commonNeighbor: 1, directLink: 0, sourceOverlap: 0, typeAffinity: 0 }).adamicAdar,
  );
  console.log("  " + describe("sourceOverlap (raw count)", rawSources));
  console.log("  " + describe("adamicAdar (raw sum)", rawAA));

  // --- raw signals, so a candidate vector can be compared on equal footing ---
  //
  // `computeRelevance` has no co-citation term at all, so the comparison runs on
  // the raw signals and applies each candidate's own weights. That also makes the
  // scale of every signal visible, which is what a weight has to be chosen against.
  const rawSignals = (a: GraphNode, b: GraphNode, ctx: RelevanceContext) => {
    const forward = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
    const backward = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
    const breakdown = computeRelevance(a, b, ctx, { directLink: 0, sourceOverlap: 0, commonNeighbor: 0, typeAffinity: 0 });
    return {
      direct: forward + backward,
      sources: countSharedSourcesPublic(a, b),
      adamicAdar: adamicAdarRaw(a, b, ctx),
      coCitation: coCitation(a, b, ctx),
    };
  };

  type Vector = [number, number, number, number];
  const applyVector = (signals: ReturnType<typeof rawSignals>, v: Vector) =>
    signals.direct * v[0] +
    signals.sources * v[1] +
    signals.adamicAdar * v[2] +
    signals.coCitation * v[3];

  // --- normalisation variants -------------------------------------------------
  //
  // The weights can only mean "relative importance" if every signal is on the
  // same scale first. Each unbounded signal therefore gets a bounded form, and
  // the alternatives are measured rather than assumed:
  //   saturate(x) = x / (1 + x)   monotone, 0..1, no ceiling effect on small x
  //   Jaccard     = shared / union (source overlap, degree-fair)
  //   cosine      = adamic-adar / sqrt(deg_a * deg_b)
  const saturate = (x: number) => x / (1 + x);
  const jaccard = (a: GraphNode, b: GraphNode) => {
    if (a.sources.length === 0 || b.sources.length === 0) return 0;
    const setA = new Set(a.sources);
    let shared = 0;
    for (const source of b.sources) if (setA.has(source)) shared += 1;
    if (shared === 0) return 0;
    return shared / new Set([...a.sources, ...b.sources]).size;
  };
  const adamicCosine = (a: GraphNode, b: GraphNode, ctx: RelevanceContext) => {
    const na = ctx.neighbors.get(a.id);
    const nb = ctx.neighbors.get(b.id);
    if (!na || !nb || na.size === 0 || nb.size === 0) return 0;
    return adamicAdarRaw(a, b, ctx) / Math.sqrt(na.size * nb.size);
  };

  type Normalised = { direct: number; sources: number; adamicAdar: number; coCitation: number };
  const NO_WEIGHTS = { directLink: 0, sourceOverlap: 0, commonNeighbor: 0, coCitation: 0 };

  const variants: Array<{
    name: string;
    signal: (a: GraphNode, b: GraphNode, ctx: RelevanceContext) => Normalised;
    weights: [number, number, number, number];
  }> = [
    {
      name: "saturate all",
      signal: (a, b, ctx) => ({
        direct: ((): number => {
          const f = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
          const r = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
          return (f + r) / 2;
        })(),
        sources: saturate(countSharedSourcesPublic(a, b)),
        adamicAdar: saturate(adamicAdarRaw(a, b, ctx)),
        coCitation: saturate(coCitation(a, b, ctx)),
      }),
      weights: [4, 2, 2, 1],
    },
    {
      name: "jaccard sources",
      signal: (a, b, ctx) => ({
        direct: ((): number => {
          const f = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
          const r = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
          return (f + r) / 2;
        })(),
        sources: jaccard(a, b),
        adamicAdar: saturate(adamicAdarRaw(a, b, ctx)),
        coCitation: saturate(coCitation(a, b, ctx)),
      }),
      weights: [4, 2, 2, 1],
    },
    {
      name: "jaccard + cosine AA",
      signal: (a, b, ctx) => ({
        direct: ((): number => {
          const f = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
          const r = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
          return (f + r) / 2;
        })(),
        sources: jaccard(a, b),
        adamicAdar: Math.min(1, adamicCosine(a, b, ctx)),
        coCitation: saturate(coCitation(a, b, ctx)),
      }),
      weights: [4, 2, 2, 1],
    },
    {
      name: "saturate, equal weights",
      signal: (a, b, ctx) => ({
        direct: ((): number => {
          const f = ctx.outLinks.get(a.id)?.has(b.id) ? 1 : 0;
          const r = ctx.outLinks.get(b.id)?.has(a.id) ? 1 : 0;
          return (f + r) / 2;
        })(),
        sources: saturate(countSharedSourcesPublic(a, b)),
        adamicAdar: saturate(adamicAdarRaw(a, b, ctx)),
        coCitation: saturate(coCitation(a, b, ctx)),
      }),
      weights: [1, 1, 1, 1],
    },
  ];
  const TRIALS = Number(process.env.EVAL_TRIALS ?? 10);
  const NAMES = ["direct", "sources", "adamicAdar", "coCitation"] as const;

  type Candidate = { name: string; vector: Vector };
  const candidates: Candidate[] = [
    { name: "sources-heavy  (3,4,1.5,0)", vector: [3, 4, 1.5, 0] },
    { name: "sources-heavy+cc (3,4,1.5,2)", vector: [3, 4, 1.5, 2] },
    { name: "no-affinity    (3,4,1.5,0)", vector: [3, 4, 1.5, 0] },
    { name: "sources+cc     (3,4,1.5,2)", vector: [3, 4, 1.5, 2] },
    { name: "adamic-led     (3,2,6,2)", vector: [3, 2, 6, 2] },
    { name: "adamic-led+cc  (3,2,6,2)", vector: [3, 2, 6, 2] },
    { name: "spread         (2,3,4,3)", vector: [2, 3, 4, 3] },
    { name: "adamic alone   (0,0,1,0)", vector: [0, 0, 1, 0] },
  ];

  console.log(`=== AUC over ${TRIALS} independent 20% splits (mean ± sd) ===\n`);

  // signal scale, measured once on the retained graph
  const scaleSamples = new Map<string, number[]>(NAMES.map((name) => [name, []]));
  {
    const rng = mulberry32(SEED);
    const ids = [...ctx.nodes.keys()];
    for (let i = 0; i < 20000; i += 1) {
      const a = ctx.nodes.get(ids[Math.floor(rng() * ids.length)]);
      const b = ctx.nodes.get(ids[Math.floor(rng() * ids.length)]);
      if (!a || !b || a.id === b.id) continue;
      const signals = rawSignals(a, b, ctx);
      scaleSamples.get("direct")!.push(signals.direct);
      scaleSamples.get("sources")!.push(signals.sources);
      scaleSamples.get("adamicAdar")!.push(signals.adamicAdar);
      scaleSamples.get("coCitation")!.push(signals.coCitation);
    }
  }

  const trials = new Map<string, number[]>(candidates.map((candidate) => [candidate.name, []]));
  for (const variant of variants) trials.set(`NORM ${variant.name}`, []);
  trials.set("SHIPPED (computeRelevance)", []);

  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = mulberry32(SEED + trial * 7919);
    const order = [...graph.edges].sort(() => rng() - 0.5);
    const cut = Math.floor(order.length * HOLDOUT_RATIO);
    const holdout = order.slice(0, cut);
    const retained: RawLink[] = order
      .slice(cut)
      .map((edge) => ({ source: edge.source, target: edge.target }));
    const trialCtx = createRelevanceContext(graph.nodes, retained);

    const positives: Array<[GraphNode, GraphNode]> = [];
    for (const edge of holdout) {
      const a = trialCtx.nodes.get(edge.source);
      const b = trialCtx.nodes.get(edge.target);
      if (a && b) positives.push([a, b]);
    }
    const trialHeldOut = new Set(holdout.map((edge) => pairKey(edge.source, edge.target)));
    const negatives: Array<[GraphNode, GraphNode]> = [];
    const trialIds = [...trialCtx.nodes.keys()];
    let attempts = 0;
    while (negatives.length < NEGATIVE_SAMPLES && attempts < NEGATIVE_SAMPLES * 20) {
      attempts += 1;
      const a = trialCtx.nodes.get(trialIds[Math.floor(rng() * trialIds.length)]);
      const b = trialCtx.nodes.get(trialIds[Math.floor(rng() * trialIds.length)]);
      if (!a || !b || a.id === b.id) continue;
      const key = pairKey(a.id, b.id);
      if (edgeKeys.has(key) || trialHeldOut.has(key)) continue;
      negatives.push([a, b]);
    }

    for (const candidate of candidates) {
      const positiveScores = positives.map(([a, b]) => applyVector(rawSignals(a, b, trialCtx), candidate.vector));
      const negativeScores = negatives.map(([a, b]) => applyVector(rawSignals(a, b, trialCtx), candidate.vector));
      trials.get(candidate.name)!.push(auc(positiveScores, negativeScores));
    }

    for (const variant of variants) {
      const score = (a: GraphNode, b: GraphNode) => {
        const s = variant.signal(a, b, trialCtx);
        return (
          s.direct * variant.weights[0] +
          s.sources * variant.weights[1] +
          s.adamicAdar * variant.weights[2] +
          s.coCitation * variant.weights[3]
        );
      };
      const p = positives.map(([a, b]) => score(a, b));
      const n = negatives.map(([a, b]) => score(a, b));
      if (!trials.has(`NORM ${variant.name}`)) trials.set(`NORM ${variant.name}`, []);
      trials.get(`NORM ${variant.name}`)!.push(auc(p, n));
    }

    // The implementation as it actually ships, not a reconstruction of it.
    {
      const shipped = (a: GraphNode, b: GraphNode) =>
        computeRelevance(a, b, trialCtx, DEFAULT_RELEVANCE_WEIGHTS).total;
      if (!trials.has("SHIPPED (computeRelevance)")) trials.set("SHIPPED (computeRelevance)", []);
      trials
        .get("SHIPPED (computeRelevance)")!
        .push(auc(positives.map(([a, b]) => shipped(a, b)), negatives.map(([a, b]) => shipped(a, b))));
    }
  }

  const rows = [...trials.entries()].map(([name, values]) => {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return { name, mean, sd: Math.sqrt(variance) };
  });
  rows.sort((x, y) => y.mean - x.mean);
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(26)} ${row.mean.toFixed(4)}  ± ${row.sd.toFixed(4)}`);
  }
  const leader = rows[0];
  const baseline = rows.find((row) => row.name.startsWith("SHIPPED")) ?? rows[0];
  console.log(
    `\n  best minus current: ${(leader.mean - baseline.mean).toFixed(4)}` +
      `  (pooled sd ${Math.sqrt((leader.sd ** 2 + baseline.sd ** 2) / 2).toFixed(4)})`,
  );

  console.log("\n=== raw signal scale (20000 random pairs) ===");
  for (const name of NAMES) {
    const values = scaleSamples.get(name)!;
    const sorted = [...values].sort((x, y) => x - y);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    console.log(
      `  ${name.padEnd(12)} mean ${mean.toFixed(2)}  p99 ${sorted[Math.floor(0.99 * sorted.length)].toFixed(2)}  max ${sorted[sorted.length - 1].toFixed(2)}`,
    );
  }

  const typeCounts = new Map<string, number>();
  for (const node of graph.nodes) typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
  const distribution = [...typeCounts.entries()].sort((x, y) => y[1] - x[1]);
  console.log(
    `\ntype distribution: ${distribution.map(([type, count]) => `${type} ${count}`).join(", ")}`,
  );
  console.log(
    `  dominant type covers ${((distribution[0][1] / graph.nodes.length) * 100).toFixed(1)}% of notes`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});