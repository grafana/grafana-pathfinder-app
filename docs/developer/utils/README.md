# Utils directory

Utility functions and helper modules shared across Pathfinder. Most business logic hooks live in specialized engine directories, while this directory contains cross-cutting browser, routing, feature flag, backend API, and development-tool helpers.

## Hook locations

Business logic hooks previously documented here have moved to specialized engine directories:

- **Interactive hooks** → `src/interactive-engine/` (see `interactive-engine/interactive.hook.ts`)
- **Context hooks** → `src/context-engine/` (see `context-engine/context.hook.ts`)
- **Requirements hooks** → `src/requirements-manager/` (see `requirements-manager/step-checker.hook.ts`)

The only top-level hook in `src/utils/` is `usePublishedGuides.ts`. Development-only hooks remain under `src/utils/devtools/`.

## File organization

### React hook

- `usePublishedGuides.ts` - Fetches published guides from the backend API

### Utilities and configuration

- `fetchBackendGuides.ts` - Shared utility for fetching backend guides from the API
- `interactive-guides-api.ts` - App Platform API availability and URL helpers
- `find-doc-page.ts` - Resolves deep-link document identifiers into loadable pages
- `pathfinder-deep-link-handler.ts` - Processes deep links and coordinates panel launch
- `pathfinder-search-params.ts` - Parses Pathfinder URL parameters and builds share, full-screen, and controller-pairing URLs
- `slug.ts` - Stable and unique document-heading slug generation
- `utils.plugin.ts` - Plugin props context management
- `utils.routing.ts` - Route prefixing utilities
- `timeout-manager.ts` - Centralized timeout/debounce management
- `dev-mode.ts` - Development mode utilities
- `openfeature.ts` - Feature toggle utilities
- `openfeature-tracking.ts` - OpenFeature hook for tracking flag evaluations to analytics
- `sidebar-auto-open.ts` - Config-driven sidebar auto-open on launch (open-panel-on-launch)
- `experiments/` - Highlighted-guide experiment orchestration, recommendation helpers, and the `window.__pathfinderExperiment` debug surface
- `variable-substitution.ts` - Template variable (`{{variableName}}`) substitution for dynamic content

### Development tools (`devtools/`)

- `index.ts` - Barrel export for all devtools utilities
- `dev-tools.types.ts` - Shared types (`StepDefinition`, `SelectorInfo`, `ExtractedSelector`)
- `action-recorder.hook.ts` - Record user actions for guide creation
- `action-recorder.util.ts` - Action recording utilities (selector extraction, step filtering)
- `element-inspector.hook.ts` - DOM element inspection
- `hover-highlight.util.ts` - Visual element highlighting during inspection
- `selector-generator.util.ts` - Automated CSS selector generation
- `step-parser.util.ts` - Parse step definitions
- `tutorial-exporter.ts` - Export tutorials in various formats

### Security and safety

- `safe-event-handler.util.ts` - Safe event handler utilities

---

## React hook

### `usePublishedGuides.ts`

**Purpose**: Fetches published interactive guides from the backend API.
**Location**: `src/utils/usePublishedGuides.ts`

**Role**:

- Loads guides from the backend on mount
- Exposes loading, initial-load completion, and error state
- Provides `refreshGuides()` for manual refresh

**Key Exports**:

- `usePublishedGuides()` - Hook returning `{ guides, isLoading, hasLoaded, error, refreshGuides }`
- `PublishedGuide` - Type for guide metadata and spec

**Used By**:

- `src/components/docs-panel/context-panel.tsx` - Context panel custom guides
- `src/components/docs-panel/CustomGuidesSection.tsx` - Custom guides section (type import)

---

## Utility files

### `fetchBackendGuides.ts`

**Purpose**: Shared utility for fetching guides from the backend API.
**Location**: `src/utils/fetchBackendGuides.ts`

**Role**:

- Calls the pathfinder backend API for interactive guides in a namespace
- Returns empty array when endpoint is unavailable (400, 403, 404, 405, 501, 503)
- Optionally returns only guides whose `spec.status` is `published`
- Re-throws other errors for caller handling

**Key Function**:

```typescript
async function fetchBackendGuides(namespace: string, publishedOnly?: boolean): Promise<any[]>;
```

**Used By**:

- `src/utils/usePublishedGuides.ts` - Published guides hook
- `src/components/block-editor/hooks/useBackendGuides.ts` - Block editor backend guides

---

### `interactive-guides-api.ts`

**Purpose**: Defines the InteractiveGuide App Platform API contract.

**Key exports**:

- `APP_PLATFORM_GROUP` and `APP_PLATFORM_API_VERSION` - API group and version
- `isBackendApiAvailable()` - Checks the Grafana aggregation feature toggle
- `collectionUrl()` and `itemUrl()` - Build namespace-scoped API URLs

**Used by**:

