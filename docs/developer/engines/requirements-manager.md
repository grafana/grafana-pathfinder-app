# Requirements Manager

The Requirements Manager (`src/requirements-manager/`) validates requirements and objectives for interactive guide steps.

## Overview

The Requirements Manager ensures that interactive steps can only be executed when their prerequisites are met, and automatically completes steps when their objectives are already satisfied.

## Architecture

### Core Components

- **`step-checker.hook.ts`** - Unified step requirements/objectives checking hook
- **`requirements-checker.hook.ts`** - Requirements validation hook
- **`requirements-checker.utils.ts`** - Requirement check functions
- **`requirements-explanations.ts`** - User-friendly error messages

## Main Hook

### `useStepChecker()`

**Location**: `src/requirements-manager/step-checker.hook.ts`

**Purpose**: Unified hook for checking both requirements and objectives

**Key Features**:

- Checks objectives first (for auto-completion)
- Validates requirements (for execution eligibility)
- Provides user-friendly error messages
- Integrates with sequential step management

**Priority Logic**:

1. Check objectives (auto-complete if met)
2. Check sequential eligibility
3. Check requirements (preconditions)

**Usage**:

```typescript
import { useStepChecker } from '../requirements-manager';

const InteractiveStep = ({ requirements, objectives }) => {
  const { requirementsState, objectivesState } = useStepChecker({
    requirements,
    objectives,
    stepId: '1.1',
    // ...
  });

  // Use state to enable/disable step
};
```

## Requirements Checking

### Requirements Checker Utils

**Location**: `src/requirements-manager/requirements-checker.utils.ts`

**Purpose**: Pure functions for checking individual requirements

**Supported Requirements**:

- `exists-reftarget` - Element exists in DOM
- `has-datasources` - At least one datasource configured
- `has-datasource:<name>` - Specific datasource exists
- `has-plugin:<pluginId>` - Plugin installed
- `has-dashboard-named:<title>` - Dashboard exists
- `has-permission:<permission>` - User has permission
- `has-role:<role>` - User has role
- `is-admin` - User is admin
- `navmenu-open` - Navigation menu is open
- `on-page:<path>` - User is on specific page
- `has-feature:<toggle>` - Feature toggle enabled
- `in-environment:<env>` - Specific environment
- `min-version:<version>` - Minimum Grafana version

**Check Functions**:
Each requirement has a corresponding check function:

- `checkHasDatasource()`
- `checkHasPlugin()`
- `checkIsAdmin()`
- `checkNavMenuOpen()`
- etc.

## Objectives System

Objectives are checked using the same functions as requirements, but with different behavior:

- **Requirements**: Must pass for step to be executable
- **Objectives**: If met, step is auto-completed

**Key Difference**: Objectives shortcut requirements checking - if objectives are met, requirements don't need to be checked.

## Requirements Explanations

**Location**: `src/requirements-manager/requirements-explanations.ts`

**Purpose**: Provides user-friendly error messages for failed requirements

**Features**:

- Maps requirement names to explanations
- Provides fix suggestions where applicable
- Supports custom hints via `data-hint` attribute

## Sequential Step Management

The Requirements Manager integrates with `interactive-engine/sequence-manager.ts` to:

- Enforce sequential dependencies
- Track step completion
- Unlock next steps when previous steps complete

## Error Handling

**Retry Logic**:

- 3 attempts with 200ms delay
- Exponential backoff for network errors
- Fail-open for unknown requirements (passes with warning)

**User Feedback**:

- Clear error messages
- "Fix this" buttons for fixable requirements
- "Skip" buttons for skippable steps

## Integration

The Requirements Manager integrates with:

- **Interactive Engine** (`interactive-engine/`) - Validates before action execution
- **Step Components** (`docs-retrieval/components/interactive/`) - Provides state for UI
- **Sequence Manager** (`interactive-engine/sequence-manager.ts`) - Coordinates sequential steps

## Usage Example

```typescript
import { useStepChecker } from '../requirements-manager';

const InteractiveStep = ({ elementData }) => {
  const {
    requirementsState,
    objectivesState,
    isEligible,
    canExecute,
  } = useStepChecker({
    requirements: elementData.requirements,
    objectives: elementData.objectives,
    stepId: elementData.stepId,
    sectionId: elementData.sectionId,
  });

  const isEnabled = canExecute && isEligible;
  const isCompleted = objectivesState.pass;

  return (
    <button disabled={!isEnabled || isCompleted}>
      {isCompleted ? '✓ Completed' : 'Do it'}
    </button>
  );
};
```

## See Also

- `.cursor/rules/interactiveRequirements.mdc` - Comprehensive requirements documentation
- `docs/developer/interactive-examples/requirements-reference.md` - Requirements reference
- `docs/developer/engines/interactive-engine.md` - Interactive engine documentation
