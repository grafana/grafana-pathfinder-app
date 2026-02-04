# E2E Test Runner Implementation Reference

> **Layer 3 Implementation**: This document captures key implementation details, design decisions, and findings from building the E2E Integration layer (Layer 3) of the [Testing Strategy](./TESTING_STRATEGY.md). For architecture and specifications, see [e2e-test-runner-design.md](./e2e-test-runner-design.md).

---

## Critical Findings: Assumption Verification

Before implementation, we verified 10 unexamined assumptions (U1-U10) from the design document. Results informed the implementation:

### Falsified Assumptions

| Assumption                                                 | Finding                                                                   | Design Impact                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| **U1**: All steps have "Do it" buttons                     | Some steps have `doIt: false`, others are `noop` steps that auto-complete | Added `hasDoItButton` detection, skip handling |
| **U3**: Steps clickable when discovered                    | Must wait for `isEligibleForChecking` (sequential dependencies)           | Added button-enabled wait with 10s timeout     |
| **U4**: Fix buttons always work                            | Fix buttons can fail                                                      | Added retry loop with max 3 attempts           |
| **U7**: No interference from SequentialRequirementsManager | Sequential dependencies affect button state                               | Wait for button enabled before clicking        |

### Partially True Assumptions

| Assumption                                    | Finding                                               | Design Impact                                    |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| **U2**: Steps complete only via "Do it" click | Steps can pre-complete via objectives before clicking | Added pre-completion detection                   |
| **U5**: Completion detected via indicator     | Multiple completion paths exist                       | Poll for completion, check before clicking       |
| **U6**: Timeouts sufficient                   | Multisteps need dynamic timeouts                      | Calculate timeout based on internal action count |
| **U10**: Requirements always detectable       | Spinner state must be waited out                      | Wait for requirements check to complete          |

### Verified True

- **U8**: localStorage reliable for guide injection
- **U9**: LazyRender steps are testable

Full analysis: `tests/e2e-runner/design/L3-phase1-verification-results.md`

---

## JSON Loading Infrastructure

Enables test guide injection via localStorage.

**Key files:**

- `src/lib/user-storage.ts` - `E2E_TEST_GUIDE` storage key
- `src/docs-retrieval/content-fetcher.ts` - `bundled:e2e-test` handler (pattern follows WYSIWYG preview)

**Usage:**

```ts
localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', jsonString);
// Then open: bundled:e2e-test
```

---

## CLI and Playwright Integration

### CLI command

`src/cli/commands/e2e.ts` implements the `e2e` command with:

- JSON validation against guide schema
- Exit codes: SUCCESS=0, TEST_FAILURE=1, CONFIGURATION_ERROR=2, GRAFANA_UNREACHABLE=3, AUTH_FAILURE=4
- `bundled:name` syntax for loading specific bundled guides
- `--bundled` flag to test all bundled guides

### Playwright spawning

The CLI spawns Playwright via `runPlaywrightTests()`:

1. Writes guide JSON to temp file (`mkdtempSync`)
2. Passes environment variables: `GUIDE_JSON_PATH`, `GRAFANA_URL`, `E2E_TRACE`, `ARTIFACTS_DIR`, `ABORT_FILE_PATH`, `RESULTS_FILE_PATH`
3. Cleans up temp files in `finally` block

### Pre-flight checks

Two-phase architecture:

1. **CLI phase**: Grafana health check via `/api/health` (public endpoint, no auth)
2. **Playwright phase**: Auth validation and plugin installation check (requires browser context)

Pre-flight utilities: `tests/e2e-runner/utils/preflight.ts`

---

## Step Discovery

`tests/e2e-runner/utils/guide-runner/discovery.ts` discovers steps from rendered DOM.

### TestableStep interface

```ts
interface TestableStep {
  stepId: string; // From data-testid
  index: number; // Zero-based DOM order
  sectionId?: string; // Parent section ID
  skippable: boolean; // Has skip button
  hasDoItButton: boolean; // U1: not all steps have buttons
  isPreCompleted: boolean; // U2: objectives/noop completion
  targetAction?: string; // From data-targetaction
  isMultistep: boolean; // For timeout calculation
  internalActionCount: number; // Multistep actions count
  refTarget?: string; // For requirements detection
}
```

