/**
 * Screenshots the official graph panel per group, for a visual check of a layout fix.
 *
 * The numbers say the cards match; a screenshot is what the reader actually judges, and
 * this sequence has already shown that a measurement can be right about the wrong
 * element. Both are needed before calling a layout defect fixed.
 *
 * Usage: node scripts/obsidian-shot.mjs [port] [outDir]
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const port = Number(process.argv[2] ?? 9222);
const outDir = path.resolve(process.argv[3] ?? path.join(process.cwd(), "harness", "obsidian"));
const LABELS = ["建议新增", "惊奇连接", "结构风险", "知识空白"];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes("index.html")) ?? pages[0];
  if (!page) throw new Error("no page to attach to");

  for (const label of LABELS) {
    await page.evaluate((text) => {
      const panels = [...document.querySelectorAll(".enhanced-graph-official-panel")];
      const panel = panels.find((candidate) => candidate.getBoundingClientRect().width > 0);
      const button = [...(panel?.querySelectorAll(".enhanced-graph-button") ?? [])].find((candidate) =>
        (candidate.textContent ?? "").includes(text),
      );
      button?.click();
    }, label);
    await page.waitForTimeout(500);

    // The panel alone, so the two widths can be compared without the graph around them.
    const handle = await page.evaluateHandle(() => {
      const panels = [...document.querySelectorAll(".enhanced-graph-official-panel")];
      return panels.find((candidate) => candidate.getBoundingClientRect().width > 0) ?? null;
    });
    const element = handle.asElement();
    if (!element) {
      console.log(`${label}: no visible panel`);
      continue;
    }
    const file = path.join(outDir, `official-panel-${LABELS.indexOf(label) + 1}.png`);
    await element.screenshot({ path: file });
    const box = await element.boundingBox();
    console.log(`${label}: ${box?.width}x${box?.height} -> ${file}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(`shot failed: ${error.message}`);
  process.exit(1);
});
