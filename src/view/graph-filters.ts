/**
 * Filters panel presentation for the Enhanced Graph view.
 *
 * Extracted from `EnhancedGraphView` so the panel body can be rendered without
 * the `ItemView`, the plugin or sigma. The module is pure DOM: it only ever
 * touches the container it is handed, holds no state between renders and knows
 * nothing about settings persistence — every switch is a callback on
 * `FilterOptions`.
 *
 * Like `renderInsightsPanel`, it deliberately does NOT clear `container`: the
 * view renders its panel header (title + close button) into the very same
 * element, and the header must stay the first child. A caller that re-renders
 * into a reused element clears it itself.
 */

import { t } from "../i18n";
import { PAGE_TYPES, type CommunityInfo, type PageType, type WikiGraph } from "../types";
import { collectTags, tagMatches, type TagFilterMode } from "./visibility";
import { checkboxRow, tabRow } from "./controls";

export interface FilterOptions {
  readonly graph: WikiGraph;
  readonly hiddenTypes: ReadonlySet<PageType>;
  /**
   * The knowledge clusters the graph is divided into, and which are excluded.
   *
   * Excluding one takes every page of it off the graph. The list is the analysis'
   * own (`graph.communities`), so the labels match the legend's rows — the legend
   * explains the clusters, this panel is where they are switched.
   */
  readonly communities: readonly CommunityInfo[];
  readonly hiddenCommunities: ReadonlySet<number>;
  readonly hiddenTags: ReadonlySet<string>;
  /**
   * Whether the ticked tags are the ones to hide, or the only ones to keep.
   *
   * The ticks mean "the tags this filter acts on" either way; this decides which
   * way round that goes.
   */
  readonly tagFilterMode: TagFilterMode;
  readonly hideIsolated: boolean;
  readonly hideStructural: boolean;
  readonly onToggleType: (type: PageType, visible: boolean) => void;
  readonly onToggleCommunity: (id: number, visible: boolean) => void;
  readonly onToggleTag: (tag: string, selected: boolean) => void;
  /**
   * Clear the tag selection: nothing excluded, or nothing kept.
   *
   * Tags only, deliberately: the button sits in the tag group and undoes what
   * that group did. The hidden-type and visibility switches are decisions made
   * elsewhere, and clearing them here would overrule the user silently.
   */
  readonly onClearTags: () => void;
  /** Tick the tags the list is currently showing — the search's matches. */
  readonly onSelectAllTags: (tags: readonly string[]) => void;
  readonly onSetTagFilterMode: (mode: TagFilterMode) => void;
  /** Un-hide every cluster at once, from the cluster group. */
  readonly onClearCommunities: () => void;
  readonly onToggleIsolated: (value: boolean) => void;
  readonly onToggleStructural: (value: boolean) => void;
  /**
   * Which filter group is on screen, and how to switch.
   *
   * Held by the caller rather than here: this function runs on every repaint, so
   * state kept inside it would be forgotten the moment anything else redraws the
   * panel — the tab would jump back on its own.
   *
   * Optional: with no {@link onSelectSection} every group is drawn one after
   * another under its own plain heading, for a caller with no panel state.
   */
  readonly activeSection?: FilterSection;
  readonly onSelectSection?: (section: FilterSection) => void;
}

/** The filter groups, one of which is on screen at a time. */
export type FilterSection = "types" | "clusters" | "tags" | "visibility";

/** One group's rows, and how the panel should label its tab. */
interface FilterGroup {
  readonly id: FilterSection;
  readonly label: string;
  readonly render: (section: HTMLElement) => void;
}

/**
 * Renders the filters body into `container`, after whatever the caller has
 * already put there (the panel header).
 *
 * The groups switch like tabs rather than folding open and shut: one button per
 * group, and the controls of the chosen one below it. With four groups the folded
 * panel was a list of headings the user had to open one at a time, and the rows
 * they were looking for moved down the panel as the others were opened and shut.
 *
 * Only *what is drawn* lives here. Everything about how it looks — node size
 * and colour, edge thickness and colour, spacing, labels — is in
 * `graph-appearance`, so the two panels do not both own a "node size" control.
 */
