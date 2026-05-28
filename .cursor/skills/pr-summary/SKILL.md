---
name: pr-summary
description: Generate a structured PR description from the current diff using `docs/design/CONCERNS.md` routing. Interviews the author for motivation before drafting. Produces canonical sections (Summary, What to look at, Why, How to verify, Breaking changes, Reversibility) tailored to change type. Outputs the draft for human review; can apply via `gh pr edit` after explicit confirmation. Pair with `/review` — this skill drafts, `/review` reviews.
---

# PR summary

Drafts a complete PR description from the diff. Before writing, it interviews the author for the "why" content the diff cannot supply — the problem, the rejected alternatives, the reviewer gotchas. The canonical sections (Summary, What to look at, Why, How to verify, Breaking changes, Reversibility) map to the schema in `docs/design/PR_REVIEW.md` so reviewers can route quickly.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Output is a draft, not an auto-applied PR edit.** Print the draft body in a fenced markdown block. Only call `gh pr edit --body-file <tmp>` after the user explicitly confirms in the same turn.
2. **Never invent test results.** The How to verify section lists what should be run; never claim anything is passing unless the user has actually run it in this session and you have the output.
3. **Activated concerns come from `docs/design/CONCERNS.md` routing** — `trigger_paths` and `trigger_keywords` matched by the diff. Do not list concerns the diff doesn't touch.
4. **Sentence case** for headings, table cells, and bullet text. No title case. Proper nouns: Grafana, Loki, Prometheus, Tempo, Mimir, Alloy, Grafana Cloud, Grafana Enterprise, Grafana Labs.
5. **No unrelated boilerplate.** A typo fix doesn't need a Reversibility section. A two-line fix doesn't need a subsystem table. Match section depth to change weight.
6. **No source code edits.** This skill only reads — and at most calls `gh pr edit`.
7. **No CI-enforced commands in How to verify.** CI automatically runs typecheck, lint, prettier, and the test suite on every PR. Do not include steps like `npm run check`, `npm run typecheck`, `npm run test:ci`, or `npm run lint` — they add no information a reviewer can act on. The section must contain only PR-specific manual verification: reproduction steps, UI interactions, edge cases, or integration scenarios CI cannot exercise.
8. **All file links use the head-commit SHA, not a branch or `main`.** Format: `$REMOTE_URL/blob/$HEAD_SHA/path/to/file`. Never write `../blob/<branch>/...` or `.../blob/main/...` — these go stale the moment the branch is deleted or the file moves.
9. **No bare artifact codes.** Never write "per A1", "see QC8", or any other section code in isolation. If you link to a design doc or reference a named section, include a one-sentence inline description of what it says. The PR body must be self-standing without requiring the reader to follow the link to parse the sentence.

## Operating modes

- **Draft mode** (default): print the draft body in a fenced block. Author copy-pastes into the PR description manually. No tool side effects.
- **Apply mode** (`--apply`): if the user invokes `/pr-summary --apply` or replies "apply" after seeing the draft, write the body to a temp file and call `gh pr edit <number> --body-file <tmp>`. Confirm the PR number from `gh pr view --json number`. Requires an existing PR.
- **Open mode** (`--open`): draft as normal, then on confirmation push the branch (if not already pushed) and call `gh pr create` with the title and body. Use when no PR exists yet and you want the skill to open it.
- **Quick mode** (`--quick`): skip Phase 0.5 author interview entirely. Combinable with `--open` or `--apply`. Useful for small chores, dependency bumps, or when the commit bodies already contain substantive motivation.

## Canonical structure

