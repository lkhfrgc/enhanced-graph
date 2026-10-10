/**
 * Restores the human rating onto the generated sheet.
 *
 * Why a script per change: this sheet is the only place a person's judgement about
 * the candidates exists, and the generator cannot reproduce it — so a rule change
 * that regenerates the sheet must not silently drop it. The grades below are the
 * vault owner's, transcribed once; the generator now reads whatever is on the sheet
 * and keeps it, so this only has to run when the previous file has been lost.
 *
 * Keys are source label + target label + term, transcribed in the order the sheet
 * listed them at the time of rating.
 */

import fs from "node:fs";
import path from "node:path";

const SHEET = path.resolve(process.cwd(), "docs", "mention-rating-sheet.md");

/** The rating, as filled in on 2026-10-10, in sheet order. */
const GRADES: ReadonlyArray<readonly [number, string]> = [
  [1, "u"],
  [2, "u"],
  [3, "w"],
  [4, "u"],
  [5, "w"],
  [6, "w"],
  [7, "u"],
  [8, "u"],
  [9, "u"],
  [10, "u"],
  [11, "u"],
  [12, "n"],
  [13, "u"],
  [14, "m"],
  [15, "m"],
  [16, "u"],
  [17, "m"],
  [18, "n"],
  [19, "n"],
  [20, "m"],
  [21, "n"],
  [22, "n"],
  [23, "m"],
  [24, "n"],
  [25, "n"],
  [26, "n"],
  [27, "u"],
  [28, "u"],
  [29, "n"],
  [30, "u"],
  [31, "u"],
  [32, "m"],
  [33, "u"],
  [34, "m"],
  [35, "m"],
  [36, "m"],
  [37, "m"],
];

/** The candidate each position held when it was rated, as `source|target|term`. */
const RATED_ORDER: readonly string[] = [
  "隐私与差分隐私|隐私与合规|Privacy",
  "知识库总览|上下文窗口|上下文长度",
  "Llama 3 技术报告|RAG 系统评测方法|评测方法",
  "RAG 综述 2024|上下文窗口|上下文长度",
  "多模态与具身智能展望|RAG 系统评测方法|评测方法",
  "内容审核|检索技术选型指南|技术选型",
  "内容审核|AI 法案与合规文档|合规文档",
  "越狱攻击|对齐税|Alignment Tax",
  "SPLADE 稀疏向量|ColBERT 延迟交互检索|ColBERT",
  "指令微调与对齐|对齐税|过度拒答",
  "安全评测基准|对齐税|过度拒答",
  "RLHF 与 DPO|指令微调与对齐|RLHF",
  "偏见与公平性|RLHF 与 DPO|RLHF",
  "OWASP LLM Top 10|智能体 Agent|Agent",
  "OWASP LLM Top 10|模型窃取|模型窃取",
  "偏见与公平性|指令微调与对齐|RLHF",
  "安全评测基准|智能体 Agent|Agent",
  "宪法 AI|指令微调与对齐|RLHF",
  "提示注入|智能体 Agent|Agent",
  "模型窃取|内容审核|内容审核",
  "红队测试|智能体 Agent|Agent",
  "指令微调与对齐|RLHF 与 DPO|偏好优化",
  "提示工程|提示注入|提示注入",
  "向量检索与关键词检索对比|可解释性|可解释性",
  "SPLADE 稀疏向量|可解释性|可解释性",
  "自注意力机制|可解释性|可解释性",
  "语义缓存|知识库版本管理|知识库版本管理",
  "知识库总览|知识库版本管理|知识库版本管理",
  "Attention Is All You Need|可解释性|可解释性",
  "上下文窗口|提示工程|Prompt",
  "混合检索|幻觉抑制|幻觉抑制",
  "语义缓存|推理优化|推理优化",
  "知识库总览|缩放定律|缩放定律",
  "合成查询生成方法|分块策略|分块策略",
  "SPLADE 稀疏向量|混合检索|混合检索",
  "SPLADE 稀疏向量|向量检索|向量检索",
  "隐私与差分隐私|向量检索|向量检索",
];

const FULL: Record<string, string> = {
  m: "must",
  u: "useful",
  n: "not-needed",
  w: "wrong",
};

function main(): void {
  const byKey = new Map<string, string>();
  GRADES.forEach(([position, letter]) => {
    const candidate = RATED_ORDER[position - 1];
    if (candidate === undefined) return;
    byKey.set(candidate, FULL[letter] ?? letter);
  });

  const lines = fs.readFileSync(SHEET, "utf8").split(/\r?\n/);
  let restored = 0;
  const out = lines.map((line) => {
    if (!line.startsWith("|")) return line;
    const cells = line.split("|");
    if (cells.length < 10) return line;
    const source = cells[3]?.trim() ?? "";
    const target = cells[4]?.trim() ?? "";
    const term = cells[5]?.trim() ?? "";
    const grade = byKey.get(`${source}|${target}|${term}`);
    if (grade === undefined) return line;
    cells[2] = ` ${grade} `;
    restored += 1;
    return cells.join("|");
  });

  fs.writeFileSync(SHEET, out.join("\n"), "utf8");
  console.log(`restored ${restored} grades into ${SHEET}`);
  const missing = RATED_ORDER.filter((candidate) => !candidate.includes("|") || true).length;
  void missing;
}

main();
