# Refactor subagent prompts

This file contains prompt templates for all subagents spawned during the `/refactor-investigate`, `/refactor-plan`, and `/refactor-execute` workflows. The main skill reads this file and passes only the relevant section to each subagent. This keeps all subagent instructions out of the main conversation context.

Each template uses `{{PLACEHOLDERS}}`. Fill them before spawning. All subagents return structured reports under 300 words — never code.

---

## Consumer Map

**Phase:** Investigate
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Map every consumer of the refactor target in the Grafana Pathfinder plugin.
>
> **Target:** `{{TARGET_FILE}}`
>
> **Your task:**
>
> 1. Find every file that imports from `{{TARGET_FILE}}` (direct imports and re-exports through barrels).
> 2. For each consumer: note the file path, what it imports, and how it uses the import (call site, prop drilling, event subscription, etc.).
> 3. Identify consumers that are part of test files vs. production code.
> 4. Flag any consumers that import internal (non-exported) symbols via direct path — these are high-risk migration targets.
>
> **Report format (under 300 words):**
>
> - **Direct consumers:** list with file path, import name(s), usage type
> - **Barrel re-exports:** list or "none"
> - **Test-only consumers:** list or "none"
> - **High-risk consumers (internal import):** list or "none"
> - **Total consumer count:** N

---

## Internal Dep Chain

**Phase:** Investigate
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Trace the internal dependency chain of the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
> **Wiki section (relevant patterns):** `{{WIKI_SECTION}}`
>
> **Your task:**
>
> 1. List every module that `{{TARGET_FILE}}` imports (direct only — one level deep).
> 2. For each dependency, note: file path, what is imported, and whether it belongs to a different architectural tier (check `src/validation/import-graph.ts` TIER_MAP).
> 3. Flag any cross-tier or cross-engine imports — these constrain where the extracted module can live.
> 4. Identify any circular import risk (A → B → A) if the target is split.
>
> **Report format (under 300 words):**
>
> - **Dependencies (direct):** list with path, imported symbol(s), tier
> - **Cross-tier imports:** list or "none" — include tier pair
> - **Circular import risk:** yes/no with evidence
> - **Extraction constraint:** one-sentence summary of the tightest constraint

---

## Tier Audit

**Phase:** Investigate
**Agent type:** `Explore`
**Thoroughness:** `quick`

**Prompt template:**

> Perform a tier audit of the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
>
> **Your task:**
>
> 1. Open `src/validation/import-graph.ts` and read the `TIER_MAP`.
> 2. Identify which tier `{{TARGET_FILE}}` belongs to.
> 3. List any ALLOWED_VERTICAL_VIOLATIONS or ALLOWED_LATERAL_VIOLATIONS entries that involve this file or its consumers.
> 4. Check `src/validation/architecture.test.ts` for any test exceptions that mention this file or its directory.
> 5. State the strictest import constraint the extracted module must satisfy.
>
> **Report format (under 200 words):**
>
> - **Current tier:** tier name
> - **Existing violation allowlist entries:** list or "none"
> - **Architecture test exceptions:** list or "none"
> - **Extraction constraint:** one sentence

---

## Contract Surface Inventory

**Phase:** Investigate (conditional — Pattern J/K signals or `data-test` / `localStorage` hits)
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Inventory the contract surface of the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
> **Wiki section (contract surface):** `{{WIKI_SECTION}}`
>
> A "contract surface" is any interface point that other code or test infrastructure depends on: exported function signatures, event names, `CustomEvent` detail shapes, `localStorage` keys, `data-test-*` attribute values, and URL/route patterns.
>
> **Your task:**
>
> 1. List all exported function and type signatures with their current shape.
> 2. Find all `data-test-*` attribute usages in the target and its templates — check `src/constants/` for centralized selector constants.
> 3. Find all `localStorage.getItem` / `localStorage.setItem` calls with their key strings.
> 4. Find all `CustomEvent` / `dispatchEvent` usages — note event name and detail type.
> 5. For each item, note: current name/value, where it is consumed (grep results), and change risk (high = consumed by tests or multiple files).
>
> **Report format (under 300 words):**
>
> - **Exported API:** list with signature and consumer count
> - **Test selectors (`data-test-*`):** list with key and consuming test files
> - **Storage keys:** list with key string and consuming files
> - **Custom events:** list with event name, detail type, and listeners
> - **Highest-risk contract item:** one sentence

---

## Timing Contract Inventory

