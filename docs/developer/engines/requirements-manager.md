# Requirements Manager

The Requirements Manager (`src/requirements-manager/`) validates requirements and objectives for interactive guide steps, providing a comprehensive system for controlling step execution eligibility and automatic completion.

## Overview

The Requirements Manager is a critical engine that ensures interactive tutorial steps can only be executed when their prerequisites are met, and automatically completes steps when their objectives are already satisfied. It provides event-driven requirements checking, sequential step coordination, and user-friendly error messaging.

## Purpose

The Requirements Manager exists to:

- **Gate step execution** - Prevent users from executing steps before prerequisites are met
- **Enable auto-completion** - Automatically complete steps when objectives are already satisfied
- **Coordinate sequential workflows** - Manage dependencies between steps in multi-step tutorials
- **Provide user feedback** - Offer clear explanations and automatic fixes for unmet requirements
- **Monitor state changes** - React to Grafana state changes (navigation, data sources, plugins, etc.)
- **Handle retry logic** - Automatically retry transient requirement failures

## Architecture

### Core Components

The requirements manager is organized into several specialized modules:

- **`step-checker.hook.ts`** - Main React hook for unified requirements and objectives checking
- **`requirements-checker.hook.ts`** - SequentialRequirementsManager class for cross-step state coordination
- **`requirements-checker.utils.ts`** - Pure functions for checking individual requirement types
- **`requirements-explanations.ts`** - User-friendly error messages and explanations
- **`check-phases.ts`** - State creation functions for different check phases
- **`step-state.ts`** - State machine implementation for explicit step state management
- **`requirements-context.tsx`** - React Context provider for manager instance access

## Main Hook: `useStepChecker()`

**Location**: `src/requirements-manager/step-checker.hook.ts`

**Purpose**: Primary React hook that orchestrates unified checking of both requirements (preconditions) and objectives (completion criteria) for interactive steps.

**Key Features**:

- **Phase-based checking** - Evaluates conditions in priority order (objectives → eligibility → requirements)
- **Auto-completion** - Completes steps automatically when objectives are satisfied
- **Sequential coordination** - Integrates with SequentialRequirementsManager for cross-step dependencies
- **Event-driven rechecking** - Responds to context changes, navigation, and DOM updates
- **Retry with feedback** - Provides retry state (count, isRetrying) for user feedback
- **Automatic fixes** - Supports fixable requirements (e.g., navigation menu state)
- **Skippable steps** - Handles optional steps that can be bypassed
- **Lazy rendering support** - Handles virtualized/lazy-loaded content with progressive scroll discovery

**Priority Logic** (4 phases):

1. **Objectives Phase** - Check objectives first; if met, auto-complete the step (objectives always win)
2. **Eligibility Phase** - Check sequential dependencies; block if previous steps incomplete
3. **Requirements Phase** - Validate requirements only if objectives not met and step is eligible
4. **Default Phase** - Enable step if no conditions specified

**State Management**:

The hook returns a comprehensive state object including:

- `isEnabled` - Step can be executed
- `isCompleted` - Step has been completed
- `isChecking` - Currently validating requirements
- `isSkipped` - Step was skipped
- `isRetrying` - Currently in retry cycle
- `retryCount` / `maxRetries` - Retry progress
- `completionReason` - How step was completed ('objectives', 'manual', 'skipped')
- `explanation` - User-friendly message about requirement status
- `canFixRequirement` - Requirement can be automatically fixed
- `fixType` - Type of fix available ('navigation', 'location', 'lazy-scroll', etc.)
- `checkStep()` - Function to manually trigger requirements check
- `markCompleted()` - Function to manually complete step
- `markSkipped()` - Function to skip step (if skippable)
- `resetStep()` - Function to reset step to initial state
- `fixRequirement()` - Function to attempt automatic fix (if available)

## Requirements Checking System

### Requirements Checker Utils

**Location**: `src/requirements-manager/requirements-checker.utils.ts`

**Purpose**: Pure requirement checking functions that validate Grafana state, user permissions, plugins, data sources, and UI state without DOM manipulation (except for specific DOM checks).

