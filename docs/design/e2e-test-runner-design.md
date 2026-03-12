# E2E Test Runner CLI Design

This document describes the design for a CLI utility that runs end-to-end tests on JSON block files, verifying that all interactive elements function correctly in a live Grafana instance.

For the user-facing CLI reference (options, quick start, exit codes, troubleshooting), see [`docs/developer/E2E_TESTING.md`](../developer/E2E_TESTING.md).

## Overview

The CLI takes a JSON guide file as input and dynamically generates and executes Playwright E2E tests against a running Grafana instance. It tests that:

1. **Rendering**: The guide loads and renders correctly in the docs panel
2. **Execution**: Each interactive step executes correctly when "Do it" is clicked
3. **Completion**: Steps complete successfully or are correctly skipped

## Design Goals

This document serves as an architecture overview for decomposition into implementation milestones. Key constraints:

- **MVP-first approach**: Start with minimal viable features, expand later
- **DOM-based iteration**: Tests interact with the rendered UI, not the raw JSON structure
- **Sequential execution**: Tests run as a user would experience the guide
- **Modular authentication**: Auth module can be swapped for different Grafana instances
- **Dynamic test generation**: No static test files, tests generated at runtime

## Pre-flight Checks

Before running any guide tests, the CLI performs validation to fail fast with clear error messages:

### Check sequence

1. **Grafana reachable**: `GET /api/health` returns `{ "database": "ok" }`
2. **Auth valid**: Navigate to a protected page, verify no redirect to login
3. **Plugin installed**: Verify `grafana-pathfinder-app` appears in plugin list
4. **Dev mode enabled**: Attempt test injection, verify plugin accepts

### Exit codes

| Code | Meaning                          |
| ---- | -------------------------------- |
| 0    | All steps passed                 |
| 1    | One or more steps failed         |
| 2    | Configuration/setup error        |
| 3    | Grafana unreachable (pre-flight) |
| 4    | Auth failure (pre-flight)        |

## Raw JSON Loading Mechanism

The pathfinder UI currently supports loading guides from:

- Bundled content (`bundled:guide-id`)
- Grafana docs URLs
- GitHub raw URLs (dev mode only)
- Localhost URLs (dev mode only)

For E2E testing, we need to load arbitrary JSON files. We'll extend the existing `bundled:wysiwyg-preview` pattern.

### Test Flow

1. **CLI reads JSON file** from disk
2. **Playwright injects JSON** into localStorage
3. **Open guide via panel API** by dispatching a `pathfinder-auto-open-docs` custom event with `{ url: 'bundled:e2e-test', title: 'E2E Test Guide' }`
4. **Guide renders** in the docs panel
5. **Tests execute** against the rendered interactive steps

## Step Iteration and Scrolling

The test runner must handle step visibility and timing carefully, as the guide panel has scrollable content and steps may not all be visible at once.

### DOM-Based Step Discovery

The test runner discovers steps by querying the rendered DOM, not by parsing the JSON. This ensures we test what the user actually sees after the plugin processes conditional logic and renders the guide.

Steps are rendered in the docs panel with predictable test IDs:

```typescript
// From src/components/testIds.ts
testIds.interactive.step(stepId); // data-testid="interactive-step-{stepId}"
testIds.interactive.doItButton(stepId); // data-testid="interactive-do-it-{stepId}"
testIds.interactive.stepCompleted(stepId); // data-testid="interactive-step-completed-{stepId}"
```

**Note**: The plugin handles conditional branches based on app state. The E2E runner simply iterates through whatever steps are rendered in the DOM - it does not need to evaluate or choose conditional paths.

### Scrolling the Guide Panel

Before interacting with a step, the test runner must ensure the step is visible in the docs panel viewport. `scrollIntoViewIfNeeded()` is used on the step element before each interaction, with a short settling wait after scroll animation.

## Timing Considerations

Different step types require different wait times. The test runner must account for:

### Base Timing Constants

From `src/constants/interactive-config.ts`:

```typescript
INTERACTIVE_CONFIG = {
  delays: {
    perceptual: {
      base: 800, // Base delay for human perception
      button: 1500, // Click action delay
      hover: 2000, // Hover duration
    },
    technical: {
      navigation: 300, // Page navigation settling
      scroll: 500, // Scroll animation
      highlight: 2500, // Highlight animation duration
    },
    multiStep: {
      defaultStepDelay: 1800, // Between internal actions
    },
  },
};
```

### Step Type Timing

| Step Type               | Estimated Duration | Notes                                   |
| ----------------------- | ------------------ | --------------------------------------- |
| Single `highlight`      | 2-3s               | Do it + highlight animation             |
| Single `button`         | 1-2s               | Do it + click                           |
| Single `formfill`       | 2-4s               | Do it + typing animation                |
| `multistep` (3 actions) | 6-10s              | ~1.8s per internal action + transitions |
| `multistep` (5 actions) | 10-16s             | Scales with action count                |

### Dynamic Wait Strategy

Since the test runner uses DOM-based discovery, it doesn't know the step type or action count from the JSON. Instead, we use a generous default timeout and rely on completion detection (30s base, +5s per multistep action).

**Note**: The completion indicator (`data-testid="interactive-step-completed-{stepId}"`) appearing is the primary signal for step completion. The timeout is a safety net, not the expected completion mechanism.

### Completion Detection

**MVP approach**: DOM polling only.

**Document & Test Assumption**: DOM polling will be reliable enough for E2E tests.

**Validation plan**:

1. Implement DOM polling
2. Run 100+ test executions
3. Track false negatives (step completed but indicator not detected)
4. If false negative rate > 5%, investigate event-driven approach

**Decide Later**: Event-driven completion detection. Only pursue if:

- DOM polling proves unreliable (>5% false negatives)
- AND the root cause is timing (not selector issues)
- AND plugin changes are feasible in the timeline

## Test Execution

The test runner executes steps as a user would experience them, clicking the "Do it" button for each step.

### What Gets Tested

For each step, the runner verifies:

- Requirements can be satisfied (Fix buttons work)
- "Do it" button is clickable
- Step completes successfully (completion indicator appears)
- No blocking errors occur during execution

### Session Validation During Execution

For long-running tests, the session may expire mid-execution. The runner performs lightweight auth validation every 5 steps by checking `/api/user`.

If session validation fails:

1. Abort remaining steps with `AUTH_EXPIRED` classification
2. Capture current state in artifacts
3. Exit with code 4

## Requirements Handling (MVP)

For the MVP, requirements handling follows these rules:

### Decision Tree

```
Step has requirements?
├── No → Execute step
└── Yes → Check requirements
    ├── Requirements met → Execute step
    └── Requirements not met
        ├── Fix button available?
        │   ├── Yes → Click Fix, recheck
        │   └── No → Check skippable
        └── Is step skippable?
            ├── Yes → Skip step, continue
            └── No → FAIL test (cannot proceed)
```

