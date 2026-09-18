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
npm run prepare    # install husky git hooks (pre-commit etc.)
```

The repo sets `ignore-scripts=true` in `.npmrc` as a supply-chain mitigation, so `npm install` skips all lifecycle scripts — including husky's `prepare`. Run `npm run prepare` once after the first clone to install pre-commit checks. CI explicitly installs Playwright browsers (`npx playwright install --with-deps`) where needed, so no other manual steps are required.

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

### Sandbox terminals

Terminal, terminal-connect and challenge blocks need the separate
`grafana-coda-app` plugin, which the base stack deliberately does not include —
Pathfinder treats it as optional and detects it at runtime, and CI must not mount
it. Opt in with the `docker-compose.coda.yaml` overlay; its header has the
two-line `.env` recipe and the build commands.

Mounting the plugin is not the whole of setup: registration is a manual step an
administrator performs once, entering an enrollment key on the Coda plugin's own
configuration page. Nothing in this repo can do it for you. See
[`CODA.md`](CODA.md) for the two-plugin setup end to end.

## Local dev against a virtualized App Platform (`/assignments/my`)

The App Platform proxy routes cannot reach a real backend locally. The aggregator that serves
Pathfinder's kinds runs only on hosted Grafana Cloud — `scripts/upsert-guide.sh` says so, and
`grafana-pathfinder-backend` ships CRDs and a manifest rather than a service, so there is nothing
to run in its place. `resolveAssignmentBackend` therefore reports `capability.available: false` on
the Docker stack, with a reason naming which precondition is missing: a served aggregation layer
for the `.app` group, an app URL, a namespace, or a provisioned CAP token to mint an on-behalf-of
access token with. On top of those, the `Assignment` kind is not registered upstream yet, so even a
real Cloud stack answers `upstream-404` today.

To build "My Paths" against the real route anyway, `/assignments/my` carries a fixture that serves
a canned envelope. It lives behind the **`pathfinderdev` build tag**
(`pkg/plugin/assignments_dev.go`), so it is absent from every shipped artifact rather than merely
disabled in one — substituting the upstream also means substituting the caller's identity, and an
identity substitution switchable by configuration in a released binary is the fail-open the proxy's
trust boundary exists to prevent (`docs/design/BACKEND_PROXY_PATTERN.md` §3).

Build the frontend and a tagged backend, matching your Docker platform's architecture:

```bash
npm run build
GOOS=linux GOARCH=arm64 go build -tags pathfinderdev \
  -o dist/gpx_grafana-pathfinder-app_linux_arm64 ./pkg    # amd64 on Intel hosts
```

Then bring the stack up as usual — there is nothing to configure:

```bash
docker compose up -d
```

**If Grafana was already running, this is not enough.** Backend plugin processes are spawned once
at Grafana's own startup and are not hot-reloaded when the binary on disk changes — `docker compose
up -d` against an already-running container reports everything as unchanged and does not restart
Grafana, so it keeps running whatever binary it originally spawned. Rebuilding the Go binary while
the stack is already up silently no-ops until you also run:

```bash
docker compose restart grafana
```

Symptom if you skip this: `capability.available` comes back `false` with `reason:
"feature-toggle-disabled"` — that is the _real_ route's answer (no App Platform aggregator locally),
which is only reachable if the dev hook never ran, i.e. you are still talking to the stale binary.

The tagged build looks for `demo/assignments-fixture.json`, which the repo already mounts into the
container at `/root/grafana-pathfinder-app/demo/`. The file's presence is the on switch, and a
missing one falls through to the real read path. (Grafana constructs the environment it launches a
backend plugin with, so a variable set on the container is not reliably visible to the plugin
process; that is why the gate is a path rather than an env var. `PATHFINDER_DEV_ASSIGNMENTS_FIXTURE`
overrides the path if you run the binary directly.)

Check the envelope before touching any UI:

```bash
curl -su admin:admin \
  http://localhost:3000/api/plugins/grafana-pathfinder-app/resources/assignments/my | jq
