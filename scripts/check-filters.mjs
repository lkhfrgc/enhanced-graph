/**
 * Drives the filters panel in a real Obsidian and checks the behaviour by hand.
 *
 * The point of this file is the INPUT, not the assertions. Five earlier attempts
 * to reproduce the 全部恢复 bug all passed with it present, because every one of
 * them clicked synthetically: `dispatchEvent(new MouseEvent("click"))` and
 * `element.click()` fire a click without pressing anything. A real press focuses
 * the control first (which is what defers the panel's re-render, and what makes a
 * rebuild land between mousedown and mouseup), and it lasts long enough for a 0ms
 * timer to run inside it. Both differences are the bug.
 *
 * So everything here is pressed, held and released the way a person does:
 * `locator.click({ delay })` holds the button down for `delay` ms. Measured in
 * Edge, a 120ms press that spans a panel rebuild dispatches no click at all —
 * `node scripts/verify-click-during-rebuild.mjs` holds that measurement.
 *
 * Attaches to an Obsidian already running with a debug port, or starts one.
 * The plugin is reloaded first, so the bundle under test is the one on disk.
 *
 * Usage: node scripts/check-filters.mjs
 */
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
const PLUGIN_ID = "enhanced-graph";
/** Long enough for a deferred re-render to land inside the press. */
const PRESS_MS = 120;
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

await page.waitForFunction((id) => Boolean(window.app.plugins?.plugins?.[id]), PLUGIN_ID, { timeout: 60000 });

// Reload the plugin: the vault copy is what Obsidian loads, and a stale one has
// made every check here pass against code that had already been replaced.
console.log("Reloading the plugin so the bundle on disk is the one under test…");
await page.evaluate(async (id) => {
  await window.app.plugins.disablePlugin(id);
  await new Promise((r) => setTimeout(r, 500));
  await window.app.plugins.enablePlugin(id);
  await new Promise((r) => setTimeout(r, 1500));
}, PLUGIN_ID);

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

/** What the panel and the settings say right now. */
const readState = () =>
  page.evaluate((id) => {
    const boxes = [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")];
    const plugin = window.app.plugins.plugins[id];
    return {
      tagRows: boxes.length,
      ticked: boxes.filter((el) => el.checked).length,
      hiddenTags: (plugin.settings.hiddenTags ?? []).slice(),
      hideIsolated: plugin.settings.hideIsolated,
      hideStructural: plugin.settings.hideStructural,
      // The deferral this bug lives in: a checkbox that still has focus is what
      // stops the panel from re-rendering between two clicks.
      focus: document.activeElement?.tagName ?? null,
      focusInPanel: Boolean(document.activeElement?.closest?.(".enhanced-graph-official-filters")),
    };
  }, PLUGIN_ID);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

/**
 * Runs one labelled step in the Obsidian page and prints what it returned.
 *
 * The insight-card check below was written against this helper, so it stays here
 * rather than being folded into `check`: it is how a step that needs to LOOK at
 * something reports what it saw before anything is asserted about it.
 */
const step = async (label, fn) => {
  const result = await page.evaluate(fn);
  console.log("");
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(result, null, 1));
  return result;
};

// Open the filters tab the way a person does: a real press on its toolbar button.
const filterButton = page.locator(".enhanced-graph-official-toolbar button", { hasText: "过滤器" }).first();
await filterButton.click({ delay: PRESS_MS });
await page.waitForSelector(".enhanced-graph-tag-list input[type=checkbox]", { timeout: 15000 });
await page.waitForTimeout(500);

