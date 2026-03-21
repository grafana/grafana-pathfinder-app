# Review concerns

This document defines the architectural and operational concerns that can be used to review changes in this repository.

It is the source of truth for:

- PR review routing
- impact analysis
- cross-cutting architecture review
- subsystem-aware debugging and change risk analysis

## How to use this document

Each concern includes:

- when it should activate
- what files and semantic signals suggest the concern is relevant
- what invariants the reviewer should check
- what kinds of changes are likely one-way doors
- what tests or verification are expected

Review systems should:

1. Read the branch diff.
2. Classify the overall shape of the change.
3. Match changed files and semantic signals against this registry.
4. Activate the relevant concerns.
5. Run focused review passes for those concerns.
6. Always run or explicitly satisfy the always-on concerns listed below.

## Change classification

Before routing individual concerns, classify the PR into one or more coarse change classes.

Suggested classes:

- `product-runtime`: runtime frontend or backend behavior
- `contracts-and-schemas`: public contracts, schemas, test contracts, payload shapes
- `infra-build-ci`: build scripts, CI workflows, release automation, Docker or packaging infrastructure
- `tests-only`: tests and fixtures without runtime behavior changes
- `docs-only`: prose-only documentation changes
- `mixed`: touches multiple classes or the classifier is uncertain

### Purpose

Change classification exists to improve routing efficiency, not to reduce safety. It should:

- help prioritize likely concerns
- help avoid obviously irrelevant reviewers
- never become a hard gate that suppresses risky review on an uncertain PR

### Fail-open rules

When classification is uncertain, classify as `mixed`.

Do not suppress likely review concerns when:

- the change touches workflows, release, publish, Docker, or external actions
- the change affects schemas, storage, public contracts, or telemetry payloads
- the change writes to stateful endpoints or changes persisted state semantics
- the change includes secrets, permissions, tokens, auth, or publishing behavior
- the PR is small but alters a high-leverage file such as `src/module.tsx`, `package.json`, `plugin.json`, `.github/workflows/*`, `Magefile.go`, or storage or schema code

### Classification guardrails

Classification may narrow reviewer fan-out, but only conservatively.

- `reversibility-and-one-way-door` must always be considered
- the final cross-cutting synthesizer must always run
- `security` should still run for any workflow, publish, release, network, secret, URL, or trust-boundary change
- `testing-and-verification` should still run for any executable change, including CI and build system changes
- `correctness-and-reliability` may be collapsed into the synthesizer for clearly non-runtime classes such as `docs-only`, and sometimes `infra-build-ci`, but only when no runtime or contract signals are present

### Classification output

The classifier should produce:

- `change_classes`
- `classification_confidence`
- `classification_reason`
- `review_suppression_decisions`
- `fail_open_signals`

`review_suppression_decisions` should be rare and justified explicitly. If there is doubt, do not suppress.

## Concern schema

Each concern entry contains:

- `id`
- `name`
- `category`
- `always_on`
- `activation_mode`
- `min_signals`
- `max_context_files`
- `purpose`
- `trigger_paths`
- `trigger_keywords`
- `load_docs`
- `load_code_areas`
- `review_questions`
- `one_way_door_signals`
- `expected_verification`
- `related_concerns`

These fields are intentionally operational. They exist to keep routed reviews consistent, small, and debuggable.

## Routing defaults

If a concern entry does not specify routing controls explicitly, use these defaults:

- `always_on: true` implies `activation_mode: always`
- `category: subsystem` implies `activation_mode: strong_signal`
- `category: cross-cutting` with `always_on: false` implies `activation_mode: weak_signal`
- default `min_signals` is `1` for always-on concerns, `2` for `strong_signal`, and `3` for `weak_signal`
- default `max_context_files` is `8`

### Activation modes

- `always`: always activate regardless of diff shape
- `strong_signal`: activate when there is clear evidence the concern is relevant
- `weak_signal`: activate only when multiple signals suggest the concern is relevant or another activated concern makes it likely

### Signal guidance

Use both path and semantic evidence.

- A matching changed file path counts as one signal
- A high-value semantic hit such as a core symbol, API, state key, or contract name counts as one signal
- Repeated low-value keyword hits in the same hunk should not be counted repeatedly

Recommended thresholds:

- `strong_signal`: one path hit plus one semantic hit, or two distinct semantic hits
- `weak_signal`: three total signals, or one strong related concern plus two additional signals

Never activate concerns using paths alone when semantic evidence is absent, unless the concern is always-on.

## Reviewer context limits

Concern reviewers should stay narrow by default.

- Respect `max_context_files` when selecting supporting files
- Prefer changed hunks and nearby symbols over whole-file reads
- Load only the docs listed for the activated concern unless the router identifies a cross-concern dependency
- If a concern cannot justify itself with the allowed context, return `no_findings` rather than expanding context casually

