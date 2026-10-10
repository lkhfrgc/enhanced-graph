# 图谱洞察改进方案 / Graph Insights: improvement plan

Status: proposal, revised after review. **Phases 0 and 1 are implemented** — see
§12 for what shipped and the evidence for each acceptance criterion. Phases 2–7
are not started. Nothing has been released.

Baseline measured 2026-10-10 on a real 80-note vault.

A review of the first revision (`docs/graph-insights-plan-review.md`) found that its
diagnosis and phasing held up but its **measurement layer did not**: one quoted number
was an unlabelled iteration sum, the protocol was stated two ways, the primary metric was
measured against the wrong objective, and the Phase 2 gate was passable while the feature
silently lost most of the links it exists to find. This revision fixes those. §3.3 lists
what changed and what it cost.

Every number below now comes from a command in this repository. The one that produced
the ranking table is `scripts/insight-eval.ts`, committed for exactly this reason.

---

## 1. What "insight" has to mean here

The feature is judged by whether a reader can **act** on a card, not by whether the
metric behind it is interesting. Every insight must satisfy three tests:

1. **Falsifiable** — it names specific notes and specific evidence, so the user can
   check it in a few seconds. "A and B share the rare neighbour `[[X]]`" passes;
   "this cluster has low cohesion" does not.
2. **Actionable** — there is a concrete next step: add a link, split a note, revisit
   a stale hub, merge two notes. An insight with no action is a statistic.
3. **Non-obvious** — the user could not have seen it by looking at the graph.

Test 3 is the hard one, and §8 explains why the obvious metric for it does not measure
it. Insight fatigue is the failure mode: a dismissal rate that climbs until the panel is
ignored.

---

## 2. Scope decisions for this round

Established while writing this plan, so the rest of it can be read correctly:

- **Arrow A — the feature can only rank links that already exist.** `rankUnexpectedLinks`
  iterates `graph.edges` (`src/core/insights.ts:116`), so a "surprising connection" is
  always a `[[wikilink]]` the user already wrote. Verified in §3.2: 100 % of its output
  is an existing link.
- **Arrow B — the graph carries no text and no time.** `GraphNode` has no body, word
  count or timestamp (`src/types.ts:45-79`), and `ParsedNote` drops the body after
  parsing (`src/core/parse.ts:12-30`). So content signals, unlinked mentions and every
  temporal insight are impossible without a data-model change.
- **Arrow C — the analysis is a build step.** `analyzeGraph` runs once inside the build
  closure, synchronously, on the UI thread (`src/main.ts:487`). There is no worker, no
  incremental path, and `getGraph()` is not actually a cache — `buildPromise` is cleared
  in a `finally` (`src/main.ts:493-499`), so one file save costs N+1 full builds for N
  open views. **Every new analyser multiplies by that factor.** This is the single
  biggest structural obstacle, and it is why §6's debt work is a prerequisite for the
  later phases of §5 rather than a follow-up.
- **Arrow D — the engine cannot reach i18n.** No `core/**` module imports `i18n`, and
  `i18n.ts` must stay import-free (`test/architecture.test.ts:209-218`). The engine
  therefore hard-codes Chinese, which is why `gap.*` keys exist but are dead
  (`src/i18n.ts:79-88`) and an English user already sees Chinese gap cards.
- **Arrow E — dismissal keys embed rendered text and every member id**
  (`gap:${type}:${title}:${nodeIds.join(",")}`, `src/core/insights.ts:310-312`), and
  nothing ever garbage-collects them. One new orphan invalidates and orphans the key of
  the whole card, and the setting grows forever.

Constraints that any new code must respect (`test/architecture.test.ts`): `core/**` may
not import `obsidian` or `sigma`; `view/**` may not import `integrate/**`; no runtime or
type-only import cycles; `types.ts` and `i18n.ts` import nothing; third-party packages
stay confined to one module each.

---

## 3. Where it stands today

### 3.1 Baseline

| Check | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `node node_modules/vitest/vitest.mjs run` | 18 files, **565 tests passed** |
| Real vault (`插件开发/插件开发`) | 80 notes, 420 edges, 6 communities, max degree 55 |
| `analyzeGraph` runtime, that vault | ~2 ms (the review measured 0.33 ms as a mean of 50 runs; immaterial either way) |
| `npm run eval:insights` | runs; numbers in §3.2 |

Both commands were run for this document. `npm run verify` was **not** run — the browser
harness and vault-copy steps are untouched by a plan-only change.

Note: `npm`/`npx` shims are blocked by this machine's PowerShell execution policy; invoke
`node node_modules/<tool>/...` directly.

### 3.2 The measured problem

**Run this to reproduce every number in this section:**

```
node node_modules/esbuild/bin/esbuild scripts/insight-eval.ts --bundle \
  --platform=node --format=cjs --outfile=scripts/insight-eval.cjs
node scripts/insight-eval.cjs 'D:\Progect\插件开发\插件开发'
```

`scripts/insight-eval.ts` is the probe the first revision of this plan described but did
not commit. It prints its own protocol, so a number can never again be quoted without its
method. **Protocol:** seed 20261010, 20 trials, **40 hidden links per trial** (an absolute
count, deliberately not a percentage — see §3.3), candidates = 2-hop pairs excluding
structural endpoints, K = 1/3/6/10/20.

Vault as measured: 80 notes, 420 edges, 6 communities, max degree 55.

```
=== candidate pool ===
pool size:        mean 1258
pool iterations:  mean 6602   (a pair recurs once per shared neighbour)
coverage:         92.9 % of held-out links are in the pool
positive rate:    2.95 % of the pool

=== precision@K (mean over 20 trials, hidden = 40) ===
method                         P@1     P@3     P@6    P@10    P@20    recall@6     AUC
---------------------------------------------------------------------------------------
AA + tags                    60.0%   50.0%   37.5%   33.0%   29.5%       5.6%   0.8192
resource allocation          60.0%   50.0%   37.5%   31.5%   27.7%       5.6%   0.8141
Adamic-Adar                  60.0%   46.7%   36.7%   32.0%   29.3%       5.5%   0.8120
common neighbours            50.0%   41.7%   33.3%   30.5%   26.3%       5.0%   0.7997
preferential attachment      65.0%   45.0%   31.7%   26.5%   20.5%       4.8%   0.6862
source Jaccard               60.0%   38.3%   25.8%   16.5%   15.0%       3.9%   0.7669
tag Jaccard                  25.0%   10.0%   16.7%   18.0%   14.0%       2.5%   0.6273
random                        0.0%    1.7%    2.5%    2.0%    1.3%       0.4%   0.5000
shipped (minus weak-tie)      0.0%    0.0%    1.7%    2.5%    3.5%       0.3%   0.3755
```

**Read the `random` row before any other.** The positive rate is 2.95 %, so chance at
P@6 is 2.95 % and a real scorer's lift is about **12×**. Any pasted precision figure
without the chance line next to it is uninterpretable, which is why the harness prints it.

Paired differences, same splits and same pool, 5000-resample bootstrap:

```
Adamic-Adar − resource allocation            -0.8 pp  95% CI [-3.3,  1.7]
Adamic-Adar − common neighbours               3.3 pp  95% CI [-0.8,  6.7]
Adamic-Adar − AA + tags                      -0.8 pp  95% CI [-2.5,  0.0]
Adamic-Adar − tag Jaccard                    20.0 pp  95% CI [ 5.8, 34.2]
Adamic-Adar − shipped (minus weak-tie)       35.0 pp  95% CI [21.7, 47.5]
Adamic-Adar − random                         34.2 pp  95% CI [21.7, 46.7]
```

Three things follow, and none of them is "Adamic-Adar wins":

- **AA, RA and CN are not distinguishable on this vault.** Every CI touches or crosses
  zero. Adopting AA as the default is defensible on *explainability* — it is the one users
  can be told in words — and on nothing else. Choose it and say why.
- **Adding tags does not help** (`AA + tags` is 0.8 pp *worse*, CI [-2.5, 0.0]). Tags are
  not a free win; `tag Jaccard` alone at 16.7 % P@6 is far below every link index. Keep
  tags as an evidence line and re-measure before making them a weight.
- **The shipped score is anti-predictive on candidate pairs** (AUC 0.3755, P@6 1.7 %,
  below the 2.5 % random baseline). That is not a defect: a *surprise* score should rank
  unlikely pairs highly. It is a confirmation that the current feature was designed to do
  a different job from link prediction — which is exactly why §5 needs two products.

Ties are deciding real comparisons. Tie mass at the K = 6 boundary: AA 1.0, RA 1.0,
CN 3.6, tag Jaccard 3.4, source Jaccard 10.2, shipped 7.9, random 1258. **A 2–3 pp margin
involving common neighbours is below this metric's resolution** — 3.6 candidates share the
boundary score, so which ones land in the top 6 is partly sort order.

Two further facts that constrain the design:

- **The feature can only rank links that already exist.** Ranking all 350 pairs at
  `minScore = 0` gives 350 pairs that are all in `graph.edges`; zero proposed connections.
  Forced by the loop at `insights.ts:116`, not a tuning artefact.
- **The shipped threshold is not a filter.** On candidate pairs — where `weak-tie` cannot
  apply, because a pair with no link has no `edge.weight` — the surviving signals put
  ~77 % of candidates above `minScore = 3`. (The first revision quoted `5568/7244`; 7 244
  was an *iteration sum* over the scanner loop, not a set size, and it exceeded the vault's
  3 160 possible node pairs. §3.3.)

**What this does and does not say.** It does **not** say `rankUnexpectedLinks` is broken
at its own job: on the graph as it ships it ranks existing links, and `weak-tie` does real
work there. It says the *job* is the limitation. Two different products are needed.

**Honesty about the comparison.** The hidden-pair version of the shipped score cannot use
`weak-tie` (no edge weight exists) and sees shifted degrees, so it understates how the
score behaves on a real graph. The 35 pp gap should be read as "the shipped scoring
function is not a link predictor", not as "it is 35 pp worse at its own task". Settling
that honestly needs human relevance labels, which do not exist yet — §8.4.

### 3.3 What the review changed, and why it matters

Kept here rather than quietly fixed, because two of these were load-bearing errors and a
reader needs to know which parts of the earlier number set to discount.

