import { isEditingWithin } from "./dom-focus";
/**
 * The side panel injected into Obsidian's **built-in** graph view.
 *
 * Split out of `official-graph.ts`: the enhancer decides *when* the panel is
 * shown or re-rendered (attach, `refresh()`, and the `setData` wrapper), this
 * module decides what it contains. Keeping the two apart is what lets the panel
 * hold its own view state — the collapse flag and the active ids — without the
 * enhancer carrying it around.
 *
 * It stays a pure DOM builder: everything it needs from the plugin arrives as a
 * callback, and the two gestures it cannot perform itself (focus, disable) are
 * callbacks too. The collapse flag and the active ids are the only state it
 * owns, and `render()` deliberately preserves both.
 */

import { setIcon } from "obsidian";

import type { GraphInsights } from "../core/insights";
import type { OfficialGraphMode, WikiGraph } from "../types";
import { t } from "../i18n";
import { colourRow } from "../view/controls";
import { renderInsightsPanel } from "../view/insights-panel";

/** Hop budgets offered for a focused pair; mirrors the standalone view's list. */
const FOCUS_INTERMEDIATE_CHOICES = [0, 1, 2, 3] as const;

/** The two colouring views; the user picks one, the other stays available. */
export type ColorTab = "type" | "community";

/** The panel is two views: the insights it exists for, and the colours. */
export type PanelTab = "insights" | "colors" | "filters" | "weights";

export interface OfficialPanelOptions {
  readonly graph: () => WikiGraph;
  readonly insights: () => GraphInsights;
  readonly dismissed: () => ReadonlySet<string>;
  readonly mode: () => OfficialGraphMode;
  /** A legend row was clicked; `communityId` is set for cluster rows only. */
  readonly onFocusNodes: (nodeIds: readonly string[], communityId?: number) => void;
  readonly onDismiss: (key: string, nodeIds: readonly string[]) => void;
  /** How many notes are focused; the hop control only matters for a pair. */
  readonly focusCount: () => number;
  /** Current hop budget, shared with the standalone view. */
  readonly intermediates: () => number;
  readonly onSetIntermediates: (intermediates: number) => void;
  /** Colour rows for the active tab, and the setter that writes them. */
  /**
   * The colour list to show, derived from the colouring mode rather than held
   * as separate state: "which list am I reading" and "how is the graph` coloured"
   * must not be able to disagree. Null while colouring is off.
   */
  readonly activeColorTab: () => ColorTab | null;
  readonly colorEntries: (tab: ColorTab) => Array<{ key: string; label: string; color: string; isOverride: boolean }>;
  /** Selecting a list IS selecting the colouring mode. */
  readonly onSelectColorTab: (tab: ColorTab) => void;
  readonly onSetColor: (tab: ColorTab, key: string, color: string | null) => void;
  readonly lineColor: () => string;
  readonly onSetLineColor: (color: string | null) => void;
  /** Draws the filters body, which the standalone view renders with the same code. */
  readonly renderFilters: (el: HTMLElement) => void;
  readonly renderWeights: (el: HTMLElement) => void;
}

export class OfficialSidePanel {
  private readonly el: HTMLElement;
  /** Which top-level view is showing; only this panel cares. */
  private tab: PanelTab = "insights";
  /** Hidden while the toolbar has no panel open. */
  private visible = true;
  /** A re-render that was deferred because a control had focus. */
  private pendingRender = false;
  private mounted = false;
  /** The node ids the insights cards should mark as active. */
  private activeNodeIds: ReadonlySet<string> = new Set();

  constructor(
    private readonly container: HTMLElement,
    private readonly options: OfficialPanelOptions,
  ) {
    this.el = document.createElement("div");
  }

