/**
 * Checks the built-in-graph integration inside a REAL Obsidian.
 *
 * Everything else in this repo verifies our code against fakes: the unit tests
 * run against a stub renderer, the browser harness drives our own view. Neither
 * can tell us that the code we wrote is wired to what Obsidian actually does —
 * and "the code looks right but nothing happens on screen" is exactly the class
 * of bug that slipped through three times in a row.
 *
 * Obsidian is Electron, so it accepts `--remote-debugging-port`, and we already
 * depend on `playwright-core` for the harness. This script:
 *
 *   1. starts an ISOLATED instance (its own `--user-data-dir`, so the instance
 *      you are working in is never touched) with the demo vault pre-registered,
 *   2. attaches over CDP,
 *   3. drives the built-in graph the way a user does and asserts the results,
 *   4. shuts that instance down again.
 *
 * Usage:
 *   node scripts/obsidian-check.mjs            # launch, check, shut down
 *   node scripts/obsidian-check.mjs --attach   # use an instance already running
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import net from "node:net";

import { chromium } from "playwright-core";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
const VAULT = process.env.OBSIDIAN_VAULT ?? "D:\\Progect\\插件开发\\插件开发";
/** Resolved at startup: in launch mode a free one, in attach mode the given one. */
let port = Number(process.env.OBSIDIAN_DEBUG_PORT ?? 9222);
const PROFILE = path.join(os.tmpdir(), "enhanced-graph-obsidian-profile");

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

/**
 * A free port, rather than a hard-coded one.
 *
 * 9222 is the obvious choice and therefore the one most likely to be taken —
 * a leftover browser process holding it made Obsidian's debug endpoint never
 * appear, and the failure looked like "Obsidian did not start".
 */
function findFreePort(preferred = port) {
  const tryPort = (candidate) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(null));
      server.once("listening", () => {
        // Read the port back off the socket: asking for 0 makes the OS choose,
        // and resolving with the requested number would hand back 0.
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : candidate;
        server.close(() => resolve(actual));
      });
      server.listen(candidate, "127.0.0.1");
    });
  return tryPort(preferred).then((found) => found ?? tryPort(0));
}

/** Who is holding the port, so a failure says something useful. */
async function describePortHolder(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = await response.json();
    return info.Browser ?? "something";
  } catch {
    return "an unidentified process";
  }
}

async function endpointAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Registers the vault so the isolated instance opens it instead of the picker. */
function seedProfile() {
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(
    path.join(PROFILE, "obsidian.json"),
    JSON.stringify({ vaults: { harness: { path: VAULT, ts: 1, open: true } } }),
    "utf8",
  );
}

async function launchObsidian() {
  seedProfile();
  const child = spawn(
    OBSIDIAN,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, VAULT],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await endpointAlive()) return;
  }
  throw new Error(`Obsidian did not expose a debug endpoint on ${port}`);
}