| # | First revision said | What was actually true | Consequence |
|---|---|---|---|
| 1 | "76.9 % of all 7244 candidate pairs" | 7 244 was the **iteration sum** of the candidate loop (a pair recurs once per shared neighbour); the pool is ~1 258 pairs. The ratio reproduces; the absolute count never could | The threshold argument survives; the numbers as written did not. The harness now labels both quantities |
| 2 | "hide 20 % of the links" *and* "40 hidden links each" | The probe used 40 links. 20 % of 420 is 84, so the two readings differ by ~15 pp on the headline metric | Protocol now names an absolute count, and the harness prints it |
| 3 | `P@10` as the primary metric | The panel shows 6 cards per section, and precision is strongly K-dependent: P@1 60 % → P@6 36.7 % → P@10 32.0 % → P@20 29.3 % | Primary endpoint is now **P@6**. The curve is also the argument for showing *fewer* cards (§7.2) |
| 4 | Gate: "shipped scorer ≥ max(AA, RA) on P@10" | Passable by shipping AA unchanged; `max()` of two indistinguishable baselines is a noise-selected target; no interval | Gate rewritten in §9 against a single fixed baseline and the **lower bound** of a paired CI, with a coverage floor |
| 5 | "AUC alone is misleading under extreme class imbalance" | The positive rate is 2.95 % — mild imbalance. AUC is prevalence-invariant by construction, so imbalance never misled it | The reason to prefer P@K is **head sensitivity**: the product consumes the top 6, and a scorer can improve AUC while making the top worse (§8.1) |
| 6 | "skip hubs above a degree cap" | The cap is redundant (AA already gives a degree-55 shared neighbour 1/log 55 ≈ 0.25, RA gives 0.018) and it **deletes recall**: measured coverage 92.9 % → 88.3 % at cap 20, and → 60.5 % at cap 10 | Cap removed; workload bounded by sampling instead (§5.3). Coverage is now a first-class metric |
| 7 | Unlinked mentions are "the highest-precision signal available" | Never measured, in a document whose thesis is "measure, do not assert". Measured now: 47 candidates / 80 notes exist, body-only; **precision still unmeasured**, so the claim is downgraded | §5.2 measures the claim before committing a phase to it |
| 8 | Synthetic planted graphs are "the only route to real statistical power" | True for **structural** claims, whose ground truth is definitional. False for a link-prediction scorer, whose target is behavioural | §8.3 now scopes the claim |
| 9 | Dismissal keys: "hash the sorted ids, so a new orphan no longer orphans the key" | A hash of the member set changes when the member set changes — identical behaviour to today. The change fixes two *other* problems (rendered title in the key, unbounded length) | Per-item keys for node-centric findings; group semantics stated explicitly (§4.3) |
| 10 | `analyzeGraph` runtime ~2 ms | 0.33 ms by the reviewer's measurement (mean of 50) | Immaterial to the plan; note it and move on |

### 3.4 Limitations, ordered by how much insight they cost

| # | Limitation | Evidence |
|---|---|---|
| L1 | Cannot propose a link that does not exist | §3.2; `insights.ts:116` |
| L2 | Blind to note text: no unlinked mentions, no titles, no aliases | `types.ts:45-79`, `parse.ts:12-30` |
| L3 | Blind to time: no created/modified, so no aging, staleness, bursts, trends | `types.ts:45-79` |
| L4 | No structural analytics: no articulation points, bridges, betweenness, k-core, conductance | `insights.ts` contains none of these primitives |
| L5 | Single flat list, no diversity control, no severity, no confidence, no "new since last visit" | `insights-panel.ts:119-140` |
| L6 | Dismissal keys unstable and never collected | `insights.ts:310-312`, `settings.ts:93-103` |
| L7 | Score is not comparable across vaults or categories (`minScore = 3`, additive hand weights) | `insights.ts:50-57`, `insights.ts:38-40` |
| L8 | No way to measure whether any change helps | no insight-quality harness |
| L9 | Dead end: a card highlights notes; it cannot insert the link it recommends | `insights-panel.ts:226-230` |
| L10 | Gap cards are Chinese-only for English users | `i18n.ts:79-88` dead keys |
| L11 | `t(\`reason.${reason}\` as never)` (`insights-panel.ts:270`) defeats the compile-time key check | new `ConnectionReason` can ship a raw key |
| L12 | A card naming a filtered-out note goes "active" while the canvas lights nothing | `graph-view.ts:1291-1302` |

---

## 4. Target architecture

One pipeline, five stages. Today only stages 1 and 5 exist, fused together.

```
graph + augmentations
      │
      ├─(1) CANDIDATE GENERATION ────────────────────────────────┐
      │      existing pairs (graph edges)                        │
      │      2-hop neighbourhood pairs (missing links)           │
      │      content-mention pairs, structural anchors           │
      │                                                          │
      ├─(2) FEATURE EXTRACTION ──────────────────────────────────┤
      │      topology: AA, RA, CN, Jaccard, degree, community    │
      │      content:  tag / source / folder / alias overlap,    │
      │                unlinked-mention presence, title tokens   │
      │      structure: cut vertex, bridge, core number,         │
      │                 constraint, (sampled) betweenness        │
      │      time:     age, staleness, burst weight              │
      │                                                          │
      ├─(3) ANALYSERS ───────────────────────────────────────────┤
      │      each consumes features + graph, returns findings    │
      │                                                          │
      ├─(4) RANKING ─────────────────────────────────────────────┤
      │      calibrate → score → de-duplicate → diversify (MMR)  │
      │      → cap per category and overall                      │
      │                                                          ▼
      └─(5) PRESENTATION ── sections, evidence, actions, dismissal,
                            "new since last visit", export
```

The three design commitments that matter:

**A. A `Finding` is the only currency.** One shape for every analyser, so ranking,
dismissal, presentation and export are written once. This is what makes "add a new
analyser" a file, not a refactor.

**B. The engine returns message keys and parameters, never sentences.** `core/**` cannot
import `i18n` (Arrow D, and `i18n.ts` must stay import-free), so a finding carries
`{ key: "gap.isolated.title", params: { count: 3 } }` and the view calls `t()`. This
deletes L10 for every new insight, and it fixes the root cause of L6: the dismiss key is
no longer derived from a rendered title.

**C. `InsightInput`, not `WikiGraph`.** New signals (content, time, previous findings)
must not be stuffed into `WikiGraph`, because `WikiGraph` is rendered verbatim, frozen,
and persisted by the harness. Findings read `graph` for anything they already need and
`augmentations` for everything new, and every augmentation is optional so existing
callers and fixtures keep working unchanged.

### 4.1 Module layout

```
src/core/
  insights/
    model.ts        Finding, FindingKind, Evidence, InsightAction, InsightBundle
    input.ts        InsightInput, GraphAugmentations, fingerprint helpers
    registry.ts     Analyser interface + the ordered analyser list
    link-prediction.ts   missing links  (uses lib/link-prediction + lib/content)
    structure.ts         cut vertices, bridges, cut size, k-core, constraint
    content.ts           unlinked mentions, merge candidates
    trend.ts             orphan aging, stale hubs, bursts
  insights.ts       unchanged public entry: analyzeGraph(graph, options) → InsightBundle
  lib/
    link-prediction.ts   AA, RA, CN, Jaccard, association strength, 2-hop candidates
    content-index.ts     title/alias matching, term index, unlinked mentions
    centrality.ts        Tarjan cut vertices/bridges, k-core, constraint, sampled betweenness
```

`src/view/insights-panel.ts` keeps its contract — pure DOM, state owned by the caller,
container never cleared — and grows data-driven sections instead of the hard-coded
`everyGroup` array at `insights-panel.ts:119-140`.

### 4.2 The finding model

```ts
/** One ranked observation. Shape is shared by every analyser. */
export interface Finding {
  /** Stable identity, independent of display text. See §4.3. */
  readonly key: string;
  readonly kind: FindingKind;
  /** Which analyser produced it — used for caps, filters and telemetry. */
  readonly analyser: string;
  /** Rendered through i18n by the view; the engine never builds a sentence. */
  readonly titleKey: MessageKeyLike;
  readonly titleParams: Readonly<Record<string, string | number>>;
  /** Ordered evidence, strongest first. The card shows the top 2–3. */
  readonly evidence: readonly Evidence[];
  /** Nodes and edges the card focuses when clicked. Clipped to the graph. */
  readonly anchors: { readonly nodeIds: readonly string[]; readonly edgeKeys: readonly string[] };
  /**
   * 0…1, on an ABSOLUTE scale fixed offline and shipped as constants — NOT a
   * per-vault percentile. Two reasons, both from the review:
   *  - MMR diversifies across analysers (§7.2), which requires comparable units;
   *    per-analyser normalisation lets whichever analyser has the widest spread
   *    own the whole panel.
   *  - A percentile cut guarantees a "strong" card in every vault, including one
   *    with no structure at all, which contradicts the cold-start gate (§5.3).
   */
  readonly score: number;
  /** `strong` | `moderate` | `weak` — an absolute band, and `weak` may be empty.
   *  A finding below the floor is not returned at all. */
  readonly confidence: "strong" | "moderate" | "weak";
  readonly severity: 1 | 2 | 3;
  /** `one-click` | `edit` | `write` — drives the severity ÷ effort ordering. */
  readonly effort: "one-click" | "edit" | "write";
  /** What the user can do, as data. Omitted when there is nothing to offer. */
  readonly action?: InsightAction;
}

export type FindingKind =
  | "missing-link" | "unlinked-mention" | "merge-candidate"   // content + topology
  | "single-point-of-failure" | "cluster-gateway"             // structure
  | "isolated" | "sparse" | "underlinked-hub"                 // gaps
  | "orphan-aging" | "stale-hub" | "emerging-topic" | "fading-topic"; // trend

export interface Evidence {
  readonly kind: "shared-neighbour" | "shared-source" | "mention" | "community"
              | "type" | "degree" | "cut-vertex" | "age" | "burst" | "tag";
  readonly labelKey: MessageKeyLike;
  readonly params: Readonly<Record<string, string | number>>;
  /** Weighted contribution, for ordering and for the bar widths. */
  readonly contribution: number;
  /** Concrete notes the claim rests on, so the user can verify it. */
  readonly nodeIds?: readonly string[];
}

export interface InsightAction {
  readonly kind: "insert-wikilink" | "open-notes" | "create-moc" | "open-report";
  /** Data the action needs; the view performs it, the engine never writes. */
  readonly payload: Readonly<Record<string, unknown>>;
}
```

`InsightBundle` replaces `GraphInsights`:

```ts
export interface InsightBundle {
  readonly findings: readonly Finding[];
  /** Analysers that ran, with their counts — the panel's section list. */
  readonly sections: readonly { id: string; count: number }[];
  /** Fingerprints of the current findings, for "new since last visit". */
  readonly fingerprint: ReadonlyMap<string, string>;
  readonly builtAt: number;
}
```

`UnexpectedLink`, `CoverageGap`, `ConnectionReason` and `GapType` in `src/types.ts`
survive as the *inputs* the two migrated analysers keep producing internally; the
existing test suites for them stay green and keep their value. What changes is that they
are mapped into `Finding`s at the analyser boundary, so the panel, the badge, the export
and every future analyser speak one language.

### 4.3 Dismissal keys: one scheme, decided

The review caught this correctly. The first revision promised that hashing the sorted
member ids would stop "one new orphan orphaning the whole card" — it does not: a hash of
the member set changes when the member set changes, exactly as today's title-plus-ids key
does. Keying has to match what the user believes they dismissed, and that differs by
finding shape:

| Finding shape | Key | Why | Survives |
|---|---|---|---|
| **Node-centric** (`stale-hub`, `single-point-of-failure`, `underlinked-hub`, `orphan-aging`) | `node:<kind>:<nodeId>` | The user dismissed a claim about *that page*. One key per page, so dismissing one never touches another | a rebuild, a rename of the id's case, a language change |
| **Pair-wise** (`missing-link`, `unlinked-mention`, `merge-candidate`) | `pair:<kind>:<edgeKey>` | Already stable — `edgeKey` is a definition, not a rendering | a rebuild, a language change |
| **Group** (`isolated`, `sparse`, `cluster-gateway`) | `group:<kind>:<anchorNodeId>` for the cluster; **per-item keys inside it** | This is the case the first revision got wrong. A cluster has no natural stable identity, and "5 isolated pages" is not one thing a user dismisses | membership changes only affect the members, not the card |

