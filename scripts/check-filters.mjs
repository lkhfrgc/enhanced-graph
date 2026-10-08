/**
 * Drives the filters panel in a real Obsidian and checks the behaviour by hand.
 *
 * Four attempts to assert this in the harness all failed to discriminate — they
 * passed with the bug present — because the harness clicks and then reads without
 * letting anything repaint in between. This does what a person does: click, wait,
 * click, wait, then look at the boxes.
 *
 * Quit Obsidian first. Usage: node scripts/check-filters.mjs
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
// Obsidian throws "No tab group found" if the workspace has not laid out yet, so
// opening the graph is retried rather than attempted once.
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (window.app.workspace.getLeavesOfType("graph").length > 0) return;
    try {
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: "graph", active: true });
      return;
    } catch {
      await wait(1500);
    }
  }
});
await page.waitForFunction(
  () => window.app.workspace.getLeavesOfType("graph").some((c) => c.view && c.view.renderer),
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(6000);

const step = async (label, fn) => {
  const result = await page.evaluate(fn);
  console.log("");
  console.log("--- " + label + " ---");
  console.log(JSON.stringify(result, null, 1));
  return result;
};

// Open the filters tab.
await step("open the filters panel", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bar = document.querySelector(".enhanced-graph-official-toolbar");
  const button = [...(bar?.querySelectorAll("button") ?? [])].find((el) =>
    (el.textContent ?? "").includes("过滤器"),
  );
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(700);
  return { toolbarButtonFound: Boolean(button), panelOpen: Boolean(document.querySelector(".enhanced-graph-official-filters")) };
});

// Hide a few tags the way a person does, then let everything settle.
const before = await step("hide three tags by clicking their boxes", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const boxes = [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")];
  const ticked = boxes.filter((el) => el.checked);
  for (const box of ticked.slice(0, 3)) {
    box.click();
    await wait(150);
  }
  await wait(1200);
  const after = [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")];
  return {
    tagRows: after.length,
    untickedAfterHiding: after.filter((el) => !el.checked).length,
    visibilitySwitches: [...document.querySelectorAll(".enhanced-graph-official-filters .enhanced-graph-checkbox")]
      .filter((row) => /孤立|结构/.test(row.textContent ?? ""))
      .map((row) => ({ text: (row.textContent ?? "").trim().slice(0, 12), checked: row.querySelector("input")?.checked })),
  };
});

// Press restore, wait for whatever repaint follows, then look at the boxes.
const restored = await step("press 全部恢复, then wait and re-read the boxes", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = [...document.querySelectorAll("button")].find((el) =>
    (el.textContent ?? "").includes("全部恢复"),
  );
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(2000);
  // Force a repaint afterwards: this is the step the harness never did, and the
  // one that put the ticks back when the list was rebuilt from a stale set.
  document.querySelector(".enhanced-graph-official-filters")?.dispatchEvent(new Event("scroll", { bubbles: true }));
  window.dispatchEvent(new Event("resize"));
  await wait(1500);

  const boxes = [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")];
  const plugin = window.app.plugins.plugins["enhanced-graph"];
  return {
    buttonFound: Boolean(button),
    tagRows: boxes.length,
    untickedAfterRestore: boxes.filter((el) => !el.checked).length,
    hiddenTagsInSettings: [...(plugin.settings.hiddenTags ?? [])].length,
    hideIsolated: plugin.settings.hideIsolated,
    hideStructural: plugin.settings.hideStructural,
    untickedRows: boxes.filter((el) => !el.checked).map((el) => el.closest("label")?.textContent?.slice(0, 20)),
  };
});

const shot = path.join(os.tmpdir(), "filters-check.png");
await page.screenshot({ path: shot });
console.log("");
console.log("screenshot: " + shot);
console.log("");
console.log("VERDICT");
console.log("  tag rows                     " + restored.tagRows);
console.log("  hidden tags left in settings " + restored.hiddenTagsInSettings + "   (want 0)");
console.log("  unticked boxes after restore " + restored.untickedAfterRestore + "   (want 0)");
console.log(
  "  " +
    (restored.hiddenTagsInSettings === 0 && restored.untickedAfterRestore === 0
      ? "PASS: every tag came back, in the settings and on screen"
      : "FAIL: see the counts above"),
);
console.log("  visibility switches: hideIsolated=" + restored.hideIsolated + " hideStructural=" + restored.hideStructural + "  (must be unchanged by the restore)");
void before;
void fs;

await browser.close();
process.exit(0);