```markdown
## Summary

<1-3 sentence pitch framing the behavior change and why it matters for the reviewer's mental model>

## What to look at

<one bullet per subsystem — name the load-bearing change and the key interaction to trace, not the file list>

## Why

<motivation: the constraint, the rejected alternative, the user or system reason>

## How to verify

<numbered steps — PR-specific manual verification only>
<CI runs typecheck, lint, and tests automatically — omit those>

## Breaking changes

None. | <explicit callout if any>

## Reversibility

<one paragraph — only include when reversibility is non-obvious or a one-way door exists>

## Out of scope

<only include for series PRs or when deliberate omissions need flagging>

<Fixes #NNN | Refs #MMM | Closes #PPP>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Variants by change type

Match section depth to change weight:

| Type           | Required sections                                                 | Optional / typical                                                             |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **feat**       | Summary, What to look at, Why, How to verify, Breaking changes    | Reversibility; Out of scope for series work                                    |
| **fix**        | Summary (problem + root cause + fix in 3-4 lines), How to verify  | Issue ref. Why is usually implicit in Summary. Breaking changes if applicable. |
| **refactor**   | Summary, Why, What to look at, Out of scope, How to verify        | Breaking changes if behavior-visible; Reversibility if state is touched        |
| **chore/deps** | Summary, What to look at (brief), How to verify (minimal or omit) | Skip Why (self-evident). Renovate PRs handle themselves — detect and skip.     |
| **docs**       | Summary, What to look at (list of docs), How to verify            | Why (if non-obvious). Link to rendered docs when useful.                       |

## Workflow

### Phase 0 — Resolve scope

1. Determine the base ref:

   ```
   gh pr view --json baseRefName -q .baseRefName 2>/dev/null \
     || git symbolic-ref refs/remotes/origin/HEAD --short | sed 's@^origin/@@'
   ```

   Default to `main` if neither resolves.

2. Capture the head commit SHA and derive the GitHub remote URL — used for all file links in the output (constraint 8):

   ```bash
   HEAD_SHA=$(git rev-parse HEAD)
   REMOTE_URL=$(git remote get-url origin | sed 's/\.git$//' | sed 's/git@github\.com:/https:\/\/github.com\//')
   ```

   File links throughout the draft must use `$REMOTE_URL/blob/$HEAD_SHA/path/to/file`.

3. Capture the diff in three forms:

   ```
   git diff --stat <base>...HEAD
   git diff --name-status <base>...HEAD
   git log <base>..HEAD --format='%h %s%n%n%b%n---'
   ```

   The `git log` output preserves commit bodies so you can extract motivation.

4. Read the **most recent commit body** in full — it sometimes contains the substantive `Why` content. A commit body is substantive when it contains ≥2 sentences of motivation text beyond the subject line (excluding `Co-authored-by:` trailers and similar footers).

5. If running on a PR branch, also capture: `gh pr view --json number,title,body,labels`. The existing title and body may already contain useful context to preserve.

6. **Pre-flight advisory.** If the change is non-trivial (more than 3 changed source files, primary class `product-runtime` or `mixed`), and commit messages show no evidence of prior skill runs (no `chore(techdebt):`, `fix(techdebt):`, `chore(secure):`, `fix(security):` prefixes, and branch name does not match `techdebt/` or `secure/`), emit a brief single-line note before proceeding:

   > Tip: consider running `/techdebt <changed-dirs>` and `/secure` before opening — issues caught here won't surface in the reviewer's report.

   This is advisory only; proceed immediately regardless of response.

### Phase 0.5 — Author interview

**When to run**: run this phase when commit bodies are thin (no substantive motivation found in Phase 0), unless the change type is `chore`/`deps`/Renovate/Dependabot, or the user invoked `--quick`.

**When to skip**: Renovate/Dependabot branch, `--quick` flag, or commit bodies already contain substantive motivation for all three questions below.

Ask the author these three questions. Use them verbatim — they are calibrated to surface content the diff cannot supply:

> **Before I draft — three quick questions:**
>
> 1. **Problem statement**: What problem does this solve? (1–2 sentences framing it for a reviewer who hasn't seen the context)
> 2. **Rejected alternatives**: Did you consider a different approach and decide against it? If so, why?
> 3. **Reviewer gotchas**: Is there anything in this diff that might look wrong but is actually correct? Any subtle constraints or invariants the reviewer should know about?

Wait for the author's answers before proceeding to Phase 1. Incorporate the answers directly into Phase 2 drafting — they are primary source material for the **Why** and **How to verify** sections. Do not fabricate answers if the author skips a question; leave `[FILL IN: …]` for that item.

If the author's answer to question 3 reveals a subtle invariant (e.g., "the retry loop threads the AbortController signal — looks like it ignores it but doesn't"), surface that in the **What to look at** bullet for the relevant file, not just in Why.

### Phase 1 — Classify the change

1. Inspect commit subjects + diff stat. Pick a **primary class**:

   | Signal                                                | Class                            |
   | ----------------------------------------------------- | -------------------------------- |
   | All commits prefixed `feat:` / `feat(scope):`         | `feat`                           |
   | All commits prefixed `fix:` / `fix(scope):`           | `fix`                            |
   | All commits prefixed `refactor:` / `refactor(scope):` | `refactor`                       |
   | All commits prefixed `chore(deps):` or `chore:`       | `chore`                          |
   | All commits prefixed `docs:`                          | `docs`                           |
   | Mixed prefixes or no prefix                           | `mixed` (use the dominant class) |

   For `mixed`, pick the class of the largest commit (by line count).

2. Read `docs/design/CONCERNS.md` and walk the routing table. For each concern, compute whether its `trigger_paths` or `trigger_keywords` match any path in `git diff --name-status`. Track:
   - `activated_concerns` — list of concern IDs that fired
   - `activation_reason` — which path or keyword triggered each
   - `likely_one_way_doors` — copy any concern's `one_way_doors` field if that concern was activated AND the changed files include the one-way-door surface

3. **Skill lineage detection.** Scan commit subjects and the branch name for evidence that this PR was generated or shaped by a skill run:

   | Pattern                                                                     | Lineage to record   |
   | --------------------------------------------------------------------------- | ------------------- |
   | Commit subject matches `chore(techdebt):` / `fix(techdebt):`                | `/techdebt` audit   |
   | Commit subject matches `fix(secure):` / `chore(secure):` / `fix(security):` | `/secure` audit     |
   | Branch name matches `bugfix/` + issue number                                | `/bugfix` workflow  |
   | Branch name matches `techdebt/` / `secure/`                                 | corresponding skill |

   If lineage is detected, set `detected_skill_lineage` with the skill name and approximate commit date. This will be surfaced in the Summary.

4. Detect Renovate / Dependabot. If the branch name matches `renovate/` or `dependabot/`, exit early with a one-line draft: `chore(deps): <dep-name> bump to <version>`. Renovate's auto-generated body is fine as-is; do not overwrite.

5. Detect series PRs. A PR is a series member when: commit messages contain "Part N of M" or "N/M", or the PR body/title references "series", or multiple related issues are referenced, or the Out of scope section from a prior PR in the branch history is still relevant. Set `is_series_pr = true` when detected.

### Phase 2 — Draft each section

**Summary**:

- One to three sentences for a typical change.
- Lead with the user-facing behavior change ("Sidebar tabs survive the toggle"), not the implementation ("Refactored useTabState").
- If `detected_skill_lineage` is set, append to Summary: "Implements findings from a [skill] run on [branch/date]." (e.g., "Implements findings from a `/techdebt` audit of `src/context-engine`.")
- Multi-phase / multi-commit features: use a bullet list, one bullet per logical phase, terse.

**What to look at**:

- Group by touched subsystem. The grouping key is the directory: `src/<engine>/`, `src/components/<panel>/`, `pkg/plugin/`, `docs/developer/`, etc.
- One bullet per subsystem. Do **not** list test files as their own bullet — they belong in How to verify.
- For each bullet, name the **load-bearing change and the key interaction to trace**, not the file list. The question to answer: "what should the reviewer look at closely, and why?"
- If Phase 0.5 produced a reviewer gotcha for a file, fold that into the relevant bullet: "… — note that X looks like Y but is actually Z."
- For backend HTTP route changes, name the route explicitly.
- Omit this section for tiny fixes (≤2 files, single concern) where Summary already conveys what matters.

**Why**:

- Primary source: answers from Phase 0.5 questions 1 and 2.
- Secondary source: commit bodies from Phase 0.
- If linked to a GitHub issue (`Fixes #NNN` / `Refs #MMM`), read the issue title and add it as context.
- If none of the above provide clear motivation, emit `[FILL IN: motivation]` and let the author finish. **Do not fabricate.**
- For `fix:` PRs where Summary already states the problem clearly, omit this section.

