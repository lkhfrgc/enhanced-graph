/**
 * Emits a rating sheet for the unlinked-mention candidates.
 *
 * Why this is a separate script rather than part of `eval:insights`: the plan's
 * Phase 2 gate is a HUMAN rating, and `eval:insights` is a ranking measurement. A
 * script that cannot answer its own question should not masquerade as the answer —
 * everything downstream of the numbers here is a person's judgement, so the output
 * is a form to fill in, not a metric.
 *
 * The sheet is deliberately one row per candidate with the sentence that matched.
 * Rating an unlinked mention is cheap precisely because the evidence is a line of
 * the reader's own prose: they know instantly whether the link belongs there, and
 * no amount of scoring can substitute for that.
 *
 * Usage: npm run eval:mentions -- [vaultPath]
 */

import fs from "node:fs";
import path from "node:path";

import { buildWikiGraph } from "../src/core/graph-builder";
import { contentIndexOf } from "../src/core/content-index";
import { MENTION_LIMIT } from "../src/core/insights/content";
import type { VaultAdapter } from "../src/core/vault";

const vaultRoot = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "插件开发"));
const OUTPUT = path.resolve(process.cwd(), "docs", "mention-rating-sheet.md");

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
}

async function main(): Promise<void> {
  const vault = new NodeVault();
  const graph = await buildWikiGraph({ vault });
  const index = contentIndexOf(graph);
  if (index === null) {
    console.error("no content index — nothing to rate");
    process.exit(1);
  }

  const present = new Set(graph.nodes.map((node) => node.id));
  const candidates = index.mentions
    .filter((mention) => present.has(mention.sourceId) && present.has(mention.targetId))
    .sort((a, b) => b.specificity - a.specificity || b.occurrences - a.occurrences);

  const labelOf = (id: string): string => graph.nodeIndex.get(id)?.label ?? id;
  const pathOf = (id: string): string => graph.nodeIndex.get(id)?.path ?? `${id}.md`;

  const lines: string[] = [
    "# 未链接提及评分表 / Unlinked-mention rating sheet",
    "",
    `生成自真实 vault，共 **${candidates.length}** 条候选。`,
    `评分表由 \`npm run eval:mentions\` 生成，不要手改数字列。`,
    "",
    "## 怎么评",
    "",
    "每条候选都是「某篇笔记的正文里写到了另一个页面的名字，但没有连」。",
    "看 `上下文` 那一列——那是你自己的句子，判断这条链接该不该加：",
    "",
    "| 评级 | 含义 |",
    "|---|---|",
    "| `must` | 这里确实该有链接，不加是遗漏 |",
    "| `useful` | 加上更好，但不加也不算错 |",
    "| `not-needed` | 是有意不连的，或者提一句就够了 |",
    "| `wrong` | 根本不是这个页面的意思（同词不同义、误匹配） |",
    "",
    "在 `评级` 列填这四种之一。`备注` 列可选。",
    "评完把表发回来，我算接受率（`must` + `useful`）与 `wrong` 率。",
    "",
    "**为什么要人工评**：离线指标只能测「排序准不准」。这里要问的是「推荐的这对",
    "值不值得连」，那是关于你的笔记的判断，任何打分函数都替代不了。",
    "",
    "---",
    "",
    `## 候选（${candidates.length} 条，按特异性排序）`,
    "",
    "| # | 评级 | 来源页面 | 目标页面 | 命中词 | 次数 | 特异性 | 上下文 |",
    "|---:|---|---|---|---|---:|---:|---|",
  ];

  candidates.forEach((mention, position) => {
    const context = mention.preview.replace(/\|/g, "\\|");
    lines.push(
      `| ${position + 1} |  | ${labelOf(mention.sourceId)} | ${labelOf(mention.targetId)} | ` +
        `${mention.term} | ${mention.occurrences} | ${mention.specificity.toFixed(2)} | ${context} |`,
    );
  });

  lines.push(
    "",
    "---",
    "",
    "## 面板实际会展示的（前 8 条，按特异性截断）",
    "",
    `分析器的上限是 ${MENTION_LIMIT} 条提及。上表按同一顺序排序，所以面板展示的就是前 ${MENTION_LIMIT} 行。`,
    "",
    "## 汇总（评完之后填）",
    "",
    "| 指标 | 值 |",
    "|---|---|",
    "| must |  |",
    "| useful |  |",
    "| not-needed |  |",
    "| wrong |  |",
    "| 接受率 (must+useful) / 总数 |  |",
    "| wrong 率 |  |",
    "",
  );

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");

  console.log(`vault:      ${vaultRoot}`);
  console.log(`notes:      ${graph.nodes.length}`);
  console.log(`candidates: ${candidates.length}`);
  console.log(`notes with >= 1: ${new Set(candidates.map((c) => c.sourceId)).size}`);
  console.log(`\nrating sheet -> ${OUTPUT}`);
  console.log("\nfirst 8 (what the panel shows):");
  for (const mention of candidates.slice(0, MENTION_LIMIT)) {
    console.log(
      `  ${labelOf(mention.sourceId)} → ${labelOf(mention.targetId)}  ` +
        `"${mention.term}" x${mention.occurrences}  spec ${mention.specificity.toFixed(2)}`,
    );
  }
  void pathOf;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
