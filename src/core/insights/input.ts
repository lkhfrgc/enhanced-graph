/**
 * What an analyser is handed, and what the registry holds.
 *
 * The engine previously took a `WikiGraph` and nothing else, which is why it
 * could only ever reason about structure: the graph carries no note text and no
 * timestamps. New signals therefore arrive through {@link InsightInput} rather
 * than by widening `WikiGraph` — that type is rendered verbatim, frozen, and
 * persisted by the browser harness, so widening it would change three unrelated
 * things at once.
 *
 * Everything outside `graph` is optional, so an existing caller that passes only a
 * graph keeps working, and each analyser declares for itself what it needs.
 */

import type { GraphNode, WikiGraph } from "../../types";
import { contentIndexOf, type ContentIndex } from "../content-index";
import type { Confidence, Finding, InsightBundle } from "./model";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Signals that are derived rather than structural.
 *
 * Every field is optional and every analyser checks before using it, because the
 * same engine runs from the tests (graph only), the browser harness (graph only)
 * and the plugin (whatever the adapter could supply).
 */
export interface GraphAugmentations {
  /**
   * Timestamps per node id, from the vault's file stat.
   *
   * Absent means "the adapter has no timestamps", which must read as *unknown*,
   * never as *old*: an age finding derived from a missing timestamp would accuse
   * every note in the vault.
   */
  readonly timestamps?: ReadonlyMap<string, { readonly created: number; readonly modified: number }>;
  /**
   * Per-window count series, for burst detection.
   *
   * Supplied by the caller rather than read by the analyser: `core/**` does no I/O, so
   * the edge-history file is read in the plugin and handed in. Absent means no
   * history, and the burst analyser then returns nothing rather than guessing.
   */
  readonly series?: readonly {
    readonly term: string;
    readonly counts: readonly number[];
    readonly nodeIds: readonly string[];
  }[];
  /** Wall-clock milliseconds the analysis should treat as "now". */
  readonly now?: number;
}

export interface InsightInput {
  readonly graph: WikiGraph;
  readonly augmentations?: GraphAugmentations;
  /** Findings from the previous analysis, for change detection. */
  readonly previous?: InsightBundle;
}

// ---------------------------------------------------------------------------
// Analysis context
// ---------------------------------------------------------------------------

/**
 * What every analyser gets.
 *
 * `nodes` is the deduplicated node list and `nodeById` the lookup — both are
 * derived once here because every analyser needs them and the graph's
 * `nodeIndex` deliberately aliases each node under two spellings, so iterating it
 * would visit mixed-case pages twice.
 */
export interface AnalysisContext {
  readonly graph: WikiGraph;
  readonly nodes: readonly GraphNode[];
  readonly nodeById: ReadonlyMap<string, GraphNode>;
  /** Undirected adjacency, out-links union in-links. */
  readonly neighbours: ReadonlyMap<string, ReadonlySet<string>>;
  readonly augmentations: GraphAugmentations;
  /**
   * Content signals for this graph, or `null` when the build had none.
   *
   * Resolved once here rather than inside each analyser, so "does this graph have
   * content?" has one answer for the whole pass — and so an analyser cannot
   * silently disagree with another about it.
   */
  readonly content: ContentIndex | null;
  /** Milliseconds; `Date.now()` unless the input pinned it. */
  readonly now: number;
}

/**
 * The unique nodes of a graph, in a stable order.
 *
 * `nodeIndex` aliases each node under both its lower-cased id and its
 * original-case `rawId`; iterating its values visits mixed-case pages twice,
 * which once double-counted orphans and produced dismiss keys containing the same
 * id two times.
 */
export function uniqueNodes(graph: WikiGraph): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  return [...byId.values()];
}

/** Node lookup that tolerates an index covering a superset of `nodes`. */
export function resolveNodes(graph: WikiGraph): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  for (const node of graph.nodes) byId.set(node.id, node);
  for (const [id, node] of graph.nodeIndex) byId.set(id, node);
  return byId;
}