**How to verify**:

- Numbered steps a reviewer (or the author before opening) can execute to confirm the change works as described.
- **Only PR-specific manual steps.** CI automatically enforces typecheck, lint, prettier, and the full test suite — do not include commands like `npm run check`, `npm run typecheck`, `npm run test:ci`, or `npm run lint`. Including them adds no information a reviewer can act on.
- Add subsystem-specific manual steps based on `activated_concerns`. Examples:
  - `security` activated → "Open the guide panel and inspect the rendered HTML in DevTools — confirm no unsanitized content reaches the DOM"
  - `coda-terminal` activated → "Close and reopen the SSH terminal tab; confirm the session reconnects without a page reload"
  - `interactive-engine` activated → "Run a guide end-to-end: click 'Show me', then 'Do it', confirm the action fires and step advances"
  - `requirements-manager` activated → "Trigger a failed requirement then wait for auto-recovery; confirm the step unblocks"
- For UI work, frame steps as what to click, what to observe, and what the expected outcome is.
- Lead with reproduction steps for bugs — first show how to reproduce the old behavior, then confirm the fix.
- **Never claim a step has passed.** Leave items as prose steps, not checkboxes. The author fills in results when they run them.

**Breaking changes**:

- Always include this section. If there are no breaking changes, write explicitly: `None. This change is additive and fully reversible.`
- If breaking changes exist, describe them plainly: what breaks, for whom, and what migration (if any) is needed.
- "Breaking" includes: changed storage key semantics, changed external API shapes, changed `data-test-*` contract values, changed plugin manifest fields that affect older Grafana versions, config changes required before deployment.

