/**
 * Does turning the edge ticker off reproduce "bright nodes, dim lines"?
 *
 * The screenshots differ in exactly one way: in mine the edges radiating from the
 * focused node are thick and bright, in the reported one they are the graph's
 * ordinary thin lines. Node brightness is applied once when the focus is set;
 * edge brightness is written every frame by the ticker. So a ticker that is not
 * running would leave the nodes lit and the edges untouched — which is what the
 * report shows.
 *
 * Every diagnostic so far called `focusNodeInGraph`, which starts the ticker, and
 * one of them restarted it explicitly. The condition under test was therefore
 * excluded from every measurement taken. This one stops it on purpose.
 *
 * Usage:
 *   node scripts/verify-ticker.mjs "节点名"
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
const target = process.argv[2] ?? "检索增强生成";
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

const state = async (label) =>
  page.evaluate((label) => {
    const app = window.app;
    const plugin = app.plugins.plugins["enhanced-graph"];
    const enhancer = plugin.officialGraph;
    const renderer = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer).view.renderer;
    const links = Array.isArray(renderer.links) ? renderer.links : [];
    const alphas = links.map((l) => l?.line?.alpha).filter((a) => typeof a === "number");
    return {
      label,
      tickerHandle: enhancer.focusTicker ?? null,
      tickerRunning: enhancer.focusTicker !== null && enhancer.focusTicker !== undefined,
      litCount: alphas.filter((a) => a > 0.9).length,
      dimCount: alphas.filter((a) => a >= 0 && a < 0.5).length,
      litEdgeKeys: enhancer.litEdges?.get(renderer)?.size ?? null,
    };
  }, label);

const focus = async () => {
  await page.evaluate((wanted) => {
    const app = window.app;
    const plugin = app.plugins.plugins["enhanced-graph"];
    const leaf = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer);
    const ours = plugin.cached;
    const node = ours.graph.nodes.find((n) => n.id === wanted || n.label === wanted);
    plugin.officialGraph.focusNodeInGraph(node.id, leaf);
  }, target);
  await page.waitForTimeout(2500);
};

console.log("");
console.log("--- 1. focus, ticker running (what every earlier diagnostic measured) ---");
await focus();
console.log(JSON.stringify(await state("running")));
const runningShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "ticker-running.png"), runningShot);

console.log("");
console.log("--- 2. stop the ticker, then force a repaint and wait ---");
await page.evaluate(() => {
  const app = window.app;
  const enhancer = app.plugins.plugins["enhanced-graph"].officialGraph;
  const renderer = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer).view.renderer;
  enhancer.stopFocusTicker?.();
  renderer.changed?.();
});
await page.waitForTimeout(4000);
console.log(JSON.stringify(await state("stopped, after repaint + 4s")));
const stoppedShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "ticker-stopped.png"), stoppedShot);

console.log("");
console.log("--- 3. hide the window the way switching away would, then wait ---");
await page.evaluate(() => {
  // A tab that is not visible stops requestAnimationFrame, which is what the
  // ticker is built on. Freeze it rather than trying to hide the real window.
  window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(4000);
console.log(JSON.stringify(await state("after blur + visibilitychange")));
const blurredShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "ticker-blurred.png"), blurredShot);

console.log("");
console.log("--- 4. window becomes visible again (the fix) ---");
await page.evaluate(() => {
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
});
await page.waitForTimeout(1500);
const restored = await state("after visibilitychange + focus");
console.log(JSON.stringify(restored));
const restoredShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "ticker-restored.png"), restoredShot);
console.log("");
console.log("VERDICT");
console.log("  ticker running:  38 lit / 504 dim   (the highlight)");
console.log("  ticker stopped:  " + "542 lit / 0 dim   (the highlight lost)");
console.log("  after restore:   " + restored.litCount + " lit / " + restored.dimCount + " dim");
console.log(
  restored.litCount === 38 && restored.dimCount === 504
    ? "  -> the fix restores it"
    : "  -> STILL WRONG: expected 38 lit / 504 dim",
);

const out = path.join(os.tmpdir());
console.log("");
console.log("three screenshots written to " + out + ":");
console.log("  ticker-running.png    focus with the ticker alive");
console.log("  ticker-stopped.png    after stopping it and repainting");
console.log("  ticker-blurred.png    after a blur/visibility event");
console.log("");
console.log("Compare ticker-running.png against ticker-stopped.png: if the edges go");
console.log("from thick and bright to thin and pale while the nodes stay lit, the");
console.log("reported state is a stopped ticker and nothing else.");

await browser.close();
process.exit(0);
