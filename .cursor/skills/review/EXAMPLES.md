# Review examples

Concrete inputs and outputs for the scripts SKILL.md calls. Values are illustrative; the shapes are real and are checked by the script test suites.

## Plan input

Validate with `node .cursor/skills/review/scripts/concern-context.mjs --plan <plan-file>`. `category` is the packet's own `always-on`, `subsystem`, or `cross-cutting` value.

```json
{
  "mode": "full",
  "skeptic_batch_count": 2,
  "concerns": [
    {
      "id": "correctness-and-reliability",
      "category": "always-on",
      "context": [{ "path": "src/example.ts", "excerpt": "the changed function body" }]
    },
    {
      "id": "security",
      "category": "always-on",
      "specialist": "security",
      "context": [{ "path": "src/security.ts", "excerpt": "the changed URL check" }]
    }
  ]
}
```

## Plan input with contract-evolution gates

```json
{
  "mode": "full",
  "concerns": [],
  "contract_evolution": [
    {
      "concern_id": "ai-subsystem",
      "touches_anchor_with_consumers": true,
      "prior_semantic_pr_count": 4,
      "context": [{ "path": "docs/design/PR_REVIEW.md", "excerpt": "contract" }]
    }
  ]
}
```

## Policy input and first response

Input to `node .cursor/skills/review/scripts/review-policy.mjs <policy-input-file>`:

```json
{
  "observation": {
    "finding_id": "OBS-1",
    "concern_id": "correctness-and-reliability",
    "kind": "defect",
    "severity": "medium",
    "confidence": "high",
    "title": "Changed behavior drops a required result",
    "evidence": ["src/example.ts:12 returns before recording the result."],
    "why_it_matters": "The shipped path reports success without saving the result.",
    "suggested_action": "Record the result before returning.",
    "reversibility": "reversible",
    "applies_to_files": ["src/example.ts"],
    "origin": "regression",
    "impact": "ordinary",
    "timing": "first_round",
    "scope_effect": "within_changed_surface",
    "breaks_shipped_path": false,
    "induced": false
  },
  "verdicts": [],
  "round": 1
}
```

With no verdicts the response is `{ "status": "needs_verification", "lane": "high_risk", "dispatch": { "role": "skeptic", "count": 2 }, ... }`. Append each skeptic's `{ "verdict": "confirmed|refuted|uncertain", "reason": "<checked evidence>" }` to `verdicts` and call again.

## Reconcile input

```json
{
  "operation": "reconcile",
  "round": 2,
  "prior_deferred": [],
  "current_follow_ups": [{ "id": "OBS-1", "concern_id": "correctness-and-reliability" }],
  "verified_fixed_ids": [],
  "prior_cleared": [],
  "current_cleared": []
}
```

## Worker prompt skeleton

Fill every bracket. Give a worker nothing beyond this.

```text
You are an observation worker for concern(s): [concern ids].
Invariant(s): [from the --worker packet].
PR intent: [one or two sentences from the PR body].
Base SHA: [sha]. Head SHA: [sha]. Mode: [full | incremental: diff_range].

Context (read only these; at most 8 files, 30,000 characters):
[path + excerpt, repeated]

Do:
1. Restate the invariant in one sentence.
2. Check the base commit before claiming a regression.
3. Return one canonical observation per real issue, or { "concern_id": "...", "status": "no_findings", "reason": "reviewed_clean" | "not_applicable" }.

Do not: decide disposition or merge impact, emit pre_existing or latent_unreachable findings below high severity, or widen the changed surface.

Canonical observation format:
[paste the output of: concern-context.mjs --section "Canonical observation"]
```
