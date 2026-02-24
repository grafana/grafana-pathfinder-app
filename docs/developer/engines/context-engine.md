# Context Engine

The Context Engine (`src/context-engine/`) analyzes the user's current Grafana state and provides context-aware documentation recommendations. It combines URL path analysis, EchoSrv event monitoring, and Grafana API data to generate personalized recommendations. Learning paths were previously called "learning journeys" — the internal type value `'learning-journey'` is preserved for backward compatibility, but user-facing references use "learning path".

## Design intent

<!-- intent -->

**Purpose**: The Context Engine exists to fulfill the project's core goal of personalized, in-product documentation — "Grafana should sense what you need and give you that, not everything" (from `projectbrief.mdc`). It bridges user activity signals (URL navigation, EchoSrv analytics events, API data) to a recommendation system that surfaces relevant learning content without requiring users to search externally.

**Constraints**:

- Debouncing is handled at the hook level (`useContextPanel`), not the service level, to provide a single unified control point for all refresh triggers (from code comment in `context.service.ts`: "Debouncing removed from service level — now handled at hook level for unified control")
- State that must persist across React component lifecycles (event buffer, EchoSrv initialization flag, detected types) uses static class properties on `ContextService` (from `context.service.ts` implementation)
- External recommender communication requires HTTPS and domain allowlist validation; dev mode is the only exception (from Security Measures section below)
- User identifiers are always hashed (SHA-256 for Cloud, generic placeholders for OSS) — no PII leaves the plugin (from Privacy Protection section below)

**Non-goals**:

- Not a replacement for reference documentation — targets beginners and intermediate users, not deep experts (from `projectbrief.mdc`)
- Does not create, modify, or cache content — only discovers and routes to existing content
- Does not implement its own debounce/timer primitives — delegates to the shared `TimeoutManager` utility

**Key tradeoffs**:

- Three-tier fallback (external → bundled → static): Availability over precision — bundled content uses fixed accuracy scores (0.8 / 0.7) rather than ML-based semantic matching, ensuring the plugin works in air-gapped and offline environments (from Recommendation Flow section below)
- Event buffer size (10 events, 5-minute TTL): Memory efficiency over completeness — only recent context signals are preserved across plugin close/reopen cycles (from Event Buffering section below)
- Confidence threshold (0.5): Relevance over recall — low-confidence recommendations are filtered out to avoid noise, at the cost of potentially missing edge-case matches (from Recommendation Scoring section below)

**Stability**: stable

## Overview

The Context Engine monitors user activity in Grafana by tracking location changes, listening to analytics events, and fetching datasource and dashboard information. It generates context tags from this data and sends them to an external recommendation service to retrieve relevant documentation, learning paths, and interactive guides. When the external service is unavailable or disabled, it falls back to bundled interactives and static link recommendations.

## Architecture

### Core Components

- **`context.service.ts`** - Main service for context data collection, tag generation, and recommendation fetching
- **`context.hook.ts`** - React hook providing context state management and debouncing
- **`context.init.ts`** - Plugin lifecycle initialization for EchoSrv event logging
- **`index.ts`** - Public API exports for the context engine
- **`context-security.test.ts`** - Security test suite (URL validation, sanitization, fallback behavior)
- **`context.service.completion.test.ts`** - Completion percentage storage selection tests (verifies learning paths use journeyCompletionStorage, interactives use interactiveCompletionStorage)

## Main Service

### `ContextService`

**Location**: `src/context-engine/context.service.ts`

**Purpose**: Centralized service for collecting Grafana context, generating semantic tags, and fetching personalized recommendations

**Key Features**:

- Collects context from multiple sources: URL paths, EchoSrv events, and Grafana APIs
- Generates semantic tags for recommendation matching
- Fetches recommendations from external recommendation service with security validation
- Provides three-tier fallback system: external service, bundled interactives, and static links
- Uses type-specific completion storage: `journeyCompletionStorage` for learning paths, `interactiveCompletionStorage` for interactive guides
- Handles error states with user-friendly messages and automatic fallback
- Manages event buffering to preserve context when plugin is closed and reopened
- Implements security measures including HTTPS validation, domain allowlisting, and XSS protection

