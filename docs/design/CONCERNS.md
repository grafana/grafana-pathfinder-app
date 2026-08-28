# Review concerns

This file is the source of truth for PR review routing, impact analysis, and change risk classification. Detailed review guidance and contract history live in `docs/design/CONCERN_DETAILS.md` and are loaded through the concern extractor.

## Change classification

Classify PRs into one or more of these classes before routing:

<!-- prettier-ignore -->
| Class | Description |
| --- | --- |
| `product-runtime` | Runtime frontend or backend behavior |
| `contracts-and-schemas` | Public contracts, schemas, test contracts, payload shapes |
| `infra-build-ci` | Build scripts, CI workflows, release automation, Docker or packaging |
| `tests-only` | Tests and fixtures without runtime behavior changes |
| `docs-only` | Prose-only documentation changes |
| `mixed` | Touches multiple classes or classifier is uncertain |

Fail open when uncertain: classify as `mixed`. Do not suppress review when the change touches workflows, release, publish, Docker, schemas, storage, telemetry, permissions, tokens, auth, or stateful external effects. `reversibility-and-one-way-door` and the final cross-cutting synthesizer always run.

## Routing defaults

<!-- prettier-ignore -->
| Category | mode | min_signals | max_context_files |
| --- | --- | --- | --- |
| always-on (`AO`) | `always` | 1 | 8 |
| subsystem (`sub`) | `strong` | 2 | 8 |
| cross-cutting (`xcut`) | `weak` | 3 | 6 |

Signal counting: a matching changed file path = 1 signal; a high-value semantic hit (core symbol, API, state key, or contract name) = 1 signal; repeated low-value hits in the same hunk = 1 signal total. Never activate concerns using paths alone when semantic evidence is absent, unless the concern is always-on.

## Coverage-gap detection

Flag unmapped clusters, disclose reduced confidence, and suggest new concerns when: a directory with multiple changed files maps weakly to no concern; repeated high-value symbols appear with no concern trigger; most meaningful hunks are covered only by always-on concerns. Coverage-gap detection is a disclosure mechanism, not a gate — do not suppress reviewers to avoid the gap.

## Canonical rule sources

F1–F6 security rules are defined in `.cursor/rules/frontend-security.mdc`. Direct F5 DOM-sink syntax is mechanically cataloged in `eslint.config.mjs`. Other files (`docs/design/PR_REVIEW.md`, `.cursor/skills/secure/SKILL.md`) reference these IDs without redefining them — if the summaries diverge, `frontend-security.mdc` wins for intent and ESLint wins for enforced F5 syntax.

---

## Concern routing table

