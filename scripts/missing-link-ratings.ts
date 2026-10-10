/**
 * Emits a rating sheet for the missing-link candidates.
 *
 * Same reason as the mention sheet: the plan's gate for a candidate type is a human
 * verdict, and no offline metric answers "does this pair belong together". This one
 * matters more, because the plan *predicted* from composition analysis (§8.2) that
 * this card type would only propose pairs the reader has already considered — and the
 * only way to check a prediction about a reader is to ask one.
 *
 * Two things are deliberately on the sheet that a reviewer would otherwise have to
 * count by hand, because they are the prediction's mechanism:
 *
 *  - **shared neighbours** — a real link has about 5 (measured, §3.2) and the ranking
 *    prefers pairs with 11–15;
 *  - **max shared degree** — every card here routes through a page with 38–42 links, so
 *    `hub-routed` is the column that says whether a card is a discovery or an index
 *    artefact.
 *
 * The sheet carries more candidates than the panel shows. Six is the panel's cap and six
 * would be far too few to conclude anything from, so it reaches past the cap into the
 * same ranking and marks where the panel stops.
 *
 * Usage: npm run eval:missing-links -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";

import { buildWikiGraph } from "../src/core/graph-builder";
import { createContext } from "../src/core/insights/input";
import { candidatePairs, signalsFor, scoreSignals } from "../src/core/insights/link-prediction";
import { MISSING_LINK_LIMIT } from "../src/core/insights/link-prediction";
import type { VaultAdapter } from "../src/core/vault";

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));
const OUTPUT = path.resolve(process.cwd(), "docs", "missing-link-rating-sheet.md");

/** How many candidates to export. Six would be too few to rate meaningfully. */
const EXPORT_LIMIT = 30;
/** Below this the ranking has nothing to say, and it is not what the panel shows. */
const MIN_SCORE = 0.2;

class NodeVault implements VaultAdapter {
  configDir(): string {
    return ".obsidian";
  }
  async listMarkdownFiles(): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith(".md")) {
          out.push(path.relative(vaultRoot, full).replace(/\\/g, "/"));
        }
      }
    };
    walk(vaultRoot);
    return out.sort();
  }
  async read(relative: string): Promise<string> {
    return fs.readFileSync(path.join(vaultRoot, relative), "utf8");
  }
  async exists(relative: string): Promise<boolean> {
    return fs.existsSync(path.join(vaultRoot, relative));
  }
  async write(): Promise<void> {
    throw new Error("read-only");
  }
  async stat(relative: string): Promise<{ created: number; modified: number }> {
    const s = fs.statSync(path.join(vaultRoot, relative));
    return { created: s.birthtimeMs, modified: s.mtimeMs };
  }
}

/** Grades already on the sheet, so regenerating does not destroy a rating pass. */
function readExistingGrades(): Map<string, string> {
  const grades = new Map<string, string>();
  if (!fs.existsSync(OUTPUT)) return grades;
  for (const line of fs.readFileSync(OUTPUT, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 10) continue;
    const grade = cells[2] ?? "";
    if (!/^(must|useful|not-needed|wrong)$/.test(grade)) continue;
    grades.set(`${cells[3]}\u0000${cells[4]}`, grade);
  }
  return grades;
}

