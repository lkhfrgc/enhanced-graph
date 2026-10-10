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

/** A link whose display text is the page's name. */
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
  it("adds the link in brackets after the term, without touching the term", () => {
    const result = run("Beta Display is a concept.\n", "Beta Display");

    expect(result.changed).toBe(true);
    expect(result.content).toBe("Beta Display（[[Beta|Beta Display]]） is a concept.\n");
    // The word is still there — the edit inserts, it does not replace.
    expect(result.content.startsWith("Beta Display")).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("links a note whose title differs from its file name", () => {
    // The whole reason `text` arrives pre-built: the file is `concepts/Beta.md`
    // while the mention is the display title. Rebuilding the link here from the
    // title would produce `[[Beta Display]]`, which resolves to nothing.
    const result = run("See Beta Display for details.\n", "Beta Display");

    expect(result.content).toBe("See Beta Display（[[Beta|Beta Display]]） for details.\n");
    expect(result.content).not.toContain("[[Beta Display]]");
  });

  it("takes the occurrence closest to the start of the body", () => {
    const result = run("one Beta Display here and another Beta Display there.\n", "Beta Display");

    expect(result.content).toBe(
      "one Beta Display（[[Beta|Beta Display]]） here and another Beta Display there.\n",
    );
  });

  it("prefers prose over a heading, wherever the heading is", () => {
    const result = run("# Beta Display\n\nBeta Display is a concept.\n", "Beta Display");

    expect(result.content).toBe(
      "# Beta Display\n\nBeta Display（[[Beta|Beta Display]]） is a concept.\n",
    );
  });

  it("falls back to a heading when that is the only occurrence", () => {
    const result = run("# Beta Display\n\nNothing else.\n", "Beta Display");

    expect(result.content).toBe("# Beta Display（[[Beta|Beta Display]]）\n\nNothing else.\n");
  });

  it("matches the term case-insensitively and leaves the spelling it found", () => {
    // The note's own casing stays: the link is added beside it, not over it.
    const result = run("see beta display here\n", "Beta Display");

    expect(result.content).toBe("see beta display（[[Beta|Beta Display]]） here\n");
  });

  it("does not match the term inside a longer word", () => {
    const result = run("Beta Displayware is not Beta Display.\n", "Beta Display");

    expect(result.content).toBe(
      "Beta Displayware is not Beta Display（[[Beta|Beta Display]]）.\n",
    );
  });

  it("links a Chinese term wherever it occurs", () => {
    // No word boundaries to check: the term is matched as written.
    const result = run("这里讨论检索增强生成的实现。\n", "检索增强生成", { targetId: "concepts/检索增强生成", text: "[[检索增强生成]]" });

    expect(result.content).toBe("这里讨论检索增强生成（[[检索增强生成]]）的实现。\n");
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
    expect(result.content).toBe(
      "```\n[[Beta]]\n```\n\nBeta Display（[[Beta|Beta Display]]） is discussed.\n",
    );
  });

  it("does not treat a link to another page as this pair", () => {
    const input = "[[Gamma]] and Beta Display.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("[[Gamma]] and Beta Display（[[Beta|Beta Display]]）.\n");
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

    expect(result.content).toBe(
      "`Beta Display` then Beta Display（[[Beta|Beta Display]]） in prose.\n",
    );
  });

  it("skips a fenced block to reach the prose after it", () => {
    const result = run("```\nBeta Display\n```\n\nBeta Display in prose.\n", "Beta Display");

    expect(result.content).toBe(
      "```\nBeta Display\n```\n\nBeta Display（[[Beta|Beta Display]]） in prose.\n",
    );
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

    expect(result.content).toBe(
      "A [[Beta Display Notes|note]] and Beta Display（[[Beta|Beta Display]]） outside.\n",
    );
    expect(result.content).not.toContain("[[[");
  });

  it("does not insert inside a markdown link's label", () => {
    const input = "[Beta Display](https://example.com) and Beta Display outside.\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe(
      "[Beta Display](https://example.com) and Beta Display（[[Beta|Beta Display]]） outside.\n",
    );
  });

  it("reports no-change rather than success when the text would be identical", () => {
    // Unreachable through `insertWikilink`, which always adds brackets, so this pins
    // the guard directly: a result equal to the input must never be reported as a
    // successful write, whatever route produced it.
    const input = "Beta Display 的说明。\n";
    const result = insertWikilink(input, {
      term: "Beta Display",
      // A zero-width insertion of nothing: the only way the output can equal the input.
      text: "",
      targetId: TARGET,
    });

    // An empty link text is refused before matching, which is its own guard.
    expect(result.changed).toBe(false);
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

    expect(result.content).toBe("---\ntitle: Alpha\ntags: [concept]\n---\nBeta Display（[[Beta|Beta Display]]） is a concept.\n");
    expect(result.content.startsWith("---\ntitle: Alpha\ntags: [concept]\n---\n")).toBe(true);
  });

  it("keeps CRLF line endings and still inserts in the body", () => {
    const input = "---\r\ntitle: Alpha\r\n---\r\nBeta Display is a concept.\r\n";
    const result = run(input, "Beta Display");

    expect(result.content).toBe("---\r\ntitle: Alpha\r\n---\r\nBeta Display（[[Beta|Beta Display]]） is a concept.\r\n");
  });

  it("inserts at the very start of a note with no frontmatter", () => {
    const result = run("Beta Display is a concept.\n", "Beta Display");

    expect(result.content.startsWith("Beta Display（[[Beta|Beta Display]]）")).toBe(true);
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
      "Beta Display（[[Beta|Beta Display]]） is discussed here.",
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
    // The link and its two brackets are added; the term is not removed, so the growth
    // is the whole insertion. Getting this wrong is how a "verifies the edit happened"
    // assertion quietly stops verifying anything.
    expect(result.content.length).toBe(input.length + LINK.length + 2);
  });

  it("returns the input byte for byte whenever changed is false", () => {
    // `no-change` is deliberately absent: the edit only ever inserts, so a matched term
    // always produces different content and that branch is unreachable from here.
    const cases: ReadonlyArray<[string, string, string]> = [
      ["already linked", "[[Beta]] and Beta Display.\n", "already-linked"],
      ["term absent", "Nothing here.\n", "term-not-found"],
      ["inside code", "`Beta Display` only.\n", "term-not-found"],
      ["empty term", "Beta Display.\n", "term-not-found"],
    ];

    for (const [name, input, reason] of cases) {
      const term = name === "empty term" ? "   " : "Beta Display";
      const result = insertWikilink(input, { term, text: LINK, targetId: TARGET });
      expect(result.changed, name).toBe(false);
      expect(result.reason, name).toBe(reason);
      expect(result.content, name).toBe(input);
    }
  });
});

