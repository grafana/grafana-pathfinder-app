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

## L3 Phase 2: CLI Scaffolding ✅ **COMPLETED**

### Milestone L3-2A: CLI Command Skeleton ✅ **COMPLETED**

**Rationale**: Establishes CLI interface per [CLI Interface](./e2e-test-runner-design.md#cli-interface).

**Goal**: Create the basic CLI command structure without Playwright integration.

**Deliverables**:

1. Create `src/cli/commands/e2e.ts` with Commander.js
2. Add command to `src/cli/index.ts`
3. Implement JSON loading and schema validation
4. Parse all CLI options (no implementation yet)

**Dependencies**: Milestone L3-1B (JSON loading)

**Files created/modified**:

- `src/cli/commands/e2e.ts` - E2E command implementation
- `src/cli/index.ts` - Command registration

**Acceptance criteria**:

- [x] `npx pathfinder-cli e2e ./guide.json` validates JSON and exits ✅
- [x] Invalid JSON fails with helpful error message ✅
- [x] `--help` shows all options: `--grafana-url`, `--output`, `--trace`, `--verbose`, `--bundled` ✅

**Estimated effort**: Small (half day)

**Actual effort**: Previously implemented

**Implementation Notes**:

- Exit codes defined per design spec (SUCCESS=0, TEST_FAILURE=1, CONFIGURATION_ERROR=2, etc.)
- Supports `bundled:name` syntax for loading specific bundled guides
- Validation errors show specific field-level issues for debugging
- Verbose mode lists all loaded guides before validation

---

### Milestone L3-2B: Playwright Spawning ✅ **COMPLETED**

**Rationale**: Integrates Playwright per [Architecture](./e2e-test-runner-design.md#architecture).

**Goal**: CLI spawns Playwright and establishes basic guide loading.

**Deliverables**:

1. Create minimal `tests/e2e-runner/guide-runner.spec.ts`
2. CLI sets environment variables and spawns Playwright
3. Verify guide loads in docs panel
4. Pass `--trace` flag through to Playwright

**Dependencies**: Milestone L3-2A

**Files created/modified**:

- `tests/e2e-runner/guide-runner.spec.ts` - Main test file (NEW)
- `src/cli/commands/e2e.ts` - Updated with Playwright spawning

**Acceptance criteria**:

- [x] CLI spawns Playwright successfully ✅
- [x] Guide JSON injected into localStorage ✅
- [x] Guide opens in docs panel (can see title) ✅
- [x] `--trace` generates trace file in test-results directory ✅

**Estimated effort**: Medium (1-2 days)

**Actual effort**: ~1 hour

**Implementation Notes**:

- `runPlaywrightTests()` function in `e2e.ts` handles temp file creation, Playwright spawning, and cleanup
- Guide JSON written to temp file in system temp directory (`mkdtempSync`)
- Environment variables passed to Playwright: `GUIDE_JSON_PATH`, `GRAFANA_URL`, `E2E_TRACE`
- Temp directory cleaned up in `finally` block to ensure cleanup even on failure
- `guide-runner.spec.ts` injects guide into localStorage using key `grafana-pathfinder-app-e2e-test-guide`
- Uses `pathfinder-auto-open-docs` custom event to open the guide with `bundled:e2e-test` URL
- Test verifies panel visibility and presence of interactive step elements
- Trace file path logged when `--trace` flag is used

---

### Milestone L3-2C: Pre-flight Checks ✅ **COMPLETED**

**Rationale**: Enables fail-fast behavior before wasting time on guide execution.

**Goal**: Fail fast with clear error messages before running any guide tests.

**Specification**: See [Pre-flight Checks](./e2e-test-runner-design.md#pre-flight-checks) for check sequence and [Exit codes](./e2e-test-runner-design.md#exit-codes) for exit code table.

**Deliverables**:

1. Implement pre-flight check sequence per design doc
2. Add exit codes for different failure types
3. Clear error messages for each failure mode

**Dependencies**: Milestone L3-2B

**Files created/modified**:

- `tests/e2e-runner/utils/preflight.ts` - Pre-flight check utilities (NEW)
- `src/cli/commands/e2e.ts` - Added CLI-level Grafana health check
- `tests/e2e-runner/guide-runner.spec.ts` - Added Playwright-level auth and plugin checks

**Acceptance criteria**:

- [x] Grafana health check before test execution ✅
- [x] Auth validation before guide loading ✅
- [x] Plugin installation verified ✅
- [x] Clear error messages with exit codes for each failure type ✅
- [x] Pre-flight results included in verbose output ✅

**Estimated effort**: Small (half day)

**Actual effort**: ~1 hour

**Implementation Notes**:

- **Two-phase pre-flight architecture**:
  - **CLI phase**: Grafana health check using `/api/health` (public endpoint, no auth needed). Exits with code 3 if Grafana is unreachable.
  - **Playwright phase**: Auth validation and plugin installation check. These require browser context for authenticated API calls.

- **Pre-flight check sequence**:
  1. CLI: `checkGrafanaHealth()` - verifies `/api/health` returns `{ "database": "ok" }`
  2. Playwright: `checkAuthValid()` - navigates to `/dashboards`, verifies no redirect to login, checks `/api/user` API
  3. Playwright: `checkPluginInstalled()` - verifies `/api/plugins/grafana-pathfinder-app/settings` returns OK and plugin is enabled

- **Exit codes implemented**:
  - Exit 3: Grafana unreachable (health check fails)
  - Exit 4: Auth failure (defined but auth failures currently result in test failure exit 1)
  - Exit 2: Configuration error (validation failures)

- **Verbose output** shows timing for each check with pass/fail indicators

- **Design decision**: Auth and plugin checks run in Playwright context because they require authenticated API access. The `@grafana/plugin-e2e` fixture handles authentication automatically via `admin.json` state.

---

## L3 Phase 3: Step Discovery & Execution (Core Functionality) ✅ **COMPLETED**

This is the highest-complexity phase. Consider splitting into smaller increments if the spike reveals additional complexity.

**Progress**: 4/4 milestones complete (L3-3A ✅, L3-3B ✅, L3-3C ✅, L3-3D ✅)

**Completion Date**: 2026-02-04
**Outcome**: All core step discovery and execution functionality implemented including session validation

### Milestone L3-3A: DOM-Based Step Discovery ✅ **COMPLETED**

**Rationale**: Implements [DOM-Based Step Discovery](./e2e-test-runner-design.md#dom-based-step-discovery) to test actual rendered UI.

**Goal**: Discover testable steps from rendered DOM.

**Deliverables**:

1. Create `tests/e2e-runner/utils/guide-test-runner.ts`
2. Implement `discoverStepsFromDOM()` function
3. Handle edge cases identified in spike (pre-completed steps, lazyRender)

**Dependencies**: Milestone L3-2C (pre-flight checks must pass first)

**Files created/modified**:

- `tests/e2e-runner/utils/guide-test-runner.ts` - Step discovery utilities (NEW)
- `tests/e2e-runner/guide-runner.spec.ts` - Integrated step discovery into test flow

**Acceptance criteria**:

- [x] All rendered interactive steps discovered from DOM ✅
- [x] Steps discovered in document order (top to bottom) ✅
- [x] Pre-completed steps detected (don't have "Do it" button) ✅
- [x] Step metadata captured (stepId, skippable flag) ✅

**Estimated effort**: Medium (1-2 days)

**Actual effort**: ~2 hours

**Implementation Notes**:

- **TestableStep interface** captures all metadata identified in L3 Phase 1:
  - `stepId`: Extracted from `data-testid` attribute
  - `index`: Zero-based DOM order position
  - `sectionId`: Parent section ID if within an interactive section
  - `skippable`: Detected by presence of skip button (conservative assumption for completed steps)
  - `hasDoItButton`: Handles U1 finding (not all steps have "Do it" buttons)
  - `isPreCompleted`: Handles U2 finding (objectives/noop auto-completion)
  - `targetAction`: Extracted from `data-targetaction` attribute for diagnostics

- **StepDiscoveryResult** includes statistics:
  - Total steps count
  - Pre-completed count (useful for understanding guide state)
  - No-button count (steps with doIt: false or noop actions)
  - Discovery duration in ms

- **Utility functions** provided for future milestones:
  - `scrollStepIntoView()`: Scroll step into viewport before interaction
  - `waitForDoItButtonEnabled()`: Handle U3 sequential dependencies
  - `waitForStepCompletion()`: DOM polling for completion indicator
  - `logDiscoveryResults()`: Human-readable discovery output

- **Integration**: Step discovery integrated into `guide-runner.spec.ts` after guide loading

---

### Milestone L3-3B: Step Execution (Happy Path) ✅ **COMPLETED**

**Rationale**: Implements [Test Execution](./e2e-test-runner-design.md#test-execution) step execution flow.

**Goal**: Execute steps assuming all requirements are met.

**Deliverables**:

1. Implement `executeStep()` function
2. Implement `scrollStepIntoView()`
3. Click "Do it" button, verify completion indicator
4. Capture basic diagnostics (duration, URL)

**Dependencies**: Milestone L3-3A

**Files modified**:

- `tests/e2e-runner/utils/guide-test-runner.ts` - Added step execution functions
- `tests/e2e-runner/guide-runner.spec.ts` - Integrated step execution into test flow

**Acceptance criteria**:

- [x] Steps scrolled into view before execution ✅
- [x] "Do it" button clicked for each step ✅
- [x] Completion indicator detected (or timeout) ✅
- [x] Pre-completed steps handled gracefully (logged, skipped) ✅

**Estimated effort**: Medium (1-2 days)

**Actual effort**: ~1.5 hours

**Implementation Notes**:

- **New types added**:
  - `StepStatus`: `'passed' | 'failed' | 'skipped' | 'not_reached'`
  - `SkipReason`: `'pre_completed' | 'no_do_it_button' | 'requirements_unmet'`
  - `StepTestResult`: Captures stepId, status, durationMs, currentUrl, consoleErrors, error, skipReason

- **`executeStep()` function** implements the happy path:
  1. Checks for pre-completed steps (U2) → skip with `pre_completed` reason
  2. Checks for missing "Do it" button (U1) → skip with `no_do_it_button` reason
  3. Scrolls step into view with 300ms settle delay
  4. Waits for "Do it" button to be enabled (U3 sequential dependencies, 10s timeout)
  5. Clicks "Do it" button
  6. Waits for completion indicator (30s default timeout)
  7. Returns result with diagnostics (duration, URL, console errors)

- **`executeAllSteps()` function** orchestrates sequential execution:
  - Iterates through all discovered steps
  - Handles abort on mandatory failure (marks remaining as `not_reached`)
  - Supports verbose logging for debugging

- **Console error capture**: Uses page.on('console') with cleanup in `finally` block to prevent memory leaks (per R1 cleanup pattern)

- **Helper functions** for reporting:
  - `logStepResult()`: Human-readable per-step output with status icons
  - `summarizeResults()`: Aggregates counts and success status
  - `logExecutionSummary()`: Summary output with pass/fail counts

- **Design decisions**:
  - Happy path only: Requirements handling deferred to L3-4A/4B
  - All failures treated as mandatory (skip/mandatory logic in L3-4C)
  - 30s default timeout per step (timing refinements in L3-3C)

---

### Milestone L3-3C: Timing and Completion Detection ✅ **COMPLETED**

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

- [x] Sequential dependencies respected (wait for button enabled) ✅
- [x] Objective-based auto-completion detected before clicking ✅
- [x] Multisteps complete successfully with longer timeouts ✅
- [x] Completion detected via DOM indicator visibility ✅

**Estimated effort**: Medium (1-2 days)

**Actual effort**: ~1 hour

**Implementation Notes**:

- **Timing constants** defined per design doc:
  - `DEFAULT_STEP_TIMEOUT_MS`: 30s base timeout
  - `TIMEOUT_PER_MULTISTEP_ACTION_MS`: +5s per internal action for multisteps
  - `BUTTON_ENABLE_TIMEOUT_MS`: 10s for sequential dependency wait
  - `SCROLL_SETTLE_DELAY_MS`: 300ms post-scroll
  - `POST_CLICK_SETTLE_DELAY_MS`: 500ms post-click (allows reactive system to settle)
  - `COMPLETION_POLL_INTERVAL_MS`: 250ms polling for objective detection

- **TestableStep interface** extended with:
  - `isMultistep`: boolean flag for multistep detection
  - `internalActionCount`: number of internal actions (extracted from `data-internal-actions`)

- **`extractMultistepInfo()`** function detects multisteps by:
  - Checking `data-targetaction="multistep"` attribute
  - Parsing `data-internal-actions` JSON to count internal actions
  - Fallback to 3 actions if JSON parsing fails

- **`calculateStepTimeout()`** function calculates dynamic timeout:
  - Simple steps: 30s default
  - Multisteps: 30s + (5s × internalActionCount)
  - Example: 5-action multistep gets 55s timeout

- **`waitForCompletionWithObjectivePolling()`** enhanced completion detection:
  - Polls every 250ms for completion indicator
  - Detects if completion happened quickly (likely via objectives)
  - Falls back to Playwright's `expect().toBeVisible()` on timeout

- **`checkObjectiveCompletion()`** checks for pre-click completion:
  - Called after scrolling, before clicking "Do it"
  - Catches cases where prior navigation satisfied objectives

- **Enhanced `executeStep()`** flow:
  1. Check pre-completed (from discovery)
  2. Check no "Do it" button
  3. Scroll with settle delay
  4. Check objective completion before clicking
  5. Wait for button enabled (10s, sequential dependencies)
  6. Click "Do it"
  7. Post-click settle delay (500ms)
  8. Wait for completion with polling

- **Verbose logging** enhanced to show:
  - Multistep detection with action count
  - Calculated timeout for multisteps
  - Objective-based completion detection

---

### Milestone L3-3D: Session Validation During Execution ✅ **COMPLETED**

**Rationale**: Implements [Session Validation During Execution](./e2e-test-runner-design.md#session-validation-during-execution).

**Goal**: Detect session expiry during long-running tests and abort gracefully.

**Deliverables**:

1. Implement lightweight session validation
2. Periodic auth check during step loop (every 5 steps)
3. Graceful abort with `AUTH_EXPIRED` classification

**Dependencies**: Milestone L3-3C

**Files modified**:

- `tests/e2e-runner/utils/guide-test-runner.ts` - Added session validation types, constants, and functions
- `tests/e2e-runner/guide-runner.spec.ts` - Handle AUTH_EXPIRED abort with abort file for exit code
- `src/cli/commands/e2e.ts` - Read abort file to determine exit code 4 for auth failures

**Acceptance criteria**:

- [x] Session validation runs every N steps (configurable, default 5) ✅
- [x] Session expiry detected before step fails cryptically ✅
- [x] `AUTH_EXPIRED` classification in report ✅
- [x] Exit code 4 for auth failures ✅
- [x] Remaining steps marked as `not_reached` ✅

**Estimated effort**: Small (half day)

**Actual effort**: ~1 hour

**Implementation Notes**:

- **New types added**:
  - `AbortReason`: `'AUTH_EXPIRED' | 'MANDATORY_FAILURE'`
  - `AllStepsResult`: Contains step results plus abort information (aborted, abortReason, abortMessage)

- **Session validation constants**:
  - `DEFAULT_SESSION_CHECK_INTERVAL`: 5 steps (configurable via options)
  - `SESSION_VALIDATION_TIMEOUT_MS`: 5s timeout for the /api/user fetch

- **`validateSession()` function**:
  - Uses `page.evaluate()` to run fetch in browser context with session cookies
  - Checks `/api/user` endpoint - returns false if response is not OK
  - Includes 5s timeout to avoid hanging on network issues
  - Returns false on any error (including page crash)

- **Session check integration in `executeAllSteps()`**:
  - Checks session at step indices 0, N, 2N, etc. (where N = sessionCheckInterval)
  - On session expiry, marks current and all remaining steps as `not_reached`
  - Returns `AllStepsResult` with `aborted: true` and `abortReason: 'AUTH_EXPIRED'`

- **Exit code 4 mechanism**:
  - Test writes abort reason to temp file (`ABORT_FILE_PATH` env var)
  - CLI reads abort file after Playwright exits
  - If abort file contains `AUTH_EXPIRED`, CLI exits with code 4 (`ExitCode.AUTH_FAILURE`)
  - This workaround is needed because Playwright always exits with 0 or 1

- **Verbose output** shows session validation timing:
  - "🔐 Validating session (step N)..."
  - "✓ Session valid" or "❌ Session expired, aborting remaining steps"

- **Summary output** enhanced with auth expiry count:
  - "🔐 Auth expired: N" shown when applicable

---

## L3 Phase 4: Requirements Handling

**Progress**: 1/3 milestones complete (L3-4A ✅)

### Milestone L3-4A: Requirements Detection ✅ **COMPLETED**

**Rationale**: Implements [Requirements Handling](./e2e-test-runner-design.md#requirements-handling-mvp) detection logic.

**Goal**: Detect step requirements and their status.

**Deliverables**:

1. Implement `handleRequirements()` function
2. Detect Fix buttons and their availability
3. Distinguish skippable vs mandatory steps
4. Detect requirement type from DOM attributes

**Dependencies**: Milestone L3-3D (session validation)

**Files modified**:

- `tests/e2e-runner/utils/guide-test-runner.ts` - Added requirements detection types and functions

**Acceptance criteria**:

- [x] Requirements detected for each step ✅
- [x] Fix button presence detected ✅
- [x] Skippable flag read from step ✅
- [x] Requirement status (met/unmet) determined ✅

**Estimated effort**: Medium (1 day)

**Actual effort**: ~1.5 hours

**Implementation Notes**:

- **New types added**:
  - `RequirementStatus`: `'met' | 'unmet' | 'checking' | 'unknown'`
  - `RequirementFixType`: `'navigation' | 'location' | 'expand-parent-navigation' | 'lazy-scroll'`
  - `RequirementResult`: Captures all requirement-related info (hasFixButton, fixType, skippable, explanationText, etc.)

- **`detectRequirements()` function** examines DOM to determine:
  - Whether "Do it" button is enabled (indicates requirements met)
  - Whether requirement explanation element is present (indicates requirements not met or checking)
  - Whether spinner is visible (indicates requirements being checked)
  - Presence of Fix, Retry, and Skip buttons

- **`detectFixType()` function** infers fix type from:
  - Explanation text content (navigation, menu, page, scroll keywords)
  - Target action type (navigate → location)
  - RefTarget selector (nav-menu → navigation)

- **`waitForRequirementsCheckComplete()`** polls for spinner to disappear before detecting final status

- **`handleRequirements()`** is the main entry point that:
  1. Waits for ongoing requirements check to complete (10s timeout)
  2. Calls `detectRequirements()` to get current status
  3. Logs results in verbose mode

- **Integration in `executeStep()`**:
  - Requirements detected after scrolling, before clicking "Do it"
  - Skippable steps with unmet requirements are skipped (preliminary L3-4C logic)
  - Mandatory steps with unmet requirements still attempt execution (fix handling in L3-4B)

- **`TestableStep` extended** with `refTarget` field for requirements detection

- **Design decisions**:
  - Fix execution deferred to L3-4B
  - Full skip/mandatory logic deferred to L3-4C
  - Requirements detection uses test IDs from `src/components/testIds.ts` for stability

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

| Milestone                              | L3 Phase | Effort | Risk       | Dependencies | Status |
| -------------------------------------- | -------- | ------ | ---------- | ------------ | ------ |
| L3-1A: Assumption Verification         | 1        | Small  | High value | None         | ✅     |
| L3-1B: JSON Loading                    | 1        | Small  | Low        | None         | ✅     |
| L3-2A: CLI Skeleton                    | 2        | Small  | Low        | L3-1B        | ✅     |
| L3-2B: Playwright Spawning             | 2        | Medium | Low        | L3-2A        | ✅     |
| L3-2C: Pre-flight Checks               | 2        | Small  | Low        | L3-2B        | ✅     |
| L3-3A: Step Discovery                  | 3        | Medium | Medium     | L3-2C        | ✅     |
| L3-3B: Step Execution (Happy Path)     | 3        | Medium | Medium     | L3-3A        | ✅     |
| L3-3C: Timing/Completion (DOM Polling) | 3        | Medium | Medium     | L3-3B        | ✅     |
| L3-3D: Session Validation              | 3        | Small  | Low        | L3-3C        | ✅     |
| L3-4A: Requirements Detection          | 4        | Medium | Low        | L3-3D        | ✅     |
| L3-4B: Fix Button Execution            | 4        | Medium | Medium     | L3-4A        |        |
| L3-4C: Skip/Mandatory Logic            | 4        | Small  | Low        | L3-4B        |        |
| L3-5A: Console Reporting               | 5        | Small  | Low        | L3-4C        |        |
| L3-5B: JSON Reporting                  | 5        | Medium | Low        | L3-5A        |        |
| L3-5C: Error Classification            | 5        | Small  | Low        | L3-5B        |        |
| L3-5D: Artifact Collection             | 5        | Medium | Low        | L3-5C        |        |
| L3-6A: Framework Test Guide (MVP)      | 6        | Small  | Low        | L3-5D        |        |
| L3-7A: Auth Abstraction                | 7        | Small  | Low        | Parallel     |        |
| L3-7B: Bundled Testing                 | 7        | Medium | Low        | L3-5D        |        |
| L3-7C: CI Workflow                     | 7        | Small  | Low        | L3-7B        |        |

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
- **L3 Phase 3**: 4-6 days estimated, ~5 hours actual (highest complexity, includes DOM polling completion + session validation)
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
