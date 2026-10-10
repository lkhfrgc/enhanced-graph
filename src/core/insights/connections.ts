/**
 * The 惊奇连接 detector, moved out of `core/insights.ts` unchanged.
 *
 * Keeping the algorithm byte-for-byte identical matters: its behaviour is pinned
 * by `test/insights.test.ts` (31 tests with exact scores), and this refactor is
 * meant to change where the output is *shaped*, not what it says. The new
 * `core/insights.ts` re-exports these symbols, so those tests stay meaningful.
 *
 * What is added here is a mapping into the shared `Finding` shape, built from
 * `contributions` — the per-signal amounts the detector already computed and that
 * the panel previously rendered only as a number.
 */

import type { ConnectionReason, GraphNode, UnexpectedLink, WikiGraph } from "../../types";
import { pairFinding, type Evidence, type Finding } from "./model";
import {
  computeGraphDensity,
  isSparseCommunity as isSparseFromMetrics,
} from "../communities";
import { edgeKey } from "../graph-keys";

export interface InsightOptions {
  /** Max surprising connections returned. Default 6. */
  readonly connectionLimit?: number;
  /** Max knowledge gaps returned. Default 10. */
  readonly gapLimit?: number;
  /** Minimum composite surprise score. Default 3. */
  readonly minScore?: number;
}

export const DEFAULT_CONNECTION_LIMIT = 6;
export const DEFAULT_GAP_LIMIT = 10;
export const DEFAULT_MIN_SCORE = 3;

/** Labels inlined in a gap description before it is summarised as "等 N 个". */
export const LABEL_PREVIEW = 5;
/** Neighbour clusters a page must span before it counts as a bridge. */
export const MIN_BRIDGE_CLUSTERS = 3;
/** Bridges reported per analysis; more than this is noise, not insight. */
export const BRIDGE_LIMIT = 3;

/** Per-signal weights of the composite surprise score. */
export const CONTRIBUTION: Readonly<Record<ConnectionReason, number>> = {
  "cross-community": 3,
  "distant-types": 2,
  "cross-type": 1,
  "peripheral-hub": 2,
  "weak-tie": 1,
  "source-overlap": 2,
};

/** Unordered type pair, so lookups do not depend on edge direction. */
export function typePair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Type combinations that rarely share vocabulary — the most interesting edges. */
export const DISTANT_TYPE_PAIRS: ReadonlySet<string> = new Set([
  typePair("source", "concept"),
  typePair("source", "synthesis"),
  typePair("query", "entity"),
  typePair("source", "thesis"),
  typePair("source", "methodology"),
]);

export const ISOLATED_SUGGESTION =
  "这些页面几乎没有关联，建议在正文中补充 [[wikilinks]] 指向相关主题，先建立连接再逐步扩充内容。";
export const SPARSE_SUGGESTION =
  "该领域内部交叉引用不足，建议在这些页面之间补充 [[wikilinks]]，把同一主题的笔记串联起来。";
export const BRIDGE_SUGGESTION =
  "这是跨领域的关键枢纽，建议保持内容更新与完整，并持续补充指向各个集群的 [[wikilinks]]。";

