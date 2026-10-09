/**
 * Appearance panel: the quick controls for how the graph *looks*, as opposed to
 * which nodes are drawn (that is `graph-filters`).
 *
 * Node size and colour, then edge thickness and colour — in the order a user
 * reaches for them. Node spacing and the label toggle live here too, being
 * display tuning rather than filtering.
 *
 * The edge ramp is configured by its **two ends**: colour and width at low
 * weight and at high weight. Everything between is interpolated, so the user
 * never has to describe the middle.
 *
 * Like `renderFilters`, the module is pure DOM and deliberately does NOT clear
 * `container`: the view renders the panel header into the same element and the
 * header must stay first. It holds no state and knows nothing about
 * persistence — every control is a callback.
 */

import { t } from "../i18n";
import {
  DEFAULT_EDGE_WIDTHS,
  EDGE_WIDTH_SCALE_RANGE,
  communityColor,
  typeColor,
} from "./palette";
import { checkboxRow, colourRow, sliderRow } from "./controls";
import { collectTypes } from "./visibility";
import { typeLabel } from "./labels";
import type { ColorMode, WikiGraph } from "../types";

/** Range of the 节点大小 slider. */
const NODE_SCALE_RANGE = { min: 0.5, max: 2, step: 0.05 } as const;
/**
 * Range of the gravity slider. Spans "let repulsion spread everything out" to
 * "pull it all into one tight ball"; measured to change the layout's
 * scale-invariant edge length by ~69%, so the whole range is useful.
 */
const GRAVITY_RANGE = { min: 0.16, max: 2.56, step: 0.02 } as const;

/** Label font size in pixels; wide enough to read a dense graph or a screenshot. */
const LABEL_SIZE_RANGE = { min: 8, max: 28, step: 1 } as const;
/**
 * Label opacity, as a multiplier: the slider shows 0…100%, and `sliderRow` reads a
 * percent slider as hundredths, so the stored value is the 0–1 the renderer wants.
 */
const LABEL_OPACITY_RANGE = { min: 0, max: 1, step: 0.05 } as const;
/** Range of each end of the edge width ramp. Wide on purpose: 0.2 … 12. */
const EDGE_WIDTH_RANGE = {
  min: EDGE_WIDTH_SCALE_RANGE.min,
  max: EDGE_WIDTH_SCALE_RANGE.max,
  step: 0.1,
} as const;

export interface AppearanceOptions {
  readonly graph: WikiGraph;
  readonly colorMode: ColorMode;
  readonly customNodeColor: string;
  readonly typeColorOverrides: Readonly<Record<string, string>>;
  readonly communityColorOverrides: Readonly<Record<string, string>>;
  readonly nodeScale: number;
  readonly gravity: number;
  /** `null` follows the theme. */
  readonly edgeWeakColor: string | null;
  readonly edgeStrongColor: string | null;
  readonly edgeWeakWidth: number;
  readonly edgeStrongWidth: number;
  readonly showLabels: boolean;
  /** Whether labels are dropped as their node shrinks below a size threshold. */
  readonly autoHideLabels: boolean;
  readonly labelSize: number;
  /**
   * Label opacity, 0–1. The colour is not a setting: white on the light theme,
   * black on the dark one — see `themePalette`.
   */
  readonly labelOpacity: number;
  readonly onColorMode: (mode: ColorMode) => void;
  readonly onCustomNodeColor: (color: string) => void;
  /** `null` clears the override and returns the type to the palette. */
  readonly onTypeColor: (type: string, color: string | null) => void;
  readonly onCommunityColor: (community: number, color: string | null) => void;
  readonly onNodeScale: (value: number) => void;
  readonly onGravity: (value: number) => void;
  /** Called continuously while the gravity slider is dragged. */
  readonly onGravityPreview: (value: number) => void;
  readonly onEdgeWeakColor: (color: string | null) => void;
  readonly onEdgeStrongColor: (color: string | null) => void;
  readonly onEdgeWeakWidth: (width: number) => void;
  readonly onEdgeStrongWidth: (width: number) => void;
  readonly onToggleLabels: (value: boolean) => void;
  readonly onAutoHideLabels: (value: boolean) => void;
  readonly onLabelSize: (value: number) => void;
  readonly onLabelOpacity: (value: number) => void;
}

