/**
 * Tests for the Markdown report builders.
 *
 * These were extracted from the plugin class precisely so they could be tested
 * without Obsidian: they are pure functions of `(graph, insights, weights)`, and
 * users are likely to want to reformat them.
 */

import { describe, expect, it } from "vitest";

import { INSIGHTS_REPORT_PATH, buildInsightsReport, buildRelevanceReport } from "../src/reports";
import { DEFAULT_RELEVANCE_WEIGHTS, type GraphEdge, type GraphNode, type PageType, type WikiGraph } from "../src/types";
import type { GraphInsights } from "../src/core/insights";

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: overrides.label ?? id.toUpperCase(),
    type: "concept" as PageType,
    rawType: "concept",
    path: `${id}.md`,
    linkCount: 3,
    inLinks: 2,
    outLinks: 1,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
    ...overrides,
  } as GraphNode;
}

function makeEdge(source: string, target: string, weight: number): GraphEdge {
  return {
    source,
    target,
    weight,
    signals: { directLink: 3, sourceOverlap: 0, adamicAdar: 0, coCitation: 0, total: weight },
    hasDirectLink: true,
    sharedSources: [],
    commonNeighbors: 0,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): WikiGraph {
  return {
    nodes,
    edges,
    communities: [],
    nodeIndex: new Map(nodes.map((node) => [node.id, node])),
    builtAt: 1,
  };
}

describe("buildRelevanceReport", () => {
  const alpha = makeNode("alpha", { label: "Alpha", sources: ["paper-a", "paper-b"] });
  const beta = makeNode("beta", { label: "Beta" });
  const gamma = makeNode("gamma", { label: "Gamma" });
  const graph = makeGraph([alpha, beta, gamma], [makeEdge("alpha", "beta", 9), makeEdge("alpha", "gamma", 4)]);

  it("starts with the note title and its metadata", () => {
    const report = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);

    expect(report.startsWith("# Alpha")).toBe(true);
    expect(report).toContain("- 类型: concept");
    expect(report).toContain("- 链接数: 3");
    expect(report).toContain("- 社区: 0");
    expect(report).toContain("- 原始资料: paper-a、paper-b");
  });

  it("says （无） when the note cites no sources", () => {
    expect(buildRelevanceReport(beta, graph, DEFAULT_RELEVANCE_WEIGHTS)).toContain("- 原始资料: （无）");
  });

  it("emits a table with one row per related page, strongest first", () => {
    const report = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);
    const rows = report.split("\n").filter((line) => line.startsWith("| [["));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Beta");
    expect(rows[1]).toContain("Gamma");
  });

  it("escapes the pipe in a wikilink alias so the table cannot break", () => {
    const report = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);
    expect(report).toContain("[[beta\\|Beta]]");
  });

  it("renders every weight to two decimals", () => {
    const report = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);
    for (const row of report.split("\n").filter((line) => line.startsWith("| [["))) {
      // The wikilink alias contains an escaped pipe, so split on the LAST five
      // cells rather than counting from the left.
      const cells = row.split("|");
      const values = cells.slice(-6, -1).map((part) => part.trim());
      expect(values).toHaveLength(5);
      for (const value of values) expect(value).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("keeps the header in the same order as the rows", () => {
    // The header and the row template are written separately and can drift:
    // they once disagreed about which of Adamic-Adar and source overlap comes
    // third, which no amount of cell-format checking would notice.
    const report = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);
    const header = report.split("\n").find((line) => line.includes("Adamic-Adar"))!;
    const headerCells = header.split("|").map((cell) => cell.trim()).filter(Boolean);
    const row = report.split("\n").find((line) => line.startsWith("| [["))!;
    // Drop the leading cell first: the wikilink alias contains an escaped pipe
    // (\|), so splitting the whole row counts one cell too many.
    const dataCells = row.slice(row.indexOf("]] |") + 4).split("|").map((c) => c.trim()).filter(Boolean);
    expect(dataCells).toHaveLength(headerCells.length - 1);
    // Column 3 of the data is the one the header used to disagree about.
    expect(headerCells[3]).toBe("Adamic-Adar");
  });

  it("honours custom weights instead of the defaults", () => {
    const withZeroDirect = buildRelevanceReport(alpha, graph, {
      ...DEFAULT_RELEVANCE_WEIGHTS,
      directLink: 0,
    });
    const defaultReport = buildRelevanceReport(alpha, graph, DEFAULT_RELEVANCE_WEIGHTS);
    expect(withZeroDirect).not.toBe(defaultReport);
    // Zeroing direct links drops the pair entirely rather than leaving a 0.00

    // link now scores zero, and zero-scoring pairs are not "related".
    const rows = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("| [[")).length;
    expect(rows(withZeroDirect)).toBeLessThan(rows(defaultReport));
  });

  it("still works for a note with no edges at all", () => {
    const lonely = makeNode("lonely");
    const report = buildRelevanceReport(lonely, makeGraph([lonely]), DEFAULT_RELEVANCE_WEIGHTS);
    expect(report).toContain("# LONELY");
    expect(report.split("\n").filter((line) => line.startsWith("| [["))).toHaveLength(0);
  });
});

