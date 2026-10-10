/**
 * Pure markdown-note parsing: frontmatter, wikilinks, page type.
 *
 * Deliberately free of any Obsidian import so the whole engine stays testable
 * in Node and in the browser harness.
 */

import yaml from "js-yaml";
import { normalizeVaultPath } from "./vault";
import type { PageType } from "../types";

export interface ParsedNote {
  /** Vault-relative path with `.md`. */
  readonly path: string;
  /** Vault-relative path without `.md`, lower-cased for stable identity. */
  readonly id: string;
  /** Original-case id, used for `[[link]]` resolution and display order. */
  readonly rawId: string;
  readonly basename: string;
  readonly title: string;
  readonly rawType: string;
  readonly type: PageType;
  /** Normalised `sources[]` keys. */
  readonly sources: readonly string[];
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  /** Raw wikilink targets plus frontmatter `related[]` entries. */
  readonly links: readonly string[];
  readonly isStructural: boolean;
  /**
   * The note's text with the frontmatter block removed.
   *
   * Carried because "does this note already mention that page in prose?" cannot be
   * answered from the graph: the graph knows what was *linked*, and an unlinked
   * mention is precisely a mention that produced no link. Every consumer of this
   * field derives a bounded signal from it and then drops the string — the content
   * index keeps term lists, not bodies — so holding it this long does not mean
   * holding a vault's text in memory for the session.
   */
  readonly body: string;
}

// ---------------------------------------------------------------------------
// Page type normalisation
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Record<string, PageType> = {
  // entity
  entity: "entity", entities: "entity", 实体: "entity", 人物: "entity", 组织: "entity",
  person: "entity", org: "entity", organization: "entity", product: "entity", tool: "entity",
  产品: "entity", 工具: "entity", 项目: "entity", project: "entity",
  // concept
  concept: "concept", concepts: "concept", 概念: "concept", 术语: "concept", term: "concept",
  topic: "concept", 主题: "concept", theory: "concept", 理论: "concept",
  // source
  source: "source", sources: "source", 资料: "source", 来源: "source", reference: "source",
  paper: "source", 论文: "source", 文献: "source", book: "source", 书籍: "source",
  article: "source", 文章: "source", video: "source", 视频: "source", clip: "source", 剪藏: "source",
  // synthesis
  synthesis: "synthesis", 综述: "synthesis", 综合: "synthesis", summary: "synthesis",
  总结: "synthesis", 汇总: "synthesis", digest: "synthesis", 摘要: "synthesis",
  // query
  query: "query", queries: "query", 查询: "query", research: "query", 研究: "query", 检索: "query",
  // comparison
  comparison: "comparison", compare: "comparison", 比较: "comparison", 对比: "comparison",
  contrast: "comparison", 对照: "comparison",
  // finding
  finding: "finding", findings: "finding", 发现: "finding", 结论: "finding",
  result: "finding", 结果: "finding", insight: "finding", 洞察: "finding",
  // thesis
  thesis: "thesis", 论点: "thesis", 主张: "thesis", claim: "thesis", 观点: "thesis",
  hypothesis: "thesis", 假设: "thesis",
  // methodology
  methodology: "methodology", method: "methodology", 方法论: "methodology", 方法: "methodology",
  process: "methodology", 流程: "methodology", 步骤: "methodology",
  // overview / structural
  overview: "overview", 概述: "overview", index: "overview", 索引: "overview",
  moc: "overview", 目录: "overview", 导航: "overview", hub: "overview",
};

export function normalizePageType(raw: unknown): PageType {
  if (typeof raw !== "string") return "other";
  const key = raw.trim().toLowerCase();
  if (!key) return "other";
  return TYPE_ALIASES[key] ?? (TYPE_ALIASES[raw.trim()] || "other");
}

/**
 * The page type as the user declared it, lower-cased for comparison.
 *
 * A custom type — anything not in `TYPE_ALIASES` — normalises to `other`, so before
 * this every custom type in a vault shared one row: twenty of them were a single
 * un-filterable 其他, all one colour, and the panels listed only the eleven types the
 * plugin knows about. What the user actually wrote is already on the node as
 * `rawType`; this is the key the panels filter, legend and colour by.
 *
 * Canonical declarations keep their canonical key (`type: concept` → `concept`), so
 * existing settings and the palette are unaffected. `node.type` remains the
 * normalised type, which is what the analysis reasons about.
 */
export function pageTypeKey(rawType: string, fallback: string): string {
  const raw = (rawType ?? "").trim();
  return (raw || fallback).toLowerCase();
}

/**
 * The type, written the way the note declares it.
 *
 * What every surface shows — a legend row, a hover card, a status line, the report. A note
 * that says `type: 实验记录` is described as `实验记录`: not the plugin's internal idea of
 * what that means, and not translated. A type is a value in someone's notes, not a piece of
 * interface text. Only a note with no type at all falls back to the inferred id.
 */
export function declaredTypeLabel(rawType: string, fallback: string): string {
  return (rawType ?? "").trim() || fallback;
}

