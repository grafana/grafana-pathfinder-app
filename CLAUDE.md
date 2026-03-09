# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> See also: `AGENTS.md` — the primary agent reference with the full on-demand context table, slash command definitions, and extended architecture notes.

## Commands

```bash
# Development
npm run dev            # Webpack watch mode (frontend)
npm run server         # Build everything + run Grafana in Docker (localhost:3000, admin/admin)

# Testing
npm run test:ci        # Run all frontend tests (use this in CI / as an agent)
npm test               # Jest watch mode (local dev)
npm run test:go        # Run Go backend tests

# Code quality
npm run lint           # ESLint
npm run lint:fix       # ESLint + Prettier auto-fix
npm run prettier-test  # Check formatting
npm run typecheck      # tsc --noEmit

# Full pre-merge check
npm run check          # typecheck + lint + prettier + lint:go + test:go + test:ci

# Build
npm run build          # Frontend production build
npm run build:backend:darwin-arm64  # Go backend for Apple Silicon
npm run build:all      # Frontend + backend (Linux x64 + ARM64)
```

Go backend targets: `mage build:darwin`, `mage build:darwinARM64`, `mage build:linux`, `mage build:linuxARM64`.

## Architecture

**Grafana Pathfinder** is a Grafana App Plugin — a right-hand sidebar that provides contextual, interactive documentation inside Grafana.

- **Frontend**: React 18 + TypeScript + Grafana Scenes (state management). Webpack build.
- **Backend**: Go using `grafana-plugin-sdk-go`. Handles streaming, terminal/SSH connections, and resource handlers.
- **Key frontend subsystems** (`src/`):
  - `context-engine/` — detects user's current Grafana context, drives recommendations
  - `interactive-engine/` — executes "Show Me" / "Do It" tutorial actions against the live DOM
  - `requirements-manager/` — checks prerequisites before interactive steps
  - `docs-retrieval/` — multi-strategy content fetching with bundled JSON fallbacks
  - `global-state/` — app-wide sidebar state and link interception
  - `learning-paths/` — badges, streaks, milestone progress tracking
  - `pages/` — Grafana Scenes page definitions and routing
  - `bundled-interactives/` — JSON guide files shipped with the plugin as fallback content

## Code style

- **Functional-first**: small pure functions, immutable data, `map`/`filter`/`reduce` over loops, type annotations everywhere.
- **Idiomatic React**: hooks for business logic, consistent with how Grafana's own codebase is written.
- **Sentence case in all UI text**: capitalize only the first word and proper nouns (Grafana, Loki, Prometheus, etc.). Never title-case headings, button labels, or menu items.
- **No proactive summary files**: do not create `IMPLEMENTATION_SUMMARY.md`, `CLEANUP_SUMMARY.md`, or similar files unless the user explicitly asks. Put summaries in chat.

## On-demand context

Load these docs **only when working in the relevant domain**:

| File                                        | When to load                           |
| ------------------------------------------- | -------------------------------------- |
| `.cursor/rules/systemPatterns.mdc`          | Architecture / component relationships |
| `.cursor/rules/techContext.mdc`             | Tech stack, dependencies, build system |
| `.cursor/rules/interactiveRequirements.mdc` | Interactive tutorial system            |
| `.cursor/rules/react-antipatterns.mdc`      | PR reviews, hooks/effects/state        |
| `.cursor/rules/frontend-security.mdc`       | Frontend security review               |
| `.cursor/rules/testingStrategy.mdc`         | Writing or reviewing tests             |
| `.cursor/rules/schema-coupling.mdc`         | JSON guide types/schemas               |
| `docs/developer/RELEASE_PROCESS.md`         | Releasing / versioning                 |
| `docs/developer/FEATURE_FLAGS.md`           | Feature flags                          |
| `docs/developer/E2E_TESTING_CONTRACT.md`    | E2E tests, `data-test-*` attributes    |
| `docs/developer/LOCAL_DEV.md`               | Local dev setup / Docker workflow      |
| `docs/developer/KNOWN_ISSUES.md`            | Known bugs and workarounds             |
| `docs/developer/interactive-examples/*.md`  | Authoring interactive JSON guides      |
| `docs/developer/engines/*.md`               | Engine subsystem internals             |

## PR reviews

Load `.cursor/rules/pr-review.md` for `/review`. It contains the full detection table (React anti-patterns R1-R21, security F1-F6, quality heuristics QC1-QC7).

For PRs touching `pkg/**/*.go`, verify: `npm run lint:go`, `npm run test:go`, and `go build ./...` all pass.
