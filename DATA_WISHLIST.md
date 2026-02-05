# E2E Contract: Data Attribute Wishlist

## Why this matters

The E2E CLI runner currently "walks the DOM" to discover and execute interactive guide steps. This involves:

- Checking multiple DOM indicators to infer state (spinners, buttons, completion icons)
- Parsing JSON from `data-internal-actions` attributes
- Parsing UI text to guess fix types ("navigation", "location", etc.)
- Polling for completion with no signal when state changes
- No visibility into guided block sub-step progress

This creates **fragile, complex E2E code** that can break when UI changes, and introduces race conditions when the E2E runner's mental model diverges from the interactive system's actual state.

## The E2E Contract pattern

Instead of the E2E runner inferring state from scattered DOM signals, the interactive system should **expose its state explicitly** via `data-*` attributes. This creates a stable contract:

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERACTIVE SYSTEM                                             │
│  "I will expose my current state via data-* attributes"         │
│                                                                 │
│  Guarantees:                                                    │
│  • Attributes set synchronously during DOM creation/render      │
│  • Attributes reflect committed state, not pending state        │
│  • Attributes are read-only exposure (no side effects)          │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│  E2E RUNNER                                                     │
│  "I will navigate purely by reading the DOM"                    │
│                                                                 │
│  Guarantees:                                                    │
│  • No JSON parsing for action metadata                          │
│  • No state tracking beyond what DOM shows                      │
│  • Wait for stable DOM state before acting                      │
└─────────────────────────────────────────────────────────────────┘
```

## Constraints on this wishlist

Each attribute in the wishlist must:

1. **Have stable state** — Set synchronously during React render or DOM creation (no async timing issues that cause race conditions)
2. **Reflect committed state** — Show what IS, not what MIGHT BE (no optimistic updates)
3. **Be read-only** — E2E only reads these attributes, never writes them
4. **Match guide semantics** — Values should align with how interactive guides are structured conceptually
5. **Be directly useful** — Each attribute should eliminate specific complex/fragile E2E code

### Naming convention

All attributes use the `data-test-*` prefix to:

- Clearly indicate these are for E2E testing
- Avoid conflicts with existing `data-*` attributes
- Allow easy stripping from production builds if desired

---

## The wishlist

### 1. Step-level state

#### `data-test-step-state`

**Values**: `idle` | `checking` | `requirements-unmet` | `executing` | `completed` | `error` | `cancelled`

**Location**: On the step element (`[data-testid^="interactive-step-"]`)

**Justification**: The runner currently infers step state by checking multiple indicators:

- Is completion indicator visible? (`[data-testid="interactive-step-completed-*"]`)
- Is spinner visible? (`.interactive-requirement-spinner`)
- Is explanation visible? (`[data-testid="interactive-requirement-*"]`)
- Is "Do it" button disabled?

A single `data-test-step-state` attribute eliminates this multi-check logic:

```typescript
// Before (fragile, multiple checks):
const isCompleted = await completedIndicator.isVisible();
const hasSpinner = (await spinner.count()) > 0;
const hasExplanation = (await explanation.count()) > 0;
// ... complex logic to determine state

// After (single read):
const state = await element.getAttribute('data-test-step-state');
```

---

#### `data-test-step-type`

**Values**: `simple` | `multistep` | `guided` | `noop`

**Location**: On the step element

**Justification**: Currently the runner checks `data-targetaction` and compares against string values. An explicit type attribute is cleaner and doesn't rely on action semantics:

```typescript
// Before:
const targetAction = await element.getAttribute('data-targetaction');
if (targetAction === 'multistep') {
  /* special handling */
}
if (targetAction === 'guided') {
  /* different handling */
}
if (targetAction === 'noop') {
  /* skip */
}

// After:
const stepType = await element.getAttribute('data-test-step-type');
```

---

#### `data-test-completion-reason`

**Values**: `action` | `objectives` | `skipped` | `auto` | `early`

**Location**: On the step element when `data-test-step-state="completed"`

**Justification**: For debugging and test assertions, it's useful to know WHY a step completed:

- `action` — User/E2E clicked "Do it" and action completed normally
- `objectives` — Step auto-completed because objectives were satisfied
- `skipped` — User/E2E clicked "Skip"
- `auto` — Step was a noop that auto-completed
- `early` — Step had `completeEarly: true` flag

```typescript
const reason = await element.getAttribute('data-test-completion-reason');
if (reason === 'objectives') {
  console.log('Step auto-completed via objectives before we clicked Do it');
}
```

---

### 2. Sub-step state (guided & multistep)

#### `data-test-substep-index`

**Values**: `0`, `1`, `2`, ... (0-based index)

**Location**: On the step element during execution

#### `data-test-substep-total`

**Values**: `1`, `2`, `3`, ...

**Location**: On the step element

**Justification**: For guided blocks and multisteps, the runner currently has no visibility into internal progress without:

- Parsing JSON from `data-internal-actions` (fragile, complex)
- Parsing "Step 1 of 3" text from the UI (very fragile)

With explicit attributes:

```typescript
// Before (parse JSON, track internally):
const internalActionsJson = await element.getAttribute('data-internal-actions');
const actions = JSON.parse(internalActionsJson);
// ... track stepIndex manually as we execute

