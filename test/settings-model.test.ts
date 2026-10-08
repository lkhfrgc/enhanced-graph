/**
 * Specification for the persisted settings model.
 *
 * The question these answer is "does my appearance setting survive a restart?".
 * Everything the appearance panel can change has to satisfy two properties:
 *
 *   1. `mergeSettings` keeps an explicit value when loading a saved file.
 *   2. A settings file written by an OLDER version still loads, with the new
 *      keys filled from the defaults rather than arriving as `undefined`.
 *
 * (2) is the one that bites: a missing key reaches the renderer as `undefined`
 * and silently poisons whatever it feeds.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_EDGE_WIDTHS } from "../src/view/palette";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings-model";

/** Simulate a save/load cycle through JSON, as Obsidian's data.json does. */
const roundTrip = (settings: unknown): ReturnType<typeof mergeSettings> =>
  mergeSettings(JSON.parse(JSON.stringify(settings)));

describe("mergeSettings: defaults", () => {
  it("fills every key from an empty file", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("starts the edge ramp on the theme with the reference widths", () => {
    const settings = mergeSettings({});
    expect(settings.edgeWeakColor).toBeNull();
    expect(settings.edgeStrongColor).toBeNull();
    expect(settings.edgeWeakWidth).toBe(DEFAULT_EDGE_WIDTHS.weakWidth);
    expect(settings.edgeStrongWidth).toBe(DEFAULT_EDGE_WIDTHS.strongWidth);
    expect(settings.typeColorOverrides).toEqual({});
    expect(settings.communityColorOverrides).toEqual({});
  });
});

describe("mergeSettings: appearance round-trip", () => {
  const appearance = {
    colorMode: "community" as const,
    nodeScale: 0.65,
    gravity: 1.4,
    showLabels: false,
    customNodeColor: "#ff8800",
    edgeWeakColor: "#000000",
    edgeStrongColor: "#ffffff",
    edgeWeakWidth: 0.4,
    edgeStrongWidth: 4.8,
    typeColorOverrides: { entity: "#123456", concept: "#abcdef" },
    communityColorOverrides: { "0": "#2887fb", "3": "#22d3ee" },
  };

  it("keeps every appearance setting across a save and load", () => {
    const settings = roundTrip({ ...DEFAULT_SETTINGS, ...appearance });
    for (const [key, value] of Object.entries(appearance)) {
      expect(settings[key as keyof typeof settings], key).toEqual(value);
    }
  });

  it("keeps the override maps intact, including their keys", () => {
    const settings = roundTrip({ ...DEFAULT_SETTINGS, ...appearance });
    expect(Object.keys(settings.typeColorOverrides).sort()).toEqual(["concept", "entity"]);
    expect(settings.typeColorOverrides.entity).toBe("#123456");
    // JSON turns numeric keys into strings; the reader has to cope with that.
    expect(settings.communityColorOverrides["3"]).toBe("#22d3ee");
  });

  it("preserves an explicit null as 'follow the theme'", () => {
    const settings = roundTrip({ ...DEFAULT_SETTINGS, edgeStrongColor: null, edgeWeakColor: null });
    expect(settings.edgeStrongColor).toBeNull();
    expect(settings.edgeWeakColor).toBeNull();
  });
});

describe("mergeSettings: upgrading an older file", () => {
  /** A file written before the appearance panel existed. */
  const legacy = {
    language: "zh",
    colorMode: "type",
    nodeScale: 0.65,
    gravity: 0.85,
    hiddenTypes: ["query"],
    positions: { "a/b": { x: 1, y: 2 } },
  };

  it("keeps what the old file had", () => {
    const settings = mergeSettings(legacy);
    expect(settings.nodeScale).toBe(0.65);
    expect(settings.gravity).toBe(0.85);
    expect(settings.hiddenTypes).toEqual(["query"]);
    expect(settings.positions["a/b"]).toEqual({ x: 1, y: 2 });
  });

  it("gives the keys the old file never had sensible defaults, not undefined", () => {
    const settings = mergeSettings(legacy);
    // A missing key would reach the renderer as undefined and poison whatever it
    // feeds — a missing edge width used to make every edge render the same.
    for (const key of [
      "edgeWeakColor",
      "edgeStrongColor",
      "edgeWeakWidth",
      "edgeStrongWidth",
      "customNodeColor",
      "typeColorOverrides",
      "communityColorOverrides",
      "showLabels",
      "hiddenTags",
    ] as const) {
      expect(settings[key], key).not.toBeUndefined();
    }
    expect(settings.edgeWeakWidth).toBe(DEFAULT_EDGE_WIDTHS.weakWidth);
  });

  it("does not mutate the object it is given", () => {
    const before = JSON.parse(JSON.stringify(legacy));
    mergeSettings(legacy);
    expect(legacy).toEqual(before);
  });
});
