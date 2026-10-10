/**
 * Measures whether the graph-insight feature finds links worth proposing.
 *
 * Why this exists: the improvement plan (docs/graph-insights-plan.md) gates
 * several phases on numbers, and a gate whose evidence cannot be re-derived is
 * an assertion. This is the probe, kept in the repository.
 *
 * Method — link prediction over the vault's own wikilinks, following the shape of
 * `weight-eval.ts` but measuring what the UI actually consumes:
 *
 *   1. build the graph from a real vault;
 *   2. hide a FIXED NUMBER of links (not a percentage — see the protocol block);
 *   3. rebuild adjacency WITHOUT them;
 *   4. build the candidate pool the way the feature would (2-hop pairs);
 *   5. rank the pool, and score the ranking with precision@K for the K values the
 *      panel uses, not only with AUC.
 *
 * Four things this reports that a plain AUC/AUC comparison does not:
 *
 *   - COVERAGE: what fraction of held-out links is even present in the pool.
 *     Precision@K is blind to the pool, so a candidate rule that deletes half the
 *     reachable positives raises P@K while destroying the feature. Coverage is
 *     the metric that catches that, and it is reported next to every P@K.
 *   - COMPOSITION: the shared-neighbour count and hub-routing of the chosen pairs
 *     against those of real links. A ranking drawn from the densest part of the
 *     graph is a ranking of the most OBVIOUS pairs, which is the opposite of what
 *     a "surprising connection" is for.
 *   - TIE MASS: how many candidates sit on the K boundary with an equal score.
 *     A small-integer score like common-neighbours is decided partly by sort
 *     order, so a 2-3 point margin involving it is below the metric's resolution.
 *   - TRIVIAL BASELINES: random and preferential-attachment, so the lift over
 *     chance is visible.
 *
 * Usage: npm run eval:insights -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";
import { buildWikiGraph } from "../src/core/graph-builder";
import { createRelevanceContext, type RawLink, type RelevanceContext } from "../src/core/relevance";
import type { GraphEdge, GraphNode, WikiGraph } from "../src/types";
import type { VaultAdapter } from "../src/core/vault";

// ---------------------------------------------------------------------------
// Protocol — printed in the output, so the numbers carry their own method
// ---------------------------------------------------------------------------

/** Fixed so two runs are comparable; printed. */
const SEED = Number(process.env.EVAL_SEED ?? 20261010);
const TRIALS = Number(process.env.EVAL_TRIALS ?? 20);
/**
 * Absolute link count, deliberately NOT a percentage.
 *
 * A percentage and a count are not interchangeable: on the vault this was first
 * measured against, "hide 20% of the links" means 80 links and changes the
 * headline precision by about 15 points against hiding 40. The protocol has to
 * name one number.
 */
const HIDDEN_LINKS = Number(process.env.EVAL_HIDDEN ?? 40);
/** The K values the panel can actually show. 6 is the per-category cap today. */
const K_VALUES = [1, 3, 6, 10, 20];
/** The K the acceptance gate is written against: the panel's per-category cap. */
const PRIMARY_K = 6;
const BOOTSTRAP_RESAMPLES = 5000;
const PREF_ATTACH_SCALE = 1e-6;

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));

// ---------------------------------------------------------------------------
// Vault access
// ---------------------------------------------------------------------------

class NodeVault implements VaultAdapter {
  configDir(): string {
    return ".obsidian";
  }
  async listMarkdownFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string): void => {
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
  async write(relative: string, content: string): Promise<void> {
    fs.writeFileSync(path.join(vaultRoot, relative), content, "utf8");
  }
}

