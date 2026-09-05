---
name: release-prep
description: Orchestrate the pre-release flow for grafana-pathfinder-app — cut a release branch off origin/main to freeze scope, bump the version in package.json, draft a CHANGELOG entry (via the `changelog` skill), run `npm run check` and `npm run build`, then print the exact `git push`/`git tag` commands for the user to execute. Never pushes the branch or the tag itself; both are one-way doors the user owns.
---

# Release prep

Pre-release orchestrator. Handles the safe, reversible parts of cutting a release (branch, version bump, changelog, validation) and stops short of the irreversible steps (branch push, tag push) so the user reviews everything before the GitHub release workflow fires.

This skill pairs with `.cursor/skills/changelog/SKILL.md`, which drafts the actual CHANGELOG entry. `release-prep` is the wrapper that runs `changelog` plus the surrounding validation.

## Why a release branch instead of prepping on main

Earlier versions of this skill worked directly on `main` and printed `git push origin main` as the last step. That races: anything merged to `main` between drafting the changelog and actually pushing lands in the release with no changelog entry, and — because `main` is protected — a "push directly" step never actually worked anyway. Cutting a fresh `release/v<version>` branch off `origin/main` the moment prep starts freezes the release's scope immediately: everything merged to `main` afterward simply rolls into the next release instead of racing this one. The GitHub tag itself was always race-free (a tag pins an exact SHA), but a `workflow_dispatch` input like `publish.yml`'s `branch` field re-resolves a branch name live — so pointing that at `main` would silently reintroduce the same race for the Cloud publish step. Point it at the release branch instead.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Never create or push the git tag.** Print the exact command for the user to run. The user controls the moment of release.
2. **Never push the release branch, and never push to `main`.** Commit locally on `release/v<version>` and print the exact `git push` command for the user to run. Pushing (and any Cloud `workflow_dispatch`) requires the user's explicit go-ahead in chat each time — this skill does not carry standing authorization to push, even though the release-branch pattern depends on that branch eventually reaching origin.
3. **`npm run check` must pass before claiming "ready".** If it fails, abort with the failure log and stop. Do not "fix-up and retry" — a failing check is real signal.
4. **Only edit `package.json` (version bump), `package-lock.json` (synced version fields), and `CHANGELOG.md`** (via the `changelog` skill). No other files. `src/plugin.json` carries `"%VERSION%"` and is substituted at build time — never edit it.
5. **If the proposed tag already exists**, abort.
6. **If the working tree is dirty**, abort with `git status` output. Don't try to be clever about which dirt is safe.
7. **One commit** for the version bump + CHANGELOG (title: `chore: prep v<version> release`) — unless the changelog was already merged to `main` independently before prep started, in which case the CHANGELOG.md edit is skipped and this becomes a version-bump-only commit. Either way, one commit on the release branch.

## Workflow

### Phase 0 — Cut the release branch

1. **Clean working tree**:

   ```
   git status --short
   ```

   Must be empty. Abort otherwise.

2. **Fetch and read the actual current tip of origin/main** — this is the moment that freezes the release's scope, so do it first, not after drafting anything:

   ```
   git fetch origin main
   git log origin/main -1 --format='%H %cI %s'
   ```

3. **Check the CHANGELOG on origin/main for an existing entry at the target version** before assuming one needs drafting:

   ```
   git show origin/main:CHANGELOG.md | head -5
   ```

   If a matching `## <version>` section is already there (someone ran `/changelog` and merged it separately, as happened for v2.17.0), Phase 3 skips drafting and this becomes a version-bump-only commit.

4. **Create the release branch from that exact commit**:

   ```
   git checkout -b release/v<version> origin/main
   ```

   If a same-named local branch already exists from an earlier, abandoned attempt, don't overwrite or delete it blindly — rename it aside (`git branch -m release/v<version> archive/release-v<version>-stale-<date>`) and cut a fresh one. It may be in-progress work from another session.

5. **Capture the last tag**:

   ```
   git tag --sort=-v:refname | head -1
   ```

   Format `v<SemVer>`. If no tags exist, abort with "No prior release tag found. First release must be done manually."

### Phase 1 — Resolve target version

If the user passed `/release-prep <version>`, use it. Otherwise suggest one.

**Version arg validation:**

- Must be valid semver: `\d+\.\d+\.\d+` (no pre-release suffixes — the repo uses none).
- Must be strictly greater than the last tag (no regressions).
- Tag `v<version>` must not already exist: `git tag -l v<version>` returns nothing.

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

**Skip this phase entirely if Phase 0 step 3 already found a `## <version>` section on `origin/main`'s CHANGELOG.md** — someone ran `/changelog` and merged it independently before this release branch was cut. Note that in the run output ("CHANGELOG for v<version> already on main; skipping draft") and proceed straight to Phase 4 with a version-bump-only change set.

Otherwise, invoke the `changelog` skill (or replicate its Phase 1-3 inline if the skill is unavailable). Pass the target version explicitly.

When the `changelog` skill is invoked from `release-prep`, override its Phase 3 commit step:

- The `changelog` skill normally commits with `chore: changelog for v<version>`.
- When called as a sub-step of `release-prep`, **skip the commit** so we can combine `package.json` + `CHANGELOG.md` into one atomic release-prep commit.
- Surface this expectation to the user in the run output: "CHANGELOG drafted in-tree but not yet committed; combining with version bump."