**Core Functions**:

- `checkRequirements()` - Pre-action requirements validation with retry logic
- `checkPostconditions()` - Post-action verification of expected outcomes
- `validateInteractiveRequirements()` - Type-safe validation helper

**Supported Requirement Types**:

**Authentication & Authorization:**

- `is-admin` - User is Grafana admin or org admin
- `is-logged-in` - User is authenticated
- `is-editor` - User has editor role or higher
- `has-permission:<permission>` - User has specific Grafana permission
- `has-role:<role>` - User has specific organizational role

**Data Sources & Plugins:**

- `has-datasources` - At least one data source configured
- `has-datasource:<name>` - Specific data source exists by name
- `has-datasource:type:<type>` - Data source of specific type exists
- `datasource-configured:<name>` - Data source is configured and tested
- `has-plugin:<pluginId>` - Plugin installed and available
- `plugin-enabled:<pluginId>` - Plugin is enabled

**Dashboards:**

- `dashboard-exists` - At least one dashboard exists
- `has-dashboard-named:<title>` - Dashboard with specific title exists

**Navigation & UI State:**

- `exists-reftarget` - Target element exists in DOM (supports lazy rendering)
- `navmenu-open` - Navigation menu is open and docked
- `on-page:<path>` - User is on specific page/URL path
- `form-valid` - Form is valid and ready for submission

**Environment & Features:**

- `has-feature:<toggle>` - Feature toggle is enabled
- `in-environment:<env>` - Running in specific environment
- `min-version:<version>` - Minimum Grafana version requirement met

**Workflow & Dependencies:**

- `section-completed:<sectionId>` - Previous section has been completed
- `var-<name>:<value>` - Guide response variable matches expected value
- `renderer:<type>` - Running in specific renderer context (pathfinder, website)

**Retry Logic**:

- Configurable retry attempts (default from INTERACTIVE_CONFIG)
- Exponential backoff for transient failures
- Per-check timeout management via TimeoutManager
- Retry state feedback (retryCount, isRetrying) for UI display

## Objectives vs Requirements

The system distinguishes between two types of conditions:

**Requirements** (preconditions):

- Must pass for step to be executable
- Checked after objectives and eligibility
- Block step execution when not met
- Can be automatically fixed in some cases
- Support retry logic for transient failures

**Objectives** (completion criteria):

- If met, step is automatically completed
- Checked first, before requirements
- Shortcut requirements checking - if objectives are met, requirements are ignored
- Used to detect when user has already completed the step's goal
- Completion is marked with `completionReason: 'objectives'`

**Priority Hierarchy**: Objectives > Eligibility > Requirements

This design ensures steps don't require users to repeat actions they've already completed, while still gating steps on necessary prerequisites.

## Requirements Explanations System

**Location**: `src/requirements-manager/requirements-explanations.ts`

**Purpose**: Translates technical requirement identifiers into user-friendly messages that guide users toward resolving issues.

**Key Functions**:

- `getRequirementExplanation()` - Main function for generating requirement failure messages
- `mapRequirementToUserFriendlyMessage()` - Maps requirement types to friendly descriptions
- `getPostVerifyExplanation()` - Generates messages for post-action verification failures

**Features**:

- **Priority-based messaging** - Uses custom hints first, then mapped messages, then safe error messages
- **Skippable step support** - Adds appropriate messaging for optional steps
- **Pattern matching** - Handles parameterized requirements (e.g., `has-plugin:grafana-clock-panel`)
- **Safe error filtering** - Only exposes safe error details, filters sensitive information
- **Fix suggestions** - Includes actionable guidance where requirements can be auto-fixed

**Message Priority**:

1. Custom `data-hint` attribute (author-provided guidance)
2. Mapped requirement messages (type-specific descriptions)
3. Safe error messages (sanitized error details)
4. Generic fallback message

## SequentialRequirementsManager

**Location**: `src/requirements-manager/requirements-checker.hook.ts`

