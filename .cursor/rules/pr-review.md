---
description: Routed PR review orchestrator. Load for /review command or any PR review task.
---

# PR Review Orchestrator

Conduct a **Principal Engineer level** review in five phases.

## 1. Read the concern registry

Always read:

- `docs/design/CONCERNS.md`

Do not maintain a separate hardcoded subsystem concern list if the concern registry already defines it.

## 2. Classify the change

Before routing specific concerns, classify the overall shape of the PR using the classes defined in `docs/design/CONCERNS.md`.

At minimum, consider:

- `product-runtime`
- `contracts-and-schemas`
- `infra-build-ci`
- `tests-only`
- `docs-only`
- `mixed`

Classification exists to improve routing efficiency, not to reduce safety.

- If uncertain, classify as `mixed`
- If the change touches workflows, release, publish, Docker, schemas, storage, telemetry payloads, permissions, tokens, or stateful external effects, fail open
- Do not use classification as a hard excuse to suppress likely reviewers on risky or ambiguous PRs
- For `infra-build-ci`, prefer promoting the `build-and-ci` concern before suppressing any other likely reviewer

Produce:

- `change_classes`
- `classification_confidence`
- `classification_reason`
- `review_suppression_decisions`
- `fail_open_signals`

`review_suppression_decisions` should be rare and justified explicitly.

## 3. Route the review

Create a lightweight branch-context summary from:

- PR description
- linked issues
- changed file list
- branch diff
- commit range

Use both:

- path-based triggers from `docs/design/CONCERNS.md`
- semantic triggers from `docs/design/CONCERNS.md`

Never route based on paths alone.

Apply the routing defaults and activation rules defined in `docs/design/CONCERNS.md`.

In particular:

- respect `activation_mode`
- respect `min_signals`
- respect `max_context_files`
- treat repeated low-value keyword hits in the same hunk as one signal, not many

Conditional concerns should only activate when the registry's signal threshold is met.

Produce:

- `activated_concerns`
- `activation_reason`
- `risk_signals`
- `likely_one_way_doors`
- `reviewers_to_run`

Keep the router output terse and structured so the review can explain why a concern ran or did not run.

## 4. Run reviewers

### Always-on reviewers

Always consider these concerns:

- `security`
- `correctness-and-reliability`
- `testing-and-verification`
- `reversibility-and-one-way-door`
- `cross-cutting-architecture`

Depending on change classification, some always-on concerns may be satisfied by the synthesizer instead of a separate early reviewer, but they still must be considered.

Never suppress:

- `reversibility-and-one-way-door`
- the final cross-cutting synthesizer

Do not suppress `security` for workflow, publish, release, token, permission, URL, or trust-boundary changes.

Do not suppress `testing-and-verification` for executable changes, including CI and build system changes.

### Conditional reviewers

Run additional reviewers only when activated by the concern registry.

Examples:

- `context-engine`
- `docs-retrieval-and-rendering`
- `interactive-engine`
- `requirements-manager`
- `guide-schema-and-contracts`
- `e2e-contract`
- `analytics-and-telemetry`
- `feature-flags-and-rollout`
- `state-persistence-and-progress`
- `grafana-plugin-integration`
- `performance-and-bundle`
- `build-and-ci`
- `go-backend`

Prefer a small reviewer set over speculative breadth.

- Always-on concerns must always be considered
- Conditional concerns should only run when activated
- If many conditional concerns activate, prioritize the highest-signal concerns first and keep the initial reviewer set small
- Add more conditional reviewers only when the router has strong evidence they are needed
- If classification suggests a narrow non-runtime class, reduce fan-out conservatively and fail open when uncertain

### Reviewer context discipline

Each reviewer should receive only:

- the relevant concern entry from `docs/design/CONCERNS.md`
- the changed hunks relevant to that concern
- the minimum supporting docs needed
- the router summary

Do not give each reviewer the full repository or unrelated subsystem docs.

