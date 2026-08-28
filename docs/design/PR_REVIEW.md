# PR Review — Standards and Pattern Catalog

Canonical reference for what reviewers (human or agent) check against when reviewing a PR in this repository. Tool-neutral. Both Cursor and Claude Code skills load this document.

The orchestration workflow that uses this catalog lives in `.cursor/skills/review/SKILL.md` (invoked via `/review`). The concern routing table lives in `docs/design/CONCERNS.md`; per-concern review guidance, one-way doors, and contract anchors live in `docs/design/CONCERN_DETAILS.md` and are extracted one concern at a time by `.cursor/skills/review/scripts/concern-context.mjs`.

## Reviewer output schema

Every reviewer (subsystem or cross-cutting) emits the same schema.

If findings exist, include:

- `concern_id`
- `finding_id`
- `severity`
- `confidence`
- `recommended_disposition` — `blocking | follow_up | suggestion | nit`
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
- `follow_up`: a real finding with real consequence that is deliberately outside this PR's merge contract
- `suggestion`: concrete non-blocking improvement, including an optional question
- `nit`: minor style or wording preference

Severity describes **defect impact**: how bad the condition is. Disposition describes **merge impact**: whether the repository is better off without this change than with it. Those are different axes, and conflating them is what drives findings toward `blocking`. A medium finding can be blocking when the ambiguity must be resolved before merge, and a critical-severity condition the PR merely exposes can be a `follow_up`.

Reviewers recommend a disposition, and §4b normalizes and deduplicates those recommendations before policy resolution. `review-policy.mjs` owns every transition after that point: one-way-door promotion, verification dispatch and adjudication, and the final blocking-gate decision. Its final disposition may not be changed downstream.

A `follow_up` carries one field beyond the standard finding set:

- `owner` — `maintainer | author`

The standard finding fields are also the proposed issue text: use `title` as the issue title and `problem` plus `suggested_action` as its body. The invoker decides whether to file it. No part of the review files GitHub issues.

### Review policy and skeptic verdict shape

Run `.cursor/skills/review/scripts/review-policy.mjs` as the single policy entry point described in `.cursor/skills/review/SKILL.md` §4c. It promotes a `partially_reversible` or `irreversible_without_cleanup` recommendation to `blocking` before selecting a verification lane, then collects skeptic verdicts on two axes, truth and warrant:

```json
{ "verdict": "confirmed", "blocking_warranted": "no", "reason": "<evidence that confirms or contradicts>" }
```

- `verdict` — `confirmed | refuted | uncertain`; is the finding true?
- `blocking_warranted` — `yes | no | uncertain`; should it stop the merge? Required only when the finding's `recommended_disposition` is `blocking`, and ignored otherwise
- `reason` — non-empty, citing the evidence

Truth is adjudicated first, then warrant. The facade uses `adversarial-policy.mjs` internally to resolve each finding to `kept`, `dropped`, or `demoted`. A `demoted` finding is finalized as a `follow_up`, not dropped — it stays visible in the report and in the marker's `deferred` list.

The warrant axis is read **among confirming verdicts only**, and it demotes when there is at least one confirming verdict and _every_ confirming verdict answers `no`. A skeptic who refutes a finding has already said it is not true, so its `blocking_warranted: "no"` restates that refutation rather than judging whether a true finding should stop the merge; counting it would let a refuter break a tie between the skeptics who actually believe the finding. Truth adjudication alone decides what a refutation is worth.

Unanimity among believers is the bar because keeping a blocker whose only believer says it should not block is precisely the over-blocking this calibration exists to remove. The `at least one` clause is not redundant: with zero confirming verdicts the condition is vacuously unanimous, and an all-uncertain trail must resolve `kept` rather than demote on a unanimity nobody expressed.

### Blocking gate answers

When `review-policy.mjs` returns `needs_gate_answers`, add the answers below to the same policy input and call the facade again. The facade passes every verified proposed blocker to `blocking-gate.mjs` internally and returns its `{ disposition, reason, override, override_source, gate_failures }` as the final decision. Never call the inner gate or hand-apply its table.

