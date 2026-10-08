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
import { PAGE_TYPES, type PageType, type WikiGraph } from "../types";
import { collectTags, tagMatches } from "./visibility";
import { checkboxRow } from "./controls";

/**
 * How many tag rows to render at once. The demo vault has 141 distinct tags, so
 * rendering them all would bury the rest of the panel; the search box narrows
 * the list, and this caps what is left.
 */
const MAX_TAG_ROWS = 40;

export interface FilterOptions {
  readonly graph: WikiGraph;
  readonly hiddenTypes: ReadonlySet<PageType>;
  readonly hiddenTags: ReadonlySet<string>;
  readonly hideIsolated: boolean;
  readonly hideStructural: boolean;
  readonly onToggleType: (type: PageType, visible: boolean) => void;
  readonly onToggleTag: (tag: string, visible: boolean) => void;
  /** Un-hide every tag at once. */
  readonly onClearTags: () => void;
  readonly onToggleIsolated: (value: boolean) => void;
  readonly onToggleStructural: (value: boolean) => void;
}

/**
 * Renders the filters body into `container`, after whatever the caller has
 * already put there (the panel header).
 *
 * Only *what is drawn* lives here. Everything about how it looks — node size
 * and colour, edge thickness and colour, spacing, labels — is in
 * `graph-appearance`, so the two panels do not both own a "node size" control.
 */
export function renderFilters(container: HTMLElement, options: FilterOptions): void {
  const section = container.createDiv({ cls: "enhanced-graph-section" });
  section.createDiv({ cls: "enhanced-graph-section-title", text: t("filter.types") });
  const counts = typeCounts(options.graph);
  for (const type of PAGE_TYPES.filter((candidate) => (counts.get(candidate) ?? 0) > 0)) {
    const row = section.createEl("label", { cls: "enhanced-graph-checkbox" });
    const input = row.createEl("input", { type: "checkbox" });
    input.checked = !options.hiddenTypes.has(type);
    input.addEventListener("change", () => options.onToggleType(type, input.checked));
    row.createSpan({ text: t(`type.${type}` as never) });
    row.createSpan({ cls: "enhanced-graph-legend-count", text: String(counts.get(type) ?? 0) });
  }

  renderTagSection(container, options);

  const visibility = container.createDiv({ cls: "enhanced-graph-section" });
  visibility.createDiv({ cls: "enhanced-graph-section-title", text: t("filter.visibility") });
  checkboxRow(visibility, t("filter.hideIsolated"), options.hideIsolated, options.onToggleIsolated);
  checkboxRow(
    visibility,
    t("filter.hideStructural"),
    options.hideStructural,
    options.onToggleStructural,
  );
}

/**
 * Tag filtering: every tag in the graph, most-used first, behind a search box.
 *
 * The row list re-renders on every keystroke so typing narrows it in place. The
 * search box is rebuilt too, but it is re-rendered synchronously inside the same
 * event, so the field keeps focus and the caret position.
 */
function renderTagSection(container: HTMLElement, options: FilterOptions): void {
  const section = container.createDiv({ cls: "enhanced-graph-section" });
  const all = collectTags(options.graph.nodes);

  const header = section.createDiv({ cls: "enhanced-graph-section-title" });
  header.createSpan({ text: `${t("filter.tags")} (${all.length})` });
  const clear = header.createEl("button", { cls: "enhanced-graph-link", text: t("filter.clearTags") });

  const search = section.createEl("input", { cls: "enhanced-graph-tag-search" });
  search.type = "search";
  search.placeholder = t("filter.tagSearch");
  search.value = tagQuery;

  const list = section.createDiv({ cls: "enhanced-graph-tag-list" });

  /**
   * The restore button is always created and merely hidden while nothing is
   * filtered. The panel is NOT re-rendered on every toggle (that would rebuild
   * the list under the pointer and steal focus from the search box), so a
   * conditionally created button would not appear until some unrelated
   * re-render happened — i.e. it would be unreachable exactly when it is
   * needed. `options.hiddenTags` is the view's live set, so reading its size
   * after a toggle is enough to know whether to show it.
   */
  const syncClear = (): void => {
    clear.classList.toggle("is-hidden", options.hiddenTags.size === 0);
  };
  clear.addEventListener("click", () => {
    if (options.hiddenTags.size === 0) return;
    options.onClearTags();
    for (const input of Array.from(list.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))) {
      input.checked = true;
    }
    syncClear();
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

    for (const entry of rows.slice(0, MAX_TAG_ROWS)) {
      const row = list.createEl("label", { cls: "enhanced-graph-checkbox" });
      const input = row.createEl("input", { type: "checkbox" });
      input.checked = !options.hiddenTags.has(entry.tag);
      input.addEventListener("change", () => {
        options.onToggleTag(entry.tag, input.checked);
        syncClear();
      });
      row.createSpan({ cls: "enhanced-graph-tag-name", text: entry.tag });
      row.createSpan({ cls: "enhanced-graph-legend-count", text: String(entry.count) });
    }

    if (rows.length > MAX_TAG_ROWS) {
      list.createDiv({
        cls: "enhanced-graph-tag-more",
        text: t("filter.moreTags", { shown: MAX_TAG_ROWS, total: rows.length }),
      });
    }
  };

  search.addEventListener("input", () => {
    tagQuery = search.value;
    paint();
  });
  paint();
  syncClear();
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
