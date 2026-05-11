# CLAUDE.md

@AGENTS.md — the primary agent reference for this repository.

## Additional context for Claude Code

### Skills (`.cursor/skills/`)

Reusable agent workflows. Read a skill's `SKILL.md` before invoking it.

| Skill                | Trigger                          | Purpose                                                                                                                                |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `bugfix`             | `/bugfix [issue-#]`              | Two-commit failing-test → fix workflow in a worktree                                                                                   |
| `changelog`          | `/changelog [version]`           | Draft CHANGELOG entry from merged PRs since the last release tag                                                                       |
| `design-review`      | conversation request             | Principal-engineer design partner; never writes code                                                                                   |
| `e2e-guide-analysis` | run E2E on a guide               | Diagnose E2E failures, write a learning report                                                                                         |
| `i18n-sync`          | `/i18n-sync`                     | Stub missing keys across 21 locales; emit a translation gap report                                                                     |
| `maintain-docs`      | conversation request, periodic   | Whole-repo doc audit: orphans, drift, staleness — opens a PR                                                                           |
| `plugin-bundle-size` | conversation request             | Reduce plugin bundle size via React.lazy + webpack code splitting                                                                      |
| `pr-summary`         | `/pr-summary`                    | Draft structured PR description from the diff via `CONCERNS.md` routing                                                                |
| `prevent-doc-drift`  | `/review`, pre-merge             | **Per-PR** drift prevention: detects new features / architecture in a PR and updates AGENTS.md, CLAUDE.md, `.cursor/rules/` in same PR |
| `refactor`           | `/refactor-investigate <target>` | High-risk refactor with pre / extract / post-test gates                                                                                |
| `release-prep`       | `/release-prep [version]`        | Bump version + draft changelog + run check; user creates the tag                                                                       |
| `secure`             | `/secure`                        | Security audit: F1-F6 frontend + backend allowlists + MCP transport + deps                                                             |
| `tidy-up`            | `/tidy-up`                       | Pre-commit gate (typecheck + lint + prettier + Go)                                                                                     |

### Doc-quality skill pairing

The repo has two complementary doc-quality skills:

- **`prevent-doc-drift`** runs **per-PR** against the diff. Catches new subdirs / scripts / skills / docs / architecture changes at introduction and produces the doc edits in the same PR. Invoked from `/review` or directly.
- **`maintain-docs`** runs **periodically** across the whole repo. Catches gradual drift between `.cursor/rules/` and `docs/developer/`, indexes orphans, validates staleness. Invoked manually or on a schedule.

Treat them as complementary: prevent-doc-drift handles _new_ drift introduced by each PR; maintain-docs sweeps for _accumulated_ drift the per-PR skill missed.

### Other Claude Code specifics

- **Full pre-merge check**: `npm run check` runs typecheck + lint + prettier + lint:go + test:go + test:ci in one command.
- **Memory system**: Long-lived user / project / feedback notes live in `~/.claude/projects/-Users-jayclifford-Repos-grafana-pathfinder-app/memory/`. See the `auto memory` section in the system prompt for the file format.
