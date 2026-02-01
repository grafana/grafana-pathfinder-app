# L3 Phase 1: Assumption Verification Results

> **Status**: ARCHIVED - Actionable findings merged into [e2e-test-runner-design.md](./e2e-test-runner-design.md). This document preserved as detailed historical record.

This document presents the findings from verifying the 10 unexamined assumptions (U1-U10) identified in the E2E Test Runner design document.

**Methodology**: Code analysis of interactive components, step checker hooks, and existing E2E tests to validate each assumption.

**Date**: 2026-02-01
**Investigator**: Claude (automated analysis)

---

## Verification Summary

| #   | Assumption                                       | Status         | Risk Level | Design Impact                     |
| --- | ------------------------------------------------ | -------------- | ---------- | --------------------------------- |
| U1  | All steps have "Do it" buttons                   | ❌ **FALSE**   | **HIGH**   | Must handle steps without buttons |
| U2  | Completion indicator appears after "Do it" click | ⚠️ **PARTIAL** | **MEDIUM** | Must handle pre-completion        |
| U3  | Steps always clickable when discovered           | ❌ **FALSE**   | **HIGH**   | Must wait for eligibility         |
| U4  | Fix buttons always succeed                       | ❌ **FALSE**   | **MEDIUM** | Need timeout/failure handling     |
| U5  | Console.error() indicates real problems          | ⚠️ **PARTIAL** | **LOW**    | May have false positives          |
| U6  | Single DOM pass discovers all steps              | ⚠️ **PARTIAL** | **MEDIUM** | May need re-discovery             |
| U7  | SequentialRequirementsManager doesn't interfere  | ❌ **FALSE**   | **LOW**    | Works with, not against it        |
| U8  | localStorage is available and reliable           | ✅ **TRUE**    | **LOW**    | Well-handled in code              |
| U9  | LazyRender steps are rare/testable               | ✅ **TRUE**    | **LOW**    | Exists but not common             |
| U10 | Steps complete within 30 seconds                 | ⚠️ **UNKNOWN** | **MEDIUM** | Needs empirical testing           |

---

## Detailed Findings

### ✅ U8: localStorage is available and reliable

**Status**: **VERIFIED - TRUE**

**Evidence**:

- `src/lib/user-storage.ts` implements comprehensive localStorage handling:
  - Lines 216-222: QuotaExceededError gracefully handled with cleanup
  - Lines 264-357: Hybrid storage with Grafana user storage fallback
  - Lines 368-468: Bidirectional sync with timestamp-based conflict resolution
- Browser compatibility handled via try-catch wrappers
- Quota limits enforced (MAX_JOURNEY_COMPLETIONS: 100, MAX_INTERACTIVE_COMPLETIONS: 100)

**Design Impact**: ✅ No changes needed. Storage infrastructure is robust.

**Recommendation**: Trust existing implementation. No additional fallback logic required.

---

### ✅ U9: LazyRender steps are rare/testable

**Status**: **VERIFIED - TRUE**

**Evidence**:

- `src/docs-retrieval/components/interactive/interactive-step.tsx`:
  - Line 152: `lazyRender = false` (default is disabled)
  - Lines 46-110: `executeWithLazyScroll()` function implements scroll discovery
  - Lines 83-101: Scrolls virtualized containers to find elements
- Used for targeting elements in long scrollable panels (dashboard lists, etc.)
- Well-tested pattern in existing interactive guides

**Design Impact**: ✅ E2E runner can handle lazy render steps:

- Wait for lazy scroll completion (lines 85-93 show it works)
- Longer timeout for these steps (~10-15s instead of 5s)
- Error if element never discovered is legitimate test failure

**Recommendation**:

- Detect `lazyRender` attribute on steps (if exposed to DOM or via data-attributes)
- Allow 15-second timeout for lazy render steps vs 5s for normal steps
- Log when lazy scroll discovery is triggered for diagnostics

---

