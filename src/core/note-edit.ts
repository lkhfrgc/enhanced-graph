/**
 * The one edit an insight action performs: inserting a wikilink into a note.
 *
 * Pure, like everything else in `core/**`: this computes the whole new file
 * content and says whether writing it is safe; the caller does the I/O. That split
 * is what lets every way the edit can go wrong — a term inside a code fence, a
 * mention that is already inside a link, a pair that is already connected — be
 * tested in Node rather than in Obsidian.
 *
 * The rules come from the plan's §5.6: insert the wikilink a card recommends,
 * with a preview of the diff first. This module produces the content the preview
 * shows *and* the content that is written, so the two cannot disagree.
 *
 * `stripCode` in `parse.ts` is the reference for what counts as code, but it
 * *removes* code and this must not — a position is needed instead — so the same
 * three passes are re-run here with their match offsets kept.
 */

import { splitFrontmatter, stripCode } from "./parse";

/** What to write, and whether writing is safe. */
export interface LinkInsertion {
  readonly changed: boolean;
  readonly content: string;
  /** Why nothing changed, for a message the user can read. */
  readonly reason?: "already-linked" | "term-not-found" | "no-change";
}

export interface InsertWikilinkOptions {
  /** The bare name to replace: a page's title, alias or file name. */
  readonly term: string;
  /** The exact wikilink text to insert. Taken verbatim from the action. */
  readonly text: string;
  /** Id of the page being linked to, used only to detect an existing link. */
  readonly targetId: string;
}

/** A half-open `[start, end)` span of the text. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Where the inserted text sits in the new line, as a span of that line.
 *
 * The preview shows the reader two versions of one line, and the only thing that
 * changed is the link. Highlighting it needs its offsets, and they cannot come from
 * the term: the replacement is a wikilink whose text was built elsewhere, so the
 * position has to be derived from the pair of strings the preview is already showing.
 *
 * Common prefix and suffix, iteratively from both ends. This is exact rather than
 * approximate for this edit, because the edit is defined as replacing one span — the
 * matched term — with another, so exactly one run differs and everything outside it is
 * shared. It would be wrong for a general diff, which is not what this is for.
 *
 * Returns `null` when the lines are identical, which the caller renders as no
 * highlight rather than an empty one.
 */
export function insertedSpan(before: string, after: string): Span | null {
  if (before === after) return null;

  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;

  // The suffix must not reach back past the prefix: on `aa` → `a` every character is
  // shared with itself, and unbounded pursuit would report a negative-width span.
  let suffix = 0;
  while (
    suffix < shortest - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const end = after.length - suffix;
  if (end <= start) return null;
  return { start, end };
}

/** Same shape as `parse.ts` uses, so this agrees with what the graph reads. */
const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

/**
 * A markdown link or embed: `[label](target)` / `![label](target)`.
 *
 * Not one of the plan's listed rules, but the same corruption as inserting inside
 * `[[...]]`: the term in `[Beta](url)` is a link's label, and a wikilink dropped
 * into it produces `[[[Beta]]](url)`, which renders as neither.
 */
const MARKDOWN_LINK_RE = /!?\[[^\]\n]*\]\([^)\n]*\)/g;

/** The three code shapes `stripCode` removes, kept here only for their offsets. */
const FENCE_RE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const FENCE_LOOSE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * Characters that end a word.
 *
 * Mirrors `content-index.ts` on purpose: the analyser decided this term was a
 * mention, and the edit must agree about where one ends — `Agent` inside `Agents`
 * is the analyser's term, not a second occurrence of it. CJK has no boundaries to
 * check, so a Chinese term matches wherever it occurs.
 */
const WORD_CHAR = /[0-9A-Za-z\u00C0-\u024F]/;

/**
 * Insert a wikilink at the first unlinked occurrence of the target's name.
 *
 * Returns the whole new file content, so the caller writes once. When
 * `changed` is false the returned content is the input, unchanged — so a caller
 * that ignores the flag still cannot corrupt anything.
 */
