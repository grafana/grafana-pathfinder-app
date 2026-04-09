# Changelog

## 2.7.2

### Added

- **Lazy-load recommendation data**: Recommendation data is now lazily loaded and milestone UI polished for improved performance and visual consistency (#749)

### Security

- Updated `go.opentelemetry.io/otel/sdk` to v1.43.0 (#747)

### Chore

- Phase 8 cleanup: removed dead code and added package pipeline regression tests (#740)

## 2.7.1

### Fixed

- **Package milestone rendering**: Fixed resolution and rendering of milestones for path-type packages (#743)

## 2.7.0

### Added

- **Package engine integration**: Full package engine pipeline with composite resolver, package-aware content fetching, milestone resolution, and integration verification tests (#697)
  - Package completion tracking and navigation links wired into the context panel (#741)
  - Package pill icon distinguishes package-backed recommendations from plain interactive guides (#742)

### Fixed

- **Recommender URL auto-selection**: Automatically select the correct recommender API URL based on the Grafana instance hostname (#737)
- **E2E "What's new" modal**: Dismiss the "What's new in Grafana" modal in E2E tests to prevent test flakiness (#738)

## 2.6.0

### Added

- **Open guide after navigate step**: Navigate steps can now open a guide in the sidebar after SPA navigation completes (#732)
  - New `openGuide` field in block editor for navigate actions (e.g., `bundled:my-guide`)
  - Backward compatible: auto-detects `doc=` param in navigation URLs and dispatches guide opening
  - Uses `auto-launch-tutorial` event pattern with dynamic `findDocPage()` import
- **Kiosk mode available without dev mode**: Kiosk mode now only requires the `enableKioskMode` toggle in plugin settings (#733)

### Fixed

- **Selector picker scoping**: Constrain element picker to the hovered element's domain (#728)
  - Added proximity check to `findNearbyFormControl` — only returns form controls within 100px of clicked element
  - Thread `hoveredElement` from inspector through recorder to selector generator with fallback validation
- **Enhanced selector nested queries**: Use `querySelectorAllEnhanced` for nested queries after `:nth-match()` and in `resolveTrailingSelector` (#730)
  - Fixes `SyntaxError` when `:text()` or `:contains()` appear after `:nth-match()` or chained after `:contains()`
  - Monotonic counter for trailing selector markers prevents collision on recursive re-entry
- **Redundant button selector generation**: Avoid duplicate text matching when parent selector already contains the same `:contains()` or `:text()` clause (#731)
- **Plugin settings data loss on Cloud deployment**: Preserve all plugin settings when saving from any config tab (#734)
  - All config forms now spread `getConfigWithDefaults(jsonData || {})` instead of raw `jsonData`
  - Dev mode toggle now fetches current settings before saving instead of wiping all other fields
  - Fixes kiosk mode and coda settings being cleared after plugin version updates
- **Clear filter pills with @@CLEAR@@**: `@@CLEAR@@` on combobox inputs now removes existing filter pills before filling new values (#727)

## 2.5.2

### Fixed

- **Guided step zombie cleanup**: Eliminate orphaned timers, event listeners, and highlights after guided step cancellation (#725)
  - Capture and clear 120s timeout promises that fired with stale closures after cancel
  - Store comment box button listeners (Close, Cancel, Skip) in cleanup handlers
  - Remove redundant NavigationManager instances in InteractiveGuided unmount
  - Track success animation timeout for proper cancellation
- **?doc= deep link improvements** (#724)
  - Derive readable tab titles from URL path instead of showing "content.json"
  - Intercept interactive-learning links inside content and open as sidebar tabs
  - Use `interactive` type for interactive-learning URLs (not `docs-page`)
  - Route interactive guides to `openDocsPage` (with reset button) instead of `openLearningJourney`
  - Always show reset button for interactive guide tabs regardless of progress state
  - Don't redirect away from current page on `?doc=` — stay on the user's dashboard
  - Strip stale doc/page/source params from URL when doc can't be parsed
  - Support `?source=learning-hub` to explicitly open as learning journey
- **Assistant text selection UX**: Change button text to "Ask Assistant", orange text highlight, no-fill purple box, 400ms debounce (#722)
- **Tooltip readability**: High-contrast text in tooltip popouts — white in dark mode, near-black in light mode

## 2.5.0

### Added

- **Selector resilience engine**: Retry-with-wait, prefix matching, domain selectors, and strategy escalation pipeline for more robust interactive tutorials (#716)
  - `resolveWithRetry()` with exponential backoff (200/600/1800ms) replaces single-pass resolution in all action handlers
  - `:text()` exact match for short button labels (< 20 chars) eliminates false positives
  - `data-testid` prefix matching fallback when exact match fails (uniqueness-guarded)
  - `panel:` domain selector prefix resolves Grafana panels by title
  - Unified `resolveSelectorPipeline()` with confidence scoring
- **Selector Health Badge**: Inline quality indicator (green/yellow/red dot, stability score, method, match count) in the block editor form
- **Test Selector Button**: Evaluates selector against live DOM and flash-highlights matched elements with numbered overlays
- **Shift+Click hover capture**: Hold Shift during recording to capture hover steps without clicking through — prevents accidental navigation
- **Alt+Click form capture**: Hold Alt during recording to force-capture any element as a form fill — element is focused for typing, step recorded on blur with typed value
- **On-demand alternative selectors**: "Show alternatives" in block editor computes alternative selectors on-the-fly with stability scores and "Use this" swap buttons
- **Auto-populate requirements**: Recorded steps auto-populate `exists-reftarget` and `navmenu-open` requirements

## 2.4.2

### Added

- **Kiosk mode**: Full-screen overlay presenting interactive guide tiles over Grafana, gated behind dev mode and configured in the Interactive Features tab (#712)
  - Fetches rules JSON from a configurable CDN URL with bundled fallback defaults
  - HTML banner block at the top of the overlay for custom branding (sanitized via DOMPurify)
  - Each tile opens the guide in a new tab via `?doc=` deep link with per-rule target URL
  - Kiosk button in the sidebar header; overlay closes only via close button or Escape key
  - Default banner themed for GrafanaCON 2026 with official stacked logo
- **Comprehensive test ID audit**: Added ~100 new centralized `data-testid` selectors across all component areas and centralized ~20 hardcoded test ID strings into `testIds` constants (#711)
  - New test ID namespaces: `editorPanel`, `learningPaths`, `liveSession`, `prTester`, `urlTester`, `codaTerminal`, `homePage`, `controlGroupPopup`, `feedbackButton`, `helpFooter`, `app`, `enableRecommender`, `kioskMode`

### Fixed

- **Sidebar dock toggle**: Prevent dock button from undocking an already-docked sidebar (#710)

## 2.4.1

### Added

- **Custom guide deep links**: Support `?doc=api:<resourceName>` deep links for custom guides stored as App Platform CRDs (#696, #701)

### Security

- **Navigate handler path validation**: Internal navigation paths are now validated against denied routes (`/logout`, `/profile/password`, `/admin/*`, `/api/*`), closing a carry-forward from ASE25039 that becomes higher-impact under default enablement in Grafana 13 (#702)
  - Role-aware validation: admin users can navigate to admin-only paths since guides legitimately steer admins there and Grafana RBAC enforces server-side access control

## 2.4.0

### Added

- **Alloy scenario VM support**: New `alloy-scenario` VM template for Coda terminal, enabling guide authors to deploy Alloy-based sandbox environments (#688)
  - Animated progress bar during VM provisioning with SSH connection status
  - Quota cleanup with polling to auto-destroy stale VMs before creating new ones
  - Persistent VM options in sessionStorage for auto-reconnect across page refresh
- **Package recommender groundwork** (dormant): Frontend infrastructure for the v1 recommender API including response types, allowlist-based sanitizer, deduplication, and composite package resolver — production endpoint unchanged (#693)

### Changed

- **Agent context centralisation**: Concern-routed PR review and centralised agent context for improved review routing and impact analysis (#699)
- **Documentation maintenance**: Updated Coda, workshop, CLI tools, and interactive requirements docs; indexed `CUSTOM_GUIDES.md` (#690, #691, #692)

### Fixed

- **Coda terminal UX**: Fixed VM replacement messages, error/disconnect retry loop, terminal panel not opening from guide connect blocks, connect button state during provisioning, and disconnect as a proper kill switch (#688)

### Chore

- Deduplicated `useSampleApps`/`useAlloyScenarios` into generic `useCodaOptions` hook (#688)

## 2.3.7

### Fixed

- **Section requirement**: Fixed issue with section requirement checking not evaluating correctly
- **Workshop PeerJS config**: Read PeerJS config from Grafana runtime instead of `PluginPropsContext`, which was always null when rendered via `plugin.addComponent()` outside the provider tree (#687)
  - Made PeerJS TLS toggle explicitly configurable

## 2.3.6

### Added

- **`pathfinder.enabled` feature flag**: Global kill-switch for cloud-wide rollout control, separate from A/B experiments. When disabled, the plugin dismounts and the native Grafana help menu takes over (#685)
- **Workshop ECDSA presenter authentication**: Challenge-response authentication using ECDSA P-256 key pairs to prevent peer ID impersonation on the PeerJS signalling layer (#680)
  - Public key embedded in join code; private key never leaves the presenter's browser
  - Removed legacy unauthenticated join path entirely
  - Follow mode gated behind feature flag pending security review
- **CLI manifest pre-flight checks**: New `--package` and `--tier` flags for the e2e command with tier check, minVersion check, and plugin checks before spawning Playwright (#681)

### Security

- Updated `google.golang.org/grpc` to v1.79.3 (#683)

### Chore

- Updated npm to v11.11.1 (#675)
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.1.1 (#676)
- Updated magefile/mage-action digest to 96c659d (#684)

## 2.3.5

### Fixed

- **Pathfinder-suggest event buffering**: Early `pathfinder-suggest` events from faster-loading apps were lost because the handler was only registered after async experiment init. Added a synchronous buffer that replays events once the real handler is ready (#679)
- **Auto-opened flag deferral**: Deferred the auto-opened localStorage flag write until the sidebar actually mounts, so the flag is never burned if the sidebar fails to open (#679)

## 2.3.4

_Patch release — version bump only._

## 2.3.3

### Added

- **VM template selection**: Guide authors can now specify a custom VM template and sample app name when provisioning sandbox VMs through the `terminal-connect` block (#672)
  - Backend: new sample-apps endpoint, `CreateVM` accepts config map, `resolveVMForUser` respects template/app when reusing or replacing VMs
  - Frontend: `TerminalConnectBlock` form with VM template selector and dynamic sample-app dropdown
  - Block palette hides Coda block types when Coda terminal is disabled

## 2.3.2

_Patch release — version bump only._

## 2.3.1

### Fixed

- **Coda VM lifecycle**: Fixed VM lifecycle issues in the Coda terminal integration (#667)

### Chore

- Updated actions/upload-artifact action to v7 (#660)
- Updated grafana/plugin-actions digest to 4698961 (#661)

## 2.3.0

### Added

- **Terminal connect block type**: New `terminal-connect` block type for interactive guides, enabling embedded terminal session setup within tutorials (#666)
  - Block editor support with terminal connect form
  - Guided handler support for terminal connect actions
  - Global interaction blocker integration for terminal steps
- **Block editor inline title editing**: Guide title is now editable inline in the header; guide ID is auto-derived from the title on first commit (slug + random suffix), locked after first set (#662)

### Changed

- **Block editor lifecycle redesign**: Replaced two-button publish flow with a single smart primary action button that follows the guide lifecycle: Save as draft → Update draft → Publish → Update. Context-sensitive menu for Publish shortcut, Unpublish, New guide, and Import (#662)
- **Terminal panel improvements**: Enhanced Coda terminal panel with improved storage and connection handling (#666)

### Fixed

- **Title rendering**: Docs pages now render only one title extracted from the content's first heading; learning path milestones with content JSON use the title from the JSON itself (#663)
- **Request timeouts**: Each content fetch request now uses its own timeout instead of sharing a single timeout across multiple requests, fixing intermittent "signal timed out" errors (#664)
- **Relative URL resolution**: Relative URLs in unstyled.html learning path content (e.g., `/sign-up/`) now resolve against `https://grafana.com` instead of the Grafana instance origin (#665)
- **Block editor race condition**: Fixed backend link lost after page refresh due to undefined sentinel value (#662)
- **Block editor stale closures**: Fixed stale closure bugs causing incorrect toast messages and breaking change detection after unpublish (#662)
- **Empty guide loading**: Fixed empty guide failing to load from library; blocked saving guides with no blocks (#662)

## 2.2.2

### Added

- **Control group popup**: Added a popup notification for users in the control group who cannot access Pathfinder

### Fixed

- **Image rendering**: Fixed image rendering in docs and markdown image parsing in the JSON parser
- **Feature flag protection**: Added safeguards around new feature flag evaluation in experiment utilities

### Changed

- **Reduced module size**: Further optimizations to plugin bundle size

## 2.2.1

### Added

- **Draft/publish lifecycle**: Introduced draft and publish workflow for library guides in the block editor, allowing content creators to iterate on guides before making them available (#657)

### Fixed

- **Guided popup themes**: Guided popup now correctly respects light/dark mode settings (#656)

### Changed

- **Reduced module size**: Optimized plugin bundle size for improved initial load performance (#659)

### Chore

- Updated grafana/plugin-actions digest to b82357e (#658)

## 2.2.0

### Added

- **Code block type**: New `code-block` block type for interactive guides with syntax highlighting, copy-to-clipboard, and step completion tracking (#650)
  - Block editor support with language selector, filename, and code content fields
  - Action handler for code block interactions in the interactive engine
- **Auto-collapse section toggle**: Added `autoCollapse` option for interactive sections, configurable in both the block editor and app config (#649)

### Fixed

- **Quiz reset**: Fixed quiz block not resetting answers properly when restarting a guide (#649)
- **Admin access**: Fixed interactive features configuration page not loading correctly for admin users (#649)

### Security

- **DOMPurify v3.3.2**: Updated DOMPurify to v3.3.2 to address CVE-2026-0540; iframes with `data:` URLs are now fully removed instead of sandboxed (#651)

## 2.1.1

### Fixed

- MCP `tools/call` responses now correctly wrap results in the `content` array as required by the MCP 2025-03-26 spec, fixing compatibility with Grafana Assistant

## 2.1.0

### Added

- **MCP server**: HTTP Model Context Protocol server at `/api/plugins/grafana-pathfinder-app/resources/mcp`, enabling AI assistants (e.g. Grafana Assistant) to discover and launch Pathfinder guides
  - `list_guides` — returns the bundled guide catalog with id, title, description, category, and type
  - `get_guide` — returns the full content JSON for a specific guide by ID
  - `get_guide_schema` — returns JSON Schema for guide content, manifest, and repository formats
  - `launch_guide` — queues a guide launch for the current user; Pathfinder opens it automatically within 5 seconds if the sidebar is active
  - `validate_guide_json` — validates a guide content.json string and returns structured errors and warnings
  - `create_guide_template` — generates a valid guide skeleton (content.json + manifest.json) ready for editing
- **Frontend polling hook** (`usePendingGuideLaunch`): polls the backend every 5 seconds and opens the Pathfinder sidebar to the requested guide when a pending launch is found
- **`openWithGuide` method** on `GlobalSidebarState`: opens the sidebar and dispatches the guide, handling the case where the sidebar is not yet mounted

## 2.0.7

### Changed

- **Experiment refactor**: Extracted experiment logic into dedicated `experiments/` module with separate orchestrator, utilities, and debug tooling; simplified `module.tsx` by removing inline experiment wiring
- **OpenFeature integration**: Added OpenFeature client wrapper for standardized feature flag evaluation
- **Analytics**: Added RudderStack event support and new suggestion state tracking via `global-state/suggestion.ts`

## 2.0.6

### Fixed

- **Terminal streaming**: Fixed terminal streaming issue in the Coda terminal live hook
- **Publish**: Fixed publish issue with terminal live hook import

## 2.0.5

### Fixed

- **Terminal streaming**: Simplified streaming implementation across backend (`stream.go`, `resources.go`) and frontend (`useTerminalLive` hook), removing redundant code paths

## 2.0.4

### Fixed

- **Session key simplification**: Removed `userLogin` from `sessionsByVM` key, using `vmID` alone. Eliminates identity-mismatch bugs across SDK paths and the reconnect race condition where an old RunStream's teardown could delete a newer session's registration
- **Reconnect race condition**: Fixed race where overlapping RunStream teardown for the same VM could delete the active session from the secondary index, causing 410 errors in Grafana Cloud

## 2.0.3

### Security

- **Terminal input auth**: Removed client-controlled user identity from terminal input; user is now derived exclusively from the SDK's `PluginContext` to prevent session impersonation

### Fixed

- **Session lookup**: Fixed 410 (Gone) errors on every terminal input/resize caused by user identity mismatch between `RunStream` (SDK PluginContext) and `handleTerminalInput` (missing HTTP header)
- **Instance lifecycle**: Moved `streamSessions` and `userVMs` from package-level globals into `App` struct fields so they are properly scoped to plugin instance lifecycle and cleaned on `Dispose()`
- **SSH retry logic**: Auth errors (wrong key, permission denied) no longer waste same-VM retry budget; they break immediately to provision a new VM
- **Context-aware retries**: Replaced `time.Sleep` in SSH retry loops with `select`/`time.After` so context cancellation is respected immediately
- **WebSocket write deadline**: Added 30s write deadline on WebSocket writes to prevent indefinite blocking when the relay stops reading
- **Reconnect timer leak**: Stored reconnect `setTimeout` ID in a ref and clear it on unmount to prevent post-unmount state updates
- **PEM validation**: `normalizePrivateKey` now validates the result with `pem.Decode` and returns an error for malformed keys instead of passing them silently to `ssh.ParsePrivateKey`
- **First poll delay**: `waitForVMActive` now polls immediately before entering the 3-second ticker loop, avoiding unnecessary delay for already-active VMs

### Improved

- **Session lookup performance**: Added secondary `sessionsByVM` index for O(1) terminal input routing instead of O(n) scan under mutex
- **Output throughput**: Added output coalescing goroutine that batches SSH output within a 5ms window (up to 32KB) before sending, reducing per-message gRPC overhead
- **Buffer sizes**: Increased SSH read buffers from 4KB to 32KB and PTY baud rates from 14400 to 38400
- **Console log gating**: Terminal connection logs gated behind dev mode per Grafana best practices; `connectionLog` converted to a per-connection factory to eliminate shared mutable state
- **Error logging**: `sendStreamError` and `sendStreamStatusWithVmId` now log marshal and send errors instead of silently discarding them
- **PublishStream comment**: Corrected misleading comment to clarify it is implemented for SDK compliance but never invoked

## 2.0.2

### Fixed

- **Terminal connection**: Fixed an issue with connection timeout

## 2.0.1

### Fixed

- **Terminal reconnection**: Fixed issues with reconnection and timeouts to VMs (#639)

## 2.0.0

### Added

- **Custom guides** (private preview, Grafana Cloud only): Users can create, publish, and manage their own guides with full backend support (#614)
  - New "Custom guides" section in the context panel shows user-published guides
  - Guide library modal for browsing and loading saved guides
  - Publish workflow for sharing guides within an organization
  - Backend API for guide storage and retrieval
- **Go backend**: Added plugin backend using `grafana-plugin-sdk-go` for streaming, resource handling, and API endpoints (#591)
- **Terminal block type** (experimental): New block type for embedding terminal sessions within guides, requires backend configuration (#591)
- **Guide health telemetry design**: Added design document for guide health monitoring and telemetry (#628)
- **Package model Phase 0-1**: Initial implementation of the guide packaging model (#623)
- **Maintain-docs skill**: New AI skill for periodic documentation audits and maintenance (#602)

### Changed

- **Architectural tier model**: Major refactoring to enforce clear architectural boundaries (#607, #608, #609, #613)
  - Added directory-scoped ESLint import boundary rules encoding the tier model
  - Added architectural invariant ratchet tests to prevent regressions
  - Eliminated all barrel bypass violations
  - Moved components to correct architectural tiers
- **Stricter TypeScript**: Enabled `noUncheckedIndexedAccess` for stricter null safety on indexed access (#606)
- **ESLint security rules**: Added `no-restricted-syntax` ESLint rules for security and architecture enforcement (#611)
- **Block editor UX improvements**: Fixed keyboard navigation, modal footer alignment, and responsive header behavior (#617)
- **Block editor availability detection**: Library and Publish controls now hide when backend API is unavailable (#631)
- **Documentation refresh**: Comprehensive documentation updates across all engine subsystems, indexed orphaned docs, and validated stale documentation (#592-#602, #625)

### Fixed

- Fixed deprecated API usage issues

### Chore

- Updated npm to v11.10.1 (#605)
- Security audit (#590)

## 1.8.0

### Added

- **Home page**: New dedicated home page (`/a/grafana-pathfinder-app`) serving as a centralized learning hub with learning paths, badges, and progress tracking. Accessible via a "My learning" button in the sidebar, with automatic redirect when the recommender is empty (#579)
- **User profile bar**: Replaced the "Recommended learning" header in the context panel with a compact profile bar showing badge progress, guide count, streak info, and a CTA to open the next recommended guide (#585)
- **12 new path-completion badges**: New badges with whimsical names and emoji icons, earned badges appear first in the grid sorted by most recent, with legacy badge indicators for badges earned in previous versions (#579)
- **Deep link page redirect**: Added `page` query parameter to deep links so that after the sidebar launches a guide, the center console navigates to a relevant Grafana page (e.g., `?doc=bundled:first-dashboard&page=/explore`) (#574)

### Changed

- **Renamed "learning journey" to "learning path"**: Updated all UI references from "learning journey" to "learning path" for consistency (#586)
- **Template variable passthrough**: Grafana template variables (`${variable}`) are now preserved and rendered in markdown content instead of being stripped by sanitization (#573)
- **Content fetching improvements**: Now renders `content.json` first if available for all docs, with `null` value handling to avoid fetch errors (#569, #571)

### Fixed

- **Learning path progress**: Fixed completion percentage display and added "Restart" button for completed learning paths with confirmation UI. Improved handling for URL-based paths and milestone auto-completion (#587)
- **Reset progress**: The "Reset progress" button now clears per-guide interactive step completion data, preventing guides from instantly re-completing when reopened (#585)
- **User storage performance**: Introduced envelope-based storage format replacing separate timestamp companion keys, with automatic migration of old-format data. Improves reliability and performance of cross-device syncing (#570)

### Chore

- Updated npm to v11.10.0 (#577)

## 1.7.1

### Fixed

- **Context panel progress stuck at 0%**: Fixed completion percentage display for learning journeys and interactive guides on the context/recommendations panel. Learning journeys now correctly read from `journeyCompletionStorage` (async), and interactive guides now correctly read from `interactiveCompletionStorage` instead of the wrong storage type.

## 1.7.0

### Breaking changes

- **Learning journeys**: The plugin must be updated to this version for all learning journeys to render correctly again due to the migration from unstyled HTML to JSON.

## 1.6.0

### Added

- **Interactive learning journeys**: Learning journeys now support interactive content, allowing guided, hands-on steps within structured learning paths. Expect more learning journeys to become interactive over time.

## 1.5.2

### Fixed

- **Empty `response.url` in content fetcher**: Fixed "Redirect target is not in trusted domain list" errors on Grafana Cloud environments where platform-level fetch interception produces synthetic responses with empty `response.url`; now falls back to the validated original URL (#564)
- **GitHub CDN redirect allowlist**: Expanded `isGitHubRawUrl()` to accept `objects.githubusercontent.com` URLs that GitHub redirects to for blob storage, fixing PR Tester failures in dev mode (#562)

### Changed

- **PR Tester file limit**: Increased maximum content files from 5 to 100 to match GitHub API's default page size, preventing silent truncation of large PRs (#565)
- **PR Tester pagination warning**: Added user-facing warning when a PR may contain more content files than the API returns in a single page (#567)

## 1.5.1

### Fixed

- **Dev-mode selector generation**: Fixed `findNearbyFormControl()` incorrectly selecting unrelated form controls when clicking elements inside buttons or links; added structural scoping for `data-testid` selectors to improve stability (#557)

### Changed

- **Developer documentation refresh**: Updated developer docs to align with current implementation, including feature flag documentation, interactive types, requirements reference, and selector guidance; removed obsolete HTML-era docs (#560)

## 1.5.0

### Removed

- **Legacy interactive HTML parsing**: Removed ~800 lines of HTML-based interactive parsing from `html-parser.ts` (#550). Interactive guides are now exclusively produced via the JSON parser path. General HTML parsing (headings, code blocks, images, tables, etc.) remains intact. Golden-path regression tests added.

### Changed

- **Docs panel modularization**: Phased refactor extracting hooks and utilities from `docs-panel.tsx` for better maintainability (#545)
  - Extracted `useTabOverflow`, `useScrollPositionPreservation`, and `useContentReset` hooks
  - Extracted `url-validation`, `tab-storage-restore` utilities and `DocsPanelModelOperations` interface
  - Added 28+ new unit tests across extracted modules
- **Design documentation**: Flattened package metadata, added AND/OR dependency syntax, deferred fields, and renamed `package.json` → `manifest.json` in design docs (#556)
- **Agent context optimization**: Reduced always-injected agent context by ~460 lines (#555)
- **Tiered PR review rules**: Reorganized PR review into compact orchestrator with unified detection table (#554)
- **Design docs refresh**: Updated reference URLs and removed outdated content (#553)

### Fixed

- **Single steps vs section steps**: Fixed issues with single interactive steps not behaving correctly relative to section steps, including user storage fixes (#549)

### Chore

- Updated npm to v11.9.0 (security) (#548)

## 1.4.13

### Added

- **E2E testing contract**: Added `data-test-*` attributes for step state, action type, and substep progress to enable stable E2E testing of interactive and guided blocks (#540)
- **E2E CLI guided block support**: Expanded E2E CLI runner with guided block discovery tests, timeout calculations, and `data-reftarget` attributes (#544)
- **E2E guide test runner documentation**: Added developer documentation for the CLI-based E2E test runner (#533)
- **Default requirements suggester**: Block editor now auto-suggests default requirements when creating interactive steps (#537)

### Fixed

- **Datasource type matching**: `has-datasource` checks now match plugin types with `grafana-` prefix and `-datasource` suffix (e.g., `has-datasource:testdata` matches `grafana-testdata-datasource`), fixing section auto-completion in the cloud first-dashboard tutorial
- **Collapsed options group expansion**: Interactive steps targeting elements inside collapsed Grafana panel editor options groups now detect the collapsed state and offer a "Fix this" action to expand them

### Changed

- **Improved validation error messages**: Better error messages for nested union fields in guide validation with custom error map (#542)
- **StorageKeys refactor**: Extracted storage keys into a standalone module to remove browser dependency, improving testability (#538)
- **Comprehensive documentation refresh**: Major rewrite of developer documentation with strategic context, integration maps, security context, and developer workflows (#543)
- **Lint deprecation cleanup**: Resolved lint warnings by updating deprecated APIs across 30 files (#547)

### Chore

- Updated dependency webpack to v5.104.1 (security) (#541)
- Updated dependency sass-loader to v16.0.7 (#546)
- Updated grafana/plugin-ci-workflows/ci-cd-workflows action to v6.1.0 (#539)
- Updated grafana/plugin-actions digest to 09d9424 (#536)
- Updated packages and added jest-dom type declarations
- Updated agent configuration to use `test:ci` script (#535)

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
