---
name: release-prep
description: Orchestrate the pre-release flow for grafana-pathfinder-app — bump the version in package.json, draft a CHANGELOG entry (via the `changelog` skill), run `npm run check` and `npm run build`, then print the exact `git tag` command for the user to execute. Never creates or pushes the tag itself; tagging is a one-way door the user owns.
---

# Release prep

Pre-release orchestrator. Handles the safe, reversible parts of cutting a release (version bump, changelog, validation) and stops short of the irreversible step (tag push) so the user reviews everything before the GitHub release workflow fires.

This skill pairs with `.cursor/skills/changelog/SKILL.md`, which drafts the actual CHANGELOG entry. `release-prep` is the wrapper that runs `changelog` plus the surrounding validation.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Never create or push the git tag.** Print the exact command for the user to run. The user controls the moment of release.
2. **Never push commits.** Stay on the local branch.
3. **`npm run check` must pass before claiming "ready".** If it fails, abort with the failure log and stop. Do not "fix-up and retry" — a failing check is real signal.
4. **Only edit `package.json` (version bump) and `CHANGELOG.md`** (via the `changelog` skill). No other files.
5. **If the proposed tag already exists**, abort.
6. **If the working tree is dirty**, abort with `git status` output. Don't try to be clever about which dirt is safe.
7. **One commit.** Title: `chore: prep v<version> release`. Contains the version bump + CHANGELOG draft.

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

1. Read `package.json`. Locate the `"version"` field.
2. Replace the value with the target version (no `v` prefix in `package.json` — just `"2.11.0"`).
3. Run `npm run prettier` on `package.json` to keep formatting canonical.

**Do not stage or commit yet** — combine with the CHANGELOG draft into one commit at the end of Phase 3.

### Phase 3 — Draft CHANGELOG

Invoke the `changelog` skill (or replicate its Phase 1-3 inline if the skill is unavailable). Pass the target version explicitly.

When the `changelog` skill is invoked from `release-prep`, override its Phase 3 commit step:

- The `changelog` skill normally commits with `chore: changelog for v<version>`.
- When called as a sub-step of `release-prep`, **skip the commit** so we can combine `package.json` + `CHANGELOG.md` into one atomic release-prep commit.
- Surface this expectation to the user in the run output: "CHANGELOG drafted in-tree but not yet committed; combining with version bump."

### Phase 4 — Validate

1. **Run `npm run check`** — the canonical pre-merge gate:

   ```
   npm run check
   ```

   This runs (per `package.json`): typecheck + lint + prettier-test + docs:sync-terms:check + lint:go + test:go + test:ci. If any step fails, **abort**. Print the failure log verbatim. Do not commit. Do not retry.

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

   Must be exactly:

   ```
   CHANGELOG.md
   package.json
   ```

   If anything else appears, abort. The skill should never modify other files.

2. **Commit** (do not push):

   ```
   git add CHANGELOG.md package.json
   git commit -m "chore: prep v<version> release"
   ```

3. **Print the release summary**:

   ```
   Ready to release v<version>.

   Previous: v<last-version>
   Included: <N> PRs (<X> added, <Y> fixed, <Z> chore)

   To cut the release, run:

     git push origin main
     git tag -a v<version> -m "Release v<version>"
     git push origin v<version>

   The `release.yml` workflow triggers on `v*` tag push and creates the GitHub release.
   ```

   Order matters: push the commit first so the tag points at an upstream-known SHA, then tag, then push the tag. Confirm this order with the user if they're unfamiliar.

## Reuses

- `.cursor/skills/changelog/SKILL.md` — drafts the changelog entry. Run as a sub-skill.
- `npm run check` — single command for the pre-merge gate. Defined in `package.json`.
- `npm run build` — production build verification.
- `docs/developer/RELEASE_PROCESS.md` — canonical release reference. If this skill diverges from that doc, update the doc.

## Integration

- Invoked manually by the maintainer before each release.
- Pairs with `release.yml` GitHub workflow (which fires on `v*` tag push) — the skill ends where the workflow begins.
- Pairs with `/changelog` — release-prep calls it as a sub-step.

## Abort conditions

The skill must abort cleanly (no partial state, no commits) if any of these are true:

| Condition                                     | Reason                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| Working tree dirty                            | Cannot reason about what state is being released          |
| Branch behind origin                          | Upstream commits would be missing from the release        |
| Tag `v<version>` already exists               | Cannot reuse a tag; double-tagging breaks GitHub releases |
| Version is not strictly > last tag            | Regression — semver violation                             |
| `npm run check` fails                         | Test suite or lint catches a real problem                 |
| `npm run build` fails                         | Production bundle is broken                               |
| `git diff --name-only` shows unexpected paths | Skill must only touch package.json + CHANGELOG.md         |

When aborting, print the failure reason clearly and (where applicable) the exact log line that triggered the abort. Do not leave partial commits behind.

## Context window management

- Phase 0: a handful of `git` invocations; minimal context.
- Phase 1: optional sub-invocation of `changelog` Phase 1-2 logic (PR list summary).
- Phase 2: small edit to `package.json` via `Edit`.
- Phase 3: delegate to `changelog` skill — its own context budget.
- Phase 4: stream `npm run check` and `npm run build` output; on success, summarize; on failure, surface the relevant log lines.
- Phase 5: one commit + report.

Total context per run: under 30k tokens for a typical release. Pull `npm run check` into the conversation lazily — only surface failing lines, not the whole pass log.

## Expected invocation patterns

- **Routine release**: maintainer runs `/release-prep <version>` (or `/release-prep` for an auto-suggested version) before each release window.
- **Sprint review**: maintainer runs `/release-prep` without confirming, captures the category counts + suggested version, and uses that to communicate scope. Then reverts the local changes and reruns once the release window is open.
- **Post-incident hotfix**: maintainer runs `/release-prep <patch-version>` for an urgent fix. The skill enforces the same gates (`npm run check` must pass) without bypass.

## What this skill does NOT do

- Push commits or tags
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
✓ CHANGELOG drafted (3 added, 7 fixed, 5 chore)
✓ npm run check (132 suites, 2511 tests, all passing)
✓ npm run build (bundle produced)
✓ Committed: chore: prep v2.11.0 release

Ready to release v2.11.0.

To cut the release, run:

  git push origin main
  git tag -a v2.11.0 -m "Release v2.11.0"
  git push origin v2.11.0

The `release.yml` workflow triggers on `v*` tag push and creates the GitHub release.
```
