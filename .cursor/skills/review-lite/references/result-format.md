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
| `findings` | object[] | Only `blocker` and `follow_up`. No nits. |
| `findings[].id` | string | Short, stable, `^[A-Za-z][A-Za-z0-9-]{0,31}$`. Reuse the same ID for the same invariant across rounds. |
| `findings[].concern_id` | string | A selected concern ID. |
| `findings[].disposition` | `blocker` \| `follow_up` |  |
| `findings[].title`, `location`, `evidence`, `consequence`, `base_comparison` | string | Required. `location` is `path:line` or a symbol. `base_comparison` says what base did. |
| `findings[].required_invariant` | string | Required for a blocker. State the property, not a patch. |
| `findings[].merge_reason` | string | Required for a blocker: why delaying the merge beats a follow-up. |
| `findings[].next_action` | string | Required for a follow-up: a concrete proposed next step. |
| `prior_decisions` | object[] | One per item in `prior.json` `items` for a complete assessment. |
| `prior_decisions[].action` | `carry` \| `resolved` \| `reopen` | `carry` keeps the prior record. `resolved` drops it from state. `reopen` requires a current finding with the same ID. |
| `prior_decisions[].evidence` | string | Evidence from the current head. |
| `clearances` | object[] | Explicit claims that a specific risk was checked and is safe. Clean coverage never implies one. |
| `clearances[].id`, `concern_id`, `claim`, `evidence` | string | The ID must not collide with a finding or prior item. |
| `escalations` | object[] | Every deeper look and why. |
| `escalations[].trigger`, `action`, `outcome` | string |  |
| `escalations[].independent` | boolean | `true` only for a separate reviewer that did not see your conclusions. |

## Headline

`Review incomplete` for an incomplete assessment. Otherwise `Changes requested` when a current or carried finding is a blocker, and `No blocking findings` when none is.

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
      "merge_reason": "The PR introduces wrong-language content on the default path, and a follow-up would ship it to every multilingual stack."
    },
    {
      "id": "cache-ttl-test",
      "concern_id": "testing-and-verification",
      "disposition": "follow_up",
      "title": "No test pins cache expiry",
      "location": "src/context-engine/cache-key.test.ts",
      "evidence": "No test advances time past the TTL.",
      "consequence": "An expiry regression would serve stale recommendations silently.",
      "base_comparison": "Base had no cache, so no such test existed.",
      "next_action": "Propose an issue for a fake-timer test that crosses the TTL."
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
  ],
  "escalations": [
    {
      "trigger": "Shared fetch path with several consumers",
      "action": "Read every caller of fetchRecommendations at head",
      "outcome": "Both callers pass locale, so the key gap is reachable.",
      "independent": false
    }
  ]
}
```