| Answer                           | Rule                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `reversibility` (on the finding) | Optional; one of the four reversibility values. A one-way door suppresses rows 7 and 8                |
| `round`                          | Positive integer, clamped at 100; read from the re-review marker, or derived per §3a when none exists |
| `override`                       | `null`, or one of `security`, `data_loss`, `credential_exposure`, `shipped_path_breakage`             |
| `authorship`                     | `regression \| pre_existing \| latent_exposed`, judged against the base commit                        |
| `latent_reachable`               | Required when `authorship` is `latent_exposed`                                                        |
| `breaks_live_path`               | Does the condition break a path that ships today?                                                     |
| `concrete_risk_now`              | Is there a concrete risk at this head, not a hypothetical future one?                                 |
| `boundable_by_followup`          | Can a tracked follow-up hold this safely?                                                             |
| `precedent_count`                | Non-negative count of already-merged PRs shipping the same property                                   |
| `induced_by_prior_suggestion`    | Does this blocker exist only because of code added in response to a prior-round suggestion or nit?    |
| `attribution`                    | `prior_unresolved \| since_prior_head \| late`; required from round 2 onward                          |
| `late_blocker_reason`            | Required and non-empty when `attribution` is `late`                                                   |
| `prior_contract_satisfied`       | Optional context for the §4b contract-anchor judgment; no decision rule reads it                      |
| `contradicts_cleared`            | Optional `{ claim, reason, new_evidence }` quoting a `cleared` marker entry this finding overturns    |

The `override` list is the entire safety net. Its **membership** is fixed at exactly `security`, `data_loss`, `credential_exposure`, and `shipped_path_breakage`, and must not grow. Once an override applies, it is never weakened by round, precedent, or authorship — it blocks unconditionally. Whether `shipped_path_breakage` applies, by contrast, _is_ derived from authorship, deliberately, per the rule below; that is a rule for resolving an override, not a condition that weakens one.

**The gate derives `shipped_path_breakage` itself.** When `breaks_live_path` is true, the reviewer supplied no `override`, and this PR is what breaks the path — `authorship` is `regression`, or `latent_exposed` with `latent_reachable` true — the gate resolves the override to `shipped_path_breakage` before any demotion rule runs. A reviewer never has to think to hand-set it: a shipped path that breaks because of this change blocks unconditionally at any round, whatever its precedent count, induced scope, or attribution. That derivation is what makes the late-finding demotion in row 2 safe, and what keeps rows 3, 4, and 8 from demoting such a finding, since it never reaches them.

The derivation keys on the shipped path breaking **because of this PR**, not merely on the shipped path breaking. `pre_existing` with `breaks_live_path` true is deliberately excluded: that path was already broken at the base commit, so row 5 demoting it is the correct outcome, and blocking would charge this author for someone else's breakage. `latent_exposed` splits on `latent_reachable` for the same reason — this PR is what made the condition reachable, so the breakage is this PR's, while one that stays unreachable is still demoted by row 6.

The gate returns the resolved `override` and an `override_source` of `supplied` or `derived`, so the trace can tell a reviewer's judgment from the gate's. Both are `null` when no override applies. An explicitly supplied override always wins and is never replaced by the derived one — a reviewer's `security` on a live-path regression resolves to `security` from `supplied`.

`gate_failures` lists every demoting condition that held, not only the one that decided the outcome — including on an override, whether supplied or derived, so the debug trace shows what the override outranked.

A round above 100 is clamped to 100 rather than rejected, in both the gate and the renderer: the bound exists to keep the marker small, and a PR with that many review submissions must still get a report. Every round-budget rule reads as `round >= 3` by then, so clamping changes no decision. A round that is not a positive integer is still rejected — that is a caller bug, not a large-PR fact.

#### Decision table

First match wins, in this order. The reason code is the stable identifier; cite it rather than the row number, which is meaningful only against this table.

| Row | Condition                                                                  | Disposition | Reason                   |
| --- | -------------------------------------------------------------------------- | ----------- | ------------------------ |
| 1   | `override` is supplied, or derived per the rule above                      | `blocking`  | `unconditional-override` |
| 2   | `attribution` is `late`                                                    | `follow_up` | `late-peripheral`        |
| 3   | `precedent_count >= 2`                                                     | `follow_up` | `policy-change`          |
| 4   | `induced_by_prior_suggestion`                                              | `follow_up` | `induced-scope`          |
| 5   | `authorship` is `pre_existing`                                             | `follow_up` | `pre-existing`           |
| 6   | `authorship` is `latent_exposed` and `latent_reachable` is false           | `follow_up` | `latent-unreachable`     |
| 7   | neither `breaks_live_path` nor `concrete_risk_now`, and not a one-way door | `follow_up` | `no-live-impact`         |
| 8   | `boundable_by_followup`, and not a one-way door                            | `follow_up` | `safely-bounded`         |
| 9   | no rule above holds                                                        | `blocking`  | `warranted`              |