## Reviewer behavior norms

Concern reviewers should optimize for signal, not coverage theater.

- Prefer invariant violations and realistic regressions over generic advice
- Cite evidence from the diff or directly related code paths
- Distinguish confident defects from speculative risks
- Use `reviewed_clean` when the concern was relevant and inspected but no issue was found
- Use `not_applicable` when the concern activated weakly but deeper inspection showed it was not truly relevant
- Avoid filing duplicate findings that are better owned by a different concern

## Fast-model reviewer checklist

Subsystem reviewers should follow this checklist in order. This ordering is designed to be robust even for faster or lower-reasoning models.

### Step 1: State the concern invariant

Before looking for problems, restate the concern's core invariant in one sentence using the concern's `purpose` and `review_questions`.

Examples:

- "This concern exists to preserve context-engine privacy, fallback behavior, and recommendation semantics."
- "This concern exists to preserve the E2E DOM contract and avoid breaking test-visible attribute semantics."

### Step 2: Confirm the PR changed the right kind of thing

Look for whether the diff changes one or more of these high-value surfaces:

- endpoint or URL path
- request or response shape
- schema or contract
- persisted state or storage shape
- public DOM or API contract
- sanitization or validation logic
- gating, fallback, rollback, or cleanup behavior

If none of these changed for the concern, prefer `reviewed_clean` or `not_applicable`.

### Step 3: Compare stated intent to implementation

Compare the PR summary, design notes, tests, and code.

Raise a finding when implementation appears to:

- broaden behavior beyond the stated invariant
- narrow behavior in a way the PR text does not acknowledge
- silently change semantics
- rely on an implicit contract that is not stated anywhere

If the change looks plausible but you cannot point to a concrete mismatch, prefer a low-confidence question or `reviewed_clean`.

### Step 4: Check rollback and one-way-door risk

Ask:

- If this breaks after merge, can a revert restore the system?
- Does the PR preserve a rollback path where one is needed?
- Does it write state that would survive a revert?

If rollback strategy is explicitly documented, treat that as positive evidence unless the implementation contradicts it.

### Step 5: Check tests against changed semantics

Do not ask only "are there tests?"

Ask whether tests cover the semantics that actually changed:

- new endpoint or path
- new mapping behavior
- new sanitization path
- new deduplication or filtering rule
- new storage or rollback behavior

If tests exist but only cover the happy path while the risky semantic change is untested, that can be a finding.

### Step 6: Decide whether to report

Report a finding only if at least one of these is true:

- invariant mismatch
- rollback hazard
- contract drift
- missing verification tied directly to the changed semantics

Do not report findings for:

- generic maintainability advice
- style preferences
- broad "consider edge cases" feedback without a concrete edge case in the changed code
- duplicate concerns already better owned elsewhere

When in doubt:

- prefer one precise question over several speculative findings
- prefer `reviewed_clean` over low-signal commentary

## Reviewer prompt snippet

When a subsystem reviewer is launched, it should effectively be told:

1. Restate this concern's invariant in one sentence.
2. Identify whether the diff changes endpoint, schema, storage, contract, sanitization, fallback, rollback, or cleanup behavior.
3. Compare the implementation to the stated intent in the PR, tests, and nearby docs.
4. Check whether rollback would actually restore the system.
5. Check whether tests cover the changed semantics, not just adjacent behavior.
6. Report only invariant mismatches, rollback hazards, contract drift, or missing verification tied to the changed semantics.
7. If nothing crosses that bar, return `reviewed_clean` or `not_applicable`.

## Concern authoring norms

Add or evolve concerns conservatively.

- Prefer repo-specific invariants over generic coding advice
- Prefer one strong concern over several overlapping weak ones
- A concern should justify why it exists separately from a neighboring concern
- If a concern mostly duplicates another concern's findings, merge them
- If a concern rarely produces actionable review output, narrow it or remove it

## Registry maintenance policy

Treat this file as an operational registry, not a brainstorm list.

- Add a new concern when a real missed review, recurring bug class, or important architectural blind spot appears
- Prefer editing an existing concern before adding a new one
- Update `trigger_keywords`, `load_docs`, and `review_questions` when subsystem architecture changes
- Remove stale triggers that cause noisy activation
- Periodically review concern overlap and merge low-signal entries
- When a concern proves valuable, tighten its triggers before expanding its scope

When a concern is noisy:

- narrow its `trigger_keywords`
- narrow its `load_code_areas`
- increase `min_signals`
- prefer better semantic signals over broader globs

## Always-on concerns

These concerns should run on every PR even if no subsystem-specific concern activates:

- `security`
- `correctness-and-reliability`
- `testing-and-verification`
- `reversibility-and-one-way-door`
- `cross-cutting-architecture`

---

## Concern: `security`

- `id`: `security`
- `name`: Frontend and plugin security
- `category`: always-on
- `always_on`: true
- `activation_mode`: always
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Protect the plugin from XSS, unsafe URL handling, insecure DOM APIs, unsafe HTML rendering, and other trust-boundary mistakes.

### Trigger paths

- `src/security/**`
- `src/docs-retrieval/**`
- `src/context-engine/**`
- `src/interactive-engine/**`
- `src/lib/analytics.ts`
- `src/lib/faro.ts`
- `.github/workflows/**`
- `pkg/**/*.go`

### Trigger keywords

- `dangerouslySetInnerHTML`
- `innerHTML`
- `outerHTML`
- `insertAdjacentHTML`
- `DOMPurify`
- `sanitizeUrl`
- `parseUrlSafely`
- `javascript:`
- `data:`
- `permissions:`
- `secrets.`
- `GITHUB_TOKEN`

### Load docs

- `.cursor/rules/frontend-security.mdc`
- `.cursor/rules/systemPatterns.mdc`

### Load code areas

- `src/security/**`
- `src/docs-retrieval/**`
- `src/context-engine/**`
- `src/interactive-engine/**`

### Review questions

- Are untrusted strings rendered safely?
- Are URLs constructed and validated safely?
- Are external payloads sanitized before use?
- Does the change widen any trust boundary without explicit validation?

### One-way door signals

- Persisting unsafe HTML or URLs
- Emitting new sensitive data to external services
- New writes to stateful external endpoints without validation

### Expected verification

- existing security tests
- targeted tests for sanitization or URL validation changes

### Related concerns

- `docs-retrieval-and-rendering`
- `context-engine`
- `analytics-and-telemetry`

---

## Concern: `correctness-and-reliability`

- `id`: `correctness-and-reliability`
- `name`: Correctness, React reliability, and code quality
- `category`: always-on
- `always_on`: true
- `activation_mode`: always
- `min_signals`: 1
- `max_context_files`: 10

### Purpose

Catch correctness bugs, React anti-patterns, lifecycle leaks, missing cleanup, and avoidable regressions that can break the plugin even when subsystem contracts look fine in isolation.

### Trigger paths

- `src/**/*.ts`
- `src/**/*.tsx`
- `pkg/**/*.go`

### Trigger keywords

- `useEffect`
- `useMemo`
- `useCallback`
- `useState`
- `localStorage`
- `sessionStorage`
- `AbortController`
- `setTimeout`
- `setInterval`

### Load docs

- `.cursor/rules/pr-review.md`
- `.cursor/rules/react-antipatterns.mdc`

### Load code areas

- changed frontend files only

### Review questions

- Does the change introduce lifecycle leaks, stale closures, or cleanup bugs?
- Does the change introduce avoidable waterfalls or heavy sync work?
- Is new code placed in the right layer or hook?
- Are types, tests, and reuse opportunities reasonable?

### One-way door signals

- Semantic behavior changes without compatibility handling
- State model changes that older code cannot interpret correctly

### Expected verification

- unit or integration tests for changed behavior
- typecheck and lint where applicable

### Related concerns

- `testing-and-verification`
- `cross-cutting-architecture`

---

## Concern: `testing-and-verification`

- `id`: `testing-and-verification`
- `name`: Testing and verification coverage
- `category`: always-on
- `always_on`: true
- `activation_mode`: always
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Ensure meaningful behavior changes are verified with the right level of tests, especially for contracts, state machines, and risky edge cases.

### Trigger paths

- all changed files

### Trigger keywords

- `.test.`
- `contract`
- `schema`
- `data-test-`
- `test:ci`
- `lint:go`
- `go build`

### Load docs

- `.cursor/rules/testingStrategy.mdc`
- `docs/developer/E2E_TESTING_CONTRACT.md`

### Load code areas

- changed files plus nearby test files

### Review questions

- Is there sufficient verification for the behavior being changed?
- Are the tests at the right level: unit, integration, contract, or E2E?
- Are important failure modes and rollback scenarios covered?

### One-way door signals

- Contract or schema changes without compatibility tests
- External payload changes without assertions on old and new behavior

### Expected verification

- focused test coverage for new behavior
- contract tests when public DOM/schema contracts change

### Related concerns

- `e2e-contract`
- `guide-schema-and-contracts`
- `reversibility-and-one-way-door`

---

## Concern: `reversibility-and-one-way-door`

- `id`: `reversibility-and-one-way-door`
- `name`: Reversibility and one-way door analysis
- `category`: always-on
- `always_on`: true
- `activation_mode`: always
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Determine whether a change is safely reversible by reverting the PR, or whether it can leave behind persistent state, semantic drift, or external side effects that a revert would not undo.

