# Local development and testing

This guide explains how to build, run, and test Grafana Pathfinder locally. For a one-page onboarding overview with first-week reading list, see [`GETTING_STARTED.md`](GETTING_STARTED.md).

## Prerequisites

| Tool    | Version                                   | Notes                                                                      |
| ------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Node.js | `>=22`                                    | Pinned in `package.json` engines and `.nvmrc`.                             |
| npm     | `11+` (we ship `npm@11.12.1`)             | The `packageManager` field locks the major version.                        |
| Go      | `1.25.7` (or whatever `go.mod` specifies) | For the plugin backend.                                                    |
| Docker  | recent                                    | Bundled Grafana + Prometheus / Loki / Alloy containers.                    |
| `mage`  | latest                                    | Backend build orchestration: `go install github.com/magefile/mage@latest`. |

Quick verification: `node -v && npm -v && go version && docker --version && mage --version`.

## Install dependencies

```bash
npm install
```

This installs frontend dependencies and runs the husky `prepare` hook to install pre-commit checks.

## Run in watch mode

```bash
npm run dev
```

Webpack watches `src/` and rebuilds `dist/` on save. Pair this with `npm run server` (in another terminal) to see changes in Grafana on a hard refresh.

## Build production bundle

```bash
npm run build         # frontend only
npm run build:all     # frontend + Linux x64 backend + Linux ARM64 backend (what docker-compose mounts)
```

For local-only backend builds (no Docker):

```bash
npm run build:backend:darwin           # macOS Intel
npm run build:backend:darwin-arm64     # macOS Apple Silicon
npm run build:backend:linux            # Linux x64
npm run build:backend:linux-arm64      # Linux ARM64
npm run build:backend:windows          # Windows
```

## Start Grafana with the plugin

```bash
npm run server
```

This runs `npm run build:all && docker compose up --build`. It brings up four containers:

| Container                             | Port  | Purpose                                     |
| ------------------------------------- | ----- | ------------------------------------------- |
| `grafana-pathfinder-app`              | 3000  | Grafana with the plugin mounted at `dist/`. |
| `grafana-pathfinder-app-prometheus-1` | 9090  | Prometheus (used by demo guides).           |
| `grafana-pathfinder-app-loki-1`       | 3100  | Loki (used by demo guides).                 |
| `grafana-pathfinder-app-alloy-1`      | 12345 | Alloy (used by demo guides).                |

Notes:

- Provisioning files under `provisioning/` are pre-configured for local dev.
- Default credentials: `admin` / `admin`.
- The sidebar **Help** icon opens the docs panel.

## Pre-merge check

Run before pushing or opening a pull request. CI runs the same set:

```bash
npm run check
```

Equivalent to:

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --cache .
npm run prettier-test   # prettier formatting check
npm run lint:go         # mage -v lint (golangci-lint)
npm run test:go         # mage -v test
npm run test:ci         # jest --passWithNoTests --maxWorkers 4
```

Each step is also a standalone script if you only want to re-run one.

## Running tests

### Unit tests

```bash
npm run test:ci          # CI mode — what agents and CI use
npm test                 # watch mode
npm run test:coverage    # one-shot coverage report
```

### Go tests

```bash
npm run test:go          # mage -v test
```

### End-to-end tests (Playwright)

```bash
npm run e2e
```

Playwright targets `http://localhost:3000` by default. Start `npm run server` first and wait until `curl -s http://localhost:3000/api/health` returns `200` before running the suite. The first run downloads the browser bundle.

The CLI ships its own test runner for guide content (separate from the plugin tests above) — see [`E2E_TESTING.md`](E2E_TESTING.md).

## Code quality

```bash
npm run lint             # check
npm run lint:fix         # autofix lint + prettier
npm run prettier         # format
npm run prettier-test    # check formatting only
npm run lint:go          # golangci-lint via mage
```

Husky runs `lint-staged` on commit (Prettier on staged `.ts`/`.tsx`/`.js`/`.json`/`.yaml`/`.md`).

## IDE setup

The repo ships `.eslintrc`, `.prettierrc.js`, and `tsconfig.json` configured. For VS Code we recommend the following extensions:

- **ESLint** (`dbaeumer.vscode-eslint`) — surfaces the same lint rules CI uses.
- **Prettier — Code formatter** (`esbenp.prettier-vscode`) — set as default formatter, format on save.
- **Go** (`golang.go`) — for backend work.

JetBrains IDEs work too — point Prettier and ESLint at the repo configs and enable format on save.

## Signing (optional)

For production distribution, the plugin must be signed:

```bash
npm run sign
```

This wraps `@grafana/sign-plugin`. Follow the prompts or pass environment variables per [Grafana's plugin signing docs](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin/).

## Troubleshooting

### Port 3000 / 9090 / 3100 / 12345 already in use

Another process is bound to the port. Common culprits: a previous `docker compose` run, a system Grafana install, or a Vite dev server. Stop the offending process or change the port in `docker-compose.yaml`.

### Docker daemon not running

`docker ps` fails. Start Docker Desktop (macOS / Windows) or `sudo systemctl start docker` (Linux).

### Plugin not visible after `npm run server`

- Hard-refresh the browser to clear the plugin manifest cache.
- Confirm the plugin is enabled under **Administration > Plugins and data > Plugins**.
- If you edited `src/plugin.json`, restart the Grafana container so the manifest is re-read: `docker compose restart grafana`.

### `mage` not found

```bash
go install github.com/magefile/mage@latest
export PATH="$PATH:$(go env GOPATH)/bin"
```

### Husky pre-commit hook fails

`npm run check` reproduces the failure locally. Fix the underlying issue; do not bypass with `--no-verify`.

### npm install fails with peer-dependency conflicts

Delete `node_modules/` and `package-lock.json`, then `npm install` from clean.

### Sidebar button missing or behaves oddly

After editing `src/module.tsx` or `src/plugin.json`, ensure the titles match. Restart the Grafana container after manifest changes.

### UI state looks stale

Pathfinder persists state to localStorage and Grafana's user-storage API. Clear the `pathfinder-*` keys in localStorage from the browser DevTools, then refresh.
