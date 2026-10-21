# Interactive tutorials matching plan

## Objective

Audit every learning path and interactive guide in `grafana/interactive-tutorials` and improve its targeting so recommendations reflect the user's current Grafana task. Favor beginners and intermediate users. Do not introduce curated defaults, guide-ID boosts, or an editorial ordering list.

Keep this work separate from the recommendations page design in grafana-pathfinder-app PR #2184. Start from the tutorials repository's current main branch and follow its authoring and validation instructions.

## Engine contract

The context-ranking implementation in the app and recommender uses four relevance tiers:

1. A matching product route plus observed task evidence.
2. A matching product route.
3. Matching environment evidence, such as installed data-source types.
4. General eligibility.

Task evidence includes selected data-source type, observed panel type, connection type, and supported create/edit/configure action tags. Installed data sources alone do not prove what the user is doing. A default visualization is not an observed panel selection.

The strongest fully satisfied OR branch supplies evidence. AND combines evidence only when its requirements are fully satisfied. Repeated tags in one category do not multiply its strength. Platform, role, cohort and source predicates constrain eligibility but do not increase relevance.

The server ranks before its result cap. The app demotes completed content within the same relevance tier. `depends` and `recommends` put prerequisite content before equally relevant follow-on guides; `suggests` does not. Equally relevant means the same evidence tier and signal counts, the same completion state and the same match accuracy, so a follow-on guide with higher match accuracy stays ahead of a less accurate prerequisite. Format, starting on the current page and editorial status are late tie-breakers. Content authors should express real conditions rather than trying to optimize a numeric score.

Client fallback matching supports only `urlPrefix`, `urlPrefixIn`, `targetPlatform`, `and` and `or`. Richer rules must be tested against the server. Do not expand fallback eligibility or add unsupported predicates to make a particular guide appear.

## Work plan

1. **Inventory the complete catalog.** Enumerate every path and guide manifest and its source file. Record whether it is a path, a standalone guide, or a path module; current targeting; starting location; product area; prerequisites; and intended learner task. Include archived or untargeted entries in the inventory with an explicit disposition.
2. **Build the path membership graph.** Include foundations, milestones, tracks and any other membership fields supported by the current schema. Every path module must be excluded from independent recommendations, including modules shared by multiple paths. Retain direct navigation and path execution. Do not confuse `startingLocation` with a recommendation rule.
3. **Read the content before changing targeting.** Identify what the learner will actually do, which product page supports it, and which observable context is necessary. Audit all items; do not infer the task only from a title.
4. **Author targeted rules.** Use real route prefixes and current supported context tags. Add platform and permission conditions where required. Separate installed capabilities from actively selected capabilities. Remove broad root-route and environment-only matches when they imply relevance the content does not have.
5. **Test eligibility and ranking together.** Build positive and negative scenarios for each recommendable item. Run the actual recommender matcher and the versioned ranking implementation, including result caps. Generate an aggregate before/after report for the scenario matrix below.
6. **Regenerate derived catalog files.** Use the repository's generators for indexes, statistics and schemas. Do not hand-edit generated files or the frozen legacy index. Run the repository's required checks and confirm generation is reproducible.
7. **Deliver the changes and evidence.** Include the complete audit inventory, changed rules, scenario results, remaining context gaps, and validation results. Group review by product area while preserving one consistent matching contract.

## Rule-authoring safeguards

- The current server can admit a partially matched top-level AND rule with nonzero accuracy. Do not assume AND is a hard eligibility gate. Where all conditions are required, use a top-level OR containing complete AND alternatives and prove rejection with negative tests against the current engine.
- For example, an Explore guide specifically about Loki can use this shape when both conditions are truly required:

```json
{
  "or": [
    {
      "and": [{ "urlPrefix": "/explore" }, { "tag": "selected-datasource:loki" }]
    }
  ]
}
```

- Verify the actual emitted tag and route in the app before using this example for a guide. Do not invent context fields such as learner experience, resource counts or product adoption.
- Prefer literal prefixes when they accurately describe the route. Regex length is not a specificity signal. Preserve existing literal prefix semantics and test neighboring routes.
- Do not add a broad OR branch merely to increase exposure: it can admit content without the intended task evidence.
- When the engine cannot distinguish two tasks, record the missing signal as an engine follow-up. Do not conceal the gap with title-based ordering or hand-picked defaults.

## Scenario matrix

Cover at least:

- Home and dashboards listing, with no data sources and with Prometheus/Loki installed.
- New dashboard, existing dashboard view, panel edit and panel change.
- Explore with no observed selection, selected Prometheus and selected Loki.
- Observed visualization changes, navigation away, return navigation and observation expiry.
- Connections browsing, adding a data source and configuring an existing connection.
- Alerting, logs, metrics, traces, profiling and each product represented by a path.
- Cloud versus OSS and relevant user roles.
- Partial rule matches, unrelated routes, empty context and old responses without ranking metadata.
- Completed and incomplete guides in the same relevance tier.
- Multiple related paths competing under the server result cap.

## Acceptance criteria

- Every catalog item has an audited disposition; no learning path module remains independently recommendable.
- Each recommendable path and standalone guide has a documented positive scenario and at least one meaningful negative scenario.
- Unrelated installed capabilities cannot outrank a genuine match for the current task.
- Route-equivalent ties, such as first-dashboard versus Terraform paths on `/dashboards`, are either resolved with valid observable evidence or explicitly reported as unresolved.
- No curated ordering, new telemetry, raw queries, arbitrary user-entered names or guessed context signals are introduced.
- All authored rules validate, generated artifacts are reproducible, and matcher/ranking results are included with the handoff.