### ❌ U1: All steps have "Do it" buttons

**Status**: **FALSIFIED - CRITICAL FINDING**

**Evidence**:

- `src/docs-retrieval/components/interactive/interactive-step.tsx`:
  - Line 146: `doIt = true` - **Default** is true, BUT can be explicitly disabled
  - Steps can set `doIt: false` to hide the "Do it" button entirely
  - Line 287: `targetAction === 'noop'` steps are informational-only
  - Lines 289-306: Noop steps **auto-complete** when eligible (no button needed)
- `src/components/testIds.ts`:
  - Line 86: `doItButton: (stepId: string) => 'interactive-do-it-${stepId}'`
  - Button selector assumes button exists, but it may not

**Code Example**:

```typescript
// From interactive-step.tsx:289-306
if (isNoopAction && isEligibleForChecking && !disabled) {
  // Notify parent section of completion (idempotent)
  if (onStepComplete && stepId) {
    onStepComplete(stepId);
  }
  // Auto-complete - NO USER ACTION REQUIRED
}
```

**Design Impact**: ❌ **MAJOR CHANGE REQUIRED**

The E2E runner CANNOT assume all steps have "Do it" buttons. The current design (lines 452-473 of design doc) will fail when encountering:

1. Steps with `doIt: false`
2. Steps with `targetAction: 'noop'` (auto-complete)
3. Steps that complete via objectives before user interaction

**Required Design Changes**:

1. **Step Discovery Phase** - Detect step type:

```typescript
async function discoverStepsFromDOM(page: Page): Promise<TestableStep[]> {
  const stepElements = await page.locator('[data-testid^="interactive-step-"]').all();

  const steps: TestableStep[] = [];
  for (const element of stepElements) {
    const stepId = extractStepId(element);

    // Check if "Do it" button exists
    const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
    const hasDoItButton = (await doItButton.count()) > 0;

    // Check if already completed (objectives or noop)
    const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));
    const isPreCompleted = await completedIndicator.isVisible();

    steps.push({
      stepId,
      hasDoItButton,
      isPreCompleted,
      element,
    });
  }

  return steps;
}
```

2. **Step Execution Logic** - Handle steps without buttons:

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  // Pre-completed steps (noop, objectives) - just verify and log
  if (step.isPreCompleted) {
    return {
      stepId: step.stepId,
      status: 'passed',
      duration: 0,
      note: 'Auto-completed (objectives or noop action)',
    };
  }

  // Steps without "Do it" button - mark as skipped
  if (!step.hasDoItButton) {
    return {
      stepId: step.stepId,
      status: 'skipped',
      duration: 0,
      skipReason: 'No "Do it" button available (doIt: false)',
    };
  }

  // Normal execution for button-based steps
  await page.getByTestId(testIds.interactive.doItButton(step.stepId)).click();
  // ... rest of execution logic
}
```

---

### ⚠️ U2: Completion indicator appears after "Do it" click

**Status**: **PARTIALLY TRUE - REQUIRES HANDLING**

**Evidence**:

- `src/docs-retrieval/components/interactive/interactive-step.tsx`:
  - Line 149: `completeEarly = false` (default)
  - Lines 394-400: If `completeEarly: true`, step completes **BEFORE** action executes
  - Lines 264-268: Steps can complete via objectives **WITHOUT** clicking "Do it"

```typescript
// Lines 394-400: CompleteEarly logic
if (completeEarly) {
  setIsLocallyCompleted(true);
  if (onStepComplete && stepId) {
    onStepComplete(stepId);
  }
  // ... then executes action
}
```

- Multiple completion paths (line 55 in step-checker.hook.ts):
  - `'manual'` - User clicked "Do it"
  - `'objectives'` - Objectives satisfied before clicking
  - `'skipped'` - User skipped the step

**Design Impact**: ⚠️ **MODERATE CHANGE REQUIRED**

The E2E runner must check for completion **before** clicking "Do it":

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  const startTime = Date.now();

  // Check if already completed (objectives-based or noop)
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(step.stepId));
  const isAlreadyComplete = await completedIndicator.isVisible();

  if (isAlreadyComplete) {
    return {
      stepId: step.stepId,
      status: 'passed',
      duration: Date.now() - startTime,
      note: 'Pre-completed (objectives satisfied)',
    };
  }

  // Click "Do it" button
  const doItButton = page.getByTestId(testIds.interactive.doItButton(step.stepId));
  await doItButton.click();

  // Wait for completion indicator
  await expect(completedIndicator).toBeVisible({ timeout: 30000 });

  return {
    stepId: step.stepId,
    status: 'passed',
    duration: Date.now() - startTime,
  };
}
```

