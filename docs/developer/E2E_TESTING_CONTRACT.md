# E2E testing contract: data-test-\* attributes

The Pathfinder interactive system exposes a stable testing contract via `data-test-*` attributes on step elements and comment boxes. This contract enables reliable E2E testing without depending on implementation details like CSS classes, text content, or DOM structure.

For prescriptive agent constraints on testing strategy, see `.cursor/rules/testingStrategy.mdc`.

## Overview

The interactive system maintains **two sets of data attributes** with distinct purposes:

### Runtime action attributes

Used by the interactive engine to coordinate action execution and state management. These are **imperative** - they describe what action should be performed.

Examples: `data-targetaction`, `data-reftarget`, `data-targetvalue`, `data-step-id`

See: [`docs/developer/interactive-examples/json-guide-format.md`](./interactive-examples/json-guide-format.md)

### Testing contract attributes

Used by E2E tests to observe the current state of the interactive system. These are **declarative** - they describe what state the component is in.

Examples: `data-test-step-state`, `data-test-substep-index`, `data-test-action`

**This document describes the E2E testing contract attributes.**

---

## Docs panel bootstrap contract

The guide runner must establish a ready Pathfinder panel before it can load guide content or discover steps. These signals form the stable contract between the plugin surface and `tests/e2e-runner/`:

- **Plugin readiness**: `window.__pathfinderPluginConfig` is assigned when Pathfinder initialization completes. The runner waits for this before treating Grafana's Help control as a Pathfinder open action.
- **Sidebar mount**: the outer Pathfinder sidebar dispatches `pathfinder-sidebar-mounted` on `window` after Grafana accepts the extension-sidebar open request. The runner uses this event to avoid a duplicate Help click; because it is an edge signal rather than current mounted state, post-click readiness still requires the panel DOM.
- **Panel readiness**: the inner panel renders `data-testid="docs-panel-container"` when it is ready for guide content. Once this container is visible, the panel must be able to receive the content-open event below.
- **Content open**: the panel listens for `pathfinder-auto-open-docs` on `document` with detail `{ url: string; title: string; source?: string }`.

The Grafana-owned Help button and `grafana.navigation.extensionSidebarDocked` storage entry are recovery hints, not Pathfinder-owned contracts. A docs-panel or sidebar refactor must preserve the four Pathfinder signals above, or update the guide runner, contract tests, and this document in the same change.

The source-level tripwires live in `src/components/docs-panel/docs-panel.contract.test.tsx` and `src/components/docs-panel/docs-panel.auto-open-event.test.tsx`.

---

## Block editor header contract

The block-editor header exposes two stable row testids that responsive e2e tests depend on to assert the two-row layout holds at narrow widths:

- **`block-editor-title-row`** (`testIds.blockEditor.titleRow`): the editable title + status cluster row. Rendered in edit/JSON view; hidden entirely in preview.
- **`block-editor-toolbar-row`** (`testIds.blockEditor.toolbarRow`): the view-mode rocker + action cluster row, present in every view. In preview the status cluster relocates here, so `tests/block-editor-title-row.spec.ts` selects it to assert status stays visible at the 320px floating-panel minimum.

A header refactor that renames or removes these rows must update `tests/block-editor-title-row.spec.ts` in the same change.

---

## My learning page contract

The My learning page exposes stable section and action testids so E2E tests can assert progress partitioning and launch specific Discover more paths without depending on text or DOM structure:

- **`my-learning-courses-section`** (`testIds.learningPaths.myCoursesSection`): the My courses section boundary.
- **`my-learning-badges-section`** (`testIds.learningPaths.badgesSection`): the badges section boundary.
- **`my-learning-discover-section`** (`testIds.learningPaths.discoverMoreSection`): the Discover more section boundary.
- **`my-learning-completed-section`** (`testIds.learningPaths.completedSection`): the completed-paths section boundary.
- **`discover-more-card-${id}`** (`testIds.learningPaths.discoverMoreCard(id)`): a Discover more card keyed by its upstream package ID.
- **`discover-more-start-${id}`** (`testIds.learningPaths.discoverMoreStart(id)`): the start action for that upstream package ID.
- **`discover-more-expand-${id}`** (`testIds.learningPaths.discoverMoreExpand(id)`): the description disclosure for that upstream package ID. Only rendered when the package index supplies a description — there is nothing to reveal otherwise.

