/**
 * The finding model — one shape for everything the insight engine observes.
 *
 * Why this exists: the engine previously produced two bespoke arrays
 * (`connections` and `gaps`) with their own fields, their own dismiss-key rules
 * and their own rendering. Every new kind of insight therefore meant touching the
 * ranker, the panel, both panel hosts, the badge counter and the report. A single
 * `Finding` shape makes "add an analyser" a new file instead of a refactor.
 *
 * Three rules hold for everything in this module:
 *
 *  1. **No sentence is built here.** A finding carries a message key and its
 *     parameters; the view renders it with `t()`. `core/**` cannot import the
 *     runtime `i18n` module (it is a leaf that imports nothing), and hard-coded
 *     Chinese in the engine is why the existing gap cards are Chinese-only for
 *     English users even though `gap.*` translations exist.
 *  2. **A finding names its evidence.** `Evidence.nodeIds` carries the concrete
 *     pages a claim rests on, so a card can show "shares the rare neighbour
 *     [[X]] (degree 4)" instead of an opaque score the reader has to trust.
 *  3. **`score` is absolute, not a percentile.** See the note on the field.
 *
 * This module is pure vocabulary: types plus the key builders. It imports only a
 * type, so it stays a leaf in the dependency graph like `types.ts`.
 */

import type { MessageKey } from "../../i18n";

// ---------------------------------------------------------------------------
// Kinds and sections
// ---------------------------------------------------------------------------

/**
 * Every kind of finding the engine can produce.
 *
 * Kept as a union rather than a string so a for-purpose switch over it can be
 * exhaustive, and so `FINDING_SECTION` below fails to compile when a kind is
 * added without a home.
 */
export type FindingKind =
  // Connections: whether two pages belong together.
  | "existing-link"
  | "missing-link"
  | "unlinked-mention"
  | "merge-candidate"
  // Structure: what the graph would lose if a page changed.
  | "single-point-of-failure"
  | "cluster-gateway"
  | "underlinked-hub"
  | "brokerage"
  // Gaps: what is connected too little.
  | "isolated"
  | "sparse"
  | "bridge"
  // Trends: what is changing over time.
  | "orphan-aging"
  | "stale-hub"
  | "emerging-topic"
  | "fading-topic";

/**
 * The panel's groups, in the order they are offered.
 *
 * `suggested` and `structure` are new; `gaps` and `trends` keep the existing
 * meaning. The ids are the wire format for persisted panel state, so they are
 * stable strings rather than numbers.
 */
export type InsightSectionId = "suggested" | "structure" | "gaps" | "trends";

export const INSIGHT_SECTIONS: readonly InsightSectionId[] = [
  "suggested",
  "structure",
  "gaps",
  "trends",
];

/** Section label keys, so the panel does not carry its own copy of the list. */
export const SECTION_LABEL_KEYS: Readonly<Record<InsightSectionId, MessageKey>> = {
  suggested: "insights.section.suggested",
  structure: "insights.section.structure",
  gaps: "insights.section.gaps",
  trends: "insights.section.trends",
};

/** Section icons, matching the names Obsidian's `setIcon` understands. */
export const SECTION_ICONS: Readonly<Record<InsightSectionId, string>> = {
  suggested: "link-2",
  structure: "git-fork",
  gaps: "alert-triangle",
  trends: "trending-up",
};

/**
 * Which group each kind belongs to.
 *
 * Exhaustive on purpose: adding a kind without deciding where it belongs is a
 * compile error, not a finding that silently never appears in the panel.
 */
export const FINDING_SECTION: Readonly<Record<FindingKind, InsightSectionId>> = {
  "existing-link": "suggested",
  "missing-link": "suggested",
  "unlinked-mention": "suggested",
  "merge-candidate": "suggested",
  "single-point-of-failure": "structure",
  "cluster-gateway": "structure",
  "underlinked-hub": "structure",
  brokerage: "structure",
  isolated: "gaps",
  sparse: "gaps",
  bridge: "gaps",
  "orphan-aging": "trends",
  "stale-hub": "trends",
  "emerging-topic": "trends",
  "fading-topic": "trends",
};

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * The kinds of evidence a card can cite.
 *
 * Deliberately a closed set: each one has a translation and a rendering rule, so
 * a new signal cannot ship an unexplained label.
 */
