# Review-session evaluation status (October 2026)

**Status:** paused, not completed. `/review` remains the production review. `/review-session` remains experimental. No production cutover is proposed. All accuracy labels below are agent-adjudicated and provisional; no maintainer has validated them.

Raw transcripts, private answer keys, arm mappings, and per-run artifacts are kept outside the repository by the experiment owner. They are not part of this change.

## What was run

1. **Pilot:** 5 historical PRs (2074, 2071, 2057, 2058, 2009), one run per arm, at tooling `61477a3`. Both arms used `claude-opus-5-5` at high effort, in isolated sessions with frozen subject checkouts and cutoff-dated intent packets.
2. **Correction pass:** independent verifiers re-checked the consequential labels, and the repairs below were made.
3. **Stage 1 at `5691939d`** (the 2058 pair). It exposed skeptic priming through data fields, an under-specified contract schema, condensed worker receipts, and evaluation cases leaking into reviewer toolkits. Those runs are diagnostic only and are not pooled.
4. **Stage 1 at `70b22339`** (the 2058 pair, the first 2 of a planned 12-run cohort). The remaining 10 runs were not launched.

## Repairs in this branch

- **Role briefs:** `/review` now has role-specific worker and skeptic briefs, and root-added prose is refused.
- **Skeptic input:** skeptics receive only allowlisted claim fields. Producer provenance is kept separately.
- **Go checks:** required when Go changed, detected by `changed-surface.mjs`.
- **Classified revert results:** setup, compile, and uncaught-error results are never credited as detection.
- **Session inputs:** PR intent and contract context reach session workers. The contract specialist's full result schema is given with examples, and corrections quote the validator.
- **Raw worker results:** stored verbatim, with derived artifacts that carry their provenance.
- **Session diffs:** observers receive bounded per-file diff shards.
- **Pathspecs:** contributor file names are treated as literal pathspecs.

Shared disposition policy, skeptic thresholds, routing, and planner counts are unchanged. `review-policy.mjs`, `adversarial-policy.mjs`, `concern-context.mjs`, and `contract-evolution-gate.mjs` are byte-identical to `61477a3`.

## Results so far (provisional, small, single-run)

- **Cost (pilot):** `/review-session` cost about 0.6× of `/review` in both time and money. The saving came from both root and subagent work.
- **Quality:** the pilot does not support a quality ranking. Blocker precision ranges from 0 to nearly 1 for both arms, depending on maintainer decisions that are still open. Detection differences rest on 9 known-defect items.
- **2058 verdict instability:** across three 2058 pairs, the verdict split between arms each time. Each split traced to one producer's impact classification of the same low-severity finding, which `review-policy.mjs` then disposed as blocking. That is consistent with the declared security-specialist difference, but single runs cannot attribute the cause.
- **Stage 1 at `70b22339`:** both arms met the audit criteria on independent verification. The mechanical gate passed for `/review-session` and did not pass for `/review`.

## Open items (unresolved; opening a PR implies no acceptance or waiver)

- **A4 (efficacy honesty) for `/review`** is mechanically UNKNOWN. The full revert output shows a real behavioral failure, but the record header was hidden from the transcript. Verifier corroboration (timestamps, ordered lines, both classifiers) supports it, and accepting that standard is a maintainer decision.
- **Probe execution and provenance:** the session controller's argv allowlist accepts `node <script>`, `node -e`, and `npx <shell>`, and labels the results `controller_observed`. This was already true at `61477a3` and is not fixed here.
- **Policy questions:**
  - whether low-severity confirmed regressions should be able to end as follow-ups;
  - outcome-channel analysis for missed callee failure channels;
  - skeptic reuse parity;
  - evidence-cutoff enforcement;
  - where the follows/extends/replaces rule lives;
  - the merge-necessity decisions for the evaluated cases.
- **Toolkit isolation:** excluded file names, but not their contents, remain visible in reviewer toolkits' git metadata.
- **Coverage limits:** the post-run auditor measures whether content appeared in agent tool output, not comprehension. Its fixtures derive from real run transcripts, so it is kept outside the repository pending a sharing decision.

Any further runs need a new authorization. A review-tooling change starts a new cohort.
