/**
 * Head-less verification of the graph engine against a real vault.
 *
 * Runs the exact production pipeline (parse → resolve → association engine →
 * Louvain → insights) over the vault on disk, asserts the properties the
 * plugin promises, writes `harness/graph.json` for the browser harness, and
 * prints a human-readable report.
 *
 * Usage: npm run verify:vault -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";
import { buildWikiGraph } from "../src/core/graph-builder";
import { analyzeGraph } from "../src/core/insights";
import { SPARSE_COHESION_THRESHOLD } from "../src/core/communities";
import type { VaultAdapter } from "../src/core/vault";

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));
const outFile = path.resolve(process.cwd(), "harness", "graph.json");

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

  async write(relative: string, content: string): Promise<void> {
    const full = path.join(vaultRoot, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
  }
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const started = Date.now();
  const graph = await buildWikiGraph({ vault: new NodeVault() });
  const insights = analyzeGraph(graph);
  const elapsed = Date.now() - started;

  const degrees = new Map(graph.nodes.map((node) => [node.id, node.linkCount]));
  const isolated = graph.nodes.filter((node) => node.linkCount <= 1 && !node.isStructural);
  const sparse = graph.communities.filter((community) => community.isSparse);
  const bridges = insights.gaps.filter((gap) => gap.type === "bridge");
  const connections = insights.connections;

  const checks: Check[] = [
    {
      name: "vault parsed into nodes",
      pass: graph.nodes.length >= 40,
      detail: `${graph.nodes.length} nodes`,
    },
    {
      name: "edges resolved",
      pass: graph.edges.length >= 60,
      detail: `${graph.edges.length} edges`,
    },
    {
      name: "Louvain found multiple communities",
      pass: graph.communities.length >= 4,
      detail: `${graph.communities.length} communities`,
    },
    {
      name: "community 0 is the largest",
      pass:
        graph.communities.length === 0 ||
        graph.communities[0].nodeCount === Math.max(...graph.communities.map((c) => c.nodeCount)),
      detail: graph.communities.length > 0 ? `${graph.communities[0].nodeCount} members` : "n/a",
    },
    {
      name: "community ids are dense and size-ordered",
      pass: graph.communities.every((community, index) => community.id === index),
      detail: graph.communities.map((c) => c.nodeCount).join(", "),
    },
    {
      name: "every node has a community",
      pass: graph.nodes.every((node) => Number.isInteger(node.community) && node.community >= 0),
      detail: `${new Set(graph.nodes.map((n) => n.community)).size} distinct`,
    },
    {
      name: "isolated pages exist (度 ≤ 1)",
      pass: isolated.length >= 3,
      detail: isolated.map((node) => `${node.label}(${node.linkCount})`).join(", ") || "none",
    },
    {
      name: "at least one sparse community (cohesion < 0.15, ≥ 3 pages)",
      pass: sparse.length >= 1,
      detail: sparse
        .map((c) => `#${c.id} ${c.topNodes[0]} n=${c.nodeCount} cohesion=${c.cohesion.toFixed(3)}`)
        .join(" | ") || "none",
    },
    {
      name: "bridge nodes connect 3+ clusters",
      pass: bridges.length >= 1,
      detail: bridges.map((gap) => `${gap.title}(${gap.clusterCount})`).join(", ") || "none",
    },
    {
      name: "surprising connections found",
      pass: connections.length >= 3,
      detail: connections
        .slice(0, 3)
        .map((c) => `${c.source.label}↔${c.target.label} score=${c.score}`)
        .join(" | "),
    },
    {
      name: "association weights vary (not all 1.0)",
      pass: new Set(graph.edges.map((edge) => edge.weight.toFixed(2))).size > 3,
      detail: `max=${Math.max(...graph.edges.map((e) => e.weight)).toFixed(2)}`,
    },
    {
      name: "source-overlap signal fires",
      pass: graph.edges.some((edge) => edge.signals.sourceOverlap > 0),
      detail: `${graph.edges.filter((e) => e.signals.sourceOverlap > 0).length} edges`,
    },
    {
      name: "Adamic-Adar signal fires",
      pass: graph.edges.some((edge) => edge.signals.adamicAdar > 0),
      detail: `${graph.edges.filter((e) => e.signals.adamicAdar > 0).length} edges`,
    },
    {
      // Co-citation replaced the type-affinity check: affinity was deleted (it
      // ranked held-out links at AUC 0.54 and was the largest block of hand-set
      // values shared with the reference implementation).
      name: "co-citation signal fires",
      pass: graph.edges.some((edge) => edge.signals.coCitation > 0),
      detail: `${graph.edges.filter((e) => e.signals.coCitation > 0).length} edges`,
    },
    {
      name: "Chinese frontmatter types normalised",
      pass: graph.nodes.some((node) => ["entity", "concept", "source"].includes(node.type)) &&
        graph.nodes.every((node) => node.type !== "other" || node.rawType === ""),
      detail: [...new Set(graph.nodes.map((n) => `${n.rawType || "-"}→${n.type}`))].join(", "),
    },
  ];

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        vaultRoot,
        graph,
        insights,
      },
      (key, value) => (value instanceof Map ? Object.fromEntries(value) : value),
      2,
    ),
    "utf8",
  );

  console.log(`\n=== Enhanced Graph — vault verification ===`);
  console.log(`vault: ${vaultRoot}`);
  console.log(
    `nodes=${graph.nodes.length} edges=${graph.edges.length} communities=${graph.communities.length} ` +
      `connections=${connections.length} gaps=${insights.gaps.length} (${elapsed} ms)\n`,
  );

  console.log("Communities:");
  for (const community of graph.communities) {
    console.log(
      `  #${String(community.id).padStart(2)} n=${String(community.nodeCount).padStart(3)} ` +
        `cohesion=${community.cohesion.toFixed(3)}${community.isSparse ? " SPARSE" : ""} ` +
        `meanDeg=${community.meanIntraDegree.toFixed(2)} core=${community.topNodes[0] ?? "-"}`,
    );
  }

  console.log("\nSurprising connections:");
  for (const connection of connections) {
    console.log(
      `  ${connection.source.label} ↔ ${connection.target.label}  score=${connection.score} ` +
        `weight=${connection.weight.toFixed(2)}  [${connection.reasons.join(", ")}]`,
    );
  }

  console.log("\nKnowledge gaps:");
  for (const gap of insights.gaps) {
    console.log(`  [${gap.type}] ${gap.title} — ${gap.description}`);
  }

  const failed = checks.filter((check) => !check.pass);
  console.log("\nChecks:");
  for (const check of checks) {
    console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  }

  console.log(`\nthreshold used for sparse communities: ${SPARSE_COHESION_THRESHOLD}`);
  console.log(`snapshot written to ${outFile}`);
  console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