export type EvidenceKind =
  | "shared-neighbour"
  | "shared-source"
  | "mention"
  | "community"
  | "type"
  | "degree"
  | "cut-vertex"
  | "bridge-edge"
  | "core-number"
  | "constraint"
  | "age"
  | "staleness"
  | "burst";

/**
 * One supporting fact, ordered by contribution within a finding.
 *
 * `contribution` is the weighted amount the signal added to the finding's score.
 * It is what puts the list in order and what sizes the evidence bars, so the two
 * ends can never disagree about which fact mattered most.
 */
export interface Evidence {
  readonly kind: EvidenceKind;
  readonly labelKey: MessageKey;
  readonly params: Readonly<Record<string, string | number>>;
  readonly contribution: number;
  /**
   * The concrete pages this fact rests on, in the order they should be read.
   *
   * A card shows these by name. "3 shared notes: A, B, C" is checkable in
   * seconds; "Adamic-Adar 2.4" is not, and asking a reader to trust an opaque
   * number is how a panel loses their attention.
   */
  readonly nodeIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * How strong the evidence is.
 *
 * Absolute, never a percentile of the current vault: a percentile cut guarantees
 * that every vault has a "strong" card — including one with no structure at all —
 * and it would contradict the cold-start rule that an analyser must be able to
 * return nothing. `weak` is therefore a legal, and possibly empty, outcome.
 */
export type Confidence = "strong" | "moderate" | "weak";

/**
 * How much work acting on the card is. Drives the severity ÷ effort ordering,
 * because "add one link" is a two-second action and "this theme is fragmenting"
 * is an afternoon; mixing them in one score-ordered list is what makes a panel
 * feel like noise.
 */
export type Effort = "one-click" | "edit" | "write";

/** 1 = cosmetic, 3 = breaks retrieval. */
export type Severity = 1 | 2 | 3;

export interface FocusTargets {
  /** Node ids the card asks the graph to emphasise. Must exist in the graph. */
  readonly nodeIds: readonly string[];
  /** Edge keys to light, for findings that are about a connection. */
  readonly edgeKeys: readonly string[];
}

/**
 * What the user can do about a finding.
 *
 * Carried as data so the engine stays free of I/O: the view performs the action,
 * which keeps "what to suggest" and "how to write to a vault" independently
 * testable — and keeps `core/**` pure.
 */
export type InsightAction =
  | {
      readonly kind: "insert-wikilink";
      /** Note the link text is inserted into. */
      readonly sourceId: string;
      /** Note being linked to. */
      readonly targetId: string;
      /** Exact text to insert, so the preview and the write cannot disagree. */
      readonly text: string;
    }
  | {
      readonly kind: "open-notes";
      readonly nodeIds: readonly string[];
    }
  | {
      readonly kind: "create-moc";
      readonly nodeIds: readonly string[];
      readonly suggestedTitle: string;
    }
  | { readonly kind: "open-report" };

export interface Finding {
  /**
   * Stable identity for dismissal.
   *
   * Built only from ids and kinds — never from rendered text, and never from the
   * full member list of a group. See {@link documentFindingKey},
   * {@link pairFindingKey} and {@link groupFindingKey} for the three shapes and
   * what each promises across a rebuild.
   */
  readonly key: string;
  readonly kind: FindingKind;
  /** Which analyser produced it. Used for caps, filters and per-analyser telemetry. */
  readonly analyser: string;
  readonly titleKey: MessageKey;
  readonly titleParams: Readonly<Record<string, string | number>>;
  /** Ordered strongest-first; a card renders the first two or three. */
  readonly evidence: readonly Evidence[];
  readonly anchors: FocusTargets;
  /**
   * 0…1, on an absolute scale fixed offline and shipped as constants — **not** a
   * per-vault percentile.
   *
   * Two reasons: diversification runs across analysers and needs comparable
   * units, otherwise whichever analyser has the widest internal spread takes the
   * whole panel; and a percentile cut cannot express "nothing here is worth
   * showing", which the cold-start rule requires.
   */
  readonly score: number;
  readonly confidence: Confidence;
  readonly severity: Severity;
  readonly effort: Effort;
  readonly action?: InsightAction;
  /**
   * Extra facts a specific kind needs to render or to act.
   *
   * Kept per-kind rather than as one wide optional bag so a reader can tell which
   * kinds carry which data.
   */
  readonly detail?: FindingDetail;
}

/** Per-kind extras. Only the kinds that need them appear here. */
export type FindingDetail =
  | { readonly kind: "sparse"; readonly nodeCount: number; readonly cohesion: number; readonly meanIntraDegree: number }
  | { readonly kind: "bridge"; readonly clusterCount: number }
  | { readonly kind: "existing-link"; readonly weight: number; readonly hasDirectLink: boolean }
  | { readonly kind: "orphan-aging"; readonly ageDays: number }
  | { readonly kind: "stale-hub"; readonly staleDays: number; readonly degree: number };

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/** One group's cards on screen, plus what the tab should say. */
export interface InsightSection {
  readonly id: InsightSectionId;
  readonly labelKey: MessageKey;
  readonly icon: string;
  /** Undismissed cards in this section, already ranked and capped. */
  readonly findings: readonly Finding[];
  /** Findings the user has dismissed, when the caller asks to see them. */
  readonly dismissed: readonly Finding[];
}

/**
 * Everything one analysis pass produced.
 *
 * `findings` is the flat ranked list the panel draws from; `sections` is the
 * grouping derived from it, so both panel hosts and the badge counter read the
 * same structure instead of each hard-coding the group list.
 */
export interface InsightBundle {
  readonly findings: readonly Finding[];
  readonly sections: readonly InsightSection[];
  /** Findings whose content changed since the previous build, for "new since last visit". */
  readonly changed: readonly Finding[];
  readonly builtAt: number;
  /** How many findings were dropped by the per-analyser caps, for diagnostics. */
  readonly droppedByCap: number;
}

export const EMPTY_BUNDLE: InsightBundle = Object.freeze({
  findings: [],
  sections: [],
  changed: [],
  builtAt: 0,
  droppedByCap: 0,
});

// ---------------------------------------------------------------------------
// Dismissal keys
// ---------------------------------------------------------------------------

/**
 * Keys for findings about one page: `node:<kind>:<nodeId>`.
 *
 * Dismissing a claim about a page dismisses *that claim*, so a second page
 * appearing elsewhere cannot take the dismissal with it.
 */
export function documentFindingKey(kind: FindingKind, nodeId: string): string {
  return `node:${kind}:${nodeId}`;
}

/**
 * Keys for findings about a pair: `pair:<kind>:<sorted edge key>`.
 *
 * `edgeKey` is a definition rather than a rendering, so this survives a rebuild,
 * a case change in a path and a language change.
 */
export function pairFindingKey(kind: FindingKind, a: string, b: string): string {
  return `pair:${kind}:${a < b ? `${a}:::${b}` : `${b}:::${a}`}`;
}

/**
 * Keys for findings about a set that has no natural stable identity: the cluster
 * or orphan group a card stands for.
 *
 * **Membership changed means this is a new finding.** That is a deliberate
 * semantic, not an implementation detail: a sparse cluster that gained four notes
 * is a different observation, and pretending a dismissal still applies would hide
 * a change the user asked to be told about. The plan's preferred per-item
 * behaviour for the orphan list belongs to whichever analyser emits one row per
 * page — which is `documentFindingKey`, above.
 */
export function groupFindingKey(kind: FindingKind, anchorId: string): string {
  return `group:${kind}:${anchorId}`;
}

/**
 * A short, stable digest of an arbitrary string.
 *
 * FNV-1a, 32-bit, rendered as unsigned hex. Used only where a key must stay
 * bounded — nothing security-related depends on it, and collisions would mean two
 * findings sharing a dismissal, which is recoverable by the user and never
 * corrupts data.
 */
export function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // The FNV prime, via shifts so the multiply stays in 32-bit range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Fingerprint of a finding's *content*, for "changed since last build".
 *
 * Distinct from `key`, which is identity. Two builds can produce the same
 * finding key with different evidence — a cluster gained a member, an edge gained
 * a shared source — and that is exactly the case the panel wants to flag as new.
 */
export function fingerprintFinding(finding: Finding): string {
  const evidence = finding.evidence
    .map((item) => `${item.kind}:${item.contribution.toFixed(3)}:${(item.nodeIds ?? []).join("|")}`)
    .join(";");
  return digest(`${finding.kind}\u0000${finding.titleKey}\u0000${evidence}`);
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

/**
 * Optional fields for {@link documentFinding} and {@link groupFinding}.
 *
 * `score` defaults to 0 and is expected to be set by the ranker rather than by
 * the analyser, so an analyser cannot invent a scale of its own.
 */
export interface FindingInit {
  readonly evidence: readonly Evidence[];
  readonly anchors: FocusTargets;
  readonly score?: number;
  readonly confidence?: Confidence;
  readonly severity?: Severity;
  readonly effort?: Effort;
  readonly action?: InsightAction;
  readonly detail?: FindingDetail;
}

function baseFinding(
  key: string,
  kind: FindingKind,
  analyser: string,
  titleKey: MessageKey,
  titleParams: Readonly<Record<string, string | number>>,
  init: FindingInit,
): Finding {
  return Object.freeze({
    key,
    kind,
    analyser,
    titleKey,
    titleParams,
    evidence: Object.freeze([...init.evidence].sort((a, b) => b.contribution - a.contribution)),
    anchors: Object.freeze({
      nodeIds: Object.freeze([...init.anchors.nodeIds]),
      edgeKeys: Object.freeze([...init.anchors.edgeKeys]),
    }),
    score: init.score ?? 0,
    confidence: init.confidence ?? "moderate",
    severity: init.severity ?? 2,
    effort: init.effort ?? "one-click",
    ...(init.action ? { action: init.action } : {}),
    ...(init.detail ? { detail: init.detail } : {}),
  });
}

/**
 * A finding about one page.
 *
 * `severity` and `effort` are required here rather than defaulted: both drive the
 * ordering, and a silent default would put a card in the wrong place without
 * anyone noticing.
 */
export function documentFinding(params: {
  kind: FindingKind;
  analyser: string;
  nodeId: string;
  titleKey: MessageKey;
  titleParams?: Readonly<Record<string, string | number>>;
  severity: Severity;
  effort: Effort;
  init: FindingInit;
}): Finding {
  return baseFinding(
    documentFindingKey(params.kind, params.nodeId),
    params.kind,
    params.analyser,
    params.titleKey,
    params.titleParams ?? {},
    { ...params.init, severity: params.severity, effort: params.effort },
  );
}

/** A finding about a pair of pages. */
export function pairFinding(params: {
  kind: FindingKind;
  analyser: string;
  a: string;
  b: string;
  titleKey: MessageKey;
  titleParams?: Readonly<Record<string, string | number>>;
  init: FindingInit;
}): Finding {
  return baseFinding(
    pairFindingKey(params.kind, params.a, params.b),
    params.kind,
    params.analyser,
    params.titleKey,
    params.titleParams ?? {},
    params.init,
  );
}

/**
 * A finding about a group, anchored on one page.
 *
 * The anchor must be a real node id and must be the page the card is *about* —
 * for a sparse cluster that is its highest-weighted member, which is already how
 * the community engine picks the name.
 */
export function groupFinding(params: {
  kind: FindingKind;
  analyser: string;
  anchorId: string;
  titleKey: MessageKey;
  titleParams?: Readonly<Record<string, string | number>>;
  init: FindingInit;
}): Finding {
  return baseFinding(
    groupFindingKey(params.kind, params.anchorId),
    params.kind,
    params.analyser,
    params.titleKey,
    params.titleParams ?? {},
    params.init,
  );
}
