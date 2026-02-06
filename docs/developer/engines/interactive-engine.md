# Interactive Engine

The Interactive Engine (`src/interactive-engine/`) is responsible for executing interactive guide actions and managing the interactive guide system within Grafana.

## Overview

The Interactive Engine provides the core automation and interaction capabilities for interactive learning guides in Grafana. It powers "Show me" and "Do it" buttons, enabling guides to programmatically demonstrate actions (show mode) or automatically execute them (do mode). The engine handles action execution, element highlighting, navigation management, state coordination, user interaction blocking during automation, and optional auto-detection of user-performed actions.

## Architecture

### Core Components

- **`interactive.hook.ts`** - Main React hook (`useInteractiveElements`) that orchestrates all interactive functionality
- **`action-handlers/`** - Specialized handlers for each action type (highlight, button, formfill, navigate, hover, guided)
- **`navigation-manager.ts`** - Manages element visibility, scrolling, navigation menu state, and highlight rendering
- **`sequence-manager.ts`** - Coordinates sequential multi-step execution with retry logic
- **`interactive-state-manager.ts`** - Tracks execution state and dispatches completion events
- **`global-interaction-blocker.ts`** - Singleton that blocks user interactions during section execution using overlays
- **`auto-completion/`** - Optional system for detecting and auto-completing user-performed actions
- **`use-sequential-step-state.hook.ts`** - React 18 hook for subscribing to sequential step state changes

## Main Hook

### `useInteractiveElements()`

**Location**: `src/interactive-engine/interactive.hook.ts`

**Purpose**: Primary React hook that provides all interactive functionality to components. It initializes and coordinates action handlers, state management, navigation, and execution flow.

**Key Features**:

- Initializes and coordinates all action handlers (focus, button, formfill, navigate, hover, guided)
- Provides high-level `executeInteractiveAction()` method for direct action execution without DOM elements
- Manages requirements checking (pre-conditions) and post-conditions verification
- Coordinates sequence execution for multi-step interactive sections
- Integrates with state manager for completion tracking
- Supports section-level blocking to prevent user interference during automation
- Provides emergency unblock method for safety

**Key Returned Methods**:

- `executeInteractiveAction()` - High-level method to execute any interactive action programmatically
- `checkRequirementsFromData()` - Validate pre-conditions before action execution
- `verifyStepResult()` - Validate post-conditions after action execution
- `startSectionBlocking()` / `stopSectionBlocking()` - Control user interaction blocking during multi-step sections
- `forceUnblock()` - Emergency method to clear all blocking overlays

## Action Handlers

Located in `src/interactive-engine/action-handlers/`, these specialized classes execute specific types of interactive actions. All handlers follow a consistent pattern and share common infrastructure.

### Handler Types

- **`focus-handler.ts`** - Highlights and optionally clicks elements by CSS selector (supports complex selectors, pseudo-selectors)
- **`button-handler.ts`** - Finds and clicks buttons using intelligent CSS selector or text matching fallback
- **`form-fill-handler.ts`** - Fills form inputs, textareas, selects, and Monaco editors; supports CLEAR command and special value patterns
- **`navigate-handler.ts`** - Navigates to internal Grafana routes or external URLs using locationService
- **`hover-handler.ts`** - Simulates hover states by dispatching mouse events and applying programmatic hover classes for CSS frameworks
- **`guided-handler.ts`** - Coordinates guided interactions where users manually perform actions while the system highlights targets and waits for completion

### Common Handler Pattern

Each handler follows a consistent execution pattern:

1. Find target element(s) using enhanced selector engine (supports `grafana:` prefix resolution)
2. Validate element visibility (non-breaking warnings)
3. Ensure navigation menu is open and element is scrolled into view
4. Execute action based on mode:
   - **Show mode**: Highlight element with optional comment overlay, no actual interaction
   - **Do mode**: Clear highlights, execute actual interaction (click, fill, navigate, etc.)
