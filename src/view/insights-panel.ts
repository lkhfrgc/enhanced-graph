/**
 * Insights panel presentation — the findings' cards, grouped into sections.
 *
 * Extracted from `EnhancedGraphView` so that a second consumer can emit the
 * exact same DOM without inheriting the view's state, its callbacks or the
 * Obsidian item-view lifecycle.
 *
 * The module is deliberately pure DOM: it only ever touches the container it
 * is handed (never `document`), holds no state between renders and knows
 * nothing about the plugin, settings persistence or `Notice`. Everything it
 * cannot own — focus toggling, dismissal, the "show dismissed" switch, which
 * section is active — is a callback on `InsightsPanelOptions`.
 *
 * The container itself belongs to the caller: the body is appended to whatever
 * is already in it and never cleared, because the view renders its own panel
 * header (title + close button) into the very same element.
 *
 * Nothing here is written twice per kind. A card is entirely data-driven:
 * `t(finding.titleKey, finding.titleParams)` for the title, the finding's own
 * evidence lines, its own confidence/effort/action. That is what §6.4 of
 * `docs/graph-insights-plan.md` asks for — adding an analyser must not mean
 * editing the view.
 */

import { setIcon } from "obsidian";

import type {
  Confidence,
  Effort,
  Evidence,
  Finding,
  InsightAction,
  InsightBundle,
  InsightSection,
  InsightSectionId,
} from "../core/insights/model";
import {
  countUndismissed as countUndismissedInBundle,
  visibleSections,
} from "../core/insights/sections";
import { edgeKey } from "../core/graph-keys";
import type { WikiGraph } from "../types";
import { t, type MessageKey } from "../i18n";
import { tabRow } from "./controls";

export type { InsightSectionId };

/** Icon renderer; matches Obsidian's `setIcon(el, iconId)` signature. */
export type SetIconImpl = (el: HTMLElement, icon: string) => void;

export interface InsightsPanelOptions {
  readonly graph: WikiGraph;
  readonly bundle: InsightBundle;
  /**
   * Keys the user has marked as seen.
   *
   * The bundle has already split its cards into visible and dismissed, so the
   * panel does not filter on this. It stays in the signature because both hosts
   * hold the set and pass it in, and because a caller reading the panel wants to
   * see the source of the split in one place.
   */
  readonly dismissed: ReadonlySet<string>;
  /** Render dismissed cards too (dimmed) instead of hiding them. */
  readonly showDismissed: boolean;
  /** The node ids currently emphasised, used to mark the active card. */
  readonly activeNodeIds: ReadonlySet<string>;
  /** Toggle focus on a card: node ids plus the edge keys that connect them. */
  readonly onToggleFocus: (nodeIds: readonly string[], edgeKeys: readonly string[]) => void;
  readonly onDismiss: (key: string, nodeIds: readonly string[]) => void;
  readonly onToggleShowDismissed: () => void;
  /**
   * Act on a finding.
   *
   * Optional on purpose: the panel performs no vault I/O — it does not open a
   * note, insert a link or write a file — so a host that has not wired the
   * action up gets a visibly disabled button rather than a button that silently
   * does nothing.
   */
  readonly onAction?: (action: InsightAction, finding: Finding) => void;
  /**
   * Which section's cards are on screen, and how to switch.
   *
   * Held by the caller rather than here: this function runs on every repaint, so
   * state kept inside it would be forgotten the moment anything else redraws the
   * panel — the tab would jump back on its own.
   *
   * Optional: with no {@link onSelectSection} every section is drawn one after
   * another under its own plain heading, which is what a caller with no panel
   * state to keep wants. A section with nothing in it gets no tab either way.
   */
  readonly activeSection?: InsightSectionId;
  readonly onSelectSection?: (section: InsightSectionId) => void;
  /**
   * Icon renderer override, defaulting to Obsidian's `setIcon`.
   *
   * The seam exists so the emitted glyphs can be asserted (and so a consumer
   * can draw them differently); production callers can simply omit it.
   */
  readonly setIconImpl?: SetIconImpl;
}

/**
 * The degree at which a shared neighbour is called a hub.
 *
 * A suggestion whose strongest evidence is found through a page this connected
 * is routed by the index rather than discovered: the same link is implied by
 * almost any pair the hub touches, so the card must say so instead of reading
 * like a discovery. The plan's §7.2 rule — "name the hub when the evidence is a
 * hub" — is what this implements.
 */
export const HUB_DEGREE_WARNING = 20;

/** How many evidence lines a card shows. */
const EVIDENCE_LINES = 3;

