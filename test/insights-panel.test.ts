/**
 * `insights-panel` tests.
 *
 * The suite runs in Vitest's default `node` environment (only the official-graph
 * test opts into jsdom, per file), so the DOM here is a hand-rolled tree rather
 * than a real document. That is enough because the module under test is a pure
 * DOM builder: it only ever creates children of the container it is handed and
 * never touches `document`, so nothing has to be installed on `globalThis`.
 *
 * Icons are routed through `setIconImpl`: a recorder replaces the aliased
 * Obsidian `setIcon` so every glyph can be asserted, and one test omits it to
 * prove the real default is still wired up.
 */

import { describe, expect, it } from "vitest";

import type {
  CommunityInfo,
  ConnectionReason,
  GapType,
  GraphEdge,
  GraphNode,
  CoverageGap,
  PageType,
  UnexpectedLink,
  WikiGraph,
} from "../src/types";
import { connectionKey, type GraphInsights } from "../src/core/insights";
import { t } from "../src/i18n";
import {
  connectionEdgeKey,
  countUndismissed,
  renderInsightsPanel,
  type InsightsPanelOptions,
} from "../src/view/insights-panel";

// ---------------------------------------------------------------------------
// Minimal DOM
// ---------------------------------------------------------------------------

type FakeListener = (event: FakeEvent) => void;

/** Only the parts of `Event` the panel uses: the type and propagation. */
class FakeEvent {
  private stopped = false;

  constructor(readonly type: string) {}

  stopPropagation(): void {
    this.stopped = true;
  }

  get propagationStopped(): boolean {
    return this.stopped;
  }
}

interface FakeElementInit {
  readonly cls?: string;
  readonly text?: string;
  readonly attr?: Record<string, string>;
}

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly classList = {
    contains: (name: string): boolean => this.hasClass(name),
    add: (name: string): void => this.addClass(name),
    remove: (name: string): void => this.removeClass(name),
  };

  className = "";
  title = "";
  /** Written by the aliased Obsidian `setIcon` stub. */
  innerHTML = "";

  private ownText = "";
  private parent: FakeElement | null = null;
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(tagName: string, init: FakeElementInit = {}) {
    this.tagName = tagName.toLowerCase();
    if (init.cls !== undefined) this.addClass(init.cls);
    if (init.text !== undefined) this.setText(init.text);
    for (const [name, value] of Object.entries(init.attr ?? {})) this.setAttribute(name, value);
  }

  // --- Obsidian's element helpers -----------------------------------------

  createEl(tagName: string, init: FakeElementInit = {}): FakeElement {
    return this.appendChild(new FakeElement(tagName, init));
  }

  createDiv(init: FakeElementInit = {}): FakeElement {
    return this.createEl("div", init);
  }

  createSpan(init: FakeElementInit = {}): FakeElement {
    return this.createEl("span", init);
  }

  empty(): void {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
  }

  setText(text: string): void {
    this.ownText = text;
  }

  addClass(cls: string): void {
    for (const name of cls.split(/\s+/).filter(Boolean)) {
      this.className = `${this.className} ${name}`.trim();
    }
  }

  removeClass(cls: string): void {
    const drop = new Set(cls.split(/\s+/).filter(Boolean));
    this.className = this.className
      .split(/\s+/)
      .filter((name) => name && !drop.has(name))
      .join(" ");
  }

  hasClass(cls: string): boolean {
    return this.className.split(/\s+/).includes(cls);
  }

  // --- Tree / attributes ---------------------------------------------------

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.ownText = value;
    this.empty();
  }

  // --- Events --------------------------------------------------------------

  addEventListener(type: string, listener: FakeListener): void {
    const existing = this.listeners.get(type);
    if (existing) existing.push(listener);
    else this.listeners.set(type, [listener]);
  }

  /** Dispatches here and bubbles up the ancestor chain, like a real click. */
  dispatchEvent(event: FakeEvent): void {
    let node: FakeElement | null = this;
    while (node) {
      for (const listener of node.listeners.get(event.type) ?? []) listener(event);
      if (event.propagationStopped) return;
      node = node.parent;
    }
  }

  click(): void {
    this.dispatchEvent(new FakeEvent("click"));
  }
}

