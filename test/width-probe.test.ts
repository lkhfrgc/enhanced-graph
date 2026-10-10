// @vitest-environment jsdom
/**
 * The width probe's report.
 *
 * This exists because a layout defect could not be reproduced outside Obsidian: the
 * panel's width was declared, measured correct in the harness, and still changed in the
 * graph view. Two causes were found that way and a third remained, so the panel was given
 * the ability to describe itself from inside the host. The report is the thing that
 * carries the answer back, which makes its content worth asserting — a probe that omits
 * the deciding fact is the same as no probe, only slower.
 *
 * `jsdom` computes no layout, so every `getBoundingClientRect` here is zero. The tests
 * therefore assert the report's *shape* — which facts it includes, and which of them it
 * picks out as the cause — rather than any measurement. That is the part a real run
 * depends on, and the part a refactor can silently drop.
 */

import { describe, expect, it } from "vitest";

import { WIDTH_PROBE_EVENT, reportPanelWidth } from "../src/view/width-probe";

/**
 * A detached element with classes, built with plain DOM so this file needs no Obsidian
 * stub: `createDiv` is the app's helper, and the probe itself only reads standard
 * properties.
 */
function el(classes: string, parent?: HTMLElement): HTMLElement {
  const node = document.createElement("div");
  node.className = classes;
  (parent ?? document.body).appendChild(node);
  return node;
}

describe("reportPanelWidth", () => {
  it("says so, rather than throwing, when there is no panel", () => {
    // The probe is run from a console by someone already unsure what is wrong. A thrown
    // error tells them nothing; a sentence tells them the view is not open.
    const report = reportPanelWidth(null);

    expect(report).toContain("not in the DOM");
    expect(report).not.toContain("undefined");
  });

  it("reports the panel's own box and the declarations that decide it", () => {
    const node = el("enhanced-graph-panel");
    const report = reportPanelWidth(node);

    for (const fact of ["panel:", "declared:", "flex:", "box-sizing:", "display:", "classes:"]) {
      expect(report, `missing ${fact}`).toContain(fact);
    }
    expect(report).toContain("enhanced-graph-panel");
  });

  it("walks the ancestor chain, so the narrow parent can be found", () => {
    // The decisive fact. A flex item cannot be wider than its parent's space however
    // loudly its own rule insists, so the answer is often an ancestor and never the
    // panel — which is exactly what a probe that only reported the panel would miss.
    const outer = el("outer-host");
    const middle = el("middle-host", outer);
    const node = el("enhanced-graph-panel", middle);

    const report = reportPanelWidth(node);

    expect(report).toContain("ancestors:");
    expect(report).toContain("middle-host");
    expect(report).toContain("outer-host");
    // The chain is ordered from the panel outward.
    expect(report.indexOf("enhanced-graph-panel")).toBeLessThan(report.indexOf("middle-host"));
    expect(report.indexOf("middle-host")).toBeLessThan(report.indexOf("outer-host"));
  });

  it("stops before `body`, which is not part of the layout worth reporting", () => {
    const node = el("enhanced-graph-panel");
    expect(reportPanelWidth(node)).not.toContain("body:");
  });

  it("says whether the stylesheet rule is present at all", () => {
    // A panel with no rule and a panel whose rule is overridden look identical on
    // screen and have different fixes, so the report has to distinguish them.
    const report = reportPanelWidth(el("enhanced-graph-panel"));
    expect(report).toContain("stylesheet rule present:");
  });

  it("names its event so the console line can be written down once", () => {
    expect(WIDTH_PROBE_EVENT).toBe("enhanced-graph:width-probe");
  });
});
