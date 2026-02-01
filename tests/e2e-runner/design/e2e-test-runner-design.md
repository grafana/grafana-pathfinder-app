# E2E Test Runner CLI Design

This document describes the design for a CLI utility that runs end-to-end tests on JSON block files, verifying that all interactive elements function correctly in a live Grafana instance.

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

## CLI Interface

```bash
# Basic usage - run E2E tests on a guide
npx pathfinder-cli e2e ./path/to/guide.json

# Test all bundled guides
npx pathfinder-cli e2e --bundled

# Run the framework test guide (validates the E2E runner itself)
npx pathfinder-cli e2e bundled:e2e-framework-test

# Custom Grafana URL
npx pathfinder-cli e2e ./guide.json --grafana-url http://localhost:3000

# Output options
npx pathfinder-cli e2e ./guide.json --output ./results.json
npx pathfinder-cli e2e ./guide.json --artifacts ./artifacts/  # Failure screenshots/DOM
npx pathfinder-cli e2e ./guide.json --verbose

# Debugging
npx pathfinder-cli e2e ./guide.json --trace        # Generate Playwright trace file
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI Entry Point                              │
│                    src/cli/commands/e2e.ts                          │
├─────────────────────────────────────────────────────────────────────┤
│  1. Parse CLI arguments                                             │
│  2. Load and validate JSON guide                                    │
│  3. Run pre-flight checks (Grafana health, auth, plugin installed)  │
│  4. Set environment variables (GUIDE_JSON_PATH, etc.)               │
│  5. Spawn Playwright: npx playwright test tests/guide-runner.spec.ts│
│  6. Collect results and generate reports                            │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Guide Runner Test                                 │
│                 tests/guide-runner.spec.ts                          │
├─────────────────────────────────────────────────────────────────────┤
│  1. Read JSON from GUIDE_JSON_PATH env var                          │
│  2. Inject JSON into localStorage                                   │
│  3. Open guide via bundled:e2e-test                                 │
│  4. Iterate through rendered steps in DOM order                     │
│  5. For each step: click "Do it" → verify completion                │
│  6. Report results via custom reporter                              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Test Utilities                                    │
│              tests/utils/guide-test-runner.ts                       │
├─────────────────────────────────────────────────────────────────────┤
│  - discoverStepsFromDOM(page): TestableStep[]                       │
│  - executeStep(page, step): StepTestResult                          │
│  - handleRequirements(page, step): RequirementResult                │
│  - captureStepDiagnostics(page, step): DiagnosticInfo               │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Authentication Module                             │
│                   tests/auth/grafana-auth.ts                        │
├─────────────────────────────────────────────────────────────────────┤
│  MVP: Uses existing @grafana/plugin-e2e auth (admin.json)           │
│  Future: Swappable auth strategies for different environments       │
└─────────────────────────────────────────────────────────────────────┘
```

## Pre-flight Checks

Before running any guide tests, the CLI performs validation to fail fast with clear error messages:

### Check sequence

1. **Grafana reachable**: `GET /api/health` returns `{ "database": "ok" }`
2. **Auth valid**: Navigate to a protected page, verify no redirect to login
3. **Plugin installed**: Verify `grafana-pathfinder-app` appears in plugin list
4. **Dev mode enabled**: Attempt test injection, verify plugin accepts

### Implementation

```typescript
async function runPreFlightChecks(page: Page, grafanaUrl: string): Promise<PreFlightResult> {
  const checks: PreFlightCheck[] = [];

  // 1. Grafana health
  const healthResponse = await fetch(`${grafanaUrl}/api/health`);
  checks.push({
    name: 'grafana-reachable',
    passed: healthResponse.ok && (await healthResponse.json()).database === 'ok',
    error: healthResponse.ok ? undefined : `Grafana not reachable at ${grafanaUrl}`,
  });

  // 2. Auth valid (after Playwright auth setup)
  await page.goto(`${grafanaUrl}/dashboards`);
  const isLoginPage = page.url().includes('/login');
  checks.push({
    name: 'auth-valid',
    passed: !isLoginPage,
    error: isLoginPage ? 'Authentication failed - redirected to login' : undefined,
  });

  // 3. Plugin installed
  const pluginResponse = await fetch(`${grafanaUrl}/api/plugins/grafana-pathfinder-app/settings`);
  checks.push({
    name: 'plugin-installed',
    passed: pluginResponse.ok,
    error: pluginResponse.ok ? undefined : 'Pathfinder plugin not installed',
  });

  // Abort if any check failed
  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    return { success: false, checks, abortReason: failed[0].error };
  }

  return { success: true, checks };
}
```