### Discovery statistics

```ts
interface StepDiscoveryResult {
  steps: TestableStep[];
  stats: {
    total: number;
    preCompleted: number; // Useful for understanding guide state
    noButton: number; // Steps with doIt: false or noop
    discoveryDurationMs: number;
  };
}
```

---

## Step Execution

`tests/e2e-runner/utils/guide-runner/execution.ts` handles step execution.

### Execution flow

1. Check pre-completed (from discovery) → skip with `pre_completed` reason
2. Check no "Do it" button (U1) → skip with `no_do_it_button` reason
3. Scroll with 300ms settle delay
4. Check objective completion before clicking (U2)
5. Wait for button enabled (10s, U3 sequential dependencies)
6. Handle requirements with fix attempts if needed
7. Click "Do it"
8. Post-click 500ms settle delay (reactive system)
9. Wait for completion with polling

### Timing constants

```ts
DEFAULT_STEP_TIMEOUT_MS = 30000; // Base timeout
TIMEOUT_PER_MULTISTEP_ACTION_MS = 5000; // +5s per internal action
BUTTON_ENABLE_TIMEOUT_MS = 10000; // Sequential dependency wait
SCROLL_SETTLE_DELAY_MS = 300;
POST_CLICK_SETTLE_DELAY_MS = 500;
COMPLETION_POLL_INTERVAL_MS = 250;
```

### Multistep timeout calculation

```ts
function calculateStepTimeout(step: TestableStep): number {
  if (step.isMultistep) {
    return DEFAULT_STEP_TIMEOUT_MS + step.internalActionCount * TIMEOUT_PER_MULTISTEP_ACTION_MS;
  }
  return DEFAULT_STEP_TIMEOUT_MS;
}
// Example: 5-action multistep gets 55s timeout
```

### Session validation

Validates session every N steps (default 5) to detect expiry during long tests:

- Uses `/api/user` fetch in browser context with session cookies
- On expiry: marks remaining steps as `not_reached`, sets `abortReason: 'AUTH_EXPIRED'`
- Exit code 4 mechanism: test writes abort reason to temp file, CLI reads it

---

## Requirements Handling

`tests/e2e-runner/utils/guide-runner/requirements.ts` manages step requirements.

### Detection

```ts
interface RequirementResult {
  status: 'met' | 'unmet' | 'checking' | 'unknown';
  hasFixButton: boolean;
  fixType?: 'navigation' | 'location' | 'expand-parent-navigation' | 'lazy-scroll';
  skippable: boolean;
  hasRetryButton: boolean;
  hasSkipButton: boolean;
  explanationText?: string;
}
```

Detection examines DOM for:

- "Do it" button enabled state (indicates requirements met)
- Requirement explanation element (indicates unmet/checking)
- Spinner visibility (indicates requirements being checked)
- Fix, Retry, Skip button presence

### Fix execution

```ts
FIX_BUTTON_TIMEOUT_MS = 10000; // Per fix operation
MAX_FIX_ATTEMPTS = 3; // Reduced from 10 for faster failure
POST_FIX_SETTLE_DELAY_MS = 1000;
NAVIGATION_FIX_SETTLE_DELAY_MS = 2000; // Location fixes
```

Fix type handling:

- `location`: 2s delay + `waitForLoadState('networkidle')`
- `navigation`, `expand-parent-navigation`: 1s delay
- `lazy-scroll`: Standard delay

### Skip/mandatory logic

```
Requirements met? → Execute step
Requirements not met + skippable → SKIPPED (continue)
Requirements not met + mandatory + fix available → Attempt fix
Requirements not met + mandatory + fix failed → FAILED (abort)
Execution fails + skippable → FAILED (continue)
Execution fails + mandatory → FAILED (abort)
```

---

## Reporting

### Console output

`tests/e2e-runner/utils/console-reporter.ts` provides formatted output:

- Status icons: ✓ passed, ✗ failed, ⊘ skipped, ○ not_reached
- Right-aligned duration per step
- Box-style header with guide title
- Summary with pass/fail counts

### JSON reports

`src/cli/utils/e2e-reporter.ts` generates structured reports.

**Single guide report:**