**Purpose**: Global state coordinator that manages cross-step dependencies, triggers reactive rechecking, and provides event-driven requirements validation.

**Key Features**:

- **Singleton pattern** - Single instance coordinates all interactive steps across the application
- **Step registry** - Maintains state for all active steps (enabled, completed, checking, error)
- **Sequential dependencies** - Tracks step order and eligibility based on completion of previous steps
- **Event-driven checking** - Responds to context changes without continuous polling
- **Step checker registry** - Maintains callbacks for targeted step rechecking
- **React integration** - Supports useSyncExternalStore for React state synchronization

**Monitoring Capabilities**:

- **Context monitoring** - Listens to ContextService (EchoSrv) for Grafana state changes
- **DOM monitoring** - Observes specific DOM changes (plugins, datasources) via MutationObserver
- **Navigation monitoring** - Tracks URL changes and navigation events (popstate, hashchange, grafana:location-changed)
- **Guide response monitoring** - Reacts to guide variable updates (input blocks, user responses)
- **Heartbeat checking** - Optional periodic rechecking for fragile requirements (configurable)

**API Methods**:

- `registerStep()` - Register a new step
- `updateStep()` - Update step state
- `getStepState()` - Get current state of a step
- `registerStepCheckerByID()` - Register callback for targeted rechecking
- `triggerStepCheck()` - Trigger check for specific step
- `triggerReactiveCheck()` - Trigger selective recheck of eligible steps
- `watchNextStep()` - Watch and repeatedly check next incomplete step
- `startDOMMonitoring()` / `stopDOMMonitoring()` - Control monitoring lifecycle

## Check Phases System

**Location**: `src/requirements-manager/check-phases.ts`

**Purpose**: Pure functions that create consistent state objects for each phase of the checking process.

**Phase Functions**:

- `createCheckingState()` - Initial checking state
- `createObjectivesCompletedState()` - State when objectives are met
- `createBlockedState()` - State when sequential dependency not met
- `createRequirementsState()` - State based on requirements check result
- `createEnabledState()` - State when no conditions apply
- `createErrorState()` - State when check encounters error

**Benefits**:

- Consistent state structure across all phases
- Improved testability
- Clear separation of concerns
- Reduced duplication in step-checker.hook.ts

## Step State Machine

**Location**: `src/requirements-manager/step-state.ts`

**Purpose**: Explicit state machine for interactive step states, replacing boolean flag combinations with proper state transitions.

**State Types**:

- `idle` - Initial state, not yet checked
- `checking` - Currently validating requirements
- `blocked` - Requirements not met or sequential dependency blocking
- `enabled` - Ready for execution
- `completed` - Step has been completed

**Completion Reasons**:

- `none` - Not completed
- `objectives` - Auto-completed via objectives
- `manual` - User executed the step
- `skipped` - User skipped the step

**Benefits**:

- Prevents impossible state combinations
- Explicit state transitions via reducer
- Helper functions for deriving boolean flags (backward compatibility)
- Clear state flow documentation

## React Context Provider

**Location**: `src/requirements-manager/requirements-context.tsx`

**Purpose**: Provides React Context-based access to SequentialRequirementsManager, replacing direct singleton access for better testability and component isolation.

**Components**:

- `RequirementsProvider` - Context provider that creates and manages manager instance
- `useRequirementsManager()` - Hook to access manager from context
- `useIsInsideRequirementsProvider()` - Check if component is within provider

**Migration Strategy**:

- Backward compatible - Falls back to singleton if used outside provider
- Allows gradual migration from `getInstance()` to context-based access
- Provider handles monitoring lifecycle (start on mount, stop on unmount)

## Data Flow & State Propagation

**How Requirements Are Checked**:

1. Component mounts and calls `useStepChecker()` with requirements/objectives
2. Hook registers step with SequentialRequirementsManager
3. Hook subscribes to manager state changes via useSyncExternalStore
4. Initial check runs for first steps in sequence
5. Context changes trigger reactive rechecking via registered callbacks
6. Check results update local state and propagate to manager
7. Manager notifies subscribers of state changes
8. Dependent steps recheck eligibility and requirements

