# PR review standards and pattern catalog

This is the canonical reference for review observations, verification, contract evolution, publication, and language-specific checks. Orchestration lives in `.cursor/skills/review/SKILL.md`; routing lives in `docs/design/CONCERNS.md`; concern details are loaded with `concern-context.mjs`.

## Canonical observation

Every routed reviewer and supplemental check emits the same factual observation. Producers describe evidence; they never decide merge impact.

```text
finding_id
concern_id
kind                    defect | suggestion | nit
severity                critical | high | medium | low
confidence              high | medium | low
title
evidence                non-empty string array
why_it_matters
suggested_action
reversibility           reversible | partially_reversible | irreversible_without_cleanup | unknown
applies_to_files         string array
origin                  regression | pre_existing | latent_reachable | latent_unreachable
impact                  none | ordinary | security | data_loss | credential_exposure
timing                  first_round | prior_unresolved | since_prior_head | late
scope_effect            within_changed_surface | widens_changed_surface
breaks_shipped_path     boolean
induced                 boolean
clearance_contradiction optional { claim, prior_reason, new_evidence }
```

`ordinary` is concrete, reachable behavior, contract, or rollback harm at the reviewed head. `none` means no current behavior or contract harm. `latent_reachable` means this PR makes a latent condition reachable; `latent_unreachable` remains unreachable. `induced` means the condition exists only because the author implemented optional earlier advice. `widens_changed_surface` means the action needs a new path, component, exported symbol, user-facing affordance, or unrelated changed path.

When there are no observations, a reviewer emits `{ concern_id, status: "no_findings", reason: "not_applicable" | "reviewed_clean" }`.

### Severity and confidence

- `critical`: security exposure, severe rollback hazard, or production-breaking regression.
- `high`: likely correctness bug, contract break, or missing verification on a high-risk semantic change.
- `medium`: meaningful risk or ambiguity.
- `low`: concrete non-blocking improvement or minor issue.
- `high` confidence requires checked code or contract evidence; `medium` has partial evidence; `low` is plausible but uncertain.

## Verification

Skeptics answer truth only:

```json
{ "verdict": "confirmed", "reason": "<non-empty checked evidence>" }
```

`verdict` is `confirmed`, `refuted`, or `uncertain`. No other field is accepted.

`review-policy.mjs` derives the lane from observation facts:

- A critical, high, or provisionally blocking defect gets two independent skeptics and one tiebreaker only when needed. It drops only on a two-of-three refutation majority.
- A medium non-blocking defect gets one skeptic and an adjudicator only after a refuted or uncertain first verdict. It drops only when the adjudicator refutes.
- A low non-blocking defect and every optional observation pass without verification.

Related findings with the same concern and evidence surface may share a packet in groups of four. The two independent skeptic roles never share an agent. Verification yields `needs_verification`, `established`, or `dropped`; it never yields a disposition.

## Disposition policy

For an established defect, `review-policy.mjs` applies this closed rule in order:

1. PR-caused or newly reachable protected harm is `blocking`.
2. A pre-existing or unreachable latent condition is `follow_up`, including protected harm.
3. A condition induced by optional earlier advice is `follow_up`, unless rule 1 applies.
4. A late finding is `follow_up`, unless rule 1 applies.
5. A PR-caused one-way door is `blocking`.
6. A condition with no current harm is `follow_up`.
7. Every other confirmed regression or newly reachable condition is `blocking`.

Protected harm is derived from either a `security`, `data_loss`, or `credential_exposure` impact, or `breaks_shipped_path: true`, combined with `regression` or `latent_reachable` origin. One-way-door status is derived from `reversibility`.

Optional observations use the same facade. A scope-widening suggestion or nit becomes `follow_up`. At round three or later, a new suggestion or nit drops. A prior unresolved optional observation may carry by stable ID without new prose only when its finding ID and concern exactly match an entry in the facade's `prior_deferred` input. Before round three, optional work within the changed surface preserves its `suggestion` or `nit` kind.

Every policy request, verification-batch request, and `ReviewReport` supplies an explicit integer round from 1 through 100. Missing or out-of-range values fail closed. Only the orchestrator derives a fallback when a version 1 marker supplies no reliable round.

The facade returns only `needs_verification`, `final`, or `dropped`. A final result has one disposition and one stable reason. No downstream phase changes it.

## Reconciliation

After disposition and before publication, call `review-policy.mjs` with `operation: "reconcile"`:

```text
next_deferred = verified-unresolved(prior_deferred) union current_follow_up_ids
next_cleared  = dedupe(current_cleared union prior_cleared)
```

A deferred entry leaves only when its stable ID appears in `verified_fixed_ids`. Every current follow-up must enter `current_follow_ups`. Clearances deduplicate by claim and retain at most 12 load-bearing entries; order current entries from most to least important before prior entries when pruning matters. Reconciliation and publication share one clearance schema: `concern_id` is a lowercase concern identifier, `claim` is one line of at most 200 characters, `reason` is one line of at most 300 characters, and neither text field may contain a review-state marker or HTML comment terminator. Reconciliation normalizes whitespace before deduplication and returns publication-ready clearance entries unchanged.

A candidate that contradicts a prior clearance must carry its exact claim and reason plus checked new evidence. The facade rejects a contradiction that does not match prior state.

## Contract evolution packet

Contract evolution is a conditional specialist scan. Its packet records:

- `concern_id`
- `origin_or_contract_anchor`
- `recent_semantic_changes`: `{ pr, sha, timestamp, summary }[]`
- `current_contract_owner`
- `new_contract_delta`
- `competing_owners_or_representations`
- `verdict`
- `history_status`
- `use_ordinal`
- `same_bug_count`
- `has_recorded_anchor`
- `anchor_violated`
- `branching_conditions`
- `sources`: immutable source IDs with selection reasons
- `finding` for every non-clean verdict

Verdicts are `follows_contract`, `coherent_extension`, `contract_missing`, `contract_branching`, and `insufficient_history`. History is `complete`, `partial`, or `unavailable`. Use ordinal is `first`, `second`, or `third_or_later`.

The adapter preserves factual contract state:

| Evidence state                                                                   | Observation       |
| -------------------------------------------------------------------------------- | ----------------- |
| Follows the contract or extends one owner coherently                             | none              |
| No owner                                                                         | medium suggestion |
| Early branching without a mature tripwire                                        | medium suggestion |
| Anchor violation, third-or-later use, or repeated bug plus a branching condition | high defect       |
| Partial or unavailable history without an anchor                                 | low suggestion    |

The adapter emits a canonical observation for non-clean states. The shared policy alone decides disposition.

Before asserting `contract_branching` or `contract_missing`, inspect the head implementation of every claimed competing owner. An anchor violation requires a recorded anchor. Incomplete history cannot establish a clean result unless an anchor supplies the missing contract.

## React reliability, security, and quality checks

Apply security rules F1–F6 to frontend changes. For a React hit, use `.cursor/rules/react-antipatterns.mdc` to load the matching themed rule. These severities feed observations, not dispositions.

| What to look for                                             | ID  | Sev      |
| ------------------------------------------------------------ | --- | -------- |
| Effect resource without cleanup                              | R1  | Critical |
| Stale state read in a callback                               | R2  | High     |
| Object or array literal in effect dependencies               | R3  | Critical |
| Async effect without cancellation or mounted guard           | R4  | High     |
| Direct state mutation                                        | R5  | Critical |
| Risky tree without an error boundary                         | R6  | High     |
| Search or filter effect without cancellation                 | R7  | High     |
| Conditional hook call                                        | R8  | Critical |
| Index key in a dynamic list                                  | R9  | Medium   |
| Promise chain without error handling                         | R10 | High     |
| Frequently changing context value                            | R11 | Medium   |
| Inline value passed to a memoized child                      | R12 | Medium   |
| Effect without a dependency array                            | R13 | Critical |
| State and effect used for a derived value                    | R14 | Medium   |
| DOM listener without cleanup                                 | R15 | High     |
| Heavy synchronous render work                                | R16 | High     |
| Nested mount-time fetch waterfall                            | R17 | High     |
| Storage access in a render path or loop                      | R18 | Medium   |
| Spinner as initial primary content                           | R19 | Medium   |
| Image without dimensions or async content without a skeleton | R20 | Medium   |
| External script without `defer` or `async`                   | R21 | Medium   |
| Untrusted dynamic SVG without sanitization                   | F1  | Critical |
| Raw HTML where React escaping is sufficient                  | F2  | High     |
| URL string concatenation instead of `URL` APIs               | F3  | High     |
| Raw HTML without Grafana sanitization                        | F4  | Critical |
| Raw DOM or script sink                                       | F5  | Critical |
| Unvalidated URL in `href` or `src`                           | F6  | High     |
| New component over 400 lines or five responsibilities        | QC1 | Medium   |
| State bag with more than ten unrelated properties            | QC2 | Medium   |
| Duplicated logic across files                                | QC3 | Medium   |
| Existing utility ignored for a reimplementation              | QC4 | Medium   |
| `any` or missing contract types                              | QC5 | Medium   |
| Missing tests for changed semantics                          | QC6 | High     |
| Missing accessible name or keyboard interaction              | QC7 | Medium   |
| Decorative, stale, or restating comments on touched code     | QC8 | Medium   |