/**
 * Renders the insights panel body into `container`, after whatever the caller
 * has already put there.
 *
 * Deliberately does not clear `container`: the view renders the panel header
 * into the same element, so emptying it would take the title and the close
 * button with it. A caller that re-renders into a reused element clears it
 * itself (or hands in a fresh one).
 *
 * The sections switch like tabs rather than folding open and shut: one button
 * per populated section, and the cards of the chosen one below it. Folding left
 * the panel showing whichever sections happened to be open, so the lists
 * competed for the same space and the panel's height moved under the pointer
 * every time one was toggled.
 */
export function renderInsightsPanel(container: HTMLElement, options: InsightsPanelOptions): void {
  // A different name from the imported `setIcon`: a local of that name would
  // shadow it, and the `??` fallback would then read the local before it exists.
  const drawIcon = options.setIconImpl ?? setIcon;
  // Dismissal is applied HERE, against the caller's live key set, not baked into
  // the bundle. The bundle is cached while a dismissal only writes settings, so a
  // build-time split froze it: the click stored the key, re-rendered, and the card
  // stayed because the cached bundle still called it visible.
  const isDismissed = (finding: Finding): boolean => options.dismissed.has(finding.key);
  // A section whose every card is dismissed has no visible cards, so with
  // `showDismissed` off it draws no tab — a button that opens an empty list is
  // worse than no button. `bundle.sections` has already dropped the sections that
  // hold nothing at all.
  const visible = visibleSections(options.bundle, options.dismissed, options.showDismissed);
  const drawn = (section: InsightSection): readonly Finding[] =>
    options.showDismissed ? section.findings : section.findings.filter((finding) => !isDismissed(finding));
  const changedKeys = changedKeySet(options.bundle.changed);

  // The empty state is about the whole bundle: a populated section whose cards
  // are all dismissed is what "show dismissed (N)" is for, not this.
  if (options.bundle.findings.length === 0) {
    container.createDiv({ cls: "enhanced-graph-empty", text: t("insights.empty") });
  }

  if (options.activeNodeIds.size > 0) {
    const clear = container.createEl("button", {
      cls: "enhanced-graph-button",
      text: t("insights.clearHighlight"),
    });
    clear.addEventListener("click", () => options.onToggleFocus([], []));
  }

  const select = options.onSelectSection;
  // A section that is gone (or was never chosen) falls back to the first one
  // that has something in it, so the panel can never come up empty-handed.
  const active = visible.some((section) => section.id === options.activeSection)
    ? options.activeSection
    : visible[0]?.id;
  // Even a lone section gets its button: it is what says which list is on screen.
  // The count is what will actually be drawn, so a tab never promises more cards
  // than it shows.
  if (select) {
    tabRow(
      container,
      visible.map((section) => ({
        id: section.id,
        label: `${t(section.labelKey)} (${drawn(section).length})`,
      })),
      active as InsightSectionId,
      select,
    );
  }

  for (const section of visible) {
    if (select && section.id !== active) continue;
    const body = container.createDiv({ cls: "enhanced-graph-section" });
    body.setAttribute("data-section", section.id);
    const cards = drawn(section);
    const fresh = cards.filter((finding) => changedKeys.has(finding.key)).length;

    if (!select) {
      // No switcher: every section is drawn, each under its own plain heading.
      const heading = body.createDiv({ cls: "enhanced-graph-section-title" });
      const icon = heading.createSpan({ cls: `enhanced-graph-icon-${section.id}` });
      heading.createSpan({ text: t(section.labelKey) });
      drawIcon(icon, section.icon);
      if (fresh > 0) {
        heading.createSpan({
          cls: "enhanced-graph-section-new",
          text: t("insights.newSince", { count: fresh }),
        });
      }
    } else if (fresh > 0) {
      // With tabs the heading is the button above, so the note goes here once.
      body.createDiv({
        cls: "enhanced-graph-section-new",
        text: t("insights.newSince", { count: fresh }),
      });
    }

    for (const finding of cards) {
      renderCard(body, finding, isDismissed(finding), options, drawIcon);
    }
  }

  // The difference between "everything the analysis found" and "what is still
  // visible", so the count is right in either filter branch.
  const hiddenCount = options.bundle.findings.length - countUndismissed(options.bundle, options.dismissed);
  // `showDismissed` alone still needs the button: without it the user could
  // never leave "show dismissed" mode once every key had been restored.
  if (hiddenCount > 0 || options.showDismissed) {
    const restore = container.createEl("button", {
      cls: "enhanced-graph-link",
      text: options.showDismissed
        ? t("toolbar.reset")
        : t("insights.showDismissed", { count: hiddenCount }),
    });
    restore.addEventListener("click", () => options.onToggleShowDismissed());
  }
}

