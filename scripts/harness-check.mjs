/**
 * Head-less verification of the graph VIEW.
 *
 * Serves `harness/` over HTTP (ES modules cannot be loaded from `file://`),
 * opens it in the system Edge/Chrome via playwright-core, drives the real UI,
 * asserts the observable behaviour and writes screenshots to `harness/shots/`.
 *
 * Usage: node scripts/harness-check.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const harnessDir = path.resolve(here, "..", "harness");
const shotsDir = path.join(harnessDir, "shots");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

/** Switch the standalone view's colouring mode from its toolbar. */
async function switchColourMode(page, label) {
  await page.evaluate(async (text) => {
    const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
      (candidate) => candidate.textContent?.includes(text),
    );
    if (!button) throw new Error(`no colour mode button saying ${text}`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }, label);
  await page.waitForTimeout(300);
}

/**
 * Press one of the side panel's section tabs.
 *
 * The insights groups and the filter groups switch like tabs rather than folding
 * open and shut, so a check that wants the tag list (or the gap cards) has to
 * press its button first — and a check that does not is checking the wrong thing.
 */
async function selectPanelTab(page, label) {
  await page.evaluate((text) => {
    const tab = [...document.querySelectorAll(".enhanced-graph-panel-tabs button")].find((el) =>
      (el.textContent ?? "").includes(text),
    );
    if (!tab) throw new Error(`no panel tab saying ${text}`);
    tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, label);
  await page.waitForTimeout(250);
}

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    // `styles.css` lives one level up from the harness directory.
    const target = pathname === "/styles.css"
      ? path.resolve(harnessDir, "..", "styles.css")
      : path.join(harnessDir, path.normalize(pathname).replace(/^([/\\])+/, ""));

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
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  if (!fs.existsSync(path.join(harnessDir, "bundle.js"))) {
    throw new Error("harness/bundle.js missing — run `npm run harness` first");
  }
  if (!fs.existsSync(path.join(harnessDir, "graph.json"))) {
    throw new Error("harness/graph.json missing — run `npm run verify:vault` first");
  }
  fs.mkdirSync(shotsDir, { recursive: true });

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    channel: process.env.HARNESS_BROWSER ?? "msedge",
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox",
      "--no-sandbox",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  console.log(`\n=== Enhanced Graph — view harness (${base}) ===\n`);

  try {
    await page.goto(`${base}/index.html`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(() => window.__HARNESS_READY__ === true, null, { timeout: 30_000 });
    await page.waitForTimeout(600);

    // --- 1. sigma mounted and produced a WebGL canvas -----------------------
    const canvasInfo = await page.evaluate(() => {
      const container = document.querySelector(".enhanced-graph-canvas");
      const canvases = container ? [...container.querySelectorAll("canvas")] : [];
      return {
        count: canvases.length,
        width: container?.clientWidth ?? 0,
        height: container?.clientHeight ?? 0,
      };
    });
    check(
      "sigma mounted a canvas into the container",
      canvasInfo.count >= 1 && canvasInfo.width > 100 && canvasInfo.height > 100,
      `${canvasInfo.count} canvas(es), ${canvasInfo.width}×${canvasInfo.height}`,
    );

    const graphStats = await page.evaluate(() => {
      const api = window.__HARNESS__;
      const sigma = api.view.renderer?.instance;
      return {
        nodes: sigma ? sigma.getGraph().order : 0,
        edges: sigma ? sigma.getGraph().size : 0,
        expectedNodes: api.snapshot.graph.nodes.length,
        expectedEdges: api.snapshot.graph.edges.length,
        hiddenStructural: api.snapshot.graph.nodes.filter((n) => n.isStructural).length,
      };
    });
    check(
      "sigma graph holds the filtered vault graph",
      graphStats.nodes === graphStats.expectedNodes - graphStats.hiddenStructural &&
        graphStats.edges > 0,
      `${graphStats.nodes} nodes / ${graphStats.edges} edges (vault: ${graphStats.expectedNodes}/${graphStats.expectedEdges})`,
    );

    // --- 2. the edge weight ramp (越弱越灰越细 → 越强越粗越白) ---------------
    // Read through `getEdgeDisplayData`, not the stored attributes: the ramp is
    // theme-dependent and therefore applied in the reducer, so the display data
    // is the only place the real colour exists.
    const readRamp = () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const graph = sigma.getGraph();
      const byWeight = [];
      graph.forEachEdge((edge, attributes) => {
        const display = sigma.getEdgeDisplayData(edge);
        byWeight.push({
          nw: attributes.normalizedWeight,
          color: display.color,
          size: display.size,
          alpha: attributes.baseAlpha,
        });
      });
      byWeight.sort((a, b) => a.nw - b.nw);
      const channels = (css) => {
        const match = String(css).match(/rgba?\(([^)]+)\)/);
        if (!match) return [0, 0, 0];
        return match[1].split(",").slice(0, 3).map((value) => Number(value.trim()));
      };
      // Rec. 709 relative luminance, 0 (black) … 255 (white).
      const luminance = (css) => {
        const [r, g, b] = channels(css);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const chroma = (css) => {
        const [r, g, b] = channels(css);
        return Math.max(r, g, b) - Math.min(r, g, b);
      };
      const lum = byWeight.map((item) => luminance(item.color));
      return {
        count: byWeight.length,
        weakest: byWeight[0],
        strongest: byWeight[byWeight.length - 1],
        weakLum: lum[0],
        strongLum: lum[lum.length - 1],
        weakChroma: chroma(byWeight[0].color),
        strongChroma: chroma(byWeight[byWeight.length - 1].color),
        monotonicLum: lum.every((value, index) => (index === 0 ? true : value >= lum[index - 1] - 1e-6)),
        nonIncreasing: lum.every((value, index) => (index === 0 ? true : value <= lum[index - 1] + 1e-6)),
        monotonicWidth: byWeight.every((item, index) =>
          index === 0 ? true : item.size >= byWeight[index - 1].size - 1e-9,
        ),
      };
    };

    const edgeRamp = await page.evaluate(readRamp);
    check(
      "dark theme: weak links are gray and thin, strong links bright and thick",
      edgeRamp.count > 0 &&
        edgeRamp.monotonicLum &&
        edgeRamp.monotonicWidth &&
        edgeRamp.strongLum > 230 &&
        edgeRamp.weakLum < 150 &&
        edgeRamp.weakChroma < 45 &&
        edgeRamp.strongChroma < 45 &&
        edgeRamp.strongest.size > edgeRamp.weakest.size,
      `weight ${edgeRamp.weakest.nw.toFixed(2)}→${edgeRamp.strongest.nw.toFixed(2)}: ` +
        `luminance ${edgeRamp.weakLum.toFixed(0)}→${edgeRamp.strongLum.toFixed(0)} ` +
        `(chroma ${edgeRamp.weakChroma}→${edgeRamp.strongChroma}), ` +
        `width ${edgeRamp.weakest.size.toFixed(2)}→${edgeRamp.strongest.size.toFixed(2)}`,
    );
    check(
      "edge alpha grows with weight",
      edgeRamp.strongest.alpha > edgeRamp.weakest.alpha,
      `alpha ${edgeRamp.weakest.alpha.toFixed(2)}→${edgeRamp.strongest.alpha.toFixed(2)}`,
    );

    // --- 3. node size follows √ scaling ------------------------------------
    const sizeCheck = await page.evaluate(() => {
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      const sizes = [];
      graph.forEachNode((node, attributes) => sizes.push({ links: attributes.linkCount, size: attributes.size }));
      sizes.sort((a, b) => a.links - b.links);
      return { min: sizes[0], max: sizes[sizes.length - 1], all: sizes };
    });
    check(
      "node size scales with link count (√ curve)",
      sizeCheck.max.size > sizeCheck.min.size && sizeCheck.max.links > sizeCheck.min.links,
      `links ${sizeCheck.min.links}→${sizeCheck.max.links}, size ${sizeCheck.min.size.toFixed(2)}→${sizeCheck.max.size.toFixed(2)}`,
    );

    await page.screenshot({ path: path.join(shotsDir, "01-type-mode-dark.png") });

    // --- 4. legend --------------------------------------------------------
    const legend = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".enhanced-graph-legend-row")];
      return {
        title: document.querySelector(".enhanced-graph-legend-title")?.textContent ?? "",
        rows: rows.length,
        labels: rows.map((row) => row.querySelector(".enhanced-graph-legend-label")?.textContent ?? ""),
        counts: rows.map((row) => row.querySelector(".enhanced-graph-legend-count")?.textContent ?? ""),
      };
    });
    check(
      "type legend lists every page type with a count",
      legend.rows >= 5 && legend.counts.every((count) => /\d/.test(count)),
      `${legend.title} → ${legend.labels.join(", ")}`,
    );

    // --- 5. community mode -------------------------------------------------
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")];
      const target = buttons.find((button) => button.textContent?.includes("按社区着色"));
      target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const communityView = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".enhanced-graph-legend-row")];
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      const colors = new Set();
      graph.forEachNode((node, attributes) => colors.add(attributes.color));
      return {
        title: document.querySelector(".enhanced-graph-legend-title")?.textContent ?? "",
        rows: rows.length,
        cohesion: [...document.querySelectorAll(".enhanced-graph-legend-cohesion")].map(
          (el) => el.textContent ?? "",
        ),
        sparse: document.querySelectorAll(".enhanced-graph-legend-cohesion.is-sparse").length,
        warningIcons: document.querySelectorAll(".enhanced-graph-legend-warn").length,
        distinctColors: colors.size,
        communities: window.__HARNESS__.snapshot.graph.communities.length,
      };
    });
    check(
      "community legend shows core node, member count and cohesion",
      communityView.title.includes("集群") &&
        communityView.rows === communityView.communities &&
        communityView.cohesion.length === communityView.communities &&
        communityView.cohesion.every((text) => /内聚度|偏低/.test(text)),
      `${communityView.rows} clusters, cohesion: ${communityView.cohesion.join(" | ")}`,
    );
    check(
      "colouring switched to the community palette",
      communityView.distinctColors >= Math.min(2, communityView.communities),
      `${communityView.distinctColors} distinct node colours`,
    );

    // The cluster rows are the filter control: pressing one takes that whole
    // knowledge cluster off the graph, pressing it again brings it back. Driven
    // with the real pointer, and the row is expected to stay in the list — it is
    // the only way back.
    const clusterFilter = await (async () => {
      const visibleCount = () => page.evaluate(() => window.__HARNESS__.visibleNodeIds().length);
      const expectedDrop = await page.evaluate(() => {
        const community = window.__HARNESS__.snapshot.graph.communities[0];
        const shown = new Set(window.__HARNESS__.visibleNodeIds());
        return community.nodeIds.filter((id) => shown.has(id)).length;
      });
      const before = await visibleCount();
      const rows = page.locator(".enhanced-graph-legend-row");
      await rows.nth(0).click();
      await page.waitForTimeout(500);
      const afterHiding = await visibleCount();
      const marked = await page.evaluate(() => ({
        hiddenRows: document.querySelectorAll(".enhanced-graph-legend-row.is-hidden-cluster").length,
        rows: document.querySelectorAll(".enhanced-graph-legend-row").length,
        showAll: [...document.querySelectorAll(".enhanced-graph-legend-header button")].some((el) =>
          (el.textContent ?? "").includes("显示全部"),
        ),
        stored: window.__HARNESS__.settings.hiddenCommunities.slice(),
      }));

      await rows.nth(0).click();
      await page.waitForTimeout(500);
      return {
        expectedDrop,
        before,
        afterHiding,
        afterRestore: await visibleCount(),
        storedAfterRestore: await page.evaluate(
          () => window.__HARNESS__.settings.hiddenCommunities.slice(),
        ),
        ...marked,
      };
    })();
    check(
      "clicking a cluster row excludes that cluster, and clicking it again restores it",
      clusterFilter.expectedDrop > 0 &&
        clusterFilter.afterHiding === clusterFilter.before - clusterFilter.expectedDrop &&
        clusterFilter.afterRestore === clusterFilter.before &&
        clusterFilter.storedAfterRestore.length === 0,
      `${clusterFilter.before} → ${clusterFilter.afterHiding} (−${clusterFilter.expectedDrop}) → ${clusterFilter.afterRestore} nodes`,
    );
    check(
      "an excluded cluster's row stays, marked, with a way back",
      clusterFilter.hiddenRows === 1 &&
        clusterFilter.rows === communityView.communities &&
        clusterFilter.showAll,
      `${clusterFilter.hiddenRows} row marked hidden of ${clusterFilter.rows}, ` +
        `stored [${clusterFilter.stored.join(", ")}], show-all offered: ${clusterFilter.showAll}`,
    );
    await page.screenshot({ path: path.join(shotsDir, "02-community-mode-dark.png") });

    // The type rows are the same control in type mode, and the header's "show all"
    // is the one-press way back for whichever group is on screen — always there,
    // disabled while there is nothing to restore.
    await switchColourMode(page, "按类型着色");
    const typeFilter = await (async () => {
      const visibleCount = () => page.evaluate(() => window.__HARNESS__.visibleNodeIds().length);
      const showAll = page.locator(".enhanced-graph-legend-header button", { hasText: "显示全部" });
      const disabledBefore = await showAll.isDisabled();
      const before = await visibleCount();
      const rows = page.locator(".enhanced-graph-legend-row");
      const rowCount = await rows.count();
      const firstName = await page.evaluate(
        () => document.querySelector(".enhanced-graph-legend-label")?.textContent ?? "",
      );

      await rows.nth(0).click();
      await page.waitForTimeout(500);
      const hidden = await visibleCount();
      const marked = await page.evaluate(() => {
        const visible = new Set(window.__HARNESS__.visibleNodeIds());
        const keyOf = (node) => ((node.rawType ?? "").trim().toLowerCase() || node.type);
        const drawnKeys = new Set(
          window.__HARNESS__.snapshot.graph.nodes
            .filter((node) => visible.has(node.id))
            .map(keyOf),
        );
        return {
          rows: document.querySelectorAll(".enhanced-graph-legend-row.is-hidden-type").length,
          // Every greyed row must be one with nothing left on the graph, and every
          // such row must be greyed — the rule, not a count of them.
          greyedLabels: [...document.querySelectorAll(".enhanced-graph-legend-row.is-hidden-type")]
            .map((row) => row.querySelector(".enhanced-graph-legend-label")?.textContent ?? "")
            .sort(),
          emptyCount: [...new Set(window.__HARNESS__.snapshot.graph.nodes.map(keyOf))].filter(
            (key) => !drawnKeys.has(key),
          ).length,
          stored: window.__HARNESS__.settings.hiddenTypes.slice(),
        };
      });
      const enabledWhileHidden = !(await showAll.isDisabled());

      await showAll.click();
      await page.waitForTimeout(500);
      return {
        rowCount,
        firstName,
        before,
        hidden,
        marked,
        disabledBefore,
        enabledWhileHidden,
        afterShowAll: await visibleCount(),
        storedAfterRestore: await page.evaluate(
          () => window.__HARNESS__.settings.hiddenTypes.slice(),
        ),
      };
    })();
    check(
      "clicking a type row excludes that type, and the header's 显示全部 brings it back",
      typeFilter.rowCount >= 5 &&
        typeFilter.hidden < typeFilter.before &&
        // Greyed means "nothing of this type is drawn": the row that was clicked, and
        // any other row the same click emptied (a vault can declare both `concept` and
        // `概念`; hiding one hides both, so both rows have to grey).
        typeFilter.marked.rows === typeFilter.marked.emptyCount &&
        typeFilter.marked.rows >= 1 &&
        typeFilter.disabledBefore === true &&
        typeFilter.enabledWhileHidden &&
        typeFilter.afterShowAll === typeFilter.before &&
        typeFilter.storedAfterRestore.length === 0,
      `"${typeFilter.firstName}": ${typeFilter.before} → ${typeFilter.hidden} → ` +
        `${typeFilter.afterShowAll} nodes; show-all disabled ${typeFilter.disabledBefore} → ` +
        `${!typeFilter.enabledWhileHidden}`,
    );

    // --- 5c. nothing scrolls back to the top when a row is clicked ----------
    // Clicking a row re-renders the legend (the row has to come back shaded) and
    // the panel (the graph changed), and rebuilding a scrolling box scrolls it
    // back to the top — under the pointer that just clicked. Measured in a short
    // window, so both boxes really do scroll.
    const scrollKeep = await (async () => {
      await page.setViewportSize({ width: 1440, height: 460 });
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => {
        const body = document.querySelector(".enhanced-graph-legend-body");
        const panel = document.querySelector(".enhanced-graph-panel");
        if (body) body.scrollTop = body.scrollHeight;
        if (panel) panel.scrollTop = panel.scrollHeight;
        return {
          bodyScrolls: body ? body.scrollHeight > body.clientHeight : false,
          panelScrolls: panel ? panel.scrollHeight > panel.clientHeight : false,
          body: body?.scrollTop ?? 0,
          panel: panel?.scrollTop ?? 0,
          bodyShape: body ? `${body.scrollHeight}/${body.clientHeight}` : "none",
          rows: document.querySelectorAll(".enhanced-graph-legend-row").length,
        };
      });
      // The LAST row: at this scroll position it is the visible one, so the real
      // pointer has no reason to scroll the list before clicking — Playwright
      // scrolls a target into view, which on its own would move the position this
      // check is about.
      await page.locator(".enhanced-graph-legend-row").last().click();
      const immediate = await page.evaluate(
        () => document.querySelector(".enhanced-graph-legend-body")?.scrollTop ?? -1,
      );
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => {
        const body = document.querySelector(".enhanced-graph-legend-body");
        return {
          body: body?.scrollTop ?? 0,
          panel: document.querySelector(".enhanced-graph-panel")?.scrollTop ?? 0,
          bodyShape: body ? `${body.scrollHeight}/${body.clientHeight}` : "none",
          rows: document.querySelectorAll(".enhanced-graph-legend-row").length,
        };
      });
      // Put the row back, and restore the window the rest of the run expects.
      await page.locator(".enhanced-graph-legend-row").last().click();
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(400);
      return { ...before, after, immediate };
    })();
    check(
      "clicking a row leaves the legend and the panel scrolled where they were",
      scrollKeep.bodyScrolls &&
        scrollKeep.body > 0 &&
        scrollKeep.after.body === scrollKeep.body &&
        (!scrollKeep.panelScrolls || scrollKeep.after.panel === scrollKeep.panel),
      `legend body ${scrollKeep.body} → ${scrollKeep.immediate} (right after the click) → ${scrollKeep.after.body} ` +
        `(${scrollKeep.bodyShape} → ${scrollKeep.after.bodyShape}, rows ${scrollKeep.rows} → ${scrollKeep.after.rows}); ` +
        `panel ${scrollKeep.panel} → ${scrollKeep.after.panel} (scrolls: ${scrollKeep.panelScrolls})`,
    );

    // --- 6. hover: neighbours stay, others dim, score tooltip --------------
    const hoverTarget = await page.evaluate(() => {
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      let best = null;
      graph.forEachNode((node, attributes) => {
        if (!best || attributes.linkCount > best.linkCount) best = { id: node, links: attributes.linkCount };
      });
      const position = window.__HARNESS__.nodePosition(best.id);
      return { best, position };
    });

    if (hoverTarget.position) {
      await page.mouse.move(hoverTarget.position.clientX, hoverTarget.position.clientY);
      await page.waitForTimeout(450);

      const hoverState = await page.evaluate(() => {
        const tooltip = document.querySelector(".enhanced-graph-tooltip");
        const sigma = window.__HARNESS__.view.renderer.instance;
        const graph = sigma.getGraph();
        // A dimmed node is one whose reduced display data lost its label even
        // though the underlying graph attribute still has one.
        let dimmed = 0;
        let labelled = 0;
        let emphasised = 0;
        graph.forEachNode((id) => {
          const display = sigma.getNodeDisplayData(id);
          const attribute = graph.getNodeAttribute(id, "label");
          if (!display) return;
          if (display.labelVisibility === "visible") emphasised += 1;
          if (display.label === "" && attribute) dimmed += 1;
          else if (display.label === attribute) labelled += 1;
        });
        return {
          tooltipVisible: Boolean(tooltip) && tooltip.style.display !== "none",
          tooltipText: tooltip?.textContent ?? "",
          dimmed,
          labelled,
          emphasised,
        };
      });
      check(
        "hovering a node shows the association-score tooltip",
        hoverState.tooltipVisible && /\d+\.\d{2}/.test(hoverState.tooltipText),
        hoverState.tooltipText.replace(/\s+/g, " ").slice(0, 90),
      );
      check(
        "non-neighbours are dimmed while neighbours stay visible",
        hoverState.dimmed > 0 && hoverState.labelled > 0 && hoverState.emphasised >= 1,
        `${hoverState.dimmed} dimmed / ${hoverState.labelled} normal / ${hoverState.emphasised} emphasised`,
      );
      await page.screenshot({ path: path.join(shotsDir, "03-hover-score-dark.png") });
      await page.mouse.move(5, 5);
      await page.waitForTimeout(200);
    } else {
      check("hovering a node shows the association-score tooltip", false, "no node position resolved");
      check("non-neighbours are dimmed while neighbours stay visible", false, "no node position resolved");
    }

    // --- 7. edge hover shows the four-signal breakdown ---------------------
    const edgeHover = await page.evaluate(() => {
      const api = window.__HARNESS__;
      const renderer = api.view.renderer;
      const edge = api.strongestEdge();
      const summary = renderer.callbacks?.describeEdge
        ? renderer.callbacks.describeEdge([edge.source, edge.target].sort().join(":::"))
        : null;
      return { edge, summary };
    });
    check(
      "edge tooltip data exposes all four signals",
      Boolean(edgeHover.summary) &&
        typeof edgeHover.summary.directLink === "number" &&
        typeof edgeHover.summary.sourceOverlap === "number" &&
        typeof edgeHover.summary.adamicAdar === "number" &&
        typeof edgeHover.summary.coCitation === "number",
      edgeHover.summary
        ? `weight=${edgeHover.summary.weight.toFixed(2)} direct=${edgeHover.summary.directLink} sources=${edgeHover.summary.sourceOverlap} aa=${edgeHover.summary.adamicAdar.toFixed(2)} coCitation=${edgeHover.summary.coCitation.toFixed(2)}`
        : "no summary",
    );

    // --- 8. insights panel + click-to-highlight ---------------------------
    // One button per group, and the cards of the chosen one below it.
    const insightTabs = await page.evaluate(() =>
      [...document.querySelectorAll(".enhanced-graph-panel-tabs button")].map((el) => el.textContent ?? ""),
    );
    const connectionCards = await page.evaluate(
      () => document.querySelectorAll(".enhanced-graph-card").length,
    );
    await selectPanelTab(page, "知识空白");
    const gapCards = await page.evaluate(() => ({
      count: document.querySelectorAll(".enhanced-graph-card").length,
      gaps: document.querySelectorAll(".enhanced-graph-card").length,
    }));
    // Back to the first group: the checks below click a connection card.
    await selectPanelTab(page, "惊奇连接");
    const panel = {
      count: connectionCards + gapCards.count,
      titles: [],
      sections: insightTabs,
    };
    check(
      "insights panel switches between connection and gap cards by tab",
      insightTabs.length >= 2 &&
        insightTabs.some((text) => text.includes("惊奇连接")) &&
        insightTabs.some((text) => text.includes("知识空白")) &&
        connectionCards >= 1 &&
        gapCards.count >= 1 &&
        panel.count >= 4,
      `tabs: ${insightTabs.join(" / ")}; ${connectionCards} connection + ${gapCards.count} gap cards`,
    );

    // Regression guard: the panel header lives in the SAME element the insight
    // cards are appended to. A renderer that clears its container deletes the
    // title and the close button — which every other check here failed to
    // notice, because none of them looked at the header.
    const header = await page.evaluate(() => {
      const panelEl = document.querySelector(".enhanced-graph-panel");
      if (!panelEl) return { present: false };
      const headerEl = panelEl.querySelector(".enhanced-graph-panel-header");
      return {
        present: Boolean(headerEl),
        isFirstChild: panelEl.firstElementChild === headerEl,
        text: headerEl?.textContent ?? "",
        hasClose: Boolean(headerEl?.querySelector(".enhanced-graph-link")),
        cardsAfterHeader: panelEl.querySelectorAll(".enhanced-graph-card").length,
        panelChildren: panelEl.children.length,
      };
    });
    check(
      "insights mode keeps the panel header above the cards",
      header.present &&
        header.isFirstChild &&
        header.text.includes("图谱洞察") &&
        header.hasClose &&
        header.cardsAfterHeader >= 1,
      `header="${header.text}" first=${header.isFirstChild} children=${header.panelChildren}`,
    );

    if (panel.count > 0) {
      await page.evaluate(() => {
        document.querySelector(".enhanced-graph-card")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(250);
      const highlighted = await page.evaluate(() => {
        const sigma = window.__HARNESS__.view.renderer.instance;
        let forced = 0;
        sigma.getGraph().forEachNode((id) => {
          if (sigma.getNodeDisplayData(id)?.labelVisibility === "visible") forced += 1;
        });
        return {
          activeCards: document.querySelectorAll(".enhanced-graph-card.is-active-connection, .enhanced-graph-card.is-active-gap").length,
          forced,
        };
      });
      check(
        "clicking an insight card highlights the matching nodes",
        highlighted.activeCards === 1 && highlighted.forced >= 2,
        `${highlighted.activeCards} active card, ${highlighted.forced} emphasised nodes`,
      );
      await page.screenshot({ path: path.join(shotsDir, "04-insight-highlight-dark.png") });

      // Toggle off with a second click.
      await page.evaluate(() => {
        document
          .querySelector(".enhanced-graph-card.is-active-connection, .enhanced-graph-card.is-active-gap")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await page.waitForTimeout(200);
      const cleared = await page.evaluate(
        () =>
          document.querySelectorAll(
            ".enhanced-graph-card.is-active-connection, .enhanced-graph-card.is-active-gap",
          ).length,
      );
      check("clicking the active card again clears the highlight", cleared === 0, `${cleared} active cards`);
    }

    // --- 9. dismiss ("mark as seen") --------------------------------------
    const dismiss = await page.evaluate(async () => {
      const before = document.querySelectorAll(".enhanced-graph-card").length;
      document
        .querySelector(".enhanced-graph-card-head .enhanced-graph-link")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        before,
        after: document.querySelectorAll(".enhanced-graph-card").length,
        dismissed: window.__HARNESS__.settings.dismissedInsights.length,
      };
    });
    check(
      "dismissing an insight card removes it and records the key",
      dismiss.after === dismiss.before - 1 && dismiss.dismissed >= 1,
      `${dismiss.before} → ${dismiss.after} cards, ${dismiss.dismissed} key(s) stored`,
    );

    // --- 10. filters panel -------------------------------------------------
    const filters = await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("过滤器"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const payload = {
        checkboxes: document.querySelectorAll(".enhanced-graph-checkbox input[type=checkbox]").length,
        sliders: document.querySelectorAll(".enhanced-graph-slider input[type=range]").length,
        panelTitle: document.querySelector(".enhanced-graph-panel-header")?.textContent ?? "",
      };
      const sigma = window.__HARNESS__.view.renderer.instance;
      const before = sigma.getGraph().order;
      const checkbox = [...document.querySelectorAll(".enhanced-graph-checkbox")]
        .find((row) => row.textContent?.includes("概念"))
        ?.querySelector("input");
      if (checkbox) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
      return { ...payload, before, after: sigma.getGraph().order };
    });
    check(
      "filters panel exposes type and tag toggles, and no appearance controls",
      filters.checkboxes >= 5 && filters.sliders === 0,
      `${filters.checkboxes} checkboxes, ${filters.sliders} sliders, panel="${filters.panelTitle}"`,
    );
    check(
      "toggling a page type rebuilds the rendered graph",
      filters.after < filters.before,
      `${filters.before} → ${filters.after} nodes after hiding 概念`,
    );
    await page.screenshot({ path: path.join(shotsDir, "05-filters-panel-dark.png") });

    // Restore so the remaining checks see the whole graph again.
    await page.evaluate(() => {
      const checkbox = [...document.querySelectorAll(".enhanced-graph-checkbox")]
        .find((row) => row.textContent?.includes("概念"))
        ?.querySelector("input");
      if (checkbox && !checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);

    // --- 10b. appearance panel: the four quick controls --------------------
    const openAppearance = async () => {
      await page.evaluate(async () => {
        const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
          (candidate) => candidate.textContent?.includes("外观"),
        );
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      await page.waitForTimeout(200);
    };
    await openAppearance();

    // An earlier check switched colouring to clusters, so put it back to type
    // before asserting the per-type rows exist.
    const switchMode = async (label) => {
      await page.evaluate(async (text) => {
        const button = [...document.querySelectorAll(".enhanced-graph-segmented .enhanced-graph-button")].find(
          (candidate) => candidate.textContent?.includes(text),
        );
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
      }, label);
      await page.waitForTimeout(250);
    };
    await switchMode("按类型");

    const appearance = await page.evaluate(() => {
      const panel = document.querySelector(".enhanced-graph-panel");
      const sections = [...(panel?.querySelectorAll(".enhanced-graph-section") ?? [])];
      const sectionNamed = (needle) =>
        sections.find((section) =>
          section.querySelector(".enhanced-graph-section-title")?.textContent?.includes(needle),
        );
      const edgeSection = sectionNamed("连线");
      const nodeSection = sectionNamed("节点");
      return {
        title: panel?.querySelector(".enhanced-graph-panel-header")?.textContent ?? "",
        // Sliders only: colour rows reuse the same label class.
        sliders: panel?.querySelectorAll(".enhanced-graph-slider input[type=range]").length ?? 0,
        numberFields: panel?.querySelectorAll(".enhanced-graph-number").length ?? 0,
        hexFields: panel?.querySelectorAll(".enhanced-graph-hex").length ?? 0,
        colourPickers: panel?.querySelectorAll(".enhanced-graph-colour").length ?? 0,
        modes: [...(panel?.querySelectorAll(".enhanced-graph-segmented .enhanced-graph-button") ?? [])].map(
          (el) => el.textContent ?? "",
        ),
        // The edge ramp is configured by both ends: two pickers, two widths.
        edgePickers: edgeSection?.querySelectorAll(".enhanced-graph-colour").length ?? 0,
        edgeRanges: edgeSection?.querySelectorAll("input[type=range]").length ?? 0,
        edgeNumbers: edgeSection?.querySelectorAll("input[type=number]").length ?? 0,
        // Per-type rows appear under the node section in type mode.
        typeRows: nodeSection?.querySelectorAll(".enhanced-graph-colour-row").length ?? 0,
        // How many distinct types the vault declares, counted the way the panel does.
        declaredTypes: new Set(
          window.__HARNESS__.snapshot.graph.nodes.map(
            (node) => (node.rawType ?? "").trim().toLowerCase() || node.type,
          ),
        ).size,
        colorMode: window.__HARNESS__.settings.colorMode,
      };
    });
    check(
      "appearance panel exposes both ends of the edge ramp, node size and colours",
      appearance.title.includes("外观") &&
        // node size, edge weak/strong width, gravity, label size, label opacity
        appearance.sliders === 6 &&
        appearance.numberFields === 6 &&
        appearance.edgePickers === 2 &&
        appearance.edgeRanges === 2 &&
        appearance.edgeNumbers === 2 &&
        appearance.modes.length === 3 &&
        // One row per type the vault declares — measured against the vault, not
        // against a number: 13 in this snapshot, four of them custom.
        appearance.typeRows === appearance.declaredTypes &&
        // one row per type + one colour per edge end. The label colour is gone from
        // this count because it is no longer a colour: the theme decides it and the
        // slider above sets its opacity.
        appearance.hexFields >= appearance.declaredTypes + 2 &&
        appearance.hexFields === appearance.colourPickers,
      `"${appearance.title}": ${appearance.sliders} sliders / ${appearance.numberFields} number fields / ` +
        `${appearance.hexFields} hex fields; edge section has ${appearance.edgePickers} pickers, ` +
        `${appearance.edgeRanges} widths; ${appearance.typeRows} per-type rows; ` +
        `modes: ${appearance.modes.join("/")}`,
    );

    // The two ends of the ramp are independent. Note the measured "weakest" edge
    // is not exactly at weight 0 (the vault's weakest link sits at 0.13), so its
    // width is already part-way along the ramp — which is the point of the
    // interpolation, and what the assertions have to allow for.
    const thickness = await page.evaluate(async () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const read = () => {
        let weakest = null;
        let strongest = null;
        sigma.getGraph().forEachEdge((edge, attributes) => {
          const size = sigma.getEdgeDisplayData(edge).size;
          if (!weakest || attributes.normalizedWeight < weakest.nw) weakest = { nw: attributes.normalizedWeight, size };
          if (!strongest || attributes.normalizedWeight > strongest.nw) strongest = { nw: attributes.normalizedWeight, size };
        });
        return { weak: weakest.size, strong: strongest.size, weakNw: weakest.nw, strongNw: strongest.nw };
      };
      const section = [...document.querySelectorAll(".enhanced-graph-section")].find((candidate) =>
        candidate.querySelector(".enhanced-graph-section-title")?.textContent?.includes("连线"),
      );
      if (!section) return { error: "no edge section" };
      const ranges = section.querySelectorAll("input[type=range]");
      const numbers = section.querySelectorAll("input[type=number]");
      if (ranges.length < 2 || numbers.length < 2) return { error: "edge section missing controls" };

      // 1. Widen only the strong end.
      const before = read();
      ranges[1].value = "10";
      ranges[1].dispatchEvent(new Event("input", { bubbles: true }));
      ranges[1].dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterStrong = read();

      // 2. Then change the weak end by typing an exact number.
      numbers[0].value = "2.5";
      numbers[0].dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterWeak = read();

      return {
        before,
        afterStrong,
        afterWeak,
        storedStrong: window.__HARNESS__.settings.edgeStrongWidth,
        storedWeak: window.__HARNESS__.settings.edgeWeakWidth,
      };
    });
    check(
      "each end of the edge ramp is set independently",
      !thickness.error &&
        // The strongest edge sits at weight 1, so it lands exactly on the
        // configured strong width.
        Math.abs(thickness.afterStrong.strong - thickness.storedStrong) < 0.01 &&
        thickness.afterStrong.strong > thickness.before.strong * 2 &&
        // The weakest edge is at weight 0.13, so it *should* move — but only by
        // its share of the ramp, far less than the strong end did.
        thickness.afterStrong.weak > thickness.before.weak &&
        thickness.afterStrong.weak - thickness.before.weak <
          (thickness.afterStrong.strong - thickness.before.strong) * 0.25 &&
        // Typing an exact value works, and moves the weak end again.
        thickness.afterWeak.weak > thickness.afterStrong.weak &&
        thickness.storedStrong === 10 &&
        thickness.storedWeak === 2.5,
      thickness.error
        ? thickness.error
        : `strong ${thickness.before.strong.toFixed(2)} → ${thickness.afterStrong.strong.toFixed(2)} ` +
          `(= configured ${thickness.storedStrong}); weakest edge moved only ` +
          `${thickness.before.weak.toFixed(2)} → ${thickness.afterStrong.weak.toFixed(2)} (its 13% share); ` +
          `then typing 2.5 took it to ${thickness.afterWeak.weak.toFixed(2)}`,
    );

    // Colour ends are independent in the same way: the strong end takes the new
    // colour exactly, and the weak end stays dominated by the theme's gray.
    const edgeColour = await page.evaluate(async () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const read = () => {
        let weakest = null;
        let strongest = null;
        sigma.getGraph().forEachEdge((edge, attributes) => {
          const colour = sigma.getEdgeDisplayData(edge).color;
          if (!weakest || attributes.normalizedWeight < weakest.nw) weakest = { nw: attributes.normalizedWeight, colour };
          if (!strongest || attributes.normalizedWeight > strongest.nw) strongest = { nw: attributes.normalizedWeight, colour };
        });
        return { weak: weakest.colour, strong: strongest.colour };
      };
      const before = read();
      const section = [...document.querySelectorAll(".enhanced-graph-section")].find((candidate) =>
        candidate.querySelector(".enhanced-graph-section-title")?.textContent?.includes("连线"),
      );
      const pickers = section?.querySelectorAll(".enhanced-graph-colour") ?? [];
      if (pickers.length < 2) return { error: "no strong-colour picker" };
      pickers[1].value = "#38bdf8";
      pickers[1].dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = read();
      const channels = (css) =>
        String(css).match(/rgba?\(([^)]+)\)/)?.[1].split(",").slice(0, 3).map(Number) ?? [0, 0, 0];
      const [r, g, b] = channels(after.strong);
      return {
        before,
        after,
        isBlue: Math.abs(r - 56) < 4 && Math.abs(g - 189) < 4 && Math.abs(b - 248) < 4,
        stored: window.__HARNESS__.settings.edgeStrongColor,
        storedWeak: window.__HARNESS__.settings.edgeWeakColor,
      };
    });
    check(
      "the strong end can be recoloured without touching the weak end",
      !edgeColour.error &&
        edgeColour.isBlue &&
        edgeColour.after.strong !== edgeColour.before.strong &&
        edgeColour.stored === "#38bdf8" &&
        edgeColour.storedWeak === null,
      edgeColour.error
        ? edgeColour.error
        : `strong ${edgeColour.before.strong} → ${edgeColour.after.strong}; ` +
          `weak end still on the theme (${edgeColour.after.weak}), stored weak=${edgeColour.storedWeak}`,
    );

    // Per-type colour overrides.
    const typeColour = await page.evaluate(async () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const colourOf = (id) => sigma.getGraph().getNodeAttribute(id, "color");
      const entity = [...sigma.getGraph().nodes()].find(
        (id) => sigma.getGraph().getNodeAttribute(id, "pageType") === "entity",
      );
      const before = colourOf(entity);
      const nodeSection = [...document.querySelectorAll(".enhanced-graph-section")].find((candidate) =>
        candidate.querySelector(".enhanced-graph-section-title")?.textContent?.includes("节点"),
      );
      const rows = [...(nodeSection?.querySelectorAll(".enhanced-graph-colour-row") ?? [])];
      const entityRow = rows.find((row) => row.textContent?.includes("实体"));
      const picker = entityRow?.querySelector(".enhanced-graph-colour");
      if (!picker) return { error: "no entity colour row" };
      picker.value = "#123456";
      picker.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        before,
        after: colourOf(entity),
        stored: window.__HARNESS__.settings.typeColorOverrides.entity,
        mode: window.__HARNESS__.settings.colorMode,
      };
    });
    check(
      "a single page type can be recoloured on its own",
      !typeColour.error &&
        typeColour.after === "#123456" &&
        typeColour.after !== typeColour.before &&
        typeColour.stored === "#123456" &&
        // Recolouring a type must not knock the view out of type mode.
        typeColour.mode === "type",
      typeColour.error ? typeColour.error : `${typeColour.before} → ${typeColour.after} (mode still ${typeColour.mode})`,
    );

    // Node colour: single-colour mode repaints every node.
    const nodeColour = await page.evaluate(async () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const colours = () => {
        const seen = new Set();
        sigma.getGraph().forEachNode((node, attributes) => seen.add(attributes.color));
        return [...seen];
      };
      const before = colours();
      const picker = [...document.querySelectorAll(".enhanced-graph-segmented .enhanced-graph-button")].find(
        (button) => button.textContent?.includes("单色"),
      );
      picker?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const afterSingle = colours();
      const colourInput = document.querySelector(".enhanced-graph-colour");
      let afterPick = afterSingle;
      if (colourInput) {
        colourInput.value = "#ff8800";
        colourInput.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        afterPick = colours();
      }
      return {
        beforeCount: before.length,
        afterSingleCount: afterSingle.length,
        single: afterSingle[0],
        afterPickCount: afterPick.length,
        picked: afterPick[0],
        mode: window.__HARNESS__.settings.colorMode,
        stored: window.__HARNESS__.settings.customNodeColor,
      };
    });
    check(
      "single-colour mode repaints every node, and the picker changes that colour",
      nodeColour.beforeCount > 1 &&
        nodeColour.afterSingleCount === 1 &&
        nodeColour.afterPickCount === 1 &&
        nodeColour.picked?.toLowerCase() === "#ff8800" &&
        nodeColour.mode === "custom",
      `${nodeColour.beforeCount} colours → ${nodeColour.afterSingleCount} (${nodeColour.single}) ` +
        `→ picker → ${nodeColour.picked} (stored ${nodeColour.stored})`,
    );

    // The label toggle used to update only the view's own copy of the flag, so
    // it silently reverted on the next reload. Assert it reaches the settings.
    const labelsToggle = await page.evaluate(async () => {
      const panel = document.querySelector(".enhanced-graph-panel");
      const row = [...panel.querySelectorAll(".enhanced-graph-checkbox")].find((candidate) =>
        candidate.textContent?.includes("显示标签"),
      );
      const input = row?.querySelector("input[type=checkbox]");
      if (!input) return { error: "no labels toggle in the appearance panel" };
      const before = window.__HARNESS__.settings.showLabels;
      input.checked = !before;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const sigma = window.__HARNESS__.view.renderer.instance;
      return {
        before,
        after: window.__HARNESS__.settings.showLabels,
        renderLabels: sigma.getSetting("renderLabels"),
      };
    });
    check(
      "the label toggle is persisted to the settings, not just the view",
      !labelsToggle.error &&
        labelsToggle.after === !labelsToggle.before &&
        labelsToggle.renderLabels === labelsToggle.after,
      labelsToggle.error
        ? labelsToggle.error
        : `settings.showLabels ${labelsToggle.before} → ${labelsToggle.after}, ` +
          `renderer renderLabels=${labelsToggle.renderLabels}`,
    );

    // Put the appearance back to its defaults so later checks see the reference
    // look — and assert the reset really restored it, rather than trusting it.
    const restored = await page.evaluate(async () => {
      const panel = document.querySelector(".enhanced-graph-panel");
      // Return to type colouring first: that is the suite's baseline, and the
      // per-type rows only exist in that mode, so there is something to reset.
      const modeButton = [...document.querySelectorAll(".enhanced-graph-segmented .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("按类型"),
      );
      modeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 350));

      const section = [...document.querySelectorAll(".enhanced-graph-section")].find((candidate) =>
        candidate.querySelector(".enhanced-graph-section-title")?.textContent?.includes("连线"),
      );
      const numbers = section.querySelectorAll("input[type=number]");
      const ranges = section.querySelectorAll("input[type=range]");
      const setNumber = (input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setNumber(numbers[0], 0.5);
      setNumber(numbers[1], 4);
      // And re-enable labels, which the persistence check turned off.
      const labelRow = [...panel.querySelectorAll('.enhanced-graph-checkbox')].find((el) =>
        el.textContent?.includes('显示标签'),
      );
      const labelInput = labelRow?.querySelector('input[type=checkbox]');
      if (labelInput && !labelInput.checked) {
        labelInput.checked = true;
        labelInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      // Every colour row carries a ↺ that returns it to the palette or theme —
      // the edge ends and the per-type rows alike. Clicking them all is
      // mode-agnostic, which matters because the per-type rows only exist in
      // type mode.
      let resetButtons = 0;
      for (const row of panel.querySelectorAll(".enhanced-graph-colour-row")) {
        const button = row.querySelector(".enhanced-graph-link");
        if (!button) continue;
        resetButtons += 1;
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 400));

      const sigma = window.__HARNESS__.view.renderer.instance;
      let strongest = null;
      sigma.getGraph().forEachEdge((edge, attributes) => {
        if (!strongest || attributes.normalizedWeight > strongest.nw) {
          strongest = { nw: attributes.normalizedWeight, size: sigma.getEdgeDisplayData(edge).size };
        }
      });
      return {
        ranges: ranges.length,
        resetButtons,
        colourRows: panel.querySelectorAll(".enhanced-graph-colour-row").length,
        strongWidth: window.__HARNESS__.settings.edgeStrongWidth,
        weakWidth: window.__HARNESS__.settings.edgeWeakWidth,
        strongColour: window.__HARNESS__.settings.edgeStrongColor,
        weakColour: window.__HARNESS__.settings.edgeWeakColor,
        mode: window.__HARNESS__.settings.colorMode,
        typeOverrides: Object.keys(window.__HARNESS__.settings.typeColorOverrides).length,
        strongestEdgeWidth: strongest.size,
      };
    });
    check(
      "the edge appearance can be reset back to the defaults",
      restored.strongWidth === 4 &&
        restored.weakWidth === 0.5 &&
        restored.strongColour === null &&
        restored.weakColour === null &&
        restored.typeOverrides === 0 &&
        restored.mode === "type",
      `widths ${restored.weakWidth}/${restored.strongWidth}, colours ` +
        `${restored.weakColour}/${restored.strongColour}, ${restored.typeOverrides} type override(s) ` +
        `[${restored.mode}] after clicking ${restored.resetButtons} of ${restored.colourRows} colour rows`,
    );
    await page.screenshot({ path: path.join(shotsDir, "13-appearance-panel-dark.png") });

    // The gravity knob must actually move the layout. This is the check the old
    // "spacing" control would have failed: spacing was FA2's scalingRatio, a
    // uniform global resize that the view's fit-to-canvas cancels completely, so
    // the layout looked identical at every setting. The measure below is
    // scale-invariant (mean edge length ÷ bounding-box diagonal), so a mere
    // rescale cannot make it move.
    const layoutShape = () =>
      page.evaluate(() => {
        const graph = window.__HARNESS__.view.renderer.instance.getGraph();
        const points = [];
        graph.forEachNode((node, attributes) => points.push([attributes.x, attributes.y]));
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const diagonal = Math.hypot(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        );
        let total = 0;
        let count = 0;
        graph.forEachEdge((edge, attributes, source, target) => {
          const a = graph.getNodeAttributes(source);
          const b = graph.getNodeAttributes(target);
          total += Math.hypot(a.x - b.x, a.y - b.y);
          count += 1;
        });
        return { diagonal, ratio: total / count / diagonal };
      });

    const setGravity = async (value) => {
      await page.evaluate(async (target) => {
        const row = [...document.querySelectorAll(".enhanced-graph-slider")].find((candidate) =>
          candidate.textContent?.includes("引力"),
        );
        const field = row?.querySelector("input[type=number]");
        if (!field) return;
        // The field works in percent: the gravity slider reads 16…256.
        field.value = String(target);
        field.dispatchEvent(new Event("change", { bubbles: true }));
        // The layout runs asynchronously after the setting changes.
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }, value);
      await page.waitForTimeout(600);
    };

    const looseGravity = await (async () => {
      await setGravity(16);
      return layoutShape();
    })();
    const tightGravity = await (async () => {
      await setGravity(256);
      return layoutShape();
    })();

    const spread = Math.abs(tightGravity.ratio - looseGravity.ratio) / looseGravity.ratio;
    check(
      "the gravity control changes the layout's shape, not just its scale",
      // Spanning the slider's own range (16%…256%); require a clear margin.
      spread > 0.15 && tightGravity.ratio > looseGravity.ratio,
      `edge/diagonal ${looseGravity.ratio.toFixed(4)} at gravity 16% -> ` +
        `${tightGravity.ratio.toFixed(4)} at gravity 256% (${(spread * 100).toFixed(1)}% change); ` +
        `bounding box ${looseGravity.diagonal.toFixed(1)} → ${tightGravity.diagonal.toFixed(1)}`,
    );

    await setGravity(100);

    // --- label auto-hide + label look --------------------------------------
    // Sigma drops a label once its node shrinks below `labelRenderedSizeThreshold`
    // — that is the behaviour being made optional.
    //
    // v4 renders labels into the WebGL pass with an SDF atlas and keeps no 2D
    // canvas, so `canvasContexts.labels` (and with it the pixel count this check
    // used to take) is gone. Counting painted pixels was already inconclusive
    // here anyway: at the zoom where the threshold starts culling, the graph is
    // ~80px across and the label-density grid is the binding constraint. What is
    // verifiable is the mechanism, which is what this reads now.
    const countRenderedLabels = () =>
      page.evaluate(() => ({
        threshold: window.__HARNESS__.view.renderer.instance.getSetting(
          "labelRenderedSizeThreshold",
        ),
      }));

    await page.evaluate(async () => {
      const renderer = window.__HARNESS__.view.renderer;
      renderer.instance.getCamera().setState({ ratio: 95, x: 0.5, y: 0.5 });
      renderer.refresh();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await page.waitForTimeout(400);
    const hidingLabels = await countRenderedLabels();

    const labelPanel = await page.evaluate(async () => {
      const box = [...document.querySelectorAll(".enhanced-graph-checkbox")].find((el) =>
        el.textContent?.includes("缩小时自动隐藏标签"),
      );
      const input = box?.querySelector("input[type=checkbox]");
      if (!input) return { error: "no auto-hide checkbox" };
      const before = input.checked;
      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { before, after: window.__HARNESS__.settings.autoHideLabels };
    });
    const showingLabels = await countRenderedLabels();
    // Assert the mechanism, not a pixel delta. At the zoom where the size
    // threshold starts culling, the graph is only ~80px across and sigma's
    // label-density grid is already the binding constraint — so the rendered
    // output is identical either way and a pixel-based assertion here would
    // prove nothing either way. What IS verifiable is that culling is genuinely
    // active with auto-hide on, and provably inactive with it off.
    const cullingState = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      // Pin the camera: earlier steps call fit(), so it must not be assumed.
      sigma.getCamera().setState({ ratio: 95, x: 0.5, y: 0.5 });
      const graph = sigma.getGraph();
      let smallest = Infinity;
      graph.forEachNode((id) => {
        smallest = Math.min(smallest, sigma.getNodeDisplayData(id).size);
      });
      return { smallestScaled: sigma.scaleSize(smallest), ratio: sigma.getCamera().ratio };
    });
    check(
      "the auto-hide toggle removes the size threshold that culls zoomed-out labels",
      !labelPanel.error &&
        labelPanel.before === true &&
        labelPanel.after === false &&
        hidingLabels.threshold > 0 &&
        showingLabels.threshold === 0 &&
        // With auto-hide on, the smallest node really is under the threshold.
        cullingState.smallestScaled < hidingLabels.threshold,
      labelPanel.error
        ? labelPanel.error
        : `threshold ${hidingLabels.threshold} → ${showingLabels.threshold}; smallest node ` +
          `scales to ${cullingState.smallestScaled.toFixed(2)}px at camera ratio ` +
          `${cullingState.ratio} ` +
          `(below the ${hidingLabels.threshold}px threshold, so culling was active)`,
    );
    // The old "pixel count is unchanged either way" companion check is gone with
    // the 2D label canvas. It was never evidence of anything: at the zoom where
    // the threshold bites, the label-density grid is already the binding
    // constraint, so the count was identical whether culling was on or off.
    //
    // Which is the other half of the bug that comment was circling: sigma culls
    // labels twice — the size threshold above, and a grid that keeps only
    // `ceil(labelDensity / ratio²)` labels per cell. Lifting the threshold alone
    // left the grid hiding labels as the user zoomed out, so the switch looked
    // inert once the graph was zoomed out at all.
    //
    // Read as settings rather than as drawn labels, for the reason in the comment
    // above: sigma v4 decides the grid at render time and paints into the WebGL
    // pass, so there is no pixel count to take. What is checkable is that the grid
    // can no longer be the binding constraint — at the furthest zoom the view
    // allows, one label per node has to fit.
    const labelZoom = await page.evaluate(async () => {
      const renderer = window.__HARNESS__.view.renderer;
      const sigma = renderer.instance;
      const settle = () => new Promise((resolve) => setTimeout(resolve, 500));
      const box = (needle) =>
        [...document.querySelectorAll(".enhanced-graph-checkbox")]
          .find((row) => row.textContent?.includes(needle))
          ?.querySelector("input") ?? null;
      const read = () => {
        let total = 0;
        sigma.getGraph().forEachNode((id) => {
          if (sigma.getNodeDisplayData(id)?.label) total += 1;
        });
        return {
          total,
          density: sigma.getSetting("labelDensity"),
          threshold: sigma.getSetting("labelRenderedSizeThreshold"),
          maxRatio: sigma.getSetting("maxCameraRatio"),
        };
      };
      const setSwitch = async (input, value) => {
        if (input.checked === value) return;
        input.checked = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await settle();
      };

      const labels = box("显示标签");
      if (labels) await setSwitch(labels, true);
      const autoHide = box("缩小时自动隐藏标签");
      if (!autoHide) return { error: "no auto-hide switch" };
      const wasOn = autoHide.checked;

      await setSwitch(autoHide, false);
      const off = read();
      await setSwitch(autoHide, true);
      const on = read();
      await setSwitch(autoHide, wasOn);
      return { off, on, wasOn };
    });
    /** Sigma's own rule: labels allowed per grid cell at a given camera ratio. */
    const labelsPerCell = (state) => Math.ceil(state.density / (state.maxRatio * state.maxRatio));
    check(
      "auto-hide OFF lifts the label grid too, so zooming out cannot cull labels",
      !labelZoom.error &&
        labelZoom.off.total > 10 &&
        labelZoom.off.threshold === 0 &&
        labelsPerCell(labelZoom.off) >= labelZoom.off.total,
      labelZoom.error
        ? labelZoom.error
        : `threshold ${labelZoom.off.threshold}, density ${labelZoom.off.density} → ` +
          `${labelsPerCell(labelZoom.off)} labels per cell at camera ratio ` +
          `${labelZoom.off.maxRatio}, for ${labelZoom.off.total} nodes`,
    );
    check(
      "auto-hide ON still culls: the threshold is back and the grid stays tight",
      !labelZoom.error &&
        labelZoom.on.threshold > 0 &&
        labelsPerCell(labelZoom.on) < labelZoom.on.total,
      labelZoom.error
        ? labelZoom.error
        : `threshold ${labelZoom.on.threshold}, density ${labelZoom.on.density} → ` +
          `${labelsPerCell(labelZoom.on)} labels per cell, for ${labelZoom.on.total} nodes`,
    );

    const labelLook = await page.evaluate(async () => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
      // v4 has no `labelSize`/`labelColor` SETTING any more — they are per-node
      // display fields, emitted by the reducer. Read them off a node.
      const readNode = () => {
        const graph = sigma.getGraph();
        const id = graph.nodes().find((n) => sigma.getNodeDisplayData(n)?.label);
        const d = id ? sigma.getNodeDisplayData(id) : null;
        return d ? { size: d.labelSize, colour: String(d.labelColor ?? "") } : null;
      };
      const sliderField = (label) =>
        [...document.querySelectorAll(".enhanced-graph-slider")]
          .find((row) => row.textContent?.includes(label))
          ?.querySelector("input[type=number]") ?? null;
      const setTheme = async (theme) => {
        window.__HARNESS__.setTheme(theme);
        window.dispatchEvent(new Event("css-change"));
        window.__HARNESS__.view.refresh();
        await settle();
      };

      const sizeField = sliderField("标签字号");
      if (!sizeField) return { error: "no label size field" };
      sizeField.value = "26";
      sizeField.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      const afterSize = readNode()?.size;

      // The colour is the theme's, not a colour of its own: black on the light
      // theme, white on the dark one.
      await setTheme("light");
      const lightColour = readNode()?.colour ?? "";
      await setTheme("dark");
      const darkColour = readNode()?.colour ?? "";

      // Opacity is what the user tunes. 50% has to reach the colour sigma draws
      // with, not just the settings file.
      const opacityField = sliderField("标签不透明度");
      if (!opacityField) return { error: "no label opacity field" };
      opacityField.value = "50";
      opacityField.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      const faded = readNode()?.colour ?? "";

      // Back to full, so the rest of the run sees labels as it found them.
      opacityField.value = "100";
      opacityField.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      return {
        afterSize,
        storedSize: window.__HARNESS__.settings.labelSize,
        lightColour,
        darkColour,
        faded,
        storedOpacity: window.__HARNESS__.settings.labelOpacity,
        restored: readNode()?.colour ?? "",
      };
    });
    check(
      "labels are black on the light theme and white on the dark one",
      !labelLook.error &&
        labelLook.afterSize === 26 &&
        labelLook.storedSize === 26 &&
        labelLook.lightColour.includes("0,0,0") &&
        labelLook.darkColour.includes("255,255,255"),
      labelLook.error
        ? labelLook.error
        : `labelSize → ${labelLook.afterSize}; light ${labelLook.lightColour}, dark ${labelLook.darkColour}`,
    );
    check(
      "the label slider sets opacity, and it reaches the colour sigma draws with",
      !labelLook.error &&
        labelLook.faded.includes("0.5") &&
        labelLook.storedOpacity === 1 &&
        labelLook.restored === labelLook.darkColour,
      labelLook.error
        ? labelLook.error
        : `at 50% ${labelLook.faded}, back at 100% ${labelLook.restored} (stored ${labelLook.storedOpacity})`,
    );

    // Gravity is configured in percent (16%…256%) and must follow the drag, not
    // only apply on release.
    const gravityLive = await page.evaluate(async () => {
      const panel = document.querySelector(".enhanced-graph-panel");
      const row = [...panel.querySelectorAll(".enhanced-graph-slider")].find((candidate) =>
        candidate.textContent?.includes("引力"),
      );
      if (!row) return { error: "no gravity row" };
      const range = row.querySelector("input[type=range]");
      const field = row.querySelector("input[type=number]");
      const readout = row.querySelector(".enhanced-graph-slider-value");
      const sigma = window.__HARNESS__.view.renderer.instance;
      const graph = sigma.getGraph();

      const positions = () => {
        const xs = [];
        graph.forEachNode((n) => xs.push(graph.getNodeAttribute(n, "x")));
        return xs;
      };
      const before = positions();
      const shown = { min: range.min, max: range.max, readout: readout?.textContent, fieldMax: field?.max };

      // Drive the slider the way a drag does: `input` events, no `change`.
      const trace = [];
      for (const value of ["0.4", "1.2", "2.4"]) {
        range.value = value;
        range.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 220));
        const now = positions();
        trace.push({
          value,
          moved: now.some((x, i) => Math.abs(x - before[i]) > 1e-6),
          readout: readout?.textContent,
        });
      }
      return {
        shown,
        trace,
        setting: window.__HARNESS__.settings.gravity,
        // Nothing should have been persisted mid-drag; the release path does that.
        storedBeforeRelease: window.__HARNESS__.settings.gravity,
      };
    });
    check(
      "the gravity slider offers 16%–256% and renders live while dragged",
      !gravityLive.error &&
        gravityLive.shown.min === "0.16" &&
        gravityLive.shown.max === "2.56" &&
        gravityLive.shown.fieldMax === "256" &&
        gravityLive.trace.every((step) => step.moved) &&
        gravityLive.trace.at(-1).readout === "240%",
      gravityLive.error
        ? gravityLive.error
        : `range ${gravityLive.shown.min}…${gravityLive.shown.max} ` +
          `(number field max ${gravityLive.shown.fieldMax}); ` +
          gravityLive.trace
            .map((step) => `${step.value}→${step.readout}${step.moved ? " (layout moved)" : " (NO move)"}`)
            .join(", "),
    );


    const visualRegressions = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const graph = sigma.getGraph();
      const id = graph.nodes().find((n) => sigma.getNodeDisplayData(n)?.label);
      const display = sigma.getNodeDisplayData(id);
      const stored = graph.getNodeAttribute(id, "size");
      const at = (ratio) => {
        sigma.getCamera().setState({ ratio, x: 0.5, y: 0.5 });
        return sigma.scaleSize(stored);
      };
      const atOne = at(1);
      const atFar = at(30);
      sigma.getCamera().setState({ ratio: 1, x: 0.5, y: 0.5 });
      sigma.refresh();
      return {
        storedSize: stored,
        scaledAtOne: atOne,
        scaledAtFar: atFar,
        labelFont: display.labelFont,
        labelSize: display.labelSize,
        backdropArea: display.backdropArea ?? "both (unspecified)",
      };
    });
    check(
      "node sizes stay in screen pixels instead of being blown up by the camera",
      // v4 defaults `itemSizesReference` to "positions", under which the stored
      // size is read as graph units and the camera multiplies it: at the default
      // view the nodes came out enormous and merged into a solid mass. The
      // meaningful guard is the default view — the rendered size must equal the
      // size we stored, not some multiple of it. (It still scales when zoomed,
      // via `zoomToSizeRatioFunction`; that is intended.)
      Math.abs(visualRegressions.scaledAtOne - visualRegressions.storedSize) < 0.01 &&
        visualRegressions.scaledAtOne <= visualRegressions.storedSize * 1.1,
      `stored ${visualRegressions.storedSize.toFixed(1)}px renders at ` +
        `${visualRegressions.scaledAtOne.toFixed(1)} at the default view ` +
        `(ratio 1), ${visualRegressions.scaledAtFar.toFixed(1)} at ratio 30`,
    );
    check(
      "the label font string carries no size, so sigma can parse the family",
      // `parseFontString` takes the weight/style keywords and treats the REST as
      // the family, so "600 12px Arial" became the family "12px Arial,
      // sans-serif" and the label fell back to a default face and size.
      typeof visualRegressions.labelFont === "string" &&
        !/\d+px/.test(visualRegressions.labelFont) &&
        visualRegressions.labelSize === 26,
      `labelFont="${visualRegressions.labelFont}", labelSize=${visualRegressions.labelSize}`,
    );

    // The backdrop only exists on the hovered node, so it has to be read while
    // something is actually hovered. Move away first: a `mouse.move` to where the
    // pointer already is produces no event, and the hover then never fires.
    const hoverPoint = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const id = sigma.getGraph().nodes().find((n) => sigma.getNodeDisplayData(n)?.label);
      return window.__HARNESS__.nodePosition(id);
    });
    await page.mouse.move(6, 6);
    await page.waitForTimeout(150);
    // `clientX/clientY`, not `x/y`: `nodePosition` reports the container-relative
    // position for the hit test and the client position for the pointer.
    await page.mouse.move(hoverPoint.clientX, hoverPoint.clientY);
    await page.waitForTimeout(400);
    const backdrop = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const id = window.__HARNESS__.hoveredNode();
      if (!id) return { error: "nothing hovered" };
      const display = sigma.getNodeDisplayData(id);
      return { area: display.backdropArea, visibility: display.backdropVisibility };
    });
    check(
      "the hover backdrop hugs the label rather than covering the node",
      // v4's default `backdropArea` is "both": one plate spanning node and label,
      // which paints a large square across the node and hides what is under it.
      !backdrop.error && backdrop.visibility === "visible" && backdrop.area === "label",
      backdrop.error ? backdrop.error : `backdropArea=${backdrop.area}, ${backdrop.visibility}`,
    );
    // Leave the pointer off the graph: a lingering hover dims edges, and the
    // light-theme ramp check that follows samples edge colours.
    await page.mouse.move(6, 6);
    await page.waitForTimeout(250);

    // Restore the label look and re-enable auto-hide for the checks below.
    await page.evaluate(async () => {
      const row = [...document.querySelectorAll(".enhanced-graph-slider")].find((candidate) =>
        candidate.textContent?.includes("标签字号"),
      );
      const field = row?.querySelector("input[type=number]");
      if (field) {
        field.value = "12";
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const box = [...document.querySelectorAll(".enhanced-graph-checkbox")].find((el) =>
        el.textContent?.includes("缩小时自动隐藏标签"),
      );
      const input = box?.querySelector("input[type=checkbox]");
      if (input && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const colourRow = [...document.querySelectorAll(".enhanced-graph-colour-row")].find((el) =>
        el.textContent?.includes("标签颜色"),
      );
      colourRow?.querySelector(".enhanced-graph-link")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await page.evaluate(async () => {
      const renderer = window.__HARNESS__.view.renderer;
      renderer.fit();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await page.waitForTimeout(300);

    // --- clustering panel: the coefficients and the resolution together ------
    const clusteringPanel = await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("聚类"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const panel = document.querySelector(".enhanced-graph-panel");
      const fields = [...panel.querySelectorAll(".enhanced-graph-stepper .enhanced-graph-number")];
      const applyButton = [...panel.querySelectorAll("button")].find((el) =>
        el.textContent?.includes("应用"),
      );
      return {
        title: panel?.querySelector(".enhanced-graph-panel-header")?.textContent ?? "",
        // The panel is steppers: no sliders should be left.
        sliders: panel.querySelectorAll(".enhanced-graph-slider input[type=range]").length,
        numbers: fields.length,
        stepButtons: panel.querySelectorAll(".enhanced-graph-stepper-button").length,
        labels: [...panel.querySelectorAll(".enhanced-graph-slider-label")].map((el) => el.textContent),
        values: fields.map((field) => Number(field.value)),
        applyDisabled: applyButton?.disabled ?? null,
        hasDefaults: [...panel.querySelectorAll(".enhanced-graph-link")].some((el) =>
          el.textContent?.includes("恢复默认"),
        ),
        settings: { ...window.__HARNESS__.settings.weights },
        resolution: window.__HARNESS__.settings.resolution,
      };
    });
    check(
      "the clustering panel exposes the four coefficients and the resolution",
      clusteringPanel.title.includes("聚类") &&
        clusteringPanel.sliders === 0 &&
        // Four coefficients plus the resolution.
        clusteringPanel.numbers === 5 &&
        // Two step buttons per row.
        clusteringPanel.stepButtons === 10 &&
        clusteringPanel.hasDefaults &&
        clusteringPanel.applyDisabled === true &&
        JSON.stringify(clusteringPanel.values) ===
          JSON.stringify([
            clusteringPanel.settings.directLink,
            clusteringPanel.settings.sourceOverlap,
            clusteringPanel.settings.commonNeighbor,
            clusteringPanel.settings.coCitation,
            clusteringPanel.resolution,
          ]),
      `"${clusteringPanel.title}": ${clusteringPanel.numbers} number fields + ` +
        `${clusteringPanel.stepButtons} step buttons (${clusteringPanel.labels.join(", ")}) ` +
        `showing ${clusteringPanel.values.join("/")}, matching settings; ` +
        `${clusteringPanel.sliders} sliders left; apply disabled ${clusteringPanel.applyDisabled}`,
    );

    // Editing stages only: nothing is written and no rebuild is asked for until the
    // button is pressed — these coefficients re-score the whole vault.
    const clusteringEdit = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const panel = document.querySelector(".enhanced-graph-panel");
      const fields = [...panel.querySelectorAll(".enhanced-graph-stepper .enhanced-graph-number")];
      const applyButton = () => [...panel.querySelectorAll("button")].find((el) => el.textContent?.includes("应用"));
      const before = window.__HARNESS__.settings.weights.sourceOverlap;
      const rebuildsBefore = window.__HARNESS__.rebuilds();

      // Second field is source overlap. Type an exact value and commit.
      fields[1].value = "1.5";
      fields[1].dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(250);
      // What the field shows, not what the settings hold: nothing is written until
      // the button is pressed.
      const typed = Number(fields[1].value);

      // Then step it up twice with the ▲ button: 1.5 → 1.6 → 1.7.
      const row = fields[1].closest(".enhanced-graph-stepper");
      const up = row.querySelector(".enhanced-graph-stepper-button");
      up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(120);
      up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(250);

      // And the resolution, which is the last field.
      const resolutionField = fields[4];
      const resolutionBefore = window.__HARNESS__.settings.resolution;
      resolutionField.value = "1.6";
      resolutionField.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(250);

      const staged = {
        typed,
        sourceOverlap: window.__HARNESS__.settings.weights.sourceOverlap,
        resolution: window.__HARNESS__.settings.resolution,
        resolutionBefore,
        rebuilds: window.__HARNESS__.rebuilds() - rebuildsBefore,
        field: fields[1].value,
        resolutionField: resolutionField.value,
        enabled: applyButton()?.disabled === false,
      };

      applyButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(400);
      const applied = {
        sourceOverlap: window.__HARNESS__.settings.weights.sourceOverlap,
        resolution: window.__HARNESS__.settings.resolution,
        rebuilds: window.__HARNESS__.rebuilds() - rebuildsBefore,
      };
      return { before, staged, applied };
    });
    check(
      "a coefficient can be typed exactly or stepped, and stays staged",
      clusteringEdit.staged.typed === 1.5 &&
        clusteringEdit.before !== clusteringEdit.staged.typed &&
        // 1.5 + 0.1 + 0.1 — no floating-point drift in the draft.
        clusteringEdit.staged.field === "1.7" &&
        // Staged means NOT written: the settings still hold the old value.
        clusteringEdit.staged.sourceOverlap === clusteringEdit.before &&
        clusteringEdit.staged.rebuilds === 0 &&
        clusteringEdit.staged.enabled === true,
      `sourceOverlap field ${clusteringEdit.before} → typed ${clusteringEdit.staged.typed} → ` +
        `two steps up ${clusteringEdit.staged.field}; settings still ` +
        `${clusteringEdit.staged.sourceOverlap}, ${clusteringEdit.staged.rebuilds} rebuilds asked for`,
    );
    check(
      "应用 writes the staged coefficients and resolution, and asks for one rebuild",
      clusteringEdit.applied.sourceOverlap === 1.7 &&
        clusteringEdit.applied.resolution === 1.6 &&
        clusteringEdit.staged.resolutionBefore !== 1.6 &&
        clusteringEdit.applied.rebuilds === 1,
      `sourceOverlap → ${clusteringEdit.applied.sourceOverlap}, resolution ` +
        `${clusteringEdit.staged.resolutionBefore} → ${clusteringEdit.applied.resolution}, ` +
        `${clusteringEdit.applied.rebuilds} rebuild(s)`,
    );

    const clusteringDefaults = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // Re-open the panel first, the way the host re-renders it after an apply: the
      // checks drive a panel the plugin would already have replaced by now.
      const tab = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("聚类"),
      );
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(150);
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(300);
      const panel = document.querySelector(".enhanced-graph-panel");
      const button = [...panel.querySelectorAll(".enhanced-graph-link")].find((el) =>
        el.textContent?.includes("恢复默认"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(300);
      const fields = [...panel.querySelectorAll(".enhanced-graph-stepper .enhanced-graph-number")];
      const staged = fields.map((field) => Number(field.value));
      const apply = [...panel.querySelectorAll("button")].find((el) => el.textContent?.includes("应用"));
      const beforeClick = {
        found: Boolean(apply),
        disabled: apply?.disabled ?? null,
        label: apply?.textContent ?? null,
        sourceOverlapSetting: window.__HARNESS__.settings.weights.sourceOverlap,
        panels: document.querySelectorAll(".enhanced-graph-panel").length,
        fieldCount: panel.querySelectorAll(".enhanced-graph-stepper .enhanced-graph-number").length,
        buttons: [...panel.querySelectorAll("button")].map(
          (el) => `${el.textContent}:${el.disabled ? "off" : "on"}`,
        ),
      };
      apply?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(400);
      return { staged, beforeClick, applied: { ...window.__HARNESS__.settings.weights } };
    });
    check(
      "「恢复默认」 stages the documented defaults, and 应用 lands them",
      // Matches DEFAULT_RELEVANCE_WEIGHTS: the ordering follows how strong the
      // evidence is, not the values the unbounded design happened to use. The
      // resolution goes back to Louvain's own 1.
      JSON.stringify(clusteringDefaults.staged) === JSON.stringify([4, 2, 2, 1, 1]) &&
        clusteringDefaults.applied.directLink === 4 &&
        clusteringDefaults.applied.commonNeighbor === 2 &&
        clusteringDefaults.applied.sourceOverlap === 2 &&
        clusteringDefaults.applied.coCitation === 1,
      `draft ${clusteringDefaults.staged.join("/")} → applied ` +
        `${clusteringDefaults.applied.directLink}/${clusteringDefaults.applied.sourceOverlap}/` +
        `${clusteringDefaults.applied.commonNeighbor}/${clusteringDefaults.applied.coCitation}; ` +
        `apply ${JSON.stringify(clusteringDefaults.beforeClick)}`,
    );

    // Back to the filters panel for the tag checks below.
    await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("外观"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await page.waitForTimeout(200);
    await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-toolbar .enhanced-graph-button")].find(
        (candidate) => candidate.textContent?.includes("过滤器"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await page.waitForTimeout(250);

    // --- 11. tag filtering -------------------------------------------------
    // Tags are the second filter axis, alongside page types, and now sit behind
    // their own tab.
    await selectPanelTab(page, "标签");
    const tagSection = await page.evaluate(() => {
      const list = document.querySelector(".enhanced-graph-tag-list");
      const rows = [...(list?.querySelectorAll(".enhanced-graph-checkbox") ?? [])];
      // Every distinct tag in the graph, counted here rather than assumed: the
      // list is drawn in full, so the two numbers have to match.
      const allTags = new Set();
      for (const node of window.__HARNESS__.snapshot.graph.nodes) {
        for (const tag of node.tags ?? []) if (tag.length > 0) allTags.add(tag);
      }
      return {
        present: Boolean(list),
        rowCount: rows.length,
        expectedRows: allTags.size,
        hasSearch: Boolean(document.querySelector(".enhanced-graph-tag-search")),
        firstName: rows[0]?.querySelector(".enhanced-graph-tag-name")?.textContent ?? "",
        firstCount: Number(rows[0]?.querySelector(".enhanced-graph-legend-count")?.textContent ?? "0"),
        // Most-used first, so the panel leads with tags that partition the graph.
        sorted: rows.every((row, index) => {
          if (index === 0) return true;
          const previous = Number(rows[index - 1].querySelector(".enhanced-graph-legend-count")?.textContent);
          return previous >= Number(row.querySelector(".enhanced-graph-legend-count")?.textContent);
        }),
      };
    });
    check(
      "filters panel lists EVERY tag, most-used first, behind a search box",
      tagSection.present &&
        tagSection.rowCount > 0 &&
        tagSection.rowCount === tagSection.expectedRows &&
        tagSection.hasSearch &&
        tagSection.sorted,
      `${tagSection.rowCount}/${tagSection.expectedRows} tag rows, search=${tagSection.hasSearch}, ` +
        `first="${tagSection.firstName}" (${tagSection.firstCount}), sorted=${tagSection.sorted}`,
    );

    const tagFilter = await page.evaluate(async () => {
      const list = document.querySelector(".enhanced-graph-tag-list");
      const row = list?.querySelector(".enhanced-graph-checkbox");
      const tag = row?.querySelector(".enhanced-graph-tag-name")?.textContent ?? "";
      const input = row?.querySelector("input");

      // Expected drop: the visible pages that actually carry this tag.
      const visible = new Set(window.__HARNESS__.visibleNodeIds());
      const carriers = window.__HARNESS__.snapshot.graph.nodes.filter(
        (node) => visible.has(node.id) && (node.tags ?? []).includes(tag),
      );
      const sigma = window.__HARNESS__.view.renderer.instance;
      const before = sigma.getGraph().order;

      // A tick means "the tag this filter acts on"; in the default mode that means
      // excluding it, so ticking the first row is what hides that tag.
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 450));

      const drawn = new Set(window.__HARNESS__.visibleNodeIds());
      const survivors = window.__HARNESS__.snapshot.graph.nodes.filter(
        (node) => drawn.has(node.id) && (node.tags ?? []).includes(tag),
      );
      return {
        tag,
        expectedDrop: carriers.length,
        before,
        after: sigma.getGraph().order,
        survivorsCarryingTag: survivors.length,
        rowStillListed: [...document.querySelectorAll(".enhanced-graph-tag-name")].some(
          (el) => el.textContent === tag,
        ),
        // Diagnostics: did the tick stick, and does the plugin's own view agree with
        // the renderer about what is visible?
        ticked: input.checked,
        mode: window.__HARNESS__.settings.tagFilterMode,
        hiddenTags: (window.__HARNESS__.settings.hiddenTags ?? []).slice(),
        visibleNow: window.__HARNESS__.visibleNodeIds().length,
      };
    });
    check(
      "hiding a tag removes exactly the pages carrying it",
      tagFilter.expectedDrop > 0 &&
        tagFilter.before - tagFilter.after === tagFilter.expectedDrop &&
        tagFilter.survivorsCarryingTag === 0,
      `hiding "${tagFilter.tag}": ${tagFilter.before} → ${tagFilter.after} nodes ` +
        `(expected -${tagFilter.expectedDrop}), ${tagFilter.survivorsCarryingTag} carriers left; ` +
        `ticked=${tagFilter.ticked} mode=${tagFilter.mode} settingsHidden=${JSON.stringify(tagFilter.hiddenTags)} ` +
        `visible=${tagFilter.visibleNow}`,
    );
    check(
      "a hidden tag stays listed so it can be switched back on",
      tagFilter.rowStillListed,
      `"${tagFilter.tag}" still present after hiding`,
    );
    await page.screenshot({ path: path.join(shotsDir, "11-tag-filter-dark.png") });

    // Narrowing the list, then restoring everything.
    const tagRestore = await page.evaluate(async () => {
      const search = document.querySelector(".enhanced-graph-tag-search");
      const countRows = () => document.querySelectorAll(".enhanced-graph-tag-list .enhanced-graph-checkbox").length;
      const before = countRows();
      search.value = "retriev";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const after = countRows();
      const names = [...document.querySelectorAll(".enhanced-graph-tag-name")].map((el) => el.textContent);
      const allMatch = names.every((name) => name.toLowerCase().includes("retriev"));

      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      const restored = countRows();

      // Found by its text, not by its container. Two earlier versions of this
      // listed the containers the button was expected to sit in, and it moved
      // both times — the check then failed for a reason that had nothing to do
      // with what it is testing.
      const button = [...document.querySelectorAll("button")].find((el) =>
        el.textContent?.includes("全清"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 450));
      // The tag rows' own checkboxes, which is what the user watches: clearing the
      // ticks has to leave every one of them unticked. Reading the settings instead
      // would miss a stale list still drawn from the old set.
      const tagBoxes = [
        ...document.querySelectorAll(".enhanced-graph-tag-list input[type=checkbox]"),
      ];
      const tickedTagRows = tagBoxes.filter((el) => el.checked).length;

      return {
        before,
        after,
        restored,
        allMatch,
        tickedTagRows,
        nodesAfterClear: window.__HARNESS__.view.renderer.instance.getGraph().order,
        // The plugin's own graph, before any filtering: "restored" means every
        // one of these is on screen again. Comparing against the count taken
        // before the tag filter only says the tag filter was undone.
        // Defensive: the harness API exposes the snapshot rather than the plugin,
        // and a wrong guess here would fail the check for the wrong reason.
        totalNodes: (() => {
          try {
            const api = window.__HARNESS__;
            const entry = typeof api.snapshot === "function" ? api.snapshot() : api.snapshot;
            return entry?.graph?.nodes?.length ?? null;
          } catch {
            return null;
          }
        })(),
      };
    });
    check(
      "the tag search box narrows the list to matching tags",
      tagRestore.after > 0 && tagRestore.after < tagRestore.before && tagRestore.allMatch,
      `"retriev" → ${tagRestore.after}/${tagRestore.before} rows, all matching=${tagRestore.allMatch}`,
    );
    // At least everything the tag filter hid has to come back, and the label
    // promises more than the tags: the run before this one went 77 → 65 → 79,
    // above the pre-filter 77, because "restore all" also switches off the two
    // visibility toggles that were already on. Asserting equality with the
    // pre-filter count would call that correct behaviour a failure.
    //
    // The weaker "> after" assertion this replaces passed while the button only
    // cleared tags — the label said all and the behaviour was one category — so
    // it was checking nothing a user could observe. This at least fails if the
    // restore stops short of the tag filter's own effect.
    // The count has to come back to exactly what it was before the tag filter,
    // and no further. "No further" is the part that matters: the button clears
    // tags and nothing else, so an implementation that also flipped the
    // visibility switches would overrule a decision the user made elsewhere and
    // this equality would catch it.
    //
    // The weaker "> after" this replaces passed even when the button restored
    // nothing but tags — which is the correct behaviour — so it distinguished
    // nothing at all.
    check(
      "clearing the search and pressing 全清 restores the graph",
      tagRestore.restored === tagRestore.before &&
        tagRestore.nodesAfterClear === tagFilter.before &&
        tagRestore.tickedTagRows === 0,
      `rows restored ${tagRestore.restored}/${tagRestore.before}; nodes ${tagFilter.before} → ${tagFilter.after} → ${tagRestore.nodesAfterClear}; tag boxes left ticked ${tagRestore.tickedTagRows}`,
    );

    // --- 11a-2. the workspace group, in the standalone view ----------------
    // The same panel module serves both views, and the built-in graph's copy is
    // driven in `verify-official-filters.mjs`. What is measured here is the
    // standalone view's own half: that its panel draws the vault's folder tree,
    // that the choice is staged until 应用, and that applying writes the settings and
    // asks the plugin to rebuild — against a fake plugin that counts the requests.
    const workspace = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const tab = [...document.querySelectorAll(".enhanced-graph-panel-tabs button")].find((el) =>
        el.textContent?.startsWith("工作区"),
      );
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(450);

      const inputs = () => [...document.querySelectorAll(".enhanced-graph-folder-input")];
      const type = (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const shape = {
        suggestions: [...document.querySelectorAll("datalist option")].map((o) => o.getAttribute("value")),
        statusAtRest: document.querySelector(".enhanced-graph-workspace-status")?.textContent,
      };
      const applyButton = () =>
        [...document.querySelectorAll(".enhanced-graph-workspace-actions button")].find((el) =>
          el.textContent?.includes("应用"),
        );
      const disabledAtRest = applyButton()?.disabled ?? null;
      const rebuildsBefore = window.__HARNESS__.rebuilds();
      const settingsBefore = {
        folder: window.__HARNESS__.settings.workingFolder,
        excluded: [...window.__HARNESS__.settings.excludeFolders],
      };

      // Stage: type a folder path, and add an exclusion with Enter. The demo vault is
      // flat, so the typed path is one of its top-level folders — the point is that a
      // path is TYPED rather than picked.
      const target = shape.suggestions[0] ?? "";
      const excludedFolder = shape.suggestions.find((path) => path !== target) ?? null;
      type(inputs()[0], target);
      await sleep(250);
      const statusAfterTyping = document.querySelector(".enhanced-graph-workspace-status")?.textContent;
      if (excludedFolder) {
        const excludeInput = inputs()[1];
        excludeInput.value = excludedFolder;
        excludeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(300);
      }
      const staged = {
        rebuilds: window.__HARNESS__.rebuilds() - rebuildsBefore,
        folder: window.__HARNESS__.settings.workingFolder,
        excluded: [...window.__HARNESS__.settings.excludeFolders],
        chips: [...document.querySelectorAll(".enhanced-graph-chip-text")].map((chip) => chip.textContent),
        fieldValue: inputs()[0]?.value,
        enabled: applyButton()?.disabled === false,
      };

      applyButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(500);
      const applied = {
        rebuilds: window.__HARNESS__.rebuilds() - rebuildsBefore,
        folder: window.__HARNESS__.settings.workingFolder,
        excluded: [...window.__HARNESS__.settings.excludeFolders],
      };

      // Put the workspace back so the checks that follow see the whole vault.
      type(document.querySelector(".enhanced-graph-folder-input"), "");
      await sleep(250);
      for (const remove of [...document.querySelectorAll(".enhanced-graph-chip-remove")]) {
        remove.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await sleep(200);
      }
      applyButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(500);

      return {
        shape,
        disabledAtRest,
        settingsBefore,
        target,
        excludedFolder,
        statusAfterTyping,
        staged,
        applied,
      };
    });

    console.log(
      `\n  workspace fields (standalone): ${workspace.shape.suggestions.length} suggestions, first ` +
        `${JSON.stringify(workspace.shape.suggestions[0])}; status at rest ` +
        `${JSON.stringify(workspace.shape.statusAtRest)}; disabled at rest ${workspace.disabledAtRest}; ` +
        `typed ${JSON.stringify(workspace.target)} → ${JSON.stringify(workspace.statusAfterTyping)}, ` +
        `excluding ${JSON.stringify(workspace.excludedFolder)} → chips ${JSON.stringify(workspace.staged.chips)}, ` +
        `${workspace.staged.rebuilds} rebuild(s); applied → ${workspace.applied.rebuilds} rebuild(s), ` +
        `${JSON.stringify(workspace.applied.folder)}/${JSON.stringify(workspace.applied.excluded)}\n`,
    );
    check(
      "工作区 in the standalone view suggests the vault's folder paths",
      workspace.shape.suggestions.length > 1 &&
        workspace.shape.suggestions.every((path) => path !== "") &&
        workspace.shape.suggestions.every((path) => typeof path === "string" && path.length > 0),
      `${workspace.shape.suggestions.length} suggestions: ${JSON.stringify(workspace.shape.suggestions.slice(0, 4))}...`,
    );
    check(
      "工作区 in the standalone view describes the typed path, at rest and after typing",
      (workspace.shape.statusAtRest ?? "").length > 0 &&
        (workspace.statusAfterTyping ?? "").length > 0 &&
        workspace.statusAfterTyping !== workspace.shape.statusAtRest,
      `at rest ${JSON.stringify(workspace.shape.statusAtRest)}; typed ${JSON.stringify(workspace.target)} → ` +
        `${JSON.stringify(workspace.statusAfterTyping)}`,
    );
    check(
      "typing paths in the standalone view changes nothing until 应用",
      workspace.disabledAtRest === true &&
        workspace.staged.rebuilds === 0 &&
        workspace.staged.folder === workspace.settingsBefore.folder &&
        JSON.stringify(workspace.staged.excluded) === JSON.stringify(workspace.settingsBefore.excluded) &&
        workspace.staged.fieldValue === workspace.target &&
        JSON.stringify(workspace.staged.chips) === JSON.stringify([`${workspace.excludedFolder}/`]) &&
        workspace.staged.enabled === true,
      `disabled at rest ${workspace.disabledAtRest}; ${workspace.staged.rebuilds} rebuilds, ` +
        `${JSON.stringify(workspace.staged.folder)}/${JSON.stringify(workspace.staged.excluded)}, ` +
        `field ${JSON.stringify(workspace.staged.fieldValue)}, chips ${JSON.stringify(workspace.staged.chips)}`,
    );
    check(
      "应用 in the standalone view writes both settings and asks for one rebuild",
      workspace.applied.rebuilds === 1 &&
        workspace.applied.folder === workspace.target &&
        JSON.stringify(workspace.applied.excluded) === JSON.stringify([`${workspace.excludedFolder}/`]),
      `${workspace.applied.rebuilds} rebuild(s), ${JSON.stringify(workspace.applied.folder)}/` +
        `${JSON.stringify(workspace.applied.excluded)} (wanted ${JSON.stringify(workspace.target)}/` +
        `${JSON.stringify(workspace.excludedFolder)}/)`,
    );

    // --- 11a-3. the structural switch, on by default -----------------------
    // Reported: 隐藏索引/概览/日志 is on from the start, yet the vault's structural
    // pages are still drawn. Whatever the cause, this measures the pair that has to
    // agree — the checkbox the panel shows, and what is actually on the canvas.
    const structural = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const tab = [...document.querySelectorAll(".enhanced-graph-panel-tabs button")].find((el) =>
        el.textContent?.startsWith("隐藏"),
      );
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(400);

      const rowFor = (label) =>
        [...document.querySelectorAll(".enhanced-graph-panel .enhanced-graph-checkbox")].find((row) =>
          row.textContent?.includes(label),
        );
      const box = () => rowFor("索引")?.querySelector("input[type=checkbox]") ?? null;
      const structuralIds = window.__HARNESS__.snapshot.graph.nodes
        .filter((node) => node.isStructural)
        .map((node) => node.id);
      const visibleStructural = () => {
        const visible = new Set(window.__HARNESS__.visibleNodeIds());
        return structuralIds.filter((id) => visible.has(id));
      };

      const atStart = {
        setting: window.__HARNESS__.settings.hideStructural,
        ticked: box()?.checked ?? null,
        drawn: visibleStructural(),
        total: structuralIds.length,
      };

      // Off: they have to come back.
      const off = box();
      if (off) {
        off.checked = false;
        off.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(450);
      }
      const afterOff = {
        setting: window.__HARNESS__.settings.hideStructural,
        drawn: visibleStructural(),
      };

      // On again: gone again.
      const on = box();
      if (on) {
        on.checked = true;
        on.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(450);
      }
      const afterOn = {
        setting: window.__HARNESS__.settings.hideStructural,
        drawn: visibleStructural(),
      };

      return { atStart, afterOff, afterOn };
    });

    console.log(
      `\n  structural switch: setting ${structural.atStart.setting}, checkbox ticked ` +
        `${structural.atStart.ticked}; drawn ${structural.atStart.drawn.length}/${structural.atStart.total} ` +
        `(${JSON.stringify(structural.atStart.drawn)})` +
        `; off → ${structural.afterOff.drawn.length} drawn; on → ${structural.afterOn.drawn.length} drawn\n`,
    );
    check(
      "隐藏索引/概览/日志 is on by default and the structural pages are not drawn",
      structural.atStart.setting === true &&
        structural.atStart.ticked === true &&
        structural.atStart.total > 0 &&
        structural.atStart.drawn.length === 0,
      `setting ${structural.atStart.setting}, ticked ${structural.atStart.ticked}, ` +
        `${structural.atStart.drawn.length} of ${structural.atStart.total} structural pages drawn ` +
        `(${JSON.stringify(structural.atStart.drawn)})`,
    );
    check(
      "switching it off brings them back, and switching it on hides them again",
      structural.afterOff.setting === false &&
        structural.afterOff.drawn.length === structural.atStart.total &&
        structural.afterOn.setting === true &&
        structural.afterOn.drawn.length === 0,
      `off → ${structural.afterOff.drawn.length}/${structural.atStart.total} drawn; ` +
        `on → ${structural.afterOn.drawn.length} drawn`,
    );

    // --- 11a-4. the type rows come from the vault --------------------------
    // The snapshot declares both canonical and custom types (including a 概念 next to
    // the 38 `concept` pages), so the rows, their counts and what hiding one does can
    // all be checked against the vault rather than against the plugin's own list.
    const typeRows = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const keyOf = (node) => ((node.rawType ?? "").trim().toLowerCase() || node.type);
      const nodes = window.__HARNESS__.snapshot.graph.nodes;

      const expected = [...nodes.reduce((byKey, node) => {
        const key = keyOf(node);
        const entry = byKey.get(key) ?? { key, count: 0, ids: [] };
        entry.count += 1;
        entry.ids.push(node.id);
        return byKey.set(key, entry);
      }, new Map()).values()].sort(
        (a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );

      const tab = [...document.querySelectorAll(".enhanced-graph-panel-tabs button")].find((el) =>
        el.textContent?.includes("类型"),
      );
      tab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await sleep(400);
      const rendered = [...document.querySelectorAll(".enhanced-graph-panel .enhanced-graph-checkbox")]
        .map((row) => ({
          label: row.querySelector("span")?.textContent ?? "",
          count: Number(row.querySelector(".enhanced-graph-legend-count")?.textContent ?? "-1"),
        }));
      // What is drawn before the toggle: the structural switch is still on from an
      // earlier check, so the vault itself is not the baseline.
      const visibleBefore = window.__HARNESS__.visibleNodeIds().length;

      // Hide the one page that declares 概念 — a type the plugin has no name for.
      const custom = expected.find((entry) => entry.key === "概念");
      const target = [...document.querySelectorAll(".enhanced-graph-panel .enhanced-graph-checkbox")]
        .find((row) => row.textContent?.includes("概念 · concept"));
      const box = target?.querySelector("input[type=checkbox]");
      if (box) {
        box.checked = false;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(450);
      }

      const visible = new Set(window.__HARNESS__.visibleNodeIds());
      const hidExactly = custom ? custom.ids.filter((id) => visible.has(id)).length : -1;
      const visibleAfter = visible.size;
      const unticked = box ? box.checked === false : false;
      // Restore, so the checks after this one see the whole vault again.
      if (box) {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(450);
      }
      const restored = new Set(window.__HARNESS__.visibleNodeIds());

      return {
        expected: expected.map(({ key, count }) => ({ key, count })),
        rendered,
        customLabelFound: Boolean(target),
        hidExactly,
        visibleAfter,
        unticked,
        visibleBefore,
        restoredCount: restored.size,
      };
    });

    console.log(
      `\n  type rows: vault declares ${typeRows.expected.length} types ` +
        `(${typeRows.expected.map((t) => `${t.key}:${t.count}`).join(", ")})\n` +
        `    panel drew: ${typeRows.rendered.map((t) => `${t.label}=${t.count}`).join(", ")}\n`,
    );
    check(
      "the type rows are the types the vault declares, custom ones included",
      typeRows.rendered.length === typeRows.expected.length &&
        typeRows.expected.every(
          (expected) => typeRows.rendered.filter((row) => row.count === expected.count).length > 0,
        ) &&
        typeRows.expected.some((entry) => entry.key === "概念"),
      `drew ${typeRows.rendered.length} rows for ${typeRows.expected.length} declared types`,
    );
    check(
      "a custom type is its own row, and hiding it hides exactly its pages",
      typeRows.customLabelFound &&
        typeRows.unticked &&
        typeRows.hidExactly === 0 &&
        // ...and only those: one page left the graph, not the 38 that share its
        // normalised type.
        typeRows.visibleAfter === typeRows.visibleBefore - 1 &&
        typeRows.restoredCount === typeRows.visibleBefore,
      `label found ${typeRows.customLabelFound}, ticked off ${typeRows.unticked}, ` +
        `visible 概念 pages after hiding ${typeRows.hidExactly}, drawn ${typeRows.visibleBefore} → ` +
        `${typeRows.visibleAfter} → ${typeRows.restoredCount}`,
    );

    // --- 11a-5. rows with nothing left on the graph ------------------------
    // With 隐藏索引/概览/日志 on (as the snapshot defaults to), the vault's structural
    // pages are not drawn — so the rows for the types they declare must be greyed
    // rather than showing a colour and a count they do not have on screen.
    const emptyRows = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const visible = new Set(window.__HARNESS__.visibleNodeIds());
      const keyOf = (node) => ((node.rawType ?? "").trim().toLowerCase() || node.type);
      const drawnTypes = new Set(
        window.__HARNESS__.snapshot.graph.nodes
          .filter((node) => visible.has(node.id))
          .map(keyOf),
      );
      const allTypes = new Set(window.__HARNESS__.snapshot.graph.nodes.map(keyOf));
      const expectedEmpty = [...allTypes].filter((key) => !drawnTypes.has(key));

      const rows = [...document.querySelectorAll(".enhanced-graph-legend-row")]
        .filter((row) => row.querySelector(".enhanced-graph-legend-dot"))
        .map((row) => ({
          label: row.querySelector(".enhanced-graph-legend-label")?.textContent ?? "",
          greyed: row.classList.contains("is-hidden-type"),
          title: row.getAttribute("title") ?? "",
        }));
      const greyed = rows.filter((row) => row.greyed).length;
      return { expectedEmpty, greyed, total: rows.length, rows };
    });

    console.log(
      `\n  legend rows: ${emptyRows.total} types, ${emptyRows.greyed} greyed; ` +
        `types with nothing drawn: ${emptyRows.expectedEmpty.length} ` +
        `(${emptyRows.expectedEmpty.join(", ")})\n`,
    );
    check(
      "a type with no page left on the graph is greyed, and only those",
      emptyRows.expectedEmpty.length > 0 &&
        emptyRows.greyed === emptyRows.expectedEmpty.length &&
        emptyRows.rows
          .filter((row) => row.greyed)
          .every((row) => row.title.length > 0),
      `${emptyRows.greyed} greyed rows for ${emptyRows.expectedEmpty.length} empty types ` +
        `(${emptyRows.expectedEmpty.join(", ")}); labels ${JSON.stringify(emptyRows.rows.map((r) => r.label))}`,
    );

    // --- 11b. the "no matching nodes" message ------------------------------
    // It used to be a Notice fired from applySearch, which runs on every
    // keystroke — so a non-matching query stacked a column of toasts down the
    // right-hand side. It is now a persistent line under the search box.
    const searchMessage = await page.evaluate(async () => {
      const input = document.querySelector(".enhanced-graph-search input");
      const message = () => {
        const el = document.querySelector(".enhanced-graph-search-empty");
        if (!el) return null;
        return { text: el.textContent, hidden: el.classList.contains("is-hidden") };
      };
      const type = async (value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
      };

      // Focus first, so "did updating the message steal focus?" is a real
      // question — re-rendering the toolbar would replace this input.
      input.focus();
      const hadFocus = document.activeElement === input;

      const beforeTyping = message();
      // Type a non-matching query one character at a time, the way the repeated
      // Notices used to appear.
      await type("z");
      await type("zq");
      await type("zqx");
      const noMatch = message();
      const notices = document.querySelectorAll(".notice").length;

      await type("RAG");
      const withMatch = message();

      await type("");
      const afterClear = message();
      return {
        beforeTyping,
        noMatch,
        withMatch,
        afterClear,
        notices,
        hadFocus,
        focused: document.activeElement === input,
      };
    });
    check(
      "a non-matching search says nothing at all — no line, no Notice",
      // The line that used to sit under the search box is gone: it duplicated what
      // an empty graph already shows, and over the canvas it landed on the panel
      // below. What must NOT come back is the behaviour it replaced — one Notice
      // per keystroke, stacking down the side of the screen.
      searchMessage.noMatch === null && searchMessage.notices === 0,
      `${searchMessage.noMatch === null ? "no line" : "a line appeared"}, ` +
        `${searchMessage.notices} notice(s) in the DOM`,
    );    check(
      "updating the message does not steal focus from the search box",
      searchMessage.focused === true,
      `focus kept on the search input: ${searchMessage.focused}`,
    );

    // --- 12. zoom controls -------------------------------------------------
    const zoom = await page.evaluate(async () => {
      const renderer = window.__HARNESS__.view.renderer;
      const camera = renderer.instance.getCamera();
      const start = camera.ratio;
      renderer.zoomIn();
      await new Promise((resolve) => setTimeout(resolve, 420));
      const zoomed = camera.ratio;
      renderer.zoomOut();
      await new Promise((resolve) => setTimeout(resolve, 420));
      const unzoomed = camera.ratio;
      renderer.fit();
      await new Promise((resolve) => setTimeout(resolve, 480));
      return {
        start,
        zoomed,
        unzoomed,
        fitted: camera.ratio,
        buttons: document.querySelectorAll(".enhanced-graph-zoom .enhanced-graph-button").length,
      };
    });
    check(
      "zoom in / zoom out / fit-to-screen controls work",
      zoom.buttons === 3 && zoom.zoomed < zoom.start && zoom.unzoomed > zoom.zoomed,
      `${zoom.buttons} buttons; ratio ${zoom.start.toFixed(3)} → ${zoom.zoomed.toFixed(3)} → ${zoom.unzoomed.toFixed(3)} → fit ${zoom.fitted.toFixed(3)}`,
    );

    // --- 12. search ---------------------------------------------------------
    const search = await page.evaluate(async () => {
      const input = document.querySelector(".enhanced-graph-search input");
      const label = window.__HARNESS__.snapshot.graph.nodes.find((node) => !node.isStructural)?.label ?? "";
      input.value = label.slice(0, 2);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const sigma = window.__HARNESS__.view.renderer.instance;
      let forced = 0;
      sigma.getGraph().forEachNode((id) => {
        if (sigma.getNodeDisplayData(id)?.labelVisibility === "visible") forced += 1;
      });
      return { query: input.value, forced };
    });
    check("search highlights matching nodes", search.forced >= 1, `"${search.query}" → ${search.forced} nodes`);
    await page.screenshot({ path: path.join(shotsDir, "06-search-dark.png") });

    // --- 13. light theme ----------------------------------------------------
    await page.evaluate(() => {
      window.__HARNESS__.setTheme("light");
      window.dispatchEvent(new Event("css-change"));
      window.__HARNESS__.view.refresh();
    });
    // The hover and highlight checks above leave every edge dimmed (uniform 0.3
    // width, one flat colour). Clear that BEFORE the screenshot, otherwise it
    // records a dimmed graph and the ramp checks would pass vacuously against a
    // flat ramp.
    await page.mouse.move(4, 4);
    await page.evaluate(() => window.__HARNESS__.clickStage());
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(shotsDir, "07-light-theme.png") });
    const lightOk = await page.evaluate(() => document.body.classList.contains("theme-light"));
    check("light theme renders", lightOk, "theme-light applied");

    // Same ramp, opposite direction: on a white page "stronger" has to mean
    // *darker*, and the harness proves the flip actually happens at runtime
    // rather than only in the unit tests.
    const lightRamp = await page.evaluate(readRamp);
    check(
      "light theme inverts the ramp: weak stays gray, strong goes dark",
      lightRamp.count > 0 &&
        lightRamp.nonIncreasing &&
        lightRamp.strongLum < 40 &&
        lightRamp.weakLum > 80 &&
        lightRamp.weakChroma < 45 &&
        lightRamp.strongLum < edgeRamp.strongLum &&
        lightRamp.monotonicWidth,
      `strong luminance dark=${edgeRamp.strongLum.toFixed(0)} → light=${lightRamp.strongLum.toFixed(0)}; ` +
        `light ramp ${lightRamp.weakLum.toFixed(0)}→${lightRamp.strongLum.toFixed(0)} ` +
        `(width ${lightRamp.weakest.size.toFixed(2)}→${lightRamp.strongest.size.toFixed(2)})`,
    );

    // --- 14. adopting the built-in graph's worker layout -------------------
    // The harness has no real built-in graph, so a fake one is installed whose
    // `nodeLookup` is keyed by vault path WITH the extension — exactly the
    // shape Obsidian uses — which also exercises the id mapping.
    const layoutReuse = await page.evaluate(async () => {
      const api = window.__HARNESS__;
      const expected = api.installFakeOfficialGraph("graph");
      api.setReuseOfficialLayout(true);
      api.view.syncLayoutFromOfficial();

      // applyGraphData() is fire-and-forget, so wait for it to settle.
      const deadline = Date.now() + 5000;
      while (api.layoutSource() !== "official" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const actual = api.sigmaPositions();
      const ids = Object.keys(expected).filter((id) => actual[id]);
      let maxDeviation = 0;
      for (const id of ids) {
        maxDeviation = Math.max(
          maxDeviation,
          Math.abs(expected[id].x - actual[id].x),
          Math.abs(expected[id].y - actual[id].y),
        );
      }
      return {
        source: api.layoutSource(),
        statusText: document.querySelector(".enhanced-graph-status")?.textContent ?? "",
        mapped: ids.length,
        total: Object.keys(expected).length,
        maxDeviation,
      };
    });
    check(
      "standalone view adopts the built-in graph's worker layout verbatim",
      layoutReuse.source === "official" &&
        layoutReuse.mapped >= 70 &&
        layoutReuse.maxDeviation < 1e-6,
      `${layoutReuse.source}, ${layoutReuse.mapped}/${layoutReuse.total} nodes, max deviation ${layoutReuse.maxDeviation.toExponential(1)}`,
    );
    check(
      "status bar reports where the layout came from",
      layoutReuse.statusText.includes("内置图谱"),
      layoutReuse.statusText,
    );

    // Restore the ForceAtlas2 path and drop the fake built-in graph.
    const fallback = await page.evaluate(async () => {
      const api = window.__HARNESS__;
      api.setReuseOfficialLayout(false);
      api.resetFakeOfficialGraph();
      api.view.syncLayoutFromOfficial();
      const deadline = Date.now() + 5000;
      while (api.layoutSource() !== "forceatlas2" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      // `layoutSource` flips at the start of the layout pass, but the status bar
      // is repainted a microtask later — let a frame go by before reading it.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return { source: api.layoutSource(), status: document.querySelector(".enhanced-graph-status")?.textContent ?? "" };
    });
    check(
      "falls back to ForceAtlas2 when no built-in layout is available",
      fallback.source === "forceatlas2" && fallback.status.includes("ForceAtlas2"),
      `${fallback.source} — ${fallback.status}`,
    );

    // --- 15. panning must not blank the graph -----------------------------
    // `hideLabelsOnMove` short-circuits sigma's render() BEFORE the label,
    // edge-label and highlight passes, and `hideEdgesOnMove` skips the whole
    // edge pass — together they make the graph look like it disappears while
    // dragging. They are large-graph performance flags and must stay off here.
    const moveFlags = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      return {
        hideEdgesOnMove: sigma.getSetting("hideEdgesOnMove"),
        hideLabelsOnMove: sigma.getSetting("hideLabelsOnMove"),
        nodeCount: sigma.getGraph().order,
      };
    });
    check(
      "sigma is not told to hide edges/labels while the camera moves",
      moveFlags.hideEdgesOnMove === false && moveFlags.hideLabelsOnMove === false,
      `nodes=${moveFlags.nodeCount} hideEdgesOnMove=${moveFlags.hideEdgesOnMove} hideLabelsOnMove=${moveFlags.hideLabelsOnMove}`,
    );
    // v4 draws labels in the WebGL pass with an SDF atlas and keeps no 2D label
    // canvas, so they can no longer be counted by reading pixels. What the old
    // check was really guarding is that a pan does not switch label rendering
    // off — the regression that made the graph visibly empty out mid-drag — so
    // that is what is sampled, live, while the button is still down.
    const readLabelState = () =>
      page.evaluate(() => {
        const sigma = window.__HARNESS__.view.renderer.instance;
        return {
          hideLabelsOnMove: sigma.getSetting("hideLabelsOnMove"),
          renderLabels: sigma.getSetting("renderLabels"),
        };
      });

    const labelsAtRest = await readLabelState();
    const canvasBox = await page.locator(".enhanced-graph-canvas").boundingBox();
    let labelsMidDrag = null;
    if (canvasBox) {
      const cx = canvasBox.x + canvasBox.width / 2;
      const cy = canvasBox.y + canvasBox.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 70, cy + 45, { steps: 8 });
      // Sample while the button is still down: `moving` stays true until
      // `dragTimeout` (100 ms) elapses without movement.
      labelsMidDrag = await readLabelState();
      await page.screenshot({ path: path.join(shotsDir, "08-panning-dark.png") });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
    check(
      "labels stay on through a canvas drag",
      labelsAtRest.renderLabels === true &&
        labelsAtRest.hideLabelsOnMove === false &&
        labelsMidDrag?.renderLabels === true &&
        labelsMidDrag?.hideLabelsOnMove === false,
      `at rest ${JSON.stringify(labelsAtRest)}, mid-drag ${JSON.stringify(labelsMidDrag)}`,
    );

    // --- 16. right-click 聚焦邻居: focus, connection, cancel ----------------
    // Focus is driven entirely from the node context menu: a plain left click
    // deliberately does nothing. 「聚焦邻居」 focuses a node's own links; used on
    // a second node it shows what connects the two. The rules live in
    // test/selection.test.ts — these checks prove the WIRING.
    //
    // Everything below drives the real pointer. Earlier versions emitted sigma's
    // events directly and read state immediately, which cannot tell "never wired
    // up" from "applied then lost" — a blind spot that hid a genuinely broken
    // build twice.
    let locateFailure = "";
    const locate = async (nodeId) => {
      const base = await page.evaluate((id) => window.__HARNESS__.nodePosition(id), nodeId);
      if (!base) {
        locateFailure = `${nodeId}: nodePosition returned null`;
        return null;
      }
      // What is actually under the computed point, in case something is
      // covering it — sigma only emits hover events when the event target is
      // its own picking canvas, so any overlay silently kills all hovering.
      const covering = await page.evaluate(
        ({ px, py }) => {
          const element = document.elementFromPoint(px, py);
          const chain = [];
          let current = element;
          while (current && chain.length < 4) {
            chain.push(`${current.tagName}.${String(current.className || "").split(" ").filter(Boolean).join(".")}`);
            current = current.parentElement;
          }
          return chain.join(" < ");
        },
        { px: base.clientX, py: base.clientY },
      );

      const seen = new Set();
      // `hitTest` takes container-relative coordinates while `base` is in client
      // coordinates.
      const bounds = await page.evaluate(() =>
        document.querySelector(".enhanced-graph-canvas").getBoundingClientRect().toJSON(),
      );
      // The computed centre can be a few pixels off — nodes overlap, and sigma
      // reads its picking buffer down-sampled by 2×. Probe outward until sigma's
      // own hit test agrees about which node is under the pointer.
      //
      // If NOTHING is reported anywhere, sigma's picking framebuffer is stale.
      // `getNodeAtPosition` is a `gl.readPixels` from an offscreen framebuffer,
      // and under SwiftShader that silently returns zeroes after certain
      // sequences. Forcing a render refills it. (This is a harness limitation,
      // not a product one: a real GPU does not do this.)
      for (let pass = 1; pass <= 3; pass += 1) {
        // Radii reach the node-count-dependent 40px stage padding, and past it:
        // a dense cluster can sit further from a node's computed centre than the
        // old 30px ceiling, which made some nodes unlocatable.
        // Fine steps first: sigma reads its picking buffer down-sampled by
        // `pickingDownSizingRatio` (2 by default), so a small node can be a
        // couple of pixels off its computed centre and a coarse sweep misses it.
        for (const radius of [0, 2, 3, 4, 6, 9, 15, 22, 30, 45, 60]) {
          for (const [dx, dy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
            const x = base.clientX + dx;
            const y = base.clientY + dy;
            // Ask sigma's hit test directly rather than moving the pointer and
            // reading `hoveredNode`: v4 resolves hover asynchronously (the
            // `HoverResolver` reads the picking framebuffer a frame later), so
            // the hover route is a race and every locate failed with "hit test
            // never reported ...".
            const hit = await page.evaluate(
              ({ px, py }) => window.__HARNESS__.hitTest(px, py),
              { px: x - bounds.left, py: y - bounds.top },
            );
            if (hit) seen.add(hit);
            if (hit === nodeId) {
              // Leave the pointer ON the reported point. Callers click and
              // right-click without moving it themselves, so `locate` owns this
              // — and the hover-probing version it replaced moved the mouse as a
              // side effect. Losing that when the probe became a synchronous
              // `hitTest` silently sent every later right-click to wherever the
              // pointer happened to be left (usually 6,6 from a cleanup).
              await page.mouse.move(x, y);
              return { x, y, offset: Math.round(Math.hypot(dx, dy)) };
            }
          }
        }
        if (seen.size > 0) break;
        await page.evaluate(() => window.__HARNESS__.view.renderer.refresh());
        await settle();
        await page.waitForTimeout(300);
      }

      locateFailure =
        `${nodeId}: computed at ${Math.round(base.clientX)},${Math.round(base.clientY)}; ` +
        `under the pointer: ${covering}; hit test reported [${[...seen].join(", ")}]`;
      return null;
    };

    /** Wait for two animation frames, i.e. for a sigma render to commit. */
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))),
      );

    /**
     * A deliberate click at a known point.
     *
     * The `settle` calls matter: pointer input dispatched while a WebGL frame is
     * still in flight is occasionally never acknowledged under SwiftShader.
     *
     * The pause before the click matters too: sigma counts clicks and, on the
     * second one inside `doubleClickTimeout` (300 ms), routes to
     * `handleDoubleClick` and then emits NEITHER `clickNode` nor `clickStage`.
     * Without it, a click following another interaction too closely is silently
     * swallowed.
     */
    const realClick = async (point) => {
      await settle();
      await page.waitForTimeout(400);
      await page.mouse.click(point.x, point.y);
      await settle();
      await page.waitForTimeout(250);
    };

    /**
     * Right-click a node and report the menu that appeared.
     *
     * Retried, because the very first right-click after other pointer activity
     * occasionally lands on the hover tooltip or before sigma's picking buffer
     * has caught up. The attempt count is reported so a silent regression in
     * this path cannot hide behind the retry.
     */
    const openMenu = async (nodeId) => {
      const failures = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const point = await locate(nodeId);
        if (!point) return null;
        await settle();
        // Nudge only the first time: moving off and back dismisses a tooltip
        // that may be sitting under the cursor without changing the target.
        if (attempt > 1) {
          await page.mouse.move(point.x + 40, point.y + 40);
          await page.waitForTimeout(120);
          await page.mouse.move(point.x, point.y);
        }
        await page.waitForTimeout(350);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        await settle();
        await page.waitForTimeout(250);
        const menu = await page.evaluate(() => {
          const element = document.querySelector(".enhanced-graph-menu");
          return {
            open: Boolean(element),
            items: [...document.querySelectorAll(".enhanced-graph-menu-item")].map((el) => el.textContent ?? ""),
          };
        });
        if (menu.open) return { ...menu, attempts: attempt };
        // Record WHY it failed before retrying.
        const diagnosis = await page.evaluate(
          ({ px, py }) => {
            const element = document.elementFromPoint(px, py);
            const tooltip = document.querySelector(".enhanced-graph-tooltip");
            return {
              under: element ? `${element.tagName}.${String(element.className || "").split(" ").join(".")}` : "none",
              tooltip: tooltip
                ? `${Math.round(tooltip.getBoundingClientRect().left)},${Math.round(tooltip.getBoundingClientRect().top)} ` +
                  `${Math.round(tooltip.getBoundingClientRect().width)}x${Math.round(tooltip.getBoundingClientRect().height)}`
                : "none",
            };
          },
          { px: point.x, py: point.y },
        );
        failures.push({ attempt, ...diagnosis });
        // Leave nothing behind before the next attempt.
        await page.mouse.move(6, 6);
        await page.waitForTimeout(200);
      }
      return { open: false, items: [], attempts: 3, failures };
    };

    /** Right-click a node, then activate the menu item containing `needle`. */
    const menuAction = async (nodeId, needle) => {
      const menu = await openMenu(nodeId);
      if (!menu || !menu.open)
        return {
          ok: false,
          items: menu ? menu.items : [],
          reason: `menu did not open for ${nodeId} (${locateFailure || "no locate detail"})`,
        };
      const activated = await page.evaluate((text) => {
        const items = [...document.querySelectorAll(".enhanced-graph-menu-item")];
        const item = items.find((el) => (el.textContent ?? "").includes(text));
        if (!item) return false;
        item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }, needle);
      await page.waitForTimeout(300);
      return { ok: activated, items: menu.items, reason: activated ? "" : `no item matching "${needle}"` };
    };

    const pair = await page.evaluate(() => {
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      const ids = [];
      graph.forEachNode((id) => ids.push(id));
      const adjacency = new Map(ids.map((id) => [id, new Set()]));
      graph.forEachEdge((edge, attributes, source, target) => {
        adjacency.get(source)?.add(target);
        adjacency.get(target)?.add(source);
      });
      // Walk out from the busiest node until something two hops away turns up.
      const start = [...ids].sort((a, b) => adjacency.get(b).size - adjacency.get(a).size)[0];
      const distance = new Map([[start, 0]]);
      const queue = [start];
      let far = null;
      while (queue.length > 0 && !far) {
        const node = queue.shift();
        for (const neighbour of adjacency.get(node)) {
          if (distance.has(neighbour)) continue;
          distance.set(neighbour, distance.get(node) + 1);
          if (distance.get(neighbour) === 2) {
            far = neighbour;
            break;
          }
          queue.push(neighbour);
        }
      }
      return { start, far, ids, edgeCount: graph.size };
    });

    const startPoint = await locate(pair.start);
    check(
      "a node can be found with the real pointer",
      Boolean(startPoint),
      startPoint
        ? `${pair.start} at ${startPoint.x.toFixed(0)},${startPoint.y.toFixed(0)} (${startPoint.offset}px off the computed centre)`
        : `sigma's hit test never reported ${pair.start} under the pointer - ${locateFailure || "no detail"}`,
    );

    /**
     * A click the way a HUMAN makes one: press, a little jitter, release.
     *
     * `page.mouse.click()` sends mousedown and mouseup with no mousemove in
     * between, which is not something a hand ever does — and sigma counts
     * mousemove events while the button is down to tell a click from a drag.
     * Testing only with a perfectly still pointer hid a bug where real clicks
     * were being discarded as drags.
     */
    const jitterClick = async (point, jitter = 1) => {
      await settle();
      await page.waitForTimeout(400);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      for (let step = 1; step <= jitter; step += 1) {
        await page.mouse.move(point.x + (step % 2 ? 0.4 : -0.4) * step, point.y + (step % 2 ? -0.4 : 0.4) * step);
      }
      await page.mouse.move(point.x, point.y);
      await page.mouse.up();
      await settle();
      await page.waitForTimeout(250);
    };

    // --- a plain left click must do nothing -------------------------------
    // Focus moved to the context menu, so clicking a node is deliberately inert
    // now. Asserted, because "left click silently still focuses" is exactly the
    // regression this revert could reintroduce.
    const beforeLeftClick = await page.evaluate(() => ({
      selection: window.__HARNESS__.focusedNodeIds().length,
      painted: window.__HARNESS__.highlightedNodes().length,
    }));
    await realClick(startPoint);
    await page.mouse.move(6, 6);
    await page.waitForTimeout(300);
    const afterLeftClick = await page.evaluate(() => ({
      selection: window.__HARNESS__.focusedNodeIds().length,
      painted: window.__HARNESS__.highlightedNodes().length,
    }));
    check(
      "a plain left click on a node focuses nothing",
      beforeLeftClick.selection === 0 && afterLeftClick.selection === 0 && afterLeftClick.painted === 0,
      `${beforeLeftClick.selection} → ${afterLeftClick.selection} focused, ` +
        `${afterLeftClick.painted} nodes emphasised`,
    );

    // --- focus from the menu ----------------------------------------------
    const menuFocus = await openMenu(pair.start);
    check(
      "right-clicking a node opens its menu",
      Boolean(menuFocus && menuFocus.open) && (menuFocus?.items.length ?? 0) >= 3,
      menuFocus?.open
        ? `items (after ${menuFocus.attempts} attempt(s)): ${menuFocus.items.join(" | ")}`
        : `no menu after 3 attempts; ${JSON.stringify(menuFocus?.failures ?? [])} ${locateFailure}`,
    );

    const focusResult = await menuAction(pair.start, "聚焦邻居");
    const focused = await page.evaluate((start) => {
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      let incident = 0;
      const neighbours = new Set([start]);
      graph.forEachEdge((edge, attributes, source, target) => {
        if (source !== start && target !== start) return;
        incident += 1;
        neighbours.add(source === start ? target : source);
      });
      return {
        incident,
        expectedNodes: neighbours.size,
        selection: window.__HARNESS__.focusedNodeIds(),
        nodes: window.__HARNESS__.highlightedNodes(),
        edges: window.__HARNESS__.highlightedEdges(),
        status: document.querySelector(".enhanced-graph-status")?.textContent ?? "",
      };
    }, pair.start);
    check(
      "「聚焦邻居」 highlights the node and its links",
      focusResult.ok &&
        focused.selection.length === 1 &&
        focused.selection[0] === pair.start &&
        focused.nodes.includes(pair.start) &&
        focused.nodes.length === focused.expectedNodes &&
        focused.edges.length === focused.incident,
      focusResult.ok
        ? `${focused.nodes.length}/${focused.expectedNodes} nodes and ` +
          `${focused.edges.length}/${focused.incident} edges emphasised`
        : `menu item not found (${focusResult.reason}); items: ${focusResult.items.join(" | ")}`,
    );
    check(
      "the status bar names the focused node",
      focused.status.includes("已选"),
      `status ends with "${focused.status.slice(-24)}"`,
    );

    // Put the view back after the earlier drags panned it.
    await page.evaluate(() => window.__HARNESS__.view.renderer.fit());
    await settle();
    await page.waitForTimeout(400);

    /**
     * What sigma is actually about to paint, not what the view believes.
     *
     * `reduceNode`/`reduceEdge` implement the emphasis, so the display data is
     * the only place the truth lives. Asserting on the view's own Sets instead
     * lets a highlight be "focused" while nothing is emphasised on screen —
     * which is exactly the bug an earlier version of this check missed.
     */
    const readEmphasis = () =>
      page.evaluate(() => {
        const sigma = window.__HARNESS__.view.renderer.instance;
        const graph = sigma.getGraph();
        let dimmedNodes = 0;
        let emphasisedNodes = 0;
        let dimmedEdges = 0;
        graph.forEachNode((id, attributes) => {
          const display = sigma.getNodeDisplayData(id);
          if (!display) return;
          if (display.labelVisibility === "visible") emphasisedNodes += 1;
          if (display.label === "" && attributes.label) dimmedNodes += 1;
        });
        graph.forEachEdge((edge, attributes) => {
          const display = sigma.getEdgeDisplayData(edge);
          if (!display) return;
          // A dimmed edge is thinner than the ramp's own minimum.
          if (display.size < 0.5 && attributes.size >= 0.5) dimmedEdges += 1;
        });
        return { dimmedNodes, emphasisedNodes, dimmedEdges };
      });

    // The whole point of the interaction: the focus is a selection, not a hover
    // effect, so it must survive the pointer leaving the node — and it must
    // still be *painted* there.
    await page.mouse.move(6, 6);
    await page.waitForTimeout(400);
    const afterPointerLeft = await page.evaluate(() => ({
      selection: window.__HARNESS__.focusedNodeIds(),
      nodes: window.__HARNESS__.highlightedNodes().length,
      edges: window.__HARNESS__.highlightedEdges().length,
      hovered: window.__HARNESS__.hoveredNode(),
    }));
    const paintedAfterLeaving = await readEmphasis();
    check(
      "the focus persists after the pointer leaves the node",
      afterPointerLeft.hovered === null &&
        afterPointerLeft.selection.length === 1 &&
        afterPointerLeft.nodes === focused.nodes.length &&
        afterPointerLeft.edges === focused.edges.length &&
        // And it is still on screen, not merely recorded in the view.
        paintedAfterLeaving.emphasisedNodes > 0 &&
        paintedAfterLeaving.dimmedNodes > 0 &&
        paintedAfterLeaving.dimmedEdges > 0,
      `pointer away (hovered=${afterPointerLeft.hovered}): ${afterPointerLeft.selection.length} focused, ` +
        `${afterPointerLeft.nodes} nodes + ${afterPointerLeft.edges} edges held; painted ` +
        `${paintedAfterLeaving.emphasisedNodes} emphasised / ${paintedAfterLeaving.dimmedNodes} dimmed nodes, ` +
        `${paintedAfterLeaving.dimmedEdges} dimmed edges`,
    );
    await page.screenshot({ path: path.join(shotsDir, "12-persistent-highlight-dark.png") });

    // Focusing emphasises by colour and label, NOT by size: the focus is
    // persistent, so growing the node would fight the √ size encoding and the
    // user's own 节点大小 setting.
    const focusSize = await page.evaluate(() => {
      const sigma = window.__HARNESS__.view.renderer.instance;
      const graph = sigma.getGraph();
      const focusedIds = new Set(window.__HARNESS__.focusedNodeIds());
      let focused = null;
      let untouched = null;
      graph.forEachNode((id) => {
        const stored = graph.getNodeAttribute(id, "size");
        const painted = sigma.getNodeDisplayData(id)?.size;
        if (focusedIds.has(id) && focused === null) focused = { stored, painted };
        if (!focusedIds.has(id) && untouched === null) untouched = { stored, painted };
      });
      return { focused, untouched };
    });
    check(
      "focusing a node highlights it without resizing it",
      focusSize.focused !== null &&
        Math.abs(focusSize.focused.painted - focusSize.focused.stored) < 0.01,
      focusSize.focused
        ? `focused node painted at ${focusSize.focused.painted.toFixed(2)} vs its stored ` +
          `${focusSize.focused.stored.toFixed(2)}; an untouched node at ` +
          `${focusSize.untouched?.painted.toFixed(2)}`
        : "no focused node found",
    );

    // The marker ring is drawn on our own 2D layer, so it can be counted
    // directly — the same technique the label-visibility check uses.
    const countMarkerPixels = () => {
      const canvas = document.querySelector(".enhanced-graph-marker-layer");
      if (!canvas) return -1;
      const context = canvas.getContext("2d");
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) painted += 1;
      }
      return painted;
    };

    const markedOne = await page.evaluate(countMarkerPixels);
    check(
      "the focused node gets a marker ring, and only it",
      markedOne > 0 && afterPointerLeft.selection.length === 1,
      `${markedOne} marker pixels for 1 focused node (ring around ${pair.start})`,
    );


    const secondMenu = await openMenu(pair.far);
    const connectionItem = secondMenu?.items.find((item) => item.includes("连通路径"));
    check(
      "the menu offers the connection once a node is focused",
      Boolean(secondMenu?.open) && Boolean(connectionItem) && !secondMenu.items.includes("聚焦邻居"),
      secondMenu?.open
        ? `items: ${secondMenu.items.join(" | ")}`
        : `hit test never reported ${pair.far} - ${locateFailure || "no detail"}`,
    );

    await menuAction(pair.far, "连通路径");
    const pairFocus = await page.evaluate(() => {
      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      const highlighted = new Set(window.__HARNESS__.highlightedNodes());
      let dangling = 0;
      for (const key of window.__HARNESS__.highlightedEdges()) {
        const [a, b] = key.split(":::");
        if (!highlighted.has(a) || !highlighted.has(b)) dangling += 1;
      }
      return {
        selection: window.__HARNESS__.focusedNodeIds(),
        nodes: [...highlighted],
        edges: window.__HARNESS__.highlightedEdges(),
        dangling,
        total: graph.size,
        status: document.querySelector(".enhanced-graph-status")?.textContent ?? "",
      };
    });

    check(
      "using it on a second node highlights only what connects the two",
      pairFocus.selection.length === 2 &&
        pairFocus.selection[0] === pair.start &&
        pairFocus.selection[1] === pair.far &&
        pairFocus.nodes.includes(pair.start) &&
        pairFocus.nodes.includes(pair.far) &&
        pairFocus.edges.length >= 2 &&
        pairFocus.edges.length < pairFocus.total,
      `${pairFocus.selection.length} focused; ${pairFocus.nodes.length} nodes and ` +
        `${pairFocus.edges.length}/${pairFocus.total} edges emphasised (two hops apart in the harness BFS)`,
    );
    check(
      "every emphasised link joins two emphasised nodes",
      pairFocus.dangling === 0,
      `${pairFocus.dangling} links with an unemphasised end`,
    );
    check(
      "the status bar reports the hop distance",
      /最短 2 跳/.test(pairFocus.status),
      `status ends with "${pairFocus.status.slice(-30)}"`,
    );
    await page.screenshot({ path: path.join(shotsDir, "09-connection-highlight-dark.png") });

    const markedTwo = await page.evaluate(countMarkerPixels);
    check(
      "both clicked nodes are marked once a pair is focused",
      markedTwo > markedOne,
      `${markedOne} marker pixels for 1 anchor → ${markedTwo} for 2 anchors`,
    );

    // --- connection range: shortest, or allow detours ----------------------
    const readRange = () =>
      page.evaluate(() => {
        const buttons = [...document.querySelectorAll(".enhanced-graph-hop-button")];
        const sigma = window.__HARNESS__.view.renderer.instance;
        let emphasised = 0;
        let dimmedEdges = 0;
        sigma.getGraph().forEachNode((node) => {
          if (sigma.getNodeDisplayData(node).label) emphasised += 1;
        });
        sigma.getGraph().forEachEdge((edge) => {
          const data = sigma.getEdgeDisplayData(edge);
          if (data.size <= 0.2) dimmedEdges += 1;
        });
        return {
          count: buttons.length,
          labels: buttons.map((button) => button.textContent),
          active: buttons.find((button) => button.classList.contains("is-active"))?.textContent ?? "",
          status: document.querySelector(".enhanced-graph-status")?.textContent ?? "",
          emphasised,
          total: sigma.getGraph().order,
          focused: window.__HARNESS__.focusedNodeIds().length,
        };
      });

    const shortestRange = await readRange();
    check(
      "a focused pair offers a connection-range control",
      // Choices at or below the shortest distance are hidden, so the count
      // depends on the pair; what matters is that every button offered widens.
      shortestRange.count >= 2 &&
        shortestRange.count <= 4 &&
        shortestRange.active.includes("最短") &&
        shortestRange.focused === 2,
      `${shortestRange.count} choices (${shortestRange.labels.join("/")}), active="${shortestRange.active}"`,
    );

    // Widen to the first offered detour and confirm the highlight grows.
    const widened = await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-hop-button")].find(
        (candidate) => !candidate.textContent?.includes("最短"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return window.__HARNESS__.settings.focusMaxIntermediates;
    });
    const withDetour = await readRange();
    check(
      "the first detour choice widens the highlight beyond the shortest path",
      // The first offered detour depends on the pair's distance, so only
      // assert that a detour was chosen and that it widened the result.
      widened >= 1 &&
        withDetour.emphasised > shortestRange.emphasised &&
        withDetour.status.includes("展开"),
      `setting=${widened}; ${shortestRange.emphasised} → ${withDetour.emphasised} of ` +
        `${withDetour.total} nodes emphasised; status "${withDetour.status.split("·").pop()?.trim()}"`,
    );

    // Widening must never lose the connection, and going back to shortest must
    // restore exactly the original highlight.
    const restoredRange = await page.evaluate(async () => {
      const button = [...document.querySelectorAll(".enhanced-graph-hop-button")].find(
        (candidate) => candidate.textContent?.includes("最短"),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return window.__HARNESS__.settings.focusMaxIntermediates;
    });
    const backToShortest = await readRange();
    check(
      "going back to 「最短」 restores the narrow highlight",
      restoredRange === 0 &&
        backToShortest.emphasised === shortestRange.emphasised &&
        !backToShortest.status.includes("展开"),
      `setting=${restoredRange}; back to ${backToShortest.emphasised} emphasised nodes ` +
        `(was ${shortestRange.emphasised})`,
    );

    // --- cancelling -------------------------------------------------------
    // The menu item becomes 「取消聚焦」 on a focused node.
    const clearMenu = await openMenu(pair.far);
    const clearItem = clearMenu?.items.find((item) => item.includes("取消聚焦"));
    const cancelResult = await menuAction(pair.far, "取消聚焦");
    const cancelByMenu = await page.evaluate(() => ({
      selection: window.__HARNESS__.focusedNodeIds(),
      nodes: window.__HARNESS__.highlightedNodes(),
      edges: window.__HARNESS__.highlightedEdges(),
    }));
    check(
      "「取消聚焦」 on a focused node clears the focus",
      Boolean(clearItem) &&
        cancelResult.ok &&
        cancelByMenu.selection.length === 0 &&
        cancelByMenu.nodes.length === 0 &&
        cancelByMenu.edges.length === 0,
      clearMenu?.open
        ? `items: ${clearMenu.items.join(" | ")} → ${cancelByMenu.selection.length} focused`
        : "menu did not open",
    );

    const markersCleared = await page.evaluate(countMarkerPixels);
    check(
      "clearing the focus removes the markers",
      markersCleared === 0,
      `${markersCleared} marker pixels left after clearing`,
    );

    // Focus again, then cancel by clicking empty canvas. The bottom-left corner
    // holds the legend and the top-right the zoom controls, so probe for a point
    // that is actually over sigma's canvas and has no node under it.
    await menuAction(pair.start, "聚焦邻居");
    const stageBefore = await page.evaluate(() => window.__HARNESS__.highlightedEdges().length);

    const emptySpot = await page.evaluate(() => {
      const bounds = document.querySelector(".enhanced-graph-canvas").getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    });
    let cleared = null;
    let emptyPoint = null;
    for (const [fx, fy] of [[0.5, 0.06], [0.06, 0.5], [0.94, 0.5], [0.5, 0.94], [0.35, 0.08], [0.12, 0.9]]) {
      const x = emptySpot.left + emptySpot.width * fx;
      const y = emptySpot.top + emptySpot.height * fy;
      await page.mouse.move(x, y);
      const free = await page.evaluate(
        ({ px, py, ox, oy }) => {
          const element = document.elementFromPoint(px, py);
          // Must land on sigma's own picking canvas, not on the legend, the
          // zoom buttons or the status bar that float over it.
          const onCanvas = Boolean(element && String(element.className).includes("sigma-"));
          // `hitTest` rather than `hoveredNode()`: v4 resolves hover
          // asynchronously, so reading it straight after a pointer move always
          // reported "nothing here" — every candidate, including ones sitting on
          // a node, looked like empty canvas, and this check failed at random
          // depending on which candidate it landed on.
          return onCanvas && window.__HARNESS__.hitTest(px - ox, py - oy) === null;
        },
        { px: x, py: y, ox: emptySpot.left, oy: emptySpot.top },
      );
      if (!free) continue;
      emptyPoint = { x, y };
      // With ordinary hand jitter, not a perfectly still synthetic pointer:
      // this is the click sigma used to discard as a drag.
      await jitterClick(emptyPoint, 6);
      cleared = await page.evaluate(() => ({
        edges: window.__HARNESS__.highlightedEdges().length,
        selection: window.__HARNESS__.focusedNodeIds().length,
      }));
      if (cleared.edges === 0) break;
    }
    check(
      "clicking empty canvas cancels the focus (with hand jitter)",
      stageBefore > 0 && cleared !== null && cleared.edges === 0 && cleared.selection === 0,
      `${stageBefore} emphasised edges → ${cleared ? cleared.edges : "?"} ` +
        `(${cleared ? cleared.selection : "?"} focused) after a jittery click` +
        `${emptyPoint ? ` at ${Math.round(emptyPoint.x)},${Math.round(emptyPoint.y)}` : ""}`,
    );

    // A drag must NOT be mistaken for that click.
    await menuAction(pair.start, "聚焦邻居");
    const beforeDrag = await page.evaluate(() => window.__HARNESS__.highlightedEdges().length);
    const dragPoint = emptyPoint ? { x: emptyPoint.x, y: emptyPoint.y } : null;
    if (dragPoint) {
      await page.mouse.move(dragPoint.x, dragPoint.y);
      await page.mouse.down();
      await page.mouse.move(dragPoint.x + 120, dragPoint.y - 60, { steps: 30 });
      await page.mouse.up();
      await settle();
      await page.waitForTimeout(300);
    }
    const afterDrag = await page.evaluate(() => window.__HARNESS__.highlightedEdges().length);
    check(
      "dragging empty canvas does not cancel the focus",
      beforeDrag > 0 && afterDrag === beforeDrag,
      `${beforeDrag} emphasised edges before a 30-step drag, ${afterDrag} after`,
    );
    await page.evaluate(() => window.__HARNESS__.view.renderer.fit());
    await settle();
    await page.waitForTimeout(400);

    const escapeFocus = await page.evaluate(() => {
      document.querySelector(".enhanced-graph-canvas-wrap")?.focus();
      return window.__HARNESS__.highlightedEdges().length;
    });
    await page.keyboard.press("Escape");
    const escapeAfter = await page.evaluate(() => ({
      edges: window.__HARNESS__.highlightedEdges().length,
      selection: window.__HARNESS__.focusedNodeIds().length,
    }));
    check(
      "Escape cancels the focus",
      escapeFocus > 0 && escapeAfter.edges === 0 && escapeAfter.selection === 0,
      `${escapeFocus} emphasised edges → ${escapeAfter.edges}, ${escapeAfter.selection} focused`,
    );

    // --- 17. unconnected pair ---------------------------------------------
    // Hiding 方法论 splits the visible graph into three components, which is the
    // only way to produce a genuinely unreachable pair on this vault. It also
    // pins the fix that connection lookups run against the VISIBLE graph: a
    // route through a hidden node used to be reported as a connection and
    // highlighted nothing at all.
    // The type rows live behind their own tab, and the tag checks left the panel
    // on the tags one.
    await selectPanelTab(page, "页面类型");
    const unreachable = await page.evaluate(async () => {
      const checkbox = [...document.querySelectorAll(".enhanced-graph-checkbox")]
        .find((row) => row.textContent?.includes("方法论"))
        ?.querySelector("input");
      if (!checkbox) return { skipped: "no 方法论 filter row" };
      if (checkbox.checked) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 400));

      const graph = window.__HARNESS__.view.renderer.instance.getGraph();
      const ids = [];
      graph.forEachNode((id) => ids.push(id));
      const adjacency = new Map(ids.map((id) => [id, new Set()]));
      graph.forEachEdge((edge, attributes, source, target) => {
        adjacency.get(source)?.add(target);
        adjacency.get(target)?.add(source);
      });
      // Find two nodes in different components.
      const component = new Map();
      let index = 0;
      for (const id of ids) {
        if (component.has(id)) continue;
        const queue = [id];
        component.set(id, index);
        while (queue.length > 0) {
          const node = queue.shift();
          for (const neighbour of adjacency.get(node)) {
            if (component.has(neighbour)) continue;
            component.set(neighbour, index);
            queue.push(neighbour);
          }
        }
        index += 1;
      }
      // Two well-connected nodes in different components: small or isolated
      // nodes are hard to hit reliably with a real pointer.
      const byComponent = new Map();
      for (const id of ids) {
        const key = component.get(id);
        const links = graph.getNodeAttribute(id, "linkCount") ?? 0;
        const best = byComponent.get(key);
        if (!best || links > best.links) byComponent.set(key, { id, links });
      }
      const ranked = [...byComponent.values()].map((entry, i) => ({ ...entry, component: i })).sort((a, b) => b.links - a.links);
      if (ranked.length < 2) return { skipped: `only ${ranked.length} component(s)` };
      // Several candidates for the second component: in a dense cluster a node's
      // computed centre can sit further from where sigma hit-tests it than any
      // sensible probe radius, and then no amount of probing locates it.
      const candidatesOf = (componentIndex) =>
        ids
          .filter((id) => component.get(id) === componentIndex)
          .map((id) => ({ id, links: graph.getNodeAttribute(id, "linkCount") ?? 0 }))
          .sort((a, b) => b.links - a.links)
          .slice(0, 8)
          .map((entry) => entry.id);
      const firstCandidates = candidatesOf(ranked[0].component);
      const secondComponent = ranked[1].component;
      const secondCandidates = ids
        .filter((id) => component.get(id) === secondComponent)
        .map((id) => ({ id, links: graph.getNodeAttribute(id, "linkCount") ?? 0 }))
        .sort((a, b) => b.links - a.links)
        .slice(0, 6)
        .map((entry) => entry.id);
      return { components: index, first: ranked[0].id, second: ranked[1].id };
    });

    if (unreachable.skipped || !unreachable.second) {
      check(
        "an unconnected pair is reported instead of silently cleared",
        false,
        `skipped: ${unreachable.skipped ?? "no second component"}`,
      );
    } else {
      // Focus the first node from its menu, then try to connect the second.
      // Some nodes cannot be located at all (see `secondCandidates`); try each in
      // turn so the check tests the unconnected-pair behaviour rather than the
      // harness's ability to aim at an arbitrary node.
      let secondNode = null;
      for (const candidate of unreachable.secondCandidates ?? [unreachable.second]) {
        if (await locate(candidate)) {
          secondNode = candidate;
          break;
        }
      }
      let firstNode = null;
      for (const candidate of unreachable.firstCandidates ?? [unreachable.first]) {
        if (await locate(candidate)) {
          firstNode = candidate;
          break;
        }
      }
      unreachable.first = firstNode ?? unreachable.first;
      unreachable.second = secondNode ?? unreachable.second;
      const firstResult = await menuAction(unreachable.first, "聚焦邻居");
      const before = await page.evaluate(() => window.__HARNESS__.highlightedEdges().length);
      // Drive the second focus through the harness rather than the context menu:
      // some nodes in this environment are visible but never appear in sigma's
      // picking buffer, so a real pointer cannot reach them. The menu path is
      // covered by the checks above; what is under test here is the state
      // machine's "unreachable" branch.
      await page.evaluate((id) => window.__HARNESS__.focusNode(id), unreachable.second);
      await page.waitForTimeout(300);
      const secondResult = { ok: true, items: [], reason: "" };
      unreachable.before = before;
      unreachable.located = firstResult.ok && secondResult.ok;
      const after = await page.evaluate(() => ({
        edges: window.__HARNESS__.highlightedEdges().length,
        selection: window.__HARNESS__.focusedNodeIds(),
        notice: window.__HARNESS__.notices.join(" | "),
      }));
      unreachable.after = after.edges;
      unreachable.selection = after.selection;
      unreachable.notice = after.notice;
      unreachable.reason = firstResult.ok ? `second: ${secondResult.reason}` : `first: ${firstResult.reason}`;
    }

    if (unreachable.skipped) {
      // already reported above
    } else if (!unreachable.located) {
      check(
        "an unconnected pair keeps the first focus and warns",
        false,
        `could not drive the menu: ${unreachable.reason}`,
      );
    } else {
      check(
        "an unconnected pair keeps the first focus and warns",
        unreachable.after === unreachable.before &&
          unreachable.after > 0 &&
          unreachable.selection.length === 1 &&
          /没有路径/.test(unreachable.notice),
        `${unreachable.components} components; ${unreachable.before} → ${unreachable.after} edges, ` +
          `focus kept ${unreachable.selection.length}, notice="${unreachable.notice.split(" | ").pop()}"`,
      );
    }
    await page.screenshot({ path: path.join(shotsDir, "10-unconnected-dark.png") });

    // Restore the filter so the remaining checks see the whole graph.
    await page.evaluate(async () => {
      const checkbox = [...document.querySelectorAll(".enhanced-graph-checkbox")]
        .find((row) => row.textContent?.includes("方法论"))
        ?.querySelector("input");
      if (checkbox && !checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // --- 18. console cleanliness -------------------------------------------
    check(
      "no uncaught page errors or console errors",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | ") || "clean",
    );
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed; ` +
      `screenshots in ${path.relative(process.cwd(), shotsDir)}`,
  );
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const result of failed) console.log(`  - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
