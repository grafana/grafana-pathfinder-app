# PR Review — Standards and Pattern Catalog

Canonical reference for what reviewers (human or agent) check against when reviewing a PR in this repository. Tool-neutral. Both Cursor and Claude Code skills load this document.

The orchestration workflow that uses this catalog lives in `.cursor/skills/review/SKILL.md` (invoked via `/review`). The concern routing table lives in `docs/design/CONCERNS.md`.

## Reviewer output schema

Every reviewer (subsystem or cross-cutting) emits the same schema.

If findings exist, include:

- `concern_id`
- `finding_id`
- `severity`
- `confidence`
- `title`
- `evidence`
- `why_it_matters`
- `suggested_action`
- `reversibility`
- `applies_to_files`

If no findings, include:

- `concern_id`
- `status: no_findings`
- `reason: not_applicable | reviewed_clean`

### Confidence guidance

- `high`: clear invariant violation or likely regression with concrete evidence
- `medium`: credible concern with partial evidence
- `low`: plausible but uncertain risk that should usually be phrased as a question, not a defect

### Severity guidance

- `critical`: security issue, severe rollback hazard, or clear production-breaking regression
- `high`: likely correctness bug, contract break, or missing verification on a high-risk semantic change
- `medium`: meaningful risk or ambiguity that should be resolved before merge if the PR is high leverage
- `low`: useful question or non-blocking improvement with concrete evidence

### Reversibility values

- `reversible`
- `partially_reversible`
- `irreversible_without_cleanup`
- `unknown`

## React reliability, security, and quality checks

Scan the diff against the unified detection table below. Security rules (F1-F6) are always loaded; for any React pattern hit, load `.cursor/rules/react-antipatterns.mdc` for the canonical Do/Don't and fix.

### Unified detection table

| What to look for                                                               | ID  | Sev      |
| ------------------------------------------------------------------------------ | --- | -------- |
| `useEffect` missing cleanup return (listeners, timers, subscriptions)          | R1  | Critical |
| State read in callback without functional update or ref                        | R2  | High     |
| Object/array literal in `useEffect` dependency array                           | R3  | Critical |
| `fetch`/async in effect without `AbortController` or mounted flag              | R4  | High     |
| `.push()`, `.splice()`, direct property assignment on state                    | R5  | Critical |
| Risky component tree or route without `<ErrorBoundary>`                        | R6  | High     |
| Search/filter effect without cancellation for rapid inputs                     | R7  | High     |
| Hook call after conditional return or inside if/loop                           | R8  | Critical |
| `key={index}` in dynamic (add/remove/reorder) list                             | R9  | Medium   |
| Promise chain without `.catch()` or `try/catch`                                | R10 | High     |
| Context provider with frequently-changing value                                | R11 | Medium   |
| Inline function/object passed to `React.memo` child                            | R12 | Medium   |
| `useEffect` without dependency array                                           | R13 | Critical |
| `useState` + `useEffect` to sync derived value                                 | R14 | Medium   |
| DOM listeners on ref without cleanup                                           | R15 | High     |
| Heavy sync computation in render / `useMemo` / effect body                     | R16 | High     |
| Nested components both fetching on mount (waterfall)                           | R17 | High     |
| `localStorage` read/write in render path or loop                               | R18 | Medium   |
| Loading spinner as initial render for primary content (LCP)                    | R19 | Medium   |
| `<img>` without dimensions; async content without skeleton (CLS)               | R20 | Medium   |
| External script without `defer`/`async`                                        | R21 | Medium   |
| Untrusted/dynamic SVG without DOMPurify sanitization                           | F1  | Critical |
| `dangerouslySetInnerHTML` where `{}` auto-escape would do                      | F2  | High     |
| URL built via string concat instead of `new URL()` + searchParams              | F3  | High     |
| `dangerouslySetInnerHTML` without `textUtil.sanitize()`                        | F4  | Critical |
| Use of `.innerHTML`, `.outerHTML`, `.insertAdjacentHTML`, dynamic `script.src` | F5  | Critical |
| URL in `href`/`src` without `textUtil.sanitizeUrl()` or scheme-allowlist check | F6  | High     |
| New component > 400 lines or > 5 responsibilities                              | QC1 | Medium   |
| New God object / state bag with > 10 unrelated props                           | QC2 | Medium   |
| Copy-paste / duplicated logic across files                                     | QC3 | Medium   |
| Existing utility or hook ignored in favor of re-impl                           | QC4 | Medium   |
| Use of `any`; missing or unexported types                                      | QC5 | Medium   |
| Missing tests for new functionality                                            | QC6 | High     |
| Missing ARIA labels or keyboard navigation on interactive els                  | QC7 | Medium   |
| Verbose / decorative / stale comments on changed code                          | QC8 | Medium   |

