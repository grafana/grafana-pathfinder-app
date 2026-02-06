# Constants Directory

Centralized configuration and constant values used throughout the plugin. This directory contains type-safe constants that eliminate magic numbers, ensure consistency across components, and provide a single source of truth for configuration values.

## Overview

The constants directory is organized into specialized files that separate concerns:

- **UI/DOM constants** for selectors and display configuration
- **Interactive guide constants** for timing, behaviors, and action types
- **Editor constants** for the WYSIWYG guide authoring experience
- **Z-index constants** for overlay stacking management

## Files in `/src/constants/`

### `selectors.ts` - DOM Selectors & UI Configuration

**Purpose**: Type-safe CSS selectors and UI element configuration for DOM manipulation and content processing.

**Key Responsibilities**:
- Provide consistent selector strings for identifying interactive elements, code blocks, and UI components
- Define CSS class names for lightbox modals and tab configuration
- Configure copy button behavior and timing
- Maintain URL pattern constants

**Key Exports**:
- `CODE_BLOCK_SELECTORS` - Selectors for code blocks requiring copy buttons
- `INTERACTIVE_SELECTORS` - Selectors for journey links, collapsible sections, and expandable tables
- `COPY_BUTTON_SELECTORS` - Selectors for identifying and styling copy buttons
- `IMAGE_LIGHTBOX` - CSS class names for image lightbox modals
- `TAB_CONFIG` - Tab dimensions and ID configuration for docs panel
- `CODE_COPY_CONFIG` - Button sizing and reset timing for copy operations
- `INTERACTIVE_EVENT_TYPES` - Custom event types for interactive elements
- `URL_PATTERNS` - Base URL patterns for Grafana documentation

**Used By**:
- `src/utils/link-handler.hook.ts` - Interactive link handling and lightbox creation
- `src/components/docs-panel/` - Tab management and UI rendering
- `src/styles/*.styles.ts` - Styling functions and theme application

**Why It Exists**: Prevents selector string typos, centralizes UI configuration, and ensures consistent behavior across all components that manipulate the DOM or style UI elements.

---

### `interactive-config.ts` ⭐ - Interactive Guide Timing & Behavior

**Purpose**: Comprehensive configuration for interactive learning guide behaviors, timing, and action types. This is the primary configuration source for the interactive engine.

**Key Responsibilities**:
- Define all timing constants for animations, delays, navigation, and form filling
- Configure requirements checking, heartbeat monitoring, and retry logic
- Provide action type definitions and metadata for interactive steps
- Manage cleanup, settling detection, and position tracking behaviors
- Export helper functions for configuration with plugin overrides

**Key Exports**:
- `INTERACTIVE_CONFIG_DEFAULTS` - Master configuration object containing:
  - `delays` - Timing for perceptual UX, technical operations, sections, multi-step sequences, navigation, form filling, requirements checking, and debouncing
  - `requirements` - Heartbeat monitoring for fragile prerequisites
  - `cleanup` - Smart auto-cleanup for highlights based on viewport
  - `settling` - Event-driven detection for animations and transitions
  - `autoDetection` - Step completion auto-detection configuration
  - `positionTracking` - Drift detection and position correction
  - `highlighting` - Timing alignment with CSS animations for dot indicators and bounding boxes
  - `guided` - Hover dwell timing and retry intervals
  - `modal` - Polling intervals for modal detection
- `getInteractiveConfig()` - Apply plugin overrides to defaults
- `INTERACTIVE_CONFIG` - Backward compatible export
- `DATA_ATTRIBUTES` - HTML data attribute keys for interactive elements
- `ACTION_TYPES` - All supported interactive action types (button, highlight, formfill, navigate, hover, multistep, guided, quiz, sequence, noop)
- `ACTION_ICONS` - Emoji indicators for action types (deprecated, use ACTION_BADGES)
- `ACTION_BADGES` - Text labels for WYSIWYG editor display
- `CLEAR_COMMAND` - Form fill clear command constant
- `COMMON_REQUIREMENTS` - Available requirement types for interactive elements
- `STEP_PATTERNS` - ID patterns for identifying first steps and dependencies
- `isFirstStep()` - Helper to check if a step ID represents a first step
- `getActionIcon()` - Get emoji for action type (deprecated)
- `getActionBadge()` - Get text label for action type

**Data Collected**: No data collection. This is pure configuration.

**Used By**:
- `src/interactive-engine/` - All interactive action handlers, sequence manager, navigation manager, state manager
- `src/requirements-manager/` - Step checker, requirements checker, check phases
- `src/styles/interactive.styles.ts` - CSS animation timing synchronization
- `src/docs-retrieval/components/interactive/` - All interactive component implementations
- `src/components/block-editor/forms/` - Block editor forms for guide authoring
- `src/interactive-engine/auto-completion/` - Auto-detection feature
- E2E test runner for guide execution and validation