describe("buildInsightsReport", () => {
  const graph = makeGraph(
    [makeNode("a"), makeNode("b"), makeNode("c")],
    [makeEdge("a", "b", 5)],
  );
  const insights: GraphInsights = {
    connections: [
      {
        key: "a:::b",
        source: makeNode("a", { label: "Alpha" }),
        target: makeNode("b", { label: "Beta" }),
        score: 6,
        weight: 12.345,
        reasons: ["cross-community", "cross-type"],
        contributions: {},
      },
    ],
    gaps: [
      {
        key: "gap:bridge-node:关键桥接：Alpha:a",
        type: "bridge",
        title: "关键桥接：Alpha",
        description: "连接 3 个知识集群",
        suggestion: "保持更新",
        nodeIds: ["a"],
      },
    ],
  };

  it("writes frontmatter that parses as a normal note", () => {
    const report = buildInsightsReport(graph, insights, new Date("2026-10-07T10:00:00Z"));
    const lines = report.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines).toContain("type: overview");
    expect(lines).toContain('title: "关系图谱洞察报告"');
    expect(lines).toContain("created: 2026-10-07");
    expect(lines).toContain("tags: [graph, insights]");
    expect(lines.indexOf("---", 1)).toBe(5);
  });

  it("reports the graph counters", () => {
    const report = buildInsightsReport(graph, insights);
    expect(report).toContain("- 页面总数：3");
    expect(report).toContain("- 关联总数：1");
    expect(report).toContain("- 知识集群：0");
  });

  it("lists connections with their score and reasons", () => {
    const report = buildInsightsReport(graph, insights);
    expect(report).toContain("**Alpha ↔ Beta**");
    expect(report).toContain("关联度 12.35");
    expect(report).toContain("惊奇分 6");
    expect(report).toContain("cross-community、cross-type");
  });

  it("renders each gap as a heading, description and quoted suggestion", () => {
    const report = buildInsightsReport(graph, insights);
    expect(report).toContain("### 关键桥接：Alpha");
    expect(report).toContain("连接 3 个知识集群");
    expect(report).toContain("> 保持更新");
  });

  it("handles an empty insight set without emitting broken sections", () => {
    const report = buildInsightsReport(graph, { connections: [], gaps: [] });
    expect(report).toContain("## 惊奇连接");
    expect(report).toContain("## 知识空白");
    // No dangling headings or empty bullet points where the content would be.
    for (const line of report.split("\n")) {
      expect(line).not.toMatch(/^#{2,3}\s*$/);
      expect(line).not.toMatch(/^-\s*$/);
    }
  });

  it("exposes the report path so callers and tests agree on it", () => {
    expect(INSIGHTS_REPORT_PATH).toBe("关系图谱洞察报告.md");
  });
});