/** Renders the appearance body after whatever the caller already put there. */
export function renderAppearance(container: HTMLElement, options: AppearanceOptions): void {
  renderNodes(container, options);
  renderEdges(container, options);

  const layout = container.createDiv({ cls: "enhanced-graph-section" });
  layout.createDiv({ cls: "enhanced-graph-section-title", text: t("appearance.layout") });
  sliderRow(layout, t("appearance.gravity"), GRAVITY_RANGE, options.gravity, options.onGravity, {
    number: true,
    // Live: the slider reports every step so the layout can follow the drag.
    onPreview: options.onGravityPreview,
  });
  renderLabels(layout, options);
}

/**
 * Label controls.
 *
 * `自动隐藏` is the switch for the behaviour that makes labels vanish while
 * zooming out: sigma skips any label whose node has shrunk below a size
 * threshold, so turning the switch off drops that threshold to zero.
 */
function renderLabels(section: HTMLElement, options: AppearanceOptions): void {
  section.createDiv({ cls: "enhanced-graph-subtitle", text: t("appearance.labels") });

  checkboxRow(section, t("appearance.showLabels"), options.showLabels, options.onToggleLabels);
  checkboxRow(
    section,
    t("appearance.autoHideLabels"),
    options.autoHideLabels,
    options.onAutoHideLabels,
  );

  sliderRow(
    section,
    t("appearance.labelSize"),
    LABEL_SIZE_RANGE,
    options.labelSize,
    options.onLabelSize,
    { unit: "px", number: true, onPreview: options.onLabelSize },
  );

  sliderRow(
    section,
    t("appearance.labelOpacity"),
    LABEL_OPACITY_RANGE,
    options.labelOpacity,
    options.onLabelOpacity,
    { unit: "%", number: true, onPreview: options.onLabelOpacity },
  );

  const hint = section.createDiv({ cls: "enhanced-graph-hint" });
  hint.setText(t("appearance.labelHint"));
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function renderNodes(container: HTMLElement, options: AppearanceOptions): void {
  const section = container.createDiv({ cls: "enhanced-graph-section" });
  section.createDiv({ cls: "enhanced-graph-section-title", text: t("appearance.nodes") });

  sliderRow(
    section,
    t("appearance.nodeScale"),
    NODE_SCALE_RANGE,
    options.nodeScale,
    options.onNodeScale,
    { number: true },
  );

  const modes: { mode: ColorMode; label: string }[] = [
    { mode: "type", label: t("appearance.colorByType") },
    { mode: "community", label: t("appearance.colorByCommunity") },
    { mode: "custom", label: t("appearance.colorSingle") },
  ];
  const row = section.createDiv({ cls: "enhanced-graph-segmented" });
  for (const entry of modes) {
    const button = row.createEl("button", { cls: "enhanced-graph-button", text: entry.label });
    if (entry.mode === options.colorMode) button.addClass("is-active");
    button.addEventListener("click", () => options.onColorMode(entry.mode));
  }

  if (options.colorMode === "custom") {
    colourRow(section, t("appearance.nodeColor"), options.customNodeColor, options.onCustomNodeColor);
    return;
  }

  if (options.colorMode === "community") {
    renderCommunityColors(section, options);
    return;
  }
  renderTypeColors(section, options);
}

/** One colour row per page type in the graph, pre-filled with the colour in force. */
function renderTypeColors(section: HTMLElement, options: AppearanceOptions): void {
  const heading = section.createDiv({ cls: "enhanced-graph-subtitle" });
  heading.createSpan({ text: t("appearance.perType") });

  // The types the vault declares. A custom type gets its own row and its own colour
  // (the palette's fallback ramp, hashed by name) — twenty custom types used to share
  // one row and one colour, since they all normalise to `other`.
  const types = collectTypes(options.graph.nodes);
  if (types.length === 0) {
    section.createDiv({ cls: "enhanced-graph-tag-empty", text: t("appearance.noTypes") });
    return;
  }

  for (const { key, label } of types) {
    const override = options.typeColorOverrides[key];
    const effective = override || typeColor(key);
    colourRow(
      section,
      typeLabel(key, label),
      effective,
      (color) => options.onTypeColor(key, color),
      { allowTheme: true, onTheme: () => options.onTypeColor(key, null), isTheme: !override },
    );
  }
}

/** One colour row per cluster actually present in the graph. */
function renderCommunityColors(section: HTMLElement, options: AppearanceOptions): void {
  const heading = section.createDiv({ cls: "enhanced-graph-subtitle" });
  heading.createSpan({ text: t("appearance.perCommunity") });

  const ids = [...new Set(options.graph.communities.map((community) => community.id))].sort(
    (a, b) => a - b,
  );
  if (ids.length === 0) {
    section.createDiv({ cls: "enhanced-graph-tag-empty", text: t("appearance.noCommunities") });
    return;
  }

  for (const id of ids) {
    const override = options.communityColorOverrides[String(id)];
    const effective = override || communityColor(id);
    const members = options.graph.communities.find((community) => community.id === id)?.nodeIds.length ?? 0;
    colourRow(
      section,
      `${t("legend.communities")} ${id} · ${members}`,
      effective,
      (color) => options.onCommunityColor(id, color),
      { allowTheme: true, onTheme: () => options.onCommunityColor(id, null), isTheme: !override },
    );
  }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function renderEdges(container: HTMLElement, options: AppearanceOptions): void {
  const section = container.createDiv({ cls: "enhanced-graph-section" });
  section.createDiv({ cls: "enhanced-graph-section-title", text: t("appearance.edges") });

  section.createDiv({ cls: "enhanced-graph-hint", text: t("appearance.edgeHint") });

  // Low weight end.
  section.createDiv({ cls: "enhanced-graph-subtitle", text: t("appearance.weightLow") });
  colourRow(
    section,
    t("appearance.edgeColor"),
    options.edgeWeakColor ?? t("appearance.themeColour"),
    (color) => options.onEdgeWeakColor(color),
    { allowTheme: true, onTheme: () => options.onEdgeWeakColor(null), isTheme: options.edgeWeakColor === null },
  );
  sliderRow(
    section,
    t("appearance.edgeWidth"),
    EDGE_WIDTH_RANGE,
    options.edgeWeakWidth,
    options.onEdgeWeakWidth,
    { unit: "", number: true, onPreview: options.onEdgeWeakWidth },
  );

  // High weight end.
  section.createDiv({ cls: "enhanced-graph-subtitle", text: t("appearance.weightHigh") });
  colourRow(
    section,
    t("appearance.edgeColor"),
    options.edgeStrongColor ?? t("appearance.themeColour"),
    (color) => options.onEdgeStrongColor(color),
    {
      allowTheme: true,
      onTheme: () => options.onEdgeStrongColor(null),
      isTheme: options.edgeStrongColor === null,
    },
  );
  sliderRow(
    section,
    t("appearance.edgeWidth"),
    EDGE_WIDTH_RANGE,
    options.edgeStrongWidth,
    options.onEdgeStrongWidth,
    { unit: "", number: true, onPreview: options.onEdgeStrongWidth },
  );

  const reset = section.createEl("button", { cls: "enhanced-graph-link", text: t("appearance.resetEdges") });
  reset.addEventListener("click", () => {
    options.onEdgeWeakColor(null);
    options.onEdgeStrongColor(null);
    options.onEdgeWeakWidth(DEFAULT_EDGE_WIDTHS.weakWidth);
    options.onEdgeStrongWidth(DEFAULT_EDGE_WIDTHS.strongWidth);
  });
}