### Skippable vs Mandatory Steps

1. **Skippable steps** (`"skippable": true`):
   - If requirements aren't met after fix attempts, skip the step
   - Log as "SKIPPED" with reason (e.g., "is-admin requirement not met")
   - Continue to next step
   - Does NOT fail the overall test

2. **Mandatory steps** (no `skippable` flag or `"skippable": false`):
   - If requirements aren't met, attempt to fix (click Fix button)
   - If still not met after fix attempts, mark step as "FAILED"
   - **Test cannot proceed past a failed mandatory step**
   - Remaining steps marked as "NOT_REACHED"

### Automatic Requirement Satisfaction (MVP)

The test runner will attempt to satisfy these requirements automatically:

| Requirement        | Auto-fix Action                             |
| ------------------ | ------------------------------------------- |
| `navmenu-open`     | Click mega-menu button to open nav          |
| `on-page:/path`    | Navigate to the specified path              |
| `exists-reftarget` | Wait for element (verified by reachability) |

### Deferred Requirements (MVP)

These requirements are checked but not auto-fixed in MVP:

| Requirement           | MVP Behavior                                                   |
| --------------------- | -------------------------------------------------------------- |
| `is-admin`            | Check current user; if not admin and step not skippable → FAIL |
| `has-role:X`          | Check current user role; if mismatch and not skippable → FAIL  |
| `has-permission:X`    | Check permission; if missing and not skippable → FAIL          |
| `has-datasource:X`    | Check exists; if missing and not skippable → FAIL              |
| `has-plugin:X`        | Check installed; if missing and not skippable → FAIL           |
| `section-completed:X` | Check DOM for completion; if not met and not skippable → FAIL  |

### Future Enhancements (Post-MVP)

- Auto-provisioning data sources for `has-datasource` requirements
- Plugin installation for `has-plugin` requirements
- Multiple user contexts for permission testing
- Pre-flight setup scripts for complex requirements

## Output Format

### Error Classification

**Document & Test Assumption**: We assume failures can be automatically classified into actionable categories. This assumption needs validation.

**MVP approach**:

| Code                 | Classification   | Notes                                        |
| -------------------- | ---------------- | -------------------------------------------- |
| `SELECTOR_NOT_FOUND` | `unknown`        | Could be content-drift OR product-regression |
| `ACTION_FAILED`      | `unknown`        | Needs human triage                           |
| `REQUIREMENT_FAILED` | `unknown`        | Could be content-drift OR missing setup      |
| `TIMEOUT`            | `infrastructure` | Likely environmental                         |
| `NETWORK_ERROR`      | `infrastructure` | Definitely environmental                     |
| `AUTH_EXPIRED`       | `infrastructure` | Definitely environmental                     |

**Key insight**: Only `infrastructure` failures can be reliably auto-classified. For `SELECTOR_NOT_FOUND`, `ACTION_FAILED`, and `REQUIREMENT_FAILED`, **default to `unknown` and require human triage**.

**Validation plan**:

1. Run E2E tests for 4 weeks, collecting all failures
2. Have humans manually classify each failure
3. Compare human classification to what a heuristic would have produced
4. If heuristic accuracy > 80%, consider auto-routing
5. If < 80%, keep human triage and use classification only as a hint

**Decide Later**: Auto-routing failures to teams. Start with all non-infrastructure failures going to a single triage queue.

### Artifact Collection on Failure

When a step fails, the CLI captures diagnostic artifacts for debugging:

| Artifact     | Format | Contents                                 |
| ------------ | ------ | ---------------------------------------- |
| Screenshot   | PNG    | Visual state at failure                  |
| DOM snapshot | HTML   | Element structure for selector debugging |
| Console log  | JSON   | JavaScript errors since last step        |
| Network log  | HAR    | API failures (optional, with `--trace`)  |

Artifacts are written to `./artifacts/` by default (configurable via `--output`).

## Key Types

```typescript
// Step discovered from the rendered DOM
interface TestableStep {
  stepId: string;
  index: number;
  sectionId?: string;
  skippable: boolean;
}

// Result of testing a single step
interface StepTestResult {
  stepId: string;
  status: 'passed' | 'failed' | 'skipped' | 'not_reached';
  duration: number;
  currentUrl: string;
  consoleErrors: string[];
  error?: string;
  skipReason?: string;
  classification?: ErrorClassification;
  artifacts?: ArtifactPaths;
}

// Error classification for routing failures
type ErrorClassification =
  | 'content-drift' // Selector/requirement issues → Content team
  | 'product-regression' // Action failures → Product team
  | 'flaky-or-infra' // Timeouts → Platform team
  | 'infrastructure' // Network/auth issues → Platform team
  | 'unknown';

// Paths to captured failure artifacts
interface ArtifactPaths {
  screenshot?: string;
  dom?: string;
  console?: string;
  network?: string;
}

// Pre-flight check result
interface PreFlightResult {
  success: boolean;
  checks: PreFlightCheck[];
  abortReason?: string;
}

interface PreFlightCheck {
  name: 'grafana-reachable' | 'auth-valid' | 'plugin-installed';
  passed: boolean;
  error?: string;
}

// CLI options
interface E2ECommandOptions {
  grafanaUrl: string;
  output?: string;
  verbose: boolean;
  bundled: boolean;
  trace: boolean;
}
```

**Note**: Multistep blocks are treated as atomic units. The test runner clicks "Do it" once and waits for the entire multistep to complete. Internal sub-steps are not tracked individually in the MVP.

## Environment Variables

| Variable          | Description                    | Default                 |
| ----------------- | ------------------------------ | ----------------------- |
| `GUIDE_JSON_PATH` | Path to JSON guide file        | Required                |
| `GRAFANA_URL`     | Grafana instance URL           | `http://localhost:3000` |
| `E2E_OUTPUT_PATH` | Path for JSON report           | `./e2e-results.json`    |
| `E2E_VERBOSE`     | Enable verbose logging         | `false`                 |
| `E2E_TRACE`       | Generate Playwright trace file | `false`                 |

## Design Decisions (Resolved)

| Question               | Decision                           | Rationale                                                       |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Step discovery         | DOM-based iteration                | Tests actual rendered UI, handles conditionals automatically    |
| Show me vs Do it       | Skip "Show me", only click "Do it" | Faster, still validates execution                               |
| Multistep handling     | Single unit (pass/fail)            | Matches user experience; expand later                           |
| Screenshots            | On failure only (MVP)              | Captures diagnostic state without storage overhead              |
| Test generation        | Dynamic (no static files)          | Cleaner, always current                                         |
| Parallel vs sequential | Sequential only                    | Matches real user flow                                          |
| Auth handling          | Modular, MVP uses existing         | Allows future swapping                                          |
| Console error capture  | `console.error()` only             | Focused signal, less noise                                      |
| Conditional branches   | Let plugin handle                  | Runner just iterates whatever is rendered                       |
| Completion detection   | DOM polling only (MVP)             | Simpler; events deferred until polling proves inadequate        |
| Error classification   | Hints only (MVP)                   | Only `infrastructure` auto-classified; others need human triage |
| Pre-flight checks      | Required before test run           | Fail fast with clear messages before wasting time               |