### Trigger paths

- `src/lib/user-storage.ts`
- `src/context-engine/**`
- `src/lib/analytics.ts`
- `src/lib/faro.ts`
- `src/utils/openfeature*.ts`
- `src/docs-retrieval/**`
- `src/types/**`
- `src/validation/**`
- `pkg/**`

### Trigger keywords

- `localStorage`
- `sessionStorage`
- `migrate`
- `schema`
- `version`
- `reportAppInteraction`
- `reportInteraction`
- `fetch(`
- `post(`
- `put(`
- `patch(`
- `trackingKey`
- `data-test-`
- `completion`
- `serialize`
- `deserialize`

### Load docs

- `docs/design/CONCERNS.md`
- `.cursor/rules/systemPatterns.mdc`
- `docs/developer/FEATURE_FLAGS.md`
- `docs/developer/E2E_TESTING_CONTRACT.md`

### Load code areas

- changed files that read or write persisted state
- changed files that send or shape external payloads

### Review questions

- Does this PR change persisted data shape or interpretation?
- Does it change the meaning of existing stored values?
- Does it emit new or differently-shaped telemetry to a stateful downstream system?
- Does it change public DOM/test contracts or schema contracts?
- Would revert restore correctness, or only prevent further drift?
- Does rollback require cleanup, migration, or replay?

### One-way door signals

- Storage format changes
- Completion or progress semantics changes
- Analytics payload schema changes
- Recommender request shape changes
- Public contract changes such as `data-test-*`, schema values, or API payload semantics
- New writes to external stateful endpoints

### Expected verification

- backward-compatibility tests where possible
- explicit migration or fallback handling
- rollback notes for non-reversible changes

### Related concerns

- `analytics-and-telemetry`
- `feature-flags-and-rollout`
- `state-persistence-and-progress`
- `guide-schema-and-contracts`

### Reviewer output requirement

Classify each finding as one of:

- `reversible`
- `partially_reversible`
- `irreversible_without_cleanup`

---

## Concern: `cross-cutting-architecture`

- `id`: `cross-cutting-architecture`
- `name`: Cross-cutting architecture coherence
- `category`: always-on
- `always_on`: true
- `activation_mode`: always
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Catch interaction risks across subsystems, architecture drift, and changes that look locally correct but break established boundaries or system-wide expectations.

### Trigger paths

- `src/**`
- `pkg/**`
- `docs/design/**`
- `docs/developer/**`
- `.github/workflows/**`
- `package.json`
- `plugin.json`
- `Magefile.go`

### Trigger keywords

- `ContextService`
- `useContextPanel`
- `useInteractiveElements`
- `SequentialRequirementsManager`
- `OpenFeature`
- `reportAppInteraction`

### Load docs

- `.cursor/rules/systemPatterns.mdc`
- `.cursor/skills/design-review/ARCHITECTURE_PRINCIPLES.md`

### Load code areas

- changed files only

### Review questions

- Does the change respect engine boundaries?
- Does it create an implicit contract that should be explicit?
- Does it degrade gracefully when dependencies fail?
- Does it align with Grafana conventions and plugin architecture?

### One-way door signals

- New hidden coupling across engines
- Public behavior changes that other subsystems implicitly depend on

### Expected verification

- cross-subsystem reasoning in the final synthesizer

### Related concerns

- all concerns

---

## Concern: `context-engine`

- `id`: `context-engine`
- `name`: Context engine recommendations and privacy
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Protect the recommendation pipeline's privacy, fallback, timeout, and semantic-tagging invariants.

### Trigger paths

- `src/context-engine/**`
- `src/components/docs-panel/context-panel.tsx`
- `src/docs-retrieval/content-fetcher.ts`
- `src/types/context.types.ts`

### Trigger keywords

- `fetchRecommendations`
- `getContextData`
- `acceptedTermsAndConditions`
- `recommenderServiceUrl`
- `hashUserIdentifier`
- `accuracy`
- `featured`
- `bundled:`
- `journeyCompletionStorage`
- `interactiveCompletionStorage`

### Load docs

- `docs/developer/engines/context-engine.md`
- `.cursor/rules/systemPatterns.mdc`

### Load code areas

- `src/context-engine/**`
- related changed call sites

### Review questions

- Are privacy guarantees preserved?
- Are fallback tiers still correct and graceful?
- Is debouncing still hook-level rather than fragmented?
- Are recommendation semantics and filtering stable?
- Are learning path and interactive completion stores still handled correctly?

### One-way door signals

- Request payload shape changes
- Identifier hashing changes
- Completion semantics changes
- Recommendation type or accuracy interpretation changes

### Expected verification

