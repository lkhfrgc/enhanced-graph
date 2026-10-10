/**
 * The link-prediction analyser: pairs that look connected but are not.
 *
 * Distinct from `connections.ts`, which ranks links the author already wrote and caps
 * at "interesting existing link". Here the candidates are pairs with **no** link, and
 * the question is whether one belongs. The plan measured what that question is worth
 * on a real vault before committing to it — see `docs/graph-insights-plan.md` §3.2 and
 * §8.2 — and the answer is that local indices score about 12× chance while drawing
 * their top results from the densest, most hub-routed part of the graph.
 *
 * Two consequences are built in from the start rather than discovered later:
 *
 *  - **Every candidate is checked against the existing link set**, in either
 *    direction, so the analyser can never propose a link that is already there.
 *  - **The evidence names its hubs.** `params.maxDegree` records the highest degree
 *    among the shared neighbours, so a card built on index pages says so instead of
 *    reading like a discovery.
 *
 * The candidate pool is bounded by *sampling* expansions, never by deleting pairs: a
 * degree cap removes reachable links (measured: 92.9 % coverage falls to 60.5 % at a
 * cap of 10) while P@K rises, which is the one failure mode the ranking metric cannot
 * see.
 */

import type { Analyser, AnalysisContext } from "./input";
import { registerAnalyser } from "./input";
import { degreeOf } from "./input";
import { pairFinding, type Confidence, type Evidence, type Finding } from "./model";
import { edgeKey } from "../graph-keys";

export const LINK_PREDICTION_ANALYSER_ID = "link-prediction";

/** Candidates offered per analysis. */
export const MISSING_LINK_LIMIT = 6;

/**
 * Degree above which an expansion is sampled rather than walked exhaustively.
 *
 * The pool grows as the sum of neighbour degrees, so one hub with hundreds of links
 * dominates the work. Sampling keeps the cost bounded without deleting a class of
 * pairs; the cap is on work, not on which links may be found.
 */
export const EXPANSION_DEGREE_BUDGET = 64;

/**
 * Minimum score to offer a card.
 *
 * On the model's 0…1 scale. An absolute bar, not a percentile: a percentile would
 * guarantee a "strong" card in a vault with nothing worth showing, which is the
 * failure the confidence bands exist to avoid.
 */
export const MIN_MISSING_LINK_SCORE = 0.2;

/** Bands for the composite score. */
const STRONG_SCORE = 0.6;
const MODERATE_SCORE = 0.35;

export function confidenceForMissingLink(score: number): Confidence {
  if (score >= STRONG_SCORE) return "strong";
  if (score >= MODERATE_SCORE) return "moderate";
  return "weak";
}

interface Signals {
  /** Shared neighbours weighted by 1 / log(degree) — rare shared pages count more. */
  readonly adamicAdar: number;
  /** Shared neighbours weighted by 1 / degree. */
  readonly resourceAllocation: number;
  /** Raw shared-neighbour count, the fact a reader can check without arithmetic. */
  readonly commonNeighbours: number;
  /** Highest degree among the shared neighbours, so a hub can be named. */
  readonly maxSharedDegree: number;
  /** The shared neighbours themselves, rarest first, for the evidence line. */
  readonly shared: readonly string[];
}

/** Local link-prediction signals for one unlinked pair. */
export function signalsFor(a: string, b: string, ctx: AnalysisContext): Signals {
  const left = ctx.neighbours.get(a);
  const right = ctx.neighbours.get(b);
  if (!left || !right) {
    return { adamicAdar: 0, resourceAllocation: 0, commonNeighbours: 0, maxSharedDegree: 0, shared: [] };
  }
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];

  let adamicAdar = 0;
  let resourceAllocation = 0;
  let commonNeighbours = 0;
  let maxSharedDegree = 0;
  const shared: string[] = [];

  for (const id of small) {
    if (!large.has(id)) continue;
    if (id === a || id === b) continue;
    const degree = Math.max(degreeOf(ctx, id), 2);
    commonNeighbours += 1;
    adamicAdar += 1 / Math.log(degree);
    resourceAllocation += 1 / degree;
    maxSharedDegree = Math.max(maxSharedDegree, degree);
    shared.push(id);
  }

  shared.sort((x, y) => degreeOf(ctx, x) - degreeOf(ctx, y) || (x < y ? -1 : 1));
  return { adamicAdar, resourceAllocation, commonNeighbours, maxSharedDegree, shared };
}

/**
 * The candidate pairs: two hops apart, not already linked.
 *
 * Undirected and de-duplicated. An expansion whose middle page is a hub — beyond
 * {@link EXPANSION_DEGREE_BUDGET} — is sampled rather than skipped, so the pool
 * degrades in size instead of losing a category of pairs.
 */