```

If that 401s with `"auth.unauthorized"` even with the right admin/admin credentials, this stack has
`GF_AUTH_BASIC_ENABLED=false` (check `docker compose exec grafana printenv | grep GF_AUTH`) — Basic
Auth is off, not the password. Log in with a session cookie instead:

```bash
curl -s -c /tmp/graf_cookie.txt -X POST http://localhost:3000/login \
  -H 'Content-Type: application/json' -d '{"user":"admin","password":"admin"}'
curl -s -b /tmp/graf_cookie.txt \
  http://localhost:3000/api/plugins/grafana-pathfinder-app/resources/assignments/my | jq
```

(If admin/admin itself is rejected by `/login` too — not just the `-u` flag — the `grafana-data`
volume is persisting an admin password from an earlier session and `GF_SECURITY_ADMIN_PASSWORD` no
longer applies; reset it with `docker compose exec grafana grafana cli admin reset-admin-password admin`.)

Notes on the loop:

- **Every `pathId` in the fixture must match a real entry in the current catalogue**
  (`src/learning-paths/paths.json` for a non-cloud-migration-target stack, `paths-cloud.json`
  otherwise — see `paths-data.ts`), or App Platform's own custom-guide catalogue for a private path.
  Unresolvable targets are silently dropped the same way a real deleted/unpublished path would be —
  a fictional id renders nothing, with no error, which is easy to mistake for the UI itself being
  broken.

- **The fixture is re-read on every request**, so editing `demo/assignments-fixture.json` and
  refreshing the browser is the whole iteration cycle — no rebuild, no plugin restart.
- **It carries the display states the UI has to render**, including an obligation with no deadline
  (the only shape MVP actually writes), a past `dueAt`, a satisfied one, a track-qualified target,
  two records for one path from different rules, and a withdrawn record that the loader drops
  exactly as the real route drops it.
- **`satisfied` comes from the file** because the real route does not evaluate it yet — see
  `unevaluatedSatisfaction` in `pkg/plugin/assignments.go` for what the completion join has to do
  and why it must not reuse `collateByUser` as-is.
- **The plugin logs a warning on the first fixture-served request.** If you do not see it, the tag
  is missing or the file is not where the plugin looked, and you are looking at the real route's
  capability envelope.
- **Identity is still preferred over substitution.** The fixture serves the verified ID-token `sub`
  when the local stack forwards one that verifies, and falls back to the file's own `subject`
  (default `user:dev`) only when it does not — so switching which user you are looking at is
  another edit to the same file.

An untagged build has no fixture at all, which `TestMyAssignments_DevFixtureAbsentInDefaultBuild`
pins. Use the ordinary `npm run build:all` for anything you intend to ship or hand to someone else.

## Testing against Grafana Cloud (Graft)

Some contributors test their local `dist/` build against a live Grafana Cloud stack instead of (or alongside) the Docker Grafana above, using [Graft](https://github.com/grafana/plugin-graft) — an internal, Grafanista-only browser-extension + local-server tool that intercepts Cloud requests and serves your local build with hot reload. See [`GRAFT_TESTING.md`](GRAFT_TESTING.md) for what this means when debugging or reviewing changes.

## Pre-merge check

Run before pushing or opening a pull request:

```bash
npm run check
```

This is the local gate. It announces each step as it starts and stops at the first failure. To see what it
contains without running it:

```bash
npm run check -- --list
```

Each step is also a standalone script if you only want to re-run one — `--list` names them, and
[`COMMANDS.md`](COMMANDS.md) describes them.

CI does not run `npm run check`, and the two are not the same set: CI additionally enforces manifest
freshness and the production build.

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

Husky runs `lint-staged` on commit: `eslint --fix` then Prettier on staged
`.ts`/`.tsx`/`.js`/`.mjs`, and Prettier alone on staged `.json`/`.yaml`/`.md`.

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

### Husky pre-commit hook fails or blocks the commit

`npm run check` reproduces the failure locally. Fix the underlying issue; do not bypass with `--no-verify`.

### npm install fails with peer-dependency conflicts

Delete `node_modules/` and `package-lock.json`, then `npm install` from clean.

### Sidebar button missing or behaves oddly

After editing `src/module.tsx` or `src/plugin.json`, ensure the titles match. Restart the Grafana container after manifest changes.

### UI state looks stale

Pathfinder persists state to localStorage and Grafana's user-storage API. Clear the `pathfinder-*` keys in localStorage from the browser DevTools, then refresh.