export function insertWikilink(content: string, options: InsertWikilinkOptions): LinkInsertion {
  const term = options.term.trim();
  const text = options.text;
  if (!term || !text) return { changed: false, content, reason: "term-not-found" };

  // A pair that is already connected is a fact the card got wrong, not an edit to
  // repeat: refuse before looking for a place to put a second link.
  if (hasLinkTo(content, options.targetId)) {
    return { changed: false, content, reason: "already-linked" };
  }

  const { body } = splitFrontmatter(content);
  // Everything before the body is frontmatter and is never touched; the insertion
  // is computed on the body and then re-attached to this prefix.
  const bodyOffset = content.length - body.length;

  const skips: Span[] = [
    ...codeSpans(body),
    ...spansMatching(body, WIKILINK_RE),
    ...spansMatching(body, MARKDOWN_LINK_RE),
  ];

  let prose: Span | null = null;
  let heading: Span | null = null;
  const matches = new RegExp(escapeRegExp(term), "gi");
  let match: RegExpExecArray | null;
  while ((match = matches.exec(body)) !== null) {
    const span: Span = { start: match.index, end: match.index + match[0].length };
    if (!boundaryOk(body, span.start, span.end - span.start)) continue;
    if (overlaps(skips, span.start, span.end - span.start)) continue;
    if (isHeadingLine(body, span.start)) {
      if (heading === null) heading = span;
      continue;
    }
    prose = span;
    break;
  }

  // Prose beats a heading wherever the heading is: a term in `# Beta` is the
  // page's own title, and linking a page to itself reads as a mistake.
  const chosen = prose ?? heading;
  if (chosen === null) return { changed: false, content, reason: "term-not-found" };

  const replacement = applyLink(body, chosen, text, parseLink(text).display);
  const next = `${body.slice(0, replacement.span.start)}${replacement.text}${body.slice(replacement.span.end)}`;
  const result = `${content.slice(0, bodyOffset)}${next}`;
  // `changed` means "the file is different", not "a term was found": a term that
  // already is the link text would otherwise be reported as a successful write of
  // an identical file.
  if (result === content) return { changed: false, content, reason: "no-change" };
  return { changed: true, content: result };
}

/**
 * Opening bracket characters that introduce a gloss on the term before them.
 *
 * Both widths, because both are used: `偏好优化（DPO）` in a Chinese sentence and
 * `alignment tax (alignment tax)` in an English one.
 */
const OPEN_GLOSS = new Set(["（", "("]);

/** The closing counterpart of each opening bracket. */
const CLOSE_FOR: Readonly<Record<string, string>> = { "（": "）", "(": ")" };

/**
 * How far ahead a closing bracket may be and still belong to the gloss.
 *
 * A gloss is short — an abbreviation, a translated term. Without a bound, a `（` that
 * opens a clause would be treated as the term's gloss and the link put in the wrong
 * sentence entirely, which is worse than not making the edit.
 */
const MAX_GLOSS = 24;

/**
 * A wikilink's parts: `[[target|alias]]` and `[[target]]` both parse.
 *
 * Display text is the alias when there is one, and the target's file name otherwise —
 * which is what Obsidian shows, and what decides whether an edit changes the prose.
 */
function parseLink(text: string): { target: string; alias: string; display: string } {
  const inner = text.replace(/^\[\[/, "").replace(/\]\]$/, "");
  const bar = inner.indexOf("|");
  const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : "";
  const display = alias || (target.split("#")[0].split("/").pop() ?? target).replace(/\.md$/i, "");
  return { target, alias, display };
}