- context engine tests
- privacy and fallback tests

### Related concerns

- `security`
- `analytics-and-telemetry`
- `state-persistence-and-progress`

---

## Concern: `docs-retrieval-and-rendering`

- `id`: `docs-retrieval-and-rendering`
- `name`: Docs retrieval, parsing, and rendering
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Protect the fetch-parse-render pipeline, especially where remote or bundled content becomes rendered UI and interactive elements.

### Trigger paths

- `src/docs-retrieval/**`
- `src/components/docs-panel/**`

### Trigger keywords

- `fetchContent`
- `parseHtml`
- `contentRenderer`
- `dangerouslySetInnerHTML`
- `bundled-interactives`
- `interactive-step`

### Load docs

- `.cursor/rules/systemPatterns.mdc`
- `.cursor/rules/frontend-security.mdc`

### Load code areas

- `src/docs-retrieval/**`
- changed docs panel consumers

### Review questions

- Is content fetched and transformed safely?
- Are fallbacks preserved?
- Are interactive affordances still wired correctly?
- Could this break rendering for bundled or remote content unexpectedly?

### One-way door signals

- Content parsing semantics changes
- Rendered output or URL rewriting changes
- Downstream assumptions about content shape changing silently

### Expected verification

- docs retrieval tests
- rendering tests
- security tests if HTML handling changes

### Related concerns

- `security`
- `interactive-engine`
- `e2e-contract`

---

## Concern: `interactive-engine`

- `id`: `interactive-engine`
- `name`: Interactive execution safety
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Ensure interactive automation remains safe, cancellable, and operationally coherent.

### Trigger paths

- `src/interactive-engine/**`
- `src/constants/interactive-config.ts`
- `src/styles/interactive.styles.ts`

### Trigger keywords

- `forceUnblock`
- `startSectionBlocking`
- `stopSectionBlocking`
- `executeInteractiveAction`
- `interactive-action-completed`
- `user-action-detected`
- `parseUrlSafely`
- `MutationObserver`
- `ResizeObserver`

### Load docs

- `docs/developer/engines/interactive-engine.md`
- `docs/developer/E2E_TESTING_CONTRACT.md`

### Load code areas

- `src/interactive-engine/**`
- changed interactive consumers

### Review questions

- Are automated actions still cancellable?
- Are observers, timers, and overlays cleaned up?
- Are external URLs still validated safely?
- Is auto-completion still opt-in and isolated from automation?
- Are blocking and z-index rules still safe?

### One-way door signals

- Changed action semantics
- Changed completion event meanings
- Changed navigation or execution behavior that affects guide assumptions

### Expected verification

- interactive engine tests
- guided or multistep tests
- contract tests if public behavior changes

### Related concerns

- `requirements-manager`
- `e2e-contract`
- `security`

---

## Concern: `requirements-manager`

- `id`: `requirements-manager`
- `name`: Requirements and objectives semantics
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Protect the gating and auto-completion semantics that interactive steps depend on.

### Trigger paths

- `src/requirements-manager/**`
- `src/types/requirements.types.ts`
- `src/constants/interactive-config.ts`

### Trigger keywords

- `checkRequirements`
- `checkPostconditions`
- `objectives`
- `requirements`
- `fixType`
- `watchNextStep`
- `triggerReactiveCheck`

### Load docs

- `docs/developer/engines/requirements-manager.md`
- `.cursor/rules/interactiveRequirements.mdc`

### Load code areas

- `src/requirements-manager/**`

### Review questions

- Is the phase order still objectives, eligibility, requirements?
- Do unknown requirement types still fail open with warning?
- Are retries, reactive checks, and mounted-state guards still correct?
- Could this block guides or auto-complete them incorrectly?

### One-way door signals

- Requirement string semantic changes
- Completion reason changes
- Fix-type contract changes

### Expected verification

- requirements tests
- guide flow tests

### Related concerns

- `interactive-engine`
- `e2e-contract`
- `guide-schema-and-contracts`

---

## Concern: `guide-schema-and-contracts`

- `id`: `guide-schema-and-contracts`
- `name`: Guide schemas and typed contracts
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Protect JSON guide schemas, package schemas, and TypeScript contract alignment.

### Trigger paths

- `src/types/json-guide.types.ts`
- `src/types/package.types.ts`
- `src/validation/**`
- `src/bundled-interactives/**/*.json`

### Trigger keywords

- `zod`
- `schema`
- `satisfies`
- `KNOWN_FIELDS`
- `manifest`
- `content.json`

### Load docs

- `.cursor/rules/schema-coupling.mdc`
- `docs/developer/package-authoring.md`

### Load code areas

- changed schema or validation files
- changed bundled guides if applicable

### Review questions

