/**
 * The 知识空白 detector, moved out of `core/insights.ts` unchanged.
 *
 * Same rule as `connections.ts`: the algorithm is untouched so the existing
 * `test/insights.test.ts` assertions keep pinning it, and what is added here is
 * the mapping into the shared `Finding` shape.
 *
 * The gap cards were the reason the `Finding` model was worth building at all.
 * They were the only part of the feature whose text was hard-coded Chinese inside
 * a pure engine module — so an English user saw Chinese cards, and the dismiss key
 * was derived from that rendered title, so switching language silently dropped
 * every dismissal. Keys and parameters fix both at once.
 */

import type { CommunityInfo, CoverageGap, GapType, GraphNode, WikiGraph } from "../../types";
import {
  computeGraphDensity,
  isSparseCommunity as isSparseFromMetrics,
} from "../communities";
import { groupFinding, type Evidence, type Finding } from "./model";
import {
  BRIDGE_LIMIT,
  DEFAULT_GAP_LIMIT,
  LABEL_PREVIEW,
  MIN_BRIDGE_CLUSTERS,
  type InsightOptions,
} from "./connections";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the three actionable gap types, ordered by how cheap they are to fix:
 * orphan pages, then loose clusters, then the bridges holding them together.
 */
export function findCoverageGaps(
  graph: WikiGraph,
  options: InsightOptions = {},
): CoverageGap[] {
  const limit = resolveLimit(options.gapLimit, DEFAULT_GAP_LIMIT);
  if (limit === 0) return [];

  const nodeById = resolveDetectorNodes(graph);
  const gaps: CoverageGap[] = [];

  // Vault-wide degree, for the same reason the visibility switch uses it: a note
  // whose links all point outside the current scope is not an isolated page, and
  // reporting it as one would be a claim about the vault that is not true.
  const isolated = uniqueDetectorNodes(graph)
    .filter((node) => !node.isStructural && node.vaultLinkCount <= 1)
    .sort(compareByLabel);

  if (isolated.length > 0) {
    const head = isolated
      .slice(0, LABEL_PREVIEW)
      .map((node) => node.label)
      .join("、");
    const hidden = isolated.length - LABEL_PREVIEW;
    const nodeIds = isolated.map((node) => node.id);
    const title = `${isolated.length} 个孤立页面`;
    gaps.push({
      key: gapKey("isolated", title, nodeIds),
      type: "isolated",
      title,
      description: hidden > 0 ? `${head} 等 ${hidden} 个` : head,
      suggestion: ISOLATED_SUGGESTION_TEXT,
      nodeIds,
    });
  }

  // Relative to this graph's own density, exactly as the community engine decides
  // it: an absolute threshold would flag nothing in a densely linked vault.
  const density = computeGraphDensity(graph.nodes.length, graph.edges.length);
  const sparse = graph.communities
    .filter((community) => isSparseCommunity(community, density))
    .sort((a, b) => a.cohesion - b.cohesion || a.id - b.id);

  for (const community of sparse) {
    const name = community.topNodes[0] ?? `社区 ${community.id}`;
    const title = `稀疏知识领域：${name}`;
    // The ratio is what the flag is decided on, so it belongs in the card — but only
    // when there is a baseline to divide by. A vault with no links at all has none.
    const ratio =
      density > 0 ? `；约为仓库平均密度的 ${(community.cohesion / density).toFixed(2)} 倍` : "";
    gaps.push({
      key: gapKey("sparse", title, community.nodeIds),
      type: "sparse",
      title,
      description:
        `${community.nodeCount} 个页面，内聚度 ${(community.cohesion * 100).toFixed(1)}%，` +
        `平均每页 ${community.meanIntraDegree.toFixed(1)} 条内部链接${ratio}`,
      suggestion: SPARSE_SUGGESTION_TEXT,
      nodeIds: community.nodeIds,
    });
  }

  for (const bridge of findBridgeNodes(nodeById, graph)) {
    const nodeIds = [bridge.node.id];
    const title = `关键桥接：${bridge.node.label}`;
    gaps.push({
      key: gapKey("bridge", title, nodeIds),
      type: "bridge",
      title,
      description: `连接 ${bridge.clusterCount} 个知识集群，是维系多个领域的关键枢纽`,
      suggestion: BRIDGE_SUGGESTION_TEXT,
      nodeIds,
      clusterCount: bridge.clusterCount,
    });
  }

  return gaps.slice(0, limit);
}

export interface BridgeCandidate {
  readonly node: GraphNode;
  readonly clusterCount: number;
}

/** Pages whose neighbours live in 3+ different clusters, strongest first. */
export function findBridgeNodes(
  nodeById: ReadonlyMap<string, GraphNode>,
  graph: WikiGraph,
): BridgeCandidate[] {
  const clusters = new Map<string, Set<number>>();

  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue; // a self-link spans nothing
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    addCluster(clusters, source.id, target.community);
    addCluster(clusters, target.id, source.community);
  }

  const candidates: BridgeCandidate[] = [];
  for (const [id, communityIds] of clusters) {
    const node = nodeById.get(id);
    if (!node || node.isStructural) continue;
    if (communityIds.size < MIN_BRIDGE_CLUSTERS) continue;
    candidates.push({ node, clusterCount: communityIds.size });
  }

  candidates.sort(
    (a, b) =>
      b.clusterCount - a.clusterCount ||
      b.node.linkCount - a.node.linkCount ||
      compareStrings(a.node.id, b.node.id),
  );
  return candidates.slice(0, BRIDGE_LIMIT);
}