A My learning layout or selector refactor must preserve these values or update the E2E selectors and this document in the same change.

---

## Badge celebration runner contract

After a guide completes, Pathfinder can show a full-screen badge celebration before the runner starts the next action.

The runner and plugin share these stable test IDs:

- **`learning-paths-badge-toast`** (`testIds.learningPaths.badgeToast`): identifies the visible badge dialog.
- **`learning-paths-badge-toast-dismiss`** (`testIds.learningPaths.badgeToastDismiss`): identifies the dismiss action inside the current dialog.

The runner uses only these selectors. It does not close generic Grafana modals.

If a refactor changes these values, update `BadgeUnlockedToast.tsx`, the guide runner, the contract test, and this document in the same change.

The source-level tripwire lives in `src/components/LearningPaths/BadgeUnlockedToast.contract.test.ts`.

---

## Design Principles

### 1. Semantic Over Syntactic

Attributes expose **semantic state** rather than raw DOM details:

- ✅ `data-test-step-state="executing"` (semantic)
- ❌ Checking for spinner elements or "Executing..." text (syntactic)

### 2. Stability

These attributes form a **stable contract**:

- Changes require coordination with the E2E test suite
- Contract tests enforce correctness at build time
- Valid values are defined in TypeScript constants

### 3. Separation of Concerns

- **Runtime action attributes** → Internal state machine (action parameters)
- **Test attributes** → External testing interface (observable state)

### 4. DOM as Public Interface

The DOM is the natural boundary for testing a UI system. By exposing structured attributes, E2E tests can:

- Avoid parsing JSON strings or UI text
- Remain stable through UI refactors
- Work across different testing frameworks

---

## Attribute Reference

### Step Components

Applied to `InteractiveStep`, `InteractiveMultiStep`, and `InteractiveGuided` elements.

#### `data-test-step-state`

**Purpose**: Current execution state of the step

**Values**: See `STEP_STATES` in `src/components/interactive-tutorial/step-states.ts`

- `idle` - Ready to execute, waiting for user
- `checking` - Verifying requirements
- `executing` - Action in progress
- `completed` - Step successfully completed
- `error` - Execution failed
- `cancelled` - User cancelled execution
- `requirements-unmet` - Prerequisites not satisfied

**Example**:

```html
<div class="interactive-step" data-test-step-state="executing">
  <!-- Step content -->
</div>
```

**Usage in tests**:

```typescript
// Wait for step to start executing
await page.waitForSelector('[data-test-step-state="executing"]');

// Wait for completion
await page.waitForSelector('[data-test-step-state="completed"]');
```

---

#### `data-test-substep-index`

**Purpose**: Current substep index during multi-step or guided execution

**Values**: `0`, `1`, `2`, ... (zero-based index)

**Presence**: Only present during execution (`data-test-step-state="executing"`)

**Example**:

```html
<div
  class="interactive-guided"
  data-test-step-state="executing"
  data-test-substep-index="2"
  data-test-substep-total="5"
>
  <!-- Currently on substep 3 of 5 -->
</div>
```

**Usage in tests**:

```typescript
// Wait for specific substep
await page.waitForSelector('[data-test-substep-index="2"]');

// Get progress
const stepElement = await page.locator('[data-test-step-state="executing"]');
const currentIndex = await stepElement.getAttribute('data-test-substep-index');
const totalSteps = await stepElement.getAttribute('data-test-substep-total');
console.log(`Progress: ${parseInt(currentIndex) + 1}/${totalSteps}`);
```

---

#### `data-test-substep-total`

**Purpose**: Total number of substeps in the sequence

**Values**: `1`, `2`, `3`, ... (positive integers)

**Presence**: Always present on multi-step and guided components

**See**: `data-test-substep-index` example above

---

#### `data-test-fix-type`

**Purpose**: Classification of requirement fix needed when requirements are unmet

**Values**: See `FIX_TYPES` in `src/components/interactive-tutorial/step-states.ts`

- `none` - No fix needed or no fix available
- `navigation` - Need to open/expand navigation menu
- `lazy-scroll` - Element not visible, needs scroll discovery
- `location` - Wrong page/route
- `expand-parent-navigation` - Parent nav section collapsed

**Example**:

```html
<div class="interactive-step" data-test-step-state="requirements-unmet" data-test-fix-type="navigation">
  <!-- User needs to open navigation first -->
</div>
```

**Usage in tests**:

```typescript
// Detect fixable requirement failures
const fixType = await page.locator('[data-test-step-state="requirements-unmet"]').getAttribute('data-test-fix-type');

if (fixType === 'navigation') {
  // Click the Fix button or manually open nav
  await page.click('[data-testid*="requirement-fix"]');
}
```

---

#### `data-test-requirements-state`

**Purpose**: Status of requirement checking

**Values**: See `REQUIREMENTS_STATES` in `src/components/interactive-tutorial/step-states.ts`

- `met` - All requirements satisfied, step is enabled
- `unmet` - Requirements failed, step is blocked
- `checking` - Currently validating requirements
- `unknown` - No requirements defined or check hasn't run

**Example**:

```html
<div class="interactive-step" data-test-requirements-state="checking">
  <!-- Spinner shown, checking if step can run -->
</div>
```

---

#### `data-test-form-state`

**Purpose**: Validation state for formfill actions (only present on formfill steps)

**Values**: See `FORM_STATES` in `src/components/interactive-tutorial/step-states.ts`

- `idle` - No validation in progress
- `checking` - Debouncing input, validation pending
- `valid` - Input matches expected pattern
- `invalid` - Input doesn't match expected pattern

**Example**:

```html
<div class="interactive-step" data-targetaction="formfill" data-test-form-state="checking">
  <!-- User is typing, waiting for debounce -->
</div>
```

**Usage in tests**:

```typescript
// Fill form and wait for validation
await page.fill('input[name="email"]', 'user@example.com');
await page.waitForSelector('[data-test-form-state="valid"]', { timeout: 3000 });
```

---

### Comment Boxes

Applied to comment box elements created by `NavigationManager` and `GuidedHandler`.

#### `data-test-action`

**Purpose**: Action type being performed (on comment boxes during guided execution)

**Values**: `button`, `formfill`, `highlight`, `hover`, `noop`

**Example**:

```html
<div class="interactive-comment-box" data-test-action="formfill">
  <!-- Comment box guiding user to fill a form -->
</div>
```

**Implementation**: Applied via `applyE2ECommentBoxAttributes()` in `src/interactive-engine/e2e-attributes.ts`

**Noop actions**: A noop is an informational step with no target element (no click, formfill, or highlight). A centered comment box is shown; both `NavigationManager.showNoopComment()` and GuidedHandler's noop path set `data-noop="true"` and `data-test-action="noop"`. Used for guided noop steps and for multi-step noop steps (e.g. intro text).

---

#### `data-test-target-value`

**Purpose**: Expected value for formfill actions (Tier 2 attribute)

**Values**: String value that the form field should contain

**Example**:

```html
<div class="interactive-comment-box" data-test-action="formfill" data-test-target-value="username@example.com">
  <!-- E2E test can validate that form is filled with correct value -->
</div>
```

---

#### `data-test-reftarget`

**Purpose**: Selector string for the current target element so the E2E runner can drive actions from the DOM only (no guide JSON dependency).

**Values**: CSS selector or other selector string that resolves to the current target (e.g. `[data-testid="submit-btn"]`, `.btn-primary`).

**Presence**: Set only when the action has a target (button, highlight, formfill, hover). **Absent for noop** (informational step with no target).

**Example**:

```html
<div class="interactive-comment-box" data-test-action="button" data-test-reftarget="[data-testid='create-dashboard']">
  <!-- E2E can locate and click the target using the reftarget selector -->
</div>
```

**Usage in tests**: Read `data-test-reftarget` from `.interactive-comment-box` together with `data-test-action` and `data-test-target-value` to perform the current substep (click, fill, hover) without parsing guide JSON.

---

## Implementation Details

### Constants and Type Safety

All valid attribute values are defined in `src/components/interactive-tutorial/step-states.ts`:

```typescript
export const STEP_STATES = {
  IDLE: 'idle',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  // ...
} as const;

export type StepStateValue = (typeof STEP_STATES)[keyof typeof STEP_STATES];
```

This ensures:

- **Type safety** in React components
- **Single source of truth** for valid values
- **Easy refactoring** if values need to change

### Comment Box Attribute Helper

`src/interactive-engine/e2e-attributes.ts` provides a shared helper for DOM-created elements:

```typescript
import { applyE2ECommentBoxAttributes } from './e2e-attributes';

const commentBox = document.createElement('div');
applyE2ECommentBoxAttributes(commentBox, {
  actionType: 'formfill',
  targetValue: 'username@example.com',
});
```