async function main(): Promise<void> {
  const existing = readExistingGrades();
  const graph = await buildWikiGraph({ vault: new NodeVault() });
  const ctx = createContext({ graph });
  const labelOf = (id: string): string => graph.nodeIndex.get(id)?.label ?? id;

  const scored = candidatePairs(ctx)
    .map(([a, b]) => ({ a, b, signals: signalsFor(a, b, ctx) }))
    .map((entry) => ({ ...entry, score: scoreSignals(entry.signals) }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort(
      (x, y) => y.score - x.score || (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || (x.b < y.b ? -1 : 1),
    )
    .slice(0, EXPORT_LIMIT);

  const lines: string[] = [
    "# 缺失链接评分表 / Missing-link rating sheet",
    "",
    `生成自真实 vault，共 **${scored.length}** 条候选（按分数排序，前 ${MISSING_LINK_LIMIT} 条是面板会展示的）。`,
    "评分表由 `npm run eval:missing-links` 生成，不要手改数字列。",
    "",
    "## 怎么评",
    "",
    "每条候选都是「这两篇笔记没有互相链接，但结构上关系很近」——",
    "**与未链接提及不同，这里没有正文证据**，唯一的理由是它们共享邻居。",
    "判断标准是：这对链接加上去，对你有用吗？",
    "",
    "| 评级 | 含义 |",
    "|---|---|",
    "| `must` | 确实该连，不加是遗漏 |",
    "| `useful` | 加上更好，但不加也不算错 |",
    "| `obvious` | 我早就知道它们相关，只是故意没连 |",
    "| `wrong` | 这两篇根本不该连 |",
    "",
    "**`obvious` 是这张表的重点。** 方案 §8.2 从构成分析预测：这类卡片推荐的主要是",
    "「用户早就考虑过、故意没连」的对。如果 `obvious` 占比高，这个预测就成立。",
    "",
    "两条辅助列请一并参考：",
    "",
    "- **共享邻居**：真实链接平均约 5 个（实测）。数值明显偏高说明它在挑图里最稠密的地方。",
    "- **最高邻居度数**：≥ 20 即为 `经由枢纽`。若几乎每条都经由枢纽，说明它推荐的是",
    "  索引页附近的对，而不是发现。",
    "",
    "---",
    "",
    `## 候选（${scored.length} 条）`,
    "",
    "| # | 评级 | 页面 A | 页面 B | 分数 | 共享邻居 | 最高邻居度数 | 经由枢纽 | 面板显示 |",
    "|---:|---|---|---|---:|---:|---:|:---:|:---:|",
  ];

  scored.forEach((entry, position) => {
    const grade = existing.get(`${labelOf(entry.a)}\u0000${labelOf(entry.b)}`) ?? "";
    const hub = entry.signals.maxSharedDegree >= 20 ? "是" : "";
    const shown = position < MISSING_LINK_LIMIT ? "✓" : "";
    lines.push(
      `| ${position + 1} | ${grade} | ${labelOf(entry.a)} | ${labelOf(entry.b)} | ` +
        `${entry.score.toFixed(2)} | ${entry.signals.commonNeighbours} | ` +
        `${entry.signals.maxSharedDegree} | ${hub} | ${shown} |`,
    );
  });

  const hubRouted = scored.filter((entry) => entry.signals.maxSharedDegree >= 20).length;
  const meanShared = scored.reduce((sum, entry) => sum + entry.signals.commonNeighbours, 0) / Math.max(1, scored.length);

  // The comparison the percentage is worthless without: real links measured on this
  // vault average 5.06 shared neighbours and are themselves 80 % hub-routed, so "93 %
  // hub-routed" only means something next to that 80.
  const edgePairs = graph.edges.map((edge) => [edge.source, edge.target] as const);
  const edgeSignals = edgePairs.map(([a, b]) => signalsFor(a, b, ctx));
  const edgeShared =
    edgeSignals.reduce((sum, signals) => sum + signals.commonNeighbours, 0) / Math.max(1, edgeSignals.length);
  const edgeHubRouted =
    edgeSignals.filter((signals) => signals.maxSharedDegree >= 20).length / Math.max(1, edgeSignals.length);

  lines.push(
    "",
    "---",
    "",
    "## 生成时的自动测量",
    "",
    "| | 候选 | 真实链接（对照） |",
    "|---|---:|---:|",
    `| 平均共享邻居 | **${meanShared.toFixed(2)}** | ${edgeShared.toFixed(2)} |`,
    `| 经由枢纽页（最高邻居度数 ≥ 20） | **${((100 * hubRouted) / Math.max(1, scored.length)).toFixed(0)}%** | ${(100 * edgeHubRouted).toFixed(0)}% |`,
    `| 条数 | ${scored.length} | ${edgeSignals.length} |`,
    "",
    "对照列是同一把尺子量在**真实链接**上。候选的平均共享邻居是真实链接的" +
      `${(meanShared / Math.max(edgeShared, 1e-6)).toFixed(1)} 倍，`,
    "但**经由枢纽的比例几乎相同**。这一点推翻了先前的一句话——「几乎每条都经由枢纽，",
    "说明推荐的是索引页附近的对」是过度解读：这个库本身就有多数真实链接经由枢纽页，",
    "所以候选的枢纽比例并不异常。枢纽路由在这里不是筛选器的偏差，而是整个库的形状。",
    "",
    "所以判断应该落在**语义**上：这两篇该不该互连。若 `obvious` 占比高，§8.2 的预测",
    "成立，这一期应当考虑撤掉或降级，而不是继续调权重。",
    "",
  );

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");

  console.log(`vault:      ${vaultRoot}`);
  console.log(`candidates: ${scored.length} (panel shows the top ${MISSING_LINK_LIMIT})`);
  console.log(
    `shared neighbours: mean ${meanShared.toFixed(2)} vs ${edgeShared.toFixed(2)} for real links ` +
      `(${(meanShared / Math.max(edgeShared, 1e-6)).toFixed(1)}×)`,
  );
  console.log(
    `hub-routed: ${((100 * hubRouted) / Math.max(1, scored.length)).toFixed(0)} % vs ` +
      `${(100 * edgeHubRouted).toFixed(0)} % for real links`,
  );
  console.log(`\nrating sheet -> ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
