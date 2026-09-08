# Documentation maintenance backlog

Persistent tracker for the maintain-docs skill's persistent state across runs.

## Work items

<!-- Structural issues requiring dedicated effort. Format: date, description, rationale. Remove when resolved. -->

- 2026-05-21: No CONCERNS.md concern covers `src/snippet-engine/`. Consider adding one or extending `package-engine` / `docs-retrieval-and-rendering` to include the new tier-1 engine. Rationale: prevent-doc-drift cannot edit `docs/design/CONCERNS.md`; surfacing here for a human review pass. Blocked: the maintain-docs hard constraint also excludes `docs/design/`, so this requires a human design review.

## Validated docs

<!-- Docs checked against source and found accurate. Format: date, doc path. Update date on re-validation. -->

- **2026-08-26**: `docs/developer/interactive-examples/authoring-interactive-journeys.md` — Corrected the authoring entry points, public-repository scope, action versus block types, and optional-manifest package model. Validated against the current JSON guide schemas and types, package/custom-guide/API references, block-editor workflow, and external contributor README.
- **2026-08-12**: `docs/developer/RELEASE_PROCESS.md` — Corrected dev deployment, CLI publish triggers, runtime dependencies, MCP smoke testing, Node base-image guidance, and plugin-tarball isolation. Validated against current release/publish workflows, `Dockerfile.cli`, `scripts/cli-build-utils.js`, and package scripts.
- **2026-08-19**: `docs/developer/learning-paths/README.md` — Revalidated after the private-path split and Discover more launch changes. Documented private-path routing, schema-validated manifest propagation, and the lazy package-resolver registry lifecycle. Supersedes the 2026-08-12 entry.
- **2026-08-19**: `.cursor/rules/systemPatterns.mdc` — Corrected the composite resolver chain and documented lazy package-resolver registration plus the published-only App Platform bare-ID gate. Validated against the current package engine, resolver registry, and plugin initialization. Supersedes the 2026-06-16 entry.
- **2026-08-19**: `docs/developer/package-authoring.md` — Documented published-only bare-ID App Platform resolution while preserving direct draft preview and tab-restore behavior; added the runtime architecture cross-reference. Validated against the composite and App Platform resolvers. Supersedes the 2026-08-07 entry.
- **2026-08-07**: `docs/developer/CROSS_TAB_CONTROLLER.md` — Corrected the wire protocol for `runId`, `targetState`, pairing, sidebar handoff, sender-scoped replies, and single-live-tab command execution. Validated against current cross-tab types, controller channel, live-tab executor, and interactive step emitters.
- **2026-08-07**: `.cursor/rules/schema-coupling.mdc` — Corrected the JSON-guide coupling guarantees, Zod unknown-field behavior, validation layout, test commands, and package-schema distinctions. Validated against current guide/package schemas, types, and coupling tests.
- **2026-08-07**: `docs/developer/interactive-examples/json-guide-format.md` — Corrected video, code-block, terminal, challenge, snippet-reference, and Grot Guide contracts plus the exported type/guard list. Validated against `json-guide.schema.ts` and `json-guide.types.ts`.
- **2026-08-07**: `docs/developer/package-authoring.md` — Corrected package milestones, content block examples, and content schema-version behavior. Validated against `package.schema.ts`, `package.types.ts`, and the JSON guide schemas.
- **2026-07-29**: `docs/developer/utils/README.md` — Added current App Platform API, deep-link, slug, experiment, sidebar auto-open, and variable-substitution coverage; corrected published-guide loading state, backend filtering, timeout/interval, plugin settings, and safe-event semantics. Validated against `src/utils/` and its current consumers. Supersedes the 2026-02-25 entry.
- **2026-07-29**: `docs/developer/ASSISTANT_INTEGRATION.md` — Corrected Assistant availability, data source selection and metadata context, parser defaults, inline/block rendering, dev-mode enablement, JSON authoring links, and examples. Validated against the HTML/JSON parsers, Assistant integration, dev-mode utilities, and data source metadata tools.
- **2026-07-15**: `docs/developer/interactive-examples/selectors-reference.md` — Added version-aware `grafana:` selector guidance, stable ancestor and descendant-anchored `:has()` generation, Pathfinder-owned content exclusion, and corrected the runtime resilience pipeline stages. Validated against `grafana-selector.ts`, `selector-generator.ts`, `pathfinder-content.ts`, `action-detector.ts`, and related tests. Supersedes the 2026-04-27 entry.
- **2026-09-02**: `docs/developer/CUSTOM_GUIDES.md` — Corrected the draft-save button labels. Revalidated inline title and ID ownership after removal of the unreachable metadata modal, plus the tour, persistence, JSON mode, guide history, preview progress, header, library, manifest, and backend lifecycle flows. Supersedes the 2026-07-15 entry.
- **2026-06-16**: `docs/developer/CLI_TOOLS.md` — Added a `build-snippets` command section and updated the intro command list/coverage line. Validated against `src/cli/commands/build-snippets.ts` and the `snippets:build` npm script. Supersedes the 2026-03-20 entry.
- **2026-06-16**: `docs/developer/CODA.md` — Added a Command execution section documenting `POST /coda/exec` (raw/gated modes, active-session auth, 5s default / 120s max timeout, 32 KB output cap, per-user token-bucket rate limit, error statuses). Validated against `pkg/plugin/coda_exec.go`, `coda_exec_ratelimit.go`, and `resources.go`. Supersedes the 2026-03-20 entry.
- **2026-06-16**: `docs/developer/MCP_SERVER.md` — Confirmed current: no structural changes in `src/cli/mcp/` since the doc's last commit (2026-05-19); already documents the Go MCP retirement (MH5).
- **2026-06-16**: `docs/developer/package-authoring.md` — Confirmed current: documents the two-file authoring format, not package-engine resolver internals, so the resolver restructure (`dependency-resolver` → `composite-resolver`/`online-cdn-resolver`/`recommender-resolver`) does not affect it.
- **2026-06-16**: `.cursor/rules/systemPatterns.mdc` — Confirmed current: package-engine entry references `composite-resolver.ts`/`createCompositeResolver` and the bundled → online-CDN → recommender chain; `snippet-engine` is listed in the tier model and subsystem reference. Supersedes the 2026-03-20 entry.
- **2026-06-16**: Structural scan, no drift since each doc's last commit: `docs/developer/AI_FIX.md`, `docs/developer/STEP_MODEL.md`, `docs/developer/engines/interactive-engine.md`, `docs/developer/engines/requirements-manager.md`, `docs/developer/engines/context-engine.md`, `docs/developer/FEATURE_FLAGS.md`, `docs/developer/EXPERIMENT_TESTING.md`, `docs/developer/LIVE_SESSIONS.md`, `docs/developer/integrations/workshop.md`.
- **2026-04-27**: `docs/sources/_index.md` — Added Block editor card; refreshed feature bullets for v2.9 (custom guides, floating panel mode).
- **2026-04-27**: `docs/sources/getting-started/_index.md` — Modernized for v2.9.x: added hover/popout actions, floating panel section, link to block editor doc.
- **2026-04-27**: `docs/sources/architecture/_index.md` — Rebuilt against current architecture (was 5+ months stale). Added package engine, custom guides backend, floating panel, selector resilience, live sessions, Coda subsystems.
- **2026-04-27**: `docs/sources/upgrade-notes/_index.md` — Synced with CHANGELOG for v2.4–v2.9 (was 4+ months stale).
- **2026-04-27**: `docs/sources/administrators-reference/_index.md` — Added kiosk, Coda terminal, live sessions sections; updated dev-mode admonition to note block editor and kiosk are no longer dev-mode-gated.
- **2026-04-27**: `docs/sources/block-editor/_index.md` — NEW user-facing block editor guide with Playwright-generated screenshots referenced via `/media/docs/pathfinder/`.
- **2026-04-27**: `docs/developer/GETTING_STARTED.md` — NEW onboarding entrypoint: 5-min quickstart, 15-min full setup, IDE setup, first-week reading list, troubleshooting.
- **2026-04-27**: `docs/developer/LOCAL_DEV.md` — Added prerequisites table, `npm run check` documentation, IDE setup, mage installation, troubleshooting section, container port table.
- **2026-04-27**: `docs/developer/DEV_MODE.md` — Added admonition noting block editor and kiosk mode no longer require dev mode.
- **2026-04-27**: `docs/developer/interactive-examples/json-guide-format.md` — Added popout action; added schema sections for code-block, terminal, terminal-connect, grot-guide block types; updated block summary table.
- **2026-04-27**: `docs/developer/LIVE_SESSIONS.md` — Added ECDSA P-256 presenter authentication section; noted legacy unauthenticated path removed.
- **2026-04-27**: `README.md` — Updated authoring section to point to block editor user guide; added For developers pointer to `GETTING_STARTED.md`; refreshed action type list to include `popout`.
- **2026-03-20**: `.cursor/rules/systemPatterns.mdc` — Updated Utils description (removed stale keyboard-shortcuts/link-handling refs), added Package Engine subsystem, updated Learning Paths Critical Path for `paths-cloud.json` and `paths-data.ts`.
- **2026-03-20**: `docs/developer/CLI_TOOLS.md` — Updated `--bundled` option description to reflect two-mode discovery (package directories + legacy flat JSON; `repository.json` exclusion; `static-links/` skip).
- **2026-03-20**: `.cursor/rules/interactiveRequirements.mdc` — Added `code-block` to `data-targetaction` values in Core Interactive Attributes table.
- **2026-03-20**: `docs/developer/interactive-examples/json-guide-format.md` — Updated "Bundling a JSON Guide" section to reflect new package directory structure (`my-guide/content.json` instead of flat `my-guide.json`, and cross-reference to `package-authoring.md` added).
- **2026-03-20**: `docs/developer/CUSTOM_GUIDES.md` — Validated against `src/components/block-editor/` and custom guide backend. Indexed in `AGENTS.md`.
- **2026-03-20**: `docs/developer/integrations/workshop.md` — Updated for `flags.ts` (follow-mode feature flag), `session-crypto.ts` (ECDSA P-256 presenter authentication), `session-manager.ts` and `session-state.tsx` (P2P session management). Added Session Manager, Session State, Session Crypto, and Feature Flags sections.
- **2026-03-20**: `docs/developer/CODA.md` — Updated for alloy-scenario VM template (`vm-aws-alloy-scenario`), `ListAlloyScenarios`/`handleAlloyScenarios` endpoints, `useCodaOptions` hook, `vmScenario` field, quota cleanup with polling, animated provision progress bar, and last VM opts sessionStorage key. Cross-reference to `coda.mdc` added.
- **2026-03-20**: `.cursor/rules/coda.mdc` — Updated for alloy-scenario VM template, `useCodaOptions` hook, `/alloy-scenarios` endpoint, `vmScenario` field, quota cleanup. Cross-reference to `CODA.md` added.
- **2026-03-05**: `docs/developer/constants/README.md` — Re-validated against `src/constants/`. Added documentation for `testIds.ts` (e2e test identifiers).
- **2026-02-25**: `docs/developer/utils/README.md` — Re-validated against `src/utils/`. Removed deleted files (keyboard-shortcuts.hook.ts, link-handler.hook.ts), added new files (fetchBackendGuides.ts, usePublishedGuides.ts).
- **2026-02-20**: `docs/developer/learning-paths/README.md` — Created and validated against `src/learning-paths/`. Covers path types, platform selection, badge system, streak tracking, progress management, hooks, and integration points.
- **2026-02-20**: `docs/developer/engines/context-engine.md` — Updated earlier today; no structural source changes since update.
- **2026-02-25**: `docs/developer/engines/interactive-engine.md` — Re-validated. Updated action-detector.ts location from src/interactive-engine/auto-completion/ to src/lib/dom/.
- **2026-02-20**: `docs/developer/engines/requirements-manager.md` — Updated earlier today; no structural source changes since update.
- **2026-02-20**: `docs/developer/E2E_TESTING.md` — Updated earlier today; no structural source changes since update. Cross-reference to `testingStrategy.mdc` added.
- **2026-02-20**: `docs/developer/E2E_TESTING_CONTRACT.md` — No structural source changes. Cross-reference to `testingStrategy.mdc` added.
- **2026-02-20**: `.cursor/rules/testingStrategy.mdc` — Cross-references to E2E docs added.