**A one-way door is not boundable by a follow-up.** Before verification, `review-policy.mjs` promotes every `partially_reversible` or `irreversible_without_cleanup` recommendation to `blocking`, regardless of its original recommendation. It therefore receives blocker-level verification and the warrant question before reaching the gate. Rows 7 and 8 are the two that demote on the premise that the finding can wait, so neither holds for a one-way door; provenance and precedent rows may still demote it. This ordering lets the gate remain the final authority without allowing a downstream elevation to bypass verification.

Row 2 carries no carve-out. A late finding that breaks a shipped path because of this PR already blocked at row 1 on the derived override, so it never reaches row 2 — the exception lives at row 1, as one rule, rather than as a clause repeated on another. Row 2 therefore holds on lateness alone, and `gate_failures` records it even where row 1 outranked it.

Rows 2 through 8 are the `DEMOTIONS` list in `blocking-gate.mjs`, in source order. No single answer set can make all seven hold — `pre-existing` and `latent-unreachable` demand different `authorship` values — so the order is pinned by two complementary `gate_failures` fixtures in the row 1 test, one per `authorship`. Between them they pin every adjacent pair any input can observe; rows 5 and 6 are mutually exclusive, so their relative order is unobservable and unpinned by construction. Reordering the list fails the suite rather than silently renumbering this table.

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

This table is the only source of recommendation truth **for the contract evolution scan**. `.cursor/skills/review/scripts/contract-evolution-policy.mjs` implements it. Its `advisory` value is scan-internal vocabulary: `contract-evolution-policy.mjs` maps it to `suggestion` when it converts a packet to a reviewer finding. The shared review policy still owns the final author disposition.

Its `blocking` rows are **recommendations**, not final dispositions. A contract verdict recommends; §4c's shared policy disposes, and it may demote any of these rows to `follow_up`. An advisory `contract_missing` packet that names a proposed owner stays a `suggestion`.

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

Reviewer-internal vocabulary for labelling findings before normalization. The author-facing report carries only the four dispositions `review-report.mjs` accepts: a `[question]` becomes `blocking`, `follow_up`, or `suggestion` per the disposition guidance above, and `[security]` and `[react]` become the finding's `concern_id`.

| Prefix         | Meaning                     |
| -------------- | --------------------------- |
| `[blocking]`   | Must fix before merge       |
| `[suggestion]` | Nice to have                |
| `[question]`   | Seeking clarification       |
| `[nit]`        | Minor style preference      |
| `[security]`   | Security concern (F1-F6)    |
| `[react]`      | React anti-pattern (R1-R21) |

## Disposition

| Disposition            | Criteria                                           |
| ---------------------- | -------------------------------------------------- |
| **Approve**            | Meets all standards, nothing to raise              |
| **Approve with minor** | Follow-ups, suggestions, or nits, nothing blocking |
| **Request changes**    | Blocking issues must be addressed                  |

## Final review report

The final assembly phase emits this `ReviewReport` object after all supplemental checks finish:

| Field           | Type   | Rule                                                       |
| --------------- | ------ | ---------------------------------------------------------- |
| `pr_url`        | string | Full `https://github.com/<owner>/<repo>/pull/<number>` URL |
| `pr_title`      | string | Current PR title; the renderer derives a one-line purpose  |
| `reviewed_head` | string | Full 40-character commit SHA                               |
| `findings`      | array  | Retained, verified, deduplicated author-facing findings    |
| `round`         | number | Optional; defaults to 1. Positive integer, clamped at 100  |
| `cleared`       | array  | Optional; every claim cleared so far on this PR            |
| `assessment`    | object | Optional; defaults to complete. See Incomplete assessment  |

Each `findings` entry contains:

- `id` — stable across re-reviews, and unique within the report
- `concern_id` — owning concern; rendered compactly and used to route an incremental re-review
- `disposition` — `blocking | follow_up | suggestion | nit`
- `severity` — `critical | high | medium | low`; rendered compactly
- `title`
- `problem` — concise evidence and consequence written for the PR author, in one rendered line
- `suggested_action` — the smallest change that resolves the finding
- `reversibility` — optional; one of the four reversibility values. The renderer surfaces only `partially_reversible` and `irreversible_without_cleanup`, because only those change what the author must weigh
- `owner` — required on a `follow_up`; `maintainer | author`

Each `cleared` entry contains `claim` (≤ 200 characters), `concern_id`, and `reason` (≤ 300 characters): a claim a round examined and found sound, so a later round cannot silently reverse it. The array accumulates for the life of the PR — final assembly unions the prior marker's entries with this round's, deduplicated by claim. This is unlike `deferred`, which shrinks as its entries are resolved. At most 12 entries, and past that count the renderer rejects the report, so final assembly prunes the least load-bearing entries. Exceeding the list's character budget is different: there the marker truncates and declares saturation rather than failing, which costs the next round a full review. No free-text marker field may embed `<!-- pathfinder-review-state:` or `-->`; the renderer rejects both rather than escaping them, because either would break the hidden comment or forge a second one.

Follow-ups render in their own `## Follow-ups` section between the merge contract and `## Suggestions`, under the fixed line `These are tracked separately and do not block merge.` They count toward `Approve with Minor` and never toward `Request Changes`.

**Follow-up count does not fail rendering.** The renderer always renders every finding. Every follow-up a round produces is offered to the marker's `deferred` list — policy demotions, normalized suggestion-surface findings, tech debt, doc drift, and instrumentation alike — and reaches it unless the marker saturates, which it declares by setting `truncated: true`. A pathologically large author-facing report can still exceed GitHub's body limit; that is a signal to split the round or recalibrate the finding set, not to hide finding detail.

This is the complete author-facing vocabulary. `confidence`, skeptic reasoning, and every other reviewer-internal field stay in the debug trace — the renderer has no channel for them, so final assembly must not fold them into `problem` as prose.

Serialize the object to a temporary JSON file and render it with `.cursor/skills/review/scripts/review-report.mjs`. The script validates the schema, orders findings by disposition and then severity, derives the verdict and counts, and emits the final text. Never hand-format around it.

### Incomplete assessment

`assessment` is `{ "status": "complete" }` by default and may be omitted. Set `{ "status": "incomplete", "reason": "<one concise sentence>" }` only when the review could not be completed — a reviewer that could not run, history the scan could not resolve, or a center of gravity the concern registry does not model well enough to assert a merge contract over.

An incomplete report states the reason, claims no mergeability, renders `Verdict: Review Incomplete`, lists any blockers found so far as findings rather than as a merge contract, and publishes no re-review state marker. A complete assessment with zero blockers still states that the PR is mergeable. Coverage gaps that do not undermine the merge claim stay in the debug trace.

### Merge contract

When blockers exist, lead with: `Fix this item and this PR is mergeable.` or `Fix these items and this PR is mergeable.` List every blocking ID before optional findings. Fixing those IDs is the complete merge contract for the reviewed head; a re-review checks them plus the incremental diff for newly introduced risks.

Do not emit headings, summaries, or status lines for processors that returned no findings. Clean tech-debt, documentation-drift, instrumentation, security, contract-evolution, and other lens results remain silent. Avoid repeating the same finding under multiple concern headings unless the cross-concern interaction is itself the problem.

### Re-review state

Immediately before the operator recap, a **complete** review emits a hidden `pathfinder-review-state` HTML comment. The renderer always writes **version 2**:

```json
{
  "version": 2,
  "round": 3,
  "reviewed_head": "<40 hex>",
  "blocking_findings": [{ "id": "B1", "concern_id": "security" }],
  "deferred": [{ "id": "F1", "concern_id": "reversibility-and-one-way-door" }],
  "cleared": [{ "claim": "...", "concern_id": "...", "reason": "..." }],
  "truncated": true
}
```

`truncated` appears only when a list was cut to fit; a marker that held everything omits it.

