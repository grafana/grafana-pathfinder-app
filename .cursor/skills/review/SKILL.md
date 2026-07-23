---
name: review
description: Routed PR review orchestrator. Load for `/review` command or any PR review task.
---

# PR review orchestrator

Conduct a **Principal Engineer level** review in eight phases.

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

Classification exists to improve routing efficiency, not to reduce safety. If uncertain, classify as `mixed`.

## 3. Route the review

Route using `trigger_paths` and `trigger_keywords` from the routing table in `docs/design/CONCERNS.md`. Apply the routing defaults defined there. Never route on paths alone.

Produce: `activated_concerns`, `activation_reason`, `risk_signals`, `likely_one_way_doors`, `reviewers_to_run`, `coverage_confidence`.

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

Run additional reviewers when activated by the routing table in `docs/design/CONCERNS.md`.

**Posture: breadth over economy.** This review is the automated safety net under human review. Run all always-on concerns as independent parallel reviewers, plus every conditional concern the router activates. Do not throttle fan-out to save cost — the goal is to raise the bar on what is caught automatically so human review can focus on novel findings.

- Always-on concerns must always run as dedicated reviewers, not folded into the synthesizer
- Conditional concerns run whenever activated by the routing table — do not suppress them on classification heuristics alone
- Dispatch reviewers in parallel where possible
- The only acceptable reason to skip a routed reviewer is a hard incompatibility with the change class (e.g., `docs-only` PR has no Go backend surface to review)
- When in doubt, run the reviewer

### Standalone deep-security lens

In addition to the `security` concern reviewer, when the PR touches any of:

- auth, tokens, secrets, or credential refresh paths
- URL construction, redirect handling, or trust boundaries
- workflows, publish steps, release tooling, or CI permissions
- MCP transport, peerjs, or any cross-origin surface
- dependency manifests (`package.json`, `go.mod`, lockfiles)

…also invoke `.cursor/skills/secure/SKILL.md` as a dedicated lens running alongside the `security` concern. The concern-level reviewer applies the F1–F6 / G1–G7 catalog against the diff; the standalone `secure` skill runs the full audit (frontend F1–F6 + backend allowlists + MCP transport + deps) with deeper context. Both report findings under the `security` concern; the synthesizer dedupes per §5.

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

Every reviewer emits the schema defined in `docs/design/PR_REVIEW.md` (Reviewer output schema), including the severity, confidence, and reversibility values.

## 4b. Adversarial verification

Before synthesis, run an adversarial verification pass on the reviewer output:

1. Collect every finding with severity `medium` or higher across all reviewers.
2. For each such finding, spawn **three independent skeptic sub-agents**, each prompted to **refute** the finding — defaulting to `refuted=true` when uncertain. Skeptics receive only the finding, the relevant diff hunks, and the concern entry — not the original reviewer's reasoning.
3. Each skeptic returns a structured verdict: `{ refuted: boolean, reason: string }`.
4. Drop any finding that ≥2 of 3 skeptics mark as refuted. Record dropped findings in a `verification_dropped` list with the skeptics' reasoning, so the synthesizer can surface them if a human wants to inspect.
5. Findings rated `low` severity or below are passed through without verification — the cost of verifying low-severity items exceeds the value.

This pass exists to kill plausible-but-wrong findings before they reach the human reviewer. False positives erode trust in the automated safety net; spending tokens to suppress them is the right trade.

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
- disclose when the PR's center of gravity appears only weakly covered by the current concern registry
- suggest updating `docs/design/CONCERNS.md` when the same unowned area appears important enough to deserve subsystem-aware review

Report findings ordered by severity, then confidence.

Each finding should include:

- concern
- problem
- why it matters
- reversibility classification
- suggested action

If all activated concerns return `no_findings`, say so explicitly and mention any residual confidence gaps or testing gaps.

If `coverage_confidence` is not `high`, include a short coverage note such as:

> Coverage note: this PR appears to center on an area that is only lightly modeled by `docs/design/CONCERNS.md`. I reviewed it with general concerns and adjacent subsystem logic, but review confidence is reduced there. If this area is important long-term, consider refining or adding a concern entry.

## 6. Tech-debt scan

After synthesis, spawn a sub-agent scoped to **only the files changed in this PR** to detect tech-debt patterns. The sub-agent reads `.cursor/skills/techdebt/SKILL.md` and runs all categories (A–E) against the changed file set.

Instructions for the sub-agent:

1. Resolve the target to the PR's changed file list — do not expand scope to the full subsystem.
2. Run `SKILL.md` workflow steps 1–6 against that file list exactly.
3. Suppress findings on files that the diff only touches in tests (D2 is still relevant there).
4. Return only **high-confidence findings**; do not emit suggestive findings unless the overall change classification is `mixed` or `product-runtime` and the router has flagged correctness risk.

Include the tech-debt report in the final review output under a **Tech debt** section. If the sub-agent returns no findings, emit:

> Tech debt: no high-confidence patterns found in the changed files.

The tech-debt scan is **non-blocking** — findings do not block merge, but they are included in the review for the author's awareness. Dedupe against synthesis findings per §5.

## 7. Documentation drift check

After synthesis, invoke `.cursor/skills/prevent-doc-drift/SKILL.md` in **review mode** to detect whether this PR introduces new subsystems, scripts, skills, docs, plugin routes, feature flags, or architecture changes that require updates to agent guidance (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`).

If the skill emits a "Doc-drift updates recommended" section, include it verbatim in the review output. The PR author can apply the diffs themselves or invoke `prevent-doc-drift` in apply mode to commit them on the same branch.

The doc-drift check is **non-blocking** — guidance drift does not block merge, but unfixed drift accumulates as tech debt future reviewers and agents will pay for.

## 8. Instrumentation coverage check

After synthesis, for PRs classified `product-runtime` or `mixed` that **add feature behavior** (new user-facing actions, new async/fetch/fallback paths, or new panel surfaces), assess instrumentation coverage against the decision rule and free-channel table in `docs/developer/TELEMETRY.md`. Skip this check for `tests-only`, `docs-only`, and `infra-build-ci` changes, and for pure refactors or bug fixes of existing behavior.

Answer these questions:

1. Does the PR add a new user-visible action with no `reportAppInteraction` event? (The Faro mirror makes every analytics event operationally observable for free.)
2. Does the PR add a fallback or degradation ladder with no typed facade event? A log does not replace the countable, alertable event required by `TELEMETRY.md`.
3. Does the PR add an async operation with a latency budget but no typed facade measurement, or an ordinary async/retry failure path with neither a stable `src/lib/logging.ts` signal nor a typed facade op?
4. Does the PR add a critical multi-step operation with no outcome-stamped `withFaroUserAction` span?
5. Does the PR add a panel with no URL-derived view and no `setFaroViewName` call? Separately, does a new Pathfinder surface omit `reportPathfinderSurface`?

Report gaps under an **Instrumentation** section in the review output, citing the relevant `TELEMETRY.md` rule. If coverage is adequate, emit:

> Instrumentation: new behavior is covered by the free telemetry channels (or existing facade ops); no gaps found.

The instrumentation check is **non-blocking** — instrumentation is a judgment call, not a gate. Do not request instrumentation for trivial UI states, and never suggest attributes that would violate the privacy invariants in `TELEMETRY.md` (high-cardinality values, raw error text, unnormalized URLs). Before emitting this section, deduplicate its observations against synthesized `analytics-and-telemetry` findings.

## Pattern catalog and reporting

The unified detection table (R1-R21, F1-F6, QC1-QC7), Go backend table (G1-G7), comment prefixes, and disposition matrix all live in `docs/design/PR_REVIEW.md`. Apply those checks during subsystem review under the `correctness-and-reliability`, `security`, and `go-backend` concerns, and use the prefix and disposition tables when reporting.
