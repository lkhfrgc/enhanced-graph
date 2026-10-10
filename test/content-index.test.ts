/**
 * The content index: unlinked mentions and possible duplicates.
 *
 * Why each group exists:
 *
 *  - **matching**: an unlinked mention is the one card type a reader needs no
 *    convincing to accept, so its false-positive modes are the whole risk. Each one
 *    gets its own test, and every one of them was a real defect or a near miss
 *    while this was written.
 *  - **already connected**: the first version asked only whether the SOURCE linked
 *    to the target, and reported five pairs on the real vault where the target
 *    linked out to the source instead. "Already connected" is symmetric; the links
 *    are not.
 *  - **specificity**: a term that appears in half the vault says nothing about a
 *    specific page. Screening it by measured document frequency is what stops a
 *    generic word from burying the handful of genuine misses — a hand-written
 *    stop-word list would be a list of names and would not travel between vaults.
 *  - **duplicates**: "these two pages may be the same concept" costs the reader a
 *    decision and can end in a deleted page, so the threshold is high and the
 *    candidate set comes from an inverted token index rather than every pair.
 *
 * The fixtures carry filler notes because the specificity filter drops any term
 * more than half the vault carries. A two-note fixture would filter everything and
 * every assertion would pass or fail for the wrong reason.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_MERGE_SIMILARITY,
  MIN_TERM_LENGTH,
  attachContentIndex,
  buildContentIndex,
  contentIndexOf,
  mergeCandidatesOf,
  mentionsInGraph,
  nameTokens,
  type ContentIndex,
} from "../src/core/content-index";
import type { GraphNode, WikiGraph } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface NoteSpec {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly aliases?: readonly string[];
}

/** Notes that mention nothing, so the specificity filter has a realistic vault. */
function filler(count = 6): NoteSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `filler-${index}`,
    title: `Filler ${index}`,
    body: "占位内容，与其他笔记无关。",
  }));
}

/** The notes under test, plus filler, so the df filter behaves as it would live. */
function vaultOf(notes: readonly NoteSpec[]): NoteSpec[] {
  return [...notes, ...filler()];
}

function indexOf(
  notes: readonly NoteSpec[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): ContentIndex {
  const index = buildContentIndex(
    notes.map((note) => ({
      id: note.id,
      title: note.title,
      aliases: note.aliases ?? [],
      body: note.body,
    })),
    (id) => adjacency.get(id) ?? new Set<string>(),
  );
  if (index === null) throw new Error("fixture produced no index");
  return index;
}

/** Undirected adjacency, built the way the builder builds it. */
function adjacent(pairs: ReadonlyArray<readonly [string, string]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    const forward = map.get(a) ?? new Set<string>();
    forward.add(b);
    map.set(a, forward);
    const backward = map.get(b) ?? new Set<string>();
    backward.add(a);
    map.set(b, backward);
  }
  return map;
}

function node(id: string, label = id): GraphNode {
  return {
    id,
    label,
    type: "concept",
    rawType: "",
    path: `${id}.md`,
    linkCount: 0,
    vaultLinkCount: 0,
    inLinks: 0,
    outLinks: 0,
    community: 0,
    sources: [],
    tags: [],
    isStructural: false,
  };
}

