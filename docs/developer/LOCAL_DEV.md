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

## Testing against Grafana Cloud (Graft)

Some contributors test their local `dist/` build against a live Grafana Cloud stack instead of (or alongside) the Docker Grafana above, using [Graft](https://github.com/grafana/plugin-graft) — an internal, Grafanista-only browser-extension + local-server tool that intercepts Cloud requests and serves your local build with hot reload. See [`GRAFT_TESTING.md`](GRAFT_TESTING.md) for what this means when debugging or reviewing changes.

## Testing private CDN URL signing locally

Use this flow to validate private interactive-learning content from a local Pathfinder app build.
This uses the app plugin backend route `/cdn/sign`.
You do not need a local `grafana-pathfinder-backend` stack.

### Prerequisites

- Local Grafana from `npm run server` is up on `http://localhost:3000`.
- `gcloud` is authenticated for `gs://interactive-learning-dev-private`.
- You can read Terraform state in `deployment_tools` for `cells/interactive-learning/grafanalabs-dev`.

### Get the dev signing secret

Read the active `key1` signing secret from Terraform state.
Do this in `deployment_tools`.

```bash
cd ~/ext/grafana/deployment_tools
SECRET=$(TERRAFORM_INITIALIZE=false ./scripts/terraform/tf-state \
  terraform/cells/interactive-learning/grafanalabs-dev pull \
  | sed -n '/^{/,$p' \
  | jq -r '.resources[]
    | select(.module=="module.interactive-learning-dev")
    | select(.type=="random_password")
    | select(.name=="token-signing")
    | .instances[]
    | select(.index_key=="key1")
    | .attributes.result')
```

### Upload a fixture package

```bash
GUIDE_ID="qa-first-dashboard-$(date +%s)"
BASE_PREFIX="internal/e2e/${GUIDE_ID}"
SRC_BASE=~/ext/grafana/grafana-pathfinder-app/src/bundled-interactives/first-dashboard

gcloud storage cp "${SRC_BASE}/content.json" "gs://interactive-learning-dev-private/${BASE_PREFIX}/content.json"
gcloud storage cp "${SRC_BASE}/manifest.json" "gs://interactive-learning-dev-private/${BASE_PREFIX}/manifest.json"
```

### Login to local Grafana and configure signer settings

This local image has basic auth disabled.
Login once and reuse the session cookie for API calls.

```bash
curl -s -c /tmp/grafana-cookie.txt \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/login \
  -d '{"user":"admin","password":"admin"}'

curl -s -b /tmp/grafana-cookie.txt \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/plugins/grafana-pathfinder-app/settings \
  -d "{
    \"enabled\": true,
    \"secureJsonData\": {
      \"cdn_private_base_url\": \"https://interactive-learning-private.grafana-dev.net\",
      \"cdn_signing_key_id\": \"key1\",
      \"cdn_signing_secret\": \"${SECRET}\"
    }
  }"
```

### Mint a signed URL and verify edge behavior

```bash
PATH_ONLY="/${BASE_PREFIX}/content.json"
SIGNED_URL=$(curl -s -b /tmp/grafana-cookie.txt \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/plugins/grafana-pathfinder-app/resources/cdn/sign \
  -d "{\"path\":\"${PATH_ONLY}\",\"expiresInSeconds\":300}" | jq -r '.url')

curl -i "${SIGNED_URL}"
curl -i "https://interactive-learning-private.grafana-dev.net${PATH_ONLY}"
```

Expected status codes:

- signed URL: `200`
- unsigned URL: `403`

You can also check signature failure modes.
Tampered or expired tokens must return `403`.

Tampered signature example:

```bash
TAMPERED_URL=$(echo "${SIGNED_URL}" | perl -pe 's/(\bs=)[0-9a-f]{8}/$1deadbeef/' )
curl -i "${TAMPERED_URL}"
```

Expired token example:

```bash
EXPIRY=$(( $(date +%s) - 60 ))
SIG=$(printf '%s\n%s\n%s' "${PATH_ONLY}" "${EXPIRY}" "key1" \
  | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $NF}')
EXPIRED_URL="https://interactive-learning-private.grafana-dev.net${PATH_ONLY}?e=${EXPIRY}&k=key1&s=${SIG}"
curl -i "${EXPIRED_URL}"
```

### Open the guide in local Pathfinder

```bash
DOC_PARAM=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "${SIGNED_URL}")
open "http://localhost:3000/a/grafana-pathfinder-app?doc=${DOC_PARAM}"
```

Expected result: the guide loads in the docs panel.

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
