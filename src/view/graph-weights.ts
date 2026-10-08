/**
 * Weight panel: the four relevance coefficients, adjustable while looking at the
 * graph.
 *
 * These live in the Obsidian settings tab too, but tuning them there means
 * leaving the graph, changing a number, and coming back to see what happened.
 * Since the coefficients decide which links exist at all, the feedback loop
 * needs to be short.
 *
 * Changing any of them re-scores every pair in the vault, so a rebuild is
 * unavoidable — the panel says so rather than pretending the change is instant.
 * The view debounces it.
 *
 * Pure DOM, no state, no persistence: every control is a callback, matching
 * `graph-filters` and `graph-appearance`.
 */

import { t } from "../i18n";
import { DEFAULT_RELEVANCE_WEIGHTS, type RelevanceWeights } from "../types";
import { stepperRow } from "./controls";

/** Wide enough to reach "ignore this signal entirely" and "let it dominate". */
const WEIGHT_RANGE = { min: 0, max: 8, step: 0.1 } as const;

export interface WeightOptions {
  readonly weights: RelevanceWeights;
  readonly onChange: (key: keyof RelevanceWeights, value: number) => void;
  readonly onReset: () => void;
}

/** Renders the weight body after whatever the caller already put there. */
export function renderWeights(container: HTMLElement, options: WeightOptions): void {
  const entries: Array<[keyof RelevanceWeights, string]> = [
    ["directLink", t("settings.weight.directLink")],
    ["sourceOverlap", t("settings.weight.sourceOverlap")],
    ["commonNeighbor", t("settings.weight.commonNeighbor")],
    ["coCitation", t("settings.weight.coCitation")],
  ];

  const section = container.createDiv({ cls: "enhanced-graph-section" });
  for (const [key, label] of entries) {
    // A stepper rather than a slider: these coefficients are compared against
    // each other, so the exact figure has to be typeable and step-by-step
    // adjustment is more useful than sweeping a range.
    stepperRow(section, label, WEIGHT_RANGE, options.weights[key], (value) =>
      options.onChange(key, value),
    );
  }

  const hint = container.createDiv({ cls: "enhanced-graph-hint" });
  hint.setText(t("weights.hint"));

  const reset = container.createEl("button", {
    cls: "enhanced-graph-link",
    text: t("weights.reset"),
  });
  reset.addEventListener("click", () => options.onReset());

  // Report the defaults so "reset" is a verifiable destination rather than a
  // vague promise.
  const defaults = container.createDiv({ cls: "enhanced-graph-hint" });
  defaults.setText(
    t("weights.defaults", {
      directLink: DEFAULT_RELEVANCE_WEIGHTS.directLink.toFixed(1),
      sourceOverlap: DEFAULT_RELEVANCE_WEIGHTS.sourceOverlap.toFixed(1),
      commonNeighbor: DEFAULT_RELEVANCE_WEIGHTS.commonNeighbor.toFixed(1),
      coCitation: DEFAULT_RELEVANCE_WEIGHTS.coCitation.toFixed(1),
    }),
  );
}
