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

### Writing style

All UI text and documentation follows **sentence case** per the [Grafana Writers' Toolkit](https://grafana.com/docs/writers-toolkit/write/style-guide/capitalization-punctuation/#capitalization).

- **Capitalize only the first word** and proper nouns (product names, company names)
- **Do NOT use title case** for headings, button labels, menu items, or other UI elements
- Proper nouns to capitalize: **Grafana**, **Loki**, **Prometheus**, **Tempo**, **Mimir**, **Alloy**, **Grafana Cloud**, **Grafana Enterprise**, **Grafana Labs**
- Generic terms stay lowercase: dashboard, alert, data source, panel, query, plugin

### File creation policy

Do NOT create summary `.md` files unless explicitly requested by the user. No `IMPLEMENTATION_SUMMARY.md`, no `CLEANUP_SUMMARY.md`, no proactive documentation files. Communicate all summaries and completion status directly in chat responses.

### Slash commands

| Command   | Role                 | Behavior                                                                                                                                                                           |
| --------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/review` | Code reviewer        | Precision and respect. Focus on clarity, correctness, maintainability. Highlight naming issues, duplication, hidden complexity, poor abstractions. Actionable, concise, kind.      |
| `/secure` | Security analyst     | Think like an attacker. Inspect for vulnerabilities, unsafe patterns, injection risks, secrets in code, insecure dependencies. Explain risk clearly, provide concrete remediation. |
| `/test`   | Test writer          | Tests that enable change. Prioritize unit tests, edge cases, failure modes. Property-based tests when useful. Avoid mocking unless necessary. Fast, isolated, reliable.            |
| `/docs`   | Documentation writer | Write for humans first. Document purpose, parameters, return values. Small useful examples. Standard docstring style. Avoid unnecessary words.                                     |

## Local development commands

### Initial setup

```bash
# Install dependencies (requires Node.js 22+)
npm install

# Type check
npm run typecheck
```

### Development workflow

```bash
# Start development server with watch mode
npm run dev

# Run Grafana locally with Docker
npm run server

# Run all tests (CI mode - agents should use this)
npm run test:ci

# Run tests in watch mode (for local development)
npm test

# Run tests with coverage
npm run test:coverage
```

### Code quality

```bash
# Lint code
npm run lint

# Lint and auto-fix
npm run lint:fix

# Format code with Prettier
npm run prettier

# Check formatting
npm run prettier-test

# Lint Go code
npm run lint:go
```

### Building and testing

```bash
# Production build (frontend only)
npm run build

# Build Go backend (Linux)
npm run build:backend

# Build everything (frontend + backend for Linux/ARM64)
npm run build:all

# Run frontend tests
npm run test:ci

# Run Go tests
npm run test:go

# Run end-to-end tests
npm run e2e

# Sign plugin for distribution
npm run sign
```

### Go backend development

```bash
# Build backend for current platform
mage build:darwin      # macOS Intel
mage build:darwinARM64 # macOS Apple Silicon
mage build:linux       # Linux x64
mage build:linuxARM64  # Linux ARM64
mage build:windows     # Windows

# Run Go tests
mage test

# Lint Go code
mage lint
```

### Additional per-platform backend builds

```bash
npm run build:backend:darwin-arm64
npm run build:backend:linux-arm64
npm run build:backend:windows
```

### Guide authoring and validation

```bash
# Validate guides + packages
npm run validate            # validate all bundled guides
npm run validate:strict     # strict mode (no unknown fields)
npm run validate:packages   # validate package manifests

# Bundled-interactives repository
npm run repository:build    # regenerate index.json + content snapshots
npm run repository:check    # validate repository integrity

# JSON guide schema export
npm run schema:export       # export schema to dist/

# Terms-and-conditions sync
npm run docs:sync-terms        # sync TERMS_VERSION across docs/
npm run docs:sync-terms:check  # CI drift check for terms
```

### Additional dev tools

```bash
# Internationalization
npm run i18n-extract           # extract translatable strings into locales/

# Live sessions / WebRTC signaling
npm run peerjs-server          # start local PeerJS signaling server

# Coverage in watch mode
npm run test:coverage:watch
```

### Development server

The development server runs Grafana OSS in Docker with the plugin mounted. After running `npm run server`, access:

- **Grafana UI**: http://localhost:3000
- **Default credentials**: admin/admin

## Code organization

### Frontend (src/)

```
src/
├── bundled-interactives/  # Bundled JSON guides + repository.json index for offline fallback
├── cli/                   # Authoring CLI (validate / create / e2e / repository) + TypeScript MCP server under src/cli/mcp/
├── components/            # React + Scenes UI: DocsPanel, Home, interactive-tutorial, LiveSession, block-editor, floating-panel, full-screen, kiosk
├── constants/             # Glob-scoped constants (testIds, selectors, interactive-config, z-index); root barrel src/constants.ts re-exports defaults
├── context-engine/        # Tier-1 engine: detects Grafana context, calls recommender API, fetches recommendations
├── docs-retrieval/        # Tier-1 engine: multi-strategy content fetcher, JSON/HTML parsers, ContentRenderer, journey-completion helpers
├── global-state/          # Cross-component stores: sidebar, panel-mode, link-interception, interactive-navigation, alignment-pending
├── hooks/                 # Cross-cutting hooks: usePendingGuideLaunch, useAlignmentReevaluation
├── img/                   # Static SVG/PNG assets
├── integrations/          # Optional integrations: assistant-integration (<assistant> tags), coda terminal, workshop mode
├── interactive-engine/    # Tier-1 engine: executes step actions, auto-completion, navigation manager, state machine
├── learning-paths/        # Tier-1 engine: progress tracking, badges, streaks, next-action recommender, per-platform path data
├── lib/                   # Shared utilities: analytics, user-storage, dom selector pipeline, async, hash, package-recommendations-client
├── locales/               # i18n translation files (en-US, de-DE, fr-FR, es-ES, cs-CZ, etc.)
├── package-engine/        # Tier-1 engine: package resolution. Composite resolver chain: bundled → online CDN → recommender API
├── pages/                 # Grafana Scenes page definitions (homePage, docsPage)
├── recovery/              # Auto-recovery: alignment evaluation, starting-location resolution, launch-source classification
├── requirements-manager/  # Tier-1 engine: prereqs / postconditions, step state machine, fix-registry, user-friendly explanations
├── security/              # URL allowlists, HTML/log sanitization (DOMPurify), domain whitelisting
├── styles/                # Theme-aware CSS-in-JS (Emotion), Prism syntax highlighting
├── test-utils/            # Shared test helpers + OpenFeature mocks
├── types/                 # Tier-0: centralized TypeScript types imported by every other subsystem
├── utils/                 # Hooks/utilities: dev-mode, openfeature, timeout-manager, variable-substitution, experiments, find-doc-page
└── validation/            # Zod schemas + condition validators; architecture.test.ts enforces tier rules
```

### Backend (pkg/)

```
pkg/
├── main.go                # Plugin entrypoint — calls app.Manage with plugin.NewApp factory
└── plugin/
    ├── app.go                       # App struct, lifecycle, CodaClient init, stream-session + user-VM caches
    ├── resources.go                 # HTTP resource handlers: /vms, /sample-apps, /alloy-scenarios, /mcp, /package-recommendations, /coda/register, /health
    ├── settings.go                  # Parses JSONData + decrypts SecureJSONData (CodaAPIURL, CodaRelayURL, EnrollmentKey, RefreshToken)
    ├── stream.go                    # Grafana Live SubscribeStream/PublishStream/RunStream — 3-tier VM resolution, SSH retry (3x), heartbeat (3s), VM expiry poll (15s)
    ├── terminal.go                  # TerminalSession: SSH over WebSocket relay, PTY, stdin/stdout/stderr pipes, private-key normalization
    ├── coda.go                      # CodaClient: JWT auth, VM CRUD, quota enforcement (max 3/user), token refresh with RWMutex
    ├── mcp.go                       # Hosts only `launch_guide` + the per-instance pending-launch queue (consumed by src/hooks/usePendingGuideLaunch.ts). All other MCP authoring tools live in src/cli/mcp/ (see MH4).
    ├── package_recommendations.go   # CDN package index cache (6h TTL, single-flight, 8-way parallel manifest fetch, bounded memory)
    ├── static.go                    # embed.FS declaration for per-guide content.json files (used by launch_guide's existence check)
    └── wsconn.go                    # WebSocket-as-net.Conn adapter for SSH-over-WebSocket relay tunnel
```

## Subsystem tiers and key relationships

The frontend follows a layered tier model. Imports flow **downward only** to avoid cycles. Cross-tier rules are enforced by ESLint and `src/validation/architecture.test.ts`; exceptions require an explicit allowlist entry with justification.

- **Tier 0 — Types & constants**: `types/`, `constants/`
- **Tier 1 — Engines & providers**: `context-engine/`, `docs-retrieval/`, `interactive-engine/`, `package-engine/`, `learning-paths/`, `requirements-manager/`, `recovery/`, `validation/`
- **Tier 2 — UI**: `components/`, `pages/`
- **Tier 3 — Support**: `lib/`, `security/`, `styles/`, `global-state/`, `integrations/`, `hooks/`, `utils/`, `test-utils/`, `bundled-interactives/`, `locales/`, `img/`, `cli/`

**Key dependency edges** (where the load-bearing wiring lives):

| Edge                                           | Why                                                            |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `context-engine` → `docs-retrieval`            | Fetches content for the recommendations it surfaces            |
| `docs-retrieval` → `bundled-interactives`      | Fallback when the online CDN is unavailable                    |
| `docs-retrieval` → `package-engine`            | Resolves package manifests + content                           |
| `components/docs-panel` → `interactive-engine` | Executes step actions when the user clicks "Show me" / "Do it" |
| `interactive-engine` → `requirements-manager`  | Checks prereqs before enabling / executing a step              |
| `interactive-engine` → `lib/dom`               | Selector resolution + element detection                        |
| `components/docs-panel` → `context-engine`     | Reads and renders recommendations                              |
| `components/docs-panel` → `global-state`       | Sidebar, panel-mode, tab persistence                           |
| `learning-paths` → `lib/user-storage`          | Persists progress + streak data                                |
| `recovery` → `requirements-manager`            | Decides whether a failed requirement is auto-recoverable       |

For per-subsystem entry points, public surfaces, and key files, load `.cursor/rules/systemPatterns.mdc`.

## Backend request paths (`pkg/`)

The Go backend is a thin bridge between the React frontend and the **Coda VM provisioning service**. No database — all state is ephemeral or delegated to Coda.

**Three primary request paths:**

1. **HTTP resource API** (`resources.go`) — REST for VM lifecycle and metadata. Routes:
   - `POST /vms`, `GET /vms`, `GET /vms/{id}`, `DELETE /vms/{id}` — VM CRUD via `CodaClient`
   - `GET /sample-apps`, `GET /alloy-scenarios` — catalog metadata
   - `GET /package-recommendations` — cached CDN package index
   - `POST /coda/register` — exchange enrollment key for tokens
   - `POST /mcp` (JSON-RPC, single tool: `launch_guide`), `GET|POST /mcp/pending-launch` — in-process per-instance launch queue; all other MCP authoring tools live in `src/cli/mcp/`
   - All external URLs pass `isAllowedCodaURL` / `IsAllowedRelayURL` allowlists.

2. **Streaming terminal** (`stream.go` + `terminal.go` + `wsconn.go`) — Grafana Live bidirectional channels.
   - Channel path: `terminal/{vmId}/{nonce}/{template?}/{app_or_scenario?}`
   - `SubscribeStream` authorizes; `RunStream` resolves the VM (3-tier cache: in-memory `userVMs` → `ListVMs` → `CreateVM`), waits for `state=active`, opens SSH via WebSocket relay (`ConnectSSHViaRelay`), then starts heartbeat (3s) and VM-expiry poll (15s) goroutines.
   - `PublishStream` forwards keyboard input / resize from xterm.js into the SSH session.
   - SSH retry: 3 attempts with credential refresh on auth failures.
   - Stream message types: `output`, `error`, `connected`, `disconnected`, `status`, `heartbeat`.

3. **Coda client** (`coda.go`) — JWT-authenticated REST. Token refresh under `RWMutex` (1-min cache buffer). Per-user VM quota: 3.

For the full SSH / relay / credential-refresh reference, load `docs/developer/CODA.md`. For agent-facing constraints (URL allowlists, retry contracts, what NOT to change), load `.cursor/rules/coda.mdc`.

## On-demand context

Load these files **only when working in the relevant domain**. Do not preload all of them.

| File                                          | When to load                                                                                                                                                                                                                     | Auto-triggered by globs                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `docs/design/CONCERNS.md`                     | PR review routing, impact analysis, change risk classification, one-way door analysis, subsystem-aware debugging                                                                                                                 | --                                                                                                                          |
| `projectbrief.mdc`                            | Understanding project scope and goals                                                                                                                                                                                            | --                                                                                                                          |
| `techContext.mdc`                             | Tech stack, dependencies, build system                                                                                                                                                                                           | --                                                                                                                          |
| `systemPatterns.mdc`                          | Architecture, component relationships                                                                                                                                                                                            | --                                                                                                                          |
| `interactiveRequirements.mdc`                 | Interactive tutorial system work                                                                                                                                                                                                 | --                                                                                                                          |
| `tracked-step-types.mdc`                      | Adding, renaming, or removing an interactive step component type. Lists the 4-site registry that must stay in sync (parse-string + React component identity layers).                                                             | `src/components/interactive-tutorial/*.tsx`, `src/docs-retrieval/content-renderer.tsx`, `src/docs-retrieval/json-parser.ts` |
| `frontend-security.mdc`                       | Frontend security (from security team)                                                                                                                                                                                           | `*.ts`, `*.tsx`, `*.js`, `*.jsx`                                                                                            |
| `react-antipatterns.mdc`                      | PR reviews (on hit), hooks/effects/state                                                                                                                                                                                         | --                                                                                                                          |
| `schema-coupling.mdc`                         | JSON guide types or schemas                                                                                                                                                                                                      | `json-guide.types.ts`, `json-guide.schema.ts`                                                                               |
| `testingStrategy.mdc`                         | Writing or reviewing tests                                                                                                                                                                                                       | `*.test.ts`, `*.test.tsx`, `jest.config*`, `jest.setup*`                                                                    |
| `pr-review.md`                                | PR review orchestration (`/review`)                                                                                                                                                                                              | --                                                                                                                          |
| `E2E_TESTING_CONTRACT.md`                     | E2E testing, `data-test-*` attributes                                                                                                                                                                                            | --                                                                                                                          |
| `RELEASE_PROCESS.md`                          | Releasing, deploying, versioning                                                                                                                                                                                                 | --                                                                                                                          |
| `FEATURE_FLAGS.md`                            | Feature flags, A/B experiments                                                                                                                                                                                                   | `openfeature.ts`                                                                                                            |
| `EXPERIMENT_TESTING.md`                       | Manual experiment override recipes (DevTools `__pathfinderExperiment.setOverride`), reset snippets, per-arm test scenarios, analytics dedup notes                                                                                | `src/utils/experiments/*`, `src/utils/openfeature-tracking.ts`                                                              |
| `CLI_TOOLS.md`                                | CLI validation, guide authoring tooling                                                                                                                                                                                          | `src/cli/*`                                                                                                                 |
| `MCP_SERVER.md`                               | Pathfinder authoring MCP server (`pathfinder-cli mcp`) — tools, transports (stdio/HTTP), how to add a tool, deploy artifact                                                                                                      | `src/cli/mcp/*`                                                                                                             |
| `interactive-examples/*.md`                   | Authoring interactive guides (format, types, selectors)                                                                                                                                                                          | --                                                                                                                          |
| `engines/*.md`                                | Engine subsystem internals (context, interactive, requirements)                                                                                                                                                                  | `src/context-engine/*`, `src/interactive-engine/*`, `src/requirements-manager/*`                                            |
| `ASSISTANT_INTEGRATION.md`                    | Authoring customizable content with `<assistant>` tag                                                                                                                                                                            | `src/integrations/assistant-integration/*`                                                                                  |
| `E2E_TESTING.md`                              | E2E guide test runner: CLI reference, options, troubleshooting, error classification, environment variables                                                                                                                      | --                                                                                                                          |
| `DEV_MODE.md`                                 | Dev mode configuration and debugging tools                                                                                                                                                                                       | `src/utils/dev-mode.ts`                                                                                                     |
| `LOCAL_DEV.md`                                | Local development setup, prerequisites, Docker workflow                                                                                                                                                                          | --                                                                                                                          |
| `LIVE_SESSIONS.md`                            | Live sessions feature (WebRTC, PeerJS)                                                                                                                                                                                           | `src/components/LiveSession/*`                                                                                              |
| `KNOWN_ISSUES.md`                             | Known bugs and workarounds                                                                                                                                                                                                       | --                                                                                                                          |
| `integrations/workshop.md`                    | Workshop mode, action capture and replay                                                                                                                                                                                         | `src/integrations/workshop/*`                                                                                               |
| `SCALE_TESTING.md`                            | Live session scale testing procedures                                                                                                                                                                                            | --                                                                                                                          |
| `utils/README.md`                             | Utility directory layout, remaining hooks, timeout manager                                                                                                                                                                       | `src/utils/*`                                                                                                               |
| `constants/README.md`                         | Selector constants, interactive config, z-index management                                                                                                                                                                       | `src/constants/*`                                                                                                           |
| `learning-paths/README.md`                    | Learning paths, badges, streaks, progress tracking                                                                                                                                                                               | `src/learning-paths/*`                                                                                                      |
| `package-authoring.md`                        | Package authoring (two-file model, content.json/manifest.json, directory structure)                                                                                                                                              | --                                                                                                                          |
| `CUSTOM_GUIDES.md`                            | Custom guides authored in the block editor — lifecycle (draft/published), creating, editing, publishing, unpublishing, and the guide library                                                                                     | `src/components/block-editor/*`                                                                                             |
| `EXTERNAL_API.md`                             | External (CI / Terraform / scripts) guide-import API. The Pathfinder Backend's K8s aggregator is callable directly with a Grafana SA token; companion bash helper at `scripts/upsert-guide.sh`.                                  | `scripts/upsert-guide.sh`                                                                                                   |
| ESLint config + `architecture.test.ts`        | Refactoring or reducing technical debt. The repo mechanically enforces rules via ESLint and `src/validation/architecture.test.ts`; their exclusions (`// eslint-disable`, test exceptions) serve as a map to existing tech debt. | --                                                                                                                          |
| `go.mod`, `go.sum`                            | Go backend dependencies, version updates                                                                                                                                                                                         | `pkg/**/*.go`                                                                                                               |
| `magefile.go`                                 | Go build tasks (mage targets)                                                                                                                                                                                                    | `pkg/**/*.go`                                                                                                               |
| `coda.mdc`                                    | Coda VM system, terminal integration, backend SSH/relay                                                                                                                                                                          | `src/integrations/coda/*`, `pkg/plugin/coda.go`, `pkg/plugin/stream.go`, `pkg/plugin/terminal.go`                           |
| `CODA.md`                                     | Coda VM system, terminal integration (comprehensive)                                                                                                                                                                             | `src/integrations/coda/*`, `pkg/plugin/coda.go`, `pkg/plugin/stream.go`                                                     |
| `docs/history/`                               | Historical implementation records for completed epics — key decisions, artifacts, and rationale. Read when you need the full context of past design choices (e.g., why recommender-based resolution, not static catalog).        | --                                                                                                                          |
| `docs/developer/GETTING_STARTED.md`           | First-week onboarding for new developers — prerequisites, IDE setup, troubleshooting                                                                                                                                             | --                                                                                                                          |
| `docs/developer/bugfix-patterns.md`           | Common bug-fix patterns observed across the codebase (companion to the `bugfix` skill)                                                                                                                                           | --                                                                                                                          |
| `docs/design/PATHFINDER-AI-AUTHORING.md`      | Top-level AI-authoring design — read first before any AI-authoring task. Design intent (may not match implementation).                                                                                                           | `src/cli/*`, `src/components/block-editor/*`                                                                                |
| `docs/design/AGENT-AUTHORING.md`              | Authoring CLI design: schema-driven help, validate-on-write, idempotent retries, agent-oriented output. Design intent.                                                                                                           | `src/cli/commands/*`                                                                                                        |
| `docs/design/HOSTED-AUTHORING-MCP.md`         | TS MCP server design — validation strategy, stdio/HTTP transports, auth. Pair with `MCP_SERVER.md` for implementation reality.                                                                                                   | `src/cli/mcp/*`                                                                                                             |
| `docs/design/AUTHORING-SESSION-ARTIFACTS.md`  | Stateless artifact-as-wire-state model for MCP tool contracts (validate-on-write, idempotency). Design intent.                                                                                                                   | `src/cli/mcp/*`                                                                                                             |
| `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md` | App Platform publish payload shape, draft vs published, `localExport` fallback. Design intent.                                                                                                                                   | `src/cli/mcp/*`, `src/components/block-editor/*`                                                                            |
| `docs/design/VIEWER-DEEP-LINK-CONTRACT.md`    | Viewer deep link format (`doc=api:<id>`), panel-mode contract, resource name stability. Design intent.                                                                                                                           | `src/components/docs-panel/*`                                                                                               |
| `docs/design/CLIENT-ORCHESTRATION-GUIDE.md`   | How AI clients use the MCP service — workflow, confirmation, publish-path selection. Design intent.                                                                                                                              | `src/integrations/assistant-integration/*`                                                                                  |
| `docs/design/PATHFINDER-PACKAGE-DESIGN.md`    | Package model: two-file structure, manifest metadata, dependencies, repository structure. Canonical spec for `package-engine` and CLI tooling.                                                                                   | `src/types/package.schema.ts`, `src/package-engine/*`                                                                       |
| `docs/design/TESTING_STRATEGY.md`             | E2E testing strategy with 4-layer model, test-environment routing, manifest metadata requirements. Pair with `E2E_TESTING.md` for runtime details.                                                                               | `src/types/package.schema.ts`                                                                                               |
| `docs/design/phases/*.md`                     | Phase-specific implementation plans for AI authoring (P0–P6)                                                                                                                                                                     | --                                                                                                                          |
| `.cursor/skills/prevent-doc-drift/SKILL.md`   | **Skill** — runs on `/review` or before merge. Detects new features / architecture changes in a PR and produces the AGENTS.md / CLAUDE.md / `.cursor/rules/` updates needed in the same PR to prevent drift.                     | --                                                                                                                          |
| `.cursor/skills/maintain-docs/SKILL.md`       | **Skill** — periodic doc-maintenance audit (orphans, drift, staleness). Complementary to `prevent-doc-drift`: runs across the whole repo on a schedule rather than per-PR.                                                       | --                                                                                                                          |
| `.cursor/skills/changelog/SKILL.md`           | **Skill** — drafts CHANGELOG entries from merged PRs since the last release tag. Categorizes by conventional-commit prefix and rewrites titles into sentence-case narrative bullets. Called by `release-prep`.                   | --                                                                                                                          |
| `.cursor/skills/release-prep/SKILL.md`        | **Skill** — orchestrates the pre-release flow (bump version + draft changelog + `npm run check` + build). Never creates or pushes the git tag; prints the exact command for the user to run.                                     | --                                                                                                                          |
| `.cursor/skills/pr-summary/SKILL.md`          | **Skill** — drafts a structured PR description (Summary / What changed / Why / Test plan / Risk) from the diff using `CONCERNS.md` routing. Pairs with `/review` (drafts vs reviews).                                            | --                                                                                                                          |
| `.cursor/skills/secure/SKILL.md`              | **Skill** — security audit. F1-F6 frontend rules, backend URL allowlists + token handling + hardcoded-secret scan, MCP transport caps, dependency advisories. Report-only with concrete remediation per finding.                 | --                                                                                                                          |
| `.cursor/skills/i18n-sync/SKILL.md`           | **Skill** — detect translation gaps across 21 locales. Stubs missing keys with empty values (matching the runtime fallback to en-US) and emits a per-locale gap report. Never invents translations.                              | --                                                                                                                          |

All `.mdc` files live in `.cursor/rules/`; `pr-review.md` is at `.cursor/rules/pr-review.md`. Developer-facing references (`*.md`) live under `docs/developer/`. Design docs live under `docs/design/` — these capture **design intent** and may not match implemented reality; verify against the code before acting on them. Skills live under `.cursor/skills/<name>/SKILL.md`.

## PR reviews

Two complementary documents drive review:

- **[`docs/design/CONCERNS.md`](docs/design/CONCERNS.md)** — concern routing backbone: classifies the change, activates subsystem reviewers, surfaces one-way doors, and provides per-subsystem review questions and verification steps.
- **[`.cursor/rules/pr-review.md`](.cursor/rules/pr-review.md)** — code-quality pattern detector: compact detection table for React anti-patterns R1-R21, security F1-F6, and quality heuristics QC1-QC7 with a pointer to the detailed reference file.

Load both for `/review`. Use CONCERNS.md alone for impact analysis, change risk classification, and subsystem-aware debugging.

**Tiered rule architecture:**

- **Tier 1 (glob-triggered on `*.ts`/`*.tsx`/`*.js`/`*.jsx`)**: `frontend-security.mdc` -- security rules F1-F6
- **Tier 1 (on `/review`)**: `docs/design/CONCERNS.md` + `pr-review.md` -- routing + pattern detection
- **Tier 2 (loaded on hit)**: `react-antipatterns.mdc` -- detailed Do/Don't for R1-R21 (includes hooks, state, performance, and SRE reliability patterns; also used by `/attack`)

**Go backend PRs:**

For PRs touching `pkg/**/*.go`, also verify:

- `npm run lint:go` passes
- `npm run test:go` passes
- `go build ./...` succeeds
- No new security issues (input validation, error handling, resource cleanup)

## `npx` examples

When generating `npx` examples of new potential CLIs and similar, these should all live under `pathfinder-cli@...`.
For example, for a hypothetical new package `pathfinder-example`, write `npx pathfinder-cli@... example` instead of `npx pathfinder-example`.
This ensures we don't get namesquatted.