export function candidatePairs(ctx: AnalysisContext): Array<readonly [string, string]> {
  const seen = new Set<string>();
  const pairs: Array<readonly [string, string]> = [];

  for (const node of ctx.nodes) {
    const first = ctx.neighbours.get(node.id);
    if (!first || first.size === 0) continue;
    for (const middle of first) {
      const second = ctx.neighbours.get(middle);
      if (!second) continue;
      // A hub is sampled: the first EXPANSION_DEGREE_BUDGET neighbours are walked
      // deterministically, so two builds of an unchanged vault agree.
      const budget = second.size > EXPANSION_DEGREE_BUDGET ? EXPANSION_DEGREE_BUDGET : second.size;
      let walked = 0;
      for (const candidate of second) {
        walked += 1;
        if (walked > budget) break;
        if (candidate === node.id || candidate === middle) continue;
        // Already connected either way: never propose an existing link.
        if (first.has(candidate)) continue;
        const key = edgeKey(node.id, candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(node.id < candidate ? [node.id, candidate] : [candidate, node.id]);
      }
    }
  }
  return pairs;
}

/**
 * Combine the raw signals into one 0…1 score.
 *
 * Saturating rather than scaling, so the score stays bounded however many shared
 * neighbours a pair has, and so a pair with two shared pages cannot outrank the
 * comparison between two others. The weights are stated rather than fitted: the plan
 * measured that the available data cannot separate candidates this close (three
 * signals, confidence intervals touching zero), so fitting would be overfitting with
 * extra steps.
 */
export function scoreSignals(signals: Signals): number {
  const saturate = (value: number): number => value / (1 + value);
  const common = Math.min(1, signals.commonNeighbours / 3);
  return (
    0.45 * saturate(signals.adamicAdar) +
    0.35 * saturate(signals.resourceAllocation) +
    0.2 * common
  );
}

/** Turn a scored pair into a finding. */
export function toMissingLinkFinding(
  a: string,
  b: string,
  signals: Signals,
  score: number,
  ctx: AnalysisContext,
): Finding {
  const labelOf = (id: string): string => ctx.nodeById.get(id)?.label ?? id;
  const named = signals.shared.slice(0, 3);

  const evidence: Evidence[] = [];
  if (signals.commonNeighbours > 0) {
    evidence.push({
      kind: "shared-neighbour",
      labelKey: "reason.evidence.shared-neighbour",
      params: {
        count: signals.commonNeighbours,
        omitted: Math.max(0, signals.shared.length - named.length),
        maxDegree: signals.maxSharedDegree,
      },
      contribution: Math.max(1, signals.commonNeighbours),
      nodeIds: named,
    });
  }

  return pairFinding({
    kind: "missing-link",
    analyser: LINK_PREDICTION_ANALYSER_ID,
    a,
    b,
    titleKey: "insights.finding.missing-link",
    titleParams: { a: labelOf(a), b: labelOf(b) },
    init: {
      evidence,
      anchors: { nodeIds: [a, b], edgeKeys: [edgeKey(a, b)] },
      score,
      confidence: confidenceForMissingLink(score),
      // Not severity 3: a missing link is an opportunity, not a failure. Reserving the
      // top band keeps structural findings above it.
      severity: 2,
      effort: "one-click",
      action: {
        kind: "insert-wikilink",
        sourceId: a,
        targetId: b,
        text: `[[${basenameOf(ctx, b)}]]`,
      },
    },
  });
}

/** The target's file name, which is the key a wikilink resolves through. */
function basenameOf(ctx: AnalysisContext, id: string): string {
  const file = (ctx.nodeById.get(id)?.path ?? id).split("/").pop() ?? id;
  return file.replace(/\.md$/i, "");
}

/**
 * The scored candidates, strongest first. Pure function of the context, so the
 * analyser and the pipeline produce the same list from the same call.
 */
export function linkPredictionFindings(
  ctx: AnalysisContext,
  limit: number = MISSING_LINK_LIMIT,
): Finding[] {
  const scored: Array<{ a: string; b: string; signals: Signals; score: number }> = [];
  for (const [a, b] of candidatePairs(ctx)) {
    const signals = signalsFor(a, b, ctx);
    const score = scoreSignals(signals);
    if (score < MIN_MISSING_LINK_SCORE) continue;
    scored.push({ a, b, signals, score });
  }
  scored.sort(
    (x, y) => y.score - x.score || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.b < y.b ? -1 : 1),
  );
  return scored
    .slice(0, limit)
    .map((entry) => toMissingLinkFinding(entry.a, entry.b, entry.signals, entry.score, ctx));
}

/**
 * The analyser.
 *
 * Returns nothing when there is no pair worth offering — a vault with no two-hop
 * pairs, or none above the bar. That is the designed outcome, not a failure.
 */
export function linkPredictionAnalyser(limit: number = MISSING_LINK_LIMIT): Analyser {
  return {
    id: LINK_PREDICTION_ANALYSER_ID,
    cap: limit,
    scoreRange: 1,
    confidenceOf: (finding: Finding): Confidence => finding.confidence,
    analyze: (ctx: AnalysisContext): readonly Finding[] => linkPredictionFindings(ctx, limit),
  };
}

/** Register the analyser alongside the shipped ones. */
export function registerLinkPredictionAnalyser(): void {
  registerAnalyser(linkPredictionAnalyser());
}
