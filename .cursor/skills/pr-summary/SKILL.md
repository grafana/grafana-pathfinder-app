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
4. **Sentence case per AGENTS.md style.**
5. **No unrelated boilerplate.** A typo fix doesn't need a Reversibility section. A two-line fix doesn't need a subsystem table. Match section depth to change weight.
6. **No source code edits.** This skill only reads — and at most calls `gh pr edit`.
7. **No CI-enforced commands in How to verify.** CI auto-runs typecheck, lint, prettier, and the test suite on every PR. Do not list `npm run check`, `npm run typecheck`, `npm run test:ci`, or `npm run lint` — only PR-specific manual verification (repro steps, UI interactions, edge cases, integration scenarios CI cannot exercise).
8. **All file links use the head-commit SHA, not a branch or `main`.** Format: `$REMOTE_URL/blob/$HEAD_SHA/path/to/file`. Never write `../blob/<branch>/...` or `.../blob/main/...` — these go stale the moment the branch is deleted or the file moves.
9. **No bare artifact codes.** Never write "per A1", "see QC8", or any other section code in isolation. If you link to a design doc or reference a named section, include a one-sentence inline description of what it says. The PR body must be self-standing without requiring the reader to follow the link to parse the sentence.

## Operating modes

- **Draft mode** (default): print the draft body in a fenced block. Author copy-pastes into the PR description manually. No tool side effects.
- **Apply mode** (`--apply`): if the user invokes `/pr-summary --apply` or replies "apply" after seeing the draft, write the body to a temp file and call `gh pr edit <number> --body-file <tmp>`. Confirm the PR number from `gh pr view --json number`. Requires an existing PR.
- **Open mode** (`--open`): draft as normal, then on confirmation push the branch (if not already pushed) and call `gh pr create --draft` with the title and body. Use when no PR exists yet and you want the skill to open it.
  - With `--tidy-history`: before pushing, rewrite commits that lack a conventional-commit prefix. For each commit whose subject does not start with `feat:`/`fix:`/`refactor:`/`chore:`/`docs:`/`test:`/`perf:` (or a scoped variant like `feat(scope):`), infer the prefix from the diff and prepend it to the subject.

    Mechanism: run `git rebase <base> --exec '<amend-script>'` where `<amend-script>` inspects `git log -1 --pretty=%s`, checks for a conventional-commit prefix, and runs `git commit --amend -m "<prefix>: <subject>"` when one is missing. The rebase runs non-interactively; if the exec fails on any commit, the rebase halts and the user can `git rebase --abort` to recover (the backup ref is the deeper safety net).

    Safeguards (non-negotiable):
    - Refuse to run if the working tree is dirty (`git status --porcelain` non-empty) or a rebase/merge is in progress.
    - Create a backup ref before rewriting: `git update-ref refs/backup/tidy-<branch>-<unix-ts> HEAD`. Print the ref so the user can recover with `git reset --hard <backup>`.
    - If the branch is already pushed, push with `git push --force-with-lease` after the rewrite. Never plain `--force`.

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

1. **Sanity-check the branch.** If `git rev-list --count <base>..HEAD` returns `0`, exit with "No changes to summarize." If the branch name matches `renovate/` or `dependabot/`, output a one-line draft (`chore(deps): <dep-name> bump to <version>`) and exit — Renovate's auto-generated body is fine as-is.

2. Determine the base ref:

   ```
   gh pr view --json baseRefName -q .baseRefName 2>/dev/null \
     || git symbolic-ref refs/remotes/origin/HEAD --short | sed 's@^origin/@@'
   ```

   Default to `main` if neither resolves.

3. Capture the head commit SHA and derive the GitHub remote URL — used for all file links in the output (constraint 8):

   ```bash
   HEAD_SHA=$(git rev-parse HEAD)
   REMOTE_URL=$(git remote get-url origin | sed 's/\.git$//' | sed 's/git@github\.com:/https:\/\/github.com\//')
   ```

   File links throughout the draft must use `$REMOTE_URL/blob/$HEAD_SHA/path/to/file`.

4. Capture the diff in three forms:

   ```
   git diff --stat <base>...HEAD
   git diff --name-status <base>...HEAD
   git log <base>..HEAD --format='%h %s%n%n%b%n---'
   ```

   The `git log` output preserves commit bodies so you can extract motivation.

5. Read the commit bodies — they sometimes contain the substantive `Why` content. A commit body is substantive when it contains ≥2 sentences of motivation text beyond the subject line (excluding `Co-authored-by:` trailers and similar footers).

6. If running on a PR branch, also capture: `gh pr view --json number,title,body,labels`. The existing title and body may already contain useful context to preserve.

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

3. **Skill lineage.** If the branch name matches `techdebt/`, `secure/`, or `bugfix/`, or commit prefixes are `chore(techdebt):` / `fix(techdebt):` / `chore(secure):` / `fix(secure):` / `fix(security):`, set `detected_skill_lineage` to the corresponding skill — used to append a credit line to Summary.

4. Detect series PRs. A PR is a series member when: commit messages contain "Part N of M" or "N/M", or the PR body/title references "series", or multiple related issues are referenced, or the Out of scope section from a prior PR in the branch history is still relevant. Set `is_series_pr = true` when detected.

### Phase 2 — Draft each section

**Summary**:

- One to three sentences for a typical change.
- Lead with the user-facing behavior change ("Sidebar tabs survive the toggle"), not the implementation ("Refactored useTabState").
- **Describe net change, not commit history.** The Summary describes the branch as if it were one atomic edit. Intermediate refactor passes, line counts, and "then we also did X" belong in commit messages, not the PR body.
- Avoid: _"Four commits net to: full rewrite, --open mode, constraint tightening, and a trim pass."_ → narrates implementation, not behavior.
- If `detected_skill_lineage` is set, append to Summary: "Implements findings from a [skill] run on [branch/date]." (e.g., "Implements findings from a `/techdebt` audit of `src/context-engine`.")
- For changes with multiple distinct user-facing outcomes (e.g., a feature plus an unrelated retirement), use a bullet list — one bullet per outcome, not per commit.

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
- For `fix:` or `chore:` PRs where Summary already states the problem clearly, omit this section.

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

1. If no PR exists for this branch, exit with "No PR found for this branch. Use `--open` to create one."
2. Write the body to a temp file: `mktemp` or a known path.
3. Call:
   ```
   gh pr edit <number> --title "<suggested-title>" --body-file <tmp>
   ```
4. Confirm success and print the PR URL.

**`--open` path** (new PR):

1. If a PR already exists for this branch, exit with "A PR already exists: <URL>. Use `--apply` to update its description."
2. Check whether the branch has an upstream: `git rev-parse --abbrev-ref @{u} 2>/dev/null`. If not, push it: `git push --set-upstream origin <branch>`.
3. Write the body to a temp file.
4. Call:
   ```
   gh pr create --title "<suggested-title>" --body-file <tmp>
   ```
5. Confirm success and print the PR URL.
