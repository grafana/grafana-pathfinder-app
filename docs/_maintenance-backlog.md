# Documentation maintenance backlog

Persistent tracker for structural issues identified by the maintain-docs skill.
Items here require dedicated effort beyond incremental edits.

<!-- Each entry: date, description, rationale. Remove when resolved. -->

## MEDIUM priority

- **2026-02-20**: `E2E_TESTING.md` staleness — Doc last updated Feb 6, `tests/` directory changed Feb 17 (11 days stale). Needs validation that the E2E guide test runner documentation is still accurate.

- **2026-02-20**: `context-engine.md` intent gap — Engine doc has no `<!-- intent -->` marker and no existing rationale headings. Needs rationale extraction from source code and design docs to create a Design intent section.

- **2026-02-20**: Remaining orphaned docs — `SCALE_TESTING.md`, utility/subsystem READMEs (`utils/`, `styles/`, `provisioning/`, `pages/`, `src/`, `constants/`) still have no path from AGENTS.md. These are lower value but could be indexed cheaply as group entries.

- **2026-02-20**: `docs/sources/` directory — Contains published Grafana documentation sources (`_index.md` files). Needs a decision: should these be indexed in AGENTS.md for agents, or are they out of scope? Currently orphaned.

## LOW priority

- **2026-02-20**: Skills SKILL.md files not indexed — `.cursor/skills/` SKILL.md files (maintain-docs, design-review, e2e-guide-analysis, tidy-up) are not referenced in AGENTS.md. These are discovered automatically by `.cursor/skills/` glob patterns in the IDE, so indexing may be unnecessary. Confirm and close if not needed.
