# E2E Test Runner Implementation Milestones

> **Layer 3 Implementation**: This document details the E2E Integration layer (Layer 3) of the [Testing Strategy](./TESTING_STRATEGY.md). All phases and milestones in this document are prefixed with "L3-" to indicate they belong to the E2E testing layer.

This document breaks down the implementation of the E2E test runner CLI into discrete, independently deliverable phases and milestones. For overall design rationale and architecture, see [e2e-test-runner-design.md](./e2e-test-runner-design.md).

## Overview

The implementation is organized into 7 L3 phases with 18 milestones total. Each milestone has clear deliverables and acceptance criteria, enabling focused planning and incremental delivery.

---

## L3 Phase 1: Foundation & Validation ✅ **COMPLETED**

**Completion Date**: 2026-02-01
**Status**: All acceptance criteria met
**Outcome**: Critical findings identified, JSON loading infrastructure implemented

### Summary of L3 Phase 1 Results

**Assumption Verification Status**:

- ✅ **2 assumptions verified true** (U8: localStorage reliable, U9: LazyRender testable)
- ⚠️ **4 assumptions partially true** (U2, U5, U6, U10) - require adjustments
- ❌ **4 assumptions falsified** (U1, U3, U4, U7) - require design changes

**Critical Findings**:

1. **U1 (Falsified)**: Not all steps have "Do it" buttons - some have `doIt: false`, others are `noop` steps that auto-complete
2. **U3 (Falsified)**: Steps may not be clickable when discovered - must wait for `isEligibleForChecking` (sequential dependencies)
3. **U2 (Partial)**: Steps can pre-complete via objectives before clicking "Do it"
4. **U4 (Falsified)**: Fix buttons can fail - need timeout and max attempts

**Design Impact**: Medium - Findings improve the design by addressing real-world behavior. No architectural blockers. See `L3-phase1-verification-results.md` for detailed analysis.

**Files Created**:

- `tests/e2e-runner/design/L3-phase1-verification-results.md` - Comprehensive verification report with code evidence

---

### Milestone L3-1A: Assumption Verification Spike ✅ **COMPLETED**

