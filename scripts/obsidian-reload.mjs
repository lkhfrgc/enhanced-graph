/**
 * Reloads the plugin inside a running Obsidian, then re-measures.
 *
 * Closing the loop matters more than it sounds: every earlier fix in this sequence was
 * verified in the browser harness, which is Chromium but not Obsidian, and the one that
 * finally reproduced was found by attaching to the app. Being able to reload the plugin
 * and re-measure without asking the reader to do anything turns a round trip per
 * hypothesis into a loop that closes in seconds.
 *
 * Usage: node scripts/obsidian-reload.mjs [port] [pluginId]
 */

import { chromium } from "playwright-core";

const port = Number(process.argv[2] ?? 9222);
const pluginId = process.argv[3] ?? "enhanced-graph";

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes("index.html")) ?? pages[0];
  if (!page) throw new Error("no page to attach to");

  const result = await page.evaluate(async (id) => {
    const app = window.app;
    if (!app?.plugins) return "no app.plugins";
    const before = app.plugins.enabledPlugins?.has?.(id) ?? app.plugins.plugins?.[id] !== undefined;
    await app.plugins.disablePlugin(id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await app.plugins.enablePlugin(id);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const after = app.plugins.plugins?.[id] !== undefined;
    return { before, after };
  }, pluginId);

  console.log(`reload ${pluginId}: ${JSON.stringify(result)}`);
  await browser.close();
}

main().catch((error) => {
  console.error(`reload failed: ${error.message}`);
  process.exit(1);
});
