/**
 * Smoke test for the BUILT plugin bundle.
 *
 * Obsidian's runtime cannot be scripted from here, so this loads the real
 * `main.js` with a stubbed `obsidian` module and drives the plugin lifecycle.
 * It catches the class of failure that unit tests cannot see: a bad bundle, a
 * missing export, or a crash inside `onload`.
 *
 * Usage: node scripts/smoke-load.cjs
 */

const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");

// The repo root, which is where `npm run build` writes by default. It used to
// read the vault copy, which tied this check to one developer's directory layout
// and to a build step that wrote outside the checkout.
const bundlePath = path.resolve(__dirname, "..", "main.js");

if (!fs.existsSync(bundlePath)) {
  console.error(`bundle not found: ${bundlePath}\nrun \`npm run build\` first`);
  process.exit(1);
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
}

// --- minimal DOM/window globals the bundle touches at load time -------------
// sigma feature-detects WebGL support while its module body evaluates; the
// classes exist in Electron/Obsidian, so stub them for Node.
global.WebGL2RenderingContext = global.WebGL2RenderingContext ?? class WebGL2RenderingContext {};
global.WebGLRenderingContext = global.WebGLRenderingContext ?? class WebGLRenderingContext {};
global.ResizeObserver = global.ResizeObserver ?? class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.requestAnimationFrame = global.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
global.cancelAnimationFrame = global.cancelAnimationFrame ?? ((handle) => clearTimeout(handle));