Prefer changed functions, nearby symbols, and directly related tests over whole-file or whole-directory reads.

### Subsystem reviewer operating instructions

When launching a subsystem reviewer, instruct it to follow this exact reasoning order:

1. Restate the concern invariant in one sentence using the concern's `purpose` and `review_questions`.
2. Determine whether the diff changes any high-value surface for that concern:
   - endpoint or URL path
   - request or response shape
   - schema or contract
   - persisted state or storage shape
   - public DOM or API contract
   - sanitization or validation logic
   - gating, fallback, rollback, or cleanup behavior
3. Compare implementation to stated intent in the PR summary, tests, and nearby design docs.
4. Check rollback and one-way-door risk: if this breaks after merge, would revert actually restore the system?
5. Check whether tests cover the changed semantics, not just nearby behavior.
6. Report only:
   - invariant mismatches
   - rollback hazards
   - contract drift
   - missing verification tied directly to the changed semantics
7. If nothing crosses that bar, return `reviewed_clean` or `not_applicable`.

Additional instructions for subsystem reviewers:

- Prefer one precise finding over multiple speculative findings
- Treat documented rollback strategy as positive evidence unless the code contradicts it
- If behavior appears broader or narrower than the PR claims, raise a question even if the code may still be valid
- Do not spend tokens on generic maintainability, style, or broad "consider edge cases" advice
- Do not duplicate a finding that is better owned by another concern

### Shared reviewer output schema

Every reviewer must emit the same schema.

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

Confidence guidance:

- `high`: clear invariant violation or likely regression with concrete evidence
- `medium`: credible concern with partial evidence
- `low`: plausible but uncertain risk that should usually be phrased as a question, not a defect

Severity guidance:

- `critical`: security issue, severe rollback hazard, or clear production-breaking regression
- `high`: likely correctness bug, contract break, or missing verification on a high-risk semantic change
- `medium`: meaningful risk or ambiguity that should be resolved before merge if the PR is high leverage
- `low`: useful question or non-blocking improvement with concrete evidence

Allowed `reversibility` values:

- `reversible`
- `partially_reversible`
- `irreversible_without_cleanup`
- `unknown`

## 5. Synthesize and report

After concern-specific reviewers finish, run one final cross-cutting reviewer that:

- considers interactions between concerns
- looks for architecture drift across subsystem boundaries
- catches risks not owned by any single concern
- checks whether the combined change is still coherent

This reviewer is required even if all subsystem reviewers are clean.

The synthesizer must:

- deduplicate overlapping findings from different concerns
- choose a primary owning concern for each merged finding
- preserve secondary concern links only when they add real explanatory value
- prefer one high-signal finding over several repetitive variants of the same issue
- elevate one-way door findings when rollback would not restore the system cleanly
- call out disagreement or uncertainty explicitly if reviewers conflict
- note when change classification may have reduced reviewer fan-out, if that affects confidence

Report findings ordered by severity, then confidence.

Each finding should include:

- concern
- problem
- why it matters
- reversibility classification
- suggested action

If all activated concerns return `no_findings`, say so explicitly and mention any residual confidence gaps or testing gaps.

## Existing review tables still apply

Use the tables below as implementation detail for the relevant concerns, especially `security`, `correctness-and-reliability`, and `go-backend`.

## React reliability, security, and quality checks

Scan the diff against the unified detection table below. Security rules (F1-F6) are always loaded; for any React pattern hit, load `@react-antipatterns.mdc` for the canonical Do/Don't and fix.

### Unified detection table

