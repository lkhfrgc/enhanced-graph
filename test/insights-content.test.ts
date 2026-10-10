/**
 * The content analyser, end to end through the real builder.
 *
 * Why this file exists separately from `content-index.test.ts`: that one pins the
 * index's own rules, and this one pins the *wiring* — that a vault built through
 * `buildWikiGraph` reaches the analyser at all, that the resulting findings land in
 * the right section with an action the view can execute, and that acting on one is
 * a real wikilink rather than a display label.
 *
 * It builds a real graph from an in-memory vault rather than hand-attaching an
 * index, because the thing most likely to break silently is the attachment: the
 * index hangs off the graph object in a `WeakMap`, so a builder that stopped
 * calling `attachContentIndex` would leave every card missing with nothing
 * throwing.
 */

import { describe, expect, it } from "vitest";

import { buildWikiGraph } from "../src/core/graph-builder";
import { analyzeGraph } from "../src/core/insights";
import { MemoryVault } from "../src/core/vault";
import { FINDING_SECTION, type Finding } from "../src/core/insights/model";

/** Enough unrelated notes that the specificity filter has a realistic vault. */
function fillerNotes(count = 6): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    out[`filler/F${index}.md`] = `---\ntitle: Filler ${index}\n---\n占位内容，与其他笔记无关。\n`;
  }
  return out;
}

async function graphFor(files: Record<string, string>) {
  return buildWikiGraph({ vault: new MemoryVault({ ...fillerNotes(), ...files }) });
}

/** The content analyser's findings, in the order the bundle presents them. */
function contentOf(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.analyser === "content");
}

describe("content analyser: unlinked mentions", () => {
  it("surfaces a page named in prose, through the real builder", async () => {
    const graph = await graphFor({
      "concepts/Alpha.md": "---\ntitle: Alpha\n---\n这里讨论了 Beta 的应用。\n",
      "concepts/Beta.md": "---\ntitle: Beta\n---\nBeta 自己的内容。\n",
    });

    const findings = contentOf(analyzeGraph(graph).bundle!.findings);
    const mention = findings.find((finding) => finding.kind === "unlinked-mention");

    expect(mention).toBeDefined();
    expect(mention!.titleParams.a).toBe("Alpha");
    expect(mention!.titleParams.b).toBe("Beta");
    // A mention sits in the section a reader looks at first.
    expect(FINDING_SECTION[mention!.kind]).toBe("suggested");
  });

  it("carries an action whose text is a real wikilink, not a display label", async () => {
    // The card offers "insert the link", and the link has to resolve when it is
    // written into the note. A note whose `title` differs from its file name is the
    // case that catches this: `[[Beta Display]]` reads correctly and resolves to
    // nothing, so the link is built from the basename with the title as an alias.
    //
    // The prose names the *title*, not an alias, because aliases are no longer scanned
    // — a mention of `Beta` would no longer find this page, which is the point of that
    // change and is covered in `content-index.test.ts`.
    const graph = await graphFor({
      "concepts/Alpha.md": "---\ntitle: Alpha\n---\n这里讨论了 Beta Display 的应用。\n",
      "concepts/Beta.md": '---\ntitle: Beta Display\naliases: ["Beta"]\n---\n内容。\n',
    });

    const mention = contentOf(analyzeGraph(graph).bundle!.findings).find(
      (finding) => finding.kind === "unlinked-mention",
    )!;

    expect(mention.action?.kind).toBe("insert-wikilink");
    const action = mention.action as { kind: "insert-wikilink"; sourceId: string; targetId: string; text: string };
    expect(action.sourceId).toBe("concepts/alpha");
    expect(action.targetId).toBe("concepts/beta");
    // The resolution key is the basename, in the file's own case; the display
    // title is only the alias.
    expect(action.text).toBe("[[Beta|Beta Display]]");

    // And it really resolves: the basename is the key the vault's link index holds.
    const inner = action.text.slice(2, -2).split("|")[0]!;
    expect(graph.nodeIndex.has(`concepts/${inner.toLowerCase()}`)).toBe(true);
  });

  it("omits the alias when the title already is the file name", async () => {
    const graph = await graphFor({
      "concepts/Alpha.md": "---\ntitle: Alpha\n---\n这里讨论了 Beta 的应用。\n",
      "concepts/Beta.md": "---\ntitle: Beta\n---\n内容。\n",
    });

    const mention = contentOf(analyzeGraph(graph).bundle!.findings).find(
      (finding) => finding.kind === "unlinked-mention",
    )!;

    expect((mention.action as { text: string }).text).toBe("[[Beta]]");
  });

  it("offers the cheapest possible fix, so it sorts above card types that need writing", async () => {
    const graph = await graphFor({
      "concepts/Alpha.md": "---\ntitle: Alpha\n---\n这里讨论了 Beta 的应用。\n",
      "concepts/Beta.md": "---\ntitle: Beta\n---\n内容。\n",
    });

    const mention = contentOf(analyzeGraph(graph).bundle!.findings).find(
      (finding) => finding.kind === "unlinked-mention",
    )!;

    expect(mention.effort).toBe("one-click");
  });

  it("does not report a pair the vault already links, in either direction", async () => {
    // The source does not link out; the TARGET links to the source. The pair is
    // connected, so the prose mention is not news — and the directed check this
    // replaced reported five such pairs on a real vault.
    const graph = await graphFor({
      "concepts/Alpha.md": "---\ntitle: Alpha\n---\n这里讨论了 Beta 的应用。\n",
      "concepts/Beta.md": "---\ntitle: Beta\n---\n见 [[Alpha]]。\n",
    });

    const findings = contentOf(analyzeGraph(graph).bundle!.findings);
    expect(findings.filter((finding) => finding.kind === "unlinked-mention")).toEqual([]);
  });
});

