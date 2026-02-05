# Changelog

## 1.4.11

### Fixed

- Fixed infinite loop in interactive step completion that caused steps to remain locked after previous step was completed

## 1.4.10

### Fixed

- Issue with learning journeys showing duplicate headers for index pages

## 1.4.9

### Changed

- Updated bundled guide to reflect changes in the Grafana UI

## 1.4.8

### Added

- **JSON editor mode**: New JSON editing mode in block editor with full undo/redo support and line-numbered validation errors (#521)
  - Switch between visual block editor and raw JSON editing
  - Validation errors show exact line numbers for quick debugging
  - Maintains roundtrip fidelity when switching between modes
- **Step state machine tests**: Added comprehensive unit tests for step state machine and check phases (#526)
- **PR review guidelines**: Added documentation for PR review workflow in dev tools (#522)

### Changed

- **Conditional block improvements**: Quality of life improvements for editing conditional blocks (#530)
  - New branch blocks editor for nested conditional content
  - Collapsible UI sections for better organization
  - Improved branch titles and visual hierarchy
- **Block editor snap scrolling**: Improved scroll behavior in block editor for smoother navigation
- **Docs panel refactoring**: Extracted components and utilities from docs-panel for better maintainability (#508)
- **My learning refactoring**: Extracted utilities and styles from my-learning tab for maintainability (#507)
- **Block editor refactoring**: Major code organization improvements to block editor (#504)
- **CI optimization**: Parallelized quality checks for faster E2E feedback (#505)
- **PR review workflow**: Improved PR review workflow in dev tools (#520)

### Fixed

- Fixed form validation errors in block builder
- Fixed objectives recalculation in step state machine (#501)
- Fixed parent section notification when step objectives are satisfied (#525)

### Removed

- Removed unused `showTarget` property from interactive schema (#506)

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.0.0 (#519)
- Updated GitHub artifact actions (#517)
- Updated actions/checkout to v4.3.1 (#435)
- Updated dependencies: npm v11.8.0, @openfeature/react-sdk v1, commander v14, sass v1.97.3, glob v13

## 1.4.7

### Added

- **Section analytics completion tracking**: Move DoSectionButtonClick analytics to fire after section execution completes (success or cancel), with accurate step position tracking and a canceled boolean. (Grafana Cloud)

## 1.4.6

### Added

- **Datasource input block type**: New block type for collecting datasource selections within interactive guides (#499)
- **Terminal mock UI**: Added terminal mock interface for Coda integration (dev mode only) (#498)

### Changed

- **Improved element highlighting**: Highlights meaningful parent elements for better visibility during interactive steps (#497)
- **Disabled auto-grouping**: Stopped automatic grouping in multistep and record mode to give content creators more control (#502)

### Fixed

- Fixed drag and drop issues in dev mode block editor (#500)
- Fixed screen highlighting for hidden or responsive elements that weren't visible on screen (#496)

## 1.4.5

### Added

- **Renderer requirement**: New `renderer` requirement type for conditional rendering based on presentation context (in-Grafana vs website) (#493)
- **PR review tool**: New dev tools feature to review PRs from interactive-tutorials repository, allowing quick testing of content.json files (#494)
- **Collapsible sections**: Section and conditional blocks in the block editor now support collapse/expand with smooth animations (#488)
- **Block type switching**: Users can now convert blocks between types (e.g., markdown → interactive) while preserving compatible data (#486)

### Changed

- **Recommendation sorting**: Recommendations are now sorted by content type priority (interactive > learning-journey > docs-page), then by match accuracy within each type
- **Drag and drop improvements**: Migrated block editor drag-and-drop from custom HTML5 implementation to @dnd-kit library for improved reliability and cross-section moves (#495)
- **Datasource API migration**: Switched requirements checker to use datasource UIDs instead of numeric IDs for compatibility with recent Grafana APIs (#487)

### Fixed

- Fixed scroll tracking issues

## 1.4.4

### Added

- **Enhanced block selection**: Block selection logic now includes multistep and guided blocks with improved merging consistency (#485)

### Changed

- **DOM selector logic**: Updated DOM selector logic in dev tools for improved element targeting (#482)

### Fixed

- Fixed defocus behavior in form-fill handler to prevent modal closure during multi-step actions (#484)
  - Dispatches non-bubbling Escape events to avoid closing parent modals
  - Relies on blur for dropdown closure instead

## 1.4.3

### Added

- **Video block timestamps**: Added `start` and `end` timestamp support for video blocks to play specific segments (#477)

### Fixed

- Fixed issues with "Go there" navigation action in interactive steps (#481)

## 1.4.2

### Changed

- **Simplified website export**: Removed separate copy for website button since block editor now uses the same JSON format (#478)

### Fixed

- Fixed issue with block editor record mode failing to initialize properly (#480)

### Chore

- Added GitHub issue templates for bugs and feature requests (#479)

## 1.4.1

### Added

- **Interactive content type support**: Added 'interactive' as a first-class content type alongside 'docs-page' and 'learning-journey' (#472)
  - Context panel now handles interactive recommendations with appropriate icons and button text
  - Improved type definitions and analytics tracking for interactive content
- **Interactive progress tracking**: Shows completion percentage for interactive guides in recommendation buttons (#474)
  - Added dropdown menu for feedback and settings in context panel
  - Improved state management for interactive progress with reset functionality
- **Category labels**: Added visual category labels and styles for recommendation types in the context panel (#475)

### Changed

- **Unified Markdown rendering**: Replaced custom Markdown parsers with `renderMarkdown` from `@grafana/data` using the Marked library (#473)
  - Configured Tiptap rich text editor to use Marked for consistent Markdown support
  - Simplified and standardized Markdown handling across the codebase
- **Improved recommendation UX**: Refactored recommendation button text and icons for better clarity (#475)
  - Added dropdown menu for feedback and settings in the docs panel

### Fixed

- Improved localization support for new UI elements across all supported languages (#474, #475)

## 1.4.0

### Added

- **Block editor tour**: New interactive tour for the block editor with improved guided UX (#467)
- **Inner list element support**: Added support for inner list elements in interactive steps (#461)
- **Noop shortcode export**: Noop actions now export as `{{< interactive/noop >}}` shortcode for website documentation (#464)
  - Made `reftarget` optional for noop actions in interactive, multistep, and guided blocks

### Changed

- **Centralized experiment auto-open state**: Replaced sessionStorage-based tracking with persistent Grafana user storage for auto-open states (#470)
  - Enhanced functions for marking and syncing auto-open states across sessions and devices
  - Updated sidebar state management to reflect new action types for analytics
  - Improved reset functionality to clear both session and user storage states
- **React 19 compatibility**: Fixed compatibility issues with React 19 (#468)

### Fixed

- Fixed various block editor UI/UX issues (#469)
- Added aria label to block form modal for accessibility (#469)
- Fixed bug with lazy scroll in React 19 (#468)
- Fixed block editor record mode persistence issues (#465)
- Fixed noop completion eligibility logic (#464)

## 1.3.7

### Fixed

- Fixed scroll highlight being cleared immediately after "Show me" action due to leftover scroll events (#463)
- Fixed lazy-loaded interactive steps not enabling buttons when element wasn't visible yet (#462)
- Fixed continuous requirement checking loop for lazy-render steps preventing button interaction (#462)

## 1.3.6

### Fixed

- Fixed issue with OpenFeature experiment tracking

### Chore

- Removed debug logging from analytics module

## 1.3.5

### Fixed

- Fixed sidebar not opening correctly on initial load
- Added analytics tracking for sidebar open/close events

## 1.3.4

### Added

- **Conditional block type**: New `conditional` block type for JSON guides that shows/hides content based on requirements (#450)
  - Supports conditional sections with requirement-based visibility
  - Block editor integration for creating and editing conditional blocks
- **Quiz block editor**: Full block editor support for creating quiz blocks with visual editing (#454)
- **Input block type**: New `input` block type for collecting user responses within guides (#454)
  - Stores responses in user storage for use in conditional logic
  - Integrates with requirements system for dynamic content

### Fixed

- Fixed scroll behavior and requirements checking issues discovered during testing (#459)
- Fixed requirements not rechecking properly in certain step sequences

### Chore

- Removed extraneous debug tooling and simplified selector debug panel (#458)
- Documentation updates to keep interactive system in sync (#456)

## 1.3.3

### Added

- **Import by paste**: Added ability to paste JSON directly into the block editor import modal (#453)

### Fixed

- Fixed external links in side journey and related journey sections now correctly open in a new browser tab instead of being blocked (#452)

### Chore

- Updated grafana/plugin-actions digest to b33da83 (#434)

## 1.3.1

### Fixed

- Fixed issue with OpenFeature experiment tracking (#444)

## 1.3.0

### Added

- **My Learning tab**: New gamified learning experience with structured learning paths and achievement badges (#443)
  - **Learning paths**: Curated sequences of guides that teach specific skills (e.g., "Getting started with Grafana", "Observability basics")
  - **Progress tracking**: Visual progress rings show completion percentage for each learning path
  - **Achievement badges**: Earn badges like "Grafana Fundamentals" and "Observability Pioneer" upon completing learning paths
  - **Streak tracking**: Daily learning streaks to encourage consistent engagement
  - **Badge unlocked toasts**: Celebratory notifications when you earn a new badge
  - **Badges display**: View all earned badges and progress toward locked ones
  - **Legacy support**: Existing guide completions are migrated to the new learning paths system
- **Experiment tools**: Added experiment management tools to dev tools panel (#442)
- **Formfill validation toggle**: Added `validateInput` option for formfill actions in guided blocks
  - When `validateInput: false` (default): Any non-empty input completes the step - ensures backward compatibility
  - When `validateInput: true`: Requires input to match `targetvalue` (supports regex patterns)
  - Block editor updated with checkbox to enable/disable strict validation

### Changed

- **Improved tab bar UX**: Enhanced tab navigation with better visual design and interaction patterns

### Fixed

- Fixed security issue with unsanitized HTML in guided handler comment display (defense-in-depth)

## 1.2.2

### Changed

- **Improved OpenFeature implementation**: Enhanced feature flag integration for better experiment control (#441)

## 1.2.1

### Added

- **Navigate action type**: Handle `navigate` action type in InteractiveStep for URL navigation within guides (#429)
- **Zod schema validation**: Runtime strict validation of interactive JSON guides with comprehensive schema checking (#417)
  - Validates all guide loads on the frontend
  - Added DOMPurify to markdown sanitization for security
  - Defined schema version 1.0.0 for bundled guides
  - CLI tool for validating guides
- **OpenFeature experiment**: Added OpenFeature experiment integration with RudderStack (#421)
- **Auto-detection**: Enabled auto-detection feature for interactive guides

### Changed

- **License update**: Updated license to AGPL-3.0 (#418)
- **Improved follow mode**: Enhanced follow mode functionality for live sessions (#425)
- **Interactive development experience**: Multiple improvements for content creators (#424)
  - Updated shortcode names with namespacing
  - Display steps as ordered list
  - Option to export combined steps as guided action instead of multistep
  - Persist recording mode state with option to return to start

### Fixed

- Fixed dashboard text styling to follow sentence case per Grafana Writers' Toolkit (#423)
- Fixed RudderStack type issues (#432)
- Fixed RudderStack and auto-detection initialization

### Chore

- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v4.3.0 (#415)
- Updated grafana/plugin-actions digest to 428421c (#400)
- Bump glob from 10.4.5 to 10.5.0 (#431)
- Automated loading of BigQuery tables for analytics (#419)
- Updated release workflow (#427)

## 1.1.85

### Added

- **Hugo shortcodes export**: Added option to export Hugo shortcodes from debug tools (#326)

### Changed

- **Block editor replaces WYSIWYG**: Replaced WYSIWYG editor with new block editor for improved content creation experience (#414)
- Improved UX of URL tester in dev tools (#392)

### Fixed

- Fixed infinite loop that blocked renders (#413)

### Chore

- Updated actions/checkout action to v6 (#407)
- Updated actions/setup-node digest to 395ad32 (#395)
- Updated dependency sass to v1.94.2 (#375)
- Updated dependency prettier to v3.7.4 (#377)
- Updated npm to v11.6.4 (#376)

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