**For the `isolated` gap specifically — the scenario Arrow E names — the fix is not a
better hash, it is a different card.** Each orphan gets `node:isolated:<id>` and its own
row; the section is the set of undismissed orphans. Dismissing one leaves the others
dismissed. That is what a dismiss button is normally understood to do.

Group cards that genuinely cannot be per-item (`sparse` — a cluster is a set) use the
cluster's anchor node (its highest-weighted member, which `communities.ts:220-228` already
computes for naming) and adopt **explicit "membership changed → this is a new finding"
semantics**, stated in the code and tested.

The acceptance test for this is the scenario itself, not a unit test of the key builder:
*dismiss an orphan card, add one orphan to the vault, assert the other orphans stay
dismissed.*

Dismissed keys are also garbage-collected on rebuild against the current findings — the
pattern already exists for `positionCache` (`graph-view.ts:212-214`).

---

## 5. The analysers

Cost column is from a synthetic-graph benchmark run for this document (PKM-shaped:
average degree 6–11, clustered, 3 % cross-cluster links), on Node 24 in this checkout:

| n | current `analyzeGraph` | 2-hop candidates + AA/RA | Brandes exact | Tarjan cuts | k-core |
|---|---|---|---|---|---|
| 80 | 2 ms | 5 ms | 8 ms | 0.4 ms | 0.3 ms |
| 500 | 3 ms | 34 ms | 387 ms | 1.8 ms | 0.8 ms |
| 1000 | 9 ms | 71 ms | **1 547 ms** | 1.0 ms | 1.2 ms |
| 2000 | 13 ms | 180 ms | **8 699 ms** | 3.1 ms | 3.6 ms |
| 5000 | 43 ms | 212 ms | (not run) | 8.6 ms | 9.5 ms |

Conclusion that shapes the whole plan: **linear-time structural analytics are
effectively free and exact betweenness is not.** Brandes on a 2000-node vault is ~8.7 s —
unusable on the UI thread at any rebuild frequency. Cut vertices, bridges, k-core and
constraint cost single-digit milliseconds at 5000 nodes. So the plan builds the cheap
exact measures, and only ever reaches for *sampled* betweenness (k-BFS), behind a node
budget.

### 5.1 Phase 1 — the model, with today's behaviour preserved

Ship the `Finding` model, the registry, the ranker and the data-driven panel, with the
four existing detectors migrated and their output otherwise unchanged. This is a
refactor: no new insight, but it makes every later phase additive.

Fixed on the way through, because the migration touches them anyway:

- **Dismissal keys** move to the scheme in §4.3 — per-item for node-centric findings, so
  the Arrow E scenario (dismiss one orphan, add another, keep the dismissal) actually
  passes. The first revision's "hash the sorted ids" did not.
- **Garbage collection**: on rebuild, drop keys that no longer correspond to a finding —
  the pattern already exists for `positionCache` (`graph-view.ts:212-214`).
- **i18n**: findings carry keys; `gap.*` stops being dead; English users stop seeing
  Chinese cards.
- **L11**: replace `t(\`reason.${reason}\` as never)` with an exhaustive `Record<ConnectionReason, MessageKey>` so a new reason cannot compile without its string.
- **L12**: clip anchors to ids present in the graph, and only mark a card active when the
  highlight matches the *clipped* set.
- `highlightNodeIds()` (`graph-view.ts:775`) is dead code; either use it for gap cards or
  delete it.

Acceptance: the **565 existing tests** still pass —
verified two ways: vitest's own run reports `Tests 565 passed (565)`, and
`vitest run --reporter=json` contains exactly 565 distinct assertion titles (no
duplicates). A line-anchored regex over the test files finds only 542 `it(` calls, and the
22-test difference is **not** multi-line `it(` calls; the likely source is tests generated
at runtime inside a loop (`test/paths-accuracy.test.ts` has 3 static `it(` and vitest
reports 22 for that file). The static count is the wrong instrument, not a contradiction.
Also: `test/insights.test.ts` assertions about `score` / `reasons` / `contributions` still
hold through a compatibility shim; the panel renders identical cards for the same graph
(checked by `scripts/harness-check.mjs`); `npm run verify` green.

### 5.2 Phase 2 — content signals, and the mention claim measured

The first revision called unlinked mentions "the highest-precision signal available" and
measured nothing. That is the one claim in the plan that carried a whole phase on
assertion, and it is cheap to check: the vault has text even though the graph does not.

**Measured** on the real vault (probe in §3.2's spirit; body-only, code blocks stripped,
matches inside `[[...]]` excluded, terms shorter than 4 characters rejected):

```
notes scanned:         80
name terms considered: 246 (titles + aliases, length >= 4)
candidates found:      47 unlinked mentions
notes with >= 1:       27 (34 % of the vault)
occurrences per candidate: 45 appear once, 1 twice, 1 three times
```

Scanned over the **body only**. Including frontmatter tripled the count to 153 and
produced entirely false positives — a `sources: [...]` entry is a citation, not a
sentence, and one note reported the same title six times from its own citation list. Any
implementation must scan the body.

The first 4-character filter is doing real work but is a crude proxy for specificity in
Chinese: common nouns that happen to be note titles (`可解释性`, `Agent`) survive it. Two
candidates that are clearly true positives, from the top of the list:

```
RLHF 与 DPO  →  指令微调与对齐       "RLHF（基于人类反馈的强化学习）把"人类偏好"变成训练信号"
SPLADE 稀疏向量 → ColBERT 延迟交互检索  "与 ColBERT 相比，两者都在试图融合稀疏与稠密的优点"
```

