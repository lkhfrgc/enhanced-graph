/**
 * The standalone view's legend, mounted on Obsidian's **built-in** graph.
 *
 * Same component and classes as the standalone view, so what the colours mean is
 * explained identically in both: node types while colouring by type, clusters
 * while colouring by community.
 *
 * It sits at the bottom-left, away from our toolbar and panel in the top-left,
 * and is given a FIXED size rather than shrinking to fit: a legend that resizes
 * as the underlying clusters change makes the graph beside it jump around.
 */

import { renderLegend, type LegendOptions } from "../view/graph-legend";
import { isEditingWithin } from "./dom-focus";

/**
 * `renderLegend` only hides itself for an empty graph; "colouring is off" is our
 * own reason to hide, so it is passed in explicitly.
 */
export interface OfficialLegendOptions extends LegendOptions {
  readonly visible: boolean;
}

export class OfficialLegend {
  private readonly el: HTMLElement;
  private mounted = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: () => OfficialLegendOptions,
  ) {
    this.el = document.createElement("div");
  }

  mount(): void {
    if (this.mounted) return;
    this.el.className = "enhanced-graph-legend enhanced-graph-official-legend";
    this.container.appendChild(this.el);
    this.mounted = true;
  }

  destroy(): void {
    if (!this.mounted) return;
    this.el.remove();
    this.mounted = false;
  }

  render(): void {
    if (!this.mounted) return;
    // Same rule as the panel and the toolbar: never rebuild while one of our own
    // controls has focus, or the interaction loses the element it is attached to.
    if (isEditingWithin(this.el)) return;
    const options = this.options();
    this.el.toggleClass("is-hidden", !options.visible);
    if (!options.visible) return;
    renderLegend(this.el, {
      ...options,
    });
  }
}
