# review-lite result format

`finish` reads one JSON object. It validates structure and identifiers, derives the headline, and writes `report.md` plus, for a complete assessment, `state.json`. It cannot tell whether evidence is true. Never write a claim you did not check.

## Fields

<!-- prettier-ignore -->
| Field | Type | Rules |
| --- | --- | --- |
| `assessment` | `complete` \| `incomplete` | `incomplete` only when missing evidence prevents a material conclusion. An incomplete run writes no state. |
| `limitations` | string[] | Scope you could not cover, unrouted files you did not read, missing independence. May be empty. |
| `coverage` | object[] | One entry per selected concern (`selected.json`), including the five always-on IDs. |
| `coverage[].concern_id` | string | A selected concern ID. |
| `coverage[].status` | `checked` \| `not_applicable` \| `unresolved` | A complete assessment allows no `unresolved`. |
| `coverage[].evidence` | string | What you inspected. For `not_applicable`, the concrete reason. |
| `checks` | object[] | Decisions for every required item in `obligations.json`: sync/doc-gap/delta items, unselected concern candidates, and generated governing-input or risk-verification nominations. Selected concern candidates need no entry. |
| `checks[].id`, `status`, `evidence` | string | Use the generated ID; status is `checked`, `irrelevant`, or `unresolved`. Unselected concerns require `irrelevant` with a concrete reason. Complete assessments allow no unresolved checks. |
| `checks[].governing` | object | Required when a governing-input obligation is `checked`: `kind` (`normative_spec`, `external_schema`, or `fixture_contract`), `source`, `pin`, and `applicability`. A local source is `head:path` or `base:path`, with the matching commit SHA as `pin`; an external HTTPS source must contain its immutable pin. The helper validates local blobs and the external reference shape, not remote availability. |
| `checks[].verification` | object | Required when a risk-verification obligation is `checked`: `invariant`, `falsifying_scenario`, `expected`, `observed`, `method` (`targeted_test`, `probe`, `mutation`, `contract_comparison`, or `static_trace`), and a relative `artifact` that exists in the run directory. |
| `findings` | object[] | `blocker`, `separate_work`, or optional `suggestion` (`nit` remains a compatible alias). At most five nits. |
| `findings[].id` | string | Short, stable, `^[A-Za-z][A-Za-z0-9-]{0,31}$`. Reuse the same ID for the same invariant across rounds. |
| `findings[].concern_id` | string | A selected concern ID. |
| `findings[].disposition` | `blocker` \| `separate_work` \| `suggestion` \| `nit` |  |
| `findings[].title`, `location`, `evidence`, `consequence`, `base_comparison` | string | Required for a blocker or separate work. A suggestion/nit needs only `title`, `location`, and `evidence`. `location` is `path:line` or a symbol. `base_comparison` says what base did. |
| `findings[].required_invariant` | string | Required for a blocker. State the property, not a patch. |
| `findings[].merge_reason` | string | Required for a blocker: why it must be fixed before merge. |
| `findings[].next_action` | string | Required for separate work (a maintainer-owned next action) and for a suggestion/nit (the suggested change). |
| `findings[].deferral_basis`, `deferral_reason` | string | Required for separate work. Basis is `pre_existing`, `accepted_scope`, or `late_round_convergence`; explain why it belongs outside this merge. `accepted_scope` also needs `scope_decision`; late-round convergence is allowed only in round 3+. |
| `findings[].attribution` | `introduced` \| `newly_exposed` \| `pre_existing` | Required for separate work. `pre_existing` also requires the `pre_existing` basis, and `base_comparison` must cite base code as `path:line` and say whether the PR changed its stored-state effect. |
| `tests` | object[] | One entry per changed, non-deleted test file in `inventory.json` `review_files`. Required for a complete assessment when any test file changed. |
| `tests[].path` | string | A changed test file. |
| `tests[].read` | boolean | `true` only after using the helper's paged pinned read; `finish` verifies the matching `reads.json` receipts, not a self-attested range. |
| `tests[].scope` | `full` \| `changed_hunks` | Required when `read` is true. `changed_hunks` is allowed only for a test file with more than 400 changed lines, or for any test file when the changed test files of 400 lines or fewer total more than 1200 changed lines: then read every changed hunk plus the surrounding test names. |
| `tests[].assertions_checked` | string | Required when `read` is true: which new assertions would fail on a regression and which would not. |
| `tests[].reason_kind` | `binary` \| `generated` \| `not_in_head` \| `tooling_blocked` | Required when `read` is false. Effort, time, and size are never a reason: read a large file with `scope: changed_hunks` instead. |
| `tests[].reason` | string | Required when `read` is false: the specifics behind `reason_kind`. Text that cites effort, time, or size is rejected. |
| `prior_decisions` | object[] | One per item in `prior.json` `items` for a complete assessment. |
| `prior_decisions[].action` | `carry` \| `resolved` \| `reopen` | `carry` keeps the prior record. `resolved` drops it from state. `reopen` requires a current finding with the same ID. |
| `prior_decisions[].evidence` | string | Evidence from the current head. |
| `clearances` | object[] | Explicit claims that a specific risk was checked and is safe. Clean coverage never implies one. |
| `clearances[].id`, `concern_id`, `claim`, `evidence` | string | The ID must not collide with a finding or prior item. |