function graphOf(nodes: readonly GraphNode[]): WikiGraph {
  return {
    nodes,
    edges: [],
    communities: [],
    nodeIndex: new Map(nodes.map((entry) => [entry.id, entry])),
    folders: [],
    builtAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("unlinked mentions: matching", () => {
  it("reports a page named in prose that was never linked", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "这里讨论了 Beta 的应用。" },
        { id: "b", title: "Beta", body: "" },
      ]),
    );

    expect(index.mentions).toHaveLength(1);
    expect(index.mentions[0]?.sourceId).toBe("a");
    expect(index.mentions[0]?.targetId).toBe("b");
    expect(index.mentions[0]?.term).toBe("Beta");
    expect(index.mentions[0]?.occurrences).toBe(1);
  });

  it("does not report a mention inside a fenced or inline code block", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "```ts\nconst Beta = 1;\n```\n和 `Beta` 也一样。" },
        { id: "b", title: "Beta", body: "" },
      ]),
    );

    expect(index.mentions).toEqual([]);
  });

  it("does not report a term shorter than the minimum", () => {
    // Three-character names are common enough that a match says almost nothing.
    const short = "甲".repeat(MIN_TERM_LENGTH - 1);
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: `${short} 出现在这里。` },
        { id: "b", title: short, body: "" },
      ]),
    );

    expect(index.mentions).toEqual([]);
  });

  it("respects word boundaries for Latin terms", () => {
    // `Agent` must not match inside `Agents`.
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Many Agents are deployed." },
        { id: "b", title: "Agent", body: "" },
      ]),
    );

    expect(index.mentions).toEqual([]);
  });

  it("matches a Latin term at the very start and end of a body", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Beta is discussed" },
        { id: "b", title: "Beta", body: "" },
      ]),
    );

    expect(index.mentions.map((mention) => mention.term)).toEqual(["Beta"]);
  });

  it("counts every occurrence and keeps a preview of the first", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Beta 一次。Beta 两次。Beta 三次。" },
        { id: "b", title: "Beta", body: "" },
      ]),
    );

    const mention = index.mentions[0];
    expect(mention?.occurrences).toBe(3);
    expect(mention?.preview).toContain("Beta");
  });

  it("prefers the longest term when one title contains another", () => {
    // The longer title must claim the span before the shorter one gets it, or the
    // card names the wrong page.
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "视觉向量检索 是一个主题。" },
        { id: "long", title: "视觉向量检索", body: "" },
        { id: "short", title: "向量检索", body: "" },
      ]),
    );

    expect(index.mentions.map((mention) => mention.targetId)).toEqual(["long"]);
  });

  it("never reports a page mentioning itself", () => {
    const index = indexOf([{ id: "a", title: "Alpha", body: "Alpha 说的是 Alpha。" }, ...filler()]);
    expect(index.mentions).toEqual([]);
  });

  it("reports an alias match, and remembers which alias matched", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "关于 Transformer 的讨论。" },
        { id: "b", title: "Attention Is All You Need", body: "", aliases: ["Transformer"] },
      ]),
    );

    expect(index.mentions[0]?.term).toBe("Transformer");
    expect(index.mentions[0]?.targetId).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Already connected
// ---------------------------------------------------------------------------

describe("unlinked mentions: already connected", () => {
  it("does not report a pair the source already links to", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Beta 出现在正文。" },
        { id: "b", title: "Beta", body: "" },
      ]),
      adjacent([["a", "b"]]),
    );

    expect(index.mentions).toEqual([]);
  });

  it("does not report a pair that links TO the source", () => {
    // Regression, and the reason the exclusion is symmetric: the first version
    // asked only whether the source linked to the target, and on the real vault it
    // reported five pairs where the link ran the other way.
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Beta 出现在正文。" },
        { id: "b", title: "Beta", body: "[[Alpha]]" },
      ]),
      adjacent([["b", "a"]]),
    );

    expect(index.mentions).toEqual([]);
  });

  it("still reports an unrelated third page in the same body", () => {
    // The exclusion is per pair, not per note: one linked neighbour must not
    // silence every other mention in the note.
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Beta 和 Gamma 都出现在正文。" },
        { id: "b", title: "Beta", body: "" },
        { id: "g", title: "Gamma", body: "" },
      ]),
      adjacent([["a", "b"]]),
    );

    expect(index.mentions.map((mention) => mention.targetId)).toEqual(["g"]);
  });
});

// ---------------------------------------------------------------------------
// Specificity
// ---------------------------------------------------------------------------

describe("unlinked mentions: specificity", () => {
  it("drops a term that more than half the vault carries", () => {
    // Five notes name the same term, and one page is titled after it.
    const notes: NoteSpec[] = [
      { id: "term", title: "通用术语", body: "" },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `n${index}`,
        title: `Note ${index}`,
        body: "这里提到 通用术语 一次。",
      })),
    ];

    expect(indexOf(notes).mentions).toEqual([]);
  });

  it("keeps a term only one page carries, and scores it as specific", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Alpha", body: "Rare Concept 出现在正文。" },
        { id: "r", title: "Rare Concept", body: "" },
      ]),
    );

    expect(index.mentions).toHaveLength(1);
    expect(index.mentions[0]?.specificity).toBeGreaterThan(0.8);
  });

  it("scores a widely carried term lower than a rare one", () => {
    // Two targets: one named by three notes, one by a single note. Both stay above
    // the filter's bar, so the scores can be compared.
    const padding = Array.from({ length: 8 }, (_, index) => ({
      id: `f${index}`,
      title: `F${index}`,
      body: "无关。",
    }));
    const index = indexOf([
      { id: "common", title: "Common Term", body: "" },
      { id: "rare", title: "Rare Term", body: "" },
      { id: "a", title: "Alpha", body: "Common Term 和 Rare Term 都提到了。" },
      { id: "b", title: "Beta", body: "Common Term 又提到一次。" },
      { id: "c", title: "Gamma", body: "Common Term 第三次。" },
      ...padding,
    ]);

    const common = index.mentions.find((mention) => mention.targetId === "common");
    const rare = index.mentions.find((mention) => mention.targetId === "rare");
    expect(common).toBeDefined();
    expect(rare).toBeDefined();
    expect(rare!.specificity).toBeGreaterThan(common!.specificity);
  });
});

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

