#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

node - "${REPO_ROOT}/.github/workflows/ci.yml" >"${WORK}/filter" <<'NODE'
const { readFileSync } = require('node:fs');
const workflow = readFileSync(process.argv[2], 'utf8');
const filters = [...workflow.matchAll(/jq -r '([^']+)'/g)]
  .map((match) => match[1])
  .filter((filter) => filter.includes('startswith("e2e test ")'));
if (filters.length !== 1) {
  throw new Error(`Expected one Playwright job-link query, found ${filters.length}`);
}
process.stdout.write(filters[0]);
NODE
FILTER=$(<"${WORK}/filter")

JOBS='{"jobs":[
  {"name":"e2e test grafana-enterprise@13.1.8","conclusion":"failure","html_url":"https://example.com/jobs/failed"},
  {"name":"e2e test grafana-enterprise@12.4.13","conclusion":"timed_out","html_url":"https://example.com/jobs/timeout"},
  {"name":"e2e test grafana-enterprise@13.2.4","conclusion":"success","html_url":"https://example.com/jobs/passed"},
  {"name":"e2e test grafana@dev-preview-react19","conclusion":"cancelled","html_url":"https://example.com/jobs/cancelled"},
  {"name":"e2e test grafana-enterprise@12.3.11","conclusion":"skipped","html_url":"https://example.com/jobs/skipped"},
  {"name":"Build","conclusion":"timed_out","html_url":"https://example.com/jobs/build"}
]}'

ACTUAL=$(printf '%s\n' "$JOBS" | jq -r "$FILTER")
EXPECTED=$(printf 'e2e test grafana-enterprise@13.1.8\thttps://example.com/jobs/failed\ne2e test grafana-enterprise@12.4.13\thttps://example.com/jobs/timeout')
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  printf 'FAIL: expected only failed and timed-out Playwright job links\nActual:\n%s\n' "$ACTUAL" >&2
  exit 1
fi
printf '  ok   links failed and timed-out images, excluding other job results\n'

TIMEOUT_ONLY='{"jobs":[{"name":"e2e test grafana-enterprise@12.4.13","conclusion":"timed_out","html_url":"https://example.com/jobs/timeout"}]}'
ACTUAL=$(printf '%s\n' "$TIMEOUT_ONLY" | jq -r "$FILTER")
EXPECTED=$(printf 'e2e test grafana-enterprise@12.4.13\thttps://example.com/jobs/timeout')
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  printf 'FAIL: a timeout-only matrix must include the timed-out image link\nActual:\n%s\n' "$ACTUAL" >&2
  exit 1
fi
printf '  ok   includes the job link when the only unsuccessful image timed out\n'