**Public Methods**:

- `getContextData()` - Collects full Grafana context (path, datasources, dashboard info, tags, platform)
- `fetchRecommendations(contextData, pluginConfig)` - Fetches recommendations with three-tier fallback
- `fetchDataSources()` - Fetches all configured datasources via `/api/datasources`
- `fetchPlugins()` - Fetches all installed plugins via `/api/plugins` (used by requirements manager for `has-plugin:` checks)
- `fetchDashboardsByName(name)` - Searches dashboards by title via `/api/search` (used by requirements manager for `has-dashboard-named:` and `dashboard-exists` checks)
- `onContextChange(listener)` - Subscribes to context changes; returns unsubscribe function (used by `SequentialRequirementsManager` for reactive rechecking)
- `initializeFromRecentEvents()` - Restores datasource/visualization state from event buffer on plugin startup
- `initializeEchoLogging()` - Registers EchoSrv backend for analytics event capture
- `getDetectedDatasourceType()` - Returns the current EchoSrv-detected datasource type
- `getDetectedVisualizationType()` - Returns the current EchoSrv-detected visualization type
- `getLastRecommenderError()` - Returns last external recommender error state (type, timestamp, message) for debugging

**Context Data Collected**:

- Current page path, URL, and path segments
- Search parameters from URL query strings
- Active datasources from Grafana API
- Dashboard information including UID, title, tags, and folder
- Datasource type from EchoSrv events (new datasource, datasource picker, query execution)
- Visualization type from EchoSrv panel picker events
- User role and hashed user identifiers for Cloud users
- Grafana version, platform (Cloud vs OSS), theme, and language/locale

## Main Hook

### `useContextPanel()`

**Location**: `src/context-engine/context.hook.ts`

**Purpose**: React hook providing context state management, debouncing, and action handlers for UI components

**Key Features**:

- Monitors URL location changes via browser events and Grafana LocationService
- Subscribes to EchoSrv-triggered context changes for datasource and visualization events
- Centralizes debouncing using TimeoutManager to prevent competing refresh mechanisms
- Separates context data loading from recommendation fetching for better performance
- Manages recommendation expansion state and error handling
- Provides action handlers for opening learning paths and docs pages
- Refreshes recommendations when interactive progress is cleared

**Return Shape**:

- `contextData` - Current context data (path, tags, datasources, dashboard info, etc.)
- `isLoadingRecommendations` - Whether recommendations are currently being fetched
- `otherDocsExpanded` - Whether the "other docs" section is expanded
- `refreshContext()` - Manually trigger a context refresh
- `refreshRecommendations()` - Manually trigger a recommendations refresh
- `openLearningJourney(url, title)` - Open a learning path in the panel
- `openDocsPage(url, title)` - Open a docs page in the panel
- `toggleSummaryExpansion(url)` - Toggle recommendation summary expansion
- `navigateToPath(path)` - Navigate to a Grafana path
- `toggleOtherDocsExpansion()` - Toggle other docs section visibility

**Backward-compatible Hooks**:

The module also exports two backward-compatible hooks for consumers that only need a subset of the context panel state:

- `useContextData()` - Returns `contextData` only
- `useRecommendations()` - Returns recommendations, loading state, and error state

## Context Detection

The engine detects context through multiple sources:

1. **Location Service** - Monitors URL changes via browser popstate events and Grafana's LocationService history listener. Tracks pathname changes to detect page navigation.

2. **EchoSrv Events** - Listens to Grafana analytics events for real-time user interactions:
   - `grafana_ds_add_datasource_clicked` - New datasource configuration
   - `grafana_ds_test_datasource_clicked` - Datasource testing (workaround for edit detection)
   - `dashboards_dspicker_clicked` - Dashboard datasource selection
   - `dashboards_panel_plugin_picker_clicked` - Visualization type selection
   - `data-request` (meta-analytics) - Active query execution in Explore or dashboards

