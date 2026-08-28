#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
FIXTURE_ROOT="$PROJECT_ROOT/tests/e2e-runner/fixtures/shared-session-path"
CLI="$PROJECT_ROOT/dist/cli/cli/index.js"
GRAFANA_URL=${GRAFANA_URL:-http://localhost:3000}
MARKER='https://shared-session.invalid/exact-browser-marker'
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

node "$CLI" e2e \
  --grafana-url "$GRAFANA_URL" \
  --package "$FIXTURE_ROOT" \
  --repository "$FIXTURE_ROOT/repository.json" \
  --output "$TEMP_DIR/shared.json" \
  --artifacts "$TEMP_DIR/shared-artifacts"

node - "$TEMP_DIR/shared.json" "$MARKER" <<'NODE'
const fs = require('fs');
const [reportPath, marker] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.outcome !== 'passed' || report.reports.length !== 2) {
  throw new Error('The shared fixture did not produce two passing reports.');
}
for (const milestone of report.reports) {
  const urls = [milestone.guide.startingLocation, ...milestone.steps.map((step) => step.currentUrl)];
  if (urls.some((url) => String(url).includes(marker))) {
    throw new Error('The browser-only marker leaked into a milestone URL.');
  }
}
NODE

if node "$CLI" e2e \
  --grafana-url "$GRAFANA_URL" \
  --package "$FIXTURE_ROOT/use-unsaved-config" \
  --output "$TEMP_DIR/isolated.json" \
  --artifacts "$TEMP_DIR/isolated-artifacts"; then
  printf '%s\n' 'The isolated state-dependent guide unexpectedly passed.' >&2
  exit 1
fi

node - "$TEMP_DIR/isolated.json" "$MARKER" <<'NODE'
const fs = require('fs');
const [reportPath, marker] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.outcome !== 'failed' || report.guide.startingLocation.includes(marker)) {
  throw new Error('The isolated fixture did not fail without URL-carried state.');
}
NODE