`deferred` is derived from the report's follow-ups, so it cannot drift from what the report says — and so an entry the author has fixed leaves the list, because final assembly stops carrying a follow-up for it. It holds bare identifiers, not proposed-issue prose: an identifier is all a later round needs to recognize what it must not re-raise, and keeping them small is what stops `deferred` competing with `cleared` for the marker's character budget. The two lists have different lifetimes: `deferred` tracks outstanding work and shrinks as that work lands, `cleared` is a record and only grows until its own cap prunes it. `cleared` is the machine-readable form of what a round would otherwise write as prose under "Things I checked, so you do not have to"; carrying it forward is what stops a later round reversing an earlier clearance without noticing. `deferred` and `cleared` hold **separate** character budgets — 3300 and 4500 within an 8192-character marker — checked independently on both the render and parse sides, so within their own budgets neither squeezes the other. The arithmetic: a `deferred` entry is a bare `{ id, concern_id }` pair measuring 48 characters at a typical concern and 65 at the longest, so its budget holds roughly fifty; a `cleared` entry measures about 267 characters at typical claim and reason lengths and 367 at generous ones, so its budget holds all 12 the count cap allows.

**Saturation is a declared state, not a failure.** Past those budgets the renderer drops entries from the tail — each list down to its own budget first, then `cleared` and finally `deferred` against the total, with `blocking_findings` never yielding — and sets `truncated: true`. §3a treats a truncated marker exactly like an absent one: the next round runs a **full** review, which re-derives every finding from the diff. That is why truncation is safe to prefer over throwing. It costs a more expensive round and can surface a previously deferred item again; it cannot lose a defect.

`--parse-state` checks shape and size caps and **never provenance**: it cannot tell whose review a body came from, so it establishes no trust on its own. Because `deferred` and `cleared` suppress later-round work, the caller carries that precondition — `.cursor/skills/review/SKILL.md` §3a honors a marker only from the same reviewer's own prior review and treats one found anywhere else as absent.

Only `review-report.mjs --parse-state` may consume the marker, and only from that trailing position: the parser accepts it solely when it occupies its own line directly above a well-formed operator recap, so a marker quoted inside a finding or appended after the recap is never read as state. It accepts either LF or CRLF line endings, because a body edited through the GitHub web UI comes back CRLF-encoded. A malformed, misplaced, or duplicated marker, or a non-ancestor head, disables the incremental path.

`truncated` is optional and only ever `true`; the parser rejects any other value and reports `truncated: false` when it is absent. A truncated marker's `deferred` length is a prefix of the recap's follow-up count rather than equal to it, so the parser relaxes that consistency check in exactly that case and no other.

**Version 1 compatibility window.** The parser also accepts a version 1 marker under a three-count recap, normalizing it to the version 2 field set with `round: 1` and empty `deferred` and `cleared`, and preserving `version: 1` so a caller can tell. That `round: 1` is a field-set artifact, not evidence: a caller reading a version 1 marker derives the round from the prior-review count instead, exactly as it would with no marker at all. Open PRs carry v1 markers, so this stays for at least one release cycle. The compatibility surface is exactly two places — the recap's optional follow-up count group and the parser's version branch. Do not add compatibility shims anywhere else.

An **incomplete** review emits no marker at all. Its coverage hole is exactly what an incremental baseline must not inherit, so every later review of that PR falls back to a full review.

### Operator recap

The last four lines are always:

```text
PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702
Purpose: add divider guide blocks
Verdict: Request Changes
1 blocking, 2 follow-ups, 2 suggestions, 3 nits
```

`Purpose` contains no newline and is capped at 120 characters. The renderer chooses `Approve`, `Approve with Minor`, `Request Changes`, or `Review Incomplete`, deriving it from the four counts: any blocker means `Request Changes`, any other count means `Approve with Minor`, otherwise `Approve`. The renderer always emits the four-count form; the parser also reads a legacy three-count recap. Nothing follows the count line.

The JSON disposition value is `follow_up` everywhere — reviewer schema, report schema, marker, and gate output. The rendered human label is `follow-up` and the recap word is `follow-ups`. Only one of those forms ever appears in data.

### Debug trace

Routing decisions, clean processor results, coverage gaps without an author action, verification drops, skeptic reasoning, gate demotions and their `gate_failures`, call counts, and stage timings belong in an internal debug trace. Show it only when the user explicitly requests diagnostics.