**Event-Driven Rechecking**:

- ContextService events (EchoSrv) → recheckNextSteps()
- Navigation events → triggerSelectiveRecheck()
- Guide response changes → recheckNextSteps()
- Step completion → watchNextStep() / triggerStepCheck()
- Custom events (section-completed, step-auto-skipped)

## Integration Points

The Requirements Manager integrates with:

**Interactive Engine** (`src/interactive-engine/`):

- `navigation-manager.ts` - Provides navigation fixes and parent expansion
- `sequence-manager.ts` - Coordinates section-level sequential steps
- `use-sequential-step-state.hook.ts` - React hook for subscribing to manager state
- `interactive-state-manager.ts` - Global interactive state coordination

**Step Components** (`src/docs-retrieval/components/interactive/`):

- `interactive-step.tsx` - Single action steps
- `interactive-guided.tsx` - Multi-step guided workflows
- `interactive-multi-step.tsx` - Sequential multi-step sections
- `interactive-section.tsx` - Section containers with completion tracking
- `interactive-quiz.tsx` - Quiz components with validation

**Context Engine** (`src/context-engine/`):

- ContextService - Subscribes to state changes for reactive checking

**Supporting Systems**:

- `TimeoutManager` - Manages debouncing and delayed checks
- `guideResponseStorage` - Variable storage for var-based requirements
- DOM utilities in `src/lib/dom/` - DOM state checking functions

## Configuration

**Location**: `src/constants/interactive-config.ts`

The requirements manager behavior is controlled through `INTERACTIVE_CONFIG.delays.requirements` and `INTERACTIVE_CONFIG.requirements.heartbeat`:

**Retry Configuration**:

- `maxRetries` - Maximum retry attempts for failed checks
- `retryDelay` - Milliseconds between retry attempts

**Heartbeat Configuration** (optional periodic rechecking):

- `enabled` - Enable/disable heartbeat monitoring
- `intervalMs` - Milliseconds between heartbeat checks
- `watchWindowMs` - Maximum duration to monitor a step (0 = infinite)
- `onlyForFragile` - Only monitor fragile requirements (navmenu-open, exists-reftarget, on-page)

**Debouncing Configuration**:

- `stateSettling` - Delay for DOM to settle after state changes

## Key Design Decisions

**Event-Driven vs Polling**:
The manager uses event-driven checking instead of continuous polling for better performance. Checks are triggered by:

- Context changes from ContextService
- Navigation events
- DOM mutations (limited to specific hotspots)
- User interactions
- Optional heartbeat for fragile requirements only

**Fail-Open Philosophy**:
Unknown requirement types pass with a warning instead of blocking. This prevents typos or future requirements from breaking existing guides.

**Lazy Rendering Support**:
The `exists-reftarget` check supports virtualized/lazy-loaded content through progressive scroll discovery, preventing false negatives for elements not yet rendered.

**Fix Automation**:
Several requirement types support automatic fixes:

- `navmenu-open` - Auto-open and dock navigation menu
- `on-page:<path>` - Auto-navigate to required page
- Location mismatches - Navigate to expected path
- Parent navigation - Expand collapsed navigation sections

## Performance Considerations

**Debouncing**:
Multiple rapid state changes are debounced to prevent excessive rechecking. The manager uses TimeoutManager for consistent timeout handling.

**Selective Rechecking**:
Only eligible steps (not completed, not currently checking) are rechecked on state changes, preventing unnecessary work.

**Mounted State Tracking**:
All async operations check component mounted state before updating, preventing memory leaks and React warnings.

**Memoization**:
Check results are cached during retry cycles to avoid redundant API calls.

## See Also

- `src/types/requirements.types.ts` - Type-safe requirement definitions
- `.cursor/rules/interactiveRequirements.mdc` - Comprehensive requirements documentation
- `docs/developer/interactive-examples/requirements-reference.md` - Requirements reference
- `docs/developer/engines/interactive-engine.md` - Interactive engine documentation
- `src/constants/interactive-config.ts` - Configuration options
