---
name: pr-summary
description: Generate a structured PR description from the current diff using `docs/design/CONCERNS.md` routing. Drafts canonical sections (Summary, What changed, Why, Test plan, Risk and reversibility) tailored to the change type (feat / fix / refactor / chore / docs). Outputs the draft for human review; can apply via `gh pr edit` after explicit confirmation. Pair with `/review` — this skill drafts, `/review` reviews.
---

# PR summary

Drafts a complete PR description from the diff. Gives the author a coherent starting point and reviewers better context — the canonical sections (Summary, What changed, Why, Test plan, Risk and reversibility) map to the schema in `.cursor/rules/pr-review.md` so reviewers can route quickly.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Output is a draft, not an auto-applied PR edit.** Print the draft body in a fenced markdown block. Only call `gh pr edit --body-file <tmp>` after the user explicitly confirms in the same turn.
2. **Never invent test results.** The Test plan lists what should be run; never claim "all passing" unless the user has actually run the tests in this session and you have the output.
3. **Activated concerns come from `docs/design/CONCERNS.md` routing** — `trigger_paths` and `trigger_keywords` matched by the diff. Do not list concerns the diff doesn't touch.
4. **Sentence case** for headings, table cells, and bullet text. No title case. Proper nouns: Grafana, Loki, Prometheus, Tempo, Mimir, Alloy, Grafana Cloud, Grafana Enterprise, Grafana Labs.
5. **No unrelated boilerplate.** A typo fix doesn't need a Risk section. A two-line fix doesn't need a phase table. Match section depth to change weight.
6. **No source code edits.** This skill only reads — and at most calls `gh pr edit`.

## Operating modes

- **Draft mode** (default): print the draft body in a fenced block. Author copy-pastes into the PR description manually. No tool side effects.
- **Apply mode**: if the user invokes `/pr-summary --apply` or replies "apply" after seeing the draft, write the body to a temp file and call `gh pr edit <number> --body-file <tmp>`. Confirm the PR number from `gh pr view --json number`.

## Canonical structure

```markdown
## Summary

<1-3 sentence pitch, or bullet list for multi-phase work>

## What changed

<concrete changes per touched subsystem; one bullet per area>

## Why

<motivation; link design docs if relevant>

## Test plan

- [ ] `npm run check`
- [ ] <subsystem-specific verifications driven by activated concerns>
- [ ] <manual reproduction steps if UI work>

## Risk and reversibility

<one paragraph; flag one-way doors per CONCERNS.md>

<Fixes #NNN | Refs #MMM | Closes #PPP>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Variants by change type

Different change shapes use different sections — match depth to weight:

| Type           | Required sections                                             | Optional / typical                                                                 |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **feat**       | Summary, What changed, Why, Test plan                         | Risk and reversibility; phase table for multi-phase                                |
| **fix**        | Summary (problem + root cause + fix in 3-4 lines), Test plan  | Issue ref. Usually omit Why (self-evident).                                        |
| **refactor**   | Summary, Why, **What's deliberately out of scope**, Test plan | Notes for review (phase order, gotchas)                                            |
| **chore/deps** | Summary, What, Test plan                                      | Skip Why (usually self-evident). Renovate PRs handle themselves — detect and skip. |
| **docs**       | Summary, What (list of docs), Test plan                       | Why (if non-obvious). Link to rendered docs when useful.                           |

## Workflow

### Phase 0 — Resolve scope

1. Determine the base ref:

   ```
   gh pr view --json baseRefName -q .baseRefName 2>/dev/null \
     || git symbolic-ref refs/remotes/origin/HEAD --short | sed 's@^origin/@@'
   ```

   Default to `main` if neither resolves.

2. Capture the diff in three forms:

   ```
   git diff --stat <base>...HEAD
   git diff --name-status <base>...HEAD
   git log <base>..HEAD --format='%h %s%n%n%b%n---'
   ```

   The `git log` output preserves commit bodies so you can extract motivation.

3. Read the **most recent commit body** in full — it usually contains the substantive `Why` content.

4. If running on a PR branch, also capture: `gh pr view --json number,title,body,labels`. The existing title and body may already contain useful context to preserve.

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

3. Detect Renovate / Dependabot. If the branch name matches `renovate/` or `dependabot/`, exit early with a one-line draft: `chore(deps): <dep-name> bump to <version>`. Renovate's auto-generated body is fine as-is; do not overwrite.

### Phase 2 — Draft each section

**Summary**:

- One to three sentences for a typical change.
- Multi-phase / multi-commit features: use a bullet list, one bullet per phase, terse.
- Lead with the user-facing change ("Sidebar tabs survive the toggle"), not the implementation ("Refactored useTabState").

**What changed**:

- Group by touched subsystem. Use the directory structure as the grouping key: `src/<engine>/`, `src/components/<panel>/`, `pkg/plugin/`, `docs/developer/`, etc.
- One bullet per subsystem. Link to the canonical entry point if non-obvious (e.g., the engine's `index.ts`).
- For backend HTTP route changes, name the route explicitly.

**Why**:

- Read the most recent commit body in full. Extract the substantive motivation paragraph.
- If linked to a GitHub issue (commit body contains `Fixes #NNN` or `Refs #MMM`), read the issue title and add it as context.
- If neither commit body nor issue gives clear motivation, emit `[FILL IN: motivation]` and let the author finish. **Do not fabricate.**
- For `fix:` PRs, this section is usually unnecessary — the Summary already explains the problem.

**Test plan**:

