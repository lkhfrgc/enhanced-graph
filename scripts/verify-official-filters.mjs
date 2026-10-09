/**
 * Presses the built-in graph's filters panel with real input, in a real browser.
 *
 * The bug this exists for — 全部恢复 restoring a few tags and leaving the rest
 * unchecked until it was pressed again — was "fixed" once before without a check
 * that could see it, because five attempts all clicked synthetically and a
 * synthetic click is not a press: it does not focus the control (which is what
 * defers the panel's re-render, and what puts a rebuild between mousedown and
 * mouseup) and it does not last long enough for a 0ms timer to run inside it.
 *
 * So this drives the real panel — `harness/official-filters.ts` mounts the real
 * `OfficialGraphEnhancer`, whose filters body is the real `renderFiltersBody` —
 * with `locator.click({ delay: 120 })`: press, hold, release, the way a person
 * does it, and the click that follows is delivered or dropped by the browser
 * exactly as it would be in the app.
 *
 * Usage: node scripts/verify-official-filters.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const harnessDir = path.join(root, "harness");
const ENTRY = path.join(harnessDir, "official-filters.ts");
const BUNDLE = path.join(harnessDir, "official-filters.bundle.js");

/** Held down for as long as a person holds a button. */
const PRESS_MS = 120;

console.log("Bundling the built-in graph's chrome…");
await esbuild.build({
  entryPoints: [ENTRY],
  outfile: BUNDLE,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  logLevel: "warning",
  // Same alias the browser harness uses: the published package is types-only.
  alias: { obsidian: path.join(harnessDir, "obsidian-stub.ts") },
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname) === "/" ? "/official-filters.html" : decodeURIComponent(url.pathname);
  const target =
    pathname === "/styles.css" ? path.join(root, "styles.css") : path.join(harnessDir, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (!target.startsWith(harnessDir) && !target.endsWith("styles.css")) {
    response.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream" });
    response.end(data);
  });
});
const port = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

/**
 * Presses one of the panel's section tabs.
 *
 * The filter groups switch like tabs, so a check that wants the tag list has to
 * press its button first — and a check that does not would silently read the
 * wrong group.
 */
const selectTab = async (label) => {
  await page
    .locator(".enhanced-graph-panel-tabs button", { hasText: label })
    .first()
    .click({ delay: PRESS_MS });
  await page.waitForTimeout(250);
};

