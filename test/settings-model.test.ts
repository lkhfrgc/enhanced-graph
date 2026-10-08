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
      "hiddenCommunities",
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

describe("mergeSettings: the excluded clusters", () => {
  it("keeps an excluded cluster across a save and load", () => {
    // The legend's cluster rows write this list, so it has to survive a restart
    // the way the hidden types do.
    const settings = roundTrip({ ...DEFAULT_SETTINGS, hiddenCommunities: [1, 3] });
    expect(settings.hiddenCommunities).toEqual([1, 3]);
  });

  it("excludes nothing by default", () => {
    expect(mergeSettings({}).hiddenCommunities).toEqual([]);
  });

  it("gives the built-in graph its own line colour, following the theme by default", () => {
    // Its own key, not the standalone view's `edgeStrongColor`: that one is one end
    // of the standalone ramp, and sharing it repainted the built-in graph's edges
    // with a flat colour whenever the ramp was tuned.
    expect(mergeSettings({}).officialLineColor).toBeNull();
    expect(mergeSettings({ edgeStrongColor: "#3b3b3b" }).officialLineColor).toBeNull();
    const settings = roundTrip({ ...DEFAULT_SETTINGS, officialLineColor: "#123456" });
    expect(settings.officialLineColor).toBe("#123456");
    expect(roundTrip({ ...DEFAULT_SETTINGS, officialLineColor: null }).officialLineColor).toBeNull();
  });

  it("turns the built-in graph enhancement on by default", () => {
    expect(mergeSettings({}).officialGraphEnabled).toBe(true);
    expect(mergeSettings({}).officialGraphColorMode).toBe("community");
    expect(roundTrip({ ...DEFAULT_SETTINGS, officialGraphEnabled: false }).officialGraphEnabled).toBe(
      false,
    );
  });

  it("splits the old three-state setting without changing anyone's state", () => {
    // It used to be one key saying both whether the enhancement ran and how it
    // coloured. A file that has only ever known that key has to keep the state it
    // was actually in — nobody's graph may change on upgrade.
    const off = mergeSettings({ officialGraphMode: "off" });
    expect(off.officialGraphEnabled).toBe(false);

    const community = mergeSettings({ officialGraphMode: "community" });
    expect(community.officialGraphEnabled).toBe(true);
    expect(community.officialGraphColorMode).toBe("community");

    const byType = mergeSettings({ officialGraphMode: "type" });
    expect(byType.officialGraphEnabled).toBe(true);
    expect(byType.officialGraphColorMode).toBe("type");

    // A file written after the split wins over the legacy key.
    const explicit = mergeSettings({ officialGraphMode: "off", officialGraphEnabled: true });
    expect(explicit.officialGraphEnabled).toBe(true);
  });
});
