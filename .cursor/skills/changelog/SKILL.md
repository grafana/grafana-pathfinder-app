---
name: changelog
description: Draft a CHANGELOG.md entry from merged PRs since the last release tag. Categorizes by conventional-commit prefix (Added / Fixed / Chore / Security / Changed / Removed), rewrites PR titles into sentence-case narrative bullets with PR refs, and commits to the current branch without pushing. Use when preparing a release, or call this skill from `/release-prep`.
---

# Changelog draft

A focused skill that drafts the next CHANGELOG.md entry from real merged PRs. Replaces a multi-hour manual task with a reviewable diff. The user reviews, edits if needed, and pushes when they're satisfied.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Only edit `CHANGELOG.md`.** Never source, `package.json`, tags, or other docs. Run `git diff --name-only` after edits and abort if anything other than `CHANGELOG.md` is staged.
2. **Do not invent PR numbers.** Every entry must trace to a real merged PR retrieved via `gh pr list` / `gh pr view`. If a PR cannot be confirmed, omit it.
3. **Do not push the commit or open a PR.** Leave the branch as-is so the user can review and push.
4. **Sentence case in entries.** Per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization). Capitalize proper nouns: Grafana, Loki, Prometheus, Tempo, Mimir, Alloy, Grafana Cloud, Grafana Enterprise, Grafana Labs.
5. **Run `npm run prettier` on `CHANGELOG.md` before committing.** Prettier is the canonical formatter; never hand-format tables or wrap manually.
6. **One commit.** Title: `chore: changelog for v<version>`. No co-author lines unless the user instructs.

## Workflow

### Phase 0 — Resolve scope

1. Capture the last release tag:

   ```
   git tag --sort=-v:refname | head -1
   ```

   Format is `v<SemVer>` (e.g., `v2.10.0`).

2. Determine the target version:
   - If the user passed `/changelog <version>`, use that.
   - Otherwise, defer the version suggestion until Phase 2 where you can count PR categories.

3. Verify `package.json`'s `version` field. If it matches the target version, proceed. If it doesn't, warn the user but continue — `/release-prep` handles the bump separately.

4. Capture the date of the last tag (used as the lower bound for the PR search):

   ```
   git log -1 --format=%cI v<last-version>
   ```

### Phase 1 — Gather PRs

1. List merged PRs since the last tag:

   ```
   gh pr list --state merged --base main --search "merged:>=<last-tag-date>" \
     --limit 200 \
     --json number,title,body,labels,mergedAt,author,url
   ```

2. **Filter** the result:
   - Drop Renovate / Dependabot dependency bumps unless they are security PRs. Heuristics for security:
     - Title contains `[SECURITY]`
     - Any label matches `automerge-security-update` or contains `security`
   - Drop PRs whose subject is exclusively `chore(deps):` and have no security signal.
   - Keep everything else.

3. For each kept PR, fetch the first ~30 lines of the body via `gh pr view <number> --json body` if the original listing's body is truncated.