- Do types and schemas still align?
- Are new fields explicit and validated?
- Will older content continue to work?
- Is validation strict in the right places and tolerant in the right places?

### One-way door signals

- Schema value renames
- Removed fields
- Validation tightening that strands existing content

### Expected verification

- schema validation tests
- fixture updates

### Related concerns

- `testing-and-verification`
- `reversibility-and-one-way-door`

---

## Concern: `e2e-contract`

- `id`: `e2e-contract`
- `name`: Stable E2E DOM contract
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Protect the `data-test-*` contract used by interactive E2E tests and other automation layers.

### Trigger paths

- `src/docs-retrieval/components/interactive/**`
- `src/interactive-engine/e2e-attributes.ts`
- `src/interactive-engine/comment-box.contract.test.ts`
- `src/docs-retrieval/components/interactive/data-attributes.contract.test.tsx`

### Trigger keywords

- `data-test-`
- `STEP_STATES`
- `FIX_TYPES`
- `REQUIREMENTS_STATES`
- `applyE2ECommentBoxAttributes`

### Load docs

- `docs/developer/E2E_TESTING_CONTRACT.md`

### Load code areas

- changed files exposing or testing contract attributes

### Review questions

- Is this a breaking contract change?
- Are allowed values still consistent with the UI state machine?
- Are contract tests updated where necessary?
- Is the public DOM contract still the source of truth for automation?

### One-way door signals

- Attribute renames
- Value changes
- Presence or absence changes
- Contract semantics changes without versioning or migration

### Expected verification

- contract tests
- E2E updates if needed

### Related concerns

- `interactive-engine`
- `requirements-manager`
- `testing-and-verification`

---

## Concern: `analytics-and-telemetry`

- `id`: `analytics-and-telemetry`
- `name`: Analytics and telemetry integrity
- `category`: cross-cutting
- `always_on`: false
- `activation_mode`: weak_signal
- `min_signals`: 3
- `max_context_files`: 6

### Purpose

Ensure analytics and observability changes remain privacy-safe, semantically stable, and operationally useful.

### Trigger paths

- `src/lib/analytics.ts`
- `src/lib/faro.ts`
- `src/utils/openfeature-tracking.ts`
- `docs/design/GUIDE_HEALTH_TELEMETRY.md`

### Trigger keywords

- `reportAppInteraction`
- `reportInteraction`
- `UserInteraction`
- `trackingKey`
- `getExperimentsForAnalytics`
- `experiments`
- `beforeSend`
- `Faro`
- `collector`
- `source_document`

### Load docs

- `docs/developer/FEATURE_FLAGS.md`
- `docs/design/GUIDE_HEALTH_TELEMETRY.md`

### Load code areas

- `src/lib/analytics.ts`
- `src/lib/faro.ts`
- changed call sites

### Review questions

- Does this add or change event semantics?
- Could it leak sensitive or high-cardinality data?
- Are OSS and Cloud behaviors still correct?
- Are experiment and feature-flag enrichments still coherent?
- Does this create irreversible downstream data pollution?

### One-way door signals

- Event name changes
- Payload schema changes
- New user-derived fields
- Cloud or OSS telemetry routing changes

### Expected verification

- analytics tests
- privacy review for new fields

### Related concerns

- `feature-flags-and-rollout`
- `reversibility-and-one-way-door`
- `security`

---

## Concern: `feature-flags-and-rollout`

- `id`: `feature-flags-and-rollout`
- `name`: Feature flags, experiments, and rollout safety
- `category`: cross-cutting
- `always_on`: false
- `activation_mode`: weak_signal
- `min_signals`: 3
- `max_context_files`: 6

### Purpose

Protect rollout safety, experiment semantics, and default behavior when flags are unavailable.

### Trigger paths

- `src/utils/openfeature.ts`
- `src/utils/openfeature-tracking.ts`
- `src/module.tsx`
- `docs/developer/FEATURE_FLAGS.md`

### Trigger keywords

- `pathfinder.`
- `trackingKey`
- `getFeatureFlagValue`
- `getExperimentConfig`
- `evaluateFeatureFlag`
- `OpenFeatureProvider`

### Load docs

- `docs/developer/FEATURE_FLAGS.md`

### Load code areas

- changed feature flag definitions or call sites

### Review questions

- Are defaults safe for Cloud and OSS?
- Does the behavior degrade safely when evaluation fails?
- Are experiment semantics and dismount behavior still correct?
- Is tracking metadata present when needed and absent when not needed?

### One-way door signals

- Default behavior changes that alter cached or persisted user state
- Flag semantic changes without compatibility handling

### Expected verification

- tests for enabled and disabled states
- fallback behavior tests

### Related concerns

- `analytics-and-telemetry`
- `state-persistence-and-progress`
- `reversibility-and-one-way-door`

