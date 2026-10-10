# Review: graph-insights-plan.md

Reviewed 2026-10-10 against the source tree and the real vault
(`插件开发/插件开发`, 81 markdown files) on this machine.
Reviewer's stance: data-science / measurement engineering — *is the reasoning
sound and is the evidence load-bearing*, rather than *is the code good*.

Nothing in the repository was modified. `git status` in the repository shows only
`?? docs/graph-insights-plan.md` (the plan itself is untracked — see §D7).

---

## Verdict

The **diagnosis and the phasing are right**, and the plan's code claims are
unusually accurate: an independent audit of 30 explicit `file:line` references
found 27 exact, 2 minor mis-citations, and 1 mischaracterised
(`settings.ts:93-103` is the manual clear-all button, not pruning logic). The
Arrow A–E framing correctly identifies the real limitation, and I reproduced the
central structural claim exactly (`minScore = 0` → 350 ranked pairs, **0** of them
non-edges).

The **measurement layer is where the problems are**, and they are consequential,
because this plan gates every phase on numbers and the single most load-bearing
table (§3.2) cannot be re-derived:

1. The probe that produced §3.2 was deleted, so the plan's central evidence is an
   assertion. This directly contradicts the repository's own working agreement.
2. One quoted number is **arithmetically impossible** for the vault it describes
   (7 244 candidate pairs on an 80-node graph, where all pairs = 3 160).
3. The evaluation objective (rank held-out links) **does not measure the property
   the plan defines as success** ("non-obvious"), and my measurements show the
   top of the ranking is drawn from the densest, most hub-mediated part of the
   graph — the pairs a user is most likely to have already considered.
4. The Phase 2 acceptance gate can be passed **while the feature silently loses
   most of the links it exists to find**, because it is blind to candidate
   generation. A plausible reading of §5.2's degree cap destroys 88 % of
   achievable recall and P@K would not notice.
5. The §5.1 dismissal-key fix **does not fix the problem §2 Arrow E states**, and
   §4.2 specifies a different scheme again.

None of this makes the plan wrong to pursue. It makes Phase 2's gate unsafe as
written and §3.2 unsafe as evidence.

---

## A. Reproducibility of the load-bearing measurement

### A1. The evidence for §3.2 was deleted (rule violation)

AGENTS.md: *"Measure, do not assert. '475 tests pass' is a claim; the command
output is the evidence for it."* §3.2 and Appendix B are the plan's central
evidence, and the plan states the script was written and then removed. Appendix D
is a good-faith substitute, but it verifies *code* claims, not *measurement*
claims. A plan whose thesis is "no measurement claim without the command output"
should not open with an unreproducible table.

**Recommendation.** Commit the probe as `scripts/insight-eval.ts` **before**
Phase 2 is gated on it, print the seed, the pool size and the exact protocol in
the output, and re-run it whenever the scorer changes. Appendix B should carry
the command line, not quoted numbers.

### A2. `7244` candidate pairs cannot exist on an 80-node vault

This is arithmetic, not implementation choice:

| quantity | value |
|---|---|
| `graph.nodes` | 80 (2 structural) |
| all unordered pairs of nodes | **3 160** |
| all unordered pairs, non-structural only (78) | 3 003 |
| all ordered pairs of nodes | 6 320 |
| measured candidates per trial (hide 40) | **1 244** (min 1 206, max 1 286) |
| measured candidates pooled over 20 trials | 24 879 |

§3.2 says *"76.9 % of all **7244** candidate pairs"* and Appendix B says
*"5568/7244 above minScore=3"*. No reading of an 80-node graph yields 7 244
candidate pairs: a single trial is capped at 3 160, a directed count at 6 320, and
a pooled count over 20 trials is ~25 000. If 7 244 were a *deduplicated union*
across trials it would still be capped at 3 003.