/**
 * Badge count: undismissed findings across the bundle's sections.
 *
 * Delegates to `core/insights/sections`, which is the one definition of the
 * bundle's visible set; this used to be a second counting rule that had to be
 * kept in step with the panel.
 */
export function countUndismissed(
  bundle: InsightBundle,
  dismissed: ReadonlySet<string> = new Set(),
): number {
  return countUndismissedInBundle(bundle, dismissed);
}

/**
 * Canonical edge key for a connection card. Delegates to {@link edgeKey} so the
 * format has exactly one definition — this used to be a third copy of it.
 */
export function connectionEdgeKey(a: string, b: string): string {
  return edgeKey(a, b);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * One finding's card.
 *
 * The whole card is the focus gesture and the dismiss button sits inside it, so
 * every inner control stops propagation — otherwise dismissing or acting on a
 * card would also focus it.
 */
function renderCard(
  parent: HTMLElement,
  finding: Finding,
  isDismissed: boolean,
  options: InsightsPanelOptions,
  drawIcon: SetIconImpl,
): void {
  const ids = finding.anchors.nodeIds;
  const active = isActiveCard(ids, options.activeNodeIds);
  // Connection-shaped findings light one canonical edge key; node and group
  // findings ask for no edge at all. The class names are the existing ones, so
  // the two highlights keep looking the way they always have.
  const edges = finding.anchors.edgeKeys.length > 0 ? edgeKeysFor(ids) : [];
  const card = parent.createDiv({
    cls:
      `enhanced-graph-card${active ? (edges.length > 0 ? " is-active-connection" : " is-active-gap") : ""}` +
      `${isDismissed ? " is-dismissed" : ""}`,
  });
  card.addEventListener("click", () => {
    // Clicking the active card is the "unfocus" gesture.
    if (active) options.onToggleFocus([], []);
    else options.onToggleFocus(ids, edges);
  });

  const head = card.createDiv({ cls: "enhanced-graph-card-head" });
  // One generic call for every kind: the four pair titles carry their own "↔",
  // so no kind needs a branch here.
  head.createSpan({
    cls: "enhanced-graph-card-title",
    text: t(finding.titleKey, finding.titleParams),
  });
  const dismiss = head.createEl("button", {
    cls: "enhanced-graph-link",
    attr: { "aria-label": t("insights.dismiss") },
  });
  drawIcon(dismiss, isDismissed ? "rotate-ccw" : "x");
  dismiss.title = t("insights.dismiss");
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onDismiss(finding.key, ids);
  });

  const badges = card.createDiv({ cls: "enhanced-graph-card-badges" });
  confidenceBadge(badges, finding.confidence);
  effortBadge(badges, finding.effort);

  const list = card.createDiv({ cls: "enhanced-graph-evidence-list" });
  for (const evidence of finding.evidence.slice(0, EVIDENCE_LINES)) {
    renderEvidence(list, evidence, options.graph);
  }

  if (finding.action) renderAction(card, finding, options);
}

/** One evidence line, with the pages it rests on named beside it. */
function renderEvidence(parent: HTMLElement, evidence: Evidence, graph: WikiGraph): void {
  const line = parent.createDiv({ cls: "enhanced-graph-evidence" });
  line.createSpan({ text: t(evidence.labelKey, evidence.params) });

  // A shared-neighbour line already says how many: this is how many of them the
  // card has room to name.
  const omitted = numberParam(evidence.params.omitted);
  if (omitted !== null && omitted > 0) {
    // Punctuation-free on purpose: it sits inside a Chinese sentence as often as
    // an English one, and the label's own template keeps it correct in both.
    line.createSpan({
      cls: "enhanced-graph-evidence-omitted",
      text: t("insights.evidenceOmitted", { count: omitted }),
    });
  }

  const labels = labelList(evidence.nodeIds, graph);
  if (labels.length > 0) {
    line.createSpan({
      cls: "enhanced-graph-evidence-nodes",
      text: t("insights.evidenceNodes", { names: labels.map((label) => `[[${label}]]`).join("、") }),
    });
  }

  const degree = numberParam(evidence.params.maxDegree);
  if (degree !== null && degree >= HUB_DEGREE_WARNING) {
    line.createSpan({
      cls: "enhanced-graph-evidence-hub",
      text: t("insights.evidenceHubWarning", { degree }),
    });
  }
}

/**
 * The named pages, in the order the evidence listed them.
 *
 * Ids that are not in the graph are skipped rather than rendered as a bare id:
 * the anchor clipping in §5.1 can leave a stale id in a bundle that was built
 * from an older graph, and "[[note-that-was-deleted]]" is worse than silence.
 */
