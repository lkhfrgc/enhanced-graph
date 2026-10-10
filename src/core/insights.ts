/**
 * 图谱洞察 (graph insights) — the public entry point.
 *
 * This module used to hold the whole engine: two bespoke detectors, their scoring
 * constants, their dismiss-key rules and their Chinese card text. It is now the
 * composition of a small pipeline, and it keeps the same public surface so nothing
 * downstream had to change in the same step:
 *
 *   analyse → map to `Finding` → rank → group into sections → `InsightBundle`
 *
 * The pieces:
 *
 *  - `insights/connections.ts` — 惊奇连接 detection (moved, unchanged)
 *  - `insights/gaps.ts`        — 知识空白 detection (moved, unchanged)
 *  - `insights/model.ts`       — the one shape everything is expressed in
 *  - `insights/input.ts`       — what an analyser receives, and the registry
 *  - `insights/ranking.ts`     — ordering and the caps
 *  - `insights/sections.ts`    — grouping and dismissal
 *
 * Everything here is pure analysis over an already-built `WikiGraph` — no I/O and
 * no Obsidian imports — so the same engine runs from the tests, from the rebuild
 * pipeline and from the view without any host setup.
 *
 * `GraphInsights` is still returned, alongside the new {@link InsightBundle}, for
 * one migration step: `src/reports.ts`, the settings reset and the existing tests
 * read it. New code should read the bundle.
 */

import type {
  CommunityInfo,
  CoverageGap,
  GraphNode,
  UnexpectedLink,
  WikiGraph,
} from "../types";
import {
  CONTRIBUTION,
  DEFAULT_CONNECTION_LIMIT,
  DEFAULT_GAP_LIMIT,
  DEFAULT_MIN_SCORE,
  DISTANT_TYPE_PAIRS,
  ISOLATED_SUGGESTION,
  SPARSE_SUGGESTION,
  BRIDGE_SUGGESTION,
  LABEL_PREVIEW,
  MIN_BRIDGE_CLUSTERS,
  BRIDGE_LIMIT,
  connectionKey,
  rankUnexpectedLinks,
  toExistingLinkFinding,
  typePair,
  type InsightOptions,
} from "./insights/connections";
import {
  findBridgeNodes,
  findCoverageGaps,
  gapKey,
  isSparseCommunity,
  knowledgeGapKey,
  toGapFindings,
} from "./insights/gaps";
import {
  connectionsAnalyser,
  gapsAnalyser,
  registerDefaultAnalysers,
  CONNECTIONS_ANALYSER_ID,
  GAPS_ANALYSER_ID,
} from "./insights/analysers";
import {
  contentAnalyser,
  contentFindings,
  registerContentAnalyser,
  toMentionFinding,
  toMergeFinding,
  CONTENT_ANALYSER_ID,
  MENTION_LIMIT,
  MERGE_LIMIT,
} from "./insights/content";
import {
  capsFrom,
  compareFindings,
  effortRank,
  rankFindings,
  scoreRangesFrom,
  sectionOf,
  type RankOptions,
} from "./insights/ranking";
import { buildBundle, countUndismissed, visibleFindings, visibleSections } from "./insights/sections";
import {
  createContext,
  registerAnalyser,
  type GraphAugmentations,
  type InsightInput,
} from "./insights/input";
import {
  LINK_PREDICTION_ANALYSER_ID,
  MISSING_LINK_LIMIT,
  confidenceForMissingLink,
  linkPredictionAnalyser,
  linkPredictionFindings,
  registerLinkPredictionAnalyser,
} from "./insights/link-prediction";
import {
  STRUCTURE_ANALYSER_ID,
  clusterGateways,
  constraint,
  coreNumbers,
  cutAnalysis,
  registerStructureAnalyser,
  structureAnalyser,
  structureFindings,
} from "./insights/structure";
import {
  TREND_ANALYSER_ID,
  agingOrphans,
  detectBursts,
  registerTrendAnalyser,
  staleHubs,
  trendAnalyser,
  trendFindings,
} from "./insights/trend";
import { EMPTY_BUNDLE, type Finding, type InsightBundle } from "./insights/model";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { InsightOptions } from "./insights/connections";
export type { InsightInput } from "./insights/input";
export type { RankOptions } from "./insights/ranking";

/**
 * Options for a full analysis: the detector knobs plus the state the bundle needs.
 *
 * Deliberately flat rather than nested, because the previous signature was
 * `analyzeGraph(graph, { connectionLimit, gapLimit, minScore })` and keeping those
 * three names at the top level means an existing caller does not have to change to
 * keep working.
 */
export interface AnalyzeOptions extends InsightOptions {
  /**
   * Findings from the previous analysis, for the "changed" list.
   *
   * Dismissal is deliberately **not** an input: the bundle is cached, so splitting
   * on a key set here would freeze that set at build time and a dismissal would not
   * take effect until something rebuilt. The view applies `visibleSections` /
   * `visibleFindings` against its live settings instead.
   */
  readonly previous?: InsightBundle;
  /** Drop findings an analyser labelled `weak`. */
  readonly dropWeak?: boolean;
  /** Caps the missing-link analyser's contribution. */
  readonly missingLinkLimit?: number;
  /**
   * Signals the graph does not carry: timestamps and per-window count series.
   *
   * Optional so every existing caller keeps working, and so a test can exercise the
   * trend analysers without a filesystem.
   */
  readonly augmentations?: GraphAugmentations;
}

