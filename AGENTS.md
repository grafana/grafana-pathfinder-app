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

## PR Reviews

When reviewing a pull request, follow the comprehensive guidelines in:

- **[.cursor/rules/pr-review.md](.cursor/rules/pr-review.md)** - Complete PR review checklist

This guide instructs you to:

1. Conduct a **Principal Engineer level** review focused on long-term code health
2. Apply **security rules** from `frontend-security.mdc` (F1-F6)
3. Apply **React anti-pattern checks** from `react-antipatterns.mdc` (R1-R15)
4. Evaluate **testability, modularity, and maintainability**
5. Watch for **vibe coding smells**: large components, God objects, duplicated logic
6. Check for **code duplication** and failure to reuse existing patterns
7. Verify the change follows established **repo conventions**

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

# Run tests in watch mode
npm test

# Run all tests (CI mode)
npm run test:ci

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
