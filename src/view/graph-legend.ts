/**
 * Legend presentation for the Enhanced Graph view.
 *
 * Extracted from `EnhancedGraphView` so the legend can be rendered without the
 * `ItemView`, the plugin or sigma. The module is pure DOM: it only ever touches
 * the container it is handed, holds no state between renders and derives
 * everything it shows from `LegendOptions`.
 *
 * A row is a control when the host hands over the matching gesture, and only
 * then: it is marked interactive, gets a title saying what a click does, and a
 * click excludes or restores that type or cluster. Both views pass the gestures —
 * the standalone view and the built-in graph read and write the same settings, so
 * the same click means the same thing in either. The header carries an
 * always-present "show all" for the group on screen, disabled while nothing is
 * hidden.
 *
 * The rows are read-only only for a host that passes no gestures at all.
 */

import { setIcon } from "obsidian";

import { t } from "../i18n";
import type { ColorMode, WikiGraph } from "../types";
import { communityColor, nodeColorForMode } from "./palette";
import { collectTypes } from "./visibility";
import { typeLabel } from "./labels";

/** The colour a row's dot takes while its subject is excluded. */
const HIDDEN_DOT = "#94a3b8";

/**
 * The gestures a host may offer, all optional.
 *
 * Omitted means "this legend is a key, not a control": no handler is bound, the
 * row is not marked interactive, and no "show all" is drawn.
 */
export interface LegendGestures {
  readonly onToggleType?: (type: string) => void;
  readonly onShowAllTypes?: () => void;
  readonly onToggleCommunity?: (id: number) => void;
  readonly onShowAllCommunities?: () => void;
  /**
   * Right-click: mark every node of this type or cluster with a dot on the graph.
   *
   * A separate gesture from the left-click toggle, and a separate statement: the toggle
   * takes the group off the graph, the mark points at where it is. Marking is not a
   * filter — it changes nothing about what is drawn, only what is pointed at.
   */
  readonly onMarkType?: (type: string) => void;
  readonly onMarkCommunity?: (id: number) => void;
  /** The group currently marked, so its row can show that it is the one being pointed at. */
  readonly marked?: { readonly kind: "type" | "community"; readonly key: string } | null;
}

export interface LegendOptions extends LegendGestures {
  readonly graph: WikiGraph;
  readonly colorMode: ColorMode;
  /** Used for the swatches when `colorMode` is `"custom"`. */
  readonly customNodeColor: string;
  /** Per-type colour overrides, so the swatches match the canvas. */
  readonly typeColorOverrides: Readonly<Record<string, string>>;
  /** Hidden types, keyed by what the user declared (a canonical id also matches). */
  readonly hiddenTypes: ReadonlySet<string>;
  /**
   * The types that still have at least one page ON THE GRAPH.
   *
   * A type can be empty on screen without being switched off: its pages may be hidden
   * by the workspace, by 隐藏索引/概览/日志, by a tag rule or by their cluster. A row
   * with a coloured dot and a count of one, beside a graph that draws none of them,
   * reads as a bug — so a row is greyed whenever nothing of it is drawn. A host with no
   * filtered view to report may omit it, and the row then follows `hiddenTypes` alone.
   */
  readonly visibleTypes?: ReadonlySet<string>;
  /** Clusters the user has excluded, by id. */
  readonly hiddenCommunities: ReadonlySet<number>;
}

export function renderLegend(container: HTMLElement, options: LegendOptions): void {
  const { graph, colorMode, hiddenTypes, hiddenCommunities } = options;
  const marked = options.marked ?? null;
  // The body is the box that scrolls, and it is rebuilt on every render: clicking
  // a row re-renders so the row can come back shaded. Emptying the container takes
  // the body — and its scroll position — with it, which scrolled the list back to
  // the top under the pointer that had just clicked. Carried across the rebuild.
  const scrolled = container.querySelector<HTMLElement>(".enhanced-graph-legend-body")?.scrollTop ?? 0;
  container.empty();
  if (graph.nodes.length === 0) {
    container.addClass("is-hidden");
    return;
  }
  container.removeClass("is-hidden");

  const header = container.createDiv({ cls: "enhanced-graph-legend-header" });
  header.createSpan({
    cls: "enhanced-graph-legend-title",
    // Custom mode still lists the page types — the counts stay useful — but the
    // section is no longer about colour, so it does not claim to be.
    text: colorMode === "community" ? t("legend.communities") : t("legend.types"),
  });

  const byCommunity = colorMode === "community";
  const hiddenCount = byCommunity ? hiddenCommunities.size : hiddenTypes.size;
  // Only a host that offers the gesture gets the control — and when it does, the
  // control is ALWAYS there, disabled while there is nothing to undo: the header
  // keeps its shape instead of growing one the moment something is hidden.
  const clear = byCommunity ? options.onShowAllCommunities : options.onShowAllTypes;
  if (clear) {
    const showAll = header.createEl("button", { cls: "enhanced-graph-link", text: t("legend.showAll") });
    showAll.disabled = hiddenCount === 0;
    showAll.addEventListener("click", () => {
      if (hiddenCount === 0) return;
      clear();
    });
  }

  const body = container.createDiv({ cls: "enhanced-graph-legend-body" });
  if (!byCommunity) renderTypeRows(body, options);
  else renderCommunityRows(body, options);
  // Only once the rows are in: before that there is nothing to scroll through.
  if (scrolled > 0) body.scrollTop = scrolled;
}

