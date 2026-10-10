/**
 * Opens the built-in graph with the plugin's overlay and measures the insight panel there.
 *
 * The reader's screenshots are of the *official* graph, not the standalone view, and the
 * two are different panels in different containers: the standalone one is a flex row
 * beside a canvas, the official one floats inside an absolutely-positioned overlay with
 * the legend and toolbar. A measurement of one says nothing about the other, which is how
 * an earlier probe reported "all four groups 291px" while the reader still saw a
 * difference.
 *
 * Usage: node scripts/obsidian-probe-official.mjs [port]
 */

import { chromium } from "playwright-core";

const port = Number(process.argv[2] ?? 9222);

const LABELS = ["建议新增", "惊奇连接", "结构风险", "知识空白"];

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes("index.html")) ?? pages[0];
  if (!page) throw new Error("no page to attach to");

  // Open the built-in graph leaf if it is not already there: `graph:open` is Obsidian's
  // own command, which is what the reader's click runs.
  const graphOpened = await page.evaluate(async () => {
    const app = window.app;
    const alreadyOpen = [...app.workspace.getLeavesOfType("graph")].length > 0;
    if (alreadyOpen) return "already open";
    const command = app?.commands?.commands?.["graph:open"];
    if (!command) return "graph:open not found";
    command.callback();
    return "ok";
  });
  console.log(`graph leaf: ${graphOpened}`);
  await page.waitForTimeout(3000);

  // The overlay toggle is stateful, so ask first and only run it when the panel is
  // absent. Running it blind flips an open overlay closed and makes the next probe
  // report "not in the DOM" for a reason that has nothing to do with the layout.
  const overlayState = await page.evaluate(() => {
    const app = window.app;
    const ids = ["enhanced-graph:toggle-official-graph"];
    const command = app?.commands?.commands?.[ids[0]];
    const presentBefore = document.querySelectorAll(".enhanced-graph-official-panel").length;
    if (presentBefore === 0 && command) command.callback();
    return { presentBefore, ran: presentBefore === 0 && Boolean(command) };
  });
  console.log(`overlay: ${JSON.stringify(overlayState)}`);
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    official: document.querySelectorAll(".enhanced-graph-official-panel").length,
    insight: document.querySelectorAll(".enhanced-graph-panel").length,
    officialCards: document.querySelectorAll(".enhanced-graph-official-panel .enhanced-graph-card").length,
    tabs: [...document.querySelectorAll(".enhanced-graph-official-panel .enhanced-graph-button")]
      .map((b) => b.textContent ?? "")
      .slice(0, 8),
  }));
  console.log(JSON.stringify(state, null, 2));
  console.log("");

  if (state.official === 0) {
    console.log("the official panel is not in the DOM; nothing to measure");
    await browser.close();
    return;
  }

  // Pick the panel the reader can actually see. Two exist — the built-in graph may have
  // more than one leaf, and a hidden one measures zero — so driving `querySelector`
  // reports a 0px panel while the visible one is right there.
  const visible = await page.evaluate(() => {
    const panels = [...document.querySelectorAll(".enhanced-graph-official-panel")];
    return panels.map((panel, index) => ({
      index,
      width: Math.round(panel.getBoundingClientRect().width),
      cards: panel.querySelectorAll(".enhanced-graph-card").length,
    }));
  });
  console.log(`official panels: ${JSON.stringify(visible)}`);
  const target = visible.find((entry) => entry.width > 0);
  if (!target) {
    console.log("no visible official panel; nothing to measure");
    await browser.close();
    return;
  }
  console.log(`measuring panel index ${target.index} (${target.width}px)\n`);

  for (const label of LABELS) {
    await page.evaluate(
      ({ panelIndex, text }) => {
        const panel = [...document.querySelectorAll(".enhanced-graph-official-panel")][panelIndex];
        const button = [...panel.querySelectorAll(".enhanced-graph-button")].find((candidate) =>
          (candidate.textContent ?? "").includes(text),
        );
        button?.click();
      },
      { panelIndex: target.index, text: label },
    );
    await page.waitForTimeout(400);

    const measured = await page.evaluate((panelIndex) => {
      const panel = [...document.querySelectorAll(".enhanced-graph-official-panel")][panelIndex];
      if (!panel) return null;
      const panelStyle = getComputedStyle(panel);
      const cards = [...panel.querySelectorAll(".enhanced-graph-card")];
      const box = panel.getBoundingClientRect();
      const host = panel.parentElement;
      const hostStyle = host ? getComputedStyle(host) : null;
      return {
        panelWidth: Math.round(box.width),
        panelClient: panel.clientWidth,
        gutter: panel.offsetWidth - panel.clientWidth,
        scrollbarGutter: panelStyle.scrollbarGutter,
        padding: panelStyle.padding,
        boxSizing: panelStyle.boxSizing,
        minWidth: panelStyle.minWidth,
        maxWidth: panelStyle.maxWidth,
        width: panelStyle.width,
        scrolls: panel.scrollHeight > panel.clientHeight,
        hostWidth: host ? Math.round(host.getBoundingClientRect().width) : null,
        hostDisplay: hostStyle?.display ?? null,
        hostAlignItems: hostStyle?.alignItems ?? null,
        cardCount: cards.length,
        cardWidths: [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().width)))].sort(
          (a, b) => a - b,
        ),
      };
    }, target.index);
    console.log(`${label.padEnd(14)} ${JSON.stringify(measured)}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
