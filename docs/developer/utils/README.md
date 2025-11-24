# Utils Directory

Utility functions and helper modules. **Note**: Most business logic hooks have been moved to specialized engine directories. This directory now contains only general-purpose utilities.

## Important: Hook Location Changes

**⚠️ CRITICAL**: Many hooks previously documented here have been moved to specialized engine directories:

- **Interactive hooks** → `src/interactive-engine/` (see `interactive-engine/interactive.hook.ts`)
- **Context hooks** → `src/context-engine/` (see `context-engine/context.hook.ts`)
- **Requirements hooks** → `src/requirements-manager/` (see `requirements-manager/step-checker.hook.ts`)

Only the following hooks remain in `src/utils/`:

## File Organization

### 🎣 **React Hooks** (Remaining in utils/)

- `keyboard-shortcuts.hook.ts` - Keyboard navigation shortcuts
- `link-handler.hook.ts` - Link click handling and lightbox

### 🛠️ **Utilities & Configuration**

- `utils.plugin.ts` - Plugin props context management
- `utils.routing.ts` - Route prefixing utilities
- `timeout-manager.ts` - Centralized timeout/debounce management
- `dev-mode.ts` - Development mode utilities
- `openfeature.ts` - Feature toggle utilities

### 🔧 **Development Tools** (`devtools/`)

- `action-recorder.hook.ts` - Record user actions for guide creation
- `element-inspector.hook.ts` - DOM element inspection
- `selector-capture.hook.ts` - CSS selector generation
- `selector-generator.util.ts` - Automated selector generation
- `selector-tester.hook.ts` - Test CSS selectors
- `step-executor.hook.ts` - Test step execution
- `step-parser.util.ts` - Parse step definitions
- `tutorial-exporter.ts` - Export tutorials
- `action-recorder.util.ts` - Action recording utilities

### 🔒 **Security & Safety**

- `safe-event-handler.util.ts` - Safe event handler utilities

---

## React Hooks (In utils/)

### `keyboard-shortcuts.hook.ts` ⭐ **Navigation Shortcuts**

**Purpose**: Provides keyboard shortcuts for efficient navigation
**Location**: `src/utils/keyboard-shortcuts.hook.ts`

**Role**:

- Tab switching with Ctrl/Cmd+Tab
- Tab closing with Ctrl/Cmd+W
- Milestone navigation with Alt+Arrow keys

**Shortcuts**:

- `Ctrl/Cmd + W` - Close current tab
- `Ctrl/Cmd + Tab` - Switch between tabs
- `Alt + →` - Next milestone
- `Alt + ←` - Previous milestone

**Used By**:

- `src/components/docs-panel/docs-panel.tsx` - Keyboard navigation

---

### `link-handler.hook.ts` ⭐ **Link & Interaction Handler**

**Purpose**: Handles clicks on various interactive elements in content
**Location**: `src/utils/link-handler.hook.ts`

**Role**:

- Journey start button handling
- Image lightbox creation and management
- Side journey and related journey link handling
- Bottom navigation (Previous/Next) button handling

**Key Features**:

- **Journey Start**: Navigates to first milestone
- **Image Lightbox**: Creates responsive modal with theme support
- **External Links**: Opens side journeys in new tabs
- **Internal Navigation**: Opens related journeys in new app tabs
- **Bottom Navigation**: Milestone Previous/Next handling

**Link Types Handled**:

- `[data-journey-start="true"]` - Journey start buttons
- `img` elements - Image lightbox
- `[data-side-journey-link]` - External side journey links
- `[data-related-journey-link]` - Internal related journey links
- `.journey-bottom-nav-button` - Navigation buttons

**Used By**:

- `src/components/docs-panel/docs-panel.tsx` - Content interaction handling

---

## Utility Files

### `utils.plugin.ts` ⭐ **Plugin Props Management**

**Purpose**: Context management for plugin props throughout the component tree
**Location**: `src/utils/utils.plugin.ts`

**Role**:

- Provides React context for plugin props
- Hooks for accessing plugin metadata
- Ensures plugin props are available to all components

**Key Exports**:

- `PluginPropsContext` - React context provider
- `usePluginProps()` - Hook for accessing plugin props
- `usePluginMeta()` - Hook for accessing plugin metadata

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

- `FeatureFlags` - Feature flag constants
- `getFeatureToggle()` - Function to check feature toggle state

**Used By**:

- `src/components/AppConfig/ConfigurationForm.tsx` - Feature configuration
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

The `devtools/` subdirectory contains development-only utilities for creating and testing interactive guides:

### Action Recording

- **`action-recorder.hook.ts`** - React hook for recording user actions
- **`action-recorder.util.ts`** - Action recording utilities

### Element Inspection

- **`element-inspector.hook.ts`** - DOM element inspection hook
- **`hover-highlight.util.ts`** - Visual element highlighting

### Selector Tools

- **`selector-capture.hook.ts`** - Capture CSS selectors from user interactions
- **`selector-generator.util.ts`** - Generate CSS selectors automatically
- **`selector-tester.hook.ts`** - Test CSS selectors against DOM

### Step Execution

- **`step-executor.hook.ts`** - Execute test steps programmatically
- **`step-parser.util.ts`** - Parse step definitions

### Export

- **`tutorial-exporter.ts`** - Export tutorials in various formats

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
- See `docs/developer/ARCHITECTURE.md` for details

---

## Architecture Note

This directory structure reflects a major architectural refactoring where business logic was moved from a monolithic component into specialized engine modules. The `utils/` directory now contains only general-purpose utilities and development tools, while domain-specific logic lives in dedicated engine directories.
