# On-demand context index

Load these files **only when working in the relevant domain**.

**Cross-tool behavior — important.** In **Cursor**, many `.cursor/rules/*.mdc` files auto-load via `globs:` / `alwaysApply:` frontmatter. In **Claude Code**, that frontmatter is inert — `.mdc` files are discoverable but not auto-loaded; load them by name when working in the relevant domain (typically because another file like `docs/design/PR_REVIEW.md` or a skill cites them). A rule's `globs:` frontmatter records its intended scope.

`.mdc` files live in `.cursor/rules/`. Developer-facing references (`*.md`) live under `docs/developer/`. Design docs live under `docs/design/` — these capture **design intent** and may not match implemented reality; verify against the code before acting on them. Skills live under `.cursor/skills/<name>/SKILL.md`.

## Architecture and project context

- `projectbrief.mdc` — Understanding project scope and goals
- `techContext.mdc` — Tech stack, dependencies, build system
- `systemPatterns.mdc` — Architecture, component relationships, per-subsystem entry points and key files
- `docs/design/CONCERNS.md` — Compact PR review routing, impact analysis, and change risk classification
- `docs/design/CONCERN_DETAILS.md` — Design intent (may not match implementation); review guidance, one-way doors, and contract anchors; extract only the activated concern with the review skill's script

## Interactive tutorial / guide authoring

- `interactiveRequirements.mdc` — Interactive tutorial system work
- `STEP_MODEL.md` — End-to-end model for step completion — store ownership (`global-state/completion-store.ts`), reset paths, stable step IDs (`global-state/step-id.ts`), section-completed gate, FSM ↔ store bridge. Load when touching completion, reset, or stable-ID code.
- `tracked-step-types.mdc` — Adding, renaming, or removing an interactive step component type. Lists the 4-site registry (`STEP_TYPE_SCHEMAS` + `INTERACTIVE_STEP_COMPONENT_TYPES` + `COMPLETION_AFFORDANCE_BLOCK_TYPES` + `resolveStepIdForBlock`) that must stay in sync.
- `schema-coupling.mdc` — JSON guide / snippet types or schemas
- `interactive-examples/*.md` — Authoring interactive guides (format, types, selectors)
- `engines/*.md` — Engine subsystem internals (context, interactive, requirements)
- `ASSISTANT_INTEGRATION.md` — Authoring customizable content with `<assistant>` tag
- `AI_FIX.md` — AI auto-heal ("Fix this") flow for failing interactive steps — event contract, patch schema, confidence gate, `enableAiAutoHeal` on by default

## Security, review, and testing

- `frontend-security.mdc` — Frontend security (from security team)
- `react-antipatterns.mdc` — PR reviews (on hit), hooks/effects/state. An index — routes each R-code to a themed file holding the detail
- `testingStrategy.mdc` — Writing or reviewing tests
- `docs/design/PR_REVIEW.md` — PR review standards: pattern catalog (R1-R21, F1-F6, QC1-QC7, G1-G7), reviewer and evolution-packet schemas, comment prefixes, and the final `ReviewReport` schema the renderer consumes
- `E2E_TESTING_CONTRACT.md` — E2E testing, `data-test-*` attributes
- `E2E_TESTING.md` — E2E guide test runner: CLI reference, package-aware testing (guides, paths/journeys), milestone expansion and dependency planning, report selection metadata, options, troubleshooting, error classification, environment variables
- `COMPLETION_RECORDS_CLOUD_CHECKLIST.md` — Manual operator checklist for the completion-records cloud round trip: capability preflight, durable record, retry idempotency, whole-path threshold. Deliberately not automated

## Release, flags, and CI

- `RELEASE_PROCESS.md` — Releasing, deploying, versioning
- `FEATURE_FLAGS.md` — Feature flags, A/B experiments
- `EXPERIMENT_TESTING.md` — Feature-control recipes, reset snippets, per-arm test scenarios, analytics dedup notes
- `KNOWN_GOTCHAS.md` — A red check that may not be your branch's fault: worktree typecheck, tool-version skew, the Go shuffle race, the advisory e2e matrix, known CI flakes

## CLI and MCP

- `CLI_TOOLS.md` — CLI validation, guide authoring tooling
- `MCP_SERVER.md` — Pathfinder authoring MCP server (`pathfinder-cli mcp`) — tools, transports (stdio/HTTP), how to add a tool, deploy artifact
- `AGENT-AUTHORING.md` (design) — Shared CLI/MCP command contract: `CommandSpec`/Zod as sole authority for input shape, Commander and MCP as renderers over it, bind/withhold rules

## Dev mode, local dev, live sessions

- `DEV_MODE.md` — Dev mode configuration and debugging tools
- `LOCAL_DEV.md` — Local development setup, prerequisites, Docker workflow
- `GRAFT_TESTING.md` — Testing the local build against a live Grafana Cloud stack via Graft (internal, Grafanista-only) instead of the Docker `npm run server` flow
- `LIVE_SESSIONS.md` — Live sessions feature (WebRTC, PeerJS)
- `KNOWN_ISSUES.md` — Known bugs and workarounds
- `integrations/workshop.md` — Workshop mode, action capture and replay
- `CROSS_TAB_CONTROLLER.md` — Two-tab interactive controller — a popped-out guide drives the live Grafana tab over BroadcastChannel
- `SCALE_TESTING.md` — Live session scale testing procedures

## Subsystem references