// After (just read):
const current = parseInt(await element.getAttribute('data-test-substep-index'));
const total = parseInt(await element.getAttribute('data-test-substep-total'));
```

---

### 3. Comment box / highlight action attributes

When the interactive system highlights an element and shows a comment box, the E2E runner needs to know what action to perform.

#### `data-test-action`

**Values**: `highlight` | `button` | `hover` | `formfill` | `navigate` | `noop`

**Location**: On `.interactive-comment-box` when created

#### `data-test-target-value`

**Values**: The `targetvalue` string (for formfill, etc.)

**Location**: On `.interactive-comment-box` when the action has a value

#### `data-test-action-state`

**Values**: `waiting` | `executing` | `completed` | `failed`

**Location**: On `.interactive-comment-box`

**Justification**: Currently the runner would need to:

1. Parse the step's `data-internal-actions` JSON
2. Track which sub-step we're on
3. Look up the action type and value from the parsed array

With explicit attributes on the comment box:

```typescript
const commentBox = page.locator('.interactive-comment-box[data-ready="true"]');
const actionType = await commentBox.getAttribute('data-test-action');
const targetValue = await commentBox.getAttribute('data-test-target-value');

switch (actionType) {
  case 'formfill':
    await target.fill(targetValue);
    break;
  case 'hover':
    await target.hover();
    break;
  case 'noop':
    await commentBox.locator('button:has-text("Continue")').click();
    break;
  default: // highlight, button
    await target.click();
}
```

---

### 4. Requirements state attributes

#### `data-test-requirements-state`

**Values**: `met` | `unmet` | `checking` | `unknown`

**Location**: On the step element

**Justification**: The runner currently infers requirement status by checking:

- Is spinner visible?
- Is explanation element visible?
- Are fix/retry/skip buttons present?
- Is "Do it" button enabled?

A single attribute simplifies this:

```typescript
// Before (complex inference):
const hasExplanation = (await explanationElement.count()) > 0;
const hasSpinner = hasExplanation
  ? (await explanationElement.locator('.interactive-requirement-spinner').count()) > 0
  : false;
// ... more checks

// After:
const reqState = await element.getAttribute('data-test-requirements-state');
```

---

#### `data-test-fix-type`

**Values**: `navigation` | `location` | `expand-parent-navigation` | `lazy-scroll` | `none`

**Location**: On the step element when requirements are unmet and fixable

**Justification**: This is the **most fragile** part of the current E2E code. The `detectFixType()` function parses explanation text to guess what kind of fix is needed:

```typescript
// Current fragile code in requirements.ts:
const lowerExplanation = explanationText.toLowerCase();
if (lowerExplanation.includes('navigation') || lowerExplanation.includes('menu')) {
  if (lowerExplanation.includes('expand') || lowerExplanation.includes('section')) {
    return 'expand-parent-navigation';
  }
  return 'navigation';
}
if (lowerExplanation.includes('page') || lowerExplanation.includes('navigate')) {
  return 'location';
}
// ... more string matching
```

With an explicit attribute:

```typescript
const fixType = await element.getAttribute('data-test-fix-type');
// No text parsing, no guessing
```

---

#### `data-test-has-fix-button` / `data-test-has-skip-button`

**Values**: `true` | `false`

**Location**: On the step element

**Justification**: Avoids counting button elements:

```typescript
// Before:
const fixButton = page.getByTestId(testIds.interactive.requirementFixButton(stepId));
const hasFixButton = (await fixButton.count()) > 0;

// After:
const hasFixButton = (await element.getAttribute('data-test-has-fix-button')) === 'true';
```

---

### 5. Form validation state

#### `data-test-form-state`

**Values**: `idle` | `checking` | `valid` | `invalid`

**Location**: On the step element (for formfill steps)

**Justification**: Form validation has a 2-second debounce (`DEFAULT_DEBOUNCE_MS = 2000`). The E2E runner can't observe when validation passes without:

- Waiting for the completion indicator (which may not appear due to race conditions)
- Polling repeatedly and hoping

With an explicit attribute:

```typescript
// Wait for validation to complete
await page
  .locator(`[data-testid="interactive-step-${stepId}"][data-test-form-state="valid"]`)
  .waitFor({ timeout: 5000 });
