/**
 * Legend presentation for the Enhanced Graph view.
 *
 * Extracted from `EnhancedGraphView` so the legend can be rendered without the
 * `ItemView`, the plugin or sigma. The module is pure DOM: it only ever touches
 * the container it is handed, holds no state between renders and derives
 * everything it shows from `LegendOptions`.
 *
 * The legend doubles as the type filter — double-clicking a row hides that page
 * type — so the type rows are wired to `onToggleType` rather than to any state
 * of their own.
 */

import { setIcon } from "obsidian";

import { t } from "../i18n";
import { PAGE_TYPES, type ColorMode, type PageType, type WikiGraph } from "../types";
import { communityColor, nodeColorForMode } from "./palette";

export interface LegendOptions {
  readonly graph: WikiGraph;
  readonly colorMode: ColorMode;
  /** Used for the swatches when `colorMode` is `"custom"`. */
  readonly customNodeColor: string;
  /** Per-type colour overrides, so the swatches match the canvas. */
  readonly typeColorOverrides: Readonly<Record<string, string>>;
  readonly hiddenTypes: ReadonlySet<PageType>;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onToggleType: (type: PageType) => void;
  readonly onShowAllTypes: () => void;
  /**
   * A cluster row was clicked. Receives the id as well as the members so the
   * caller can tell "this cluster again" from "a different one" and toggle.
   */
  readonly onFocusNodes: (nodeIds: readonly string[], communityId?: number) => void;
  /** The cluster currently held lit, so its row can say so. */
  readonly activeCommunityId?: number | null;
}

export function renderLegend(container: HTMLElement, options: LegendOptions): void {
  const { graph, colorMode, hiddenTypes, collapsed } = options;
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

  if (colorMode === "type" && hiddenTypes.size > 0) {
    const showAll = header.createEl("button", { cls: "enhanced-graph-link", text: t("legend.showAll") });
    showAll.addEventListener("click", () => options.onShowAllTypes());
  }

  const collapse = header.createEl("button", {
    cls: "enhanced-graph-link",
    attr: { "aria-label": collapsed ? t("legend.expand") : t("legend.collapse") },
  });
  setIcon(collapse, collapsed ? "chevron-up" : "chevron-down");
  collapse.addEventListener("click", () => options.onToggleCollapsed());
  if (collapsed) return;

  const body = container.createDiv({ cls: "enhanced-graph-legend-body" });
  if (colorMode !== "community") renderTypeRows(body, options);
  else renderCommunityRows(body, options);
}

/** One row per page type actually present, with its node count. */
function renderTypeRows(body: HTMLElement, options: LegendOptions): void {
  const { graph, hiddenTypes } = options;
  const counts = typeCounts(graph);
  for (const type of PAGE_TYPES.filter((candidate) => (counts.get(candidate) ?? 0) > 0)) {
    const hidden = hiddenTypes.has(type);
    const row = body.createDiv({ cls: `enhanced-graph-legend-row${hidden ? " is-hidden-type" : ""}` });
    const dot = row.createSpan({ cls: "enhanced-graph-legend-dot" });
    dot.style.backgroundColor = hidden
      ? "#94a3b8"
      : nodeColorForMode({
          colorMode: options.colorMode,
          pageType: type,
          community: 0,
          customColor: options.customNodeColor,
          typeOverrides: options.typeColorOverrides,
        });
    row.createSpan({ cls: "enhanced-graph-legend-label", text: t(`type.${type}` as never) });
    row.createSpan({ cls: "enhanced-graph-legend-count", text: String(counts.get(type) ?? 0) });
    row.title = t("legend.hint");
    row.addEventListener("dblclick", () => options.onToggleType(type));
  }
}

/** One row per Louvain community: core node, member count, cohesion. */
function renderCommunityRows(body: HTMLElement, options: LegendOptions): void {
  for (const community of options.graph.communities) {
    const row = body.createDiv({ cls: "enhanced-graph-legend-row" });
    const dot = row.createSpan({ cls: "enhanced-graph-legend-dot" });
    dot.style.backgroundColor = communityColor(community.id);

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

    // Clicking a cluster keeps it lit; clicking it again lets go. The class is
    // what says which of the two the next click will do.
    if (options.activeCommunityId === community.id) row.addClass("is-active");
    row.addEventListener("click", () => options.onFocusNodes(community.nodeIds, community.id));
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