## Risks and Dependencies

### Technical Risks

| Risk                     | Mitigation                                   |
| ------------------------ | -------------------------------------------- |
| Selector fragility       | Test against known-good bundled guides first |
| Timing flakiness         | Use completion detection over fixed waits    |
| localStorage quota       | Clear E2E_TEST_GUIDE after test completion   |
| Playwright version drift | Pin version in package.json                  |

### Dependencies

| Dependency            | Used For             | Notes                          |
| --------------------- | -------------------- | ------------------------------ |
| `@playwright/test`    | Test execution       | Already in devDependencies     |
| `@grafana/plugin-e2e` | Authentication       | Already in devDependencies     |
| `commander`           | CLI parsing          | Already in devDependencies     |
| Test IDs stability    | Selector reliability | Existing `testIds.ts` patterns |

### Assumptions

> **L3 Phase 1 Verification Complete** (2026-02-01): Core assumptions verified through code analysis. See "Verified Assumptions" section below for detailed results.

**Operational Assumptions** (still valid):

1. **Dev mode enabled**: E2E tests run against a Grafana instance with dev mode enabled
2. **Admin auth available**: MVP assumes admin user authentication
3. **Network stability**: Tests run against localhost (no network latency)
4. **Clean state**: Each test run starts with fresh guide state (no prior completion)
5. **No pre-existing artifacts**: MVP assumes the Grafana instance has no required pre-existing state (dashboards, data sources, etc.)
6. **DOM order matches logical order**: Steps within a section appear in document order (top to bottom) matching the intended execution sequence
7. **Conditional branches handled by plugin**: The plugin evaluates conditional logic based on app state; the test runner only sees the rendered result

**Corrected Assumptions** (from L3 Phase 1 verification):

1. ✅ **localStorage is reliable**: Robust handling with QuotaExceededError, fallbacks, and bidirectional sync with Grafana storage (U8 verified)
2. ✅ **LazyRender steps exist and are testable**: Default disabled, but `executeWithLazyScroll()` handles scroll discovery when enabled (U9 verified)
3. ⚠️ **Not all steps have "Do it" buttons**: Steps can have `doIt: false` or be `noop` actions that auto-complete (U1 falsified)
4. ⚠️ **Steps may not be clickable when discovered**: `isEligibleForChecking` enforces sequential dependencies; buttons can be disabled (U3 falsified)
5. ⚠️ **Steps can pre-complete**: Objectives-based completion or `completeEarly: true` means steps may finish before/without clicking (U2 partial)
6. ⚠️ **Fix buttons can fail**: Navigation fixes, network issues, or unfixable requirements require timeout and retry logic (U4 falsified)
7. ⚠️ **SequentialRequirementsManager is intentional**: Manager coordinates state propagation across steps - work with it, not against it (U7 falsified but correct behavior)

### Verified Assumptions (L3 Phase 1 Complete) ✅

> **L3 Phase 1 Completion**: All assumptions have been verified through code analysis (2026-02-01). See [L3-phase1-verification-results.md](./L3-phase1-verification-results.md) for detailed findings.

| #   | Assumption                                           | Verification Result                                                                              | Design Impact                                               | Status                              |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------- |
| U1  | **All steps have "Do it" buttons**                   | ❌ **FALSE** - Steps can have `doIt: false`; `noop` steps auto-complete                          | **HIGH** - Must check button existence before clicking      | Required changes in Milestone L3-3A |
| U2  | **Completion indicator appears after "Do it" click** | ⚠️ **PARTIAL** - Steps with `completeEarly: true` or objectives complete before/without clicking | **MEDIUM** - Check for pre-completion before clicking       | Required changes in Milestone L3-3B |
| U3  | **Steps are always clickable when discovered**       | ❌ **FALSE** - `isEligibleForChecking` controls sequential access; buttons may be disabled       | **HIGH** - Must wait for `.toBeEnabled()` not just visible  | Required changes in Milestone L3-3B |
| U4  | **Fix buttons always succeed**                       | ❌ **FALSE** - Navigation/network failures possible; some requirements unfixable                 | **MEDIUM** - Add timeout and max retry logic                | Required changes in Milestone L3-4B |
| U5  | **Console.error() indicates real problems**          | ⚠️ **PARTIAL** - Grafana likely logs warnings/deprecations (needs empirical test)                | **LOW** - Filter known false positives                      | Optional polish                     |
| U6  | **Single DOM pass discovers all steps**              | ⚠️ **LIKELY TRUE** - All steps render on mount, but conditional rendering possible               | **MEDIUM** - Re-check after major state changes defensively | Optional for MVP                    |
| U7  | **SequentialRequirementsManager doesn't interfere**  | ❌ **FALSE** (but intentional) - Manager actively coordinates state across steps                 | **LOW** - Work with manager, not against it                 | No changes needed                   |
| U8  | **localStorage is available and reliable**           | ✅ **TRUE** - Robust handling with QuotaExceededError, fallbacks, sync                           | **LOW** - No additional handling needed                     | ✅ Verified                         |
| U9  | **LazyRender steps are rare/testable**               | ✅ **TRUE** - Default `false`, `executeWithLazyScroll()` handles scroll discovery                | **LOW** - Use longer timeouts for lazy steps                | ✅ Verified                         |
| U10 | **Steps complete within 30 seconds**                 | ⚠️ **UNKNOWN** - Requires empirical testing with framework guide                                 | **MEDIUM** - Use 30s default, adjust based on data          | Testing needed in Milestone L3-3C   |

**Summary**: 2 verified true, 4 partially true (require adjustments), 4 falsified (require design changes). **No architectural blockers** - all findings improve design quality.

**Key Design Changes Required**:

1. **Step Discovery** (Milestone L3-3A): Add `hasDoItButton` and `isPreCompleted` fields to `TestableStep` interface
2. **Step Execution** (Milestone L3-3B): Handle pre-completed steps, wait for buttons to be enabled (not just visible)
3. **Fix Handling** (Milestone L3-4B): Add timeout (10s) and max attempts (3) for fix operations
4. **Timing** (Milestone L3-3C): Start with 30s timeout, collect empirical data, adjust per-step-type if needed

## Implementation Complexity Analysis

### Hardest Parts (Ordered by Difficulty)

#### 1. Timing and Completion Detection (High Complexity)

The plugin has a sophisticated reactive system that the E2E runner must work with, not against:

**Challenges:**

