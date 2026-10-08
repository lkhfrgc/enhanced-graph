/**
 * Architecture probe: build the real import graph and report coupling metrics.
 *
 * Usage: node scripts/architecture-report.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = walk(srcDir).sort();
const rel = (file) => path.relative(root, file).replace(/\\/g, "/");

/** Module key: the path without the extension, relative to src/. */
const keyOf = (file) => path.relative(srcDir, file).replace(/\\/g, "/").replace(/\.ts$/, "");

const nodes = new Map();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split("\n").length;
  const imports = new Set();
  /** Edges that survive compilation. `import type` is erased by esbuild. */
  const runtimeImports = new Set();
  const re = /(?:^|\n)\s*(?:import|export)(\s+type)?\b[^;]*?from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const typeOnly = Boolean(match[1]);
    const spec = match[2];
    if (!spec.startsWith(".")) {
      imports.add(`<external:${spec}>`);
      if (!typeOnly) runtimeImports.add(`<external:${spec}>`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), spec);
    const key = rel(resolved.endsWith(".ts") ? resolved : `${resolved}.ts`)
      .replace(/^src\//, "")
      .replace(/\.ts$/, "");
    imports.add(key);
    if (!typeOnly) runtimeImports.add(key);
  }
  const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/gm)].map((m) => m[1]);
  nodes.set(keyOf(file), { file, lines, imports, runtimeImports, exports });
}

// --- edges ---------------------------------------------------------------
/** Every reference, including type-only ones. */
const edges = [];
/** Only references that exist at runtime; these are what can actually couple. */
const runtimeEdges = [];
for (const [from, info] of nodes) {
  for (const to of info.imports) {
    if (to.startsWith("<external") || !nodes.has(to)) continue;
    edges.push([from, to]);
    if (info.runtimeImports.has(to)) runtimeEdges.push([from, to]);
  }
}

const fanOut = new Map();
const fanIn = new Map();
for (const [from, to] of edges) {
  fanOut.set(from, (fanOut.get(from) ?? 0) + 1);
  fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
}

// --- cycles (Tarjan-lite via DFS) ---------------------------------------
/**
 * Computed over RUNTIME edges. A cycle of `import type` statements is erased by
 * esbuild and cannot couple anything at runtime, so it is reported separately
 * rather than treated as a defect.
 */
const cycles = [];
const state = new Map();
const stack = [];
function visit(node) {
  if (state.get(node) === "done") return;
  if (state.get(node) === "open") {
    const at = stack.indexOf(node);
    if (at >= 0) cycles.push([...stack.slice(at), node]);
    return;
  }
  state.set(node, "open");
  stack.push(node);
  for (const [from, to] of runtimeEdges) if (from === node) visit(to);
  stack.pop();
  state.set(node, "done");
}
for (const node of nodes.keys()) visit(node);
const uniqueCycles = [];
const seenCycle = new Set();
for (const cycle of cycles) {
  const key = [...cycle].sort().join("|");
  if (seenCycle.has(key)) continue;
  seenCycle.add(key);
  uniqueCycles.push(cycle);
}

/** Type-only reference cycles — informational. */
const typeCycles = [];
{
  const st = new Map();
  const sk = [];
  const walk = (node) => {
    if (st.get(node) === "done") return;
    if (st.get(node) === "open") {
      const at = sk.indexOf(node);
      if (at >= 0) typeCycles.push([...sk.slice(at), node].join(" → "));
      return;
    }
    st.set(node, "open");
    sk.push(node);
    for (const [from, to] of edges) if (from === node) walk(to);
    sk.pop();
    st.set(node, "done");
  };
  for (const node of nodes.keys()) walk(node);
}

// --- layering ------------------------------------------------------------
/**
 * The intended dependency direction, lowest first:
 *   contract  — pure shared vocabulary (types, i18n, settings shape, host API)
 *   core      — the engine; no Obsidian, no sigma
 *   view      — generic rendering; knows nothing about Obsidian's internals
 *   integrate — reaches into Obsidian's internals; MAY use view building blocks
 *   app       — composition root; the only place that wires everything together
 */
const LAYERS = ["contract", "core", "view", "integrate", "app"];
const CONTRACT_MODULES = new Set(["types", "i18n", "settings-model", "plugin-host"]);

function layerOf(key) {
  if (CONTRACT_MODULES.has(key)) return "contract";
  if (key.startsWith("core/")) return "core";
  if (key.startsWith("view/")) return "view";
  if (key.startsWith("integrate/")) return "integrate";
  return "app";
}
const violations = [];
for (const [from, to] of runtimeEdges) {
  const a = layerOf(from);
  const b = layerOf(to);
  if (a === b) continue;
  if (LAYERS.indexOf(a) < LAYERS.indexOf(b)) {
    violations.push(`${from} (${a}) → ${to} (${b})`);
  }
}

// --- report --------------------------------------------------------------
console.log("=== module sizes ===");
const byLines = [...nodes.entries()].sort((a, b) => b[1].lines - a[1].lines);
for (const [key, info] of byLines.slice(0, 14)) {
  console.log(
    `${String(info.lines).padStart(5)} lines  ${String(info.exports.length).padStart(2)} exports  ` +
      `fan-in ${String(fanIn.get(key) ?? 0).padStart(2)}  fan-out ${String(fanOut.get(key) ?? 0).padStart(2)}  ${key}`,
  );
}
console.log(`\ntotal modules: ${nodes.size}, total source lines: ${byLines.reduce((s, [, i]) => s + i.lines, 0)}`);

console.log("\n=== most depended-upon (fan-in) ===");
for (const [key, count] of [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(count).padStart(3)}  ${key}`);
}

console.log("\n=== largest fan-out (knows the most) ===");
for (const [key, count] of [...fanOut.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(count).padStart(3)}  ${key}`);
}

console.log("\n=== import cycles (runtime) ===");
if (uniqueCycles.length === 0) console.log("none");
for (const cycle of uniqueCycles) console.log(cycle.join(" → "));

console.log("\n=== type-only reference cycles (erased at build time) ===");
const uniqueTypeCycles = [...new Set(typeCycles)];
if (uniqueTypeCycles.length === 0) console.log("none");
for (const cycle of uniqueTypeCycles) console.log(cycle);

console.log("\n=== layering violations (runtime edges only) ===");
if (violations.length === 0) console.log("none");
for (const violation of violations) console.log(violation);

console.log("\n=== runtime edge count ===");
console.log(`${runtimeEdges.length} runtime edges of ${edges.length} total references`);

console.log("\n=== external dependencies per module ===");
for (const [key, info] of nodes) {
  const external = [...info.imports].filter((i) => i.startsWith("<external"));
  if (external.length > 0) console.log(`${key}: ${external.map((e) => e.slice(10, -1)).join(", ")}`);
}