### QC8 — Comment hygiene on changed code

The canonical catalog of bad-shape comments and the keep-list live in `AGENTS.md` §Comments (always loaded in agent context). This section is reviewer-specific scoping only.

**Reviewer scoping rules:**

- **Flag on changed lines only.** If a bad-shape comment appears in a hunk the PR is modifying, flag it. Do not flag bad-shape comments in untouched files or untouched functions — comment cleanup rides along on code changes, never as a standalone sweep.
- **Also flag stale comments left in place inside functions the PR is modifying.** If the PR renames a symbol, alters a control flow, or changes a behavior, but leaves an adjacent comment describing the prior shape, the comment is now stale and should have been trimmed.
- **Reference the shape number** (1-8) from the AGENTS.md catalog when reporting. Example: `QC8.2: defensive "Intentionally NOT" block above doWork()`.
- **Severity is Medium and non-blocking.** A single bad-shape comment does not block merge. A PR running 3:1 comments-to-code that doesn't clear should be flagged for cleanup before merge.

### Escalation pointers

- **R1-R21 hit**: load `.cursor/rules/react-antipatterns.mdc` for the canonical Do/Don't example and fix pattern.
- **F1-F6 hit**: load `.cursor/rules/frontend-security.mdc` directly for the canonical rule definition and remediation pattern. (In Cursor, that file's `alwaysApply` frontmatter auto-loads it for matching files; in Claude Code, cite it by path.)
- **QC8 hit**: cite the specific shape (1-8) from `AGENTS.md` §Comments when reporting.

## Go backend checks

For PRs touching `pkg/**/*.go`, also check:

| What to look for                                      | ID  | Sev      |
| ----------------------------------------------------- | --- | -------- |
| Missing error handling (unchecked errors)             | G1  | High     |
| Resource leak (unclosed connections, files, channels) | G2  | Critical |
| Goroutine leak (no context cancellation)              | G3  | High     |
| Data race potential (shared state without sync)       | G4  | Critical |
| Unsafe input handling (unsanitized user input)        | G5  | High     |
| Missing context propagation in handlers               | G6  | Medium   |
| Hardcoded secrets or credentials                      | G7  | Critical |

**Verification commands:**

- `npm run lint:go` — Go linter passes
- `npm run test:go` — Go tests pass
- `go build ./...` — Compiles successfully

## Comment prefixes

| Prefix         | Meaning                     |
| -------------- | --------------------------- |
| `[blocking]`   | Must fix before merge       |
| `[suggestion]` | Nice to have                |
| `[question]`   | Seeking clarification       |
| `[nit]`        | Minor style preference      |
| `[security]`   | Security concern (F1-F6)    |
| `[react]`      | React anti-pattern (R1-R21) |

## Disposition

| Disposition            | Criteria                                |
| ---------------------- | --------------------------------------- |
| **Approve**            | Meets all standards, no blocking issues |
| **Approve with minor** | Small suggestions, nothing blocking     |
| **Request changes**    | Blocking issues must be addressed       |

## Reporting

**Clean PR** — one line:

> LGTM. No blocking concerns found across the activated review perspectives. Approve to merge.

**Issues found** — for each finding, state the problem, reference the rule ID or concern ID, include reversibility when relevant, and suggest a fix. Keep it terse.

Avoid repeating the same finding under multiple concern headings unless the cross-concern interaction itself is important.
