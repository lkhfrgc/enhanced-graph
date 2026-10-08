import { setIcon } from "obsidian";

/**
 * Small form controls shared by the side panels.
 *
 * Both `graph-filters` and `graph-appearance` need labelled checkboxes, sliders
 * and colour fields. Keeping one implementation means the two panels cannot
 * drift apart visually, and the markup stays in one place for the stylesheet and
 * the browser assertions.
 */

/** Checkbox + label, wrapped so the row styles the pair as one control. */
export function checkboxRow(
  parent: HTMLElement,
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const row = parent.createEl("label", { cls: "enhanced-graph-checkbox" });
  const input = row.createEl("input", { type: "checkbox" });
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  row.createSpan({ text: label });
  return row;
}

/** One tab: the id the caller recognises, and the label on its button. */
export interface TabEntry<T extends string> {
  readonly id: T;
  readonly label: string;
}

/**
 * The panels' section switcher: one button per group, the active one marked, and
 * clicking another reports it.
 *
 * The same button the appearance panel uses for its colour mode, so the panels in
 * one column switch their content the same way. It is allowed to wrap — four
 * labels do not fit on one line in a side panel.
 */
export function tabRow<T extends string>(
  parent: HTMLElement,
  tabs: readonly TabEntry<T>[],
  activeId: T,
  onSelect: (id: T) => void,
): HTMLElement {
  const row = parent.createDiv({ cls: "enhanced-graph-panel-tabs" });
  for (const tab of tabs) {
    const active = tab.id === activeId;
    const button = row.createEl("button", {
      cls: `enhanced-graph-button${active ? " is-active" : ""}`,
      text: tab.label,
      attr: { "aria-pressed": String(active) },
    });
    button.addEventListener("click", () => onSelect(tab.id));
  }
  return row;
}

export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * A labelled row: range slider plus an optional number field.
 *
 * The slider is for nudging, the number field for typing an exact value — the
 * range on these settings is wide enough (edge width runs 0.2 … 12) that
 * dragging alone cannot land on a precise figure.
 *
 * `onPreview` fires while dragging and `onCommit` when the value settles, so a
 * cheap live redraw (the edge reducer) can be separated from an expensive one
 * (rebuilding the graph for node size).
 */
export function sliderRow(
  parent: HTMLElement,
  label: string,
  range: SliderRange,
  value: number,
  onCommit: (value: number) => void,
  options: {
    readonly unit?: string;
    readonly number?: boolean;
    readonly onPreview?: (value: number) => void;
  } = {},
): HTMLElement {
  const row = parent.createDiv({ cls: "enhanced-graph-slider" });
  row.createSpan({ cls: "enhanced-graph-slider-label", text: label });

  const input = row.createEl("input", { type: "range", cls: "enhanced-graph-slider-range" });
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);

  const unit = options.unit ?? "%";
  // Percent-style controls show 50…200; unit-less ones show the raw number.
  const display = (raw: number): string =>
    unit === "%" ? String(Math.round(raw * 100)) : String(Math.round(raw * 100) / 100);

  const readout = row.createSpan({ cls: "enhanced-graph-slider-value" });
  let field: HTMLInputElement | null = null;

  const paint = (raw: number): void => {
    const text = display(raw);
    readout.setText(unit === "%" ? `${text}%` : text);
    if (field && document.activeElement !== field) field.value = text;
  };
  paint(value);

  const sync = (raw: number): void => {
    paint(raw);
    if (field) field.value = display(raw);
  };

  input.addEventListener("input", () => {
    const raw = Number(input.value);
    sync(raw);
    options.onPreview?.(raw);
  });
  input.addEventListener("change", () => onCommit(Number(input.value)));

  if (options.number) {
    // The field works in the units it DISPLAYS. For a percent slider that is
    // percent, not the underlying 0…1 value: with the raw bounds the field showed
    // "100" while its own min/max were 0.5…2, so typing the number it was already
    // showing clamped it to 2.
    const scale = unit === "%" ? 100 : 1;
    const toDisplay = (raw: number): number => Math.round(raw * scale * 100) / 100;
    field = row.createEl("input", { type: "number", cls: "enhanced-graph-number" });
    field.min = String(toDisplay(range.min));
    field.max = String(toDisplay(range.max));
    field.step = String(toDisplay(range.step));
    field.value = display(value);
    field.addEventListener("change", () => {
      const parsed = Number(field?.value);
      if (!Number.isFinite(parsed)) {
        paint(Number(input.value));
        return;
      }
      const clamped = Math.min(range.max, Math.max(range.min, parsed / scale));
      input.value = String(clamped);
      sync(clamped);
      onCommit(clamped);
    });
  }

  return row;
}

