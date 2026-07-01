# Grafana Pathfinder - AI Agent Guide

## What is this project?

**Grafana Pathfinder** is a Grafana App Plugin that provides contextual, interactive documentation directly within the Grafana UI. It appears as a right-hand sidebar panel that displays personalized learning content, tutorials, and recommendations to help users learn Grafana products and configurations. Built as a **React + TypeScript + Grafana Scenes** frontend with a **Go backend** using `grafana-plugin-sdk-go`.

### Key features

- **Context-Aware Recommendations**: Automatically detects what you're doing in Grafana and suggests relevant documentation
- **Interactive Tutorials**: Step-by-step guides with "Show me" and "Do it" buttons that can automate actions in the Grafana UI
- **Tab-Based Interface**: Browser-like experience with multiple documentation tabs and localStorage persistence
- **Intelligent Content Delivery**: Multi-strategy content fetching with bundled fallbacks
- **Progressive Learning**: Tracks completion state and adapts to user experience level

### Target audience

Beginners and intermediate users who need to quickly learn Grafana products. Not intended for deep experts who primarily need reference documentation.

## Code style and conventions

### Coding style

- **Functional-first**: Pragmatic FP approach balancing purity with practicality
- Break problems into small, reusable functions
- Use immutable data structures and pure functions for core logic
- Allow minimal side effects in well-isolated functions (e.g., IO, logging)
- Favor functional patterns (`map`, `filter`, `reduce`) over loops
- Use type annotations whenever possible
- Favor idiomatic React usage consistent with the Grafana codebase

### Comments

**Default to no comments.** Add one only when removing it would confuse a reader who can read the surrounding code. The narrow band that earns a comment: counterintuitive code that looks wrong but is correct, hidden invariants, or workarounds for specific external bugs (with a link).

**Trim on touch.** When editing a function, also trim bad-shape comments inside that function and on adjacent declarations in the same file. Do not sweep whole files or grep across the repo for cleanup — comment removal rides along on code changes, never as a standalone PR.

**Bad shapes to delete (QC8 catalog):** (1) narrates the next line, (2) defends a non-action (`Intentionally NOT X`), (3) references dead process artifacts (pre-mortems, ticket/PR refs), (4) points at where a value came from (`Find References` does that), (5) repeats the user-visible string, (6) big JSDoc on a small internal type, (7) justifies a trivial `||` fallback, (8) whole-file docstring on a `<50`-line module.

**Keep-list:** counterintuitive-but-correct code, hidden invariants the type system can't express, external-bug workarounds (with an upstream link), and security/correctness warnings. If a comment won't fit on one short line, rename or restructure instead.

For the full catalog with before/after examples, load the `comment-hygiene` skill (`.cursor/skills/comment-hygiene/SKILL.md`).

### Writing style

All UI text and documentation follows **sentence case** per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization).

- **Capitalize only the first word** and proper nouns (product names, company names)
- **Do NOT use title case** for headings, button labels, menu items, or other UI elements
- Proper nouns to capitalize: **Grafana**, **Loki**, **Prometheus**, **Tempo**, **Mimir**, **Alloy**, **Grafana Cloud**, **Grafana Enterprise**, **Grafana Labs**
- Generic terms stay lowercase: dashboard, alert, data source, panel, query, plugin

### File creation policy

Do NOT create summary `.md` files unless explicitly requested by the user. No `IMPLEMENTATION_SUMMARY.md`, no `CLEANUP_SUMMARY.md`, no proactive documentation files. Communicate all summaries and completion status directly in chat responses.

### Slash commands

`/review` and `/secure` are defined by their skills (see the "Skills" section below). Two persona-only commands with no backing skill:

| Command | Role                 | Behavior                                                                                                                                                                |
| ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/test` | Test writer          | Tests that enable change. Prioritize unit tests, edge cases, failure modes. Property-based tests when useful. Avoid mocking unless necessary. Fast, isolated, reliable. |
| `/docs` | Documentation writer | Write for humans first. Document purpose, parameters, return values. Small useful examples. Standard docstring style. Avoid unnecessary words.                          |

## Skills

Skills are reusable agent workflows. Each lives at `.cursor/skills/<name>/SKILL.md` with `name` + `description` frontmatter. Read a skill's `SKILL.md` before running it, and follow it exactly. Invoke a skill by name; harnesses that support slash commands expose it as `/<name>`. Every agent on this repo shares these skills regardless of harness.

Available skills: `bugfix`, `changelog`, `comment-hygiene`, `design-review`, `e2e-guide-analysis`, `i18n-sync`, `maintain-docs`, `plugin-bundle-size`, `pr-summary`, `prevent-doc-drift`, `refactor`, `release-prep`, `review`, `secure`, `techdebt`.

This is a names-only index — the authoritative description of what each skill does and when to use it is its frontmatter, read live. Before starting a non-trivial task, hydrate the descriptions to see which skill applies:

```bash
for f in .cursor/skills/*/SKILL.md; do
  echo "### $(basename "$(dirname "$f")")"
  awk 'NR==1 && /^---/ {f=1; next} f && /^---/ {exit} f' "$f"
done
```

To add a skill: create `.cursor/skills/<name>/SKILL.md` with `name` + `description` frontmatter and add `<name>` to the list above. There is no per-skill description to maintain here — the frontmatter is the single source of truth.

## Essential commands

```bash
npm install              # Install dependencies (requires Node.js 24+)
npm run dev              # Frontend watch mode
npm run server           # Run Grafana locally with Docker
npm run test:ci          # Frontend tests, no coverage (agents should use this, not `npm test`)
npm run test:coverage    # Frontend tests with coverage + thresholds (used by `npm run check`)
npm run lint:fix         # Lint + autofix
npm run check            # Full pre-merge gate: typecheck + lint + prettier + lint:go + test:go + test:coverage
```

Dev server runs at http://localhost:3000 (admin/admin). For the complete command reference (build targets, mage tasks, validation, i18n, peerjs, etc.), see `docs/developer/COMMANDS.md` or read `package.json#scripts` directly.

## Code organization

### Frontend tier model

Imports flow **downward only** to avoid cycles, across five tiers: **0** types & constants → **1** support (`lib/`, `security/`, `styles/`, `global-state/`, `utils/`, `validation/`, `recovery/`) → **2** engines & hooks (`context-engine/`, `docs-retrieval/`, `interactive-engine/`, `requirements-manager/`, `learning-paths/`, `package-engine/`, `snippet-engine/`, `hooks/`) → **3** integrations → **4** UI (`components/`, `pages/`). Cross-tier rules are enforced by ESLint and `src/validation/architecture.test.ts`; the canonical source is `TIER_MAP` in `src/validation/import-graph.ts`.

For the annotated tier definitions, the per-subsystem reference, and the key dependency-edges table (load-bearing producer → consumer wiring), load `.cursor/rules/systemPatterns.mdc`.

### Backend (`pkg/`)

The Go backend is a thin bridge between the React frontend and the **Coda VM provisioning service**. No database — all state is ephemeral or delegated to Coda. Three primary request paths: HTTP resource API (`resources.go`), streaming terminal over Grafana Live (`stream.go` + `terminal.go` + `wsconn.go`), and the Coda JWT client (`coda.go`).

When touching `pkg/`, load `.cursor/rules/coda.mdc` (agent-facing constraints) and `docs/developer/CODA.md` (full SSH / relay / credential-refresh reference). Plugin entrypoint is `pkg/main.go`.

## On-demand context

Load files only when working in the relevant domain — do not preload. The full routing table (engines, security, testing, CLI/MCP, design docs, skills, history) lives in **[`docs/developer/CONTEXT_INDEX.md`](docs/developer/CONTEXT_INDEX.md)**.

Frequently-needed entries:

- `docs/design/CONCERNS.md` — PR review routing, impact analysis, one-way doors
- `.cursor/rules/systemPatterns.mdc` — architecture, component relationships, per-subsystem entry points
- `.cursor/rules/frontend-security.mdc` — frontend security F1-F6; load when working in `*.ts`/`*.tsx`/`*.js`/`*.jsx` files (Cursor auto-loads via `globs:` frontmatter; Claude Code does not — cite by path)
- `.cursor/rules/react-antipatterns.mdc` — Do/Don't reference for R1-R21
- `.cursor/rules/testingStrategy.mdc` — unit/smoke/integration test guidance
- `docs/developer/E2E_TESTING.md` + `E2E_TESTING_CONTRACT.md` — E2E runner and `data-test-*` attributes
- `docs/developer/RELEASE_PROCESS.md` — releasing, deploying, versioning

## PR reviews

Use `/review`. It invokes `.cursor/skills/review/SKILL.md` (orchestration workflow) which loads `docs/design/CONCERNS.md` (concern routing) and `docs/design/PR_REVIEW.md` (pattern catalog for R1-R21, F1-F6, QC1-QC7, G1-G7); `react-antipatterns.mdc` loads on hit. The review skill also spawns a tech-debt sub-agent (`.cursor/skills/techdebt/SKILL.md`) scoped to the PR's changed files. For Go PRs touching `pkg/**/*.go`, also verify `npm run lint:go`, `npm run test:go`, and `go build ./...` pass.

Use `CONCERNS.md` alone for impact analysis, change risk classification, and subsystem-aware debugging.

## Tech-debt audits

Use `/techdebt <subsystem>` to run a confidence-tiered debt audit on a concrete target (directory, glob, or named subsystem). The skill reads `.cursor/skills/techdebt/SKILL.md` and its `PATTERNS.md` catalog (categories A–E: local syntactic, cross-file structural, architectural, process debt, operational seams). Findings are ordered by hotspot score (`churn × severity`) so the highest-risk items surface first. Run with `--suggestive` to include lower-confidence candidates.

## `npx` examples

When generating `npx` examples of new potential CLIs and similar, these should all live under `pathfinder-cli@...`.
For example, for a hypothetical new package `pathfinder-example`, write `npx pathfinder-cli@... example` instead of `npx pathfinder-example`.
This ensures we don't get namesquatted.