**Phase:** Investigate (conditional — Pattern F signals)
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Inventory timing contracts in the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
> **Wiki section (Pattern F — timing):** `{{WIKI_SECTION}}`
>
> **Your task:**
>
> 1. Find every `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`, and `cancelAnimationFrame` call. Note: file, line, delay value, purpose (if discernible).
> 2. Find every `Promise`, `async/await`, top-level `await`, and `queueMicrotask` usage that creates sequencing dependencies.
> 3. For each timing call: identify what behavior it gates (e.g., "debounce before fetch", "delay before DOM read").
> 4. Identify which timing contracts are visible to tests (wrapped in `jest.useFakeTimers`, referenced in test assertions, etc.).
>
> **Report format (under 300 words):**
>
> - **Timers:** list with location, delay, and purpose
> - **Async sequencing:** list of chain dependencies
> - **Test-visible timing contracts:** list or "none"
> - **Extraction risk:** one sentence — which contracts would break if the extraction changes call order

---

## Cross-System Invariant Map

**Phase:** Investigate (conditional — Pattern G/J signals)
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Map cross-system invariants for the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
> **Wiki section (Pattern G/J — invariants):** `{{WIKI_SECTION}}`
>
> A cross-system invariant is a property that must hold across two or more subsystems simultaneously — e.g., "the sidebar state in React must match the DOM class on the body element", or "the tab count in localStorage must equal the active tab list in memory".
>
> **Your task:**
>
> 1. Identify state that is maintained in multiple places simultaneously (React state + DOM, localStorage + memory, event publisher + subscriber).
> 2. For each invariant: name the two systems, describe the invariant property, and find any existing tests that verify it.
> 3. Identify invariants that would be violated if the extraction changes initialization order or ownership.
>
> **Report format (under 300 words):**
>
> - **Invariants found:** list — systems, property, existing test coverage
> - **Invariants at extraction risk:** list or "none"
> - **Recommended tripwires:** list of test assertions that would catch violation

---

## Startup Timeline

**Phase:** Investigate (conditional — Pattern K signals)
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Map the startup and initialization timeline for the refactor target.
>
> **Target:** `{{TARGET_FILE}}`
> **Wiki section (Pattern K — bootstrap):** `{{WIKI_SECTION}}`
>
> **Your task:**
>
> 1. Trace the initialization sequence: when is `{{TARGET_FILE}}` first imported? What runs at module load time vs. explicit call?
> 2. Find all top-level `await` and side-effectful imports (code that runs on import, not on function call).
> 3. Map the dependency initialization order: which modules must initialize before `{{TARGET_FILE}}` is usable?
> 4. Find any files that `{{TARGET_FILE}}` itself imports at the root level (not inside functions) — these are bootstrap dependencies.
> 5. Identify any tests that rely on a specific initialization order (e.g., `beforeEach` that calls init functions in a specific sequence).
>
> **Report format (under 300 words):**
>
> - **Import-time side effects:** list or "none"
> - **Initialization order dependencies:** list — what must exist before this module works
> - **Root-level imports (bootstrap risk):** list
> - **Order-sensitive tests:** list or "none"
> - **Extraction risk:** one sentence — what breaks if initialization order changes

---

## Pattern Selector

**Phase:** Investigate (after fan-out)
**Agent type:** `Explore`
**Thoroughness:** `quick`

**Prompt template:**

> Select the best refactor pattern for this target based on investigation findings.
>
> **Target:** `{{TARGET_FILE}}`
> **INVESTIGATION.md contents:**
>
> ```
> {{INVESTIGATION_MD}}
> ```
>
> **Wiki — Pattern definitions A–K:** `{{WIKI_SECTION}}`
>
> **Your task:**
>
> 1. Read the investigation findings (consumer map, dep chain, tier audit, and any conditional inventories).
> 2. Match the findings against Patterns A–K from the wiki.
> 3. Propose the top 1–2 patterns that best fit, with one-sentence evidence for each from the investigation findings.
> 4. Note any patterns that were considered but rejected, and why.
>
> **Report format (under 200 words):**
>
> - **Recommended pattern(s):** name, one-sentence rationale tied to investigation evidence
> - **Considered and rejected:** list with reason, or "none"
> - **Key risk for recommended pattern:** one sentence

---

## Pre-test design

**Phase:** Plan (per phase, parallel)
**Agent type:** `Plan`

**Prompt template:**

