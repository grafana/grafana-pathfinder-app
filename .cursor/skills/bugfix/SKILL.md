---
name: bugfix
description: Fix a robustness bug from GitHub issues using worktrees, test-first development, and subagents.
---

# Bugfix

Fix robustness bugs one at a time using isolated worktrees, test-driven development, and parallel subagents.

## Usage

```
/bugfix           # Pick the next unassigned robustness issue
/bugfix 786       # Fix a specific issue by number
```

## Subagent context

All subagent prompts, scoring heuristics, and keyword maps live in **`.cursor/skills/bugfix/SUBAGENTS.md`**. Read that file before spawning any subagent, then pass only the relevant section as the prompt. Do NOT paste SUBAGENTS.md content into the main conversation context.

## Workflow

### Phase 1: Select and understand the bug

1. **Check active worktrees first.** Run `git worktree list` and report any existing `pathfinder-fix-*` worktrees so the user is aware of in-progress or stale fixes.

2. If no issue number provided, **triage and prioritize:**
   - Fetch open robustness issues: `gh issue list --label robustness --state open --json number,title,labels,body`
   - Read the **Prioritization scoring** section from `SUBAGENTS.md` and score each issue.
   - Present the top 3 candidates with scores. If the user says "just go", pick the highest.

3. Fetch the full issue body **and comments**:

   ```
   gh issue view <number>
   gh issue view <number> --comments
   ```

4. **Check for scope mismatch.** If the issue is also labeled `enhancement`, warn the user: "This issue includes new functionality beyond a pure bug fix. The bugfix skill targets minimal fixes — should I proceed with just the bug-fix portion, or hand off to a planning workflow for the full scope?"

5. **Spawn two subagents in parallel.** Read `SUBAGENTS.md` and use the **Code investigation (Phase 1a)** and **Related issues (Phase 1b)** prompt templates, filling in the issue details.

### Phase 2: Classify the bug

6. Based on the Explore findings, classify the bug:

   | Category            | Example                                                          | Test track                                                           |
   | ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
   | **Logic bug**       | Wrong calculation, incorrect filtering, bad conditional          | Unit test with Jest                                                  |
   | **State bug**       | Race condition, stale state, incorrect lifecycle                 | Unit/integration test with Jest + RTL                                |
   | **Rendering bug**   | Wrong component output, missing/duplicate elements               | Component test with Jest + RTL                                       |
   | **UX behavior bug** | Navigation broken, tab persistence lost, cross-component failure | Prefer RTL component test; E2E only if component test can't cover it |
   | **Visual bug**      | Spinner off-axis, layout shift, styling regression               | **Structural test track** (see below)                                |

7. **State a root cause hypothesis** in one sentence. Present to the user for confirmation. Do NOT write tests until the root cause is agreed upon.

#### Structural test track (visual bugs)

Visual bugs often can't be captured with behavioral assertions, but they usually _can_ be tested structurally. Instead of stopping to ask the user every time:

1. Check whether the bug can be expressed as a DOM structure or CSS class assertion (e.g., "spinner container should have `display: flex` and `align-items: center`", or "element should have class `centered-spinner`", or "only one `.skip-button` should exist in the section").
2. If a structural assertion is feasible, proceed with it as the failing test — no user gate needed.
3. If no structural assertion is possible (pure visual regression with no DOM/CSS signal), then flag to user with options: screenshot comparison E2E test, or fix-only with user approval.

### Phase 3: Set up the worktree

8. Create an isolated worktree:

   ```
   git worktree add ../pathfinder-fix-<number> -b fix/<number>-<short-slug>
   ```

   Switch working directory to the worktree for all subsequent work.

9. Run `npm install` in the worktree.

### Phase 4: Write failing tests FIRST

This is the most important phase. The test must prove the bug exists before any fix is attempted.

10. **Spawn a Plan subagent.** Read the **Test design (Phase 4)** prompt template from `SUBAGENTS.md`, fill in the confirmed root cause and Explore findings.

11. **If test strategy calls for E2E (Playwright):** check whether the dev server is running (`curl -s http://localhost:3000/api/health`). If not, tell the user: "This bug needs an E2E test but Grafana isn't running. Please start it with `npm run server` or I can write a component-level test instead." Prefer component-level RTL tests when they can adequately cover the behavior.

12. Write the test(s). Follow existing conventions:
    - Co-locate tests next to source files (`foo.test.ts` beside `foo.ts`)
    - Use `src/test-utils/` for shared helpers
    - Import from `@testing-library/react` and `@grafana/data`/`@grafana/ui` as needed
    - Descriptive names: `it('should not show double skip buttons when ...')`
    - Test the boundary, not just the symptom

