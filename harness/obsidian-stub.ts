/**
 * Minimal stand-in for the `obsidian` module, used only by the browser
 * harness so the real view code can run in a plain page.
 */

export class Notice {
  constructor(message: string, timeout?: number) {
    const el = document.createElement("div");
    el.className = "harness-notice";
    el.textContent = message;
    if (timeout) el.dataset.timeout = String(timeout);
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 4000);
    // Recorded so the harness can assert on notices.
    (window as unknown as { __NOTICES__: string[] }).__NOTICES__ ??= [];
    (window as unknown as { __NOTICES__: string[] }).__NOTICES__.push(message);
  }
  hide(): void {}
}

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension = "md";
  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.replace(/\.md$/, "");
  }
}

export class TFolder {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}

export class WorkspaceLeaf {
  view: unknown = null;
}

export class ItemView {
  app: unknown;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "workspace-leaf-content";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "view-content";
    this.containerEl.appendChild(this.contentEl);
  }

  getViewType(): string {
    return "stub";
  }
  getDisplayText(): string {
    return "stub";
  }
  getIcon(): string {
    return "file";
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

export class Plugin {
  app: unknown;
  manifest = { id: "stub", name: "stub", version: "0" };
  constructor(app?: unknown) {
    this.app = app;
  }
  async loadData(): Promise<unknown> {
    return {};
  }
  async saveData(): Promise<void> {}
  addRibbonIcon(): HTMLElement {
    return document.createElement("div");
  }
  addCommand(): void {}
  addSettingTab(): void {}
  registerView(): void {}
  registerEvent(): void {}
}

export class PluginSettingTab {
  app: unknown;
  containerEl: HTMLElement = document.createElement("div");
  constructor(app: unknown, _plugin: unknown) {
    this.app = app;
  }
  display(): void {}
}

/**
 * The control components behind `Setting.addX`.
 *
 * They have to exist for the settings tab to be testable at all: it is built
 * almost entirely out of `Setting`, and the previous stub returned `this` from
 * every `addX` without calling the callback or creating a node — so the tab
 * rendered nothing and no assertion about it could fail.
 *
 * Faithful in the ways that matter for behaviour:
 *   - `setValue`/`setLimits`/`addOption`/`setButtonText` are programmatic and do
 *     NOT fire `onChange`, matching Obsidian. A test that wants the handler must
 *     dispatch the event itself.
 *   - the control is a real element of the right tag, so `querySelector("select")`
 *     and friends work as they would in the app.
 */
class ComponentBase<T extends HTMLElement> {
  protected changeHandler: ((value: never) => unknown) | null = null;
  constructor(readonly el: T) {
    // The element owns the wiring, so a subclass only declares how to read a
    // value out of itself — see `elValue`.
    const emit = () => void this.changeHandler?.(elValue(el) as never);
    el.addEventListener("input", emit);
    el.addEventListener("change", emit);
  }
  onChange(cb: (value: never) => unknown): this {
    this.changeHandler = cb;
    return this;
  }
}

export class TextComponent extends ComponentBase<HTMLInputElement> {
  setValue(value: string): this {
    this.el.value = value;
    return this;
  }
  setPlaceholder(value: string): this {
    this.el.placeholder = value;
    return this;
  }
  then(cb: (component: this) => void): this {
    cb(this);
    return this;
  }
}

export class TextAreaComponent extends ComponentBase<HTMLTextAreaElement> {
  setValue(value: string): this {
    this.el.value = value;
    return this;
  }
  setPlaceholder(value: string): this {
    this.el.placeholder = value;
    return this;
  }
}

export class DropdownComponent extends ComponentBase<HTMLSelectElement> {
  addOption(value: string, display: string): this {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = display;
    this.el.appendChild(option);
    return this;
  }
  addOptions(record: Record<string, string>): this {
    for (const [value, display] of Object.entries(record)) this.addOption(value, display);
    return this;
  }
  setValue(value: string): this {
    this.el.value = value;
    return this;
  }
}

export class ToggleComponent extends ComponentBase<HTMLInputElement> {
  setValue(value: boolean): this {
    this.el.checked = value;
    return this;
  }
  setTooltip(): this {
    return this;
  }
}

export class ButtonComponent extends ComponentBase<HTMLButtonElement> {
  setButtonText(value: string): this {
    this.el.textContent = value;
    return this;
  }
  setIcon(): this {
    return this;
  }
  setTooltip(): this {
    return this;
  }
  setCta(): this {
    this.el.addClass("mod-cta");
    return this;
  }
  setWarning(): this {
    this.el.addClass("mod-warning");
    return this;
  }
  onClick(cb: () => unknown): this {
    this.el.addEventListener("click", () => void cb());
    return this;
  }
}

export class SliderComponent extends ComponentBase<HTMLInputElement> {
  setLimits(min: number, max: number, step: number): this {
    this.el.min = String(min);
    this.el.max = String(max);
    this.el.step = String(step);
    return this;
  }
  setValue(value: number): this {
    this.el.value = String(value);
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  showTooltip(): this {
    return this;
  }
}

export class Setting {
  readonly settingEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv({ cls: "setting-item" });
    const info = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = info.createDiv({ cls: "setting-item-name" });
    this.descEl = info.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }

  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }

  setClass(cls: string): this {
    this.settingEl.addClass(cls);
    return this;
  }

  setHeading(): this {
    this.settingEl.addClass("setting-item-heading");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.toggleClass("is-disabled", disabled);
    return this;
  }

  private control<T extends HTMLElement>(tag: string, options: { type?: string }): HTMLElement {
    return this.controlEl.createEl(tag, options) as HTMLElement;
  }

  addText(cb: (component: TextComponent) => unknown): this {
    cb(new TextComponent(this.control<HTMLInputElement>("input", { type: "text" })));
    return this;
  }

  addTextArea(cb: (component: TextAreaComponent) => unknown): this {
    cb(new TextAreaComponent(this.control<HTMLTextAreaElement>("textarea", {})));
    return this;
  }

  addToggle(cb: (component: ToggleComponent) => unknown): this {
    cb(new ToggleComponent(this.control<HTMLInputElement>("input", { type: "checkbox" })));
    return this;
  }

  addSlider(cb: (component: SliderComponent) => unknown): this {
    cb(new SliderComponent(this.control<HTMLInputElement>("input", { type: "range" })));
    return this;
  }

  addDropdown(cb: (component: DropdownComponent) => unknown): this {
    cb(new DropdownComponent(this.control<HTMLSelectElement>("select", {})));
    return this;
  }

  addButton(cb: (component: ButtonComponent) => unknown): this {
    cb(new ButtonComponent(this.controlEl.createEl("button")));
    return this;
  }

  addExtraButton(cb: (component: ButtonComponent) => unknown): this {
    return this.addButton(cb);
  }
}

/** The value an event should carry for a given control element. */
function elValue(el: HTMLElement): string | boolean {
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
  if (el instanceof HTMLInputElement && el.type === "range") return el.value;
  if (el instanceof HTMLInputElement) return el.value;
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  return "";
}


export class App {}
export class Component {
  load(): void {}
  unload(): void {}
}

/** Lucide-ish placeholder: the harness only checks that an icon was mounted. */
export function setIcon(el: HTMLElement, icon: string): void {
  el.innerHTML = `<svg data-icon="${icon}" viewBox="0 0 24 24"></svg>`;
}

/**
 * Obsidian's own language getter.
 *
 * The plugin used to read `localStorage.getItem("language")` directly, which the
 * directory flagged: the key is an implementation detail and the value is not
 * guaranteed to be there. This stands in for the real one in tests and in the
 * harness, where `document.documentElement.lang` is the closest equivalent.
 */
export function getLanguage(): string {
  return document.documentElement.lang || "en";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export function requestUrl(): Promise<never> {
  return Promise.reject(new Error("requestUrl is unavailable in the harness"));
}

export function debounce<T extends (...args: never[]) => void>(fn: T, wait = 0): T {
  let timer: number | null = null;
  return ((...args: never[]) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  }) as T;
}
