/**
 * Checks the shape of the focus for one node: is the lit EDGE set the same as the
 * lit NODE set implies?
 *
 * The report was "two bright nodes with no bright line between them", naming
 * 大模型应用技术全景 and vLLM while 检索增强生成 was focused. Neither is the
 * focused note — both are its neighbours — so if the two sets disagree about
 * edges among neighbours, that is the gap, and it can be counted here without
 * opening Obsidian.
 *
 * Usage: npm run verify:focus-shape -- "检索增强生成" "大模型应用技术全景" "vLLM"
 */
import fs from "node:fs";
import path from "node:path";

import { buildWikiGraph } from "../src/core/graph-builder";

const [centreName = "检索增强生成", aName = "大模型应用技术全景", bName = "vLLM"] = process.argv.slice(2);
const vaultRoot = path.resolve(process.cwd(), "..", "插件开发");

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
          if ([".obsidian", ".trash", ".git"].includes(entry.name)) continue;
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

const graph = await buildWikiGraph({
  vault: new NodeVault(),
  excludeFolders: [],
  weights: { directLink: 4, commonNeighbor: 2, sourceOverlap: 2, coCitation: 1 },
});

const find = (needle) =>
  graph.nodes.find((n) => n.label === needle || n.id === needle || n.id.endsWith("/" + needle.toLowerCase()));

const centre = find(centreName);
const a = find(aName);
const b = find(bName);
console.log("focused : " + (centre?.id ?? "NOT FOUND"));
console.log("A       : " + (a?.id ?? "NOT FOUND"));
console.log("B       : " + (b?.id ?? "NOT FOUND"));
if (!centre || !a || !b) process.exit(1);

const neighboursOf = (id) => {
  const out = new Set();
  for (const edge of graph.edges) {
    if (edge.source === id) out.add(edge.target);
    else if (edge.target === id) out.add(edge.source);
  }
  return out;
};
const hasEdge = (x, y) =>
  graph.edges.some((e) => (e.source === x && e.target === y) || (e.source === y && e.target === x));

const neighbours = neighboursOf(centre.id);
console.log("");
console.log("A is a neighbour of the focused note: " + neighbours.has(a.id));
console.log("B is a neighbour of the focused note: " + neighbours.has(b.id));
console.log("an edge A - B exists:                 " + hasEdge(a.id, b.id));

const bright = new Set([centre.id, ...neighbours]);
const incident = graph.edges.filter((e) => e.source === centre.id || e.target === centre.id);
const amongNeighbours = graph.edges.filter(
  (e) => bright.has(e.source) && bright.has(e.target) && e.source !== centre.id && e.target !== centre.id,
);

console.log("");
console.log("bright node set (focused + neighbours): " + bright.size);
console.log("edges lit today (incident to focused):  " + incident.length);
console.log("edges among neighbours, NOT lit:        " + amongNeighbours.length);
console.log("");
if (amongNeighbours.length > 0) {
  console.log("the gap, first 15:");
  for (const e of amongNeighbours.slice(0, 15)) console.log("  " + e.source + "  --  " + e.target);
}