### Exit codes

| Code | Meaning                          |
| ---- | -------------------------------- |
| 0    | All steps passed                 |
| 1    | One or more steps failed         |
| 2    | Configuration/setup error        |
| 3    | Grafana unreachable (pre-flight) |
| 4    | Auth failure (pre-flight)        |

## File Structure

```
src/cli/
├── commands/
│   ├── validate.ts          # Existing validation command
│   └── e2e.ts               # NEW: E2E test runner command
├── utils/
│   ├── file-loader.ts       # Existing file utilities
│   └── e2e-reporter.ts      # NEW: JSON report generator
└── index.ts                 # Add e2e command

src/lib/
└── user-storage.ts          # ADD: E2E_TEST_GUIDE storage key

src/docs-retrieval/
└── content-fetcher.ts       # ADD: bundled:e2e-test handler

tests/
├── e2e-runner/                  # NEW: E2E test runner directory
│   ├── MILESTONES.md            # Implementation milestones
│   ├── guide-runner.spec.ts     # Dynamic guide test runner
│   ├── utils/
│   │   └── guide-test-runner.ts # Test execution utilities
│   └── auth/
│       └── grafana-auth.ts      # Authentication module
├── fixtures.ts                  # Existing
├── constants.ts                 # Existing
└── helpers/
    └── block-editor.helpers.ts  # Existing
```

## Raw JSON Loading Mechanism

The pathfinder UI currently supports loading guides from:

- Bundled content (`bundled:guide-id`)
- Grafana docs URLs
- GitHub raw URLs (dev mode only)
- Localhost URLs (dev mode only)

For E2E testing, we need to load arbitrary JSON files. We'll extend the existing `bundled:wysiwyg-preview` pattern.

### Existing Pattern: WYSIWYG Preview

The WYSIWYG editor already uses localStorage-based loading:

```typescript
// src/lib/user-storage.ts
WYSIWYG_PREVIEW_JSON: 'grafana-pathfinder-app-wysiwyg-preview-json';

// src/docs-retrieval/content-fetcher.ts
if (contentId === 'wysiwyg-preview') {
  const previewContent = localStorage.getItem(StorageKeys.WYSIWYG_PREVIEW_JSON);
  // ... returns as RawContent
}
```

### New Pattern: E2E Test Loading

We'll add a similar mechanism for E2E tests:

```typescript
// src/lib/user-storage.ts - ADD:
E2E_TEST_GUIDE: 'grafana-pathfinder-app-e2e-test-guide';

// src/docs-retrieval/content-fetcher.ts - ADD handler:
if (contentId === 'e2e-test') {
  const testContent = localStorage.getItem(StorageKeys.E2E_TEST_GUIDE);
  // ... same pattern as wysiwyg-preview
}
```

### Test Flow

1. **CLI reads JSON file** from disk
2. **Playwright injects JSON** into localStorage:
   ```typescript
   await page.evaluate((jsonContent) => {
     localStorage.setItem('grafana-pathfinder-app-e2e-test-guide', jsonContent);
   }, guideJson);
   ```
3. **Open guide via panel API**:
   ```typescript
   await page.evaluate(() => {
     // Trigger the docs panel to open bundled:e2e-test
     document.dispatchEvent(
       new CustomEvent('pathfinder-auto-open-docs', {
         detail: { url: 'bundled:e2e-test', title: 'E2E Test Guide' },
       })
     );
   });
   ```
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

### Step Discovery Function

```typescript
async function discoverStepsFromDOM(page: Page): Promise<TestableStep[]> {
  // Query all rendered step elements in DOM order
  const stepElements = await page.locator('[data-testid^="interactive-step-"]').all();

  const steps: TestableStep[] = [];
  for (const element of stepElements) {
    const testId = await element.getAttribute('data-testid');
    const stepId = testId?.replace('interactive-step-', '') ?? '';
    steps.push({ stepId, element });
  }

  return steps;
}
```

### Scrolling the Guide Panel

Before interacting with a step, the test runner must ensure the step is visible in the docs panel viewport:

```typescript
async function scrollStepIntoView(page: Page, stepId: string): Promise<void> {
  const stepElement = page.getByTestId(testIds.interactive.step(stepId));

  // Scroll within the docs panel container, not the main page
  await stepElement.scrollIntoViewIfNeeded();

  // Wait for scroll animation to complete
  await page.waitForTimeout(300);
}
```

### Step Iteration Pattern

