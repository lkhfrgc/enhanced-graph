/**
 * Colours, palettes and size maths for the graph view.
 *
 * Everything here is pure so the visual rules can be unit-tested without a
 * canvas.
 *
 * The colours are generated rather than hand-picked: each is defined as
 * (hue, chroma, lightness) in CIE LCh, converted to sRGB and then measured —
 * `npm run palette` prints the pairwise ΔE and the WCAG contrast of every
 * entry. Two properties are enforced because eyeballing hex values cannot
 * establish either:
 *
 *   - no two type colours are closer than ΔE 19, so eleven of them stay
 *     tellable apart on a canvas where each is only a few pixels wide;
 *   - every colour clears 3:1 against BOTH the dark and the light canvas,
 *     which one shared set of colours has to do since the themes only change
 *     the backdrop, not the nodes.
 *
 * The weight-based edge ramp (越弱越灰越细 / 越强越粗越亮，浅色主题反向) is the
 * enhancement this plugin adds.
 */

import type { ColorMode, PageType } from "../types";

/** Base radius of a degree-0 node, in graph units. */
export const BASE_NODE_SIZE = 8;
/** Radius of the highest-degree node, before density scaling and user scale. */
export const MAX_NODE_SIZE = 28;

export const NODE_TYPE_COLORS: Record<PageType, string> = {
  thesis: "#dd527d",
  source: "#e46352",
  overview: "#c9834c",
  finding: "#518f4e",
  methodology: "#3b9072",
  query: "#00a1ad",
  comparison: "#009fcb",
  entity: "#0088e2",
  concept: "#7e82e5",
  synthesis: "#bf66b6",
  other: "#7d8d9c",
};

/**
 * Twelve cluster colours at even 30° hue steps; index = community id % 12.
 *
 * Deliberately uniform in lightness and chroma. Alternating them (the obvious
 * way to separate neighbours) was measured and made things WORSE — the worst
 * pair tightened from ΔE 17.8 to 15.0, because half the ring moved inward.
 */
export const COMMUNITY_COLORS: readonly string[] = [
  "#cd657d",
  "#c96c59",
  "#b37a3f",
  "#938737",
  "#6a9147",
  "#319768",
  "#009a90",
  "#0098b4",
  "#0092cd",
  "#5687d2",
  "#9778c3",
  "#bd6aa4",
];

/** Used when a page type is not in the canonical set. */
const FALLBACK_TYPE_COLORS = [
  "#cb6569", "#bd8147", "#7e8a3a", "#3d9f6e",
  "#00979f", "#009ad4", "#757eca", "#c573ad",
];

export function communityColor(community: number): string {
  if (!Number.isFinite(community) || community < 0) return NODE_TYPE_COLORS.other;
  return COMMUNITY_COLORS[community % COMMUNITY_COLORS.length];
}

export function typeColor(type: string): string {
  if (Object.prototype.hasOwnProperty.call(NODE_TYPE_COLORS, type)) {
    return NODE_TYPE_COLORS[type as PageType];
  }
  let hash = 0;
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_TYPE_COLORS[hash % FALLBACK_TYPE_COLORS.length];
}

/**
 * The node colour for the active mode — one place so the renderer, the legend
 * and the official-graph overlay cannot drift apart.
 *
 * Per-type and per-community overrides are consulted first, but only in the
 * mode they belong to: a type colour has no meaning while colouring by cluster.
 * An empty string counts as "no override" so a cleared input falls back rather
 * than rendering an invisible node.
 */
export function nodeColorForMode(input: {
  readonly colorMode: ColorMode;
  readonly pageType: string;
  readonly community: number;
  readonly customColor: string;
  readonly typeOverrides?: Readonly<Record<string, string>>;
  readonly communityOverrides?: Readonly<Record<number, string>>;
}): string {
  if (input.colorMode === "custom") return input.customColor;

  if (input.colorMode === "community") {
    const override = input.communityOverrides?.[input.community];
    return override || communityColor(input.community);
  }

  const override = input.typeOverrides?.[input.pageType];
  return override || typeColor(input.pageType);
}

// ---------------------------------------------------------------------------
// Edge ramp: the weaker the link, the grayer and thinner; the stronger, the
// thicker and brighter — inverted in the light theme, where "stronger" means
// darker rather than brighter.
// ---------------------------------------------------------------------------

/**
 * The two ends of the weight ramp. Theme-dependent, because the same weight has
 * to read as "bright" on a dark canvas and as "dark" on a light one.
 */
export interface EdgeRamp {
  readonly weak: string;
  readonly strong: string;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "").trim();
  const full =
    normalized.length === 3
      ? normalized.split("").map((c) => c + c).join("")
      : normalized.padEnd(6, "0").slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