3. **Backend APIs** - Fetches structured data from Grafana REST APIs:
   - `/api/datasources` - All configured datasources with types and metadata
   - `/api/dashboards/uid/{uid}` - Dashboard metadata including title, tags, and folder
   - `/api/plugins` - All installed plugins with types and enabled state
   - `/api/search` - Dashboard search by title (params: `type: 'dash-db'`, `limit: 100`, `deleted: false`)

## Tag Generation

Context tags are semantic identifiers generated from user context to match relevant documentation:

- **Entity-Action tags** - Extracted from URL paths (e.g., `dashboard:edit`, `datasource:create`, `explore:view`)
- **Selected datasource tags** - From EchoSrv events (e.g., `selected-datasource:prometheus`, `selected-datasource:loki`)
- **Panel type tags** - Only when creating/editing visualizations (e.g., `panel-type:timeseries`, `panel-type:gauge`)
- **Connection type tags** - From add-new-connection URLs (e.g., `connection-type:clickhouse`)
- **Datasource type tags** - From connections and datasources pages (e.g., `datasource-type:prometheus`)
- **Dashboard tags** - From dashboard metadata (e.g., `dashboard-tag:monitoring`)
- **UI state tags** - From query parameters (e.g., `ui:tabbed`, `ui:fullscreen`, `ui:kiosk`)

Tags are sent to the external recommendation service as part of the context payload for semantic matching.

## Recommendation Flow

The recommendation system follows a three-tier approach with automatic fallback:

### Tier 1: External Recommendation Service

1. **Context Collection** - Fetch current Grafana state via `getContextData()`
2. **Tag Generation** - Create semantic tags from URL, events, and API data
3. **Security Validation** - Validate recommender service URL against domain allowlist
4. **User Privacy** - Hash user identifiers and email for Cloud users (OSS users use generic identifiers)
5. **API Request** - POST context payload to external recommender service with 5-second timeout
6. **XSS Protection** - Sanitize recommendations using explicit allowlist to prevent prototype pollution
7. **Completion Processing** - Fetch metadata and completion percentages for learning paths and interactive guides. Uses type-specific storage: learning paths read from `journeyCompletionStorage` (via `getJourneyCompletionPercentageAsync`), interactives read from `interactiveCompletionStorage`. Bundled interactives (URLs starting with `bundled:`) are skipped here and handled by `buildBundledInteractiveRecommendations` instead.
8. **Filtering** - Remove low-confidence recommendations (below 0.5 threshold)
9. **Sorting** - Prioritize by type (interactive > learning-journey > docs-page), then by accuracy

### Tier 2: Bundled Interactives (on external service failure)

1. **Load Index** - Read `bundled-interactives/index.json` for available guides
2. **URL Matching** - Filter interactives by current URL path and platform (Cloud/OSS)
3. **Completion Tracking** - Include user progress from local storage

### Tier 3: Static Links (fallback when recommender is disabled)

1. **Load Rules** - Dynamically require all JSON files from `bundled-interactives/static-links/`
2. **URL Prefix Matching** - Match current path against rule URL prefixes
3. **Platform Filtering** - Filter by target platform (Cloud/OSS)
4. **Top-Level Only** - Exclude tag-based rules (only navigation-level recommendations)

## Timeout Management

The engine uses a centralized `TimeoutManager` (`src/utils/timeout-manager.ts`) to prevent competing debounce mechanisms:

**Location**: Hook-level debouncing in `useContextPanel()`

**Purpose**: Single source of truth for all timeout operations

**Key Features**:

- Debounces context refreshes to prevent rapid-fire API calls
- Cancels previous timeouts when new events arrive (true debouncing behavior)
- Uses configurable delays from `INTERACTIVE_CONFIG` constants
- Provides `setDebounced()` for operations requiring cancellation
- Provides `setTimeout()` for simple delays without interference
- Provides `setInterval()` / `clearInterval()` for managed intervals (prevents interval stacking; used by global-interaction-blocker for modal polling)
- Provides `isActive()` / `isIntervalActive()` / `getActiveKeys()` for debugging and state checks
- Manages cleanup on component unmount via `clearAll()`
- Accessible in React via the `useTimeoutManager()` hook