```typescript
async function iterateSteps(page: Page): Promise<StepTestResult[]> {
  const results: StepTestResult[] = [];
  const steps = await discoverStepsFromDOM(page);

  for (const step of steps) {
    // 1. Scroll step into view in the docs panel
    await scrollStepIntoView(page, step.stepId);

    // 2. Handle requirements (click Fix buttons if needed)
    await handleRequirements(page, step);

    // 3. Click "Do it" button and capture diagnostics
    const result = await executeStep(page, step);
    results.push(result);

    // 4. If failed and not skippable, abort remaining steps
    if (result.status === 'failed' && !step.skippable) {
      // Mark remaining steps as "not_reached"
      break;
    }

    // 5. Wait for step completion before moving to next
    await waitForStepCompletion(page, step, result);
  }

  return results;
}
```

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

Since the test runner uses DOM-based discovery, it doesn't know the step type or action count from the JSON. Instead, we use a generous default timeout and rely on completion detection:

```typescript
function calculateStepTimeout(): number {
  // Generous default that accommodates multisteps
  // Completion detection will return early for faster steps
  const DEFAULT_TIMEOUT = 30000; // 30 seconds
  return DEFAULT_TIMEOUT;
}
```

**Note**: The completion indicator (`data-testid="interactive-step-completed-{stepId}"`) appearing is the primary signal for step completion. The timeout is a safety net, not the expected completion mechanism.

### Completion Detection

**MVP approach**: DOM polling only.

```typescript
async function waitForStepCompletion(page: Page, step: TestableStep, timeout: number): Promise<void> {
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(step.stepId));
  await expect(completedIndicator).toBeVisible({ timeout });
}
```

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