- **EchoSrv context subscriptions**: Steps subscribe to context changes and auto-recheck requirements when navigation occurs
- **SequentialRequirementsManager**: Singleton manager coordinates step eligibility across sections; triggers `triggerReactiveCheck()` on completion
- **Multiple completion paths**: Steps can complete via:
  - Manual "Do it" click → `completionReason: 'manual'`
  - Objective auto-detection → `completionReason: 'objectives'`
  - Skip action → `completionReason: 'skipped'`
  - `completeEarly: true` flag → completes before action finishes
- **Debounced rechecks**: The manager debounces context changes (500ms) and DOM mutations (1200ms)

**Why it's hard**: The 30-second timeout assumes we're waiting for one thing (completion indicator). But the reactive system can trigger intermediate state changes that reset timers or change step status mid-execution.

**Mitigation strategy**:

- Wait for step element to have `.completed` class OR completion indicator visible
- Add small delay after "Do it" click before checking completion (let reactive system settle)
- Consider disabling DOM monitoring during E2E runs (environment variable?)

#### 2. LazyRender Steps (High Complexity)

Steps targeting elements in virtualized containers (like long panel lists) use `lazyRender: true`:

**How it works in the plugin:**

1. Step checks `exists-reftarget` requirement
2. Element not found → returns `{ canFix: true, fixType: 'lazy-scroll' }`
3. User clicks "Do it" → plugin scrolls the container to discover element
4. Scroll triggers DOM changes → requirement rechecks → element found → action executes

**Why it's hard**: The design assumes clicking "Do it" is a simple action. For lazyRender steps, "Do it" triggers a complex scroll-discovery flow that can take multiple seconds and may fail if the element doesn't exist.

**Design impact**: The E2E runner needs to:

- Detect lazyRender steps (check `data-lazyrender` attribute)
- Allow longer timeouts for scroll discovery
- Handle case where element is never discovered (legitimate test failure)

#### 3. Section Sequential Dependencies (Medium Complexity)

Steps within a section have sequential dependencies enforced by `InteractiveSection`:

**How it works:**

- Section maintains `completedSteps` Set
- Each step receives `isEligibleForChecking` prop
- First step: always eligible
- Subsequent steps: eligible only when previous steps completed
- `useStepChecker` won't enable a step until eligible

**Why it's hard**: If the E2E runner discovers steps and immediately tries to click "Do it" on step 2, the button may be disabled because step 1 isn't complete yet.

**Mitigation strategy**:

- Execute steps strictly in DOM order (already planned)
- Wait for "Do it" button to be enabled, not just visible
- The existing `handleFixMeButtons()` pattern already waits for enabled state

#### 4. Fix Button Reliability (Medium Complexity)

Fix buttons trigger different actions based on `fixType`:

| fixType                    | Action                           | Can Fail?                       |
| -------------------------- | -------------------------------- | ------------------------------- |
| `navigation`               | Click mega-menu, expand sections | Network timeout, menu not found |
| `location`                 | Navigate to path                 | Page 404, redirect loops        |
| `expand-parent-navigation` | Expand collapsed nav section     | Section not found               |
| `lazy-scroll`              | Scroll container to discover     | Element doesn't exist           |

**Why it's hard**: The design assumes fix buttons are reliable. In practice, navigation fixes involve network calls and DOM manipulation that can timeout or fail.

**Mitigation strategy**:

- Limit fix attempts to 3 (reduced from design's original 10 for faster failure)
- Add timeout for individual fix operations
- Log fix failures as warnings, not test failures (if step is skippable)

#### 5. Objectives vs Requirements (Low-Medium Complexity)

Steps can auto-complete without user action if objectives are met:

```typescript
// From step-checker.hook.ts
const isCompletedWithObjectives =
  parentCompleted ||
  isLocallyCompleted ||
  checker.completionReason === 'objectives' ||
  checker.completionReason === 'skipped';
```

**Why it matters**: A step might be completed before the E2E runner tries to click "Do it". The button won't exist.

**Mitigation strategy**:

- Before clicking "Do it", check if completion indicator already visible
- If already complete, log as "pre-completed" and move to next step
- This is a success case, not a failure

### Lower Complexity Items (Addressed by Design)

- **Scrolling steps into view**: `scrollIntoViewIfNeeded()` is reliable for the docs panel
- **Wait for Grafana ready**: Existing `waitForGrafanaReady()` pattern handles initial load
- **Test ID stability**: Centralized in `testIds.ts`, unlikely to change without notice
- **JSON injection via localStorage**: Well-established pattern from WYSIWYG preview

## Resolved Questions

The following questions were identified during design and have been resolved:

| Question                                              | Resolution                         | Rationale                            |
| ----------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| Disable SequentialRequirementsManager DOM monitoring? | No                                 | It's part of what we're testing      |
| Pre-completed steps reporting?                        | `passed` with note                 | Guide is functioning correctly       |
| LazyRender retry with scroll?                         | Trust plugin handling, wait longer | Plugin handles transparently         |
| Max multistep timeout?                                | 30s base + 5s per action           | Start generous, tune with data       |
| Verify guide completed all sections?                  | Post-MVP                           | Focus on step-level validation first |

## Open Questions (Resolved)

| Question               | Decision                    | Rationale                                                                                 |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| Retry logic            | No retries for failed steps | Failed steps indicate guide/selector issues, not flakiness. Retrying masks real problems. |
| Trace files            | Yes, provide `--trace` flag | Traces are essential for debugging complex multi-step failures. Include in MVP.           |
| Parallel guide testing | No parallel execution       | Sequential is simpler, more predictable, and matches user experience. Not needed.         |

## Future Enhancements (Post-MVP)

### Near-term (After MVP)

- **Screenshot on failure**: Capture screenshots when steps fail for debugging (requires storage directory planning)
- **Multistep sub-step reporting**: Break down multistep results in JSON output
- **Verbose mode**: Detailed logging with `--verbose` flag
- **Reachability mode**: Fast selector-only validation without executing actions

### Medium-term

- **Guide artifact metadata**: Guides express what artifacts they require (dashboards, data sources, plugins) so the runner can select appropriate test instances
- **Parallel guide testing**: Run `--bundled` tests concurrently
- **Multiple user contexts**: Test with admin, editor, viewer roles
- **Pre-flight setup scripts**: Provision data sources, install plugins before test
- **CI integration**: GitHub Actions workflow template

#### CI test policies

| Trigger           | What Runs                  | Blocks Merge?           |
| ----------------- | -------------------------- | ----------------------- |
| PR to `main`      | Framework test guide only  | No (warn only)          |
| Merge to `main`   | All bundled guides         | No (alert on failure)   |
| Nightly           | Full guide suite           | No (dashboard tracking) |
| Release candidate | Full suite + manual review | Yes                     |

### Long-term

- **Visual regression testing**: Compare screenshots across runs
- **Performance benchmarking**: Track step timing trends over time
- **Custom assertions**: User-defined validation scripts per step
- **Watch mode**: Re-run tests on JSON file changes
- **Test instance routing**: Automatically route guides to appropriate Grafana instances based on artifact requirements

## Resolved Decisions

This section consolidates key decisions made during design and implementation phases. These decisions are authoritative and should not be duplicated in other documents.

| Decision                | Value                                 | Rationale                                            |
| ----------------------- | ------------------------------------- | ---------------------------------------------------- |
| Max fix attempts        | 3                                     | Fail fast in E2E tests; 10 was too slow              |
| Console error filtering | Hardcoded in runner                   | Known patterns (deprecations, DevTools) filtered out |
| Auth strategies         | Cloud SSO/Okta, username/password     | MVP uses existing @grafana/plugin-e2e auth           |
| Artifact storage        | Local files, GitHub Actions artifacts | Screenshots and DOM snapshots on failure             |
| Version matrix          | Deferred                              | Guides may express compatibility metadata later      |

## Framework Test Guide

A special guide validates the E2E framework itself. This guide should **always pass** when the framework is working correctly — failures indicate framework bugs, not guide bugs.

### Purpose

- Exercises core interaction types the framework supports
- Has no side effects (read-only operations only)
- Has predictable, deterministic outcomes
- Completes quickly (under 60 seconds)
- Works on a fresh Grafana instance with defaults

### Location

`src/bundled-interactives/e2e-framework-test.json`

### MVP Scope

**Decide Later**: The exact sections and timing expectations will be determined empirically after running the E2E framework against 3-5 real bundled guides.

**MVP scope**:

- Create a minimal guide with 3-4 steps covering: highlight, button click, navigation
- No timing assertions initially - collect timing data, analyze distribution, then set thresholds
- No failure interpretation table - build this from actual failure patterns observed

**Expansion criteria**: Expand the framework test guide when:

1. MVP passes reliably for 2 weeks
2. We have timing data from 100+ test runs
3. We've observed 3+ distinct failure patterns that need coverage

## Package-Aware Testing

The sections above describe the core E2E runner: loading a `content.json` from disk or bundled guides and testing it against a single Grafana instance. This section extends the runner to be **package-aware** — it can resolve packages from a remote repository, read manifest metadata to determine the correct test target, authenticate against that target, and run the same Playwright-based guide execution.

This extension can be framed as either "Layer 3 becomes package-aware" or as a new Layer 4 in the [testing strategy](./TESTING_STRATEGY.md) pyramid. If framed as Layer 4, the current "Live Environment Validation" vision (nightly runs, managed environment pools, observability dashboards) would become Layer 5.

### Design goals

- **Package-first**: The CLI can test any package by bare ID, resolving content and metadata from the repository ecosystem.
- **Manifest-driven routing**: The guide's `manifest.json` declares where it should be tested via `testEnvironment`. The CLI obeys the manifest.
- **Ephemeral auth isolation**: Each guide test authenticates independently with its own session state. No session reuse across guides.
- **Path and journey expansion**: Paths and journeys are first-class test inputs. Testing a path means sequentially testing its milestone guides.
- **Graceful degradation**: Guides that cannot be tested (no auth, content fetch failure) are logged and skipped without failing the batch.

### Package resolution

The CLI supports two resolution modes depending on the input:

| Input            | Resolution strategy                                                     | Source                                              |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `--package <id>` | **Resolution service** — `GET /api/v1/packages/{id}` on the recommender | `https://recommender.grafana.com`                   |
| `--repository`   | **Repository index** — fetch `repository.json` from CDN                 | `https://interactive-learning.grafana.net/packages` |

#### Resolution service (`--package`)

The [grafana-recommender](https://github.com/grafana/grafana-recommender) exposes a package resolution endpoint (`GET /api/v1/packages/{id}`) that resolves a bare package ID to CDN URLs for `content.json` and `manifest.json`. The CLI uses this as the primary resolution mechanism for `--package` mode.

Flow for `--package <id>`:

```
GET {resolverUrl}/api/v1/packages/{id}
  → { id, contentUrl, manifestUrl, repository }
    │
    ▼
Fetch manifestUrl → parse manifest.json
  → { type, testEnvironment, milestones?, ... }
    │
    ├── type: "guide" → fetch contentUrl, determine target, run test
    │
    └── type: "path" or "journey" → read milestones[], resolve each
        → if ANY milestone returns 404 → FAIL the entire path
        → each resolved guide is tested sequentially (see below)
```

On resolution service 404: the guide is reported as `resolution_failed` and skipped.

#### Repository index (`--repository`)

For batch testing, the CLI fetches the full `repository.json` from the CDN. This index contains denormalized manifest metadata for every package, including `testEnvironment`, `type`, and `milestones`. No individual manifest fetches are needed — the index has everything.

Flow for `--repository`:

```
GET {repoUrl}/repository.json
  → { [id]: { path, type, testEnvironment, milestones?, ... } }
    │
    ▼
Filter by --tier (if provided)
Expand paths/journeys via milestones (all in the same index)
  → if a milestone ID is missing from the index → FAIL that path
Deduplicate guides
    │
    ▼
For each guide: construct contentUrl as {repoUrl}/{entry.path}content.json
  → fetch, validate, determine target, run test
```

The repository index is fetched fresh on every invocation (it is served from CDN). No local caching.

### Path and journey expansion

Paths (`type: "path"`) and journeys (`type: "journey"`) are treated uniformly: they are packages whose `milestones` array names other packages. Testing a path or journey means testing its constituent guides.

**Sequential milestone execution**: Milestones within a path are tested in order. If milestone N fails, milestones N+1 through the end are **not tested** — they are marked `not_reached`. This is because later milestones may depend on earlier milestones having been executed. A single milestone failure fails the entire path.

**Recursive expansion**: If a journey's milestone is itself a path, that path is expanded to its own milestones. Expansion is recursive until only `type: "guide"` packages remain.

**Missing milestones**: If any milestone ID cannot be resolved (404 from the resolution service, or absent from the repository index), the entire path is reported as `path_incomplete`. No milestone guides are tested.

**Deduplication**: In `--repository` mode, a guide that appears as a milestone in multiple paths is tested once. Its result is shared across all paths that reference it.

Example: `--package prometheus-lj` where the path has `milestones: ["guide-a", "guide-b", "guide-c"]`:

1. Resolve `prometheus-lj` → manifest says `type: "path"`, `milestones: ["guide-a", "guide-b", "guide-c"]`
2. Resolve each milestone via the resolution service
3. If all resolve: test `guide-a`, then `guide-b`, then `guide-c` sequentially
4. If `guide-b` fails: `guide-c` is marked `not_reached`, the path fails
5. If `guide-b` returns 404: the path is `path_incomplete`, nothing is tested

### Test target resolution

Each guide declares where it should be tested via `testEnvironment` in its manifest. The CLI resolves this to a concrete Grafana URL and credentials.

#### Resolution rules

| `testEnvironment`                                               | Resolved target                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tier: "local"` (or absent)                                     | `--grafana-server` value (default: `http://localhost:3000`). Uses `admin`/`admin` credentials via `@grafana/plugin-e2e`.             |
| `tier: "cloud"`, no `instance`                                  | `--cloud-url` value (default: `https://learn.grafana.net/`). Uses `--user`/`--password` credentials.                                 |
| `tier: "cloud"`, `instance` matches `--cloud-url` hostname      | Same as above.                                                                                                                       |
| `tier: "cloud"`, `instance` differs from `--cloud-url` hostname | Target is `https://{instance}/`. Uses `--user`/`--password` credentials. If auth fails at preflight, the guide reports auth failure. |
| `tier: "cloud"`, no credentials provided                        | Guide is skipped with `skipped_no_auth`.                                                                                             |

#### CLI target override vs manifest conflict

The manifest's `testEnvironment` is authoritative. If the user provides a CLI target (e.g., `--grafana-server http://localhost:3000`) but the guide's manifest says `tier: "cloud"`, the guide is **skipped** — not tested against the wrong environment. The CLI logs a message explaining the mismatch.

This design anticipates a future pool executor that distributes guides to environment-specific testers. The CLI is a single-environment tool; it tests what it can and skips what it cannot.

### Authentication

#### Credentials

Credentials are resolved in priority order (highest wins):

1. `--user` / `--password` CLI flags
2. `GRAFANA_USER` / `GRAFANA_PASSWORD` environment variables
3. No credentials available → cloud guides are skipped with `skipped_no_auth`

For `tier: "local"`, the existing `@grafana/plugin-e2e` authentication is used, which defaults to `admin`/`admin` via the `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` environment variables.

#### Ephemeral auth isolation

Each guide test gets its own auth state. No session reuse between guides.

1. Create a temp directory: `/tmp/pathfinder-e2e-{uuid}/`
2. Playwright auth project logs in → writes cookies to `{tempDir}/auth.json`
3. Test project loads auth state from that file
4. After the test completes → entire temp directory is deleted

This means testing 10 guides against the same instance authenticates 10 times. This is intentional — repeatability and isolation over performance. Each test is fully independent, with no state leaking between guides.

The Playwright config reads the auth state path from an environment variable:

```typescript
storageState: process.env.AUTH_STATE_FILE
  ? process.env.AUTH_STATE_FILE
  : join(projectRoot, 'playwright/.auth/admin.json'),
```

The CLI passes per-guide values via environment variables to the spawned Playwright process:

```typescript
env: {
  ...process.env,
  GRAFANA_URL: target.grafanaUrl,
  GRAFANA_ADMIN_USER: target.username ?? 'admin',
  GRAFANA_ADMIN_PASSWORD: target.password ?? 'admin',
  AUTH_STATE_FILE: tempAuthFile,
  GUIDE_JSON_PATH: guidePath,
  // ... existing env vars
},
```

### CLI interface (extended)

Existing options are unchanged. New options are additive:

```bash
# ── Existing (unchanged) ──
npx pathfinder-cli e2e ./guide.json
npx pathfinder-cli e2e --bundled
npx pathfinder-cli e2e bundled:e2e-framework-test

# ── New: package-aware ──
npx pathfinder-cli e2e --package alerting-101
npx pathfinder-cli e2e --package prometheus-lj          # path → expands milestones
npx pathfinder-cli e2e --repository                     # all packages from repo
npx pathfinder-cli e2e --repository --tier local        # filter by tier
npx pathfinder-cli e2e --repository --tier cloud        # filter by tier

# ── New: cloud auth and target options ──
npx pathfinder-cli e2e --package alerting-101 \
  --user myuser --password mypass

npx pathfinder-cli e2e --repository --tier cloud \
  --user myuser --password mypass \
  --cloud-url https://learn.grafana.net/
```

#### New CLI options

| Option                   | Type    | Default                                             | Env var fallback   | Description                                                          |
| ------------------------ | ------- | --------------------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `--package <id>`         | string  | —                                                   | —                  | Resolve and test a package by bare ID (guide, path, or journey)      |
| `--repository`           | boolean | false                                               | —                  | Fetch full repository index and test all packages                    |
| `--tier <tier>`          | string  | —                                                   | —                  | Filter packages by `testEnvironment.tier` (used with `--repository`) |
| `--grafana-server <url>` | string  | `http://localhost:3000`                             | `GRAFANA_SERVER`   | Grafana URL for `tier: "local"` guides                               |
| `--user <user>`          | string  | —                                                   | `GRAFANA_USER`     | Username for cloud instance authentication                           |
| `--password <pw>`        | string  | —                                                   | `GRAFANA_PASSWORD` | Password for cloud instance authentication                           |
| `--cloud-url <url>`      | string  | `https://learn.grafana.net/`                        | —                  | Default cloud instance URL (for `tier: "cloud"` with no `instance`)  |
| `--resolver-url <url>`   | string  | `https://recommender.grafana.com`                   | —                  | Package resolution service URL                                       |
| `--repo-url <url>`       | string  | `https://interactive-learning.grafana.net/packages` | —                  | Repository CDN base URL (for `--repository` mode)                    |

**Note on `--grafana-server`**: This replaces the original `--grafana-url` name for consistency. The old `--grafana-url` name should be kept as an alias for backwards compatibility.

#### Ignored manifest fields

The E2E runner ignores the following manifest fields. They exist for other consumers (recommender, learning path engine) but are not relevant to test execution:

- `startingLocation` — the runner does not navigate to a starting page before testing
- `depends` — every guide is tested standalone, pass/fail, with no dependency chains
- `targeting` — recommendation rules are irrelevant to test execution
- `provides`, `conflicts`, `replaces` — dependency graph metadata, not test metadata

### Guide outcome taxonomy

A guide in a batch run can end in one of these states:

| Outcome                 | Meaning                                                      | Counts as test failure? |
| ----------------------- | ------------------------------------------------------------ | ----------------------- |
| `passed`                | All mandatory steps passed                                   | No                      |
| `failed`                | One or more mandatory steps failed                           | **Yes**                 |
| `skipped_no_auth`       | No credentials available for the target instance             | No (logged)             |
| `skipped_tier_mismatch` | Guide requires a tier/instance the CLI is not configured for | No (logged)             |
| `fetch_failed`          | Could not fetch `content.json` from CDN                      | No (logged)             |
| `resolution_failed`     | Resolution service returned 404 or network error             | No (logged)             |
| `validation_failed`     | Fetched `content.json` failed schema validation              | **Yes**                 |
| `path_incomplete`       | Path or journey has unresolvable milestones                  | **Yes**                 |

The CLI exit code is `1` (TEST_FAILURE) if any guide has a "counts as test failure" outcome. Exit `0` only when all guides either passed or were skipped/unfetchable.

### Architecture (extended)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLI Entry Point (extended)                      │
│                    src/cli/commands/e2e.ts                           │
├─────────────────────────────────────────────────────────────────────┤
│  Existing: file paths, --bundled, bundled:name                       │
│  NEW: --package, --repository, --tier, --user, --password            │
│  NEW: resolvePackages() → fetches manifest, resolves to guide list   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Package Resolver    │  NEW
                    │  (e2e-package.ts)    │
                    ├─────────────────────┤
                    │  --package mode:     │
                    │    Call resolution   │
                    │    service, fetch    │
                    │    manifest          │
                    │  --repository mode:  │
                    │    Fetch repo index  │
                    │  Both:              │
                    │    Expand paths/     │
                    │    journeys          │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Target Resolver     │  NEW
                    │  (e2e-targets.ts)    │
                    ├─────────────────────┤
                    │  testEnvironment →   │
                    │  { grafanaUrl,       │
                    │    user, password,   │
                    │    skipReason? }     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Existing Runner     │  UNCHANGED
                    │  guide-runner.spec   │
                    │  + Playwright config │
                    │  (ephemeral auth)    │
                    └─────────────────────┘
```

### File structure (new files)

```
src/cli/
├── commands/
│   └── e2e.ts               # Extended: --package, --repository, --tier
└── utils/
    ├── e2e-package.ts        # NEW: package resolver (resolution service + repo index)
    ├── e2e-targets.ts        # NEW: target resolver (testEnvironment → Grafana URL)
    ├── e2e-reporter.ts       # Extended: package metadata in reports
    └── file-loader.ts        # Existing (unchanged)
```

### Execution flow

#### Single package (`--package alerting-101`)

```
1. Resolve via resolution service
   GET https://recommender.grafana.com/api/v1/packages/alerting-101
   → { contentUrl, manifestUrl }

2. Fetch manifest
   GET {manifestUrl}
   → { type: "guide", testEnvironment: { tier: "cloud" } }

3. Resolve target
   tier: "cloud", no instance → https://learn.grafana.net/
   credentials: --user/--password or GRAFANA_USER/GRAFANA_PASSWORD

4. Fetch content
   GET {contentUrl}
   → raw content.json string

5. Validate content (schema check)

6. Create ephemeral auth state (temp dir + auth file)

7. Spawn Playwright with:
   GRAFANA_URL=https://learn.grafana.net/
   GRAFANA_ADMIN_USER={user}
   GRAFANA_ADMIN_PASSWORD={password}
   AUTH_STATE_FILE={tempDir}/auth.json
   GUIDE_JSON_PATH={tempDir}/guide.json

8. Playwright authenticates, injects guide, runs steps

9. Collect results, clean up temp dir

10. Report outcome
```

#### Path (`--package prometheus-lj`)

```
1. Resolve prometheus-lj via resolution service
   → { contentUrl, manifestUrl }

2. Fetch manifest
   → { type: "path", milestones: ["guide-a", "guide-b", "guide-c"] }

3. Resolve each milestone via resolution service
   → guide-a: { contentUrl, manifestUrl }
   → guide-b: { contentUrl, manifestUrl }
   → guide-c: 404 → FAIL path as path_incomplete, stop

   OR if all resolve:

4. Fetch each milestone's manifest (for testEnvironment)
5. Test guide-a (full flow: target, auth, Playwright)
   → passed
6. Test guide-b
   → failed → mark guide-c as not_reached, path fails
```

#### Repository batch (`--repository --tier cloud`)

```
1. Fetch repository.json
   GET https://interactive-learning.grafana.net/packages/repository.json

2. Filter: keep entries where testEnvironment.tier === "cloud"
   Expand paths/journeys to constituent guides
   Deduplicate

3. For each guide:
   Construct contentUrl from {repoUrl}/{entry.path}content.json
   testEnvironment is in the index entry (no manifest fetch needed)
   Resolve target, run test (same as single package flow)

4. Aggregate results across all guides
```

### Console output (package mode)

#### Single package

```
╔══════════════════════════════════════════════════════════════════╗
║  E2E Package Test: alerting-101                                   ║
╚══════════════════════════════════════════════════════════════════╝

📦 Source: recommender.grafana.com
🎯 Target: learn.grafana.net (cloud)

  ✓ step-1                                                  [1.2s]
  ✓ step-2                                                  [0.8s]
  ✓ step-3                                                  [2.1s]

────────────────────────────────────────────────────────────────────
Summary: 3 passed, 0 failed, 0 skipped                    [4.1s]
────────────────────────────────────────────────────────────────────
```

#### Path with sequential milestones

```
╔══════════════════════════════════════════════════════════════════╗
║  E2E Package Test: prometheus-lj (path, 3 milestones)            ║
╚══════════════════════════════════════════════════════════════════╝

📦 Milestone 1/3: guide-a
🎯 Target: learn.grafana.net (cloud)
  ✓ step-1                                                  [1.0s]
  ✓ step-2                                                  [0.9s]
  ✅ guide-a passed                                          [1.9s]

📦 Milestone 2/3: guide-b
🎯 Target: learn.grafana.net (cloud)
  ✓ step-1                                                  [1.1s]
  ✗ step-2 - FAILED                                         [5.2s]
  ○ step-3 - NOT_REACHED
  ❌ guide-b failed                                          [6.3s]

📦 Milestone 3/3: guide-c
  ○ NOT_REACHED (previous milestone failed)

────────────────────────────────────────────────────────────────────
Path: prometheus-lj — FAILED (milestone 2/3 failed)
  ✅ guide-a: passed
  ❌ guide-b: failed
  ○  guide-c: not reached
────────────────────────────────────────────────────────────────────
```

#### Repository batch

```
╔══════════════════════════════════════════════════════════════════╗
║  E2E Repository Test: 15 packages (12 guides, 3 paths)           ║
╚══════════════════════════════════════════════════════════════════╝

📦 Repository: https://interactive-learning.grafana.net/packages
   Tier filter: cloud

🎯 learn.grafana.net:
  ✅ alerting-101                                           [4.2s]
  ✅ logql-101                                              [3.8s]
  ✅ connect-prometheus-metrics                             [5.1s]
  ⊘  sm-setting-up-your-first-check (skipped_no_auth)

🎯 play.grafana.org:
  ✅ k8s-cpu                                                [5.1s]
  ❌ k8s-mem                                                [timeout]
  ✅ tour-of-visualizations                                 [3.2s]

────────────────────────────────────────────────────────────────────
Summary: 10 passed, 1 failed, 1 skipped, 0 fetch errors   [42.3s]
────────────────────────────────────────────────────────────────────
```

### JSON report (extended)

The JSON report gains package metadata fields:

```json
{
  "guide": {
    "id": "alerting-101",
    "title": "Grafana Alerting 101",
    "path": "https://interactive-learning.grafana.net/packages/alerting-101/content.json",
    "packageId": "alerting-101",
    "sourcePackageId": "prometheus-lj",
    "tier": "cloud",
    "instance": null,
    "targetUrl": "https://learn.grafana.net/"
  },
  "config": {
    "grafanaUrl": "https://learn.grafana.net/",
    "timestamp": "2026-03-12T10:30:00.000Z"
  },
  "outcome": "passed",
  "summary": { "...": "..." },
  "steps": ["..."]
}
```

For multi-guide reports (batch or path), each guide entry includes these package fields. The `sourcePackageId` records which path or journey the guide was expanded from, if any.

### Environment variables (extended)

| Variable                 | Description                                                  | Default                 |
| ------------------------ | ------------------------------------------------------------ | ----------------------- |
| `GRAFANA_SERVER`         | Grafana URL for local testing (alias for `--grafana-server`) | `http://localhost:3000` |
| `GRAFANA_USER`           | Username for cloud auth (alias for `--user`)                 | —                       |
| `GRAFANA_PASSWORD`       | Password for cloud auth (alias for `--password`)             | —                       |
| `GRAFANA_URL`            | **Internal**: passed to Playwright process per-guide         | Set by CLI              |
| `GRAFANA_ADMIN_USER`     | **Internal**: passed to `@grafana/plugin-e2e` auth           | Set by CLI              |
| `GRAFANA_ADMIN_PASSWORD` | **Internal**: passed to `@grafana/plugin-e2e` auth           | Set by CLI              |
| `AUTH_STATE_FILE`        | **Internal**: ephemeral auth cookie file path                | Set by CLI              |
| `GUIDE_JSON_PATH`        | **Internal**: path to guide JSON temp file                   | Set by CLI              |

"Internal" variables are set by the CLI when spawning Playwright — they are not intended for direct user configuration.

### Design decisions (package-aware)

| Decision                        | Value                                                                   | Rationale                                                                             |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Resolution mechanism            | Recommender service for `--package`; repository.json for `--repository` | Resolution service is canonical for bare IDs; repository index is efficient for batch |
| Auth state                      | Ephemeral per-guide, deleted after test                                 | Repeatability and isolation over performance                                          |
| Path milestone execution        | Sequential, stop on failure                                             | Later milestones may depend on earlier ones                                           |
| Missing milestones              | Fail entire path                                                        | Incomplete paths cannot be meaningfully tested                                        |
| Content fetch failure           | Skip guide, log as `fetch_failed`                                       | Does not count as test failure; CDN issue, not content issue                          |
| Manifest authority              | Manifest `testEnvironment` is authoritative                             | Guides speak for themselves; CLI respects the manifest                                |
| CLI target vs manifest conflict | Skip guide with `skipped_tier_mismatch`                                 | Prevents testing a guide against an incompatible environment                          |
| Credential env vars             | `GRAFANA_USER` / `GRAFANA_PASSWORD`                                     | Standard practice for CI where secrets should not appear in command lines             |
| `startingLocation`              | Ignored by E2E runner                                                   | The plugin may use it at runtime; the runner tests wherever it lands                  |
| `depends` chains                | Ignored; every guide is standalone                                      | Simplicity; no topological ordering needed                                            |
| Repository caching              | None; always fetch fresh                                                | Repository index is on CDN; no benefit to local caching                               |

### Risks and dependencies (package-aware)

| Risk                              | Mitigation                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Resolution service unavailable    | Fail fast with clear error; `--repository` mode as fallback                       |
| Cloud instance auth incompatible  | Pre-flight check validates auth; guide reports auth failure, does not crash batch |
| CDN content stale or missing      | `fetch_failed` outcome; does not block other guides                               |
| Path with many milestones is slow | Sequential execution is intentional; future pool executor will parallelize        |
| Credentials in process env        | Standard Playwright pattern; env vars are not logged                              |

### Implementation milestones

| #   | Milestone                     | Delivers                                                                                                                                                   | Dependencies |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| P1  | **Resolution service client** | `e2e-package.ts`: call `GET /api/v1/packages/{id}`, parse response, handle 404/errors. Fetch `manifestUrl`, parse `testEnvironment`, `type`, `milestones`. | None         |
| P2  | **Target resolver**           | `e2e-targets.ts`: `(testEnvironment, cliOptions) → TestTarget`. Credential resolution with env var fallback. Tier mismatch detection.                      | P1           |
| P3  | **Ephemeral auth plumbing**   | Temp auth state file per guide, pass `AUTH_STATE_FILE` + credential env vars to Playwright, cleanup after test. Update Playwright config.                  | P2           |
| P4  | **`--package` CLI path**      | Wire up: resolve → fetch manifest → determine target → fetch content → validate → run test. Handle `type: "guide"` only.                                   | P1, P2, P3   |
| P5  | **Path/journey expansion**    | Recursive milestone resolution via service. Sequential execution with stop-on-failure. `path_incomplete` for missing milestones.                           | P4           |
| P6  | **`--repository` CLI path**   | Fetch `repository.json`, filter by `--tier`, expand paths/journeys from index, construct content URLs, batch execute.                                      | P4, P5       |
| P7  | **Reporting**                 | Extended `GuideMetadata` with package fields. New outcome types. Multi-target and path summary in console output.                                          | P4, P5, P6   |
| P8  | **CLI polish**                | `--grafana-server` alias for `--grafana-url`. Env var fallbacks (`GRAFANA_SERVER`, `GRAFANA_USER`, `GRAFANA_PASSWORD`). Help text updates.                 | P4           |

### Future: pool executor (deferred)

The CLI as designed is a **single-environment tool** — it runs guides that match its configured target and skips the rest. A future pool executor will:

1. Read all packages from the repository
2. Group guides by `testEnvironment` requirements
3. Dispatch guides to environment-specific test runners (each running this CLI)
4. Aggregate results across all environments
5. Feed results into the Enablement Observability Dashboard

This is explicitly deferred. The CLI's tier-mismatch skip behavior is designed to compose cleanly with a future pool executor that invokes the CLI per-environment.

## Related Documentation

- [E2E Testing Reference](../developer/E2E_TESTING.md) - User-facing CLI reference, quick start, troubleshooting
- [Interactive Requirements System](../developer/interactive-examples/requirements-reference.md)
- [JSON Guide Schema](../../src/types/json-guide.types.ts)
- [Existing E2E Tests](../../tests/welcome-journey.spec.ts)
- [CLI Validation Command](../../src/cli/commands/validate.ts)
- [Testing Strategy](./TESTING_STRATEGY.md) - Higher-level testing vision and failure classification
- [Pathfinder Package Design](./PATHFINDER-PACKAGE-DESIGN.md) - Two-file package model, manifest schema, `testEnvironment`
- [Package Standards Alignment](./package/standards-alignment.md) - `testEnvironment` metadata specification
- [Recommender OpenAPI](https://github.com/grafana/grafana-recommender) - `/api/v1/packages/{id}` resolution endpoint