function addCluster(clusters: Map<string, Set<number>>, id: string, community: number): void {
  const existing = clusters.get(id);
  if (existing) existing.add(community);
  else clusters.set(id, new Set([community]));
}

export function isSparseCommunity(community: CommunityInfo, graphDensity: number): boolean {
  // `isSparse` is precomputed by the community engine; recomputing from the raw
  // metrics keeps cached or hand-built graphs working when the flag is absent.
  return (
    community.isSparse ||
    isSparseFromMetrics(community.cohesion, community.nodeCount, graphDensity)
  );
}

/** Stable dismiss key for a gap card. */
export function knowledgeGapKey(gap: CoverageGap): string {
  return gapKey(gap.type, gap.title, gap.nodeIds);
}

export function gapKey(type: GapType, title: string, nodeIds: readonly string[]): string {
  return `gap:${type}:${title}:${nodeIds.join(",")}`;
}

// ---------------------------------------------------------------------------
// Finding mapping
// ---------------------------------------------------------------------------

/**
 * Gap text, kept here only as the *legacy* `CoverageGap` payload.
 *
 * The finding path uses message keys instead — these strings exist because
 * `buildInsightsReport` and the existing engine tests still read `CoverageGap`.
 * They are no longer what the panel renders.
 */
const ISOLATED_SUGGESTION_TEXT =
  "这些页面几乎没有关联，建议在正文中补充 [[wikilinks]] 指向相关主题，先建立连接再逐步扩充内容。";
const SPARSE_SUGGESTION_TEXT =
  "该领域内部交叉引用不足，建议在这些页面之间补充 [[wikilinks]]，把同一主题的笔记串联起来。";
const BRIDGE_SUGGESTION_TEXT =
  "这是跨领域的关键枢纽，建议保持内容更新与完整，并持续补充指向各个集群的 [[wikilinks]]。";

/**
 * Map a detected gap onto the finding model.
 *
 * The anchor is what keeps the dismiss key meaningful:
 *
 *  - `bridge` and per-page findings anchor on the page itself.
 *  - `sparse` anchors on the cluster's name-bearing member — the same page the
 *    community engine already picks to name the cluster, so the card and its key
 *    agree about which page the finding is "about".
 *  - `isolated` is the case the review caught. It anchors on the *first page in
 *    stable order* and adopts explicit membership-changed semantics: adding an
 *    orphan makes this a different observation, and the dismissal is
 *    deliberately dropped rather than silently applied to a changed set. The
 *    per-page behaviour a user expects arrives when an analyser emits one row per
 *    orphan; see `docs/graph-insights-plan.md` §4.3.
 */
export function toGapFindings(gaps: readonly CoverageGap[]): Finding[] {
  const findings: Finding[] = [];
  for (const gap of gaps) {
    switch (gap.type) {
      case "isolated": {
        const anchorId = gap.nodeIds[0];
        if (!anchorId) break;
        findings.push(
          groupFinding({
            kind: "isolated",
            analyser: "gaps",
            anchorId,
            titleKey: "insights.finding.isolated",
            titleParams: { count: gap.nodeIds.length },
            init: {
              evidence: [
                {
                  kind: "degree",
                  labelKey: "reason.evidence.degree",
                  params: {},
                  contribution: 1,
                  nodeIds: gap.nodeIds.slice(0, LABEL_PREVIEW),
                },
              ],
              anchors: { nodeIds: gap.nodeIds, edgeKeys: [] },
              confidence: "moderate",
              severity: 2,
              effort: "edit",
            },
          }),
        );
        break;
      }
      case "sparse": {
        const anchorId = gap.nodeIds[0];
        if (!anchorId) break;
        findings.push(
          groupFinding({
            kind: "sparse",
            analyser: "gaps",
            anchorId,
            titleKey: "insights.finding.sparse",
            titleParams: { name: gap.title.replace(/^稀疏知识领域：/, "") },
            init: {
              evidence: [
                {
                  kind: "community",
                  labelKey: "reason.evidence.community",
                  params: {},
                  contribution: 1,
                  nodeIds: gap.nodeIds.slice(0, LABEL_PREVIEW),
                },
              ],
              anchors: { nodeIds: gap.nodeIds, edgeKeys: [] },
              confidence: "moderate",
              severity: 2,
              effort: "write",
            },
          }),
        );
        break;
      }
      case "bridge": {
        const anchorId = gap.nodeIds[0];
        if (!anchorId) break;
        const evidence: Evidence[] = [
          {
            kind: "community",
            labelKey: "reason.evidence.community",
            params: {},
            contribution: gap.clusterCount ?? 0,
          },
        ];
        findings.push({
          ...groupFinding({
            kind: "bridge",
            analyser: "gaps",
            anchorId,
            titleKey: "insights.finding.bridge",
            titleParams: { name: gap.title.replace(/^关键桥接：/, "") },
            init: {
              evidence,
              anchors: { nodeIds: gap.nodeIds, edgeKeys: [] },
              confidence: "moderate",
              severity: 2,
              effort: "write",
            },
          }),
        });
        break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from the legacy module on purpose; see the header)
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

/** Pinned locale: dismiss keys must not depend on the machine's default locale. */
function compareByLabel(a: GraphNode, b: GraphNode): number {
  return a.label.localeCompare(b.label, "zh") || compareStrings(a.id, b.id);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