/**
 * Keep the reader's word by making it the link's alias.
 *
 * A mention matches a page through its frontmatter aliases, and an alias is often a
 * *narrower* term than the page name. `对齐税.md` lists `过度拒答` because over-refusal
 * is one of the tax's symptoms — so replacing `过度拒答` with `[[对齐税]]` states the
 * category where the sentence said the symptom:
 *
 *    对齐会带来"对齐税"：过度拒答、回答趋同、…
 * →  对齐会带来"对齐税"：[[对齐税]]、回答趋同、…      ← the sentence got worse
 *
 * The author listed the alias because they do mean that page by that word, so the
 * matched spelling becomes the link's display text and the prose is untouched:
 *
 *    对齐会带来"对齐税"：[[对齐税|过度拒答]]、回答趋同、…
 *
 * No alias is added when the matched term *is* the page's name (case-insensitively),
 * so the ordinary case stays a plain `[[Target]]` rather than `[[Target|target]]`.
 * Where the note writes the name in different case, the note's own spelling wins:
 * it is the text the reader is looking at, and the link resolves either way.
 */
function withTermAsAlias(text: string, term: string): string {
  const { target, alias, display } = parseLink(text);
  if (!target) return text;
  if (alias === term) return text;
  if (display.toLowerCase() === term.toLowerCase()) return text;
  return `[[${target}|${term}]]`;
}

/**
 * Where an insertion goes and what it replaces: a span, and the text for it.
 *
 * Everything except the plain "replace the matched term" case is expressed as a span
 * whose text is different, so there is exactly one place that rebuilds the body.
 */
interface Replacement {
  readonly span: Span;
  readonly text: string;
}

/**
 * Put the link where it does not delete the reader's words.
 *
 * The edit is nominally "replace the matched term with the link text", and that is
 * wrong in two common shapes — both found by reading a real preview rather than by
 * reasoning about the rules.
 *
 * **A term glossed in brackets.** A note writes a short form and then names the page —
 * `偏好优化（RLHF 与 DPO）` — and substituting the term left that name dangling after a
 * link that already said it. When the brackets hold the page's own name, the link
 * replaces their contents and the sentence is otherwise untouched:
 *
 *    再用…或直接偏好优化（RLHF 与 DPO）把模型推向…
 * →  再用…或直接偏好优化（[[RLHF 与 DPO]]）把模型推向…
 *
 * A bracket is only a gloss when its contents *are* the page name. `偏好优化（DPO）` is
 * an aside about a different term, and putting this link there would place it in the
 * wrong group of words.
 *
 * **A term that is an alias of the page.** The page's aliases are narrower words —
 * `对齐税.md` lists `过度拒答` — so the page name cannot stand in for the term. The
 * matched spelling becomes the link's display text, which keeps the sentence and still
 * resolves to the page ({@link withTermAsAlias}).
 *
 * The two cases take different text on purpose: the bracket case uses the caller's
 * `text` because the replaced word *is* the page's name, and the general case derives
 * an alias because the replaced word is the reader's, not the page's.
 *
 * The bracket case is decided first. An earlier version wrapped the term as an alias
 * before looking at the bracket, which meant the bracket could never match and the
 * gloss case silently stopped working — while every test still passed, because the
 * alias form was a reasonable-looking result.
 */
function applyLink(body: string, span: Span, text: string, pageName: string): Replacement {
  let bracket = span.end;
  if (body[bracket] === " " && OPEN_GLOSS.has(body[bracket + 1] ?? "")) bracket += 1;

  const open = body[bracket] ?? "";
  const close = CLOSE_FOR[open];
  if (close !== undefined && pageName !== "") {
    const limit = Math.min(body.length, bracket + 1 + MAX_GLOSS);
    const at = body.indexOf(close, bracket + 1);
    if (
      at > 0 &&
      at <= limit &&
      body.slice(bracket + 1, at).trim().toLowerCase() === pageName.toLowerCase()
    ) {
      // The brackets already display the page's name, so the caller's plain text is
      // exactly right and the sentence is left as it was.
      return { span: { start: bracket + 1, end: at }, text };
    }
  }

  // The matched spelling, not the trimmed term: a note may write `beta` where the page
  // says `Beta`, and the reader's own casing is what the link should display.
  return { span, text: withTermAsAlias(text, body.slice(span.start, span.end)) };
}