/** Every descendant of `root`, in document order (the root itself excluded). */
function descendants(root: FakeElement): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (element: FakeElement): void => {
    for (const child of element.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function byClass(root: FakeElement, ...classes: string[]): FakeElement[] {
  return descendants(root).filter((el) => classes.every((cls) => el.hasClass(cls)));
}

/** Direct children of `root` carrying `cls` — used to reach the panel buttons. */
function directByClass(root: FakeElement, cls: string): FakeElement[] {
  return root.children.filter((child) => child.hasClass(cls));
}

function one(root: FakeElement, ...classes: string[]): FakeElement {
  const [first] = byClass(root, ...classes);
  if (!first) throw new Error(`no element matching .${classes.join(".")}`);
  return first;
}

/** The dismiss / restore button living in a card's head. */
function dismissButton(card: FakeElement): FakeElement {
  return one(one(card, "enhanced-graph-card-head"), "enhanced-graph-link");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface NodeOverrides {
  readonly id: string;
  readonly label?: string;
  readonly type?: PageType;
  readonly community?: number;
  readonly linkCount?: number;
}

function makeNode(overrides: NodeOverrides): GraphNode {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    type: overrides.type ?? "other",
    rawType: "",
    path: `${overrides.id}.md`,
    linkCount: overrides.linkCount ?? 0,
    inLinks: overrides.linkCount ?? 0,
    outLinks: 0,
    community: overrides.community ?? 0,
    sources: [],
    tags: [],
    isStructural: false,
  };
}

interface ConnectionOverrides {
  readonly weight?: number;
  readonly score?: number;
  readonly reasons?: readonly ConnectionReason[];
  readonly contributions?: Readonly<Partial<Record<ConnectionReason, number>>>;
}

function makeConnection(
  source: GraphNode,
  target: GraphNode,
  overrides: ConnectionOverrides = {},
): UnexpectedLink {
  return {
    key: connectionKey(source.id, target.id),
    source,
    target,
    score: overrides.score ?? 5,
    weight: overrides.weight ?? 4.25,
    reasons: overrides.reasons ?? ["cross-community"],
    contributions: overrides.contributions ?? { "cross-community": 3 },
  };
}

interface GapOverrides {
  readonly key?: string;
  readonly type?: GapType;
  readonly title?: string;
  readonly description?: string;
  readonly suggestion?: string;
  readonly nodeIds?: readonly string[];
}

function makeGap(overrides: GapOverrides = {}): CoverageGap {
  return {
    key: overrides.key ?? "gap:isolated-node:孤立页面:alpha,beta",
    type: overrides.type ?? "isolated",
    title: overrides.title ?? "2 个孤立页面",
    description: overrides.description ?? "Alpha、Beta",
    suggestion: overrides.suggestion ?? "建议补充 [[wikilinks]]。",
    nodeIds: overrides.nodeIds ?? ["alpha", "beta"],
  };
}

function makeGraph(nodes: readonly GraphNode[]): WikiGraph {
  const edges: readonly GraphEdge[] = [];
  const communities: readonly CommunityInfo[] = [];
  return { nodes, edges, communities, nodeIndex: new Map(nodes.map((node) => [node.id, node])), builtAt: 1 };
}

const ALPHA = makeNode({ id: "alpha", label: "Alpha", type: "source", linkCount: 3 });
const BETA = makeNode({ id: "beta", label: "Beta", type: "concept", linkCount: 4 });
const GAMMA = makeNode({ id: "gamma", label: "Gamma", type: "query", linkCount: 2 });
const GRAPH = makeGraph([ALPHA, BETA, GAMMA]);

interface FocusCall {
  readonly ids: readonly string[];
  readonly edges: readonly string[];
}

interface DismissCall {
  readonly key: string;
  readonly ids: readonly string[];
}

interface IconCall {
  readonly element: FakeElement;
  readonly icon: string;
}

interface PanelFixture {
  readonly container: FakeElement;
  readonly focusCalls: FocusCall[];
  readonly dismissCalls: DismissCall[];
  readonly icons: IconCall[];
  readonly toggleCount: number;
  /** Cards in document order. */
  cards(): FakeElement[];
}

/** Renders the panel into a fresh fake container and records every callback. */
function render(overrides: Partial<InsightsPanelOptions> = {}): PanelFixture {
  const container = new FakeElement("div");
  const focusCalls: FocusCall[] = [];
  const dismissCalls: DismissCall[] = [];
  const icons: IconCall[] = [];
  let toggleCount = 0;

  const options: InsightsPanelOptions = {
    graph: GRAPH,
    insights: { connections: [], gaps: [] },
    dismissed: new Set(),
    showDismissed: false,
    activeNodeIds: new Set(),
    setIconImpl: (el, icon) => icons.push({ element: el as unknown as FakeElement, icon }),
    onToggleFocus: (ids, edges) => focusCalls.push({ ids, edges }),
    onDismiss: (key, ids) => dismissCalls.push({ key, ids }),
    onToggleShowDismissed: () => {
      toggleCount += 1;
    },
    ...overrides,
  };

  renderInsightsPanel(container as unknown as HTMLElement, options);

  return {
    container,
    focusCalls,
    dismissCalls,
    icons,
    get toggleCount() {
      return toggleCount;
    },
    cards: () => byClass(container, "enhanced-graph-card"),
  };
}

// ---------------------------------------------------------------------------
// connectionEdgeKey
// ---------------------------------------------------------------------------

describe("connectionEdgeKey", () => {
  it("joins the pair with ::: and is order-independent", () => {
    expect(connectionEdgeKey("a", "b")).toBe("a:::b");
    expect(connectionEdgeKey("b", "a")).toBe("a:::b");
    expect(connectionEdgeKey("b", "a")).toBe(connectionEdgeKey("a", "b"));
    expect(connectionEdgeKey("concepts/splade", "concepts/dpr")).toBe(
      "concepts/dpr:::concepts/splade",
    );
  });

  it("keeps a self-pair readable", () => {
    expect(connectionEdgeKey("beta", "beta")).toBe("beta:::beta");
  });

  it("matches the dismiss-key format built by core/insights", () => {
    const pairs = [
      ["a", "b"],
      ["beta", "alpha"],
      ["concepts/SPLADE", "concepts/dpr"],
      ["z", "a"],
    ] as const;

    for (const [a, b] of pairs) {
      expect(connectionEdgeKey(a, b)).toBe(connectionKey(a, b));
      expect(connectionEdgeKey(b, a)).toBe(connectionKey(a, b));
    }
  });
});

// ---------------------------------------------------------------------------
// countUndismissed
// ---------------------------------------------------------------------------

describe("countUndismissed", () => {
  it("returns 0 for empty insights", () => {
    expect(countUndismissed({ connections: [], gaps: [] }, new Set())).toBe(0);
  });

  it("counts connections and gaps together", () => {
    const insights: GraphInsights = {
      connections: [
        makeConnection(ALPHA, BETA),
        makeConnection(ALPHA, GAMMA),
        makeConnection(BETA, GAMMA),
      ],
      gaps: [makeGap(), makeGap({ key: "gap:bridge-node:x:gamma" })],
    };

    expect(countUndismissed(insights, new Set())).toBe(5);
  });

  it("skips dismissed keys on both halves", () => {
    const connection = makeConnection(ALPHA, BETA);
    const gap = makeGap();
    const insights: GraphInsights = { connections: [connection], gaps: [gap] };

    expect(countUndismissed(insights, new Set([connection.key]))).toBe(1);
    expect(countUndismissed(insights, new Set([gap.key]))).toBe(1);
    expect(countUndismissed(insights, new Set([connection.key, gap.key]))).toBe(0);
  });

  it("ignores dismissed keys that match nothing in the analysis", () => {
    const insights: GraphInsights = {
      connections: [makeConnection(ALPHA, BETA)],
      gaps: [],
    };

    // Stale keys survive in settings after a rebuild; they must not be counted.
    expect(countUndismissed(insights, new Set(["alpha:::gamma", "gap:gone:x:y"]))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Connection cards
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / connection cards", () => {
  const connection = makeConnection(ALPHA, BETA);

  function connectionPanel(overrides: Partial<InsightsPanelOptions> = {}): PanelFixture {
    return render({ insights: { connections: [connection], gaps: [] }, ...overrides });
  }

  it("renders the 惊奇连接 section with the link-2 icon before the label", () => {
    const fixture = connectionPanel();
    const title = one(fixture.container, "enhanced-graph-section-title");

    expect(title.children).toHaveLength(2);
    expect(title.children[0]?.className).toBe("enhanced-graph-icon-connection");
    expect(title.children[1]?.textContent).toBe(t("insights.connections"));
    // The section glyph is mounted on the span itself, before the label span.
    expect(fixture.icons[0]?.element).toBe(title.children[0]);
    expect(fixture.icons[0]?.icon).toBe("link-2");
  });

  it("renders one card whose head carries A ↔ B and a dismiss button", () => {
    const fixture = connectionPanel();
    const cards = fixture.cards();

    expect(cards).toHaveLength(1);
    expect(one(cards[0] as FakeElement, "enhanced-graph-card-title").textContent).toBe("Alpha ↔ Beta");

    const dismiss = dismissButton(cards[0] as FakeElement);
    expect(dismiss.tagName).toBe("button");
    expect(dismiss.title).toBe(t("insights.dismiss"));
    expect(dismiss.getAttribute("aria-label")).toBe(t("insights.dismiss"));
    expect(fixture.icons[1]?.element).toBe(dismiss);
    expect(fixture.icons[1]?.icon).toBe("x");
  });

  it("shows the weight as a fixed-2 score value and the surprise badge", () => {
    const fixture = connectionPanel({
      insights: {
        connections: [makeConnection(ALPHA, BETA, { weight: 4.25, score: 5 })],
        gaps: [],
      },
    });
    const card = fixture.cards()[0] as FakeElement;

    expect(one(card, "enhanced-graph-card-score-value").textContent).toBe("4.25");
    expect(one(card, "enhanced-graph-card-surprise").textContent).toBe("★ 5");
    // The score row keeps the plain label as its first child, with the trailing
    // space the renderer has always emitted.
    const scoreRow = one(card, "enhanced-graph-card-score");
    expect(scoreRow.children[0]?.textContent).toBe(`${t("edge.score")} `);
  });

  it("rounds the weight to two decimals the same way toFixed does", () => {
    const fixture = connectionPanel({
      insights: { connections: [makeConnection(ALPHA, BETA, { weight: 3 })], gaps: [] },
    });

    expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-score-value").textContent).toBe(
      "3.00",
    );
  });

  it("joins the reason texts with a full-width comma", () => {
    const fixture = connectionPanel({
      insights: {
        connections: [makeConnection(ALPHA, BETA, { reasons: ["cross-community", "distant-types"] })],
        gaps: [],
      },
    });
    const meta = one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-meta");

    expect(meta.textContent).toBe(
      `${t("reason.cross-community")}，${t("reason.distant-types", { a: "source", b: "concept" })}`,
    );
    expect(meta.textContent).toContain("，");
  });

  it("halves the source-overlap contribution when naming the shared sources", () => {
    const fixture = connectionPanel({
      insights: {
        connections: [
          makeConnection(ALPHA, BETA, {
            reasons: ["source-overlap"],
            contributions: { "source-overlap": 5 },
          }),
        ],
        gaps: [],
      },
    });

    // 5 points of signal ÷ the 2-point weight, rounded → 3 shared sources.
    expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-meta").textContent).toBe(
      t("reason.source-overlap", { count: 3 }),
    );
  });

  it("falls back to the bare reason text when no contribution is recorded", () => {
    const fixture = connectionPanel({
      insights: {
        connections: [
          makeConnection(ALPHA, BETA, { reasons: ["weak-tie"], contributions: {} }),
        ],
        gaps: [],
      },
    });

    expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-meta").textContent).toBe(
      t("reason.weak-tie"),
    );
  });
});

// ---------------------------------------------------------------------------
// Active-card detection
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / active card detection", () => {
  const connection = makeConnection(ALPHA, BETA);

  function cardWithActive(activeNodeIds: readonly string[]): FakeElement {
    const fixture = render({
      insights: { connections: [connection], gaps: [] },
      activeNodeIds: new Set(activeNodeIds),
    });
    return fixture.cards()[0] as FakeElement;
  }

  it("marks the card active only when the ids match exactly", () => {
    expect(cardWithActive(["alpha", "beta"]).hasClass("is-active-connection")).toBe(true);
    // Order of the highlight set must not matter.
    expect(cardWithActive(["beta", "alpha"]).hasClass("is-active-connection")).toBe(true);
  });

  it("does not mark a superset active", () => {
    // Focusing a node and its neighbours is a different focus.
    expect(cardWithActive(["alpha", "beta", "gamma"]).hasClass("is-active-connection")).toBe(false);
  });

  it("does not mark a subset active", () => {
    expect(cardWithActive(["alpha"]).hasClass("is-active-connection")).toBe(false);
    expect(cardWithActive([]).hasClass("is-active-connection")).toBe(false);
  });

  it("does not mark a same-sized but different set active", () => {
    expect(cardWithActive(["alpha", "gamma"]).hasClass("is-active-connection")).toBe(false);
  });

  it("toggles focus off when the active card is clicked", () => {
    const fixture = render({
      insights: { connections: [connection], gaps: [] },
      activeNodeIds: new Set(["alpha", "beta"]),
    });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: [], edges: [] }]);
  });

  it("focuses both nodes and exactly one edge key when an inactive card is clicked", () => {
    const fixture = render({ insights: { connections: [connection], gaps: [] } });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: ["alpha", "beta"], edges: ["alpha:::beta"] }]);
  });

  it("dismisses with the card's key and leaves the focus alone", () => {
    const fixture = render({ insights: { connections: [connection], gaps: [] } });
    const dismiss = one(fixture.cards()[0] as FakeElement, "enhanced-graph-link");
    dismiss.click();

    expect(fixture.focusCalls).toEqual([]);
    expect(fixture.dismissCalls).toEqual([{ key: "alpha:::beta", ids: ["alpha", "beta"] }]);
  });
});