**Note on completeEarly**: Steps with this flag complete immediately when "Do it" is clicked, then execute the action in the background. The completion indicator appears **immediately**, not after the action finishes. This is fine for the E2E runner - we just verify the indicator appears.

---

### ❌ U3: Steps are always clickable when discovered

**Status**: **FALSIFIED - CRITICAL FINDING**

**Evidence**:

- `src/docs-retrieval/components/interactive/interactive-step.tsx`:
  - Lines 270-281: Button enabled only when `finalIsEnabled` is true
  - `finalIsEnabled` requires BOTH:
    1. `isEligibleForChecking` (sequential dependency from section)
    2. `checker.isEnabled` (requirements satisfied)

```typescript
// Lines 270-281: Eligibility calculation
const finalIsEnabled = isPartOfSection
  ? isEligibleForChecking &&
    !isCompleted &&
    (checker.isEnabled || lazyScrollAvailable) &&
    checker.completionReason !== 'objectives'
  : checker.isEnabled || lazyScrollAvailable;
```

- `src/docs-retrieval/components/interactive/interactive-section.tsx`:
  - Line 104: `const [completedSteps, setCompletedSteps] = useState(new Set<string>())`
  - Section enforces sequential completion - next step not eligible until previous completes
  - Lines 256-261: `isEligibleForChecking` passed down to each step

**Sequential Dependency Example**:

```
Section with 3 steps:
  Step 1: isEligibleForChecking = true  (first step always eligible)
  Step 2: isEligibleForChecking = false (Step 1 not yet complete)
  Step 3: isEligibleForChecking = false (Step 2 not yet complete)
```

**Design Impact**: ❌ **MAJOR CHANGE REQUIRED**

