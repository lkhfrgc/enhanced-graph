/**
 * Compares PIXELS, not properties.
 *
 * Every earlier check read a value we wrote — the collected key count, the
 * resolved line count, `line.alpha` — and every one of them said the highlight
 * was complete while the screen said otherwise. Three of those readings also
 * contradicted each other, so they cannot be the basis for a fix.
 *
 * This takes two screenshots of the same graph, one with the focus active and one
 * without, and samples the pixels along the segment between each pair of nodes
 * that the plugin claims to have lit. If a line lights up, the pixels along it
 * change; if they do not, the plugin's claim and the screen disagree, and the
 * disagreement is now measured rather than argued.
 *
 * Usage:
 *   node scripts/verify-highlight-pixels.mjs "节点名"
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

const freePort = (preferred) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.once("listening", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : preferred;
      server.close(() => resolve(actual));
    });
    server.listen(preferred, "127.0.0.1");
  }).then((found) => found ?? new Promise((resolve) => {
    const server = net.createServer();
    server.once("listening", () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(actual));
    });
    server.listen(0, "127.0.0.1");
  }));

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
  port = await freePort(port);
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

/** Node centres, in the coordinate space the screenshot uses. */
const geometry = await page.evaluate((wanted) => {
  const app = window.app;
  const plugin = app.plugins.plugins["enhanced-graph"];
  const enhancer = plugin.officialGraph;
  const renderer = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer).view.renderer;
  const lookup = renderer.nodeLookup ?? {};
  const ours = plugin.cached;
  const node = ours.graph.nodes.find((n) => n.id === wanted || n.label === wanted);
  if (!node) return { error: "node not in the plugin's graph", sample: ours.graph.nodes.slice(0, 10).map((n) => n.id) };

  const officialIdOf = new Map();
  for (const officialId of Object.keys(lookup)) {
    const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const oursNode = ours.graph.nodeIndex.get(key);
    if (oursNode) officialIdOf.set(oursNode.id, officialId);
  }

  // The graph's canvas has no stable class; take the largest one, which is it.
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ c, r: c.getBoundingClientRect() }));
  canvases.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const canvas = canvases[0]?.c ?? null;
  const box = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const dpr = window.devicePixelRatio || 1;
  const scale = renderer.scale;
  const panX = renderer.panX ?? 0;
  const panY = renderer.panY ?? 0;

  // The plugin's own transform, which the marker has been drawn with correctly
  // all along.
  const screenOf = (officialId) => {
    const n = lookup[officialId];
    if (!n || typeof n.x !== "number") return null;
    return {
      // Canvas-local CSS pixels, then offset by the canvas position so the
      // screenshot and the geometry share one origin.
      x: box.left + (n.x * scale + panX) / dpr,
      y: box.top + (n.y * scale + panY) / dpr,
      w: box.width,
      h: box.height,
    };
  };

  const centre = screenOf(officialIdOf.get(node.id));
  if (!centre) return { error: "the focused node has no position in the built-in graph" };

  // The neighbours the plugin claims to have lit.
  const neighbours = [];
  for (const edge of ours.graph.edges) {
    const otherId = edge.source === node.id ? edge.target : edge.target === node.id ? edge.source : null;
    if (!otherId) continue;
    const otherOfficial = officialIdOf.get(otherId);
    if (!otherOfficial) continue;
    const point = screenOf(otherOfficial);
    if (point) neighbours.push({ id: otherId, x: point.x, y: point.y });
  }

  return {
    focus: { x: centre.x, y: centre.y },
    canvas: { left: box.left, top: box.top, width: box.width, height: box.height },
    claimed: neighbours.length,
    neighbours,
    devicePixelRatio: dpr,
  };
}, target);

if (geometry.error) {
  console.error(JSON.stringify(geometry, null, 1));
  process.exit(1);
}
console.log(`focused: ${target}   claimed lit edges: ${geometry.claimed}`);
console.log(`canvas: ${Math.round(geometry.canvas.width)}x${Math.round(geometry.canvas.height)} at (${Math.round(geometry.canvas.left)}, ${Math.round(geometry.canvas.top)})`);

