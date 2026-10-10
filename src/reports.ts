/**
 * Markdown report builders.
 *
 * Pure functions of `(graph, insights, weights)` — no Obsidian, no I/O, no
 * plugin. That is deliberate: the reports are the part of the plugin a user is
 * most likely to want to reformat, and keeping them here means reformatting one
 * is a change to a pure function that can be unit-tested, rather than an edit
 * buried in the plugin class.
 */

import type { GraphInsights } from "./core/insights";
import { createRelevanceContext, rankRelated } from "./core/relevance";
import { declaredTypeLabel } from "./core/parse";
import type { GraphNode, RelevanceWeights, WikiGraph } from "./types";

/** How many related pages the per-note report lists. */
export const RELEVANCE_REPORT_LIMIT = 10;

/** The filename the insights report is written to, relative to the vault root. */
export const INSIGHTS_REPORT_PATH = "关系图谱洞察报告.md";

/**
 * Association report for a single note: its metadata plus the strongest
 * neighbours with the full per-signal breakdown.
 */
export function buildRelevanceReport(
  node: GraphNode,
  graph: WikiGraph,
  weights?: RelevanceWeights,
): string {
  const links = graph.edges.flatMap((edge) =>
    edge.source === node.id
      ? [{ source: edge.source, target: edge.target }]
      : edge.target === node.id
        ? [{ source: edge.source, target: edge.target }]
        : [],
  );
  const context = createRelevanceContext(graph.nodes, links);
  const related = rankRelated(context, node.id, RELEVANCE_REPORT_LIMIT, weights);

  const lines: string[] = [
    `# ${node.label}`,
    "",
    `- 类型: ${declaredTypeLabel(node.rawType, node.type)}`,
    `- 链接数: ${node.linkCount}`,
    `- 社区: ${node.community}`,
    `- 原始资料: ${node.sources.length > 0 ? node.sources.join("、") : "（无）"}`,
    "",
    "## 关联度最高的页面",
    "",
    "| 页面 | 关联度 | 直接链接 | Adamic-Adar | 来源重叠 | 共被引 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of related) {
    lines.push(
      `| [[${item.node.id}\\|${item.node.label}]] | ${item.breakdown.total.toFixed(2)} | ` +
        `${item.breakdown.directLink.toFixed(2)} | ${item.breakdown.adamicAdar.toFixed(2)} | ` +
        // Type affinity is a tie-break rather than a contribution, so it is not
        // a column here; co-citation is.
        `${item.breakdown.sourceOverlap.toFixed(2)} | ${item.breakdown.coCitation.toFixed(2)} |`,
    );
  }
  return lines.join("\n");
}

/** Vault-wide insights report: counters, surprising connections, knowledge gaps. */
export function buildInsightsReport(
  graph: WikiGraph,
  insights: GraphInsights,
  today: Date = new Date(),
): string {
  const lines: string[] = [
    "---",
    "type: overview",
    `title: ${JSON.stringify("关系图谱洞察报告")}`,
    `created: ${today.toISOString().slice(0, 10)}`,
    "tags: [graph, insights]",
    "---",
    "",
    "# 关系图谱洞察报告",
    "",
    `- 页面总数：${graph.nodes.length}`,
    `- 关联总数：${graph.edges.length}`,
    `- 知识集群：${graph.communities.length}`,
    "",
    "## 惊奇连接",
    "",
  ];
  for (const connection of insights.connections) {
    lines.push(
      `- **${connection.source.label} ↔ ${connection.target.label}** — 关联度 ${connection.weight.toFixed(2)}，` +
        `惊奇分 ${connection.score}（${connection.reasons.join("、")}）`,
    );
  }
  lines.push("", "## 知识空白", "");
  for (const gap of insights.gaps) {
    lines.push(`### ${gap.title}`, "", gap.description, "", `> ${gap.suggestion}`, "");
  }
  return lines.join("\n");
}
