# Documentation maintenance backlog

Persistent tracker for the maintain-docs skill's persistent state across runs.

## Work items

<!-- Structural issues requiring dedicated effort. Format: date, description, rationale. Remove when resolved. -->

## Validated docs

<!-- Docs checked against source and found accurate. Format: date, doc path. Update date on re-validation. -->

- **2026-04-27**: `docs/sources/_index.md` — Added Block editor card; refreshed feature bullets for v2.9 (custom guides, floating panel mode).
- **2026-04-27**: `docs/sources/getting-started/_index.md` — Modernized for v2.9.x: added hover/popout actions, floating panel section, link to block editor doc.
- **2026-04-27**: `docs/sources/architecture/_index.md` — Rebuilt against current architecture (was 5+ months stale). Added package engine, custom guides backend, floating panel, selector resilience, live sessions, Coda subsystems.
- **2026-04-27**: `docs/sources/upgrade-notes/_index.md` — Synced with CHANGELOG for v2.4–v2.9 (was 4+ months stale).
- **2026-04-27**: `docs/sources/administrators-reference/_index.md` — Added kiosk, Coda terminal, live sessions sections; updated dev-mode admonition to note block editor and kiosk are no longer dev-mode-gated.
- **2026-04-27**: `docs/sources/block-editor/_index.md` — NEW user-facing block editor guide with Playwright-generated screenshots referenced via `/media/docs/pathfinder/`.
- **2026-04-27**: `docs/developer/GETTING_STARTED.md` — NEW onboarding entrypoint: 5-min quickstart, 15-min full setup, IDE setup, first-week reading list, troubleshooting.
- **2026-04-27**: `docs/developer/LOCAL_DEV.md` — Added prerequisites table, `npm run check` documentation, IDE setup, mage installation, troubleshooting section, container port table.
- **2026-04-27**: `docs/developer/DEV_MODE.md` — Added admonition noting block editor and kiosk mode no longer require dev mode.
- **2026-04-27**: `docs/developer/CUSTOM_GUIDES.md` — Cross-link to user-facing block editor doc; removed dev-mode caveat from creation flow; added floating panel + popout step section.
- **2026-04-27**: `docs/developer/interactive-examples/json-guide-format.md` — Added popout action; added schema sections for code-block, terminal, terminal-connect, grot-guide block types; updated block summary table.
- **2026-04-27**: `docs/developer/interactive-examples/selectors-reference.md` — Added selector resilience pipeline section (retry/backoff, `:text()` exact match, `data-testid` prefix matching, `panel:` domain prefix, confidence scoring, Selector Health badge).
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

- `docs/developer/provisioning/README.md` — 4-line stub with only external links to Grafana provisioning docs. No agent-relevant content.
- `.cursor/skills/maintain-docs/SKILL.md` — Discovered automatically by IDE via `.cursor/skills/` glob pattern. No AGENTS.md entry needed.
- `.cursor/skills/design-review/SKILL.md` — Same as above.
- `.cursor/skills/e2e-guide-analysis/SKILL.md` — Same as above.
- `.cursor/skills/tidy-up/SKILL.md` — Same as above.
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