What *does* reproduce is the ratio: I measure **76.3 %** (hide 20 %) and
**77.6 %** (hide 40) against the plan's 76.9 %. That pattern — the ratio
reproduces, the absolute counts do not — is the signature of numbers that were
reconstructed rather than read off a run. Whatever the cause, **at least one of
`5568`, `7244`, `76.9 %` is wrong, and the plan's headline "a fixed threshold is
not a filter" rests on the pair that is impossible.**

### A3. The protocol is stated two ways, and the two readings disagree

§3.2: *"hide 20 % of the links"*, then *"20 trials, 40 hidden links each"*.
The vault has 399 unique non-structural links, so 20 % = 80 links, not 40. I ran
both:

| protocol | AA P@10 | RA P@10 | CN P@10 |
|---|---|---|---|
| hide 20 % (80 links) | 42.5 % | 42.5 % | 44.5 % |
| hide 40 links | 27.0 % | 26.0 % | 26.5 % |

The two readings differ by 15 pp on the headline metric. The plan's quoted
**38.0 % matches neither**. Pick one protocol and state the link count, not the
percentage.

### A4. What reproduced, and what did not

Reproduced (independent reimplementation, so *levels* are expected to differ
slightly; *shape* is the test):

| claim | plan | mine | verdict |
|---|---|---|---|
| `tsc --noEmit` exit 0 | exit 0 | exit 0 | ✅ |
| `it(` regex count | 542 | 542 | ✅ |
| V1 ranks only existing links | 350 / 0 non-edges | 350 / 0 non-edges | ✅ |
| degraded V1 ≥ `minScore=3` | 76.9 % | 76.3 % / 77.6 % | ✅ |
| AA ≈ RA, CI touches 0 | 2.0 pp, [−0.5, 5.0] | 0.0 pp, [−3.5, 3.5] | ✅ |
| sd of P@K across splits | ~12 pp | 11.4 – 14.1 pp | ✅ |
| V1 is not a link predictor | AUC 0.378 | AUC 0.326 – 0.327 | ✅ |
| "N+1 builds per save" | derived | confirmed by control flow | ✅ |
| `analyzeGraph` runtime | ~2 ms | **0.33 ms** (mean of 50) | ⚠️ faster |
| AA/RA/CN AUC level | 0.83 – 0.84 | 0.76 – 0.81 | ⚠️ level differs |
| AA > CN by 2.5 pp | 38.0 / 35.5 | CN **higher** in both protocols | ❌ direction flips |

**The conclusions survive; the quoted numbers do not.** Note the last row: the
plan's own CI for AA − CN is [0.0, 5.0] — touching zero — and in my runs CN is the
*best* of the three under both protocols. The plan's decision to adopt AA as the
"explainable default" is defensible on explainability grounds, but not on the
evidence it cites. Say that, rather than "highest P@K (38 %)".

### A5. Credit where it is due

- The **honesty note** (§3.2) about the AA-vs-V1 comparison being unfair to V1 is
  exactly the right instinct. Most plans would have banked 36 pp silently.
- The hit rate on line references (27/30 exact) is far above normal for a
  document of this size, and the *code* claims I spot-checked all held.
- The cost table's "single runs, ±20 %, order of magnitude only" caveat is the
  right level of humility.
- The repowering of the V1 result: an AUC of **0.33** on candidate pairs means
  the surprise score is **anti-predictive**, i.e. it does what a *surprise* score
  should. The plan reads its most damning number as a failure; it is actually a
  confirmation of design intent. The real problem is that V1's candidate set is
  the edge list, which the plan already says. Consider strengthening that
  paragraph — it makes the "two products" decision much more obviously correct.

---

## B. The metric does not measure the stated objective

§1 defines success as three tests, the third being **non-obvious**: *"the user
could not have seen it by looking at the graph."* §3.2 then measures success with
**precision@K on held-out links** — which rewards pairs that are *most likely to
be linked*, i.e. most structurally expected. Those are different objectives and
in practice partly opposed: the pair with eleven shared neighbours is both the
most predictable link and the most obvious suggestion.

