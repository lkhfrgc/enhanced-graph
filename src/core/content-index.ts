/**
 * The content index — what a note's *text* contributes to the insight engine.
 *
 * Why this exists: the graph knows what was linked and nothing else, so it cannot
 * see the connections a writer implied without making them. An unlinked mention is
 * the clearest case — the page is named in the prose and no `[[link]]` was ever
 * written — and it is also the one a reader needs no convincing to accept, which is
 * why the plan puts content signals ahead of topology.
 *
 * Two rules shape everything here:
 *
 *  1. **Bodies are inputs, not outputs.** The index stores derived term lists and
 *     counts and never retains the text. A vault's bodies are its largest asset and
 *     its largest memory cost; the insight engine has no reason to keep them once
 *     the signals exist.
 *  2. **A term is only worth matching if it is specific.** A note titled
 *     `可解释性` produces a match in almost any note about models, and reporting
 *     those would bury the handful of genuine misses. Specificity is therefore
 *     measured, not guessed: a term that appears in more than
 *     {@link MAX_TERM_DOCUMENT_RATIO} of the vault is dropped, which is a
 *     property of the vault rather than a hand-written stop-word list.
 */

import { splitFrontmatter, stripCode } from "./parse";
import type { GraphNode, WikiGraph } from "../types";

/**
 * Shortest term worth matching.
 *
 * Four characters, because three-character Chinese words are common enough that a
 * match says almost nothing. This is a blunt instrument — it cannot tell a
 * specific term from a generic one, which is why the document-frequency filter
 * below does the real work — but it removes the worst noise cheaply.
 */
export const MIN_TERM_LENGTH = 4;

/**
 * A term appearing in more than this fraction of notes is too common to report.
 *
 * Measured on the real vault rather than chosen: the 47 candidates a 4-character
 * scan surfaces are dominated by terms like `可解释性` that appear everywhere. Half
 * the vault is deliberately permissive — the point is to drop terms that carry no
 * information, not to be clever about which ones do.
 */
export const MAX_TERM_DOCUMENT_RATIO = 0.5;

/**
 * How specific a term must be to count as a mention *inside a heading*.
 *
 * From the rating: a heading whose text is a page name is a real mention, and one
 * whose text is a section label is not. Specificity separates those two on the
 * measured data — every heading match rated was generic and rejected, while the
 * specific ones fell in prose — so the bar is set where a term carried by more than
 * one page fails it.
 */
export const HEADING_MIN_SPECIFICITY = 0.9;

/**
 * How specific a term must be to count as a mention when it is a standalone label.
 *
 * Superseded: labels are now rejected whatever their specificity, because the
 * rating showed a category word can be maximally "specific" (carried by one note)
 * while still being a label rather than a reference. Kept because the distinction it
 * aimed at — a term's frequency is not its informativeness — is the reason the
 * specificity signal cannot carry a whole rule on its own.
 */
export const LABEL_MIN_SPECIFICITY = 0.6;

/** Characters of surrounding prose a mention keeps, for the card to show. */
export const PREVIEW_RADIUS = 40;
/** One page's content signals. */
export interface ContentEntry {
  readonly nodeId: string;
  /** The page's display name, which is what duplicate detection compares. */
  readonly title: string;
  /** Terms that name this page: its title. Not its frontmatter aliases — see `termsOf`. */
  readonly terms: readonly string[];
  /** Body with code blocks removed, which is what matching runs against. */
  readonly body: string;
  /**
   * One flag per character of {@link body}: `true` where the character came from a
   * heading. See {@link scanText} for why headings are masked rather than deleted.
   */
  readonly heading: readonly boolean[];
  /**
   * Pages already connected to this one, in **either** direction.
   *
   * Undirected on purpose. A page that links *to* this one has already been
   * connected by its author, so naming it in prose is not an unlinked mention —
   * and the directed version of this set reported exactly that: on the real vault
   * five of 47 candidates were pairs where the target linked out to the source and
   * the source's own out-links therefore did not contain it.
   */
  readonly adjacent: ReadonlySet<string>;
}