// ---------------------------------------------------------------------------
// Gap cards
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / gap cards", () => {
  const gap = makeGap();

  function gapPanel(overrides: Partial<InsightsPanelOptions> = {}): PanelFixture {
    return render({ insights: { connections: [], gaps: [gap] }, ...overrides });
  }

  it("renders the 知识空白 section with the alert-triangle icon", () => {
    const fixture = gapPanel();
    const title = one(fixture.container, "enhanced-graph-section-title");

    expect(title.children[0]?.className).toBe("enhanced-graph-icon-gap");
    expect(title.children[1]?.textContent).toBe(t("insights.gaps"));
    expect(fixture.icons[0]?.icon).toBe("alert-triangle");
  });

  it("renders the title, description and suggestion", () => {
    const card = gapPanel().cards()[0] as FakeElement;

    expect(one(card, "enhanced-graph-card-title").textContent).toBe("2 个孤立页面");
    expect(one(card, "enhanced-graph-card-meta").textContent).toBe("Alpha、Beta");
    expect(one(card, "enhanced-graph-card-suggestion").textContent).toBe("建议补充 [[wikilinks]]。");
    // A gap card has no score row.
    expect(byClass(card, "enhanced-graph-card-score")).toEqual([]);
  });

  it("marks the gap active only when its node ids match exactly", () => {
    expect(
      (gapPanel({ activeNodeIds: new Set(["alpha", "beta"]) }).cards()[0] as FakeElement).hasClass(
        "is-active-gap",
      ),
    ).toBe(true);
    expect(
      (gapPanel({ activeNodeIds: new Set(["alpha", "beta", "gamma"]) }).cards()[0] as FakeElement).hasClass(
        "is-active-gap",
      ),
    ).toBe(false);
    expect(
      (gapPanel({ activeNodeIds: new Set(["beta"]) }).cards()[0] as FakeElement).hasClass("is-active-gap"),
    ).toBe(false);
  });

  it("focuses the gap nodes with no edge keys, and clears when already active", () => {
    const inactive = gapPanel();

    (inactive.cards()[0] as FakeElement).click();
    expect(inactive.focusCalls).toEqual([{ ids: ["alpha", "beta"], edges: [] }]);

    const active = gapPanel({ activeNodeIds: new Set(["alpha", "beta"]) });
    (active.cards()[0] as FakeElement).click();
    expect(active.focusCalls).toEqual([{ ids: [], edges: [] }]);
  });

  it("dismisses with the gap key and its node ids, without focusing", () => {
    const fixture = gapPanel();
    const dismiss = dismissButton(fixture.cards()[0] as FakeElement);

    dismiss.click();

    expect(fixture.dismissCalls).toEqual([{ key: gap.key, ids: ["alpha", "beta"] }]);
    expect(fixture.focusCalls).toEqual([]);
    expect(fixture.icons[1]?.icon).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// Dismissal
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / dismissal", () => {
  const connection = makeConnection(ALPHA, BETA);
  const gap = makeGap();
  const insights: GraphInsights = { connections: [connection], gaps: [gap] };

  it("hides dismissed cards by default", () => {
    const fixture = render({ insights, dismissed: new Set([connection.key]) });

    expect(fixture.cards()).toHaveLength(1);
    expect(one(fixture.container, "enhanced-graph-card-title").textContent).toBe(gap.title);
  });

  it("shows dismissed cards dimmed when showDismissed is on", () => {
    const fixture = render({
      insights,
      dismissed: new Set([connection.key]),
      showDismissed: true,
    });
    const cards = fixture.cards();

    expect(cards).toHaveLength(2);
    expect(cards[0]?.hasClass("is-dismissed")).toBe(true);
    expect(cards[1]?.hasClass("is-dismissed")).toBe(false);
    // A dismissed connection offers "restore" instead of "dismiss".
    expect(fixture.icons.map((call) => call.icon)).toEqual([
      "link-2",
      "rotate-ccw",
      "alert-triangle",
      "x",
    ]);
  });

  it("marks a connection card both active and dismissed at once", () => {
    const fixture = render({
      insights,
      dismissed: new Set([connection.key]),
      showDismissed: true,
      activeNodeIds: new Set(["alpha", "beta"]),
    });

    expect(fixture.cards()[0]?.className).toBe("enhanced-graph-card is-active-connection is-dismissed");
  });

  it("renders the empty state once every card is dismissed", () => {
    const fixture = render({ insights, dismissed: new Set([connection.key, gap.key]) });

    expect(fixture.cards()).toEqual([]);
    expect(one(fixture.container, "enhanced-graph-empty").textContent).toBe(t("insights.empty"));
  });

  it("renders no empty state while a card is visible", () => {
    expect(byClass(render({ insights }).container, "enhanced-graph-empty")).toEqual([]);
  });

  it("offers the show-dismissed toggle only while something is hidden", () => {
    expect(directByClass(render({ insights }).container, "enhanced-graph-link")).toEqual([]);

    const hidden = render({ insights, dismissed: new Set([connection.key]) });
    const toggles = directByClass(hidden.container, "enhanced-graph-link");
    expect(toggles).toHaveLength(1);
    // Only the hidden card is counted, even though a gap is still visible.
    expect(toggles[0]?.textContent).toBe(t("insights.showDismissed", { count: 1 }));
  });

  it("switches the toggle to a reset once dismissed cards are shown", () => {
    const fixture = render({
      insights,
      dismissed: new Set([connection.key, gap.key]),
      showDismissed: true,
    });
    const toggles = directByClass(fixture.container, "enhanced-graph-link");

    // Everything is visible again, so the toggle survives only as the way back.
    expect(toggles).toHaveLength(1);
    expect(toggles[0]?.textContent).toBe(t("toolbar.reset"));
    expect(fixture.cards()).toHaveLength(2);
  });

  it("reports a toggle click to the caller", () => {
    const fixture = render({ insights, dismissed: new Set([connection.key, gap.key]) });
    const toggle = directByClass(fixture.container, "enhanced-graph-link")[0] as FakeElement;

    toggle.click();

    expect(fixture.toggleCount).toBe(1);
    // The panel is stateless: the caller re-renders with the new mode.
    expect(fixture.focusCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clear highlight, ordering and container handling
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / structure", () => {
  const connection = makeConnection(ALPHA, BETA);
  const gap = makeGap();

  it("offers the clear-highlight button only while nodes are emphasised", () => {
    expect(byClass(render({}).container, "enhanced-graph-button")).toEqual([]);

    const fixture = render({ insights: { connections: [connection], gaps: [] }, activeNodeIds: new Set(["alpha"]) });
    const clear = one(fixture.container, "enhanced-graph-button");

    expect(clear.textContent).toBe(t("insights.clearHighlight"));
    clear.click();
    expect(fixture.focusCalls).toEqual([{ ids: [], edges: [] }]);
  });

  it("renders connections before gaps", () => {
    const fixture = render({ insights: { connections: [connection], gaps: [gap] } });
    const sectionTitles = byClass(fixture.container, "enhanced-graph-section-title");

    expect(sectionTitles).toHaveLength(2);
    expect(sectionTitles[0]?.textContent).toBe(t("insights.connections"));
    expect(sectionTitles[1]?.textContent).toBe(t("insights.gaps"));
    expect(fixture.cards()).toHaveLength(2);
  });

  it("appends after the caller's own children instead of clearing them", () => {
    // Regression: the view renders the panel header (title + close button) into
    // the same element it hands over, so emptying the container here silently
    // deleted the header — something the head-less harness never asserted on.
    const container = new FakeElement("div");
    const header = container.createDiv({ cls: "enhanced-graph-panel-header" });
    header.createSpan({ text: t("insights.title") });
    header.createEl("button", { cls: "enhanced-graph-link" }).setText("x");

    renderInsightsPanel(container as unknown as HTMLElement, {
      graph: GRAPH,
      insights: { connections: [connection], gaps: [gap] },
      dismissed: new Set(),
      showDismissed: false,
      activeNodeIds: new Set(),
      onToggleFocus: () => {},
      onDismiss: () => {},
      onToggleShowDismissed: () => {},
    });

    expect(container.children[0]).toBe(header);
    expect(one(container, "enhanced-graph-panel-header").textContent).toBe(t("insights.title") + "x");
    // Header first, then the body — the order the view has always produced.
    expect(container.children.map((child) => child.className)).toEqual([
      "enhanced-graph-panel-header",
      "enhanced-graph-section",
      "enhanced-graph-section",
    ]);
  });

  it("defaults to Obsidian's setIcon when no renderer is injected", () => {
    // `vitest.config.ts` aliases `obsidian` to `harness/obsidian-stub.ts`, whose
    // setIcon writes an `<svg data-icon="…">` into the element — so a consumer
    // that omits `setIconImpl` still gets its glyphs.
    const container = new FakeElement("div");
    renderInsightsPanel(container as unknown as HTMLElement, {
      graph: GRAPH,
      insights: { connections: [connection], gaps: [] },
      dismissed: new Set(),
      showDismissed: false,
      activeNodeIds: new Set(),
      onToggleFocus: () => {},
      onDismiss: () => {},
      onToggleShowDismissed: () => {},
    });

    expect(one(container, "enhanced-graph-icon-connection").innerHTML).toContain("link-2");
    expect(one(container, "enhanced-graph-card-title").textContent).toBe("Alpha ↔ Beta");
  });
});