The E2E runner CANNOT immediately click discovered steps. Must wait for buttons to become **enabled**:

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  const doItButton = page.getByTestId(testIds.interactive.doItButton(step.stepId));

  // Wait for button to be ENABLED, not just visible
  // Disabled buttons have aria-disabled="true" or disabled attribute
  await expect(doItButton).toBeEnabled({ timeout: 5000 });

  // Now safe to click
  await doItButton.click();
  // ... rest of execution
}
```

**Playwright's `.toBeEnabled()` matcher** checks:

- Element is not disabled (no `disabled` attribute)
- Element is not `aria-disabled="true"`
- Element is visible and clickable

This aligns perfectly with Grafana UI's Button component behavior.

---

### ❌ U4: Fix buttons always succeed

**Status**: **FALSIFIED - REQUIRES ERROR HANDLING**

**Evidence**:

- `src/requirements-manager/step-checker.hook.ts`:
  - Lines 108-194: `checkRequirementsWithStateUpdates()` implements retry logic
  - Line 116: `maxRetries = INTERACTIVE_CONFIG.delays.requirements.maxRetries`
  - Lines 150-157: Retries on failure with delay
- Fix types that can fail:
  - `navigation`: Network timeout, page not found
  - `location`: 404 errors, redirect loops
  - `lazy-scroll`: Element doesn't exist in virtualized container

**Code showing retry logic**:

```typescript
// Lines 150-157: Retry on failure
if (retryCount < maxRetries) {
  await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.requirements.retryDelay));
  return attemptCheck(retryCount + 1);
}
```

**Design Impact**: ⚠️ **MODERATE CHANGE REQUIRED**

The E2E runner must:

1. Limit fix attempts (design already specifies `maxFixes = 10`)
2. Add timeout for individual fix operations
3. Handle fix failures gracefully

```typescript
async function handleRequirements(page: Page, step: TestableStep): Promise<RequirementResult> {
  const fixButton = page.getByTestId(testIds.interactive.requirementFixButton(step.stepId));
  const fixButtonExists = (await fixButton.count()) > 0;

  if (!fixButtonExists) {
    return { satisfied: false, canProceed: step.skippable };
  }

  let attempts = 0;
  const MAX_FIX_ATTEMPTS = 3; // Lower than design's 10 - fail fast in E2E

  while (attempts < MAX_FIX_ATTEMPTS) {
    try {
      // Click fix button with timeout
      await fixButton.click({ timeout: 5000 });

      // Wait for fix to complete (navigation, etc.)
      await page.waitForLoadState('networkidle', { timeout: 10000 });

      // Recheck requirements
      const requirementCheck = page.getByTestId(testIds.interactive.requirementCheck(step.stepId));
      const passed = (await requirementCheck.getAttribute('data-passed')) === 'true';

      if (passed) {
        return { satisfied: true, canProceed: true };
      }

      attempts++;
    } catch (error) {
      console.warn(`Fix attempt ${attempts + 1} failed:`, error);
      attempts++;
    }
  }

  // All fix attempts failed
  if (step.skippable) {
    return {
      satisfied: false,
      canProceed: true,
      note: 'Skippable step with unfixable requirements',
    };
  }

  return {
    satisfied: false,
    canProceed: false,
    error: 'Requirements could not be satisfied after fix attempts',
  };
}
```

---

### ⚠️ U5: Console.error() indicates real problems

**Status**: **LIKELY PARTIAL - NEEDS EMPIRICAL TESTING**

**Evidence**:

- No direct code evidence found in source
- Grafana ecosystem is known to log:
  - Deprecation warnings
  - React development warnings
  - Third-party library warnings
  - Feature flag notifications

**Design Impact**: ⚠️ **MINOR CHANGE - ADD FILTERING**

The E2E runner should filter console errors:

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  const consoleErrors: string[] = [];

  // Filter out known false positives
  const IGNORED_PATTERNS = [
    /deprecated/i,
    /DevTools/,
    /Download the React DevTools/,
    /webpack/i,
    // Add more as discovered during testing
  ];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const isIgnored = IGNORED_PATTERNS.some((pattern) => pattern.test(text));
      if (!isIgnored) {
        consoleErrors.push(text);
      }
    }
  });

  // ... execute step

  return {
    stepId: step.stepId,
    status: 'passed',
    consoleErrors, // Only real errors
  };
}
```

**Recommendation**:

- Start with empty ignore list
- Run framework test guide and collect common warnings
- Build ignore list based on empirical data

---

### ⚠️ U6: Single DOM pass discovers all steps

**Status**: **LIKELY TRUE BUT MAY NEED RE-DISCOVERY**

**Evidence**:

- Interactive sections render all steps on mount (from `interactive-section.tsx`)
- Steps are React components - all rendered in initial tree
- **However**: Conditional rendering is possible:
  - Steps with unmet objectives may not render initially
  - Sections can be collapsed (lines 110, 181-190 in `interactive-section.tsx`)
  - User actions may cause React to render additional conditional content

**Design Impact**: ⚠️ **LOW RISK - DEFENSIVE APPROACH**

Single DOM pass likely works for most guides, but defensively re-check after major state changes:

```typescript
async function iterateSteps(page: Page): Promise<StepTestResult[]> {
  let steps = await discoverStepsFromDOM(page);
  const results: StepTestResult[] = [];
  let lastStepCount = steps.length;

  for (const step of steps) {
    const result = await executeStep(page, step);
    results.push(result);

    // After significant state changes (navigation, section completion),
    // re-discover steps to catch conditionally rendered content
    if (result.currentUrl !== results[0]?.currentUrl || result.sectionCompleted) {
      steps = await discoverStepsFromDOM(page);

      // If new steps appeared, log for diagnostics
      if (steps.length > lastStepCount) {
        console.log(`Re-discovery found ${steps.length - lastStepCount} new steps`);
        lastStepCount = steps.length;
      }
    }
  }

  return results;
}
```

**Recommendation**:

- Start with single-pass for MVP
- Add re-discovery if framework test guide fails due to missing steps
- Log when re-discovery finds new steps (indicates conditional rendering)

---

### ❌ U7: SequentialRequirementsManager doesn't interfere

**Status**: **FALSIFIED - BUT WORKS WITH MANAGER, NOT AGAINST IT**

**Evidence**:

- `src/requirements-manager/step-checker.hook.ts`:
  - Lines 199-228: Manager integration via context
  - Line 21: `SequentialRequirementsManager` is a core part of the system
  - Lines 210-228: `updateManager()` propagates state to other steps
- `src/requirements-manager/requirements-checker.hook.ts`:
  - Manager coordinates step state across sections
  - `triggerReactiveCheck()` called on step completion
  - Debounced rechecks: 500ms for context changes, 1200ms for DOM mutations

**Manager's Role**:

```typescript
// Lines 210-228: Manager receives step state updates
const updateManager = useCallback(
  (newState: typeof state) => {
    if (managerRef.current) {
      managerRef.current.updateStep(stepId, {
        isEnabled: newState.isEnabled,
        isCompleted: newState.isCompleted,
        isChecking: newState.isChecking,
        // ... propagate to next steps
      });
    }
  },
  [stepId, stepIndex]
);
```

**Design Impact**: ✅ **NO CHANGE - WORK WITH THE SYSTEM**

The manager is **intentional** and **beneficial** for E2E testing:

- Enforces sequential dependencies (already handled in U3)
- Triggers next step's requirements check when previous completes
- Debouncing prevents flakiness (waits for UI to settle)

**What E2E Runner Should Do**:

1. ✅ Execute steps in DOM order (already planned)
2. ✅ Wait for button to be enabled (already planned in U3 fix)
3. ✅ Let manager handle state propagation (no interference needed)
4. ✅ Trust the completion indicator (manager sets it correctly)

The manager is NOT interference - it's the **mechanism** that enables sequential guides. E2E tests validate that this mechanism works correctly.

**Recommendation**:

- No additional handling needed
- The debouncing (500ms/1200ms) is already factored into wait times
- Trust that when a button becomes enabled, the manager gave permission

---

### ⚠️ U10: Steps complete within 30 seconds

**Status**: **UNKNOWN - REQUIRES EMPIRICAL TESTING**

**Evidence**:

- No code analysis can determine worst-case timing
- Factors affecting duration:
  - Network latency (navigation steps)
  - DOM rendering time (complex forms)
  - Animation durations (from `interactive-config.ts`)
  - Multistep action count

**From `src/constants/interactive-config.ts`**:

```typescript
INTERACTIVE_CONFIG = {
  delays: {
    perceptual: {
      base: 800,
      button: 1500,
      hover: 2000,
    },
    technical: {
      navigation: 300,
      scroll: 500,
      highlight: 2500,
    },
    multiStep: {
      defaultStepDelay: 1800,
    },
  },
};
```

**Estimated Durations** (from design doc):
| Step Type | Actions | Estimated Duration |
|-----------|---------|-------------------|
| Simple highlight/button | 1 | 2-3s |
| Navigate | 1 | 5-10s |
| Formfill | 1 | 2-4s |
| Multistep | 3 | 6-10s |
| Multistep | 5 | 10-16s |

