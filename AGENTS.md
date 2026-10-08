# Working agreement for this repository

## Do not release without confirmation

**Stop before tagging. Ask first.**

A release is triggered by pushing a tag, and pushing a tag is the one action here
that cannot be taken back quietly: the workflow creates a published GitHub
release, and the community directory scans it and shows the result to the person
reviewing the plugin.

So the flow is:

1. Make the change.
2. Run the checks (below). They must pass.
3. **Stop.** Report what changed and what the checks said.
4. Wait for an explicit go-ahead.
5. Only then bump `manifest.json`, add the `versions.json` entry, write
   `docs/releases/<version>.md`, commit, tag, and push.

Committing and pushing to `main` is fine on its own — see the trigger below.
Bumping the version is part of the release step, not part of the change.

### What actually triggers a release

```yaml
on:
  push:
    tags:
      - "*"
```

Only a tag push. A commit to `main` publishes nothing, creates no release, and is
not seen by the directory until a release is made from it. So work can be
committed and pushed freely; the tag is the line.

## Checks to run before proposing a release

```
npm run verify            typecheck, unit tests, real-vault assertions,
                          browser harness, built-bundle smoke test
npm run verify:obsidian   assertions inside a real Obsidian (needs the app)
npm run audit:policy      Obsidian developer policies, measured against the code
npm run audit:submission  the plugin submission requirements
```

`audit:submission` expects a published release for the version in `manifest.json`,
so its last two checks fail between a version bump and the release. That is
expected, not a regression.

## How claims are made here

- **Measure, do not assert.** "475 tests pass" is a claim; the command output is
  the evidence for it. Prefer quoting the output.
- **Negative controls.** When something is fixed, break it again and show the
  check failing. A test that passes both before and after a fix is testing
  nothing — that has already happened twice in this repository, once as an
  assertion of `radius > 0` that let a ring ignore the zoom, and once as a test
  that hard-coded a constant and so failed on every unrelated adjustment.
- **Weak assertions are worse than none.** An assertion that cannot fail
  (`expect(undefined).not.toBeNull()`) reports success forever.
- **Say what was not verified.** Where a claim rests on reasoning rather than
  measurement, say so in the same sentence.

## Files that are written for a reader

- `README.md` is English — the plugin directory requires it, and it is what the
  directory renders on the entry page. The Chinese version is `README.zh.md`.
- `manifest.json`'s `description` must not contain the word "Obsidian"; the
  directory's linter rejects it outright. The submission-requirements page says
  the opposite, and the linter wins.
- Process narration does not belong in commit messages or user-facing documents.
