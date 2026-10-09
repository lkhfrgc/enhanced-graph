import { App, getLanguage, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingsHost } from "./plugin-host";
import { t } from "./i18n";
import { applyLanguage, type EnhancedGraphSettings } from "./settings-model";
import { hasOfficialGraphView } from "./integrate/official-internals";

export class EnhancedGraphSettingTab extends PluginSettingTab {
  private readonly plugin: Plugin & SettingsHost;

  constructor(app: App, plugin: Plugin & SettingsHost) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Not `createEl("h2")`: Obsidian asks for headings to go through `Setting`
    // so they pick up the same classes and spacing as every other setting row.
    new Setting(containerEl).setName(t("settings.heading")).setHeading();

    this.renderGraph(containerEl);
    this.renderAdvanced(containerEl);
  }

  // -------------------------------------------------------------------------
  // Graph behaviour
  // -------------------------------------------------------------------------

  private renderGraph(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t("settings.language"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "自动 / Auto")
          .addOption("zh", "简体中文")
          .addOption("en", "English")
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as EnhancedGraphSettings["language"];
            await this.plugin.saveSettings();
            applyLanguage(this.plugin.settings, getLanguage());
            this.plugin.refreshViews();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.officialGraph"))
      .setDesc(t("settings.officialGraphDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.officialGraphEnabled).onChange(async (value) => {
          this.plugin.settings.officialGraphEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.applyOfficialGraphMode();
          this.display();
        }),
      );

    if (this.plugin.settings.officialGraphEnabled) {
      containerEl.createEl("p", {
        cls: "setting-item-description mod-warning",
        text: t("settings.officialGraphWarning"),
      });
    }

    const layoutSetting = new Setting(containerEl)
      .setName(t("settings.reuseOfficialLayout"))
      .setDesc(t("settings.reuseOfficialLayoutDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.reuseOfficialLayout).onChange(async (value) => {
          this.plugin.settings.reuseOfficialLayout = value;
          await this.plugin.saveSettings();
          this.plugin.syncLayoutFromOfficial();
          this.display();
        }),
      );
    if (this.plugin.settings.reuseOfficialLayout && !hasOfficialGraphView(this.plugin.app)) {
      layoutSetting.setDesc(`${t("settings.reuseOfficialLayoutDesc")}\n${t("settings.reuseOfficialLayoutUnavailable")}`);
    }

    new Setting(containerEl)
      .setName(t("settings.workingFolder"))
      .setDesc(t("settings.workingFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.workingFolderPlaceholder"))
          .setValue(this.plugin.settings.workingFolder)
          .onChange(async (value) => {
            this.plugin.settings.workingFolder = value.trim();
            await this.plugin.saveSettings();
            this.plugin.requestGraphRebuild();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.excludeFolders"))
      .setDesc(t("settings.excludeFoldersDesc"))
      .addTextArea((text) =>
        text
          .setValue(this.plugin.settings.excludeFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.requestGraphRebuild();
          }),
      );
  }

  // -------------------------------------------------------------------------
  // Advanced
  // -------------------------------------------------------------------------

  private renderAdvanced(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t("insights.restore"))
      .setDesc(`${this.plugin.settings.dismissedInsights.length}`)
      .addButton((button) =>
        button.setButtonText(t("toolbar.reset")).onClick(async () => {
          this.plugin.settings.dismissedInsights = [];
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings.layoutCache"))
      .setDesc(t("settings.layoutCacheDesc", { count: Object.keys(this.plugin.settings.positions).length }))
      .addButton((button) =>
        button.setButtonText(t("toolbar.reset")).onClick(async () => {
          this.plugin.settings.positions = {};
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        }),
      );
  }
}