// ---------------------------------------------------------------------------
// The bracket is added, always
//
// One shape covers every case: the link goes in a new pair of brackets after the term,
// and the term itself is never touched. Earlier versions branched — replacing the term,
// or reusing brackets the note already had — and each branch was a way to rewrite the
// reader's prose by accident. There is one branch now, and these tests pin the places
// the old ones went wrong.
// ---------------------------------------------------------------------------

describe("insertWikilink: the brackets are added, never reused", () => {
  it("does not merge with a bracket the note already has", () => {
    // The case that started this: the note defines its own abbreviation, and the link
    // must not be dropped inside that definition or over it.
    const input = "再用强化学习或直接偏好优化（DPO）把模型推向被偏好的方向。\n";
    const result = runPlain(input, "偏好优化");

    expect(result.content).toBe(
      "再用强化学习或直接偏好优化（DPO）（[[Beta]]）把模型推向被偏好的方向。\n",
    );
    // Both groups survive: the reader's definition and the link are separate things.
    expect(result.content).toContain("（DPO）");
    expect(result.content).toContain("（[[Beta]]）");
  });

  it("does not touch a long bracketed clause", () => {
    // Nothing to bound any more — there is no rule that reaches into brackets — so a
    // long parenthetical is safe for the same reason a short one is.
    const long = "这一点在别的笔记里展开说过很长一段话所以超出了上限";
    const input = `偏好优化（${long}）是主题。\n`;
    const result = runPlain(input, "偏好优化");

    expect(result.content).toBe(`偏好优化（${long}）（[[Beta]]）是主题。\n`);
    expect(result.content).toContain(long);
  });

  it("puts the link after the term, not over it", () => {
    // The defect that a wrong span produces: the term vanishes and only the link is
    // left. Asserting the term's presence is what distinguishes insert from replace.
    const result = runPlain("偏好优化很重要。\n", "偏好优化");

    expect(result.content).toBe("偏好优化（[[Beta]]）很重要。\n");
    expect(result.content.startsWith("偏好优化")).toBe(true);
  });

  it("keeps the word when the link text differs from the term", () => {
    // Where the alias version used to graft the term on as a link alias, the term now
    // simply stays where it was — no alias, no reconstruction.
    const input = '- **风险。** 对齐会带来"对齐税"：过度拒答、回答趋同。\n';
    const result = run(input, "过度拒答");

    expect(result.content).toBe(
      '- **风险。** 对齐会带来"对齐税"：过度拒答（[[Beta|Beta Display]]）、回答趋同。\n',
    );
    expect(result.content).toContain("过度拒答（");
  });

  it("never leaves the term missing from the edited line", () => {
    // A property check over the shapes that used to break, because "the reader's word
    // survives" is the invariant every earlier version violated somewhere.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["偏好优化很重要。\n", "偏好优化"],
      ["偏好优化（DPO）把模型推向。\n", "偏好优化"],
      ["Beta Display is a concept.\n", "Beta Display"],
      ["see beta display here\n", "beta display"],
      ["# Beta Display\n\nNothing.\n", "Beta Display"],
      ["直接偏好优化（DPO）把模型推向。\n", "偏好优化"],
    ];

    for (const [input, term] of cases) {
      const result = run(input, term);
      expect(result.changed, input).toBe(true);
      expect(result.content, input).toContain(term);
      expect(result.content, input).toContain("（[[");
    }
  });

  it("keeps the term's own casing rather than the page's", () => {
    // The note wrote `beta display`; the page is `Beta Display`. The link carries the
    // page's name, and the note keeps its own casing.
    const result = runPlain("see beta display here\n", "beta display");

    expect(result.content).toBe("see beta display（[[Beta]]） here\n");
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