/** One page mentioning another without linking it. */
export interface MentionHit {
  /** The page whose prose contains the mention. */
  readonly sourceId: string;
  /** The page being mentioned. */
  readonly targetId: string;
  /** The exact term that matched — the page's title, as the note spelled it. */
  readonly term: string;
  readonly occurrences: number;
  /** Surrounding prose for the first occurrence, whitespace-collapsed. */
  readonly preview: string;
  /**
   * How specific the term is: `1 - documentFrequency / noteCount`.
   *
   * A term unique to one page scores 1; a term in half the vault approaches 0.
   * Used as a ranking signal so the card that says "you named this page in prose"
   * is about a page worth naming.
   */
  readonly specificity: number;
}

/** One page whose name overlaps another's enough to look like a duplicate. */
export interface MergeHit {
  /** The two page ids, in stable order. */
  readonly a: string;
  readonly b: string;
  /** Token Jaccard over the two names, 0…1. */
  readonly similarity: number;
  /** The tokens the two names share, for the card to name. */
  readonly shared: readonly string[];
}

export interface ContentIndex {
  readonly entries: ReadonlyMap<string, ContentEntry>;
  /** Every term, lower-cased, mapped to the pages it names. */
  readonly termTargets: ReadonlyMap<string, readonly string[]>;
  /** Mentions found at build time, already filtered for specificity. */
  readonly mentions: readonly MentionHit[];
  /** Name-overlap pairs found at build time. See {@link MIN_MERGE_SIMILARITY}. */
  readonly merges: readonly MergeHit[];
}

/**
 * Terms a page can be recognised by.
 *
 * Lower-cased for matching, de-duplicated, and filtered by length. The original
 * spelling is kept in {@link ContentEntry.terms} for display.
 */
/**
 * The terms that name a page for the purpose of finding mentions.
 *
 * **The title only — deliberately not `aliases`.** A frontmatter alias is a word the
 * author uses for a page, but it is very often a *narrower* term than the title:
 * `对齐税.md` lists `过度拒答` because over-refusal is one of the tax's symptoms, and
 * `RLHF 与 DPO.md` lists `偏好优化`. Matching those turned "this note names that page"
 * into "this note names something related to that page", and a link offered on that
 * basis is wrong more often than it is right.
 *
 * The title and the file name are the page's own names, so a mention of either is a
 * mention of *that page*. Everything else the author wrote in `aliases` is left to
 * the link resolver, which is where `[[过度拒答]]` in a note still works — that has
 * always been Obsidian's own behaviour and is untouched here.
 */
function termsOf(title: string): string[] {
  const term = title.trim();
  if (term.length < MIN_TERM_LENGTH) return [];
  return [term];
}

/** Characters that end a word. Used to stop `Agent` matching inside `Agents`. */
const WORD_CHAR = /[0-9A-Za-z\u00C0-\u024F]/;

/** Whether an index sits on a word boundary for the term matched there. */
function boundaryOk(text: string, start: number, length: number): boolean {
  const before = start === 0 ? "" : text[start - 1]!;
  const after = start + length >= text.length ? "" : text[start + length]!;
  // Only Latin-ish words have boundaries to respect. A Chinese term is matched
  // wherever it occurs, because there is no space to check for.
  if (WORD_CHAR.test(after) && WORD_CHAR.test(text[start] ?? "")) return false;
  if (WORD_CHAR.test(before) && WORD_CHAR.test(text[start] ?? "")) return false;
  return true;
}

/**
 * Build the index from notes that are still in memory.
 *
 * Returns `null` when there is nothing to index, so a caller can skip storing an
 * empty index rather than distinguishing "no content" from "no index".
 */