const listeners = new Map();
global.window = global.window ?? {
  setTimeout: () => 0,
  clearTimeout: () => {},
  localStorage: { getItem: () => "zh" },
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.document = global.document ?? {
  body: { classList: { contains: () => true, add: () => {}, remove: () => {}, toggle: () => {} } },
  createElement: () => ({
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    appendChild: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
    createDiv: () => ({}),
    empty: () => {},
  }),
  documentElement: { classList: { contains: () => false } },
  addEventListener: () => {},
};

// --- obsidian stub ----------------------------------------------------------
const registered = { views: [], commands: [], ribbon: 0, settingTabs: 0, events: 0 };

class Events {
  on() {
    return {};
  }
  off() {}
  trigger() {}
}
class Component {
  load() {}
  unload() {}
  registerEvent() {
    registered.events += 1;
  }
  addChild() {}
}
class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return this.__data ?? null;
  }
  async saveData(data) {
    this.__data = data;
  }
  addRibbonIcon() {
    registered.ribbon += 1;
    return { addClass: () => {}, setAttribute: () => {} };
  }
  addCommand(command) {
    registered.commands.push(command);
    return command;
  }
  addSettingTab() {
    registered.settingTabs += 1;
  }
  registerView(type) {
    registered.views.push(type);
  }
}
class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.containerEl = { empty: () => {}, addClass: () => {}, appendChild: () => {} };
    this.contentEl = this.containerEl;
  }
}
class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty: () => {},
      createEl: () => ({ createSpan: () => ({}), setText: () => {} }),
      createDiv: () => ({ createSpan: () => ({}) }),
    };
  }
}
class Setting {
  constructor() {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText() {
    return this;
  }
  addTextArea() {
    return this;
  }
  addSlider() {
    return this;
  }
  addButton() {
    return this;
  }
  addDropdown() {
    return this;
  }
}
class TFile {
  constructor(path) {
    this.path = path;
    this.extension = "md";
    this.basename = path.split("/").pop().replace(/\.md$/, "");
  }
}
class Notice {
  constructor(message) {
    registered.lastNotice = message;
  }
}
class WorkspaceLeaf {}
class TFolder {}

const obsidianStub = {
  App: class {},
  Component,
  Events,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath: (p) => String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/"),
  setIcon: () => {},
  // The plugin reads the interface language through Obsidian's own getter rather
  // than `localStorage`, so the stub has to provide it.
  getLanguage: () => "en",
  debounce: (fn) => fn,
  requestUrl: async () => ({ status: 200, text: "{}" }),
  MarkdownView: class {},
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function patched(id) {
  if (id === "obsidian") return obsidianStub;
  return originalRequire.apply(this, arguments);
};

const app = {
  vault: {
    // The graph builder skips the configuration folder, and its name is read
    // from the vault rather than assumed.
    configDir: ".obsidian",
    on: () => ({}),
    getMarkdownFiles: () => [],
    getAbstractFileByPath: () => null,
    adapter: { read: async () => "", exists: async () => false, write: async () => {} },
    create: async () => {},
    createFolder: async () => {},
  },
  workspace: {
    on: () => ({}),
    getLeavesOfType: () => [],
    getLeaf: () => ({ setViewState: async () => {}, openFile: async () => {} }),
    revealLeaf: async () => {},
    detachLeavesOfType: () => {},
    getActiveFile: () => null,
  },
};

async function main() {
  console.log("\n=== Enhanced Graph — built-bundle smoke test ===\n");
  check("bundle exists on disk", fs.existsSync(bundlePath), path.basename(bundlePath));

  const stats = fs.statSync(bundlePath);
  check("bundle is a plausible size", stats.size > 100_000 && stats.size < 5_000_000, `${Math.round(stats.size / 1024)} KB`);

  const source = fs.readFileSync(bundlePath, "utf8");
  check(
    "bundle declares the CommonJS plugin export",
    /module\.exports|exports\.default/.test(source),
    "module.exports present",
  );
  check(
    "bundle contains no leftover Deep Research / LLM code",
    !/chat\/completions|deep-research|optimizeResearchTopic|generateResearchTopic/.test(source),
    "clean",
  );

  let moduleExports;
  try {
    // Compiled as CommonJS explicitly rather than through `require()`.
    //
    // The bundle now lives in the repository root, and `package.json` declares
    // `"type": "module"`, so Node would treat a `main.js` there as ESM and refuse
    // the `module.exports` at the end of it. The bundle IS CommonJS — esbuild is
    // configured that way, and Obsidian loads it from a plugin folder that has no
    // `package.json` at all. `_compile` runs the source as CJS whatever the
    // surrounding package says, which is what Obsidian effectively does.
    const bundleModule = new Module(bundlePath, null);
    bundleModule.filename = bundlePath;
    bundleModule.paths = Module._nodeModulePaths(path.dirname(bundlePath));
    bundleModule._compile(source, bundlePath);
    moduleExports = bundleModule.exports;
  } catch (error) {
    check("bundle can be required", false, error.message);
    return finish();
  }
  check("bundle can be required", true, "as CommonJS, independent of package.json type");

  const PluginClass = moduleExports.default ?? moduleExports;
  check("default export is a plugin class", typeof PluginClass === "function", typeof PluginClass);

  let instance;
  try {
    instance = new PluginClass(app, { id: "enhanced-graph", version: "1.0.0" });
  } catch (error) {
    check("plugin can be constructed", false, error.message);
    return finish();
  }
  check("plugin can be constructed", true, "");

  try {
    await instance.onload();
  } catch (error) {
    check("onload() completes without throwing", false, error.message);
    return finish();
  }
  check("onload() completes without throwing", true, "");
  check("registers the graph view", registered.views.includes("enhanced-graph-view"), registered.views.join(", "));
  check("registers commands", registered.commands.length >= 3, `${registered.commands.length} commands`);
  check("adds a ribbon icon", registered.ribbon >= 1, String(registered.ribbon));
  check("adds a settings tab", registered.settingTabs >= 1, String(registered.settingTabs));
  check("subscribes to vault/workspace events", registered.events >= 4, `${registered.events} events`);
  check(
    "command ids are the expected ones",
    [
      // Obsidian prefixes these with the plugin id itself, so repeating it here
      // would produce "enhanced-graph:open-enhanced-graph".
      "open",
      "rebuild",
      "copy-relevance-report",
      "export-graph-insights",
      "toggle-official-graph",
      "probe-official-graph",
      "sync-official-layout",
    ].every((id) => registered.commands.some((command) => command.id === id)),
    registered.commands.map((command) => command.id).join(", "),
  );

  // The built-in graph adapter must degrade silently when no graph view exists.
  check(
    "built-in graph probe degrades cleanly with no graph leaf open",
    typeof instance.reportOfficialGraphCompatibility !== "function" ||
      (() => {
        try {
          instance.reportOfficialGraphCompatibility?.();
          return true;
        } catch {
          return false;
        }
      })(),
    "no throw",
  );

  try {
    await instance.onunload();
    check("onunload() completes without throwing", true, "");
  } catch (error) {
    check("onunload() completes without throwing", false, error.message);
  }

  finish();
}

function finish() {
  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFailed checks:");
    for (const result of failed) console.log(`  - ${result.name}: ${result.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