**Design Impact**: ⚠️ **NEEDS TESTING - DYNAMIC TIMEOUT**

Recommendation from design doc is sound:

- Start with generous 30s default
- Use completion detection (not fixed waits)
- Timeout is safety net, not expected completion mechanism

```typescript
function calculateStepTimeout(step: TestableStep): number {
  // Could enhance this based on step attributes if available:
  // - Multistep: read action count from DOM if exposed
  // - LazyRender: add extra buffer
  // For MVP: use generous default
  return 30000; // 30 seconds
}

async function waitForStepCompletion(page: Page, step: TestableStep): Promise<void> {
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(step.stepId));
  const timeout = calculateStepTimeout(step);

  await expect(completedIndicator).toBeVisible({ timeout });
}
```

**Recommendation**:

- Use 30s default for MVP
- Run framework test guide to capture actual timings
- If timeouts occur, analyze and adjust per-step-type
- Log actual durations to identify slow steps

---

## Risk Register

### High-Risk Findings (Require Design Changes)

| Finding                                            | Impact                                               | Mitigation                                                      | Status                       |
| -------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| **U1**: Steps without "Do it" buttons              | E2E runner will fail on noop/doIt:false steps        | Add pre-check for button existence, handle auto-completed steps | Required for Milestone L3-3A |
| **U3**: Buttons not always enabled when discovered | Race condition - clicking disabled buttons will fail | Use `.toBeEnabled()` matcher, wait for eligibility              | Required for Milestone L3-3B |

### Medium-Risk Findings (Require Adjustments)

| Finding                                | Impact                                           | Mitigation                             | Status                          |
| -------------------------------------- | ------------------------------------------------ | -------------------------------------- | ------------------------------- |
| **U2**: Pre-completed steps            | Unnecessary "Do it" clicks on already-done steps | Check completion before clicking       | Recommended for Milestone L3-3B |
| **U4**: Fix buttons can fail           | Test hangs or fails cryptically                  | Add timeout and max attempts for fixes | Required for Milestone L3-4B    |
| **U6**: Conditional rendering possible | May miss dynamically rendered steps              | Re-discover after major state changes  | Optional for MVP, add if needed |
| **U10**: Unknown max duration          | Flaky timeouts or unnecessary waiting            | Empirical testing with framework guide | Required for Milestone L3-3C    |

### Low-Risk Findings (Minor Adjustments)

| Finding                                | Impact                       | Mitigation            | Status          |
| -------------------------------------- | ---------------------------- | --------------------- | --------------- |
| **U5**: Console warnings produce noise | False positive error reports | Filter known warnings | Optional polish |
| **U7**: Manager actively coordinates   | None - works as designed     | No action needed      | Informational   |

---

## Updated Design Assumptions

Based on verification results, update the "Assumptions" section of the design document:

### Remove (Falsified):

- ❌ "All steps have 'Do it' buttons" → FALSE
- ❌ "Steps are always clickable when discovered" → FALSE
- ❌ "Fix buttons always succeed" → FALSE

### Update (Qualified):

- ⚠️ "Single DOM pass discovers all steps" → TRUE for most guides, re-check after major state changes
- ⚠️ "Completion indicator appears after 'Do it' click" → TRUE for manual completion, but check for pre-completion first

### Add (New Findings):

- ✅ "Noop steps auto-complete when eligible (no user interaction required)"
- ✅ "Steps can complete via objectives without clicking 'Do it'"
- ✅ "Section sequential dependencies enforce step order via isEligibleForChecking"
- ✅ "SequentialRequirementsManager coordinates state across steps (intentional, not interference)"

---

## Recommendations for Implementation

### Milestone L3-1B: JSON Loading Infrastructure (Ready to Implement)

- ✅ localStorage is reliable (U8 verified)
- ✅ No blocking issues for JSON injection mechanism
- **Proceed as designed**

### Milestone L3-3A: Step Discovery (Changes Required)