export function buildContentIndex(
  notes: readonly { readonly id: string; readonly title: string; readonly body: string }[],
  adjacencyOf: (noteId: string) => ReadonlySet<string>,
): ContentIndex | null {
  if (notes.length === 0) return null;

  const entries = new Map<string, ContentEntry>();
  const termTargets = new Map<string, string[]>();

  for (const note of notes) {
    const terms = termsOf(note.title);
    if (terms.length === 0) continue;
    // Emphasised away, tables dropped and headings masked before scanning.
    const scanned = scanText(note.body);
    entries.set(note.id, {
      nodeId: note.id,
      title: note.title,
      terms,
      body: scanned.text,
      heading: scanned.heading,
      adjacent: adjacencyOf(note.id),
    });
    for (const term of terms) {
      const key = term.toLowerCase();
      const bucket = termTargets.get(key);
      if (bucket) bucket.push(note.id);
      else termTargets.set(key, [note.id]);
    }
  }

  if (entries.size === 0) return null;

  // Longest term first, so a title that contains a shorter title is not shadowed
  // by it: `视觉向量检索` must match before `向量检索` gets the same span.
  const allTerms = [...termTargets.keys()].sort((a, b) => b.length - a.length);

  /**
   * A term named by more than this many notes is too common to report.
   *
   * Measured over SOURCE notes — how often the name comes up — not over how many
   * pages carry it. Those are different numbers, and the second let a term named by
   * five of five notes through because only one page was titled after it.
   */
  const frequencyLimit = Math.max(2, Math.ceil(entries.size * MAX_TERM_DOCUMENT_RATIO));

  /**
   * Every raw match, before the specificity filter.
   *
   * Collected in a first pass because the filter needs a COMPLETE document
   * frequency, and a running counter is not one: with the counter incremented as
   * the scan went, the first notes compared a part-way total against the limit and
   * kept a term the last note went on to exceed. A term's frequency is a property
   * of the whole vault, so it can only be known after the whole vault is read.
   */
  interface RawMatch {
    readonly sourceId: string;
    readonly targetId: string;
    readonly term: string;
    readonly termKey: string;
    readonly occurrences: number;
    readonly preview: string;
  }
  const raw: RawMatch[] = [];
  const namedBy = new Map<string, number>();

  for (const entry of entries.values()) {
    // Scanned unpadded, so `index` is also an index into `entry.heading`. The
    // trailing pad a boundary check wants is already there — `scanText` ends every
    // body with a space — and a leading pad would shift every mask lookup by one.
    const padded = entry.body;
    if (padded.trim().length === 0) continue;
    const lowerPadded = padded.toLowerCase();
    const claimed: Array<{ start: number; end: number }> = [];
    const byTarget = new Map<string, { occurrences: number; first: number; term: string; termKey: string }>();

    for (const term of allTerms) {
      let index = lowerPadded.indexOf(term);
      while (index >= 0) {
        const end = index + term.length;
        const overlaps = claimed.some((span) => index < span.end && end > span.start);
        if (!overlaps && boundaryOk(padded, index, term.length)) {
          // A heading is the section's name, not a sentence. A generic name there is
          // a label and linking it adds nothing — every rated candidate of that shape
          // was rejected — while a *specific* name there is a real mention, so the
          // specificity signal decides rather than a blanket skip.
          const inHeading =
            entry.heading[index - 1] === true || entry.heading[index] === true;
          const specificity = 1 - (termTargets.get(term)?.length ?? 1) / entries.size;
          // A heading is the section's name, not a sentence. A generic name there is
          // a label and linking it adds nothing — every rated candidate of that shape
          // was rejected — while a *specific* name there is a real mention, so the
          // specificity signal decides rather than a blanket skip.
          if (inHeading && specificity < HEADING_MIN_SPECIFICITY) {
            index = lowerPadded.indexOf(term, index + term.length);
            continue;
          }
          // A standalone label: the sentence starts with the term and ends right
          // after it, so the term is heading the item rather than naming the page.
          //
          // Not gated on specificity. The first attempt gated it, and the rating
          // showed why that fails: `评测方法` is carried by exactly ONE note, so it
          // scores 0.99 specific while being a category word used as a bullet label.
          // Frequency measures how many pages share a name, not how much the name
          // says — and a label is a poor card however rare it is, because the
          // sentence it quotes is the label itself.
          if (isStandaloneLabel(padded, index, end)) {
            index = lowerPadded.indexOf(term, index + term.length);
            continue;
          }
          claimed.push({ start: index, end });
          namedBy.set(term, (namedBy.get(term) ?? 0) + 1);
          for (const targetId of termTargets.get(term) ?? []) {
            if (targetId === entry.nodeId) continue;
            // A pair that is already connected either way is not an unlinked
            // mention: the author has already made the connection.
            if (entry.adjacent.has(targetId)) continue;
            const current = byTarget.get(targetId);
            if (current) current.occurrences += 1;
            else {
              // The spelling **as this note wrote it**, taken from the match itself
              // rather than from the page. `termSpelling` holds the page's own term,
              // so a note writing `prompt` reported `Prompt`, and the editor then
              // inserted the page's casing over the reader's — a small change to their
              // prose that they never asked for.
              const spelling = padded.slice(index, index + term.length);
              byTarget.set(targetId, {
                occurrences: 1,
                first: index,
                term: spelling,
                termKey: term,
              });
            }
          }
        }
        index = lowerPadded.indexOf(term, index + term.length);
      }
    }

    for (const [targetId, hit] of byTarget) {
      raw.push({
        sourceId: entry.nodeId,
        targetId,
        term: hit.term,
        termKey: hit.termKey,
        occurrences: hit.occurrences,
        preview: previewAround(padded, hit.first, hit.term.length),
      });
    }
  }

  const mentions: MentionHit[] = [];
  for (const match of raw) {
    const documentFrequency = namedBy.get(match.termKey) ?? 1;
    if (documentFrequency > frequencyLimit) continue;
    mentions.push({
      sourceId: match.sourceId,
      targetId: match.targetId,
      term: match.term,
      occurrences: match.occurrences,
      preview: match.preview,
      specificity: 1 - documentFrequency / entries.size,
    });
  }

  return { entries, termTargets, mentions, merges: findMerges(entries) };
}