- `utils/README.md` — Utility directory layout, remaining hooks, timeout manager
- `constants/README.md` — Selector constants, interactive config, z-index management
- `learning-paths/README.md` — Learning paths, badges, streaks, progress tracking
- `package-authoring.md` — Package authoring (two-file model, content.json/manifest.json, directory structure)
- `CUSTOM_GUIDES.md` — Custom guides authored in the block editor — lifecycle (draft/published), creating, editing, publishing, unpublishing, and the guide library
- `EXTERNAL_API.md` — External (CI / Terraform / scripts) guide-import API. The Pathfinder Backend's K8s aggregator is callable directly with a Grafana SA token; companion bash helpers at `scripts/upsert-guide.sh` (one guide) and `scripts/upsert-learning-path.sh` (a path/journey package, including `spec.manifest`).
- `TERRAFORM.md` — Provisioning private guides with Terraform via `grafana_apps_generic_resource`: worked example, path/journey ordering with `depends_on`, what "covered by the CRD shape" means (pruned block fields become a non-converging plan), and the RBAC / per-stack-enablement gaps that remain.
- `TELEMETRY.md` — Faro + RudderStack telemetry: what a new feature gets for free vs when to add custom facade ops, privacy invariants, gating. Load when touching telemetry code or instrumenting a feature.
- `.cursor/rules/systemPatterns.mdc` (completion-records section) — Durable completion records: the single recorder boundary, surface-neutral emission (`recordGuideCompletionForSurface`), the retry queue (lease, idempotency key, retention, drain budget), identity keying, and the write contract shared with backend PR #1433. Load when touching completion recording or the write path.

## Refactoring and tech debt

- ESLint config + `architecture.test.ts` — Refactoring or reducing technical debt. The repo mechanically enforces rules via ESLint and `src/validation/architecture.test.ts`; their exclusions (`// eslint-disable`, test exceptions) serve as a map to existing tech debt.

## Go backend

- `go.mod`, `go.sum` — Go backend dependencies, version updates
- `magefile.go` — Go build tasks (mage targets)
- `coda.mdc` — Coda terminal integration — the client side of the `grafana-coda-app` v1 API
- `CODA.md` — Coda terminal integration (comprehensive). Backend contract lives in the `grafana-coda-app` repo's `docs/API.md`
- `docs/design/BACKEND_PROXY_PATTERN.md` — Canonical pattern for plugin-backend proxies to the App Platform aggregator: inbound ID-token verification and namespace binding, outbound OBO access-token minting, caching, pagination, failure semantics, capability envelopes, the Go ⇄ TypeScript contract goldens (§10), and the POST-create write variant (§11)

## History and onboarding

- `docs/history/` — Historical implementation records for completed epics — key decisions, artifacts, and rationale. Read when you need the full context of past design choices (e.g., why recommender-based resolution, not static catalog).
- `docs/developer/GETTING_STARTED.md` — First-week onboarding for new developers — prerequisites, IDE setup, troubleshooting
- `docs/developer/bugfix-patterns.md` — Common bug-fix patterns observed across the codebase (companion to the `bugfix` skill)

## AI-authoring design docs

- `docs/design/PATHFINDER-AI-AUTHORING.md` — Top-level AI-authoring design — read first before any AI-authoring task. Design intent (may not match implementation).
- `docs/design/AGENT-AUTHORING.md` — Authoring CLI design: schema-driven help, validate-on-write, idempotent retries, agent-oriented output. Design intent.
- `docs/design/HOSTED-AUTHORING-MCP.md` — TS MCP server design — validation strategy, stdio/HTTP transports, auth. Pair with `MCP_SERVER.md` for implementation reality.
- `docs/design/AUTHORING-SESSION-ARTIFACTS.md` — Stateless artifact-as-wire-state model for MCP tool contracts (validate-on-write, idempotency). Design intent.
- `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md` — App Platform publish payload shape, draft vs published, `localExport` fallback. Design intent.
- `docs/design/VIEWER-DEEP-LINK-CONTRACT.md` — Viewer deep link format (`doc=api:<id>`), panel-mode contract, resource name stability. Design intent.
- `docs/design/PANEL-MODE-PERSISTENCE.md` — Panel-mode persistence contract: current surface vs persisted preference, the three mutators, decisions 2 & 3, and why `setMode` stays conditional. Load before touching surface/persistence logic.
- `docs/design/COMPLETION-MODEL.md` — Completion model design rationale: guide/path/journey percentage formulas, the path-member content-key join and its exclusion rule (decision 9 — the join ships, its rollup consumer does not yet), the unconditional mark-complete button, the rejected alternative, and the falsifiable bets each decision rests on. Load before changing completion arithmetic or path aggregation.
- `docs/design/CLIENT-ORCHESTRATION-GUIDE.md` — How AI clients use the MCP service — workflow, confirmation, publish-path selection. Design intent.
- `docs/design/PATHFINDER-PACKAGE-DESIGN.md` — Package model: two-file structure, manifest metadata, dependencies, repository structure. Canonical spec for `package-engine` and CLI tooling.
- `docs/design/phases/*.md` — Phase-specific implementation plans for AI authoring (P0–P6)

## Skills

Skills are not enumerated here, and no file enumerates them. Bodies live in `.cursor/skills/<name>/SKILL.md`; each has a committed pointer stub at `.claude/skills/<name>/SKILL.md` so Claude Code's skill loader surfaces the `name` + `description` frontmatter automatically and loads the body only when the skill runs. That frontmatter is the single source of truth for all harnesses. `src/validation/skill-references.test.ts` asserts the two directories stay in lockstep. Read a skill's `SKILL.md` before running it.