```

---

### 6. Hover action state

#### `data-test-hover-state`

**Values**: `idle` | `entered` | `dwelling` | `completed` | `cancelled`

**Location**: On `.interactive-comment-box` for hover actions

**Justification**: Hover actions have dwell timers that get cancelled when tooltips appear and cause `mouseleave` events. The E2E runner currently has no visibility into this state machine.

With an explicit attribute, E2E can observe progress:

```typescript
// Wait for hover to complete (without detecting tooltip appearance)
await commentBox.locator('[data-test-hover-state="completed"]').waitFor();
```

This is particularly relevant for the tooltip stall bug (PLAN_P2) — even after fixing the production bug, the attribute provides observability.

---

### 7. Do it button state

#### `data-test-do-it-state`

**Values**: `hidden` | `disabled` | `enabled` | `executing`

**Location**: On the step element

**Justification**: The runner must currently check both button existence AND enabled state:

```typescript
// Before:
const buttonCount = await doItButton.count();
const buttonExists = buttonCount > 0;
const buttonEnabled = buttonExists ? await doItButton.isEnabled() : false;

// After:
const doItState = await element.getAttribute('data-test-do-it-state');
const canClick = doItState === 'enabled';
```

---

### 8. Skippable flag

#### `data-test-skippable`

**Values**: `true` | `false`

**Location**: On the step element

**Justification**: The runner currently must check for skip button presence. An explicit flag is cleaner:

```typescript
const skippable = (await element.getAttribute('data-test-skippable')) === 'true';
```

---

## Priority ranking

If implementing incrementally, here's the suggested priority based on impact:

### High priority (eliminate most complex/fragile code)

| Attribute                | Impact                                       |
| ------------------------ | -------------------------------------------- |
| `data-test-step-state`    | Eliminates multi-indicator polling           |
| `data-test-substep-index` | Progress tracking without text parsing       |
| `data-test-substep-total` | Know total sub-steps without JSON parsing    |
| `data-test-action`        | Action type on comment box without inference |
| `data-test-fix-type`      | Eliminates fragile text parsing              |

### Medium priority (simplify common operations)

| Attribute                     | Impact                                           |
| ----------------------------- | ------------------------------------------------ |
| `data-test-step-type`          | Explicit type without checking targetAction      |
| `data-test-target-value`       | Value on comment box without JSON parsing        |
| `data-test-requirements-state` | Direct requirements status                       |
| `data-test-form-state`         | Observe validation without waiting for indicator |

### Lower priority (nice to have)

| Attribute                    | Impact                        |
| ---------------------------- | ----------------------------- |
| `data-test-completion-reason` | Debugging/assertion support   |
| `data-test-hover-state`       | Hover action observability    |
| `data-test-do-it-state`       | Combined button state         |
| `data-test-has-fix-button`    | Avoid button counting         |
| `data-test-has-skip-button`   | Avoid button counting         |
| `data-test-skippable`         | Direct skip policy access     |
| `data-test-action-state`      | Action progress observability |

---

## Implementation locations

Based on code analysis, here's where attributes would be set:

| Attribute                  | File                                                                           | Timing                             |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Step-level attributes      | `interactive-step.tsx`, `interactive-guided.tsx`, `interactive-multi-step.tsx` | React render (synchronous)         |
| Comment box attributes     | `guided-handler.ts`, `navigation-manager.ts`                                   | DOM element creation (synchronous) |
| Requirements attributes    | `interactive-step.tsx` (uses `useStepChecker` state)                           | React render                       |
| Form validation attributes | `interactive-step.tsx` (uses `useFormValidation` state)                        | React render                       |

The key is that all attributes are set **synchronously** during the same operation that changes the visible DOM, ensuring E2E always sees consistent state.

---

## Contract testing

Contract testing is **mandatory** for this approach to succeed. Each attribute we implement must have corresponding unit tests that verify the attribute value matches the actual component state. This prevents attribute drift—where `data-test-step-state="completed"` but the UI shows a spinner.

Example contract test pattern:

```typescript
it('data-test-step-state matches actual completion state', () => {
  render(<InteractiveStep completed={true} />);
  const element = screen.getByTestId('interactive-step-1');
  
  // Attribute matches actual state
  expect(element).toHaveAttribute('data-test-step-state', 'completed');
  // And actual UI is correct
  expect(screen.getByTestId('completion-indicator')).toBeVisible();
});
```

Without contract tests, we simply move fragility from E2E tests to attribute maintenance.

---

## Production inclusion

These attributes **will be included in production builds**. We will not strip them.

Rationale:

1. **Testing against production**: Per [TESTING_STRATEGY.md](./tests/TESTING_STRATEGY.md), Layer 4 (Live Environment Validation) requires testing against production-like environments, including Cloud staging and managed test environments with specific datasets. Stripping attributes would mean testing code that differs from production.

2. **Minimal overhead**: The DOM size increase is negligible—a few hundred bytes per guide.

3. **Debugging value**: Attributes provide observability for troubleshooting in production without requiring special builds.

---

## Backward compatibility

All attributes are **additive**. Existing attributes continue to work:

- `data-testid` — unchanged
- `data-targetaction` — unchanged
- `data-reftarget` — unchanged
- `data-internal-actions` — unchanged (can be deprecated later)

The E2E runner can gradually migrate to the new attributes while keeping existing code as fallback.
