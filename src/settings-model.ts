/**
 * The persisted settings model.
 *
 * Deliberately separate from the settings *UI* (`settings.ts`): the model is
 * what every other module depends on, and keeping it free of Obsidian's
 * `Setting`/`PluginSettingTab` means the graph view and the engine can depend on
 * the shape of the settings without dragging in the settings screen — or, worse,
 * the plugin class that owns them.
 */

import type { ColorMode, OfficialGraphMode, RelevanceWeights } from "./types";
import { DEFAULT_RELEVANCE_WEIGHTS } from "./types";
import { DEFAULT_EDGE_WIDTHS } from "./view/palette";
import { detectLanguage, setLanguage, type Language } from "./i18n";

export interface EnhancedGraphSettings {
  language: Language | "auto";
  /** Association-engine weights, user tunable. */
  weights: RelevanceWeights;
  /** Folder prefixes excluded from the graph. */
  excludeFolders: string[];
  /** Page types hidden from the graph. */
  hiddenTypes: string[];
  /**
   * Knowledge clusters (Louvain communities) hidden from the graph, by id.
   *
   * Ids, not names: a cluster has no name of its own — the legend labels it with
   * its core node — and the ids are what the analysis produces.
   */
  hiddenCommunities: number[];
  /** Tags the tag filter acts on; see `tagFilterMode` for what that means. */
  hiddenTags: string[];
  /**
   * Whether the ticked tags are the ones to hide, or the only ones to keep.
   *
   * Default `"exclude"` keeps the meaning every existing settings file already
   * has: the list is the tags being hidden.
   */
  tagFilterMode: "exclude" | "include";
  hideIsolated: boolean;
  hideStructural: boolean;
  showLabels: boolean;
  colorMode: ColorMode;
  nodeScale: number;
  /** ForceAtlas2 gravity; higher packs clusters tighter. */
  gravity: number;
  /** Multiplier on the edge width ramp; 1 keeps the reference widths. */
  /** Weak end of the edge colour ramp; `null` follows the theme. */
  edgeWeakColor: string | null;
  /** Strong end of the edge colour ramp; `null` follows the theme. */
  edgeStrongColor: string | null;
  /** Edge width at normalizedWeight 0 / 1; everything between interpolates. */
  edgeWeakWidth: number;
  edgeStrongWidth: number;
  /**
   * How many intermediate notes a connecting path may pass through.
   * 0 means shortest paths only; 1 admits A → X → B, and so on.
   */
  /** Whether labels are dropped as their node shrinks below a size threshold. */
  autoHideLabels: boolean;
  /** Label font size in pixels. */
  labelSize: number;
  /**
   * Label opacity, 0–1.
   *
   * The colour itself is not a setting: labels are white on the light theme and
   * black on the dark one, which is what reads against a node fill. Opacity is
   * what is left to tune — how loudly the labels sit on top of the graph.
   */
  labelOpacity: number;
  focusMaxIntermediates: number;
  /** Node colour used when `colorMode` is `"custom"`. */
  customNodeColor: string;
  /** Per-page-type colour overrides, keyed by page type. */
  typeColorOverrides: Record<string, string>;
  /** Per-community colour overrides. JSON keys are strings, so ids are stored as text. */
  communityColorOverrides: Record<string, string>;
  /** How far to layer onto Obsidian's built-in graph view. */
  officialGraphMode: OfficialGraphMode;
  /**
   * Line colour for the built-in graph's enhancement, or `null` to leave the
   * built-in graph's own theme colour alone.
   *
   * Its own setting, not the standalone view's strong-edge colour: that one is one
   * end of the standalone view's weak→strong ramp, so sharing it meant tuning the
   * ramp silently repainted the built-in graph's edges with a flat colour — a dark
   * ramp end left near-black lines on the light theme.
   */
  officialLineColor: string | null;
  /** Reuse the built-in graph's worker-computed layout when available. */
  reuseOfficialLayout: boolean;
  /** Layout positions, persisted so the graph never jumps between sessions. */
  positions: Record<string, { x: number; y: number }>;
  /** Dismissed insight keys ("mark as seen"). */
  dismissedInsights: string[];
}

export const DEFAULT_SETTINGS: EnhancedGraphSettings = {
  language: "auto",
  weights: { ...DEFAULT_RELEVANCE_WEIGHTS },
  excludeFolders: [],
  hiddenTypes: [],
  hiddenCommunities: [],
  hiddenTags: [],
  tagFilterMode: "exclude",
  hideIsolated: false,
  hideStructural: true,
  showLabels: true,
  colorMode: "type",
  nodeScale: 1,
  gravity: 1,
  edgeWeakColor: null,
  edgeStrongColor: null,
  edgeWeakWidth: DEFAULT_EDGE_WIDTHS.weakWidth,
  edgeStrongWidth: DEFAULT_EDGE_WIDTHS.strongWidth,
  autoHideLabels: true,
  labelSize: 12,
  labelOpacity: 1,
  focusMaxIntermediates: 0,
  customNodeColor: "#60a5fa",
  typeColorOverrides: {},
  communityColorOverrides: {},
  officialGraphMode: "off",
  officialLineColor: null,
  reuseOfficialLayout: true,
  positions: {},
  dismissedInsights: [],
};

/** Fill in anything a previous settings file is missing. */
export function mergeSettings(raw: unknown): EnhancedGraphSettings {
  const source = (raw ?? {}) as Partial<EnhancedGraphSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    weights: { ...DEFAULT_SETTINGS.weights, ...(source.weights ?? {}) },
    positions: source.positions ?? {},
    dismissedInsights: source.dismissedInsights ?? [],
    excludeFolders: source.excludeFolders ?? [],
    hiddenTypes: source.hiddenTypes ?? [],
    hiddenCommunities: source.hiddenCommunities ?? [],
    hiddenTags: source.hiddenTags ?? [],
    tagFilterMode: source.tagFilterMode ?? DEFAULT_SETTINGS.tagFilterMode,
    officialGraphMode: source.officialGraphMode ?? DEFAULT_SETTINGS.officialGraphMode,
    officialLineColor: source.officialLineColor ?? DEFAULT_SETTINGS.officialLineColor,
    reuseOfficialLayout: source.reuseOfficialLayout ?? DEFAULT_SETTINGS.reuseOfficialLayout,
    edgeWeakColor: source.edgeWeakColor ?? DEFAULT_SETTINGS.edgeWeakColor,
    edgeStrongColor: source.edgeStrongColor ?? DEFAULT_SETTINGS.edgeStrongColor,
    edgeWeakWidth: source.edgeWeakWidth ?? DEFAULT_SETTINGS.edgeWeakWidth,
    edgeStrongWidth: source.edgeStrongWidth ?? DEFAULT_SETTINGS.edgeStrongWidth,
    autoHideLabels: source.autoHideLabels ?? DEFAULT_SETTINGS.autoHideLabels,
    labelSize: source.labelSize ?? DEFAULT_SETTINGS.labelSize,
    labelOpacity: source.labelOpacity ?? DEFAULT_SETTINGS.labelOpacity,
    focusMaxIntermediates: source.focusMaxIntermediates ?? DEFAULT_SETTINGS.focusMaxIntermediates,
    customNodeColor: source.customNodeColor ?? DEFAULT_SETTINGS.customNodeColor,
    typeColorOverrides: source.typeColorOverrides ?? {},
    communityColorOverrides: source.communityColorOverrides ?? {},
  };
}

export function applyLanguage(settings: EnhancedGraphSettings, locale?: string): void {
  setLanguage(settings.language === "auto" ? detectLanguage(locale) : settings.language);
}