For QC8, use the keep-list in `AGENTS.md`. Load `.cursor/skills/comment-hygiene/SKILL.md` only for a borderline call or to cite a shape number. Flag changed lines and stale adjacent comments inside a changed function, not untouched cleanup.

## Go backend checks

For `pkg/**/*.go` changes, also check:

| What to look for               | ID  | Sev      |
| ------------------------------ | --- | -------- |
| Unchecked error                | G1  | High     |
| Resource leak                  | G2  | Critical |
| Goroutine without cancellation | G3  | High     |
| Unsynchronized shared state    | G4  | Critical |
| Unsafe input handling          | G5  | High     |
| Missing context propagation    | G6  | Medium   |
| Hardcoded secret or credential | G7  | Critical |

Verify `npm run lint:go`, `npm run test:go`, and `go build ./...`.

## Final review report

After policy and reconciliation, render one `ReviewReport`:

| Field           | Rule                                               |
| --------------- | -------------------------------------------------- |
| `pr_url`        | Full GitHub pull request URL                       |
| `pr_title`      | Current title; renderer derives a one-line summary |
| `reviewed_head` | Full 40-character commit SHA                       |
| `findings`      | Final author-facing findings                       |
| `round`         | Explicit integer from 1 through 100                |
| `deferred`      | Exact `next_deferred` from reconciliation          |
| `cleared`       | Exact `next_cleared` from reconciliation           |
| `assessment`    | Optional complete or incomplete status             |

Each finding contains only `id`, `concern_id`, `disposition`, `severity`, `title`, `problem`, `suggested_action`, and optional `reversibility`. Disposition is `blocking`, `follow_up`, `suggestion`, or `nit`. The report does not carry confidence, reviewer reasoning, or follow-up ownership.

`review-report.mjs` validates, sorts by disposition then severity, renders every retained finding, derives the verdict and counts, and emits exactly one marker plus one trailing operator recap. It performs no policy decisions.

Rendering does not authorize publication. Present the complete output to the user and obtain explicit approval before posting it or otherwise mutating GitHub.

An incomplete assessment needs one concise reason, claims no mergeability, and emits no marker. A complete report with no blockers says the PR is mergeable.

### Re-review state

The renderer writes version 2 only:

```json
{
  "version": 2,
  "round": 3,
  "reviewed_head": "<40 hex>",
  "blocking_findings": [{ "id": "B1", "concern_id": "security" }],
  "deferred": [{ "id": "F1", "concern_id": "documentation-alignment" }],
  "cleared": [{ "claim": "...", "concern_id": "...", "reason": "..." }]
}
```

When that complete value exceeds `MAX_MARKER`, it writes only:

```json
{
  "version": 2,
  "round": 3,
  "reviewed_head": "<40 hex>",
  "blocking_findings": [],
  "deferred": [],
  "cleared": [],
  "truncated": true
}
```

A truncated marker always forces a full next review. The parser keeps version 1 and legacy `Purpose` recap read compatibility, recap adjacency, strict shape checks, and fail-closed behavior for malformed, duplicated, forged, oversized, or misplaced state. Provenance and ancestor validation remain caller preconditions: suppressive state is honored only from the same reviewer's prior review and only when `reviewed_head` is an ancestor.

### Operator recap

The last four lines are always:

```text
PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702
Summary: add divider guide blocks
Verdict: Request Changes
Results: 1 blocker, 5 non-blocking findings, 2 follow-ups
```

Nothing follows the results line. `Summary` is one line of at most 120 characters. `Verdict` is `Approve`, `Approve with Minor`, `Request Changes`, or `Review Incomplete`. Results count current rendered findings: suggestions plus nits are non-blocking findings, and carried deferred IDs without repeated prose are not follow-ups.

### Debug trace

Keep routing decisions, clean results, refutations, skeptic reasons, policy reason codes, worker count, skeptic batch count, context characters, full-versus-incremental mode, and timings internal. Show the trace only when the user requests diagnostics.
