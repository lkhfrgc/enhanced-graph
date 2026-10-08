import { describe, expect, it } from "vitest";

import {
  extractWikilinks,
  isStructuralSlug,
  normalizePageType,
  normalizeRelatedEntry,
  normalizeSourceKey,
  parseNote,
  splitFrontmatter,
  stripCode,
} from "../src/core/parse";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A note touching every frontmatter field `parseNote` reads, plus body links,
 * a fenced block, inline code and an embed.
 */
const REALISTIC_NOTE = [
  "---",
  "title: Attention Is All You Need",
  "type: 论文",
  'sources: ["raw/papers/Attention Is All You Need.pdf", "[[The Transformer Blog]]"]',
  'tags: [transformer, "#nlp"]',
  'aliases: ["Transformer Paper", Transformer]',
  'related: ["[[concepts/Self-Attention|attention]]", "entities/Vaswani.md"]',
  "---",
  "# Heading",
  "",
  "Body links [[Self-Attention]] and [[Multi-Head Attention|heads]].",
  "",
  "```ts",
  "// [[Not A Link]]",
  "```",
  "",
  "Inline `[[Also Not A Link]]` stays.",
  "",
  "![[Figure 1.png]]",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe("splitFrontmatter", () => {
  it("splits a plain --- block into data, raw and body", () => {
    const result = splitFrontmatter("---\ntitle: X\ntags: [a]\n---\nbody\n");

    expect(result.data).toEqual({ title: "X", tags: ["a"] });
    expect(result.raw).toBe("title: X\ntags: [a]");
    expect(result.body).toBe("body\n");
  });

  it("accepts CRLF line endings", () => {
    const result = splitFrontmatter("---\r\ntitle: X\r\n---\r\nbody\r\n");

    expect(result.data).toEqual({ title: "X" });
    expect(result.raw).toBe("title: X");
    expect(result.body).toBe("body\r\n");
  });

  it("accepts a leading BOM", () => {
    const result = splitFrontmatter("\uFEFF---\ntitle: X\n---\nbody\n");

    expect(result.data).toEqual({ title: "X" });
    expect(result.raw).toBe("title: X");
    expect(result.body).toBe("body\n");
  });

  it("does not throw on malformed YAML: data is empty and body follows the block", () => {
    // FINDING: a block that fails to parse is still *recognised* as frontmatter,
    // so `body` is the text after the closing `---`, not the whole document.
    // The fallback only clears `data`.
    const content = "---\ntitle: [unclosed\nfoo: {bar\n---\nreal body\n";

    expect(() => splitFrontmatter(content)).not.toThrow();

    const result = splitFrontmatter(content);
    expect(result.data).toEqual({});
    expect(result.raw).toBe("title: [unclosed\nfoo: {bar");
    expect(result.body).toBe("real body\n");
  });

  it("treats YAML that is not a mapping as no metadata", () => {
    const scalar = splitFrontmatter("---\njust-a-string\n---\nbody\n");
    expect(scalar.data).toEqual({});
    expect(scalar.body).toBe("body\n");

    expect(splitFrontmatter("---\n- a\n- b\n---\nbody\n").data).toEqual({});
  });

  it("returns the content unchanged when there is no frontmatter", () => {
    const content = "# Title\n\njust text\n";

    expect(splitFrontmatter(content)).toEqual({ data: {}, body: content, raw: "" });
  });

  it("does not treat a later --- (a horizontal rule) as frontmatter", () => {
    const content = "body\n\n---\n\nmore\n";

    expect(splitFrontmatter(content)).toEqual({ data: {}, body: content, raw: "" });
  });

  it("accepts a closing --- at end of file with no trailing newline", () => {
    expect(splitFrontmatter("---\na: 1\n---")).toEqual({ data: { a: 1 }, body: "", raw: "a: 1" });
  });

  it("handles empty content", () => {
    expect(splitFrontmatter("")).toEqual({ data: {}, body: "", raw: "" });
  });
});

// ---------------------------------------------------------------------------
// Page type
// ---------------------------------------------------------------------------

describe("normalizePageType", () => {
  it("maps English and Chinese aliases onto canonical page types", () => {
    expect(normalizePageType("entity")).toBe("entity");
    expect(normalizePageType("Entity")).toBe("entity");
    expect(normalizePageType("实体")).toBe("entity");
    expect(normalizePageType("概念")).toBe("concept");
    expect(normalizePageType("资料")).toBe("source");
    expect(normalizePageType("论文")).toBe("source");
    expect(normalizePageType("synthesis")).toBe("synthesis");
    expect(normalizePageType("query")).toBe("query");
    expect(normalizePageType("  CONCEPT  ")).toBe("concept");
    expect(normalizePageType("Overview")).toBe("overview");
  });

  it("falls back to other for unknown, blank and non-string values", () => {
    expect(normalizePageType("banana")).toBe("other");
    expect(normalizePageType("")).toBe("other");
    expect(normalizePageType("   ")).toBe("other");
    expect(normalizePageType(null)).toBe("other");
    expect(normalizePageType(undefined)).toBe("other");
    expect(normalizePageType(42)).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Source keys
// ---------------------------------------------------------------------------

describe("normalizeSourceKey", () => {
  it("collapses a paper path, a wikilink and loose spacing onto one key", () => {
    const spaced = normalizeSourceKey("attention   is all you need");

    expect(spaced).toBe("attention is all you need");
    expect(normalizeSourceKey("raw/papers/Attention Is All You Need.pdf")).toBe(spaced);
    expect(normalizeSourceKey("[[Attention Is All You Need]]")).toBe(spaced);
  });

  it("keeps hyphens, so the hyphenated form is a different key", () => {
    // FINDING: only runs of whitespace collapse (`\s+` → " "); the hyphen is
    // left alone, so "Attention-Is-All-You-Need" does NOT normalise onto the
    // spaced form and the same paper would be counted as two sources.
    const hyphenated = normalizeSourceKey("Attention-Is-All-You-Need");

    expect(hyphenated).toBe("attention-is-all-you-need");
    expect(hyphenated).not.toBe(normalizeSourceKey("attention is all you need"));
  });

  it("drops the alias, the heading, the directory and a known extension", () => {
    expect(normalizeSourceKey("[[Note|alias]]")).toBe("note");
    expect(normalizeSourceKey("Note#heading")).toBe("note");
    expect(normalizeSourceKey("Note.MD")).toBe("note");
    expect(normalizeSourceKey("raw/sub dir/My  Note.docx")).toBe("my note");
    expect(normalizeSourceKey("deep/nested/Report.PDF")).toBe("report");
  });

  it("returns the empty string for blank input", () => {
    expect(normalizeSourceKey("")).toBe("");
    expect(normalizeSourceKey("   ")).toBe("");
  });

  it("strips the extension before collapsing whitespace", () => {
    // FINDING: `\.md$` runs before the whitespace collapse, so a single trailing
    // space inside the wikilink defeats it and the extension survives.
    expect(normalizeSourceKey("[[ Attention  Is All You Need .md ]]")).toBe(
      "attention is all you need .md",
    );
  });
});

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

describe("extractWikilinks", () => {
  it("returns the bare target for plain, aliased, heading and embedded links", () => {
    expect(extractWikilinks("[[a]] [[a|b]] [[a#h]] [[a#h|b]] ![[embed]]")).toEqual([
      "a",
      "a",
      "a",
      "a",
      "embed",
    ]);
  });

  it("extracts several links from one line, in document order, keeping duplicates", () => {
    expect(extractWikilinks("[[a]] and [[b|B]] then [[c#h|C]]")).toEqual(["a", "b", "c"]);
    expect(extractWikilinks("[[a]] [[b]] [[a]]")).toEqual(["a", "b", "a"]);
  });

  it("ignores links inside fenced code blocks", () => {
    expect(extractWikilinks("before\n```js\n[[code]]\n```\nafter [[real]]")).toEqual(["real"]);
    expect(extractWikilinks("before\n~~~\n[[code]]\n~~~\nafter [[real]]")).toEqual(["real"]);
    expect(extractWikilinks("before\n````\n[[code]]\n````\nafter [[real]]")).toEqual(["real"]);
  });

  it("ignores links inside inline code", () => {
    expect(extractWikilinks("a `[[inline]]` b [[real]]")).toEqual(["real"]);
  });

  it("ignores empty and blank targets", () => {
    expect(extractWikilinks("[[]]")).toEqual([]);
    expect(extractWikilinks("[[   ]] [[ | ]]")).toEqual([]);
  });

  it("still scans an unterminated fence", () => {
    // FINDING: `stripCode` needs a closing fence, so an unclosed ``` block is
    // scanned and its links leak into the result.
    expect(extractWikilinks("```\n[[leaked]]\n")).toEqual(["leaked"]);
  });
});

describe("stripCode", () => {
  it("removes fenced blocks and inline code, leaving the rest intact", () => {
    expect(stripCode("keep `inline` and\n```\n[[fenced]]\n```\ntail")).toBe("keep  and\n\ntail");
  });

  it("removes tilde fences as well", () => {
    expect(stripCode("before\n~~~\n[[fenced]]\n~~~\nafter")).toBe("before\n\nafter");
  });
});

// ---------------------------------------------------------------------------
// related[] entries and structural slugs
// ---------------------------------------------------------------------------

describe("normalizeRelatedEntry", () => {
  it("reduces a wikilink to its bare target", () => {
    expect(normalizeRelatedEntry("[[concepts/x|y]]")).toBe("x");
    expect(normalizeRelatedEntry("[[Note#h|alias]]")).toBe("Note");
  });

  it("takes the last path segment and drops a .md extension", () => {
    expect(normalizeRelatedEntry("a/b/c.md")).toBe("c");
    expect(normalizeRelatedEntry("c.MD")).toBe("c");
    expect(normalizeRelatedEntry("")).toBe("");
  });

  it("normalises backslashes to forward slashes", () => {
    expect(normalizeRelatedEntry("a\\b\\c")).toBe("c");
    expect(normalizeRelatedEntry("[[concepts\\x]]")).toBe("x");
  });
});

describe("isStructuralSlug", () => {
  it("recognises the structural slugs, their prefixed forms, and nothing else", () => {
    expect(isStructuralSlug("index")).toBe(true);
    expect(isStructuralSlug("Index")).toBe(true);
    expect(isStructuralSlug("overview")).toBe(true);
    expect(isStructuralSlug("log")).toBe(true);
    expect(isStructuralSlug("purpose")).toBe(true);
    expect(isStructuralSlug("Index of Things")).toBe(true);

    expect(isStructuralSlug("note")).toBe(false);
    expect(isStructuralSlug("logs")).toBe(false);
    expect(isStructuralSlug("logo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end note parsing
// ---------------------------------------------------------------------------

describe("parseNote", () => {
  it("parses a realistic note end to end", () => {
    expect(parseNote("Papers/Attention Is All You Need.md", REALISTIC_NOTE)).toEqual({
      path: "Papers/Attention Is All You Need.md",
      id: "papers/attention is all you need",
      rawId: "Papers/Attention Is All You Need",
      basename: "Attention Is All You Need",
      title: "Attention Is All You Need",
      rawType: "论文",
      type: "source",
      sources: ["attention is all you need", "the transformer blog"],
      tags: ["transformer", "nlp"],
      aliases: ["Transformer Paper", "Transformer"],
      links: [
        "Self-Attention",
        "Multi-Head Attention",
        "Figure 1.png",
        "The Transformer Blog",
        "concepts/Self-Attention",
        "Vaswani",
      ],
      isStructural: false,
    });
  });

  it("lower-cases the id but keeps rawId, basename and path in their original case", () => {
    const note = parseNote("Papers/Deep Work.md", "body\n");

    expect(note.id).toBe("papers/deep work");
    expect(note.rawId).toBe("Papers/Deep Work");
    expect(note.basename).toBe("Deep Work");
    expect(note.path).toBe("Papers/Deep Work.md");
  });

  it("normalises backslashes in the path and strips an upper-case .MD", () => {
    const note = parseNote("a\\b\\Note.MD", "body\n");

    expect(note.path).toBe("a/b/Note.MD");
    expect(note.basename).toBe("Note");
    expect(note.rawId).toBe("a/b/Note");
    expect(note.id).toBe("a/b/note");
  });

  it("unions body wikilinks with related[] entries and de-duplicates", () => {
    const content = [
      "---",
      'related: ["[[Note Two]]", "entities/Note Three.md"]',
      "---",
      "[[Note Two]] and [[Note Two]] again plus [[Other]].",
    ].join("\n");

    expect(parseNote("a.md", content).links).toEqual(["Note Two", "Other", "Note Three"]);
  });

  it("also collects the raw wikilink form found in the frontmatter", () => {
    // FINDING: `links` is the union of `extractWikilinks(body)`,
    // `extractWikilinks(content)` — which rescans the frontmatter too — and the
    // *normalised* related[] entries. De-duplication is by exact string, so one
    // logical target can show up twice in two different shapes.
    const content = [
      "---",
      'related: ["[[concepts/Self-Attention]]"]',
      "---",
      "[[Self-Attention]]",
      "",
    ].join("\n");

    expect(parseNote("a.md", content).links).toEqual(["Self-Attention", "concepts/Self-Attention"]);
  });

  it("does not collect links from fenced or inline code", () => {
    const note = parseNote("a.md", "```\n[[fenced]]\n```\ntext `[[inline]]` and [[real]]\n");

    expect(note.links).toEqual(["real"]);
  });

  it("falls back to the first h1/h2 heading when there is no frontmatter title", () => {
    expect(parseNote("x.md", "# Another\n\ntext\n").title).toBe("Another");
    expect(parseNote("x.md", "## Real Heading\n\ntext\n").title).toBe("Real Heading");
  });

  it("ignores headings deeper than h2", () => {
    expect(parseNote("x.md", "### Deep Heading\n\ntext\n").title).toBe("x");
  });

  it("falls back to the basename with - and _ replaced by spaces", () => {
    expect(parseNote("my-note_name.md", "Body only.\n").title).toBe("my note name");
    expect(parseNote("folder/Multi-Word_Title.md", "Body.\n").title).toBe("Multi Word Title");
  });

  it("prefers the frontmatter title over a heading", () => {
    const note = parseNote("x.md", "---\ntitle: From Frontmatter\n---\n# From Heading\n");

    expect(note.title).toBe("From Frontmatter");
  });

  it("marks index/overview/log/purpose notes structural", () => {
    for (const basename of ["index", "overview", "log", "purpose"]) {
      expect(parseNote(`folder/${basename}.md`, "body\n").isStructural).toBe(true);
    }
    expect(parseNote("Index.md", "body\n").isStructural).toBe(true);
  });

  it("marks a note structural when its normalised type is overview", () => {
    expect(parseNote("note.md", "---\ntype: overview\n---\nbody\n").isStructural).toBe(true);
    expect(parseNote("note.md", "---\ntype: 索引\n---\nbody\n").isStructural).toBe(true);
  });

  it("leaves an ordinary note non-structural", () => {
    expect(parseNote("note.md", "---\ntype: concept\n---\nbody\n").isStructural).toBe(false);
  });

  it("splits a comma-separated sources string and de-duplicates the keys", () => {
    expect(parseNote("x.md", "---\nsources: a, b\n---\nbody\n").sources).toEqual(["a", "b"]);

    const duplicates = parseNote(
      "x.md",
      '---\nsources: ["[[Attention Is All You Need]]", "raw/papers/Attention Is All You Need.pdf"]\n---\n',
    );
    expect(duplicates.sources).toEqual(["attention is all you need"]);
  });

  it("accepts tags as a list or a string and strips a leading #", () => {
    expect(parseNote("x.md", "---\ntags: [a, b]\n---\n").tags).toEqual(["a", "b"]);
    expect(parseNote("x.md", '---\ntags: "#c"\n---\n').tags).toEqual(["c"]);
    expect(parseNote("x.md", '---\ntags: ["#c", d]\n---\n').tags).toEqual(["c", "d"]);
  });

  it("reads aliases from a list or a comma-separated string", () => {
    expect(parseNote("x.md", "---\naliases: [A, B]\n---\n").aliases).toEqual(["A", "B"]);
    expect(parseNote("x.md", "---\naliases: A, B\n---\n").aliases).toEqual(["A", "B"]);
  });
});
