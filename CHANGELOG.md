# Changelog

## 1.1.84

### Added

- **Assistant wrapper blocks**: New `assistant` block type for JSON guides that wraps child blocks with AI-powered customization
  - Each child block gets its own "Customize" button that adapts content to the user's actual datasources
  - Supports wrapping `markdown`, `interactive`, `multistep`, and `guided` blocks
  - Customizations are persisted in localStorage per block
- **Unified datasource metadata tool**: New `fetch_datasource_metadata` tool for Grafana Assistant integration
  - Auto-detects datasource type (Prometheus, Loki, Tempo, Pyroscope)
  - Fetches labels, metrics, services, tags, and profile types from user's datasources
  - Enables AI to generate queries using actual data from user's environment
- **Grafana context tool**: New `get_grafana_context` tool providing environment information to the assistant

### Changed

- Updated datasource picker selectors in bundled tutorials for improved reliability
  - Uses `data-testid="data-source-card"` with `:has()` selector for robust element targeting
- Upgraded `@grafana/assistant` SDK to v0.1.7

## 1.1.83

> ⚠️ **BREAKING CHANGE: New content delivery infrastructure**
>
> Interactive guides are now served from a dedicated CDN (`interactive-learning.grafana.net`)
> instead of GitHub raw URLs. **You must update to this version or later to load interactive guides.**
>
> **What changed:**
>
> - Content is now delivered from `interactive-learning.grafana.net` (production) and `interactive-learning.grafana-dev.net` (development)
> - GitHub raw URLs (`raw.githubusercontent.com`) are only supported in dev mode for testing
> - The backend proxy route for GitHub content has been removed
>
> **For content creators:**
>
> - No changes required to your content - the CDN serves the same JSON format
> - Dev mode still supports GitHub raw URLs for testing before publishing

### Changed

- **BREAKING**: Migrated content delivery from GitHub raw URLs to dedicated interactive learning CDN
- Removed backend proxy route for GitHub content (no longer needed with direct CDN access)
- Updated security validation to use new `interactive-learning.grafana.net` domains
- Simplified URL tester in dev mode to accept all supported URL types in single input

### Added

- Added `interactive-learning.grafana-ops.net` to allowed domains

### Removed

- Removed `data-proxy.ts` and GitHub proxy configuration from `plugin.json`
- Removed `validateGitHubUrl` and related GitHub-specific URL validation functions

## 1.1.78 (2025-12-01)

### Changed

- Added improvements to interaction engine

### Fixed

- Fixed EnableRecommenderBanner not showing when recommendations are disabled (variable name bug)

## 1.1.77 (2025-12-01)

### Fixed

- Fixed regression in WYSIWYG editor caused by recent updates
- Improved requirements system

### Chore

- Updated actions/setup-go digest to 4dc6199
- Updated actions/checkout action to v5.0.1

## 1.1.76 (2025-12-01)

### Fixed

- Fixed issues with RudderStack analytics

## 1.1.75 (2025-12-01)

### Fixed

- fixed issue with bundled getting started guide step

## 1.1.74 (2025-12-01)

> ⚠️ **BREAKING CHANGE FOR CONTENT CREATORS**
>
> The content format for interactive guides has migrated from HTML/TypeScript to **JSON**.
> Existing HTML-based guides will continue to work but are deprecated.
> All new content should use the JSON format. See the migration guide at
> `docs/developer/interactive-examples/html-to-json-migration.md` and the format documentation
> at `docs/developer/interactive-examples/json-guide-format.md`.

### Added

- Added JSON-based interactive guide format with full migration of bundled interactives
- Added quiz block for interactive knowledge checks
- Added JSON export support in dev mode
- Added fullscreen mode for WYSIWYG editor
- Added bubble toolbar for WYSIWYG editor
- Added `verify` property for interactive step validation
- Added `completeEarly` support at interactive block level
- Added `noop` interactive action type
- Added auto-extract selector from step format in Simple Selector Tester

### Changed

- **BREAKING**: Content format migrated from HTML/TypeScript to JSON
- Moved dev tools to dedicated tab for better organization
- Updated interactive UI styling
- Improved edit experience in dev mode

### Fixed

