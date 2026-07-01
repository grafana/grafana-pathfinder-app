# CLAUDE.md

@AGENTS.md — the primary agent reference for this repository.

## Additional context for Claude Code

Skills are indexed in AGENTS.md's "Skills" section — a names-only list plus a command to hydrate each skill's frontmatter description on demand. That is the single source of truth for all harnesses; there is no separate CLAUDE.md skills table to keep in sync.

### Other Claude Code specifics

- **Full pre-merge check**: `npm run check` runs typecheck + lint + prettier + lint:go + test:go + test:coverage in one command.
- **Memory system**: Long-lived user / project / feedback notes live under `~/.claude/projects/<project-slug>/memory/`, where `<project-slug>` is the absolute path to this repo with `/` replaced by `-` (for example, a clone at `/Users/alice/code/grafana-pathfinder-app` resolves to `-Users-alice-code-grafana-pathfinder-app`). See the `auto memory` section in the system prompt for the file format.
