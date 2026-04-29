# Bugfix subagent prompts

This file contains prompts and context for subagents spawned during the `/bugfix` workflow. The main skill reads this file and passes the relevant section to each subagent. This keeps subagent instructions out of the main conversation context.

---

## Code investigation (Phase 1a)

**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Investigate a bug in the Grafana Pathfinder plugin.
>
> **Issue #{number}:** {title}
>
> **Description:**
> {issue body, truncated to first 2000 chars}
>
> **Your task:**
>
> 1. Locate the specific files and functions involved in this bug. Start with any file paths or component names mentioned in the issue. If none are mentioned, search by keywords from the title/description.
> 2. Find related test files that already exist (co-located `*.test.ts` or `*.test.tsx` files).
> 3. Identify the root cause if discernible from code reading alone. State it as a one-sentence hypothesis.
> 4. Note any architectural tier the affected code belongs to (check `src/validation/import-graph.ts` for `TIER_MAP` if unclear).
>
> **Report format (under 300 words):**
>
> - **Files involved:** list with line numbers
> - **Existing tests:** list or "none"
> - **Root cause hypothesis:** one sentence
> - **Architectural tier:** which tier(s) the fix will touch

---

## Related issues (Phase 1b)

**Agent type:** `Explore`
**Thoroughness:** `quick`

**Prompt template:**

> Check for related open robustness issues in this repo.
>
> **Current issue #{number}:** {title}
> **Files involved:** {files from code investigation, or "unknown yet"}
> **UI region:** {one of: sidebar, navigation, block-editor, interactive-engine, learning-paths, context-engine, settings, other}
>
> **Steps:**
>
> 1. Run: `gh issue list --label robustness --state open --json number,title,body`
> 2. Find issues that are related by ANY of:
>    - They reference the same files or components
>    - They describe symptoms in the same UI region (sidebar, nav, block editor, interactive steps, learning paths)
>    - They describe the same class of failure (e.g., "disappearing", "duplicate", "stale state")
> 3. For each related issue, state in one line: issue number, title, and why it's related.
>
> **Report format (under 200 words):**
>
> - **Related issues:** numbered list, or "none found"
> - **Shared root cause likely?** yes/no with one-sentence reasoning

---

## Test design (Phase 4)

**Agent type:** `Plan`

**Prompt template:**

> Design a test strategy for a confirmed bug.
>
> **Issue #{number}:** {title}
> **Bug category:** {logic | state | rendering | ux-behavior | visual}
> **Confirmed root cause:** {one-sentence hypothesis}
> **Files involved:** {from code investigation}
> **Existing tests:** {from code investigation}
>
> **Project test conventions:**
>
> - Co-locate tests: `foo.test.ts` beside `foo.ts`
> - Use `src/test-utils/` for shared helpers
> - Import from `@testing-library/react`, `@grafana/data`, `@grafana/ui`
> - Descriptive names: `it('should not show double skip buttons when ...')`
> - Test boundaries, not just symptoms (e.g., test with 0, 1, and 2 skip-eligible steps)
> - For E2E: follow `docs/developer/E2E_TESTING.md`
>
> **Your task — design only, do not write code:**
>
> 1. Which test file(s) to create or modify
> 2. What specific assertions will fail due to the bug (be precise about expected vs actual)
> 3. What the test should assert after the fix
> 4. If visual bug on the structural-test track: what DOM structure or CSS classes to assert
> 5. If E2E: which Playwright test file and what user flow
>
> **Report format (under 250 words):**
>
> - **Test file:** path
> - **Test cases:** list with assertion details
> - **Setup required:** any mocks, fixtures, or render wrappers needed

---

## Prioritization scoring

Used in Phase 1 when no issue number is provided. Score each candidate issue:

| Factor                 | Score | Condition                                                  |
| ---------------------- | ----- | ---------------------------------------------------------- |
| **Shared root cause**  | +3    | Related to 2+ other open robustness issues                 |
| **Has repro steps**    | +2    | Issue body or comments contain explicit reproduction steps |
| **Testable category**  | +2    | Logic or state bug (high test-first success rate)          |
| **Rendering bug**      | +1    | Component-testable with RTL                                |
| **UX behavior bug**    | +0    | Requires E2E or complex setup                              |
| **Visual-only**        | -1    | May not be automatable                                     |
| **Enhancement-tagged** | -2    | May exceed bugfix scope                                    |

Present the top 3 candidates with scores to the user. If the user says "just go", pick the highest-scoring one.

---

## UI region keyword map

Used by the related-issues subagent to classify issues by UI region when no file paths are mentioned.

| Region             | Keywords                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| sidebar            | sidebar, panel, pop-out, dismiss, tab, drawer                                |
| navigation         | nav, menu, nested, reveal, breadcrumb, route                                 |
| block-editor       | block editor, markdown, switch type, editor                                  |
| interactive-engine | step, section, skip, highlight, tooltip, action, do it, show me, interactive |
| learning-paths     | learning path, module, badge, streak, progress, continue                     |
| context-engine     | recommend, context, suggestion, featured                                     |
| settings           | settings, permissions, plugin settings, configuration                        |