### Step Execution Flow

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  const startTime = Date.now();
  const consoleErrors: string[] = [];

  // Capture console.error() calls during step execution
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1. Handle requirements (click Fix buttons if needed)
    await handleRequirements(page, step);

    // 2. Click "Do it" button
    const doItButton = page.getByTestId(testIds.interactive.doItButton(step.stepId));
    await doItButton.click();

    // 3. Wait for step completion indicator
    const timeout = calculateStepTimeout();
    await waitForStepCompletion(page, step, timeout);

    // 4. Return success result with diagnostics
    return {
      stepId: step.stepId,
      status: 'passed',
      duration: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
    };
  } catch (error) {
    return {
      stepId: step.stepId,
      status: 'failed',
      duration: Date.now() - startTime,
      currentUrl: page.url(),
      consoleErrors,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### What Gets Tested

For each step, the runner verifies:

- Requirements can be satisfied (Fix buttons work)
- "Do it" button is clickable
- Step completes successfully (completion indicator appears)
- No blocking errors occur during execution

### Session Validation During Execution

For long-running tests, the session may expire mid-execution. The runner performs lightweight auth validation periodically:

```typescript
async function validateSession(page: Page): Promise<boolean> {
  // Quick check: can we access a protected API endpoint?
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/user');
    return res.ok;
  });

  return response;
}

// In the step loop:
if (stepIndex % 5 === 0) {
  const sessionValid = await validateSession(page);
  if (!sessionValid) {
    return {
      aborted: true,
      reason: 'AUTH_EXPIRED',
      message: 'Session expired mid-test',
    };
  }
}
```

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

### Console Output

```
╔══════════════════════════════════════════════════════════════════╗
║  E2E Test: Welcome to Grafana                                    ║
╚══════════════════════════════════════════════════════════════════╝

  ✓ step-1                                                  [1.2s]
  ✓ step-2                                                  [0.8s]
  ✓ step-3                                                  [0.9s]
  ⊘ step-4 - SKIPPED                                        [0.1s]
    Reason: is-admin requirement not met (skippable step)
  ✓ step-5                                                  [0.7s]

────────────────────────────────────────────────────────────────────
Summary: 4 passed, 0 failed, 1 skipped                    [3.7s]
────────────────────────────────────────────────────────────────────
```

### JSON Output

```json
{
  "guide": {
    "id": "welcome-to-grafana",
    "title": "Welcome to Grafana",
    "path": "./welcome-to-grafana.json"
  },
  "config": {
    "grafanaUrl": "http://localhost:3000",
    "grafanaVersion": "11.3.0",
    "timestamp": "2026-01-31T10:30:00.000Z"
  },
  "summary": {
    "total": 6,
    "passed": 5,
    "failed": 0,
    "skipped": 1,
    "notReached": 0,
    "duration": 4823
  },
  "steps": [
    {
      "stepId": "step-1",
      "index": 0,
      "status": "passed",
      "duration": 1234,
      "currentUrl": "http://localhost:3000/",
      "consoleErrors": []
    },
    {
      "stepId": "step-4",
      "index": 3,
      "status": "skipped",
      "duration": 100,
      "currentUrl": "http://localhost:3000/dashboards",
      "consoleErrors": [],
      "skipReason": "is-admin requirement not met"
    },
    {
      "stepId": "step-5",
      "index": 4,
      "status": "failed",
      "duration": 5200,
      "currentUrl": "http://localhost:3000/dashboards",
      "consoleErrors": ["TypeError: Cannot read property 'x' of undefined"],
      "error": "Timeout waiting for step completion indicator",
      "classification": "content-drift",
      "artifacts": {
        "screenshot": "./artifacts/step-5-failure.png",
        "dom": "./artifacts/step-5-dom.html"
      }
    }
  ]
}
```

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

Artifacts are written to `./artifacts/` by default (configurable via `--output`):

```typescript
async function captureFailureArtifacts(page: Page, stepId: string, outputDir: string): Promise<ArtifactPaths> {
  const screenshotPath = path.join(outputDir, `${stepId}-failure.png`);
  const domPath = path.join(outputDir, `${stepId}-dom.html`);

  await page.screenshot({ path: screenshotPath, fullPage: false });

  const html = await page.content();
  await fs.writeFile(domPath, html);

  return { screenshot: screenshotPath, dom: domPath };
}
```

## Implementation Milestones

For detailed implementation milestones, phases, and acceptance criteria, see [MILESTONES.md](./MILESTONES.md).

The implementation is organized into 7 L3 phases:

1. **L3 Phase 1: Foundation & Validation** - JSON loading infrastructure and assumption verification
2. **L3 Phase 2: CLI Scaffolding** - Command structure, Playwright integration, and pre-flight checks
3. **L3 Phase 3: Step Discovery & Execution** - Core DOM-based test execution (highest complexity)
4. **L3 Phase 4: Requirements Handling** - Fix buttons, skippable/mandatory logic
5. **L3 Phase 5: Reporting** - Console output, JSON output, error classification, and artifact capture
6. **L3 Phase 6: Framework Test Guide** - Create `e2e-framework-test.json` to validate the runner itself
7. **L3 Phase 7: Polish & Extensions** - Auth abstraction, bundled guide testing, CI workflow template

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

## Reusing Existing Code

The implementation should reuse:

1. **File loading** (`src/cli/utils/file-loader.ts`)
   - `loadGuideFiles()`, `loadBundledGuides()`

2. **JSON validation** (`src/validation/`)
   - Validate guide before testing

3. **Test helpers** (`tests/helpers/block-editor.helpers.ts`, `tests/welcome-journey.spec.ts`)
   - `handleFixMeButtons()`, `completeStep()` patterns
   - `waitForGrafanaReady()`

4. **Test IDs** (`src/components/testIds.ts`)
   - Consistent selectors for interactive elements

5. **Fixtures** (`tests/fixtures.ts`)
   - Grafana plugin e2e authentication

## Design Decisions (Resolved)

| Question               | Decision                           | Rationale                                                           |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Step discovery         | DOM-based iteration                | Tests actual rendered UI, handles conditionals automatically        |
| Show me vs Do it       | Skip "Show me", only click "Do it" | Faster, still validates execution                                   |
| Multistep handling     | Single unit (pass/fail)            | Matches user experience; expand later                               |
| Screenshots            | On failure only (MVP)              | Captures diagnostic state without storage overhead                  |
| Test generation        | Dynamic (no static files)          | Cleaner, always current                                             |
| Parallel vs sequential | Sequential only                    | Matches real user flow                                              |
| Auth handling          | Modular, MVP uses existing         | Allows future swapping                                              |
| Console error capture  | `console.error()` only             | Focused signal, less noise                                          |
| Conditional branches   | Let plugin handle                  | Runner just iterates whatever is rendered                           |
| Completion detection   | DOM polling only (MVP)             | Simpler; events deferred until polling proves inadequate            |
| Error classification   | Hints only (MVP)                   | Only `infrastructure` auto-classified; others need human triage     |
| Pre-flight checks      | Required before test run           | Fail fast with clear messages before wasting time                   |

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

> **L3 Phase 1 Completion**: All assumptions have been verified through code analysis (2026-02-01). See `tests/e2e-runner/design/L3-phase1-verification-results.md` for detailed findings.

| #   | Assumption                                           | Verification Result | Design Impact | Status |
| --- | ---------------------------------------------------- | ------------------- | ------------- | ------ |
| U1  | **All steps have "Do it" buttons**                   | ❌ **FALSE** - Steps can have `doIt: false`; `noop` steps auto-complete | **HIGH** - Must check button existence before clicking | Required changes in Milestone L3-3A |
| U2  | **Completion indicator appears after "Do it" click** | ⚠️ **PARTIAL** - Steps with `completeEarly: true` or objectives complete before/without clicking | **MEDIUM** - Check for pre-completion before clicking | Required changes in Milestone L3-3B |
| U3  | **Steps are always clickable when discovered**       | ❌ **FALSE** - `isEligibleForChecking` controls sequential access; buttons may be disabled | **HIGH** - Must wait for `.toBeEnabled()` not just visible | Required changes in Milestone L3-3B |
| U4  | **Fix buttons always succeed**                       | ❌ **FALSE** - Navigation/network failures possible; some requirements unfixable | **MEDIUM** - Add timeout and max retry logic | Required changes in Milestone L3-4B |
| U5  | **Console.error() indicates real problems**          | ⚠️ **PARTIAL** - Grafana likely logs warnings/deprecations (needs empirical test) | **LOW** - Filter known false positives | Optional polish |
| U6  | **Single DOM pass discovers all steps**              | ⚠️ **LIKELY TRUE** - All steps render on mount, but conditional rendering possible | **MEDIUM** - Re-check after major state changes defensively | Optional for MVP |
| U7  | **SequentialRequirementsManager doesn't interfere**  | ❌ **FALSE** (but intentional) - Manager actively coordinates state across steps | **LOW** - Work with manager, not against it | No changes needed |
| U8  | **localStorage is available and reliable**           | ✅ **TRUE** - Robust handling with QuotaExceededError, fallbacks, sync | **LOW** - No additional handling needed | ✅ Verified |
| U9  | **LazyRender steps are rare/testable**               | ✅ **TRUE** - Default `false`, `executeWithLazyScroll()` handles scroll discovery | **LOW** - Use longer timeouts for lazy steps | ✅ Verified |
| U10 | **Steps complete within 30 seconds**                 | ⚠️ **UNKNOWN** - Requires empirical testing with framework guide | **MEDIUM** - Use 30s default, adjust based on data | Testing needed in Milestone L3-3C |

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

| Question | Resolution | Rationale |
|----------|------------|-----------|
| Disable SequentialRequirementsManager DOM monitoring? | No | It's part of what we're testing |
| Pre-completed steps reporting? | `passed` with note | Guide is functioning correctly |
| LazyRender retry with scroll? | Trust plugin handling, wait longer | Plugin handles transparently |
| Max multistep timeout? | 30s base + 5s per action | Start generous, tune with data |
| Verify guide completed all sections? | Post-MVP | Focus on step-level validation first |

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
- **CI integration**: GitHub Actions workflow template (see example below)

#### CI workflow example (Medium-term)

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      grafana:
        image: grafana/grafana:11.3.0
        ports:
          - 3000:3000
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Wait for Grafana
        run: |
          timeout 60 bash -c 'until curl -sf http://localhost:3000/api/health; do sleep 2; done'

      - name: Run E2E tests
        run: npx pathfinder-cli e2e --bundled --grafana-url http://localhost:3000

      - name: Upload artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-artifacts
          path: artifacts/
```

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

| Decision | Value | Rationale |
|----------|-------|-----------|
| Max fix attempts | 3 | Fail fast in E2E tests; 10 was too slow |
| Console error filtering | Hardcoded in runner | Known patterns (deprecations, DevTools) filtered out |
| Auth strategies | Cloud SSO/Okta, username/password | MVP uses existing @grafana/plugin-e2e auth |
| Artifact storage | Local files, GitHub Actions artifacts | Screenshots and DOM snapshots on failure |
| Version matrix | Deferred | Guides may express compatibility metadata later |

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

### Running the framework test

```bash
# Standard run
npx pathfinder-cli e2e bundled:e2e-framework-test

# Verbose debugging
npx pathfinder-cli e2e bundled:e2e-framework-test --verbose --trace
```

## Related Documentation

- [Interactive Requirements System](../../../docs/developer/interactive-examples/requirements-reference.md)
- [JSON Guide Schema](../../../src/types/json-guide.types.ts)
- [Existing E2E Tests](../../welcome-journey.spec.ts)
- [CLI Validation Command](../../../src/cli/commands/validate.ts)
- [Testing Strategy](./TESTING_STRATEGY.md) - Higher-level testing vision and failure classification
- [Implementation Milestones](./MILESTONES.md) - L3 Phased implementation plan
- [L3 Phase 1 Results](./L3-phase1-verification-results.md) - Assumption verification findings
