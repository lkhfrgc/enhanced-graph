/**
 * The finding model, the ranker and the section grouping.
 *
 * Why these three together: they are the decisions the refactor introduces, and
 * each has a failure mode that is invisible in the rendered panel —
 *
 *  - **keys**: a key built from rendered text or from a full member list silently
 *    drops the user's dismissals when anything about the card changes. The plan's
 *    §4.3 fixes the shape, so the shape is what is asserted here.
 *  - **ranking**: the order is severity ÷ effort, and the score is only a
 *    tie-breaker. A ranker that sorted by score alone would look plausible on
 *    screen while putting a cosmetic one-click suggestion above a structural
 *    failure.
 *  - **caps and empty sections**: a per-analyser cap that is applied in arrival
 *    order drops arbitrary findings, and a section emitted with nothing in it
 *    produces a tab that opens onto nothing.
 */

import { describe, expect, it } from "vitest";

import {
  documentFinding,
  pairFinding,
  groupFinding,
  documentFindingKey,
  pairFindingKey,
  groupFindingKey,
  fingerprintFinding,
  FINDING_SECTION,
  INSIGHT_SECTIONS,
  SECTION_LABEL_KEYS,
  digest,
  type Finding,
  type FindingKind,
  type InsightBundle,
} from "../src/core/insights/model";
import { rankFindings, effortRank, compareFindings, capsFrom } from "../src/core/insights/ranking";
import { buildBundle, countUndismissed, firstSectionId, visibleFindings, visibleSections } from "../src/core/insights/sections";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function finding(overrides: {
  kind: FindingKind;
  analyser?: string;
  key?: string;
  score?: number;
  severity?: 1 | 2 | 3;
  effort?: "one-click" | "edit" | "write";
  nodeId?: string;
}): Finding {
  const { kind, nodeId = "n1" } = overrides;
  const created = documentFinding({
    kind,
    analyser: overrides.analyser ?? "test",
    nodeId,
    titleKey: "insights.finding.isolated",
    severity: overrides.severity ?? 2,
    effort: overrides.effort ?? "edit",
    init: { evidence: [], anchors: { nodeIds: [nodeId], edgeKeys: [] }, score: overrides.score ?? 0 },
  });
  if (overrides.key === undefined) return created;
  return { ...created, key: overrides.key };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

describe("finding keys", () => {
  it("keys a page-scoped finding on the page, not on the rendered title", () => {
    expect(documentFindingKey("stale-hub", "notes/a")).toBe("node:stale-hub:notes/a");
  });

  it("keys a pair identically whichever way round the endpoints are given", () => {
    expect(pairFindingKey("missing-link", "a", "b")).toBe(pairFindingKey("missing-link", "b", "a"));
    expect(pairFindingKey("missing-link", "a", "b")).toBe("pair:missing-link:a:::b");
  });

  it("keys a group on its anchor alone, so the key cannot grow with the member list", () => {
    const small = groupFindingKey("sparse", "cluster-head");
    const large = groupFindingKey("sparse", "cluster-head");
    expect(small).toBe(large);
    // The length is bounded by the anchor, not by how many pages the group holds.
    expect(small.length).toBeLessThan(64);
  });

  it("keeps the two kinds of identity apart", () => {
    // A pair key and a page key must never collide: dismissing one would
    // otherwise silence the other.
    const keys = new Set([
      documentFindingKey("missing-link", "a"),
      pairFindingKey("missing-link", "a", "a"),
      groupFindingKey("missing-link", "a"),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("finding fingerprints", () => {
  it("changes when the evidence changes, though the key does not", () => {
    const base = finding({ kind: "sparse", nodeId: "cluster-head" });
    const moved: Finding = {
      ...base,
      evidence: [
        { kind: "community", labelKey: "reason.evidence.community", params: {}, contribution: 2 },
      ],
    };

    expect(moved.key).toBe(base.key);
    expect(fingerprintFinding(moved)).not.toBe(fingerprintFinding(base));
  });

  it("is stable for two identical findings", () => {
    expect(fingerprintFinding(finding({ kind: "isolated" }))).toBe(
      fingerprintFinding(finding({ kind: "isolated" })),
    );
  });

  it("digest is deterministic and bounded", () => {
    expect(digest("same input")).toBe(digest("same input"));
    expect(digest("same input")).not.toBe(digest("other input"));
    expect(digest("x".repeat(5000))).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

describe("finding sections", () => {
  it("assigns a section to every kind, with no kind left ungrouped", () => {
    // The record is exhaustive by type, so this guards the runtime shape too: a
    // kind mapped to an id that is not one of the declared sections would never be
    // rendered and would never throw.
    for (const [kind, section] of Object.entries(FINDING_SECTION)) {
      expect(INSIGHT_SECTIONS, `${kind} maps to an undeclared section`).toContain(section);
      expect(SECTION_LABEL_KEYS[section], `${section} has no label`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

describe("ranking", () => {
  it("puts a structural failure above a cosmetic one-click suggestion", () => {
    const trivial = finding({ kind: "isolated", severity: 1, effort: "one-click", score: 0.9 });
    const serious = finding({ kind: "single-point-of-failure", severity: 3, effort: "write", score: 0.1 });

    const { ranked } = rankFindings([trivial, serious], new Map());
    expect(ranked.map((entry) => entry.kind)).toEqual([
      "single-point-of-failure",
      "isolated",
    ]);
  });

  it("never lets a cheap fix outrank a more severe one", () => {
    // Regression, and the reason the order is not severity ÷ effort: that ratio
    // makes severity 2 with a one-click fix (2/1) beat severity 3 needing prose
    // (3/4), burying a single point of failure under a tidiness suggestion.
    const severeAndExpensive = finding({ kind: "single-point-of-failure", severity: 3, effort: "write" });
    const mildAndCheap = finding({ kind: "isolated", severity: 2, effort: "one-click" });

    const { ranked } = rankFindings([mildAndCheap, severeAndExpensive], new Map());
    expect(ranked.map((entry) => entry.kind)).toEqual([
      "single-point-of-failure",
      "isolated",
    ]);
  });

  it("puts the cheaper fix first within one severity band", () => {
    const expensive = finding({ kind: "isolated", nodeId: "expensive", severity: 2, effort: "write" });
    const cheap = finding({ kind: "isolated", nodeId: "cheap", severity: 2, effort: "one-click" });

    expect(effortRank(cheap)).toBeLessThan(effortRank(expensive));

    const { ranked } = rankFindings([expensive, cheap], new Map());
    expect(ranked.map((entry) => entry.key)).toEqual([cheap.key, expensive.key]);
  });

  it("lets the score break a tie between equally severe and equally cheap findings", () => {
    const weak = finding({ kind: "isolated", nodeId: "a", severity: 2, effort: "edit", score: 0.2 });
    const strong = finding({ kind: "isolated", nodeId: "b", severity: 2, effort: "edit", score: 1 });

    const { ranked } = rankFindings([weak, strong], new Map());
    expect(ranked.map((entry) => entry.key)).toEqual([strong.key, weak.key]);
  });

  it("reads a raw 0…6 surprise score on its own scale, not as a 0…1 fraction", () => {
    // Regression: the ordering originally added a share of the raw score to the
    // structural term, so the migrated detectors' score of 6 was six times the whole
    // term and a cosmetic one-click card outranked a structural failure.
    const trivial = finding({ kind: "isolated", severity: 1, effort: "one-click", score: 6 });
    const serious = finding({ kind: "single-point-of-failure", severity: 3, effort: "write", score: 1 });

    const ranges = new Map([["test", 6]]);
    const { ranked } = rankFindings([trivial, serious], new Map(), { scoreRanges: ranges });
    expect(ranked.map((entry) => entry.kind)).toEqual([
      "single-point-of-failure",
      "isolated",
    ]);
  });

  it("keeps the score out of the severity and effort comparison entirely", () => {
    // The property is structural, not a tuned bound: severity and effort are compared
    // before the score is ever read, so no score can cross either step. Two findings
    // that differ ONLY in score compare on the score (a strict tie-break, so a
    // non-zero result here is correct and expected); what must never happen is a
    // higher score winning against a more severe or a cheaper finding.
    const low = finding({ kind: "isolated", severity: 2, effort: "one-click", score: 0 });
    const high = { ...low, score: 1e9 };

    // The score orders them, in the right direction.
    expect(compareFindings(high, low)).toBeLessThan(0);
    expect(compareFindings(low, high)).toBeGreaterThan(0);

    // But it cannot buy a win against a more severe finding...
    const severe = finding({ kind: "single-point-of-failure", severity: 3, effort: "one-click", score: 0 });
    expect(compareFindings(severe, high)).toBeLessThan(0);

    // ...nor against a cheaper one at the same severity.
    const cheap = finding({ kind: "isolated", severity: 2, effort: "one-click", score: 0 });
    const expensive = finding({ kind: "isolated", severity: 2, effort: "write", score: 1e9 });
    expect(compareFindings(cheap, expensive)).toBeLessThan(0);
  });

  it("orders deterministically when everything else is equal", () => {
    const first = finding({ kind: "isolated", nodeId: "b", analyser: "beta" });
    const second = finding({ kind: "isolated", nodeId: "a", analyser: "alpha" });

    const one = rankFindings([first, second], new Map()).ranked.map((entry) => entry.key);
    const two = rankFindings([second, first], new Map()).ranked.map((entry) => entry.key);
    expect(one).toEqual(two);
  });

  it("drops an analyser's weakest findings, not whichever arrived last", () => {
    const findings = [
      finding({ kind: "isolated", nodeId: "weak", analyser: "gaps", score: 0.1 }),
      finding({ kind: "isolated", nodeId: "strong", analyser: "gaps", score: 0.9 }),
      finding({ kind: "isolated", nodeId: "middle", analyser: "gaps", score: 0.5 }),
    ];
    const caps = capsFrom([{ id: "gaps", cap: 2 }]);

    const { ranked, droppedByCap } = rankFindings(findings, caps);

    expect(ranked.map((entry) => entry.key)).toEqual([
      documentFindingKey("isolated", "strong"),
      documentFindingKey("isolated", "middle"),
    ]);
    expect(droppedByCap).toBe(1);
  });

  it("stops one analyser from taking the whole panel", () => {
    const chatty = Array.from({ length: 6 }, (_, index) =>
      finding({ kind: "isolated", nodeId: `chatty-${index}`, analyser: "gaps", score: 0.9 - index * 0.1 }),
    );
    const quiet = finding({ kind: "existing-link", nodeId: "quiet", analyser: "connections", score: 0.1 });
    const caps = capsFrom([
      { id: "gaps", cap: 2 },
      { id: "connections", cap: 6 },
    ]);

    const { ranked } = rankFindings([...chatty, quiet], caps);

    expect(ranked.filter((entry) => entry.analyser === "gaps")).toHaveLength(2);
    // The quiet analyser is not starved by the chatty one.
    expect(ranked.some((entry) => entry.analyser === "connections")).toBe(true);
  });

  it("honours the weak-confidence filter only when asked", () => {
    const weak: Finding = { ...finding({ kind: "isolated" }), confidence: "weak" };
    const strong: Finding = { ...finding({ kind: "isolated", nodeId: "other" }), confidence: "strong" };

    expect(rankFindings([weak, strong], new Map()).ranked).toHaveLength(2);
    expect(rankFindings([weak, strong], new Map(), { dropWeak: true }).ranked).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Bundling
// ---------------------------------------------------------------------------

describe("bundling", () => {
  function bundleOf(findings: readonly Finding[], _dismissed: string[] = []): InsightBundle {
    // `_dismissed` is accepted and ignored on purpose: the bundle no longer splits
    // on dismissal, so a caller passing a key set must see the same bundle. The
    // dismissal tests below assert that directly.
    return buildBundle(findings);
  }

  it("groups findings into their declared sections, in the declared order", () => {
    const bundle = bundleOf([
      finding({ kind: "isolated", analyser: "gaps" }),
      finding({ kind: "single-point-of-failure", analyser: "structure" }),
      finding({ kind: "missing-link", analyser: "links" }),
    ]);

    expect(bundle.sections.map((section) => section.id)).toEqual([
      "suggested",
      "structure",
      "gaps",
    ]);
  });

  it("omits a section with nothing in it, rather than emitting an empty tab", () => {
    const bundle = bundleOf([finding({ kind: "isolated" })]);

    expect(bundle.sections.map((section) => section.id)).toEqual(["gaps"]);
    expect(bundle.sections[0]?.findings).toHaveLength(1);
  });

  it("keeps every finding in the bundle, dismissed included", () => {
    // The bundle is cached while a dismissal only writes settings, so splitting on
    // dismissal here froze it: the click stored the key, re-rendered, and the card
    // stayed because the cached bundle still classified it as visible. The split is
    // `visibleFindings` / `visibleSections`, applied by the panel against live state.
    const target = finding({ kind: "isolated", analyser: "gaps" });
    const other = finding({ kind: "isolated", analyser: "gaps", nodeId: "other" });

    const bundle = bundleOf([target, other], [target.key]);

    const section = bundle.sections.find((entry) => entry.id === "gaps");
    expect(section?.findings.map((entry) => entry.key)).toEqual([target.key, other.key]);
    expect(bundle.findings).toHaveLength(2);
    // The legacy field stays on the shape but carries nothing.
    expect(section?.dismissed).toEqual([]);
  });

  it("hides a dismissed finding at read time, and restores it from the same bundle", () => {
    const target = finding({ kind: "isolated", analyser: "gaps" });
    const other = finding({ kind: "isolated", analyser: "gaps", nodeId: "other" });
    const bundle = bundleOf([target, other]);

    const dismissed = new Set([target.key]);
    expect(visibleFindings(bundle, dismissed).map((entry) => entry.key)).toEqual([other.key]);
    expect(countUndismissed(bundle, dismissed)).toBe(1);
    expect(visibleSections(bundle, dismissed, false).map((section) => section.id)).toEqual(["gaps"]);

    // Restoring is the same bundle read with an empty set — no rebuild involved.
    expect(countUndismissed(bundle, new Set())).toBe(2);
    expect(visibleFindings(bundle, new Set())).toHaveLength(2);
  });

  it("offers no section at all once every card in it is dismissed", () => {
    const only = finding({ kind: "isolated", analyser: "gaps" });
    const bundle = bundleOf([only]);
    const dismissed = new Set([only.key]);

    // With showDismissed off the section would be a tab opening onto nothing.
    expect(visibleSections(bundle, dismissed, false)).toEqual([]);
    // With it on, the section comes back so the dismissal can be undone.
    expect(visibleSections(bundle, dismissed, true).map((section) => section.id)).toEqual(["gaps"]);
  });

  it("reports every finding as changed on a first build, and none when nothing moved", () => {
    const findings = [finding({ kind: "isolated" }), finding({ kind: "sparse", nodeId: "head" })];

    const first = bundleOf(findings);
    expect(first.changed).toHaveLength(2);

    const second = buildBundle(findings, { previous: first });
    expect(second.changed).toHaveLength(0);
  });

  it("reports a finding as changed when its evidence moved but its key did not", () => {
    const before = [finding({ kind: "sparse", nodeId: "head" })];
    const first = bundleOf(before);

    const after: Finding[] = [
      {
        ...before[0]!,
        evidence: [
          { kind: "community", labelKey: "reason.evidence.community", params: {}, contribution: 3 },
        ],
      },
    ];
    const second = buildBundle(after, { previous: first });

    expect(after[0]!.key).toBe(before[0]!.key);
    expect(second.changed).toHaveLength(1);
  });

  it("falls back to the first populated section", () => {
    expect(firstSectionId(bundleOf([finding({ kind: "missing-link" })]))).toBe("suggested");
    expect(firstSectionId(bundleOf([]))).toBeUndefined();
  });

  it("carries the cap count through for diagnostics", () => {
    const bundle = buildBundle([], { droppedByCap: 7 });
    expect(bundle.droppedByCap).toBe(7);
  });
});
