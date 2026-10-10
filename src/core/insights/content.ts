/**
 * The content analyser: unlinked mentions and possible duplicates.
 *
 * Two card types, and the plan keeps them apart from the topological ones for a
 * reason it measured. `missing-link` says "topology thinks these belong together",
 * which is an argument the reader has to weigh. `unlinked-mention` says "you named
 * this page in that note and never linked it", which is a fact the reader can
 * verify in one glance — and in the one comparison the plan could run, adding a
 * structural signal to a content one made both worse. They are therefore separate
 * kinds with separate evidence, never summed into one score.
 *
 * Both cards carry an `insert-wikilink` action, because the mention card's whole
 * value is that acting on it costs one click.
 */

import type { Analyser, AnalysisContext } from "./input";
import { registerAnalyser } from "./input";
import { mentionsInGraph, mergesInGraph, type ContentIndex } from "../content-index";
import { edgeKey } from "../graph-keys";
import { pairFinding, type Confidence, type Evidence, type Finding } from "./model";

export const CONTENT_ANALYSER_ID = "content";

/**
 * How many of each card the analyser may contribute.
 *
 * Mentions are cheap to act on and cheap to verify, so a handful is a menu rather
 * than a chore. Merge candidates are the opposite — each one asks the reader to
 * judge whether two pages are the same idea — so there are fewer of them and the
 * threshold above does most of the filtering.
 */
export const MENTION_LIMIT = 8;
export const MERGE_LIMIT = 3;

/**
 * Confidence bands.
 *
 * A mention is `strong` when the term is specific to its page, because a specific
 * term appearing in prose is not a coincidence. A shared name that is common
 * enough to appear elsewhere is `moderate` — the mention is still real, it is the
 * inference that is weaker. Merges are never better than `moderate`: the analyser
 * compares names, and whether two similarly-named pages are the same concept is a
 * judgement only the author can make.
 */
export const MENTION_STRONG_SPECIFICITY = 0.75;

function mentionConfidence(specificity: number): Confidence {
  return specificity >= MENTION_STRONG_SPECIFICITY ? "strong" : "moderate";
}

/**
 * The wikilink text that connects two pages.
 *
 * Links by **basename**, with the display title only as an alias:
 * `[[beta|Beta Display]]` where the label differs, `[[Beta]]` where it does not.
 * Resolution runs through the basename, so linking by the display title would
 * produce a link that reads correctly and resolves to nothing whenever a note sets
 * a `title` that differs from its file name. The alias is what keeps it readable.
 *
 * `targetPath` is the vault path, not the node id, because the id is lower-cased:
 * a note saved as `Beta.md` should be linked as `[[Beta]]`, not `[[beta]]`.
 *
 * Exported because the card shows this text in its preview and Phase 6 writes it
 * into the note — one definition means the two cannot disagree about what the user
 * is about to get.
 */
export function wikilinkText(targetPath: string, label: string): string {
  const file = targetPath.split("/").pop() ?? targetPath;
  const basename = file.replace(/\.md$/i, "");
  // Case-insensitive: a file named `beta.md` with `title: Beta` already reads as
  // `[[beta]]`, so an alias there would be noise.
  return basename.toLowerCase() === label.toLowerCase() ? `[[${basename}]]` : `[[${basename}|${label}]]`;
}

/**
 * Turn an unlinked mention into a finding.
 *
 * `score` is the mention's specificity on the model's 0…1 scale, so the ordering
 * among mentions is "how specific is the name you used" rather than how many times
 * it appeared: a page named once by its own distinctive title is a better card
 * than a generic word repeated five times.
 */