/** Pack a hex colour into the `0xRRGGBB` integer Obsidian's graph view uses. */
export function hexToRgbInt(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

/** Per-channel linear interpolation between two hex colours. */
export function mixColor(from: string, to: string, ratio: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = clamp01(ratio);
  const channel = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/**
 * Map a normalised association weight (0…1) onto a weak→strong ramp.
 * Returns a hex colour; alpha is applied separately so the reducer can dim
 * an edge without losing its strength.
 */
export function edgeColorForWeight(normalizedWeight: number, ramp: EdgeRamp): string {
  return mixColor(ramp.weak, ramp.strong, clamp01(normalizedWeight));
}

/**
 * Apply the user's strong-end colour, if they picked one.
 *
 * Only the strong end moves: the weak end stays the theme's gray, so the
 * "weak = gray and thin" reading — and the direction of the ramp — survive
 * whatever colour is chosen. `null` means "follow the theme", and returns the
 * theme ramp by identity so callers can compare cheaply.
 */
export function resolveEdgeRamp(theme: EdgeRamp, strongOverride: string | null): EdgeRamp {
  if (!strongOverride) return theme;
  return { weak: theme.weak, strong: strongOverride };
}

/**
 * Strong-end colours offered in the appearance panel.
 *
 * Deliberately mid-tone hues that stay legible on both a dark and a light
 * canvas — a preset has to be predictable, and white would vanish on the light
 * theme. `color: null` is the theme default.
 */
export const EDGE_STRONG_PRESETS: readonly { id: string; color: string | null }[] = [
  { id: "theme", color: null },
  { id: "blue", color: "#009cc8" },
  { id: "green", color: "#599a56" },
  { id: "orange", color: "#d36f5f" },
  { id: "purple", color: "#8384d4" },
  { id: "red", color: "#d66986" },
  { id: "teal", color: "#009f7f" },
];

/**
 * The full edge look: a colour *and* a width at each end of the weight range.
 *
 * Both ends are explicit so the middle needs no configuration — it is a linear
 * interpolation. `weak`/`strong` come from `EdgeRamp` so the colour maths stays
 * shared with the theme default.
 */
export interface EdgeStyle extends EdgeRamp {
  /** Width at normalizedWeight 0. */
  readonly weakWidth: number;
  /** Width at normalizedWeight 1. */
  readonly strongWidth: number;
}

/** Allowed width at either end of the weight range, in graph units. */
export const EDGE_WIDTH_SCALE_RANGE = { min: 0.2, max: 12 } as const;

/** Widths the reference implementation uses, and what "reset" restores. */
export const DEFAULT_EDGE_WIDTHS = { weakWidth: 0.5, strongWidth: 4 } as const;

export interface EdgeStyleOverrides {
  /** `null` follows the theme. */
  readonly weakColor: string | null;
  /** `null` follows the theme. */
  readonly strongColor: string | null;
  readonly weakWidth: number;
  readonly strongWidth: number;
}

function clampWidth(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(EDGE_WIDTH_SCALE_RANGE.max, Math.max(EDGE_WIDTH_SCALE_RANGE.min, value));
}

/**
 * Combine the theme's colours with the user's explicit ends.
 *
 * Either colour may be left on the theme independently, which is what makes it
 * possible to recolour only the strong end — the common case — without losing
 * the theme-aware weak end.
 */
export function resolveEdgeStyle(theme: EdgeRamp, overrides: EdgeStyleOverrides): EdgeStyle {
  return {
    weak: overrides.weakColor ?? theme.weak,
    strong: overrides.strongColor ?? theme.strong,
    weakWidth: clampWidth(overrides.weakWidth, DEFAULT_EDGE_WIDTHS.weakWidth),
    strongWidth: clampWidth(overrides.strongWidth, DEFAULT_EDGE_WIDTHS.strongWidth),
  };
}

/**
 * Width for a normalized weight: the two configured ends, interpolated.
 *
 * Takes only the widths, so the graph can be built with the reference widths
 * and the reducer can re-derive the real ones per frame.
 *
 * The ends are independent, so a ramp that gets *thinner* with weight is
 * expressible; the interpolation does not assume an order.
 */
export function edgeWidthForWeight(
  normalizedWeight: number,
  widths: { readonly weakWidth: number; readonly strongWidth: number },
): number {
  const t = clamp01(normalizedWeight);
  return widths.weakWidth + (widths.strongWidth - widths.weakWidth) * t;
}

/** Alpha ramp: weak edges are near-invisible, strong edges fully opaque. */
export function edgeAlphaForWeight(normalizedWeight: number): number {
  return 0.22 + clamp01(normalizedWeight) * 0.68;
}

// ---------------------------------------------------------------------------
// Node size
// ---------------------------------------------------------------------------

/** Shrink nodes on very large graphs so the canvas stays readable. */
export function graphDensityScale(nodeCount: number): number {
  if (nodeCount <= 150) return 1;
  return Math.max(0.35, Math.sqrt(150 / nodeCount));
}

/**
 * √ scaling: visual area grows roughly linearly with the link count, which
 * keeps a 100-link hub from dwarfing everything else.
 */
export function nodeSize(
  linkCount: number,
  maxLinks: number,
  nodeCount: number,
  userScale = 1,
): number {
  if (maxLinks <= 0) return BASE_NODE_SIZE * graphDensityScale(nodeCount) * userScale;
  const ratio = Math.max(0, linkCount) / maxLinks;
  const size = BASE_NODE_SIZE + Math.sqrt(ratio) * (MAX_NODE_SIZE - BASE_NODE_SIZE);
  return size * graphDensityScale(nodeCount) * userScale;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface GraphThemePalette {
  /** Default edge colour before per-edge styling is applied. */
  readonly defaultEdge: string;
  /** Weak→strong edge ramp; inverted between the two themes. */
  readonly edgeRamp: EdgeRamp;
  readonly label: string;
  readonly hoverLabelText: string;
  readonly hoverLabelBackground: string;
  readonly hoverLabelBorder: string;
  readonly hoverLabelShadow: string;
  /** Where dimmed node colours are mixed toward. */
  readonly mutedNodeMixTarget: string;
  readonly mutedNodeMixRatio: number;
  readonly tooltipBackground: string;
  readonly tooltipBorder: string;
  readonly tooltipText: string;
  readonly tooltipMuted: string;
  readonly panelBackground: string;
  readonly panelBorder: string;
  readonly accent: string;
  readonly warning: string;
  /** Ring drawn around a node the user explicitly focused. */
  readonly markerRing: string;
  /** Darker ring behind {@link markerRing}, so the marker reads on any node colour. */
  readonly markerRingHalo: string;
}

/**
 * The canvas chrome, not the identity palette.
 *
 * The neutral ramp is anchored on `#7d8d9c` — the same value as the `other`
 * page type — so the chrome and the nodes share one grey rather than each
 * carrying its own.
 */
export function themePalette(isDark: boolean): GraphThemePalette {
  return isDark
    ? {
        defaultEdge: "rgba(125,141,156,0.16)",
        // Dim ink → near-white: the stronger the link, the brighter it burns
        // against the dark canvas.
        edgeRamp: { weak: "#3c4b57", strong: "#f4f8fa" },
        // White ink on the dark theme, black on the light one — the theme decides
        // the colour, and the appearance panel's opacity slider decides how loudly
        // the labels sit on top of it. Labels are drawn INSIDE the node by sigma,
        // so what they read against is the node's fill; a saturated mid-tone takes
        // either ink, which is what leaves opacity as the thing worth tuning.
        label: "#ffffff",
        hoverLabelText: "#f4f8fa",
        hoverLabelBackground: "rgba(10,20,28,0.94)",
        hoverLabelBorder: "rgba(169,183,193,0.36)",
        hoverLabelShadow: "rgba(4,10,15,0.55)",
        mutedNodeMixTarget: "#1f2d38",
        mutedNodeMixRatio: 0.78,
        tooltipBackground: "rgba(10,20,28,0.97)",
        tooltipBorder: "rgba(169,183,193,0.34)",
        tooltipText: "#eef3f6",
        tooltipMuted: "#a9b7c1",
        panelBackground: "rgba(10,20,28,0.86)",
        panelBorder: "rgba(169,183,193,0.26)",
        accent: "#35a7dd",
        warning: "#d9a441",
        markerRing: "#f4f8fa",
        markerRingHalo: "rgba(4,10,15,0.85)",
      }
    : {
        defaultEdge: "#b9c6ce",
        // Inverted: on a white page "stronger" has to mean *darker*, so the
        // ramp runs mid-gray → near-black.
        edgeRamp: { weak: "#8fa0ad", strong: "#0a141c" },
        // Black here; see the note on the dark theme's `label`.
        label: "#000000",
        hoverLabelText: "#0a141c",
        // A light-theme overlay is white; there is no other value for it. The
        // neutral ramp around it is what changed.
        hoverLabelBackground: "rgba(255,255,255,0.97)",
        hoverLabelBorder: "rgba(10,20,28,0.14)",
        hoverLabelShadow: "rgba(10,20,28,0.18)",
        mutedNodeMixTarget: "#dfe7ec",
        mutedNodeMixRatio: 0.78,
        tooltipBackground: "rgba(255,255,255,0.97)",
        tooltipBorder: "rgba(10,20,28,0.16)",
        tooltipText: "#0a141c",
        tooltipMuted: "#5c6b76",
        panelBackground: "rgba(255,255,255,0.9)",
        panelBorder: "rgba(10,20,28,0.12)",
        accent: "#0b6f9c",
        warning: "#8a5a12",
        markerRing: "#0a141c",
        markerRingHalo: "rgba(255,255,255,0.95)",
      };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
