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
import { PAGE_TYPES, type ColorMode, type PageType, type WikiGraph } from "../types";
import { communityColor, nodeColorForMode } from "./palette";

/** The colour a row's dot takes while its subject is excluded. */
const HIDDEN_DOT = "#94a3b8";

/**
 * The gestures a host may offer, all optional.
 *
 * Omitted means "this legend is a key, not a control": no handler is bound, the
 * row is not marked interactive, and no "show all" is drawn.
 */
export interface LegendGestures {
  readonly onToggleType?: (type: PageType) => void;
  readonly onShowAllTypes?: () => void;
  readonly onToggleCommunity?: (id: number) => void;
  readonly onShowAllCommunities?: () => void;
}

export interface LegendOptions extends LegendGestures {
  readonly graph: WikiGraph;
  readonly colorMode: ColorMode;
  /** Used for the swatches when `colorMode` is `"custom"`. */
  readonly customNodeColor: string;
  /** Per-type colour overrides, so the swatches match the canvas. */
  readonly typeColorOverrides: Readonly<Record<string, string>>;
  readonly hiddenTypes: ReadonlySet<PageType>;
  /** Clusters the user has excluded, by id. */
  readonly hiddenCommunities: ReadonlySet<number>;
}

export function renderLegend(container: HTMLElement, options: LegendOptions): void {
  const { graph, colorMode, hiddenTypes, hiddenCommunities } = options;
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
  const { graph, hiddenTypes } = options;
  const counts = typeCounts(graph);
  for (const type of PAGE_TYPES.filter((candidate) => (counts.get(candidate) ?? 0) > 0)) {
    const hidden = hiddenTypes.has(type);
    const row = body.createDiv({
      cls: `enhanced-graph-legend-row${hidden ? " is-hidden-type" : ""}`,
    });
    const dot = row.createSpan({ cls: "enhanced-graph-legend-dot" });
    dot.style.backgroundColor = hidden
      ? HIDDEN_DOT
      : nodeColorForMode({
          colorMode: options.colorMode,
          pageType: type,
          community: 0,
          customColor: options.customNodeColor,
          typeOverrides: options.typeColorOverrides,
        });
    row.createSpan({ cls: "enhanced-graph-legend-label", text: t(`type.${type}` as never) });
    row.createSpan({ cls: "enhanced-graph-legend-count", text: String(counts.get(type) ?? 0) });
    const toggle = options.onToggleType;
    if (toggle) {
      row.addClass("is-interactive");
      row.title = t("legend.hint");
      // A click, like the cluster rows: one gesture for both groups, and the
      // hidden row stays in place (shaded) so it can be clicked straight back.
      row.addEventListener("click", () => toggle(type));
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
    if (toggle) {
      row.addClass("is-interactive");
      row.title = t("legend.hintCluster");
      row.addEventListener("click", () => toggle(community.id));
    }
  }
}

/** Nodes per page type, over the whole graph (not the filtered view). */
function typeCounts(graph: WikiGraph): Map<PageType, number> {
  const counts = new Map<PageType, number>();
  for (const node of graph.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  return counts;
}