4. Maintain a list of records: `{ number, title, body_snippet, labels, prefix, scope }` where `prefix` is the conventional commit prefix (`feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `test`, etc.) extracted from the title.

### Phase 2 — Categorize and draft

1. **Mapping** (prefix → CHANGELOG section):

   | Prefix                               | Section                                                   |
   | ------------------------------------ | --------------------------------------------------------- |
   | `feat`                               | **Added**                                                 |
   | `fix`                                | **Fixed**                                                 |
   | `refactor`, `perf`, `test`, `style`  | **Chore**                                                 |
   | `chore`                              | **Chore**                                                 |
   | `docs`                               | **Chore** (unless docs are user-facing — judge from body) |
   | `[SECURITY]` title or security label | **Security**                                              |
   | `BREAKING:` body marker              | **Changed** + flag for blockquote preamble at top         |

   Unprefixed PR titles (e.g., "Pathfinder MCP Server - Initial version") get heuristic categorization based on body content. When uncertain, default to **Chore**.

2. **Draft each entry** as:

   ```
   - **<sentence-case title>**: <one or two sentence narrative>. (#<number>)
   ```

   Rules for the title:
   - Drop the conventional prefix (`feat: ` / `fix(scope): `).
   - Rewrite to sentence case. Capitalize only the first word and proper nouns.
   - Keep the scope as part of the narrative if it adds clarity (e.g., "in the block editor", "for OSS recommender mode") rather than as a parenthetical.

   Rules for the narrative:
   - Pull the substantive sentence from the PR body's Summary section. Tighten — one or two sentences max.
   - State user impact, not implementation. "Sidebar tabs survive the toggle" beats "Refactored useTabState hook".
   - Don't quote the PR title verbatim — the bold title already does that.

3. **Suggest the next version** based on the category counts:
   - Any **Changed** entry triggered by `BREAKING:` → major bump
   - Any **Added** → minor bump
   - Else → patch bump

   Print the suggestion before drafting the section. Example:

   ```
   Detected since v2.10.0:
     - 3 feat (Added)
     - 7 fix (Fixed)
     - 5 chore (Chore)
     - 0 breaking, 0 security

   Suggested next version: 2.11.0 (minor bump)
   ```

   If the user supplied a version arg, validate it matches the suggestion. If it doesn't, warn but proceed with the user's version.

4. **Order entries within each section** by:
   - **Added**: most impactful first (longest body, most files touched). Use `gh pr view` metadata.
   - **Fixed**: bugfix urgency — security-adjacent first, then UI / UX, then internal.
   - **Chore**: dependency bumps last (or omitted entirely if low signal).

### Phase 3 — Render and commit

1. Read the current `CHANGELOG.md`.

2. Locate the insertion point: immediately after the `# Changelog` heading, before the previous `## <previous-version>` heading.

3. **Insert the new section** in this template:

   ```markdown
   ## <version>

   <optional blockquote preamble for breaking changes; omit if none>

   ### Added

   - ...

   ### Changed

   - ...

   ### Fixed

   - ...

   ### Security

   - ...

   ### Chore

   - ...

   ### Removed

   - ...
   ```

   **Omit empty sub-sections.** A patch-only release with no entries can use the placeholder `_Patch release — version bump only._` instead of empty sections.

4. **Format**: run `npm run prettier`. Confirm only `CHANGELOG.md` was changed:

   ```
   git diff --name-only
   ```

   If anything else appears, abort and revert.

5. **Commit**:

   ```
   git add CHANGELOG.md
   git commit -m "chore: changelog for v<version>"
   ```

   Do **not** push.

6. **Print summary**:

   ```
   Drafted v<version> entry — N added, M fixed, P chore (Q security, R removed).
   Review with `git diff HEAD~1` and edit before tagging.
   ```

## Reuses

- `gh` CLI for PR data (same pattern as `maintain-docs`).
- Conventional commit prefix parsing — small regex; no dependency.
- `npm run prettier` for formatting.

## Integration

- **`/release-prep`** calls this skill as part of its draft-changelog phase. The skill must work as both a standalone invocation and a sub-step of `/release-prep`.
- Pairs with manual edits — the draft is a starting point. Authors with deep context will tighten entries before tagging. That's expected and encouraged.

## When to exit cleanly without making changes

- No merged PRs since the last tag — exit with "No new PRs since v<last-version>. Nothing to draft."
- The last tag does not exist (fresh repo, no tags) — exit with "No prior release tag found. Cannot determine scope. Pass a date range explicitly via `--since <date>`."
- `CHANGELOG.md` does not exist — exit with "No CHANGELOG.md found. Create one before invoking this skill."

## Context window management

This skill is small by design:

- Phase 0: 2-3 short `git` invocations.
- Phase 1: one `gh pr list` call (the full result) + targeted `gh pr view` for any PR whose body was truncated.
- Phase 2: in-memory categorization and drafting from the records.
- Phase 3: read CHANGELOG.md (typically < 500 lines), insert the new section, write back.

Total context per run: well under 10k tokens for a typical release with 10-25 PRs. Larger releases scale linearly.

## Expected invocation patterns

- **Before tagging**: maintainer runs `/changelog <next-version>` to draft the section, reviews + edits the commit, then tags.
- **Called from `/release-prep`**: as part of the orchestrated pre-release flow.
- **On-demand audit**: run `/changelog` without a version to see what would land in the next release. The skill prints the category counts and suggested bump without writing — useful for sprint reviews.

## Output examples

### Successful run

```
Drafted v2.11.0 entry — 3 added, 7 fixed, 5 chore.
Review with `git diff HEAD~1` and edit before tagging.
```

### No PRs since last tag

```
No new PRs since v2.10.0 (tagged 2026-04-15). Nothing to draft.
```

### Aborted due to dirty working tree

```
Working tree is dirty. Commit or stash before running /changelog:

 M src/components/Foo.tsx
?? scratch.md

Aborting without changes.
```
