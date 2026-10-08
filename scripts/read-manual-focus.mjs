/**
 * Reads the focus YOU made, instead of making one itself.
 *
 * Every diagnostic so far called `focusNodeInGraph` to set the focus and then
 * measured what it had just built. That is fine for testing the pipeline and
 * useless for reproducing a report: the state under test was constructed by the
 * tool, so anything the real path does differently was excluded by design.
 *
 * This one opens Obsidian and waits. Focus a note in the graph by hand — the way
 * you normally do — and the moment a focus appears it reads that state, prints it,
 * and screenshots it. Nothing is driven from here.
 *
 * It reports, for the focused note, every incident edge with what happened to it:
 * whether both endpoints resolved, whether the built-in graph holds a graphics
 * object for it, and what the drawn value ended up as.
 *
 * Quit Obsidian first.
 *
 * Usage:
 *   node scripts/read-manual-focus.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
let port = 9222;

const alive = async () => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
};

if (!(await alive())) {
  const running = await new Promise((resolve) => {
    const probe = spawn("tasklist", ["/FI", "IMAGENAME eq Obsidian.exe"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    probe.stdout.on("data", (c) => (out += String(c)));
    probe.on("close", () => resolve(out));
    probe.on("error", () => resolve(""));
  });
  if (running.includes("Obsidian.exe")) {
    console.error("Obsidian is already running without a debug port. Quit it completely, then run again.");
    process.exit(1);
  }
  port = await new Promise((resolve) => {
    const server = net.createServer();
    server.once("listening", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(actual));
    });
    server.listen(0, "127.0.0.1");
  });
  console.log(`Starting Obsidian on ${port}…`);
  const child = spawn(OBSIDIAN, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  child.unref();
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await alive()) break;
  }
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = null;
for (let attempt = 0; attempt < 8 && !page; attempt += 1) {
  for (const candidate of context.pages().filter((p) => p.url().startsWith("app://obsidian.md"))) {
    try {
      await candidate.waitForFunction(() => Boolean(window.app?.workspace), null, { timeout: 15000 });
      page = candidate;
      break;
    } catch {
      /* look again */
    }
  }
  if (!page) await new Promise((r) => setTimeout(r, 3000));
}
if (!page) {
  console.error("No usable Obsidian page.");
  process.exit(1);
}

await page.waitForFunction(() => Boolean(window.app.plugins?.plugins?.["enhanced-graph"]), null, { timeout: 60000 });

console.log("");
console.log("Obsidian is open. In the built-in graph, focus the note you are asking about");
console.log("— the way you normally do it, right-click or click the node.");
console.log("");
console.log("Waiting for a focus to appear (up to 10 minutes)…");

const hasFocus = () => {
  const plugin = window.app.plugins?.plugins?.["enhanced-graph"];
  const enhancer = plugin?.officialGraph;
  if (!enhancer?.focusIds) return false;
  return [...enhancer.focusIds.values()].some((set) => set && set.size > 0);
};
await page.waitForFunction(hasFocus, null, { timeout: 600000 });
// Let the plugin settle whatever it is going to do, without touching anything.
await page.waitForTimeout(3000);

const report = await page.evaluate(() => {
  const app = window.app;
  const plugin = app.plugins.plugins["enhanced-graph"];
  const enhancer = plugin.officialGraph;
  const leaf = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer);
  if (!leaf) return { error: "no built-in graph with a renderer is open" };
  const renderer = leaf.view.renderer;
  const lookup = renderer.nodeLookup ?? {};
  const ours = plugin.cached;

  const officialIdOf = new Map();
  for (const officialId of Object.keys(lookup)) {
    const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const node = ours.graph.nodeIndex.get(key);
    if (node) officialIdOf.set(node.id, officialId);
  }

  const focused = [...(enhancer.focusIds.get(renderer) ?? [])];
  const lit = enhancer.litEdges?.get(renderer) ?? new Set();
  const links = Array.isArray(renderer.links) ? renderer.links : [];
  const alphas = links.map((l) => l?.line?.alpha).filter((a) => typeof a === "number");

  // Sample the middle of the segment between two notes, in the same transform the
  // marker uses. Reported as coordinates so the values can be checked against the
  // screenshot rather than trusted.
  const dpr = window.devicePixelRatio || 1;
  const posOf = (officialId) => {
    const n = lookup[officialId];
    if (!n || typeof n.x !== "number") return null;
    return { x: (n.x * renderer.scale + (renderer.panX ?? 0)) / dpr, y: (n.y * renderer.scale + (renderer.panY ?? 0)) / dpr };
  };

  const edges = [];
  for (const id of focused) {
    for (const edge of ours.graph.edges) {
      const other = edge.source === id ? edge.target : edge.target === id ? edge.source : null;
      if (!other) continue;
      const from = officialIdOf.get(id);
      const to = officialIdOf.get(other);
      const link = from && to ? (lookup[from]?.forward?.[to] ?? lookup[to]?.forward?.[from]) : undefined;
      const keys = [...lit];
      edges.push({
        other,
        resolvedBothEnds: Boolean(from && to),
        foundGraphics: Boolean(link),
        hasLine: Boolean(link?.line),
        litByKey: keys.includes([id, other].sort().join(":::")) || keys.includes([other, id].sort().join(":::")),
        endPosition: posOf(to),
      });
    }
  }

  return {
    focused,
    vaultFiles: app.vault.getMarkdownFiles().length,
    ourNodes: ours.graph.nodes.length,
    ourEdges: ours.graph.edges.length,
    officialNodes: Object.keys(lookup).length,
    litKeyCount: lit.size,
    litLinkCount: alphas.filter((a) => a > 0.9).length,
    incidentEdges: edges.length,
    resolvedBothEnds: edges.filter((e) => e.resolvedBothEnds).length,
    foundGraphics: edges.filter((e) => e.foundGraphics).length,
    withLine: edges.filter((e) => e.hasLine).length,
    litByKey: edges.filter((e) => e.litByKey).length,
    notLit: edges.filter((e) => !e.litByKey).map((e) => e.other),
    focusPosition: posOf(officialIdOf.get(focused[0])),
    edges,
  };
});

console.log("");
console.log("=== the focus you made ===");
console.log(JSON.stringify(report, null, 1));

const shot = path.join(os.tmpdir(), "manual-focus.png");
await page.screenshot({ path: shot });
console.log("");
console.log("screenshot: " + shot);
console.log("Nothing was written to the vault.");

await browser.close();
process.exit(0);
