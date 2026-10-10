/**
 * `insights-panel` tests.
 *
 * The suite runs in Vitest's default `node` environment (only the official-graph
 * test opts into jsdom, per file), so the DOM here is a hand-rolled tree rather
 * than a real document. That is enough because the module under test is a pure
 * DOM builder: it only ever creates children of the container it is handed and
 * never touches `document`, so nothing has to be installed on `globalThis`.
 *
 * Fixtures are built through the real `core/insights` model and grouped with the
 * real `buildBundle`, never as a hand-written `sections` array: the panel's whole
 * claim is that it renders whatever the engine declares, and a fixture that
 * pre-computed the grouping by hand would keep passing after the grouping broke.
 *
 * Assertions read real `t()` output. That is deliberate — a card whose key is
 * missing renders the key itself, and only a comparison against the dictionary
 * catches that.
 *
 * Icons are routed through `setIconImpl`: a recorder replaces the aliased
 * Obsidian `setIcon` so every glyph can be asserted, and one test omits it to
 * prove the real default is still wired up.
 */

import { describe, expect, it } from "vitest";

import type {
  CommunityInfo,
  GraphEdge,
  GraphNode,
  PageType,
  WikiGraph,
} from "../src/types";
import { t } from "../src/i18n";
import { edgeKey } from "../src/core/graph-keys";
import { countUndismissed as countUndismissedInBundle } from "../src/core/insights/sections";
import {
  documentFinding,
  pairFinding,
  type Confidence,
  type Effort,
  type Evidence,
  type Finding,
  type FindingKind,
  type InsightBundle,
  type InsightAction,
  type Severity,
} from "../src/core/insights/model";
import { buildBundle } from "../src/core/insights/sections";
import {
  connectionEdgeKey,
  countUndismissed,
  HUB_DEGREE_WARNING,
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
  disabled = false;
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
    // A disabled button dispatches no click at all. Without this the fake tree
    // would bubble the event to the card and report a focus the browser would
    // never perform.
    if (this.disabled) return;
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

/** The panel's show-dismissed / reset toggle: a direct child link button. */
function toggleButton(container: FakeElement): FakeElement | undefined {
  return directByClass(container, "enhanced-graph-link")[0];
}

// ---------------------------------------------------------------------------
// Graph fixtures
// ---------------------------------------------------------------------------

interface NodeOverrides {
  readonly id: string;
  readonly label?: string;
  readonly type?: PageType;
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
    vaultLinkCount: overrides.linkCount ?? 0,
    inLinks: overrides.linkCount ?? 0,
    outLinks: 0,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
  };
}

function makeGraph(nodes: readonly GraphNode[]): WikiGraph {
  const edges: readonly GraphEdge[] = [];
  const communities: readonly CommunityInfo[] = [];
  return {
    nodes,
    edges,
    communities,
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
    folders: [],
    builtAt: 1,
  };
}

const ALPHA = makeNode({ id: "alpha", label: "Alpha", type: "source", linkCount: 3 });
const BETA = makeNode({ id: "beta", label: "Beta", type: "concept", linkCount: 4 });
const GAMMA = makeNode({ id: "gamma", label: "Gamma", type: "query", linkCount: 2 });
const GRAPH = makeGraph([ALPHA, BETA, GAMMA]);

// ---------------------------------------------------------------------------
// Finding fixtures — built through the real model
// ---------------------------------------------------------------------------

/** An evidence line, with the model's strongest-first order left to the model. */
function evidence(init: Partial<Evidence> & { readonly contribution: number }): Evidence {
  return {
    kind: init.kind ?? "shared-neighbour",
    labelKey: init.labelKey ?? "reason.evidence.shared-neighbour",
    params: init.params ?? {},
    contribution: init.contribution,
    ...(init.nodeIds ? { nodeIds: init.nodeIds } : {}),
  };
}

interface PairOverrides {
  readonly kind?: FindingKind;
  readonly a?: string;
  readonly b?: string;
  readonly labels?: readonly [string, string];
  readonly evidence?: readonly Evidence[];
  readonly confidence?: Confidence;
  readonly effort?: Effort;
  readonly severity?: Severity;
  readonly action?: InsightAction;
  /** Whether the anchors carry the pair's canonical edge key. */
  readonly withEdge?: boolean;
}