**Critical Dependencies**:
- **CSS Animations**: The `highlighting` timing constants must stay synchronized with CSS animation durations in `src/styles/interactive.styles.ts`. Changes to one require changes to the other.
- **Plugin Configuration**: Values can be overridden via `DocsPluginConfig` interface in `src/constants.ts`
- **Action Handlers**: All action handlers depend on delay configurations from this file
- **Requirements Manager**: Timeout and retry logic directly uses these constants

**Why It Exists**: Interactive guides require precise timing coordination across multiple systems (DOM operations, animations, user interactions, requirements checking). This file eliminates magic numbers, provides clear timing semantics (perceptual vs technical delays), and ensures all components use consistent timing values. It serves as the authoritative source for all interactive behavior configuration.

---

### `editor-config.ts` - WYSIWYG Editor Configuration

**Purpose**: Configuration constants specific to the WYSIWYG interactive guide editor (not used in runtime guide execution).

**Key Responsibilities**:
- Define CSS class names and Tiptap node types for editor elements
- Configure toolbar button labels, tooltips, and keyboard shortcuts
- Provide default editor content and placeholder text
- Set editor formatting preferences and timing constants

**Key Exports**:
- `CSS_CLASSES` - CSS classes for interactive elements in editor
- `NODE_TYPES` - Tiptap node and mark type names
- `HTML_TAGS` - HTML element tag names
- `EDITOR_UI_LABELS` - Toolbar button labels, heading levels, format options, list types, tooltips
- `EDITOR_DEFAULTS` - Initial content templates, placeholder text, default section IDs, download filename
- `EDITOR_CONFIG` - Print width, tab width, whitespace sensitivity
- `EDITOR_TIMING` - Auto-save debounce, saving indicator duration, download cleanup delay

**Data Collected**: No data collection. This is pure configuration.

**Used By**:
- `src/components/block-editor/` - Block editor forms, hooks, and UI components
- WYSIWYG editor implementation (Tiptap-based)
- Guide authoring tools and development utilities

**Critical Dependencies**:
- **Tiptap Editor**: Node types and mark names must match Tiptap configuration
- **Interactive Config**: Works alongside `interactive-config.ts` but is editor-specific (not used in runtime)

**Why It Exists**: Separates editor-specific configuration from runtime guide configuration. The editor has different needs (authoring UI, content templates, formatting) than the runtime guide execution engine. This separation keeps concerns isolated and prevents editor-only constants from being bundled in runtime code.

---

### `interactive-z-index.ts` - Overlay Stacking Order

**Purpose**: Centralized z-index constants for interactive overlays, highlights, and comment boxes.

**Key Responsibilities**:
- Define z-index values for all interactive overlay elements
- Ensure correct stacking order for highlights, comments, and blocking overlays
- Handle Grafana plugin context where values must exceed Grafana's own z-index ranges

**Key Exports**:
- `INTERACTIVE_Z_INDEX` - Object containing:
  - `BLOCKING_OVERLAY` - 9999 (blocks interaction with specific elements)
  - `HIGHLIGHT_OUTLINE` - 9999 (visual highlight around target elements)
  - `COMMENT_BOX` - 10002 (explanation tooltips for interactive steps)
  - `DOM_PATH_TOOLTIP` - 9999 (element inspector tooltip)

**Data Collected**: No data collection. This is pure configuration.

**Used By**:
- `src/styles/interactive.styles.ts` - Apply z-index to interactive overlays
- `src/interactive-engine/global-interaction-blocker.ts` - Blocking overlay positioning
- `src/components/DomPathTooltip/` - Element inspector tooltip styling

**Critical Dependencies**:
- **Grafana UI**: Values must exceed Grafana's z-index ranges (modals, portals, tooltips up to ~2000)
- **Interactive Styles**: Must coordinate with other styling systems to prevent stacking context issues

**Why It Exists**: Pathfinder runs as a Grafana plugin and must render interactive overlays above all Grafana UI elements (modals, navigation, tooltips). These intentionally high z-index values (9999+) ensure guides remain visible and functional regardless of Grafana's own UI state. Centralizing these values prevents z-index conflicts and makes stacking order explicit.

---

## Parent Directory Constants

### `constants.ts` (in `/src/` directory)

**Purpose**: Plugin-wide configuration including API endpoints, security allowlists, feature defaults, and runtime configuration management.

**Key Responsibilities**:
- Define default API URLs for recommender and documentation services
- Maintain security allowlists for permitted hostnames (docs, recommender, interactive learning)
- Configure plugin-wide feature defaults (auto-detection, live sessions, dev mode, etc.)
- Provide configuration interface and helper functions for runtime settings
- Manage backward compatibility exports

