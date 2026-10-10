/**
 * Specification for the edge strength ramp.
 *
 * The requested look: **the weaker the link, the grayer and thinner; the
 * stronger, the thicker and whiter** — and in the light theme the colour
 * direction inverts, so a strong link goes dark instead of bright.
 *
 * Written before the implementation. Edge colours previously went gray → green;
 * these tests pin the new ramp and, importantly, pin it as a property of the
 * *theme*, since the same weight must render bright on dark and dark on light.
 */

import { describe, expect, it } from "vitest";

import {
  TYPE_COLORS,
  COMMUNITY_COLORS,
  DEFAULT_EDGE_WIDTHS,
  EDGE_STRONG_PRESETS,
  EDGE_WIDTH_SCALE_RANGE,
  assignTypeColors,
  resolveTypeColors,
  edgeAlphaForWeight,
  edgeColorForWeight,
  edgeWidthForWeight,
  hexToRgb,
  nodeColorForMode,
  resolveEdgeRamp,
  resolveEdgeStyle,
  themePalette,
  type EdgeRamp,
  type EdgeStyle,
} from "../src/view/palette";

/** Rec. 709 relative luminance, 0 (black) … 255 (white). */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far a colour is from neutral gray, 0 = perfectly achromatic. */
function chroma(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const DARK = themePalette(true).edgeRamp;
const LIGHT = themePalette(false).edgeRamp;

/**
 * Threshold for "reads as gray".
 *
 * Not zero: the whole palette is slate-tinted (labels `#94a3b8`, borders
 * `rgba(148,163,184,…)`, the muted-node target `#334155`), and slate-600
 * `#475569` has a chroma of 34 — a cool gray, deliberately, rather than a
 * neutral one that would look out of place next to the rest of the UI.
 */
const GRAY_CHROMA = 40;

function rampValues(ramp: EdgeRamp, steps = 11): number[] {
  return Array.from({ length: steps }, (_, index) => luminance(edgeColorForWeight(index / (steps - 1), ramp)));
}

describe("the dark theme ramp", () => {
  it("sends strong links toward white", () => {
    const strong = edgeColorForWeight(1, DARK);
    expect(luminance(strong)).toBeGreaterThan(230);
    expect(chroma(strong)).toBeLessThan(GRAY_CHROMA);
  });

  it("keeps weak links a neutral gray", () => {
    const weak = edgeColorForWeight(0, DARK);
    expect(chroma(weak)).toBeLessThan(GRAY_CHROMA);
    expect(luminance(weak)).toBeGreaterThan(50);
    expect(luminance(weak)).toBeLessThan(150);
  });

  it("gets monotonically brighter with weight", () => {
    const values = rampValues(DARK);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
    expect(values[values.length - 1] - values[0]).toBeGreaterThan(60);
  });

  it("spans a wide brightness range end to end", () => {
    // A ramp that barely moves would satisfy monotonicity and look like mush.
    expect(luminance(edgeColorForWeight(1, DARK)) - luminance(edgeColorForWeight(0, DARK))).toBeGreaterThan(80);
  });
});

describe("the light theme ramp", () => {
  it("inverts: strong links go dark", () => {
    const strong = edgeColorForWeight(1, LIGHT);
    expect(luminance(strong)).toBeLessThan(40);
    expect(chroma(strong)).toBeLessThan(GRAY_CHROMA);
  });

  it("gets monotonically darker with weight", () => {
    const values = rampValues(LIGHT);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
    expect(values[0] - values[values.length - 1]).toBeGreaterThan(60);
  });

  it("keeps weak links visible against a white page", () => {
    const weak = edgeColorForWeight(0, LIGHT);
    expect(luminance(weak)).toBeGreaterThan(80);
    expect(luminance(weak)).toBeLessThan(200);
  });

  it("runs in the opposite direction to the dark theme", () => {
    expect(luminance(edgeColorForWeight(1, DARK))).toBeGreaterThan(luminance(edgeColorForWeight(0, DARK)));
    expect(luminance(edgeColorForWeight(1, LIGHT))).toBeLessThan(luminance(edgeColorForWeight(0, LIGHT)));
  });
});

describe("edgeColorForWeight", () => {
  it("returns the exact endpoint colours at the extremes", () => {
    expect(edgeColorForWeight(0, DARK)).toBe(DARK.weak);
    expect(edgeColorForWeight(1, DARK)).toBe(DARK.strong);
    expect(edgeColorForWeight(0, LIGHT)).toBe(LIGHT.weak);
    expect(edgeColorForWeight(1, LIGHT)).toBe(LIGHT.strong);
  });

  it("clamps out-of-range and non-finite weights", () => {
    expect(edgeColorForWeight(-5, DARK)).toBe(DARK.weak);
    expect(edgeColorForWeight(5, DARK)).toBe(DARK.strong);
    expect(edgeColorForWeight(Number.NaN, DARK)).toBe(DARK.weak);
  });

  it("is grayscale on both ends of both themes", () => {
    for (const ramp of [DARK, LIGHT]) {
      expect(chroma(edgeColorForWeight(0, ramp))).toBeLessThan(GRAY_CHROMA);
      expect(chroma(edgeColorForWeight(1, ramp))).toBeLessThan(GRAY_CHROMA);
    }
  });
});

describe("width and alpha", () => {
  const reference: EdgeStyle = {
    weak: "#000000",
    strong: "#ffffff",
    weakWidth: DEFAULT_EDGE_WIDTHS.weakWidth,
    strongWidth: DEFAULT_EDGE_WIDTHS.strongWidth,
  };

  it("hits the reference widths at the ends by default", () => {
    expect(edgeWidthForWeight(0, reference)).toBeCloseTo(0.5, 5);
    expect(edgeWidthForWeight(1, reference)).toBeCloseTo(4, 5);
  });

  it("grows the alpha with weight", () => {
    expect(edgeAlphaForWeight(0)).toBeLessThan(edgeAlphaForWeight(1));
  });

  it("stays monotonic across the whole range", () => {
    for (let i = 1; i <= 10; i += 1) {
      expect(edgeWidthForWeight(i / 10, reference)).toBeGreaterThan(
        edgeWidthForWeight((i - 1) / 10, reference),
      );
      expect(edgeAlphaForWeight(i / 10)).toBeGreaterThan(edgeAlphaForWeight((i - 1) / 10));
    }
  });
});

describe("resolveEdgeRamp", () => {
  it("returns the theme ramp untouched when nothing is overridden", () => {
    expect(resolveEdgeRamp(DARK, null)).toBe(DARK);
    expect(resolveEdgeRamp(LIGHT, null)).toBe(LIGHT);
  });

  it("keeps the weak end from the theme and takes the strong end from the override", () => {
    const custom = resolveEdgeRamp(DARK, "#38bdf8");
    expect(custom.weak).toBe(DARK.weak);
    expect(custom.strong).toBe("#38bdf8");
  });

  it("applies the override in both themes, so the choice is predictable", () => {
    expect(resolveEdgeRamp(LIGHT, "#38bdf8").strong).toBe("#38bdf8");
    expect(resolveEdgeRamp(LIGHT, "#38bdf8").weak).toBe(LIGHT.weak);
  });

  it("still produces a monotonic ramp once overridden", () => {
    const ramp = resolveEdgeRamp(DARK, "#38bdf8");
    const values = [0, 0.25, 0.5, 0.75, 1].map((nw) => luminance(edgeColorForWeight(nw, ramp)));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });
});

describe("EDGE_STRONG_PRESETS", () => {
  it("offers a theme default plus several explicit colours", () => {
    expect(EDGE_STRONG_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(EDGE_STRONG_PRESETS.some((preset) => preset.color === null)).toBe(true);
    expect(EDGE_STRONG_PRESETS.filter((preset) => preset.color !== null).length).toBeGreaterThanOrEqual(4);
  });

  it("only contains valid, actually coloured hex values", () => {
    for (const preset of EDGE_STRONG_PRESETS) {
      if (preset.color === null) continue;
      expect(preset.color).toMatch(/^#[0-9a-f]{6}$/i);
      // A preset should be a colour, not another gray.
      expect(chroma(preset.color)).toBeGreaterThan(40);
    }
  });

  it("gives every preset a distinct id", () => {
    const ids = EDGE_STRONG_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveEdgeStyle", () => {
  const overrides = { weakColor: null, strongColor: null, weakWidth: 0.5, strongWidth: 4 };

  it("follows the theme when neither colour is overridden", () => {
    const style = resolveEdgeStyle(DARK, overrides);
    expect(style.weak).toBe(DARK.weak);
    expect(style.strong).toBe(DARK.strong);
  });

  it("overrides either end independently", () => {
    const onlyStrong = resolveEdgeStyle(DARK, { ...overrides, strongColor: "#38bdf8" });
    expect(onlyStrong.weak).toBe(DARK.weak);
    expect(onlyStrong.strong).toBe("#38bdf8");

    const onlyWeak = resolveEdgeStyle(DARK, { ...overrides, weakColor: "#123456" });
    expect(onlyWeak.weak).toBe("#123456");
    expect(onlyWeak.strong).toBe(DARK.strong);
  });

  it("carries the widths through unchanged when they are in range", () => {
    const style = resolveEdgeStyle(DARK, { ...overrides, weakWidth: 1.5, strongWidth: 9 });
    expect(style.weakWidth).toBe(1.5);
    expect(style.strongWidth).toBe(9);
  });

  it("clamps widths to the allowed range", () => {
    const style = resolveEdgeStyle(DARK, { ...overrides, weakWidth: -3, strongWidth: 999 });
    expect(style.weakWidth).toBe(EDGE_WIDTH_SCALE_RANGE.min);
    expect(style.strongWidth).toBe(EDGE_WIDTH_SCALE_RANGE.max);
  });

  it("falls back to the default widths for non-finite input", () => {
    const style = resolveEdgeStyle(DARK, { ...overrides, weakWidth: Number.NaN, strongWidth: Number.NaN });
    expect(style.weakWidth).toBe(DEFAULT_EDGE_WIDTHS.weakWidth);
    expect(style.strongWidth).toBe(DEFAULT_EDGE_WIDTHS.strongWidth);
  });
});

describe("edgeWidthForWeight with per-end widths", () => {
  const style = { weak: "#000000", strong: "#ffffff", weakWidth: 1, strongWidth: 9 };

  it("hits the configured width at each end", () => {
    expect(edgeWidthForWeight(0, style)).toBeCloseTo(1, 5);
    expect(edgeWidthForWeight(1, style)).toBeCloseTo(9, 5);
  });

  it("interpolates linearly in between", () => {
    expect(edgeWidthForWeight(0.5, style)).toBeCloseTo(5, 5);
    expect(edgeWidthForWeight(0.25, style)).toBeCloseTo(3, 5);
    expect(edgeWidthForWeight(0.75, style)).toBeCloseTo(7, 5);
  });

  it("still works when the ends are swapped, so strong can be thinner", () => {
    const inverted = { ...style, weakWidth: 9, strongWidth: 1 };
    expect(edgeWidthForWeight(0, inverted)).toBeCloseTo(9, 5);
    expect(edgeWidthForWeight(1, inverted)).toBeCloseTo(1, 5);
    expect(edgeWidthForWeight(0.5, inverted)).toBeCloseTo(5, 5);
  });

  it("supports a uniform width", () => {
    const flat = { ...style, weakWidth: 2, strongWidth: 2 };
    for (const nw of [0, 0.3, 0.7, 1]) expect(edgeWidthForWeight(nw, flat)).toBeCloseTo(2, 5);
  });

  it("clamps normalized weights and never goes non-positive", () => {
    expect(edgeWidthForWeight(-5, style)).toBeCloseTo(1, 5);
    expect(edgeWidthForWeight(5, style)).toBeCloseTo(9, 5);
    for (const nw of [0, 0.5, 1]) expect(edgeWidthForWeight(nw, style)).toBeGreaterThan(0);
  });
});

describe("edgeColorForWeight across a user-defined ramp", () => {
  it("interpolates between the two chosen colours, whatever they are", () => {
    const ramp = { weak: "#000000", strong: "#ffffff" };
    expect(edgeColorForWeight(0, ramp)).toBe("#000000");
    expect(edgeColorForWeight(1, ramp)).toBe("#ffffff");
    expect(luminance(edgeColorForWeight(0.5, ramp))).toBeGreaterThan(100);
    expect(luminance(edgeColorForWeight(0.5, ramp))).toBeLessThan(160);
  });

  it("ignores the theme entirely once both ends are chosen", () => {
    const ramp = { weak: "#ff0000", strong: "#0000ff" };
    const mid = edgeColorForWeight(0.5, ramp);
    const { r, g, b } = hexToRgb(mid);
    expect(g).toBe(0);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });
});

describe("nodeColorForMode with per-type and per-community overrides", () => {
  const base = {
    colorMode: "type" as const,
    pageType: "entity",
    community: 2,
    customColor: "#ff8800",
    typeOverrides: {} as Record<string, string>,
    communityOverrides: {} as Record<number, string>,
    // The views always have the graph, so they always pass this; a type's colour comes
    // from the vault's assignment rather than a hash of its name.
    typeColors: assignTypeColors(["entity"]),
  };

  it("prefers a per-type override in type mode", () => {
    expect(nodeColorForMode({ ...base, typeOverrides: { entity: "#123456" } })).toBe("#123456");
  });

  it("prefers a per-community override in community mode", () => {
    expect(
      nodeColorForMode({ ...base, colorMode: "community", communityOverrides: { 2: "#abcdef" } }),
    ).toBe("#abcdef");
  });

  it("falls back to the palette for a type or community with no override", () => {
    expect(nodeColorForMode({ ...base, typeOverrides: { concept: "#123456" } })).toBe(
      assignTypeColors(["entity"]).get("entity"),
    );
    expect(nodeColorForMode({ ...base, colorMode: "community" })).toBe(COMMUNITY_COLORS[2]);
  });

  it("does not consult overrides in single-colour mode", () => {
    expect(
      nodeColorForMode({
        ...base,
        colorMode: "custom",
        typeOverrides: { entity: "#123456" },
        communityOverrides: { 2: "#abcdef" },
      }),
    ).toBe("#ff8800");
  });

  it("treats an empty override string as no override", () => {
    expect(nodeColorForMode({ ...base, typeOverrides: { entity: "" } })).toBe(
      assignTypeColors(["entity"]).get("entity"),
    );
  });
});

describe("resolveTypeColors", () => {
  it("keeps every existing type's colour when a type is added", () => {
    // The reported problem: assignment by sort position meant one new type repainted every
    // type that sorted after it. Measured before this: 13 of 13 changed when it sorted first.
    const before = resolveTypeColors(["concept", "paper", "question"]);
    const after = resolveTypeColors(["concept", "paper", "question", "analysis"], before.stored);
    for (const key of ["concept", "paper", "question"]) {
      expect(after.colors.get(key)).toBe(before.colors.get(key));
    }
    // The new one takes a colour nobody else has.
    const used = ["concept", "paper", "question"].map((key) => before.colors.get(key));
    expect(used).not.toContain(after.colors.get("analysis"));
  });

  it("releases the colour of a type that is gone", () => {
    const before = resolveTypeColors(["concept", "paper"]);
    const after = resolveTypeColors(["concept"], before.stored);
    // Written back without the type that disappeared, so its colour is free again.
    expect(Object.keys(after.stored).sort()).toEqual(["concept"]);
    // A type that comes back is a new type: it takes a free colour rather than the old one.
    const returned = resolveTypeColors(["concept", "paper"], after.stored);
    expect(returned.colors.get("concept")).toBe(before.colors.get("concept"));
    expect(returned.colors.get("paper")).toBeTruthy();
  });

  it("never lets a hand-edited settings file put two types on one colour", () => {
    const { colors } = resolveTypeColors(["concept", "paper"], { concept: "#111111", paper: "#111111" });
    expect(colors.get("concept")).toBe("#111111");
    expect(colors.get("paper")).not.toBe("#111111");
  });

  it("gives a fresh vault the ramp in sorted order", () => {
    const { colors, stored } = resolveTypeColors(["paper", "concept"]);
    expect(colors.get("concept")).toBe(TYPE_COLORS[0]);
    expect(colors.get("paper")).toBe(TYPE_COLORS[1]);
    expect(stored).toEqual({ concept: TYPE_COLORS[0], paper: TYPE_COLORS[1] });
  });
});

describe("the type ramp's order", () => {
  // Assignment walks the ramp, so a vault with N types uses the first N entries. The
  // property that matters is therefore the closest pair within a PREFIX — measuring the
  // whole ramp hid this: in hue order every prefix had a ΔE 19.0 pair, always ramp[0] vs
  // ramp[1], and a real vault showed two unrelated types as the same colour.
  const lab = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    const toLinear = (c: number) =>
      c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
    const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
    const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
    const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [f(x), f(y), f(z)];
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  };
  const deltaE = (a: string, b: string) => {
    const x = lab(a);
    const y = lab(b);
    return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
  };
  const closestInPrefix = (count: number): number => {
    let closest = Infinity;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        closest = Math.min(closest, deltaE(TYPE_COLORS[i], TYPE_COLORS[j]));
      }
    }
    return closest;
  };

  it("keeps a five-type vault's colours far apart", () => {
    // Measured: 38.5 in this order, 19.0 in hue order — which is the reported collision
    // between two unrelated types in the same vault.
    expect(closestInPrefix(5)).toBeGreaterThan(35);
  });

  it("still separates the first ten, and never drops below the ramp's own floor", () => {
    expect(closestInPrefix(10)).toBeGreaterThan(18);
    expect(closestInPrefix(TYPE_COLORS.length)).toBeGreaterThan(18);
  });

  it("holds the whole ramp together as a set", () => {
    expect(new Set(TYPE_COLORS).size).toBe(TYPE_COLORS.length);
    expect(closestInPrefix(2)).toBeGreaterThan(90);
  });
});

describe("assignTypeColors", () => {
  it("gives every declared type its own colour, custom ones included", () => {
    // The measured bug this replaces: a hash per key cannot know what else is on screen,
    // so on a real vault 13 declared types produced 12 colours — 实体 and 资料 identical.
    const keys = [
      "concept",
      "entity",
      "source",
      "methodology",
      "synthesis",
      "comparison",
      "finding",
      "thesis",
      "other",
      "overview",
      "实体",
      "概念",
      "资料",
    ];
    const assignment = assignTypeColors(keys);
    const colours = keys.map((key) => assignment.get(key));
    expect(colours.every((colour) => typeof colour === "string")).toBe(true);
    expect(new Set(colours).size).toBe(keys.length);
  });

  it("treats every declared type the same, whatever it is spelled like", () => {
    // No spelling is the standard one: `concept` and `概念` are two types like any others,
    // so a vault that writes both gets two colours and neither is privileged.
    const assignment = assignTypeColors(["concept", "概念", "实验记录"]);
    const colours = ["concept", "概念", "实验记录"].map((key) => assignment.get(key));
    expect(new Set(colours).size).toBe(3);
    // Which one gets the first ramp entry is decided by sorting, not by meaning.
    expect(assignment.get("concept")).toBe(TYPE_COLORS[0]);
  });

  it("gives a type the ramp entry its sort position earns", () => {
    const assignment = assignTypeColors(["concept", "实验记录"]);
    expect(assignment.get("concept")).toBe(TYPE_COLORS[0]);
    expect(assignment.get("实验记录")).toBe(TYPE_COLORS[1]);
  });

  it("ignores duplicate declarations of the same type", () => {
    // A vault can declare the same type in notes that differ only by case; the key is
    // lower-cased upstream, so the same string arriving twice is one type, one colour.
    const assignment = assignTypeColors(["实验记录", "实验记录", "concept"]);
    expect(assignment.size).toBe(2);
    expect(assignment.get("实验记录")).toBe(TYPE_COLORS[1]);
  });

  it("is deterministic: the same vault gets the same colours in any order", () => {
    const keys = ["实验记录", "读书笔记", "concept", "随笔"];
    const forwards = assignTypeColors(keys);
    const backwards = assignTypeColors([...keys].reverse());
    for (const key of keys) expect(backwards.get(key)).toBe(forwards.get(key));
  });

  it("assigns the ramp in a fixed order, so a colour means one type", () => {
    const assignment = assignTypeColors(["实验记录", "读书笔记"]);
    // Keys are sorted by code unit (实 U+5B9E, 读 U+8BFB), and each takes the next free
    // ramp entry rather than a hash slot — so the assignment is reproducible, not lucky.
    expect(assignment.get("实验记录")).toBe(TYPE_COLORS[0]);
    expect(assignment.get("读书笔记")).toBe(TYPE_COLORS[1]);
  });

  it("keeps ten custom types apart, where a name hash managed five", () => {
    // Names of the kind a vault invents. Measured: hashing each name gave 5 distinct
    // colours for these ten (5 collisions), the assignment gives 10.
    const keys = [
      "实验记录", "读书笔记", "随笔", "会议纪要", "灵感",
      "待办", "项目", "周报", "论文笔记", "课程",
    ];
    const assignment = assignTypeColors(keys);
    const colours = keys.map((key) => assignment.get(key));
    expect(new Set(colours).size).toBe(keys.length);
  });

  it("wraps when a vault declares more custom types than the ramp has", () => {
    const keys = Array.from({ length: TYPE_COLORS.length + 2 }, (_, i) => `type-${i}`);
    const assignment = assignTypeColors(keys);
    const colours = keys.map((key) => assignment.get(key));
    // Everything is coloured; the ramp is exhausted, so the last two repeat. Documented
    // rather than hidden: there is no answer that is both distinct and this long.
    expect(colours.every((colour) => typeof colour === "string")).toBe(true);
    expect(new Set(colours).size).toBe(TYPE_COLORS.length);
  });

  it("gives a custom type its assigned colour through nodeColorForMode", () => {
    const assignment = assignTypeColors(["实验记录"]);
    expect(
      nodeColorForMode({
        colorMode: "type",
        pageType: "实验记录",
        community: 0,
        customColor: "#ff8800",
        typeColors: assignment,
      }),
    ).toBe(assignment.get("实验记录"));
    // An override still wins over the assignment.
    expect(
      nodeColorForMode({
        colorMode: "type",
        pageType: "实验记录",
        community: 0,
        customColor: "#ff8800",
        typeColors: assignment,
        typeOverrides: { 实验记录: "#123456" },
      }),
    ).toBe("#123456");
  });
});

describe("nodeColorForMode", () => {
  const base = {
    pageType: "entity",
    community: 2,
    customColor: "#ff8800",
    typeColors: assignTypeColors(["entity"]),
  };

  it("uses the type palette in type mode", () => {
    expect(nodeColorForMode({ ...base, colorMode: "type" })).toBe(
      assignTypeColors(["entity"]).get("entity"),
    );
  });

  it("uses the community palette in community mode", () => {
    expect(nodeColorForMode({ ...base, colorMode: "community" })).toBe(COMMUNITY_COLORS[2]);
  });

  it("uses the custom colour in custom mode, ignoring type and community", () => {
    expect(nodeColorForMode({ ...base, colorMode: "custom" })).toBe("#ff8800");
    expect(nodeColorForMode({ ...base, colorMode: "custom", community: 7 })).toBe("#ff8800");
  });

  it("still answers for an unknown page type", () => {
    expect(nodeColorForMode({ ...base, colorMode: "type", pageType: "nonsense" })).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("themePalette", () => {
  it("exposes a ramp for both themes with different endpoints", () => {
    expect(DARK.strong).not.toBe(LIGHT.strong);
    expect(DARK.weak).not.toBe(LIGHT.weak);
  });

  it("gives weak links less contrast against their own background than strong ones", () => {
    // The canvas background each theme draws on.
    const DARK_BACKGROUND = "#0f172a";
    const LIGHT_BACKGROUND = "#ffffff";

    const contrast = (color: string, background: string) =>
      Math.abs(luminance(color) - luminance(background));

    expect(contrast(DARK.weak, DARK_BACKGROUND)).toBeLessThan(contrast(DARK.strong, DARK_BACKGROUND));
    expect(contrast(LIGHT.weak, LIGHT_BACKGROUND)).toBeLessThan(contrast(LIGHT.strong, LIGHT_BACKGROUND));
  });
});