**Rationale**: Verifies design assumptions before implementation per [Assumptions](./e2e-test-runner-design.md#assumptions) section.

**Goal**: Before building, verify the 10 unexamined assumptions (U1-U10) identified in the design document. This is a time-boxed investigation, not implementation.

**Deliverables**:

1. Create a test file that manually exercises each assumption
2. Document findings in a verification table
3. Identify design adjustments needed

**Key questions to answer**:

- Do all testable steps have "Do it" buttons? (U1)
- How do pre-completed steps (via objectives) behave? (U2, U5)
- Does the SequentialRequirementsManager interfere with test actions? (U7)
- How should lazyRender steps be handled? (U9)

**Acceptance criteria**:

- [x] All 10 assumptions documented as verified/adjusted ✅
- [x] Design document updated with findings ✅ (see below in Phase 1 summary)
- [x] Risk register created for any unresolved concerns ✅ (in phase1-verification-results.md)

**Estimated effort**: Small (1-2 days investigation)

**Actual effort**: 1 day (code analysis)

---

### Milestone L3-1B: JSON Loading Infrastructure ✅ **COMPLETED**

**Rationale**: Enables test guide injection per [Raw JSON Loading Mechanism](./e2e-test-runner-design.md#raw-json-loading-mechanism).

**Goal**: Enable loading arbitrary JSON guides into the pathfinder UI via localStorage. This is low-risk and provides immediate value for manual testing too.

**Deliverables**:

1. Add `E2E_TEST_GUIDE` key to `src/lib/user-storage.ts`
2. Add `bundled:e2e-test` handler in `src/docs-retrieval/content-fetcher.ts`
3. Manual verification script/instructions

**Dependencies**: None

**Files modified**:

- `src/lib/user-storage.ts` - Added E2E_TEST_GUIDE storage key
- `src/docs-retrieval/content-fetcher.ts` - Added bundled:e2e-test handler

**Acceptance criteria**:

- [x] `localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', jsonString)` stores guide ✅
- [x] Opening `bundled:e2e-test` renders the stored guide in the docs panel ✅
- [x] Guide displays correctly with all interactive elements ✅

**Implementation Notes**:

- Handler follows same pattern as WYSIWYG preview (lines 264-306 in content-fetcher.ts)
- Extracts title from JSON metadata for better UX
- Returns clear error if no test content available
- Works with existing localStorage infrastructure (quota handling, etc.)

**Estimated effort**: Small (half day)

**Actual effort**: 1 hour

---

## L3 Phase 2: CLI Scaffolding

### Milestone L3-2A: CLI Command Skeleton

**Rationale**: Establishes CLI interface per [CLI Interface](./e2e-test-runner-design.md#cli-interface).

**Goal**: Create the basic CLI command structure without Playwright integration.

**Deliverables**:

1. Create `src/cli/commands/e2e.ts` with Commander.js
2. Add command to `src/cli/index.ts`
3. Implement JSON loading and schema validation
4. Parse all CLI options (no implementation yet)

**Dependencies**: Milestone L3-1B (JSON loading)

**Files to create/modify**:

- `src/cli/commands/e2e.ts` - New command file
- `src/cli/index.ts` - Register command

**Acceptance criteria**:

- [ ] `npx pathfinder-cli e2e ./guide.json` validates JSON and exits
- [ ] Invalid JSON fails with helpful error message
- [ ] `--help` shows all options: `--grafana-url`, `--output`, `--trace`, `--verbose`, `--bundled`

**Estimated effort**: Small (half day)

---

### Milestone L3-2B: Playwright Spawning

**Rationale**: Integrates Playwright per [Architecture](./e2e-test-runner-design.md#architecture).

**Goal**: CLI spawns Playwright and establishes basic guide loading.

**Deliverables**:

1. Create minimal `tests/e2e-runner/guide-runner.spec.ts`
2. CLI sets environment variables and spawns Playwright
3. Verify guide loads in docs panel
4. Pass `--trace` flag through to Playwright

**Dependencies**: Milestone L3-2A

**Files to create**:

- `tests/e2e-runner/guide-runner.spec.ts` - Main test file

**Acceptance criteria**:

- [ ] CLI spawns Playwright successfully
- [ ] Guide JSON injected into localStorage
- [ ] Guide opens in docs panel (can see title)
- [ ] `--trace` generates trace file in test-results directory

**Estimated effort**: Medium (1-2 days)

---

### Milestone L3-2C: Pre-flight Checks

**Rationale**: Enables fail-fast behavior before wasting time on guide execution.

**Goal**: Fail fast with clear error messages before running any guide tests.

**Specification**: See [Pre-flight Checks](./e2e-test-runner-design.md#pre-flight-checks) for check sequence and [Exit codes](./e2e-test-runner-design.md#exit-codes) for exit code table.

**Deliverables**:

1. Implement pre-flight check sequence per design doc
2. Add exit codes for different failure types
3. Clear error messages for each failure mode

**Dependencies**: Milestone L3-2B

**Acceptance criteria**:

- [ ] Grafana health check before test execution
- [ ] Auth validation before guide loading
- [ ] Plugin installation verified
- [ ] Clear error messages with exit codes for each failure type
- [ ] Pre-flight results included in verbose output

**Estimated effort**: Small (half day)

---

## L3 Phase 3: Step Discovery & Execution (Core Functionality)

This is the highest-complexity phase. Consider splitting into smaller increments if the spike reveals additional complexity.

### Milestone L3-3A: DOM-Based Step Discovery

**Rationale**: Implements [DOM-Based Step Discovery](./e2e-test-runner-design.md#dom-based-step-discovery) to test actual rendered UI.

**Goal**: Discover testable steps from rendered DOM.

**Deliverables**:

1. Create `tests/e2e-runner/utils/guide-test-runner.ts`
2. Implement `discoverStepsFromDOM()` function
3. Handle edge cases identified in spike (pre-completed steps, lazyRender)

**Dependencies**: Milestone L3-2C (pre-flight checks must pass first)

**Files to create**:

- `tests/e2e-runner/utils/guide-test-runner.ts` - Test utilities

**Acceptance criteria**:

- [ ] All rendered interactive steps discovered from DOM
- [ ] Steps discovered in document order (top to bottom)
- [ ] Pre-completed steps detected (don't have "Do it" button)
- [ ] Step metadata captured (stepId, skippable flag)

**Estimated effort**: Medium (1-2 days)

---

### Milestone L3-3B: Step Execution (Happy Path)

**Rationale**: Implements [Test Execution](./e2e-test-runner-design.md#test-execution) step execution flow.

**Goal**: Execute steps assuming all requirements are met.

**Deliverables**:

1. Implement `executeStep()` function
2. Implement `scrollStepIntoView()`
3. Click "Do it" button, verify completion indicator
4. Capture basic diagnostics (duration, URL)

**Dependencies**: Milestone L3-3A

**Acceptance criteria**:

- [ ] Steps scrolled into view before execution
- [ ] "Do it" button clicked for each step
- [ ] Completion indicator detected (or timeout)
- [ ] Pre-completed steps handled gracefully (logged, skipped)

**Estimated effort**: Medium (1-2 days)

---

### Milestone L3-3C: Timing and Completion Detection

**Rationale**: Handles [Timing Considerations](./e2e-test-runner-design.md#timing-considerations) and [Completion Detection](./e2e-test-runner-design.md#completion-detection).

**Goal**: Handle completion detection using DOM polling.

**Deliverables**:

1. Wait for "Do it" button to be enabled (not just visible)
2. Handle multiple completion paths (manual, objectives, skipped)
3. Add settling delay after actions for reactive system
4. Implement configurable timeout (30s default)
5. **DOM polling for completion indicator**

**Removed from scope**:

- Event-driven completion detection (decide later based on polling reliability)

**Dependencies**: Milestone L3-3B

**Technical considerations**:

- EchoSrv context subscriptions trigger rechecks on navigation
- SequentialRequirementsManager coordinates step eligibility
- Multiple completion paths: manual, objectives, skipped, completeEarly
- Debounced rechecks (500ms context, 1200ms DOM)

**Acceptance criteria**:

- [ ] Sequential dependencies respected (wait for button enabled)
- [ ] Objective-based auto-completion detected before clicking
- [ ] Multisteps complete successfully with longer timeouts
- [ ] Completion detected via DOM indicator visibility

**Estimated effort**: Medium (1-2 days)

---

### Milestone L3-3D: Session Validation During Execution

**Rationale**: Implements [Session Validation During Execution](./e2e-test-runner-design.md#session-validation-during-execution).

**Goal**: Detect session expiry during long-running tests and abort gracefully.

**Deliverables**:

1. Implement lightweight session validation
2. Periodic auth check during step loop (every 5 steps)
3. Graceful abort with `AUTH_EXPIRED` classification

**Dependencies**: Milestone L3-3C

**Implementation**:

```typescript
async function validateSession(page: Page): Promise<boolean> {
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/user');
    return res.ok;
  });
  return response;
}

// In step loop, check every 5 steps
if (stepIndex % 5 === 0) {
  const sessionValid = await validateSession(page);
  if (!sessionValid) {
    return { aborted: true, reason: 'AUTH_EXPIRED' };
  }
}
```

**Acceptance criteria**:

- [ ] Session validation runs every N steps (configurable, default 5)
- [ ] Session expiry detected before step fails cryptically
- [ ] `AUTH_EXPIRED` classification in report
- [ ] Exit code 4 for auth failures
- [ ] Remaining steps marked as `not_reached`

**Estimated effort**: Small (half day)

---

## L3 Phase 4: Requirements Handling

### Milestone L3-4A: Requirements Detection

**Rationale**: Implements [Requirements Handling](./e2e-test-runner-design.md#requirements-handling-mvp) detection logic.

**Goal**: Detect step requirements and their status.

**Deliverables**:

1. Implement `handleRequirements()` function
2. Detect Fix buttons and their availability
3. Distinguish skippable vs mandatory steps
4. Detect requirement type from DOM attributes

**Dependencies**: Milestone L3-3D (session validation)

**Acceptance criteria**:

- [ ] Requirements detected for each step
- [ ] Fix button presence detected
- [ ] Skippable flag read from step
- [ ] Requirement status (met/unmet) determined

**Estimated effort**: Medium (1 day)

---

### Milestone L3-4B: Fix Button Execution

**Rationale**: Enables automatic requirement satisfaction per [Requirements Handling](./e2e-test-runner-design.md#requirements-handling-mvp).

**Goal**: Click Fix buttons and handle outcomes.

**Specification**: See [Fix Button Reliability](./e2e-test-runner-design.md#4-fix-button-reliability-medium-complexity) for fix types and failure modes.

**Deliverables**:

1. Click Fix buttons with timeout (10s per operation)
2. Handle fix failures gracefully
3. Limit fix attempts to **3** (reduced from original 10 for faster failure)
4. Auto-satisfy `navmenu-open` and `on-page:` requirements

**Dependencies**: Milestone L3-4A

**Acceptance criteria**:

- [ ] Fix buttons clicked automatically when present
- [ ] Nav menu opened when `navmenu-open` required
- [ ] Navigation fixes trigger page load wait
- [ ] Fix failures don't crash test (log and continue based on skippable)
- [ ] Max 3 fix attempts before giving up

**Estimated effort**: Medium (1-2 days)

---

### Milestone L3-4C: Skippable vs Mandatory Logic

**Rationale**: Implements [Skippable vs Mandatory Steps](./e2e-test-runner-design.md#skippable-vs-mandatory-steps) decision tree.

**Goal**: Implement the decision tree from the design.

**Specification**: See [Decision Tree](./e2e-test-runner-design.md#decision-tree) for skip/mandatory flow diagram.

**Deliverables**:

1. Skippable steps with unmet requirements → SKIPPED
2. Mandatory steps with unmet requirements → FAILED
3. Failed mandatory step stops test progression
4. Remaining steps marked as NOT_REACHED

**Dependencies**: Milestone L3-4B

**Acceptance criteria**:

- [ ] Skippable steps skip gracefully with reason logged
- [ ] Mandatory failures stop test progression
- [ ] NOT_REACHED status for steps after mandatory failure
- [ ] Test exit code reflects failures

**Estimated effort**: Small (half day)

---

## L3 Phase 5: Reporting

### Milestone L3-5A: Console Reporting

**Rationale**: Provides real-time feedback during test execution for debugging.

**Goal**: Real-time console output with clear visual feedback.

**Specification**: See [Console Output](./e2e-test-runner-design.md#console-output) for expected format and status indicators.

**Deliverables**:

1. Step-by-step progress output during execution
2. Status indicators (✓ passed, ✗ failed, ⊘ skipped, ○ not_reached)
3. Timing per step
4. Summary statistics at end

**Dependencies**: Milestone L3-4C

**Acceptance criteria**:

- [ ] Each step shows as it completes
- [ ] Clear visual distinction between statuses
- [ ] Duration shown per step
- [ ] Summary shows totals
- [ ] Exit code 0 for all pass, non-zero for any failures

**Estimated effort**: Small (half day)

---

### Milestone L3-5B: JSON Reporting

**Rationale**: Enables CI integration and programmatic test result analysis.

**Goal**: Structured JSON output for CI integration.

**Specification**: See [JSON Output](./e2e-test-runner-design.md#json-output) for complete JSON structure.

**Deliverables**:

1. Create `src/cli/utils/e2e-reporter.ts`
2. Implement full JSON report structure per design doc
3. Write to file via `--output` option
4. Include console errors per step

**Dependencies**: Milestone L3-5A

**Files to create**:

- `src/cli/utils/e2e-reporter.ts` - Report generator

**Acceptance criteria**:

- [ ] JSON file written to specified path
- [ ] Contains guide metadata, config, summary
- [ ] Each step has status, duration, currentUrl, consoleErrors
- [ ] Skipped steps include skip reason
- [ ] Failed steps include error message

**Estimated effort**: Medium (1 day)

---

### Milestone L3-5C: Error Classification (MVP)

**Rationale**: Provides hints for failure triage per [Failure Classification](../../TESTING_STRATEGY.md#failure-classification).

**Goal**: Add classification field to failures as a **hint**, not a routing decision.

**Specification**: See [Error Classification](./e2e-test-runner-design.md#error-classification) for MVP approach and validation plan.

**Deliverables**:

1. Add `classification` field to step results
2. Classify only high-confidence cases: `infrastructure` for TIMEOUT/NETWORK/AUTH
3. Default all other failures to `unknown`
4. Log classification in JSON output

**Decide Later**:

- Auto-routing to teams (requires validation data from 4+ weeks of test runs)
- content-drift vs product-regression heuristic (requires human baseline)

**Dependencies**: Milestone L3-5B

**Acceptance criteria**:

- [ ] All failures include classification field
- [ ] Infrastructure failures correctly identified (TIMEOUT, NETWORK_ERROR, AUTH_EXPIRED)
- [ ] `unknown` used as default (not guessing)
- [ ] JSON output includes classification field

**Estimated effort**: Small (half day)

---

### Milestone L3-5D: Artifact Collection on Failure

**Rationale**: Screenshots and DOM snapshots are critical for debugging failures in CI where you can't watch the browser.

**Goal**: Capture diagnostic artifacts when steps fail.

**Specification**: See [Artifact Collection on Failure](./e2e-test-runner-design.md#artifact-collection-on-failure) for artifact types and implementation.

**Deliverables**:

1. Implement screenshot capture on failure per design doc
2. Implement DOM snapshot capture
3. Add `--artifacts` CLI flag for output directory
4. Include artifact paths in JSON output

**Dependencies**: Milestone L3-5C

**Acceptance criteria**:

- [ ] Screenshot captured on step failure
- [ ] DOM snapshot captured on step failure
- [ ] Artifacts written to `--artifacts` directory (default: `./artifacts/`)
- [ ] Artifact paths included in JSON output
- [ ] Console errors captured per step
- [ ] No artifacts captured for passing steps (saves space)

**Estimated effort**: Medium (1 day)

---

## L3 Phase 6: Framework Test Guide

### Milestone L3-6A: Framework Test Guide Creation (MVP)

**Rationale**: Validates the E2E framework itself; failures here indicate framework bugs, not guide bugs.

**Goal**: Create a minimal guide that validates basic E2E framework functionality.

**Specification**: See [Framework Test Guide](./e2e-test-runner-design.md#framework-test-guide) for MVP scope and expansion criteria.

**Deliverables**:

1. Create `src/bundled-interactives/e2e-framework-test.json` with 3-4 steps
2. Steps cover: highlight, button click, navigate
3. No side effects (read-only operations only)

**Decide Later**:

- Exact timing thresholds (collect data first)
- Full coverage matrix (expand based on observed gaps)
- Failure interpretation table (build from real failures)

**Dependencies**: Milestone L3-5D (needs artifact capture working)

**Design principles**:

- **No mutations**: Never create, modify, or delete data
- **No dependencies**: Works on fresh Grafana with defaults
- **Stable selectors**: Uses only elements that exist in all versions
- **Fast execution**: Completes in under 60 seconds
- **Deterministic**: Same result every time on same Grafana version

**Acceptance criteria**:

- [ ] Framework test guide runs without error on fresh Grafana
- [ ] Guide completes in under 60 seconds (rough bound, not per-step)
- [ ] `npx pathfinder-cli e2e bundled:e2e-framework-test` works

**Estimated effort**: Small (half day)

---

## L3 Phase 7: Polish & Extensions

### Milestone L3-7A: Authentication Module Abstraction

**Rationale**: Enables swappable auth strategies per [Authentication Module](./e2e-test-runner-design.md#authentication-module).

**Goal**: Abstract authentication for future extensibility.

**Deliverables**:

1. Create `tests/e2e-runner/auth/grafana-auth.ts` interface
2. MVP implementation using `@grafana/plugin-e2e` auth
3. Documentation for swapping auth strategies

**Dependencies**: Can be done in parallel with L3 Phase 5

**Files to create**:

- `tests/e2e-runner/auth/grafana-auth.ts` - Auth module

**Acceptance criteria**:

- [ ] Auth logic isolated in separate module
- [ ] Tests run with existing auth (admin.json)
- [ ] Clear extension point documented for alternative auth strategies

**Estimated effort**: Small (half day)

---

### Milestone L3-7B: Bundled Guide Testing

**Rationale**: Tests all bundled guides per [CLI Interface](./e2e-test-runner-design.md#cli-interface) `--bundled` flag.

**Goal**: Add `--bundled` flag to test all bundled guides.

**Deliverables**:

1. Implement `--bundled` flag in CLI
2. Load guides from `src/bundled-interactives/`
3. Run tests for each guide sequentially
4. Aggregate results across all guides

**Dependencies**: Milestone L3-5D

**Acceptance criteria**:

- [ ] `npx pathfinder-cli e2e --bundled` tests all bundled guides
- [ ] Each guide tested independently
- [ ] Summary shows results across all guides
- [ ] Exit code reflects overall pass/fail

**Estimated effort**: Medium (1 day)

---

### Milestone L3-7C: CI Workflow Template

**Rationale**: Enables automated testing in CI pipelines with appropriate failure policies.

**Goal**: Provide GitHub Actions workflow for running E2E tests in CI.

**Specification**: See [CI workflow example](./e2e-test-runner-design.md#ci-workflow-example-medium-term) for example workflow YAML and [CI test policies](./e2e-test-runner-design.md#ci-test-policies) for trigger/policy table.

**Deliverables**:

1. Create `.github/workflows/e2e-guides.yml` template per design doc
2. Document CI integration patterns
3. Define test policies (PR vs merge vs nightly)

**Dependencies**: Milestone L3-7B

**Acceptance criteria**:

- [ ] Workflow template documented
- [ ] Works in GitHub Actions environment
- [ ] Artifacts uploaded on failure
- [ ] Test policies documented

**Estimated effort**: Small (half day)

---

## Summary Table

| Milestone                              | L3 Phase | Effort | Risk       | Dependencies |
| -------------------------------------- | -------- | ------ | ---------- | ------------ |
| L3-1A: Assumption Verification         | 1        | Small  | High value | None         |
| L3-1B: JSON Loading                    | 1        | Small  | Low        | None         |
| L3-2A: CLI Skeleton                    | 2        | Small  | Low        | L3-1B        |
| L3-2B: Playwright Spawning             | 2        | Medium | Low        | L3-2A        |
| L3-2C: Pre-flight Checks               | 2        | Small  | Low        | L3-2B        |
| L3-3A: Step Discovery                  | 3        | Medium | Medium     | L3-2C        |
| L3-3B: Step Execution (Happy Path)     | 3        | Medium | Medium     | L3-3A        |
| L3-3C: Timing/Completion (DOM Polling) | 3        | Medium | Medium     | L3-3B        |
| L3-3D: Session Validation              | 3        | Small  | Low        | L3-3C        |
| L3-4A: Requirements Detection          | 4        | Medium | Low        | L3-3D        |
| L3-4B: Fix Button Execution            | 4        | Medium | Medium     | L3-4A        |
| L3-4C: Skip/Mandatory Logic            | 4        | Small  | Low        | L3-4B        |
| L3-5A: Console Reporting               | 5        | Small  | Low        | L3-4C        |
| L3-5B: JSON Reporting                  | 5        | Medium | Low        | L3-5A        |
| L3-5C: Error Classification            | 5        | Small  | Low        | L3-5B        |
| L3-5D: Artifact Collection             | 5        | Medium | Low        | L3-5C        |
| L3-6A: Framework Test Guide (MVP)      | 6        | Small  | Low        | L3-5D        |
| L3-7A: Auth Abstraction                | 7        | Small  | Low        | Parallel     |
| L3-7B: Bundled Testing                 | 7        | Medium | Low        | L3-5D        |
| L3-7C: CI Workflow                     | 7        | Small  | Low        | L3-7B        |

---

## Dependency Graph

```
L3 Phase 1: Foundation
  L3-1A (Spike) ────────────────────────────────────────────────────┐
  L3-1B (JSON Loading) ───┐                                         │
                          │                                         │
L3 Phase 2: CLI           ▼                                         │
  L3-2A (CLI Skeleton) ───┐                                         │
                          │                                         │
                          ▼                                         │
  L3-2B (Playwright) ─────┐                                         │
                          │                                         │
                          ▼                                         │
  L3-2C (Pre-flight) ─────┐                                         │
                          │                                         │
L3 Phase 3: Core          ▼    (Findings from L3-1A inform L3-3A-3D)│
  L3-3A (Discovery) ──────┐◄────────────────────────────────────────┘
                          │
                          ▼
  L3-3B (Execution) ──────┐
                          │
                          ▼
  L3-3C (Timing/Polling) ─┐
                          │
                          ▼
  L3-3D (Session) ────────┐
                          │
L3 Phase 4: Requirements  ▼
  L3-4A (Detection) ──────┐
                          │
                          ▼
  L3-4B (Fix Buttons) ────┐
                          │
                          ▼
  L3-4C (Skip/Mandatory) ─┐
                          │
L3 Phase 5: Reporting     ▼
  L3-5A (Console) ────────┐
                          │
                          ▼
  L3-5B (JSON) ───────────┐
                          │
                          ▼
  L3-5C (Classification) ─┐
                          │
                          ▼
  L3-5D (Artifacts) ──────┐
                          │
L3 Phase 6: Framework     ▼
  L3-6A (Test Guide) ─────┐
                          │
L3 Phase 7: Polish        ▼
  L3-7A (Auth) ◄──────────┤ (can run in parallel with L3 Phase 5-6)
                          │
  L3-7B (Bundled) ◄───────┤
                          │
                          ▼
  L3-7C (CI Workflow) ◄───┘
```

---

## Total Estimated Effort

- **L3 Phase 1**: 1.5-2.5 days
- **L3 Phase 2**: 2-3 days (includes pre-flight checks)
- **L3 Phase 3**: 4-6 days (highest complexity, includes DOM polling completion + session validation)
- **L3 Phase 4**: 2.5-3.5 days
- **L3 Phase 5**: 3-4 days (includes error classification + artifact collection)
- **L3 Phase 6**: 0.5-1 day (framework test guide MVP)
- **L3 Phase 7**: 2-3 days

**Total**: ~14-22 days of focused development

---

## Notes for Implementation

1. **Start with Milestone L3-1A**: The spike is critical. Unverified assumptions in the design could invalidate later milestones.

2. **L3 Phase 3 is the riskiest**: Timing and completion detection involves the reactive requirements system. DOM polling is simpler than event-driven but may need adjustment based on empirical data. Budget extra time here.

3. **Milestone L3-7A can be parallelized**: Authentication abstraction is independent and can be worked on alongside L3 Phase 5-6.

4. **Each milestone should be a PR**: Keep changes focused and reviewable.

5. **Write tests for the test runner**: Meta, but important. Unit tests for utility functions in `guide-test-runner.ts`.

6. **Framework test guide (L3-6A) validates your work**: Once implemented, run the framework test guide after each milestone to ensure the runner still works correctly.

7. **Error classification enables CI integration**: The classification system (L3-5C) makes failure routing possible in CI workflows (L3-7C). Implement them in order.

8. **Artifact collection is essential for debugging**: Don't skip L3-5D — screenshots and DOM snapshots are critical for debugging failures in CI where you can't watch the browser.
