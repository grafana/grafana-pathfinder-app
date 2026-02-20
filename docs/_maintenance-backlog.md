# Documentation maintenance backlog

Persistent tracker for structural issues identified by the maintain-docs skill.
Items here require dedicated effort beyond incremental edits.

<!-- Each entry: date, description, rationale. Remove when resolved. -->

## HIGH priority

- **2026-02-20**: `authoring-interactive-journeys.md` staleness — Last updated Nov 18, 2025 (93 days stale). Source directories (`src/interactive-engine/`, `src/components/interactive/`) have changed extensively since then. The doc likely contains outdated authoring instructions. Needs full staleness validation and possibly a structural rewrite.

- **2026-02-20**: `interactive-engine.md` staleness — Doc last updated Feb 10, source (`src/interactive-engine/`) last changed Feb 19 (9 days stale). The interactive engine is a high-traffic domain; needs staleness validation to catch any behavioral drift.

## MEDIUM priority

- **2026-02-20**: `CLI_TOOLS.md` staleness — Doc last updated Feb 5, source (`src/cli/`) changed Feb 9 (4 days stale). Lower risk than engine docs but should be validated in next run.

- **2026-02-20**: `E2E_TESTING_CONTRACT.md` staleness — Doc last updated Feb 10, E2E test directories changed Feb 17 (7 days stale). Needs validation that `data-test-*` attribute contracts are still accurate.

- **2026-02-20**: Remaining orphaned docs — 20+ component READMEs, `LIVE_SESSIONS.md`, `KNOWN_ISSUES.md`, `SCALE_TESTING.md`, and `integrations/workshop.md` still have no path from AGENTS.md. Component READMEs could be indexed as a group entry. `LIVE_SESSIONS.md` and `KNOWN_ISSUES.md` are lower value but could be indexed cheaply.

- **2026-02-20**: `docs/sources/` directory — Contains published Grafana documentation sources (`_index.md` files). Needs a decision: should these be indexed in AGENTS.md for agents, or are they out of scope? Currently orphaned.

## LOW priority

- **2026-02-20**: Skills SKILL.md files not indexed — `.cursor/skills/` SKILL.md files (maintain-docs, design-review, e2e-guide-analysis, tidy-up) are not referenced in AGENTS.md. These are discovered automatically by `.cursor/skills/` glob patterns in the IDE, so indexing may be unnecessary. Confirm and close if not needed.
