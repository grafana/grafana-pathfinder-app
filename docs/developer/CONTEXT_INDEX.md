# On-demand context index

Load these files **only when working in the relevant domain**.

**Cross-tool behavior — important.** In **Cursor**, many `.cursor/rules/*.mdc` files auto-load via `globs:` / `alwaysApply:` frontmatter. In **Claude Code**, that frontmatter is inert — `.mdc` files are discoverable but not auto-loaded; load them by name when working in the relevant domain (typically because another file like `docs/design/PR_REVIEW.md` or a skill cites them). The "Auto-triggered by globs" column in the tables below documents the Cursor behavior for cross-tool reference; treat it as a hint about a rule's intended scope, not as a load-on-demand guarantee in Claude Code.

`.mdc` files live in `.cursor/rules/`. Developer-facing references (`*.md`) live under `docs/developer/`. Design docs live under `docs/design/` — these capture **design intent** and may not match implemented reality; verify against the code before acting on them. Skills live under `.cursor/skills/<name>/SKILL.md`.

## Architecture and project context

| File                      | When to load                                                                                                     | Auto-triggered by globs |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `projectbrief.mdc`        | Understanding project scope and goals                                                                            | --                      |
| `techContext.mdc`         | Tech stack, dependencies, build system                                                                           | --                      |
| `systemPatterns.mdc`      | Architecture, component relationships, per-subsystem entry points and key files                                  | --                      |
| `docs/design/CONCERNS.md` | PR review routing, impact analysis, change risk classification, one-way door analysis, subsystem-aware debugging | --                      |

## Interactive tutorial / guide authoring

