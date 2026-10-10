/**
 * The contract the UI layer needs from the plugin.
 *
 * `view/` and `settings.ts` depend on THIS, not on the plugin class. That is
 * what keeps the dependency arrows pointing one way:
 *
 *     main (composition root)
 *       └── view / settings  ──▶  plugin-host  ──▶  settings-model, types, core
 *
 * and what lets the graph view be driven from the browser harness with a plain
 * object instead of a real `Plugin`.
 */

import type { App } from "obsidian";
import type { GraphInsights } from "./core/insights";
import type { InsightAction } from "./core/insights/model";
import type { MessageKey } from "./i18n";
import type { WikiGraph } from "./types";
import type { EnhancedGraphSettings } from "./settings-model";
import type { LayoutSource } from "./view/layout";

export interface GraphSnapshot {
  readonly graph: WikiGraph;
  readonly insights: GraphInsights;
}

export interface PluginHost {
  readonly app: App;
  /** Live settings object; mutating it is allowed, persisting is not implicit. */
  settings: EnhancedGraphSettings;

  saveSettings(): Promise<void>;

  /** The graph snapshot, building it on first use. */
  getGraph(onProgress?: (done: number, total: number) => void): Promise<GraphSnapshot>;

  /** Markdown report of the association scores around one node, to the clipboard. */
  copyRelevanceReport(nodeId: string): Promise<void>;

  /**
   * Perform a finding's action. Returns a message key for the Notice, or null.
   *
   * `null` means the action reported its own outcome (`open-report` exports the
   * file and notices it) or the user cancelled the preview — in neither case is
   * there a second message to show. A key means the caller shows it: both panel
   * hosts render the same cards, so the message belongs where the click came from.
   *
   * Typed as `MessageKey` rather than `string` so `t()` can render it without a
   * cast; the two are interchangeable to a caller, since `MessageKey extends string`.
   */
  performInsightAction(action: InsightAction): Promise<MessageKey | null>;

  /** Throw away the cached graph and rebuild. */
  requestGraphRebuild(notify?: boolean): void;

  /** Re-render every open view (and the built-in-graph overlay). */
  refreshViews(): void;

  /**
   * Where the standalone view may borrow pre-computed coordinates from.
   * `null` when nothing supplies them, in which case the view lays out itself.
   */
  readonly layoutSource: LayoutSource | null;
}

/** The subset the settings screen needs, so it never sees the whole plugin. */
export interface SettingsHost {
  readonly app: App;
  settings: EnhancedGraphSettings;
  saveSettings(): Promise<void>;
  requestGraphRebuild(notify?: boolean): void;
  refreshViews(): void;
  /** Re-apply the built-in-graph mode after the dropdown changes. */
  applyOfficialGraphMode(): void;
  /** Re-seed open views from the built-in graph's layout. */
  syncLayoutFromOfficial(): Promise<void>;
}