I measured the composition of the chosen cards against the composition of real
(hidden) links, hide-40 protocol, 20 trials, top-10 per trial:

| statistic | AA top-10 | RA top-10 | CN top-10 | **real hidden links** |
|---|---|---|---|---|
| mean shared neighbours | 11.27 | 10.99 | 11.29 | **5.08** |
| mean max degree of a shared note | 35.6 | 35.3 | 35.4 | **31.1** |
| top-10 routed through a hub (>20 links) | 99.5 % | 97.0 % | 100 % | **88.2 %** |
| cross-community | 68.0 % | 65.5 % | 68.5 % | 44.3 % |

The ranking is drawn from pairs with **2.2× the shared-neighbour count of a real
link**, and essentially every AA/CN card is routed through a page with more than
twenty links. Read plainly: the metric prefers pairs sitting inside the densest
part of the graph, under the biggest index/MOC note. Those are precisely the pairs
a user is most likely to have *already considered and deliberately not linked* —
and the hidden-link protocol is structurally unable to see that class, because a
deliberate non-link is never in the positive set.

**Honest limits of this finding.** This is a compositional difference, and it is
consistent with the "obvious" hypothesis; it is not proof. I have no human
relevance labels, so I cannot say a user would call those cards obvious. But it
is the exact risk §1 names, and the plan's own metric cannot detect it — the gate
would pass whether or not it is happening. Settling it needs the ~100-item rating
study §8.4 already plans; that study should run **before** the scoring objective
is frozen, not after Phase 2 ships.

**Constructive alternatives, in order of value:**

1. **Use §5.5's snapshot for its real payoff.** The plan sells the edge-history
   file as enabling temporal *splits* (leakage control). Its bigger value is
   **negatives**: pairs that had high AA at time *T* and were **never** linked by
   *T + Δ* are the deliberate-non-link class. That is the only way to measure the
   failure mode this section describes, and it upgrades Phase 5 from
   "prerequisite for evaluation hygiene" to "the thing that makes the objective
   correct". Consider re-ordering §5.5's rationale around it.
2. **Evaluate on a restricted pool as a second view.** Report P@K on the
   low-common-neighbour subset (e.g. candidates with CN ≤ 2) alongside the full
   pool. A scorer that wins on both is genuinely better; a scorer that wins only
   on the hub-routed pool is being rewarded for obviousness.
3. **Make "obvious" measurable cheaply**: record whether the pair shares the
   user's top hub, or whether the shared neighbours are all degree ≥ 20. Those
   are already computable from the graph and can be an evidence line *and* a
   diagnostic.

---

## C. The Phase 2 acceptance gate is a coin flip and blind to the worst failure

> *"The gate is: shipping scorer ≥ max(AA, RA) on P@10 over 20 paired splits."*

Five problems:

1. **`max()` of two indistinguishable baselines is a noise-selected target.** The
   plan's own CI ([−0.5, 5.0]) says AA and RA are the same method for this
   purpose. Requiring the shipped scorer to beat the larger of two point
   estimates is partly requiring it to beat a coin flip.
