/**
 * Insights panel presentation — the 惊奇连接 / 知识空白 cards.
 *
 * Extracted from `EnhancedGraphView` so that a second consumer can emit the
 * exact same DOM without inheriting the view's state, its callbacks or the
 * Obsidian item-view lifecycle.
 *
 * The module is deliberately pure DOM: it only ever touches the container it
 * is handed (never `document`), holds no state between renders and knows
 * nothing about the plugin, settings persistence or `Notice`. Everything it
 * cannot own — focus toggling, dismissal, the "show dismissed" switch — is a
 * callback on `InsightsPanelOptions`.
 *
 * The container itself belongs to the caller: the body is appended to whatever
 * is already in it and never cleared, because the view renders its own panel
 * header (title + close button) into the very same element.
 */

import { setIcon } from "obsidian";

import type { GraphInsights } from "../core/insights";
import { edgeKey } from "../core/graph-keys";
import type {
  ConnectionReason,
  CoverageGap,
  UnexpectedLink,
  WikiGraph,
} from "../types";
import { t } from "../i18n";

/** Icon renderer; matches Obsidian's `setIcon(el, iconId)` signature. */
export type SetIconImpl = (el: HTMLElement, icon: string) => void;

export interface InsightsPanelOptions {
  readonly graph: WikiGraph;
  readonly insights: GraphInsights;
  /** Keys the user has marked as seen. */
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
   * Which insight sections are collapsed.
   *
   * Held by the caller rather than here: this function runs on every repaint, so
   * state kept inside it would be forgotten the moment anything else redraws the
   * panel — the section would spring open again on its own.
   *
   * Optional along with {@link onToggleSection}: with neither, the headings stay
   * plain labels, which is what a caller that has no panel state to keep wants.
   */
  readonly collapsedSections?: ReadonlySet<InsightSection>;
  readonly onToggleSection?: (section: InsightSection) => void;
  /**
   * Icon renderer override, defaulting to Obsidian's `setIcon`.
   *
   * The seam exists so the emitted glyphs can be asserted (and so a consumer
   * can draw them differently); production callers can simply omit it.
   */
  readonly setIconImpl?: SetIconImpl;
}

/** The two insight groups, each of which can be folded away. */
export type InsightSection = "connections" | "gaps";

/**
 * The clickable section header. Returns the element the icon is drawn into.
 *
 * A button rather than a plain heading: the whole title is the target, which is
 * what makes it read as something to press rather than a label that happens to be
 * clickable, and it carries `aria-expanded` for the same reason.
 */
function sectionTitle(
  section: HTMLElement,
  options: InsightsPanelOptions,
  which: InsightSection,
): HTMLElement {
  const collapsed = options.collapsedSections?.has(which) ?? false;
  const toggle = options.onToggleSection;
  if (!toggle) {
    const plain = section.createDiv({ cls: "enhanced-graph-section-title" });
    const plainIcon = plain.createSpan({
      cls: which === "connections" ? "enhanced-graph-icon-connection" : "enhanced-graph-icon-gap",
    });
    plain.createSpan({ text: t(which === "connections" ? "insights.connections" : "insights.gaps") });
    return plainIcon;
  }
  const title = section.createEl("button", { cls: "enhanced-graph-section-title is-toggle" });
  title.setAttribute("aria-expanded", String(!collapsed));
  const icon = title.createSpan({
    cls: which === "connections" ? "enhanced-graph-icon-connection" : "enhanced-graph-icon-gap",
  });
  title.createSpan({ text: t(which === "connections" ? "insights.connections" : "insights.gaps") });
  const chevron = title.createSpan({ cls: "enhanced-graph-section-chevron" });
  chevron.setAttribute("data-chevron", collapsed ? "right" : "down");
  title.addEventListener("click", () => toggle(which));
  return icon;
}

/**
 * Renders the insights panel body into `container`, after whatever the caller
 * has already put there.
 *
 * Deliberately does not clear `container`: the view renders the panel header
 * into the same element, so emptying it would take the title and the close
 * button with it. A caller that re-renders into a reused element clears it
 * itself (or hands in a fresh one).
 */
export function renderInsightsPanel(container: HTMLElement, options: InsightsPanelOptions): void {
  const setIconImpl = options.setIconImpl ?? setIcon;
  const { insights, dismissed, showDismissed, activeNodeIds } = options;

  // Dismissal only ever filters the *view*: the analysis still returns every
  // insight, so the same key can be restored without re-running it.
  const connections = insights.connections.filter((item) => showDismissed || !dismissed.has(item.key));
  const gaps = insights.gaps.filter((item) => showDismissed || !dismissed.has(item.key));

  if (connections.length === 0 && gaps.length === 0) {
    container.createDiv({ cls: "enhanced-graph-empty", text: t("insights.empty") });
  }

  if (activeNodeIds.size > 0) {
    const clear = container.createEl("button", {
      cls: "enhanced-graph-button",
      text: t("insights.clearHighlight"),
    });
    clear.addEventListener("click", () => options.onToggleFocus([], []));
  }

  if (connections.length > 0) {
    const section = container.createDiv({ cls: "enhanced-graph-section" });
    const collapsed = options.collapsedSections?.has("connections") ?? false;
    if (collapsed) section.addClass("is-collapsed");
    setIconImpl(sectionTitle(section, options, "connections"), "link-2");
    if (!collapsed) {
      for (const connection of connections) {
        renderConnectionCard(section, connection, dismissed.has(connection.key), options, setIconImpl);
      }
    }
  }

  if (gaps.length > 0) {
    const section = container.createDiv({ cls: "enhanced-graph-section" });
    const collapsed = options.collapsedSections?.has("gaps") ?? false;
    if (collapsed) section.addClass("is-collapsed");
    setIconImpl(sectionTitle(section, options, "gaps"), "alert-triangle");
    if (!collapsed) {
      for (const gap of gaps) renderGapCard(section, gap, options, setIconImpl);
    }
  }

  // The count is the difference between "everything the analysis found" and
  // "what survived the filter", so it stays correct for either filter branch.
  const hiddenCount =
    insights.connections.length + insights.gaps.length - (connections.length + gaps.length);
  // `showDismissed` alone still needs the button: without it the user could
  // never leave "show dismissed" mode once every key had been restored.
  if (hiddenCount > 0 || showDismissed) {
    const restore = container.createEl("button", {
      cls: "enhanced-graph-link",
      text: showDismissed
        ? t("toolbar.reset")
        : t("insights.showDismissed", { count: hiddenCount }),
    });
    restore.addEventListener("click", () => options.onToggleShowDismissed());
  }
}