## Event Buffering

The service maintains an in-memory event buffer to preserve context across plugin lifecycle:

**Buffer Specifications**:

- Maximum 10 events stored
- 5-minute TTL for events
- Stores datasource type, visualization type, timestamp, and event source
- Event source strings: `'add'`, `'test'`, `'dashboard-picker'`, `'panel-picker'`, `'{source}-query'` (e.g., `'explore-query'`, `'dashboard-query'`)
- Automatically cleaned on buffer overflow

**Use Cases**:

- Plugin close/reopen scenarios - preserves last known datasource and visualization context
- Missed events during plugin downtime - recovers from recent events
- Initialization on plugin startup - calls `initializeFromRecentEvents()` to restore state

**Implementation**: Static properties on `ContextService` class maintain state across React component lifecycles.

## Integration Points

The Context Engine integrates with multiple systems:

**Internal Dependencies**:

- **Content Fetcher** (`docs-retrieval/content-fetcher.ts`) - Fetches learning path metadata and content
- **Context Panel** (`components/docs-panel/context-panel.tsx`) - Primary UI consumer using `useContextPanel()` hook
- **Timeout Manager** (`utils/timeout-manager.ts`) - Centralized debouncing and timeout management
- **User Storage** (`lib/user-storage.ts`) - Stores interactive and learning path completion percentages
- **Hash Utility** (`lib/hash.util.ts`) - Hashes user identifiers for privacy
- **Security Utilities** (`security/`) - Text sanitization and URL parsing

**External Dependencies**:

- **Grafana Runtime** - LocationService for navigation, BackendSrv for API calls, EchoSrv for events, config for system info
- **Grafana Data** - Plugin context for configuration
- **External Recommendation Service** - Remote API at `recommender.grafana.com` for ML-powered recommendations
- **docs-retrieval** - `getJourneyCompletionPercentageAsync` for learning path completion, `fetchContent` for content metadata

**Initialization**:

- Called via `onPluginStart()` in `App.tsx` during plugin mount
- Registers EchoSrv backend immediately to capture events even when plugin UI is closed

## Security Measures

The Context Engine implements multiple security layers:

**URL Validation**:

- HTTPS-only requirement for external recommender service (dev mode allows HTTP)
- Domain allowlist with exact hostname matching (no wildcards)
- URL parsing with safe fallbacks to prevent injection attacks

**XSS Protection**:

- Explicit allowlist for recommendation properties (blocks `__proto__`, `constructor`, dangerous properties)
- Text sanitization for display to prevent script injection
- No spread operators on external API responses to prevent prototype pollution

**Privacy Protection**:

- User identifiers and emails hashed with SHA-256 for Cloud users
- OSS users use generic identifiers (`oss-user`, `oss-user@example.com`)
- Source hostname hashing for Cloud instances (except public `play.grafana.org`)
- No sensitive data sent to external services

**Error Boundaries**:

- Graceful degradation when external service fails
- User-friendly error messages without exposing internal details
- Automatic fallback to bundled content maintains functionality

## Error Handling

The service implements a comprehensive error handling strategy:

**Error Types**:

- `unavailable` - Service timeout, CORS, or network failure
- `rate-limit` - HTTP 429 response when service is under strain
- `other` - Validation failures, parsing errors, or unexpected issues

**Error Response**:

- User-friendly messages displayed in UI
- Error state tracked in `lastExternalRecommenderError` with timestamp
- Automatic fallback to bundled interactives and static links
- Service continues retrying on next context change (no permanent failure state)

**Fallback Behavior**:

- External service failure → bundled interactives + static links
- Recommender disabled → bundled interactives + static links only
- Content fetch failure → empty recommendations with graceful error display

## Bundled Content System

The Context Engine includes offline-capable bundled content located in `src/bundled-interactives/`:

**Bundled Interactives** (`index.json`):

