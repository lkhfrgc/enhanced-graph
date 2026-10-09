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

- Weights are adjustable in the settings tab or from the view's own weights panel; changes rebuild the graph.
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
npm run audit:submission  the plugin submission requirements
npm run eval:weights      held-out link prediction, for evaluating the weights
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

The **workspace** — which part of the vault the plugin reads at all — is chosen in the filters panel of either view, in its own 工作区 / Workspace group. It is one **folder tree**: click a folder's name to read only that folder (or 整个仓库 / the whole vault), tick a folder to leave it and everything under it out, and press **Apply** to take effect. Because a tick excludes a whole subtree, a folder under an excluded one is shown as excluded and cannot be ticked — a flat list of checkboxes claimed those were still being read. Each row carries the note count of its whole subtree, branches fold with the arrow on the left, and a search box narrows the tree to matching folders and the paths down to them, which is what keeps a vault with dozens of nested folders navigable.

Applying re-reads the vault — it changes which notes exist, not merely which are drawn — so the choices are staged and take effect together on the button. The folder list is the vault's own, collected before the scope narrowed it, so a folder the current scope hides is still offered and the scope can always be widened again. Storage is one working folder plus exclusion prefixes (`workingFolder` / `excludeFolders`), shared by both views; it cannot express two disjoint roots, which needs "the whole vault minus everything else" as an approximation.

Every filter group switches like a tab: page types, knowledge clusters, tags, the workspace, and the two visibility switches.

Everything else (colours, filters, appearance — and, in the standalone view, the weights) is edited inside the graph itself, where the effect is visible while you change it.

---

## Licence

**GPL-3.0-only**, full text in [`LICENSE`](LICENSE).

The five third-party libraries bundled into `main.js` are MIT licensed; their copyright notices and full licence texts are in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also travels in the bundle's footer.

Upstream attribution is in [`NOTICE`](NOTICE).

No network requests, no telemetry, no self-update.