**Key Exports**:
- `PLUGIN_BASE_URL` - Base path for plugin routes
- Default URLs: `DEFAULT_DOCS_BASE_URL`, `DEFAULT_RECOMMENDER_SERVICE_URL`
- Security allowlists: `ALLOWED_GRAFANA_DOCS_HOSTNAMES`, `ALLOWED_RECOMMENDER_DOMAINS`, `ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES`
- Feature defaults: `DEFAULT_ENABLE_AUTO_DETECTION`, `DEFAULT_REQUIREMENTS_CHECK_TIMEOUT`, `DEFAULT_GUIDED_STEP_TIMEOUT`, `DEFAULT_ENABLE_LIVE_SESSIONS`, `DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS`, `DEFAULT_OPEN_PANEL_ON_LAUNCH`, `DEFAULT_ENABLE_CODA_TERMINAL`
- Network timeouts: `DEFAULT_CONTENT_FETCH_TIMEOUT`, `DEFAULT_RECOMMENDER_TIMEOUT`
- Dev mode defaults: `DEFAULT_DEV_MODE`, `DEFAULT_DEV_MODE_USER_IDS`
- PeerJS defaults for live sessions: `DEFAULT_PEERJS_HOST`, `DEFAULT_PEERJS_PORT`, `DEFAULT_PEERJS_KEY`
- `DocsPluginConfig` - Configuration interface for plugin settings
- Helper functions: `getConfigWithDefaults()`, `isRecommenderEnabled()`, `getRecommenderServiceUrl()`, etc.
- `ROUTES` enum for routing
- `TERMS_VERSION` - Terms and conditions version

**Data Collected**: No data collection. This is configuration only.

**Used By**:
- `src/module.tsx` - Plugin initialization and configuration
- `src/security/url-validator.ts` - URL validation against allowlists
- `src/context-engine/context.service.ts` - API endpoint configuration
- `src/docs-retrieval/content-fetcher.ts` - Document fetching with timeout configuration
- `src/utils/dev-mode.ts` - Development mode utilities
- All components requiring API access, security validation, or feature toggle checks

**Critical Dependencies**:
- **Security**: URL validators and content fetchers depend on allowlists to prevent MITM attacks and unauthorized content loading
- **Feature Toggles**: All experimental features (live sessions, global link interception, auto-detection) read their defaults from this file
- **API Services**: Recommender and docs retrieval systems depend on these endpoint configurations
- **Plugin Config**: Values can be overridden via Grafana plugin configuration UI (stored in jsonData)

**Why It Exists**: Provides a single source of truth for all plugin-wide settings. Separates security-critical constants (allowlists), API configuration, and feature defaults from component-specific or engine-specific configuration. This is the entry point for all plugin configuration and the bridge between Grafana's plugin config storage and the application's runtime configuration needs.

---

## Design Pattern

The constants are organized in a multi-level hierarchy:

1. **Plugin-Wide Configuration** (`/src/constants.ts`) - API endpoints, security, feature defaults, global settings
2. **Interactive Engine Configuration** (`/src/constants/interactive-config.ts`) - Timing, behavior, action types, requirements
3. **UI/DOM Configuration** (`/src/constants/selectors.ts`) - Selectors, class names, UI constants
4. **Editor Configuration** (`/src/constants/editor-config.ts`) - Editor-specific settings (authoring only)
5. **Styling Configuration** (`/src/constants/interactive-z-index.ts`) - Z-index stacking order

This separation ensures:
- **Clear Boundaries**: Plugin-level vs engine-level vs UI-level vs editor-level concerns
- **Type Safety**: All constants are strongly typed with TypeScript
- **Maintainability**: Changes to one system don't ripple across unrelated systems
- **Bundle Optimization**: Editor-only constants can be tree-shaken from runtime builds
- **Security**: Security-critical constants are isolated and easy to audit

## Key Dependencies

### Critical Cross-File Dependencies

1. **CSS Timing Synchronization**: `interactive-config.ts` highlighting timings must match CSS animations in `src/styles/interactive.styles.ts`
2. **Security Validation**: `constants.ts` allowlists are consumed by `src/security/url-validator.ts` for all URL validation
3. **Action Handler Coordination**: All action handlers in `src/interactive-engine/action-handlers/` depend on `interactive-config.ts` timing constants
4. **Plugin Configuration Flow**: `constants.ts` → `interactive-config.ts` via `getInteractiveConfig()` for runtime overrides

### External Dependencies

- **Grafana Runtime**: Plugin config stored in Grafana's jsonData, accessed via `@grafana/runtime`
- **Tiptap Editor**: Editor node types in `editor-config.ts` must match Tiptap configuration
- **Browser APIs**: Z-index values must account for Grafana's modal and portal z-index ranges

## Purpose

The constants directory exists to:

1. **Eliminate Magic Numbers**: Replace hardcoded values with named constants that convey meaning
2. **Ensure Consistency**: Single source of truth prevents drift across components
3. **Enable Type Safety**: TypeScript const assertions and type exports catch errors at compile time
4. **Simplify Maintenance**: Centralized configuration makes changes predictable and traceable
5. **Support Testing**: E2E tests and component tests can reference the same timing and behavior constants
6. **Document Intent**: Well-named constants serve as inline documentation of system behavior
7. **Enable Overrides**: Plugin configuration can override defaults at runtime where appropriate