Column key — **cat**: `AO`=always-on · `sub`=subsystem · `xcut`=cross-cutting · **on**: Y/N · **mode**: always/strong/weak · **min**/**max**: min_signals/max_context_files

<!-- prettier-ignore -->
| id | cat | on | mode | min | max | trigger_paths | trigger_keywords |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `security` | AO | Y | always | 1 | 8 | `src/security/**`, `src/docs-retrieval/**`, `src/context-engine/**`, `src/interactive-engine/**`, `src/components/docs-panel/**`, `src/global-state/**`, `src/validation/**`, `src/lib/analytics.ts`, `src/lib/faro.ts`, `src/lib/hash.util.ts`, `.github/workflows/**`, `pkg/**/*.go` | `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `DOMPurify`, `sanitizeHtmlUrl`, `sanitizeDocumentationHTML`, `parseUrlSafely`, `isAllowedContentUrl`, `validateTutorialUrl`, `javascript:`, `permissions:`, `${{ secrets.`, `GITHUB_TOKEN` |
| `correctness-and-reliability` | AO | Y | always | 1 | 8 | `src/**/*.ts`, `src/**/*.tsx`, `pkg/**/*.go` | `AbortController` |
| `testing-and-verification` | AO | Y | always | 1 | 8 | all changed files | `.test.`, `contract`, `schema`, `data-test-`, `test:ci`, `lint:go`, `go build` |
| `reversibility-and-one-way-door` | AO | Y | always | 1 | 8 | `src/lib/user-storage.ts`, `src/lib/storage/**`, `src/lib/storage-keys.ts`, `src/context-engine/**`, `src/lib/analytics.ts`, `src/lib/faro.ts`, `src/utils/openfeature*.ts`, `src/docs-retrieval/**`, `src/types/**`, `src/validation/**`, `pkg/**`, `src/global-state/**`, `src/learning-paths/**`, `src/completion-records/**`, `src/lib/package-recommendations-client.ts`, `src/utils/fetchBackendGuides.ts`, `src/components/docs-panel/**` | `localStorage`, `sessionStorage`, `migrate`, `reportAppInteraction`, `reportInteraction`, `trackingKey`, `data-test-`, `completion`, `serialize`, `StorageKeys`, `wrapEnvelope`, `tabStorage`, `journeyCompletionStorage`, `interactiveCompletionStorage`, `guideResponseStorage`, `learningProgressStorage`, `milestoneCompletionStorage`, `recordGuideCompletion`, `recordJourneyCompletion`, `onCompletionRecorded`, `learning-progress-updated`, `restoreTabs` |
| `cross-cutting-architecture` | AO | Y | always | 1 | 8 | `src/**`, `pkg/**`, `docs/design/**`, `docs/developer/**`, `.github/workflows/**`, `package.json`, `src/plugin.json`, `Magefile.go` | `ContextService`, `useContextPanel`, `useInteractiveElements`, `SequentialRequirementsManager`, `OpenFeature`, `reportAppInteraction`, `AppPlugin`, `Scene`, `sidebarState`, `linkInterceptionState`, `PluginExtensionPoints`, `grafana/extension-sidebar`, `@dnd-kit`, `auto-open` |
| `context-engine` | sub | N | strong | 2 | 8 | `src/context-engine/**`, `src/components/docs-panel/context-panel.tsx`, `src/docs-retrieval/content-fetcher.ts`, `src/types/context.types.ts` | `fetchRecommendations`, `getContextData`, `acceptedTermsAndConditions`, `recommenderServiceUrl`, `hashUserData`, `accuracy`, `featured`, `useContextPanel`, `getJourneyCompletionPercentageAsync`, `journeyCompletionStorage`, `interactiveCompletionStorage` |
| `docs-retrieval-and-rendering` | sub | N | strong | 2 | 8 | `src/docs-retrieval/**`, `src/components/docs-panel/**` | `fetchContent`, `parseHTMLToComponents`, `ContentRenderer`, `useContentRenderer`, `parseJsonGuide`, `sanitizeDocumentationHTML`, `bundled-interactives`, `interactive-step`, `docs-panel-container`, `pathfinder-sidebar-mounted`, `pathfinder-auto-open-docs`, `__pathfinderPluginConfig` |
| `interactive-engine` | sub | N | strong | 2 | 8 | `src/interactive-engine/**`, `src/recovery/**`, `src/lib/dom/**`, `src/constants/interactive-config.ts`, `src/styles/interactive.styles.ts` | `useInteractiveElements`, `executeInteractiveAction`, `forceUnblock`, `startSectionBlocking`, `stopSectionBlocking`, `interactive-action-completed`, `user-action-detected`, `InteractiveStateManager`, `NavigationManager`, `ActionMonitor`, `evaluateAlignment`, `isAutoRecoverableRequirement`, `launchSource` |
| `requirements-manager` | sub | N | strong | 2 | 8 | `src/requirements-manager/**`, `src/types/requirements.types.ts`, `src/constants/interactive-config.ts`, `src/global-state/guide-identity.ts` | `useStepChecker`, `checkRequirements`, `checkPostconditions`, `useGuideRequirements`, `GuideRequirementsProvider`, `GUIDE_SCOPED_REQUIREMENT_PREFIXES`, `validateInteractiveRequirements`, `SequentialRequirementsManager`, `fixType`, `watchNextStep`, `triggerReactiveCheck`, `RequirementsProvider` |
| `guide-schema-and-contracts` | sub | N | strong | 2 | 8 | `src/cli/e2e/schemas/**`, `src/types/json-guide.types.ts`, `src/types/json-guide.schema.ts`, `src/types/package.types.ts`, `src/types/package.schema.ts`, `src/validation/**`, `src/bundled-interactives/**/*.json`, `src/components/interactive-tutorial/**`, `src/interactive-engine/e2e-attributes.ts`, `src/interactive-engine/comment-box.contract.test.ts`, `scripts/upsert-*.sh`, `scripts/lib/**`, `scripts/tests/**` | `zod`, `schema`, `satisfies`, `KNOWN_FIELDS`, `manifest`, `content.json`, `data-test-`, `STEP_STATES`, `FIX_TYPES`, `REQUIREMENTS_STATES`, `FORM_STATES`, `applyE2ECommentBoxAttributes` |
| `build-and-ci` | sub | N | strong | 1 | 8 | `.github/workflows/**`, `Dockerfile.e2e-runner`, `Dockerfile.e2e-runner.dockerignore`, `scripts/e2e-runner*`, `scripts/check.js`, `package.json`, `package-lock.json`, `Magefile.go`, `.config/Dockerfile`, `jest.config.js`, `.config/jest.config.js`, `tsconfig.json`, `tsconfig.cli.json`, `.config/tsconfig.json` | `uses:`, `run:`, `permissions:`, `workflow_dispatch`, `GITHUB_TOKEN`, `actions/cache`, `docker`, `npm ci`, `npm run check`, `npm run build`, `gh release`, `publish` |
| `cli-and-e2e-runner` | sub | N | strong | 1 | 8 | `src/cli/commands/**`, `src/cli/utils/**`, `src/cli/__tests__/**`, `src/cli/contracts/**`, `src/cli/cli-commands.ts`, `src/cli/help-json.ts`, `src/cli/commands/manifest.ts`, `tests/e2e-runner/**`, `docs/developer/E2E_TESTING.md`, `docs/developer/E2E_TESTING_CONTRACT.md` | `ExitCode`, `CONFIGURATION_ERROR`, `runManifestPreflight`, `checkTier`, `checkMinVersion`, `checkPlugins`, `loadManifestFromDir`, `defineCommand`, `CommandSpec`, `COMMAND_MANIFEST`, `--package`, `--tier`, `.choices([`, `Playwright`, `NODE_SAFE_EXTERNALS`, `scanNodeEnvReachability` |
| `ai-subsystem` | sub | N | strong | 1 | 8 | `.cursor/**`, `AGENTS.md`, `CLAUDE.md`, `.cursor/skills/**/SKILL.md`, `.cursor/**/*.mdc`, `src/cli/mcp/lib/server-instructions.ts`, `src/cli/mcp/lib/agent-routing.ts`, `src/cli/mcp/tools/**` | `agent`, `agents`, `skill`, `prompt`, `concern`, `instruction`, `orchestrator`, `alwaysApply`, `globs:` |
| `go-backend` | sub | N | strong | 1 | 8 | `pkg/**/*.go`, `go.mod`, `go.sum`, `Magefile.go` | `context.Context`, `goroutine`, `defer`, `.Close(`, `sync.`, `net/http`, `io.LimitReader`, `continue` token, `auth.AccessTokenHeader` |
| `coda-terminal` | sub | N | strong | 1 | 8 | `src/integrations/coda/**`, `src/requirements-manager/checks/coda.ts`, `src/components/interactive-tutorial/terminal-connect-step.tsx`, `src/components/interactive-tutorial/challenge-block.tsx`, `src/components/block-editor/forms/TerminalConnectBlockForm.tsx`, `src/components/AppConfig/CodaBackendStatus.tsx`, `src/components/block-editor/forms/ChallengeBlockForm.tsx`, `src/components/block-editor/forms/useCodaOptions.ts` | `TerminalContext`, `useTerminalLive`, `TerminalPanel`, `coda-api`, `createSession`, `execInSession`, `sessionChannelAddress`, `SessionEvent`, `TerminalVMOptions`, `vmTemplate`, `vmApp`, `vmScenario`, `getTerminalConnectionStatus`, `getTerminalSessionId`, `useCodaPluginAvailable`, `useCodaSessionEligibility`, `isCodaUsable`, `is-terminal-active`, `coda-exit-zero`, `terminal-storage`, `useCodaOptions`, `loadCodaCapabilities`, `isCodaProbeSupported`, `codaErrorCodeMessage`, `codaRoleForbiddenMessage` |
| `mcp-authoring-server` | sub | N | strong | 1 | 8 | `src/cli/mcp/**`, `src/cli/contracts/**` | `McpServer`, `McpTransport`, `createHttpTransport`, `createStdioTransport`, `pathfinder_authoring_start`, `pathfinder_finalize_for_app_platform`, `pathfinder_manage_block`, `pathfinder_read_repository`, `pathfinder_read_session`, `pathfinder_help`, `validateCommandArgs`, `bindCommandInterface`, `defineCommand`, `CommandSpec`, `ARTIFACT_MUTATED`, `etag`, `repositoryClient`, `concurrencyLimit`, `wallclockTimeout` |
| `package-engine` | sub | N | strong | 2 | 8 | `src/package-engine/**`, `src/bundled-interactives/repository.json` | `PackageResolver`, `PackageResolution`, `BundledPackageResolver`, `CompositePackageResolver`, `createBundledResolver`, `loadBundledContent`, `loadBundledManifest`, `RepositoryJson`, `resolvePackage` |
| `assistant-integration` | sub | N | strong | 2 | 8 | `src/integrations/assistant-integration/**` | `useAssistantGeneration`, `grafana-context`, `datasource-metadata`, `AssistantWrapper`, `useTextSelection`, `buildAssistantContext`, `assistantAvailable` |
| `workshop-collaboration` | sub | N | strong | 2 | 8 | `src/integrations/workshop/**` | `SessionManager`, `SessionCrypto`, `WorkshopSession`, `ecdsaSign`, `ecdsaVerify`, `sessionNonce`, `attendeeMap`, `actionReplay`, `PeerConnection`, `handshake` |
| `cross-tab-controller` | sub | N | strong | 1 | 8 | `src/integrations/cross-tab/**`, `src/lib/cross-tab-transport.ts`, `src/lib/pairing-manager.ts`, `src/security/cross-tab-crypto.ts`, `src/types/cross-tab.types.ts`, `src/global-state/controller-channel.tsx`, `src/utils/pathfinder-search-params.ts` | `CrossTabTransport`, `installLiveTabExecutor`, `validateCrossTabMessage`, `KIND_VALIDATORS`, `KNOWN_TARGET_ACTIONS`, `verifySignedMessage`, `createControllerPairingLaunch`, `acceptSession`, `ControllerChannelProvider`, `PairingRequestBanner`, `pathfinder-cross-tab`, `pairing-accept`, `step-command`, `check-requirements`, `fix-requirement`, `sidebar-handoff`, `enableTwoTabController` |
| `block-editor-authoring` | sub | N | strong | 2 | 8 | `src/components/block-editor/**`, `docs/developer/components/block-editor/README.md`, `docs/developer/CUSTOM_GUIDES.md` | `BlockEditor`, `useBlockEditor`, `useBlockPersistence`, `useBackendSaveFlow`, `useBackendGuides`, `useJsonModeHandlers`, `useGuideOperations`, `BLOCK_EDITOR_STORAGE_KEY`, `viewMode`, `jsonModeState`, `loadGuide`, `resetGuide`, `restoreJsonMode`, `GuideLibraryModal` |
| `data-check` | sub | N | strong | 2 | 8 | `src/lib/datasource/**`, `src/constants/datasource-types.ts`, `src/components/interactive-tutorial/datasource-check-step.tsx`, `src/components/interactive-tutorial/use-data-check.ts`, `src/components/interactive-tutorial/data-check-controls.tsx`, `src/components/interactive-tutorial/datasource-options.ts` | `runDataCheckQuery`, `DATA_CHECK_QUERY_LIMITS`, `useDataCheck`, `DatasourceCheckStep`, `getNormalizedDatasourceType`, `filterDatasourcesByType`, `/api/ds/query`, `dataCheckQuery`, `dataCheckBlocking` |
| `floating-panel` | sub | N | strong | 2 | 8 | `src/components/floating-panel/**`, `src/global-state/panel-mode.ts`, `src/constants/floating-panel.ts`, `src/lib/event-names.ts` | `pathfinder-floating-`, `FloatingPanelEvents`, `dodgeSessionReducer`, `useDodgeSession`, `useHighlightDodge`, `useDragResize`, `panelModeManager`, `data-panel-state`, `MinimizedPill`, `savedScrollTop`, `restoreToken`, `FloatingPanelGeometry` |
| `completion-records` | sub | N | strong | 1 | 8 | `src/completion-records/**`, `src/lib/guide-stats/**`, `pkg/plugin/completion_records*.go`, `src/cli/commands/build-stats.ts` | `recordGuideCompletion`, `recordJourneyCompletion`, `onCompletionRecorded`, `recordGuideCompletionForSurface`, `armCompletionWriteHook`, `discardQueuedCompletionWrites`, `resolveCompletionIdentity`, `deriveCompletionUserID`, `CompletionFact`, `recordCompletionWriteDegradation`, `route-missing`, `forbidden-hold`, `idempotencyKey`, `computeGuideBlockIndex`, `guideProgress`, `summarizeGuideBlocks`, `GUIDE_STATS_VERSION` |
| `full-screen-sidebar-handoff` | sub | N | strong | 2 | 8 | `src/components/full-screen/**`, `src/global-state/panel-mode.ts`, `src/constants/interactive-actions.ts`, `src/interactive-engine/interactive.hook.ts`, `src/components/interactive-tutorial/interactive-guided.tsx`, `src/components/interactive-tutorial/code-block-step.tsx`, `src/components/content-renderer/**` | `requestSidebarHandoffAndWait`, `handleExitToSidebar`, `dockOnLeavingFullScreen`, `fullScreenFallbackLocation`, `FullScreenExitReason`, `REQUEST_SIDEBAR_HANDOFF_EVENT`, `pathfinder-sidebar-mounted`, `GRAFANA_DRIVING_ACTIONS`, `resolveSafeTargetPath`, `isGrafanaDrivingHandoffNeeded` |
| `analytics-and-telemetry` | xcut | N | weak | 2 | 6 | `src/lib/analytics.ts`, `src/lib/faro.ts`, `src/lib/telemetry/**`, `src/utils/openfeature-tracking.ts`, `src/utils/openfeature.ts`, `src/utils/experiments/highlighted-guide-orchestrator.ts`, `src/utils/sidebar-auto-open.ts`, `src/components/OpenFeatureProvider.tsx`, `src/module.tsx`, `docs/developer/FEATURE_FLAGS.md`, `docs/developer/TELEMETRY.md` | `reportAppInteraction`, `reportInteraction`, `UserInteraction`, `trackingKey`, `getExperimentsForAnalytics`, `experiments`, `beforeSend`, `Faro`, `collector`, `source_document`, `pathfinder.`, `getFeatureFlagValue`, `getHighlightedGuideConfig`, `evaluateFeatureFlag`, `PathfinderFeatureProvider`, `initializeOpenFeature` |
| `performance-and-bundle` | xcut | N | weak | 3 | 6 | `src/module.tsx`, `src/utils/timeout-manager.ts`, `src/context-engine/**`, `src/interactive-engine/**`, `src/requirements-manager/**`, `src/components/docs-panel/**`, `src/lib/faro.ts` | `TimeoutManager`, `setDebounced`, `MutationObserver`, `ResizeObserver`, `lazy(`, `Suspense`, `await import`, `getWebInstrumentations` |

---

## Concern details

Detailed reviewer guidance and contract history live in `docs/design/CONCERN_DETAILS.md`. Do not load that registry wholesale during a review. For each activated concern, run:

```bash
node .cursor/skills/review/scripts/concern-context.mjs <concern-id>
```

The extractor joins this routing row with the concern purpose, bounded context, review questions, one-way doors, verification, related concerns, contract anchor, named invariants, and any pre-contract candidate. `npm run test:review-contract` validates that the two registries stay aligned.

When authoring concerns, prefer editing an existing concern over adding one. Add a concern only after a missed review, recurring bug class, or important architectural blind spot. Tighten keywords or context before widening activation.
