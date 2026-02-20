# Grafana Pathfinder - AI Agent Guide

## What is this project?

**Grafana Pathfinder** is a Grafana App Plugin that provides contextual, interactive documentation directly within the Grafana UI. It appears as a right-hand sidebar panel that displays personalized learning content, tutorials, and recommendations to help users learn Grafana products and configurations.

### Key features

- **Context-Aware Recommendations**: Automatically detects what you're doing in Grafana and suggests relevant documentation
- **Interactive Tutorials**: Step-by-step guides with "Show me" and "Do it" buttons that can automate actions in the Grafana UI
- **Tab-Based Interface**: Browser-like experience with multiple documentation tabs and localStorage persistence
- **Intelligent Content Delivery**: Multi-strategy content fetching with bundled fallbacks
- **Progressive Learning**: Tracks completion state and adapts to user experience level

### Target audience

Beginners and intermediate users who need to quickly learn Grafana products. Not intended for deep experts who primarily need reference documentation.

## Project architecture

This is a **React + TypeScript + Grafana Scenes** application built as a Grafana extension plugin. The architecture follows these key patterns:

- **Modular, Scene-Based Architecture**: Uses Grafana Scenes for state management
- **Hook-Based Business Logic**: Business logic extracted into focused React hooks
- **Interactive Tutorial System**: Sophisticated requirement checking and automated action execution
- **Functional-First Code Style**: Pragmatic functional programming approach with immutable data and pure functions

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
```

### Building and testing

```bash
# Production build
npm run build

# Run end-to-end tests
npm run e2e

# Sign plugin for distribution
npm run sign
```

### Development server

The development server runs Grafana OSS in Docker with the plugin mounted. After running `npm run server`, access:

- **Grafana UI**: http://localhost:3000
- **Default credentials**: admin/admin

## Code organization

```
src/
├── bundled-interactives/  # Bundled JSON guide files (fallback content)
├── cli/                   # CLI tools for guide validation and authoring
├── components/            # React and Scenes UI components
├── constants/             # Configuration, selectors, z-index management
├── context-engine/        # Detects user context and recommends content
├── docs-retrieval/        # Content fetching and rendering pipeline
├── global-state/          # App-wide state (sidebar, link interception)
├── img/                   # Static image assets
├── integrations/          # Assistant integration, workshop mode
├── interactive-engine/    # Executes interactive tutorial actions
├── learning-paths/        # Learning paths, badges, streak tracking
├── lib/                   # Shared utilities (analytics, async, DOM helpers)
├── locales/               # Internationalization translations
├── pages/                 # Grafana Scenes page definitions and routing
├── requirements-manager/  # Checks prerequisites for interactive steps
├── security/              # HTML/log sanitization and security utilities
├── styles/                # Theme-aware CSS-in-JS styling
├── test-utils/            # Shared test helpers and fixtures
├── types/                 # TypeScript type definitions
├── utils/                 # Business logic hooks and utility functions
└── validation/            # Guide and condition validation logic
```

## On-demand context

Load these files **only when working in the relevant domain**. Do not preload all of them.

| File                          | When to load                                                    | Auto-triggered by globs                                                          |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `projectbrief.mdc`            | Understanding project scope and goals                           | --                                                                               |
| `techContext.mdc`             | Tech stack, dependencies, build system                          | --                                                                               |
| `systemPatterns.mdc`          | Architecture, component relationships                           | --                                                                               |
| `interactiveRequirements.mdc` | Interactive tutorial system work                                | --                                                                               |
| `frontend-security.mdc`       | Frontend security (from security team)                          | `*.ts`, `*.tsx`, `*.js`, `*.jsx`                                                 |
| `react-antipatterns.mdc`      | PR reviews (on hit), hooks/effects/state                        | --                                                                               |
| `schema-coupling.mdc`         | JSON guide types or schemas                                     | `json-guide.types.ts`, `json-guide.schema.ts`                                    |
| `testingStrategy.mdc`         | Writing or reviewing tests                                      | `*.test.ts`, `*.test.tsx`, `jest.config*`, `jest.setup*`                         |
| `pr-review.md`                | PR review orchestration (`/review`)                             | --                                                                               |
| `E2E_TESTING_CONTRACT.md`     | E2E testing, `data-test-*` attributes                           | --                                                                               |
| `RELEASE_PROCESS.md`          | Releasing, deploying, versioning                                | --                                                                               |
| `FEATURE_FLAGS.md`            | Feature flags, A/B experiments                                  | `openfeature.ts`                                                                 |
| `CLI_TOOLS.md`                | CLI validation, guide authoring tooling                         | `src/cli/*`                                                                      |
| `interactive-examples/*.md`   | Authoring interactive guides (format, types, selectors)         | --                                                                               |
| `engines/*.md`                | Engine subsystem internals (context, interactive, requirements) | `src/context-engine/*`, `src/interactive-engine/*`, `src/requirements-manager/*` |
| `ASSISTANT_INTEGRATION.md`    | Authoring customizable content with `<assistant>` tag           | `src/integrations/assistant-integration/*`                                       |
| `E2E_TESTING.md`              | E2E guide test runner, Playwright-based guide verification      | --                                                                               |
| `DEV_MODE.md`                 | Dev mode configuration and debugging tools                      | `src/utils/dev-mode.ts`                                                          |
| `LOCAL_DEV.md`                | Local development setup, prerequisites, Docker workflow         | --                                                                               |
| `LIVE_SESSIONS.md`            | Live sessions feature (WebRTC, PeerJS)                          | `src/components/LiveSession/*`                                                   |
| `KNOWN_ISSUES.md`             | Known bugs and workarounds                                      | --                                                                               |
| `integrations/workshop.md`    | Workshop mode, action capture and replay                        | `src/integrations/workshop/*`                                                    |
| `SCALE_TESTING.md`            | Live session scale testing procedures                           | --                                                                               |
| `utils/README.md`             | Utility directory layout, remaining hooks, timeout manager      | `src/utils/*`                                                                    |
| `constants/README.md`         | Selector constants, interactive config, z-index management      | `src/constants/*`                                                                |

All `.mdc` files live in `.cursor/rules/`. `pr-review.md` is at `.cursor/rules/pr-review.md`. `E2E_TESTING_CONTRACT.md`, `RELEASE_PROCESS.md`, `FEATURE_FLAGS.md`, `CLI_TOOLS.md`, `ASSISTANT_INTEGRATION.md`, `E2E_TESTING.md`, `DEV_MODE.md`, `LOCAL_DEV.md`, `LIVE_SESSIONS.md`, `KNOWN_ISSUES.md`, `SCALE_TESTING.md`, `integrations/workshop.md`, `utils/README.md`, and `constants/README.md` are at `docs/developer/`. The `interactive-examples/` and `engines/` directories are also under `docs/developer/`.

## PR reviews

Load **[.cursor/rules/pr-review.md](.cursor/rules/pr-review.md)** for reviews. It contains a compact detection table covering all concern areas (React anti-patterns R1-R21, security F1-F6, and quality heuristics QC1-QC7) with a pointer to the detailed reference file.

**Tiered rule architecture:**

- **Tier 1 (glob-triggered on `*.ts`/`*.tsx`/`*.js`/`*.jsx`)**: `frontend-security.mdc` -- security rules F1-F6
- **Tier 1 (on `/review`)**: `pr-review.md` -- compact orchestrator with unified detection table
- **Tier 2 (loaded on hit)**: `react-antipatterns.mdc` -- detailed Do/Don't for R1-R21 (includes hooks, state, performance, and SRE reliability patterns; also used by `/attack`)