const browser = await chromium.launch({ channel: process.env.HARNESS_BROWSER ?? "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

console.log(`\n=== Enhanced Graph — built-in graph filters (http://127.0.0.1:${port}) ===\n`);

const state = () =>
  page.evaluate(() => {
    const api = window.__OFFICIAL_FILTERS__;
    const boxes = [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")];
    return {
      tagRows: boxes.length,
      selected: boxes.filter((el) => el.checked).length,
      hiddenTags: api.settings.hiddenTags.slice(),
      tagMode: api.settings.tagFilterMode,
      activeTag: document.activeElement?.tagName ?? null,
      focusInFilters: Boolean(document.activeElement?.closest?.(".enhanced-graph-official-filters")),
    };
  });

/** The panel's drawn height, rounded to whole pixels. */
const panelHeight = () =>
  page.evaluate(() => {
    const panel = document.querySelector(".enhanced-graph-official-panel");
    return panel ? Math.round(panel.getBoundingClientRect().height) : -1;
  });

/** Presses one of the toolbar's panel buttons (洞察 / 颜色 / 过滤器 / 权重). */
const openPanelTab = async (label) => {
  await page
    .locator(".enhanced-graph-official-toolbar button", { hasText: label })
    .first()
    .click({ delay: PRESS_MS });
  await page.waitForTimeout(300);
};

try {
  await page.goto(`http://127.0.0.1:${port}/official-filters.html`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => window.__OFFICIAL_FILTERS_READY__ === true, null, { timeout: 30_000 });
  await page.waitForTimeout(500);

  // Open the filters tab with a real press on its toolbar button, then the tag
  // group within it: the groups switch like tabs.
  await page.locator(".enhanced-graph-official-toolbar button", { hasText: "过滤器" }).first().click({ delay: PRESS_MS });
  await page.waitForSelector(".enhanced-graph-panel-tabs button", { timeout: 15_000 });
  await selectTab("标签");
  await page.waitForSelector(".enhanced-graph-tag-list input[type=checkbox]", { timeout: 15_000 });
  await page.waitForTimeout(300);

  const before = await state();
  const tagRowsExpected = await page.evaluate(() => window.__OFFICIAL_FILTERS__.tagCount);
  check(
    "the filters panel lists a checkbox per tag",
    before.tagRows === tagRowsExpected && before.selected === 0,
    `${before.tagRows} rows, ${before.selected} ticked (want ${tagRowsExpected} rows, none ticked)`,
  );

  // Three real presses on three tag checkboxes. Each one focuses its box, which
  // is what defers the panel's re-render for the whole sequence — the state the
  // bulk button used to read a stale copy of. A tick now means "the tag this
  // filter acts on", and the default mode excludes it.
  const boxes = page.locator(".enhanced-graph-tag-list input[type=checkbox]");
  for (let index = 0; index < 3; index += 1) {
    await boxes.nth(index).click({ delay: PRESS_MS });
    await page.waitForTimeout(350);
  }
  const hidden = await state();
  console.log(
    `\n  after three presses: ${hidden.selected} ticked on screen, ` +
      `${JSON.stringify(hidden.hiddenTags)} in the settings, focus ${hidden.activeTag} (in panel: ${hidden.focusInFilters})`,
  );
  check(
    "three presses exclude three tags, and every one of them reaches the settings",
    hidden.selected === 3 && hidden.hiddenTags.length === 3,
    `${hidden.selected} ticked, ${hidden.hiddenTags.length} excluded (want 3 and 3)`,
  );
  check(
    "a tag checkbox keeps focus, so the panel is NOT rebuilt between presses",
    hidden.focusInFilters && hidden.activeTag === "INPUT",
    `focus is on ${hidden.activeTag}, inside the filters body: ${hidden.focusInFilters}`,
  );

  // The press under test. Held, like the ones above, because that is the press
  // that used to be dropped: the panel rebuilt the button mid-press.
  await page.locator("button", { hasText: "全清" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(800);
  const restored = await state();
  console.log(
    `  after one press of 全清: ${restored.selected} ticked on screen, ` +
      `${JSON.stringify(restored.hiddenTags)} in the settings\n`,
  );
  check(
    "ONE press of 全清 leaves every tag unticked",
    restored.selected === 0,
    `${restored.selected} tag rows ticked (want 0)`,
  );
  check(
    "ONE press of 全清 clears the tag selection",
    restored.hiddenTags.length === 0,
    `${restored.hiddenTags.length} ticked (want 0)`,
  );
  check("nothing logged an error while the panel was driven", consoleErrors.length === 0, consoleErrors.join(" | "));

  // --- the two tag modes, end to end -------------------------------------
  // Each mode starts in its own natural state — excluding with nothing ticked,
  // including with everything ticked — so switching never leaves the graph filtered
  // by the other mode's ticks. Counted on the payload the built-in renderer was
  // actually handed, so this is the filter the user sees rather than a setting.
  const drawnNodes = () =>
    page.evaluate(() =>
      Object.keys(window.__OFFICIAL_FILTERS__.renderer.lastData?.nodes ?? {}).length,
    );
  const carries = (tag) =>
    page.evaluate(
      (name) =>
        Object.values(window.__OFFICIAL_FILTERS__.nodeTags).filter((tags) => tags.includes(name)).length,
      tag,
    );
  const tickedRows = () =>
    page.evaluate(
      () =>
        [...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]")].filter(
          (el) => el.checked,
        ).length,
    );
  const rows = page.locator(".enhanced-graph-tag-list input[type=checkbox]");
  const firstName = await page.evaluate(
    () => document.querySelector(".enhanced-graph-tag-name")?.textContent ?? "",
  );
  const total = await drawnNodes();
  const carriers = await carries(firstName);

  await page.locator("button", { hasText: "包含标签" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const includeDefaultTicked = await tickedRows();
  const includeDefaultDrawn = await drawnNodes();

  // 全清 while including keeps NOTHING: an empty selection is a choice the user
  // made, not the absence of one, so the graph empties.
  await page.locator("button", { hasText: "全清" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const clearedTicked = await tickedRows();
  const clearedDrawn = await drawnNodes();

  // With one tag ticked, including keeps exactly its carriers.
  await rows.first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const includedDrawn = await drawnNodes();

  await page.locator("button", { hasText: "排除标签" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const excludeDefaultTicked = await tickedRows();
  const excludeDefaultDrawn = await drawnNodes();
  await rows.first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const excludedDrawn = await drawnNodes();

  // Back to including: its own ticks are exactly as they were left, and so is the
  // graph. Each mode keeps its own list; switching rewrites neither.
  await page.locator("button", { hasText: "包含标签" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  const includeRememberedTicked = await tickedRows();
  const includeRememberedDrawn = await drawnNodes();
  await page.locator("button", { hasText: "全清" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: "排除标签" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: "全清" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(600);

  console.log(
    `\n  tag modes: "${firstName}" is on ${carriers} of ${total} pages; ` +
      `include default ${includeDefaultTicked} ticked → ${includeDefaultDrawn} drawn; ` +
      `全清 → ${clearedTicked} ticked, ${clearedDrawn} drawn; include one → ${includedDrawn}; ` +
      `exclude default ${excludeDefaultTicked} ticked → ${excludeDefaultDrawn} drawn; exclude one → ${excludedDrawn}; ` +
      `back to include → ${includeRememberedTicked} ticked, ${includeRememberedDrawn} drawn\n`,
  );
  check(
    "包含标签 opens fully ticked and 排除标签 starts empty, both showing the whole graph",
    includeDefaultTicked === total &&
      includeDefaultDrawn === total &&
      excludeDefaultTicked === 0 &&
      excludeDefaultDrawn === total,
    `include ${includeDefaultTicked} ticked → ${includeDefaultDrawn} drawn; ` +
      `exclude ${excludeDefaultTicked} ticked → ${excludeDefaultDrawn} drawn (want ${total} drawn both times)`,
  );
  check(
    "全清 while including keeps nothing",
    clearedTicked === 0 && clearedDrawn === 0,
    `${clearedTicked} ticked, ${clearedDrawn} drawn (want 0 and 0)`,
  );
  check(
    "包含标签 keeps exactly the pages carrying the one ticked tag",
    carriers > 0 && includedDrawn === carriers && includedDrawn < total,
    `${firstName}: ${carriers} carriers, ${includedDrawn} drawn of ${total}`,
  );
  check(
    "排除标签 excludes the same tag instead",
    excludedDrawn === total - carriers,
    `${excludedDrawn} drawn of ${total} (want ${total - carriers})`,
  );
  check(
    "each mode remembers its own ticks across a switch",
    includeRememberedTicked === 1 && includeRememberedDrawn === carriers,
    `back in include: ${includeRememberedTicked} ticked, ${includeRememberedDrawn} drawn ` +
      `(want 1 and ${carriers})`,
  );

  // The workspace group: two typed paths and the button that applies them. On the
  // real vault this is what narrows the build; the fixture has no vault to re-read,
  // so what is measured here is exactly the part the panel owns — the suggestions it
  // offers, what it says about a typed path, that nothing is applied until the
  // button is pressed, and the pair it then asks for. The narrowing itself is
  // measured on the real vault in `verify:vault`.
  await selectTab("工作区");
  await page.waitForSelector(".enhanced-graph-folder-input", { timeout: 15_000 });
  await page.waitForTimeout(300);

  const suggestions = await page.evaluate(() =>
    Array.from(document.querySelectorAll("datalist option")).map((option) => option.getAttribute("value")),
  );
  const graphFolders = await page.evaluate(() =>
    window.__OFFICIAL_FILTERS__.folders.filter((entry) => entry.path !== "").map((entry) => entry.path),
  );
  const inputs = page.locator(".enhanced-graph-folder-input");
  const folderInput = inputs.nth(0);
  const excludeInput = inputs.nth(1);
  const applyButton = page.locator(".enhanced-graph-workspace-actions button", { hasText: "应用" }).first();
  const applyDisabledFirst = await applyButton.isDisabled();

  // Typing a path that names nothing has to say so: the graph would come back empty
  // and the reason would otherwise be invisible.
  await folderInput.fill("notez");
  await page.waitForTimeout(250);
  const unknownPath = await page.evaluate(() => {
    const status = document.querySelector(".enhanced-graph-workspace-status");
    return { text: status?.textContent, warning: status?.classList.contains("is-warning") };
  });
  await folderInput.fill("notes");
  await page.waitForTimeout(250);
  const knownPath = await page.evaluate(() => {
    const status = document.querySelector(".enhanced-graph-workspace-status");
    return { text: status?.textContent, warning: status?.classList.contains("is-warning") };
  });

  // An exclusion is typed and committed with Enter, which turns it into a chip.
  await excludeInput.fill("notes/deep");
  await excludeInput.press("Enter");
  await page.waitForTimeout(300);

  const staged = await page.evaluate(() => ({
    applied: window.__OFFICIAL_FILTERS__.appliedWorkspaces.length,
    folder: window.__OFFICIAL_FILTERS__.settings.workingFolder,
    excluded: window.__OFFICIAL_FILTERS__.settings.excludeFolders.slice(),
    chips: Array.from(document.querySelectorAll(".enhanced-graph-chip-text")).map((chip) => chip.textContent),
    typed: document.querySelectorAll(".enhanced-graph-folder-input")[0]?.value,
  }));
  const applyEnabledAfterStaging = !(await applyButton.isDisabled());

  await applyButton.click({ delay: PRESS_MS });
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => ({
    calls: window.__OFFICIAL_FILTERS__.appliedWorkspaces.slice(),
    folder: window.__OFFICIAL_FILTERS__.settings.workingFolder,
    excluded: window.__OFFICIAL_FILTERS__.settings.excludeFolders.slice(),
  }));

  console.log(
    `\n  workspace fields: suggestions ${JSON.stringify(suggestions)} for folders ${JSON.stringify(graphFolders)}; ` +
      `unknown path → ${JSON.stringify(unknownPath)}; known path → ${JSON.stringify(knownPath)}; ` +
      `staged → chips ${JSON.stringify(staged.chips)}, ${staged.applied} applied, ` +
      `settings ${JSON.stringify(staged.folder)}/${JSON.stringify(staged.excluded)}; ` +
      `after 应用 → ${JSON.stringify(applied.calls)}\n`,
  );
  check(
    "工作区 suggests the vault's folders, at every depth",
    suggestions.length === graphFolders.length &&
      graphFolders.every((folder) => suggestions.includes(folder)) &&
      suggestions.includes("notes/deep"),
    `${JSON.stringify(suggestions)} for folders ${JSON.stringify(graphFolders)}`,
  );
  check(
    "工作区 says when a typed path names no folder",
    (unknownPath.text ?? "").length > 0 &&
      unknownPath.warning === true &&
      knownPath.warning === false &&
      knownPath.text !== unknownPath.text,
    `unknown → ${JSON.stringify(unknownPath)}; known → ${JSON.stringify(knownPath)}`,
  );
  check(
    "应用 is disabled until something is staged",
    applyDisabledFirst === true && applyEnabledAfterStaging === true,
    `disabled at rest: ${applyDisabledFirst}, enabled after staging: ${applyEnabledAfterStaging}`,
  );
  check(
    "typing a path and adding an exclusion applies nothing",
    staged.applied === 0 &&
      staged.folder === "" &&
      staged.excluded.length === 0 &&
      JSON.stringify(staged.chips) === JSON.stringify(["notes/deep/"]) &&
      staged.typed === "notes",
    `${staged.applied} calls, settings ${JSON.stringify(staged.folder)}/${JSON.stringify(staged.excluded)}, ` +
      `chips ${JSON.stringify(staged.chips)}, field ${JSON.stringify(staged.typed)} (want none applied)`,
  );
  check(
    "应用 hands over the path to read and the path to leave out, in one call",
    applied.calls.length === 1 &&
      applied.calls[0].folder === "notes" &&
      JSON.stringify(applied.calls[0].excluded) === JSON.stringify(["notes/deep/"]) &&
      applied.folder === "notes" &&
      JSON.stringify(applied.excluded) === JSON.stringify(["notes/deep/"]),
    `${JSON.stringify(applied.calls)}; settings ${JSON.stringify(applied.folder)}/${JSON.stringify(applied.excluded)}`,
  );

  // Back to the whole vault, so the checks that follow see every node: clear the
  // path, remove the chip, apply.
  await folderInput.fill("");
  await page.locator(".enhanced-graph-chip-remove").first().click({ delay: PRESS_MS });
  await page.waitForTimeout(250);
  await page.locator(".enhanced-graph-workspace-actions button", { hasText: "应用" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(400);
  await selectTab("标签");
  await page.waitForTimeout(300);

  // Clusters: the legend's cards are controls in the built-in graph too, and they
  // write the same shared setting as the filters panel. Driven with the real
  // pointer, because the panel defers its own redraw while one of its checkboxes
  // has focus.
  const clusterState = () =>
    page.evaluate(() => window.__OFFICIAL_FILTERS__.settings.hiddenCommunities.slice());
  const legendRows = page.locator(".enhanced-graph-official-legend .enhanced-graph-legend-row");
  const legendShowAll = page.locator(".enhanced-graph-official-legend button", { hasText: "显示全部" });
  const legendBefore = await page.evaluate(() => ({
    buttons: document.querySelectorAll(".enhanced-graph-official-legend button").length,
    interactiveRows: document.querySelectorAll(
      ".enhanced-graph-official-legend .enhanced-graph-legend-row.is-interactive",
    ).length,
    rows: document.querySelectorAll(".enhanced-graph-official-legend .enhanced-graph-legend-row").length,
    hidden: window.__OFFICIAL_FILTERS__.settings.hiddenCommunities.slice(),
  }));
  const legendShowAllDisabledBefore = await legendShowAll.isDisabled();
  await legendRows.first().click({ delay: PRESS_MS });
  await page.waitForTimeout(500);
  const afterLegendClick = await clusterState();
  const legendMarked = await page.evaluate(
    () => document.querySelectorAll(".enhanced-graph-official-legend .enhanced-graph-legend-row.is-hidden-cluster").length,
  );
  const legendShowAllEnabledWhileHidden = !(await legendShowAll.isDisabled());
  await legendShowAll.click({ delay: PRESS_MS });
  await page.waitForTimeout(500);
  const afterLegendRestore = await clusterState();

  const clusterSection = page.locator('.enhanced-graph-official-filters [data-section="clusters"]');
  await selectTab("知识集群");
  const clusterBoxes = clusterSection.locator("input[type=checkbox]");
  const clusterRows = await clusterBoxes.count();
  const showAll = clusterSection.locator("button", { hasText: "显示全部" });
  const showAllDisabledBefore = await showAll.isDisabled();
  await clusterBoxes.first().click({ delay: PRESS_MS });
  await page.waitForTimeout(500);
  const hiddenClusters = await clusterState();
  const showAllDisabledAfter = await showAll.isDisabled();
  await showAll.click({ delay: PRESS_MS });
  await page.waitForTimeout(500);
  const restoredClusters = await clusterState();

  console.log(
    `\n  clusters: ${clusterRows} rows, legend ${legendBefore.rows} rows / ${legendBefore.buttons} buttons / ` +
      `${legendBefore.interactiveRows} interactive; panel ${JSON.stringify(hiddenClusters)} → ${JSON.stringify(restoredClusters)}\n`,
  );
  check(
    "the filters panel lists a switch per cluster, and one press excludes it",
    clusterRows >= 2 && hiddenClusters.length === 1,
    `${clusterRows} rows, hidden ${JSON.stringify(hiddenClusters)} (want one)`,
  );
  check(
    "the always-present 显示全部 wakes up with the exclusion and clears it",
    showAllDisabledBefore === true && showAllDisabledAfter === false && restoredClusters.length === 0,
    `disabled ${showAllDisabledBefore} → ${showAllDisabledAfter}, then ${JSON.stringify(restoredClusters)}`,
  );
  check(
    "the legend's cards are controls here too: a press excludes, 显示全部 restores",
    legendBefore.rows >= 2 &&
      legendBefore.interactiveRows === legendBefore.rows &&
      legendBefore.buttons === 1 &&
      legendShowAllDisabledBefore === true &&
      afterLegendClick.length === 1 &&
      legendMarked === 1 &&
      legendShowAllEnabledWhileHidden &&
      afterLegendRestore.length === 0,
    `${legendBefore.rows} rows, ${legendBefore.interactiveRows} interactive, ` +
      `${legendBefore.buttons} button(s); press → ${JSON.stringify(afterLegendClick)} ` +
      `(${legendMarked} marked), 显示全部 → ${JSON.stringify(afterLegendRestore)}`,
  );

  // --- one panel, one ceiling --------------------------------------------
  // The panel follows its content, and stops at the space the overlay leaves
  // above the legend. That ceiling is the same for every tab — measured, not
  // assumed: both the insight cards and the tag list carry more than fits, so each
  // reports the ceiling itself, and the two have to agree. A ceiling only shows
  // itself when something reaches it, which is why the fixture holds six cards
  // and thirty tags.
  const heights = { insights: 0, types: 0, tags: 0 };
  await openPanelTab("洞察");
  heights.insights = await panelHeight();
  await openPanelTab("过滤器");
  await selectTab("页面类型");
  heights.types = await panelHeight();
  await selectTab("标签");
  heights.tags = await panelHeight();
  const scrolls = await page.evaluate(() => {
    const panel = document.querySelector(".enhanced-graph-official-panel");
    return panel ? { scroll: panel.scrollHeight, client: panel.clientHeight } : { scroll: 0, client: 0 };
  });

  console.log(
    `\n  panel height: insights ${heights.insights}, 页面类型 ${heights.types}, 标签 ${heights.tags} ` +
      `(scroll ${scrolls.scroll} in ${scrolls.client})\n`,
  );
  check(
    "the tags tab fills to the same ceiling as the insights tab, and scrolls inside it",
    heights.insights > 100 &&
      heights.tags === heights.insights &&
      scrolls.scroll > scrolls.client,
    `insights ${heights.insights}, tags ${heights.tags} (want equal), ` +
      `scroll ${scrolls.scroll} in ${scrolls.client}`,
  );
  check(
    "a short tab still follows its content instead of padding out to that ceiling",
    heights.types > 0 && heights.types < heights.insights,
    `页面类型 ${heights.types} vs ceiling ${heights.insights}`,
  );

  // A short window is where the ceiling has to bind for both: same answer, one
  // window down, so "equal" cannot be an artefact of one particular height.
  await page.setViewportSize({ width: 900, height: 520 });
  await page.waitForTimeout(400);
  await openPanelTab("洞察");
  const shortInsights = await panelHeight();
  await openPanelTab("过滤器");
  await selectTab("标签");
  const shortTags = await panelHeight();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);
  console.log(`  in a 520px window: insights ${shortInsights}, 标签 ${shortTags}\n`);
  check(
    "the two tabs still agree in a shorter window",
    shortInsights > 60 && shortTags === shortInsights && shortInsights < heights.insights,
    `insights ${shortInsights}, tags ${shortTags}, full-window ceiling ${heights.insights}`,
  );
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);

  // --- the search marks follow the canvas ---------------------------------
  // The marks are our own canvas drawn in screen space, so they only stay on
  // their nodes if something redraws them as the camera moves. Measured on the
  // real pixels: put one mark on screen, pan the camera, and see where it went.
  const searchInput = page.locator(".enhanced-graph-official-toolbar .enhanced-graph-search input");
  await searchInput.click({ delay: PRESS_MS });
  await searchInput.fill("tag-07");
  await page.waitForTimeout(400);

  /** Centroid of the marker layer's non-transparent pixels. */
  const markCentroid = () =>
    page.evaluate(() => {
      const canvas = document.querySelector("canvas.enhanced-graph-marker-layer");
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return null;
      const { width, height } = canvas;
      const data = context.getImageData(0, 0, width, height).data;
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] === 0) continue;
        const pixel = (index - 3) / 4;
        sumX += pixel % width;
        sumY += Math.floor(pixel / width);
        count += 1;
      }
      return count === 0 ? { count: 0, x: 0, y: 0 } : { count, x: sumX / count, y: sumY / count };
    });

  const beforeMove = await markCentroid();
  // Pan by a known amount, exactly as dragging the canvas does.
  await page.evaluate(() => {
    window.__OFFICIAL_FILTERS__.renderer.panX += 120;
  });
  await page.waitForTimeout(400);
  const afterMove = await markCentroid();

  console.log(
    `\n  search mark: ${beforeMove?.count ?? 0}px at x=${beforeMove?.x.toFixed(1)} → ` +
      `${afterMove?.count ?? 0}px at x=${afterMove?.x.toFixed(1)} after a 120px pan\n`,
  );
  check(
    "the search mark moves with the canvas instead of staying where it was drawn",
    Boolean(beforeMove) &&
      beforeMove.count > 0 &&
      afterMove.count > 0 &&
      Math.abs(afterMove.x - beforeMove.x - 120) < 3 &&
      Math.abs(afterMove.y - beforeMove.y) < 3,
    `x ${beforeMove?.x.toFixed(1)} → ${afterMove?.x.toFixed(1)} (want +120), ` +
      `y ${beforeMove?.y.toFixed(1)} → ${afterMove?.y.toFixed(1)} (want unchanged)`,
  );

  // Put the search box back so nothing else is looking at marked nodes.
  await searchInput.fill("");
  await page.waitForTimeout(300);

  // --- nothing in the toolbar that does not belong there ------------------
  // Weights are tuned in the settings tab and the standalone view; the built-in
  // graph keeps itself in step with the vault, so it has no rebuild button.
  const toolbarLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".enhanced-graph-official-toolbar button")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent ?? "",
    ),
  );
  console.log(`  toolbar buttons: ${toolbarLabels.join(" | ")}\n`);
  check(
    "the toolbar offers no weights toggle and no rebuild button",
    !toolbarLabels.some((label) => label.includes("权重")) &&
      !toolbarLabels.some((label) => label.includes("重建")),
    `buttons: ${toolbarLabels.join(" | ")}`,
  );
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((result) => !result.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
