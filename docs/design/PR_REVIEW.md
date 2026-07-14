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

## Contract evolution packet

Emitted by the contract evolution scan (`.cursor/skills/review/SKILL.md` §3b) when its deterministic gate fires. The packet gives diff-scoped reviewers and the synthesizer the temporal context they otherwise lack: whether the sequence of recent changes to a capability is converging on a contract or branching it.

Required fields:

- `concern_id`
- `origin_or_contract_anchor`
- `recent_semantic_changes` — up to three entries with PR number, merge SHA, timestamp, and semantic summary
- `current_contract_owner`
- `new_contract_delta`
- `competing_owners_or_representations`
- `history_status` — `complete | partial | unavailable`
- `use_ordinal` — `first | second | third_or_later`
- `same_bug_count` — total bugs observed in this class, including the one this PR addresses; `0` when this PR does not address a bug in a previously seen class
- `has_recorded_anchor`
- `anchor_violated` — `true` only when the change contradicts an invariant stated in the recorded anchor; must be `false` when `has_recorded_anchor` is `false`
- `branching_conditions`
- `sources` — immutable same-repository PR, issue, and commit identifiers plus selection reasons
- `verdict`
- `finding` — required for `contract_missing`, `contract_branching`, and `insufficient_history`; contains `finding_id`, `title`, `evidence`, `why_it_matters`, `suggested_action`, `reversibility`, and `applies_to_files`. When the policy downgrades a clean verdict to `insufficient_history`, `contract-evolution-policy.mjs` synthesizes the finding — packets with clean verdicts never include one.

Also record the deterministic gate output or the router's explicitly labeled `discretionary_trigger`. Never present a subjective router judgment as a gate metric.

### Verdict values

- `follows_contract`: the change conforms to a recorded anchor or a coherent reconstructed contract
- `coherent_extension`: the change grows the contract surface in a way consistent with its established shape and ownership
- `contract_missing`: the capability has no single owner; refs, events, storage, or browser state collectively implement an unmodeled contract
- `contract_branching`: the change creates a new branch of the implicit contract — a competing owner, representation, or vocabulary
- `insufficient_history`: no anchor exists and reliable history is insufficient for a contract verdict; never blocking

### Branching conditions

Record each applicable condition; conditions classify the delta but do not determine disposition by themselves:

- another raw representation of an existing concept
- another state or lifecycle owner for a concept that already has one
- a new event or payload vocabulary without central types
- vendor-specific calls (e.g. `pushFaro*`) from an additional product-domain consumer
- ordering-sensitive bootstrap behavior
- another patch for a bug class already visible in the recent history

### Disposition table

This table is the only source of disposition truth. `.cursor/skills/review/scripts/contract-evolution-policy.mjs` implements it.

| History and contract state                                             | Verdict                | Severity | Disposition |
| ---------------------------------------------------------------------- | ---------------------- | -------- | ----------- |
| Complete history; change conforms                                      | `follows_contract`     | —        | none        |
| Complete history; one owner grows coherently                           | `coherent_extension`   | —        | none        |
| No owner, any use ordinal                                              | `contract_missing`     | medium   | advisory    |
| First or second use, no anchor violation                               | `contract_branching`   | medium   | advisory    |
| Recorded anchor is violated and a branching condition exists           | `contract_branching`   | high     | blocking    |
| Third-or-later use and a branching condition exists                    | `contract_branching`   | high     | blocking    |
| Second or later bug in the same class and a branching condition exists | `contract_branching`   | high     | blocking    |
| Partial or unavailable history with no recorded anchor                 | `insufficient_history` | low      | advisory    |

Every advisory or blocking packet is converted to the shared reviewer output schema before adversarial verification. Skeptics receive that finding, the relevant hunks, and the immutable sources recorded in the packet.

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
| F5 DOM sink lint failure, bypass, or equivalent raw DOM/script sink            | F5  | Critical |
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

`AGENTS.md` §Comments carries the shape summary — the eight shape titles plus the keep-list (always loaded in agent context). The canonical catalog with worked before/after examples lives in the `comment-hygiene` skill (`.cursor/skills/comment-hygiene/SKILL.md`); load it when a QC8 call is borderline. This section is reviewer-specific scoping only.

**Reviewer scoping rules:**

- **Flag on changed lines only.** If a bad-shape comment appears in a hunk the PR is modifying, flag it. Do not flag bad-shape comments in untouched files or untouched functions — comment cleanup rides along on code changes, never as a standalone sweep.
- **Also flag stale comments left in place inside functions the PR is modifying.** If the PR renames a symbol, alters a control flow, or changes a behavior, but leaves an adjacent comment describing the prior shape, the comment is now stale and should have been trimmed.
- **Reference the shape number** (1-8) from the AGENTS.md catalog when reporting. Example: `QC8.2: defensive "Intentionally NOT" block above doWork()`.
- **Severity is Medium and non-blocking.** A single bad-shape comment does not block merge. A PR running 3:1 comments-to-code that doesn't clear should be flagged for cleanup before merge.

### Escalation pointers

- **R1-R21 hit**: load `.cursor/rules/react-antipatterns.mdc` for the canonical Do/Don't example and fix pattern.
- **F1-F6 hit**: load `.cursor/rules/frontend-security.mdc` for intent and remediation. For direct F5 sinks, `eslint.config.mjs` owns the mechanical catalog.
- **QC8 hit**: cite the specific shape (1-8) from `AGENTS.md` §Comments when reporting; load `.cursor/skills/comment-hygiene/SKILL.md` for the worked example when the call is borderline.

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