2. **The gate is satisfiable by shipping AA unchanged** (AA is the max on the
   plan's table). A gate the baseline itself passes is not a gate. Use ≥ and it
   passes; use > and it is unsatisfiable without a real improvement whose size
   the data cannot resolve.
3. **Point estimates, no interval.** sd(P@10) ≈ 12 pp over 20 splits gives a
   paired CI of roughly ±3.5 pp. An effect of 2 pp passes the gate and is
   invisible. A gate should be written on the *lower bound* of the paired
   difference, not the mean.
4. **Wrong K.** The panel's per-category cap is 6 (`DEFAULT_CONNECTION_LIMIT`).
   Precision is strongly K-dependent (measured, hide-40):

   | | P@1 | P@3 | P@5 | **P@6** | P@10 | P@20 |
   |---|---|---|---|---|---|---|
   | AA | 55.0 % | 41.7 % | 36.0 % | **34.2 %** | 29.0 % | 24.8 % |
   | RA | 65.0 % | 41.7 % | 34.0 % | **32.5 %** | 28.0 % | 25.3 % |
   | CN | 55.0 % | 40.0 % | 39.0 % | **37.5 %** | 30.0 % | 23.0 % |

   Gating on P@10 while the UI shows 6 measures a different product. Gate on P@6.
   (Also: the curve is the strongest available argument for *showing fewer cards*
   — P@3 is 41.7 % against P@10's 29.0 %, a 44 % relative improvement. §7's
   "6–10 items per section" is buying volume at the cost of precision.)
5. **Blind to candidate generation — the decisive one.**

### C1. The gate cannot see the largest source of loss

P@K measures *ranking within* the candidate pool. It is completely insensitive to
what the pool contains. Measured cost of §5.2's own candidate rules (hide-40,
20 trials, coverage = fraction of held-out links present in the pool):

| candidate rule | pool size (all nodes) | coverage of held-out links |
|---|---|---|
| all 2-hop pairs, no exclusions | 1 345 | **93.0 %** |
| exclude structural endpoints (§5.2) | 1 248 | 87.0 % |
| + degree cap 50 | 1 345 | 93.0 % |
| + degree cap 20 | 1 155 | **56.0 %** |
| + degree cap 10 | 362 | **11.3 %** |

A degree cap of 10 — a thoroughly plausible reading of *"skipping hubs above a
degree cap"* on a vault whose largest page has 42 links — throws away **88 % of
the recall the feature could ever achieve**. The surviving 11 % would be ranked
beautifully, P@10 would *rise*, and the gate would pass. This is the single most
dangerous sentence in the plan.

(The pool sizes in this table are over all nodes; §A2's 1 244 counts the smaller
pool that already excludes structural endpoints. Both experiments hide 40 links
per trial over 20 fixed-seed trials, so the coverage column is comparable.)

Two further observations on the same rule:

- The cap is **untested by construction**. Max degree in the real vault is 42, so
  the failure mode the cap defends against ("a hub with 300 neighbours") cannot
  occur on any data available here; the branch will never be exercised.
- The cap is **redundant**. Hub-mediated candidate inflation is already handled
  by the scoring: a shared neighbour of degree 42 contributes `1/log 42 = 0.27`
  under AA and `1/42 = 0.024` under RA. If work per node must be bounded, *sample
  the expansions* rather than deleting the pairs — deleting them removes real
  links, sampling degrades gracefully.

**Recommendation.** Add **candidate coverage** as a first-class metric with a
floor (e.g. ≥ 85 % of held-out positives inside the pool), reported next to P@K
in every eval run, and treat a coverage regression as a gate failure regardless
of P@K. This is the metric whose absence lets the plan pass its own gate while
shipping a feature that cannot see half the links.

### C2. A gate that cannot generalise

The 95 % CI over 20 splits is a **within-vault, within-link-set** interval. It
measures split noise, not vault-to-vault generalisation — all 20 splits resample
the same 399 links. §10 names "overfitting the scorer to one vault" as a risk and
then writes the gate on that one vault. Either the gate is explicitly a
*regression* gate against a recorded baseline, or it needs a second corpus. It
must not be described as evidence of quality.

### C3. No absolute precision floor

P@6 ≈ 34 % means **two of every three cards are wrong**. Insight fatigue is the
plan's #1 risk and the panel's whole justification is that a bad card costs
trust. A purely relative gate ("better than AA") can be passed by a feature that
is unusable in absolute terms. Either define a floor, or lead the section with
the higher-precision product — which brings us to:

---

