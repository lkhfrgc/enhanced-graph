/**
 * The structural analyser: what the graph would lose, and where it is thin.
 *
 * This is the one card type whose ground truth is definitional rather than
 * behavioural — a cut vertex either exists or does not — so it needs no rating study
 * to be worth shipping, and it is the most defensible answer to the plan's
 * "non-obvious" test (§1).
 *
 * Everything here is `O(n + m)`. That is not a coincidence but the reason the phase
 * was ordered ahead of others: measured on synthetic PKM-shaped graphs, Tarjan's cut
 * vertices and bridges and an iterative k-core cost single-digit milliseconds at
 * 5 000 nodes, while exact betweenness (Brandes) costs 8.7 seconds at 2 000 — so the
 * cheap exact measures ship and the expensive one is not used at all.
 *
 * One card per *page*, so the dismiss key is a page and stays stable (§4.3).
 */

import type { Analyser, AnalysisContext } from "./input";
import { registerAnalyser } from "./input";
import { documentFinding, type Confidence, type Finding } from "./model";
import { edgeKey } from "../graph-keys";

export const STRUCTURE_ANALYSER_ID = "structure";

/** Cards per kind, so one kind cannot own the panel. */
export const CUT_VERTEX_LIMIT = 4;
export const GATEWAY_LIMIT = 3;
export const CORE_LIMIT = 3;
export const BROKERAGE_LIMIT = 3;

/** A page must be at least this central in its cluster to count as load-bearing. */
export const UNDERLINKED_HUB_MAX_DEGREE = 3;

/**
 * Squash an unbounded raw measure onto the model's 0…1 scale.
 *
 * The structural measures have no natural ceiling — a cut vertex can separate seven
 * notes or seventy — while `Finding.score` is a 0…1 quantity. `x / (x + k)` is
 * monotone, keeps small values roughly proportional, and never reaches 1, which is
 * what makes the ranking between two structural findings mean something instead of
 * every card showing 0.00.
 */
function normalise(raw: number, half: number): number {
  if (!(raw > 0)) return 0;
  return raw / (raw + half);
}

/**
 * Whether a node sits in a high k-core relative to the vault.
 *
 * The core number is an absolute count, so the bar has to be relative to the vault's
 * own structure: a note in the 5-core of a densely linked vault is unremarkable,
 * and the same number in a sparse one is the centre of everything.
 */
function coreThreshold(ctx: AnalysisContext): number {
  let maxCore = 0;
  for (const value of coreNumbers(ctx).values()) maxCore = Math.max(maxCore, value);
  return Math.max(2, Math.ceil(maxCore * 0.6));
}

// ---------------------------------------------------------------------------
// Tarjan: articulation points and bridges
// ---------------------------------------------------------------------------

export interface CutAnalysis {
  /** Nodes whose removal disconnects part of the graph. */
  readonly cutVertices: ReadonlySet<string>;
  /** Undirected edge keys whose removal disconnects part of the graph. */
  readonly bridges: ReadonlySet<string>;
  /**
   * For each cut vertex, how many notes become unreachable from the largest
   * remaining component. The number a reader can act on.
   */
  readonly separatedBy: ReadonlyMap<string, number>;
}

/**
 * Cut vertices and bridges, iteratively.
 *
 * Iterative because a recursive DFS overflows the stack on a long chain of notes —
 * a vault of 5 000 notes in a line is unrealistic, but a single deep path is not, and
 * the failure mode is a crash rather than a wrong answer.
 */