/**
 * Ids that are navigational scaffolding rather than knowledge.
 *
 * The Chinese entries include every word the visibility switch names — 索引, 概览,
 * 日志 — because a switch that says it hides those and does not is worse than a
 * shorter label. The English pattern below catches the same words as prefixes
 * (`Index of Things`, `Log 2026-01`).
 */
const STRUCTURAL_SLUGS = new Set([
  "index", "overview", "log", "purpose", "schema", "home", "readme", "moc", "inbox",
  "索引", "概述", "目录", "首页", "概览", "日志",
]);

export function isStructuralSlug(basename: string): boolean {
  const slug = basename.trim().toLowerCase().replace(/\.md$/, "");
  if (STRUCTURAL_SLUGS.has(slug)) return true;
  return /^(index|overview|log|purpose|schema|moc)\b/.test(slug);
}

// ---------------------------------------------------------------------------
// Source normalisation
// ---------------------------------------------------------------------------

/**
 * Reduce a `sources[]` entry to a comparable key so that
 * `"raw/papers/Attention Is All You Need.pdf"`, `"[[Attention Is All You Need]]"`
 * and `"attention is all you need"` all collapse onto one key.
 */
export function normalizeSourceKey(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  value = value.replace(/^\[\[|\]\]$/g, "");
  value = value.split("|")[0];
  value = value.split("#")[0];
  value = value.replace(/\\/g, "/");
  value = value.split("/").pop() ?? value;
  value = value.replace(/\.(md|pdf|docx?|txt|html?|epub|mobi|pptx?|xlsx?)$/i, "");
  value = value.replace(/\s+/g, " ").trim().toLowerCase();
  return value;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface FrontmatterResult {
  readonly data: Record<string, unknown>;
  /** Body with the frontmatter block removed. */
  readonly body: string;
  readonly raw: string;
}

export function splitFrontmatter(content: string): FrontmatterResult {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: content, raw: "" };
  let data: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML must never take the graph down; fall back to no metadata.
    data = {};
  }
  return { data, body: content.slice(match[0].length), raw: match[1] };
}

function toStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    // `tags: a, b` and `sources: [[x]], [[y]]` both occur in the wild.
    return value
      .split(/[,\n]/)
      .map((part) => part.trim().replace(/^\[\[|\]\]$/g, "").trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item.trim());
      else if (typeof item === "number") out.push(String(item));
    }
    return out.filter(Boolean);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

// Inside a character class, `[` needs no escape.
const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

/** Remove fenced and inline code so links inside code are not counted. */
export function stripCode(content: string): string {
  return content
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
}

/** `[[Target|alias]]` / `[[Target#heading]]` / `[[Target#^block|alias]]` → `Target`. */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const scannable = stripCode(content);
  const re = new RegExp(WIKILINK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(scannable)) !== null) {
    const inner = match[1];
    const target = inner.split("|")[0].split("#")[0].trim();
    if (target) links.push(target);
  }
  return links;
}

/** Normalise a frontmatter `related[]` entry into a bare link target. */
export function normalizeRelatedEntry(raw: string): string {
  let value = raw.trim().replace(/^\[\[|\]\]$/g, "");
  value = value.split("|")[0].split("#")[0].replace(/\\/g, "/");
  return (value.split("/").pop() ?? value).replace(/\.md$/i, "").trim();
}

// ---------------------------------------------------------------------------
// Note parsing
// ---------------------------------------------------------------------------

export function parseNote(path: string, content: string): ParsedNote {
  const normalizedPath = normalizeVaultPath(path);
  const fileBase = normalizedPath.split("/").pop() ?? normalizedPath;
  const basename = fileBase.replace(/\.md$/i, "");
  const rawId = normalizedPath.replace(/\.md$/i, "");
  const id = rawId.toLowerCase();

  const { data, body } = splitFrontmatter(content);

  const rawType =
    typeof data.type === "string" ? data.type.trim()
    : typeof data.Type === "string" ? String(data.Type).trim()
    : "";
  const type = normalizePageType(rawType);

  const sources = toStringArray(data.sources ?? data.source)
    .map(normalizeSourceKey)
    .filter(Boolean);

  const tags = toStringArray(data.tags ?? data.tag).map((tag) => tag.replace(/^#/, "").trim());
  const aliases = toStringArray(data.aliases ?? data.alias);

  const related = toStringArray(data.related)
    .map(normalizeRelatedEntry)
    .filter(Boolean);

  const links = Array.from(new Set([...extractWikilinks(body), ...extractWikilinks(content), ...related]));

  const title = pickTitle(data.title, body, basename);
  const isStructural = type === "overview" || isStructuralSlug(basename);

  return {
    path: normalizedPath,
    id,
    rawId,
    basename,
    title,
    rawType,
    type,
    sources: Array.from(new Set(sources)),
    tags,
    aliases,
    links,
    isStructural,
    body,
  };
}

function pickTitle(frontmatterTitle: unknown, body: string, basename: string): string {
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  if (typeof frontmatterTitle === "number") return String(frontmatterTitle);
  const heading = body.match(/^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  if (heading) return heading[1].trim();
  return basename.replace(/[-_]+/g, " ").trim() || basename;
}
