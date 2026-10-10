/**
 * Grouping ranked findings into the panel's sections.
 *
 * The shipped panel hard-coded its two groups in the view module, and both panel
 * hosts plus the badge counter each had their own copy of the group list. Adding a
 * third group therefore meant editing five places in two packages. Sections are
 * derived here instead, from the ranked findings themselves, so the panel draws
 * whatever the engine declares and a new analyser produces a new group without
 * touching the view.
 *
 * Dismissal is applied here rather than in the panel for the same reason: it is a
 * property of the bundle ("what is still worth showing"), not of the DOM.
 */

import {
  fingerprintFinding,
  INSIGHT_SECTIONS,
  SECTION_ICONS,
  SECTION_LABEL_KEYS,
  FINDING_SECTION,
  type Finding,
  type InsightBundle,
  type InsightSection,
  type InsightSectionId,
} from "./model";

export interface BundleOptions {
  /** Keys the user has marked as seen. */
  readonly dismissed?: ReadonlySet<string>;
  /** Findings from the previous analysis, for "new since last visit". */
  readonly previous?: InsightBundle;
  readonly droppedByCap?: number;
  readonly now?: number;
}

/**
 * Build the bundle the panel renders.
 *
 * **The bundle holds every finding, dismissed or not.** Dismissal is applied when
 * the panel draws, against the caller's *current* key set.
 *
 * That is a correction, not a preference. The bundle is cached — the graph and its
 * analysis survive until something asks for a rebuild — while a dismissal is a
 * settings write that does not rebuild anything. Splitting on dismissal here
 * therefore froze it at build time: clicking dismiss stored the key, re-rendered,
 * and the card stayed, because the cached bundle still classified it as visible.
 * A view filter has to be derived from live state, so it is.
 *
 * A section with nothing in it is still omitted, so the panel cannot offer a tab
 * that opens onto nothing.
 */
export function buildBundle(
  ranked: readonly Finding[],
  options: BundleOptions = {},
): InsightBundle {
  const bySection = new Map<InsightSectionId, Finding[]>();
  for (const id of INSIGHT_SECTIONS) bySection.set(id, []);

  for (const finding of ranked) {
    const bucket = bySection.get(FINDING_SECTION[finding.kind]);
    if (!bucket) continue;
    bucket.push(finding);
  }

  const sections: InsightSection[] = [];
  for (const id of INSIGHT_SECTIONS) {
    const findings = bySection.get(id);
    if (!findings || findings.length === 0) continue;
    sections.push({
      id,
      labelKey: SECTION_LABEL_KEYS[id],
      icon: SECTION_ICONS[id],
      findings,
      // Legacy of the build-time split: kept on the shape so a consumer written
      // against it does not break, always empty because the split is live now.
      dismissed: [],
    });
  }

  const previousFingerprints = new Map<string, string>();
  for (const finding of options.previous?.findings ?? []) {
    previousFingerprints.set(finding.key, fingerprintFinding(finding));
  }
  // "Changed" rather than "added": a finding whose evidence moved is as much news
  // as one that appeared, and a cluster that gained four notes is the case a user
  // most wants flagged.
  const changed = ranked.filter((finding) => {
    const before = previousFingerprints.get(finding.key);
    return before === undefined || before !== fingerprintFinding(finding);
  });

  return Object.freeze({
    findings: Object.freeze([...ranked]),
    sections: Object.freeze(sections),
    changed: Object.freeze(changed),
    builtAt: options.now ?? Date.now(),
    droppedByCap: options.droppedByCap ?? 0,
  });
}

/**
 * The findings a caller should draw, given which keys the user has dismissed.
 *
 * One definition of "visible", used by the panel and by the badge counter, so the
 * number on the toolbar can never disagree with the number of cards on screen.
 */
export function visibleFindings(
  bundle: InsightBundle,
  dismissed: ReadonlySet<string>,
): Finding[] {
  return bundle.findings.filter((finding) => !dismissed.has(finding.key));
}

/** Undismissed finding count, for the toolbar badge. */
export function countUndismissed(
  bundle: InsightBundle,
  dismissed: ReadonlySet<string> = EMPTY_SET,
): number {
  return visibleFindings(bundle, dismissed).length;
}

/** The sections that still have something to draw. */
export function visibleSections(
  bundle: InsightBundle,
  dismissed: ReadonlySet<string>,
  showDismissed: boolean,
): InsightSection[] {
  if (showDismissed) return [...bundle.sections];
  return bundle.sections.filter((section) =>
    section.findings.some((finding) => !dismissed.has(finding.key)),
  );
}

/** The section a panel should fall back to when the chosen one has nothing. */
export function firstSectionId(bundle: InsightBundle): InsightSectionId | undefined {
  return bundle.sections[0]?.id;
}

/** Whether the bundle has a section with that id. */
export function hasSection(bundle: InsightBundle, id: InsightSectionId): boolean {
  return bundle.sections.some((section) => section.id === id);
}

const EMPTY_SET: ReadonlySet<string> = new Set();
