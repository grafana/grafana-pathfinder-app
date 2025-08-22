# Local development and testing

This guide explains how to build, run, and test Grafana Pathfinder locally.

## Prerequisites

- Node.js 22+ (see `package.json` engines)
- npm 11+
- Docker (for the bundled Grafana environment)

## Install dependencies

```bash
npm install
```

## Run in watch mode

```bash
npm run dev
```

## Build production bundle

```bash
npm run build
```

## Start Grafana with the plugin

The repo provides a docker-compose setup that mounts the built plugin and provisions defaults.

```bash
npm run server
```

Notes:

- This uses the `docker-compose.yaml` in the project root.
- Provisioning files live under `provisioning/` and are already set up for local dev.

Once started, open Grafana: http://localhost:3000

## Enable and find the plugin

- Log in (defaults: admin / admin).
- Navigate to Administration → Plugins, find “Grafana Pathfinder” and ensure it is enabled.
- The sidebar “Grafana Pathfinder” button opens the docs panel.

## Running tests

### Unit tests

```bash
npm run test
```

### Type checks and lint

```bash
npm run typecheck
npm run lint
```

### E2E tests (Playwright)

```bash
npm run e2e
```

## Signing (optional)

For production distribution you must sign the plugin:

```bash
npm run sign
```

This uses `@grafana/sign-plugin`. Follow prompts or pass environment variables per Grafana docs.

## Troubleshooting

- If the sidebar button disappears, ensure titles in `src/module.tsx` and `src/plugin.json` match.
- After editing `src/plugin.json`, restart Grafana (docker-compose) to reload the manifest.
- Clear browser cache/localStorage if UI state seems stale.