```typescript
interface TestableStep {
  stepId: string;
  index: number;
  sectionId?: string;
  skippable: boolean;
  // NEW FIELDS based on verification:
  hasDoItButton: boolean; // U1: Check if button exists
  isPreCompleted: boolean; // U2: Check if already done
  targetAction?: string; // For logging/diagnostics
}

async function discoverStepsFromDOM(page: Page): Promise<TestableStep[]> {
  const stepElements = await page.locator('[data-testid^="interactive-step-"]').all();

  const steps: TestableStep[] = [];
  for (const element of stepElements) {
    const testId = await element.getAttribute('data-testid');
    const stepId = testId?.replace('interactive-step-', '') ?? '';

    // Check if "Do it" button exists (U1)
    const doItButton = page.getByTestId(testIds.interactive.doItButton(stepId));
    const hasDoItButton = (await doItButton.count()) > 0;

    // Check if already completed (U2)
    const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(stepId));
    const isPreCompleted = await completedIndicator.isVisible();

    steps.push({
      stepId,
      index: steps.length,
      hasDoItButton,
      isPreCompleted,
      skippable: false, // TODO: detect from DOM if possible
    });
  }

  return steps;
}
```

### Milestone L3-3B: Step Execution (Changes Required)

```typescript
async function executeStep(page: Page, step: TestableStep): Promise<StepTestResult> {
  const startTime = Date.now();

  // Handle pre-completed steps (U2 - objectives/noop)
  if (step.isPreCompleted) {
    return {
      stepId: step.stepId,
      status: 'passed',
      duration: Date.now() - startTime,
      note: 'Pre-completed (objectives satisfied or noop action)',
    };
  }

  // Handle steps without "Do it" button (U1)
  if (!step.hasDoItButton) {
    return {
      stepId: step.stepId,
      status: 'skipped',
      duration: Date.now() - startTime,
      skipReason: 'No "Do it" button (doIt: false or special step type)',
    };
  }

  // Wait for button to be enabled (U3 - sequential dependencies)
  const doItButton = page.getByTestId(testIds.interactive.doItButton(step.stepId));
  await expect(doItButton).toBeEnabled({ timeout: 5000 });

  // Click button
  await doItButton.click();

  // Wait for completion indicator
  const completedIndicator = page.getByTestId(testIds.interactive.stepCompleted(step.stepId));
  await expect(completedIndicator).toBeVisible({ timeout: 30000 });

  return {
    stepId: step.stepId,
    status: 'passed',
    duration: Date.now() - startTime,
  };
}
```

### Milestone L3-3C: Timing (Empirical Testing Required)

- Use framework test guide to capture actual durations
- Log min/max/avg per step type
- Adjust timeouts based on data

### Milestone L3-4B: Fix Button Execution (Changes Required)

- Limit fix attempts to 3 (not 10) for faster failure
- Add 10s timeout per fix operation
- Handle failures gracefully based on `skippable` flag

---

## Conclusion

**L3 Phase 1 verification is COMPLETE**. Of 10 assumptions:

- ✅ **2 verified true** (U8, U9)
- ⚠️ **4 partially true** (U2, U5, U6, U10) - require adjustments
- ❌ **4 falsified** (U1, U3, U4, U7) - require design changes

**Critical findings** (U1, U3) necessitate changes to Milestone L3-3A/L3-3B but do **not** block implementation. The findings actually **improve** the design by addressing real-world behavior.

**Next Steps**:

1. ✅ Update design document with corrected assumptions
2. ✅ Implement Milestone L3-1B (JSON loading) - no blockers
3. ✅ Proceed to Milestone L3-2A (CLI scaffolding) - no blockers
4. ⚠️ Apply findings when implementing Milestone L3-3A/L3-3B (step discovery and execution)

**Overall Risk Assessment**: ✅ **LOW** - All findings are addressable with code changes. No architectural blockers discovered.
