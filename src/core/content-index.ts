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

/** Characters of surrounding prose a mention keeps, for the card to show. */
export const PREVIEW_RADIUS = 40;
/** One page's content signals. */
export interface ContentEntry {
  readonly nodeId: string;
  /** The page's display name, which is what duplicate detection compares. */
  readonly title: string;
  /** Terms that name this page: its title and every alias. */
  readonly terms: readonly string[];
  /** Body with code blocks removed, which is what matching runs against. */
  readonly body: string;
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
  /** The exact term that matched — a title or an alias. */
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
function termsOf(title: string, aliases: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [title, ...aliases]) {
    const term = raw.trim();
    if (term.length < MIN_TERM_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
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
  notes: readonly { readonly id: string; readonly title: string; readonly aliases: readonly string[]; readonly body: string }[],
  adjacencyOf: (noteId: string) => ReadonlySet<string>,
): ContentIndex | null {
  if (notes.length === 0) return null;

  const entries = new Map<string, ContentEntry>();
  const termTargets = new Map<string, string[]>();
  /** Lower-cased term -> the spelling the note itself uses. */
  const termSpelling = new Map<string, string>();

  for (const note of notes) {
    const terms = termsOf(note.title, note.aliases);
    if (terms.length === 0) continue;
    // Emphasised away and unwrapped before scanning, so a terminator inside
    // `**bold**` or at a line break is not mistaken for a sentence boundary and the
    // preview quotes the whole sentence.
    const body = scanText(note.body);
    entries.set(note.id, {
      nodeId: note.id,
      title: note.title,
      terms,
      body,
      adjacent: adjacencyOf(note.id),
    });
    for (const term of terms) {
      const key = term.toLowerCase();
      if (!termSpelling.has(key)) termSpelling.set(key, term);
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
    const body = entry.body;
    if (body.length === 0) continue;
    // Space-padded so a term at either edge has a boundary to check, which is what
    // makes the Latin boundary rule work on the first and last words.
    const padded = ` ${body} `;
    const lowerPadded = padded.toLowerCase();
    const claimed: Array<{ start: number; end: number }> = [];
    const byTarget = new Map<string, { occurrences: number; first: number; term: string; termKey: string }>();

    for (const term of allTerms) {
      let index = lowerPadded.indexOf(term);
      while (index >= 0) {
        const end = index + term.length;
        const overlaps = claimed.some((span) => index < span.end && end > span.start);
        if (!overlaps && boundaryOk(padded, index, term.length)) {
          claimed.push({ start: index, end });
          namedBy.set(term, (namedBy.get(term) ?? 0) + 1);
          for (const targetId of termTargets.get(term) ?? []) {
            if (targetId === entry.nodeId) continue;
            // A pair that is already connected either way is not an unlinked
            // mention: the author has already made the connection.
            if (entry.adjacent.has(targetId)) continue;
            const current = byTarget.get(targetId);
            if (current) current.occurrences += 1;
            // The note's own spelling, so a card reads `Beta` rather than `beta`.
            else {
              byTarget.set(targetId, {
                occurrences: 1,
                first: index,
                term: termSpelling.get(term) ?? term,
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
 * A body as the scanner wants it: no code, no emphasis, no raw line breaks.
 *
 * The line breaks matter. Prose in a note is wrapped and bulleted, so a raw `\n`
 * sits in the middle of sentences — treating it as a terminator made every wrapped
 * line its own sentence, and a preview came out as `评测方法。` for a bullet whose
 * text continued on the same line after the emphasis. Normalising to spaces lets
 * the real punctuation decide where a sentence ends.
 */
function scanText(body: string): string {
  return stripEmphasis(stripCode(body)).replace(/\s*\n+\s*/g, " ");
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
