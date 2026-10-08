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
      unticked: boxes.filter((el) => !el.checked).length,
      hiddenTags: api.settings.hiddenTags.slice(),
      activeTag: document.activeElement?.tagName ?? null,
      focusInFilters: Boolean(document.activeElement?.closest?.(".enhanced-graph-official-filters")),
    };
  });

try {
  await page.goto(`http://127.0.0.1:${port}/official-filters.html`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => window.__OFFICIAL_FILTERS_READY__ === true, null, { timeout: 30_000 });
  await page.waitForTimeout(500);

  // Open the filters tab with a real press on its toolbar button.
  await page.locator(".enhanced-graph-official-toolbar button", { hasText: "过滤器" }).first().click({ delay: PRESS_MS });
  await page.waitForSelector(".enhanced-graph-tag-list input[type=checkbox]", { timeout: 15_000 });
  await page.waitForTimeout(300);

  const before = await state();
  check(
    "the filters panel lists a checkbox per tag",
    before.tagRows === 6 && before.unticked === 0,
    `${before.tagRows} rows, ${before.unticked} unticked`,
  );

  // Three real presses on three tag checkboxes. Each one focuses its box, which
  // is what defers the panel's re-render for the whole sequence — the state the
  // restore button used to read a stale copy of.
  const boxes = page.locator(".enhanced-graph-tag-list input[type=checkbox]");
  for (let index = 0; index < 3; index += 1) {
    await boxes.nth(index).click({ delay: PRESS_MS });
    await page.waitForTimeout(350);
  }
  const hidden = await state();
  console.log(
    `\n  after three presses: ${hidden.unticked} unticked on screen, ` +
      `${JSON.stringify(hidden.hiddenTags)} in the settings, focus ${hidden.activeTag} (in panel: ${hidden.focusInFilters})`,
  );
  check(
    "three presses hide three tags, and every one of them reaches the settings",
    hidden.unticked === 3 && hidden.hiddenTags.length === 3,
    `${hidden.unticked} unticked, ${hidden.hiddenTags.length} hidden (want 3 and 3)`,
  );
  check(
    "a tag checkbox keeps focus, so the panel is NOT rebuilt between presses",
    hidden.focusInFilters && hidden.activeTag === "INPUT",
    `focus is on ${hidden.activeTag}, inside the filters body: ${hidden.focusInFilters}`,
  );

  // The press under test. Held, like the ones above, because that is the press
  // that used to be dropped: the panel rebuilt the button mid-press.
  await page.locator("button", { hasText: "全部恢复" }).first().click({ delay: PRESS_MS });
  await page.waitForTimeout(800);
  const restored = await state();
  console.log(
    `  after one press of 全部恢复: ${restored.unticked} unticked on screen, ` +
      `${JSON.stringify(restored.hiddenTags)} in the settings\n`,
  );
  check(
    "ONE press of 全部恢复 leaves every tag ticked",
    restored.unticked === 0,
    `${restored.unticked} tag rows unticked (want 0)`,
  );
  check(
    "ONE press of 全部恢复 empties the hidden tags",
    restored.hiddenTags.length === 0,
    `${restored.hiddenTags.length} hidden (want 0)`,
  );
  check("nothing logged an error while the panel was driven", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((result) => !result.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