- `src/context-engine/context.init.ts`
- `src/docs-retrieval/content-fetcher/backend-guide.ts`
- `src/components/block-editor/hooks/useBackendGuides.ts`
- `src/utils/fetchBackendGuides.ts`

---

### `find-doc-page.ts`

**Purpose**: Resolves a deep-link document value into a typed page descriptor.

`findDocPage()` supports App Platform guides (`api:` and `backend-guide:`), bundled interactives, Interactive Learning URLs, curated static links, and allowed Grafana documentation URLs. It returns the page type, URL, title, and an optional redirect target.

**Used by**:

- `src/utils/pathfinder-deep-link-handler.ts`
- `src/utils/experiments/highlighted-guide-utils.ts`
- `src/utils/experiments/highlighted-guide-orchestrator.ts`
- `src/components/full-screen/FullScreenPanel.tsx`

---

### `pathfinder-search-params.ts`

**Purpose**: Centralizes the URL contract for Pathfinder deep links.

**Key exports**:

- `parsePathfinderDeepLink()` and `stripPathfinderParams()` - Parse and remove Pathfinder-controlled query parameters
- `buildPathfinderShareUrl()` and `buildFullScreenRouteUrl()` - Build encoded guide URLs
- `buildControllerPairingHash()` and `parseControllerPairingHash()` - Encode and parse controller pairing data
- `shouldOpenAsLearningJourney()` - Resolve the guide surface from URL attribution

**Used by**:

- `src/module.tsx`
- Full-screen, floating-panel, and docs-panel components
- `src/hooks/useAutoLaunchTutorial.ts`

---

### `pathfinder-deep-link-handler.ts`

**Purpose**: Processes Pathfinder deep links at startup and during Grafana SPA navigation.

`handlePathfinderDeepLink()` applies requested panel modes, handles kiosk sessions and safe redirects, resolves the requested document, and dispatches it to the first mounted Pathfinder surface. `installDeepLinkNavListener()` re-runs the handler on navigation.

**Used by**:

- `src/module.tsx`

---

### `slug.ts`

**Purpose**: Generates normalized, de-duplicated heading slugs for document outlines.

**Key exports**:

- `slugify()` - Normalizes heading text to a URL-safe slug
- `uniqueSlug()` - Adds a numeric suffix when a slug is already taken

**Used by**:

- `src/hooks/useDocumentOutline.ts`

---

### `utils.plugin.ts`

**Purpose**: Context management for plugin props throughout the component tree.
**Location**: `src/utils/utils.plugin.ts`

**Role**:

- Provides React context for plugin props
- Updates plugin settings through Grafana's backend service

**Key Exports**:

- `PluginPropsContext` - React context for sharing `AppRootProps`
- `updatePluginSettings()` - Function to update plugin settings via API

**Used By**:

- `src/components/App/App.tsx` - Context provider setup
- `src/components/AppConfig/ConfigurationForm.tsx`
- `src/components/AppConfig/InteractiveFeatures.tsx`
- `src/components/AppConfig/TermsAndConditions.tsx`

---

### `utils.routing.ts`

**Purpose**: URL and routing utilities for consistent plugin navigation.
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
- `src/pages/fullScreenPage.ts` - Full-screen route definition
- `src/pages/homePage.ts` - Home route definition

---

### `timeout-manager.ts`

**Purpose**: Centralized timeout, interval, and debounce management.
**Location**: `src/utils/timeout-manager.ts`

**Role**:

- Prevents competing timeout mechanisms
- Provides debounced function creation
- Manages timeout cleanup

**Key Exports**:

- `TimeoutManager` - Singleton manager for keyed timeouts and intervals
- `useTimeoutManager()` - Hook for timeout management

**Used By**:

- `src/context-engine/context.hook.ts` - Context refresh debouncing
- `src/interactive-engine/global-interaction-blocker.ts` - Interaction-blocking intervals
- `src/requirements-manager/` - Requirement polling and debouncing

---

### `openfeature.ts`

**Purpose**: Typed OpenFeature flag evaluation for Pathfinder.
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
- `getHighlightedGuideConfig()` and `getActiveExperiments()` - Highlighted-guide experiment state
- `initializeOpenFeature()` - Initialize the OpenFeature SDK
- `useBooleanFlag`, `useStringFlag`, and `useNumberFlag` - React flag hooks

**Used By**:

- `src/utils/experiments/experiment-debug.ts` - Experiment debugging console tools
- `src/utils/experiments/highlighted-guide-orchestrator.ts` - Experiment auto-open setup
- `src/utils/openfeature-tracking.ts` - Flag evaluation analytics tracking
- `src/module.tsx` - Provider initialization, kill switches, and experiment analytics
- `src/context-engine/context.service.ts` - Highlighted-guide recommendation injection

---

### `openfeature-tracking.ts`

**Purpose**: Reports enrolled experiment exposures to Pathfinder analytics.

