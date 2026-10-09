/**
 * Clustering panel: what the graph is *made of*, adjustable while looking at it.
 *
 * Two decisions live here, and they belong together because they are the two halves
 * of one answer. The four relevance coefficients decide how strongly each pair of
 * notes is tied, and therefore which pairs Louvain sees as close; the resolution
 * decides how finely it is willing to cut the result. Tuning either means leaving
 * the graph, changing a number, and coming back to see what happened — the feedback
 * loop has to be short.
 *
 * Both are BUILD inputs, not draw-time switches: changing either re-scores or
 * re-partitions the whole vault, which costs a rebuild. So the panel stages the
 * edits and applies them together on the button, exactly as the workspace does.
 * Everything else in the side panel can afford to act on click; this cannot.
 *
 * Pure DOM: every control reports through a callback and the draft is kept here
 * only so an unrelated repaint cannot throw a half-made edit away.
 */

import { t } from "../i18n";
import {
  MAX_RESOLUTION,
  MIN_RESOLUTION,
} from "../core/communities";
import { DEFAULT_RELEVANCE_WEIGHTS, type RelevanceWeights } from "../types";
import { stepperRow } from "./controls";

/** Wide enough to reach "ignore this signal entirely" and "let it dominate". */
const WEIGHT_RANGE = { min: 0, max: 8, step: 0.1 } as const;

/** The range the sweep on a real vault supported: below it everything merges. */
const RESOLUTION_RANGE = { min: MIN_RESOLUTION, max: MAX_RESOLUTION, step: 0.1 } as const;

export interface ClusteringChoice {
  readonly weights: RelevanceWeights;
  readonly resolution: number;
}

export interface ClusteringOptions {
  /**
   * What is currently applied — the thing the draft is compared against.
   *
   * A function, not a value: applying replaces the settings objects, so a snapshot
   * taken when the panel was built would compare the draft against a value that is
   * no longer in force and call itself clean.
   */
  readonly applied: () => ClusteringChoice;
  readonly onApply: (choice: ClusteringChoice) => void;
}

/**
 * The panel's own draft, or `null` while it follows what is applied.
 *
 * Module-level for the same reason the workspace's is: the side panel is re-rendered
 * whenever anything repaints it, and a half-made edit must survive that. `from` is
 * the applied choice the draft started from — both views share this module, so an
 * apply in one of them has to invalidate the other's draft rather than be shadowed.
 */
let draft: { weights: RelevanceWeights; resolution: number; from: string } | null = null;

function choiceKey(choice: ClusteringChoice): string {
  const { weights } = choice;
  return [
    weights.directLink,
    weights.sourceOverlap,
    weights.commonNeighbor,
    weights.coCitation,
    choice.resolution,
  ].join("\u0000");
}

/** Renders the clustering body after whatever the caller already put there. */
export function renderClustering(container: HTMLElement, options: ClusteringOptions): void {
  const applied = options.applied();
  const appliedKey = choiceKey(applied);
  if (draft === null || draft.from !== appliedKey) {
    draft = { weights: { ...applied.weights }, resolution: applied.resolution, from: appliedKey };
  }
  const current = draft;

  const section = container.createDiv({ cls: "enhanced-graph-section" });

  // --- the four coefficients ----------------------------------------------
  const entries: Array<[keyof RelevanceWeights, string]> = [
    ["directLink", t("settings.weight.directLink")],
    ["sourceOverlap", t("settings.weight.sourceOverlap")],
    ["commonNeighbor", t("settings.weight.commonNeighbor")],
    ["coCitation", t("settings.weight.coCitation")],
  ];
  for (const [key, label] of entries) {
    // A stepper rather than a slider: these coefficients are compared against
    // each other, so the exact figure has to be typeable and step-by-step
    // adjustment is more useful than sweeping a range.
    stepperRow(section, label, WEIGHT_RANGE, current.weights[key], (value) => {
      current.weights = { ...current.weights, [key]: value };
      sync();
    });
  }

  // --- how finely to cut ---------------------------------------------------
  stepperRow(
    section,
    t("clustering.resolution"),
    RESOLUTION_RANGE,
    current.resolution,
    (value) => {
      current.resolution = value;
      sync();
    },
  );
  section.createDiv({ cls: "enhanced-graph-hint", text: t("clustering.resolutionHint") });

  // --- apply ---------------------------------------------------------------
  const actions = container.createDiv({ cls: "enhanced-graph-workspace-actions" });
  const apply = actions.createEl("button", { cls: "enhanced-graph-button", text: t("clustering.apply") });
  const reset = actions.createEl("button", { cls: "enhanced-graph-link", text: t("clustering.reset") });
  // Restoring the defaults stages them rather than applying them: everything here
  // lands together on the button, and a control that quietly rebuilt the graph on
  // its own would be the one exception to that.
  const defaultsButton = actions.createEl("button", { cls: "enhanced-graph-link", text: t("clustering.defaults") });

  /** True while the draft would change what is applied. */
  const isDirty = (): boolean => choiceKey(current) !== appliedKey;

  function sync(): void {
    apply.disabled = !isDirty();
    reset.classList.toggle("is-hidden", !isDirty());
  }

  apply.addEventListener("click", () => {
    if (!isDirty()) return;
    const choice: ClusteringChoice = { weights: { ...current.weights }, resolution: current.resolution };
    // Back to following what is applied: the host writes these and rebuilds, and the
    // rebuild's repaint lands on the applied values.
    draft = null;
    options.onApply(choice);
  });

  reset.addEventListener("click", () => {
    draft = null;
    // Redrawn in place: the draft has to go back to the applied values, and only a
    // fresh render puts them there. Reusing the element keeps the `data-section` the
    // switcher and the checks read.
    container.empty();
    renderClustering(container, options);
  });

  defaultsButton.addEventListener("click", () => {
    current.weights = { ...DEFAULT_RELEVANCE_WEIGHTS };
    current.resolution = 1;
    // Staged through the module's draft rather than this render's closure: the host
    // re-renders the panel after an apply, and a click that arrived before that
    // re-render would otherwise write into an object the module no longer holds —
    // the redraw below would discard the staged defaults without a word. `from` is
    // set to the LIVE applied key so the draft is measured against what is in force.
    current.from = choiceKey(options.applied());
    draft = current;
    container.empty();
    renderClustering(container, options);
  });

  sync();

  const hint = container.createDiv({ cls: "enhanced-graph-hint" });
  hint.setText(t("clustering.hint"));

  // Report the defaults so "restore" is a verifiable destination rather than a
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