function labelList(nodeIds: readonly string[] | undefined, graph: WikiGraph): string[] {
  const labels: string[] = [];
  for (const id of nodeIds ?? []) {
    const node = graph.nodeIndex.get(id);
    if (node) labels.push(node.label);
  }
  return labels;
}

/**
 * The edge key for a connection card, derived from the two pages it connects.
 *
 * Derived rather than read out of `anchors.edgeKeys` so the key is canonical by
 * construction: the anchors carry the same string today, but they are the
 * finding's data and this is the renderer's contract with the highlight sets.
 */
function edgeKeysFor(ids: readonly string[]): string[] {
  return ids.length === 2 ? [connectionEdgeKey(ids[0] as string, ids[1] as string)] : [];
}

/** The action button, calling the host's `onAction`; disabled when there is none. */
function renderAction(card: HTMLElement, finding: Finding, options: InsightsPanelOptions): void {
  const action = finding.action;
  if (!action) return;
  const label = t(ACTION_LABEL_KEYS[action.kind]);
  const button = card.createEl("button", {
    cls: "enhanced-graph-button enhanced-graph-card-action",
    text: label,
  });
  if (!options.onAction) {
    button.disabled = true;
    button.title = t("insights.actionUnavailable");
    return;
  }
  button.addEventListener("click", (event) => {
    // The button sits inside the card, so without this the action would also
    // focus the card behind it.
    event.stopPropagation();
    options.onAction?.(action, finding);
  });
  // A disabled button dispatches no click in the browser, so this is the whole
  // interaction: no listener is needed on the unwired branch above.
}

/**
 * Confidence and effort labels.
 *
 * The two lookups are the one place `t()` is handed a template string rather
 * than a literal, so the compile-time key check cannot see them. These maps are
 * what replaces it: the value is a `Record` over the whole union, so a new
 * `Confidence` or `Effort` member is a compile error here instead of a raw key
 * on screen. That is the defect the plan calls out as L11 — `t(\`reason.${reason}\`
 * as never)`, which let a new reason ship its own key text — and it is not
 * reproduced.
 */
const CONFIDENCE_LABEL_KEYS: Readonly<Record<Confidence, MessageKey>> = {
  strong: "insights.confidence.strong",
  moderate: "insights.confidence.moderate",
  weak: "insights.confidence.weak",
};

const EFFORT_LABEL_KEYS: Readonly<Record<Effort, MessageKey>> = {
  "one-click": "insights.effort.one-click",
  edit: "insights.effort.edit",
  write: "insights.effort.write",
};

const ACTION_LABEL_KEYS: Readonly<Record<InsightAction["kind"], MessageKey>> = {
  "insert-wikilink": "insights.action.insert-link",
  "open-notes": "insights.action.open-notes",
  "create-moc": "insights.action.create-moc",
  "open-report": "insights.action.copy",
};

/**
 * The label for a value of an exhaustive map.
 *
 * The `Record` in the parameter type is the whole mechanism: a `Confidence` or
 * `Effort` member without an entry fails `tsc` at the map's declaration, so the
 * lookup itself cannot be reached with a missing value. The map is required by
 * the type rather than the switch being written out here so the two lookups stay
 * one line each.
 */
function labelFor<T extends string>(labels: Readonly<Record<T, MessageKey>>, value: T): string {
  return t(labels[value]);
}

function confidenceBadge(parent: HTMLElement, value: Confidence): void {
  parent.createSpan({
    cls: `enhanced-graph-badge enhanced-graph-confidence is-${value}`,
    text: labelFor(CONFIDENCE_LABEL_KEYS, value),
  });
}

function effortBadge(parent: HTMLElement, value: Effort): void {
  parent.createSpan({
    cls: `enhanced-graph-badge enhanced-graph-effort is-${value}`,
    text: labelFor(EFFORT_LABEL_KEYS, value),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Findings whose content moved since the previous build. */
function changedKeySet(changed: readonly Finding[]): ReadonlySet<string> {
  return new Set(changed.map((finding) => finding.key));
}

/** A numeric evidence parameter, or `null` when the evidence does not carry it. */
function numberParam(value: string | number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A card is active only when its ids and the highlight match *exactly*: a
 * superset (focusing a node and its neighbours) or a subset (a single page of a
 * multi-page group) is a different focus and must not light the card up.
 */
function isActiveCard(ids: readonly string[], activeNodeIds: ReadonlySet<string>): boolean {
  const candidate = new Set(ids);
  if (candidate.size !== activeNodeIds.size) return false;
  for (const id of candidate) {
    if (!activeNodeIds.has(id)) return false;
  }
  return true;
}