export function cutAnalysis(ctx: AnalysisContext): CutAnalysis {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const cutVertices = new Set<string>();
  const bridges = new Set<string>();
  const parentOf = new Map<string, string | null>();
  const subtreeSize = new Map<string, number>();
  let counter = 0;

  for (const root of ctx.nodes) {
    if (index.has(root.id)) continue;
    let rootChildren = 0;
    const stack: Array<{ id: string; iter: Iterator<string> }> = [];
    index.set(root.id, counter);
    low.set(root.id, counter);
    counter += 1;
    parentOf.set(root.id, null);
    subtreeSize.set(root.id, 1);
    stack.push({ id: root.id, iter: (ctx.neighbours.get(root.id) ?? new Set()).values() });

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = frame.iter.next();
      if (next.done) {
        stack.pop();
        const parent = parentOf.get(frame.id) ?? null;
        if (parent !== null) {
          low.set(parent, Math.min(low.get(parent) ?? 0, low.get(frame.id) ?? 0));
          subtreeSize.set(parent, (subtreeSize.get(parent) ?? 1) + (subtreeSize.get(frame.id) ?? 1));
          if ((low.get(frame.id) ?? 0) >= (index.get(parent) ?? 0)) cutVertices.add(parent);
          // A bridge is an edge the subtree cannot reach around.
          if ((low.get(frame.id) ?? 0) > (index.get(parent) ?? 0)) {
            bridges.add(edgeKey(parent, frame.id));
          }
        }
        continue;
      }
      const next_ = next.value;
      if (!index.has(next_)) {
        index.set(next_, counter);
        low.set(next_, counter);
        counter += 1;
        parentOf.set(next_, frame.id);
        subtreeSize.set(next_, 1);
        // The root's own DFS-tree children decides whether it is a cut vertex at all.
        if (frame.id === root.id) rootChildren += 1;
        stack.push({ id: next_, iter: (ctx.neighbours.get(next_) ?? new Set()).values() });
      } else if (next_ !== (parentOf.get(frame.id) ?? null)) {
        low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(next_) ?? 0));
      }
    }

    // The DFS root is a cut vertex only with two or more children.
    if (rootChildren < 2) cutVertices.delete(root.id);
  }

  // How much a cut vertex separates: the notes held behind it that the rest of the
  // graph cannot reach once it is gone.
  //
  // Computed per node by walking outward and counting what is *not* reachable without
  // passing through it. Twice, because a cut vertex can sit in a corner of the graph:
  // `size - 1 - largestChildSubtree` is the smaller side, and the smaller side is the
  // one that becomes unreachable — reporting the larger would claim the whole vault
  // hangs off a note that only three pages depend on.
  const separatedBy = new Map<string, number>();
  const componentSize = new Map<string, number>();
  for (const id of index.keys()) {
    if (componentSize.has(id)) continue;
    // Flood each component once and remember its size, so the arithmetic below is a
    // subtraction rather than a second traversal.
    const queue = [id];
    const seen = new Set([id]);
    while (queue.length > 0) {
      const at = queue.pop()!;
      for (const neighbour of ctx.neighbours.get(at) ?? new Set()) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    for (const member of seen) componentSize.set(member, seen.size);
  }

  for (const id of cutVertices) {
    const total = componentSize.get(id) ?? 1;
    let largestSide = 0;
    for (const neighbour of ctx.neighbours.get(id) ?? new Set()) {
      if (neighbour === id) continue;
      // Reachable from one neighbour without passing through the cut vertex.
      const queue = [neighbour];
      const seen = new Set([neighbour]);
      while (queue.length > 0) {
        const at = queue.pop()!;
        for (const next of ctx.neighbours.get(at) ?? new Set()) {
          if (next === id || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      largestSide = Math.max(largestSide, seen.size);
    }
    separatedBy.set(id, Math.max(0, total - 1 - largestSide));
  }

  return { cutVertices, bridges, separatedBy };
}

function edgeKeyOf(a: string, b: string): string {
  return edgeKey(a, b);
}

// ---------------------------------------------------------------------------
// k-core
// ---------------------------------------------------------------------------

/**
 * Core number per node: the deepest shell it survives in.
 *
 * Peeling by ascending degree, with a bucket queue, which is linear. The value is
 * what makes "this page is load-bearing while barely linked" expressible: a note in
 * the top core with two links is holding more structure than its degree suggests.
 */
export function coreNumbers(ctx: AnalysisContext): Map<string, number> {
  const degree = new Map<string, number>();
  const removed = new Set<string>();
  for (const node of ctx.nodes) degree.set(node.id, ctx.neighbours.get(node.id)?.size ?? 0);

  const buckets = new Map<number, string[]>();
  const push = (id: string, value: number): void => {
    const bucket = buckets.get(value);
    if (bucket) bucket.push(id);
    else buckets.set(value, [id]);
  };
  for (const node of ctx.nodes) push(node.id, degree.get(node.id) ?? 0);

  const core = new Map<string, number>();
  let current = 0;
  for (let level = 0; level <= ctx.nodes.length; level += 1) {
    const bucket = buckets.get(level);
    if (!bucket) continue;
    while (bucket.length > 0) {
      const id = bucket.pop()!;
      if (removed.has(id)) continue;
      if ((degree.get(id) ?? 0) > level) {
        // Its degree fell after it was queued; re-file it at its real level.
        push(id, degree.get(id) ?? 0);
        continue;
      }
      removed.add(id);
      current = Math.max(current, level);
      core.set(id, current);
      for (const neighbour of ctx.neighbours.get(id) ?? new Set()) {
        if (removed.has(neighbour)) continue;
        const next = (degree.get(neighbour) ?? 0) - 1;
        degree.set(neighbour, next);
        push(neighbour, next);
      }
    }
  }
  for (const node of ctx.nodes) if (!core.has(node.id)) core.set(node.id, current);
  return core;
}

// ---------------------------------------------------------------------------
// Brokerage: Burt's constraint
// ---------------------------------------------------------------------------

/**
 * Burt's constraint per node, lower meaning more brokerage.
 *
 * A node whose neighbours are not connected to each other spans a structural hole,
 * which is where a new link buys the most connectivity. Kept because it is the one
 * *positive* card in the set — "here is where to invest" — and a panel made only of
 * complaints is the fastest route to being ignored.
 */
export function constraint(ctx: AnalysisContext): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of ctx.nodes) {
    const neighbours = [...(ctx.neighbours.get(node.id) ?? new Set())];
    if (neighbours.length === 0) {
      out.set(node.id, 0);
      continue;
    }
    let total = 0;
    for (const neighbour of neighbours) {
      const neighbourSet = ctx.neighbours.get(neighbour) ?? new Set();
      // Proportion of the node's ties that go through this neighbour, direct and via
      // one other neighbour.
      let proportion = 1 / neighbours.length;
      for (const other of neighbours) {
        if (other === neighbour) continue;
        if (neighbourSet.has(other)) proportion += 1 / neighbours.length;
      }
      total += proportion * proportion;
    }
    out.set(node.id, total);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cluster exit edges
// ---------------------------------------------------------------------------

export interface Gateway {
  readonly community: number;
  /** Pages in the community with at least one edge leaving it. */
  readonly exitNodes: readonly string[];
  /** Distinct edges leaving the community. */
  readonly exitEdges: number;
}

/**
 * Communities reachable through a single page.
 *
 * A cluster whose only link to the rest of the vault is one note is one edit away
 * from being unreachable, and the edit is not always deliberate. This is the
 * community-level counterpart of a cut vertex, and it is what makes "this note is the
 * only door into that area" a provable statement rather than a hunch.
 */
export function clusterGateways(ctx: AnalysisContext): Gateway[] {
  const byCommunity = new Map<number, { exits: number; nodes: Set<string> }>();
  for (const edge of ctx.graph.edges) {
    const a = ctx.nodeById.get(edge.source);
    const b = ctx.nodeById.get(edge.target);
    if (!a || !b || a.community === b.community) continue;
    for (const side of [a, b]) {
      const entry = byCommunity.get(side.community) ?? { exits: 0, nodes: new Set<string>() };
      entry.exits += 1;
      entry.nodes.add(side.id);
      byCommunity.set(side.community, entry);
    }
  }

  const gateways: Gateway[] = [];
  for (const [community, entry] of byCommunity) {
    if (entry.nodes.size !== 1) continue;
    gateways.push({ community, exitNodes: [...entry.nodes], exitEdges: entry.exits });
  }
  gateways.sort((a, b) => a.community - b.community);
  return gateways;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * Every structural finding this pass can offer.
 *
 * Bands are `strong` for a cut vertex with a measured separation and `moderate`
 * otherwise: "if you delete this, six notes fall off the graph" is a fact about the
 * graph, while "this cluster has one door" is a fact worth checking.
 */
export function structureFindings(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  const labelOf = (id: string): string => ctx.nodeById.get(id)?.label ?? id;

  const { cutVertices, bridges, separatedBy } = cutAnalysis(ctx);
  const rankedCuts = [...cutVertices]
    .filter((id) => !ctx.nodeById.get(id)?.isStructural)
    .sort(
      (a, b) =>
        (separatedBy.get(b) ?? 0) - (separatedBy.get(a) ?? 0) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );

  for (const id of rankedCuts.slice(0, CUT_VERTEX_LIMIT)) {
    const separated = separatedBy.get(id) ?? 0;
    const hasBridge = [...(ctx.neighbours.get(id) ?? new Set())].some((neighbour) =>
      bridges.has(edgeKeyOf(id, neighbour)),
    );
    findings.push(
      documentFinding({
        kind: "single-point-of-failure",
        analyser: STRUCTURE_ANALYSER_ID,
        nodeId: id,
        titleKey: "insights.finding.single-point-of-failure",
        titleParams: { name: labelOf(id) },
        severity: 3,
        effort: "write",
        init: {
          evidence: [
            {
              kind: "cut-vertex",
              labelKey: "reason.evidence.cut-vertex",
              params: { count: separated },
              // A larger blast radius is stronger evidence, not a different fact.
              contribution: 1 + separated,
            },
            ...(hasBridge
              ? [
                  {
                    kind: "bridge-edge" as const,
                    labelKey: "reason.evidence.bridge-edge" as const,
                    params: {},
                    contribution: 1,
                  },
                ]
              : []),
          ],
          anchors: { nodeIds: [id], edgeKeys: [] },
          score: normalise(separated, 5),
          confidence: separated > 0 ? "strong" : "moderate",
        },
      }),
    );
  }

  for (const gateway of clusterGateways(ctx).slice(0, GATEWAY_LIMIT)) {
    const id = gateway.exitNodes[0];
    if (id === undefined) continue;
    findings.push(
      documentFinding({
        kind: "cluster-gateway",
        analyser: STRUCTURE_ANALYSER_ID,
        nodeId: id,
        titleKey: "insights.finding.cluster-gateway",
        titleParams: { name: labelOf(id) },
        severity: 3,
        effort: "edit",
        init: {
          evidence: [
            {
              kind: "community",
              labelKey: "reason.evidence.community",
              params: {},
              contribution: gateway.exitEdges,
            },
          ],
          anchors: { nodeIds: [id], edgeKeys: [] },
          score: normalise(gateway.exitEdges, 2),
          confidence: "moderate",
        },
      }),
    );
  }

  const threshold = coreThreshold(ctx);
  const core = coreNumbers(ctx);
  const loadBearing = ctx.nodes
    .filter(
      (node) =>
        !node.isStructural &&
        (core.get(node.id) ?? 0) >= threshold &&
        (ctx.neighbours.get(node.id)?.size ?? 0) <= UNDERLINKED_HUB_MAX_DEGREE,
    )
    .sort(
      (a, b) =>
        (core.get(b.id) ?? 0) - (core.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
    );

  for (const node of loadBearing.slice(0, CORE_LIMIT)) {
    findings.push(
      documentFinding({
        kind: "underlinked-hub",
        analyser: STRUCTURE_ANALYSER_ID,
        nodeId: node.id,
        titleKey: "insights.finding.underlinked-hub",
        titleParams: { name: node.label },
        severity: 2,
        effort: "edit",
        init: {
          evidence: [
            {
              kind: "core-number",
              labelKey: "reason.evidence.core-number",
              params: { core: core.get(node.id) ?? 0 },
              contribution: core.get(node.id) ?? 0,
            },
          ],
          anchors: { nodeIds: [node.id], edgeKeys: [] },
          score: normalise(core.get(node.id) ?? 0, 4),
          confidence: "moderate",
        },
      }),
    );
  }

  const constraintByNode = constraint(ctx);
  const brokers = ctx.nodes
    .filter(
      (node) =>
        !node.isStructural &&
        (ctx.neighbours.get(node.id)?.size ?? 0) >= 3 &&
        (constraintByNode.get(node.id) ?? 1) > 0,
    )
    // Lowest constraint first: the least redundant ego network is the best place for a
    // new link.
    .sort(
      (a, b) =>
        (constraintByNode.get(a.id) ?? 1) - (constraintByNode.get(b.id) ?? 1) ||
        (a.id < b.id ? -1 : 1),
    );

  for (const node of brokers.slice(0, BROKERAGE_LIMIT)) {
    findings.push(
      documentFinding({
        kind: "brokerage",
        analyser: STRUCTURE_ANALYSER_ID,
        nodeId: node.id,
        titleKey: "insights.finding.brokerage",
        titleParams: { name: node.label },
        severity: 1,
        effort: "edit",
        init: {
          evidence: [
            {
              kind: "constraint",
              labelKey: "reason.evidence.constraint",
              params: {},
              // Lower constraint is the stronger finding, so invert it for ordering.
              contribution: 1 - Math.min(1, constraintByNode.get(node.id) ?? 1),
            },
          ],
          anchors: { nodeIds: [node.id], edgeKeys: [] },
          // Lower constraint is more brokerage, which is what the score measures.
          score: 1 - Math.min(1, constraintByNode.get(node.id) ?? 1),
          confidence: "moderate",
        },
      }),
    );
  }

  return findings;
}

/** The analyser. */
export function structureAnalyser(): Analyser {
  return {
    id: STRUCTURE_ANALYSER_ID,
    cap: CUT_VERTEX_LIMIT + GATEWAY_LIMIT + CORE_LIMIT + BROKERAGE_LIMIT,
    scoreRange: 1,
    confidenceOf: (finding: Finding): Confidence => finding.confidence,
    analyze: (ctx: AnalysisContext): readonly Finding[] => structureFindings(ctx),
  };
}

/** Register the analyser alongside the shipped ones. */
export function registerStructureAnalyser(): void {
  registerAnalyser(structureAnalyser());
}
