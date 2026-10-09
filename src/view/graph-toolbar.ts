/**
 * Toolbar presentation for the Enhanced Graph view.
 *
 * Extracted from `EnhancedGraphView` so the chrome can be rendered without the
 * `ItemView`, the plugin or sigma. The module is pure DOM: it only ever touches
 * the container it is handed, holds no state between renders and knows nothing
 * about settings persistence. Everything it cannot own — colour mode, search
 * text, which panel is open, rebuild and zoom — arrives as a callback on
 * `ToolbarOptions`.
 */

import { setIcon } from "obsidian";

import { t } from "../i18n";
import type { ColorMode } from "../types";

/** Which side panel is showing, if any. */
export type PanelMode = "none" | "insights" | "filters" | "appearance" | "clustering";

export interface ToolbarOptions {
  readonly colorMode: ColorMode;
  readonly searchQuery: string;
  readonly insightCount: number;
  readonly panelMode: PanelMode;
  readonly onColorMode: (mode: ColorMode) => void;
  readonly onSearch: (query: string) => void;
  readonly onPanel: (mode: PanelMode) => void;
  /**
   * Rebuild the graph from the vault.
   *
   * Optional: a host that keeps itself in step passes nothing and gets no button.
   * The built-in graph is such a host — the plugin rebuilds when the vault
   * changes, and everything the enhancement draws it takes from that same build —
   * so the button would only offer to do again what is already being done.
   */
  readonly onRebuild?: () => void;
  /** Zoom controls live here too. */
  /**
   * Which panel toggles to render. Defaults to all of them.
   *
   * The built-in graph only has some of these panels so far; rendering a toggle
   * that opens nothing would be a button that cannot do anything, and the
   * standalone view's set is unaffected by the default.
   */
  readonly panels?: readonly PanelMode[];
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
}

/** Renders the toolbar (empties it first). */
export function renderToolbar(container: HTMLElement, options: ToolbarOptions): void {
  container.empty();

  const group = container.createDiv({ cls: "enhanced-graph-segmented" });
  makeToggle(group, t("toolbar.colorByType"), "tag", options.colorMode === "type", () =>
    options.onColorMode("type"),
  );
  makeToggle(group, t("toolbar.colorByCommunity"), "layers", options.colorMode === "community", () =>
    options.onColorMode("community"),
  );

  const searchWrap = container.createDiv({ cls: "enhanced-graph-search-wrap" });
  const search = searchWrap.createDiv({ cls: "enhanced-graph-search" });
  setIcon(search.createSpan({ cls: "enhanced-graph-search-icon" }), "search");
  const input = search.createEl("input", {
    type: "text",
    placeholder: t("toolbar.searchPlaceholder"),
    value: options.searchQuery,
  });
  input.addEventListener("input", () => {
    options.onSearch(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      options.onSearch("");
    }
  });

  const right = container.createDiv({ cls: "enhanced-graph-toolbar-right" });
  const showPanel = (mode: PanelMode): boolean =>
    options.panels === undefined || options.panels.includes(mode);
  if (showPanel("insights")) {
  makeToggle(
    right,
    options.insightCount > 0
      ? `${t("toolbar.insights")} ${options.insightCount}`
      : t("toolbar.insights"),
    "lightbulb",
    options.panelMode === "insights",
    () => options.onPanel("insights"),
  );
  }
  if (showPanel("filters")) {
    makeToggle(right, t("toolbar.filter"), "filter", options.panelMode === "filters", () =>
      options.onPanel("filters"),
    );
  }
  if (showPanel("appearance")) {
    makeToggle(right, t("toolbar.appearance"), "palette", options.panelMode === "appearance", () =>
      options.onPanel("appearance"),
    );
  }
  if (showPanel("clustering")) {
    makeToggle(right, t("toolbar.clustering"), "scale", options.panelMode === "clustering", () =>
      options.onPanel("clustering"),
    );
  }
  if (options.onRebuild) {
    makeIconButton(right, "refresh-cw", t("toolbar.rebuild"), options.onRebuild);
  }
}

/** Renders the floating zoom buttons (empties the container first). */
export function renderZoomControls(
  container: HTMLElement,
  options: Pick<ToolbarOptions, "onZoomIn" | "onZoomOut" | "onFit">,
): void {
  container.empty();
  makeIconButton(container, "zoom-in", t("toolbar.zoomIn"), options.onZoomIn);
  makeIconButton(container, "zoom-out", t("toolbar.zoomOut"), options.onZoomOut);
  makeIconButton(container, "maximize", t("toolbar.fit"), options.onFit);
}

/** Icon + label button, marked with `is-active` while its mode is showing. */
function makeToggle(
  parent: HTMLElement,
  label: string,
  icon: string,
  active: boolean,
  onClick: () => void,
): void {
  const button = parent.createEl("button", { cls: `enhanced-graph-button${active ? " is-active" : ""}` });
  setIcon(button.createSpan({ cls: "enhanced-graph-button-icon" }), icon);
  button.createSpan({ text: label });
  button.addEventListener("click", onClick);
}

/** Square icon-only button; the icon is the button itself. */
function makeIconButton(parent: HTMLElement, icon: string, title: string, onClick: () => void): void {
  const button = parent.createEl("button", { cls: "enhanced-graph-button is-icon", attr: { "aria-label": title } });
  setIcon(button, icon);
  button.title = title;
  button.addEventListener("click", onClick);
}
