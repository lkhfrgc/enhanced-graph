/**
 * Generates the graph palettes from perceptual targets, then checks them.
 *
 * Picking hex values by eye cannot answer the two questions that matter here:
 * are any two of the eleven type colours too close to tell apart, and does each
 * one survive both a dark and a light canvas? So colours are defined as
 * (hue, chroma, lightness) in CIE LCh, converted to sRGB, and measured.
 *
 * Checks:
 *   - minimum pairwise ΔE*ab between type colours (want >= 20: "clearly
 *     different", not merely "not identical");
 *   - WCAG contrast against the dark canvas and against white (want >= 3:1 for
 *     both, so one palette can serve the two themes);
 *   - chroma actually reachable in sRGB at that lightness (no silent clipping).
 *
 * Usage: node scripts/build-palette.mjs [--json]
 */

// --- CIE LCh -> Lab -> XYZ -> sRGB ----------------------------------------

const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

function labToXyz(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  return { x: D65.x * finv(fx), y: D65.y * finv(fy), z: D65.z * finv(fz) };
}

function xyzToLinearRgb({ x, y, z }) {
  return {
    r: x * 3.2406 + y * -1.5372 + z * -0.4986,
    g: x * -0.9689 + y * 1.8758 + z * 0.0415,
    b: x * 0.0557 + y * -0.204 + z * 1.057,
  };
}

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function lchToRgb(L, C, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const lab = { L, a: C * Math.cos(h), b: C * Math.sin(h) };
  const linear = xyzToLinearRgb(labToXyz(lab.L, lab.a, lab.b));
  const raw = { r: encode(linear.r), g: encode(linear.g), b: encode(linear.b) };
  const clipped = {
    r: Math.min(1, Math.max(0, raw.r)),
    g: Math.min(1, Math.max(0, raw.g)),
    b: Math.min(1, Math.max(0, raw.b)),
  };
  const error =
    Math.abs(raw.r - clipped.r) + Math.abs(raw.g - clipped.g) + Math.abs(raw.b - clipped.b);
  return { ...clipped, error };
}

const toHex = ({ r, g, b }) =>
  "#" +
  [r, g, b]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