describe("content analyser: duplicates", () => {
  it("surfaces two near-identical names", async () => {
    const graph = await graphFor({
      "notes/Transformer.md": "---\ntitle: Transformer\n---\n一个。\n",
      "notes/Transformer 2.md": "---\ntitle: Transformer\n---\n另一个。\n",
    });

    const merge = contentOf(analyzeGraph(graph).bundle!.findings).find(
      (finding) => finding.kind === "merge-candidate",
    );

    expect(merge).toBeDefined();
    // Never better than moderate: the analyser compares names, and only the author
    // knows whether two similarly-named pages are one idea.
    expect(merge!.confidence).toBe("moderate");
    expect(merge!.effort).toBe("write");
    expect(merge!.action?.kind).toBe("open-notes");
  });

  it("does not accuse two names that merely share a word", async () => {
    const graph = await graphFor({
      "notes/A.md": "---\ntitle: 向量检索\n---\n一个。\n",
      "notes/B.md": "---\ntitle: 向量数据库\n---\n另一个。\n",
    });

    const findings = contentOf(analyzeGraph(graph).bundle!.findings);
    expect(findings.filter((finding) => finding.kind === "merge-candidate")).toEqual([]);
  });
});

describe("content analyser: boundaries", () => {
  it("produces nothing when the graph carries no content index", async () => {
    // A hand-built graph — a fixture, or a caller that never went through the
    // builder — has no index. The analyser must then say nothing rather than guess.
    const graph = await graphFor({ "a.md": "---\ntitle: A\n---\n内容。\n" });
    const withoutIndex = { ...graph, nodes: graph.nodes, edges: graph.edges };

    const findings = contentOf(analyzeGraph(withoutIndex).bundle!.findings);
    expect(findings).toEqual([]);
  });

  it("stays within its cap", async () => {
    // Sixteen notes that each name one of sixteen others.
    const files: Record<string, string> = {};
    for (let index = 0; index < 16; index += 1) {
      const other = (index + 1) % 16;
      files[`n/N${index}.md`] = `---\ntitle: N${index}\n---\n这里提到 Target${other} 一次。\n`;
      files[`t/Target${other}.md`] = `---\ntitle: Target${other}\n---\n内容。\n`;
    }

    const findings = contentOf(analyzeGraph(await graphFor(files)).bundle!.findings);
    // 8 mentions + 3 merges is the ceiling the analyser declares.
    expect(findings.length).toBeLessThanOrEqual(11);
  });
});
