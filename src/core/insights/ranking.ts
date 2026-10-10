/**
 * Ranking: turning a pile of findings into a panel.
 *
 * The shipped engine ranked with a bare `score` and a fixed cap per list. That is
 * enough for one list and not enough for several, because the failure mode of an
 * insight panel is not too few cards but too many similar ones — the plan
 * measured precision falling from 60 % at the first card to 29 % by the
 * twentieth, so order and count *are* the quality knob.
 *
 * Three deliberate choices, each with its reason:
 *
 *  1. **Order by severity ÷ effort, not by score.** "Add one link" is a two-second
 *     action; "this cluster is fragmenting" is an afternoon. A list sorted by score
 *     alone interleaves them and reads as noise. The score is a tie-breaker, so the
 *     stronger of two equally cheap findings still wins.
 *  2. **No cross-analyser score normalisation.** Each analyser scores on its own
 *     scale — the migrated detectors use the engine's existing 0…6 additive scale —
 *     and those scales are not comparable. Making them comparable by normalising per
 *     vault is exactly the forced-positive failure: "strong" would come to mean "the
 *     best this vault has", so a vault with nothing worth showing would still
 *     produce a strong card. Severity and effort are the units that *are* comparable
 *     across analysers, so they do the ordering; `score` compares only within an
 *     analyser, where the scale is by definition the same.
 *  3. **An absolute confidence floor, and an empty result is legal.** Each analyser
 *     declares its own bands (see `Analyser.confidenceOf`), so the engine can say
 *     "nothing here clears the bar".
 */

import { FINDING_SECTION, type Finding } from "./model";

/**
 * The ordering, in three explicit steps.
 *
 * **Severity first, then effort, then score.** The plan said "order by severity ÷
 * effort", and the ratio is the wrong arithmetic: severity 2 with a one-click fix
 * scores 2/1 = 2, while severity 3 needing prose scores 3/4 = 0.75 — so a
 * tidiness suggestion outranks a single point of failure, which is the exact
 * inversion the ordering exists to prevent. Dividing by effort lets effort outweigh
 * severity by up to 4×, and no choice of divisor fixes that without making effort
 * meaningless.
 *
 * Severity is the property that decides whether the user should *care*; effort is
 * the property that decides which of the things they should care about to do
 * first. That is a lexicographic order, not a product. So:
 *
 *   1. severity, descending — a structural failure is never buried under a
 *      cosmetic one, whatever either costs;
 *   2. effort, ascending — within one severity, the cheap wins come first, which is
 *      the part of "severity ÷ effort" that was right;
 *   3. score, descending — the tie-break, normalised per analyser.
 *
 * Deterministic last, on analyser id and finding key: the panel re-renders on every
 * file save, and a list that reshuffles under the cursor is worse than a stale one.
 */
const EFFORT_ORDER: Readonly<Record<"one-click" | "edit" | "write", number>> = {
  "one-click": 0,
  edit: 1,
  write: 2,
};

/**
 * A finding's position within its severity band.
 *
 * Exposed for tests and for reasoning about the order; the comparator below is what
 * the ranker uses, because a single number cannot express a lexicographic order
 * without reintroducing the very trade-off this avoids.
 */
export function effortRank(finding: Finding): number {
  return EFFORT_ORDER[finding.effort];
}

/**
 * A finding's score as a 0…1 fraction of the range its analyser declared.
 *
 * Clamped rather than scaled: an analyser that emits more than it declared is a bug
 * in that analyser, and clamping keeps it from silently dominating its peers.
 */
export function normaliseScore(score: number, scoreRange = 1): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const range = Number.isFinite(scoreRange) && scoreRange > 0 ? scoreRange : 1;
  return Math.min(1, score / range);
}

export interface RankOptions {
  /** Drop findings whose analyser labelled them `weak`. Default false. */
  readonly dropWeak?: boolean;
  /** Hard ceiling on the returned list, applied after the per-analyser caps. */
  readonly totalLimit?: number;
  /**
   * Score range per analyser id, for normalisation.
   *
   * A missing entry means 1 — the model's standard scale — so an analyser that
   * does not declare a range is treated as emitting 0…1.
   */
  readonly scoreRanges?: ReadonlyMap<string, number>;
}

export interface RankResult {
  readonly ranked: readonly Finding[];
  /** Findings the per-analyser caps excluded, for diagnostics. */
  readonly droppedByCap: number;
}

/** The three-step order described above. */
export function compareFindings(
  a: Finding,
  b: Finding,
  scoreRanges?: ReadonlyMap<string, number>,
): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.effort !== b.effort) return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort];

  const rangeOf = (finding: Finding): number => scoreRanges?.get(finding.analyser) ?? 1;
  const byScore = normaliseScore(b.score, rangeOf(b)) - normaliseScore(a.score, rangeOf(a));
  if (byScore !== 0) return byScore;

  return compareStrings(a.analyser, b.analyser) || compareStrings(a.key, b.key);
}

/**
 * Rank findings and enforce the caps.
 *
 * The per-analyser cap is applied in ranked order, so the findings a cap drops are
 * that analyser's *weakest*, not whichever happened to come last.
 */
export function rankFindings(
  findings: readonly Finding[],
  caps: ReadonlyMap<string, number>,
  options: RankOptions = {},
): RankResult {
  const eligible = options.dropWeak
    ? findings.filter((finding) => finding.confidence !== "weak")
    : [...findings];

  eligible.sort((a, b) => compareFindings(a, b, options.scoreRanges));

  const usedPerAnalyser = new Map<string, number>();
  const ranked: Finding[] = [];
  let droppedByCap = 0;

  for (const finding of eligible) {
    const cap = caps.get(finding.analyser) ?? Number.POSITIVE_INFINITY;
    const used = usedPerAnalyser.get(finding.analyser) ?? 0;
    if (used >= cap) {
      droppedByCap += 1;
      continue;
    }
    usedPerAnalyser.set(finding.analyser, used + 1);
    if (options.totalLimit !== undefined && ranked.length >= options.totalLimit) {
      droppedByCap += 1;
      continue;
    }
    ranked.push(finding);
  }

  return { ranked, droppedByCap };
}

/** Default per-analyser caps, as a lookup the ranker can use directly. */
export function capsFrom(
  analysers: readonly { readonly id: string; readonly cap: number }[],
): Map<string, number> {
  return new Map(analysers.map((analyser) => [analyser.id, analyser.cap]));
}

/** Score ranges by analyser id, for `RankOptions.scoreRanges`. */
export function scoreRangesFrom(
  analysers: readonly { readonly id: string; readonly scoreRange?: number }[],
): Map<string, number> {
  const ranges = new Map<string, number>();
  for (const analyser of analysers) {
    if (analyser.scoreRange !== undefined) ranges.set(analyser.id, analyser.scoreRange);
  }
  return ranges;
}

/** The section a finding belongs to. */
export function sectionOf(finding: Finding): string {
  return FINDING_SECTION[finding.kind];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
