/**
 * The two migrated analysers, wired to the registry.
 *
 * Each one delegates to the detector that already existed (`rankUnexpectedLinks`,
 * `findCoverageGaps`) and then maps its output into `Finding`s. Keeping detection
 * and presentation apart in this direction is what makes the migration
 * behaviour-preserving: the detectors are untouched and still pinned by their own
 * tests, while everything downstream sees one shape.
 *
 * `cap` is the per-analyser ceiling the ranker enforces. Both values match the
 * limits the engine shipped with, so a migration cannot silently change how many
 * cards a vault produces.
 */

import type { Analyser, AnalysisContext } from "./input";
import { registerAnalyser } from "./input";
import {
  DEFAULT_CONNECTION_LIMIT,
  DEFAULT_GAP_LIMIT,
  confidenceForScore,
  rankUnexpectedLinks,
  toExistingLinkFinding,
  type InsightOptions,
} from "./connections";
import { findCoverageGaps, toGapFindings } from "./gaps";
import type { Confidence, Finding } from "./model";

export const CONNECTIONS_ANALYSER_ID = "connections";
export const GAPS_ANALYSER_ID = "gaps";

/**
 * The surprise score's range: the sum of every `CONTRIBUTION` weight.
 *
 * Written out rather than computed so a change to a weight is a visible edit here
 * too — the value is what keeps a raw 0…6 score from being read as a 0…1 score by
 * the ranker, which is the bug the ranking test caught.
 */
export const SURPRISE_SCORE_RANGE = 6;

/**
 * Bands for the gap detectors.
 *
 * The gap findings carry no comparable numeric scale of their own — they are
 * structural facts (this many orphans, this cluster's cohesion) rather than
 * scored pairs — so they are banded by what they mean. `moderate` is the honest
 * label for all three: each is a real structural observation, and none of them is
 * strong enough evidence to claim a page is broken. Nothing here is `strong`, and
 * that is the point: the band exists so an analyser *can* decline to be confident.
 */
function gapConfidence(): Confidence {
  return "moderate";
}

/** The 惊奇连接 analyser: existing links worth a second look. */
export function connectionsAnalyser(options: InsightOptions = {}): Analyser {
  return {
    id: CONNECTIONS_ANALYSER_ID,
    cap: options.connectionLimit ?? DEFAULT_CONNECTION_LIMIT,
    scoreRange: SURPRISE_SCORE_RANGE,
    confidenceOf: (finding: Finding): Confidence => confidenceForScore(finding.score),
    analyze: (ctx: AnalysisContext): readonly Finding[] => {
      const connections = rankUnexpectedLinks(ctx.graph, options);
      const neighboursOf = (id: string): ReadonlySet<string> =>
        ctx.neighbours.get(id) ?? EMPTY_SET;
      const degreeOf = (id: string): number => ctx.neighbours.get(id)?.size ?? 0;
      return connections.map((connection) =>
        toExistingLinkFinding(connection, neighboursOf, degreeOf),
      );
    },
  };
}

/** The 知识空白 analyser: orphans, loose clusters and the bridges between them. */
export function gapsAnalyser(options: InsightOptions = {}): Analyser {
  return {
    id: GAPS_ANALYSER_ID,
    cap: options.gapLimit ?? DEFAULT_GAP_LIMIT,
    confidenceOf: gapConfidence,
    analyze: (ctx: AnalysisContext): readonly Finding[] =>
      toGapFindings(findCoverageGaps(ctx.graph, options)),
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Register the shipped analysers.
 *
 * Exported separately from the analyser factories so a test can register a stub
 * instead, and so registration order is stated in one place — it is the tie-break
 * the ranker uses when two findings score identically.
 */
export function registerDefaultAnalysers(options: InsightOptions = {}): void {
  registerAnalyser(connectionsAnalyser(options));
  registerAnalyser(gapsAnalyser(options));
}
