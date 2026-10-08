/**
 * Obsidian's DOM helpers (`createDiv`, `createEl`, `empty`, `addClass`, …)
 * are injected into the global prototypes by the app. The harness needs the
 * same surface so the untouched view code can run here.
 */

type DomOptions = {
  cls?: string | string[];
  text?: string;
  title?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  [key: string]: unknown;
};

function applyOptions(el: HTMLElement, options?: DomOptions): void {
  if (!options) return;
  for (const [key, value] of Object.entries(options)) {
    switch (key) {
      case "cls":
        if (Array.isArray(value)) el.classList.add(...(value as string[]));
        else if (typeof value === "string" && value) el.classList.add(...value.split(/\s+/));
        break;
      case "text":
        el.textContent = String(value);
        break;
      case "title":
        el.title = String(value);
        break;
      case "attr":
        for (const [name, attrValue] of Object.entries((value ?? {}) as Record<string, unknown>)) {
          if (attrValue === null || attrValue === false) continue;
          el.setAttribute(name, String(attrValue));
        }
        break;
      case "type":
        el.setAttribute("type", String(value));
        break;
      case "placeholder":
        el.setAttribute("placeholder", String(value));
        break;
      case "value":
        (el as HTMLInputElement).value = String(value);
        break;
      case "href":
        el.setAttribute("href", String(value));
        break;
      default:
        break;
    }
  }
}

declare global {
  interface HTMLElement {
    createDiv(options?: DomOptions): HTMLDivElement;
    createSpan(options?: DomOptions): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: DomOptions,
    ): HTMLElementTagNameMap[K];
    empty(): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
    toggleClass(classes: string | string[], value: boolean): void;
    setText(value: string): void;
    setAttr(name: string, value: string | number | boolean | null): void;
    detach(): void;
  }
}

function install(target: typeof HTMLElement.prototype): void {
  target.createDiv = function (this: HTMLElement, options?: DomOptions) {
    return this.createEl("div", options);
  };
  target.createSpan = function (this: HTMLElement, options?: DomOptions) {
    return this.createEl("span", options) as HTMLSpanElement;
  };
  target.createEl = function <K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options?: DomOptions,
  ) {
    const el = document.createElement(tag);
    applyOptions(el, options);
    this.appendChild(el);
    return el;
  };
  target.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  target.addClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean));
  };
  target.removeClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes.flatMap((cls) => cls.split(/\s+/)).filter(Boolean));
  };
  target.toggleClass = function (this: HTMLElement, classes: string | string[], value: boolean) {
    const list = Array.isArray(classes) ? classes : [classes];
    for (const cls of list) this.classList.toggle(cls, value);
  };
  target.setText = function (this: HTMLElement, value: string) {
    this.textContent = value;
  };
  target.setAttr = function (this: HTMLElement, name: string, value: string | number | boolean | null) {
    if (value === null || value === false) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  };
  target.detach = function (this: HTMLElement) {
    this.remove();
  };
}

install(HTMLElement.prototype);
install(Element.prototype as unknown as typeof HTMLElement.prototype);
install(document.body as unknown as typeof HTMLElement.prototype);

export {};
