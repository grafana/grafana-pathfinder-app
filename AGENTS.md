# Grafana Pathfinder - AI Agent Guide

## What is this Project?

**Grafana Pathfinder** is a Grafana App Plugin that provides contextual, interactive documentation directly within the Grafana UI. It appears as a right-hand sidebar panel that displays personalized learning content, tutorials, and recommendations to help users learn Grafana products and configurations.

### Key Features

- **Context-Aware Recommendations**: Automatically detects what you're doing in Grafana and suggests relevant documentation
- **Interactive Tutorials**: Step-by-step guides with "Show me" and "Do it" buttons that can automate actions in the Grafana UI
- **Tab-Based Interface**: Browser-like experience with multiple documentation tabs and localStorage persistence
- **Intelligent Content Delivery**: Multi-strategy content fetching with bundled fallbacks
- **Progressive Learning**: Tracks completion state and adapts to user experience level

### Target Audience

Beginners and intermediate users who need to quickly learn Grafana products. Not intended for deep experts who primarily need reference documentation.

## Project Architecture

This is a **React + TypeScript + Grafana Scenes** application built as a Grafana extension plugin. The architecture follows these key patterns:

- **Modular, Scene-Based Architecture**: Uses Grafana Scenes for state management
- **Hook-Based Business Logic**: Business logic extracted into focused React hooks
- **Interactive Tutorial System**: Sophisticated requirement checking and automated action execution
- **Functional-First Code Style**: Pragmatic functional programming approach with immutable data and pure functions

## Getting Started for AI Agents

### Essential Reading (in order)

Before working on this codebase, you MUST read these files in `.cursor/rules/`:

1. **`.cursor/rules/projectbrief.mdc`** - Start here to understand core requirements and goals
2. **`.cursor/rules/techContext.mdc`** - Technologies, dependencies, and development setup
3. **`.cursor/rules/systemPatterns.mdc`** - Architecture, design patterns, and critical implementation paths

### Specialized Documentation

For specific work areas, consult these:

- **`.cursor/rules/interactiveRequirements.mdc`** - Requirements and objectives system for interactive tutorials
- **`.cursor/rules/multistepActions.mdc`** - Multi-step component design and implementation
- **`.cursor/rules/frontend-security.mdc`** - Security rules for frontend code (ALWAYS apply)
- **`.cursor/rules/instructions.mdc`** - Agent behavior, commands, and workflow patterns

### Security First

Always follow the security rules in `.cursor/rules/frontend-security.mdc`

## Local Development Commands

### Initial Setup

```bash
# Install dependencies (requires Node.js 22+)
npm install

# Type check
npm run typecheck
```

### Development Workflow

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

### Code Quality

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

### Development Server

The development server runs Grafana OSS in Docker with the plugin mounted. After running `npm run server`, access:

- **Grafana UI**: http://localhost:3000
- **Default credentials**: admin/admin

## Code Organization

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

## AI Agent Roles

This project supports role-based agent behavior via slash commands:

- **`/fp`** - Functional Programming Engineer (default): Write functional-first code with pure functions and immutability
- **`/review`** - Code Reviewer: Review for clarity, correctness, and maintainability
- **`/secure`** - Security Analyst: Check for vulnerabilities and unsafe patterns
- **`/test`** - Test Writer: Write fast, isolated, reliable tests
- **`/docs`** - Documentation Writer: Write clear, human-first documentation

## File Creation Policy

Do NOT create summary `.md` files unless explicitly requested. This saves tokens and keeps the repository clean.

## Getting Help

When uncertain about:
- **Architecture decisions**: Review `.cursor/rules/systemPatterns.mdc`
- **Security concerns**: Follow `.cursor/rules/frontend-security.mdc` and ask user to reach out in #security channel
- **Interactive tutorials**: Consult `.cursor/rules/interactiveRequirements.mdc`
- **Memory/context**: The agent instructions in `.cursor/rules/instructions.mdc` explain the memory bank system