- Fixed `showMe`/`doIt` property handling in interactive steps
- Fixed step sequencing issues
- Fixed URL generation strategy for both new `content.json` and legacy `unstyled.html`

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.1.0

## 1.1.73 (2025-11-25)

### Added

- Added assistant RudderStack analytics integration
- Added cancel button and cleanup for guided components

### Fixed

- Applied React anti-pattern validator fixes

## 1.1.72 (2025-11-25)

### Added

- Added support for bundled and GitHub links

### Changed

- Improved WYSIWYG editor based on RichiH feedback
- Refreshed documentation to align with current architecture

### Fixed

- Fixed issues with sections not rechecking requirements
- Fixed DOM selector logic in interactive engine
- Fixed formfill selectors to descend into input elements

## 1.1.71 (2025-11-21)

### Fixed

- Hotfix for requirements in guided step
- Fixed documentation issues

## 1.1.70 (2025-11-21)

### Added

- Added new inline assistant feature
- Added ability to open learning journeys and docs on load
- Implemented featured recommendations

### Changed

- WYSIWYG cosmetic improvements

## 1.1.69 (2025-11-19)

### Changed

- Changed requirements to be event driven rather than poll-based

## 1.1.68 (2025-11-18)

### Added

- Added highlight feature to dev tools
- Added skip button for steps in guided mode

### Changed

- Renamed "Pathfinder Tutorials" to "Pathfinder Guides" throughout
- Allows buttons to also use CSS selectors

### Fixed

- Fixed issue with auto loading
- Fixed multistep validation for reftargets in WYSIWYG editor

### Removed

- Removed old interactive code
- Removed dead requirements code

### Chore

- Updated grafana/plugin-actions
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.0.0
- Updated actions/checkout
- Updated dependency glob to v11.1.0 (security)
- Added new e2e test and updated test IDs to best practices

## 1.1.67 (2025-11-17)

### Added

- Added WYSIWYG interactive HTML editor (initial implementation)

### Fixed

- Prevent opening sidebar on onboarding

## 1.1.66 (2025-11-13)

### Added

- Added Grafana e2e selectors
- Added collapse on complete feature

### Fixed

- Fixed interactive styles
- Fixed UI theme and tab appearance

## 1.1.65 (2025-11-12)

### Changed

- Centralized types to reduce duplication
- Refactored devtools

### Fixed

- Fixed regression for guided handler

### Chore

- Updated grafana/plugin-actions
- Added changelog and documentation links

## 1.1.64 (2025-11-11)

### Added

- Added offline cloud suggestions for improved user guidance when recommendations are not available
- Implemented hand raise functionality for live sessions

### Changed

- Refactored global link interception and sidebar state management
- Moved workshop and assistant into integration folder
- Moved docs rendering into separate module
- Moved DOM helpers into lib for better organization
- Updated plugin and runtime dependencies

### Fixed

- Fixed deprecated lint issues

### Chore

- Updated GitHub artifact actions
- Spring cleaning of Agents information

## 1.1.63 (2025-11-07)

### Added

- Added function for quick complete for DOM changes

### Changed

- Cleaned up interactive guides implementation
- Grouped requirements manager files for better organization
- Grouped security related files

### Removed

- Removed plans feature

## 1.1.62 (2025-11-05)

### Added

- Implemented live sessions functionality

### Fixed

- Fixed browser storage issues

## 1.1.61 (2025-11-04)

### Fixed

- Fixed rendering issues

## 1.1.60 (2025-11-04)

### Fixed

- Fixed rendering issues

## 1.1.59 (2025-11-04)

### Fixed

- Fixed rerendering issues

## 1.1.58 (2025-11-03)

### Changed

- Improved sequence manager functionality

## 1.1.57 (2025-11-03)

### Changed

- Updated dependencies and workflows

### Fixed

- Fixed plugin update issues

## 1.1.56 (2025-10-31)

### Added

- Added backend proxy for context engine
- Added "open sidebar by default" feature flag

### Fixed

- Fixed scroll behavior
- Fixed auto launch tutorial

### Changed

- Updated multiple GitHub Actions (download-artifact to v5, setup-go to v6, setup-node to v6)
- Updated Grafana plugin actions and CI/CD workflows

## 1.1.55 (2025-10-31)

Previous stable release