/** Badge count: undismissed connections + undismissed gaps. */
export function countUndismissed(insights: GraphInsights, dismissed: ReadonlySet<string>): number {
  const connections = insights.connections.filter((item) => !dismissed.has(item.key)).length;
  const gaps = insights.gaps.filter((item) => !dismissed.has(item.key)).length;
  return connections + gaps;
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

function renderConnectionCard(
  parent: HTMLElement,
  connection: UnexpectedLink,
  isDismissed: boolean,
  options: InsightsPanelOptions,
  setIcon: SetIconImpl,
): void {
  const { source, target } = connection;
  const ids = [source.id, target.id];
  const active = isActiveCard(ids, options.activeNodeIds);
  const card = parent.createDiv({
    cls: `enhanced-graph-card${active ? " is-active-connection" : ""}${isDismissed ? " is-dismissed" : ""}`,
  });
  card.addEventListener("click", () => {
    // Clicking the active card is the "unfocus" gesture.
    if (active) options.onToggleFocus([], []);
    else options.onToggleFocus(ids, [connectionEdgeKey(source.id, target.id)]);
  });

  const head = card.createDiv({ cls: "enhanced-graph-card-head" });
  head.createSpan({
    cls: "enhanced-graph-card-title",
    text: `${source.label} ↔ ${target.label}`,
  });
  const dismiss = head.createEl("button", {
    cls: "enhanced-graph-link",
    attr: { "aria-label": t("insights.dismiss") },
  });
  setIcon(dismiss, isDismissed ? "rotate-ccw" : "x");
  dismiss.title = t("insights.dismiss");
  dismiss.addEventListener("click", (event) => {
    // The button sits inside the card, so without this the dismiss gesture
    // would also focus the connection.
    event.stopPropagation();
    options.onDismiss(connection.key, ids);
  });

  const scoreRow = card.createDiv({ cls: "enhanced-graph-card-score" });
  scoreRow.createSpan({ text: `${t("edge.score")} ` });
  scoreRow.createSpan({ cls: "enhanced-graph-card-score-value", text: connection.weight.toFixed(2) });
  scoreRow.createSpan({ cls: "enhanced-graph-card-surprise", text: `★ ${connection.score}` });

  card.createDiv({
    cls: "enhanced-graph-card-meta",
    text: connection.reasons.map((reason) => reasonText(reason, connection)).join("，"),
  });
}

function reasonText(reason: ConnectionReason, connection: UnexpectedLink): string {
  switch (reason) {
    case "distant-types":
      return t("reason.distant-types", { a: connection.source.type, b: connection.target.type });
    case "source-overlap": {
      const shared = connection.contributions["source-overlap"] ?? 0;
      return t("reason.source-overlap", { count: Math.round(shared / 2) });
    }
    default:
      return t(`reason.${reason}` as never);
  }
}

function renderGapCard(
  parent: HTMLElement,
  gap: CoverageGap,
  options: InsightsPanelOptions,
  setIcon: SetIconImpl,
): void {
  const ids = gap.nodeIds;
  const active = isActiveCard(ids, options.activeNodeIds);
  const card = parent.createDiv({
    cls: `enhanced-graph-card${active ? " is-active-gap" : ""}`,
  });
  card.addEventListener("click", () => {
    if (active) options.onToggleFocus([], []);
    // A gap spans pages that need not be linked yet, so it focuses nodes only.
    else options.onToggleFocus(ids, []);
  });

  const head = card.createDiv({ cls: "enhanced-graph-card-head" });
  head.createSpan({ cls: "enhanced-graph-card-title", text: gap.title });
  const dismiss = head.createEl("button", {
    cls: "enhanced-graph-link",
    attr: { "aria-label": t("insights.dismiss") },
  });
  setIcon(dismiss, "x");
  dismiss.title = t("insights.dismiss");
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    options.onDismiss(gap.key, ids);
  });

  card.createDiv({ cls: "enhanced-graph-card-meta", text: gap.description });
  card.createDiv({ cls: "enhanced-graph-card-suggestion", text: gap.suggestion });
}

/**
 * A card is active only when its ids and the highlight match *exactly*: a
 * superset (focusing a node and its neighbours) or a subset (a single page of a
 * multi-page gap) is a different focus and must not light the card up.
 */
function isActiveCard(ids: readonly string[], activeNodeIds: ReadonlySet<string>): boolean {
  const candidate = new Set(ids);
  if (candidate.size !== activeNodeIds.size) return false;
  for (const id of candidate) {
    if (!activeNodeIds.has(id)) return false;
  }
  return true;
}
