/**
 * The hover tooltip for Obsidian's **built-in** graph view.
 *
 * Split out of `official-graph.ts`: the enhancer owns the hover *wiring* (it
 * chains to whatever the data engine had already put in `renderer.onNodeHover`
 * and then delegates here), this module owns the card the user sees.
 *
 * It is a pure DOM builder. It never touches the renderer, imports no Obsidian
 * internals of its own and holds no state beyond its own element, so everything
 * that has to be current — the node lookup, the neighbour ranking — arrives as a
 * callback and is read on every `show()`: a graph rebuilt after `mount()` is
 * therefore picked up by the next hover without re-mounting anything.
 */

import type { WikiGraph } from "../types";
import { t } from "../i18n";
import type { NodeResolver } from "./official-internals";

/** Related pages listed under the hovered node. */
const RELATED_LIMIT = 5;
/** Distance from the pointer to the card's top-left corner. */
const POINTER_OFFSET = 16;
/** Gap kept between the card and the container edge. */
const EDGE_GAP = 4;
/** Assumed card extents, used to decide when the card would overflow. */
const CARD_WIDTH = 240;
const CARD_HEIGHT = 40;

export interface HoverTooltipOptions {
  /** Resolves an official node id to our node, or undefined for virtual nodes. */
  readonly resolve: NodeResolver;
  /** Ranked neighbours for the "related pages" list. */
  readonly topNeighbours: (nodeId: string, limit: number) => Array<{ label: string; weight: number }>;
  readonly graph: () => WikiGraph;
}

export class OfficialHoverTooltip {
  private readonly el: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: HoverTooltipOptions,
  ) {
    this.el = document.createElement("div");
  }

  /** Builds the tooltip element and appends it to the container. */
  mount(): void {
    this.el.className = "enhanced-graph-official-tooltip is-hidden";
    this.container.appendChild(this.el);
  }

  show(
    event: MouseEvent,
    officialId: string,
    officialType: string,
    mouse: { x: number | null; y: number | null },
  ): void {
    try {
      const node = this.options.resolve(officialId);
      const tooltip = this.el;
      tooltip.empty();

      if (!node) {
        // Virtual nodes (tags / unresolved links) still get a minimal card.
        const label = officialId.split("/").pop()?.replace(/\.md$/i, "") ?? officialId;
        tooltip.createDiv({ cls: "enhanced-graph-official-tooltip-title", text: label });
        tooltip.createDiv({
          cls: "enhanced-graph-official-tooltip-meta",
          text: officialType ? t("official.virtualNode", { type: officialType }) : t("official.unknownNode"),
        });
      } else {
        tooltip.createDiv({ cls: "enhanced-graph-official-tooltip-title", text: node.label });
        tooltip.createDiv({
          cls: "enhanced-graph-official-tooltip-meta",
          text:
            `${t("type." + node.type as never)} · ${t("status.edges")} ${node.linkCount} · ` +
            `${t("legend.communities")} ${node.community}`,
        });

        const related = this.options.topNeighbours(node.id, RELATED_LIMIT);
        if (related.length > 0) {
          const list = tooltip.createDiv({ cls: "enhanced-graph-official-tooltip-list" });
          for (const item of related) {
            const row = list.createDiv({ cls: "enhanced-graph-official-tooltip-row" });
            row.createSpan({ cls: "enhanced-graph-official-tooltip-name", text: item.label });
            row.createSpan({ cls: "enhanced-graph-official-tooltip-value", text: item.weight.toFixed(2) });
          }
        }
      }

      const rect = this.container.getBoundingClientRect();
      const x = mouse.x ?? event.clientX - rect.left;
      const y = mouse.y ?? event.clientY - rect.top;
      tooltip.style.left = `${Math.max(EDGE_GAP, Math.min(x + POINTER_OFFSET, rect.width - CARD_WIDTH))}px`;
      tooltip.style.top = `${Math.max(EDGE_GAP, Math.min(y + POINTER_OFFSET, rect.height - CARD_HEIGHT))}px`;
      tooltip.removeClass("is-hidden");
    } catch (error) {
      console.error("[enhanced-graph] hover tooltip failed:", error);
    }
  }

  hide(): void {
    this.el.addClass("is-hidden");
  }

  destroy(): void {
    this.el.remove();
  }
}