## Suggestions, separate work, and state

Suggestions/nits render under `## Optional suggestions`, never change the headline, and are not written to `state.json`. Separate work renders as maintainer-owned work outside this merge and is carried in state. Legacy `follow_up` state remains readable and is rendered explicitly as legacy, without silently granting it a new deferral basis. State also records the review `round` from preparation.

## Headline

`Review incomplete` for an incomplete assessment. Otherwise `Changes requested` when a current or carried finding is a blocker, and `Approve` when none is.

## Example

```json
{
  "assessment": "complete",
  "limitations": ["Did not run the context-engine tests; the contributor gate has not authorized execution."],
  "coverage": [
    {
      "concern_id": "security",
      "status": "checked",
      "evidence": "The new cache key holds no user identifier; hashUserData output is unchanged."
    },
    {
      "concern_id": "correctness-and-reliability",
      "status": "checked",
      "evidence": "Read both callers of buildCacheKey at head."
    },
    {
      "concern_id": "testing-and-verification",
      "status": "checked",
      "evidence": "cache-key.test.ts covers path and datasource, not locale."
    },
    {
      "concern_id": "reversibility-and-one-way-door",
      "status": "checked",
      "evidence": "The cache is in memory only; a revert drops it."
    },
    {
      "concern_id": "cross-cutting-architecture",
      "status": "not_applicable",
      "evidence": "No import crosses a tier; both files stay in src/context-engine."
    },
    {
      "concern_id": "context-engine",
      "status": "checked",
      "evidence": "Traced fetchRecommendations with two locales at base and head."
    }
  ],
  "checks": [],
  "findings": [
    {
      "id": "cache-key-locale",
      "concern_id": "context-engine",
      "disposition": "blocker",
      "title": "Recommendation cache key omits the user's locale",
      "location": "src/context-engine/cache-key.ts:12",
      "evidence": "buildCacheKey at head joins path and datasource only; fetchRecommendations sends locale in the request body.",
      "consequence": "After a language switch, users see recommendations fetched for the previous locale until a reload.",
      "base_comparison": "Base had no cache; every call fetched with the current locale.",
      "required_invariant": "A cached recommendation is served only for a request with identical inputs, locale included.",
      "merge_reason": "The PR introduces wrong-language content on the default path and must be fixed before it ships to every multilingual stack."
    },
    {
      "id": "cache-ttl-test",
      "concern_id": "testing-and-verification",
      "disposition": "suggestion",
      "title": "No test pins cache expiry",
      "location": "src/context-engine/cache-key.test.ts",
      "evidence": "No test advances time past the TTL.",
      "next_action": "Consider a fake-timer test that crosses the TTL."
    }
  ],
  "prior_decisions": [],
  "clearances": [
    {
      "id": "cache-privacy",
      "concern_id": "context-engine",
      "claim": "The cache key carries no raw user data.",
      "evidence": "Every key component at head is a path, datasource type, or hashUserData output."
    }
  ]
}
```
