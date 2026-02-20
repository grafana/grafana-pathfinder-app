# Documentation maintenance backlog

Persistent tracker for structural issues identified by the maintain-docs skill.
Items here require dedicated effort beyond incremental edits.

<!-- Each entry: date, description, rationale. Remove when resolved. -->

## MEDIUM priority

- **2026-02-20**: `CLI_TOOLS.md` staleness — Doc last updated Feb 5, `src/cli/` had E2E CLI improvements (#538) on Feb 9. CLI options or behavior may have drifted.

- **2026-02-20**: `LIVE_SESSIONS.md` staleness — Doc last updated Feb 10, `src/components/LiveSession/` changed Feb 17 (#586, "learning journey" → "learning path" rename). May contain stale terminology.

- **2026-02-20**: Remaining orphaned component READMEs — `docs/developer/components/` subdirectory READMEs (App, AppConfig, block-editor, docs-panel, SelectorDebugPanel, PrTester, LearningPaths, LiveSession, FeedbackButton, parent README) and `docs/developer/pages/README.md`, `docs/developer/styles/README.md`, `docs/developer/src/README.md` have no path from AGENTS.md. These are lower value but could be indexed as a group.

- **2026-02-20**: `docs/sources/` directory — Contains published Grafana documentation sources (`_index.md` files). Needs a decision: should these be indexed in AGENTS.md for agents, or are they out of scope? Currently orphaned.

- **2026-02-20**: Intent gaps in non-engine docs — `ASSISTANT_INTEGRATION.md`, `LIVE_SESSIONS.md`, and `integrations/workshop.md` have no `<!-- intent -->` marker and no existing rationale headings. Lower priority than engine docs.

## LOW priority

- **2026-02-20**: Skills SKILL.md files not indexed — `.cursor/skills/` SKILL.md files (maintain-docs, design-review, e2e-guide-analysis, tidy-up) are not referenced in AGENTS.md. These are discovered automatically by `.cursor/skills/` glob patterns in the IDE, so indexing may be unnecessary. Confirm and close if not needed.
