# Utils Directory

Utility functions and helper modules. **Note**: Most business logic hooks have been moved to specialized engine directories. This directory now contains only general-purpose utilities.

## Important: Hook Location Changes

**⚠️ CRITICAL**: Many hooks previously documented here have been moved to specialized engine directories:

- **Interactive hooks** → `src/interactive-engine/` (see `interactive-engine/interactive.hook.ts`)
- **Context hooks** → `src/context-engine/` (see `context-engine/context.hook.ts`)
- **Requirements hooks** → `src/requirements-manager/` (see `requirements-manager/step-checker.hook.ts`)

Only the following hook remains in `src/utils/`:

## File Organization

### 🎣 **React Hooks** (Remaining in utils/)

- `usePublishedGuides.ts` - Fetches published guides from the backend API

### 🛠️ **Utilities & Configuration**

- `fetchBackendGuides.ts` - Shared utility for fetching backend guides from the API

- `utils.plugin.ts` - Plugin props context management
- `utils.routing.ts` - Route prefixing utilities
- `timeout-manager.ts` - Centralized timeout/debounce management
- `dev-mode.ts` - Development mode utilities
- `openfeature.ts` - Feature toggle utilities
- `openfeature-tracking.ts` - OpenFeature hook for tracking flag evaluations to analytics
- `experiment-debug.ts` - Debug utilities for the experiment system (`window.__pathfinderExperiment`)
- `variable-substitution.ts` - Template variable (`{{variableName}}`) substitution for dynamic content

### 🔧 **Development Tools** (`devtools/`)

- `index.ts` - Barrel export for all devtools utilities
- `dev-tools.types.ts` - Shared types (`StepDefinition`, `SelectorInfo`, `ExtractedSelector`)
- `action-recorder.hook.ts` - Record user actions for guide creation
- `action-recorder.util.ts` - Action recording utilities (selector extraction, step filtering)
- `element-inspector.hook.ts` - DOM element inspection
- `hover-highlight.util.ts` - Visual element highlighting during inspection
- `selector-generator.util.ts` - Automated CSS selector generation
- `step-parser.util.ts` - Parse step definitions
- `tutorial-exporter.ts` - Export tutorials in various formats

### 🔒 **Security & Safety**

- `safe-event-handler.util.ts` - Safe event handler utilities

---

## React Hooks (In utils/)

### `usePublishedGuides.ts` ⭐ **Published Guides from Backend**

**Purpose**: Fetches published interactive guides from the backend API
**Location**: `src/utils/usePublishedGuides.ts`

**Role**:

- Loads guides from the backend on mount
- Exposes loading and error state
- Provides `refreshGuides()` for manual refresh

**Key Exports**:

- `usePublishedGuides()` - Hook returning `{ guides, isLoading, error, refreshGuides }`
- `PublishedGuide` - Type for guide metadata and spec

**Used By**:

- `src/components/docs-panel/context-panel.tsx` - Context panel custom guides
- `src/components/docs-panel/CustomGuidesSection.tsx` - Custom guides section (type import)

---

## Utility Files

### `fetchBackendGuides.ts` ⭐ **Backend Guides Fetcher**

**Purpose**: Shared utility for fetching guides from the backend API
**Location**: `src/utils/fetchBackendGuides.ts`

**Role**:

- Calls the pathfinder backend API for interactive guides in a namespace
- Returns empty array when endpoint is unavailable (400, 403, 404, 405, 501, 503)
- Re-throws other errors for caller handling

**Key Function**:

```typescript
async function fetchBackendGuides(namespace: string): Promise<any[]>;
```

**Used By**:

- `src/utils/usePublishedGuides.ts` - Published guides hook
- `src/components/block-editor/hooks/useBackendGuides.ts` - Block editor backend guides

---

### `utils.plugin.ts` ⭐ **Plugin Props Management**

**Purpose**: Context management for plugin props throughout the component tree
**Location**: `src/utils/utils.plugin.ts`

**Role**:

- Provides React context for plugin props
- Hooks for accessing plugin metadata
- Ensures plugin props are available to all components

**Key Exports**:

- `PluginPropsContext` - React context for sharing `AppRootProps`
- `updatePluginSettings()` - Function to update plugin settings via API

**Used By**:

- `src/components/App/App.tsx` - Context provider setup
- Any component needing access to plugin configuration

---

### `utils.routing.ts` ⭐ **Route Utilities**

**Purpose**: URL and routing utilities for consistent plugin navigation
**Location**: `src/utils/utils.routing.ts`

**Role**:

- Prefixes routes with plugin base URL
- Ensures consistent URL structure
- Supports Grafana's app routing patterns

**Key Function**:

```typescript
function prefixRoute(route: string): string {
  return `${PLUGIN_BASE_URL}/${route}`;
}
```

