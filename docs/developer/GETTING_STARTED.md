# Getting started

Welcome to Grafana Pathfinder. This is the first doc to read on day one — it gets you from a fresh clone to a running plugin and points you at the rest of the developer documentation.

## Five-minute quickstart

```bash
git clone git@github.com:grafana/grafana-pathfinder-app.git
cd grafana-pathfinder-app
nvm use   # or install Node 22+ separately
npm install
npm run dev
```

`npm run dev` runs the webpack frontend build in watch mode. To see the plugin in Grafana, you also need a backend build and a Grafana container — see the next section.

## Full local setup (15 minutes)

Use this when you actually want to run the plugin against Grafana.

### Prerequisites

| Tool    | Version                                          | Why                                                                                     |
| ------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Node.js | `>=22` (see `package.json` engines and `.nvmrc`) | Frontend build, tests, CLI tools.                                                       |
| npm     | `11+` (we ship `npm@11.12.1`)                    | Package manager.                                                                        |
| Go      | matches `go.mod` (currently 1.25.7)              | Backend build.                                                                          |
| Docker  | recent                                           | Bundled Grafana + ancillary containers (Prometheus, Loki, Alloy).                       |
| `mage`  | latest                                           | Backend build orchestration. Install with `go install github.com/magefile/mage@latest`. |

Verify everything quickly:

```bash
node -v && npm -v && go version && docker --version && mage --version
```

### Build and run

```bash
npm install            # installs frontend deps and triggers husky hook setup
npm run build:all      # frontend + Linux/ARM64 backend (what docker-compose mounts)
npm run server         # build:all + docker compose up --build
```

`npm run server` brings up four containers:

| Container                             | Port  | Purpose                             |
| ------------------------------------- | ----- | ----------------------------------- |
| `grafana-pathfinder-app`              | 3000  | Grafana with the plugin mounted.    |
| `grafana-pathfinder-app-prometheus-1` | 9090  | Bundled Prometheus for guide demos. |
| `grafana-pathfinder-app-loki-1`       | 3100  | Bundled Loki for guide demos.       |
| `grafana-pathfinder-app-alloy-1`      | 12345 | Bundled Alloy for guide demos.      |

Once the containers are up, log in to [http://localhost:3000](http://localhost:3000) as `admin` / `admin` and click the **Help** icon in the navbar to open Pathfinder.

### Iterating on the frontend

In a second terminal, run `npm run dev` to rebuild on save. The bundled Grafana container mounts the `dist/` directory, so a hard refresh of the browser picks up your changes.

### Iterating on the backend

```bash
mage build:darwinARM64   # or build:darwin / build:linux / build:linuxARM64 / build:windows
docker compose restart grafana
```

The plugin's Go code lives in `pkg/`; the entrypoint is `pkg/main.go`. Backend resource handlers are wired from `pkg/plugin/resources.go`. See [`AGENTS.md`](../../AGENTS.md) for the rest of the layout.

## Pre-merge check

Before opening a pull request, run:

```bash
npm run check
```

This is the same set of checks CI runs:

```text
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --cache .
npm run prettier-test   # prettier formatting check
npm run lint:go         # mage -v lint (golangci-lint)
npm run test:go         # mage -v test (Go tests)
npm run test:ci         # jest --passWithNoTests --maxWorkers 4
```

Each step also runs as a separate npm script if you only want to re-run one of them.

## Recommended IDE setup

The project ships with `.eslintrc`, `.prettierrc.js`, and `tsconfig.json` configured. Any IDE that respects them will work; for VS Code we recommend:

- **ESLint** (`dbaeumer.vscode-eslint`) — surfaces the same lint rules CI uses.
- **Prettier — Code formatter** (`esbenp.prettier-vscode`) — set as default formatter, format on save.
- **Go** (`golang.go`) — for backend work.

A husky pre-commit hook runs `lint-staged`, which applies Prettier to staged `.ts`/`.tsx`/`.js`/`.json`/`.yaml`/`.md` files automatically.

## First-week reading list

Once you have the plugin running, work through these docs in order:

1. **[`AGENTS.md`](../../AGENTS.md)** — The agent / developer reference. Project layout, conventions, on-demand docs index.
2. **[`docs/developer/LOCAL_DEV.md`](LOCAL_DEV.md)** — More detail on the build commands.
3. **[`docs/developer/DEV_MODE.md`](DEV_MODE.md)** — How to enable dev mode and what it exposes.
4. **[`docs/developer/CUSTOM_GUIDES.md`](CUSTOM_GUIDES.md)** — How custom guides flow through the block editor and backend.
5. **[`docs/developer/interactive-examples/json-guide-format.md`](interactive-examples/json-guide-format.md)** — The block-level schema reference (read this before editing any guide, recorded or hand-written).
6. **[`docs/developer/interactive-examples/interactive-types.md`](interactive-examples/interactive-types.md)** — Action types (`highlight`, `button`, `formfill`, `navigate`, `hover`, `noop`, `popout`) and when to use each.
7. **[`docs/developer/E2E_TESTING.md`](E2E_TESTING.md)** — How the Pathfinder CLI's E2E test runner works.
8. **[`docs/developer/engines/`](engines/)** — Subsystem internals (interactive engine, context engine, requirements manager).
9. **[`docs/sources/architecture/_index.md`](../sources/architecture/_index.md)** — User-facing architecture overview, useful as a high-level mental model.

## Common first-day issues

### `docker compose` fails or hangs during the initial build

`npm run server` runs `npm run build:all` first, then `docker compose up --build`. The first build pulls Grafana + sidecar images (~1 GB); on a slow network this can look stuck. If it actually fails, run `docker compose up --build` separately to see the build output.

### "Port 3000 already in use"

Another process is on 3000. Common culprits: an existing Grafana, a Vite dev server, or a previous `docker compose` run. Stop them or set `GRAFANA_URL` to a different port and update `docker-compose.yaml` accordingly.

### Plugin not visible after `npm run server`

- Confirm the plugin is enabled in Grafana under **Administration > Plugins and data > Plugins**.
- Hard-refresh the browser to clear the plugin manifest cache.
- If you edited `src/plugin.json`, restart the Grafana container so the new manifest is read.

### `mage` not found

```bash
go install github.com/magefile/mage@latest
export PATH="$PATH:$(go env GOPATH)/bin"
```

### Husky pre-commit hook fails

`npm run check` reproduces the failure locally. Fix the root cause; do not bypass with `--no-verify`.

### `npm run e2e` can't connect to Grafana

The Playwright tests assume Grafana is running at `http://localhost:3000`. Start the server first with `npm run server`, wait until `curl -s http://localhost:3000/api/health` returns 200, then run `npm run e2e`.

## Where to ask for help

- **Slack:** `#pathfinder-app-release` for releases, otherwise the team channel.
- **GitHub:** [grafana/grafana-pathfinder-app](https://github.com/grafana/grafana-pathfinder-app/issues) for bugs, feature requests, or onboarding gaps you hit while reading this doc.
- **Pair programming:** Reach out to the team — there's plenty of subsystem-specific knowledge that's faster to share over a screen-share than to read.
