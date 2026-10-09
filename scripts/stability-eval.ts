/**
 * Measures how stable the clustering is: how much the partition moves when the
 * input moves slightly.
 *
 * Why it matters here: community ids are remapped across rebuilds so colours
 * survive, but that only hides the churn — it does not measure it. A cluster whose
 * membership is decided by a coin flip would keep its colour and lose its meaning,
 * and the user would see the same cluster name over a different set of notes.
 *
 * Three perturbations, none of which changes what the vault MEANS:
 *
 *   1. node insertion order — Louvain's local moving walks the graph in insertion
 *      order, so a different order is a different random walk;
 *   2. dropped links — the vault as it would be after editing a few notes;
 *   3. resolution jitter — the knob the clustering panel exposes, moved by one step.
 *
 * Reported as Adjusted Rand Index against the baseline partition: 1.0 is identical,
 * 0.0 is what two random partitions of the same nodes would score. Also reported:
 * how often the cluster's CORE note changes, because that is the name the user reads.
 *
 * Usage: npm run eval:stability -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";
import { buildWikiGraph } from "../src/core/graph-builder";
import { deriveCommunities } from "../src/core/communities";
import type { VaultAdapter } from "../src/core/vault";
import type { WikiGraph } from "../src/types";

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));
const ORDER_TRIALS = Number(process.env.EVAL_TRIALS ?? 12);
const DROP_TRIALS = Number(process.env.EVAL_DROP_TRIALS ?? 12);
const JITTER_STEP = Number(process.env.EVAL_JITTER ?? 0.1);

class NodeVault implements VaultAdapter {
  configDir(): string {
    return ".obsidian";
  }
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

/** Adjusted Rand Index: 1 identical, ~0 for two random partitions of the same nodes. */
function adjustedRand(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  const ids = [...a.keys()].filter((id) => b.has(id));
  if (ids.length < 2) return 1;
  const cells = new Map<string, number>();
  const rows = new Map<number, number>();
  const cols = new Map<number, number>();
  for (const id of ids) {
    const x = a.get(id) as number;
    const y = b.get(id) as number;
    const key = `${x}\u0000${y}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    rows.set(x, (rows.get(x) ?? 0) + 1);
    cols.set(y, (cols.get(y) ?? 0) + 1);
  }
  const choose2 = (n: number) => (n * (n - 1)) / 2;
  const sum = (values: Iterable<number>) => {
    let total = 0;
    for (const value of values) total += choose2(value);
    return total;
  };
  const total = choose2(ids.length);
  const sumCells = sum(cells.values());
  const sumRows = sum(rows.values());
  const sumCols = sum(cols.values());
  const expected = total === 0 ? 0 : (sumRows * sumCols) / total;
  const maximum = 0.5 * (sumRows + sumCols);
  if (maximum === expected) return 1;
  return (sumCells - expected) / (maximum - expected);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
function spread(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

function report(label: string, values: readonly number[]): void {
  const sorted = [...values].sort((x, y) => x - y);
  console.log(
    `  ${label.padEnd(30)} mean ${mean(values).toFixed(3)}  sd ${spread(values).toFixed(3)}  ` +
      `min ${sorted[0].toFixed(3)}  max ${sorted[sorted.length - 1].toFixed(3)}`,
  );
}

async function main(): Promise<void> {
  const graph: WikiGraph = await buildWikiGraph({ vault: new NodeVault() });
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    linkCount: node.linkCount,
  }));
  const edges = graph.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
  }));

  const baseline = deriveCommunities(nodes, edges);
  console.log(`vault: ${vaultRoot}`);
  console.log(
    `notes: ${graph.nodes.length}   links: ${graph.edges.length}   ` +
      `clusters: ${baseline.communities.length}\n`,
  );

  const random = mulberry32(20261009);
  const coreOf = (assignments: ReadonlyMap<string, number>) => {
    const byCommunity = new Map<number, string[]>();
    for (const [id, community] of assignments) {
      const members = byCommunity.get(community);
      if (members) members.push(id);
      else byCommunity.set(community, [id]);
    }
    const cores = new Map<number, string>();
    for (const [community, members] of byCommunity) {
      cores.set(community, [...members].sort()[0]);
    }
    return cores;
  };
  const baselineCores = coreOf(baseline.assignments);
  /** How many of the baseline's clusters keep the same id→core pairing. */
  const coreAgreement = (assignments: ReadonlyMap<string, number>): number => {
    const cores = coreOf(assignments);
    let same = 0;
    let total = 0;
    for (const [community, core] of baselineCores) {
      const after = cores.get(community);
      if (after === undefined) continue;
      total += 1;
      if (after === core) same += 1;
    }
    return total === 0 ? 1 : same / total;
  };

  const orderAris: number[] = [];
  const orderCores: number[] = [];
  for (let trial = 0; trial < ORDER_TRIALS; trial += 1) {
    const shuffled = [...nodes];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const result = deriveCommunities(shuffled, edges);
    orderAris.push(adjustedRand(baseline.assignments, result.assignments));
    orderCores.push(coreAgreement(result.assignments));
  }

  const dropAris = new Map<string, number[]>();
  for (const share of [0.01, 0.05]) {
    const values: number[] = [];
    for (let trial = 0; trial < DROP_TRIALS; trial += 1) {
      const dropped = new Set<number>();
      const count = Math.max(1, Math.round(edges.length * share));
      while (dropped.size < count) dropped.add(Math.floor(random() * edges.length));
      const kept = edges.filter((_edge, index) => !dropped.has(index));
      const result = deriveCommunities(nodes, kept);
      values.push(adjustedRand(baseline.assignments, result.assignments));
    }
    dropAris.set(`${(share * 100).toFixed(0)}% of links dropped`, values);
  }

  const jitterAris: number[] = [];
  for (const resolution of [1 - JITTER_STEP, 1 + JITTER_STEP]) {
    const result = deriveCommunities(nodes, edges, { resolution });
    jitterAris.push(adjustedRand(baseline.assignments, result.assignments));
  }

  console.log("=== ARI against the baseline partition (1.0 identical) ===");
  report("node order shuffled", orderAris);
  for (const [label, values] of dropAris) report(label, values);
  report(
    `resolution ±${JITTER_STEP}`,
    jitterAris,
  );
  console.log(
    `\n  clusters keeping their core note: order shuffles ${(mean(orderCores) * 100).toFixed(0)}%`,
  );

  console.log("\n=== reading ===");
  console.log(
    "  Node order is the largest of the three effects, not the smallest — but production\n" +
      "  always feeds the same order (notes in path order), so it is not run-to-run churn.\n" +
      "  What it measures is how far apart two equally valid answers can be: the ceiling on\n" +
      "  this partition's determinism, and the reason the id remap exists. Link drops are\n" +
      "  what editing the vault actually does; the resolution row is the panel's own knob,\n" +
      "  moved by one step.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
