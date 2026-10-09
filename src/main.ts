/**
 * Composition root.
 *
 * Everything here is wiring: register the view and commands, cache the graph
 * snapshot, and inject the platform-specific pieces (`VaultAdapter`,
 * `LayoutSource`, the built-in-graph enhancer) into the modules that need them.
 * The behaviour lives in `core/`, `view/`, `integrate/` and `reports.ts`.
 */

import { getLanguage, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { EnhancedGraphSettingTab } from "./settings";
import { DEFAULT_SETTINGS, applyLanguage, mergeSettings, type EnhancedGraphSettings } from "./settings-model";
import { t } from "./i18n";
import { VIEW_TYPE_ENHANCED_GRAPH, EnhancedGraphView } from "./view/graph-view";
import {
  EMPTY_GRAPH,
  type OfficialGraphMode,
  type WikiGraph,
} from "./types";
import { buildWikiGraph } from "./core/graph-builder";
import { analyzeGraph, type GraphInsights } from "./core/insights";
import type { VaultAdapter } from "./core/vault";
import { GRAPH_MENU_SOURCE, OfficialGraphEnhancer, probeOfficialGraph } from "./integrate/official-graph";
import { captureOfficialLayout } from "./integrate/official-layout";
import { hasOfficialGraphView } from "./integrate/official-internals";
import type { PluginHost, SettingsHost } from "./plugin-host";
import type { ExternalLayout, LayoutSource } from "./view/layout";
import { ObsidianVaultAdapter } from "./vault-adapter";
import { INSIGHTS_REPORT_PATH, buildInsightsReport, buildRelevanceReport } from "./reports";

/** How long to wait after the last vault edit before rebuilding. */
const REBUILD_DEBOUNCE_MS = 1200;

export default class EnhancedGraphPlugin extends Plugin implements PluginHost, SettingsHost {
  settings: EnhancedGraphSettings = { ...DEFAULT_SETTINGS };

  private vaultAdapter!: VaultAdapter;
  private cachedGraph: WikiGraph = EMPTY_GRAPH;
  private cachedInsights: GraphInsights = { connections: [], gaps: [] };
  private buildPromise: Promise<{ graph: WikiGraph; insights: GraphInsights }> | null = null;
  private rebuildTimer: number | null = null;
  private views = new Set<EnhancedGraphView>();
  private officialGraph: OfficialGraphEnhancer | null = null;

  /**
   * The standalone view asks this for pre-computed coordinates; it never learns
   * where they come from. Gated on the user's preference here rather than in the
   * view, so "which provider" and "should we use one at all" stay in one place.
   */
  readonly layoutSource: LayoutSource = {
    capture: (nodeIds: readonly string[]): ExternalLayout | null => {
      if (!this.settings.reuseOfficialLayout) return null;
      const snapshot = captureOfficialLayout(this.app, nodeIds);
      if (!snapshot) return null;
      return {
        positions: snapshot.positions,
        source: snapshot.viewType,
        coverage: snapshot.coverage,
      };
    },
  };

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onload(): Promise<void> {
    await this.loadSettings();
    applyLanguage(this.settings, getLanguage());
    this.vaultAdapter = new ObsidianVaultAdapter(this.app);

    this.registerView(VIEW_TYPE_ENHANCED_GRAPH, (leaf) => {
      const view = new EnhancedGraphView(leaf, this);
      this.views.add(view);
      return view;
    });

    this.addRibbonIcon("git-fork", t("ribbon.tooltip"), () => void this.activateView());

    this.addCommand({
      id: "open",
      name: t("command.open"),
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "rebuild",
      name: t("command.rebuild"),
      callback: () => this.requestGraphRebuild(true),
    });

    this.addCommand({
      id: "copy-relevance-report",
      name: t("command.copyReport"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.copyRelevanceReport(file.path.replace(/\.md$/i, "").toLowerCase());
        return true;
      },
    });

    this.addCommand({
      id: "export-graph-insights",
      name: t("command.exportInsights"),
      callback: () => void this.exportInsights(),
    });

    this.addCommand({
      id: "toggle-official-graph",
      name: t("command.toggleOfficialGraph"),
      callback: () => void this.toggleOfficialGraph(),
    });

    this.addCommand({
      id: "probe-official-graph",
      name: t("command.probeOfficialGraph"),
      callback: () => this.reportOfficialGraphCompatibility(),
    });

    this.addCommand({
      id: "sync-official-layout",
      name: t("command.syncOfficialLayout"),
      callback: () => this.syncLayoutFromOfficial(),
    });

    this.addSettingTab(new EnhancedGraphSettingTab(this.app, this));

    // Vault changes invalidate the graph; debounce so a typing burst is cheap.
    const schedule = () => this.scheduleRebuild();
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
    this.registerEvent(this.app.workspace.on("css-change", () => this.refreshViews()));
    // The built-in graph's leaves come and go with the layout.
    this.registerEvent(this.app.workspace.on("layout-change", () => this.officialGraph?.sync()));
    // The built-in graph opens its node menu itself and fires `file-menu` first
    // (verified against the shipped app: the source is "graph-context-menu"), so
    // our items go in through that public event. Nothing is monkey-patched — if
    // Obsidian stops firing it we lose the menu items, not the graph.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
        if (source !== GRAPH_MENU_SOURCE) return;
        if (!(file instanceof TFile)) return;
        this.officialGraph?.handleFileMenu(menu, file, source, leaf);
      }),
    );

    this.setupOfficialGraph();
  }

  /**
   * Not `async`: `Plugin.onunload` is typed as returning `void`, and an async
   * implementation returns a promise the app never awaits.
   *
   * The leaves are deliberately NOT detached here. Detaching them on unload
   * resets the view to its default location, so a user who moved the graph to a
   * different pane finds it back where it started the next time the plugin
   * loads. Obsidian tears the leaf down itself when the view type is
   * unregistered; the enhancer still has to let go of the built-in graph, which
   * is what `stop()` does.
   */
  onunload(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    // Detach before the leaves disappear so the built-in graph is restored.
    this.officialGraph?.stop();
    this.officialGraph = null;
    this.views.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // -------------------------------------------------------------------------
  // View helpers
  // -------------------------------------------------------------------------

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_ENHANCED_GRAPH)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_ENHANCED_GRAPH, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Re-render open views; `theme` also re-reads the colour palette. */
  refreshViews(): void {
    for (const view of this.openViews()) view.refresh();
    this.officialGraph?.refresh();
  }

  // -------------------------------------------------------------------------
  // Built-in graph integration
  // -------------------------------------------------------------------------

  private setupOfficialGraph(): void {
    this.officialGraph = new OfficialGraphEnhancer({
      app: this.app,
      getData: () => this.cached,
      // The enhancer works in terms of a mode, "off" included; the setting is a
      // switch plus a colouring, so the two are composed here and nowhere else.
      getMode: () => this.officialMode(),
      getDismissed: () => this.settings.dismissedInsights,
      onSetMode: async (mode) => {
        if (mode === "off") return;
        this.settings.officialGraphColorMode = mode;
        await this.saveSettings();
        this.applyOfficialGraphMode();
      },
      getWeights: () => this.settings.weights,
      getVisibility: () => ({
        hiddenTypes: new Set(this.settings.hiddenTypes as never[]),
        hiddenCommunities: new Set(this.settings.hiddenCommunities),
        hiddenTags: new Set(this.settings.hiddenTags),
        includedTags:
          this.settings.includedTags === null ? null : new Set(this.settings.includedTags),
        tagFilterMode: this.settings.tagFilterMode,
        hideStructural: this.settings.hideStructural,
        hideIsolated: this.settings.hideIsolated,
      }),
      getTagFilterMode: () => this.settings.tagFilterMode,
      onSetVisibility: async (patch) => {
        Object.assign(this.settings, patch);
        await this.saveSettings();
        this.refreshViews();
      },
      getTypeColors: () => this.settings.typeColorOverrides,
      getCommunityColors: () => this.settings.communityColorOverrides,
      onSetTypeColor: async (type, color) => {
        if (color === null) delete this.settings.typeColorOverrides[type];
        else this.settings.typeColorOverrides[type] = color;
        await this.saveSettings();
        this.refreshViews();
      },
      onSetCommunityColor: async (community, color) => {
        const key = String(community);
        if (color === null) delete this.settings.communityColorOverrides[key];
        else this.settings.communityColorOverrides[key] = color;
        await this.saveSettings();
        this.refreshViews();
      },
      onSetLineColor: async (color) => {
        // The built-in graph's own line colour. NOT `edgeStrongColor`: that is one
        // end of the standalone view's ramp, and driving this graph from it meant a
        // dark ramp end painted near-black edges over the light theme.
        this.settings.officialLineColor = color;
        await this.saveSettings();
        this.refreshViews();
      },
      getLineColor: () => this.settings.officialLineColor,

      getFocusIntermediates: () => this.settings.focusMaxIntermediates,
      onSetFocusIntermediates: async (intermediates) => {
        this.settings.focusMaxIntermediates = intermediates;
        await this.saveSettings();
      },
      getHiddenTypes: () => this.settings.hiddenTypes,
      onToggleType: async (pageType) => {
        const hidden = this.settings.hiddenTypes;
        const at = hidden.indexOf(pageType);
        if (at === -1) hidden.push(pageType);
        else hidden.splice(at, 1);
        await this.saveSettings();
        this.refreshViews();
      },
      onDismiss: async (key) => {
        if (!this.settings.dismissedInsights.includes(key)) {
          this.settings.dismissedInsights.push(key);
          await this.saveSettings();
        }
        this.officialGraph?.refresh();
        this.refreshViews();
      },
      onOpenNode: (nodeId) => {
        const node = this.cached.graph.nodeIndex.get(nodeId);
        if (!node) return;
        const file = this.app.vault.getAbstractFileByPath(node.path);
        if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
      },
    });

    if (this.settings.officialGraphEnabled) {
      // Two things have to be true before this can run, and only the second was
      // being honoured:
      //
      //   1. Obsidian must have finished indexing the vault. `onload` runs
      //      BEFORE that, so a build started here reads an empty vault and
      //      caches the empty result — the bug where the built-in graph's
      //      insights stayed blank until an unrelated click forced a rebuild.
      //   2. The enhancer resolves nodes through the cached graph, so it must
      //      not attach before the first build has finished.
      this.app.workspace.onLayoutReady(() => {
        void this.getGraph().then(() => this.officialGraph?.start());
      });
    }
  }

  /** The enhancer's view of the setting: the switch, then the colouring. */
  officialMode(): OfficialGraphMode {
    return this.settings.officialGraphEnabled ? this.settings.officialGraphColorMode : "off";
  }

  /** Re-apply the switch after a settings change (called from the settings tab). */
  applyOfficialGraphMode(): void {
    if (!this.officialGraph) return;
    if (!this.settings.officialGraphEnabled) {
      this.officialGraph.stop();
      return;
    }
    void this.getGraph().then(() => {
      this.officialGraph?.start();
      this.officialGraph?.sync();
      this.officialGraph?.refresh();
    });
  }

  private async setOfficialGraphMode(mode: OfficialGraphMode, notify = true): Promise<void> {
    if (mode === "off") {
      if (!this.settings.officialGraphEnabled) return;
      this.settings.officialGraphEnabled = false;
    } else {
      if (this.settings.officialGraphEnabled && this.settings.officialGraphColorMode === mode) return;
      this.settings.officialGraphEnabled = true;
      this.settings.officialGraphColorMode = mode;
    }
    await this.saveSettings();
    this.applyOfficialGraphMode();
    if (notify) {
      new Notice(
        mode === "off"
          ? t("notice.officialOff")
          : t("notice.officialOn", {
              mode:
                mode === "community"
                  ? t("settings.officialGraphCommunity")
                  : t("settings.officialGraphType"),
            }),
      );
    }
  }

  private async toggleOfficialGraph(): Promise<void> {
    if (this.settings.officialGraphEnabled) {
      await this.setOfficialGraphMode("off");
      return;
    }
    // The view-type strings live only in `official-internals`; ask it rather
    // than repeating the literals here.
    if (!hasOfficialGraphView(this.app)) new Notice(t("notice.officialNoView"));
    await this.setOfficialGraphMode(this.settings.officialGraphColorMode);
  }

  /** Re-seed every open standalone view from the built-in graph's layout. */
  async syncLayoutFromOfficial(): Promise<void> {
    const views = this.openViews();
    if (views.length === 0) {
      new Notice(t("notice.officialNoView"));
      return;
    }
    const { graph } = await this.getGraph();
    const snapshot = captureOfficialLayout(
      this.app,
      graph.nodes.map((node) => node.id),
    );
    for (const view of views) view.syncLayoutFromOfficial();
    new Notice(
      snapshot
        ? t("notice.layoutSynced", { view: snapshot.viewType })
        : t("notice.layoutUnavailable"),
    );
  }

  /** Diagnostics for `command.probeOfficialGraph`: which seams still exist. */
  private reportOfficialGraphCompatibility(): void {    const probes = probeOfficialGraph(this.app);
    console.info("[enhanced-graph] built-in graph compatibility probe", probes);
    const report = probes
      .map((probe) => {
        const state = !probe.leafFound
          ? "未打开"
          : probe.missing.length > 0
            ? `缺失 ${probe.missing.join("/")}`
            : "可用";
        return `${probe.viewType}: ${state}`;
      })
      .join("；");
    new Notice(t("notice.officialProbe", { report }), 12000);
  }

  private openViews(): EnhancedGraphView[] {
    const out: EnhancedGraphView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_ENHANCED_GRAPH)) {
      if (leaf.view instanceof EnhancedGraphView) out.push(leaf.view);
    }
    return out;
  }

  requestGraphRebuild(notify = false): void {
    this.cachedGraph = EMPTY_GRAPH;
    this.cachedInsights = { connections: [], gaps: [] };
    this.buildPromise = null;
    this.scheduleRebuild(0);
    if (notify) new Notice(t("status.building"));
  }

  private scheduleRebuild(delay = REBUILD_DEBOUNCE_MS): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      for (const view of this.openViews()) void view.setGraphFromPlugin();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Graph building
  // -------------------------------------------------------------------------

  /** Cached graph build. Concurrent callers share one build. */
  async getGraph(onProgress?: (done: number, total: number) => void): Promise<{
    graph: WikiGraph;
    insights: GraphInsights;
  }> {
    if (this.buildPromise) return this.buildPromise;

    const build = (async () => {
      const graph = await buildWikiGraph({
        vault: this.vaultAdapter,
        excludeFolders: this.settings.excludeFolders,
        weights: this.settings.weights,
        // Re-using the previous community ids keeps cluster colours stable
        // across rebuilds instead of reshuffling them on every file save.
        previousCommunities: this.cachedGraph.communities,
        onProgress,
      });
      const insights = analyzeGraph(graph);
      this.cachedGraph = graph;
      this.cachedInsights = insights;
      return { graph, insights };
    })();

    this.buildPromise = build;
    try {
      return await build;
    } finally {
      // A failed build must not be cached forever.
      this.buildPromise = null;
    }
  }

  get cached(): { graph: WikiGraph; insights: GraphInsights } {
    return { graph: this.cachedGraph, insights: this.cachedInsights };
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async copyRelevanceReport(nodeId: string): Promise<void> {
    const { graph } = await this.getGraph();
    const node = graph.nodeIndex.get(nodeId);
    if (!node) {
      new Notice(t("notice.noActiveNote"));
      return;
    }
    await navigator.clipboard.writeText(buildRelevanceReport(node, graph, this.settings.weights));
    new Notice(t("notice.reportCopied"));
  }

  async exportInsights(): Promise<void> {
    const { graph, insights } = await this.getGraph();
    const path = INSIGHTS_REPORT_PATH;
    await this.vaultAdapter.write(path, buildInsightsReport(graph, insights));
    new Notice(t("notice.reportExported", { path }));
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
  }
}

export { VIEW_TYPE_ENHANCED_GRAPH };
