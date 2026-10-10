import { describe, expect, it } from "vitest";

import { insertWikilink, type LinkInsertion } from "../src/core/note-edit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The page being linked to: id, while the file itself is `concepts/Beta.md`. */
const TARGET = "concepts/beta";

/** The link text the analyser built for it — `insertWikilink` must use it as-is. */
const LINK = "[[Beta|Beta Display]]";

function run(content: string, term: string, overrides: Partial<{ text: string; targetId: string }> = {}): LinkInsertion {
  return insertWikilink(content, { term, text: LINK, targetId: TARGET, ...overrides });
}

/** A note with frontmatter, a body mention and both code shapes. */
const REALISTIC_NOTE = [
  "---",
  "title: Alpha",
  "tags: [concept]",
  "---",
  "# Alpha",
  "",
  "Beta Display is discussed here.",
  "",
  "```ts",
  "const name = \"Beta Display\";",
  "```",
  "",
  "Inline `Beta Display` stays.",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// The plain case
// ---------------------------------------------------------------------------

describe("insertWikilink: inserting", () => {
  it("replaces the bare term with the link text, verbatim", () => {
    const result = run("Beta Display is a concept.\n", "Beta Display");

    expect(result.changed).toBe(true);
    expect(result.content).toBe("[[Beta|Beta Display]] is a concept.\n");
    expect(result.reason).toBeUndefined();
  });

  it("links a note whose title differs from its file name", () => {
    // The whole reason `text` arrives pre-built: the file is `concepts/Beta.md`
    // while the mention is the display title. Rebuilding the link here from the
    // title would produce `[[Beta Display]]`, which resolves to nothing.
    const result = run("See Beta Display for details.\n", "Beta Display");

    expect(result.content).toBe("See [[Beta|Beta Display]] for details.\n");
    expect(result.content).not.toContain("[[Beta Display]]");
  });

  it("takes the occurrence closest to the start of the body", () => {
    const result = run("one Beta Display here and another Beta Display there.\n", "Beta Display");

    expect(result.content).toBe("one [[Beta|Beta Display]] here and another Beta Display there.\n");
  });

  it("prefers prose over a heading, wherever the heading is", () => {
    const result = run("# Beta Display\n\nBeta Display is a concept.\n", "Beta Display");

    expect(result.content).toBe("# Beta Display\n\n[[Beta|Beta Display]] is a concept.\n");
  });

  it("falls back to a heading when that is the only occurrence", () => {
    const result = run("# Beta Display\n\nNothing else.\n", "Beta Display");

    expect(result.content).toBe("# [[Beta|Beta Display]]\n\nNothing else.\n");
  });

  it("matches the term case-insensitively and replaces the spelling it found", () => {
    const result = run("see beta display here\n", "Beta Display");

    expect(result.content).toBe("see [[Beta|Beta Display]] here\n");
  });

  it("does not match the term inside a longer word", () => {
    const result = run("Beta Displayware is not Beta Display.\n", "Beta Display");

    expect(result.content).toBe("Beta Displayware is not [[Beta|Beta Display]].\n");
  });

  it("links a Chinese term wherever it occurs", () => {
    // No word boundaries to check: the term is matched as written.
    const result = run("这里讨论检索增强生成的实现。\n", "检索增强生成", { targetId: "concepts/检索增强生成", text: "[[检索增强生成]]" });

    expect(result.content).toBe("这里讨论[[检索增强生成]]的实现。\n");
  });
});

// ---------------------------------------------------------------------------
// Refusing: already linked
// ---------------------------------------------------------------------------

describe("insertWikilink: already linked", () => {
  // The four spellings an existing link can take. Each is a separate case because
  // each one is a different way the check can be written wrongly.
  const SPELLINGS: ReadonlyArray<[string, string]> = [
    ["bare", "[[Beta]]"],
    ["pathed", "[[concepts/Beta]]"],
    ["aliased", "[[Beta|an alias]]"],
    ["heading", "[[Beta#Details]]"],
  ];

  for (const [name, link] of SPELLINGS) {
    it(`refuses a ${name} link`, () => {
      const input = `${link} is already here.\n\nAnd Beta Display too.\n`;
      const result = run(input, "Beta Display");

      expect(result.changed).toBe(false);
      expect(result.reason).toBe("already-linked");
      expect(result.content).toBe(input);
    });
  }

  it("compares case-insensitively", () => {
    const input = "Linking [[CONCEPTS/BETA]] already.\n";
    const result = run(input, "Beta Display");

    expect(result.reason).toBe("already-linked");
    expect(result.content).toBe(input);
  });

  it("does not treat a code-block link as a link", () => {
    // `extractWikilinks` strips code, so the graph does not see this link either;
    // treating it as connected would block an edit the reader still wants.
    const input = "```\n[[Beta]]\n```\n\nBeta Display is discussed.\n";
    const result = run(input, "Beta Display");

    expect(result.reason).toBeUndefined();
    expect(result.content).toBe("```\n[[Beta]]\n```\n\n[[Beta|Beta Display]] is discussed.\n");
  });

  it("does not treat a link to another page as this pair", () => {
    const input = "[[Gamma]] and Beta Display.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("[[Gamma]] and [[Beta|Beta Display]].\n");
  });

  it("finds a link declared in frontmatter `related`", () => {
    const input = "---\nrelated: [\"[[Beta|see]]\"]\n---\n\nBeta Display is discussed.\n";
    const result = run(input, "Beta Display");

    expect(result.reason).toBe("already-linked");
    expect(result.content).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Refusing: the term is only inside code
// ---------------------------------------------------------------------------

describe("insertWikilink: code is left alone", () => {
  it("refuses when the only occurrence is in a fenced block", () => {
    const input = "```ts\nconst name = \"Beta Display\";\n```\n";
    const result = run(input, "Beta Display");

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("refuses when the only occurrence is in a tilde fence", () => {
    const input = "~~~\nBeta Display\n~~~\n";
    const result = run(input, "Beta Display");

    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("refuses when the only occurrence is an inline code span", () => {
    const input = "`Beta Display` is a page.\n";
    const result = run(input, "Beta Display");

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("inserts in the prose and leaves the code alone", () => {
    const result = run("`Beta Display` then Beta Display in prose.\n", "Beta Display");

    expect(result.content).toBe("`Beta Display` then [[Beta|Beta Display]] in prose.\n");
  });

  it("skips a fenced block to reach the prose after it", () => {
    const result = run("```\nBeta Display\n```\n\nBeta Display in prose.\n", "Beta Display");

    expect(result.content).toBe("```\nBeta Display\n```\n\n[[Beta|Beta Display]] in prose.\n");
  });

  it("refuses when a fence is never closed", () => {
    // An unclosed fence renders everything after it as code, so there is no place
    // in the rest of the note where a wikilink would be a link.
    const input = "```\nBeta Display\n";
    const result = run(input, "Beta Display");

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("does not skip prose just because the note contains a closed fence", () => {
    // The negative control for the unclosed-fence rule: a closed fence must not
    // make the rest of the note unreachable.
    const result = run("```\ncode\n```\n\nBeta Display in prose.\n", "Beta Display");

    expect(result.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Refusing: no place to insert
// ---------------------------------------------------------------------------

describe("insertWikilink: refusing", () => {
  it("returns term-not-found when the term is absent", () => {
    const input = "Nothing to see here.\n";
    const result = run(input, "Beta Display");

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("does not search the frontmatter for the term", () => {
    const input = "---\ntitle: Beta Display\naliases: [Beta Display]\n---\n\nNo mention in the body.\n";
    const result = run(input, "Beta Display");

    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("refuses an empty term", () => {
    const input = "Beta Display is here.\n";
    const result = insertWikilink(input, { term: "   ", text: LINK, targetId: TARGET });

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("term-not-found");
    expect(result.content).toBe(input);
  });

  it("does not insert inside an existing wikilink", () => {
    // The term occurs inside `[[Beta Display Notes|that page]]`, which is a link to
    // a different page: replacing it there would produce a link inside a link.
    const input = "A [[Beta Display Notes|note]] and Beta Display outside.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("A [[Beta Display Notes|note]] and [[Beta|Beta Display]] outside.\n");
    expect(result.content).not.toContain("[[[");
  });

  it("does not insert inside a markdown link's label", () => {
    const input = "[Beta Display](https://example.com) and Beta Display outside.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("[Beta Display](https://example.com) and [[Beta|Beta Display]] outside.\n");
  });

  it("reports no-change rather than success when the text would be identical", () => {
    // `text` equal to `term` is the degenerate case: the replacement happens and
    // produces the input. Claiming success there would write nothing and say it did.
    const input = "Beta Display is here.\n";
    const result = insertWikilink(input, { term: "Beta Display", text: "Beta Display", targetId: TARGET });

    expect(result.changed).toBe(false);
    expect(result.reason).toBe("no-change");
    expect(result.content).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe("insertWikilink: frontmatter", () => {
  it("leaves the frontmatter byte-identical and inserts after it", () => {
    const input = "---\ntitle: Alpha\ntags: [concept]\n---\nBeta Display is a concept.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("---\ntitle: Alpha\ntags: [concept]\n---\n[[Beta|Beta Display]] is a concept.\n");
    expect(result.content.startsWith("---\ntitle: Alpha\ntags: [concept]\n---\n")).toBe(true);
  });

  it("keeps CRLF line endings and still inserts in the body", () => {
    const input = "---\r\ntitle: Alpha\r\n---\r\nBeta Display is a concept.\r\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("---\r\ntitle: Alpha\r\n---\r\n[[Beta|Beta Display]] is a concept.\r\n");
  });

  it("inserts at the very start of a note with no frontmatter", () => {
    const result = run("Beta Display is a concept.\n", "Beta Display");

    expect(result.content.startsWith("[[Beta|Beta Display]]")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The whole note
// ---------------------------------------------------------------------------

describe("insertWikilink: a real note", () => {
  it("edits only the prose line", () => {
    const result = run(REALISTIC_NOTE, "Beta Display");

    const expected = [
      "---",
      "title: Alpha",
      "tags: [concept]",
      "---",
      "# Alpha",
      "",
      "[[Beta|Beta Display]] is discussed here.",
      "",
      "```ts",
      "const name = \"Beta Display\";",
      "```",
      "",
      "Inline `Beta Display` stays.",
      "",
    ].join("\n");

    expect(result.changed).toBe(true);
    expect(result.content).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Negative controls
// ---------------------------------------------------------------------------

describe("insertWikilink: negative controls", () => {
  it("changes the content when the edit is real", () => {
    // Without this, a function that returns its input unchanged and reports
    // `changed: true` would satisfy every refused-case assertion above.
    const input = "Beta Display is a concept.\n";
    const result = run(input, "Beta Display");

    expect(result.changed).toBe(true);
    expect(result.content).not.toBe(input);
    expect(result.content.length).toBe(input.length + LINK.length - "Beta Display".length);
  });

  it("returns the input byte for byte whenever changed is false", () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ["already linked", "[[Beta]] and Beta Display.\n", "already-linked"],
      ["term absent", "Nothing here.\n", "term-not-found"],
      ["inside code", "`Beta Display` only.\n", "term-not-found"],
      ["no change", "Beta Display only.\n", "no-change"],
    ];

    for (const [name, input, reason] of cases) {
      const text = reason === "no-change" ? "Beta Display" : LINK;
      const result = insertWikilink(input, { term: "Beta Display", text, targetId: TARGET });
      expect(result.changed, name).toBe(false);
      expect(result.reason, name).toBe(reason);
      expect(result.content, name).toBe(input);
    }
  });
});