- JSON guide files containing interactive tutorials and walkthroughs
- Indexed by ID, title, summary, URL patterns, and target platform
- Support multiple URL patterns per interactive (array format)
- Platform filtering for Cloud-specific or OSS-specific content
- Matched by exact URL path comparison
- Accuracy score: 0.8 (high confidence for bundled content)

**Static Links** (`static-links/*.json`):

- Platform-specific documentation link collections organized by topic
- Rule-based matching using URL prefix patterns and platform targeting
- Support for logical operators (AND/OR) in match conditions
- Files organized by category: alerting, explore, administration, AI/ML, etc.
- Only top-level navigation rules used (tag-based rules filtered out)
- Accuracy score: 0.7 (good confidence for static fallbacks)

**Content Discovery**:

- Uses webpack `require.context` for dynamic file loading
- Deduplicates file paths to handle webpack finding same files with different paths
- Graceful error handling if files fail to load
- No external network requests required for bundled content

## Recommendation Scoring

Recommendations are filtered and sorted based on accuracy and content type:

**Accuracy Scores**:

- External API recommendations: Variable (0.0 to 1.0) based on semantic matching
- Bundled interactives: 0.8 (high confidence)
- Static links: 0.7 (good confidence)
- Confidence threshold: 0.5 (recommendations below this are filtered out)

**Content Type Priority** (lower number = higher priority):

1. Interactive guides (0) - Hands-on, step-by-step tutorials
2. Learning paths (1) - Multi-step educational paths (type value: `'learning-journey'`)
3. Docs pages (2) - Static documentation

**Sorting Algorithm**:

1. Primary sort: Content type priority (interactive first)
2. Secondary sort: Accuracy score descending
3. Featured recommendations: Server-curated, not filtered by confidence, preserve server order

**Filtering Rules**:

- Remove generic learning path index pages (both `/docs/learning-journeys` and `/docs/learning-paths` URL variants)
- Drop recommendations with accuracy ≤ 0.5
- Featured recommendations skip confidence filtering (trusted server curation)

## Configuration

Configuration is managed through plugin settings (`DocsPluginConfig`):

**Recommendation Service**:

- `recommenderServiceUrl` - External API endpoint (default: `https://recommender.grafana.com`)
- `acceptedTermsAndConditions` - Enable/disable external recommendations (default: enabled for Cloud, disabled for OSS)
- Security validation requires HTTPS and domain allowlist matching

**Network Timeouts**:

- `DEFAULT_RECOMMENDER_TIMEOUT` - 5 seconds for API requests (prevents hanging in air-gapped environments)
- Automatic fallback to bundled content on timeout or network errors

**Platform Detection**:

- Automatically detects Cloud vs OSS from Grafana build info
- Cloud users: real user identifiers hashed for privacy
- OSS users: generic identifiers (`oss-user`) to preserve privacy

## Key Files and Locations

**Core Implementation**:

- `src/context-engine/context.service.ts` - Main service class with all context logic
- `src/context-engine/context.hook.ts` - React hook for UI integration
- `src/context-engine/context.init.ts` - Plugin lifecycle initialization
- `src/context-engine/context-security.test.ts` - Security test suite
- `src/context-engine/context.service.completion.test.ts` - Completion storage selection tests
- `src/types/context.types.ts` - TypeScript type definitions

**Bundled Content**:

- `src/bundled-interactives/index.json` - Interactive guides index
- `src/bundled-interactives/static-links/*.json` - Static documentation links
- `src/bundled-interactives/*.json` - Interactive guide content files

**Related Systems**:

- `src/utils/timeout-manager.ts` - Centralized debouncing and timeout management
- `src/docs-retrieval/content-fetcher.ts` - Content fetching for learning paths
- `src/components/docs-panel/context-panel.tsx` - Primary UI consumer
- `src/constants.ts` - Configuration constants and security allowlists

## See Also

- `docs/developer/components/docs-panel/` - Context panel component documentation
- `docs/architecture.dot` - Overall system architecture
- `docs/developer/utils/README.md` - TimeoutManager and utility documentation
- `docs/developer/ASSISTANT_INTEGRATION.md` - Assistant integration using context data