/**
 * Whether the note already links to `targetId`.
 *
 * Four spellings count — `[[Target]]`, `[[path/Target]]`, `[[Target|alias]]` and
 * `[[Target#heading]]` — and all of them case-insensitively, because the id is
 * lower-cased while the file name is not. Code is stripped first, exactly as
 * `extractWikilinks` does it: a link Obsidian renders as code is not a link, so it
 * must not block an edit the reader would still call missing.
 *
 * A link to a *different* file with the same basename counts as linked. Obsidian
 * resolves `[[Target]]` through the basename and cannot tell the two apart from
 * the link text alone, so refusing is the safe side of an ambiguity: the cost is
 * one edit the user has to make by hand, against a link inserted into a note that
 * already points somewhere with that name.
 */
function hasLinkTo(content: string, targetId: string): boolean {
  const target = normalizeLinkTarget(targetId);
  if (!target) return false;
  const scannable = stripCode(content);
  const links = new RegExp(WIKILINK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = links.exec(scannable)) !== null) {
    const link = normalizeLinkTarget(match[1] ?? "");
    if (!link) continue;
    if (link === target || basename(link) === basename(target)) return true;
  }
  return false;
}

/**
 * An inner wikilink target reduced to the key Obsidian resolves it by:
 * alias and heading dropped, `\` normalised, `.md` stripped, lower-cased.
 */
function normalizeLinkTarget(raw: string): string {
  const value = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/\.md$/i, "");
  return value.toLowerCase();
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Whether the term's match sits inside a fenced block or an inline code span. */
function codeSpans(text: string): Span[] {
  const spans: Span[] = [
    ...spansMatching(text, FENCE_RE),
    ...spansMatching(text, FENCE_LOOSE_RE),
    ...spansMatching(text, INLINE_CODE_RE),
  ];
  // An unclosed fence renders the rest of the note as code, so nothing after it is
  // a safe place to link. `stripCode` leaves that text alone — it only removes
  // fences it can see the end of — and a link inserted there would stay literal.
  const open = unclosedFenceStart(text);
  if (open >= 0) spans.push({ start: open, end: text.length });
  return mergeSpans(spans);
}

/** Where an unterminated fence starts, or -1 when every fence is closed. */
function unclosedFenceStart(text: string): number {
  let offset = 0;
  let openAt = -1;
  let marker = "";
  for (const line of text.split("\n")) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const char = (fence[1] ?? "")[0] ?? "";
      // A closing fence uses the same character as the one that opened it.
      if (openAt < 0) {
        openAt = offset;
        marker = char;
      } else if (char === marker) {
        openAt = -1;
      }
    }
    offset += line.length + 1;
  }
  return openAt;
}

/** Every match of `re` as a span. The caller supplies a fresh, global regex. */
function spansMatching(text: string, re: RegExp): Span[] {
  const spans: Span[] = [];
  const scanner = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    if (match[0].length === 0) {
      scanner.lastIndex += 1;
      continue;
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** Sort and coalesce, so an overlap test is a single scan. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) out[out.length - 1] = { start: last.start, end: span.end };
      continue;
    }
    out.push(span);
  }
  return out;
}

/** Whether `[start, start + length)` touches any skipped span. */
function overlaps(spans: readonly Span[], start: number, length: number): boolean {
  const end = start + length;
  return spans.some((span) => start < span.end && end > span.start);
}

/** Whether the position is on a line that renders as a heading. */
function isHeadingLine(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^ {0,3}#{1,6}[ \t]/.test(text.slice(lineStart, index + 1));
}

/** Whether an occurrence sits on a word boundary; see {@link WORD_CHAR}. */
function boundaryOk(text: string, start: number, length: number): boolean {
  const first = text[start] ?? "";
  const before = start === 0 ? "" : text[start - 1] ?? "";
  const after = start + length >= text.length ? "" : text[start + length] ?? "";
  if (WORD_CHAR.test(first) && WORD_CHAR.test(after)) return false;
  if (WORD_CHAR.test(first) && WORD_CHAR.test(before)) return false;
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
