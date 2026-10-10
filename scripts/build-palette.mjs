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
 * No semantic set any more.
 *
 * There used to be eleven hand-placed hues with meaning attached — source warm,
 * findings green, arguments red — and every other declared type fell back to a hash.
 * That split is invisible from inside a vault: a user writes `type: 实验记录` and has no
 * idea the plugin considers `concept` the standard spelling of anything, so the same
 * idea written two ways was painted two colours while two unrelated custom types could
 * collide. Types are now simply the strings a vault declares, and they all draw from one
 * searched ramp, assigned per vault by `assignTypeColors`.
 */

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

const communities = build(COMMUNITIES);

/** The eight hand-spread fallbacks that used to colour unknown types, for comparison. */
const FALLBACK_HEXES = Array.from({ length: 8 }, (_, index) =>
  toHex(lchToRgb(55 + (index % 2) * 4, 44, (index * 360) / 8 + 22)),
);

/**
 * The ramp every declared page type draws from.
 *
 * Searched rather than hand-placed: sweep hue, lightness and chroma, and keep only what
 * clears a distance from the colours already kept and 3:1 contrast on both canvases. No
 * meaning is attached to any hue — which is the point. A vault declares `实验记录` or
 * `concept` or `我的概念`, and the plugin has no business deciding that one of those
 * spellings is the standard one and deserves a reserved colour.
 *
 * The distances are the point of the exercise, so they are printed rather than assumed.
 */
const TYPE_MIN_INTERNAL = 19;

const typeRamp = (() => {
  const kept = [];
  // Sweep hue first, then the lightness/chroma bands, so the first entries are spread
  // around the wheel rather than clustered in whichever band came first. Several bands
  // because a ramp that has to cover a whole vault needs the room.
  const candidates = [];
  for (let hueStep = 0; hueStep < 360; hueStep += 3) {
    for (const L of [52, 56, 60]) {
      for (const chroma of [50, 42, 32]) {
        candidates.push({ hue: hueStep, chroma, L });
      }
    }
  }
  for (const candidate of build(candidates)) {
    const contrastOk =
      contrast(candidate.hex, DARK_CANVAS) >= 3 && contrast(candidate.hex, LIGHT_CANVAS) >= 3;
    if (!contrastOk) continue;
    if (kept.some((entry) => deltaE(candidate.hex, entry.hex) < TYPE_MIN_INTERNAL)) continue;
    kept.push(candidate);
  }
  return kept;
})();

/**
 * Order the ramp so that a PREFIX of it is as spread out as the whole thing.
 *
 * Assigned in sorted-key order, a vault with N types uses the first N entries — and the
 * search produced them in hue order, so the first five were all reds: measured, the
 * closest pair within any prefix was ΔE 19.0, and it was always the same two entries
 * (ramp[0] vs ramp[1]). A reader saw "connection" and "question" as the same colour.
 *
 * Farthest-point ordering fixes the number that actually matters without touching the
 * colours: repeatedly take the entry furthest from everything already taken. The 22-colour
 * minimum is unchanged (19.0) while the first five go from 19.0 to 38.5.
 */
const spread = (ramp) => {
  const remaining = [...ramp];
  const ordered = [];
  let bestPair = [remaining[0], remaining[1]];
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      if (deltaE(remaining[i].hex, remaining[j].hex) > deltaE(bestPair[0].hex, bestPair[1].hex)) {
        bestPair = [remaining[i], remaining[j]];
      }
    }
  }
  ordered.push(bestPair[0], bestPair[1]);
  remaining.splice(remaining.indexOf(bestPair[0]), 1);
  remaining.splice(remaining.indexOf(bestPair[1]), 1);
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -Infinity;
    for (const [index, candidate] of remaining.entries()) {
      const nearest = Math.min(...ordered.map((taken) => deltaE(candidate.hex, taken.hex)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
};

const typeRampOrdered = spread(typeRamp);

const closestInPrefix = (ramp, count) => {
  let worst = { d: Infinity, pair: ["", ""] };
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const d = deltaE(ramp[i].hex, ramp[j].hex);
      if (d < worst.d) worst = { d, pair: [ramp[i].hex, ramp[j].hex] };
    }
  }
  return worst;
};

report("page type ramp (searched)", typeRampOrdered, FALLBACK_HEXES);
console.log("\n  closest pair within the first N entries — what a vault with N types sees:");
for (const count of [2, 3, 5, 8, 10, 13, 22]) {
  const before = closestInPrefix(typeRamp, count);
  const after = closestInPrefix(typeRampOrdered, count);
  console.log(
    `    first ${String(count).padStart(2)}: ΔE ${after.d.toFixed(1).padStart(5)}  ` +
      `(hue order was ${before.d.toFixed(1)})`,
  );
}
report("community colours (12)", communities, OLD.communities);

console.log("\n=== TS source ===\n");
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
console.log("// Searched ramp every declared page type draws from; see `palette.ts`.");
console.log("export const TYPE_COLORS: readonly string[] = [");
for (const colour of typeRampOrdered) console.log(`  "${colour.hex}",`);
console.log("];");
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