export function toMentionFinding(
  mention: {
    readonly sourceId: string;
    readonly targetId: string;
    readonly term: string;
    readonly occurrences: number;
    readonly preview: string;
    readonly specificity: number;
  },
  labelOf: (id: string) => string,
  pathOf: (id: string) => string,
): Finding {
  const targetLabel = labelOf(mention.targetId);
  const evidence: Evidence[] = [
    {
      kind: "mention",
      labelKey: "reason.evidence.mention",
      params: { count: mention.occurrences, term: mention.term },
      contribution: 1 + mention.specificity,
      nodeIds: [mention.targetId],
    },
  ];

  return pairFinding({
    kind: "unlinked-mention",
    analyser: CONTENT_ANALYSER_ID,
    a: mention.sourceId,
    b: mention.targetId,
    titleKey: "insights.finding.unlinked-mention",
    titleParams: { a: labelOf(mention.sourceId), b: targetLabel },
    init: {
      evidence,
      anchors: { nodeIds: [mention.sourceId, mention.targetId], edgeKeys: [] },
      score: mention.specificity,
      confidence: mentionConfidence(mention.specificity),
      severity: 2,
      // The one action in the feature that genuinely costs a single click, which is
      // why this card type leads the phase.
      effort: "one-click",
      action: {
        kind: "insert-wikilink",
        sourceId: mention.sourceId,
        targetId: mention.targetId,
        // The exact text to insert. Built here so the preview and the write cannot
        // disagree about what will appear in the note.
        text: wikilinkText(pathOf(mention.targetId), targetLabel),
      },
    },
  });
}

/** Turn a name overlap into a finding. */
export function toMergeFinding(
  merge: { readonly a: string; readonly b: string; readonly similarity: number; readonly shared: readonly string[] },
  labelOf: (id: string) => string,
): Finding {
  return pairFinding({
    kind: "merge-candidate",
    analyser: CONTENT_ANALYSER_ID,
    a: merge.a,
    b: merge.b,
    titleKey: "insights.finding.merge-candidate",
    titleParams: { a: labelOf(merge.a), b: labelOf(merge.b) },
    init: {
      evidence: [
        {
          kind: "shared-source",
          labelKey: "reason.evidence.shared-source",
          params: { count: merge.shared.length, names: merge.shared.join("、") },
          contribution: merge.similarity,
        },
      ],
      anchors: { nodeIds: [merge.a, merge.b], edgeKeys: [edgeKey(merge.a, merge.b)] },
      score: merge.similarity,
      // Never better than moderate: the analyser compares names, and only the
      // author knows whether two similarly-named pages are one idea.
      confidence: "moderate",
      severity: 3,
      effort: "write",
      action: { kind: "open-notes", nodeIds: [merge.a, merge.b] },
    },
  });
}

/** Every mention and merge this build can offer. Pure function of the index. */
export function contentFindings(ctx: AnalysisContext, index: ContentIndex | null): Finding[] {
  if (index === null) return [];
  const labelOf = (id: string): string => ctx.nodeById.get(id)?.label ?? id;
  // The vault path, so a link keeps the file's real capitalisation.
  const pathOf = (id: string): string => ctx.nodeById.get(id)?.path ?? id;

  const mentions = mentionsInGraph(index, ctx.nodes)
    .map((mention) => toMentionFinding(mention, labelOf, pathOf))
    .slice(0, MENTION_LIMIT);
  const merges = mergesInGraph(index, ctx.nodes)
    .map((merge) => toMergeFinding(merge, labelOf))
    .slice(0, MERGE_LIMIT);

  return [...mentions, ...merges];
}

/**
 * The content analyser.
 *
 * Returns nothing when the build had no content index — a hand-built graph from a
 * test or the browser fixture, or a vault of empty files. That is the honest
 * outcome: the analyser has no evidence, so it produces no findings rather than
 * weak ones.
 */
export function contentAnalyser(): Analyser {
  return {
    id: CONTENT_ANALYSER_ID,
    cap: MENTION_LIMIT + MERGE_LIMIT,
    scoreRange: 1,
    confidenceOf: (finding: Finding): Confidence => finding.confidence,
    // `ctx.content` is resolved once per pass by `createContext`; this analyser
    // never reaches for the graph itself.
    analyze: (ctx: AnalysisContext): readonly Finding[] => contentFindings(ctx, ctx.content),
  };
}

/** Register the content analyser alongside the shipped pair. */
export function registerContentAnalyser(): void {
  registerAnalyser(contentAnalyser());
}