- Start with `npm run check` as the always-applicable first checkbox.
- Add subsystem-specific items based on `activated_concerns`. Examples:
  - `security` activated → "Manual XSS / sanitization spot check on the new HTML render path"
  - `coda-terminal` activated → "Manual SSH reconnect smoke test against a Coda VM"
  - `interactive-engine` activated → "Run an interactive guide end-to-end via `npm run e2e`"
  - `requirements-manager` activated → "Verify auto-recovery for at least one failed requirement"
- Add manual reproduction steps for UI work — frame them as numbered steps a reviewer can execute.
- **Never claim a test has passed.** Checkboxes stay unchecked unless the author runs them and updates manually.

**Risk and reversibility**:

- Include this section only if `likely_one_way_doors` is non-empty, or if the diff touches storage formats, telemetry, public APIs, plugin manifest, or backend HTTP contracts.
- One paragraph. Flag specific irreversibilities and any mitigation (e.g., "Adding a new optional field to manifest.json; older versions ignore it. Reversible.").
- For changes where revert would not restore the system (e.g., a one-way data migration), say so plainly.

**Issue refs**:

- Pull `Fixes #NNN` / `Refs #MMM` / `Closes #PPP` markers from commit bodies.
- Use `Fixes` for resolved bugs (auto-closes the issue on merge), `Refs` for related work, `Closes` for feature issues.

**Generated footer**:

- Always append:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```
- This matches existing repo convention for AI-authored PRs.

### Phase 3 — Render output

1. Compose the body using the canonical structure + variant rules.
2. Print the suggested title: `<prefix>(<scope>): <title>` in sentence case.
3. Print the body in a fenced markdown block — agents that consume this skill's output expect a single fenced block, not a free-form report.
4. After the block, ask: "Apply this to PR #N via `gh pr edit`?" Wait for confirmation before mutating anything.

### Phase 4 — Apply (only on explicit user confirmation)

If the user confirms:

1. Write the body to a temp file: `mktemp` or a known path.
2. Call:

   ```
   gh pr edit <number> --title "<suggested-title>" --body-file <tmp>
   ```

3. Confirm success and print the PR URL.

If the user does not confirm, exit cleanly without side effects.

## Reuses

- `docs/design/CONCERNS.md` — concern routing (16 IDs, trigger_paths, trigger_keywords, one_way_doors).
- `.cursor/rules/pr-review.md` — reviewer schema for `activated_concerns`, `risk_signals`, `reversibility` (so the draft uses the same vocabulary the reviewer will).
- `gh` CLI for reading PR metadata and applying edits.
- Conventional commit prefix parsing — shared with `/changelog`.

## Integration

- **Pairs with `/review`**: this skill drafts, `/review` reviews. Same vocabulary, same concern routing.
- Authors invoke this skill **after committing** but **before opening / updating** the PR.
- Can be re-run on an existing PR to refresh the body after new commits land — the apply mode handles this.

## When to exit cleanly without making changes

- Diff is empty (no commits ahead of base) — exit with "No changes to summarize."
- Branch is a Renovate / Dependabot auto-update — output a one-line draft and exit.
- The user invokes `--apply` but no PR exists for this branch — exit with "No PR found for this branch. Run `gh pr create` first."

## Context window management

- Phase 0: ~3 short `git` invocations + one `gh pr view`.
- Phase 1: read `CONCERNS.md` once; match against diff paths in memory.
- Phase 2: read the most recent commit body in full; otherwise work from in-memory diff stats.
- Phase 3: render + print.
- Phase 4 (apply only): write temp file, run one `gh pr edit`.

Total context per run: well under 30k tokens for a typical PR. Multi-phase features may need to read several commit bodies — still bounded.

## Expected invocation patterns

- **Before opening a PR**: author runs `/pr-summary` after their commits are in place, copies the draft into `gh pr create`.
- **After landing new commits on an open PR**: author runs `/pr-summary --apply` to refresh the description.
- **During code review**: reviewer runs `/pr-summary` against the same branch to compare what was written vs. what the diff actually does — a "did the description match reality" sanity check.

## Worked example

For a branch with three commits:

```
abc1234 feat(interactive-engine): add popout step type
def5678 test(interactive-engine): cover popout in step state machine
9876fed docs: update interactive-types.md with popout example
```

Draft output:

````
Suggested title: feat(interactive-engine): add popout step type

```markdown
## Summary

Add a `popout` step type to the interactive tutorial system. When a guide step is marked `popout`, the action surface detaches into a floating overlay that survives layout changes, useful for guides that span scrolling regions.

## What changed

- `src/interactive-engine/action-handlers/popout-handler.ts` — new handler for the `popout` action type
- `src/types/interactive-actions.types.ts` — extends the action union with `PopoutAction`
- `src/interactive-engine/interactive-state-manager.ts` — handles the popout lifecycle (open / close / focus return)
- `docs/developer/interactive-examples/interactive-types.md` — documents the new step type with an example

## Why

Guides that span multiple scrolling regions (e.g., side-by-side editor + preview) lose their action overlay when the user scrolls. Popout decouples the overlay from the scroll context so the guide remains anchored to the user's attention rather than the page geometry. Refs #791.

## Test plan

- [ ] `npm run check`
- [ ] Manual: run a guide containing a `popout` step and verify the overlay survives scrolling
- [ ] Manual: verify focus returns to the originating element when the popout closes

## Risk and reversibility

Reversible — popout is a new optional action type. Existing guides that don't use it are unaffected. No schema migration; guides that omit the field default to non-popout behavior.

Refs #791

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Apply this to PR #872 via `gh pr edit`?
````