/** Deterministic PRNG, so two runs of the same experiment are comparable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Rank-based AUC, ties counting half. */
function auc(positives: number[], negatives: number[]): number {
  const all = [
    ...positives.map((score) => ({ score, positive: true })),
    ...negatives.map((score) => ({ score, positive: false })),
  ].sort((x, y) => x.score - y.score);
  let positiveRankSum = 0;
  let index = 0;
  while (index < all.length) {
    let end = index;
    while (end + 1 < all.length && all[end + 1]!.score === all[index]!.score) end += 1;
    const averageRank = (index + end) / 2 + 1;
    for (let i = index; i <= end; i += 1) if (all[i]!.positive) positiveRankSum += averageRank;
    index = end + 1;
  }
  const n1 = positives.length;
  const n0 = negatives.length;
  if (n1 === 0 || n0 === 0) return 0.5;
  return (positiveRankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sd(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

/** Percentile bootstrap CI of the mean. */
function bootstrapCI(values: readonly number[], seed: number): [number, number] {
  if (values.length === 0) return [0, 0];
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i += 1) {
    let sum = 0;
    for (let j = 0; j < values.length; j += 1) sum += values[Math.floor(rng() * values.length)]!;
    means.push(sum / values.length);
  }
  means.sort((x, y) => x - y);
  return [
    means[Math.floor(0.025 * means.length)]!,
    means[Math.floor(0.975 * means.length)]!,
  ];
}

// ---------------------------------------------------------------------------
// Candidate pool
// ---------------------------------------------------------------------------

interface Pool {
  /** Deduplicated pair keys — the thing the ranker sees. */
  readonly keys: readonly string[];
  /** Sum of loop iterations, which is larger than the key count because a pair
   *  is re-encountered once per shared neighbour. Reported so the two are never
   *  confused: they are different quantities. */
  readonly iterations: number;
}

/**
 * The 2-hop candidate pool: pairs with a common neighbour that are not linked.
 *
 * Rules are flags rather than a single hard-coded choice, because each one costs
 * measurable recall and that cost belongs in the output.
 */
function buildPool(
  graph: WikiGraph,
  ctx: RelevanceContext,
  options: { excludeStructuralEndpoints: boolean; degreeCap: number | null },
): Pool {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let iterations = 0;

  for (const [id, neighbors] of ctx.neighbors) {
    for (const mid of neighbors) {
      const midDegree = ctx.neighbors.get(mid)?.size ?? 0;
      if (options.degreeCap !== null && midDegree > options.degreeCap) continue;
      for (const other of ctx.neighbors.get(mid) ?? []) {
        if (other === id) continue;
        if (neighbors.has(other)) continue;
        const a = nodeById.get(id);
        const b = nodeById.get(other);
        if (!a || !b) continue;
        if (options.excludeStructuralEndpoints && (a.isStructural || b.isStructural)) continue;
        iterations += 1;
        seen.add(pairKey(id, other));
      }
    }
  }
  return { keys: [...seen].sort(), iterations };
}

// ---------------------------------------------------------------------------
// Scorers
// ---------------------------------------------------------------------------

type Scorer = (a: GraphNode, b: GraphNode) => number;

interface ScorerSpec {
  readonly name: string;
  readonly score: Scorer;
  /** Scorers that are only meaningful on the primary pool. */
  readonly diagnostic?: boolean;
}

/** The signal decomposition every local index needs. */
function localSignals(
  a: GraphNode,
  b: GraphNode,
  ctx: RelevanceContext,
): { cn: number; aa: number; ra: number; meanSharedDegree: number; maxSharedDegree: number } {
  const na = ctx.neighbors.get(a.id);
  const nb = ctx.neighbors.get(b.id);
  if (!na || !nb) return { cn: 0, aa: 0, ra: 0, meanSharedDegree: 0, maxSharedDegree: 0 };
  const [small, large] = na.size <= nb.size ? [na, nb] : [nb, na];
  let cn = 0;
  let aa = 0;
  let ra = 0;
  let degreeSum = 0;
  let maxDegree = 0;
  for (const shared of small) {
    if (!large.has(shared)) continue;
    const degree = Math.max(ctx.neighbors.get(shared)?.size ?? 0, 2);
    cn += 1;
    aa += 1 / Math.log(degree);
    ra += 1 / degree;
    degreeSum += degree;
    maxDegree = Math.max(maxDegree, degree);
  }
  return {
    cn,
    aa,
    ra,
    meanSharedDegree: cn > 0 ? degreeSum / cn : 0,
    maxSharedDegree: maxDegree,
  };
}

/**
 * The shipped "surprise" score, reimplemented over an arbitrary pair.
 *
 * `weak-tie` is deliberately absent: it reads `edge.weight`, which a pair with no
 * link does not have. So this is the shipped score MINUS the one signal that
 * cannot apply to a proposed link, which is the honest version to compare against
 * a link predictor. `peripheral-hub` is kept, computed against the retained
 * graph's degrees.
 */
function shippedScore(a: GraphNode, b: GraphNode, ctx: RelevanceContext, maxDegree: number): number {
  const DISTANT = new Set([
    "concept|source",
    "source|synthesis",
    "entity|query",
    "source|thesis",
    "methodology|source",
  ]);
  let score = 0;
  if (a.community !== b.community) score += 3;
  if (a.type !== b.type) {
    const pair = [a.type, b.type].sort().join("|");
    score += DISTANT.has(pair) ? 2 : 1;
  }
  const degreeA = ctx.neighbors.get(a.id)?.size ?? 0;
  const degreeB = ctx.neighbors.get(b.id)?.size ?? 0;
  if (Math.min(degreeA, degreeB) <= 2 && Math.max(degreeA, degreeB) >= maxDegree * 0.5) score += 2;
  const shared = a.sources.filter((source) => b.sources.includes(source)).length;
  if (shared >= 2) score += 2;
  return score;
}

function contentSignals(a: GraphNode, b: GraphNode): { tagJaccard: number; sourceJaccard: number } {
  const jaccard = (left: readonly string[], right: readonly string[]): number => {
    if (left.length === 0 || right.length === 0) return 0;
    const set = new Set(left);
    let shared = 0;
    for (const value of right) if (set.has(value)) shared += 1;
    if (shared === 0) return 0;
    return shared / new Set([...left, ...right]).size;
  };
  return { tagJaccard: jaccard(a.tags, b.tags), sourceJaccard: jaccard(a.sources, b.sources) };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface TrialRow {
  readonly trial: number;
  readonly poolSize: number;
  readonly poolIterations: number;
  readonly hidden: number;
  readonly reachable: number;
  readonly coverage: number;
  /** scorer name -> hit counts per K. */
  readonly hits: Map<string, number[]>;
  readonly aucs: Map<string, number>;
  /** scorer name -> composition of its top-K picks. */
  readonly composition: Map<string, { shared: number; maxDegree: number; hubRouted: number; crossCommunity: number }>;
  readonly ties: Map<string, number>;
  readonly topKeys: Map<string, readonly string[]>;
}

async function main(): Promise<void> {
  const vault = new NodeVault();
  const graph = await buildWikiGraph({ vault });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  console.log("=== protocol ===");
  console.log(`vault:            ${vaultRoot}`);
  console.log(`seed:             ${SEED}`);
  console.log(`trials:           ${TRIALS}`);
  console.log(`hidden links:     ${HIDDEN_LINKS} per trial (absolute count, not a percentage)`);
  console.log(`primary K:        ${PRIMARY_K}   reported K: ${K_VALUES.join(", ")}`);
  console.log(`notes:            ${graph.nodes.length}`);
  console.log(`edges:            ${graph.edges.length} (${graph.edges.filter((edge) => nodeById.get(edge.source)?.isStructural || nodeById.get(edge.target)?.isStructural).length} touch a structural page)`);
  console.log(`communities:      ${graph.communities.length}`);
  console.log(`max degree:       ${Math.max(...graph.nodes.map((node) => node.linkCount))}`);
  console.log(
    `all node pairs:   ${(graph.nodes.length * (graph.nodes.length - 1)) / 2} unordered — ` +
      `a candidate count above this is an iteration sum, not a set size`,
  );
  console.log("");

  if (graph.edges.length < HIDDEN_LINKS * 4) {
    console.log("vault too small for this protocol");
    return;
  }

  const rows: TrialRow[] = [];

  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = mulberry32(SEED + trial * 7919);
    const order = [...graph.edges].sort(() => rng() - 0.5);
    const hidden = order.slice(0, HIDDEN_LINKS);
    const kept = order.slice(HIDDEN_LINKS);
    const hiddenKeys = new Set(hidden.map((edge) => pairKey(edge.source, edge.target)));

    // The graph the feature would see: adjacency without the hidden links.
    const keptLinks: RawLink[] = kept.map((edge) => ({ source: edge.source, target: edge.target }));
    const ctx = createRelevanceContext(graph.nodes, keptLinks);

    const pool = buildPool(graph, ctx, { excludeStructuralEndpoints: true, degreeCap: null });
    let maxDegree = 1;
    for (const node of graph.nodes) {
      maxDegree = Math.max(maxDegree, ctx.neighbors.get(node.id)?.size ?? 0);
    }

    // A held-out link counts as reachable only when BOTH endpoints survive and the
    // pair is in the pool. Everything downstream is reported against both bases.
    const hiddenPairs = hidden
      .map((edge) => ({ key: pairKey(edge.source, edge.target), a: edge.source, b: edge.target }))
      .filter((pair) => nodeById.has(pair.a) && nodeById.has(pair.b));
    const reachable = hiddenPairs.filter((pair) => pool.keys.some((key) => key === pair.key)).length;

    const scorers: ScorerSpec[] = [
      {
        name: "shipped (minus weak-tie)",
        score: (a, b) => shippedScore(a, b, ctx, maxDegree),
      },
      { name: "Adamic-Adar", score: (a, b) => localSignals(a, b, ctx).aa },
      { name: "resource allocation", score: (a, b) => localSignals(a, b, ctx).ra },
      { name: "common neighbours", score: (a, b) => localSignals(a, b, ctx).cn },
      { name: "tag Jaccard", score: (a, b) => contentSignals(a, b).tagJaccard },
      { name: "source Jaccard", score: (a, b) => contentSignals(a, b).sourceJaccard },
      // Baselines, so the lift over chance is visible rather than implied.
      { name: "random", score: () => 0, diagnostic: true },
      {
        name: "preferential attachment",
        score: (a, b) =>
          ((ctx.neighbors.get(a.id)?.size ?? 0) * (ctx.neighbors.get(b.id)?.size ?? 0)) *
          PREF_ATTACH_SCALE,
      },
      {
        name: "AA + tags",
        score: (a, b) => localSignals(a, b, ctx).aa + contentSignals(a, b).tagJaccard,
      },
    ];

    // Rank once per scorer; random needs a per-trial shuffle to be a real baseline.
    const hits = new Map<string, number[]>();
    const aucs = new Map<string, number>();
    const composition = new Map<string, { shared: number; maxDegree: number; hubRouted: number; crossCommunity: number }>();
    const ties = new Map<string, number>();
    const topKeys = new Map<string, readonly string[]>();

    for (const spec of scorers) {
      const scored = pool.keys.map((key) => {
        const [a, b] = key.split("\u0000") as [string, string];
        const nodeA = nodeById.get(a)!;
        const nodeB = nodeById.get(b)!;
        const raw = spec.score(nodeA, nodeB);
        // A tie-break key that is random for `random` and stable otherwise, so the
        // "random" row measures chance rather than a fixed id order.
        const tieBreak = spec.name === "random" ? rng() : 0;
        return { key, raw, tieBreak, nodeA, nodeB };
      });
      scored.sort((x, y) => y.raw - x.raw || x.tieBreak - y.tieBreak || (x.key < y.key ? -1 : 1));

      const perK = K_VALUES.map((k) => {
        let count = 0;
        for (let i = 0; i < k && i < scored.length; i += 1) {
          if (hiddenKeys.has(scored[i]!.key)) count += 1;
        }
        return count / k;
      });
      hits.set(spec.name, perK);

      // Tie mass at the K boundary: candidates sharing the Kth score exactly.
      const boundaryIndex = Math.min(PRIMARY_K, scored.length) - 1;
      const boundaryScore = scored[boundaryIndex]?.raw;
      ties.set(
        spec.name,
        boundaryScore === undefined
          ? 0
          : scored.filter((item) => item.raw === boundaryScore).length,
      );

      const positives = scored.filter((item) => hiddenKeys.has(item.key)).map((item) => item.raw);
      const negatives = scored.filter((item) => !hiddenKeys.has(item.key)).map((item) => item.raw);
      aucs.set(spec.name, auc(positives, negatives));

      const top = scored.slice(0, PRIMARY_K);
      topKeys.set(spec.name, top.map((item) => item.key));
      let sharedSum = 0;
      let maxDegreeSum = 0;
      let hubRouted = 0;
      let crossCommunity = 0;
      for (const item of top) {
        const signals = localSignals(item.nodeA, item.nodeB, ctx);
        sharedSum += signals.cn;
        maxDegreeSum += signals.maxSharedDegree;
        if (signals.maxSharedDegree > 20) hubRouted += 1;
        if (item.nodeA.community !== item.nodeB.community) crossCommunity += 1;
      }
      composition.set(spec.name, {
        shared: top.length > 0 ? sharedSum / top.length : 0,
        maxDegree: top.length > 0 ? maxDegreeSum / top.length : 0,
        hubRouted: top.length > 0 ? hubRouted / top.length : 0,
        crossCommunity: top.length > 0 ? crossCommunity / top.length : 0,
      });
    }

    // Ground-truth composition: the real links the ranking is supposed to resemble.
    let sharedSum = 0;
    let maxDegreeSum = 0;
    let hubRouted = 0;
    let crossCommunity = 0;
    let counted = 0;
    for (const edge of hidden) {
      const a = nodeById.get(edge.source);
      const b = nodeById.get(edge.target);
      if (!a || !b) continue;
      const signals = localSignals(a, b, ctx);
      sharedSum += signals.cn;
      maxDegreeSum += signals.maxSharedDegree;
      if (signals.maxSharedDegree > 20) hubRouted += 1;
      if (a.community !== b.community) crossCommunity += 1;
      counted += 1;
    }
    composition.set("__ground_truth__", {
      shared: counted > 0 ? sharedSum / counted : 0,
      maxDegree: counted > 0 ? maxDegreeSum / counted : 0,
      hubRouted: counted > 0 ? hubRouted / counted : 0,
      crossCommunity: counted > 0 ? crossCommunity / counted : 0,
    });

    rows.push({
      trial,
      poolSize: pool.keys.length,
      poolIterations: pool.iterations,
      hidden: hidden.length,
      reachable,
      coverage: hiddenPairs.length > 0 ? reachable / hiddenPairs.length : 0,
      hits,
      aucs,
      composition,
      ties,
      topKeys,
    });
  }

  // -------------------------------------------------------------------------
  // Coverage and pool
  // -------------------------------------------------------------------------
  console.log("=== candidate pool (structural endpoints excluded) ===");
  const poolSizes = rows.map((row) => row.poolSize);
  console.log(
    `pool size:        mean ${mean(poolSizes).toFixed(0)}  min ${Math.min(...poolSizes)}  max ${Math.max(...poolSizes)}`,
  );
  console.log(
    `pool iterations:  mean ${mean(rows.map((row) => row.poolIterations)).toFixed(0)}  ` +
      `(a pair recurs once per shared neighbour, so this exceeds the set size)`,
  );
  console.log(
    `coverage:         ${(mean(rows.map((row) => row.coverage)) * 100).toFixed(1)} % of held-out links are in the pool`,
  );
  console.log(
    `positive rate:    ${((mean(rows.map((row) => row.reachable)) / mean(poolSizes)) * 100).toFixed(2)} % of the pool`,
  );
  console.log("");

  console.log("=== what each candidate rule costs (mean over trials) ===");
  console.log(
    "  the vault's own max degree is " +
      `${Math.max(...graph.nodes.map((node) => node.linkCount))}, so a cap above that never fires`,
  );
  console.log("  rule".padEnd(46) + "pool".padStart(8) + "coverage".padStart(11));
  console.log("  " + "-".repeat(63));
  const ruleSizes = new Map<string, number[]>();
  const ruleCoverage = new Map<string, number[]>();
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = mulberry32(SEED + trial * 7919);
    const order = [...graph.edges].sort(() => rng() - 0.5);
    const hidden = order.slice(0, HIDDEN_LINKS);
    const kept: RawLink[] = order.slice(HIDDEN_LINKS).map((edge) => ({ source: edge.source, target: edge.target }));
    const hiddenKeys = new Set(hidden.map((edge) => pairKey(edge.source, edge.target)));
    const ctx = createRelevanceContext(graph.nodes, kept);
    const rules: Array<[string, { excludeStructuralEndpoints: boolean; degreeCap: number | null }]> = [
      ["all 2-hop, no exclusions", { excludeStructuralEndpoints: false, degreeCap: null }],
      ["exclude structural endpoints", { excludeStructuralEndpoints: true, degreeCap: null }],
      ["+ degree cap 50", { excludeStructuralEndpoints: true, degreeCap: 50 }],
      ["+ degree cap 20", { excludeStructuralEndpoints: true, degreeCap: 20 }],
      ["+ degree cap 10", { excludeStructuralEndpoints: true, degreeCap: 10 }],
    ];
    for (const [name, options] of rules) {
      const pool = buildPool(graph, ctx, options);
      const keySet = new Set(pool.keys);
      const reachable = [...hiddenKeys].filter((key) => keySet.has(key)).length;
      if (!ruleSizes.has(name)) {
        ruleSizes.set(name, []);
        ruleCoverage.set(name, []);
      }
      ruleSizes.get(name)!.push(pool.keys.length);
      ruleCoverage.get(name)!.push(reachable / Math.max(1, hiddenKeys.size));
    }
  }
  for (const [name, sizes] of ruleSizes) {
    console.log(
      "  " +
        name.padEnd(44) +
        mean(sizes).toFixed(0).padStart(8) +
        `${(mean(ruleCoverage.get(name)!) * 100).toFixed(1)} %`.padStart(11),
    );
  }
  console.log("");

  // -------------------------------------------------------------------------
  // Ranking quality
  // -------------------------------------------------------------------------
  const names = [...rows[0]!.hits.keys()];
  console.log(`=== precision@K  (mean over ${TRIALS} trials, hidden = ${HIDDEN_LINKS}) ===`);
  console.log(
    "method".padEnd(26) + K_VALUES.map((k) => `P@${k}`.padStart(8)).join("") + "recall@K".padStart(11) + "AUC".padStart(9),
  );
  console.log("-".repeat(26 + 8 * K_VALUES.length + 20));
  const summary = names.map((name) => ({
    name,
    perK: K_VALUES.map((_, index) => mean(rows.map((row) => row.hits.get(name)![index]!))),
    auc: mean(rows.map((row) => row.aucs.get(name)!)),
    sd: sd(rows.map((row) => row.hits.get(name)![K_VALUES.indexOf(PRIMARY_K)]!)),
    ties: mean(rows.map((row) => row.ties.get(name)!)),
  }));
  summary.sort((x, y) => y.perK[K_VALUES.indexOf(PRIMARY_K)]! - x.perK[K_VALUES.indexOf(PRIMARY_K)]!);
  for (const row of summary) {
    console.log(
      row.name.padEnd(26) +
        row.perK.map((value) => `${(value * 100).toFixed(1)}%`.padStart(8)).join("") +
        `${((row.perK[K_VALUES.indexOf(PRIMARY_K)]! * PRIMARY_K) / HIDDEN_LINKS * 100).toFixed(1)}%`.padStart(11) +
        row.auc.toFixed(4).padStart(9),
    );
  }
  console.log(
    `\n  sd of P@${PRIMARY_K} across splits: ` +
      summary.map((row) => `${row.name} ${(row.sd * 100).toFixed(1)}pp`).join(", "),
  );
  console.log(
    "  tie mass at the K boundary: " +
      summary.map((row) => `${row.name} ${row.ties.toFixed(1)}`).join(", "),
  );
  console.log(
    "  chance level for P@K on this pool is the positive rate above; " +
      "a scorer at that rate found nothing.",
  );
  console.log("");

  // Paired comparisons: same splits, same pool, so the DIFFERENCE is much better
  // estimated than either level.
  console.log(`=== paired P@${PRIMARY_K} differences (same splits, ${BOOTSTRAP_RESAMPLES}-resample bootstrap) ===`);
  const kIndex = K_VALUES.indexOf(PRIMARY_K);
  const paired = (a: string, b: string): void => {
    const deltas = rows.map((row) => row.hits.get(a)![kIndex]! - row.hits.get(b)![kIndex]!);
    const [low, high] = bootstrapCI(deltas, SEED + 13);
    console.log(
      `  ${`${a} − ${b}`.padEnd(44)} ${(mean(deltas) * 100).toFixed(1)} pp  ` +
        `95% CI [${(low * 100).toFixed(1)}, ${(high * 100).toFixed(1)}]`,
    );
  };
  paired("Adamic-Adar", "resource allocation");
  paired("Adamic-Adar", "common neighbours");
  paired("Adamic-Adar", "tag Jaccard");
  paired("Adamic-Adar", "shipped (minus weak-tie)");
  paired("Adamic-Adar", "AA + tags");
  paired("Adamic-Adar", "random");
  paired("preferential attachment", "random");
  console.log("");

  // -------------------------------------------------------------------------
  // What the ranking is made of
  // -------------------------------------------------------------------------
  console.log(`=== composition of the top ${PRIMARY_K} vs. the real links ===`);
  console.log(
    "method".padEnd(26) + "shared nbrs".padStart(13) + "max nbr deg".padStart(13) +
      "hub-routed".padStart(12) + "cross-comm".padStart(12),
  );
  console.log("-".repeat(76));
  const groundTruth = mean(rows.map((row) => row.composition.get("__ground_truth__")!.shared));
  for (const name of names) {
    const c = rows.map((row) => row.composition.get(name)!);
    console.log(
      name.padEnd(26) +
        mean(c.map((item) => item.shared)).toFixed(2).padStart(13) +
        mean(c.map((item) => item.maxDegree)).toFixed(1).padStart(13) +
        `${(mean(c.map((item) => item.hubRouted)) * 100).toFixed(1)}%`.padStart(12) +
        `${(mean(c.map((item) => item.crossCommunity)) * 100).toFixed(1)}%`.padStart(12),
    );
  }
  {
    const c = rows.map((row) => row.composition.get("__ground_truth__")!);
    console.log(
      "REAL links (hidden)".padEnd(26) +
        mean(c.map((item) => item.shared)).toFixed(2).padStart(13) +
        mean(c.map((item) => item.maxDegree)).toFixed(1).padStart(13) +
        `${(mean(c.map((item) => item.hubRouted)) * 100).toFixed(1)}%`.padStart(12) +
        `${(mean(c.map((item) => item.crossCommunity)) * 100).toFixed(1)}%`.padStart(12),
    );
  }
  console.log(
    `\n  a method whose "shared nbrs" is well above the real-link row is choosing the` +
      ` densest pairs, which are the most predictable and the most obvious.`,
  );
  console.log(`  (ground-truth mean shared neighbours: ${groundTruth.toFixed(2)})`);
  console.log("");

  // -------------------------------------------------------------------------
  // The pool hides the metric's blind spot: a low-common-neighbour view
  // -------------------------------------------------------------------------
  console.log("=== P@K restricted to low-overlap pairs (common neighbours ≤ 2) ===");
  console.log("  a scorer that only wins on hub-routed pairs is being rewarded for obviousness");
  const lowPool = new Map<string, number[]>();
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const rng = mulberry32(SEED + trial * 7919);
    const order = [...graph.edges].sort(() => rng() - 0.5);
    const hidden = order.slice(0, HIDDEN_LINKS);
    const kept: RawLink[] = order.slice(HIDDEN_LINKS).map((edge) => ({ source: edge.source, target: edge.target }));
    const hiddenKeys = new Set(hidden.map((edge) => pairKey(edge.source, edge.target)));
    const ctx = createRelevanceContext(graph.nodes, kept);
    const pool = buildPool(graph, ctx, { excludeStructuralEndpoints: true, degreeCap: null });
    for (const name of ["Adamic-Adar", "resource allocation", "common neighbours"]) {
      const scored = pool.keys
        .map((key) => {
          const [a, b] = key.split("\u0000") as [string, string];
          const nodeA = nodeById.get(a)!;
          const nodeB = nodeById.get(b)!;
          const signals = localSignals(nodeA, nodeB, ctx);
          return { key, cn: signals.cn, raw: name === "Adamic-Adar" ? signals.aa : name === "resource allocation" ? signals.ra : signals.cn };
        })
        .filter((item) => item.cn <= 2)
        .sort((x, y) => y.raw - x.raw || (x.key < y.key ? -1 : 1));
      const k = Math.min(PRIMARY_K, scored.length);
      let count = 0;
      for (let i = 0; i < k; i += 1) if (hiddenKeys.has(scored[i]!.key)) count += 1;
      if (!lowPool.has(name)) lowPool.set(name, []);
      lowPool.get(name)!.push(k > 0 ? count / k : 0);
    }
  }
  for (const [name, values] of lowPool) {
    console.log(`  ${name.padEnd(24)} P@${PRIMARY_K} on the low-overlap subset: ${(mean(values) * 100).toFixed(1)} %`);
  }
  console.log("");

  const edgesTouchingStructural = graph.edges.filter(
    (edge: GraphEdge) => nodeById.get(edge.source)?.isStructural || nodeById.get(edge.target)?.isStructural,
  ).length;
  console.log("=== summary ===");
  console.log(`  edges: ${graph.edges.length}, of which ${edgesTouchingStructural} touch a structural page`);
  console.log(`  coverage floor proposed in the plan: 85 %; measured: ${(mean(rows.map((row) => row.coverage)) * 100).toFixed(1)} %`);
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
