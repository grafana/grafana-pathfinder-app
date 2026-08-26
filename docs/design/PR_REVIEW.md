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
- `recommended_disposition` — `blocking | suggestion | nit`
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

### Author disposition guidance

- `blocking`: must be fixed or answered before merge
- `suggestion`: concrete non-blocking improvement, including an optional question
- `nit`: minor style or wording preference

Severity describes impact; disposition describes the merge contract. A medium finding can be blocking when the ambiguity must be resolved before merge, and a high-risk observation can remain a suggestion when the PR does not create that risk. Reviewers recommend a disposition; the synthesizer owns the final value after verification and deduplication.

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
- `history_status` — `complete | partial | unavailable`; defaults to the gate's value — upgrade `partial` to `complete` only after inspecting each unmapped or unclassified commit the gate reported and recording in `sources` why it is irrelevant to this capability
- `use_ordinal` — `first | second | third_or_later`: this PR's position in the sequence of distinct PRs extending or reshaping the capability's contract surface, with the introducing PR as `first`; count PRs (the gate's distinct-PR history is the baseline evidence), not consumers or call sites. Count only PRs that extended or reshaped the specific contract surface at issue, not every semantic PR under the concern's paths — a scroll-position fix in the same directory does not advance the ordinal of an event-name contract. `third_or_later` plus a branching condition blocks, so over-counting manufactures blocking findings
- `same_bug_count` — total bugs observed in this class, including the one this PR addresses; `0` when this PR does not address a bug in a previously seen class
- `has_recorded_anchor` — `true` only when the concern has a row in the Contract anchors table in `docs/design/CONCERN_DETAILS.md`; pre-contract candidates do not count
- `anchor_violated` — `true` only when the change contradicts an invariant stated in the recorded anchor; must be `false` when `has_recorded_anchor` is `false`
- `branching_conditions`
- `sources` — immutable same-repository PR, issue, and commit identifiers plus selection reasons
- `verdict`
- `finding` — required for `contract_missing`, `contract_branching`, and `insufficient_history`; contains `finding_id`, `title`, `evidence`, `why_it_matters`, `suggested_action`, `reversibility`, and `applies_to_files`. When the policy downgrades a clean verdict to `insufficient_history`, `contract-evolution-policy.mjs` synthesizes the finding — packets with clean verdicts never include one.

Also record the deterministic gate output or the router's explicitly labeled `discretionary_trigger`. Never present a subjective router judgment as a gate metric.

### Packet example

Emit exactly this shape — `contract-evolution-policy.mjs` validates strictly (field names, source `kind` enum, integer `pr`/`timestamp`, SHA-shaped `sha`, array-valued `evidence` and `applies_to_files`):

```json
{
  "concern_id": "analytics-and-telemetry",
  "origin_or_contract_anchor": "No recorded anchor; pre-contract candidate row proposes a typed facade owner.",
  "recent_semantic_changes": [
    {
      "pr": 1275,
      "sha": "fc9be20d282ebef45f8e1580a7279497e030e5af",
      "timestamp": 1783698004,
      "summary": "Introduced vendor-direct telemetry calls across product tiers."
    }
  ],
  "current_contract_owner": "lib/telemetry/facade.ts domain operations; vendor adapter internal.",
  "new_contract_delta": "Adds a second event vocabulary defined locally in a consumer.",
  "competing_owners_or_representations": ["local event names in consumer module"],
  "history_status": "complete",
  "use_ordinal": "second",
  "same_bug_count": 0,
  "has_recorded_anchor": false,
  "anchor_violated": false,
  "branching_conditions": ["a new event or payload vocabulary without central types"],
  "sources": [
    {
      "kind": "pr",
      "id": 1275,
      "sha": "fc9be20d282ebef45f8e1580a7279497e030e5af",
      "selection_reason": "Introducing PR for the capability."
    }
  ],
  "verdict": "contract_branching",
  "finding": {
    "finding_id": "CE-example-1",
    "title": "Event vocabulary branches away from the central types",
    "evidence": ["consumer defines event names locally instead of importing the central type"],
    "why_it_matters": "Consumers can disagree about the payload shape.",
    "suggested_action": "Centralize the event type.",
    "reversibility": "reversible",
    "applies_to_files": ["src/example/consumer.ts"]
  }
}
```

Packets with clean verdicts (`follows_contract`, `coherent_extension`) omit `finding`.

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

This table is the only source of disposition truth **for the contract evolution scan**. `.cursor/skills/review/scripts/contract-evolution-policy.mjs` implements it. Its `advisory` value is scan-internal vocabulary: `contract-evolution-policy.mjs` maps it to the author-facing `suggestion` when it converts a packet to a reviewer finding. The synthesizer still owns the final author disposition (see Author disposition guidance).

| History and contract state                                             | Verdict                | Severity | Recommended disposition |
| ---------------------------------------------------------------------- | ---------------------- | -------- | ----------------------- |
| Complete history; change conforms                                      | `follows_contract`     | —        | none                    |
| Complete history; one owner grows coherently                           | `coherent_extension`   | —        | none                    |
| No owner, any use ordinal                                              | `contract_missing`     | medium   | advisory                |
| First or second use, no anchor violation                               | `contract_branching`   | medium   | advisory                |
| Recorded anchor is violated and a branching condition exists           | `contract_branching`   | high     | blocking                |
| Third-or-later use and a branching condition exists                    | `contract_branching`   | high     | blocking                |
| Second or later bug in the same class and a branching condition exists | `contract_branching`   | high     | blocking                |
| Partial or unavailable history with no recorded anchor                 | `insufficient_history` | low      | advisory                |

Every advisory or blocking packet is converted to the shared reviewer output schema before adversarial verification. Skeptics receive that finding, the relevant hunks, and the immutable sources recorded in the packet.

## React reliability, security, and quality checks

Scan the diff against the unified detection table below. Security rules (F1-F6) are always loaded; for any React pattern hit, resolve the code in `.cursor/rules/react-antipatterns.mdc` and then load the themed file it routes to, which holds the canonical Do/Don't and fix.

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

`AGENTS.md` §Comments carries the rule and the keep-list (always loaded in agent context). The eight shape titles and the canonical catalog with worked before/after examples live in the `comment-hygiene` skill (`.cursor/skills/comment-hygiene/SKILL.md`) — load it to cite a shape number, or when a QC8 call is borderline. This section is reviewer-specific scoping only.

**Reviewer scoping rules:**

- **Flag on changed lines only.** If a bad-shape comment appears in a hunk the PR is modifying, flag it. Do not flag bad-shape comments in untouched files or untouched functions — comment cleanup rides along on code changes, never as a standalone sweep.
- **Also flag stale comments left in place inside functions the PR is modifying.** If the PR renames a symbol, alters a control flow, or changes a behavior, but leaves an adjacent comment describing the prior shape, the comment is now stale and should have been trimmed.
- **Reference the shape number** (1-8) from the `comment-hygiene` catalog when reporting. Example: `QC8.2: defensive "Intentionally NOT" block above doWork()`.
- **Severity is Medium and non-blocking.** A single bad-shape comment does not block merge. A PR running 3:1 comments-to-code that doesn't clear should be flagged for cleanup before merge.

### Escalation pointers

- **R1-R21 hit**: resolve the code in `.cursor/rules/react-antipatterns.mdc` (an index), then load the themed file its `Detail` column names — that file holds the canonical Do/Don't example and fix pattern. The index's one-line `Fix` cell is a reminder, not a substitute.
- **F1-F6 hit**: load `.cursor/rules/frontend-security.mdc` for intent and remediation. For direct F5 sinks, `eslint.config.mjs` owns the mechanical catalog.
- **QC8 hit**: load `.cursor/skills/comment-hygiene/SKILL.md` to cite the specific shape (1-8) and for the worked example when the call is borderline.

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

Reviewer-internal vocabulary for labelling findings before synthesis. The author-facing report carries only the three dispositions `review-report.mjs` accepts: a `[question]` becomes `blocking` or `suggestion` per the disposition guidance above, and `[security]` and `[react]` become the finding's `concern_id`.

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

## Final review report

The synthesizer emits this `ReviewReport` object after all supplemental checks finish:

| Field           | Type   | Rule                                                       |
| --------------- | ------ | ---------------------------------------------------------- |
| `pr_url`        | string | Full `https://github.com/<owner>/<repo>/pull/<number>` URL |
| `pr_title`      | string | Current PR title; the renderer derives a one-line purpose  |
| `reviewed_head` | string | Full 40-character commit SHA                               |
| `findings`      | array  | Retained, verified, deduplicated author-facing findings    |
| `assessment`    | object | Optional; defaults to complete. See Incomplete assessment  |

Each `findings` entry contains:

- `id` — stable across re-reviews, and unique within the report
- `concern_id` — owning concern; rendered compactly and used to route an incremental re-review
- `disposition` — `blocking | suggestion | nit`
- `severity` — `critical | high | medium | low`; rendered compactly
- `title`
- `problem` — concise evidence and consequence written for the PR author, in one rendered line
- `suggested_action` — the smallest change that resolves the finding
- `reversibility` — optional; one of the four reversibility values. The renderer surfaces only `partially_reversible` and `irreversible_without_cleanup`, because only those change what the author must weigh

This is the complete author-facing vocabulary. `confidence`, skeptic reasoning, and every other reviewer-internal field stay in the debug trace — the renderer has no channel for them, so the synthesizer must not fold them into `problem` as prose.

Serialize the object to a temporary JSON file and render it with `.cursor/skills/review/scripts/review-report.mjs`. The script validates the schema, orders findings by disposition and then severity, derives the verdict and counts, and emits the final text. Never hand-format around it.

### Incomplete assessment

`assessment` is `{ "status": "complete" }` by default and may be omitted. Set `{ "status": "incomplete", "reason": "<one concise sentence>" }` only when the review could not be completed — a reviewer that could not run, history the scan could not resolve, or a center of gravity the concern registry does not model well enough to assert a merge contract over.

An incomplete report states the reason, claims no mergeability, renders `Verdict: Review Incomplete`, and lists any blockers found so far as findings rather than as a merge contract. A complete assessment with zero blockers still states that the PR is mergeable. Coverage gaps that do not undermine the merge claim stay in the debug trace.

### Merge contract

When blockers exist, lead with: `Fix this item and this PR is mergeable.` or `Fix these items and this PR is mergeable.` List every blocking ID before optional findings. Fixing those IDs is the complete merge contract for the reviewed head; a re-review checks them plus the incremental diff for newly introduced risks.

Do not emit headings, summaries, or status lines for processors that returned no findings. Clean tech-debt, documentation-drift, instrumentation, security, contract-evolution, and other lens results remain silent. Avoid repeating the same finding under multiple concern headings unless the cross-concern interaction is itself the problem.

### Re-review state

Immediately before the operator recap, the renderer emits a hidden `pathfinder-review-state` HTML comment containing version 1, `reviewed_head`, and each blocking finding's ID and owning concern. Only `review-report.mjs --parse-state` may consume it, and only from that trailing position: the parser accepts the marker solely when it occupies its own line directly above a well-formed operator recap, so a marker quoted inside a finding or appended after the recap is never read as state. A malformed, misplaced, or duplicated marker, or a non-ancestor head, disables the incremental fast path.

### Operator recap

The last four lines are always:

```text
PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702
Purpose: add divider guide blocks
Verdict: Request Changes
1 blocking, 2 suggestions, 3 nits
```

`Purpose` contains no newline and is capped at 120 characters. The renderer chooses `Approve`, `Approve with Minor`, `Request Changes`, or `Review Incomplete`. Nothing follows the count line.

### Debug trace

Routing decisions, clean processor results, coverage gaps without an author action, verification drops, skeptic reasoning, call counts, and stage timings belong in an internal debug trace. Show it only when the user explicitly requests diagnostics.
