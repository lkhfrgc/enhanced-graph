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

import { WIDTH_PROBE_EVENT, WIDTH_PROBE_GLOBAL, exposeWidthProbe, reportPanelWidth } from "../src/view/width-probe";

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

  it("reports the cards, which is where the width the reader notices lives", () => {
    // The defect this probe was extended for: the panel held 320px while the *cards*
    // changed width between groups, because a scrolled group lost the scrollbar's width.
    // Every earlier report said 320px and was right, which is exactly why the panel
    // numbers are not enough.
    const node = el("enhanced-graph-panel");
    const card = el("enhanced-graph-card", node);
    card.textContent = "检索增强生成 ↔ RAG 系统评测方法";

    const report = reportPanelWidth(node);

    expect(report).toContain("cards: 1");
    expect(report).toContain("widths ");
  });

  it("says when there are no cards in the group rather than reporting zero", () => {
    // A group can legitimately be empty — no candidates for that kind — and "0px" would
    // read as a layout failure rather than an absent section.
    const report = reportPanelWidth(el("enhanced-graph-panel"));
    expect(report).toContain("cards: none in this group");
  });

  it("reports the panel's own boxes, where a scrollbar shows up", () => {
    // `clientWidth` versus `offsetWidth` is the gutter, and it is the number that moved
    // when the cards did. jsdom computes neither, so this asserts the report includes
    // them rather than what they equal.
    const report = reportPanelWidth(el("enhanced-graph-panel"));
    expect(report).toContain("panel boxes:");
    expect(report).toContain("gutter");
    expect(report).toContain("scrollbar-gutter:");
  });

  it("names its event so the calling line can be written down once", () => {
    expect(WIDTH_PROBE_EVENT).toBe("enhanced-graph:width-probe");
  });
});

describe("exposeWidthProbe", () => {
  const globals = window as unknown as Record<string, unknown>;

  it("publishes the report on a global, since the console is not an option", () => {
    // The submission guidelines forbid logging, and the reviewer's rule cannot be
    // silenced — the disable comment is blocked and the bare form is blocked for being
    // undescribed. A named global is the route that is left, and it is a better one: it
    // autocompletes, and calling it is the documentation.
    const detach = exposeWidthProbe();
    expect(typeof globals[WIDTH_PROBE_GLOBAL]).toBe("function");
    detach();
  });

  it("returns the report as well as handing it to the caller", () => {
    // Two consumers: the global is for a person, the callback is for `graph-view`, which
    // shows the same text as a Notice. The return value keeps the function usable on its
    // own, which is what a probe script over CDP reads.
    const seen: string[] = [];
    const detach = exposeWidthProbe((report) => seen.push(report));

    const returned = (globals[WIDTH_PROBE_GLOBAL] as () => string)();

    expect(typeof returned).toBe("string");
    expect(seen).toEqual([returned]);
    detach();
  });

  it("says so rather than throwing when no panel is mounted", () => {
    // The other tests in this file mount panels and jsdom keeps them, so this removes
    // them first rather than assuming an empty document — an assertion that depends on
    // running order is one that breaks the moment a test is added above it.
    const mounted = Array.from(document.querySelectorAll(".enhanced-graph-panel"));
    const parents = mounted.map((node) => node.parentElement);
    for (const node of mounted) node.remove();

    const detach = exposeWidthProbe();
    expect((globals[WIDTH_PROBE_GLOBAL] as () => string)()).toContain("no insight panel");
    detach();

    mounted.forEach((node, index) => parents[index]?.appendChild(node));
  });

  it("leaves nothing behind on detach", () => {
    // A closed view must not keep a global alive pointing at removed DOM.
    const before = globals[WIDTH_PROBE_GLOBAL];
    const detach = exposeWidthProbe();
    detach();
    expect(globals[WIDTH_PROBE_GLOBAL]).toBe(before);
  });

  it("stops answering the event once detached", () => {
    const seen: string[] = [];
    const detach = exposeWidthProbe((report) => seen.push(report));
    document.dispatchEvent(new Event(WIDTH_PROBE_EVENT));
    const afterFirst = seen.length;
    detach();
    document.dispatchEvent(new Event(WIDTH_PROBE_EVENT));
    expect(afterFirst).toBeGreaterThan(0);
    expect(seen.length).toBe(afterFirst);
  });
});