// ---------------------------------------------------------------------------
// Duplicate-name candidates
// ---------------------------------------------------------------------------

/**
 * How much two names must overlap to be called a possible duplicate.
 *
 * High on purpose. "These two pages may be the same concept" is an accusation the
 * reader has to adjudicate, and a false one costs more trust than a missed merge
 * costs convenience — the consequence of acting on a wrong merge is deleting a
 * page. Token Jaccard at 0.7 means most of both names agree.
 */
export const MIN_MERGE_SIMILARITY = 0.7;

/**
 * Tokens a name is made of, for the overlap test.
 *
 * CJK text has no spaces, so each Han character becomes its own token; Latin runs
 * stay whole and are lower-cased. A shared single character is therefore a weak
 * signal and a shared Latin word a strong one, which the Jaccard score reflects
 * rather than the tokeniser having to.
 */
export function nameTokens(name: string): string[] {
  const tokens: string[] = [];
  const latin = /[0-9A-Za-z\u00C0-\u024F]+/g;
  let match: RegExpExecArray | null;
  while ((match = latin.exec(name)) !== null) tokens.push(match[0].toLowerCase());
  const han = name.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) ?? [];
  tokens.push(...han);
  return [...new Set(tokens)];
}

/**
 * Pairs whose names overlap enough to be worth a look.
 *
 * Built through an inverted token index rather than by comparing every pair: two
 * names can only be similar if they share a token, so the candidate set is the
 * union of the token buckets and the comparison is proportional to real overlap
 * instead of to the square of the vault.
 */
function findMerges(entries: ReadonlyMap<string, ContentEntry>): MergeHit[] {
  const byToken = new Map<string, string[]>();
  const tokensById = new Map<string, readonly string[]>();
  for (const entry of entries.values()) {
    // The TITLE, not the node id. Ids are vault paths (`papers/attention`), and
    // tokenising those compares folder names: the first version did exactly that
    // and found nothing on a vault full of near-duplicate note names.
    const tokens = nameTokens(entry.title);
    tokensById.set(entry.nodeId, tokens);
    for (const token of tokens) {
      const bucket = byToken.get(token);
      if (bucket) bucket.push(entry.nodeId);
      else byToken.set(token, [entry.nodeId]);
    }
  }

  const candidatePairs = new Map<string, [string, string]>();
  for (const bucket of byToken.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const [x, y] = bucket[i]! < bucket[j]! ? [bucket[i]!, bucket[j]!] : [bucket[j]!, bucket[i]!];
        candidatePairs.set(`${x}\u0000${y}`, [x, y]);
      }
    }
  }

  const merges: MergeHit[] = [];
  for (const [, [a, b]] of candidatePairs) {
    const left = new Set(tokensById.get(a) ?? []);
    const right = tokensById.get(b) ?? [];
    if (left.size === 0 || right.length === 0) continue;
    const shared: string[] = [];
    for (const token of right) if (left.has(token)) shared.push(token);
    if (shared.length === 0) continue;
    const union = new Set([...left, ...right]).size;
    const similarity = shared.length / union;
    if (similarity < MIN_MERGE_SIMILARITY) continue;
    merges.push({ a, b, similarity, shared: [...shared].sort() });
  }

  // Strongest first, then stable on ids, so the cap keeps the best candidates.
  merges.sort(
    (x, y) =>
      y.similarity - x.similarity ||
      (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) ||
      (x.b < y.b ? -1 : x.b > y.b ? 1 : 0),
  );
  return merges;
}

