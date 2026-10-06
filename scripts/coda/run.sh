#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
: "${CODA_HARNESS_ROOT:?Set CODA_HARNESS_ROOT to a grafana-coda-app checkout with the lifecycle harness}"
CODA_HARNESS_ROOT=$(cd "$CODA_HARNESS_ROOT" && pwd)
export CODA_HARNESS_STATE="$CODA_HARNESS_ROOT/tests/harness/state"
export PATHFINDER_PLUGIN_DIST="$ROOT/dist"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-coda-lifecycle}
cd "$ROOT"
mkdir -p tests/coda/.harness
cp "$CODA_HARNESS_ROOT/tests/lifecycle/fixtures.ts" tests/coda/.harness/fixtures.ts
cp "$CODA_HARNESS_ROOT/tests/lifecycle/reporter.ts" tests/coda/.harness/reporter.ts
if [[ "${PATHFINDER_SKIP_BUILD:-0}" != 1 ]]; then
  npm run build
  case $(docker info --format '{{.Architecture}}') in
    arm64|aarch64) mage build:linuxARM64 ;;
    amd64|x86_64) mage build:linuxAMD64 ;;
    *) echo 'Unsupported Docker architecture' >&2; exit 1 ;;
  esac
fi
trap 'bash "$CODA_HARNESS_ROOT/scripts/harness/run.sh" down' EXIT INT TERM
bash "$CODA_HARNESS_ROOT/scripts/harness/run.sh" up
npx tsc -p tsconfig.coda.json
npx playwright test -c playwright.coda.config.ts "$@"