describe("duplicate-name candidates", () => {
  it("tokenises Latin runs whole and Han text per character", () => {
    expect(nameTokens("Attention Is All You Need")).toEqual([
      "attention",
      "is",
      "all",
      "you",
      "need",
    ]);
    expect(nameTokens("向量检索")).toEqual(["向", "量", "检", "索"]);
  });

  it("pairs two names that mostly agree", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Transformer", body: "" },
        { id: "b", title: "Transformer", body: "" },
      ]),
    );

    expect(index.merges).toHaveLength(1);
    expect(index.merges[0]?.similarity).toBe(1);
    expect(index.merges[0]?.shared).toContain("transformer");
  });

  it("does not pair names that merely share one word", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "向量检索", body: "" },
        { id: "b", title: "向量数据库", body: "" },
      ]),
    );

    expect(index.merges).toEqual([]);
  });

  it("never pairs a page with itself", () => {
    const index = indexOf(vaultOf([{ id: "a", title: "Transformer Architecture", body: "" }]));
    expect(index.merges).toEqual([]);
  });

  it("orders by similarity and never emits a pair twice", () => {
    const index = indexOf(
      vaultOf([
        { id: "a", title: "Transformer", body: "" },
        { id: "b", title: "Transformer", body: "" },
        { id: "c", title: "Transformer", body: "" },
      ]),
    );

    // Three identical names: three pairs, each once.
    expect(index.merges).toHaveLength(3);
    const keys = index.merges.map((merge) => `${merge.a}|${merge.b}`);
    expect(new Set(keys).size).toBe(3);
    const similarities = index.merges.map((merge) => merge.similarity);
    expect(similarities).toEqual([...similarities].sort((x, y) => y - x));
    expect(index.merges.every((merge) => merge.similarity >= MIN_MERGE_SIMILARITY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Graph attachment
// ---------------------------------------------------------------------------

describe("graph attachment", () => {
  it("round-trips an index through the graph it describes", () => {
    const graph = graphOf([node("a")]);
    const index = indexOf([{ id: "a", title: "Alpha", body: "text" }, ...filler()]);

    expect(contentIndexOf(graph)).toBeNull();
    attachContentIndex(graph, index);
    expect(contentIndexOf(graph)).toBe(index);
  });

  it("keeps an index per graph, so two builds cannot share one", () => {
    const first = graphOf([node("a")]);
    const second = graphOf([node("b")]);
    const indexA = indexOf([{ id: "a", title: "Alpha", body: "" }, ...filler()]);
    const indexB = indexOf([{ id: "b", title: "Beta", body: "" }, ...filler()]);

    attachContentIndex(first, indexA);
    attachContentIndex(second, indexB);

    expect(contentIndexOf(first)).toBe(indexA);
    expect(contentIndexOf(second)).toBe(indexB);
  });

  it("filters mentions to the nodes this graph actually contains", () => {
    const extra = filler();
    const index = indexOf([
      { id: "a", title: "Alpha", body: "Beta 出现在正文。" },
      { id: "b", title: "Beta", body: "" },
      ...extra,
    ]);
    const all = [node("a"), node("b"), ...extra.map((note) => node(note.id))];

    expect(index.mentions).toHaveLength(1);
    // A graph that holds only the source cannot show the card.
    expect(mentionsInGraph(index, [all[0]!, ...all.slice(2)])).toEqual([]);
    expect(mentionsInGraph(index, all)).toHaveLength(1);
  });

  it("filters merge candidates to the nodes this graph contains", () => {
    const extra = filler();
    const index = indexOf([
      { id: "a", title: "Transformer", body: "" },
      { id: "b", title: "Transformer", body: "" },
      ...extra,
    ]);
    const all = [node("a"), node("b"), ...extra.map((note) => node(note.id))];

    expect(mergeCandidatesOf(index, [all[0]!, ...all.slice(2)])).toEqual([]);
    expect(mergeCandidatesOf(index, all)).toHaveLength(1);
  });
});