## D. Claims that are unmeasured, or measured with the wrong statistic

### D1. `unlinked-mention` — "highest precision signal available" — is never measured

§5.2 commits to this as the higher-precision card type, and §5.2 is called "the
highest-value item". The claim carries a whole phase and has **zero** measurement,
in a document whose thesis is "measure, do not assert".

Arrow B is correct that the *graph* has no text. But **the vault has text**, and
the §3.2 probe already read the vault from disk. Mention precision can be measured
today, offline, with a throwaway script, before a line of Phase 4 is written:
extract titles and aliases, scan bodies for unlinked occurrences, sample ~100
hits, count how many are real. That is the cheapest de-risking available anywhere
in this plan, and it protects the item the plan itself calls highest-value.

### D2. §8.1's justification for P@K over AUC is wrong

> *"AUC alone is misleading under extreme class imbalance."*

Measured positive rate in the candidate pool: **3.00 %** (37.3 reachable
positives per 1 244 candidates — 40 hidden, 93.3 % of them inside the pool). That
is mild imbalance, not extreme. AUC is prevalence-invariant by
construction — imbalance does not mislead it. The correct reason to prefer P@K is
**head-sensitivity**: AUC integrates over every threshold, while the product
consumes only the top six cards, and a scorer can improve AUC while making the
top of the list worse. Fix the reason for the right conclusion, or someone will
later "fix" the imbalance with resampling and believe something changed.

### D3. Ties are doing real work in at least one comparison

**36.6 % of candidate pairs share exactly one neighbour**, and common-neighbours
is a small-integer score. Measured number of candidates tied at the K=10
boundary: AA 1.0, RA 1.0, **CN 6.3**. CN's P@10 is therefore partly decided by
sort order within a tie — worth several points. Any comparison whose margin is
2–3 pp and that involves CN is below the resolution of the metric. Either report
tie mass, or use a tie-aware metric (expected precision under random
tie-breaking).

### D4. No trivial baselines

There is no random or preferential-attachment baseline anywhere. With a 3 %
positive rate, P@10 = 29–42 % is a **10–14× lift over chance**, and the document
never says so. One line of output would be the most persuasive sentence in §8.

### D5. Recall@K is reported without its ceiling

91.1 % (hide 20 %) / 93.3 % (hide 40 %) of held-out links are inside the 2-hop
pool, so recall@10 has a ceiling of ~93 %, not 100 %. Reporting 5.3 % recall
without that context understates the method and, worse, hides the generator's
loss — which per C1 is where the real risk lives. Report raw **and**
coverage-conditional recall.

### D6. Ringing a signal that is nearly constant

§5.2 lists "same community" as a signal with "a cross-community pair is the more
interesting card". **78.0 % of 2-hop candidates are already cross-community**
(measured), so as a main effect it carries almost no ranking information, and §3's
`CONTRIBUTION["cross-community"] = 3` is the single largest weight in the current
score. Keep it as an evidence line; do not ship it as a weight.

### D7. §8.3 over-claims synthetic power

> *"Synthetic planted structure (the only route to real statistical power)."*

Two different questions. Synthetic/LFR graphs give real power for **structural**
claims whose ground truth is definitional (does Tarjan find the planted cut
vertex). They cannot validate a **link-prediction scorer**, because the scorer's
target is behavioural — which links a *person* chose to write — and an LFR graph
is not generated by that process. §8.4's table is more careful than §8.3's
headline; make §8.3 say the same thing.

### D8. The claim that could not be reproduced at all

*"`git status` is clean"* (Appendix B). It is not: `git status --porcelain`
returns `?? docs/graph-insights-plan.md`. Trivial in itself, but it is the one
place the document asserts a verifiable state and the assertion fails.