---

## Concern: `state-persistence-and-progress`

- `id`: `state-persistence-and-progress`
- `name`: Persistence, local state, and progress tracking
- `category`: cross-cutting
- `always_on`: false
- `activation_mode`: weak_signal
- `min_signals`: 3
- `max_context_files`: 6

### Purpose

Protect browser-persisted state such as tabs, progress, streaks, and completion data.

### Trigger paths

- `src/lib/user-storage.ts`
- `src/global-state/**`
- `src/learning-paths/**`
- `src/components/docs-panel/**`

### Trigger keywords

- `localStorage`
- `sessionStorage`
- `journeyCompletionStorage`
- `interactiveCompletionStorage`
- `guideResponseStorage`
- `streakTracker`
- `learning-progress-updated`
- `restoreTabs`

### Load docs

- `.cursor/rules/systemPatterns.mdc`
- `docs/developer/learning-paths/README.md`

### Load code areas

- changed storage files
- changed docs panel tab state files

### Review questions

- Are storage keys and value formats backward-compatible?
- Does reset or restore behavior still work?
- Could stale state trap users in a bad experience?
- Are progress and badge events still coherent?

### One-way door signals

- Storage key changes
- Stored value shape changes
- Completion semantics changes

### Expected verification

- storage tests
- migration or compatibility handling where needed

### Related concerns

- `reversibility-and-one-way-door`
- `context-engine`
- `feature-flags-and-rollout`

---

## Concern: `grafana-plugin-integration`

- `id`: `grafana-plugin-integration`
- `name`: Grafana plugin integration and UX alignment
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 2
- `max_context_files`: 8

### Purpose

Keep Pathfinder aligned with Grafana plugin conventions, Scenes, panel lifecycle expectations, and repo-specific UI conventions.

### Trigger paths

- `src/module.tsx`
- `src/App.tsx`
- `src/pages/**`
- `src/components/**`
- `src/constants/**`

### Trigger keywords

- `AppPlugin`
- `Scene`
- `useStyles2`
- `extension`
- `@dnd-kit`
- `sidebar`
- `auto-open`

### Load docs

- `.cursor/rules/systemPatterns.mdc`
- `AGENTS.md`
- `CLAUDE.md`

### Load code areas

- changed app shell, module, page, or sidebar files

### Review questions

- Does this align with Grafana Scenes and plugin conventions?
- Does the change preserve sidebar and auto-open behavior expectations?
- Is drag-and-drop using the approved library?
- Does new UI text follow sentence case?

### One-way door signals

- Route or lifecycle semantics changes
- User-facing behavior changes persisted across sessions

### Expected verification

- UI behavior tests if applicable
- manual verification for shell-level changes

### Related concerns

- `cross-cutting-architecture`
- `feature-flags-and-rollout`

---

## Concern: `performance-and-bundle`

- `id`: `performance-and-bundle`
- `name`: Performance, monitoring scope, and bundle impact
- `category`: cross-cutting
- `always_on`: false
- `activation_mode`: weak_signal
- `min_signals`: 3
- `max_context_files`: 6

### Purpose

Catch regressions in render cost, monitoring breadth, timeout usage, network waterfalls, and bundle growth.

### Trigger paths

- `src/module.tsx`
- `src/context-engine/**`
- `src/interactive-engine/**`
- `src/requirements-manager/**`
- `src/lib/faro.ts`

### Trigger keywords

- `MutationObserver`
- `ResizeObserver`
- `TimeoutManager`
- `setDebounced`
- `import(`
- `await import`
- `getWebInstrumentations`

### Load docs

- `.cursor/rules/systemPatterns.mdc`
- `.cursor/skills/design-review/ARCHITECTURE_PRINCIPLES.md`

### Load code areas

- changed files adding monitoring, async fetches, or heavy imports

### Review questions

- Does this widen observation scope more than necessary?
- Does it introduce avoidable waterfalls or heavy render work?
- Does it bypass shared timeout or debounce patterns?
- Does it grow the initial bundle unnecessarily?

### One-way door signals

- New persistent performance cost from always-on listeners or observers
- Bundle-loading changes that become hard to unwind after shipping dependencies

### Expected verification

- performance reasoning in review
- targeted tests or profiling when risk is high

### Related concerns

- `context-engine`
- `interactive-engine`
- `grafana-plugin-integration`

---

## Concern: `build-and-ci`

- `id`: `build-and-ci`
- `name`: Build, CI, release, and workflow safety
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Protect the build pipeline, CI behavior, release automation, and workflow safety so repository operations remain reproducible, secure, and understandable.

### Trigger paths