This ensures consistency between:

- `NavigationManager.highlightWithComment()`
- `NavigationManager.showNoopComment()` (for noop comment boxes)
- `GuidedHandler.executeGuidedStep()`

### React Component Integration

React components derive attributes from existing UI state:

```tsx
// interactive-guided.tsx / interactive-multi-step.tsx
<div
  data-test-step-state={
    isExecuting
      ? 'executing'
      : hasError
        ? 'error'
        : isCompleted
          ? 'completed'
          : isChecking
            ? 'checking'
            : !isEnabled
              ? 'requirements-unmet'
              : 'idle'
  }
  data-test-substep-index={isExecuting ? currentIndex : undefined}
/>
```

For multi-step components, `executing` takes precedence over `completed`. A multi-step `completeEarly` write can occur before its automated actions settle.

For guided components, `executing` also takes precedence during a narrower final-action window. Final click activation can persist while the application handler and guided cleanup settle.

After composite execution settles, genuine objectives completion is authoritative. It suppresses stale local error or cancellation state.

For multi-step execution, a `completeEarly` write alone does not suppress an error. For guided execution, callback failure becomes an error before completion wins. Successful final-action persistence keeps the completed outcome if later setup or cleanup fails.

`InteractiveStep` also prioritizes active execution, but after execution settles it lets `completed` override a stale local error because completed rendering suppresses its error affordances. The `cancelled` state applies only to guided execution.

**Key insight**: Attributes ARE the source of truth for rendered state. If they're wrong, the UI is wrong, so tests catch real bugs.

---

## Contract Tests

### Purpose

Contract tests enforce the stability of E2E attributes at build time, preventing drift between attributes and actual UI state.

### Location

- `src/components/interactive-tutorial/data-attributes.contract.test.tsx` - React component attributes
- `src/interactive-engine/comment-box.contract.test.ts` - DOM-created element attributes
- `src/components/docs-panel/docs-panel.contract.test.tsx` - Docs panel test IDs (constant values, source reference mapping, auto-derived exhaustiveness, window globals, scroll-restoration)
- `src/components/LearningPaths/BadgeUnlockedToast.contract.test.ts` - Badge celebration test IDs and source references

### Pattern: Dual Assertion

Each test verifies:

1. The attribute exists and has the correct value
2. The corresponding UI state matches the attribute

### Example

```typescript
it('has data-test-step-state attribute', () => {
  render(<InteractiveStep stepId="test" targetAction="button" refTarget=".btn" />);

  const element = screen.getByTestId(testIds.interactive.step('test'));

  // Attribute exists
  expect(element).toHaveAttribute('data-test-step-state');

  // Value is valid
  const stateValue = element.getAttribute('data-test-step-state');
  expect(Object.values(STEP_STATES)).toContain(stateValue);
});
```

### Running Contract Tests

```bash
npm run test:ci  # Includes contract tests
npm test -- data-attributes.contract  # Run specific contract tests
```

---

## E2E Test Integration

### Selector Patterns

**Recommended**: Use attribute selectors for stable queries

```typescript
// ✅ Good - semantic state selector
await page.waitForSelector('[data-test-step-state="completed"]');

// ✅ Good - combine with step ID for specificity
await page.waitForSelector('[data-step-id="create-dashboard"][data-test-step-state="idle"]');

// ❌ Bad - fragile to UI changes
await page.waitForSelector('.interactive-step.completed');
await page.getByText('Step completed');
```

### Waiting for State Transitions

```typescript
// Wait for step to become ready
await page.waitForSelector('[data-test-step-state="idle"]', { timeout: 5000 });

// Click "Do it" button
await page.click('[data-testid="do-it-button"]');

// Wait for execution
await page.waitForSelector('[data-test-step-state="executing"]');

// Wait for completion
await page.waitForSelector('[data-test-step-state="completed"]', { timeout: 30000 });
```

### Guided steps

Guided steps run a substep loop driven by the comment box. The runner uses only the DOM and contract attributes (no guide JSON):

