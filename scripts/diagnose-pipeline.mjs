/**
 * Walks the whole focus pipeline for one real pair of notes, in YOUR Obsidian.
 *
 * Everything upstream had been verified piece by piece — the path search against
 * brute force on the real graph, the adjacency being undirected, the link lookup
 * finding a graphics object on one side or the other — and the highlight was
 * still incomplete. What had never been checked is the ASSEMBLY: which pairs
 * `focusEdgePairs` actually produces, whether each maps to official ids, what
 * budget was applied, and what finally lands in `litEdges`.
 *
 * So this drives the focus itself rather than asking a person to, and prints each
 * stage, so the break shows up as a stage rather than as a guess.
 *
 * Usage:
 *   node scripts/diagnose-pipeline.mjs
 *
 * Quit Obsidian first: it refuses a second instance, and a running one has no
 * debug port to attach to.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
let port = 9222;

const endpointAlive = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
};

const findFreePort = (preferred) => {
  const tryPort = (candidate) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(null));
      server.once("listening", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : candidate;
        server.close(() => resolve(actual));
      });
      server.listen(candidate, "127.0.0.1");
    });
  return tryPort(preferred).then((found) => found ?? tryPort(0));
};

if (!(await endpointAlive())) {
  const running = await new Promise((resolve) => {
    const probe = spawn("tasklist", ["/FI", "IMAGENAME eq Obsidian.exe"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    probe.stdout.on("data", (chunk) => (out += String(chunk)));
    probe.on("close", () => resolve(out));
    probe.on("error", () => resolve(""));
  });
  if (running.includes("Obsidian.exe")) {
    console.error("Obsidian is already running without a debug port. Quit it completely, then run again.");
    process.exit(1);
  }
  port = await findFreePort(port);
  console.log(`Starting Obsidian on debug port ${port} (your normal profile and vault)…`);
  const child = spawn(OBSIDIAN, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await endpointAlive()) break;
  }
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().startsWith("app://obsidian.md"));
await page.waitForFunction(() => Boolean(window.app?.workspace), null, { timeout: 60000 });
await page.waitForFunction(() => Boolean(window.app.plugins?.plugins?.["enhanced-graph"]), null, { timeout: 60000 });
await page.evaluate(async () => {
  if (window.app.workspace.getLeavesOfType("graph").length === 0) {
    const leaf = window.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: "graph", active: true });
  }
});
await page.waitForFunction(
  () => window.app.workspace.getLeavesOfType("graph").some((c) => c.view && c.view.renderer),
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(6000);

const report = await page.evaluate(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = window.app;
  const plugin = app.plugins.plugins["enhanced-graph"];
  const enhancer = plugin.officialGraph;
  const leaf = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer);
  const renderer = leaf.view.renderer;
  const lookup = renderer.nodeLookup ?? {};
  const ours = plugin.cached;

  // Our id -> official id, exactly as the collector builds it.
  const officialIdOf = new Map();
  for (const officialId of Object.keys(lookup)) {
    const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const node = ours.graph.nodeIndex.get(key);
    if (node) officialIdOf.set(node.id, officialId);
  }

  // Pick a pair that is MAPPABLE and adjacent, so the test is about the pipeline
  // and not about the known unmappable tail.
  const candidate = ours.graph.edges.find(
    (edge) => officialIdOf.has(edge.source) && officialIdOf.has(edge.target),
  );
  if (!candidate) return { error: "no mappable edge found" };
  const ids = [candidate.source, candidate.target];

  const stages = { chosen: ids, officialIds: [officialIdOf.get(ids[0]), officialIdOf.get(ids[1])] };

  // Stage 1: what does the plugin think the budget is?
  stages.getFocusIntermediates = plugin.settings.focusMaxIntermediates;
  stages.focusIdsAfterFocus = enhancer.focusIds
    ? [...enhancer.focusIds.values()].map((set) => [...set])
    : null;
  stages.pathOptions = enhancer.pathOptions ? enhancer.pathOptions() : null;

  // Stage 2: run the focus the way the plugin does.
  //
  // NOT `focusNodes`: that one only sets `renderer.highlightNode`, which is the
  // renderer's own single-node hover highlight. Calling it left `focusIds`
  // empty, so `focusEdgePairs` returned nothing and the first run of this
  // diagnostic reported a break that was really its own mistake.
  // `focusNodeInGraph` is the one that writes `focusIds`.
  enhancer.focusNodeInGraph(ids[0], leaf);
  enhancer.focusNodeInGraph(ids[1], leaf);
  await wait(1500);

  // Stage 3: the pairs it produced.
  let pairs = [];
  try {
    pairs = enhancer.focusEdgePairs(renderer) ?? [];
  } catch (error) {
    stages.focusEdgePairsThrew = String(error);
  }
  stages.pairCount = pairs.length;
  stages.pairs = pairs.slice(0, 30).map(([a, b]) => [a, b]);

  // Stage 4: per-pair resolution, exactly as collectLitEdges does it.
  stages.perPair = pairs.slice(0, 30).map(([a, b]) => {
    const from = officialIdOf.get(a);
    const to = officialIdOf.get(b);
    const forward = from ? lookup[from] : undefined;
    const backward = to ? lookup[to] : undefined;
    const link = forward?.forward?.[to] ?? backward?.forward?.[from];
    return {
      pair: [a, b],
      from: from ?? null,
      to: to ?? null,
      mapped: Boolean(from && to),
      onFromSide: Boolean(forward?.forward?.[to]),
      onToSide: Boolean(backward?.forward?.[from]),
      found: Boolean(link),
      hasLine: Boolean(link?.line),
    };
  });

  // Stage 5: what actually got collected and lit.
  let collected = null;
  try {
    const set = enhancer.collectLitEdges(renderer);
    collected = set ? set.size : null;
  } catch (error) {
    stages.collectThrew = String(error);
  }
  stages.collectedLitEdges = collected;
  stages.litEdgesMapSize = enhancer.litEdges ? [...enhancer.litEdges.values()].reduce((s, v) => s + v.size, 0) : null;

  // Stage 6: what the link objects' alpha actually is right now.
  const links = Array.isArray(renderer.links) ? renderer.links : [];
  const alphas = links
    .slice(0, 40)
    .map((link) => link?.line?.alpha)
    .filter((a) => typeof a === "number");
  stages.alphaSample = alphas.slice(0, 20);
  stages.highAlphaCount = alphas.filter((a) => a > 0.9).length;
  stages.linkCount = links.length;

  // Stage 7: does the searched edge itself appear among the pairs?
  const wanted = [candidate.source, candidate.target];
  stages.edgeIsInPairs = pairs.some(
    ([a, b]) => (a === wanted[0] && b === wanted[1]) || (a === wanted[1] && b === wanted[0]),
  );
  const paths = enhancer.findConnectingPathsFor
    ? null
    : null;
  stages.note = "paths computed inside focusEdgePairs; see edgeIsInPairs";
  void paths;

  return stages;
});

console.log("");
console.log("=== pipeline diagnostic ===");
console.log(JSON.stringify(report, null, 1));
const out = path.join(os.tmpdir(), "enhanced-graph-pipeline.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log("");
console.log("saved to " + out);
console.log("Nothing was written to the vault.");
await browser.close();
process.exit(0);