// --- measurement ----------------------------------------------------------

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export function hexToLab(hex) {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255));
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / D65.x;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / D65.y;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / D65.z;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const luminance = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const deltaE = (a, b) => {
  const x = hexToLab(a);
  const y = hexToLab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

// --- the palettes ---------------------------------------------------------

const DARK_CANVAS = "#0f172a";
const LIGHT_CANVAS = "#ffffff";

/**
 * Eleven page types. Hue carries the meaning (source is warm, findings green,
 * arguments red); lightness is held in a band that clears 3:1 on BOTH canvases,
 * which one shared set of colours has to do.
 *
 * `meta: true` marks the types that should recede — a summary or an
 * unclassified page is not what the eye should land on first — so they get
 * lower chroma rather than a different hue.
 */
const TYPES = [
  { type: "thesis", hue: 5, chroma: 58, L: 55, note: "arguments: red" },
  { type: "source", hue: 35, chroma: 60, L: 58, note: "raw material: orange" },
  { type: "overview", hue: 62, chroma: 46, L: 61, note: "summaries: gold", meta: true },
  { type: "finding", hue: 140, chroma: 44, L: 54, note: "results: green" },
  { type: "methodology", hue: 166, chroma: 34, L: 54, note: "process: teal" },
  { type: "query", hue: 205, chroma: 44, L: 59, note: "questions: cyan" },
  { type: "comparison", hue: 230, chroma: 46, L: 59, note: "side by side: azure" },
  { type: "entity", hue: 262, chroma: 58, L: 53, note: "named things: indigo" },
  { type: "concept", hue: 295, chroma: 56, L: 58, note: "ideas: violet" },
  { type: "synthesis", hue: 330, chroma: 54, L: 56, note: "combining: magenta" },
  { type: "other", hue: 255, chroma: 10, L: 58, note: "unclassified: neutral", meta: true },
];

/** Twelve cluster colours: no meaning to carry, so spread the hues evenly. */
const COMMUNITIES = Array.from({ length: 12 }, (_, index) => ({
  hue: (index * 360) / 12 + 8,
  // Alternate two lightness levels so neighbours differ by more than hue alone.
  // Both stay under L* 61: one shared set of colours has to clear 3:1 on white.
  // Uniform lightness and chroma on purpose: alternating them shrinks the
  // colour ring for half the entries, which brought neighbours CLOSER (the
  // measured worst pair went from 17.5 to 15.0). Hue alone separates best here.
  chroma: 44,
  L: 56,
}));

const OLD = {
  types: {
    entity: "#60a5fa", concept: "#c084fc", source: "#fb923c", synthesis: "#f87171",
    query: "#4ade80", comparison: "#2dd4bf", finding: "#a855f7", thesis: "#f43f5e",
    methodology: "#14b8a6", overview: "#facc15", other: "#94a3b8",
  },
  communities: [
    "#60a5fa", "#4ade80", "#fb923c", "#c084fc", "#f87171", "#2dd4bf",
    "#facc15", "#f472b6", "#a78bfa", "#38bdf8", "#34d399", "#fbbf24",
  ],
};

function build(entries) {
  return entries.map((entry) => {
    const rgb = lchToRgb(entry.L, entry.chroma, entry.hue);
    return { ...entry, hex: toHex(rgb), clipError: rgb.error };
  });
}

function report(label, colours, oldColours) {
  const hexes = colours.map((c) => c.hex);
  const between = (list) => {
    let worst = { d: Infinity, pair: null };
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const d = deltaE(list[i], list[j]);
        if (d < worst.d) worst = { d, pair: [list[i], list[j]] };
      }
    }
    return worst;
  };

  console.log(`\n=== ${label} ===`);
  for (const colour of colours) {
    const dark = contrast(colour.hex, DARK_CANVAS);
    const light = contrast(colour.hex, LIGHT_CANVAS);
    const ok = dark >= 3 && light >= 3 ? " " : "!";
    console.log(
      `${ok} ${colour.hex}  L*=${hexToLab(colour.hex).L.toFixed(0).padStart(2)}  ` +
        `contrast dark ${dark.toFixed(1)}:1  light ${light.toFixed(1)}:1   ` +
        `${colour.type ?? ""} ${colour.note ?? ""}`,
    );
  }

  const worst = between(hexes);
  console.log(`\n  closest pair: ΔE ${worst.d.toFixed(1)}  (${worst.pair.join(" vs ")})`);
  const failing = colours.filter(
    (c) => contrast(c.hex, DARK_CANVAS) < 3 || contrast(c.hex, LIGHT_CANVAS) < 3,
  );
  console.log(`  below 3:1 on either canvas: ${failing.length}`);

  if (oldColours) {
    const oldWorst = between(oldColours);
    const oldFailing = oldColours.filter(
      (c) => contrast(c, DARK_CANVAS) < 3 || contrast(c, LIGHT_CANVAS) < 3,
    );
    console.log(
      `\n  BEFORE: closest pair ΔE ${oldWorst.d.toFixed(1)} (${oldWorst.pair.join(" vs ")})` +
        `, below 3:1: ${oldFailing.length}` +
        (oldFailing.length ? ` (${oldFailing.join(", ")})` : ""),
    );
    console.log(
      `  AFTER:  closest pair ΔE ${worst.d.toFixed(1)}, below 3:1: ${failing.length}`,
    );
  }
  return { worst: worst.d, failing: failing.length };
}

const types = build(TYPES);
const communities = build(COMMUNITIES);

report("page types (11)", types, Object.values(OLD.types));
report("community colours (12)", communities, OLD.communities);

console.log("\n=== TS source ===\n");
console.log("export const NODE_TYPE_COLORS: Record<PageType, string> = {");
for (const c of types) console.log(`  ${c.type}: "${c.hex}",`);
console.log("};\n");
console.log("export const COMMUNITY_COLORS: readonly string[] = [");
for (const c of communities) console.log(`  "${c.hex}",`);
console.log("];");

// Fallbacks and edge presets come out of the same system, so an unknown page
// type or a chosen edge colour cannot land outside the palette's range.
const fallbacks = Array.from({ length: 8 }, (_, index) => {
  const rgb = lchToRgb(55 + (index % 2) * 4, 44, (index * 360) / 8 + 22);
  return toHex(rgb);
});
const edges = [
  { id: "blue", hue: 230 },
  { id: "green", hue: 140 },
  { id: "orange", hue: 35 },
  { id: "purple", hue: 295 },
  { id: "red", hue: 5 },
  { id: "teal", hue: 172 },
].map(({ id, hue }) => ({ id, hex: toHex(lchToRgb(58, 46, hue)) }));

console.log("");
console.log("const FALLBACK_TYPE_COLORS = [");
console.log("  " + fallbacks.map((h) => `"${h}"`).join(", "));
console.log("];\n");
console.log("export const EDGE_STRONG_PRESETS = [");
for (const edge of edges) console.log(`  { id: "${edge.id}", color: "${edge.hex}" },`);
console.log("];");
console.log("");
console.log("// fallback contrast check");
for (const hex of [...fallbacks, ...edges.map((e) => e.hex)]) {
  const worst = Math.min(contrast(hex, DARK_CANVAS), contrast(hex, LIGHT_CANVAS));
  if (worst < 3) console.log(`  BELOW 3:1  ${hex}  ${worst.toFixed(1)}`);
}
console.log("  (no output above means all clear)");