/**
 * The legacy shape, kept while the migration finishes.
 *
 * `connections` and `gaps` are exactly what `analyzeGraph` returned before this
 * refactor, so `reports.ts` and the 31 existing engine tests keep working.
 *
 * `bundle` is what new code should read. It is **optional** on purpose: every
 * existing fixture across the test suite builds `{ connections, gaps }` by hand,
 * and making the field required would have forced ~40 mechanical edits to files
 * that are asserting behaviour this refactor deliberately did not change. A caller
 * that would rather not handle `undefined` should use {@link analyzeBundle} or
 * {@link GraphInsights.bundle} on a value it got from `analyzeGraph`, which always
 * sets it.
 */
export interface GraphInsights {
  readonly connections: readonly UnexpectedLink[];
  readonly gaps: readonly CoverageGap[];
  /** The new model. Always present on a value returned by `analyzeGraph`. */
  readonly bundle?: InsightBundle;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the shipped analysers over a graph.
 *
 * Both the legacy arrays and the new bundle come out of this one call. The two
 * detectors are run directly rather than through the registry because this
 * function's signature is part of the previous public surface — it took a graph
 * and an option bag, and it still does. The registry (`registerAnalyser`,
 * `registerDefaultAnalysers`) is the extension seam for analysers added in later
 * phases; a caller that wants it drives `listAnalysers()` itself.
 */
export function analyzeGraph(graph: WikiGraph, options: AnalyzeOptions = {}): GraphInsights {
  const input: InsightInput = {
    graph,
    ...(options.previous ? { previous: options.previous } : {}),
    ...(options.augmentations ? { augmentations: options.augmentations } : {}),
  };
  const ctx = createContext(input);
  const analysers = [
    connectionsAnalyser(options),
    gapsAnalyser(options),
    contentAnalyser(),
    linkPredictionAnalyser(options.missingLinkLimit),
    structureAnalyser(),
    trendAnalyser(),
  ];

  // The legacy arrays are produced by the same calls the analysers make, so a
  // migration cannot report one thing in `connections` and another on a card.
  const connections = rankUnexpectedLinks(graph, options);
  const gaps = findCoverageGaps(graph, options);
  // Content findings come from the context's index, which the builder attached to
  // the graph while the parsed bodies were in memory.
  const content = contentFindings(ctx, ctx.content);

  const findings: Finding[] = [
    ...connections.map((connection) =>
      toExistingLinkFinding(
        connection,
        (id) => ctx.neighbours.get(id) ?? EMPTY_NEIGHBOURS,
        (id) => ctx.neighbours.get(id)?.size ?? 0,
      ),
    ),
    ...toGapFindings(gaps),
    ...content,
    ...linkPredictionFindings(ctx, options.missingLinkLimit),
    ...structureFindings(ctx),
    ...trendFindings(ctx, ctx.augmentations.series ?? []),
  ];

  const { ranked, droppedByCap } = rankFindings(findings, capsFrom(analysers), {
    ...(options.dropWeak !== undefined ? { dropWeak: options.dropWeak } : {}),
    scoreRanges: scoreRangesFrom(analysers),
  });
  const bundle = buildBundle(ranked, {
    ...(options.previous ? { previous: options.previous } : {}),
    droppedByCap,
  });

  return Object.freeze({ connections: Object.freeze(connections), gaps: Object.freeze(gaps), bundle });
}

/** The bundle alone, for callers that have finished migrating. */
export function analyzeBundle(graph: WikiGraph, options: AnalyzeOptions = {}): InsightBundle {
  // `analyzeGraph` always sets it; the fallback keeps the return type non-optional
  // for callers rather than making every one of them handle `undefined`.
  return analyzeGraph(graph, options).bundle ?? EMPTY_BUNDLE;
}

// ---------------------------------------------------------------------------
// Re-exports: the surface this module had before the pipeline was extracted
// ---------------------------------------------------------------------------

export {
  BRIDGE_LIMIT,
  BRIDGE_SUGGESTION,
  CONNECTIONS_ANALYSER_ID,
  CONTENT_ANALYSER_ID,
  CONTRIBUTION,
  DEFAULT_CONNECTION_LIMIT,
  DEFAULT_GAP_LIMIT,
  DEFAULT_MIN_SCORE,
  DISTANT_TYPE_PAIRS,
  EMPTY_BUNDLE,
  GAPS_ANALYSER_ID,
  ISOLATED_SUGGESTION,
  LABEL_PREVIEW,
  MENTION_LIMIT,
  MERGE_LIMIT,
  MIN_BRIDGE_CLUSTERS,
  SPARSE_SUGGESTION,
  buildBundle,
  compareFindings,
  connectionKey,
  contentAnalyser,
  contentFindings,
  countUndismissed,
  effortRank,
  findBridgeNodes,
  findCoverageGaps,
  gapKey,
  isSparseCommunity,
  knowledgeGapKey,
  rankFindings,
  rankUnexpectedLinks,
  registerAnalyser,
  registerContentAnalyser,
  registerDefaultAnalysers,
  scoreRangesFrom,
  sectionOf,
  toMentionFinding,
  toMergeFinding,
  typePair,
  visibleFindings,
  visibleSections,
};

export type {
  CommunityInfo,
  GraphNode,
  InsightBundle,
  Finding,
  RankOptions as RankingOptions,
};

const EMPTY_NEIGHBOURS: ReadonlySet<string> = new Set();