```ts
interface E2ETestReport {
  guide: { id: string; title: string; path: string };
  config: { grafanaUrl: string; timestamp: string };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    notReached: number;
    mandatoryFailed: number;
    skippableFailed: number;
    duration: number;
  };
  steps: StepResult[];
}
```

**Multi-guide report** (for `--bundled` runs):

```ts
interface MultiGuideReport {
  type: 'multi-guide';
  summary: {
    totalGuides: number;
    passedGuides: number;
    failedGuides: number;
    authExpiredGuides: number;
    steps: AggregatedStepCounts;
    totalDuration: number;
  };
  guides: GuideResult[]; // Condensed per-guide results
  reports: E2ETestReport[]; // Full reports for analysis
}
```

### Error classification

MVP approach: only auto-classify high-confidence `infrastructure` failures.

```ts
type ErrorClassification = 'infrastructure' | 'content-drift' | 'product-regression' | 'unknown';
```

Infrastructure patterns recognized:

- Timeout: `timeout`, `timed out`, `waiting for`, `exceeded`
- Network: `network`, `net::`, `fetch failed`, `econnrefused`
- Auth: `auth.*expir`, `session.*expir`, `unauthorized`, `401`, `403`
- Browser: `browser.*closed`, `page.*crashed`

`content-drift` vs `product-regression` distinction requires human validation and is not auto-classified.

### Artifact collection

On step failure, captures:

- **Screenshot**: `{stepId}-failure.png` (viewport only)
- **DOM snapshot**: `{stepId}-dom.html` for selector debugging
- **Console errors**: `{stepId}-console.json` if any were collected

Artifacts captured only on failure to save space. Directory created lazily.

---

## Authentication Module

`tests/e2e-runner/auth/grafana-auth.ts` provides swappable auth strategies.

### Strategy interface

```ts
interface AuthStrategy {
  name: string;
  authenticate(page: Page, grafanaUrl: string): Promise<AuthResult>;
  validateSession(page: Page): Promise<SessionValidationResult>;
  refreshSession?(page: Page): Promise<AuthResult>; // Optional
}
```

### Default strategy

Uses `@grafana/plugin-e2e` authentication via Playwright's `storageState`. Session persisted in `playwright/.auth/admin.json`.

### Extension point

Custom strategies can implement token refresh for long-running tests. The default strategy does not support refresh by design.

---

## Framework Test Guide

`src/bundled-interactives/e2e-framework-test.json` validates the E2E framework itself.

### Design principles

- **No mutations**: Never create, modify, or delete data
- **No dependencies**: Works on fresh Grafana with defaults
- **Stable selectors**: Uses only elements that exist in all versions
- **Fast execution**: Completes in under 60 seconds
- **Deterministic**: Same result every time

### Implementation notes

- Uses highlight actions only (button/navigate actions don't reliably have "Do it" buttons standalone)
- Steps outside sections (independent) to avoid sequential dependency timing issues at discovery
- Uses standard Grafana nav menu item test IDs for cross-version stability

---

## Files Reference

### Core implementation

| File                                                  | Purpose                                 |
| ----------------------------------------------------- | --------------------------------------- |
| `src/cli/commands/e2e.ts`                             | CLI command, Playwright spawning        |
| `tests/e2e-runner/guide-runner.spec.ts`               | Main Playwright test                    |
| `tests/e2e-runner/utils/guide-runner/discovery.ts`    | Step discovery from DOM                 |
| `tests/e2e-runner/utils/guide-runner/execution.ts`    | Step execution logic                    |
| `tests/e2e-runner/utils/guide-runner/requirements.ts` | Requirements detection and fix handling |
| `tests/e2e-runner/utils/console-reporter.ts`          | Console output formatting               |
| `src/cli/utils/e2e-reporter.ts`                       | JSON report generation                  |
| `tests/e2e-runner/utils/preflight.ts`                 | Pre-flight check utilities              |
| `tests/e2e-runner/auth/grafana-auth.ts`               | Auth strategy abstraction               |

### Infrastructure

| File                                               | Purpose                    |
| -------------------------------------------------- | -------------------------- |
| `src/lib/user-storage.ts`                          | E2E_TEST_GUIDE storage key |
| `src/docs-retrieval/content-fetcher.ts`            | bundled:e2e-test handler   |
| `src/bundled-interactives/e2e-framework-test.json` | Framework validation guide |
