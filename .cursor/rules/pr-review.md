---
description: Compact PR review orchestrator with unified detection table. Load for /review command or any PR review task.
---

# PR Review Orchestrator

Conduct a **Principal Engineer level** review in three steps.

## 1. Understand

Read the PR description and linked issues. Write a one-paragraph summary of what changed and why.

## 2. Detect

Scan the diff against the unified detection table below. Security rules (F1-F6) are always loaded; for any other hit, note the rule ID and load the reference file only if the canonical fix is needed.

### Unified detection table

| What to look for | ID | Sev |
|---|---|---|
| `useEffect` missing cleanup return (listeners, timers, subscriptions) | R1 | Critical |
| State read in callback without functional update or ref | R2 | High |
| Object/array literal in `useEffect` dependency array | R3 | Critical |
| `fetch`/async in effect without `AbortController` or mounted flag | R4 | High |
| `.push()`, `.splice()`, direct property assignment on state | R5 | Critical |
| Risky component tree without `<ErrorBoundary>` | R6 | High |
| Search/filter effect without cancellation for rapid inputs | R7 | High |
| Hook call after conditional return or inside if/loop | R8 | Critical |
| `key={index}` in dynamic (add/remove/reorder) list | R9 | Medium |
| Promise chain without `.catch()` or `try/catch` | R10 | High |
| Context provider with frequently-changing value | R11 | Medium |
| Inline function/object passed to `React.memo` child | R12 | Medium |
| `useEffect` without dependency array | R13 | Critical |
| `useState` + `useEffect` to sync derived value | R14 | Medium |
| DOM listeners on ref without cleanup | R15 | High |
| `dangerouslySetInnerHTML` without sanitization | F1 | Critical |
| Untrusted/dynamic SVG without DOMPurify | F2 | Critical |
| Dynamic text rendered via innerHTML instead of `{}` | F3 | High |
| URL built via string concatenation instead of `URL` API | F4 | High |
| Use of `innerHTML`, `outerHTML`, `insertAdjacentHTML` | F5 | Critical |
| Unvalidated URL scheme (`javascript:`, `data:`) in link/img | F6 | High |
| Heavy sync computation in render / `useMemo` / effect body | SRE1 | High |
| `useEffect` with listener/interval and no cleanup | SRE2 | Critical |
| Component tree / route without `<ErrorBoundary>` | SRE3 | High |
| Nested components both fetching on mount (waterfall) | SRE4 | High |
| `localStorage` read/write in render path or loop | SRE5 | Medium |
| Context provider with unstable value (no `useMemo`) | SRE6 | Medium |
| Async effect without abort/cancellation | SRE7 | High |
| Render-then-fetch with loading spinner on LCP element | SRE8 | Medium |
| `<img>` without dimensions; async content without skeleton | SRE9 | Medium |
| External script without `defer`/`async` | SRE10 | Medium |
| New component > 400 lines or > 5 responsibilities | QC1 | Medium |
| New God object / state bag with > 10 unrelated props | QC2 | Medium |
| Copy-paste / duplicated logic across files | QC3 | Medium |
| Existing utility or hook ignored in favor of re-impl | QC4 | Medium |
| Use of `any`; missing or unexported types | QC5 | Medium |
| Missing tests for new functionality | QC6 | High |
| Missing ARIA labels or keyboard navigation on interactive els | QC7 | Medium |

### Escalation pointers

- **R1-R15 hit**: load `@react-antipatterns.mdc` for the canonical Do/Don't example and fix pattern.
- **SRE1-SRE10 hit**: load `@react-sre-audit.mdc` for the full "10 Commandments" heuristic and remediation plan.
- **F1-F6 hit**: `frontend-security.mdc` is already loaded (always-apply). Reference it directly.

## 3. Report

**Clean PR** — one line:

> LGTM. No security, anti-pattern, or reliability issues found. Approve to merge.

**Issues found** — for each finding, state the problem, reference the rule ID, and suggest a fix. Keep it terse.

### Comment prefixes

| Prefix | Meaning |
|---|---|
| `[blocking]` | Must fix before merge |
| `[suggestion]` | Nice to have |
| `[question]` | Seeking clarification |
| `[nit]` | Minor style preference |
| `[security]` | Security concern (F1-F6) |
| `[react]` | React anti-pattern (R1-R15) |
| `[sre]` | Reliability / performance (SRE1-SRE10) |

### Disposition

| Disposition | Criteria |
|---|---|
| **Approve** | Meets all standards, no blocking issues |
| **Approve with minor** | Small suggestions, nothing blocking |
| **Request changes** | Blocking issues must be addressed |