**Reversibility**:

- Include only if `likely_one_way_doors` is non-empty, or if the diff touches storage formats, telemetry, public APIs, plugin manifest, or backend HTTP contracts.
- One paragraph. Flag specific irreversibilities and any mitigation.
- For changes where revert would not restore the system (e.g., a storage migration that has run), say so plainly and note what manual recovery would look like.
- Omit entirely for purely additive changes where Breaking changes already says "None. Fully reversible."

**Out of scope**:

Include this section when any of the following apply:

- The PR is part of a series (`is_series_pr = true`) — name what the subsequent PRs will handle.
- The commit messages or Phase 0.5 answers mention something deliberately left out.
- Activated concerns surface an adjacent area the diff intentionally does not address.

Format: one bullet per item, stating what was left out and why (e.g., "Migration of existing stored tabs — handled in PR #XXX" or "The retry count is currently hardcoded — intentionally not configurable until usage patterns are clearer").

**Issue refs**:

- Pull `Fixes #NNN` / `Refs #MMM` / `Closes #PPP` markers from commit bodies.
- Use `Fixes` for resolved bugs (auto-closes the issue on merge), `Refs` for related work, `Closes` for feature issues.

**Generated footer**:

- Always append:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

### Phase 3 — Render output

1. Compose the body using the canonical structure + variant rules.
2. Print the suggested title: `<prefix>(<scope>): <title>` in sentence case.
3. Print the body in a fenced markdown block — agents that consume this skill's output expect a single fenced block, not a free-form report.
4. After the block, ask: "Apply this to PR #N via `gh pr edit`?" Wait for confirmation before mutating anything.

### Phase 4 — Mutate (only on explicit user confirmation)

If the user does not confirm, exit cleanly without side effects.

**`--apply` path** (existing PR):

1. Write the body to a temp file: `mktemp` or a known path.
2. Call:
   ```
   gh pr edit <number> --title "<suggested-title>" --body-file <tmp>
   ```
3. Confirm success and print the PR URL.

**`--open` path** (new PR):

1. Check whether the branch has an upstream: `git rev-parse --abbrev-ref @{u} 2>/dev/null`. If not, push it: `git push --set-upstream origin <branch>`.
2. Write the body to a temp file.
3. Call:
   ```
   gh pr create --title "<suggested-title>" --body-file <tmp>
   ```
4. Confirm success and print the PR URL.

## Reuses

- `docs/design/CONCERNS.md` — concern routing (trigger_paths, trigger_keywords, one_way_doors).
- `docs/design/PR_REVIEW.md` — reviewer schema for `activated_concerns`, `risk_signals`, `reversibility` (so the draft uses the same vocabulary the reviewer will).
- `.cursor/skills/review/SKILL.md` — orchestration workflow that runs the review (this skill drafts, that one reviews).
- `gh` CLI for reading PR metadata and applying edits.
- Conventional commit prefix parsing — shared with `/changelog`.

## Integration

- **Pairs with `/review`**: this skill drafts, `/review` reviews. Same concern vocabulary, same CONCERNS.md routing.
- Authors invoke this skill **after committing** but **before opening / updating** the PR.
- Can be re-run on an existing PR to refresh the body after new commits land — the apply mode handles this.
- For non-trivial product changes, the recommended author sequence is: skill-assisted analyses on changed dirs → `/pr-summary --open`.

