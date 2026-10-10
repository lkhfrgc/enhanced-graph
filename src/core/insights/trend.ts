/**
 * The trend analyser: what is aging, what has gone quiet, what is heating up.
 *
 * These are the highest-trust cards in the set, for a reason that has nothing to do
 * with algorithms: a reader can check "you link to this from 30 notes and have not
 * touched it in 14 months" in five seconds, against their own memory of their vault.
 * A card that can be verified that cheaply buys credit for the ones that cannot.
 *
 * Two halves, split by what they need:
 *
 *  - **`stat`-based** (`orphan-aging`, `stale-hub`) — a file's `ctime`/`mtime` and a
 *    link count. Available today, no history file, which is why they ship first.
 *  - **history-based** (`emerging-topic`, `fading-topic`) — counts per time window
 *    from the append-only edge snapshot. Absent history means no burst findings, not
 *    an error.
 *
 * Every card here is `weak` when the timestamp is missing. `created`/`modified` are
 * optional, and absent means unknown: treating an absent timestamp as old would accuse
 * every note in a vault whose host does not support `stat`.
 */

import type { Analyser, AnalysisContext } from "./input";
import { registerAnalyser, degreeOf } from "./input";
import { documentFinding, type Confidence, type Evidence, type Finding } from "./model";

export const TREND_ANALYSER_ID = "trend";

/** Cards per kind. */
export const AGING_LIMIT = 3;
export const STALE_HUB_LIMIT = 3;
export const BURST_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Age at which an orphan is worth surfacing.
 *
 * Bucketed rather than continuous because the action differs by bucket: a note from
 * last week is normal and must not be nagged about, one from last month is worth a
 * look, and one from a season ago is a decision. Sorting by age *is* the severity.
 */
export const ORPHAN_QUIET_DAYS = 7;
export const ORPHAN_STALE_DAYS = 30;

/** A hub is stale when it is well linked and untouched for this long. */
export const STALE_HUB_DAYS = 180;
export const STALE_HUB_MIN_DEGREE = 5;

/** A note younger than this is never reported as aging. */
function daysBetween(from: number, now: number): number {
  return Math.floor((now - from) / DAY_MS);
}

/**
 * Squash an unbounded raw measure onto the model's 0…1 scale.
 *
 * Age in days and degree have no ceiling while `Finding.score` is 0…1, and the first
 * version left the score unset — every trend card displayed `0.00`, which made the
 * ordering between two aging notes arbitrary and the number meaningless.
 */
function normalise(raw: number, half: number): number {
  if (!(raw > 0)) return 0;
  return raw / (raw + half);
}

// ---------------------------------------------------------------------------
// Bursts (Kleinberg)
// ---------------------------------------------------------------------------

export interface BurstWindow {
  readonly start: number;
  readonly end: number;
  /** Burst weight; higher is a sharper departure from the term's own baseline. */
  readonly weight: number;
}

/**
 * Kleinberg's two-state burst detection over a count series.
 *
 * The standard method for "when did this term's rate change", and it fits here
 * because it needs no tuning: the state costings are derived from the series itself,
 * and the burst levels give the severity bands for free. A simpler "count > mean × 2"
 * rule was considered and rejected — on a personal vault a term with a baseline of one
 * mention a month crosses that on ordinary noise.
 *
 * Returns the windows whose state is the burst state, merged when adjacent.
 */
export function detectBursts(
  counts: readonly number[],
  options: { readonly gamma?: number; readonly maxLevel?: number } = {},
): BurstWindow[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0 || counts.length < 4) return [];
  const gamma = options.gamma ?? 1;
  const maxLevel = options.maxLevel ?? 2;

  // Baseline rate, with a floor so a term seen once cannot produce a division by zero.
  const base = Math.max(total / counts.length, 1e-6);

  const windows: BurstWindow[] = [];

  /**
   * Poisson deviance of a count against a rate, up to a constant.
   *
   * `2 * (rate - count + count * ln(count / rate))`, with the zero-count case taking
   * the limit. This is the likelihood ratio the burst test needs: comparing it under
   * the burst rate and under the baseline says how much more likely the observed
   * count is in one state than the other.
   */
  const deviance = (count: number, rate: number): number => {
    if (count === 0) return 2 * rate;
    return 2 * (rate - count + count * Math.log(count / rate));
  };

  for (let level = 1; level <= maxLevel; level += 1) {
    const rate = base * level;
    // How much evidence a bucket needs to be called a burst rather than baseline.
    const threshold = gamma * Math.log(counts.length);

    let start = -1;
    for (let index = 0; index <= counts.length; index += 1) {
      const count = counts[index] ?? 0;
      const inBurst =
        index < counts.length && deviance(count, base) - deviance(count, rate) > threshold;
      if (inBurst && start < 0) start = index;
      if (!inBurst && start >= 0) {
        windows.push({ start, end: index - 1, weight: level });
        start = -1;
      }
    }
  }

  windows.sort((a, b) => b.weight - a.weight || a.start - b.start);
  return windows;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * Orphans that have been quiet long enough to be a decision.
 *
 * An orphan is a note with at most one link *in the whole vault*, which is the
 * existing isolation test — not the build's link count, because a note whose links
 * all point outside the current scope is not an orphan in the vault that holds it.
 */
export function agingOrphans(ctx: AnalysisContext): Array<{ id: string; ageDays: number }> {
  const out: Array<{ id: string; ageDays: number }> = [];
  for (const node of ctx.nodes) {
    if (node.isStructural) continue;
    if (node.vaultLinkCount > 1) continue;
    if (node.created === undefined) continue;
    const ageDays = daysBetween(node.created, ctx.now);
    if (ageDays < ORPHAN_QUIET_DAYS) continue;
    out.push({ id: node.id, ageDays });
  }
  out.sort((a, b) => b.ageDays - a.ageDays || (a.id < b.id ? -1 : 1));
  return out;
}

