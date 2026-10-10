import { describe, expect, it } from "vitest";

import { insertedSpan, insertWikilink, type LinkInsertion } from "../src/core/note-edit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The page being linked to: id, while the file itself is `concepts/Beta.md`. */
const TARGET = "concepts/beta";

/** The link text the analyser built for it — `insertWikilink` must use it as-is. */
const LINK = "[[Beta|Beta Display]]";

/** The page's own name, which `LINK` resolves through: `[[Beta|Beta Display]]`. */
const PAGE = "Beta";

/**
 * A link whose display text is the page's name, as the bracket rule needs.
 *
 * The two fixtures exist because the analyser picks the link text and the outcomes
 * differ: when a mention matches through a frontmatter *alias*, the page name is not
 * the word in the note.
 */
const PLAIN_LINK = `[[${PAGE}]]`;

function run(content: string, term: string, overrides: Partial<{ text: string; targetId: string }> = {}): LinkInsertion {
  return insertWikilink(content, { term, text: LINK, targetId: TARGET, ...overrides });
}

/** The same call with a link that displays the page's own name. */
function runPlain(content: string, term: string): LinkInsertion {
  return run(content, term, { text: PLAIN_LINK });
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

// ---------------------------------------------------------------------------
// A term with a bracketed gloss
// ---------------------------------------------------------------------------

describe("insertWikilink: a term that is glossed in brackets", () => {
  it("links inside the brackets when they name the page", () => {
    // The reported defect, reproduced from the real vault: the author wrote the short
    // form and then the page's own name in brackets, and substituting the term left
    // that name dangling after a link that already said it.
    const input = "再用强化学习或直接偏好优化（Beta）把模型推向被偏好的方向。\n";
    const result = runPlain(input, "偏好优化");

    expect(result.changed).toBe(true);
    expect(result.content).toBe("再用强化学习或直接偏好优化（[[Beta]]）把模型推向被偏好的方向。\n");
    // The reader's own words survive, which is the whole point.
    expect(result.content).toContain("偏好优化（[[");
    expect(result.content).not.toContain("（Beta）");
  });

  it("keeps the term itself, so nothing is deleted", () => {
    // The negative control for the fix: the earlier behaviour replaced the term, so
    // asserting the term is still present is what distinguishes the two.
    const result = runPlain("见偏好优化（Beta）一节。\n", "偏好优化");
    expect(result.content).toContain("偏好优化");
    expect(result.content).toContain("（[[Beta]]）");
  });

  it("handles an English gloss separated by a space", () => {
    const result = runPlain("Defence has a cost (Beta) to weigh.\n", "cost");
    expect(result.content).toBe("Defence has a cost ([[Beta]]) to weigh.\n");
  });

  it("does not reach into a long bracketed clause", () => {
    // The bound is what stops a long parenthetical from being read as a gloss, and a
    // term that is an alias of the page still keeps its own word in the fallback.
    const long = "这一点在别的笔记里展开说过很长一段话所以超出了上限";
    const input = `偏好优化（${long}）是主题。\n`;
    const result = runPlain(input, "偏好优化");

    expect(result.content).toBe(`[[Beta|偏好优化]]（${long}）是主题。\n`);
    // The clause is untouched, which is the point of the fallback.
    expect(result.content).toContain(long);
  });

  it("leaves a bracket alone when it is about something else", () => {
    // The rule that the alias work exposed: a bracket is only a gloss when its
    // contents are the page's name. `（DPO）` is an aside about another term, so
    // replacing the contents would put this link in the wrong group of words — and
    // the reader's word is kept rather than swapped for the page name.
    const result = runPlain("或直接偏好优化（DPO）把模型推向被偏好的方向。\n", "偏好优化");
    expect(result.content).toBe("或直接[[Beta|偏好优化]]（DPO）把模型推向被偏好的方向。\n");
    expect(result.content).toContain("（DPO）");
  });

  it("still replaces the term when no bracket follows", () => {
    // Negative control: the bracket rule must not swallow the ordinary case.
    const result = runPlain("偏好优化很重要。\n", "偏好优化");
    expect(result.content).toBe("[[Beta|偏好优化]]很重要。\n");
  });

  it("does not treat a bracket in the next sentence as a gloss", () => {
    const result = runPlain("偏好优化很好。（Beta）\n", "偏好优化");
    // Two characters away but a sentence boundary between them.
    expect(result.content).toBe("[[Beta|偏好优化]]很好。（Beta）\n");
  });
});

// ---------------------------------------------------------------------------
// A term that matches through a frontmatter alias
// ---------------------------------------------------------------------------

describe("insertWikilink: a term that is one of the page's aliases", () => {
  it("keeps the reader's word as the link's alias", () => {
    // The second reported defect. `对齐税.md` lists `过度拒答` in its aliases because
    // over-refusal is one of the tax's symptoms — a narrower word than the page name —
    // so substituting the page name replaced the symptom with the category:
    //
    //   对齐会带来"对齐税"：过度拒答、回答趋同、…
    // → 对齐会带来"对齐税"：[[对齐税]]、回答趋同、…
    //
    // The author listed the alias because they do mean that page by that word, so the
    // matched spelling becomes the link's display text and the prose is untouched.
    const input = '- **风险。** 对齐会带来"对齐税"：过度拒答、回答趋同。\n';
    const result = run(input, "过度拒答");

    expect(result.changed).toBe(true);
    expect(result.content).toBe('- **风险。** 对齐会带来"对齐税"：[[Beta|过度拒答]]、回答趋同。\n');
    expect(result.content).toContain("过度拒答");
  });

  it("does not add an alias when the link would already display the term", () => {
    // Negative control: the ordinary case must stay a plain `[[Target]]`, not become
    // `[[Target|target]]`. The link here is the bare form, so no alias is needed.
    const result = run("Beta 很重要。\n", "Beta", { text: `[[${PAGE}]]` });
    expect(result.content).toBe("[[Beta]] 很重要。\n");
    expect(result.content).not.toContain("|Beta]]");
  });

  it("leaves the caller's link spelling alone for a differently cased match", () => {
    // `[[Beta]]` is what the caller supplied and what stays: the link text is never
    // rebuilt, only given an alias when one is needed.
    const result = run("beta 很重要。\n", "beta", { text: `[[${PAGE}]]` });
    expect(result.content).toBe("[[Beta]] 很重要。\n");
    expect(result.content).not.toContain("|beta]]");
  });

  it("replaces in place rather than inserting beside the term", () => {
    // What the defect looked like: the term must not survive next to the link, or the
    // sentence would read `过度拒答[[对齐税]]`.
    const result = run("见过度拒答一节。\n", "过度拒答");
    expect(result.content).toBe("见[[Beta|过度拒答]]一节。\n");
    expect(result.content).not.toContain("过度拒答[[");
  });
});

// ---------------------------------------------------------------------------
// insertedSpan: where the highlight goes in the preview
// ---------------------------------------------------------------------------

describe("insertedSpan", () => {
  const slice = (line: string, span: ReturnType<typeof insertedSpan>): string =>
    span === null ? "" : line.slice(span.start, span.end);

  it("finds the link that replaced a term in the middle of a line", () => {
    // The preview's whole value: two versions of one line, and the mark has to land
    // on the link, not on the sentence around it.
    const before = "这意味着现有的评测方法需要改造。";
    const after = "这意味着现有的[[评测方法]]需要改造。";

    const span = insertedSpan(before, after);
    expect(slice(after, span)).toBe("[[评测方法]]");
  });

  it("finds a link inserted at the very start", () => {
    const span = insertedSpan("Beta 是主题。", "[[Beta]] 是主题。");
    expect(slice("[[Beta]] 是主题。", span)).toBe("[[Beta]]");
  });

  it("finds a link at the very end", () => {
    const span = insertedSpan("见 Beta", "见 [[Beta]]");
    expect(slice("见 [[Beta]]", span)).toBe("[[Beta]]");
  });

  it("finds a link that replaced a longer name", () => {
    // The replacement is a wikilink carrying an alias, so the inserted run is longer
    // than the term it replaced — the span must cover the whole link, not the term.
    const span = insertedSpan("关于 Beta Display 的说明。", "关于 [[Beta|Beta Display]] 的说明。");
    expect(slice("关于 [[Beta|Beta Display]] 的说明。", span)).toBe("[[Beta|Beta Display]]");
  });

  it("returns null when the two lines are identical", () => {
    // Negative control: no change means no highlight, rather than a full-line one.
    expect(insertedSpan("一样的一行", "一样的一行")).toBeNull();
  });

  it("never returns a negative-width span when characters repeat", () => {
    // `aa` → `a`: every character is shared with itself, so suffix pursuit bounded
    // only by the shorter string would walk past the prefix and invert the span.
    const span = insertedSpan("aaa", "aa");
    expect(span === null || span.end > span.start).toBe(true);
    const forward = insertedSpan("aa", "aaa");
    expect(forward === null || forward.end > forward.start).toBe(true);
  });

  it("returns a forward span for every prefix-and-suffix combination", () => {
    // Property check over the shapes this edit can produce, so the two bounds cannot
    // drift into an inverted span for some length nobody thought to write a case for.
    const base = "abcde";
    for (let cut = 0; cut <= base.length; cut += 1) {
      for (let end = cut; end <= base.length; end += 1) {
        const shorter = base.slice(0, cut) + base.slice(end);
        for (const [before, after] of [
          [shorter, base],
          [base, shorter],
        ] as const) {
          const span = insertedSpan(before, after);
          if (span !== null) {
            expect(span.start, `${before} → ${after}`).toBeGreaterThanOrEqual(0);
            expect(span.end, `${before} → ${after}`).toBeLessThanOrEqual(after.length);
            expect(span.end, `${before} → ${after}`).toBeGreaterThan(span.start);
          }
        }
      }
    }
  });

  it("agrees with what insertWikilink actually produced", () => {
    // The guard that matters: the span comes from the two strings, the strings come
    // from the edit. If they ever disagreed the preview would highlight the wrong
    // characters, and the reader would be confirming one thing while writing another.
    // The term here is the page's name, so the link carries its alias and the inserted
    // run is longer than the word it replaced — which is exactly the case a naive
    // "span of the term" would get wrong.
    const input = "参考 Beta 的说明。\n";
    const result = insertWikilink(input, { term: "Beta", text: LINK, targetId: TARGET });
    expect(result.changed).toBe(true);

    const beforeLine = input.split("\n")[0] ?? "";
    const afterLine = result.content.split("\n")[0] ?? "";
    const span = insertedSpan(beforeLine, afterLine);

    const marked = slice(afterLine, span);
    expect(marked).toBeDefined();
    expect(marked).not.toBe("");
    // Removing the mark leaves the original sentence with its word intact.
    expect(beforeLine).not.toContain(marked);
    expect(beforeLine).toContain("Beta");
    expect(result.content).toContain(`[[${PAGE}`);
  });
});