/** One row per page type actually present, with its node count. */
function renderTypeRows(body: HTMLElement, options: LegendOptions): void {
  const { graph, hiddenTypes, visibleTypes } = options;
  // The types the vault declares, not the ones the plugin knows: a custom type is a
  // row of its own with its own colour, and the count is of the pages that say so.
  for (const type of collectTypes(graph.nodes)) {
    const { key, label, count } = type;
    // Grey when nothing of this type is drawn — whether because the user switched it
    // off or because every page of it is excluded by some other rule. A row that
    // promises a colour and a count, beside a graph showing none of it, is a lie about
    // what is on screen; the count stays the vault's own so the row still says how much
    // is being held back.
    const drawn = visibleTypes === undefined || visibleTypes.has(key);
    const hidden = hiddenTypes.has(key) || !drawn;
    const row = body.createDiv({
      cls: `enhanced-graph-legend-row${hidden ? " is-hidden-type" : ""}`,
    });
    const dot = row.createSpan({ cls: "enhanced-graph-legend-dot" });
    dot.style.backgroundColor = hidden
      ? HIDDEN_DOT
      : nodeColorForMode({
          colorMode: options.colorMode,
          pageType: key,
          community: 0,
          customColor: options.customNodeColor,
          typeOverrides: options.typeColorOverrides,
        });
    row.createSpan({
      cls: "enhanced-graph-legend-label",
      text: typeLabel(key, label),
    });
    row.createSpan({ cls: "enhanced-graph-legend-count", text: String(count) });
    if (!drawn) row.title = t("legend.typeEmpty", { count: String(count) });
    const toggle = options.onToggleType;
    const mark = options.onMarkType;
    if (toggle || mark) {
      row.addClass("is-interactive");
      if (drawn) row.title = mark ? t("legend.hintMark") : t("legend.hint");
      if (options.marked?.kind === "type" && options.marked.key === key) {
        row.addClass("is-marked");
        row.title = t("legend.hintUnmark");
      }
      // A click, like the cluster rows: one gesture for both groups, and the
      // hidden row stays in place (shaded) so it can be clicked straight back.
      if (toggle) row.addEventListener("click", () => toggle(key));
      if (mark) {
        // Right-click points at the group instead: the row is the only place that
        // knows what a group *is*, so this is where "show me where they are" belongs.
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          mark(key);
        });      }
    }
  }
}

/**
 * One row per Louvain community: core node, member count, cohesion.
 *
 * The cards say which cluster is which — and, when one has been excluded, that it
 * is the reason some pages are missing. Switching a cluster off is the filters
 * panel's job; a host that still wants a shortcut here passes one (the standalone
 * view does), and only then is the row marked and bound.
 */
function renderCommunityRows(body: HTMLElement, options: LegendOptions): void {
  for (const community of options.graph.communities) {
    const hidden = options.hiddenCommunities.has(community.id);
    const row = body.createDiv({
      cls: `enhanced-graph-legend-row${hidden ? " is-hidden-cluster" : ""}`,
    });
    const dot = row.createSpan({ cls: "enhanced-graph-legend-dot" });
    dot.style.backgroundColor = hidden ? HIDDEN_DOT : communityColor(community.id);

    const label = row.createSpan({
      cls: "enhanced-graph-legend-label",
      text: community.topNodes[0] ?? `${t("legend.communities")} ${community.id}`,
    });
    label.title = community.topNodes.join("、");

    row.createSpan({ cls: "enhanced-graph-legend-count", text: t("legend.members", { count: community.nodeCount }) });

    const cohesion = row.createSpan({
      cls: `enhanced-graph-legend-cohesion${community.isSparse ? " is-sparse" : ""}`,
      text: community.isSparse
        ? t("legend.sparse", { value: `${(community.cohesion * 100).toFixed(1)}%` })
        : t("legend.cohesion", { value: `${(community.cohesion * 100).toFixed(1)}%` }),
    });
    if (community.isSparse) setIcon(cohesion.createSpan({ cls: "enhanced-graph-legend-warn" }), "alert-triangle");

    const toggle = options.onToggleCommunity;
    const mark = options.onMarkCommunity;
    if (toggle || mark) {
      row.addClass("is-interactive");
      row.title = mark ? t("legend.hintMarkCluster") : t("legend.hintCluster");
      if (options.marked?.kind === "community" && options.marked.key === String(community.id)) {
        row.addClass("is-marked");
        row.title = t("legend.hintUnmark");
      }
      if (toggle) row.addEventListener("click", () => toggle(community.id));
      if (mark) {
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          mark(community.id);
        });
      }
    }
  }
}