5. Mark step as completed and dispatch completion event
6. Wait for React updates and state propagation

### Action Type: Sequence

The special `sequence` action type (handled directly in `interactive.hook.ts`) executes multiple child actions sequentially. It supports two modes:

- **Show-only mode**: Shows each step in sequence without executing
- **Full mode**: Executes do action, then show action for each step with retry logic

## Navigation Manager

**Location**: `src/interactive-engine/navigation-manager.ts`

**Purpose**: Manages element visibility, scrolling, navigation menu state, and visual highlighting. Ensures interactive targets are accessible before actions execute.

**Key Functions**:

- `ensureNavigationOpen()` - Opens and docks Grafana's side navigation menu if target is in nav tree
- `ensureElementVisible()` - Scrolls elements into viewport with sticky header offset handling
- `highlightWithComment()` - Creates highlight overlays (outline or dot mode) with optional comment boxes containing sanitized HTML
- `expandParentNavigationSection()` - Expands collapsed navigation sections to reveal target elements
- `clearAllHighlights()` - Removes all highlight overlays and comment boxes from the page
- `showNoopComment()` - Displays centered comment box for informational noop steps
- `fixNavigationRequirements()` - Attempts to fix navigation-related requirement failures

**Highlight Features**:

- Supports both outline highlights (for visible elements) and dot indicators (for small/obscure elements)
- Active drift detection in guided mode using requestAnimationFrame to keep highlights synchronized with element position
- Automatic cleanup via IntersectionObserver when elements scroll out of view
- Position tracking handles sticky headers, scrolling containers, and viewport changes
- Comment boxes with Pathfinder branding, sanitized HTML content, and smart positioning

## Sequence Manager

**Location**: `src/interactive-engine/sequence-manager.ts`

**Purpose**: Coordinates sequential execution of multiple interactive steps with automatic retry logic and failure handling.

**Key Features**:

- Executes child interactive elements within a sequence container in order
- Built-in retry logic with configurable max retries and delays
- Two execution modes:
  - `runInteractiveSequence()` - Show or do mode for all steps
  - `runStepByStepSequence()` - Do each step, verify, then show (full automation)
- Pre-action requirements validation using requirements checker
- Post-action verification to ensure step succeeded before proceeding
- Graceful failure handling - stops sequence on persistent failures after retries
- Integrates with state manager for completion tracking

## State Management

### Interactive State Manager

**Location**: `src/interactive-engine/interactive-state-manager.ts`

**Purpose**: Central state coordinator that tracks interactive action lifecycle and manages integration with the global interaction blocker.

**Key Features**:

- Manages state transitions: idle → running → completed/error
- Dispatches `interactive-action-completed` custom events to DOM for step completion tracking
- Error logging with context and structured error handling
- Section-level blocking coordination via `startSectionBlocking()` / `stopSectionBlocking()`
- Configurable options for logging, events, and global blocking
- Emergency `forceUnblock()` method for safety

**State Lifecycle**:

1. `setState(data, 'running')` - Action starts
2. Action handler executes
3. `setState(data, 'completed')` - Dispatches completion event
4. React components listening for `interactive-action-completed` event update UI

### Global Interaction Blocker

**Location**: `src/interactive-engine/global-interaction-blocker.ts`

**Purpose**: Singleton that prevents user interference during automated section execution using transparent blocking overlays.

**Features**:

- Creates three types of overlays:
  - **Main content overlay** - Blocks page content area
  - **Header overlay** - Blocks top navigation bar (spans full viewport width)
  - **Full-screen overlay** - Activates when modals are detected (initially hidden)
- Modal detection system with MutationObserver and polling fallback
- Automatic overlay switching based on modal state (ARIA dialogs, data-overlay-container)
- Position synchronization using ResizeObserver and window resize/scroll handlers
- Status indicator with spinner and cancel button (always visible, z-index 10001+)
- Keyboard shortcut support (Ctrl/Cmd+C to cancel running section)
- Intelligent event blocking that allows interactions within WYSIWYG editor
- Automatic cleanup of all resources (observers, listeners, timers) on unblock
- Uses TimeoutManager singleton to prevent interval stacking and memory leaks