/**
 * A labelled row with a number field and a stacked pair of step buttons.
 *
 * Used instead of {@link sliderRow} where the exact value matters more than
 * sweeping through a range — the relevance coefficients are compared against
 * each other, so "3.0" has to be typeable, and stepping by a known amount is
 * more useful than dragging to roughly the right place.
 *
 * `step` also fixes the number of decimals kept, so repeated stepping cannot
 * accumulate floating-point noise (0.1 + 0.2 → 0.30000000000000004).
 */
export function stepperRow(
  parent: HTMLElement,
  label: string,
  range: SliderRange,
  value: number,
  onChange: (value: number) => void,
  options: { readonly step?: number } = {},
): HTMLElement {
  const step = options.step ?? range.step;
  const decimals = (String(step).split(".")[1] ?? "").length;
  const tidy = (raw: number): number => {
    const clamped = Math.min(range.max, Math.max(range.min, raw));
    return Number(clamped.toFixed(decimals));
  };

  const row = parent.createDiv({ cls: "enhanced-graph-stepper" });
  row.createSpan({ cls: "enhanced-graph-slider-label", text: label });

  const field = row.createEl("input", { type: "number", cls: "enhanced-graph-number" });
  field.min = String(range.min);
  field.max = String(range.max);
  field.step = String(step);
  field.value = value.toFixed(decimals);

  const commit = (next: number): void => {
    const tidyValue = tidy(next);
    field.value = tidyValue.toFixed(decimals);
    onChange(tidyValue);
  };

  // Typing is committed on Enter and on blur, not on every keystroke: a partial
  // entry like "1" on the way to "1.5" would otherwise be applied and trigger a
  // rebuild.
  field.addEventListener("change", () => {
    const parsed = Number(field.value);
    if (!Number.isFinite(parsed)) {
      field.value = value.toFixed(decimals);
      return;
    }
    commit(parsed);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") field.blur();
  });

  const buttons = row.createDiv({ cls: "enhanced-graph-stepper-buttons" });
  const makeButton = (direction: "up" | "down"): void => {
    const button = buttons.createEl("button", {
      cls: "enhanced-graph-stepper-button",
      attr: { "aria-label": direction === "up" ? `increase ${label}` : `decrease ${label}` },
    });
    setIcon(button, direction === "up" ? "chevron-up" : "chevron-down");
    button.addEventListener("click", () => {
      // Read the field rather than the closure's `value`, so a typed-then-stepped
      // sequence starts from what is on screen.
      const current = Number(field.value);
      const base = Number.isFinite(current) ? current : value;
      commit(base + (direction === "up" ? step : -step));
    });
  };
  makeButton("up");
  makeButton("down");

  return row;
}

/**
 * Colour field: the platform picker (which is where the colour wheel lives)
 * plus a hex box for typing or pasting an exact value.
 *
 * `allowTheme` adds a "follow the theme" button, used for the edge ramp ends
 * where `null` is a meaningful choice rather than "no colour set".
 */
export function colourRow(
  parent: HTMLElement,
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: { readonly allowTheme?: boolean; readonly onTheme?: () => void; readonly isTheme?: boolean } = {},
): HTMLElement {
  const row = parent.createDiv({ cls: "enhanced-graph-colour-row" });
  row.createSpan({ cls: "enhanced-graph-slider-label", text: label });

  const picker = row.createEl("input", { type: "color", cls: "enhanced-graph-colour" });
  picker.value = value;
  picker.addEventListener("input", () => {
    hex.value = picker.value;
    onChange(picker.value);
  });

  const hex = row.createEl("input", { type: "text", cls: "enhanced-graph-hex" });
  hex.value = value;
  hex.spellcheck = false;
  const commitHex = (): void => {
    const normalised = normalizeHex(hex.value);
    if (!normalised) {
      hex.value = picker.value;
      return;
    }
    picker.value = normalised;
    hex.value = normalised;
    onChange(normalised);
  };
  hex.addEventListener("change", commitHex);

  if (options.allowTheme) {
    const button = row.createEl("button", {
      cls: `enhanced-graph-link${options.isTheme ? " is-active" : ""}`,
      text: "↺",
      attr: { "aria-label": "theme" },
    });
    button.addEventListener("click", () => options.onTheme?.());
  }

  return row;
}

/** `#abc` / `abc` / `#AABBCC` → `#aabbcc`; anything else → null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split("").map((c) => c + c).join("").toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}
