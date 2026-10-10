/**
 * Measures the insight panel inside the real Obsidian.
 *
 * Written because three successive fixes to the panel's width were measured correct in
 * the browser harness and did not hold in the app. The harness is Chromium and so is
 * Obsidian, so the difference is not the renderer — it is everything around it: the
 * app's own stylesheet, the theme's, and the layout the view is docked into. None of
 * that can be reproduced from a fixture, and guessing at it had already cost more than
 * looking.
 *
 * Attaches over the Chrome DevTools Protocol to an Obsidian started with
 * `--remote-debugging-port`, drives the view itself, and prints the numbers for every
 * group — the panel's box, each card's box, and the element that is refusing to shrink.
 *
 * Usage: node scripts/obsidian-probe.mjs [port]
 */

import { chromium } from "playwright-core";

const port = Number(process.argv[2] ?? 9222);

/** One group's numbers, gathered in the page, for every panel present. */
const MEASURE = `(() => {
  const panels = [...document.querySelectorAll(".enhanced-graph-panel")];
  if (panels.length === 0) return { error: "no .enhanced-graph-panel in the DOM" };

  return panels.map((panel, index) => {
    const panelBox = panel.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const cards = [...panel.querySelectorAll(".enhanced-graph-card")];

    // The element whose own content is refusing to shrink: the widest scrollWidth among
    // things at least half a card wide.
    let widest = null;
    for (const el of panel.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width < 60) continue;
      if (!widest || el.scrollWidth > widest.scrollWidth) {
        widest = {
          cls: String(el.className),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          whiteSpace: getComputedStyle(el).whiteSpace,
          text: (el.textContent || "").trim().slice(0, 50),
        };
      }
    }

    const owner = panel.closest(".enhanced-graph-official-panel")
      ? "official-panel"
      : panel.closest(".enhanced-graph-body")
        ? "standalone-view"
        : "unknown";

    return {
      index: index + 1,
      owner,
      panel: {
        width: Math.round(panelBox.width),
        client: panel.clientWidth,
        offset: panel.offsetWidth,
        gutter: panel.offsetWidth - panel.clientWidth,
        declaredWidth: panelStyle.width,
        minWidth: panelStyle.minWidth,
        maxWidth: panelStyle.maxWidth,
        boxSizing: panelStyle.boxSizing,
        scrollbarGutter: panelStyle.scrollbarGutter,
        scrolls: panel.scrollHeight > panel.clientHeight,
        padding: panelStyle.padding,
        flex: panelStyle.flexGrow + " " + panelStyle.flexShrink + " " + panelStyle.flexBasis,
      },
      cards: {
        count: cards.length,
        widths: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().width)))].sort((a,b)=>a-b),
      },
      widest,
    };
  });
})()`;

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  console.log(`attached: ${pages.length} page(s)`);

  // The workspace, not the settings window or a popout.
  const page = pages.find((candidate) => candidate.url().includes("index.html")) ?? pages[0];
  if (!page) throw new Error("no page to attach to");
  console.log(`page: ${page.url()}\n`);

  // Open the view through the command the plugin registers, which is the same code path
  // a click takes — driving the UI any other way would test something the reader does
  // not do.
  const opened = await page.evaluate(async () => {
    const app = window.app;
    if (!app) return "no window.app";
    const command = app.commands?.commands?.["enhanced-graph:open"];
    if (!command) {
      const ids = Object.keys(app.commands?.commands ?? {}).filter((id) => id.includes("enhanced-graph"));
      return `command not found; ids: ${ids.join(", ")}`;
    }
    command.callback();
    return "ok";
  });
  console.log(`open view: ${opened}`);
  await page.waitForTimeout(2500);

  const hasPanel = await page.evaluate(() => Boolean(document.querySelector(".enhanced-graph-panel")));
  console.log(`panel present: ${hasPanel}`);
  if (!hasPanel) {
    await browser.close();
    return;
  }

  // Each panel is driven on its own. Clicking by label alone hits the first panel's
  // button every time, which made an earlier version of this probe report one panel
  // eight times and look like two.
  const panelCount = await page.evaluate(
    () => document.querySelectorAll(".enhanced-graph-panel").length,
  );
  console.log(`panels in the DOM: ${panelCount}\n`);

  for (let index = 0; index < panelCount; index += 1) {
    const labels = await page.evaluate((panelIndex) => {
      const panel = document.querySelectorAll(".enhanced-graph-panel")[panelIndex];
      if (!panel) return [];
      return [...panel.querySelectorAll(".enhanced-graph-panel-tabs button")].map(
        (button) => button.textContent ?? "",
      );
    }, index);
    if (labels.length === 0) continue;

    console.log(`########## panel ${index + 1} of ${panelCount} ##########`);
    for (const label of labels) {
      await page.evaluate(
        ({ panelIndex, text }) => {
          const panel = document.querySelectorAll(".enhanced-graph-panel")[panelIndex];
          const button = [...panel.querySelectorAll(".enhanced-graph-panel-tabs button")].find(
            (candidate) => (candidate.textContent ?? "").includes(text.replace(/\s*\(\d+\)\s*$/, "")),
          );
          button?.click();
        },
        { panelIndex: index, text: label },
      );
      await page.waitForTimeout(350);
      const measured = await page.evaluate(
        ({ panelIndex }) => {
          const panel = document.querySelectorAll(".enhanced-graph-panel")[panelIndex];
          if (!panel) return null;
          const panelStyle = getComputedStyle(panel);
          const cards = [...panel.querySelectorAll(".enhanced-graph-card")];
          return {
            panelWidth: Math.round(panel.getBoundingClientRect().width),
            client: panel.clientWidth,
            gutter: panel.offsetWidth - panel.clientWidth,
            scrollbarGutter: panelStyle.scrollbarGutter,
            padding: panelStyle.padding,
            flex: `${panelStyle.flexGrow} ${panelStyle.flexShrink} ${panelStyle.flexBasis}`,
            boxSizing: panelStyle.boxSizing,
            scrolls: panel.scrollHeight > panel.clientHeight,
            cardCount: cards.length,
            cardWidths: [
              ...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().width))),
            ].sort((a, b) => a - b),
          };
        },
        { panelIndex: index },
      );
      console.log(`  ${label.padEnd(14)} ${JSON.stringify(measured)}`);
    }
    console.log("");
  }

  await browser.close();
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