  /** Builds the panel element and appends it to the container. */
  mount(): void {
    this.el.className = "enhanced-graph-official-panel";
    this.container.appendChild(this.el);
    // A deferred render has to happen once the interaction is over.
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

    /** The colours view: one list per colouring mode, plus the line colour. */
    private renderColours(panel: HTMLElement): void {
      const colorTabs = panel.createDiv({ cls: "enhanced-graph-official-tabs" });
      for (const [tab, label] of [
        ["type", t("appearance.colorByType")],
        ["community", t("appearance.colorByCommunity")],
      ] as Array<[ColorTab, string]>) {
        const button = colorTabs.createEl("button", {
          cls: `enhanced-graph-tab${this.options.activeColorTab() === tab ? " is-active" : ""}`,
          text: label,
        });
        button.addEventListener("click", () => this.options.onSelectColorTab(tab));
      }
      const colorSection = panel.createDiv({ cls: "enhanced-graph-official-colors" });
      const entries = this.options.colorEntries(this.options.activeColorTab() ?? "type");
      if (entries.length === 0) {
        colorSection.createDiv({
          cls: "setting-item-description",
          text: t("appearance.noCommunities"),
        });
      }
      for (const entry of entries) {
        colourRow(
          colorSection,
          entry.label,
          entry.color,
          (value) => this.options.onSetColor(this.options.activeColorTab() ?? "type", entry.key, value),
          {
            allowTheme: true,
            onTheme: () => this.options.onSetColor(this.options.activeColorTab() ?? "type", entry.key, null),
            isTheme: !entry.isOverride,
          },
        );
      }
      colourRow(
        panel.createDiv({ cls: "enhanced-graph-official-colors" }),
        t("appearance.edgeColor"),
        this.options.lineColor(),
        (value) => this.options.onSetLineColor(value),
        { allowTheme: true, onTheme: () => this.options.onSetLineColor(null), isTheme: false },
      );
    }

  /**
   * Show one tab, or hide the whole panel.
   *
   * Driven by the toolbar's toggles, so the panel and the button that opens it
   * cannot disagree about what is on screen.
   */
  showTab(tab: PanelTab, visible = true): void {
    this.tab = tab;
    this.visible = visible;
    this.render();
  }
  /** Re-renders in place. */
  render(): void {
    // Never rebuild while one of our own controls holds focus. Emptying the
    // panel removes the very element the interaction is attached to: clicking a
    // colour swatch closed the native picker the instant it opened, because the
    // settings change it triggered re-rendered the panel. Deferring keeps every
    // control usable, not just that one.
    if (this.mounted && isEditingWithin(this.el)) {
      this.pendingRender = true;
      return;
    }
    const panel = this.el;
    const mode = this.options.mode();
    if (mode === "off") {
      panel.addClass("is-hidden");
      return;
    }
    panel.removeClass("is-hidden");
    panel.toggleClass("is-hidden", !this.visible);
    panel.empty();

    const graph = this.options.graph();
    const insights = this.options.insights();
    const dismissed = this.options.dismissed();

    const header = panel.createDiv({ cls: "enhanced-graph-official-panel-header" });
    setIcon(header.createSpan({ cls: "enhanced-graph-button-icon" }), "git-fork");
    // No collapse or close button: the toolbar owns which view is open, and the
    // enhancement as a whole is turned off from the settings tab.
    header.createSpan({ text: t("official.panelTitle") });
    if (this.tab === "weights") {
      const weights = panel.createDiv({ cls: "enhanced-graph-official-weights" });
      this.options.renderWeights(weights);
      return;
    }

    if (this.tab === "filters") {
      const body = panel.createDiv({ cls: "enhanced-graph-official-filters" });
      this.options.renderFilters(body);
      return;
    }

    if (this.tab === "colors") {
      this.renderColours(panel);
      return;
    }

    // The hop budget: how far the route between two focused notes may wander.
    // Rendered with the standalone view's own classes so both look identical.
    if (this.options.focusCount() >= 2) {
      const row = panel.createDiv({ cls: "enhanced-graph-focus-range" });
      row.createSpan({ cls: "enhanced-graph-focus-range-label", text: t("focus.range") });
      const active = this.options.intermediates();
      for (const intermediates of FOCUS_INTERMEDIATE_CHOICES) {
        const label =
          intermediates === 0 ? t("focus.shortest") : t("focus.viaN", { n: intermediates });
        const button = row.createEl("button", { cls: "enhanced-graph-hop-button", text: label });
        if (intermediates === active) button.addClass("is-active");
        button.addEventListener("click", () => this.options.onSetIntermediates(intermediates));
      }
    }
    // The community list lives in the legend at the bottom-left now; repeating it
    // here was the same information twice on one screen.
    const insightsEl = panel.createDiv({ cls: "enhanced-graph-official-insights" });
    renderInsightsPanel(insightsEl, {
      graph,
      insights,
      dismissed,
      showDismissed: false,
      activeNodeIds: this.activeNodeIds,
      // Keep the cards visually identical to the standalone view.
      setIconImpl: setIcon,
      onToggleFocus: (nodeIds) => {
        this.activeNodeIds = new Set(nodeIds);
        this.options.onFocusNodes(nodeIds);
        this.render();
      },
      onDismiss: (key, nodeIds) => void this.options.onDismiss(key, nodeIds),
      onToggleShowDismissed: () => this.render(),
    });
  }

  destroy(): void {
    this.el.remove();
  }
}
