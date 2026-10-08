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
  /** Tags hidden from the graph; a page carrying any of them is hidden. */
  hiddenTags: string[];
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
  /** Label colour; `null` follows the theme. */
  labelColor: string | null;
  focusMaxIntermediates: number;
  /** Node colour used when `colorMode` is `"custom"`. */
  customNodeColor: string;
  /** Per-page-type colour overrides, keyed by page type. */
  typeColorOverrides: Record<string, string>;
  /** Per-community colour overrides. JSON keys are strings, so ids are stored as text. */
  communityColorOverrides: Record<string, string>;
  /** How far to layer onto Obsidian's built-in graph view. */
  officialGraphMode: OfficialGraphMode;
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
  hiddenTags: [],
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
  labelColor: null,
  focusMaxIntermediates: 0,
  customNodeColor: "#60a5fa",
  typeColorOverrides: {},
  communityColorOverrides: {},
  officialGraphMode: "off",
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
    hiddenTags: source.hiddenTags ?? [],
    officialGraphMode: source.officialGraphMode ?? DEFAULT_SETTINGS.officialGraphMode,
    reuseOfficialLayout: source.reuseOfficialLayout ?? DEFAULT_SETTINGS.reuseOfficialLayout,
    edgeWeakColor: source.edgeWeakColor ?? DEFAULT_SETTINGS.edgeWeakColor,
    edgeStrongColor: source.edgeStrongColor ?? DEFAULT_SETTINGS.edgeStrongColor,
    edgeWeakWidth: source.edgeWeakWidth ?? DEFAULT_SETTINGS.edgeWeakWidth,
    edgeStrongWidth: source.edgeStrongWidth ?? DEFAULT_SETTINGS.edgeStrongWidth,
    autoHideLabels: source.autoHideLabels ?? DEFAULT_SETTINGS.autoHideLabels,
    labelSize: source.labelSize ?? DEFAULT_SETTINGS.labelSize,
    labelColor: source.labelColor ?? DEFAULT_SETTINGS.labelColor,
    focusMaxIntermediates: source.focusMaxIntermediates ?? DEFAULT_SETTINGS.focusMaxIntermediates,
    customNodeColor: source.customNodeColor ?? DEFAULT_SETTINGS.customNodeColor,
    typeColorOverrides: source.typeColorOverrides ?? {},
    communityColorOverrides: source.communityColorOverrides ?? {},
  };
}

export function applyLanguage(settings: EnhancedGraphSettings, locale?: string): void {
  setLanguage(settings.language === "auto" ? detectLanguage(locale) : settings.language);
}
