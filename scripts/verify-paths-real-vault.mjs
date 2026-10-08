/**
 * Runs `findConnectingPaths` against the REAL vault graph and checks every pair
 * against brute-force enumeration.
 *
 * The synthetic topologies already pass, but they are four small shapes. The real
 * graph has 79 nodes and 420 edges with whatever quirks the vault contains, and
 * "still missing edges" on real data is not something four hand-built shapes can
 * rule out.
 *
 * Brute force is the independent answer: enumerate every simple path up to the
 * applied span and union their edges. Anything the function reports that is not
 * in that union is spurious; anything in the union it omits is missing.
 *
 * Usage: node scripts/verify-paths-real-vault.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { buildWikiGraph } from "../src/core/graph-builder";
import { findConnectingPaths } from "../src/core/paths";
import { edgeKey } from "../src/core/graph-keys";

const vaultRoot = process.argv[2] ?? path.resolve(process.cwd(), "..", "插件开发");

class NodeVault {
  configDir() {
    return ".obsidian";
  }
  async listMarkdownFiles() {
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".obsidian" || entry.name === ".trash" || entry.name === ".git") continue;
          walk(full);
        } else if (entry.name.toLowerCase().endsWith(".md")) {
          out.push(path.relative(vaultRoot, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(vaultRoot);
    return out;
  }
  async read(file) {
    return fs.readFileSync(path.join(vaultRoot, file), "utf8");
  }
  async exists(file) {
    return fs.existsSync(path.join(vaultRoot, file));
  }
  async write(file, content) {
    fs.writeFileSync(path.join(vaultRoot, file), content, "utf8");
  }
}

const graph = await buildWikiGraph({ vault: new NodeVault(), excludeFolders: [], weights: { directLink: 4, commonNeighbor: 2, sourceOverlap: 2, coCitation: 1 } });
console.log(`vault: ${vaultRoot}`);
console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

// Adjacency, worst case for the enumeration: undirected.
const adjacency = new Map();
for (const edge of graph.edges) {
  if (edge.source === edge.target) continue;
  adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
}

function bruteForce(from, to, span, limit = 400000) {
  const edges = new Set();
  const stack = [from];
  const visited = new Set([from]);
  let steps = 0;
  let truncated = false;
  const walk = (at, used) => {
    if (truncated) return;
    if (at === to) {
      for (let i = 0; i + 1 < stack.length; i += 1) edges.add(edgeKey(stack[i], stack[i + 1]));
      return;
    }
    if (used >= span) return;
    for (const next of adjacency.get(at) ?? []) {
      if (steps >= limit) {
        truncated = true;
        return;
      }
      if (visited.has(next)) continue;
      steps += 1;
      visited.add(next);
      stack.push(next);
      walk(next, used + 1);
      stack.pop();
      visited.delete(next);
    }
  };
  walk(from, 0);
  return { edges, truncated, steps };
}

// A sample of pairs: all of them would be 79*78/2 = 3081, each with up to five
// budgets. Deterministic stride keeps it reproducible.
const ids = graph.nodes.map((n) => n.id);
let checked = 0;
let skippedTruncated = 0;
let spuriousTotal = 0;
let missingTotal = 0;
const failures = [];

for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) {
    for (let intermediates = 0; intermediates <= 3; intermediates += 1) {
      const result = findConnectingPaths(graph, ids[i], ids[j], { maxHops: intermediates + 1 });
      if (!result) continue;
      const truth = bruteForce(ids[i], ids[j], result.span);
      if (truth.truncated) {
        skippedTruncated += 1;
        continue;
      }
      checked += 1;
      const reported = new Set(result.edges);
      const spurious = [...reported].filter((e) => !truth.edges.has(e));
      const missing = [...truth.edges].filter((e) => !reported.has(e));
      if (spurious.length || missing.length) {
        spuriousTotal += spurious.length;
        missingTotal += missing.length;
        if (failures.length < 10) {
          failures.push({
            pair: [ids[i], ids[j]],
            intermediates,
            span: result.span,
            spurious: spurious.length,
            missing: missing.length,
            missingSample: missing.slice(0, 4),
            spuriousSample: spurious.slice(0, 4),
          });
        }
      }
    }
  }
}

console.log("");
console.log(`pairs x budgets checked: ${checked}  (skipped, enumeration too large: ${skippedTruncated})`);
console.log(`spurious edges: ${spuriousTotal}`);
console.log(`missing edges:  ${missingTotal}`);
if (failures.length) {
  console.log("");
  console.log("first failures:");
  console.log(JSON.stringify(failures, null, 1));
} else {
  console.log("");
  console.log("no mismatches on the real graph");
}
