# Grafana Pathfinder - AI Agent Guide

## What is this Project?

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

## Getting started for AI agents

### Project Context

The following files are important sources of information:

1. `.cursor/rules/projectbrief.mdc` - Start here to understand core requirements and goals
2. `.cursor/rules/techContext.mdc` - Technologies, dependencies, and development setup
3. `.cursor/rules/systemPatterns.mdc` - Architecture, design patterns, and critical implementation paths
4. `.cursor/rules/interactiveRequirements.mdc` - Requirements and objectives system for interactive tutorials
5. `.cursor/rules/multistepActions.mdc` - Multi-step component design and implementation
6. `.cursor/rules/frontend-security.mdc` - Security rules for frontend code (ALWAYS apply)
7. `.cursor/rules/instructions.mdc` - Agent behavior, commands, and workflow patterns
8. `.cursor/rules/react-antipatterns.mdc` - React anti-patterns to check during reviews (R1-R15)
9. `docs/developer/E2E_TESTING_CONTRACT.md` - the interactive system exposes its state via **data-test-\* attributes** which serve as a stable contract for both the interactive system itself and E2E testing.

## PR Reviews

Load **[.cursor/rules/pr-review.md](.cursor/rules/pr-review.md)** for reviews. It contains a compact detection table covering all concern areas (React anti-patterns R1-R15, security F1-F6, SRE reliability SRE1-SRE10, and quality heuristics QC1-QC7) with pointers to detailed reference files.

**Tiered rule architecture:**

- **Tier 1 (always loaded)**: `frontend-security.mdc` — security rules F1-F6
- **Tier 1 (on `/review`)**: `pr-review.md` — compact orchestrator with unified detection table
- **Tier 2 (loaded on hit)**: `react-antipatterns.mdc` — detailed Do/Don't for R1-R15
- **Tier 2 (loaded on hit)**: `react-sre-audit.mdc` — SRE reliability audit for SRE1-SRE10 (also used by `/attack`)

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

### Building and Testing

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
├── components/         # React components
│   ├── interactive/   # Interactive tutorial components
│   └── docs/          # Documentation rendering components
├── utils/             # Business logic hooks and utilities
├── styles/            # Theme-aware styling functions
├── constants/         # Configuration and selectors
└── types/             # TypeScript type definitions
```
