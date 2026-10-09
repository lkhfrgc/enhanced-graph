/**
 * The standalone view's toolbar, mounted on Obsidian's **built-in** graph.
 *
 * Deliberately the same component (`view/graph-toolbar`) and the same classes, so
 * the chrome looks and behaves identically in both places — the two views are
 * two renderings of one graph, not two products.
 *
 * Overlay, not replacement: the built-in view keeps its own settings gear. Our
 * toolbar only drives what we actually own, which is why the panel list is
 * restricted — a toggle that opens nothing is worse than no toggle.
 */

import { renderToolbar, type PanelMode } from "../view/graph-toolbar";
import { isEditingWithin } from "./dom-focus";
import type { ColorMode } from "../types";

export interface OfficialToolbarOptions {
  readonly colorMode: () => ColorMode;
  readonly searchQuery: () => string;
  readonly insightCount: () => number;
  readonly panel: () => PanelMode;
  readonly onColorMode: (mode: ColorMode) => void;
  readonly onSearch: (query: string) => void;
  readonly onPanel: (mode: PanelMode) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFit: () => void;
}

/**
 * Only panels the built-in graph actually has. A toggle that opens nothing is
 * worse than no toggle, so this list is what the port has reached.
 *
 * Weights are not on it: the coefficients are the analysis' own, tuned in the
 * settings tab and in the standalone view, and offering them here as well meant a
 * second copy of the same four numbers inside a graph they describe.
 */
const AVAILABLE_PANELS: readonly PanelMode[] = ["insights", "filters", "appearance", "clustering"];

export class OfficialToolbar {
  private readonly el: HTMLElement;
  private mounted = false;
  /** A re-render deferred because a control of ours had focus. */
  private pendingRender = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: OfficialToolbarOptions,
  ) {
    this.el = document.createElement("div");
  }

  mount(): void {
    if (this.mounted) return;
    this.el.className = "enhanced-graph-official-toolbar";
    this.container.appendChild(this.el);
    // Same reason as the panel: rebuilding removes the element the interaction
    // is attached to, which threw focus out of the search box on every
    // keystroke.
    this.el.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (this.pendingRender && !isEditingWithin(this.el)) {
          this.pendingRender = false;
          this.render();
        }
      }, 0);
    });
    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) return;
    this.el.remove();
    this.mounted = false;
  }

  render(): void {
    if (!this.mounted) return;
    if (isEditingWithin(this.el)) {
      this.pendingRender = true;
      return;
    }
    const options = this.options;
    renderToolbar(this.el, {
      colorMode: options.colorMode(),
      searchQuery: options.searchQuery(),
      insightCount: options.insightCount(),
      panelMode: options.panel(),
      panels: AVAILABLE_PANELS,
      onColorMode: options.onColorMode,
      onSearch: options.onSearch,
      onPanel: options.onPanel,
      // No `onRebuild`: the built-in graph keeps itself in step with the vault, so
      // the toolbar draws no rebuild button here.
      onZoomIn: options.onZoomIn,
      onZoomOut: options.onZoomOut,
      onFit: options.onFit,
    });
  }
}