export function renderFilters(container: HTMLElement, options: FilterOptions): void {
  const counts = typeCounts(options.graph);
  const types = PAGE_TYPES.filter((type) => (counts.get(type) ?? 0) > 0);
  const tags = collectTags(options.graph.nodes);
  const clusters = options.communities;

  const groups: FilterGroup[] = [
    {
      id: "types",
      label: `${t("filter.types")} (${types.length})`,
      render: (section) => {
        for (const type of types) {
          const row = section.createEl("label", { cls: "enhanced-graph-checkbox" });
          const input = row.createEl("input", { type: "checkbox" });
          input.checked = !options.hiddenTypes.has(type);
          input.addEventListener("change", () => options.onToggleType(type, input.checked));
          row.createSpan({ text: t(`type.${type}` as never) });
          row.createSpan({ cls: "enhanced-graph-legend-count", text: String(counts.get(type) ?? 0) });
        }
      },
    },
    {
      id: "clusters",
      label: `${t("filter.clusters")} (${clusters.length})`,
      render: (section) => renderClusterRows(section, options, clusters),
    },
    {
      id: "tags",
      label: `${t("filter.tags")} (${tags.length})`,
      render: (section) => renderTagRows(section, options, tags),
    },
    { id: "visibility", label: t("filter.visibility"), render: (section) => renderVisibilityRows(section, options) },
  ];

  const select = options.onSelectSection;
  const active = groups.some((group) => group.id === options.activeSection)
    ? options.activeSection
    : groups[0].id;
  if (select) {
    tabRow(
      container,
      groups.map((group) => ({ id: group.id, label: group.label })),
      active as FilterSection,
      select,
    );
  }

  for (const group of groups) {
    if (select && group.id !== active) continue;
    const section = container.createDiv({ cls: "enhanced-graph-section" });
    section.setAttribute("data-section", group.id);
    if (!select) {
      // No switcher: every group is drawn, each under its own plain heading.
      section.createDiv({ cls: "enhanced-graph-section-title", text: group.label });
    }
    group.render(section);
  }
}

/** Hide-isolated and hide-structural: two switches that are not about content. */
function renderVisibilityRows(section: HTMLElement, options: FilterOptions): void {
  checkboxRow(section, t("filter.hideIsolated"), options.hideIsolated, options.onToggleIsolated);
  checkboxRow(section, t("filter.hideStructural"), options.hideStructural, options.onToggleStructural);
}

/**
 * Cluster rows: one per knowledge cluster the analysis found.
 *
 * A cluster is named by its core note, exactly as the legend names it, so the two
 * lists read the same. "Show all" sits above them and is ALWAYS drawn: the group
 * keeps its shape instead of growing a control the moment something is excluded,
 * and it is disabled while there is nothing to restore.
 */
function renderClusterRows(
  section: HTMLElement,
  options: FilterOptions,
  clusters: readonly CommunityInfo[],
): void {
  if (clusters.length === 0) {
    section.createDiv({ cls: "enhanced-graph-tag-empty", text: t("filter.noClusters") });
    return;
  }

  const actions = section.createDiv({ cls: "enhanced-graph-filter-actions" });
  const showAll = actions.createEl("button", { cls: "enhanced-graph-link", text: t("legend.showAll") });
  /**
   * Kept in step in place, like the tag group's restore button: the panel is NOT
   * redrawn while one of its own checkboxes has focus, so a state that is only
   * recomputed on a repaint would sit there stale for as long as the user keeps
   * switching clusters on and off.
   */
  const syncShowAll = (): void => {
    showAll.disabled = options.hiddenCommunities.size === 0;
  };
  syncShowAll();
  showAll.addEventListener("click", () => {
    // The set is live in the panel that owns one (see `liveSet`), so this reads
    // the state as it is now rather than as it was when the body was drawn.
    if (options.hiddenCommunities.size === 0) return;
    options.onClearCommunities();
    syncShowAll();
  });

  for (const community of clusters) {
    const row = section.createEl("label", { cls: "enhanced-graph-checkbox" });
    const input = row.createEl("input", { type: "checkbox" });
    input.checked = !options.hiddenCommunities.has(community.id);
    input.addEventListener("change", () => {
      options.onToggleCommunity(community.id, input.checked);
      syncShowAll();
    });
    row.createSpan({ text: community.topNodes[0] ?? `${t("legend.communities")} ${community.id}` });
    row.createSpan({
      cls: "enhanced-graph-legend-count",
      text: t("legend.members", { count: community.nodeCount }),
    });
  }
}

/**
 * Tag filtering: every tag in the graph, most-used first, behind a search box.
 *
 * The tick means "the tag this filter acts on", and the mode above says which way
 * round that goes: excluding the ticked tags, or keeping only them. One meaning
 * for the tick in both modes is what makes a selection readable either way, and a
 * mode that changed it would leave the user guessing what a stored selection now
 * does.
 *
 * The row list re-renders on every keystroke so typing narrows it in place. The
 * search box is rebuilt too, but it is re-rendered synchronously inside the same
 * event, so the field keeps focus and the caret position.
 */