## Auto-Completion System

Located in `src/interactive-engine/auto-completion/`, this optional subsystem automatically detects and completes steps when users manually perform actions. **Disabled by default** - must be enabled in Plugin Configuration.

### Components

- **`action-monitor.ts`** - Singleton that registers global DOM event listeners (click, input, change, mouseenter, keydown)
- **`action-detector.ts`** - Analyzes DOM elements and events to determine action type (highlight, button, formfill, navigate, hover)
- **`action-matcher.ts`** - Matches detected user actions against step configurations using CSS selectors, button text, or regex patterns
- **`useAutoDetection.ts`** - React hook that subscribes to `user-action-detected` events and auto-completes matching steps
- **`useFormValidation.ts`** - Debounced form validation hook with regex pattern matching support

### Action Detection Logic

The `action-detector` determines action type based on element characteristics:

- **formfill**: Input fields, textareas, selects (except radio/checkbox)
- **button**: Buttons with unique text and no testid/aria-label (uses text matching)
- **highlight**: Clickable elements, buttons with testid (uses CSS selectors)
- **navigate**: External links (href starts with http)
- **hover**: Elements triggered by mouseenter events

### How It Works

1. User performs action in Grafana UI (e.g., clicks button, fills form)
2. ActionMonitor detects event and extracts element/action information
3. ActionMonitor dispatches `user-action-detected` custom event
4. Components using `useAutoDetection` receive event and check if it matches their step config
5. If match found, step is automatically marked complete
6. Includes debouncing to prevent duplicate completions from rapid interactions

### Features

- Reference-counted enable/disable for multi-section coordination
- Force-disable mode during section execution to prevent auto-completion interference
- Intelligent element filtering (excludes debug panels, wysiwyg editor)
- Regex pattern matching for flexible form value validation
- Action queue with max size limit to prevent memory issues
- CSS selector detection vs text matching heuristics

## Integration Points

The Interactive Engine integrates with several other system components:

### Requirements Manager

**Location**: `src/requirements-manager/`

**Integration**: The Interactive Engine uses the Requirements Manager for pre-condition validation and post-condition verification.

- `checkRequirements()` - Called before action execution to validate step prerequisites
- `checkPostconditions()` - Called after action execution to verify success
- `waitForReactUpdates()` - Used throughout action handlers to synchronize with React state
- Requirements strings are parsed and evaluated to check DOM state, routes, feature flags, etc.

### Content Renderer

**Location**: `src/docs-retrieval/content-renderer.tsx`

**Integration**: The Content Renderer creates the interactive step UI that triggers the Interactive Engine.

- Renders "Show me" and "Do it" buttons for interactive steps
- Extracts `data-*` attributes from markdown/JSON to create InteractiveElementData
- Calls `executeInteractiveAction()` when users click interactive buttons
- Displays step states (pending, running, completed) based on requirements and completion events

### Context Engine

**Location**: `src/context-engine/`

**Integration**: The Context Engine provides user state information used for requirements validation.

- Current route, feature flags, installed plugins, data sources
- User role and permissions
- This context is evaluated by the Requirements Manager during requirements checking

## Supported Action Types

The Interactive Engine supports the following action types via the `targetAction` attribute:

- **highlight** - Highlights and optionally clicks elements by CSS selector
- **button** - Finds and clicks buttons by text or CSS selector
- **formfill** - Fills form fields with specified values
- **navigate** - Navigates to internal routes or external URLs
- **hover** - Simulates hover interactions
- **guided** - Guided mode where user manually performs actions
- **sequence** - Executes multiple child actions sequentially
- **noop** - Informational step with no interaction (displays comment only)

## Data Collected and Events

The Interactive Engine collects and dispatches the following information:

### Completion Events

