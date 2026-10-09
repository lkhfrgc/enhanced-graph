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
  /**
   * Louvain resolution: higher yields more, smaller clusters.
   *
   * 1 is the algorithm's own default and was the only value this plugin could use
   * until now. Modularity cannot reliably separate communities below
   * `sqrt(2 * edges)` nodes, which is where this vault's clusters already sit, so
   * the knob is exposed rather than hidden.
   */
  resolution: number;
  /**
   * Only notes under this subfolder are read; empty means the whole vault.
   *
   * A single folder rather than a list, and an INCLUDE where `excludeFolders` is an
   * exclude: it narrows the plugin to one part of a vault that holds more than the
   * graph is about — a work folder inside a personal vault, say. Empty is the
   * default and keeps the previous behaviour exactly.
   */
  workingFolder: string;
  /** Page types hidden from the graph. */
  hiddenTypes: string[];
  /**
   * Knowledge clusters (Louvain communities) hidden from the graph, by id.
   *
   * Ids, not names: a cluster has no name of its own — the legend labels it with
   * its core node — and the ids are what the analysis produces.
   */
  hiddenCommunities: number[];
  /** Tags to exclude. Only read while `tagFilterMode` is `"exclude"`. */
  hiddenTags: string[];
  /**
   * Tags to keep. Only read while `tagFilterMode` is `"include"`.
   *
   * `null` means "no selection has been made in include mode yet", which keeps
   * everything — the state the mode opens in, since its first selection is every
   * tag. An EMPTY list is a selection the user made, and means the opposite: keep
   * nothing. The two are deliberately different values, not the same state twice.
   */
  includedTags: string[] | null;
  /**
   * Which way round the ticked tags are read.
   *
   * Each mode keeps its own selection, so switching back and forth never rewrites
   * the other one. Default `"exclude"`, which is also the only mode a file written
   * before this feature knows about — its `hiddenTags` meant "the tags being
   * hidden", and still does.
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
  /** Whether to layer the enhancement onto Obsidian's built-in graph view. */
  officialGraphEnabled: boolean;
  /**
   * How the built-in graph colours its nodes while the enhancement is on.
   *
   * Its own switch is separate: "off" used to be a third value of this setting, so
   * the same control both turned the enhancement on and chose how it coloured.
   * Which colouring it uses is now picked where it can be seen — the graph's own
   * toolbar — and this only remembers that choice.
   */
  officialGraphColorMode: "community" | "type";
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
  resolution: 1,
  workingFolder: "",
  hiddenTypes: [],
  hiddenCommunities: [],
  hiddenTags: [],
  includedTags: null,
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
  officialGraphEnabled: true,
  officialGraphColorMode: "community",
  officialLineColor: null,
  reuseOfficialLayout: true,
  positions: {},
  dismissedInsights: [],
};

/** Fill in anything a previous settings file is missing. */
export function mergeSettings(raw: unknown): EnhancedGraphSettings {
  const source = (raw ?? {}) as Partial<EnhancedGraphSettings>;
  // The key this feature used to live under. Read from the raw file rather than the
  // typed source, because the interface no longer has it — this is the only place
  // that still knows the old name, and it only reads it.
  const legacyMode = ((raw ?? {}) as { officialGraphMode?: OfficialGraphMode }).officialGraphMode;
  /** The tag mode as a file may have written it before the two selections split. */
  const legacyTagMode = source.tagFilterMode;
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    weights: { ...DEFAULT_SETTINGS.weights, ...(source.weights ?? {}) },
    positions: source.positions ?? {},
    dismissedInsights: source.dismissedInsights ?? [],
    excludeFolders: source.excludeFolders ?? [],
    resolution: typeof source.resolution === "number" ? source.resolution : DEFAULT_SETTINGS.resolution,
    workingFolder: source.workingFolder ?? DEFAULT_SETTINGS.workingFolder,
    hiddenTypes: source.hiddenTypes ?? [],
    hiddenCommunities: source.hiddenCommunities ?? [],
    hiddenTags: legacyTagMode === "include" ? [] : (source.hiddenTags ?? []),
    // A file written while the two modes shared one list had it meaning "keep
    // these" if it said include. That list moves to the mode it belonged to, so
    // the graph looks the same after the upgrade.
    includedTags:
      source.includedTags ??
      (legacyTagMode === "include" ? (source.hiddenTags ?? []) : DEFAULT_SETTINGS.includedTags),
    tagFilterMode: source.tagFilterMode ?? DEFAULT_SETTINGS.tagFilterMode,
    // Split out of the old three-state `officialGraphMode`, which said both whether
    // the enhancement ran and how it coloured. A file that has only ever known that
    // key keeps the state it was actually in: "off" stays off, and a colouring that
    // was in use stays on with that colouring — nobody's graph changes on upgrade.
    // A file with NEITHER key is a fresh install, and that starts ON.
    officialGraphEnabled:
      source.officialGraphEnabled ?? (legacyMode === undefined ? true : legacyMode !== "off"),
    officialGraphColorMode:
      source.officialGraphColorMode ?? (legacyMode === "type" ? "type" : "community"),
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
