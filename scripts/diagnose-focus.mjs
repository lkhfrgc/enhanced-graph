/**
 * Audits every edge in the plugin's graph against the built-in graph's own link
 * objects, inside YOUR Obsidian, without writing anything.
 *
 * Automatic on purpose: the earlier version asked a person to focus two notes by
 * hand, which cannot be done from here, and focusing one pair would only ever
 * answer the question for that pair. This resolves every edge instead, so the
 * one-directional case and the "the built-in graph has no such edge" case are
 * both measured rather than assumed.
 *
 * Usage:
 *   node scripts/diagnose-focus.mjs
 *
 * Quit Obsidian first: it refuses to start a second instance, and an already
 * running one has no debug port to attach to.
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
    console.error("");
    console.error("Obsidian is already running without a debug port. Quit it completely, then run again.");
    console.error("");
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

if (!(await endpointAlive())) {
  console.error(`Obsidian never exposed a debug endpoint on ${port}.`);
  process.exit(1);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().startsWith("app://obsidian.md"));
if (!page) {
  console.error("No Obsidian page found.");
  process.exit(1);
}
await page.waitForFunction(() => Boolean(window.app?.workspace), null, { timeout: 60000 });

// Give the plugin time to build and the built-in graph time to lay out links.
await page.waitForFunction(() => Boolean(window.app.plugins?.plugins?.["enhanced-graph"]), null, { timeout: 60000 });
await page.evaluate(async () => {
  const app = window.app;
  if (app.workspace.getLeavesOfType("graph").length === 0) {
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: "graph", active: true });
  }
});

// A leaf can exist before its renderer does, so poll for one rather than
// assuming a fixed delay is enough. If it never turns up, the note is printed
// below and the person can open the graph by hand while this is still running.
const rendererReady = await page
  .waitForFunction(
    () =>
      window.app.workspace
        .getLeavesOfType("graph")
        .some((candidate) => candidate.view && candidate.view.renderer),
    null,
    { timeout: 45000 },
  )
  .then(() => true)
  .catch(() => false);

if (!rendererReady) {
  console.log("");
  console.log("The built-in graph has not produced a renderer yet.");
  console.log("Open the graph view in Obsidian now (the window is already running).");
  console.log("Waiting up to 90 more seconds…");
  const second = await page
    .waitForFunction(
      () =>
        window.app.workspace
          .getLeavesOfType("graph")
          .some((candidate) => candidate.view && candidate.view.renderer),
      null,
      { timeout: 90000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!second) {
    console.error("Still no renderer. Nothing was read.");
    await browser.close();
    process.exit(1);
  }
}

// Let the layout settle so links exist.
await page.waitForTimeout(4000);

const report = await page.evaluate(() => {
  const app = window.app;
  const plugin = app.plugins?.plugins?.["enhanced-graph"];
  if (!plugin) return { error: "plugin not enabled" };

  const leaf = app.workspace
    .getLeavesOfType("graph")
    .find((candidate) => candidate.view && candidate.view.renderer);
  if (!leaf) return { error: "no built-in graph with a renderer" };
  const renderer = leaf.view.renderer;
  const lookup = renderer.nodeLookup ?? {};
  const ours = plugin.cached;

  // Our id -> official id, the same normalization the collector uses.
  const officialIdOf = new Map();
  for (const officialId of Object.keys(lookup)) {
    const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const node = ours.graph.nodeIndex.get(key);
    if (node) officialIdOf.set(node.id, officialId);
  }

  const stats = {
    vaultFiles: app.vault.getMarkdownFiles().length,
    ourNodes: ours.graph.nodes.length,
    ourEdges: ours.graph.edges.length,
    officialNodes: Object.keys(lookup).length,
    officialLinks: Array.isArray(renderer.links) ? renderer.links.length : null,
    mappedNodes: officialIdOf.size,
  };

  let bothEndpointsMapped = 0;
  let linkOnSourceSide = 0;
  let linkOnTargetSide = 0;
  let linkOnNeither = 0;
  let linkWithoutLine = 0;
  const examples = { neither: [], targetSideOnly: [], withoutLine: [] };

  for (const edge of ours.graph.edges) {
    const from = officialIdOf.get(edge.source);
    const to = officialIdOf.get(edge.target);
    if (!from || !to) continue;
    bothEndpointsMapped += 1;

    const onSource = lookup[from]?.forward?.[to];
    const onTarget = lookup[to]?.forward?.[from];
    if (onSource) linkOnSourceSide += 1;
    if (onTarget) linkOnTargetSide += 1;

    const found = onSource ?? onTarget;
    if (!found) {
      linkOnNeither += 1;
      if (examples.neither.length < 8) {
        examples.neither.push({
          our: [edge.source, edge.target],
          official: [from, to],
          sourceForwardKeys: Object.keys(lookup[from]?.forward ?? {}).length,
          targetForwardKeys: Object.keys(lookup[to]?.forward ?? {}).length,
        });
      }
      continue;
    }
    if (!onSource && onTarget) {
      // A one-directional link: stored only where the link was written.
      if (examples.targetSideOnly.length < 8) {
        examples.targetSideOnly.push({ our: [edge.source, edge.target], official: [from, to] });
      }
    }
    if (!found.line) {
      linkWithoutLine += 1;
      if (examples.withoutLine.length < 8) {
        examples.withoutLine.push({ our: [edge.source, edge.target], keys: Object.keys(found) });
      }
    }
  }

  // One worked example, printed in full, so the shape of a real link is visible
  // rather than inferred.
  const sampleEdge = ours.graph.edges.find(
    (edge) => officialIdOf.get(edge.source) && officialIdOf.get(edge.target),
  );
  let sample = null;
  if (sampleEdge) {
    const from = officialIdOf.get(sampleEdge.source);
    const to = officialIdOf.get(sampleEdge.target);
    const onSource = lookup[from]?.forward?.[to];
    const onTarget = lookup[to]?.forward?.[from];
    // Only primitives: returning the link object itself fails to serialize,
    // because it carries the whole PIXI display tree behind it.
    sample = {
      our: [sampleEdge.source, sampleEdge.target],
      official: [from, to],
      onSourceSide: onSource ? Object.keys(onSource) : null,
      onTargetSide: onTarget ? Object.keys(onTarget) : null,
      found: Boolean(onSource ?? onTarget),
      hasLine: Boolean((onSource ?? onTarget)?.line),
      lineAlpha: (onSource ?? onTarget)?.line?.alpha ?? null,
    };
  }

  return {
    stats,
    edges: {
      bothEndpointsMapped,
      linkOnSourceSide,
      linkOnTargetSide,
      linkOnNeither,
      linkWithoutLine,
    },
    examples,
    sample,
  };
});

console.log("");
console.log("=== diagnostic ===");
console.log(JSON.stringify(report, null, 1));
console.log("");
const out = path.join(os.tmpdir(), "enhanced-graph-diagnostic.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log("saved to " + out);
console.log("Nothing was written to the vault.");

await browser.close();
process.exit(0);