### Phase 4 — Validate

1. **Run `npm run check`** — the canonical pre-merge gate:

   ```
   npm run check
   ```

   The gate announces each step as it starts and stops at the first failure; `npm run check -- --list` prints its composition without running it. If any step fails, **abort**. Print the failure log verbatim. Do not commit. Do not retry.

2. **Run `npm run build`** — confirm the production bundle still builds:

   ```
   npm run build
   ```

   Failure here is rare but blocking. Abort if it fails.

3. **Skip plugin signing.** Per `docs/developer/RELEASE_PROCESS.md`, signing is currently disabled (would require `policy_token` in repo secrets). If signing is re-enabled later, this skill should be updated to run `npm run sign` here.

### Phase 5 — Commit and hand off

1. Verify only the expected files changed:

   ```
   git diff --name-only
   ```

   Must be exactly `package-lock.json` + `package.json`, or those two plus `CHANGELOG.md` if Phase 3 actually drafted one. If anything else appears, abort. The skill should never modify other files.

2. **Commit** (do not push — see hard constraint 2):

   ```
   git add package.json package-lock.json CHANGELOG.md   # omit CHANGELOG.md if Phase 3 was skipped
   git commit -m "chore: prep v<version> release"
   ```

3. **Print the release summary and hand off every remaining step** — pushing the branch, tagging, and pushing the tag are all one-way doors this skill does not take on its own:

   ```
   Ready to release v<version> on release/v<version> (frozen at <short-sha>, off origin/main).

   Previous: v<last-version>
   Included: <N> PRs (<X> added, <Y> fixed, <Z> chore)

   To cut the release, run:

     git push -u origin release/v<version>
     git tag -a v<version> -m "Release v<version>" release/v<version>
     git push origin v<version>

   The `release.yml` workflow triggers on `v*` tag push and creates the GitHub release — it builds
   whatever commit the tag points to, so main can keep moving after this without affecting it.

   If you also publish to Grafana Cloud via `publish.yml` (workflow_dispatch), point its `branch`
   input at `release/v<version>`, not `main` — that input re-resolves live, so `main` would reintroduce
   the exact race this branch exists to avoid.

   The next release's `/changelog` scopes from this tag regardless, so nothing is at risk of being
   missed either way. But if Phase 3 actually drafted a CHANGELOG section here (rather than finding
   one already on main), open a small PR merging that CHANGELOG.md + version bump back into `main` —
   otherwise `main`'s own CHANGELOG.md permanently skips this version's entry.
   ```

   Order matters: push the branch first so the tag points at an upstream-known SHA, then tag, then push the tag.

## Reuses

- `.cursor/skills/changelog/SKILL.md` — drafts the changelog entry. Run as a sub-skill.
- `npm run check` — single command for the pre-merge gate. Its steps are declared in `scripts/check.js`.
- `npm run build` — production build verification.
- `docs/developer/RELEASE_PROCESS.md` — canonical release reference. If this skill diverges from that doc, update the doc.

## Integration

- Invoked manually by the maintainer before each release.
- Pairs with `release.yml` GitHub workflow (which fires on `v*` tag push) — the skill ends where the workflow begins.
- Pairs with `/changelog` — release-prep calls it as a sub-step.

## Abort conditions

The skill must abort cleanly (no partial state, no commits) if any of these are true:

| Condition                                     | Reason                                                                |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Working tree dirty                            | Cannot reason about what state is being released                      |
| `git fetch origin main` fails                 | Cannot freeze scope against a tip we can't confirm                    |
| Tag `v<version>` already exists               | Cannot reuse a tag; double-tagging breaks GitHub releases             |
| Version is not strictly > last tag            | Regression — semver violation                                         |
| `npm run check` fails                         | Test suite or lint catches a real problem                             |
| `npm run build` fails                         | Production bundle is broken                                           |
| `git diff --name-only` shows unexpected paths | Skill must only touch package.json + package-lock.json + CHANGELOG.md |

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

- Push the release branch, commits, or tags
- Merge the release branch back into `main`
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
✓ Fetched origin/main (a1b2c3d)
✓ No v2.11.0 section on main's CHANGELOG.md yet — drafting one
✓ Cut release/v2.11.0 from origin/main
✓ No existing v2.11.0 tag
✓ package.json bumped to 2.11.0
✓ package-lock.json synced (2 version fields)
✓ No other files reference the previous version
✓ CHANGELOG drafted (3 added, 7 fixed, 5 chore)
✓ npm run check (132 suites, 2511 tests, all passing)
✓ npm run build (bundle produced)
✓ Committed on release/v2.11.0: chore: prep v2.11.0 release

Ready to release v2.11.0 on release/v2.11.0 (frozen at a1b2c3d, off origin/main).

To cut the release, run:

  git push -u origin release/v2.11.0
  git tag -a v2.11.0 -m "Release v2.11.0" release/v2.11.0
  git push origin v2.11.0

The `release.yml` workflow triggers on `v*` tag push and creates the GitHub release — it builds
whatever commit the tag points to, so main can keep moving after this without affecting it.

If you also publish to Grafana Cloud via `publish.yml`, point its `branch` input at `release/v2.11.0`,
not `main`.
```