**What this establishes and what it does not.** It establishes the signal exists, at a
usable volume (47 candidates over 80 notes is a panel's worth, not a flood), and that a
body-only scan is mandatory. It does **not** establish precision: that needs a person to
rate the 47 items, which is exactly the ~100-item study §8.4 calls for, and it should
happen before this phase ships, not after. The claim is downgraded from "highest
precision available" to "**the only signal measured to exist in this vault at a volume
that fits a panel, and the cheapest to explain**".

**Why content comes before topology, in light of §8.2.** On this vault the topology route
has a measured ceiling: a real link has 5.06 shared neighbours on average, the pairs any
local index puts on top have 12.5, and on candidates with ≤ 2 shared neighbours every
local index scores **0–2.5 % P@6**. Missing links are therefore, on this data, a
hub-routed suggestion engine. Content signals do not have that ceiling, work at cold
start, and are the honest answer to "implicit information in the graph" for a vault like
this one. So: content first, topology second and labelled as the weaker product.

Deliverables:

| Analyser / feature | Method | Notes |
|---|---|---|
| `unlinked-mention` | match titles and aliases against each note's **body**, minus existing links, code and self-matches | Highest-confidence card type; one-click "link this mention" (Phase 6) makes it trivial to act on |
| `merge-candidate` | title token overlap / trigram Jaccard, restricted to same-type or same-folder pairs | A different insight class: "these two notes may be the same concept" |
| Content features for §5.3 | tag Jaccard with IDF, source Jaccard, folder prior, term overlap | **Measured on this vault: tag Jaccard alone is 16.7 % P@6 and `AA + tags` is no better than AA.** Ship tags as an evidence line, not a weight, until a re-measurement says otherwise. Folder is a *feature*, never a standalone card |
| `library` / `source` hygiene | `sources[]` entries that name no note in the vault | Cheap, and the vault has real ones — 20 of 246 name terms come from citation lists |

Acceptance: the 47 measured candidates are reproduced by the shipped implementation on
that vault within a stated tolerance; a mention inside a code block or inside `sources:`
is not reported; a human rating of the top 20 records an accept rate; content indexing
stays under 100 ms at 5000 notes (measure, do not assume).

### 5.3 Phase 3 — missing links (the weaker product)

The weakest part of the current feature is measured in §3.2. This phase turns it into a
feature that can propose something new — while being honest that on the vault measured it
mostly proposes hub-routed pairs (§8.2).

**Candidate generation, and why there is no degree cap.** For each node, the 2-hop
neighbourhood minus its own neighbours, excluding structural pages as endpoints.

The first revision added "skip hubs above a degree cap" to bound the work. The review
killed it, correctly, and the measurements agree:

```
rule                                     pool   coverage of held-out links
all 2-hop, no exclusions                 1357     95.9 %
exclude structural endpoints             1258     92.9 %
+ degree cap 50                          1258     92.9 %   (never fires: max degree is 55)
+ degree cap 20                           864     88.3 %
+ degree cap 10                           311     60.5 %
```

Three reasons it is the wrong instrument: it **deletes recall** (a cap of 10 loses 40 % of
reachable links on this vault, and the reviewer measured 88 % on theirs); it is
**redundant**, because hub inflation is already handled by the scoring (a shared neighbour
of degree 55 contributes 1/log 55 ≈ 0.25 under AA and 1/55 ≈ 0.018 under RA); and it is
**untested by construction**, since the failure mode it defends against — a hub with
hundreds of neighbours — cannot occur on any vault available here.

Workload is bounded by **sampling the expansions instead**: when a node's expansion budget
is exceeded, sample which neighbours to expand and record the fraction, so the pool
degrades gracefully rather than losing a class of links. Any budget that still excludes
candidates must be reported as coverage, never applied silently.

**Signals**, each normalised to 0…1 on an absolute scale before weighting:

| Signal | Formula | Measured standing on this vault |
|---|---|---|
| Resource Allocation | `Σ_{z∈Γ(a)∩Γ(b)} 1/k_z` | 37.5 % P@6 — tied for best |
| Adamic-Adar | `Σ_{z∈Γ(a)∩Γ(b)} 1/log k_z` | 36.7 % P@6 — tied; **adopt it for explainability, not for the number** |
| Common neighbours | `|Γ(a)∩Γ(b)|` | 33.3 % P@6; the evidence users understand instantly; heavy tie mass (3.6 at the K = 6 boundary) |
| Association strength | `shared / √(k_a·k_b)` | Not yet measured; removes hub bias from the existing `sources[]` signal |
| Same community | indicator | **78 % of 2-hop candidates are already cross-community** (reviewer's measurement), so as a weight it carries almost no information. Keep it as an evidence line, not a weight — note this is the single largest weight (+3) in today's score |
| Unlinked mention | from §5.2 | Not a weight here; it is its own card type |

**Two products, not one score.** `missing-link` (topology says they belong together) and
`unlinked-mention` (§5.2) stay separate card types with separate wording and separate
evidence. `AA + tags` measured *worse* than AA alone, which is the same lesson one level
down: summing signals with different characters destroys both.

**Evidence, not a score.** Every card shows its top shared neighbours **by name**, with
their degree and an explicit note when they are hubs: "shares `[[索引]]` (degree 55) and
`[[概览]]` (degree 40) — both are index pages". `contributions` already exists
(`types.ts:245`) and is only rendered as a number. Naming the hub is what lets a user
decide "yes, obviously" in one second instead of being fooled.

**Calibration, not a threshold.** Replace `minScore = 3` with an absolute band whose cut
points were fixed offline against the harness. ~77 % of candidates cleared the old
threshold once the edge weight was unavailable, so it filtered nothing; a per-vault
percentile would filter, but forces a "strong" card in every vault (§4.2), so the band is
absolute and may legitimately return nothing.

Acceptance:
- **Gate (regression, not generalisation):** on the §8.1 harness, primary endpoint
  **P@6**, paired over ≥ 20 splits, the **lower bound of the 95 % paired CI** for
  `shipped − Adamic-Adar` must be **≥ 0**, and **candidate coverage ≥ 85 %**. The point
  estimate is printed and is not the gate. AA is the single fixed baseline because it is
  the strongest explainable local index and the CI cannot separate it from RA.
- A golden-vault regression fixture (§8.3) asserts the planted missing link is found and
  that a fully-linked pair is not reported.
- The card's action inserts a wikilink into the source note through the vault adapter, and
  the edit is undoable with Obsidian's own undo.
- Cold start: the analyser returns **no findings** below the confidence floor (not "weak
  findings"), and the panel leads with §5.2 content instead.
- **Hub-routed share of the top 6 is reported** and capped: if every card routes through
  one page, the panel is showing the user their own index, not an insight.

### 5.4 Phase 4 — structure (cheapest non-obvious win)

Everything here is `O(n+m)` except betweenness, and none of it needs new data. This moves
ahead of nothing but is independent of §5.2 and §5.3 — it can ship in parallel.

| Analyser | Algorithm | What the card says | Evidence |
|---|---|---|---|
| `single-point-of-failure` | Tarjan cut vertices + bridges | "Removing `X` splits the graph; `A`, `B`, `C` become unreachable from the rest" | the components it separates |
| `cluster-gateway` | per-community exit-edge count | "This cluster is reachable through a single page" — upgrades today's heuristic (neighbours span ≥3 communities) to a provable statement | the exit edges |
| `underlinked-hub` | k-core + degree | "`X` sits in the highest core but has few links — it is load-bearing" | core number, degree |
| `brokerage` | Burt constraint / effective size | "`X`'s neighbours are not connected to each other — the best place to build a bridge" | ego-network size |
| `bridge-severity` | sampled k-BFS betweenness, `n > 1500` only | ranks bridges already found; never discovers them | sampling fraction, shown as a caveat |

This adds a class of insight the plugin does not have at all: **structure that is provably
load-bearing**, rather than a heuristic that looks like it might be. It is also the most
defensible answer to "non-obvious" (§1) available on this vault, because it does not
depend on a ranking model at all — a cut vertex either exists or does not. And it gives
the panel *positive* cards ("here is where to invest") to balance the negative ones.

Acceptance: the synthetic planted-graph fixture (planted bridge, planted single-entry
cluster) is detected; deleting the planted bridge removes the finding; re-adding it
restores it (the negative control AGENTS.md asks for); the whole phase stays under 20 ms
at n = 5000.

### 5.5 Phase 5 — time, in two independent halves

The first revision bundled four analysers behind one prerequisite and overstated it. The
review separated them correctly: **`orphan-aging` and `stale-hub` do not need the history
file at all.**

#### 5.5a — `stat`-based (no history file)

`VaultAdapter` is `configDir / listMarkdownFiles / read / exists / write`
(`src/core/vault.ts:7-23`) — there is no `stat`. Obsidian's `TFile.stat` supplies
`ctime` and `mtime`, so the whole gap is **one adapter method plus two optional fields on
`GraphNode`**. That is the entire prerequisite for:

| Analyser | Input | Why it is worth a card |
|---|---|---|
| `orphan-aging` | `created` + link count | Buckets: 0–7 d (normal, silent), 7–30 d (worth surfacing), > 30 d (stale, actionable). Sorting by age *is* the severity |
| `stale-hub` | degree + `modified` | "You link to `X` from 30 notes but have not touched it in 14 months" — verifiable in 5 seconds, which is what builds trust in the whole panel |

These are the two highest-trust items in the plan and they ship in weeks, not after a
history file exists. Acceptance: a note's age is asserted against a fixture vault with
known timestamps; a page modified yesterday is never reported stale; both analysers return
nothing (not "weak" findings) when the adapter supplies no timestamps.

#### 5.5b — history-based (bursts, and the negatives that fix §8)

**The append-only edge-history snapshot** — one line per newly observed
`{source, target, firstSeen}`, written on rebuild. Its stated payoff in the first revision
was leakage control for temporal splits. The review identified a **larger** payoff, and it
is the better reason to build it:

> Pairs that had a high Adamic-Adar score at time *T* and were **still not linked** at
> *T + Δ* are the *deliberate non-link* class. The held-out-link protocol is structurally
> blind to them — §8.2 — so today there is no way to measure the failure mode this plan
> worries about most.

That reframes the snapshot from evaluation hygiene to **the thing that makes the objective
correct**. It is still ~20 lines and still unrecoverable if missed, so it ships early —
but it is no longer advertised as a prerequisite for aging or staleness.

| Analyser | Input | Why it is worth a card |
|---|---|---|
| `emerging-topic` / `fading-topic` | Kleinberg burst detection over tag/term counts per window | Established method with a built-in severity hierarchy |

Community-level dormancy and topic drift stay **out of scope**: with less than six months
of history they are noise, and drift detection at PKM scale is exploratory at best.

Acceptance: burst detection is measured against a simulated stream with an injected burst
(rate × 5 in a known window) and must recover the window. **The temporal split is a
report, not a gate** — on the day the snapshot ships its sample size is zero and it stays
unusable for months, so gating on it would be gating on the calendar.

### 5.6 Phase 6 — act on an insight

A card currently highlights notes and stops (`insights-panel.ts:226-230`). This phase
closes the loop, which is what turns a panel into a feature:

- **Insert the wikilink** the card recommends, with a preview of the diff first, through
  the vault adapter, leaving Obsidian's undo intact. For `unlinked-mention` cards this is
  a link-the-mention-in-place edit, the interaction Obsidian's own backlinks pane ships and
  users already trust.
- **Open both notes side by side** for cards where the decision is editorial.
- **Create a MOC / index note** from a `cluster-gateway` or `emerging-topic` card.
- **Copy the finding as Markdown**, matching the export format in `src/reports.ts`.
- **Dismiss with a reason** ("already linked" / "not related" / "know it"), stored
  locally. This is the only feedback channel that is safe at this scale: fitting weights
  to a handful of clicks a week overfits badly and makes the ranking change between
  sessions, which destroys trust. Fit offline; give users explicit controls.

### 5.7 Phase 7 — measurement discipline (starts at Phase 0, not after Phase 2)

See §8. The review is right that this cannot start at Phase 2: Phase 0's own acceptance
criterion ("one file save = one build for N views") is a measurement, and Phase 0 touches
the hottest path in the plugin. **No analyser ships without a measurement, and no
measurement claim is made without the command output that produced it.**

---

## 6. Engineering debt that gates the above

These are not new features; they are what makes new features affordable. Ordered by how
much they unlock.

### 6.1 Fix the rebuild path first (do this before Phase 2)

`getGraph()` clears `buildPromise` in a `finally` (`main.ts:493-499`) while
`applyRebuiltGraph` awaits a build and then asks every open view to reload
(`main.ts:458-462`) — so one file save costs N+1 full builds and N+1 full analyses for N
open views, and `cachedGraph` is never read as a cache. Every analyser added later is
multiplied by that.

**The blast radius is bigger than "small, testable change".** The review is right to flag
it: `previousCommunities: this.cachedGraph.communities` (`main.ts:484`) is what keeps
cluster colours stable across rebuilds, and `requestGraphRebuild` empties `cachedGraph`
first (`main.ts:433`). The file-save path does *not* go through `requestGraphRebuild` (it
goes `vault.on("modify") → scheduleRebuild`, `main.ts:130-134`), so stability survives
today — but **a cache rewrite is the thing most likely to break it silently.** Phase 0
assertions therefore include, explicitly:

- one file save produces **one** build for N open views (measured, not derived);
- **community ids are stable across a rebuild** with unchanged content — assert the
  assignments are identical, not merely the colours;
- the colour-stability path (`previousCommunities`) is still fed from the cache.

### 6.2 Separate "graph" from "insights" in the cache

Today `requestGraphRebuild` throws away the graph and the insights together
(`main.ts:433-435`), and `analyzeGraph` runs inside the build closure. So a knob that only
affects the analysis (a threshold, a category toggle) costs a full vault re-read. Fix:
cache the graph and the bundle separately, and recompute only the bundle when the graph is
unchanged. `InsightOptions` is currently never populated from settings
(`main.ts:487` passes nothing), so the three existing knobs are test-only — this is what
makes them real.

### 6.3 Chunk the analysis, and measure what the user actually feels

`MAIN_THREAD_LAYOUT_LIMIT = 220` gates the layout into a chunked path
(`graph-view.ts:86`, `view/layout.ts:70-83`); the analysis has no equivalent. Reuse that
pattern: run analysers in phases with a yield between them and render progressively, so a
2000-node vault shows today's insights immediately and the expensive ones a frame later.
Because `core/**` is pure and DOM-free, a Worker is also open later, but chunking is the
cheaper first move and needs no message protocol.

**Stability is a first-class metric, and the repository already measures it elsewhere.**
`scripts/stability-eval.ts` measures how a partition moves under perturbation (node
insertion order, dropped links, resolution jitter), reported as Adjusted Rand Index plus
how often a cluster's core note changes. The plan cites `weight-eval.ts` twice and never
mentioned it — a real gap, because **stability is what the user experiences**: every file
save triggers a rebuild, and a top-6 list that reshuffles after every keystroke is worse
than a stale one. Extend the same protocol to findings:

- **top-6 Jaccard across a perturbation** — how much does the panel churn when one note
  changes?
- **dismissal survival** — dismiss a card, rebuild, assert it stays dismissed. This is the
  natural regression test for §4.3, and it is the scenario Arrow E describes.

Both belong in `npm run eval:insights`, next to precision.

### 6.4 Panel section contract

`InsightSection` is a two-member union (`insights-panel.ts:71`) consumed by the
hard-coded group array, `countUndismissed` (`insights-panel.ts:195-199`) and *both* hosts
(`graph-view.ts:117`, `official-panel.ts:89`). Adding a section means touching all of
them plus the harness tab assertions (`scripts/harness-check.mjs:578-607`) and the panel
height check (`scripts/verify-official-filters.mjs:607-657`). Phase 1 must therefore make
sections **data-driven** — derived from `bundle.sections` — or every later phase pays this
tax again. Also worth fixing while there: `.enhanced-graph-official-tabs` /
`.enhanced-graph-tab` are emitted by `official-panel.ts:135-143` with no CSS rules.

### 6.5 One known performance bug to avoid amplifying

In the built-in graph, focusing a card runs `findConnectingPaths` for **every pair** of
focused ids, per animation frame (`official-graph.ts:1266-1282`, `1415-1457`, `1676-1719`;
`STEPS_LIMIT = 200_000`). Today's dense gap cards already hand it large id sets. New
categories must clip anchors to a small, meaningful set — and Phase 1's anchor clipping
(§5.1) is the natural place to do it.

---

## 7. Presentation

### 7.1 Sections

Data-driven, in this order, each with a count, each hideable:

1. **建议连接 / Suggested links** — `missing-link`, `unlinked-mention`, `merge-candidate`
2. **结构风险 / Structural risks** — `single-point-of-failure`, `cluster-gateway`, `underlinked-hub`
3. **知识空白 / Knowledge gaps** — `isolated`, `sparse`, `brokerage`
4. **演化趋势 / Trends** — `orphan-aging`, `stale-hub`, `emerging-topic`, `fading-topic`

Empty sections get no tab (the current behaviour, `insights-panel.ts:143`, is right).

### 7.2 The card

```
┌──────────────────────────────────────────────────────────────┐
│ 建议连接 · 强证据                                       [×]  │
│ [[注意力机制]] ↔ [[Transformer]]                             │
│ ──────────────────────────────────────────────────────────── │
│ 共享稀有邻居：[[自注意力]] (4 度)、[[多头注意力]] (6 度)      │
│ 跨社区 · 类型不同：concept ↔ finding                          │
│ 正文中已提及但未链接（2 处）                                  │
│ ──────────────────────────────────────────────────────────── │
│ [插入链接]  [并排打开]                    effort: 一键         │
└──────────────────────────────────────────────────────────────┘
```

Rules that matter more than the layout:

- **Named evidence, not metric names.** "shares `[[自注意力]]` (degree 4)" beats
  "Adamic-Adar 2.4". Never show the algorithm's name to the user.
- **Name the hub when the evidence is a hub.** For a `missing-link` card, say "shares
  `[[索引]]` (degree 55)" rather than hiding which page produced the score. §8.2 measured
  that the top of a local-index ranking is overwhelmingly hub-routed; naming it is what
  lets the user answer "yes, obviously" in one second.
- **Three confidence bands**, not decimals. `2.41` and `2.37` are indistinguishable to a
  reader; "strong" is actionable. The bands are **absolute** (§4.2) and a section with
  nothing above the floor shows an empty state — that is a legal, designed outcome.
- **Order by severity ÷ effort**, not by score. "Add one link" is a 2-second action;
  "this theme is fragmenting" is an afternoon. Mixing them in one list sorted by score is
  what makes a panel feel like noise.
- **Effort is visible on the card**, so the user can budget attention.
- **"New since last visit"** on the section header. A list that never changes trains
  dismissal; `bundle.fingerprint` is what makes this possible. Decide the **first-run**
  behaviour explicitly: on install everything is "new", which is exactly the moment the
  user forms their opinion of the panel, so the first run should present a short,
  high-confidence set rather than a full list.
- **Show fewer cards.** Precision is strongly K-dependent — measured P@1 60 %, P@3 46.7 %,
  P@6 36.7 %, P@10 32.0 %, P@20 29.3 %. Moving the per-section cap from 6 to 3 buys a 27 %
  relative precision improvement for the cost of three cards. The first revision said
  "6–10 items"; the measurement says **3–6, and the cap is a quality knob, not a
  capacity knob.**
- **Diversify, but comparably.** Per-category caps plus MMR across categories — which
  requires the cross-analyser comparable `score` from §4.2. Diversifying on
  per-analyser-normalised scores would let whichever analyser has the widest internal
  spread own the panel.
- **Dismissing a category is one click.** A release valve prevents the whole feature from
  being switched off.

### 7.3 Explainability, concretely

For a `missing-link` card the evidence list is the explanation: the shared neighbours are
the "subgraph that explains it", and it is already computed for scoring. Add one
counterfactual line where it is cheap and true — for `cluster-gateway`, "this is the only
remaining link between these two areas"; for `single-point-of-failure`, "removing this
page disconnects 6 notes". Counterfactuals are what make a structural claim believable.

---

## 8. Evaluation

The rule from `AGENTS.md`: **measure, do not assert**. This section is what turns that
from a slogan into a harness.

### 8.1 The harness

**`scripts/insight-eval.ts` now exists and is committed** (`npm run eval:insights`), built
on the shape of `scripts/weight-eval.ts`. It is the first deliverable, not Phase 2's
companion, because Phase 0, Phase 1's "identical cards" claim and Phase 2's gate all
depend on it. It reports:

- **precision@K for 1/3/6/10/20**, with **K = 6 as the primary endpoint** because that is
  the panel's per-category cap. The correct argument for P@K over AUC is **head
  sensitivity**: AUC integrates over every threshold, while the product consumes only the
  top six, and a scorer can improve AUC while making the top of the list worse. The first
  revision justified P@K by "extreme class imbalance" — measured, the positive rate is
  **2.95 %**, which is mild, and AUC is prevalence-invariant by construction, so imbalance
  never misled it. Getting this wrong invites someone to "fix" it later with resampling.
- **candidate coverage**, first-class and with a floor. This is the metric whose absence
  lets the feature pass its own gate while unable to see half the links (§5.3). Coverage
  regression is a gate failure regardless of P@K.
- **the trivial baselines** (random, preferential attachment) and the chance level, so the
  ~12× lift over chance is visible instead of implied.
- **tie mass at the K boundary**, because a small-integer score like common neighbours is
  decided partly by sort order (measured: 3.6 candidates tied at K = 6).
- **composition of the top K vs. the real links** (mean shared neighbours, max shared
  degree, hub-routed share), which is what exposes the obviousness problem in §8.2.
- **paired differences with bootstrap CIs**, since the paired CI is far tighter than
  either level's: the sd of P@6 across splits is ~27 pp while the paired CI on a
  comparison is ~±3 pp.
- **raw and coverage-conditional recall.** Reporting raw recall alone hides the
  generator's loss and understates the method.

### 8.2 The metric does not measure the stated objective

This is the review's most valuable finding, and it survives independent reproduction.

§1 defines success as **non-obvious**. §3.2 measures P@K on held-out links — which rewards
pairs that are *most likely to be linked*, i.e. most structurally expected. Those are
opposed. Measured composition of the top 6 against the real links:

| | shared neighbours | max shared degree | hub-routed (> 20) | cross-community |
|---|---|---|---|---|
| Adamic-Adar top 6 | **12.50** | 33.4 | 94.2 % | 63.3 % |
| resource allocation top 6 | 12.23 | 33.4 | 92.5 % | 66.7 % |
| common neighbours top 6 | 12.53 | 33.5 | 94.2 % | 60.8 % |
| **real hidden links** | **5.06** | 29.3 | 80.0 % | 41.4 % |

A local index picks pairs with **2.5× the shared-neighbour count of a real link**, and
94 % of them route through a page with more than 20 links. In plain terms: the metric
prefers pairs sitting inside the densest part of the graph, under the biggest index note —
exactly the pairs a user is most likely to have already considered and deliberately not
linked. And the held-out protocol **cannot see that class at all**, because a deliberate
non-link is never in the positive set.

The restricted-pool check makes it blunter: on candidates with **≤ 2 common neighbours**,
every local index scores **0–2.5 % P@6**. For this vault, "missing links" is a hub-routed
suggestion engine.

**What that means for the plan.** This is a measured compositional difference plus an
argument, not a demonstrated user-perception result — there are no human labels yet. But
it is the exact risk §1 names, and the gate would pass whether or not it is happening. So:

1. **Order the phases by it.** Content signals (§5.2) lead, because they do not have this
   ceiling; topology (§5.3) follows and is labelled the weaker product.
2. **Make "obvious" measurable and visible.** Record whether the pair shares the user's
   top hub, or whether the shared neighbours are all degree ≥ 20. Already computable; use
   it as an evidence line *and* as a diagnostic.
3. **Report a second, restricted view.** P@K on the low-overlap subset (CN ≤ 2) alongside
   the full pool. A scorer that wins on both is genuinely better; one that wins only on
   the hub-routed pool is being rewarded for obviousness. The harness does this.
4. **Run the human rating study before freezing the objective**, not after Phase 2 ships.
   ~100 blind items on one vault is enough to detect a 2:1 effect (§8.4).

### 8.3 Splits, and what synthetic graphs can and cannot settle

- **Random held-out links** for fast iteration (what the harness uses today).
- **Temporal split** once §5.5b's history exists: train on edges first seen before `T`,
  test on those after, restricted to pairs whose endpoints both existed before `T`. Random
  splits leak — a hidden edge's endpoints are still connected through their other hidden
  edges.
- **Deliberate non-links as negatives.** This is the snapshot's real payoff (§5.5b): pairs
  that scored high at time *T* and were still not linked at *T + Δ*. It is the only
  negative class that can measure §8.2's failure mode.
- **Pooled across vaults.** One 80-note vault has ~40 held-out links; a 5-point change is
  unmeasurable there.

**Synthetic planted structure gives real power for structural claims and none for the
scorer.** The first revision said "the only route to real statistical power" without
qualification; that over-claims. Split it:

| Claim | Synthetic helps? | Why |
|---|---|---|
| Do Tarjan / k-core / conductance find a planted cut vertex, bridge or single-entry cluster? | **Yes, with full power** | Ground truth is definitional — the generator knows the answer |
| Does burst detection recover an injected burst window? | **Yes** | Same reason |
| Does the link-prediction scorer rank *human-chosen* links well? | **No** | The target is behavioural. An LFR graph is not generated by a person writing notes, so an LFR-derived "missing link" is a different object |

The **golden-vault regression fixture** — a small checked-in synthetic vault (~150 notes,
generated by a script) with planted structure and asserted findings — is a regression test
rather than an evaluation, and it is the cheapest way to make the insight layer
unit-testable.

### 8.4 What can be measured at this scale — be explicit

| Question | Method | Feasible? |
|---|---|---|
| Does the scorer rank held-out real links well? | P@6 on paired splits | Yes, but it measures "predictable", not "non-obvious" (§8.2) |
| Is the scorer rewarding obviousness? | top-K composition vs. real links; low-overlap P@K | Yes, already in the harness |
| Do structural analysers find planted truths? | synthetic planted graphs | Yes, with real power (§8.3) |
| Are the cards *relevant to this user*? | blind rating of ~100 items, method hidden | Yes, and it is the **only** way to settle §8.2. Below ~50 items, treat as colour, not a metric |
| Do users act on them? | local telemetry: impression, accept, dismiss, time-to-action, per-analyser dismissal trend | Yes, and **dismissal rate per analyser is the health metric** — a rising rate means lower that analyser's frequency, not "add more insights" |
| Is the feature stable enough to trust? | top-6 Jaccard under perturbation; dismissal survival across a rebuild (`stability-eval.ts` protocol, §6.3) | Yes, cheap, and currently unmeasured anywhere |

Offline precision and online acceptance are correlated but not identical; use offline
numbers to choose between algorithms and telemetry to decide whether a category survives.
No vault content ever leaves the machine — telemetry stays in the plugin's own data file.

---

## 9. Delivery plan

Each phase is independently shippable and verifiable. A phase is done when its acceptance
criteria pass and `npm run verify` is green. **Gates are regression gates against a
recorded baseline, not evidence of generalisation** — all 20 splits resample the same ~400
links, so the interval measures split noise, not vault-to-vault behaviour.

| Phase | Deliverable | New insight | Risk | Gate |
|---|---|---|---|---|
| **0** | Rebuild-path fix (§6.1), insight/graph cache split (§6.2), `eval:insights` harness (§8.1) | none | Medium — touches the hottest path and the community-id stability path | one file save = **one** build for N views (measured); community ids identical across a rebuild of unchanged content; harness runs green |
| **1** | `Finding` model, registry, ranker, data-driven panel; migrate the 4 detectors; fix keys (§4.3), i18n, clipping, `t()` hole | none (behaviour-preserving) | Medium — wide refactor | 565 tests green; harness renders identical cards; dismissal-survives-rebuild test passes |
| **2** | Content index, unlinked mentions, merge candidates, content features | high (highest confidence) | Medium — indexing cost, false positives | the 47 measured candidates reproduced within a stated tolerance; body-only scan (a `sources:` hit is not a mention); human rating of the top 20 recorded; < 100 ms at 5000 notes |
| **3** | Missing links, minus the degree cap, with sampling; coverage in the harness | medium (**weaker product**, hub-routed) | Medium — calibration needs the harness | **P@6 lower-bound of the paired CI for `shipped − AA` ≥ 0**, coverage ≥ 85 %, hub-routed share of the top 6 reported and capped; planted link found; no fully-linked pair reported |
| **4** | Cut vertices, bridges, cut size, k-core, constraint, sampled betweenness | high (most defensible "non-obvious") | Low — exact, linear-time algorithms | planted structure detected and cleared on removal (negative control); < 20 ms at n = 5000 |
| **5a** | `stat` adapter method; orphan aging, stale hubs | medium-high (high trust) | Low | age asserted against a fixture vault with known timestamps; a page modified yesterday is never stale |
| **5b** | Edge-history snapshot; burst detection | medium | Low for the file; medium for bursts | snapshot written on rebuild; injected burst window recovered. **Temporal split is a report, not a gate** |
| **6** | Actions: link-the-mention, insert link, open side by side, create MOC, copy, dismiss-with-reason | — (usability multiplier) | Medium — writes to the vault | inserted link byte-exact; undo restores the file; every action reachable from the harness |
| **7** | Ongoing measurement discipline; telemetry counters; stability metrics | — | Low | every analyser has a measurement command and a recorded baseline; top-6 churn recorded |

Phase 2 and Phase 4 are independent and can run in parallel; Phase 3 depends on Phase 1
and benefits from Phase 2's content features but does not require them.

---

## 10. Risks

| Risk | Why it happens | Mitigation |
|---|---|---|
| **The metric rewards obviousness** | P@K on held-out links prefers the most predictable pairs; 94 % of top-6 cards route through a hub, against 80 % of real links | §8.2: phase order, low-overlap view, hub-visibility evidence, human rating study before freezing the objective |
| **Coverage loss invisible to the gate** | P@K is blind to the candidate pool; a cap can delete half the reachable links while P@K rises | Coverage is first-class with an 85 % floor; no degree cap; sampling instead of deletion |
| **Insight fatigue** — the panel becomes noise | Too many cards, no diversity, no freshness | Cap at 3–6 per section (precision is 27 % better at 3 than at 6), MMR on comparable scores, "new since last visit", one-click category dismissal, per-analyser dismissal telemetry |
| **False confidence** on a sparse vault | Structural claims are meaningless below ~80 notes | Absolute confidence floor; **returning no findings is a legal, designed state**; content signals lead at cold start |
| **The analysis blocks the UI** | It is synchronous inside the build, and `getGraph` multiplies it by N+1 | Phase 0 first; chunked analysers (§6.3); sampling for expansions; sampled betweenness only |
| **Overfitting the scorer to one vault** | Tuning on a single 80-note vault: ~40 positives per split, three signals the CI cannot separate, 2.95 % positive rate, heavy tie mass | Ship normalised signals, named evidence and bands — **not** fitted weights (§11). Gate is explicitly a regression gate. Revisit at ≥ 3 vaults |
| **Panel churn** | Every save rebuilds; a reshuffling top-6 is worse than a stale one | Stability metrics from `stability-eval.ts`'s protocol; dismissal-survival test |
| **A cache rewrite breaks cluster colours** | `previousCommunities` feeds colour stability and `requestGraphRebuild` empties the cache | Phase 0 asserts community ids are identical across a rebuild |
| **Writing to the vault loses work** | Phase 6 edits notes | Preview the diff, use the vault adapter so Obsidian's undo works, never batch-write without confirmation |
| **Dismissal settings grow forever** | Nothing collects stale keys (today) | §4.3 key scheme + GC on rebuild against current findings |
| **Architecture rules break** | New `core/**` modules importing `obsidian`, or a cycle between registry and types | Keep `types.ts` import-free; put the input/augmentation contract in `core/insights/input.ts`; `test/architecture.test.ts` already enforces the rest |
| **Scope creep into a different product** | Embeddings, LLM summaries, cloud analysis | Out of scope by decision. Local embeddings in particular change the plugin's identity and distribution constraints |

---

## 11. Three decisions to confirm before Phase 1 starts

The review answered all three; the recommendations below are revised to match.

1. **Engine language policy — message keys. Agreed, no reservations.** Findings carry
   `{key, params}` and the view renders them. `core/**` stays pure, `i18n.ts` stays
   import-free, and it fixes the Chinese-only gap cards and half of the dismiss-key problem
   in one move. This is a deliberate new precedent for `core/**`, so it needs an explicit
   yes — it is the single best-designed part of the proposal and the cheapest to adopt
   while Phase 1 is already touching every finding.

2. **How far to go on scoring — normalise and band; do NOT fit weights.** The first
   revision offered offline logistic regression as the "maximum" option. That is withdrawn.
   The data is one vault, one link set, ~40 positives per split, 20 correlated splits, three
   signals whose own CIs cannot separate them, a 2.95 % positive rate and heavy tie mass.
   Weights fitted on that will overfit and will drift between sessions — the exact failure
   §5.6 already warns about for click feedback. Ship normalised signals, named evidence and
   absolute confidence bands, and **revisit only when there are ≥ 3 vaults or §5.5b's
   snapshot supplies deliberate-non-link negatives that actually discriminate.**

3. **Scope of Phase 5 — snapshot in, but nothing gated on it.** The edge-history snapshot
   is ~20 lines, in scope, ships early, and its value compounds. But `orphan-aging` and
   `stale-hub` are gated on a `stat` adapter method instead (§5.5a), and the temporal split
   is a **report, not a gate** (§5.5b), because on the day it ships its sample size is zero.
   Community drift detection stays out of scope; the reason given (insufficient history) is
   correct.

**And one thing the plan should do before Phase 2 ships, not after:** run the blind human
rating study (§8.4). §8.2 shows the primary metric can pass while the feature recommends
only obvious pairs, and no amount of offline measurement can settle that — it needs ~100
rated items with the method hidden. Cheap, decisive, and it is the only way to know
whether the objective was right before freezing it.

### Loose end: wiring the harness into the release checks

`npm run eval:insights` is deliberately **not** part of `npm run verify`, because it needs
a vault path and because a research measurement is not a build gate. `AGENTS.md`'s
"Checks to run before proposing a release" is therefore unchanged by this plan. When Phase
3 ships a scorer whose gate is a precision comparison, that judgement should be revisited
deliberately — with a **recorded baseline** committed next to the harness, so the release
check can assert "not worse than the recorded numbers" rather than re-deriving them.

---

## Appendix A — measured cost reference

Synthetic PKM-shaped graphs, Node 24, this checkout. Reproduce with the benchmark
described in §5; treat the numbers as order-of-magnitude, not as a benchmark suite —
they are **single runs** with no repetition, and repeated runs of the same cell varied by
roughly ±20 % (the 2000-node AA/RA cell measured 180 ms and 198 ms on two runs). The
conclusions drawn from them are about orders of magnitude, which that variance does not
threaten.

| n | e | communities | current `analyzeGraph` | 2-hop candidates | +AA/RA scoring | Brandes | Tarjan | k-core |
|---|---|---|---|---|---|---|---|---|
| 80 | 424 | 5 | 2.0 ms | 2.1 ms | 3.4 ms | 7.7 ms | 0.4 ms | 0.3 ms |
| 500 | 2650 | 14 | 3.3 ms | 19.4 ms | 33.7 ms | 387 ms | 1.8 ms | 0.8 ms |
| 1000 | 5300 | 16 | 8.8 ms | 43.4 ms | 70.8 ms | 1 547 ms | 1.0 ms | 1.2 ms |
| 2000 | 10600 | 23 | 13.3 ms | 128.3 ms | 198 ms | 8 699 ms | 3.1 ms | 3.6 ms |
| 5000 | 14905 | 52 | 42.7 ms | 139.5 ms | 214 ms | — | 8.6 ms | 9.5 ms |

## Appendix B — baseline evidence

```
$ node node_modules/typescript/bin/tsc --noEmit
exit 0

$ node node_modules/vitest/vitest.mjs run
 Test Files  18 passed (18)
      Tests  565 passed (565)
   Duration  22.28s
```

Quality measurement on `插件开发/插件开发` (80 notes, 420 edges, 6 communities, max degree
55). **This is the command, not a pasted table** — the harness prints its own numbers and
its own protocol:

```
$ node node_modules/esbuild/bin/esbuild scripts/insight-eval.ts --bundle \
    --platform=node --format=cjs --outfile=scripts/insight-eval.cjs
$ node scripts/insight-eval.cjs 'D:\Progect\插件开发\插件开发'

=== protocol ===
seed:             20261010
trials:           20
hidden links:     40 per trial (absolute count, not a percentage)
primary K:        6   reported K: 1, 3, 6, 10, 20
notes:            80      edges: 420 (21 touch a structural page)
communities:      6       max degree: 55
all node pairs:   3160 unordered — a candidate count above this is an iteration sum, not a set size

=== candidate pool (structural endpoints excluded) ===
pool size:        mean 1258  min 1136  max 1300
pool iterations:  mean 6602  (a pair recurs once per shared neighbour)
coverage:         92.9 % of held-out links are in the pool
positive rate:    2.95 % of the pool
```

The full output (precision@K for every scorer, paired CIs, composition, coverage per
candidate rule, ties, the low-overlap view) is in §3.2's table and is reproduced verbatim
by the command. The earlier revision's table — `AA 38.0% / RA 36.0% / CN 35.5% / V1 2.0%`
at `P@K` with `AUC 0.84` — is superseded: those numbers came from a probe that hid 40 links
but was documented as hiding 20 %, and whose candidate count was an unlabelled iteration
sum. The direction of every conclusion is unchanged; the levels are not comparable and
should not be quoted.

The line that mattered most, and that no earlier revision had:

```
V1 as shipped, minScore=0: 350 pairs ranked, 0 of them non-edges
```

The superseded probe was written for the first revision and then deleted — which the
review rightly called a violation of this repository's own working agreement, since it made
the plan's central evidence unverifiable and, as it turned out, partly wrong. It has been
replaced by **`scripts/insight-eval.ts`, committed**, wired to `npm run eval:insights`, and
its output is quoted in §3.2 rather than transcribed. The rule this document now follows:
**a number appears here only with the command that produces it.**

## Appendix C — how the claims in this document were verified

**Measured by running, in this checkout:**

| Claim | Evidence |
|---|---|
| 565 tests | `vitest run` reports `Tests 565 passed (565)`; `--reporter=json` contains 565 distinct assertion titles and zero duplicate titles. The 542-vs-565 gap is caused by runtime-generated tests (`paths-accuracy.test.ts`: 3 static `it(`, 22 reported), **not** multi-line `it(` calls — the first revision's explanation was wrong || `tsc --noEmit` exit 0 | run; exit 0 |
| Pool size, coverage, positive rate, precision@K, CIs, composition, ties, coverage-per-rule | `npm run eval:insights` output, quoted in §3.2 |
| Unlinked mentions exist at a usable volume | mention probe run body-only: 47 candidates / 80 notes; frontmatter-inclusive scan gave 153 with false positives, so the body-only figure is the meaningful one |
| The feature cannot propose new links | `minScore = 0` → 350 ranked pairs, 0 non-edges |
| Synthetic cost table (Appendix A) | benchmark run; single runs, ±20 %, order-of-magnitude only |

**Read from source, not instrumented** — flagged because a later phase depends on each:

- `insights.ts:116` — the loop really is `for (const edge of graph.edges)`.
- `official-graph.ts:1441-1455`, `:1719`, `:1653-1660`, `:1683-1687` — `drawMarkers` calls
  `focusEdgePairs` (one `findConnectingPaths` per pair of focused ids) and runs from the
  `requestAnimationFrame` ticker with no early return when a focus exists, so the per-frame
  O(k²) claim holds. No timing was taken on a focused multi-id card.
- `graph-view.ts:212-214` — `positionCache.prune` is the existing GC pattern; the staleness
  fix at `:217-224` only runs when a focus exists.
- `main.ts:493-499` — `buildPromise` is cleared in `finally`, so `getGraph()` is a
  concurrency guard rather than a cache. **The "N+1 builds per save" figure is derived from
  control flow, not counted.** Phase 0 must count it before claiming the fix.
- `src/core/vault.ts:7-23` — `VaultAdapter` has no `stat`, which is the real prerequisite
  for `orphan-aging` / `stale-hub`.
- `test/architecture.test.ts:209-218` — `types` and `i18n` must import nothing at all.

**Not verified:** nothing has been run against a real Obsidian instance
(`npm run verify:obsidian`), and `npm run verify` as a whole has not been run — see §3.1.
No claim in this document rests on a human relevance label, which is why §8.2 is a measured
compositional difference plus an argument, and why §8.4 puts the rating study on the
critical path.

## Appendix D — references

Link prediction: [Lü & Zhou, survey](https://doi.org/10.1016/j.physa.2010.11.027) ·
[Adamic & Adar 2003](https://dl.acm.org/doi/10.1145/956750.956813) ·
[Zhou et al., resource allocation](https://doi.org/10.1140/epjb/e2009-00335-8) ·
[Liben-Nowell & Kleinberg](https://doi.org/10.1002/asi.20591) ·
[Yang et al., evaluating link prediction](https://arxiv.org/abs/1505.04094)

Structure: [Brandes 2001](https://doi.org/10.1080/0022250X.2001.9990249) ·
[Freeman 1977](https://doi.org/10.2307/3033543) ·
[k-core, Dorogovtsev et al.](https://arxiv.org/abs/cond-mat/0509102) ·
[Burt, structural holes](https://www.hup.harvard.edu/books/9780674843714) ·
[Granovetter, weak ties](https://doi.org/10.1086/225469) ·
[Eppstein & Wang, sampling betweenness](https://doi.org/10.1007/s10618-015-0423-0)

Communities: [Yang & Leskovec, ground-truth communities](https://doi.org/10.1007/s10115-013-0693-z) ·
[Fortunato & Barthélemy, resolution limit](https://doi.org/10.1073/pnas.0605965104) ·
[Traag et al., Louvain → Leiden](https://doi.org/10.1038/s41598-019-41695-z)

Temporal: [Kleinberg, bursty structure](https://dl.acm.org/doi/10.1145/775047.775061) ·
[Palla et al., group evolution](https://doi.org/10.1038/nature05670) ·
[Leskovec et al., graphs over time](https://arxiv.org/abs/physics/0603229)

Explainability and evaluation: [Zhang & Chen, explainable recommendation](https://doi.org/10.1561/1500000066) ·
[Herlocker et al., evaluating recommenders](https://doi.org/10.1145/963770.963772) ·
[Gunawardana & Shani](https://doi.org/10.1007/978-0-387-85820-3_8)

Prior art: [Obsidian unlinked mentions](https://obsidian.md/help/plugins/backlinks) ·
[Graph Analysis plugin](https://github.com/SkepticMystic/graph-analysis) ·
[InfraNodus content gaps](https://infranodus.com/tutorial/content-gap-analysis) ·
[Smart Connections](https://smartconnections.app/smart-connections/) ·
[Neo4j GDS algorithms](https://neo4j.com/docs/graph-data-science/current/algorithms/) ·
[CiteSpace, Chen 2006](https://doi.org/10.1002/asi.20317)

---

## 12. Implementation status

### Phase 0 — complete

`src/core/graph-cache.ts` holds the cache; `src/main.ts` delegates to it.
`getGraph()` is now a cache rather than a concurrency guard, `invalidate()` marks
the graph stale **without discarding it** (that is what keeps `previousCommunities`
feeding cluster-id stability), and the vault-change path invalidates with
`{ request: false }` so the 1200 ms debounce is preserved instead of replaced by
one rebuild per keystroke.

| Acceptance criterion | Evidence |
|---|---|
| One file save = one build for N views, asserted by a test | `test/graph-cache.test.ts` → `costs one build for one file save, however many views are open`; 15 tests green |
| The counter can fail (not vacuous) | In-suite control `counts one build per view when a request precedes each reload` asserts `builds === 4`; the cache engineer additionally ran six mutations of `graph-cache.ts`, each making specific tests fail, then restored the file byte-identically |
| Community ids identical across a rebuild | Independently measured on the real vault (80 notes): `previousCommunities` reached the second build and all 80 assignments were identical |
| Production shape end to end | Independently measured: one `invalidate({request:false})` → `getGraph()` → 3 view reloads produced **1 build and 1 analysis**, and all three views received the identical pair |

**A defect the tests caught during the refactor:** `inFlight` was never cleared
when an attempt settled, so a settled promise served later callers and the
freshness check became unreachable. The cache was correct; the reuse path was not.
The mutation run is what surfaced it.

### Phase 1 — complete

The engine now emits one `Finding` shape. `src/core/insights.ts` keeps its exact
public signature (`analyzeGraph(graph, options)`, with `connections` / `gaps` still
on the result) and additionally returns `bundle`, so the 31 existing engine tests
and `reports.ts` were untouched.

| Acceptance criterion | Evidence |
|---|---|
| The 565 existing tests still pass | 626 tests pass in total (565 baseline + 61 new); `tsc --noEmit` exit 0 |
| The panel renders for the same graph | Browser harness **96/96**, including `insights panel switches between suggested and gap cards by tab: tabs: 建议连接 (6) / 知识空白 (5)` and `insights mode keeps the panel header above the cards` |
| Dismissal works, and `gap.*` keys are live | `harness-check.mjs` → `dismissing an insight card removes it and records the key: 6 → 5 cards, 1 key(s) stored`. Gap cards now render from message keys, so an English user no longer sees Chinese |
| L11 (`t(\`reason.${reason}\` as never)`) removed | The panel resolves confidence, effort and action labels through exhaustive `Readonly<Record<…, MessageKey>>` maps, so a new member is a `tsc` error |
| L12 (a card naming a filtered-out note goes active) | Anchors are clipped to ids present in the graph, and a card is active only against the clipped set |
| The official side is unaffected | `scripts/verify-official-filters.mjs` **28/28**, including the panel-height ceiling `insights 482, tags 482`; `verify-vault` all checks passed; bundle smoke test 16/16 |

**Two design errors the new tests caught**, both of which would have shipped
silently:

1. **The ordering key was not a tie-breaker.** It added a bounded share of the
   score to `severity ÷ effort`, and no bound works: the base spans 0.25…3, so the
   smallest step between adjacent combinations is 0.25 and *any* positive addition
   can cross one.
2. **`severity ÷ effort` itself is the wrong arithmetic.** Severity 2 with a
   one-click fix scores 2, severity 3 needing prose scores 0.75 — so a tidiness
   suggestion outranked a single point of failure, the exact inversion the ordering
   exists to prevent. The order is now lexicographic: severity, then effort, then
   score.

**One design change made while wiring the hosts**, because the browser harness
caught it: the bundle is cached while a dismissal only writes settings, so
splitting on dismissal inside `buildBundle` froze it at build time — clicking
dismiss stored the key, re-rendered, and the card stayed. The bundle now holds
every finding, and `visibleFindings` / `visibleSections` are applied by the panel
against the live key set. The panel and the badge count read that one definition.

### Not verified

`npm run verify` was not run as a single command; its steps were run individually
(typecheck, vitest, `verify:vault`, harness build + `verify:view`, `verify:filters`,
production build, `verify:bundle`) and all passed. `npm run verify:obsidian` was
**not** run — it needs the Obsidian app — so nothing here is confirmed inside a real
Obsidian instance. The vault copy was not rebuilt (`build:vault`), so the copy
Obsidian actually loads is still the previous build.

---

## 13. Phase 2 measurement: the human rating

§5.2's gate was a human rating, on the grounds that "is this pair worth linking?" is a
judgement about the reader's own notes that no scoring function can make. It has now
been done, on the real vault (80 notes), by the vault's owner, blind to nothing but
with the evidence in front of them.

Sheet: `docs/mention-rating-sheet.md`, generated by `npm run eval:mentions`, 37
candidates, 4-point scale (`must` / `useful` / `not-needed` / `wrong`).

| Grade | Count | Share |
|---|---:|---:|
| `must` — the link belongs there | 10 | 27 % |
| `useful` — better with it | 15 | 41 % |
| `not-needed` — deliberate, or a passing mention | 9 | 24 % |
| `wrong` — not that page's meaning | 3 | 8 % |

**Acceptance rate (`must` + `useful`): 25/37 = 68 %. `wrong` rate: 3/37 = 8 %.**

### The finding that matters: precision at the top is worse than the average

The panel shows the top **8**, and that slice performed *below* the overall rate:

| Slice | Accepted | `wrong` |
|---|---:|---:|
| Top 8 (what the panel displays) | 5/8 = 63 % | **3/8 = 38 %** |
| Ranks 9–37 (never displayed) | 20/29 = 69 % | 0/29 = 0 % |

All three `wrong` verdicts sit in the top 8, at specificity 0.97 — higher than the
candidates the rater accepted further down. Concretely: `评测方法`, `技术选型` and
`可解释性` are generic *category* words that happen to be page titles. A specific term
appearing in prose is normally a real mention; a generic category word is the case
where the specificity filter does not help, and it is concentrated at the top because
those terms appear in the most notes.

So the ranking actively surfaces the worst cards. That is the opposite of what Phase 3
and §8.2 assumed about the ordering, and it is a more useful result than a single
acceptance number would have been.

### The pattern the rating exposes

Splitting the 37 by where the match occurred:

| Where the term matched | n | Accepted | Rate |
|---|---:|---:|---:|
| Prose | 34 | 24 | **71 %** |
| A heading or a table cell | 3 | 0 | **0 %** |

And by specificity:

| Specificity | n | Accepted | `wrong` |
|---|---:|---:|---:|
| ≥ 0.9 | 29 | 18 | 3 |
| < 0.9 | 8 | 7 | 0 |

Two rules fall straight out, and both are cheap:

1. **A heading or a table cell is not prose.** A term inside a section label is the
   section's name, and linking it adds nothing; a table cell is a field value. All
   three such candidates were rejected, so skipping both is free on this evidence.
2. **A generic term needs prose to justify it.** The three `wrong` verdicts are all
   terms that name a category rather than a thing. Specificity does not separate them,
   so a second signal is needed — the natural one being the term's own document
   frequency as a word rather than as a page name, or an explicit check that the
   mention is not the last-resort label of a list item.

Neither rule is implemented yet. **Precision at the panel's 8-card cap is the number
that matters, and it is currently 63 % with 38 % wrong** — the phase shipped with the
right card type and the wrong ordering, which is exactly the thing offline metrics
could not have told us.

### What this changes

- **The claim "highest-precision signal available" is retired.** Measured, it is 68 %
  accepted with 8 % wrong — good, not dominant, and materially worse at the top.
- **Phase 3's premise is now testable rather than assumed.** §8.2 argued from
  composition that missing links are hub-routed and therefore obvious. If the first
  card type ships at 63 % at the top, "this vault's link-prediction candidates are the
  pairs a user already considered" is a claim worth measuring the same way before
  spending a phase on it.
- **The ordering needed a "generic term" dimension**, which has now been added.

### The two rules the rating produced, and what they did

Both are implemented in `core/content-index.ts` and each is pinned by a test that was
verified to fail when the rule is disabled:

1. **A heading or a table row is not prose.** Table rows are dropped outright; heading
   spans are masked and a generic term inside one is skipped. All three such candidates
   were rejected by the rater, so this cost nothing.
2. **A standalone label is not a reference.** The three `wrong` verdicts were all the
   same shape — a category word heading a bullet, `4. **评测方法。** 报告详细说明了…`
   — where the quoted "sentence" is the label itself. Such a match is now rejected. It
   is deliberately *not* gated on specificity: the first attempt was, and `评测方法`
   is carried by exactly one note, so it scored 0.99 specific while being a category
   word. **Frequency measures how many pages share a name, not how much the name says.**

Measured effect, by re-running the generator and keeping the rater's grades:

| Slice | Before | After |
|---|---:|---:|
| Candidates | 37 | 35 |
| Accepted at the panel's top 8 | 5/8 = 63 % | **7/8 = 88 %** |
| `wrong` at the panel's top 8 | **3/8 = 38 %** | **1/8 = 13 %** |

**One `wrong` survives, and it is honest to leave it.** `多模态与具身智能展望 → RAG
系统评测方法` matches `评测方法` mid-sentence — *"也意味着现有的评测方法需要大幅改造"*
— where the noun really is the one the page is named after and the writer simply did not
mean that page. No signal available here separates "the word refers to the page" from
"the word refers to the concept", and two attempts to build one from frequency failed
for the reason above. Detecting it needs a signal this plan does not have: a term's
document frequency *as plain text* across the vault, which would show that `评测方法` is
used as a category word in many notes while being a page title in one. That is worth
trying, and it is a measurement, not a guess.

**Method note.** Regenerating the sheet initially destroyed the rater's grades, which
would have made every subsequent rule change cost ten minutes of a person's attention.
The generator now reads the existing grades off the sheet and writes them back, keyed by
source + target + term, so a candidate that survives keeps its verdict and one that
disappears simply leaves the file — which is the clearest possible statement of what a
rule change did.

---

## 14. Phases 3–5 and 7: implementation status

### Phase 3 — link prediction: implemented, and it reproduces §8.2 exactly

`src/core/insights/link-prediction.ts`. Two-hop candidate generation (1 396 pairs on the
real vault), scored by Adamic-Adar, resource allocation and common-neighbour count, with
**sampling** rather than a degree cap so the pool degrades in size instead of losing a
class of pairs.

Measured on the real vault, the six cards it offers:

```
向量检索 ↔ 评估与基准测试          shared=15  maxSharedDegree=42
向量检索 ↔ RAG 系统评测方法         shared=15  maxSharedDegree=42
分块策略 ↔ 检索技术选型指南          shared=14  maxSharedDegree=38
分块策略 ↔ 大模型应用技术全景         shared=14  maxSharedDegree=38
上下文窗口 ↔ 检索增强生成           shared=11  maxSharedDegree=42
云端 API 与本地部署对比 ↔ 大模型应用技术全景  shared=12  maxSharedDegree=38
```

Every card is routed through a page with 38–42 links, and the shared-neighbour counts are
two to three times what a real link has (5.06, measured in §3.2).

**But the comparison that number was missing changes the conclusion.** Measuring the same
signals over the vault's 420 *real* links:

| | Candidates (30) | Real links (420) |
|---|---:|---:|
| Mean shared neighbours | **10.07** | 5.85 |
| Hub-routed (max shared degree ≥ 20) | **93 %** | 88 % |

The shared-neighbour elevation is real but modest — **1.7×, not the 2.5× an earlier
hand-measurement suggested** — and **hub-routing is not a bias of this analyser at all**:
88 % of the vault's own links route through a hub page too. An earlier reading of this
section said the analyser "proposes exactly the pairs a user has already considered"
because every card is hub-routed. That was an over-read: hub routing is the *shape of
this vault*, not a property the ranking introduces, and a comparison without the control
column could not have shown it.

What survives is weaker and more honest: the candidates share about 1.7× as many
neighbours as real links do, which is what any local link-prediction index produces by
construction, and the panel's top six are pairs like `向量检索 ↔ 评估与基准测试` — related
pages, quite possibly obvious ones. Whether that is a discovery or a nuisance is exactly
what the rating sheet exists to settle, and **it cannot be settled from these numbers**.

`npm run eval:missing-links` emits the sheet: 30 candidates, the ranked order the panel
uses, with the shared-neighbour and hub columns and the control row above.

### Phase 4 — structure: implemented, and it found a real single point of failure

`src/core/insights/structure.ts`. Iterative Tarjan cut vertices and bridges, k-core by
bucket peeling, Burt constraint, and per-community exit-edge counts. All `O(n + m)`;
`analyzeGraph` on 80 notes costs 22 ms in total for every analyser.

On the real vault: **2 cut vertices, 4 bridges, 0 single-exit clusters**. The head card
is `检索增强生成`, whose removal separates **78 of 80 notes** — the graph hangs off one
page, and that is exactly the class of finding the plan said no offline metric could
produce. Scores are real numbers now rather than the `0.00` the first version displayed
for every structural card, which had made the ordering between them meaningless.

### Phase 5a — trends: implemented, and correct to return nothing here

`src/core/insights/trend.ts`, plus an optional `stat` on `VaultAdapter` and optional
`created`/`modified` on `GraphNode` and `ParsedNote`. Measured, all 80 notes carry
timestamps.

**Both cards are empty on this vault, and that is the right answer**: the vault is three
days old (79 notes created 2026-10-07), so nothing is older than the 7-day orphan bar or
the 180-day staleness bar. The rule is exercised against fixtures instead. A card that
reported old notes in a three-day-old vault would be the failure.

### Phase 5b — edge history: implemented

`src/core/edge-history.ts`. Append-only JSONL, tolerant parsing (a truncated last line is
the expected shape of a crash mid-append and costs one line, not the file), `firstSeen`
never moved once set, and `deliberateNonLinks` — the negative class §8.2 needs, gated so
that a history which had not started yet reports nothing rather than declaring every
candidate a rejection.

Burst detection is Kleinberg's two-state model. Its first implementation never fired at
all: the cost function was written as `count·ln(count/rate) + rate − count`, which is zero
at `count == rate`, so a spike produced no evidence. Replaced with the Poisson deviance,
verified by hand — for the injected burst in the test, `9` against a base of `1.67` gives
a difference of about `9.3` against a threshold of `2.5`.

### Phase 7 — stability: measured, and it found the worst problem in the feature

`npm run eval:insights` now reports two things the plan asks for and nothing measured
before:

```
top-6 after dropping 2 % of links: 2.0/6 cards kept (worst 2/6),
  Jaccard mean 20.0 % — 12 perturbations
dismissal survival across a rebuild: 6/6 of the top-6 stay dismissed
```

**Dismissal survives**, which is the key design of §4.3 doing its job — the failure the
review caught (a key derived from the member list) would show here as cards reappearing.

**But the panel churns.** Removing 2 % of links — one note's worth of editing — keeps
only 2 of the 6 cards. Every file save triggers a rebuild, so a user editing a note sees
most of the panel replaced. That is worse than a stale list, and it is now a number
rather than an impression.

Two things were done about it, and neither is sufficient:

1. **Stickiness** (implemented): the ranker now takes the keys that were visible last
   build and prefers them when the two scores are within 0.05. Measured effect:
   **2.0 → 2.5 of 6 cards kept**, Jaccard 20 % → 27 %.
2. **The rest is not a tie-break problem.** The worst perturbation still keeps **0 of
   6**. That means the churn is *substantive*: removing a few links changes which
   findings exist at all, not merely their order. Each analyser caps its own output
   before the global ranking, and degrees and shared-neighbour sets move together, so a
   different candidate can enter an analyser's cap and push another out. Making the
   panel hold still would mean questioning the per-analyser caps — a design change with
   its own trade-off (a lower cap loses genuine findings), so it is recorded rather than
   guessed at.

**What would settle it.** The right measurement is not churn on a random perturbation
but churn on a *realistic* one — the user editing one note they are actually working on.
A perturbation that deletes 2 % of links everywhere is not what editing looks like, and
if the churn is real under it, that may say more about the perturbation than the panel.
Building that fixture is the next step, and it needs a captured sequence of real vault
states rather than a synthetic edit.

### Phase 6 — actions: implemented

`src/core/note-edit.ts` holds the pure edit; `main.ts` routes the four action kinds and
shows a preview before writing. The write goes through the vault adapter, so an
insertion becomes part of Obsidian's own undo history rather than a hand-rolled one —
which is what §5.6 asks for, and the reason there is no custom undo code.

`insertWikilink` refuses rather than guesses, and each refusal is a tested rule: never
inside code (fences, tilde fences, inline spans, and an unterminated fence), never inside
an existing wikilink or a markdown link label, never when the pair is already linked in
any of four spellings (bare, pathed, aliased, heading) or via frontmatter `related`,
never when the term is absent from the body, and never frontmatter. Three mutations of
the module were run to show the tests fail when it is weakened (9, 7 and 8 tests fail
respectively), so the suite is not vacuous.

**One design gap found and fixed while integrating.** `InsightAction` carried only the
built `text`, so the writer had to infer which bare name to search for from the target's
title, alias and file name. A mention matched by a *frontmatter alias* that appears
nowhere else has no inferred candidate — the card was matched by the analyser and the
button would have reported "no mention found" and done nothing. The action now carries
`term`, the name the scanner actually matched, and the writer tries it first.

**A real regression this phase caused, caught by the gate.** Adding a `Modal` subclass
made the built bundle stop loading: the smoke test's `obsidian` stub had no `Modal`, so
the bundle failed at *require* with "Class extends value undefined is not a constructor
or null". `npm run test` passed throughout — 737 green — and only
`npm run verify:bundle` saw it. The stub now provides `Modal`, and the episode is worth
recording because it is the one failure mode a unit suite structurally cannot catch: the
artifact Obsidian loads is not the artifact the tests exercise.

**Not verified.** No Obsidian instance is available, so the preview modal, the actual
file write, the two-pane open, MOC creation and the undo behaviour are **reasoned about,
not executed**. The official panel's enabled action path is covered by `tsc` and reading
only; its 112 tests pass no `onAction` and therefore exercise the disabled branch.