**Used By**:

- `src/pages/docsPage.ts` - Page route definition
- Any component requiring route generation

---

### `timeout-manager.ts` ⭐ **Timeout Management**

**Purpose**: Centralized timeout and debounce management
**Location**: `src/utils/timeout-manager.ts`

**Role**:

- Prevents competing timeout mechanisms
- Provides debounced function creation
- Manages timeout cleanup

**Key Exports**:

- `useTimeoutManager()` - Hook for timeout management
- Debounce utilities for UI updates and API calls

**Used By**:

- `src/context-engine/context.hook.ts` - Context refresh debouncing
- Various components requiring debounced updates

---

### `openfeature.ts` ⭐ **Feature Toggle Utilities**

**Purpose**: Feature flag management using Grafana's feature toggle system
**Location**: `src/utils/openfeature.ts`

**Role**:

- Provides utilities for checking Grafana feature toggles
- Centralized feature flag constants
- Type-safe feature flag access

**Key Exports**:

- `pathfinderFeatureFlags` - Feature flag definitions (names, default values, tracking keys)
- `evaluateFeatureFlag()` - Async function to evaluate a flag's value
- `getFeatureFlagValue()` - Synchronous boolean flag check
- `getStringFlagValue()` - Synchronous string flag check
- `initializeOpenFeature()` - Initialize the OpenFeature SDK
- `ExperimentConfig` / `getExperimentConfig()` - Experiment configuration types and accessor

**Used By**:

- `src/utils/experiment-debug.ts` - Experiment debugging console tools
- `src/utils/openfeature-tracking.ts` - Flag evaluation analytics tracking
- Components requiring feature flag checks

---

### `dev-mode.ts` ⭐ **Development Mode Utilities**

**Purpose**: Development mode detection and utilities
**Location**: `src/utils/dev-mode.ts`

**Role**:

- Detects development mode
- Provides dev-only functionality
- Enables debug features

**Used By**:

- Development tools and debug panels
- Components requiring dev-mode checks

---

### `safe-event-handler.util.ts` ⭐ **Safe Event Handlers**

**Purpose**: Safe event handler utilities with error handling
**Location**: `src/utils/safe-event-handler.util.ts`

**Role**:

- Wraps event handlers with error boundaries
- Prevents event handler errors from crashing the app
- Provides safe event handling patterns

**Used By**:

- Components requiring robust event handling
- Interactive elements with user-triggered events

---

## Development Tools (`devtools/`)

The `devtools/` subdirectory contains development-only utilities for creating and testing interactive guides. All public exports are consolidated through `index.ts`.

### Structure

- **`index.ts`** - Barrel export for all devtools utilities
- **`dev-tools.types.ts`** - Shared types (`StepDefinition`, `SelectorInfo`, `ExtractedSelector`)

### Action Recording

- **`action-recorder.hook.ts`** - React hook for recording user actions
- **`action-recorder.util.ts`** - Selector extraction and step filtering utilities

### Element Inspection

- **`element-inspector.hook.ts`** - DOM element inspection hook
- **`hover-highlight.util.ts`** - Visual element highlighting

### Selector Generation

- **`selector-generator.util.ts`** - Generate CSS selectors from DOM events

### Step Parsing & Export

- **`step-parser.util.ts`** - Parse step definitions from strings
- **`tutorial-exporter.ts`** - Export tutorials in various formats (HTML, guided, multistep)

---

## Where to Find Other Functionality

### Interactive Guide System

**Location**: `src/interactive-engine/`

- `interactive.hook.ts` - Main interactive elements hook
- `action-handlers/` - Action execution handlers
- `navigation-manager.ts` - Element navigation
- `sequence-manager.ts` - Sequential execution
- See `docs/developer/engines/interactive-engine.md` for details

### Context & Recommendations

**Location**: `src/context-engine/`

- `context.hook.ts` - Context panel hook
- `context.service.ts` - Context data service
- See `docs/developer/engines/context-engine.md` for details

### Requirements System

**Location**: `src/requirements-manager/`

- `step-checker.hook.ts` - Step requirements/objectives checking
- `requirements-checker.hook.ts` - Requirements validation
- `requirements-checker.utils.ts` - Requirement check functions
- See `docs/developer/engines/requirements-manager.md` for details

### Content Retrieval

**Location**: `src/docs-retrieval/` (top-level, not under utils)

- `content-fetcher.ts` - Content fetching
- `html-parser.ts` - HTML parsing
- `content-renderer.tsx` - React rendering
- See `docs/architecture.dot` for details (GraphViz DOT architecture)

---

## Architecture Note

This directory structure reflects a major architectural refactoring where business logic was moved from a monolithic component into specialized engine modules. The `utils/` directory now contains only general-purpose utilities and development tools, while domain-specific logic lives in dedicated engine directories.