function renderTagRows(
  section: HTMLElement,
  options: FilterOptions,
  all: ReturnType<typeof collectTags>,
): void {
  const including = options.tagFilterMode === "include";
  const modes = section.createDiv({ cls: "enhanced-graph-segmented" });
  for (const [mode, label] of [
    ["exclude", t("filter.tagModeExclude")],
    ["include", t("filter.tagModeInclude")],
  ] as const) {
    const button = modes.createEl("button", {
      cls: `enhanced-graph-button${mode === options.tagFilterMode ? " is-active" : ""}`,
      text: label,
    });
    button.addEventListener("click", () => options.onSetTagFilterMode(mode));
  }

  // The search box and the two bulk actions share a row: they all act on the list
  // below rather than on the graph.
  const searchRow = section.createDiv({ cls: "enhanced-graph-tag-search-row" });
  const search = searchRow.createEl("input", { cls: "enhanced-graph-tag-search" });
  search.type = "search";
  search.placeholder = t("filter.tagSearch");
  search.value = tagQuery;
  const selectAll = searchRow.createEl("button", { cls: "enhanced-graph-link", text: t("filter.selectAllTags") });
  const clear = searchRow.createEl("button", { cls: "enhanced-graph-link", text: t("filter.clearTags") });

  const list = section.createDiv({ cls: "enhanced-graph-tag-list" });

  /**
   * The two bulk buttons are always created and merely hidden while they would do
   * nothing. The panel is NOT re-rendered on every toggle (that would rebuild the
   * list under the pointer and steal focus from the search box), so a
   * conditionally created button would not appear until some unrelated re-render
   * happened — i.e. it would be unreachable exactly when it is needed.
   * `options.hiddenTags` is the view's live set, so reading it after a toggle is
   * enough to know what to show.
   */
  const tickedRows = (): HTMLInputElement[] =>
    Array.from(list.querySelectorAll<HTMLInputElement>("input[type=checkbox]"));
  const syncBulk = (): void => {
    const rows = tickedRows();
    clear.classList.toggle("is-hidden", options.hiddenTags.size === 0);
    selectAll.classList.toggle("is-hidden", rows.every((input) => input.checked));
  };
  selectAll.addEventListener("click", () => {
    options.onSelectAllTags(tickedRows().map((input) => input.dataset.tag ?? ""));
    for (const input of tickedRows()) input.checked = true;
    syncBulk();
  });
  clear.addEventListener("click", () => {
    if (options.hiddenTags.size === 0) return;
    options.onClearTags();
    for (const input of tickedRows()) input.checked = false;
    syncBulk();
  });

  const paint = (): void => {
    list.empty();
    const matched = all.filter((entry) => tagMatches(entry.tag, tagQuery));
    // A hidden tag stays pinned to the top even when the query filters it out,
    // otherwise the thing the user just switched off would vanish from view.
    const pinned = all.filter((entry) => options.hiddenTags.has(entry.tag) && !matched.includes(entry));
    const rows = [...pinned, ...matched];

    if (rows.length === 0) {
      list.createDiv({ cls: "enhanced-graph-tag-empty", text: t("filter.noTags") });
      return;
    }

    // Every tag, most-used first. The list is drawn in full rather than cut off at
    // a row count: a tag the user cannot see is a tag they cannot switch off, and
    // the search box is there for narrowing rather than for reaching the rest.
    for (const entry of rows) {
      const row = list.createEl("label", { cls: "enhanced-graph-checkbox" });
      const input = row.createEl("input", { type: "checkbox" });
      // Ticked means "this filter acts on this tag" — the mode above says which way.
      input.checked = options.hiddenTags.has(entry.tag);
      input.dataset.tag = entry.tag;
      input.addEventListener("change", () => {
        options.onToggleTag(entry.tag, input.checked);
        syncBulk();
      });
      row.createSpan({ cls: "enhanced-graph-tag-name", text: entry.tag });
      row.createSpan({ cls: "enhanced-graph-legend-count", text: String(entry.count) });
    }
  };

  search.addEventListener("input", () => {
    tagQuery = search.value;
    paint();
    syncBulk();
  });
  paint();
  syncBulk();
  // A mode switch changes what the ticks mean, so the whole body is redrawn by the
  // caller: the label under the buttons has to say which way round it is.
  if (including) {
    section.createDiv({ cls: "enhanced-graph-hint", text: t("filter.tagModeIncludeHint") });
  }
}

/**
 * The tag search box's current text. Module-level and intentionally not part of
 * `FilterOptions`: it is a property of the panel's own UI, not of the graph, and
 * the view has no reason to know or persist it.
 */
let tagQuery = "";

/** Nodes per page type, over the whole graph (not the filtered view). */
function typeCounts(graph: WikiGraph): Map<PageType, number> {
  const counts = new Map<PageType, number>();
  for (const node of graph.nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  return counts;
}
