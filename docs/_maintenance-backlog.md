# Documentation maintenance backlog

Persistent tracker for the maintain-docs skill's persistent state across runs.

## Work items

<!-- Structural issues requiring dedicated effort. Format: date, description, rationale. Remove when resolved. -->

- **2026-02-20**: `src/learning-paths/` new subsystem needs documentation — New directory (12 files, created Feb 16-18) covering learning paths, badges, streak tracking, and guide fetching. No dedicated doc exists. Recommend creating `docs/developer/learning-paths/README.md` in a feature branch.

- **2026-02-20**: Remaining orphaned component READMEs — `docs/developer/components/` subdirectory READMEs (App, AppConfig, block-editor, docs-panel, SelectorDebugPanel, PrTester, LearningPaths, LiveSession, FeedbackButton, parent README) and `docs/developer/pages/README.md`, `docs/developer/styles/README.md`, `docs/developer/src/README.md` have no path from AGENTS.md. These are lower value but could be indexed as a group.

- **2026-02-20**: Intent gaps in non-engine docs — `ASSISTANT_INTEGRATION.md`, `LIVE_SESSIONS.md`, and `integrations/workshop.md` have no `<!-- intent -->` marker and no existing rationale headings. Lower priority than engine docs.

## Validated docs

<!-- Docs checked against source and found accurate. Format: date, doc path. Update date on re-validation. -->

- **2026-02-20**: `docs/developer/utils/README.md` — Validated against `src/utils/` and `src/utils/devtools/`. Fixed stale file listings (3 deleted devtools files removed, 3 new utility files and 2 devtools structural files added), corrected export names in `openfeature.ts` and `utils.plugin.ts` sections.

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
