---
name: release-prep
description: Orchestrate the pre-release flow for grafana-pathfinder-app — bump the version in package.json + package-lock.json, draft a CHANGELOG entry (via the `changelog` skill), and run `npm run check` and `npm run build` under the repo's pinned Node (`.nvmrc`). Commits on a branch for a release-prep PR to protected `main`. The release itself is a manual CD deploy (the `Plugins - CD` workflow), NOT a git tag.
---

# Release prep

Pre-release orchestrator. Handles the safe, reversible parts of cutting a release (version bump, changelog, validation) and stops before merging the release-prep PR and running the CD deploy, so the user reviews everything first. Pathfinder is **not** released by pushing a `v*` tag — see `docs/developer/RELEASE_PROCESS.md`; the release is a manual `Plugins - CD` dispatch of `main` to each environment.

This skill pairs with `.cursor/skills/changelog/SKILL.md`, which drafts the actual CHANGELOG entry. `release-prep` is the wrapper that runs `changelog` plus the surrounding validation.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **No git tag.** Pathfinder does not release via tags — the release is a manual CD deploy (`Plugins - CD`). Do not create or push a `v*` tag.
2. **Never commit to or push `main` (it's protected).** Commit on a branch; the release-prep change lands via a PR the user merges. Do not deploy — the user runs the CD dispatch.
3. **`npm run check` must pass before claiming "ready".** If it fails, abort with the failure log and stop. Do not "fix-up and retry" — a failing check is real signal.
4. **Only edit `package.json` (version bump), `package-lock.json` (synced version fields), and `CHANGELOG.md`** (via the `changelog` skill). No other files. `src/plugin.json` carries `"%VERSION%"` and is substituted at build time — never edit it.
5. **If a `v<version>` tag already exists, abort** — version numbers must be unique. Historical `v<version>` tags are used only as version markers / changelog-range boundaries; this skill never creates or pushes one.
6. **If the working tree is dirty**, abort with `git status` output. Don't try to be clever about which dirt is safe.
7. **One commit.** Title: `chore: prep v<version> release`. Contains the version bump (manifest + lockfile) + CHANGELOG draft.

## Workflow

### Phase 0 — Preconditions

Verify the environment is safe to proceed:

1. **Clean working tree**:

   ```
   git status --short
   ```

   Must be empty. Abort otherwise.

2. **On main branch** (or a release branch — warn but allow):

   ```
   git branch --show-current
   ```

   Default expectation: `main`. If on another branch, warn the user — they may be cutting from a release branch intentionally, which is fine, but they should confirm.

3. **In sync with origin**:

   ```
   git fetch origin
   git log HEAD..origin/main --oneline
   ```

   Must be empty (no upstream commits we don't have). Otherwise abort with "Branch is behind origin/main by N commits. Pull first."

4. **Capture the last tag**:

   ```
   git tag --sort=-v:refname | head -1
   ```

   Format `v<SemVer>`. If no tags exist, abort with "No prior release tag found. First release must be done manually."

### Phase 1 — Resolve target version

If the user passed `/release-prep <version>`, use it. Otherwise suggest one.

**Version arg validation:**

- Must be valid semver: `\d+\.\d+\.\d+` (no pre-release suffixes — the repo uses none).
- Must be strictly greater than the last tag (no regressions).
- The version must be unused — no existing `v<version>` tag (`git tag -l v<version>` returns nothing). These tags are historical version markers used for the changelog range, not release triggers; the skill doesn't create one.

**Auto-suggestion** (when no arg given):

Invoke the `changelog` skill's Phase 1 + Phase 2 logic to count categories since the last tag, then suggest:

- Any breaking change → major bump (`X.0.0`)
- Any feat → minor bump (`X.Y.0`, reset patch to 0)
- Else → patch bump (`X.Y.Z+1`)

Print the suggestion and **wait for user confirmation** in the same turn before proceeding. Example:

```
Last release: v2.10.0
Since then: 3 feat, 7 fix, 5 chore, 0 breaking
Suggested: v2.11.0 (minor bump)

Reply with the version to proceed, or override with a different one.
```

### Phase 2 — Bump version

The version lives in **two** files that must stay in lock-step: `package.json` (the manifest) and `package-lock.json` (two occurrences — root `version` + the root project entry under `packages[""].version`). `src/plugin.json` uses the literal `"%VERSION%"` placeholder substituted at build time and must not be edited by this skill.

1. **Edit `package.json`**: replace the `"version"` field's value with the target version (no `v` prefix — just `"2.11.0"`).

2. **Edit `package-lock.json`** — both `version` fields:

   ```
   line 3:  "version": "2.10.0",          → "2.11.0"
   line 9:  "version": "2.10.0",          → "2.11.0"   (under packages[""])
   ```

   **Why a targeted edit and not `npm version` / `npm install --package-lock-only`:** those commands tend to pull in unrelated lockfile churn (peer-flag annotations, resolved-URL or integrity-hash drift, transitive range updates) on top of the version bump. A release-prep PR must contain only the bump, so we edit the two specific lines directly. `npm version <ver> --no-git-tag-version` would also create a commit + ignore the lockfile-only path; `npm install --package-lock-only` updates the lockfile but with the noted churn risk. Targeted edit is the single deterministic option.

   If you ever observe more than the two version lines drifting in the lockfile from a previous developer's `npm install`, that drift is **separate** from the release and belongs in its own `chore(deps)` PR — do not bundle it.

3. **Verify nothing else needs the bump**:

   ```
   rg '"version"\s*:\s*"<previous-version>"' --glob '!node_modules' --glob '!.claude' --glob '!**/dist/**'
   ```

   Expected: only `package.json` and `package-lock.json` (×2). Anything else (e.g., a new manifest a feature PR added) is a signal — surface it to the user before continuing.

4. **Run `npm run prettier`** on the edited files to keep formatting canonical.

**Do not stage or commit yet** — combine with the CHANGELOG draft into one commit at the end of Phase 3.

### Phase 3 — Draft CHANGELOG

Invoke the `changelog` skill (or replicate its Phase 1-3 inline if the skill is unavailable). Pass the target version explicitly.

When the `changelog` skill is invoked from `release-prep`, override its Phase 3 commit step:

- The `changelog` skill normally commits with `chore: changelog for v<version>`.
- When called as a sub-step of `release-prep`, **skip the commit** so we can combine `package.json` + `CHANGELOG.md` into one atomic release-prep commit.
- Surface this expectation to the user in the run output: "CHANGELOG drafted in-tree but not yet committed; combining with version bump."

### Phase 4 — Validate

1. **Run `npm run check`** — the canonical pre-merge gate. **Run it under the repo's pinned Node** (`.nvmrc` = 24.18; the repo requires Node ≥ 24). On an older Node it fails spuriously (e.g. the `import-graph` `node:test` assertion, and the TS/webpack build). If a version manager isn't auto-switching, pin explicitly — e.g. `fnm exec --using 24.18 -- npm run check`.

   ```
   npm run check
   ```

   This runs (per `package.json`): typecheck + lint + prettier-test + docs:sync-terms:check + lint:go + test:go + test:coverage. If any step fails, **abort**. Print the failure log verbatim. Do not commit. Do not retry.

2. **Run `npm run build`** — confirm the production bundle still builds:

   ```
   npm run build
   ```

   Failure here is rare but blocking. Abort if it fails.

3. **Skip plugin signing.** Per `docs/developer/RELEASE_PROCESS.md`, signing is currently disabled (would require `policy_token` in repo secrets). If signing is re-enabled later, this skill should be updated to run `npm run sign` here.

### Phase 5 — Commit on a branch, open the PR, and hand off

1. Verify only the expected files changed:

   ```
   git diff --name-only
   ```

   Must be exactly:

   ```
   CHANGELOG.md
   package-lock.json
   package.json
   ```

   If anything else appears, abort. The skill should never modify other files.

2. **Commit on a release-prep branch** (never on `main` — it's protected):

   ```
   git checkout -b chore/prep-v<version>
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "chore: prep v<version> release"
   git push -u origin chore/prep-v<version>
   ```

3. **Open the release-prep PR** to `main` (`gh pr create --base main`), then **print the summary**:

   ```
   Release-prep PR opened for v<version>.

   Previous: v<last-version>
   Included: <N> PRs (<X> added, <Y> fixed, <Z> chore)

   To release, once the PR is approved + merged to main:
     1. Dispatch "Plugins - CD" (publish.yml): branch=main, environment=dev — verify.
     2. Repeat for ops, then prod-canary, then prod.
     3. For prod-canary + prod, click "Resume" on the paused approval step in the
        Argo UI (argo-workflows.grafana.net, grafana-plugins-cd). Watch #pathfinder-app-release.

   No git tag is involved. See docs/developer/RELEASE_PROCESS.md.
   ```

## Reuses

- `.cursor/skills/changelog/SKILL.md` — drafts the changelog entry. Run as a sub-skill.
- `npm run check` — single command for the pre-merge gate. Defined in `package.json`.
- `npm run build` — production build verification.
- `docs/developer/RELEASE_PROCESS.md` — canonical release reference. If this skill diverges from that doc, update the doc.

## Integration

- Invoked manually by the maintainer before each release.
- The release is a manual `Plugins - CD` (`publish.yml`) dispatch of `main` to each environment — the skill ends where that deploy begins. It does **not** use the tag-based `release.yml` (see `docs/developer/RELEASE_PROCESS.md`).
- Pairs with `/changelog` — release-prep calls it as a sub-step.

## Abort conditions

The skill must abort cleanly (no partial state, no commits) if any of these are true:

| Condition                                     | Reason                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| Working tree dirty                            | Cannot reason about what state is being released                           |
| Branch behind origin                          | Upstream commits would be missing from the release                         |
| `v<version>` version marker already exists    | Version numbers must be unique (these tags mark already-released versions) |
| Version is not strictly > last tag            | Regression — semver violation                                              |
| `npm run check` fails                         | Test suite or lint catches a real problem                                  |
| `npm run build` fails                         | Production bundle is broken                                                |
| `git diff --name-only` shows unexpected paths | Skill must only touch package.json + package-lock.json + CHANGELOG.md      |

When aborting, print the failure reason clearly and (where applicable) the exact log line that triggered the abort. Do not leave partial commits behind.

## Context window management

- Phase 0: a handful of `git` invocations; minimal context.
- Phase 1: optional sub-invocation of `changelog` Phase 1-2 logic (PR list summary).
- Phase 2: small edits to `package.json` (1 line) + `package-lock.json` (2 lines) via `Edit`.
- Phase 3: delegate to `changelog` skill — its own context budget.
- Phase 4: stream `npm run check` and `npm run build` output; on success, summarize; on failure, surface the relevant log lines.
- Phase 5: one commit + report.

Total context per run: under 30k tokens for a typical release. Pull `npm run check` into the conversation lazily — only surface failing lines, not the whole pass log.

## Expected invocation patterns

- **Routine release**: maintainer runs `/release-prep <version>` (or `/release-prep` for an auto-suggested version) before each release window.
- **Sprint review**: maintainer runs `/release-prep` without confirming, captures the category counts + suggested version, and uses that to communicate scope. Then reverts the local changes and reruns once the release window is open.
- **Post-incident hotfix**: maintainer runs `/release-prep <patch-version>` for an urgent fix. The skill enforces the same gates (`npm run check` must pass) without bypass.

## What this skill does NOT do

- Push to `main`, create git tags, merge the release-prep PR, or run the CD deploy
- Sign the plugin (disabled per RELEASE_PROCESS.md)
- Run E2E tests (`npm run e2e` is not part of `npm run check`; if needed, the user runs it separately)
- Coordinate cross-repo releases (e.g., `grafana-recommender`) — out of scope
- Edit `docs/sources/` user-facing docs — those follow a different update cadence
- Bump dependencies — `chore(deps)` PRs are independent of release prep

## Worked example

```
> /release-prep

Last release: v2.10.0 (2026-04-15)
Since then: 3 feat, 7 fix, 5 chore, 0 breaking, 0 security
Suggested: v2.11.0 (minor bump)

Reply with the version to proceed.

> 2.11.0

✓ Working tree clean
✓ On main, in sync with origin
✓ No existing v2.11.0 tag
✓ package.json bumped to 2.11.0
✓ package-lock.json synced (2 version fields)
✓ No other files reference the previous version
✓ CHANGELOG drafted (3 added, 7 fixed, 5 chore)
✓ npm run check (132 suites, 2511 tests, all passing)
✓ npm run build (bundle produced)
✓ Committed on chore/prep-v2.11.0: chore: prep v2.11.0 release
✓ Pushed branch + opened release-prep PR

Release-prep PR opened for v2.11.0.

To release, once the PR is approved + merged to main:
  1. Dispatch "Plugins - CD": branch=main, environment=dev — verify.
  2. Repeat for ops, then prod-canary, then prod.
  3. For prod-canary + prod, click "Resume" on the paused Argo approval step. Watch #pathfinder-app-release.

No git tag is involved.
```
