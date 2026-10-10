# Enhanced Graph

A graph view for Obsidian with an association engine, Louvain community detection and graph insights — plus an enhancement layer that overlays the same features on the built-in graph.

[中文说明](README.zh.md)

---

## Features

### Association engine

The association score between any two notes is a weighted sum of four signals:

| Signal | Default weight | What it measures |
| --- | --- | --- |
| **Direct link** | ×4.0 | Notes connected by `[[wikilinks]]`; both directions score full, one direction scores half |
| **Adamic–Adar** | ×2.0 | Common neighbours weighted by how rare each neighbour is |
| **Source overlap** | ×2.0 | Notes sharing an entry in `frontmatter sources[]` |
| **Co-citation** | ×1.0 | Two notes cited by the same third note |

**Every signal is normalised to 0–1 before weighting** (`saturate(x) = x/(1+x)`), so a weight is a statement of relative importance and the per-signal numbers in the tooltip can be compared with each other.

- The coefficients and the clustering resolution live in the view's own **clustering panel** (the 聚类 / Clustering toggle on the toolbar, in the standalone view and in the built-in graph alike). Both are build inputs, so the panel stages the edits and applies them together on its button, which re-scores the vault and re-runs the clustering.
- Hovering an edge shows the full breakdown.
- The command **Copy relevance report** writes a note's top-10 related notes to the clipboard as a Markdown table.

### Community detection

Louvain clustering, with cohesion and mean intra-degree — the latter is independent of community size, so communities can be compared with each other.

### Graph insights

- **Surprising connections** — cross-community, cross-type links
- **Knowledge gaps** — isolated notes, sparse areas, bridge notes
- Each card can be marked as seen

### Built-in graph enhancement (on by default)

Overlays community colouring, the association tooltip, an insights sidebar and click-to-focus on Obsidian's own graph view. Enabling it takes over the graph's color groups; turning it off restores them one by one.

### Standalone view

Toolbar, filters (type / tag / structural / isolated), appearance panel, weights panel, right-click focus and two-point connectivity, and Markdown export of the relevance report.

The **type** rows are the types the vault itself declares: a note with `type: 实验记录` gets its own row, its own count, its own colour and its own filter, so twenty custom types are twenty rows rather than one `other`. **A row says exactly what the frontmatter says** — `synthesis` stays `synthesis` rather than being translated into the interface language, and `paper` stays `paper` rather than being shown as `paper · source`. A note with no type at all shows the type the plugin inferred, which is the internal id. **Colours are assigned per vault, not hashed per name**: each build sorts the declared types and hands each one the next entry of a searched ramp, so two types cannot collide (measured: 13 declared types, 13 colours — a name hash gave 5 distinct colours for 10 names). The ramp's **order** matters as much as its colours, because a vault uses a prefix of it: it is ordered farthest-point, so the closest pair among the first five entries is ΔE 38.5 rather than 19.0, and the 22-colour minimum is unchanged at 19.0. `npm run palette` prints both. Past 22 types the ramp wraps, which is a stated limit rather than an oversight. A known type is shown in the interface language; a custom one keeps the spelling the user wrote, with the normalised type appended when that adds something (`概念 · concept`). Hiding a type matches **both** the declared type and the normalised one, so a `concept` stored in settings still hides a page that declares `type: 概念`. A row is **greyed whenever nothing of that type is on the graph** — whether the user switched it off or another rule emptied it (the workspace, 隐藏索引/概览/日志, a tag, a cluster) — and the row's count stays the vault's own total, so it still says how much is being held back.

**Left-click and right-click on a legend row do different things.** Left-click excludes or restores the type or cluster. **Right-click marks every node of that group with a dot at its centre**, drawn on the same overlay the focus and search marks use, so it follows pan and zoom. A mark is not a filter: nothing is hidden and nothing is rebuilt, and the row shows that it is the one being pointed at. Right-clicking the same row again clears it.