Also: §3.1's explanation of 565 vs 542 is unsupported. There is exactly **one**
non-line-initial `it(` in the test tree and it is inside a comment; a
line-anchored regex that matches `it(` finds 542, and a multi-line `it(` would
still be found. The 23-test gap is more likely tests generated at runtime.
(**Not verified:** I could not run vitest here — the sandbox blocks vite's
esbuild/`child_process` spawn with EPERM. 565 is unverified, not contradicted.)

---

## E. Two internal contradictions in the Finding model

### E1. The dismissal-key fix does not deliver what §5.1 promises

§2 Arrow E states the problem: *"One new orphan invalidates and orphans the key
of the whole card."*

§5.1 prescribes: *"Dismissal keys become structural
(`gap:isolated:<fingerprint of sorted ids>`), so a new orphan no longer orphans
the key of every other card."*

Those are the same behaviour. Today's key is
`gap:${type}:${title}:${nodeIds.join(",")}` (`insights.ts:311`); a new orphan
changes both the title and the id list, so the key changes and the dismissal is
lost. Hash the sorted ids instead and a new orphan still changes the hash, so the
dismissal is still lost. The change **does** fix two other real problems — the
rendered title leaves the key (a language change stops invalidating dismissals)
and key length stops growing without bound — but it does not fix Arrow E.

Worse, §4.2 specifies a **third** scheme: `gap:<kind>:<anchorHash>` — a single
anchor, which *would* be stable. So the plan contains two key designs, and the one
in §5.1 fails §5.1's own stated purpose.

**Decide explicitly:**
- per-item dismissal (`gap:isolated:<nodeId>`, one key per orphan, card = the set
  of undismissed orphans), or
- set-card dismissal with deliberate "membership changed → this is a new
  finding" semantics, stated as such.

The first is what a user expects from a dismiss button. Whichever is chosen, the
§5.1 sentence needs rewriting, and the acceptance criterion should be a test that
survives the exact scenario Arrow E describes: *dismiss the card, add one orphan,
assert the other orphans stay dismissed.*

### E2. `score` is per-analyser, but MMR diversifies across analysers

§4.2: `score` is *"0…1, calibrated within this vault and this analyser"*.
§7.2: MMR diversification happens *"across categories at the bundle level"*.

MMR requires comparable relevance across the things it diversifies. With
per-analyser normalisation the score's scale is arbitrary, so whichever analyser
has the widest internal spread will dominate the entire budget, and the cap
structure will not save you — MMR will rank its items top. Either define the
cross-analyser comparable quantity (severity ÷ effort is already reaching for
this; an expected-value formulation — P(action) × severity — would make it
explicit) or run MMR *within* categories only and use severity ÷ effort between
them. As written, the two sections cannot both be implemented as stated.

### E3. Percentile-calibrated confidence produces forced positives

`confidence: "strong" | "moderate" | "weak"`, derived from a within-vault
percentile cut, guarantees that **every** vault has a "strong" card — including a
vault with no structure at all. The top of a list of three pairs is not evidence
of anything. This directly conflicts with §5.2's cold-start gate, which requires
the analyser to *report low confidence* below ~80 notes: that requires the ability
to emit nothing, which a percentile cut cannot express.

Add an absolute floor (e.g. minimum shared-neighbour count or AA value) and make
`"none"` / an empty `findings` array a first-class outcome with a defined panel
state. Also decide the first-run behaviour of `fingerprint` — on install,
*everything* is "new since last visit", which is exactly the moment the user
forms their opinion of the panel.

---

## F. Scheduling and prerequisites

### F1. Phase 5's prerequisite is overstated: `stat` comes first, history second

§5.5: *"The prerequisite is decided now … an append-only edge-history
snapshot."* But only two of its four analysers need it:

| analyser | needs | available |
|---|---|---|
| `orphan-aging` | `created` + link count | **today**, via a vault-adapter method |
| `stale-hub` | degree + `modified` | **today**, via a vault-adapter method |
| `emerging`/`fading-topic` | counts per window | needs history |
| temporal split (§8.2) | edge first-seen | needs history |

