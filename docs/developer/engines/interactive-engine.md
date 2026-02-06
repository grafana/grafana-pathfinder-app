# Interactive Engine

The Interactive Engine (`src/interactive-engine/`) is responsible for executing interactive guide actions and managing the interactive guide system.

## Overview

The Interactive Engine provides the core functionality for "Show me" and "Do it" buttons in interactive guides. It handles action execution, element highlighting, navigation, and state management for interactive steps.

## Architecture

### Core Components

- **`interactive.hook.ts`** - Main React hook for interactive elements
- **`action-handlers/`** - Action execution handlers
- **`navigation-manager.ts`** - Element visibility and navigation
- **`sequence-manager.ts`** - Sequential step execution
- **`interactive-state-manager.ts`** - State coordination
- **`global-interaction-blocker.ts`** - Section execution blocking
- **`auto-completion/`** - Auto-detection system for user actions

## Main Hook

### `useInteractiveElements()`

**Location**: `src/interactive-engine/interactive.hook.ts`

**Purpose**: Main hook for managing interactive guide elements

**Key Features**:

- Attaches event listeners to interactive elements
- Handles action execution (show/do)
- Manages requirements checking
- Coordinates with action handlers

**Usage**:

```typescript
import { useInteractiveElements } from '../interactive-engine';

const MyComponent = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useInteractiveElements({
    containerRef,
  });

  return <div ref={containerRef}>Content</div>;
};
```

## Action Handlers

Located in `src/interactive-engine/action-handlers/`:

- **`focus-handler.ts`** - Highlights and clicks elements by CSS selector
- **`button-handler.ts`** - Finds and clicks buttons by text
- **`form-fill-handler.ts`** - Fills form fields with values
- **`navigate-handler.ts`** - Navigates to URLs
- **`hover-handler.ts`** - Applies hover states
- **`guided-handler.ts`** - Handles guided user-performed actions

Each handler follows a consistent pattern:

1. Find target element(s)
2. Validate visibility
3. Navigate if needed
4. Execute action
5. Return success/failure

## Navigation Manager

**Location**: `src/interactive-engine/navigation-manager.ts`

**Purpose**: Ensures elements are visible and navigates to them if needed

**Key Functions**:

- `ensureNavigationOpen()` - Opens/docks navigation menu
- `ensureElementVisible()` - Scrolls elements into view
- `highlightWithComment()` - Highlights elements with tooltips
- `expandParentNavigationSection()` - Expands collapsed nav sections

## Sequence Manager

**Location**: `src/interactive-engine/sequence-manager.ts`

**Purpose**: Manages sequential execution of multiple steps

**Key Features**:

- Coordinates step-by-step execution
- Handles timing between steps
- Manages failure recovery
- Supports skippable steps

## State Management

### Interactive State Manager

**Location**: `src/interactive-engine/interactive-state-manager.ts`

**Purpose**: Tracks execution state and coordinates with global blocker

**Key Features**:

- Tracks step execution state
- Dispatches completion events
- Coordinates section blocking

### Global Interaction Blocker

**Location**: `src/interactive-engine/global-interaction-blocker.ts`

**Purpose**: Blocks user interactions during section execution

**Features**:

- Creates overlays (main, header, fullscreen modal)
- Prevents user interference during automation
- Handles cancellation (Ctrl+C or cancel button)

## Auto-Completion System

Located in `src/interactive-engine/auto-completion/`:

- **`action-monitor.ts`** - Global DOM listener for user actions
- **`action-detector.ts`** - Detects action type from events
- **`action-matcher.ts`** - Matches user actions to step configurations

**Purpose**: Automatically completes steps when users perform actions themselves (if enabled in config)

## Integration

The Interactive Engine integrates with:

- **Requirements Manager** (`requirements-manager/`) - Validates requirements before execution
- **Content Renderer** (`docs-retrieval/content-renderer.tsx`) - Renders interactive components
- **Context Engine** (`context-engine/`) - Provides context for recommendations

## Usage Example

```typescript
import { useInteractiveElements } from '../interactive-engine';
import { useStepChecker } from '../requirements-manager';

const InteractiveStep = ({ elementData }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Set up interactive elements
  useInteractiveElements({ containerRef });

  // Check requirements
  const { requirementsState } = useStepChecker({
    requirements: elementData.requirements,
    objectives: elementData.objectives,
    // ...
  });

  return (
    <div ref={containerRef}>
      {/* Step content */}
    </div>
  );
};
```

## E2E Testing Contract

The interactive system exposes its state via `data-test-*` attributes for E2E testing. These form a stable contract between the interactive components and the E2E test runner.

**Key locations:**

- `src/interactive-engine/e2e-attributes.ts` - Shared helper for applying attributes to comment boxes
- `src/docs-retrieval/components/interactive/step-states.ts` - Constants defining valid attribute values
- Contract tests ensure attribute stability at build time

See: [`docs/developer/E2E_TESTING_CONTRACT.md`](../E2E_TESTING_CONTRACT.md) for the full specification.

## See Also

- `docs/developer/engines/requirements-manager.md` - Requirements validation
- `docs/developer/E2E_TESTING_CONTRACT.md` - E2E testing contract and data-test-\* attributes
- `docs/architecture.dot` - Overall architecture, GraphViz DOT format
- `.cursor/rules/interactiveRequirements.mdc` - Requirements system documentation
