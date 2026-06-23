# Local development commands

Reference index for npm scripts and mage tasks. The essentials live in `AGENTS.md`; everything below is on-demand.

## Initial setup

```bash
# Install dependencies (requires Node.js 24+)
npm install

# Type check
npm run typecheck
```

## Development workflow

```bash
# Start development server with watch mode
npm run dev

# Run Grafana locally with Docker
npm run server

# Run all tests, no coverage (CI mode - agents should use this for focused runs)
npm run test:ci

# Run tests in watch mode (for local development)
npm test

# Run tests with coverage + threshold enforcement (used by `npm run check`)
npm run test:coverage
```

## Code quality

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

## Pre-merge check

`npm run check` runs typecheck + lint + prettier + lint:go + test:go + test:coverage in one command.

## Building and testing

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

## Go backend development

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

## Additional per-platform backend builds

```bash
npm run build:backend:darwin-arm64
npm run build:backend:linux-arm64
npm run build:backend:windows
```

## Guide authoring and validation

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

## Additional dev tools

```bash
# Internationalization
npm run i18n-extract           # extract translatable strings into locales/

# Live sessions / WebRTC signaling
npm run peerjs-server          # start local PeerJS signaling server

# Coverage in watch mode
npm run test:coverage:watch
```

## Development server

The development server runs Grafana OSS in Docker with the plugin mounted. After running `npm run server`, access:

- **Grafana UI**: http://localhost:3000
- **Default credentials**: admin/admin