// Screenshot with the focus OFF first, so the "before" is the untouched graph.
const clearFocus = async () => {
  await page.evaluate(() => {
    const enhancer = window.app.plugins.plugins["enhanced-graph"].officialGraph;
    const renderer = window.app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer).view.renderer;
    enhancer.focusIds?.delete(renderer);
    renderer.changed?.();
  });
  await page.waitForTimeout(2000);
};
const applyFocus = async () => {
  await page.evaluate((wanted) => {
    const app = window.app;
    const plugin = app.plugins.plugins["enhanced-graph"];
    const enhancer = plugin.officialGraph;
    const leaf = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer);
    const ours = plugin.cached;
    const node = ours.graph.nodes.find((n) => n.id === wanted || n.label === wanted);
    enhancer.focusNodeInGraph(node.id, leaf);
  }, target);
  await page.waitForTimeout(2500);
};

await clearFocus();
const offShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "highlight-off.png"), offShot);

await applyFocus();
const onShot = await page.screenshot();
fs.writeFileSync(path.join(os.tmpdir(), "highlight-on.png"), onShot);

// Compare inside the page: no PNG decoder needed here, and both screenshots are
// interpreted in the same coordinate space the geometry was read in.
const comparison = await page.evaluate(
  async ({ offBase64, onBase64, focus, neighbours }) => {
    const load = (base64) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = "data:image/png;base64," + base64;
      });
    const [off, on] = await Promise.all([load(offBase64), load(onBase64)]);

    const pixelsOf = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
    };
    const offPixels = pixelsOf(off);
    const onPixels = pixelsOf(on);

    // Screenshots are in device pixels; the geometry was read in CSS pixels.
    const factor = offPixels.width / window.innerWidth;
    const luminance = (image, x, y) => {
      const px = Math.round(x * factor);
      const py = Math.round(y * factor);
      if (px < 1 || py < 1 || px >= image.width - 1 || py >= image.height - 1) return null;
      const at = (image.width * py + px) << 2;
      return 0.2126 * image.data[at] + 0.7152 * image.data[at + 1] + 0.0722 * image.data[at + 2];
    };

    const results = [];
    for (const neighbour of neighbours) {
      // Offset the segment by each node's own radius so the discs are skipped.
      const dx = neighbour.x - focus.x;
      const dy = neighbour.y - focus.y;
      const length = Math.hypot(dx, dy);
      if (length < 30) continue;
      const samples = [];
      for (let travelled = 14; travelled <= length - 14; travelled += 2) {
        const x = focus.x + (dx / length) * travelled;
        const y = focus.y + (dy / length) * travelled;
        const before = luminance(offPixels, x, y);
        const after = luminance(onPixels, x, y);
        if (before === null || after === null) continue;
        samples.push({ before, after });
      }
      if (samples.length < 5) continue;
      // The line is thin, so a fixed grid will not land on it every time: the
      // peak along the segment is what says whether a line is there and bright.
      const peakBefore = Math.max(...samples.map((s) => s.before));
      const peakAfter = Math.max(...samples.map((s) => s.after));
      results.push({
        id: neighbour.id,
        peakBefore: Math.round(peakBefore),
        peakAfter: Math.round(peakAfter),
        delta: Math.round(peakAfter - peakBefore),
      });
    }
    return { factor, results, screenshotWidth: offPixels.width, innerWidth: window.innerWidth };
  },
  {
    offBase64: offShot.toString("base64"),
    onBase64: onShot.toString("base64"),
    focus: geometry.focus,
    neighbours: geometry.neighbours,
  },
);

console.log("");
console.log("screenshot scale factor: " + comparison.factor + "  (" + comparison.screenshotWidth + "px for " + comparison.innerWidth + " CSS px)");
const brightened = comparison.results.filter((r) => r.delta > 15);
const unchanged = comparison.results.filter((r) => r.delta <= 15);
console.log("sampled edges:            " + comparison.results.length);
console.log("brightened on screen:     " + brightened.length);
console.log("NOT brightened on screen: " + unchanged.length);
console.log("");
console.log("not brightened (the plugin claims these are lit):");
for (const r of unchanged.slice(0, 20)) console.log("  " + r.id + "   peak " + r.peakBefore + " -> " + r.peakAfter + "  (delta " + r.delta + ")");
console.log("");
console.log("brightened, for comparison:");
for (const r of brightened.slice(0, 6)) console.log("  " + r.id + "   peak " + r.peakBefore + " -> " + r.peakAfter + "  (delta " + r.delta + ")");
const out = path.join(os.tmpdir(), "highlight-pixels.json");
fs.writeFileSync(out, JSON.stringify({ target, claimed: geometry.claimed, comparison }, null, 2), "utf8");
console.log("");
console.log("saved: " + out);
console.log("screenshots: highlight-off.png / highlight-on.png in " + os.tmpdir());

await browser.close();
process.exit(0);