Custom DOM event `interactive-action-completed` dispatched with:

```typescript
{
  data: InteractiveElementData, // Step configuration
  state: 'completed' | 'error'  // Final state
}
```

### User Action Events (Auto-completion)

Custom DOM event `user-action-detected` dispatched with:

```typescript
{
  element: HTMLElement,        // Target element
  action: DetectedAction,      // Action type
  value?: string,              // Form value if applicable
  timestamp: number            // Event timestamp
}
```

### State Tracking

The Interactive State Manager tracks:

- Current execution state per step (idle, running, completed, error)
- Section blocking state (active, inactive)
- Error context and messages
- Cancel callbacks for in-progress sections

## Usage Example

```typescript
import { useInteractiveElements } from '../interactive-engine';

const InteractiveGuide = () => {
  const {
    executeInteractiveAction,
    checkRequirementsFromData,
    startSectionBlocking,
    stopSectionBlocking,
    forceUnblock
  } = useInteractiveElements();

  const handleShowAction = async () => {
    // Execute in show mode (highlight only, no interaction)
    await executeInteractiveAction(
      'highlight',                    // targetAction
      '[data-testid="nav-datasources"]', // refTarget (CSS selector)
      undefined,                      // targetValue
      'show',                         // buttonType
      'Click here to open data sources' // targetComment
    );
  };

  const handleDoAction = async () => {
    // Execute in do mode (actual interaction)
    await executeInteractiveAction(
      'button',
      'Add data source',  // Will find button by text
      undefined,
      'do'
    );
  };

  return (
    <div>
      <button onClick={handleShowAction}>Show me</button>
      <button onClick={handleDoAction}>Do it</button>
    </div>
  );
};
```

## Key Dependencies

### Internal Dependencies

- **Requirements Manager** (`src/requirements-manager/`) - Pre/post-condition validation
- **DOM Utilities** (`src/lib/dom/`) - Enhanced selector engine, element visibility checking, button finding
- **Security** (`src/security/`) - HTML sanitization for comment content
- **Interactive Styles** (`src/styles/interactive.styles.ts`) - Global CSS for highlights and overlays
- **Interactive Config** (`src/constants/interactive-config.ts`) - Timing delays, retry counts, modal detection settings
- **Interactive Z-Index** (`src/constants/interactive-z-index.ts`) - Z-index constants for overlay layering
- **Timeout Manager** (`src/utils/timeout-manager.ts`) - Centralized interval/timeout management to prevent leaks

### External Dependencies

- **@grafana/runtime** - `locationService` for navigation
- **React** - Hooks (useMemo, useCallback, useSyncExternalStore) for state management

## Critical Configuration

Located in `src/constants/interactive-config.ts`:

- **Delays**: Timing for actions (button clicks, hover, navigation), React update settling, debouncing
- **Retries**: Maximum retry attempts for sequence steps (default: 3)
- **Modal Detection**: Polling interval and debounce settings for modal state detection
- **Position Tracking**: Drift detection threshold and check interval for guided mode highlights

## Why This Engine Exists

The Interactive Engine exists to bridge the gap between static documentation and hands-on learning in Grafana:

1. **Eliminate Uncertainty** - Users don't have to hunt for buttons or features; the system shows and explains exactly where things are
2. **Reduce Friction** - "Do it" automation removes tedious setup steps, letting users focus on learning concepts
3. **Context-Aware Guidance** - Integration with Requirements Manager ensures guides adapt to user's current state (installed plugins, permissions, etc.)
4. **Safe Exploration** - Guided mode lets users learn actual interaction patterns while preventing mistakes
5. **Accessibility** - Automated actions help users who struggle with complex UIs or have accessibility needs

## See Also

- `docs/developer/engines/requirements-manager.md` - Requirements validation system
- `docs/architecture.dot` - Overall architecture diagram (GraphViz DOT format)
- `.cursor/rules/interactiveRequirements.mdc` - Requirements system rules and patterns