## When to exit cleanly without making changes

- Diff is empty (no commits ahead of base) — exit with "No changes to summarize."
- Branch is a Renovate / Dependabot auto-update — output a one-line draft and exit.
- The user invokes `--apply` but no PR exists for this branch — exit with "No PR found for this branch. Use `--open` to create one."
- The user invokes `--open` but a PR already exists for this branch — exit with "A PR already exists: <URL>. Use `--apply` to update its description."

## Context window management

- Phase 0: ~3 short `git` invocations + one `gh pr view`.
- Phase 0.5: one turn of user conversation; no additional file reads.
- Phase 1: read `CONCERNS.md` once; match against diff paths in memory. Read `github.com` issue title if refs present.
- Phase 2: read the most recent commit body in full; otherwise work from in-memory diff stats.
- Phase 3: render + print.
- Phase 4 (apply): write temp file, run one `gh pr edit`.
- Phase 4 (open): optionally push branch, write temp file, run one `gh pr create`.

Total context per run: well under 30k tokens for a typical PR.

## Expected invocation patterns

- **Open a PR**: author runs `/pr-summary --open` after commits are in place; answers the interview questions; confirms the draft; skill pushes the branch (if needed) and calls `gh pr create`.
- **Open a PR (quick)**: `/pr-summary --open --quick` — skip the interview when commit bodies are already rich.
- **Draft only**: `/pr-summary` — print the draft for manual copy-paste into `gh pr create`. Useful when the author wants to edit the body before opening.
- **Refresh an open PR**: author runs `/pr-summary --apply` after new commits land to update the description.
- **During code review**: reviewer runs `/pr-summary` against the same branch to compare what was written vs. what the diff actually does — a "did the description match reality" sanity check.

## Worked example

Branch `feat/docs-retrieval-cdn-retry` has two commits with thin commit bodies:

```
abc1234 feat(docs-retrieval): add retry logic for CDN fallback
def5678 test(docs-retrieval): cover retry with abort signal
```

`git log` shows no substantive motivation in either body. Phase 0.5 fires:

---

**Before I draft — three quick questions:**

1. **Problem statement**: What problem does this solve?
2. **Rejected alternatives**: Did you consider a different approach and decide against it?
3. **Reviewer gotchas**: Is there anything in this diff that might look wrong but is actually correct?

**Author answers:**

1. CDN returns 503s during rolling deploys. Users saw a blank panel instead of content. Now the fetcher retries 3× with backoff before falling back to bundled content.
2. Considered a circuit breaker but it requires state that outlives the component. The 3-retry stateless approach fits the existing abort-signal pattern without introducing lifecycle coupling.
3. The retry loop threads the existing `AbortController` signal — if the component unmounts mid-retry, the fetch aborts cleanly. Looks like it ignores the signal but doesn't.

---

Draft output:

````
Suggested title: feat(docs-retrieval): add retry logic for CDN fallback

```markdown
## Summary

Add 3-retry-with-backoff logic to the CDN fetch path. When the CDN returns 5xx during a rolling deploy, users previously saw a blank panel; now the fetcher retries before falling back to bundled content.

## What to look at

- `src/docs-retrieval/content-fetcher.ts` — new `retryWithBackoff` wrapper around the fetch call; the retry loop threads the existing `AbortController` signal through each attempt, so it aborts cleanly on unmount despite appearing to ignore the signal
- `src/docs-retrieval/__tests__/content-fetcher.test.ts` — covers the abort-on-unmount case mid-retry

## Why

CDN returns 503s during rolling deploys, causing a blank panel. A circuit breaker was considered but needs state that outlives the component; the 3-retry stateless approach fits the existing abort-signal pattern without lifecycle coupling.

## How to verify

1. Block the CDN domain in DevTools (Network → Blocked URLs). Open the sidebar. Confirm the panel shows bundled fallback content after the retry delay — not a blank panel and not an error state.
2. Open the panel and immediately navigate away while a fetch is in flight. Confirm no "Can't perform a React state update on an unmounted component" warning appears in the console.

## Breaking changes

None. The retry wrapper is internal to `content-fetcher.ts`; existing callers, the fallback chain, and bundled content behavior are unchanged.

Refs #803

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Apply this to PR #847 via `gh pr edit`?
````
