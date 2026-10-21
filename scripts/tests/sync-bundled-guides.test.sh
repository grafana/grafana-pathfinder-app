#!/usr/bin/env bash
# Behavioural tests for scripts/sync-bundled-guides.sh, run by
# `npm run test:scripts`.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
SYNC="${REPO_ROOT}/scripts/sync-bundled-guides.sh"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

nope() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
  [[ -z "${2:-}" ]] || printf '%s\n' "$2" | sed 's/^/         /'
}

# Fresh upstream and bundled trees per case; sets UP and BUN.
fixture() {
  UP="${WORK}/$1/upstream"
  BUN="${WORK}/$1/bundled"
  mkdir -p "$UP" "${BUN}/first-dashboard"
  printf '{"id":"first-dashboard","title":"Old"}\n' >"${BUN}/first-dashboard/content.json"
  printf '{"id":"first-dashboard","type":"guide","repository":"bundled","stats":{"version":2}}\n' \
    >"${BUN}/first-dashboard/manifest.json"
}

upstream_guide() {
  mkdir -p "${UP}/$1"
  printf '{"id":"%s","title":"New"}\n' "$1" >"${UP}/$1/content.json"
  printf '{"id":"%s","type":"guide","description":"Upstream","repository":"interactive-tutorials","stats":{"version":9}}\n' \
    "${2:-$1}" >"${UP}/$1/manifest.json"
}

run() {
  RUN_OUT=$(bash "$SYNC" "$UP" "$BUN" 2>&1)
  RUN_CODE=$?
}

echo "sync-bundled-guides.sh"

fixture copies
upstream_guide first-dashboard
run
if [[ "$RUN_CODE" == 0 && "$RUN_OUT" == *"synced first-dashboard"* ]]; then
  ok "syncs a guide present upstream"
else
  nope "syncs a guide present upstream (exit ${RUN_CODE})" "$RUN_OUT"
fi
if cmp -s "${UP}/first-dashboard/content.json" "${BUN}/first-dashboard/content.json"; then
  ok "copies content.json verbatim"
else
  nope "copies content.json verbatim"
fi
MANIFEST=$(jq -c . "${BUN}/first-dashboard/manifest.json")
WANT='{"id":"first-dashboard","type":"guide","repository":"bundled","description":"Upstream"}'
if [[ "$MANIFEST" == "$WANT" ]]; then
  ok "keeps repository as bundled and drops stats for restamping"
else
  nope "keeps repository as bundled and drops stats for restamping" "$MANIFEST"
fi
if [[ "$RUN_OUT" == *"missing welcome-to-grafana"* && ! -e "${BUN}/welcome-to-grafana" ]]; then
  ok "skips a guide not yet published upstream"
else
  nope "skips a guide not yet published upstream" "$RUN_OUT"
fi

fixture incomplete
mkdir -p "${UP}/first-dashboard"
printf '{}\n' >"${UP}/first-dashboard/content.json"
run
if [[ "$RUN_CODE" != 0 && "$RUN_OUT" == *"incomplete first-dashboard"* ]] &&
  grep -q '"Old"' "${BUN}/first-dashboard/content.json"; then
  ok "fails without touching the bundled copy when upstream lacks manifest.json"
else
  nope "fails without touching the bundled copy when upstream lacks manifest.json" "$RUN_OUT"
fi

fixture mismatch
upstream_guide first-dashboard something-else
run
if [[ "$RUN_CODE" != 0 && "$RUN_OUT" == *"mismatch first-dashboard"* ]] &&
  grep -q '"Old"' "${BUN}/first-dashboard/content.json"; then
  ok "fails when the upstream manifest id differs from its directory"
else
  nope "fails when the upstream manifest id differs from its directory" "$RUN_OUT"
fi

fixture no-upstream
RUN_OUT=$(bash "$SYNC" "${WORK}/does-not-exist" "$BUN" 2>&1)
RUN_CODE=$?
if [[ "$RUN_CODE" != 0 && "$RUN_OUT" == *"upstream directory not found"* ]]; then
  ok "fails when the upstream checkout is missing"
else
  nope "fails when the upstream checkout is missing" "$RUN_OUT"
fi

printf '%d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" == 0 ]]