`TrackingHook` delegates OpenFeature evaluations to `reportFeatureFlagExposure()`. Only `control` and `treatment` variants of tracked object-valued Pathfinder flags are reported, with browser-and-hostname deduplication.

**Used by**:

- `src/utils/openfeature.ts`

---

### `experiments/`

**Purpose**: Implements the highlighted-guide experiment.

- `highlighted-guide-orchestrator.ts` - Initializes reset state, page matching, once-per-browser auto-open, and guide launch
- `highlighted-guide-utils.ts` - Manages auto-open markers, matches target pages, and builds featured recommendations
- `experiment-debug.ts` - Exposes flag overrides and exposure inspection through `window.__pathfinderExperiment`
- `index.ts` - Public exports consumed by `src/module.tsx` and `src/context-engine/context.service.ts`

---

### `sidebar-auto-open.ts`

**Purpose**: Opens the Pathfinder sidebar when enabled by plugin configuration or the `pathfinder.auto-open-sidebar` flag.

It avoids taking an extension sidebar owned by another plugin and defers auto-open until Grafana's onboarding flow has been left.

**Used by**:

- `src/module.tsx`
- `src/utils/experiments/highlighted-guide-orchestrator.ts`

---

### `dev-mode.ts`

**Purpose**: Per-user development and Assistant development-mode management.
**Location**: `src/utils/dev-mode.ts`

**Role**:

- Reads per-user development-mode state from plugin configuration
- Adds or removes users while preserving unrelated plugin settings
- Exposes global checks for code outside React components

**Used By**:

- Plugin configuration and docs-panel components
- Docs retrieval and URL security helpers
- Assistant integration helpers

---

### `variable-substitution.ts`

**Purpose**: Replaces `{{variableName}}` placeholders with stored guide responses.

In addition to `substituteVariables()`, the module can detect and extract placeholders, report missing response values, and substitute across multiple strings.

**Used by**:

- `src/components/interactive-tutorial/grot-guide-block.tsx`

---

### `safe-event-handler.util.ts`

**Purpose**: Applies event cancellation and propagation options safely.
**Location**: `src/utils/safe-event-handler.util.ts`

**Role**:

- Calls `preventDefault()` only for cancelable events
- Optionally stops propagation or immediate propagation
- Provides non-passive and passive listener option constants

**Used By**:

- `src/components/docs-panel/link-handler.hook.ts`
- `src/components/docs-panel/keyboard-shortcuts.hook.ts`

---

## Development tools (`devtools/`)

The `devtools/` subdirectory contains development-only utilities for creating and testing interactive guides. All public exports are consolidated through `index.ts`.

### Structure

- **`index.ts`** - Barrel export for all devtools utilities
- **`dev-tools.types.ts`** - Shared types (`StepDefinition`, `SelectorInfo`, `ExtractedSelector`)

### Action recording

- **`action-recorder.hook.ts`** - React hook for recording user actions
- **`action-recorder.util.ts`** - Selector extraction and step filtering utilities

### Element inspection

- **`element-inspector.hook.ts`** - DOM element inspection hook
- **`hover-highlight.util.ts`** - Visual element highlighting

### Selector generation

- **`selector-generator.util.ts`** - Generate CSS selectors from DOM events

### Step parsing and export

- **`step-parser.util.ts`** - Parse step definitions from strings
- **`tutorial-exporter.ts`** - Export tutorials in various formats (HTML, guided, multistep)

---

## Where to find other functionality

### Interactive guide system

**Location**: `src/interactive-engine/`

- `interactive.hook.ts` - Main interactive elements hook
- `action-handlers/` - Action execution handlers
- `navigation-manager.ts` - Element navigation
- `sequence-manager.ts` - Sequential execution
- See `docs/developer/engines/interactive-engine.md` for details

### Context and recommendations

**Location**: `src/context-engine/`

- `context.hook.ts` - Context panel hook
- `context.service.ts` - Context data service
- See `docs/developer/engines/context-engine.md` for details

### Requirements system

**Location**: `src/requirements-manager/`

- `step-checker.hook.ts` - Step requirements/objectives checking
- `requirements-checker.hook.ts` - Requirements validation
- `requirements-checker.utils.ts` - Requirement check functions
- See `docs/developer/engines/requirements-manager.md` for details

### Content retrieval

**Location**: `src/docs-retrieval/` (top-level, not under utils)

- `content-fetcher.ts` - Content fetching
- `html-parser.ts` - HTML parsing
- `json-parser.ts` - Structured guide content parsing
- `components/docs/` - React renderers for documentation blocks
- See `docs/architecture.dot` for details (GraphViz DOT architecture)

---

## Architecture note

This directory structure reflects a major architectural refactoring where business logic was moved from a monolithic component into specialized engine modules. The `utils/` directory retains cross-cutting services used by multiple engines and surfaces, including deep-link handling, feature flag evaluation, and App Platform API helpers.
