/**
 * Measures the panel and the legend as they actually are on screen.
 *
 * Three attempts at this were reasoned from the CSS and all three were reported
 * as not working. Bounding boxes settle it in one run: where each box is, whether
 * they overlap, and what the browser actually computed for the properties that
 * were supposed to keep them apart.
 *
 * Quit Obsidian first. Usage: node scripts/measure-overlay.mjs
 */
import { spawn } from "node:child_process";
import net from "node:net";
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
await page.waitForTimeout(5000);

const report = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return { selector, found: false };
    const r = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      selector,
      found: true,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      height: Math.round(r.height),
      maxHeight: style.maxHeight,
      height2: style.height,
      overflowY: style.overflowY,
      zIndex: style.zIndex,
      position: style.position,
    };
  };

  const panel = box(".enhanced-graph-official-panel");
  const legend = box(".enhanced-graph-official-legend");
  const overlay = box(".enhanced-graph-official-overlay");

  const overlap =
    panel.found && legend.found
      ? Math.max(0, Math.min(panel.bottom, legend.bottom) - Math.max(panel.top, legend.top))
      : null;

  // Who paints on top where they meet, by asking the document what is at a point
  // inside the overlap.
  let topmost = null;
  if (panel.found && legend.found && overlap > 0) {
    const x = Math.max(panel.left, legend.left) + 10;
    const y = Math.max(panel.top, legend.top) + 10;
    const element = document.elementFromPoint(x, y);
    topmost = element
      ? element.className || element.tagName
      : null;
  }

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    overlay,
    panel,
    legend,
    overlapPx: overlap,
    topmostAtOverlap: topmost,
    graphViewHeight: (() => {
      const leaf = document.querySelector(".workspace-leaf.mod-active .view-content") ?? document.querySelector(".view-content");
      return leaf ? Math.round(leaf.getBoundingClientRect().height) : null;
    })(),
  };
});

console.log("");
console.log(JSON.stringify(report, null, 1));
console.log("");
console.log("=== read this ===");
console.log("  panel.maxHeight      what the browser actually applied");
console.log("  overlay.height       the box the percentage resolves against");
console.log("  overlapPx            >0 means they still overlap");
console.log("  topmostAtOverlap     which element wins where they meet");

await browser.close();
process.exit(0);