/** A connection-shaped finding: two pages, and one edge key by default. */
function makePair(overrides: PairOverrides = {}): Finding {
  const a = overrides.a ?? ALPHA.id;
  const b = overrides.b ?? BETA.id;
  const [labelA, labelB] = overrides.labels ?? ["Alpha", "Beta"];
  const withEdge = overrides.withEdge ?? true;
  return pairFinding({
    kind: overrides.kind ?? "existing-link",
    analyser: "test-pairs",
    a,
    b,
    titleKey: "insights.finding.existing-link",
    titleParams: { a: labelA, b: labelB },
    init: {
      evidence: overrides.evidence ?? [evidence({ contribution: 3 })],
      anchors: { nodeIds: [a, b], edgeKeys: withEdge ? [edgeKey(a, b)] : [] },
      score: 0.8,
      confidence: overrides.confidence ?? "strong",
      severity: overrides.severity ?? 2,
      effort: overrides.effort ?? "one-click",
      ...(overrides.action ? { action: overrides.action } : {}),
    },
  });
}

interface NodeOverridesFinding {
  readonly kind?: FindingKind;
  readonly id?: string;
  readonly name?: string;
  readonly evidence?: readonly Evidence[];
  readonly confidence?: Confidence;
  readonly effort?: Effort;
  readonly severity?: Severity;
  readonly action?: InsightAction;
}

/** A page-shaped finding, titled through the `{name}` keys. */
function makeNodeFinding(overrides: NodeOverridesFinding = {}): Finding {
  const id = overrides.id ?? GAMMA.id;
  return documentFinding({
    kind: overrides.kind ?? "isolated",
    analyser: "test-nodes",
    nodeId: id,
    titleKey: "insights.finding.isolated",
    titleParams: { count: 1 },
    severity: overrides.severity ?? 3,
    effort: overrides.effort ?? "edit",
    init: {
      evidence: overrides.evidence ?? [evidence({ contribution: 2 })],
      anchors: { nodeIds: [id], edgeKeys: [] },
      score: 0.5,
      confidence: overrides.confidence ?? "moderate",
      ...(overrides.action ? { action: overrides.action } : {}),
    },
  });
}

/** The bundle the panel renders, grouped by the real `buildBundle`. */
function makeBundle(
  findings: readonly Finding[],
  options: { readonly previous?: InsightBundle } = {},
): InsightBundle {
  return buildBundle(findings, {
    ...(options.previous ? { previous: options.previous } : {}),
  });
}

/**
 * A bundle holding `findings`.
 *
 * Dismissal is no longer part of the bundle — it is applied by the panel against
 * the live key set, because the bundle is cached while a dismissal only writes
 * settings. A dismissal test therefore passes `dismissed` to `render()`, and the
 * `dismissed` argument here exists only so existing call sites keep compiling.
 */
function bundleOf(
  findings: readonly Finding[],
  _dismissed: readonly string[] = [],
): InsightBundle {
  return makeBundle(findings);
}

// ---------------------------------------------------------------------------
// Panel harness
// ---------------------------------------------------------------------------

interface FocusCall {
  readonly ids: readonly string[];
  readonly edges: readonly string[];
}

interface DismissCall {
  readonly key: string;
  readonly ids: readonly string[];
}

interface ActionCall {
  readonly action: InsightAction;
  readonly finding: Finding;
}

interface IconCall {
  readonly element: FakeElement;
  readonly icon: string;
}

interface PanelFixture {
  readonly container: FakeElement;
  readonly focusCalls: FocusCall[];
  readonly dismissCalls: DismissCall[];
  readonly actionCalls: ActionCall[];
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
  const actionCalls: ActionCall[] = [];
  const icons: IconCall[] = [];
  let toggleCount = 0;

  const options: InsightsPanelOptions = {
    graph: GRAPH,
    bundle: bundleOf([]),
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
    actionCalls,
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

  it("delegates to the one edge-key definition in core/graph-keys", () => {
    const pairs = [
      ["a", "b"],
      ["beta", "alpha"],
      ["concepts/SPLADE", "concepts/dpr"],
      ["z", "a"],
    ] as const;

    for (const [a, b] of pairs) {
      expect(connectionEdgeKey(a, b)).toBe(edgeKey(a, b));
    }
  });
});

// ---------------------------------------------------------------------------
// countUndismissed
// ---------------------------------------------------------------------------

