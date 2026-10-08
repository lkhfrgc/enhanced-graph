// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import "../harness/dom-polyfill";
import { EnhancedGraphSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, type EnhancedGraphSettings } from "../src/settings-model";
import type { SettingsHost } from "../src/plugin-host";

/**
 * The settings tab is plain DOM built against `SettingsHost`, so a fake host is
 * enough to exercise it.
 *
 * The colour rows and the weight sliders used to be the interesting part here
 * and are gone — both are edited inside the graph now. What is left still has
 * behaviour worth pinning: the exclude-folder box parses free text into a list,
 * and the two reset buttons mutate persisted state.
 */
function makeHost(options: {
  settings?: Partial<EnhancedGraphSettings>;
  openGraphLeaves?: boolean;
} = {}): {
  host: SettingsHost;
  settings: EnhancedGraphSettings;
  rebuilds: number;
  saves: number;
} {
  // Deep enough: the overrides are mutated by the settings under test, and a
  // shallow spread would share them with DEFAULT_SETTINGS — leaking between
  // cases here and into every other test file.
  const settings: EnhancedGraphSettings = {
    ...DEFAULT_SETTINGS,
    weights: { ...DEFAULT_SETTINGS.weights },
    typeColorOverrides: { ...DEFAULT_SETTINGS.typeColorOverrides },
    communityColorOverrides: { ...DEFAULT_SETTINGS.communityColorOverrides },
    dismissedInsights: [...DEFAULT_SETTINGS.dismissedInsights],
    positions: { ...DEFAULT_SETTINGS.positions },
    ...options.settings,
  };
  const state = { saves: 0, rebuilds: 0 };
  const host = {
    // `renderGraph` probes for open built-in graph leaves.
    app: {
      workspace: {
        getLeavesOfType: () => (options.openGraphLeaves === false ? [] : [{ view: {} }]),
      },
    },
    settings,
    saveSettings: async () => {
      state.saves += 1;
    },
    requestGraphRebuild: () => {
      state.rebuilds += 1;
    },
    refreshViews: () => {},
    applyOfficialGraphMode: () => {},
    syncLayoutFromOfficial: async () => {},
  } as unknown as SettingsHost;
  return {
    host,
    settings,
    get saves() {
      return state.saves;
    },
    get rebuilds() {
      return state.rebuilds;
    },
  };
}

function render(host: SettingsHost): EnhancedGraphSettingTab {
  const tab = new EnhancedGraphSettingTab({} as never, host as never);
  tab.display();
  return tab;
}

/** The `.setting-item` whose name contains `name`. */
function settingNamed(container: HTMLElement, name: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(".setting-item")).find((item) =>
    item.querySelector(".setting-item-name")?.textContent?.includes(name),
  );
}

describe("EnhancedGraphSettingTab", () => {
  it("parses the exclude-folder box into a trimmed, non-empty list", async () => {
    const h = makeHost();
    const tab = render(h.host);

    const box = settingNamed(tab.containerEl, "排除的文件夹")?.querySelector("textarea");
    expect(box).toBeTruthy();
    box!.value = "templates/\n\n  archive/old  \n";
    box!.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();

    // Blank lines and surrounding spaces are the user's, not the setting's.
    expect(h.settings.excludeFolders).toEqual(["templates/", "archive/old"]);
    // Folder changes alter which nodes exist, so a rebuild is required.
    expect(h.rebuilds).toBeGreaterThan(0);
  });

  it("offers the language choices and shows the stored one", () => {
    const { host } = makeHost({ settings: { language: "en" } });
    const tab = render(host);

    const select = settingNamed(tab.containerEl, "界面语言")?.querySelector("select");
    expect(select).toBeTruthy();
    expect(Array.from(select!.options).map((option) => option.value)).toEqual(["auto", "zh", "en"]);
    expect(select!.value).toBe("en");
  });

  it("warns that the layout cannot be reused while no built-in graph is open", () => {
    const tab = render(makeHost({ openGraphLeaves: false }).host);

    const item = settingNamed(tab.containerEl, "复用内置图谱的布局");
    // Not "回退": the base description already ends with 自动回退, so that word
    // cannot tell the two states apart.
    expect(item?.querySelector(".setting-item-description")?.textContent).toContain(
      "当前没有打开的内置图谱视图",
    );
  });

  it("does not warn when a built-in graph is open", () => {
    const tab = render(makeHost().host);

    const item = settingNamed(tab.containerEl, "复用内置图谱的布局");
    expect(item?.querySelector(".setting-item-description")?.textContent).not.toContain(
      "当前没有打开的内置图谱视图",
    );
  });

  it("clears the dismissed insights and the layout cache when asked", async () => {
    const h = makeHost({
      settings: { dismissedInsights: ["a", "b"], positions: { "x.md": { x: 1, y: 2 } } },
    });
    const tab = render(h.host);

    // Both rows are buttons labelled just "重置", so find them by their setting
    // name — clicking the wrong one would still pass a "some button worked" test.
    const clicked = async (name: string) => {
      const button = settingNamed(tab.containerEl, name)?.querySelector("button");
      expect(button).toBeTruthy();
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    };

    await clicked("恢复已消除的洞察");
    expect(h.settings.dismissedInsights).toEqual([]);
    // The other store is untouched by this button.
    expect(Object.keys(h.settings.positions)).toHaveLength(1);

    await clicked("布局缓存");
    expect(h.settings.positions).toEqual({});
    expect(h.saves).toBeGreaterThan(0);
  });
});