/** Stable dismiss key for a connection card; see {@link edgeKey}. */
export function connectionKey(a: string, b: string): string {
  return edgeKey(a, b);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Score every edge by how unexpected its endpoints are together and keep the
 * strongest ones. Signals are additive so a card can explain *why* a pair was
 * surfaced via `contributions`.
 */
export function rankUnexpectedLinks(
  graph: WikiGraph,
  options: InsightOptions = {},
): UnexpectedLink[] {
  const limit = resolveLimit(options.connectionLimit, DEFAULT_CONNECTION_LIMIT);
  if (limit === 0 || graph.edges.length === 0) return [];

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const nodeById = resolveDetectorNodes(graph);
  let maxDegree = 1;
  for (const node of uniqueDetectorNodes(graph)) maxDegree = Math.max(maxDegree, node.linkCount);

  const seen = new Set<string>();
  const scored: UnexpectedLink[] = [];

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    if (source.isStructural || target.isStructural) continue;

    // Multi-edges and reversed duplicates describe one relationship, and a
    // duplicate card would inflate the ranking with the same pair.
    const key = connectionKey(source.id, target.id);
    if (seen.has(key)) continue;
    seen.add(key);

    const reasons: ConnectionReason[] = [];
    const contributions: Partial<Record<ConnectionReason, number>> = {};
    const add = (reason: ConnectionReason): void => {
      contributions[reason] = (contributions[reason] ?? 0) + CONTRIBUTION[reason];
      reasons.push(reason);
    };

    if (source.community !== target.community) add("cross-community");

    if (source.type !== target.type) {
      // Exactly one of the two type signals fires, so the card can say either
      // "different types" or the stronger "distant types".
      add(DISTANT_TYPE_PAIRS.has(typePair(source.type, target.type)) ? "distant-types" : "cross-type");
    }

    const minDeg = Math.min(source.linkCount, target.linkCount);
    const maxDeg = Math.max(source.linkCount, target.linkCount);
    if (minDeg <= 2 && maxDeg >= maxDegree * 0.5) add("peripheral-hub");

    if (edge.weight > 0 && edge.weight < 2) add("weak-tie");

    // 来源重叠 is the heaviest association signal (weight 4.0); surfacing it
    // here explains why unrelated-looking pages ended up connected.
    if (edge.sharedSources.length >= 2) add("source-overlap");

    const score = reasons.reduce((sum, reason) => sum + CONTRIBUTION[reason], 0);
    if (reasons.length === 0 || score < minScore) continue;

    scored.push({ key, source, target, score, weight: edge.weight, reasons, contributions });
  }

  scored.sort(
    (a, b) => b.score - a.score || b.weight - a.weight || compareStrings(a.key, b.key),
  );
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Finding mapping
// ---------------------------------------------------------------------------

/**
 * Confidence bands for an existing-link card.
 *
 * Absolute cut points on the detector's own 0…6+ additive scale, kept here rather
 * than derived from the current vault's distribution: a percentile cut would
 * label the strongest of three weak cards "strong" in a vault that has nothing
 * worth showing, which is exactly the failure the cold-start rule guards against.
 */
const STRONG_SCORE = 5;
const MODERATE_SCORE = 3;

export function confidenceForScore(score: number): "strong" | "moderate" | "weak" {
  if (score >= STRONG_SCORE) return "strong";
  if (score >= MODERATE_SCORE) return "moderate";
  return "weak";
}

/**
 * Turn a scored connection into a finding.
 *
 * Two evidence decisions worth stating:
 *
 *  - **Named neighbours come first.** They are the most checkable fact on the
 *    card — "shares [[自注意力]] (degree 4)" can be verified in seconds — even
 *    though the structural signals carry larger weights. The named evidence is
 *    therefore given a contribution at least as large as the strongest structural
 *    reason, which is also what puts it at the top and sizes its bar.
 *  - **A hub is named as a hub.** The plan measured that a local-index ranking is
 *    overwhelmingly hub-routed; the evidence records each shared neighbour's
 *    degree in its params so a presenter can say "both are index pages" instead of
 *    letting an obvious pair read as a discovery.
 *
 * Named neighbours are capped at {@link MAX_NAMED_NEIGHBOURS}: the shared set can
 * be large, and a card that lists twelve pages by name is a wall, not evidence.
 * The count in `params` is always the true total.
 */
export function toExistingLinkFinding(
  connection: UnexpectedLink,
  neighboursOf: (id: string) => ReadonlySet<string>,
  degreeOf: (id: string) => number,
): Finding {
  const { source, target } = connection;
  const evidence: Evidence[] = [];

  const sourceNeighbours = neighboursOf(source.id);
  const targetNeighbours = neighboursOf(target.id);
  const sharedIds: string[] = [];
  for (const id of targetNeighbours) {
    if (id === source.id || id === target.id) continue;
    if (sourceNeighbours.has(id)) sharedIds.push(id);
  }
  if (sharedIds.length > 0) {
    // Rarest first: a shared page nothing else points at says far more about the
    // pair than a shared index page does.
    sharedIds.sort((a, b) => degreeOf(a) - degreeOf(b) || compareStrings(a, b));
    const named = sharedIds.slice(0, MAX_NAMED_NEIGHBOURS);
    const structural = Math.max(
      connection.contributions["cross-community"] ?? 0,
      connection.contributions["distant-types"] ?? 0,
    );
    evidence.push({
      kind: "shared-neighbour",
      labelKey: "reason.evidence.shared-neighbour",
      params: {
        count: sharedIds.length,
        // The presenter renders these by name with their degree; `params` carries
        // the count of pages that were too many to list.
        omitted: sharedIds.length - named.length,
        // Highest degree among the named pages, so a presenter can warn that the
        // whole claim rests on index pages without recomputing anything.
        maxDegree: named.reduce((max, id) => Math.max(max, degreeOf(id)), 0),
      },
      contribution: Math.max(named.length, structural),
      nodeIds: named,
    });
  }

  for (const reason of connection.reasons) {
    const contribution = connection.contributions[reason] ?? 0;
    switch (reason) {
      case "cross-community":
        evidence.push({
          kind: "community",
          labelKey: "reason.evidence.community",
          params: {},
          contribution,
        });
        break;
      case "distant-types":
      case "cross-type":
        evidence.push({
          kind: "type",
          labelKey: "reason.evidence.type",
          params: { a: source.type, b: target.type },
          contribution,
        });
        break;
      case "peripheral-hub":
      case "weak-tie":
        evidence.push({
          kind: "degree",
          labelKey: "reason.evidence.degree",
          params: {},
          contribution,
        });
        break;
      case "source-overlap": {
        const sharedSources = source.sources.filter((entry) => target.sources.includes(entry));
        evidence.push({
          kind: "shared-source",
          labelKey: "reason.evidence.shared-source",
          params: { count: sharedSources.length },
          contribution,
          nodeIds: sharedSources,
        });
        break;
      }
    }
  }

  return pairFinding({
    kind: "existing-link",
    analyser: "connections",
    a: source.id,
    b: target.id,
    titleKey: "insights.finding.existing-link",
    titleParams: { a: source.label, b: target.label },
    init: {
      evidence,
      anchors: { nodeIds: [source.id, target.id], edgeKeys: [connectionKey(source.id, target.id)] },
      score: connection.score,
      confidence: confidenceForScore(connection.score),
      severity: 1,
      effort: "one-click",
      action: { kind: "open-notes", nodeIds: [source.id, target.id] },
      detail: { kind: "existing-link", weight: connection.weight, hasDirectLink: true },
    },
  });
}

/** How many shared neighbours a card names before summarising the rest. */
export const MAX_NAMED_NEIGHBOURS = 3;

// ---------------------------------------------------------------------------
// Shared helpers (duplicated from the legacy module on purpose; see the header)
// ---------------------------------------------------------------------------

function resolveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function resolveDetectorNodes(graph: WikiGraph): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  for (const [id, node] of graph.nodeIndex) byId.set(id, node);
  return byId;
}

function uniqueDetectorNodes(graph: WikiGraph): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  return [...byId.values()];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Re-exported so `core/insights.ts` can keep its existing public surface. */
export { computeGraphDensity, isSparseFromMetrics };