| What to look for                                                      | ID  | Sev      |
| --------------------------------------------------------------------- | --- | -------- |
| `useEffect` missing cleanup return (listeners, timers, subscriptions) | R1  | Critical |
| State read in callback without functional update or ref               | R2  | High     |
| Object/array literal in `useEffect` dependency array                  | R3  | Critical |
| `fetch`/async in effect without `AbortController` or mounted flag     | R4  | High     |
| `.push()`, `.splice()`, direct property assignment on state           | R5  | Critical |
| Risky component tree or route without `<ErrorBoundary>`               | R6  | High     |
| Search/filter effect without cancellation for rapid inputs            | R7  | High     |
| Hook call after conditional return or inside if/loop                  | R8  | Critical |
| `key={index}` in dynamic (add/remove/reorder) list                    | R9  | Medium   |
| Promise chain without `.catch()` or `try/catch`                       | R10 | High     |
| Context provider with frequently-changing value                       | R11 | Medium   |
| Inline function/object passed to `React.memo` child                   | R12 | Medium   |
| `useEffect` without dependency array                                  | R13 | Critical |
| `useState` + `useEffect` to sync derived value                        | R14 | Medium   |
| DOM listeners on ref without cleanup                                  | R15 | High     |
| Heavy sync computation in render / `useMemo` / effect body            | R16 | High     |
| Nested components both fetching on mount (waterfall)                  | R17 | High     |
| `localStorage` read/write in render path or loop                      | R18 | Medium   |
| Loading spinner as initial render for primary content (LCP)           | R19 | Medium   |
| `<img>` without dimensions; async content without skeleton (CLS)      | R20 | Medium   |
| External script without `defer`/`async`                               | R21 | Medium   |
| `dangerouslySetInnerHTML` without sanitization                        | F1  | Critical |
| Untrusted/dynamic SVG without DOMPurify                               | F2  | Critical |
| Dynamic text rendered via innerHTML instead of `{}`                   | F3  | High     |
| URL built via string concatenation instead of `URL` API               | F4  | High     |
| Use of `innerHTML`, `outerHTML`, `insertAdjacentHTML`                 | F5  | Critical |
| Unvalidated URL scheme (`javascript:`, `data:`) in link/img           | F6  | High     |
| New component > 400 lines or > 5 responsibilities                     | QC1 | Medium   |
| New God object / state bag with > 10 unrelated props                  | QC2 | Medium   |
| Copy-paste / duplicated logic across files                            | QC3 | Medium   |
| Existing utility or hook ignored in favor of re-impl                  | QC4 | Medium   |
| Use of `any`; missing or unexported types                             | QC5 | Medium   |
| Missing tests for new functionality                                   | QC6 | High     |
| Missing ARIA labels or keyboard navigation on interactive els         | QC7 | Medium   |

### Escalation pointers

- **R1-R21 hit**: load `@react-antipatterns.mdc` for the canonical Do/Don't example and fix pattern.
- **F1-F6 hit**: `frontend-security.mdc` is already loaded (always-apply). Reference it directly.

## Reporting

**Clean PR** — one line:

> LGTM. No blocking concerns found across the activated review perspectives. Approve to merge.

**Issues found** — for each finding, state the problem, reference the rule ID or concern ID, include reversibility when relevant, and suggest a fix. Keep it terse.

Avoid repeating the same finding under multiple concern headings unless the cross-concern interaction itself is important.

### Comment prefixes

| Prefix         | Meaning                     |
| -------------- | --------------------------- |
| `[blocking]`   | Must fix before merge       |
| `[suggestion]` | Nice to have                |
| `[question]`   | Seeking clarification       |
| `[nit]`        | Minor style preference      |
| `[security]`   | Security concern (F1-F6)    |
| `[react]`      | React anti-pattern (R1-R21) |

### Disposition

| Disposition            | Criteria                                |
| ---------------------- | --------------------------------------- |
| **Approve**            | Meets all standards, no blocking issues |
| **Approve with minor** | Small suggestions, nothing blocking     |
| **Request changes**    | Blocking issues must be addressed       |

## Go Backend Reviews

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

- `npm run lint:go` - Go linter passes
- `npm run test:go` - Go tests pass
- `go build ./...` - Compiles successfully
