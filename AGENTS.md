# Grafana Pathfinder - AI Agent Guide

**Grafana Pathfinder** is a Grafana App Plugin that renders contextual, interactive documentation in a right-hand sidebar inside Grafana: context-aware recommendations, tutorials with "Show me" / "Do it" UI automation, and per-step completion tracking. React + TypeScript + Grafana Scenes frontend, Go backend on `grafana-plugin-sdk-go`.

It targets beginners and intermediate users learning Grafana, not experts after reference docs — when a product call hinges on audience, favor the newcomer. Scope and goals: `.cursor/rules/projectbrief.mdc`.

This file loads into every agent, so it stays under a byte budget (`src/validation/always-on-context-budget.test.ts`). Put detail in a test's failure message, a skill, or `docs/developer/CONTEXT_INDEX.md`; give it at most one line here.

## Code style and conventions

### Coding style

Functional-first and pragmatic: small composable functions, immutable data and pure functions for core logic, side effects isolated at the edges. React should read like the Grafana codebase. Use `assertExhaustive(value)` from `src/lib/assert-exhaustive.ts` in fail-safe `default` branches.

### Control characters in source

Never paste a raw control byte, invisible Unicode formatting character, or bidirectional control into a tracked file — write an escape or build it with `String.fromCharCode`. A raw byte makes `grep -r` and `rg` skip the whole file silently. `src/validation/control-bytes.test.ts` and `src/validation/unicode-format-characters.test.ts` enforce this and explain the fix.

### Comments

**Default to no comments.** Add one only for counterintuitive-but-correct code, hidden invariants the type system can't express, external-bug workarounds (with an upstream link), or security and correctness warnings. If it won't fit on one short line, rename or restructure instead. Every `eslint-disable` needs an explanation after `--`. **Trim on touch**: when editing a function, trim bad-shape comments in it and on adjacent declarations — never as a standalone sweep. The eight bad shapes (QC8) live in the `comment-hygiene` skill.

### Writing style

All UI text and documentation uses **sentence case** per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization) — capitalize the first word and proper nouns only, including headings, button labels, and menu items. Product and company names are proper nouns (**Grafana**, **Loki**, **Prometheus**, **Tempo**, **Mimir**, **Alloy**, **Grafana Cloud**, **Grafana Enterprise**, **Grafana Labs**); generic terms are not (dashboard, alert, data source, panel, query, plugin).

### File creation policy

Do not create summary `.md` files (`IMPLEMENTATION_SUMMARY.md` and friends) unless asked. Report completion in chat.

## Skills

Skill bodies live in `.cursor/skills/<name>/SKILL.md`, each with a pointer stub at `.claude/skills/<name>/SKILL.md` carrying identical frontmatter (`src/validation/skill-references.test.ts`). Read a skill's `SKILL.md` before running it, and follow it exactly.

## Essential commands

```bash
npm install              # Install dependencies (requires Node.js 24+)
npm run dev              # Frontend watch mode
npm run server           # Run Grafana locally with Docker
npm run test:ci          # Frontend tests, no coverage (agents should use this, not `npm test`)
npm run test:coverage    # Frontend tests with coverage + thresholds (used by `npm run check`)
npm run lint:fix         # Lint + autofix
npm run lint:go          # Go lint (golangci-lint); CI-enforced, so a diagnostic here blocks merge
npm run check            # Full pre-merge gate (`npm run check -- --list` prints the steps)
npm run test:scripts     # Shell scripts: bash -n, shellcheck, behavioural suites
```

Dev server runs at http://localhost:3000 (admin/admin). Focused Jest runs need `--coverage=false`, or global thresholds report a false failure. Match `GOLANGCI_LINT_VERSION` in `.github/workflows/ci.yml` locally to see CI's Go lint diagnostics. Full reference: `docs/developer/COMMANDS.md`. Before blaming your branch for a red check, read `docs/developer/KNOWN_GOTCHAS.md`.

## Code organization

### Frontend tier model

Imports flow **downward only**, enforced by ESLint and `src/validation/architecture.test.ts`. Exceptions need an accountable allowlist entry. Annotated tier definitions, lateral-isolation bridges, and the key dependency edges live in `.cursor/rules/systemPatterns.mdc`.

- **Tier 0 — Types & constants**: `types/`, `constants/`
- **Tier 1 — Support**: `lib/`, `security/`, `styles/`, `global-state/`, `utils/`, `validation/`, `recovery/`, `completion-records/`
- **Tier 2 — Engines & hooks**: `context-engine/`, `docs-retrieval/`, `interactive-engine/`, `requirements-manager/`, `learning-paths/`, `package-engine/`, `snippet-engine/`, `hooks/`
- **Tier 3 — Integrations**: `integrations/`
- **Tier 4 — UI**: `components/`, `pages/`

Excluded from tier analysis (not tiered): `test-utils/`, `cli/`, `bundled-interactives/`, `img/`, `locales/`. The canonical source is `TIER_MAP` in `src/validation/import-graph.ts`.

`src/cli/` and `tests/` run in plain Node, so nothing they import may need browser globals; put shared logic in environment-neutral `*-core.ts` modules. `architecture.test.ts` also ratchets orphaned and off-graph modules; its failure messages give the procedure.

### Backend (`pkg/`)

The Go backend is an **App Platform proxy** and nothing else — no database, no streaming. Load `docs/design/BACKEND_PROXY_PATTERN.md` before touching `pkg/`; it is the canonical pattern and holds the identity trust boundary. `/package-recommendations` is an anonymous, process-wide cached CDN fetch: per-user data must never enter its cache. Sandbox VMs and terminals live in [`grafana-coda-app`](https://github.com/grafana/grafana-coda-app); see `.cursor/rules/coda.mdc`.

## On-demand context

Load files only when working in the relevant domain. The full routing table is **[`docs/developer/CONTEXT_INDEX.md`](docs/developer/CONTEXT_INDEX.md)**. Hot paths:

- `docs/design/CONCERNS.md` — compact PR review routing and impact analysis
- `.cursor/rules/systemPatterns.mdc` — architecture and per-subsystem entry points
- `.cursor/rules/frontend-security.mdc` — F1-F6; applies to any `*.ts`/`*.tsx`/`*.js`/`*.jsx` change
- `.cursor/rules/react-antipatterns.mdc` — R1-R21 routing index; load the themed file it names
- `.cursor/rules/testingStrategy.mdc` — unit/smoke/integration guidance
- `docs/developer/TELEMETRY.md` — Faro + RudderStack policy and privacy invariants

## PR reviews

Use `/review`. A PR whose author is not listed in `.github/community-pr-gate.json` goes through `/community-pr` first; that list is authoritative even where `.github/CODEOWNERS` differs.

## Tech-debt audits

Use `/techdebt <subsystem>` against a concrete target; add `--suggestive` for lower-confidence candidates.

## A/B experiments

Use `/create-experiment`. Only object-valued flags carrying a `variant` field emit exposure events; a boolean experiment flag silently produces no readout.

## `npx` examples

Namespace every `npx` example under `pathfinder-cli@...` (write `npx pathfinder-cli@... example`, never `npx pathfinder-example`) so we are not namesquatted.

## Filing issues

Fill out `.github/ISSUE_TEMPLATE/structured-issue.yml`, especially User impact / flow change and Acceptance criteria, and apply `needs-review` plus type, area, and severity labels. Report security issues via [Grafana's security reporting page](https://grafana.com/legal/report-a-security-issue/), not in this repository.