13. Run the tests and **confirm they fail** for the right reason:
    ```
    npx jest <test-file> --no-coverage
    ```
    If the test passes (bug not reproduced), reassess the root cause. Do NOT proceed until you have a failing test.

### Phase 5: Commit the failing test

14. Commit the test separately:

    ```
    git add <test-files>
    git commit -m "test: add failing test for <short description>

    Demonstrates the bug described in #<number>. This test is
    expected to fail until the fix is applied in the next commit.

    Refs #<number>"
    ```

### Phase 6: Fix the bug

15. Implement the minimal fix. Hard constraints:
    - Fix only the bug — no drive-by refactors
    - No new dependencies unless absolutely required
    - No changes to unrelated files
    - **Respect architectural boundaries.** The codebase enforces a tiered import graph via `src/validation/architecture.test.ts`. Your fix must NOT:
      - Introduce upward-tier imports (check `TIER_MAP` in `src/validation/import-graph.ts`)
      - Add lateral imports between Tier 2 engines unless unavoidable
      - Bypass engine barrel exports
      - Add entries to violation allowlists
    - If the fix requires crossing a boundary, stop and discuss with the user.

16. Run the failing test(s) and confirm they **now pass**:
    ```
    npx jest <test-file> --no-coverage
    ```

### Phase 7: Verify no regressions

17. Run the full check suite:
    ```
    npm run check
    ```
    Fix any failures introduced by your change. If fixing would require out-of-scope changes, stop and tell the user.

### Phase 8: Commit the fix

18. Commit the fix separately:

    ```
    git add <fix-files>
    git commit -m "fix: <description>

    Fixes #<number>"
    ```

### Phase 9: Record pattern and report

19. **Record the fix pattern.** Append one entry to `docs/developer/bugfix-patterns.md` (create it if it doesn't exist):

    ```markdown
    | #<number> | <category> | <root cause pattern — one phrase> | <files touched> | <date> |
    ```

    If the file is new, add this header first:

    ```markdown
    # Bugfix patterns

    Patterns from resolved robustness issues. Loaded during `/bugfix` Phase 2 to inform classification and root cause hypotheses.

    | Issue | Category | Root cause pattern | Files | Date |
    | ----- | -------- | ------------------ | ----- | ---- |
    ```

20. **Report to the user:**
    - **Bug:** one sentence
    - **Root cause:** one sentence
    - **Test:** what the test proves
    - **Fix:** what the fix does
    - **Related issues:** sibling robustness issues that may share this root cause
    - **Branch:** `fix/<number>-<slug>` in worktree `../pathfinder-fix-<number>`

21. **Offer next steps:**
    - `push` — push branch and create a PR
    - `next` — start the next highest-priority robustness issue
    - `merge` — rebase onto main and merge locally (check for conflicts with other fix branches first)
    - `cleanup` — remove this worktree (`git worktree remove ../pathfinder-fix-<number>`)
    - `status` — list all active fix worktrees and their branches

## Hard constraints

1. **NEVER skip the failing-test phase.** If you cannot reproduce the bug in a test, stop and discuss with the user rather than fixing blindly.
2. **NEVER modify existing test assertions** to make them pass — write new tests or extend existing ones.
3. **One bug per worktree.** Each issue gets its own branch and worktree.
4. **Minimal diff.** Only tests and the fix. No formatting changes, no unrelated refactors.
5. **Use subagents for exploration, not for writing code.** All code changes happen in the main context.
6. **Two-commit structure.** Commit 1: failing test. Commit 2: the fix.
7. **Confirm root cause before writing tests.** Present hypothesis to user first.
8. **Load prior patterns.** In Phase 2, check if `docs/developer/bugfix-patterns.md` exists and read it. Use prior root cause patterns to inform the current hypothesis.

## Subagent strategy

| Subagent                       | When              | Prompt source                            |
| ------------------------------ | ----------------- | ---------------------------------------- |
| `Explore` (code investigation) | Phase 1           | `SUBAGENTS.md` → Code investigation      |
| `Explore` (related issues)     | Phase 1           | `SUBAGENTS.md` → Related issues          |
| `Plan` (test design)           | Phase 4           | `SUBAGENTS.md` → Test design             |
| `Explore` (additional paths)   | Phase 6 if needed | Ad-hoc, scoped to specific code question |