/** Merge candidates between nodes that are both in this graph. */
export function mergeCandidatesOf(index: ContentIndex, nodes: readonly GraphNode[]): MergeHit[] {
  const present = new Set(nodes.map((node) => node.id));
  return index.merges.filter((merge) => present.has(merge.a) && present.has(merge.b));
}

/** Alias kept for the name used by the analyser. */
export const mergesInGraph = mergeCandidatesOf;

/**
 * Characters that end a sentence.
 *
 * Emphasis markers are stripped from the scanned text first, because a terminator
 * inside emphasis is not a boundary: `**评测方法。** 报告详细说明了…` is one
 * sentence, and splitting at the `。` produced a two-word preview.
 */
const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "；", ".", "!", "?", ";", "\n"]);

/** Emphasis and inline-code markers, removed before a body is scanned. */
function stripEmphasis(text: string): string {
  return text.replace(/(\*\*|__|`)/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2");
}

/**
 * Whether a match is a standalone label rather than a reference.
 *
 * True when the match begins a sentence and the same sentence ends immediately
 * after it — `技术选型。` on its own, or `4. 评测方法。 报告…` where the item's text
 * follows. That is the shape a bolded category heading takes, and linking it would
 * point at a page the sentence is not about.
 */
export function isStandaloneLabel(text: string, start: number, end: number): boolean {
  // Whitespace has to be skipped before asking whether a sentence starts here: the
  // scanner joins lines with a space, so a bolded label on its own line is preceded
  // by one, and requiring the terminator to be the immediately preceding character
  // made the check miss every case it exists for.
  let before = start - 1;
  while (before >= 0 && /\s/.test(text[before]!)) before -= 1;
  const starts = before < 0 || SENTENCE_TERMINATORS.has(text[before]!);
  const ends = SENTENCE_TERMINATORS.has(text[end] ?? "");
  return starts && ends;
}

/** A markdown table row: it starts with a pipe once trimmed. */
const TABLE_ROW = /^\s*\|/;

/** A markdown ATX heading, captured so the marker can be measured and removed. */
const HEADING = /^(\s*)(#{1,6})(\s+)(.*)$/;

/** A body prepared for scanning, with the parts that are not prose marked. */
export interface ScannableBody {
  /** Prose only: no code, no emphasis, no table rows, line breaks unwrapped. */
  readonly text: string;
  /**
   * One flag per character of {@link text}: `true` where the character came from a
   * heading.
   *
   * Measured need. Of 37 rated candidates on the real vault, every one that matched
   * inside a heading or a table cell was rejected, and none of the three `wrong`
   * verdicts came from prose. A section label is the section's name and a table cell
   * is a field value; neither is a sentence a link belongs in.
   *
   * Headings are masked rather than deleted because a heading that *is* a page name
   * is a legitimate mention, and the analyser decides that using the term's
   * specificity — the mask keeps the decision in one place.
   */
  readonly heading: readonly boolean[];
}

/**
 * Prepare a body for scanning.
 *
 * Table rows are dropped outright, headings are kept but masked. The line breaks
 * matter too: prose is wrapped and bulleted, so a raw `\n` sits inside sentences,
 * and treating it as a sentence boundary made every wrapped line its own sentence
 * and produced previews like `评测方法。` for a bullet whose text continued on the
 * same line.
 */
export function scanText(body: string): ScannableBody {
  const cleaned = stripEmphasis(stripCode(body));
  const chunks: string[] = [];
  const heading: boolean[] = [];

  for (const line of cleaned.split(/\r?\n/)) {
    // A table is structure, not prose: no part of a row is a sentence.
    if (TABLE_ROW.test(line)) continue;
    const match = line.match(HEADING);
    if (match) {
      const content = match[4] ?? "";
      const span = (match[1]?.length ?? 0) + (match[2]?.length ?? 0) + (match[3]?.length ?? 0);
      chunks.push(" ".repeat(span));
      for (let index = 0; index < span; index += 1) heading.push(true);
      chunks.push(content);
      for (let index = 0; index < content.length; index += 1) heading.push(true);
    } else {
      chunks.push(line);
      for (let index = 0; index < line.length; index += 1) heading.push(false);
    }
    // The break becomes a space, which keeps offsets aligned with the mask.
    chunks.push(" ");
    heading.push(false);
  }

  const text = chunks.join("");
  return { text, heading };
}

/**
 * The sentence a match sits in, whitespace-collapsed.
 *
 * A fixed-width window was the first attempt and it read badly: it started
 * mid-word, so a rating-sheet row began `ansformer 架构]] 在大规模下的实用改良`
 * and the reader had to reconstruct the sentence around the match. Sentence
 * boundaries cost nothing extra and give the reader the unit they actually judge —
 * "should this link be here?" is a question about a sentence.
 *
 * Falls back to the whole text when no terminator is found, and caps the length so
 * one unpunctuated run cannot fill the card.
 */
export function previewAround(text: string, at: number, length: number): string {
  const isBoundary = (position: number): boolean => {
    const character = text[position];
    if (character === undefined) return false;
    if (!SENTENCE_TERMINATORS.has(character)) return false;
    // A dot directly after a digit is an ordered-list marker, not a full stop:
    // `4. **评测方法。** 报告…` is one sentence, and treating the marker as a
    // boundary produced a preview of `评测方法。` — the correct sentence by the
    // letter of the rule, and useless to read.
    if (character === "." && position > 0 && /\d/.test(text[position - 1] ?? "")) return false;
    return true;
  };

  let start = at;
  while (start > 0 && !isBoundary(start - 1)) start -= 1;
  let end = at + length;
  while (end < text.length && !isBoundary(end)) end += 1;
  if (end < text.length) end += 1;

  let sentence = text.slice(start, end).replace(/\s+/g, " ").trim();
  // A bullet marker or a stray bracket can still lead, which reads as a truncated
  // sentence rather than a quote.
  sentence = sentence.replace(/^[>\-*+\d.\s）)]+/, "").trim();
  if (sentence.length > MAX_PREVIEW) sentence = `${sentence.slice(0, MAX_PREVIEW)}…`;
  return sentence;
}

/** Longest a preview may be, so an unpunctuated run cannot fill the card. */
const MAX_PREVIEW = 160;

// ---------------------------------------------------------------------------
// Graph attachment
// ---------------------------------------------------------------------------

/**
 * The index for a graph, held beside it rather than inside it.
 *
 * `WikiGraph` is rendered verbatim, frozen, and serialised into the browser
 * harness's fixture. Widening it with a content index would change all three at
 * once for a signal only the insight engine reads, so the index is attached to the
 * graph object instead — the same object identity the rest of the engine already
 * relies on. A `WeakMap` means the index dies with the graph, which is exactly the
 * lifetime wanted: it describes one build.
 */
const indexes = new WeakMap<WikiGraph, ContentIndex>();

/** Attach an index to a graph. Called by the builder, once per build. */
export function attachContentIndex(graph: WikiGraph, index: ContentIndex | null): void {
  if (index !== null) indexes.set(graph, index);
}

/** The index for a graph, or `null` when the build had no content to index. */
export function contentIndexOf(graph: WikiGraph): ContentIndex | null {
  return indexes.get(graph) ?? null;
}

/** Mention hits between nodes that are both in this graph. */
export function mentionsInGraph(
  index: ContentIndex,
  nodes: readonly GraphNode[],
): MentionHit[] {
  const present = new Set(nodes.map((node) => node.id));
  return index.mentions.filter(
    (mention) => present.has(mention.sourceId) && present.has(mention.targetId),
  );
}

/** Body text for a node, when the index still has it. */
export function bodyOf(index: ContentIndex | null, nodeId: string): string | null {
  return index?.entries.get(nodeId)?.body ?? null;
}

/** Re-exported so a caller can strip frontmatter the same way the index does. */
export { splitFrontmatter };