| File                          | When to load                                                                                                                                                                                                                                                | Auto-triggered by globs                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactiveRequirements.mdc` | Interactive tutorial system work                                                                                                                                                                                                                            | --                                                                                                                                                            |
| `STEP_MODEL.md`               | End-to-end model for step completion — store ownership (`global-state/completion-store.ts`), reset paths, stable step IDs (`global-state/step-id.ts`), section-completed gate, FSM ↔ store bridge. Load when touching completion, reset, or stable-ID code. | `src/global-state/completion-store.ts`, `src/global-state/step-id.ts`, `src/components/interactive-tutorial/interactive-section.tsx`                          |
| `tracked-step-types.mdc`      | Adding, renaming, or removing an interactive step component type. Lists the 2-site registry (`STEP_TYPE_SCHEMAS` + `INTERACTIVE_STEP_COMPONENT_TYPES`) that must stay in sync.                                                                              | `src/components/interactive-tutorial/*.tsx`, `src/components/content-renderer/content-renderer.tsx`, `src/docs-retrieval/json-parser.ts`                      |
| `schema-coupling.mdc`         | JSON guide / snippet types or schemas                                                                                                                                                                                                                       | `json-guide.types.ts`, `json-guide.schema.ts`, `json-snippet.types.ts`, `json-snippet.schema.ts`                                                              |
| `interactive-examples/*.md`   | Authoring interactive guides (format, types, selectors)                                                                                                                                                                                                     | --                                                                                                                                                            |
| `engines/*.md`                | Engine subsystem internals (context, interactive, requirements)                                                                                                                                                                                             | `src/context-engine/*`, `src/interactive-engine/*`, `src/requirements-manager/*`                                                                              |
| `ASSISTANT_INTEGRATION.md`    | Authoring customizable content with `<assistant>` tag                                                                                                                                                                                                       | `src/integrations/assistant-integration/*`                                                                                                                    |
| `AI_FIX.md`                   | AI auto-heal ("Fix this") flow for failing interactive steps — event contract, patch schema, confidence gate, `enableAiAutoHeal` opt-in                                                                                                                     | `src/integrations/assistant-integration/ai-fix-*`, `src/components/docs-panel/AiFixOrchestrator.tsx`, `src/components/interactive-tutorial/ai-fix-button.tsx` |

## Security, review, and testing

| File                       | When to load                                                                                                | Auto-triggered by globs                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `frontend-security.mdc`    | Frontend security (from security team)                                                                      | `*.ts`, `*.tsx`, `*.js`, `*.jsx`                         |
| `react-antipatterns.mdc`   | PR reviews (on hit), hooks/effects/state                                                                    | --                                                       |
| `testingStrategy.mdc`      | Writing or reviewing tests                                                                                  | `*.test.ts`, `*.test.tsx`, `jest.config*`, `jest.setup*` |
| `docs/design/PR_REVIEW.md` | PR review standards: pattern catalog (R1-R21, F1-F6, QC1-QC7, G1-G7), reviewer schema, comment prefixes     | --                                                       |
| `E2E_TESTING_CONTRACT.md`  | E2E testing, `data-test-*` attributes                                                                       | --                                                       |
| `E2E_TESTING.md`           | E2E guide test runner: CLI reference, options, troubleshooting, error classification, environment variables | --                                                       |

## Release, flags, and CI

| File                    | When to load                                                                                                                                      | Auto-triggered by globs                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `RELEASE_PROCESS.md`    | Releasing, deploying, versioning                                                                                                                  | --                                                             |
| `FEATURE_FLAGS.md`      | Feature flags, A/B experiments                                                                                                                    | `openfeature.ts`                                               |
| `EXPERIMENT_TESTING.md` | Manual experiment override recipes (DevTools `__pathfinderExperiment.setOverride`), reset snippets, per-arm test scenarios, analytics dedup notes | `src/utils/experiments/*`, `src/utils/openfeature-tracking.ts` |

## CLI and MCP

| File            | When to load                                                                                                                | Auto-triggered by globs |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `CLI_TOOLS.md`  | CLI validation, guide authoring tooling                                                                                     | `src/cli/*`             |
| `MCP_SERVER.md` | Pathfinder authoring MCP server (`pathfinder-cli mcp`) — tools, transports (stdio/HTTP), how to add a tool, deploy artifact | `src/cli/mcp/*`         |

## Dev mode, local dev, live sessions

| File                       | When to load                                                                                          | Auto-triggered by globs                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `DEV_MODE.md`              | Dev mode configuration and debugging tools                                                            | `src/utils/dev-mode.ts`                                                   |
| `LOCAL_DEV.md`             | Local development setup, prerequisites, Docker workflow                                               | --                                                                        |
| `LIVE_SESSIONS.md`         | Live sessions feature (WebRTC, PeerJS)                                                                | `src/components/LiveSession/*`                                            |
| `KNOWN_ISSUES.md`          | Known bugs and workarounds                                                                            | --                                                                        |
| `integrations/workshop.md` | Workshop mode, action capture and replay                                                              | `src/integrations/workshop/*`                                             |
| `CROSS_TAB_CONTROLLER.md`  | Two-tab interactive controller — a popped-out guide drives the live Grafana tab over BroadcastChannel | `src/integrations/cross-tab/*`, `src/global-state/controller-channel.tsx` |
| `SCALE_TESTING.md`         | Live session scale testing procedures                                                                 | --                                                                        |

## Subsystem references

| File                       | When to load                                                                                                                                                                                    | Auto-triggered by globs         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `utils/README.md`          | Utility directory layout, remaining hooks, timeout manager                                                                                                                                      | `src/utils/*`                   |
| `constants/README.md`      | Selector constants, interactive config, z-index management                                                                                                                                      | `src/constants/*`               |
| `learning-paths/README.md` | Learning paths, badges, streaks, progress tracking                                                                                                                                              | `src/learning-paths/*`          |
| `package-authoring.md`     | Package authoring (two-file model, content.json/manifest.json, directory structure)                                                                                                             | --                              |
| `CUSTOM_GUIDES.md`         | Custom guides authored in the block editor — lifecycle (draft/published), creating, editing, publishing, unpublishing, and the guide library                                                    | `src/components/block-editor/*` |
| `EXTERNAL_API.md`          | External (CI / Terraform / scripts) guide-import API. The Pathfinder Backend's K8s aggregator is callable directly with a Grafana SA token; companion bash helper at `scripts/upsert-guide.sh`. | `scripts/upsert-guide.sh`       |

## Refactoring and tech debt

| File                                   | When to load                                                                                                                                                                                                                     | Auto-triggered by globs |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| ESLint config + `architecture.test.ts` | Refactoring or reducing technical debt. The repo mechanically enforces rules via ESLint and `src/validation/architecture.test.ts`; their exclusions (`// eslint-disable`, test exceptions) serve as a map to existing tech debt. | --                      |

## Go backend

| File               | When to load                                            | Auto-triggered by globs                                                                           |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `go.mod`, `go.sum` | Go backend dependencies, version updates                | `pkg/**/*.go`                                                                                     |
| `magefile.go`      | Go build tasks (mage targets)                           | `pkg/**/*.go`                                                                                     |
| `coda.mdc`         | Coda VM system, terminal integration, backend SSH/relay | `src/integrations/coda/*`, `pkg/plugin/coda.go`, `pkg/plugin/stream.go`, `pkg/plugin/terminal.go` |
| `CODA.md`          | Coda VM system, terminal integration (comprehensive)    | `src/integrations/coda/*`, `pkg/plugin/coda.go`, `pkg/plugin/stream.go`                           |

## History and onboarding

| File                                | When to load                                                                                                                                                                                                              | Auto-triggered by globs |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `docs/history/`                     | Historical implementation records for completed epics — key decisions, artifacts, and rationale. Read when you need the full context of past design choices (e.g., why recommender-based resolution, not static catalog). | --                      |
| `docs/developer/GETTING_STARTED.md` | First-week onboarding for new developers — prerequisites, IDE setup, troubleshooting                                                                                                                                      | --                      |
| `docs/developer/bugfix-patterns.md` | Common bug-fix patterns observed across the codebase (companion to the `bugfix` skill)                                                                                                                                    | --                      |

## AI-authoring design docs

| File                                          | When to load                                                                                                                                       | Auto-triggered by globs                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `docs/design/PATHFINDER-AI-AUTHORING.md`      | Top-level AI-authoring design — read first before any AI-authoring task. Design intent (may not match implementation).                             | `src/cli/*`, `src/components/block-editor/*`          |
| `docs/design/AGENT-AUTHORING.md`              | Authoring CLI design: schema-driven help, validate-on-write, idempotent retries, agent-oriented output. Design intent.                             | `src/cli/commands/*`                                  |
| `docs/design/HOSTED-AUTHORING-MCP.md`         | TS MCP server design — validation strategy, stdio/HTTP transports, auth. Pair with `MCP_SERVER.md` for implementation reality.                     | `src/cli/mcp/*`                                       |
| `docs/design/AUTHORING-SESSION-ARTIFACTS.md`  | Stateless artifact-as-wire-state model for MCP tool contracts (validate-on-write, idempotency). Design intent.                                     | `src/cli/mcp/*`                                       |
| `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md` | App Platform publish payload shape, draft vs published, `localExport` fallback. Design intent.                                                     | `src/cli/mcp/*`, `src/components/block-editor/*`      |
| `docs/design/VIEWER-DEEP-LINK-CONTRACT.md`    | Viewer deep link format (`doc=api:<id>`), panel-mode contract, resource name stability. Design intent.                                             | `src/components/docs-panel/*`                         |
| `docs/design/CLIENT-ORCHESTRATION-GUIDE.md`   | How AI clients use the MCP service — workflow, confirmation, publish-path selection. Design intent.                                                | `src/integrations/assistant-integration/*`            |
| `docs/design/PATHFINDER-PACKAGE-DESIGN.md`    | Package model: two-file structure, manifest metadata, dependencies, repository structure. Canonical spec for `package-engine` and CLI tooling.     | `src/types/package.schema.ts`, `src/package-engine/*` |
| `docs/design/TESTING_STRATEGY.md`             | E2E testing strategy with 4-layer model, test-environment routing, manifest metadata requirements. Pair with `E2E_TESTING.md` for runtime details. | `src/types/package.schema.ts`                         |
| `docs/design/phases/*.md`                     | Phase-specific implementation plans for AI authoring (P0–P6)                                                                                       | --                                                    |

## Doc-quality and release skills

| File                                        | When to load                                                                                                                                                                                                     | Auto-triggered by globs |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `.cursor/skills/review/SKILL.md`            | **Skill** — `/review` orchestration. Six-phase workflow: read concern registry, classify, route, run reviewers, synthesize, doc-drift check. Grounds findings in `docs/design/PR_REVIEW.md`.                     | --                      |
| `.cursor/skills/prevent-doc-drift/SKILL.md` | **Skill** — runs on `/review` or before merge. Detects new features / architecture changes in a PR and produces the AGENTS.md / CLAUDE.md / `.cursor/rules/` updates needed in the same PR to prevent drift.     | --                      |
| `.cursor/skills/maintain-docs/SKILL.md`     | **Skill** — periodic doc-maintenance audit (orphans, drift, staleness). Complementary to `prevent-doc-drift`: runs across the whole repo on a schedule rather than per-PR.                                       | --                      |
| `.cursor/skills/changelog/SKILL.md`         | **Skill** — drafts CHANGELOG entries from merged PRs since the last release tag. Categorizes by conventional-commit prefix and rewrites titles into sentence-case narrative bullets. Called by `release-prep`.   | --                      |
| `.cursor/skills/release-prep/SKILL.md`      | **Skill** — orchestrates the pre-release flow (bump version + draft changelog + `npm run check` + build). Never creates or pushes the git tag; prints the exact command for the user to run.                     | --                      |
| `.cursor/skills/pr-summary/SKILL.md`        | **Skill** — drafts a structured PR description (Summary / What changed / Why / Test plan / Risk) from the diff using `CONCERNS.md` routing. Pairs with `/review` (drafts vs reviews).                            | --                      |
| `.cursor/skills/secure/SKILL.md`            | **Skill** — security audit. F1-F6 frontend rules, backend URL allowlists + token handling + hardcoded-secret scan, MCP transport caps, dependency advisories. Report-only with concrete remediation per finding. | --                      |
| `.cursor/skills/i18n-sync/SKILL.md`         | **Skill** — detect translation gaps across 21 locales. Stubs missing keys with empty values (matching the runtime fallback to en-US) and emits a per-locale gap report. Never invents translations.              | --                      |
