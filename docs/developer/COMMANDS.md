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

# Validate the contract-evolution review gate and disposition policy
npm run test:review-contract

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

## Go lint

`npm run lint:go` runs `mage -v lint`, which is `golangci-lint run ./...` over the default
linter set configured by `.golangci.yaml`.

CI runs the identical invocation in the `Lint backend` job of `.github/workflows/ci.yml`, and that job
is one of the checks `CI Gate` aggregates. `CI Gate` is a required status check on `main`, so a Go lint
diagnostic blocks merge exactly as an eslint or typecheck error does.

The linter version is pinned in `GOLANGCI_LINT_VERSION` at the top of `.github/workflows/ci.yml`, so an
upstream release cannot turn the repository red on its own. Install that version locally to reproduce
CI exactly — `golangci-lint --version` tells you what you have. When a diagnostic is wrong rather than
a real defect, suppress it at the line with `//nolint:<linter> // <reason>` rather than widening the
linter set in `.golangci.yaml`.

## Pre-merge check

`npm run check` runs the local pre-merge gate in one command. It announces each step as it starts, and
stops at the first failure. To see what it contains without running it:

```bash
npm run check -- --list
```

Every step is also a standalone script: `--list` names them, and this file documents each one in the
section it belongs to. CI does not run `npm run check`; it additionally enforces manifest freshness and
the production build, so a green local gate is not by itself a green `CI Gate`.

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

# Regenerate the Go/TypeScript contract goldens under pkg/plugin/testdata/contract
# (see docs/design/BACKEND_PROXY_PATTERN.md §10)
go test ./pkg/plugin -run TestContract -update
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
npm run stats:build         # stamp each manifest.json with its completion block stats
npm run stats:check         # CI drift check for the stamped stats (writes nothing)

# JSON guide schema export
npm run schema:export       # export schema to dist/

# Terms-and-conditions sync
npm run docs:sync-terms        # sync TERMS_VERSION across docs/
npm run docs:sync-terms:check  # local drift check for terms; not run in CI
```

## Uploading guides to a stack

`InteractiveGuide` resources are written through the Pathfinder Backend
aggregator, which Grafana Cloud serves and OSS Grafana does not. Both scripts
need `curl` and `jq`, and an Editor-role service-account token; pass it in
`$PATHFINDER_SA_TOKEN` rather than `--token` so it stays out of the process
table. Full reference: [`EXTERNAL_API.md`](EXTERNAL_API.md).

```bash
export PATHFINDER_SA_TOKEN="glsa_..."

# One guide, from a bare spec or an editor Library → Export envelope
scripts/upsert-guide.sh --stack learn.grafana.net --spec ./my-guide.json

# A whole package: milestones first, then the path's cover page
scripts/upsert-learning-path.sh --stack learn.grafana.net --package ./drilldown-logs-lj

# Preview without writing. Validates every resource and reports collisions;
# exits non-zero if anything would fail, so it works as a CI gate.
scripts/upsert-learning-path.sh --stack learn.grafana.net --package ./pkg --dry-run
```

```bash
# Test the scripts themselves (bash -n, shellcheck, behavioural suites)
npm run test:scripts
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