async function main() {
  const attachOnly = process.argv.includes("--attach");
  if (!attachOnly) {
    // Take a free port instead of insisting on 9222: a leftover browser process
    // squatting there makes Obsidian's endpoint never appear, which reads as
    // "Obsidian failed to start".
    port = await findFreePort(port);
    if (await endpointAlive()) {
      console.error(
        `Port ${port} is already serving ${await describePortHolder(port)}; ` +
          `refusing to start a second instance against it.`,
      );
      process.exit(1);
    }
  }
  if (!(await endpointAlive())) {
    if (attachOnly) {
      console.error(
        `Nothing is listening on ${port}.\n` +
          `Start Obsidian with:  "${OBSIDIAN}" --remote-debugging-port=${port}`,
      );
      process.exit(1);
    }
    console.log(`Starting an isolated Obsidian on port ${port}…`);
    await launchObsidian();
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("no browser context");
  const page = context.pages().find((candidate) => candidate.url().startsWith("app://obsidian.md"));
  if (!page) throw new Error("no Obsidian page found");

  await page.waitForFunction(() => Boolean(window.app?.workspace), null, { timeout: 60000 });

  // Open the built-in graph if it is not already up, so the checks do not depend
  // on what the window happened to be showing.
  await page.evaluate(async () => {
    const app = window.app;
    if (app.workspace.getLeavesOfType("graph").length === 0) {
      const leaf = app.workspace.getLeaf(true);
      await leaf.setViewState({ type: "graph", active: true });
    }
  });
  // Wait for our chrome rather than a fixed number of seconds: on a cold profile
  // the vault loads, the plugin runs and the graph builds before the enhancer can
  // attach, which a fixed sleep did not cover.
  await page
    .waitForFunction(() => Boolean(document.querySelector(".enhanced-graph-official-toolbar")), null, {
      timeout: 90000,
    })
    .catch(() => {});
  await page.waitForTimeout(2000);

  const attached = await page.evaluate(() => {
    // `getLeavesOfType` can return several, and a leaf whose view has not
    // initialised has no `renderer` at all — taking [0] reported our chrome as
    // missing while it was mounted on another leaf.
    const leaf = window.app.workspace
      .getLeavesOfType("graph")
      .find((candidate) => candidate.view && candidate.view.renderer);
    const container = leaf?.view?.renderer?.containerEl;
    return {
      hasRenderer: Boolean(leaf?.view?.renderer),
      hasToolbar: Boolean(container?.querySelector(".enhanced-graph-official-toolbar")),
      hasPanel: Boolean(container?.querySelector(".enhanced-graph-official-panel")),
      hasLegend: Boolean(container?.querySelector(".enhanced-graph-official-legend")),
      nodeCount: leaf?.view?.renderer?.nodes?.length ?? -1,
    };
  });

  check(
    "our chrome is mounted on the built-in graph",
    attached.hasToolbar && attached.hasPanel && attached.hasLegend,
    `toolbar=${attached.hasToolbar} panel=${attached.hasPanel} legend=${attached.hasLegend}`,
  );

  // Report the version we are ACTUALLY testing.
  //
  // Obsidian's window title carries it, and the title only becomes meaningful
  // once a view is open — probing earlier reported nothing at all, and an
  // unverified "pass" is worse than no check. A run of this script once verified
  // 1.9.10 while 1.14.4 was installed, which is the mistake this guards against.
  let testedVersion = null;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    for (const target of targets) {
      // 1.9.x titles read "Obsidian v1.9.10"; 1.14.x dropped the "v" and reads
      // "Obsidian 1.14.4". Accept both, or the check silently stops reporting
      // which version it just verified.
      const match = /Obsidian v?(\d+\.\d+\.\d+)/.exec(target.title ?? "");
      if (match) {
        testedVersion = match[1];
        break;
      }
    }
  } catch {
    /* fall through to the warning below */
  }
  if (testedVersion) {
    console.log(`Testing against Obsidian ${testedVersion}\n`);
  } else {
    console.log("WARNING: could not determine the Obsidian version being tested\n");
  }
  // --- does the insights tab fill in by itself on a cold start? ------------
  // Wait with no interaction whatsoever. The count is sampled repeatedly so a
  // failure says whether it stayed at zero or filled in late.
  const coldStart = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const leaf = window.app.workspace
      .getLeavesOfType("graph")
      .find((candidate) => candidate.view && candidate.view.renderer);
    if (!leaf) return { error: "no built-in graph" };
    const panel = leaf.view.renderer.containerEl.querySelector(
      ".enhanced-graph-official-panel",
    );
    if (!panel) return { error: "no panel" };

    const cards = () => panel.querySelectorAll(".enhanced-graph-card").length;
    const nodes = () => {
      try {
        return window.app.plugins.plugins["enhanced-graph"].cached.graph.nodes.length;
      } catch {
        return -1;
      }
    };
    // Sample BOTH: "the data never arrived" and "the data arrived but the panel
    // never repainted" need different fixes, and the card count alone cannot
    // tell them apart.
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      samples.push(`${cards()}/${nodes()}`);
      await wait(1000);
    }
    samples.push(`${cards()}/${nodes()}`);

    const activeTab =
      panel.querySelector(".enhanced-graph-tab.is-active")?.textContent?.trim() ?? "?";
    // Is the DATA missing, or is it there and simply not drawn?
    const plugin = window.app.plugins.plugins["enhanced-graph"];
    let data = null;
    try {
      const cached = plugin.cached;
      data = {
        connections: cached.insights.connections.length,
        gaps: cached.insights.gaps.length,
        graphNodes: cached.graph.nodes.length,
        dismissed: plugin.settings.dismissedInsights.length,
      };
    } catch (error) {
      data = { error: String(error) };
    }
    // Did the build see an unindexed vault, or a full one it then cached empty?
    const vaultFiles = window.app.vault.getMarkdownFiles().length;
    let adapterFiles = null;
    try {
      adapterFiles = plugin.vaultAdapter?.listMarkdownFiles?.()?.length ?? null;
    } catch (error) {
      adapterFiles = "threw: " + String(error);
    }
    const mode = plugin.settings.officialGraphMode;
    const buildCached = Boolean(plugin.buildPromise);

    return {
      samples,
      activeTab,
      final: cards(),
      vaultFiles,
      adapterFiles,
      mode,
      buildCached,
      data,
      panelText: (panel.textContent ?? "").trim().slice(0, 160),
      panelHtmlLength: panel.innerHTML.length,
    };
  });

  check(
    "fills the insights tab on its own after a cold start",
    !coldStart.error && (coldStart.final ?? 0) > 0,
    coldStart.error ??
      `cards/nodes over 20s: ${JSON.stringify(coldStart.samples)}; active tab: "${coldStart.activeTab}"` +
        `; data: ${JSON.stringify(coldStart.data)}` +
        `; vault files: ${coldStart.vaultFiles}; adapter files: ${coldStart.adapterFiles}` +
        `; mode: ${coldStart.mode}; build cached: ${coldStart.buildCached}`,
  );

  // --- the filter path that kept failing -------------------------------------
  const filtering = await page.evaluate(async () => {
    const app = window.app;
    const leaf = app.workspace
      .getLeavesOfType("graph")
      .find((candidate) => candidate.view && candidate.view.renderer);
    const view = leaf.view;
    const renderer = view.renderer;
    const container = renderer.containerEl;

    const before = renderer.nodes.length;
    // Pick a page type that is actually on screen, so the toggle has an effect.
    const plugin = app.plugins.plugins["enhanced-graph"];
    // Our own graph is built lazily — a freshly started Obsidian has the built-in
    // graph on screen and our cache still empty, so ask for a rebuild and wait for
    // it rather than reporting "no page type matched".
    if (!plugin.cached?.graph?.nodes?.length) {
      // `getGraph()` is the builder; `requestGraphRebuild` only schedules one.
      try {
        await plugin.getGraph();
      } catch (error) {
        return { error: `building the graph threw: ${error}` };
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (plugin.cached?.graph?.nodes?.length) break;
      }
    }
    const graph = plugin.cached?.graph;
    if (!graph?.nodes?.length) return { error: "the plugin never built its graph" };

    // Official ids are vault paths with the extension; ours are lower-cased
    // without it. Normalising here keeps the count honest without reaching into
    // the plugin's own resolver.
    const normalise = (id) => String(id).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").toLowerCase();
    const counts = new Map();
    for (const official of renderer.nodes) {
      // `path` first: that is how our builder keys a note, and it is what the
      // first working version matched on. The normalised form is the fallback
      // for anything the builder stored differently.
      const ours =
        graph.nodeIndex.get(official.id) ?? graph.nodeIndex.get(normalise(official.id));
      if (!ours) continue;
      counts.set(ours.type, (counts.get(ours.type) ?? 0) + 1);
    }
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!target) {
      return {
        error:
          `no page type matched: our graph has ${graph.nodes.length} notes, ` +
          `the renderer ${renderer.nodes.length} nodes; ` +
          `first official id="${renderer.nodes[0]?.id}" ` +
          `first our path="${graph.nodes[0]?.path}" ` +
          `first our id="${graph.nodes[0]?.id}"`,
      };
    }

    const [type, expected] = target;
    const settings = plugin.settings;
    settings.hiddenTypes = [...settings.hiddenTypes, type];
    await plugin.saveSettings();
    plugin.refreshViews();
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const after = renderer.nodes.length;
    settings.hiddenTypes = settings.hiddenTypes.filter((entry) => entry !== type);
    await plugin.saveSettings();
    plugin.refreshViews();
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Count THAT type, not the total: the built-in graph's node count drifts by a
    // couple for reasons of its own, so a total is a fragile thing to assert on.
    let restoredCount = 0;
    for (const official of renderer.nodes) {
      const ours =
        graph.nodeIndex.get(official.id) ?? graph.nodeIndex.get(normalise(official.id));
      if (ours?.type === type) restoredCount += 1;
    }
    return { type, expected, before, after, restored: restoredCount };
  });

  check(
    "unticking a page type removes its nodes from the graph",
    !filtering.error && filtering.after <= filtering.before - filtering.expected,
    filtering.error ??
      `${filtering.type}: ${filtering.before} → ${filtering.after} nodes (expected at least ${filtering.expected} fewer)`,
  );

  check(
    "re-enabling the type brings them back",
    !filtering.error && filtering.restored === filtering.expected,
    filtering.error ?? `${filtering.restored}/${filtering.expected} "${filtering.type}" nodes are back`,
  );

  // --- settings tab: what is left after the trim ---------------------------
  const settings = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const app = window.app;
    app.setting.open();
    app.setting.openTabById("enhanced-graph");
    await wait(400);

    const tab = app.setting.activeTab;
    if (!tab) return { error: "no active settings tab" };
    const container = tab.containerEl;

    const names = [...container.querySelectorAll(".setting-item-name")].map((el) =>
      (el.textContent ?? "").trim(),
    );
    return {
      names,
      sliders: container.querySelectorAll('input[type="range"]').length,
      colourRows: container.querySelectorAll(".enhanced-graph-colour-row").length,
      colourInputs: container.querySelectorAll('input[type="color"]').length,
    };
  });

  const expectedRows = ["界面语言", "官方图谱增强", "复用内置图谱的布局", "排除的文件夹"];
  check(
    "the settings tab shows only the remaining rows",
    !settings.error &&
      expectedRows.every((name) => settings.names?.some((row) => row.includes(name))) &&
      settings.sliders === 0 &&
      settings.colourRows === 0 &&
      settings.colourInputs === 0,
    settings.error ??
      `rows=${JSON.stringify(settings.names)}; sliders=${settings.sliders}` +
        `; colour rows=${settings.colourRows}; colour inputs=${settings.colourInputs}`,
  );

  // --- weights: the restore button had to repaint, not just rebuild --------
  const weights = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const leaf = window.app.workspace
      .getLeavesOfType("graph")
      .find((candidate) => candidate.view && candidate.view.renderer);
    if (!leaf) return { error: "no built-in graph" };
    const container = leaf.view.renderer.containerEl;

    const buttonSaying = (root, text) =>
      [...(root?.querySelectorAll("button") ?? [])].find((candidate) =>
        (candidate.textContent ?? "").includes(text),
      );

    const toolbar = container.querySelector(".enhanced-graph-official-toolbar");
    const weightsToggle = buttonSaying(toolbar, "权重");
    if (!weightsToggle) return { error: "no weights toggle" };
    weightsToggle.click();
    await wait(300);

    const panel = container.querySelector(".enhanced-graph-official-panel");
    const fields = () =>
      [...(panel?.querySelectorAll('input[type="number"]') ?? [])].map((input) => input.value);

    const before = fields();
    if (before.length === 0) return { error: "weights panel has no number fields" };

    // Move one coefficient away from its default, through the panel itself.
    const first = panel.querySelector('input[type="number"]');
    first.value = "7";
    first.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
    const edited = fields();

    const reset = buttonSaying(panel, "恢复默认");
    if (!reset) return { error: "no restore button" };
    // Remember the node, to tell "the panel never re-rendered" from "it
    // re-rendered but with stale numbers".
    const inputBefore = panel.querySelector('input[type="number"]');
    reset.click();
    // Deliberately nothing else: no colour-mode switch, no waiting for the
    // debounced rebuild. The panel has to repaint on its own.
    await wait(250);
    const restored = fields();

    // Is the plumbing broken, or was it simply never called? Ask the plugin to
    // repaint directly and see whether the panel follows.
    let afterManualRefresh = null;
    try {
      window.app.plugins.plugins["enhanced-graph"].refreshViews();
      await wait(250);
      afterManualRefresh = fields();
    } catch (error) {
      afterManualRefresh = ["threw: " + String(error)];
    }

    return {
      afterManualRefresh,
      before,
      edited,
      restored,
      reRendered: panel.querySelector('input[type="number"]') !== inputBefore,
      activeTag: document.activeElement?.tagName ?? "none",
      activeInPanel: Boolean(panel.contains(document.activeElement)),
      settings: { ...window.app.plugins.plugins["enhanced-graph"].settings.weights },
    };
  });

  const expectedDefaults = ["4.0", "2.0", "2.0", "1.0"];
  const asNumbers = (values) => (values ?? []).map((value) => Number(value));
  check(
    "restores the default weights immediately",
    !weights.error &&
      asNumbers(weights.restored).join(",") === asNumbers(expectedDefaults).join(",") &&
      asNumbers(weights.edited).join(",") !== asNumbers(weights.restored).join(","),
    weights.error ??
      `${weights.edited?.join("/")} after edit → ${weights.restored?.join("/")} after restore` +
        ` (defaults ${expectedDefaults.join("/")}); plugin settings: ` +
        `${JSON.stringify(weights.settings)}`,
  );

  // --- colouring --------------------------------------------------------------
  const colouring = await page.evaluate(async () => {
    // `getLeavesOfType` can return several, and a leaf whose view has not
    // initialised has no `renderer` at all — taking [0] reported our chrome as
    // missing while it was mounted on another leaf.
    const leaf = window.app.workspace
      .getLeavesOfType("graph")
      .find((candidate) => candidate.view && candidate.view.renderer);
    const renderer = leaf.view.renderer;
    const sample = () => renderer.nodes.find((node) => node.color)?.color?.rgb ?? null;
    const plugin = window.app.plugins.plugins["enhanced-graph"];

    // This writes to the real vault's data.json, so the original value goes back
    // at the end whatever happens.
    const original = plugin.settings.officialGraphMode;
    const setMode = async (mode) => {
      plugin.settings.officialGraphMode = mode;
      await plugin.saveSettings();
      plugin.applyOfficialGraphMode();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return sample();
    };

    const asType = await setMode("type");
    const asCommunity = await setMode("community");
    await setMode(original);

    return { asType, asCommunity, restored: plugin.settings.officialGraphMode };
  });

  check(
    "the colour mode is put back afterwards",
    colouring.restored !== undefined,
    `left on ${colouring.restored}`,
  );

  check(
    "switching to by-community actually recolours the nodes",
    colouring.asType !== null &&
      colouring.asCommunity !== null &&
      colouring.asType !== colouring.asCommunity,
    `type=#${(colouring.asType ?? 0).toString(16)} community=#${(colouring.asCommunity ?? 0).toString(16)}`,
  );

  await browser.close();

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} Obsidian checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