const round = async (label, query) => {
  console.log("");
  console.log(`--- ${label} ---`);
  if (query !== null) {
    const search = page.locator(".enhanced-graph-tag-search").first();
    await search.click({ delay: PRESS_MS });
    await search.fill(query);
    await page.waitForTimeout(600);
  }

  const before = await readState();
  console.log(`  rows ${before.tagRows}, ticked ${before.ticked}, hidden ${JSON.stringify(before.hiddenTags)}`);

  // Three real presses on three tag checkboxes. Each one focuses the box, which
  // is what defers the panel's re-render for the whole sequence.
  const boxes = page.locator(".enhanced-graph-tag-list input[type=checkbox]");
  for (let index = 0; index < 3; index += 1) {
    await boxes.nth(index).click({ delay: PRESS_MS });
    await page.waitForTimeout(400);
  }
  const afterHiding = await readState();
  console.log(
    `  after three presses: ticked ${afterHiding.ticked}, hidden ${JSON.stringify(afterHiding.hiddenTags)}, ` +
      `focus ${afterHiding.focus} inPanel=${afterHiding.focusInPanel}`,
  );
  check(
    `${label}: three presses exclude three tags, and the settings keep all three`,
    afterHiding.hiddenTags.length === 3 && afterHiding.ticked === 3,
    `${afterHiding.ticked} ticked on screen, ${afterHiding.hiddenTags.length} in the settings (want 3 and 3)`,
  );

  // The press under test, held the way a person holds it.
  await page.locator("button", { hasText: "全清" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(1200);
  const afterRestore = await readState();
  console.log(
    `  after 全清: ticked ${afterRestore.ticked}, hidden ${JSON.stringify(afterRestore.hiddenTags)}`,
  );
  check(
    `${label}: ONE press of 全清 clears the tag selection`,
    afterRestore.hiddenTags.length === 0 && afterRestore.ticked === 0,
    `${afterRestore.ticked} ticked on screen, ${afterRestore.hiddenTags.length} in the settings (want 0 and 0)`,
  );
  check(
    `${label}: the visibility switches were left alone`,
    afterRestore.hideIsolated === before.hideIsolated && afterRestore.hideStructural === before.hideStructural,
    `hideIsolated=${afterRestore.hideIsolated} hideStructural=${afterRestore.hideStructural}`,
  );
};

await round("plain list", null);
await round("with a tag search query", "a");

// Click an insight card and see whether BOTH endpoints end up focused.
const insight = await step("click the first insight connection card", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.app;
  const plugin = app.plugins.plugins["enhanced-graph"];
  const enhancer = plugin.officialGraph;
  const renderer = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer)?.view.renderer;

  // Make sure the insights tab is showing.
  const bar = document.querySelector(".enhanced-graph-official-toolbar");
  const insightsButton = [...(bar?.querySelectorAll("button") ?? [])].find((el) =>
    (el.textContent ?? "").includes("洞察"),
  );
  insightsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(900);

  const cards = [...document.querySelectorAll(".enhanced-graph-card")];
  const titles = cards.map((el) => (el.textContent ?? "").trim().slice(0, 30));
  const card = cards[0];
  if (!card) return { cards: 0, error: "no insight cards rendered" };
  const before = enhancer.focusIds.get(renderer)?.size ?? 0;
  card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(1500);
  const focused = [...(enhancer.focusIds.get(renderer) ?? [])];

  // Then a SECOND card: the first card's focus has to be gone, not added to. The
  // panel only ever marks one card active, so the graph has to agree with it.
  const second = [...document.querySelectorAll(".enhanced-graph-card")][1];
  const focusedSecond = second
    ? await (async () => {
        second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(1500);
        return [...(enhancer.focusIds.get(renderer) ?? [])];
      })()
    : [];

  return {
    cards: cards.length,
    firstCard: titles[0] ?? null,
    secondCard: titles[1] ?? null,
    focusBefore: before,
    focusAfter: focused.length,
    focused,
    focusAfterSecond: focusedSecond.length,
    focusedSecond,
    // Ids the first card focused that are still focused after the second click.
    leftOver: focused.filter((id) => focusedSecond.includes(id)),
  };
});

// The card names a connection, so the plugin's own focus — the state 右键「聚焦邻居」
// produces — has to hold BOTH ends, not just the first one it can resolve.
check(
  "one click on an insight card focuses both ends of the connection",
  insight.focusAfter === 2,
  `${insight.cards} card(s), first="${insight.firstCard}", ` +
    `focus ${insight.focusBefore} → ${insight.focusAfter} [${(insight.focused ?? []).join(", ")}]`,
);
check(
  "clicking a second card drops the first card's focus",
  insight.cards < 2 || (insight.leftOver ?? []).length === 0,
  `second="${insight.secondCard}", focus ${insight.focusAfter} → ${insight.focusAfterSecond} ` +
    `[${(insight.focusedSecond ?? []).join(", ")}], left over from the first [${(insight.leftOver ?? []).join(", ")}]`,
);

const shot = path.join(os.tmpdir(), "filters-check.png");
await page.screenshot({ path: shot });
console.log("");
console.log("screenshot: " + shot);
console.log("");
console.log("VERDICT");
for (const result of results) console.log(`  ${result.pass ? "ok  " : "FAIL"} ${result.name}`);
const failed = results.filter((result) => !result.pass).length;
console.log(failed === 0 ? "  all checks passed" : `  ${failed} check(s) failed`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
