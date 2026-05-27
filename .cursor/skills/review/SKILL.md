---
name: review
description: Routed PR review orchestrator. Load for `/review` command or any PR review task.
---

# PR review orchestrator

Conduct a **Principal Engineer level** review in six phases.

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

Prefer a small reviewer set over speculative breadth.

- Always-on concerns must always be considered
- Conditional concerns should only run when activated
- If many conditional concerns activate, prioritize the highest-signal concerns first and keep the initial reviewer set small
- Add more conditional reviewers only when the router has strong evidence they are needed
- If classification suggests a narrow non-runtime class, reduce fan-out conservatively and fail open when uncertain

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

The tech-debt scan is **non-blocking** — findings do not block merge, but they are included in the review for the author's awareness. If a finding overlaps with a correctness or architecture finding already raised by another reviewer, prefer the primary concern's finding and add a note that it also represents accrued debt.

## 7. Documentation drift check

After synthesis, invoke `.cursor/skills/prevent-doc-drift/SKILL.md` in **review mode** to detect whether this PR introduces new subsystems, scripts, skills, docs, plugin routes, feature flags, or architecture changes that require updates to agent guidance (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`).

If the skill emits a "Doc-drift updates recommended" section, include it verbatim in the review output. The PR author can apply the diffs themselves or invoke `prevent-doc-drift` in apply mode to commit them on the same branch.

The doc-drift check is **non-blocking** — guidance drift does not block merge, but unfixed drift accumulates as tech debt future reviewers and agents will pay for.

## Pattern catalog and reporting

The unified detection table (R1-R21, F1-F6, QC1-QC7), Go backend table (G1-G7), comment prefixes, and disposition matrix all live in `docs/design/PR_REVIEW.md`. Apply those checks during subsystem review under the `correctness-and-reliability`, `security`, and `go-backend` concerns, and use the prefix and disposition tables when reporting.