/** Undirected adjacency over the graph's edges, pre-seeded for isolated nodes. */
export function buildNeighbours(graph: WikiGraph): Map<string, Set<string>> {
  const neighbours = new Map<string, Set<string>>();
  for (const node of graph.nodes) if (!neighbours.has(node.id)) neighbours.set(node.id, new Set());
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    neighbours.get(edge.source)?.add(edge.target);
    neighbours.get(edge.target)?.add(edge.source);
  }
  return neighbours;
}

export function createContext(input: InsightInput): AnalysisContext {
  const nodes = uniqueNodes(input.graph);
  const graphNodes = graphIds(input.graph);
  const neighbours = buildNeighbours(input.graph);
  // Endpoints the graph never listed as nodes are dropped, so a neighbour lookup
  // can never report a degree for a page that is not in the build.
  for (const [id, set] of neighbours) if (!graphNodes.has(id)) neighbours.delete(id);
  return {
    graph: input.graph,
    nodes,
    nodeById: resolveNodes(input.graph),
    neighbours,
    augmentations: input.augmentations ?? {},
    content: contentIndexOf(input.graph),
    now: input.augmentations?.now ?? Date.now(),
  };
}

function graphIds(graph: WikiGraph): Set<string> {
  const ids = new Set<string>();
  for (const node of graph.nodes) ids.add(node.id);
  return ids;
}

/** Undirected degree within this build, as the analysers should read it. */
export function degreeOf(ctx: AnalysisContext, id: string): number {
  return ctx.neighbours.get(id)?.size ?? 0;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * One analysis pass.
 *
 * `analyze` must be pure and synchronous: it runs on the UI thread inside the
 * rebuild, and an analyser that does I/O would make the cache's behaviour depend
 * on when it happened to run.
 */
export interface Analyser {
  /** Stable id, used for per-analyser caps, telemetry and section counts. */
  readonly id: string;
  /** Findings this analyser is allowed to contribute, before the global cap. */
  readonly cap: number;
  /**
   * The largest score this analyser emits, for `score / scoreRange` normalisation.
   *
   * Needed because the migrated detectors score on the engine's **existing** 0…6
   * additive scale, while the model's contract is 0…1. Declaring the range here
   * keeps the raw scale — which is what the 31 existing engine tests assert, and
   * what `GraphInsights.connections[].score` still reports — without letting an
   * out-of-range score change the ordering, which is what happened when the
   * ranking key assumed 0…1 and a score of 6 contributed six times the intended
   * maximum. Defaults to 1, so an analyser using the standard scale omits it.
   */
  readonly scoreRange?: number;
  /**
   * The confidence band for one of this analyser's findings.
   *
   * Declared per analyser because scores are not comparable across analysers: the
   * migrated detectors score on the engine's existing 0…6 additive scale, and a
   * future analyser will use its own. Putting the bands here keeps each scale's cut
   * points next to the code that produces the scale, and lets an analyser return
   * `weak` — or nothing at all — instead of being forced to promote its best card.
   */
  readonly confidenceOf: (finding: Finding) => Confidence;
  readonly analyze: (ctx: AnalysisContext) => readonly Finding[];
}

const registry: Analyser[] = [];

/**
 * Replace an analyser, or append it.
 *
 * Replacement by id rather than append is what lets a test swap one analyser
 * without unregistering the others, and stops a double registration from
 * duplicating every card.
 */
export function registerAnalyser(analyser: Analyser): void {
  const index = registry.findIndex((candidate) => candidate.id === analyser.id);
  if (index >= 0) registry[index] = analyser;
  else registry.push(analyser);
}

/** Every registered analyser, in registration order. */
export function listAnalysers(): readonly Analyser[] {
  return registry;
}

/** Drop every registration. Used by tests so one test cannot leak into the next. */
export function clearAnalysers(): void {
  registry.length = 0;
}