describe("countUndismissed", () => {
  it("returns 0 for a bundle with nothing in it", () => {
    expect(countUndismissed(bundleOf([]))).toBe(0);
  });

  it("counts the undismissed findings of every section", () => {
    expect(countUndismissed(bundleOf([makePair(), makePair({ a: "alpha", b: "gamma" }), makeNodeFinding()]))).toBe(3);
  });

  it("counts a dismissed finding as gone, in whichever section it sits", () => {
    const pair = makePair();
    const node = makeNodeFinding();
    const bundle = bundleOf([pair, node]);

    // Dismissal is read live: the same bundle counted against different key sets.
    expect(countUndismissed(bundle, new Set([pair.key]))).toBe(1);
    expect(countUndismissed(bundle, new Set([node.key]))).toBe(1);
    expect(countUndismissed(bundle, new Set([pair.key, node.key]))).toBe(0);
  });

  it("is the same number the bundle's own counter gives", () => {
    // The panel's counter exists for its old callers; it must not become a
    // second counting rule that drifts away from core/insights/sections.
    const node = makeNodeFinding();
    const bundle = bundleOf([makePair(), node, makePair({ a: "alpha", b: "gamma" })]);
    const dismissed = new Set([node.key]);

    expect(countUndismissed(bundle, dismissed)).toBe(countUndismissedInBundle(bundle, dismissed));
    expect(countUndismissed(bundle, dismissed)).toBe(2);
  });

  it("ignores dismissed keys that match nothing in the analysis", () => {
    // Stale keys survive in settings after a rebuild; they must not be counted.
    const bundle = bundleOf([makePair()]);
    expect(countUndismissed(bundle, new Set(["alpha:::gamma", "gap:gone:x:y"]))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Data-driven titles, evidence, badges
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / card content", () => {
  it("renders the title through t(finding.titleKey, finding.titleParams)", () => {
    const fixture = render({ bundle: bundleOf([makePair()]) });

    expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-title").textContent).toBe(
      "Alpha ↔ Beta",
    );
  });

  it("renders a node finding's title with no kind-specific branch", () => {
    const fixture = render({ bundle: bundleOf([makeNodeFinding()]) });

    expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-title").textContent).toBe(
      t("insights.finding.isolated", { count: 1 }),
    );
  });

  it("renders at most three evidence lines, in the model's order", () => {
    const finding = makePair({
      evidence: [
        evidence({ contribution: 9, nodeIds: ["alpha"] }),
        evidence({ contribution: 8, nodeIds: ["beta"] }),
        evidence({ contribution: 7, nodeIds: ["gamma"] }),
        evidence({ contribution: 6, kind: "type", labelKey: "reason.evidence.type", params: { a: "source", b: "concept" } }),
      ],
    });
    const fixture = render({ bundle: bundleOf([finding]) });
    const lines = byClass(fixture.cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(lines).toHaveLength(3);
    expect(byClass(fixture.cards()[0] as FakeElement, "enhanced-graph-evidence")).toHaveLength(3);
  });

  it("names the pages an evidence line rests on, resolved from the graph", () => {
    const finding = makePair({
      evidence: [
        evidence({
          contribution: 4,
          params: { count: 2 },
          nodeIds: ["alpha", "gamma"],
        }),
      ],
    });
    const fixture = render({ bundle: bundleOf([finding]) });
    const line = one(fixture.cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(line.textContent).toBe(
      `${t("reason.evidence.shared-neighbour", { count: 2 })}${t("insights.evidenceNodes", {
        names: "[[Alpha]]、[[Gamma]]",
      })}`,
    );
    expect(one(line, "enhanced-graph-evidence-nodes").textContent).toBe(
      t("insights.evidenceNodes", { names: "[[Alpha]]、[[Gamma]]" }),
    );
  });

  it("skips node ids the graph does not know", () => {
    const finding = makePair({
      evidence: [
        evidence({ contribution: 4, nodeIds: ["alpha", "deleted-note", "gamma"] }),
      ],
    });
    const line = one(render({ bundle: bundleOf([finding]) }).cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(one(line, "enhanced-graph-evidence-nodes").textContent).toBe(
      t("insights.evidenceNodes", { names: "[[Alpha]]、[[Gamma]]" }),
    );
  });

  it("renders no page list when every id is missing from the graph", () => {
    const finding = makePair({
      evidence: [evidence({ contribution: 4, nodeIds: ["gone", "also-gone"] })],
    });
    const line = one(render({ bundle: bundleOf([finding]) }).cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(byClass(line, "enhanced-graph-evidence-nodes")).toEqual([]);
  });

  it("shows the omitted count when the evidence reports one", () => {
    const finding = makePair({
      evidence: [evidence({ contribution: 4, params: { count: 5, omitted: 2 }, nodeIds: ["alpha"] })],
    });
    const line = one(render({ bundle: bundleOf([finding]) }).cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(one(line, "enhanced-graph-evidence-omitted").textContent).toBe(
      t("insights.evidenceOmitted", { count: 2 }),
    );
  });

  it("shows no omitted marker when omitted is absent or zero", () => {
    const absent = makePair({ evidence: [evidence({ contribution: 4, nodeIds: ["alpha"] })] });
    const zero = makePair({
      evidence: [evidence({ contribution: 4, params: { count: 5, omitted: 0 }, nodeIds: ["alpha"] })],
    });

    expect(
      byClass(one(render({ bundle: bundleOf([absent]) }).cards()[0] as FakeElement, "enhanced-graph-evidence"), "enhanced-graph-evidence-omitted"),
    ).toEqual([]);
    expect(
      byClass(one(render({ bundle: bundleOf([zero]) }).cards()[0] as FakeElement, "enhanced-graph-evidence"), "enhanced-graph-evidence-omitted"),
    ).toEqual([]);
  });

  it("warns when the strongest shared neighbour is a hub", () => {
    const finding = makePair({
      evidence: [evidence({ contribution: 6, params: { count: 3, maxDegree: HUB_DEGREE_WARNING }, nodeIds: ["alpha"] })],
    });
    const line = one(render({ bundle: bundleOf([finding]) }).cards()[0] as FakeElement, "enhanced-graph-evidence");
    const marker = one(line, "enhanced-graph-evidence-hub");

    expect(marker.textContent).toBe(t("insights.evidenceHubWarning", { degree: 20 }));
    expect(line.textContent).toContain("⚠");
  });

  it("does not warn at degree 19 (negative control)", () => {
    const finding = makePair({
      evidence: [evidence({ contribution: 6, params: { count: 3, maxDegree: 19 }, nodeIds: ["alpha"] })],
    });
    const line = one(render({ bundle: bundleOf([finding]) }).cards()[0] as FakeElement, "enhanced-graph-evidence");

    expect(byClass(line, "enhanced-graph-evidence-hub")).toEqual([]);
    expect(line.textContent).not.toContain("⚠");
    expect(HUB_DEGREE_WARNING).toBe(20);
  });

  it("does not warn when the evidence carries no maxDegree at all", () => {
    const line = one(
      render({ bundle: bundleOf([makePair()]) }).cards()[0] as FakeElement,
      "enhanced-graph-evidence",
    );

    expect(byClass(line, "enhanced-graph-evidence-hub")).toEqual([]);
  });

  it("renders the confidence and effort badges from the finding's own values", () => {
    const strong = render({
      bundle: bundleOf([makePair({ confidence: "strong", effort: "one-click" })]),
    });
    const strongCard = strong.cards()[0] as FakeElement;

    expect(one(strongCard, "enhanced-graph-confidence").textContent).toBe(t("insights.confidence.strong"));
    expect(one(strongCard, "enhanced-graph-effort").textContent).toBe(t("insights.effort.one-click"));

    const weak = render({
      bundle: bundleOf([makePair({ confidence: "weak", effort: "write" })]),
    });
    const weakCard = weak.cards()[0] as FakeElement;

    expect(one(weakCard, "enhanced-graph-confidence").textContent).toBe(t("insights.confidence.weak"));
    expect(one(weakCard, "enhanced-graph-effort").textContent).toBe(t("insights.effort.write"));
  });

  it("marks the badge with the state so the stylesheet can tell them apart", () => {
    const card = render({
      bundle: bundleOf([makePair({ confidence: "moderate", effort: "edit" })]),
    }).cards()[0] as FakeElement;

    expect(one(card, "enhanced-graph-confidence").hasClass("is-moderate")).toBe(true);
    expect(one(card, "enhanced-graph-effort").hasClass("is-edit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / actions", () => {
  const insertLink: InsightAction = {
    kind: "insert-wikilink",
    sourceId: "alpha",
    targetId: "beta",
    text: "[[Beta]]",
  };

  it("labels the button by action kind and reports the click to onAction", () => {
    const finding = makePair({ action: insertLink });
    const fixture = render({ bundle: bundleOf([finding]), onAction: (action, subject) => fixture.actionCalls.push({ action, finding: subject }) });
    const button = one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-action");

    expect(button.tagName).toBe("button");
    expect(button.textContent).toBe(t("insights.action.insert-link"));
    button.click();

    expect(fixture.actionCalls).toEqual([{ action: insertLink, finding }]);
  });

  it("does not focus the card when the action is clicked", () => {
    const fixture = render({
      bundle: bundleOf([makePair({ action: insertLink })]),
      onAction: (action, finding) => fixture.actionCalls.push({ action, finding }),
    });
    one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-action").click();

    expect(fixture.focusCalls).toEqual([]);
    expect(fixture.actionCalls).toHaveLength(1);
  });

  it("renders the button disabled when the host wired no onAction", () => {
    const fixture = render({ bundle: bundleOf([makePair({ action: insertLink })]) });
    const button = one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-action");

    expect(button.disabled).toBe(true);
    expect(button.title).toBe(t("insights.actionUnavailable"));
    button.click();
    expect(fixture.actionCalls).toEqual([]);
    expect(fixture.focusCalls).toEqual([]);
  });

  it("renders no action button for a finding without an action", () => {
    const fixture = render({ bundle: bundleOf([makePair()]) });

    expect(byClass(fixture.cards()[0] as FakeElement, "enhanced-graph-card-action")).toEqual([]);
  });

  it("labels each action kind from the dictionary", () => {
    const kinds: readonly InsightAction[] = [
      { kind: "open-notes", nodeIds: ["alpha", "beta"] },
      { kind: "create-moc", nodeIds: ["alpha"], suggestedTitle: "Index" },
      { kind: "open-report" },
    ];
    const expected = [
      t("insights.action.open-notes"),
      t("insights.action.create-moc"),
      t("insights.action.copy"),
    ];

    for (const [index, action] of kinds.entries()) {
      const finding = makePair({ action });
      const fixture = render({ bundle: bundleOf([finding]), onAction: () => {} });
      expect(one(fixture.cards()[0] as FakeElement, "enhanced-graph-card-action").textContent).toBe(
        expected[index],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Active-card detection
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / active card detection", () => {
  function cardWithActive(activeNodeIds: readonly string[]): FakeElement {
    return render({ bundle: bundleOf([makePair()]), activeNodeIds: new Set(activeNodeIds) })
      .cards()[0] as FakeElement;
  }

  it("marks a pair card active only when the ids match exactly", () => {
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

  it("marks a node finding with the gap class, not the connection class", () => {
    const fixture = render({
      bundle: bundleOf([makeNodeFinding({ id: "gamma" })]),
      activeNodeIds: new Set(["gamma"]),
    });
    const card = fixture.cards()[0] as FakeElement;

    expect(card.hasClass("is-active-gap")).toBe(true);
    expect(card.hasClass("is-active-connection")).toBe(false);
  });

  it("toggles focus off when the active card is clicked", () => {
    const fixture = render({
      bundle: bundleOf([makePair()]),
      activeNodeIds: new Set(["alpha", "beta"]),
    });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: [], edges: [] }]);
  });

  it("focuses both nodes and exactly one edge key when an inactive pair card is clicked", () => {
    const fixture = render({ bundle: bundleOf([makePair()]) });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: ["alpha", "beta"], edges: ["alpha:::beta"] }]);
  });

  it("focuses nodes only for a node finding", () => {
    const fixture = render({ bundle: bundleOf([makeNodeFinding({ id: "gamma" })]) });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: ["gamma"], edges: [] }]);
  });

  it("offers no edge key for a pair finding whose anchors carry none", () => {
    // The panel decides "connection-shaped" from the anchors, so a kind that
    // names two pages but no edge must not invent one.
    const fixture = render({ bundle: bundleOf([makePair({ withEdge: false })]) });
    (fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([{ ids: ["alpha", "beta"], edges: [] }]);
  });

  it("dismisses with the card's key and its node ids, without focusing", () => {
    const finding = makePair();
    const fixture = render({ bundle: bundleOf([finding]) });
    dismissButton(fixture.cards()[0] as FakeElement).click();

    expect(fixture.focusCalls).toEqual([]);
    expect(fixture.dismissCalls).toEqual([{ key: finding.key, ids: ["alpha", "beta"] }]);
  });

  it("marks a card both active and dismissed at once", () => {
    const finding = makePair();
    const fixture = render({
      bundle: bundleOf([finding]),
      dismissed: new Set([finding.key]),
      showDismissed: true,
      activeNodeIds: new Set(["alpha", "beta"]),
    });

    expect(fixture.cards()[0]?.className).toBe(
      "enhanced-graph-card is-active-connection is-dismissed",
    );
  });
});

// ---------------------------------------------------------------------------
// Sections and tabs
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / sections", () => {
  const pair = makePair();
  const node = makeNodeFinding();

  it("offers one tab per populated section, with its undismissed count", () => {
    const chosen: string[] = [];
    const fixture = render({
      bundle: bundleOf([pair, node]),
      onSelectSection: (section) => chosen.push(section),
    });
    const tabs = byClass(fixture.container, "enhanced-graph-button");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${t("insights.section.suggested")} (1)`,
      `${t("insights.section.gaps")} (1)`,
    ]);
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    expect(tabs[1]?.hasClass("is-active")).toBe(false);

    tabs[0]?.click();
    tabs[1]?.click();
    expect(chosen).toEqual(["suggested", "gaps"]);
  });

  it("offers no tab for a section the bundle leaves out", () => {
    const fixture = render({
      bundle: bundleOf([node]),
      activeSection: "suggested",
      onSelectSection: () => {},
    });
    const tabs = byClass(fixture.container, "enhanced-graph-button");

    // A button that opens an empty list is worse than no button, and a stale
    // choice for that section falls back to the one that has cards.
    expect(tabs.map((tab) => tab.textContent)).toEqual([`${t("insights.section.gaps")} (1)`]);
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    expect(fixture.cards()).toHaveLength(1);
  });

  it("falls back to the first populated section when the active one is stale", () => {
    const fixture = render({
      bundle: bundleOf([node]),
      activeSection: "trends",
      onSelectSection: () => {},
    });
    const tabs = byClass(fixture.container, "enhanced-graph-button");

    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    expect(one(fixture.container, "enhanced-graph-section").getAttribute("data-section")).toBe("gaps");
  });

  it("draws only the chosen section's cards", () => {
    const fixture = render({
      bundle: bundleOf([pair, node]),
      activeSection: "gaps",
      onSelectSection: () => {},
    });

    expect(fixture.cards()).toHaveLength(1);
    expect(fixture.cards()[0]?.textContent).toContain(t("insights.finding.isolated", { count: 1 }));
  });

  it("draws every section under its own heading with the section's own icon when no switcher is given", () => {
    const fixture = render({ bundle: bundleOf([pair, node]) });
    const headings = byClass(fixture.container, "enhanced-graph-section-title");

    expect(byClass(fixture.container, "enhanced-graph-button")).toEqual([]);
    // The heading carries the label and, below it, the "new since" note.
    expect(headings[0]?.children[1]?.textContent).toBe(t("insights.section.suggested"));
    expect(headings[1]?.children[1]?.textContent).toBe(t("insights.section.gaps"));
    // Icon span first, then the label — the shape the panel has always emitted.
    expect(headings[0]?.children[0]?.className).toBe("enhanced-graph-icon-suggested");
    expect(headings[1]?.children[0]?.className).toBe("enhanced-graph-icon-gaps");
    // Heading icon, card dismiss glyph, heading icon, card dismiss glyph.
    expect(fixture.icons.map((call) => call.icon)).toEqual([
      "link-2",
      "x",
      "alert-triangle",
      "x",
    ]);
    expect(fixture.icons[0]?.element).toBe(headings[0]?.children[0]);
    expect(fixture.cards()).toHaveLength(2);
  });

  it("renders the empty state only when the whole bundle has no findings", () => {
    const fixture = render({ bundle: bundleOf([]) });

    expect(one(fixture.container, "enhanced-graph-empty").textContent).toBe(t("insights.empty"));
    expect(fixture.cards()).toEqual([]);
  });

  it("renders no empty state while a card is visible", () => {
    expect(byClass(render({ bundle: bundleOf([pair]) }).container, "enhanced-graph-empty")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// New since last visit
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / new since last visit", () => {
  it("puts the count in the heading when there is no switcher", () => {
    const fixture = render({ bundle: bundleOf([makePair(), makeNodeFinding()]) });
    const headings = byClass(fixture.container, "enhanced-graph-section-title");

    expect(one(headings[0] as FakeElement, "enhanced-graph-section-new").textContent).toBe(
      t("insights.newSince", { count: 1 }),
    );
    expect(one(headings[1] as FakeElement, "enhanced-graph-section-new").textContent).toBe(
      t("insights.newSince", { count: 1 }),
    );
  });

  it("counts only the findings this build changed, not every card in the section — negative control", () => {
    // `suggested` holds two visible findings. One is identical in the previous
    // build, so it is *not* changed; the other is new. A panel that counted the
    // section's cards, or the whole bundle, would print 2 or 4 here.
    const stable = makePair();
    const fresh = makePair({ b: GAMMA.id, labels: ["Alpha", "Gamma"] });
    const bundle = makeBundle([stable, fresh], { previous: makeBundle([stable]) });
    const headings = byClass(render({ bundle }).container, "enhanced-graph-section-title");

    expect(bundle.changed.map((finding) => finding.key)).toEqual([fresh.key]);
    expect(one(headings[0] as FakeElement, "enhanced-graph-section-new").textContent).toBe(
      t("insights.newSince", { count: 1 }),
    );
  });

  it("counts only the findings in its own section — negative control", () => {
    // Three findings in `suggested` (one of them dismissed) and one in `gaps`.
    // A panel that counted the whole bundle would print 4 and 4; a panel that
    // counted every card in the section, dismissed included, would print 3.
    const finding = makePair();
    const fixture = render({
      bundle: bundleOf([
        finding,
        makePair({ a: "alpha", b: "gamma" }),
        makePair({ a: "beta", b: "gamma" }),
        makeNodeFinding(),
      ]),
      dismissed: new Set([finding.key]),
    });
    const headings = byClass(fixture.container, "enhanced-graph-section-title");

    expect(one(headings[0] as FakeElement, "enhanced-graph-section-new").textContent).toBe(
      t("insights.newSince", { count: 2 }),
    );
    expect(one(headings[1] as FakeElement, "enhanced-graph-section-new").textContent).toBe(
      t("insights.newSince", { count: 1 }),
    );
  });

  it("omits the note for a finding that is not in bundle.changed — negative control", () => {
    // Two builds of the same finding: same key, same content, so the second
    // bundle reports nothing as changed. Without `previous` everything is new,
    // which is why the assertion is written against a pair of bundles.
    const stable = makePair();
    const previous = makeBundle([stable]);
    const unchanged = makeBundle([stable], { previous });

    expect(unchanged.changed).toEqual([]);
    expect(byClass(render({ bundle: unchanged }).container, "enhanced-graph-section-new")).toEqual([]);
  });

  it("counts a finding whose evidence moved as new", () => {
    const before = makePair({ evidence: [evidence({ contribution: 1, nodeIds: ["alpha"] })] });
    const after = makePair({ evidence: [evidence({ contribution: 4, nodeIds: ["alpha", "gamma"] })] });
    const bundle = makeBundle([after], { previous: makeBundle([before]) });

    expect(bundle.changed.map((finding) => finding.key)).toEqual([after.key]);
    expect(
      one(render({ bundle }).container, "enhanced-graph-section-new").textContent,
    ).toBe(t("insights.newSince", { count: 1 }));
  });

  it("renders the note once above the active section's cards when tabs are used", () => {
    const fixture = render({
      bundle: bundleOf([makePair(), makeNodeFinding()]),
      activeSection: "gaps",
      onSelectSection: () => {},
    });
    const notes = byClass(fixture.container, "enhanced-graph-section-new");

    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(t("insights.newSince", { count: 1 }));
    // The tab is above the note, and the note above the cards.
    expect(byClass(fixture.container, "enhanced-graph-section-title")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dismissal
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / dismissal", () => {
  const pair = makePair();
  const node = makeNodeFinding();
  /** The live key set the panel filters by; a dismissal is a settings write. */
  const dismissed = new Set([pair.key]);

  it("hides a dismissed card by default", () => {
    const fixture = render({ bundle: bundleOf([pair, node]), dismissed });

    expect(fixture.cards()).toHaveLength(1);
    expect(one(fixture.container, "enhanced-graph-card-title").textContent).toBe(
      t("insights.finding.isolated", { count: 1 }),
    );
  });

  it("shows a dismissed card dimmed, with a restore glyph, when showDismissed is on", () => {
    const fixture = render({
      bundle: bundleOf([pair, node]),
      dismissed,
      showDismissed: true,
    });
    const cards = fixture.cards();

    expect(cards).toHaveLength(2);
    expect(cards[0]?.hasClass("is-dismissed")).toBe(true);
    expect(cards[1]?.hasClass("is-dismissed")).toBe(false);
    // A dismissed card offers "restore" instead of "dismiss"; the section heading
    // icons come first, then the two cards' buttons in document order.
    expect(dismissButton(cards[0] as FakeElement).title).toBe(t("insights.dismiss"));
    expect(fixture.icons.map((call) => call.icon)).toEqual([
      "link-2",
      "rotate-ccw",
      "alert-triangle",
      "x",
    ]);
  });

  it("offers the show-dismissed toggle only while something is hidden", () => {
    expect(toggleButton(render({ bundle: bundleOf([pair, node]) }).container)).toBeUndefined();

    const hidden = render({ bundle: bundleOf([pair, node]), dismissed });
    const toggle = toggleButton(hidden.container);

    expect(toggle?.textContent).toBe(t("insights.showDismissed", { count: 1 }));
  });

  it("switches the toggle to a reset once the dismissed cards are shown", () => {
    const fixture = render({
      bundle: bundleOf([pair, node]),
      dismissed: new Set([pair.key, node.key]),
      showDismissed: true,
    });

    // Everything is visible again, so the toggle survives only as the way back.
    expect(toggleButton(fixture.container)?.textContent).toBe(t("toolbar.reset"));
    expect(fixture.cards()).toHaveLength(2);
  });

  it("keeps the reset reachable when every key has been restored", () => {
    // No hidden cards, `showDismissed` still on: without the button the user
    // could never leave "show dismissed" mode.
    const fixture = render({ bundle: bundleOf([pair, node]), showDismissed: true });

    expect(toggleButton(fixture.container)?.textContent).toBe(t("toolbar.reset"));
  });

  it("reports a toggle click to the caller without touching the focus", () => {
    const fixture = render({
      bundle: bundleOf([pair, node]),
      dismissed: new Set([pair.key, node.key]),
    });

    toggleButton(fixture.container)?.click();

    expect(fixture.toggleCount).toBe(1);
    // The panel is stateless: the caller re-renders with the new mode.
    expect(fixture.focusCalls).toEqual([]);
  });

  it("offers the section again when every card in it is dismissed and showDismissed is on", () => {
    const fixture = render({
      bundle: bundleOf([node]),
      dismissed: new Set([node.key]),
      showDismissed: true,
      onSelectSection: () => {},
    });
    const tabs = byClass(fixture.container, "enhanced-graph-button");

    // The count is what is actually drawn, which with showDismissed on is the one
    // dismissed card — a tab must not promise fewer cards than it shows either.
    expect(tabs.map((tab) => tab.textContent)).toEqual([`${t("insights.section.gaps")} (1)`]);
    expect(fixture.cards()).toHaveLength(1);
    expect(fixture.cards()[0]?.hasClass("is-dismissed")).toBe(true);
  });

  it("offers no section at all when every card in it is dismissed and showDismissed is off", () => {
    // A section whose cards are all dismissed is not empty — the toggle is the
    // affordance, and the empty state must not claim there is nothing to see.
    const fixture = render({
      bundle: bundleOf([node]),
      dismissed: new Set([node.key]),
      onSelectSection: () => {},
    });

    expect(byClass(fixture.container, "enhanced-graph-button")).toEqual([]);
    expect(fixture.cards()).toEqual([]);
    expect(byClass(fixture.container, "enhanced-graph-empty")).toEqual([]);
    expect(toggleButton(fixture.container)?.textContent).toBe(t("insights.showDismissed", { count: 1 }));
  });
});

// ---------------------------------------------------------------------------
// Container handling and icon plumbing
// ---------------------------------------------------------------------------

describe("renderInsightsPanel / container handling", () => {
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
      bundle: bundleOf([makePair(), makeNodeFinding()]),
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

  it("offers the clear-highlight button only while nodes are emphasised", () => {
    expect(byClass(render({ bundle: bundleOf([makePair()]) }).container, "enhanced-graph-button")).toEqual([]);

    const fixture = render({
      bundle: bundleOf([makePair()]),
      activeNodeIds: new Set(["alpha"]),
    });
    const clear = one(fixture.container, "enhanced-graph-button");

    expect(clear.textContent).toBe(t("insights.clearHighlight"));
    clear.click();
    expect(fixture.focusCalls).toEqual([{ ids: [], edges: [] }]);
  });

  it("defaults to Obsidian's setIcon when no renderer is injected", () => {
    // `vitest.config.ts` aliases `obsidian` to `harness/obsidian-stub.ts`, whose
    // setIcon writes an `<svg data-icon="…">` into the element — so a consumer
    // that omits `setIconImpl` still gets its glyphs.
    const container = new FakeElement("div");
    renderInsightsPanel(container as unknown as HTMLElement, {
      graph: GRAPH,
      bundle: bundleOf([makePair()]),
      dismissed: new Set(),
      showDismissed: false,
      activeNodeIds: new Set(),
      onToggleFocus: () => {},
      onDismiss: () => {},
      onToggleShowDismissed: () => {},
    });

    expect(one(container, "enhanced-graph-icon-suggested").innerHTML).toContain("link-2");
    expect(one(container, "enhanced-graph-card-title").textContent).toBe("Alpha ↔ Beta");
  });
});
