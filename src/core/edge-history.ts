/**
 * The edge history: when each link between two notes was first seen.
 *
 * Written before it was needed, deliberately, because its value compounds and cannot
 * be recovered. A vault's frontmatter records when a *note* changed, never when a
 * *link* appeared — so without a snapshot taken now, "which links did I add this
 * month" is unanswerable forever, and so is every temporal insight built on it.
 *
 * Two jobs, and the second is the one that matters most:
 *
 *  1. **Counting** — link velocity and burst detection over time.
 *  2. **Negatives.** A pair that scored high at time *T* and was still not linked at
 *     *T + Δ* is a *deliberate non-link*, and it is the only negative class that can
 *     measure the failure mode the plan's §8.2 names: a ranking that prefers the pairs
 *     a user has already considered. A held-out-link protocol is structurally blind to
 *     that class, because a deliberate non-link is never in the positive set.
 *
 * The format is one JSON object per line, append-only, which survives a crash
 * mid-write and can be read incrementally. Nothing here does I/O: the caller reads and
 * writes the string, so the engine stays testable and pure.
 */

import { edgeKey } from "./graph-keys";

/** One recorded link. */
export interface HistoryRecord {
  /** `edgeKey` of the pair. */
  readonly key: string;
  /** Epoch milliseconds the pair was first seen. */
  readonly firstSeen: number;
  /** Epoch milliseconds it was last seen, refreshed on each observation. */
  readonly lastSeen: number;
}

export interface EdgeHistory {
  readonly records: ReadonlyMap<string, HistoryRecord>;
}

export const EMPTY_HISTORY: EdgeHistory = Object.freeze({ records: new Map() });

/**
 * Parse a JSONL history file.
 *
 * Tolerant on purpose: a truncated last line is the expected shape of a crash during
 * an append, and one unreadable line must not cost the whole history — that would
 * throw away the only copy of information that cannot be reconstructed.
 */
export function parseEdgeHistory(text: string): EdgeHistory {
  const records = new Map<string, HistoryRecord>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<HistoryRecord>;
      if (typeof parsed.key !== "string" || typeof parsed.firstSeen !== "number") continue;
      records.set(parsed.key, {
        key: parsed.key,
        firstSeen: parsed.firstSeen,
        lastSeen: typeof parsed.lastSeen === "number" ? parsed.lastSeen : parsed.firstSeen,
      });
    } catch {
      // A half-written line, or a hand edit. Skip it and keep the rest.
      continue;
    }
  }
  return { records };
}

export interface ObserveResult {
  /** The history with this build's pairs merged in. */
  readonly history: EdgeHistory;
  /** Only the lines that need appending, so the file grows by the delta. */
  readonly appended: readonly string[];
  /** Pairs seen for the first time in this build. */
  readonly discovered: number;
}

/**
 * Fold one build's edges into the history.
 *
 * Returns the lines to append rather than the whole history, so the file grows by the
 * delta and a large vault does not rewrite its own history on every save. `firstSeen`
 * is never moved once set: the whole point is when the link appeared, not when it was
 * last rebuilt.
 */
export function observeEdges(
  history: EdgeHistory,
  edges: readonly { readonly source: string; readonly target: string }[],
  now: number,
): ObserveResult {
  const records = new Map(history.records);
  const appended: string[] = [];
  let discovered = 0;

  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const key = edgeKey(edge.source, edge.target);
    const existing = records.get(key);
    if (existing) {
      records.set(key, { ...existing, lastSeen: now });
      continue;
    }
    const record: HistoryRecord = { key, firstSeen: now, lastSeen: now };
    records.set(key, record);
    appended.push(JSON.stringify(record));
    discovered += 1;
  }

  return { history: { records }, appended, discovered };
}

/** Pairs first seen at or after `since`. Link velocity, and the basis of a burst. */
export function linksSince(history: EdgeHistory, since: number): HistoryRecord[] {
  return [...history.records.values()].filter((record) => record.firstSeen >= since);
}

/**
 * Bucket first-seen timestamps into a count series.
 *
 * The input burst detection wants. `buckets` is how many windows to produce, ending at
 * `now`, so the series is anchored to the present and a burst is always recent — a
 * series that ended last year would report a burst nobody can act on.
 */
export function firstSeenSeries(
  history: EdgeHistory,
  now: number,
  buckets: number,
  windowMs: number,
): number[] {
  const series = new Array<number>(buckets).fill(0);
  const start = now - buckets * windowMs;
  for (const record of history.records.values()) {
    if (record.firstSeen < start || record.firstSeen > now) continue;
    const index = Math.min(buckets - 1, Math.floor((record.firstSeen - start) / windowMs));
    if (index < 0) continue;
    series[index] = (series[index] ?? 0) + 1;
  }
  return series;
}

/**
 * Pairs that a scorer ranked highly and which were never linked.
 *
 * The negative class §8.2 needs: `rank` supplies a pair and a score, `history` says
 * whether the pair has ever been a link, and the result is the pairs a user has had
 * the chance to link and chosen not to. Time-bounded by `settledBefore` so a pair
 * that simply has not come up yet is not counted as a rejection.
 */
export function deliberateNonLinks(
  candidates: readonly { readonly key: string; readonly score: number }[],
  history: EdgeHistory,
  settledBefore: number,
  minScore: number,
): Array<{ key: string; score: number }> {
  const out: Array<{ key: string; score: number }> = [];
  for (const candidate of candidates) {
    if (candidate.score < minScore) continue;
    const record = history.records.get(candidate.key);
    // Never linked at all, and the vault is old enough for that to mean something:
    // the history has to have been running before the candidate was settled.
    if (record !== undefined) continue;
    if (!hasHistoryBefore(history, settledBefore)) continue;
    out.push(candidate);
  }
  out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  return out;
}

/** Whether the history was already running at `when`, so absence means rejection. */
function hasHistoryBefore(history: EdgeHistory, when: number): boolean {
  for (const record of history.records.values()) {
    if (record.firstSeen <= when) return true;
  }
  return false;
}