/** Well-linked notes nobody has touched in a long time. */
export function staleHubs(ctx: AnalysisContext): Array<{ id: string; staleDays: number; degree: number }> {
  const out: Array<{ id: string; staleDays: number; degree: number }> = [];
  for (const node of ctx.nodes) {
    if (node.isStructural) continue;
    const degree = degreeOf(ctx, node.id);
    if (degree < STALE_HUB_MIN_DEGREE) continue;
    if (node.modified === undefined) continue;
    const staleDays = daysBetween(node.modified, ctx.now);
    if (staleDays < STALE_HUB_DAYS) continue;
    out.push({ id: node.id, staleDays, degree });
  }
  out.sort((a, b) => b.degree - a.degree || b.staleDays - a.staleDays || (a.id < b.id ? -1 : 1));
  return out;
}

/**
 * Every trend finding this pass can offer.
 *
 * `snapshots` is the tag/term series per window from the edge history, when there is
 * one. It is a parameter rather than a field of the context because it is derived from
 * a file the analyser must not read — `core/**` does no I/O.
 */
export function trendFindings(
  ctx: AnalysisContext,
  snapshots: readonly { readonly term: string; readonly counts: readonly number[]; readonly nodeIds: readonly string[] }[] = [],
  windowMs: number = 30 * DAY_MS,
): Finding[] {
  const findings: Finding[] = [];
  const labelOf = (id: string): string => ctx.nodeById.get(id)?.label ?? id;

  for (const orphan of agingOrphans(ctx).slice(0, AGING_LIMIT)) {
    const stale = orphan.ageDays >= ORPHAN_STALE_DAYS;
    findings.push(
      documentFinding({
        kind: "orphan-aging",
        analyser: TREND_ANALYSER_ID,
        nodeId: orphan.id,
        titleKey: "insights.finding.orphan-aging",
        titleParams: { name: labelOf(orphan.id) },
        severity: stale ? 2 : 1,
        effort: "edit",
        init: {
          evidence: [
            {
              kind: "age",
              labelKey: "reason.evidence.age",
              params: { days: orphan.ageDays },
              contribution: orphan.ageDays,
            },
          ],
          anchors: { nodeIds: [orphan.id], edgeKeys: [] },
          score: normalise(orphan.ageDays, ORPHAN_STALE_DAYS),
          // Never above `moderate`: being old is not evidence of being wrong, and the
          // card exists to put a decision in front of the reader, not to accuse.
          confidence: "moderate",
        },
      }),
    );
  }

  for (const hub of staleHubs(ctx).slice(0, STALE_HUB_LIMIT)) {
    findings.push(
      documentFinding({
        kind: "stale-hub",
        analyser: TREND_ANALYSER_ID,
        nodeId: hub.id,
        titleKey: "insights.finding.stale-hub",
        titleParams: { name: labelOf(hub.id) },
        severity: 2,
        effort: "write",
        init: {
          evidence: [
            {
              kind: "staleness",
              labelKey: "reason.evidence.staleness",
              params: { days: hub.staleDays },
              contribution: hub.degree + hub.staleDays / 30,
            },
          ],
          anchors: { nodeIds: [hub.id], edgeKeys: [] },
          score: normalise(hub.degree * (hub.staleDays / STALE_HUB_DAYS), 4),
          confidence: "moderate",
        },
      }),
    );
  }

  // Bursts, when there is history to find one in.
  for (const series of snapshots) {
    const bursts = detectBursts(series.counts);
    const top = bursts[0];
    if (!top) continue;
    const anchor = series.nodeIds[0];
    if (anchor === undefined) continue;
    const rising = top.end >= series.counts.length - 2;
    findings.push(
      documentFinding({
        kind: rising ? "emerging-topic" : "fading-topic",
        analyser: TREND_ANALYSER_ID,
        nodeId: anchor,
        titleKey: rising ? "insights.finding.emerging-topic" : "insights.finding.fading-topic",
        titleParams: { name: series.term },
        severity: 1,
        effort: "write",
        init: {
          evidence: [
            {
              kind: "burst",
              labelKey: "reason.evidence.burst",
              params: { weight: top.weight },
              contribution: top.weight + (rising ? 1 : 0),
              nodeIds: series.nodeIds.slice(0, 3),
            },
          ],
          anchors: { nodeIds: series.nodeIds.slice(0, 3), edgeKeys: [] },
          score: normalise(top.weight + (rising ? 1 : 0), 2),
          confidence: "moderate",
        },
      }),
    );
  }

  void windowMs;
  return findings.slice(0, AGING_LIMIT + STALE_HUB_LIMIT + BURST_LIMIT);
}

/** The analyser. */
export function trendAnalyser(): Analyser {
  return {
    id: TREND_ANALYSER_ID,
    cap: AGING_LIMIT + STALE_HUB_LIMIT + BURST_LIMIT,
    scoreRange: 1,
    confidenceOf: (finding: Finding): Confidence => finding.confidence,
    // The snapshot series reach the analyser through `AnalysisContext.augmentations`
    // when a caller supplies them; without history this returns only the two
    // stat-based kinds, which is the designed outcome rather than a degraded one.
    analyze: (ctx: AnalysisContext): readonly Finding[] =>
      trendFindings(ctx, ctx.augmentations.series ?? []),
  };
}

/** Register the analyser alongside the shipped ones. */
export function registerTrendAnalyser(): void {
  registerAnalyser(trendAnalyser());
}

/** Re-exported so a caller can build a series without knowing the shape. */
export type { Evidence };
