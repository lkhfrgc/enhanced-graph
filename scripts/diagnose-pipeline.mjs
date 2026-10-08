/**
 * Walks the whole focus pipeline for one real pair of notes, in YOUR Obsidian.
 *
 * Everything upstream had been verified piece by piece — the path search against
 * brute force on the real graph, the adjacency being undirected, the link lookup
 * finding a graphics object on one side or the other — and the highlight was
 * still incomplete. What had never been checked is the ASSEMBLY: which pairs
 * `focusEdgePairs` actually produces, whether each maps to official ids, what
 * budget was applied, and what finally lands in `litEdges`.
 *
 * So this drives the focus itself rather than asking a person to, and prints each
 * stage, so the break shows up as a stage rather than as a guess.
 *
 * Usage:
 *   node scripts/diagnose-pipeline.mjs
 *
 * Quit Obsidian first: it refuses a second instance, and a running one has no
 * debug port to attach to.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "D:\\ToWrite\\obsidian\\Obsidian.exe";
let port = 9222;

const endpointAlive = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
};

const findFreePort = (preferred) => {
  const tryPort = (candidate) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(null));
      server.once("listening", () => {
        const address = server.address();
        const actual = typeof address === "object" && address ? address.port : candidate;
        server.close(() => resolve(actual));
      });
      server.listen(candidate, "127.0.0.1");
    });
  return tryPort(preferred).then((found) => found ?? tryPort(0));
};

if (!(await endpointAlive())) {
  const running = await new Promise((resolve) => {
    const probe = spawn("tasklist", ["/FI", "IMAGENAME eq Obsidian.exe"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    probe.stdout.on("data", (chunk) => (out += String(chunk)));
    probe.on("close", () => resolve(out));
    probe.on("error", () => resolve(""));
  });
  if (running.includes("Obsidian.exe")) {
    console.error("Obsidian is already running without a debug port. Quit it completely, then run again.");
    process.exit(1);
  }
  port = await findFreePort(port);
  console.log(`Starting Obsidian on debug port ${port} (your normal profile and vault)…`);
  const child = spawn(OBSIDIAN, [`--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await endpointAlive()) break;
  }
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
let page = context.pages().find((candidate) => candidate.url().startsWith("app://obsidian.md"));
// A closed page is not necessarily fatal: Obsidian can swap the page while the
// vault opens. Retry, and pick the page up again each time.
const waitForApp = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pages = context.pages().filter((candidate) => candidate.url().startsWith("app://obsidian.md"));
    for (const candidate of pages) {
      try {
        await candidate.waitForFunction(() => Boolean(window.app?.workspace), null, { timeout: 15000 });
        return candidate;
      } catch {
        /* try the next page, or wait and look again */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
};
page = await waitForApp();
if (!page) {
  console.error("Obsidian never presented a usable page. Nothing was read.");
  await browser.close();
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
await page.waitForTimeout(6000);

const pairArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (pairArgs.length) console.log("inspecting pair:", pairArgs.join("  <>  "));
await page.evaluate((pair) => {
  window.__DIAGNOSE_PAIR__ = pair;
}, pairArgs);

const report = await page.evaluate(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const app = window.app;
  const plugin = app.plugins.plugins["enhanced-graph"];
  const enhancer = plugin.officialGraph;
  const leaf = app.workspace.getLeavesOfType("graph").find((c) => c.view && c.view.renderer);
  const renderer = leaf.view.renderer;
  const lookup = renderer.nodeLookup ?? {};
  const ours = plugin.cached;

  // Our id -> official id, exactly as the collector builds it.
  const officialIdOf = new Map();
  for (const officialId of Object.keys(lookup)) {
    const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
    const node = ours.graph.nodeIndex.get(key);
    if (node) officialIdOf.set(node.id, officialId);
  }

  // The pair to inspect: given on the command line when the question is about
  // specific notes, otherwise any mappable edge — which tests the pipeline but
  // not the case under discussion.
  const wanted = window.__DIAGNOSE_PAIR__;
  let ids;
  if (Array.isArray(wanted) && wanted.length >= 1) {
    ids = wanted.slice(0, 2).map((name) => ours.graph.nodes.find((n) => n.id === name || n.label === name)?.id ?? name);
  } else {
    const fallback = ours.graph.edges.find(
      (edge) => officialIdOf.has(edge.source) && officialIdOf.has(edge.target),
    );
    if (!fallback) return { error: "no mappable edge found" };
    ids = [fallback.source, fallback.target];
  }
  const candidate = { source: ids[0], target: ids[1] };
  const unknown = ids.filter((id) => !ours.graph.nodeIndex.has(id));
  if (unknown.length) {
    return {
      error: "these ids are not in the plugin's graph",
      unknown,
      hint: "pass the note names as they appear in the vault",
      sampleIds: ours.graph.nodes.slice(0, 12).map((n) => n.id),
    };
  }

  const stages = { chosen: ids, officialIds: [officialIdOf.get(ids[0]), officialIdOf.get(ids[1])] };

  // Stage 1: what does the plugin think the budget is?
  stages.getFocusIntermediates = plugin.settings.focusMaxIntermediates;
  stages.focusIdsAfterFocus = enhancer.focusIds
    ? [...enhancer.focusIds.values()].map((set) => [...set])
    : null;
  stages.pathOptions = enhancer.pathOptions ? enhancer.pathOptions() : null;

  // Stage 2: run the focus the way the plugin does.
  //
  // NOT `focusNodes`: that one only sets `renderer.highlightNode`, which is the
  // renderer's own single-node hover highlight. Calling it left `focusIds`
  // empty, so `focusEdgePairs` returned nothing and the first run of this
  // diagnostic reported a break that was really its own mistake.
  // `focusNodeInGraph` is the one that writes `focusIds`.
  for (const id of ids) enhancer.focusNodeInGraph(id, leaf);
  await wait(1500);

  // Stage 3: the pairs it produced.
  let pairs = [];
  try {
    pairs = enhancer.focusEdgePairs(renderer) ?? [];
  } catch (error) {
    stages.focusEdgePairsThrew = String(error);
  }
  stages.pairCount = pairs.length;
  stages.pairs = pairs.slice(0, 30).map(([a, b]) => [a, b]);

  // Stage 4: per-pair resolution, exactly as collectLitEdges does it.
  stages.perPair = pairs.slice(0, 30).map(([a, b]) => {
    const from = officialIdOf.get(a);
    const to = officialIdOf.get(b);
    const forward = from ? lookup[from] : undefined;
    const backward = to ? lookup[to] : undefined;
    const link = forward?.forward?.[to] ?? backward?.forward?.[from];
    return {
      pair: [a, b],
      from: from ?? null,
      to: to ?? null,
      mapped: Boolean(from && to),
      onFromSide: Boolean(forward?.forward?.[to]),
      onToSide: Boolean(backward?.forward?.[from]),
      found: Boolean(link),
      hasLine: Boolean(link?.line),
    };
  });

  // Stage 5: what actually got collected and lit.
  const links = Array.isArray(renderer.links) ? renderer.links : [];
  let collected = null;
  try {
    const set = enhancer.collectLitEdges(renderer);
    collected = set ? set.size : null;
  } catch (error) {
    stages.collectThrew = String(error);
  }
  stages.collectedLitEdges = collected;

  // The pairs that produce no key, and WHY. "Four edges are missing" is not an
  // explanation until each one says which endpoint failed and whether that note
  // is visible in the built-in graph at all.
  {
    const dropped = [];
    for (const [a, b] of pairs) {
      const from = officialIdOf.get(a);
      const to = officialIdOf.get(b);
      if (from && to) continue;
      const missing = from ? b : a;
      const missingOfficial = from ? to : from;
      dropped.push({
        pair: [a, b],
        unmappedEndpoint: missing,
        theOtherOfficialId: (from ?? to) ?? null,
        // Is a node with this note's name present in nodeLookup under ANY id?
        presentInOfficialGraph: Object.keys(lookup).some((officialId) => {
          const key = officialId.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
          return key === missing || key.endsWith("/" + missing);
        }),
        hasOurNode: ours.graph.nodeIndex.has(missing),
        inOurGraph: Boolean(ours.graph.nodeIndex.get(missing)),
      });
    }
    stages.droppedPairs = dropped;
    stages.droppedCount = dropped.length;
  }

  // The decisive check: for every key that should be lit, is the graphics object
  // it resolves to actually one of the objects the render loop walks?
  //
  // `renderer.links` held 542 entries against 420 edges in our graph, so the two
  // collections are not the same set. A key whose object is absent from
  // `renderer.links` can never be given an alpha by the renderer, however
  // correct the key set is — and a route with such an edge in it lights up with
  // a gap in the middle.
  {
    const inLinks = new Set(links.map((link) => link?.line).filter(Boolean));
    let resolved = 0;
    let missingFromLinks = 0;
    const samples = [];
    for (const key of enhancer.litEdges.get(renderer) ?? []) {
      const [a, b] = key.split(":::");
      const link =
        lookup[a]?.forward?.[b] ??
        lookup[b]?.forward?.[a];
      const line = link?.line;
      if (!line) continue;
      resolved += 1;
      if (!inLinks.has(line)) {
        missingFromLinks += 1;
        if (samples.length < 6) samples.push({ key, note: "resolved but absent from renderer.links" });
      }
    }
    stages.litKeyResolution = {
      keys: enhancer.litEdges.get(renderer)?.size ?? 0,
      resolved,
      missingFromLinks,
      samples,
    };
  }
  stages.litEdgesMapSize = enhancer.litEdges ? [...enhancer.litEdges.values()].reduce((s, v) => s + v.size, 0) : null;

  // Stage 6: what the link objects' alpha actually is right now.
  // Every link, not the first forty: sampling 40 of 542 and reporting the count
  // as if it described the graph made the previous run look far worse than it
  // was, and would have done the same in the other direction.
  const alphas = links.map((link) => link?.line?.alpha).filter((a) => typeof a === "number");
  stages.linkCount = links.length;
  stages.alphasMeasured = alphas.length;
  stages.highAlphaCount = alphas.filter((a) => a > 0.9).length;
  stages.dimAlphaCount = alphas.filter((a) => a < 0.5).length;
  stages.alphaSample = alphas.slice(0, 12);

  // Stage 7: does the chosen edge itself appear among the pairs?
  const wantedEdge = [candidate.source, candidate.target];
  // Single-node focus: every incident edge should light. Count how many the
  // built-in graph has a graphics object for, and list those it does not — those
  // are the ones drawn only in the standalone view.
  if (ids.length === 1) {
    const node = ids[0];
    const incident = ours.graph.edges.filter((e) => e.source === node || e.target === node);
    let withLink = 0;
    const without = [];
    for (const edge of incident) {
      const other = edge.source === node ? edge.target : edge.source;
      const a = officialIdOf.get(node);
      const b = officialIdOf.get(other);
      if (!a || !b) {
        without.push({ other, reason: "endpoint absent from the built-in graph" });
        continue;
      }
      const link = lookup[a]?.forward?.[b] ?? lookup[b]?.forward?.[a];
      if (link?.line) withLink += 1;
      else without.push({ other, reason: "no graphics object in the built-in graph" });
    }
    // The other direction: lines the built-in graph draws FROM that node which
    // our graph has no edge for. Those can never be highlighted, and they look
    // exactly like "connected but not lit".
    const officialNode = officialIdOf.get(node);
    const extraLines = [];
    if (officialNode) {
      for (const otherOfficial of Object.keys(lookup[officialNode]?.forward ?? {})) {
        const key = otherOfficial.replace(/\\/g, "/").replace(/\.md$/i, "").toLowerCase();
        const ourOther = ours.graph.nodeIndex.get(key);
        if (!ourOther) {
          extraLines.push({ officialTarget: otherOfficial, reason: "not a note in our graph" });
          continue;
        }
        const hasEdge = ours.graph.edges.some(
          (e) =>
            (e.source === node && e.target === ourOther.id) ||
            (e.target === node && e.source === ourOther.id),
        );
        if (!hasEdge) extraLines.push({ officialTarget: otherOfficial, ourId: ourOther.id, reason: "our graph has no such edge" });
      }
    }
    // Are the lit EDGES' endpoints the same nodes as the lit NODES?
  //
  // The built-in graph drives a link's alpha from its endpoints' brightness, so a
  // lit edge whose endpoint node is dim is drawn dark no matter what we write to
  // \`line.alpha\`. If \`focusEdgePairs\` and \`focusSet\` disagree on the endpoint set,
  // that is the whole explanation for bright nodes sitting next to unlit lines.
  {
    const focus = enhancer.focusSet(renderer);
    const litNodes = focus ? new Set([...focus]) : new Set();
    const pairsForNode = pairs ?? [];
    const endpoints = new Set();
    for (const [a, b] of pairsForNode) {
      endpoints.add(a);
      endpoints.add(b);
    }
    const notBright = [...endpoints].filter((id) => !litNodes.has(id));
    const brightWithoutEdge = [...litNodes].filter((id) => id !== node && !endpoints.has(id));
    // The value the DRAW uses, not the value we write.
  //
  // PIXI composites \`worldAlpha\` — its own alpha multiplied by every ancestor
  // container's. Reading \`line.alpha\` says what WE set; reading \`worldAlpha\` says
  // what ends up on screen. If they disagree, something upstream is fading the
  // line and no amount of writing alpha here can fix it.
  {
    const rows = [];
    for (const link of links.slice(0, 600)) {
      const line = link?.line;
      if (!line) continue;
      rows.push({
        alpha: typeof line.alpha === "number" ? Math.round(line.alpha * 1000) / 1000 : null,
        worldAlpha: typeof line.worldAlpha === "number" ? Math.round(line.worldAlpha * 1000) / 1000 : null,
        visible: line.visible !== false,
        renderable: line.renderable !== false,
        parentAlpha: typeof line.parent?.worldAlpha === "number" ? line.parent.worldAlpha : null,
      });
    }
    // Who owns the value: us, or the render loop?
  //
  // Stop writing to \`line.alpha\` and watch. If the values drift back toward
  // something else, the render recomputes them every frame and our writes are
  // being overwritten — which would explain a bright node beside a dark line
  // while every write-side check passes.
  {
    const snapshot = () =>
      links
        .map((link) => link?.line?.alpha)
        .filter((a) => typeof a === "number");
    const before = snapshot();
    const tickerStopped = (() => {
      try {
        if (typeof enhancer.stopFocusTicker === "function") {
          enhancer.stopFocusTicker();
          return true;
        }
        return false;
      } catch (error) {
        return String(error);
      }
    })();
    await wait(2500);
    const after = snapshot();
    const moved = before.reduce(
      (sum, value, index) => sum + (Math.abs(value - (after[index] ?? value)) > 0.01 ? 1 : 0),
      0,
    );
    stages.ownership = {
      tickerStopped,
      valuesBefore: before.length,
      valuesAfter: after.length,
      valuesThatMovedWhileWeStopped: moved,
      beforeSample: before.slice(0, 8).map((v) => Math.round(v * 1000) / 1000),
      afterSample: after.slice(0, 8).map((v) => Math.round(v * 1000) / 1000),
      // What the renderer's own state looks like, for reference.
      highlightNode: renderer.highlightNode ? "set" : "null",
      lineColorAlpha: renderer.colors?.line?.a ?? null,
      lineHighlightAlpha: renderer.colors?.lineHighlight?.a ?? null,
    };
    // Put the ticker back so the rest of the report describes a live focus.
    try {
      enhancer.startFocusTicker?.();
    } catch {
      /* nothing to restart */
    }
  }

  stages.drawValues = {
      measured: rows.length,
      litByAlpha: rows.filter((r) => r.alpha !== null && r.alpha > 0.9).length,
      litByWorldAlpha: rows.filter((r) => r.worldAlpha !== null && r.worldAlpha > 0.9).length,
      invisible: rows.filter((r) => !r.visible).length,
      notRenderable: rows.filter((r) => !r.renderable).length,
      // A few of each, so the shape is visible rather than summarised.
      litSample: rows.filter((r) => r.alpha !== null && r.alpha > 0.9).slice(0, 5),
      dimSample: rows.filter((r) => r.alpha !== null && r.alpha < 0.5).slice(0, 5),
    };
  }

  stages.brightness = {
      litNodeCount: litNodes.size,
      edgeEndpointCount: endpoints.size,
      edgeEndpointNotBright: notBright.length,
      edgeEndpointNotBrightSample: notBright.slice(0, 10),
      brightNodeWithNoEdge: brightWithoutEdge.length,
      brightNodeWithNoEdgeSample: brightWithoutEdge.slice(0, 10),
      // Which official nodes actually get a bright colour written to them.
      nodeAlphas: (() => {
        const out = [];
        for (const officialId of Object.keys(lookup).slice(0, 0)) void officialId;
        return out;
      })(),
    };
  }

  stages.singleNode = {
      builtInLinesFromNode: officialNode ? Object.keys(lookup[officialNode]?.forward ?? {}).length : null,
      linesWithNoOurEdge: extraLines.length,
      lineExamples: extraLines.slice(0, 12),
      node,
      incidentEdges: incident.length,
      highlightable: withLink,
      notHighlightable: without.length,
      examples: without.slice(0, 10),
    };
  }

  // Sample over TIME, not once.
  //
  // Every earlier measurement read the state immediately after focusing, and
  // every one came back clean while the report kept saying edges were missing.
  // The likely difference is not what is measured but WHEN: if the highlight
  // decays — the ticker stopping, or a repaint resetting the alphas — a single
  // snapshot right after the focus cannot see it.
  {
    const series = [];
    for (let i = 0; i < 12; i += 1) {
      const now = Array.isArray(renderer.links) ? renderer.links : [];
      const values = now.map((link) => link?.line?.alpha).filter((a) => typeof a === "number");
      series.push({
        t: i * 2,
        lit: values.filter((a) => a > 0.9).length,
        dim: values.filter((a) => a < 0.5).length,
      });
      await wait(2000);
    }
    stages.timeSeries = series;
  // What is actually DRAWN. Every earlier check read the value written to
  // \`line.alpha\` and treated it as the result; whether the render honours that
  // value was never verified. A picture settles it without another inference.
  stages.screenshotTaken = true;
    stages.litFirst = series[0]?.lit ?? null;
    stages.litLast = series[series.length - 1]?.lit ?? null;
    stages.litMin = Math.min(...series.map((s) => s.lit));
    stages.litMax = Math.max(...series.map((s) => s.lit));
  }

  stages.edgeIsInPairs = pairs.some(
    ([a, b]) =>
      (a === wantedEdge[0] && b === wantedEdge[1]) || (a === wantedEdge[1] && b === wantedEdge[0]),
  );
  const paths = enhancer.findConnectingPathsFor
    ? null
    : null;
  stages.note = "paths computed inside focusEdgePairs; see edgeIsInPairs";
  void paths;

  return stages;
});

console.log("");
console.log("=== pipeline diagnostic ===");
console.log(JSON.stringify(report, null, 1));
const shot = path.join(os.tmpdir(), "enhanced-graph-focus.png");
try {
  await page.screenshot({ path: shot });
  console.log("screenshot: " + shot);
} catch (error) {
  console.log("screenshot failed: " + String(error));
}

const out = path.join(os.tmpdir(), "enhanced-graph-pipeline.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
console.log("");
console.log("saved to " + out);
console.log("Nothing was written to the vault.");
await browser.close();
process.exit(0);