The **structural** switch (隐藏索引 / 概览 / 日志) covers navigational pages, decided two ways: a frontmatter `type` that normalises to `overview` (`overview`, `概述`, `index`, `索引`, `moc`, `目录`, `导航`, `hub`), or a filename that is exactly one of `index`, `overview`, `log`, `purpose`, `schema`, `home`, `readme`, `moc`, `inbox`, `索引`, `概述`, `目录`, `首页`, `概览`, `日志` — or begins with `index`/`overview`/`log`/`purpose`/`schema`/`moc`. A note called `purpose.md` therefore counts as structural on its name alone. The **isolated** switch hides pages with no links anywhere in the vault and deliberately skips structural pages, which that switch owns.

---

## Installation

Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/lkhfrgc/enhanced-graph/releases) into:

```
<your vault>/.obsidian/plugins/enhanced-graph/
```

Restart Obsidian and enable the plugin under **Settings → Community plugins**.

Not yet listed in the community directory.

### Building from source

```bash
npm install
npm run build        # writes main.js into the repository root
npm run build:vault  # writes into the vault this repo is developed against
npm run dev          # watch, writing into the vault
```

---

## Verification

The repository carries reproducible checks rather than manual ones:

```
npm run verify            typecheck + unit tests + real-vault assertions
                          + browser harness + built-bundle smoke test
npm run verify:obsidian   assertions inside a real Obsidian, printing the version
npm run audit:policy      Obsidian developer policies, measured against the code
npm run audit:colors      what colour each declared type gets, and what an older build would draw
npm run audit:submission  the plugin submission requirements
npm run eval:weights      held-out link prediction, for evaluating the weights and any candidate signal
npm run eval:stability    how far the clustering moves when the input moves (ARI + core-note survival)
npm run similarity:scan   line-by-line comparison across the repository
npm run palette           regenerate and measure the palette (ΔE and WCAG contrast)
npm run archive:terms     archive Obsidian's terms and report changes
```

Verified against real Obsidian **1.9.10** and **1.14.4**. `minAppVersion` is 1.9.10.

**Versions not listed here have not been tested.** The built-in graph enhancement is tied to the Obsidian version; where the running app does not support it, the enhancement disables itself and the built-in graph is unaffected.

---

## Known limitations

- **The built-in graph only draws `[[wikilinks]]` that exist.** The most valuable part of the association engine — non-link associations (source overlap, common neighbours, co-citation) — has no corresponding edge there, so those are **only visible in the standalone view**.
- **"Related notes" can return fewer than five.** Pairs scoring zero are dropped rather than given a floor score: better to return less than to recommend something meaningless.
- Building the graph for a large vault takes a moment on first run; the interface shows progress.

---

## Settings

The settings tab holds: interface language, association weights, built-in graph enhancement, and reuse of the built-in graph's layout — plus two buttons that clear dismissed insights and the layout cache.

The **workspace** — which part of the vault the plugin reads at all — is chosen in the filters panel of either view, in its own 工作区 / Workspace group. It is **typed, not picked**: enter a path for the folder to read (`notes/deep`, empty for the whole vault) and paths to leave out, each added to the list as a chip. Both fields suggest the vault's folders as you type, so an exact path does not have to be remembered, and the line under the path field says what it stands for — how many notes, or that no such folder exists and the graph would come back empty. Exclusions match by prefix, so `templates` covers everything under it.

Applying re-reads the vault — it changes which notes exist, not merely which are drawn — so the choices are staged and take effect together on the button. The suggestion list is the vault's own, collected before the scope narrowed it, so a folder the current scope hides is still offered and the scope can always be widened again. Storage is one working folder plus exclusion prefixes (`workingFolder` / `excludeFolders`), shared by both views; it cannot express two disjoint roots, which needs "the whole vault minus everything else" as an approximation.

Every filter group switches like a tab: page types, knowledge clusters, tags, the workspace, and the two visibility switches.

Everything else (colours, filters, appearance — and, in the standalone view, the weights) is edited inside the graph itself, where the effect is visible while you change it.

---

## Licence

**GPL-3.0-only**, full text in [`LICENSE`](LICENSE).

The five third-party libraries bundled into `main.js` are MIT licensed; their copyright notices and full licence texts are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also travels in the bundle's footer.

Upstream attribution is in [`NOTICE`](NOTICE).

No network requests, no telemetry, no self-update.