## Exclusions

<!-- Files confirmed as not needing an AGENTS.md entry. Format: path, reason. -->

- `docs/_maintenance-backlog.md` — Workflow-owned state for the maintain-docs skill; the skill reads it directly, so it does not need agent-context indexing.
- `docs/developer/provisioning/README.md` — 4-line stub with only external links to Grafana provisioning docs. No agent-relevant content.
- `.cursor/skills/maintain-docs/SKILL.md` — Discovered automatically by IDE via `.cursor/skills/` glob pattern. No AGENTS.md entry needed.
- `.cursor/skills/design-review/SKILL.md` — Same as above.
- `.cursor/skills/e2e-guide-analysis/SKILL.md` — Same as above.
- `docs/sources/_index.md` — End-user documentation published to Grafana.com. Not agent-relevant for implementation tasks.
- `docs/sources/getting-started/_index.md` — Same as above.
- `docs/sources/administrators-reference/_index.md` — Same as above.
- `docs/sources/architecture/_index.md` — Same as above.
- `docs/sources/upgrade-notes/_index.md` — Same as above.
- `docs/developer/src/README.md` — Broad source-tree overview that duplicates AGENTS.md code organization section. Too granular to stay accurate; no agent-specific constraints.
- `docs/developer/components/README.md` — Components directory overview. Agents get this context from AGENTS.md code organization and on-demand docs already.
- `docs/developer/components/App/README.md` — Local component README for App root. Context for developers working on App component only.
- `docs/developer/components/AppConfig/README.md` — Local component README for plugin configuration UI.
- `docs/developer/components/block-editor/README.md` — Local component README for visual JSON guide editor.
- `docs/developer/components/docs-panel/README.md` — Local component README for core documentation panel.
- `docs/developer/components/SelectorDebugPanel/README.md` — Local component README for developer tools panel.
- `docs/developer/components/PrTester/README.md` — Local component README for PR testing tool.
- `docs/developer/components/LearningPaths/README.md` — Local component README for learning path UI. Complemented by the now-indexed `docs/developer/learning-paths/README.md`.
- `docs/developer/components/LiveSession/README.md` — Local component README. Redundant with already-indexed `LIVE_SESSIONS.md`.
- `docs/developer/components/FeedbackButton/README.md` — Local component README for feedback button.
- `docs/developer/pages/README.md` — Pages directory README. Very narrow scope (single page definition).
- `docs/developer/styles/README.md` — Styles directory README. Useful for style work but no agent-level constraints.
- `.cursor/skills/plugin-bundle-size/SKILL.md` — Discovered automatically by IDE via `.cursor/skills/` glob pattern. No AGENTS.md entry needed.
- `.cursor/skills/bugfix/SKILL.md` — Workflow skill invoked via `/bugfix`; auto-discovered by the IDE via the `.cursor/skills/` glob. Consistent with the other workflow-skill exclusions; no AGENTS.md entry needed. (Its companion reference `docs/developer/bugfix-patterns.md` is already indexed.)
- `.cursor/skills/refactor/SKILL.md` — Workflow skill invoked via `/refactor-investigate` / `/refactor-plan` / `/refactor-execute`; auto-discovered by the IDE. No AGENTS.md entry needed.
- `.cursor/skills/maintain-docs/intent.md` — Design rationale linked directly from `.cursor/skills/maintain-docs/SKILL.md`; it supplements that workflow rather than defining a separate task domain.
- `docs/sources/block-editor/_index.md` — End-user documentation published to Grafana.com. Not agent-relevant for implementation tasks.
- `docs/sources/terms-and-conditions/_index.md` — End-user data-usage notice published to Grafana.com; auto-generated from `src/components/AppConfig/terms-content.ts` via `npm run docs:sync-terms` (do not hand-edit). Not agent-relevant for implementation tasks.