> Design the pre-extraction tests for one phase of a refactor.
>
> **Target:** `{{TARGET_FILE}}`
> **Phase scope:** `{{PHASE_SCOPE}}`
> **Phase risk level:** `{{PHASE_RISK}}`
> **Wiki section (pattern guidance):** `{{WIKI_SECTION}}`
>
> A pre-extraction test is a disposable contract test that proves the current behavior before extraction begins. It must pass against the pre-extraction code and continue to pass after extraction (or be explicitly deleted as part of a post-test replacement).
>
> **Project test conventions:**
>
> - Co-locate: `foo.test.ts` beside `foo.ts`
> - Use `src/test-utils/` for shared helpers
> - Import from `@testing-library/react`, `@grafana/data`, `@grafana/ui`
> - Descriptive names: `it('should call onMount exactly once when initialized')`
>
> **Your task — design only, no code:**
>
> 1. Identify what behavior this phase's extraction puts at risk.
> 2. Specify 2–4 pre-extraction assertions that prove the current behavior (expected values, call counts, DOM structure, or storage state).
> 3. Note if any existing test already covers this — if so, flag as a seam tripwire instead of a new test.
>
> **Report format (under 250 words):**
>
> - **Behavior at risk:** one sentence per extraction
> - **Pre-test assertions:** list with expected values
> - **Existing seam tripwire (if found):** file path and test name

---

## Tripwire enumeration

**Phase:** Plan (per phase, parallel)
**Agent type:** `Explore`
**Thoroughness:** `medium`

**Prompt template:**

> Find seam tripwires for one phase of a refactor.
>
> **Target:** `{{TARGET_FILE}}`
> **Phase scope:** `{{PHASE_SCOPE}}`
> **Wiki section (seam tripwires):** `{{WIKI_SECTION}}`
>
> A seam tripwire is an existing test that will fail if the extraction changes observable behavior — exactly what we want. It catches regressions automatically.
>
> **Your task:**
>
> 1. Find all existing tests that exercise behavior within `{{PHASE_SCOPE}}` — check co-located test files and `src/test-utils/` usage.
> 2. For each test, assess: would it fail if the extraction changed initialization order, removed a side effect, or renamed a contract surface?
> 3. Identify any test gaps — behavior that the extraction puts at risk but that no existing test covers.
>
> **Report format (under 250 words):**
>
> - **Seam tripwires found:** list with test file, test name, and what they protect
> - **Test gaps:** list with description of uncovered behavior, or "none"
> - **Recommended additions:** one line per gap (pre-test design subagent will detail these)

---

## Consumer Pre-Survey

**Phase:** Execute (per consumer, parallel)
**Agent type:** `Explore`
**Thoroughness:** `quick`

**Prompt template:**

> Survey one consumer call site before migrating it to the extracted module.
>
> **Consumer file:** `{{CONSUMER_FILE}}`
> **Current import:** `{{CURRENT_IMPORT}}`
> **New import (proposed):** `{{NEW_IMPORT}}`
>
> **Your task:**
>
> 1. Read `{{CONSUMER_FILE}}` around the import and its usage (within 50 lines of each call site).
> 2. Note: does the consumer use the symbol directly, re-export it, or pass it through props?
> 3. Identify any typing constraints: are there local type assertions, generics, or `as` casts that depend on the current module's types?
> 4. Check if this consumer has a co-located test file. If so, will the test still pass if the import path changes?
> 5. Flag any risk specific to this consumer (e.g., it is a root-level module, it is part of the architecture test TIER_MAP).
>
> **Report format (under 200 words):**
>
> - **Usage pattern:** direct call / re-export / prop-threaded
> - **Type dependencies:** list or "none"
> - **Test file:** path or "none"
> - **Migration risk:** low / medium / high with one-line reason
> - **Migration action:** one sentence — what the main agent needs to do

---

## Pattern Extraction Guide

**Phase:** Execute (per phase)
**Agent type:** `Explore`
**Thoroughness:** `quick`

**Prompt template:**

> Confirm the extraction approach for one phase before code changes begin.
>
> **Target:** `{{TARGET_FILE}}`
> **Phase scope:** `{{PHASE_SCOPE}}`
> **Confirmed pattern:** `{{PATTERN}}`
> **Wiki section (pattern extraction steps):** `{{WIKI_SECTION}}`
> **Tripwires for this phase:** `{{TRIPWIRES}}`
>
> **Your task:**
>
> 1. Read the wiki extraction steps for `{{PATTERN}}` (from `{{WIKI_SECTION}}`).
> 2. Verify the planned extraction matches the pattern's prescribed sequence (e.g., "introduce interface first", "move implementation before updating consumers").
> 3. Check that every tripwire listed in `{{TRIPWIRES}}` is covered by the pre-test or by existing tests.
> 4. Flag any deviation between the plan and the wiki's prescribed steps.
>
> **Report format (under 200 words):**
>
> - **Extraction sequence match:** yes / partial / no — with details if partial or no
> - **Uncovered tripwires:** list or "none"
> - **Recommended adjustment (if any):** one sentence, or "none"
> - **Ready to proceed:** yes / no with reason