`VaultAdapter` is `configDir / listMarkdownFiles / read / exists / write`
(`src/core/vault.ts:7-23`) — there is no `stat`. Obsidian's `TFile.stat` provides
`ctime` and `mtime`, so the whole gap is **one adapter method plus two fields on
`GraphNode`**, not the history file. Splitting Phase 5 lets two verifiable,
high-trust analysers ("you link to this from 30 notes and have not touched it in
14 months") ship in weeks instead of after a history file exists.

### F2. The snapshot starts empty, so its own gate cannot pass for months

Phase 5's gate includes *"temporal split reports its sample size"*. On the day it
ships that number is **0**, and it will stay unusable for months. Ship the file —
the "value compounds and cannot be recovered later" argument is correct — but make
the temporal split a *report*, not a gate, and remove it from Phase 5's
acceptance criteria.

### F3. The plan measures accuracy and never stability — and the repo already has the tool

`scripts/stability-eval.ts` measures how a partition moves under perturbation
(node insertion order, dropped links, resolution jitter), reported as Adjusted
Rand Index plus how often a cluster's core note changes. The plan cites
`weight-eval.ts` twice and never mentions it.

This matters because **stability is the property the user actually experiences**:
every file save triggers a rebuild (§6.1), the panel's trust argument depends on
it (§7.2: "a list that never changes trains dismissal"), and a top-6 list that
reshuffles after every keystroke is worse than a stale one. Reuse the protocol on
the finding list: top-6 Jaccard across a perturbation, plus "does a dismissal
survive a rebuild". The latter is the natural regression test for E1.

### F4. Phase 7 should start at Phase 0, not Phase 2

§5.7 says measurement "starts at Phase 2". Phase 0's acceptance criterion — *"one
file save = one build for N views, asserted by a test"* — is itself a measurement,
and Phase 0 changes the hottest path in the plugin. The harness belongs with
Phase 0.

### F5. Phase 0's blast radius is bigger than "small, testable change"

The plan is right that `getGraph()` is a concurrency guard rather than a cache
(`buildPromise` cleared in `finally`, `main.ts:493-499`) and that a save costs
N+1 builds for N views — I confirmed the control flow:
`applyRebuiltGraph` awaits `getGraph()` (clearing `buildPromise`), then awaits
`setGraphFromPlugin()` per view, and `reload()` calls `getGraph()` again
(`graph-view.ts:244-245`, `:350-355`). Two open views = 3 builds and 3
`analyzeGraph` calls.

But note what else lives in that region: `previousCommunities:
this.cachedGraph.communities` (`main.ts:484`) is what keeps cluster colours stable
across rebuilds, and `requestGraphRebuild` empties `cachedGraph` first
(`main.ts:433`). The file-save path does *not* go through `requestGraphRebuild`
(it goes `vault.on("modify") → scheduleRebuild`, `main.ts:130-134`), so stability
survives today — but any cache rewrite must preserve that distinction. Add
"community ids are stable across a rebuild" to Phase 0's assertions, because it is
the thing a cache fix is most likely to break silently.

---

## G. The three decisions in §11 — my recommendations

1. **Message keys in findings.** Agree, no reservations. Keys and params are
   data, so `core/**` stays pure, `i18n.ts` stays import-free, and it fixes L10
   and half of L6 in one move. This is the best-designed part of the plan.
2. **How far to go on scoring.** Do **not** fit logistic regression offline, and
   do not ship fitted coefficients. The data is one vault, one link set, ~40
   positives per split, 20 correlated splits, three signals that the plan's own
   CI cannot separate, and a 3 % positive rate with heavy tie mass. Weights fitted
   on that will overfit and will change between sessions — the exact failure §5.6
   warns about for click-feedback. Ship normalised signals + named evidence +
   bands. Revisit when there are either ≥3 vaults or the history file supplies
   negatives that actually matter (B1).
3. **Phase 5 scope.** Edge-history snapshot: **yes, in scope** — cheap and
   unrecoverable if missed. But **do not** gate `orphan-aging` / `stale-hub` on it
   (F1), and do not gate on the temporal split (F2). Community drift out of scope:
   agreed, and the reason given (insufficient history) is correct.

---

## H. What I would change before Phase 1 starts

Ordered by value per unit of work:

1. **Rebuild §3.2's probe and commit it.** Print the seed, the pool size, the
   positive rate, the coverage, and the protocol in link counts. Replace the
   quoted numbers with a command line. (§A1–A3, §8.1)
2. **Add candidate coverage to the harness, with a floor.** It is the only metric
   that catches C1, and it is ~15 lines. Report it beside every P@K.
3. **Drop the degree cap; sample the expansions instead.** Keep excluding
   structural pages as *endpoints* (accepting the measured 6 pp cost knowingly),
   keep them as evidence. (§C1)
4. **Rewrite the Phase 2 gate**: primary endpoint P@6 on the 2-hop pool, paired
   over ≥ 20 splits, gate on the lower bound of the paired CI against a single
   fixed AA baseline, plus coverage ≥ 85 %. Keep the point estimate in the output,
   out of the gate. (§C)
5. **Fix the two key designs into one** and write the Arrow E regression test.
   (§E1)
6. **Define the cross-analyser comparable score** (or scope MMR to within
   category) and give `confidence` an absolute floor with a legal empty result.
   (§E2, §E3)
7. **Split Phase 5**: `stat`-based aging/staleness first, history-based bursts and
   temporal splits second. (§F1, §F2)
8. **Run the human rating study before freezing the objective**, not after
   Phase 2 ships. 100 blind items on one vault is enough to detect a 2:1 effect.
   (§B, §8.4)
9. **Measure unlinked-mention precision offline, today**, before committing
   Phase 4 to the plan's own "highest-value" label. (§D1)
10. **Reuse `stability-eval.ts`** for top-6 churn and dismissal survival. (§F3)

Item 1 inverts the plan's own sequencing slightly: it makes §8.1's harness the
first deliverable rather than Phase 2's companion, because Phase 0, Phase 1's
"identical cards" claim, and Phase 2's gate all depend on it.

---

## Appendix — how to reproduce this review

The probes are outside the repository (so `git status` stays clean) at
`D:\Progect\插件开发\_dsreview\`:

```
repro.ts    §3.2's protocol, both readings, + coverage + degraded V1 + AUC/P@K
repro2.ts   tie structure, CN distribution, candidate-rule coverage costs
repro3.ts   precision curve P@1…P@50, and top-10 vs ground-truth composition
```

Built and run with the repository's own esbuild, from `enhanced-graph/`:

```
node node_modules/esbuild/bin/esbuild ../_dsreview/repro.ts --bundle \
  --platform=node --format=cjs --outfile=../_dsreview/repro.cjs
node ../_dsreview/repro.cjs
```

All trials use a fixed seed (`20261010`), 20 trials, and the repository's own
`buildWikiGraph` against the real vault, so the graph facts are the production
pipeline's, not a re-derivation. These are close to the harness §8.1 describes;
promote them into `scripts/insight-eval.ts` rather than rewriting them.

**Verified by running:** `tsc --noEmit` (exit 0), all graph facts, all P@K / AUC
/ coverage / composition numbers above, `analyzeGraph` runtime, the 542 `it(`
count, the N+1 build path (control flow, not instrumented).

**Not verified, and said so where it matters:** the 565 test count (vitest cannot
start in this sandbox — vite's esbuild and `child_process` spawns fail with
EPERM); the plan's synthetic benchmark table (§5, Appendix A) was not re-run; no
claim here rests on a human relevance label, so §B is a measured *composition*
difference and an argument, not a demonstrated user-perception result.