1. **Wait for execution to start**: After clicking "Do it", wait for the step element to have `data-test-step-state="executing"`.
2. **Read substep bounds**: From the step element, read `data-test-substep-index` (current substep, 0-based) and `data-test-substep-total` (total substeps).
3. **Locate the comment box**: Use `.interactive-comment-box` (visible while the guided step is executing).
4. **Read the comment box contract**: From the comment box, read `data-test-action` (e.g. `button`, `highlight`, `formfill`, `hover`, `noop`), `data-test-reftarget` (selector for the current target; see [Comment Boxes](#comment-boxes) — absent for noop), and `data-test-target-value` (for formfill).
5. **Perform the substep**: For noop, click the Continue button; for button/highlight, resolve the target from `data-test-reftarget` and click; for hover, resolve and hover; for formfill, resolve and fill with `data-test-target-value`.
6. **Wait for advance**: Poll the step element until `data-test-substep-index` increases or `data-test-step-state` becomes `"completed"`. If the step becomes `"error"` or `"cancelled"`, fail.

Completion is standardized on `data-test-step-state="completed"` for all step types (single, multistep, guided).

The runner applies the calculated timeout to the complete step operation. If the deadline expires, it closes the page and reports a guide failure.

During active step execution, an unexpected page, context, or browser termination produces an infrastructure outcome. The runner retains results from steps that completed before the termination.

```typescript
// Wait for guided execution to start
await page.waitForSelector('[data-test-step-state="executing"]');

// Read substep progress from step element
const stepElement = page.locator('[data-testid="interactive-step-my-step"]');
const totalStr = await stepElement.getAttribute('data-test-substep-total');
const total = parseInt(totalStr ?? '1', 10);

// Each substep: read comment box, perform action, wait for advance
const commentBox = page.locator('.interactive-comment-box').first();
const action = await commentBox.getAttribute('data-test-action');
const reftarget = await commentBox.getAttribute('data-test-reftarget');
const targetValue = await commentBox.getAttribute('data-test-target-value');
// ... resolve target from reftarget, then click/fill/hover per action ...

// Wait for completion
await page.waitForSelector('[data-test-step-state="completed"]');
```

### Handling Requirement Failures

```typescript
// Check if requirements are unmet
const requirementsState = await page.getAttribute('[data-step-id="my-step"]', 'data-test-requirements-state');

if (requirementsState === 'unmet') {
  const fixType = await page.getAttribute('[data-step-id="my-step"]', 'data-test-fix-type');

  if (fixType !== 'none') {
    // Click fix button
    await page.click('[data-testid*="requirement-fix"]');

    // Wait for requirements to be met
    await page.waitForSelector('[data-test-requirements-state="met"]');
  }
}
```

---

### Skip controls and runner synchronization

The plugin renders two Skip controls that both call the same underlying `markSkipped()` action:

- **`interactive-skip-${stepId}`** (`testIds.interactive.skipButton`): the step's always-available Skip button. It renders whenever the step is skippable, is not a noop action, and is not already completed, regardless of requirements state. Step discovery uses this control to determine `step.skippable`.
- **`interactive-requirement-skip-${stepId}`** (`testIds.interactive.requirementSkipButton`): a narrower Skip button rendered only inside the requirements-explanation banner when requirements have failed. `detectRequirements()` reports this control's presence as `hasSkipButton`.

A test or runner that needs to skip a step should prefer the step-level control and fall back to the requirement-scoped one only when the step-level control is not rendered, so it supports whichever shape the plugin actually renders instead of assuming one fixed control.

Clicking either control does not skip the step immediately from the runner's point of view. The runner must wait for `data-test-step-state` to reach a terminal value, `completed`, or for the step element to detach, before treating the step as skipped. A transient value such as `checking` is not a terminal state; a runner that stops polling on the first non-`requirements-unmet` value can record a false skip while the plugin is still mid-transition.

```typescript
// Prefer the step-level Skip control; fall back to the requirement-scoped one.
const stepSkip = page.getByTestId(testIds.interactive.skipButton(stepId));
const requirementSkip = page.getByTestId(testIds.interactive.requirementSkipButton(stepId));
const skipButton = (await stepSkip.count()) > 0 ? stepSkip : requirementSkip;
await skipButton.click();

// Wait for a terminal state before treating the step as skipped.
await page.waitForSelector('[data-step-id="my-step"][data-test-step-state="completed"]');
```

---

## Versioning and Stability

### Current Version

The E2E testing contract is at **version 1** (implicit). There is no explicit version attribute yet.

### Breaking Changes

Changes that break the contract (require E2E test updates):

- Renaming attributes (e.g., `data-test-step-state` → `data-test-state`)
- Removing attributes
- Changing valid values (e.g., `idle` → `ready`)
- Changing when attributes appear/disappear

### Non-Breaking Changes

Changes that don't break the contract:

- Adding new attributes
- Adding new valid values (if E2E tests use allowlists, not blocklists)
- Adding attributes to more elements
- Internal implementation changes that maintain the same attribute contract

### Future: Explicit Versioning

Consider adding `data-test-version="v1"` to step elements. This allows:

- E2E tests to detect contract version
- Gradual migration when the contract changes
- Clear signaling of breaking vs. non-breaking changes

---

## Related Documentation

- [E2E Testing Guide](./E2E_TESTING.md) - E2E test runner and CLI
- [Interactive Engine](./engines/interactive-engine.md) - Interactive system architecture
- [JSON Guide Format](./interactive-examples/json-guide-format.md) - Block types, properties, and action types reference
- [Requirements Manager](./engines/requirements-manager.md) - Requirements checking system

---

## Maintenance Guidelines

### Adding New Attributes

1. Define constants in `step-states.ts` with valid values (if applicable)
2. Add TypeScript type for the values
3. Apply attribute in React component or use `applyE2ECommentBoxAttributes()` (for comment box attributes, add to `E2ECommentBoxAttributeOptions` in `e2e-attributes.ts`)
4. Add contract test in `data-attributes.contract.test.tsx` or `comment-box.contract.test.ts`
5. Document in this file (Comment Boxes or Step Components as appropriate)
6. Update E2E test selectors if needed

### Changing Existing Attributes

1. **Don't** change attribute names or values unless absolutely necessary
2. If you must change:
   - Coordinate with E2E test maintainers
   - Update contract tests first (TDD approach)
   - Update this documentation
   - Consider deprecation period for values
3. Run full E2E test suite to verify no breakage

### Deprecating Attributes

1. Add new attribute alongside old one
2. Update E2E tests to use new attribute
3. Wait 2-3 releases
4. Remove old attribute and update contract tests

---

## Troubleshooting

### "Attribute not found" in E2E tests

**Symptom**: `await page.waitForSelector('[data-test-step-state="idle"]')` times out

**Causes**:

- Step hasn't mounted yet (wait for `[data-step-id="..."]` first)
- Step is in a different state (check actual state with `getAttribute()`)
- Typo in attribute name or value
- Step was removed from DOM (check with `locator().count()`)

**Debug**:

```typescript
// Check what state the step is actually in
const actualState = await page.getAttribute('[data-step-id="my-step"]', 'data-test-step-state');
console.log(`Expected: idle, Actual: ${actualState}`);
```

### Contract test failures

**Symptom**: `data-attributes.contract.test.tsx` fails after component changes

**Cause**: Attribute contract changed (intentionally or accidentally)

**Fix**:

1. If intentional: Update contract test and coordinate with E2E tests
2. If accidental: Restore original attribute behavior

### Attributes out of sync with UI

**Symptom**: `data-test-step-state="completed"` but UI still shows "Do it" button

**Cause**: Bug in state derivation logic

**Debug**:

1. Check component's state variables in React DevTools
2. Trace attribute derivation in `src/components/interactive-tutorial/interactive-step.tsx`
3. Verify contract test covers this scenario

**Prevention**: Contract tests should catch these issues, but only if they verify both attribute AND UI state.

---

## FAQ

### Why separate attributes for testing vs. internal state?

**Separation of concerns**. Internal attributes (`data-targetaction`) describe what the component should _do_. Test attributes (`data-test-step-state`) describe what the component _is doing right now_. Mixing these creates tight coupling between tests and implementation.

### Why not use CSS classes for E2E tests?

CSS classes are implementation details that change during refactoring. Attributes form a **public contract** that's explicitly maintained and tested.

### Why not use ARIA attributes?

ARIA attributes are for accessibility, not testing. Overloading them for testing creates semantic confusion and can confuse screen readers.

### Can I use these attributes for non-E2E tests?

Yes! They're useful for:

- Integration tests checking state transitions
- Visual regression tests that need to wait for specific states
- Manual QA workflows that inspect the DOM
- Browser extensions that enhance Pathfinder

### What if I need an attribute that doesn't exist?

1. Check if existing attributes can solve your need
2. If not, propose a new attribute following the "Adding New Attributes" guidelines
3. Consider if it belongs in the testing contract or is a one-off need