- `.github/workflows/**`
- `package.json`
- `package-lock.json`
- `Magefile.go`
- `.config/Dockerfile`
- `jest.config.js`
- `.config/jest.config.js`
- `tsconfig.json`
- `tsconfig.cli.json`
- `.config/tsconfig.json`

### Trigger keywords

- `uses:`
- `run:`
- `permissions:`
- `workflow_dispatch`
- `GITHUB_TOKEN`
- `actions/cache`
- `docker`
- `npm ci`
- `npm run check`
- `npm run build`
- `gh release`
- `publish`

### Load docs

- `AGENTS.md`
- `CLAUDE.md`
- `docs/developer/RELEASE_PROCESS.md`

### Load code areas

- changed workflow and build configuration files only

### Review questions

- Does this preserve the intended CI coverage and failure behavior?
- Does it widen permissions or secret exposure unnecessarily?
- Does it change release, publish, or artifact semantics?
- Could a trivial wording or logging change mask an important workflow state or error?
- Are branch protections, matrix changes, caches, and environment setup still coherent?

### One-way door signals

- Release or publish behavior changes
- Artifact naming or retention changes that downstream automation depends on
- Permission changes that can leak credentials or mutate external state
- Workflow steps that publish, deploy, sign, or write to external systems

### Expected verification

- reasoned review of changed workflow semantics
- targeted command validation if a build script or release command changed

### Related concerns

- `security`
- `testing-and-verification`
- `reversibility-and-one-way-door`

---

## Concern: `cli-and-e2e-runner`

- `id`: `cli-and-e2e-runner`
- `name`: CLI behavior and E2E runner semantics
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Protect command-line semantics, manifest-aware preflight behavior, structured exit outcomes, and E2E runner correctness so developer tooling remains predictable, scriptable, and operationally efficient.

### Trigger paths

- `src/cli/commands/e2e.ts`
- `src/cli/utils/manifest-preflight.ts`
- `src/cli/utils/e2e-reporter.ts`
- `src/cli/__tests__/manifest-preflight.test.ts`
- `docs/developer/E2E_TESTING.md`
- `docs/design/e2e-test-runner-design.md`

### Trigger keywords

- `ExitCode`
- `CONFIGURATION_ERROR`
- `runManifestPreflight`
- `checkTier`
- `checkMinVersion`
- `checkPlugins`
- `loadManifestFromDir`
- `--package`
- `--tier`
- `.choices([`
- `process.exit(`
- `skip`
- `Playwright`

### Load docs

- `docs/developer/E2E_TESTING.md`
- `docs/design/e2e-test-runner-design.md`
- `.cursor/rules/testingStrategy.mdc`

### Load code areas

- changed CLI command files
- changed CLI utility files
- directly related CLI tests

### Review questions

- Do CLI flags parse and validate in a way that fails fast for bad input?
- Are skip, fail, and pass outcomes clearly distinguished and machine-usable?
- Are expensive checks ordered correctly so obviously unrunnable guides short-circuit early?
- Are exit codes and error messages consistent with the command's contract?
- Do preflight checks avoid unnecessary network or browser startup work?
- Are tests covering the changed command semantics, not just helper internals?

### One-way door signals

- Changed exit-code semantics that would break automation
- Changed skip-vs-fail behavior that downstream tooling depends on
- Structured output changes that would break scripts or CI parsing
- New preflight network calls or side effects before an expected early exit

### Expected verification

- CLI unit tests for changed semantics
- behavior tests for skip, fail, and success outcomes
- targeted smoke coverage when flag parsing or orchestration changes

### Related concerns

- `testing-and-verification`
- `guide-schema-and-contracts`
- `reversibility-and-one-way-door`
- `build-and-ci`

---

## Concern: `go-backend`

- `id`: `go-backend`
- `name`: Go backend safety and operational correctness
- `category`: subsystem
- `always_on`: false
- `activation_mode`: strong_signal
- `min_signals`: 1
- `max_context_files`: 8

### Purpose

Catch Go-specific correctness, resource safety, concurrency, and operational risks in the plugin backend.

### Trigger paths

- `pkg/**/*.go`
- `go.mod`
- `go.sum`
- `magefile.go`

### Trigger keywords

- `context.Context`
- `goroutine`
- `defer`
- `close(`
- `http`
- `websocket`
- `stream`
- `terminal`

### Load docs

- `.cursor/rules/pr-review.md`
- `AGENTS.md`

### Load code areas

- changed Go files only

### Review questions

- Are errors handled?
- Are resources closed and goroutines cancellable?
- Is shared state safe?
- Is input handling and credential handling safe?

### One-way door signals

- Persisted backend state changes
- API or stream semantic changes
- External side effects that a revert would not clean up

### Expected verification

- `npm run lint:go`
- `npm run test:go`
- `go build ./...`

### Related concerns

- `reversibility-and-one-way-door`
- `security`

