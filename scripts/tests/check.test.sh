#!/usr/bin/env bash
# Behavioural tests for scripts/check.js — the pre-merge gate runner — run by
# `npm run test:scripts`.
#
# Stub npm's JavaScript entry point so this never re-enters the real gate.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
CHECK="${REPO_ROOT}/scripts/check.js"

PASS=0
FAIL=0
WORK=$(mktemp -d)
if command -v cygpath >/dev/null; then
  WORK=$(cygpath -m "$WORK")
fi
trap 'rm -rf "$WORK"' EXIT

NODE=$(command -v node)
EMPTY_PATH="${WORK}/empty-path"
NPM_STUB="${WORK}/npm-stub.js"
mkdir -p "$EMPTY_PATH"
cat >"$NPM_STUB" <<'STUB'
const fs = require('fs');

const step = process.argv[3];
fs.appendFileSync(process.env.STUB_LOG, `${step}\n`);
process.exit(step === process.env.STUB_FAIL_ON ? 3 : 0);
STUB

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

nope() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
  [[ -z "${2:-}" ]] || printf '%s\n' "$2" | sed 's/^/         /'
}

# Sets RUN_OUT, RUN_CODE and RUN_LOG using the lifecycle fixture.
run() {
  local log="${WORK}/steps.log"
  : >"$log"
  # Require the lifecycle-provided npm entry point instead of PATH fallback.
  RUN_OUT=$(
    PATH="$EMPTY_PATH" \
      npm_execpath="$NPM_STUB" \
      STUB_LOG="$log" \
      STUB_FAIL_ON="${FAIL_ON:-}" \
      "$NODE" "$CHECK" "$@" 2>&1
  )
  RUN_CODE=$?
  RUN_LOG=$(cat "$log")
}

expect_code() {
  local label="$1" want="$2"
  if [[ "$RUN_CODE" == "$want" ]]; then
    ok "$label"
  else
    nope "$label (exit ${RUN_CODE}, want ${want})" "$RUN_OUT"
  fi
}

expect_out() {
  local label="$1" needle="$2"
  if [[ "$RUN_OUT" == *"$needle"* ]]; then
    ok "$label"
  else
    nope "$label (no \"${needle}\" in output)" "$RUN_OUT"
  fi
}

# The steps the runner declares, straight from its own list — the test asserts
# that every declared step is printed and run, not that the list has a
# particular content, which would be a second copy of the declaration.
STEPS=()
while IFS= read -r step; do
  STEPS+=("$step")
done < <(node "$CHECK" --list | sed -n 's/^ *[0-9]*\. \([^ ]*\) .*/\1/p')

echo "scripts/check.js"

if [[ "${#STEPS[@]}" -ge 2 ]]; then
  ok "--list prints a step list (${#STEPS[@]} steps)"
else
  nope "--list prints a step list" "parsed ${#STEPS[@]} steps"
fi

FAIL_ON='' run --list
expect_code "--list exits 0" 0
if [[ -z "$RUN_LOG" ]]; then
  ok "--list runs nothing"
else
  nope "--list runs nothing" "$RUN_LOG"
fi

FAIL_ON='' run
expect_code "a clean run exits 0" 0
expect_out "a clean run reports every step passed" "all ${#STEPS[@]} steps passed"

MISSING=
for step in "${STEPS[@]}"; do
  printf '%s\n' "$RUN_LOG" | grep -qxF "$step" || MISSING="${MISSING} ${step}"
  expect_out "announces ${step} as it starts" "npm run ${step}"
done
if [[ -z "$MISSING" ]]; then
  ok "runs every declared step"
else
  nope "runs every declared step" "missing:${MISSING}"
fi

if [[ "$RUN_LOG" == "$(printf '%s\n' "${STEPS[@]}")" ]]; then
  ok "runs the steps in the declared order"
else
  nope "runs the steps in the declared order" "$RUN_LOG"
fi

if [[ "$(node -p 'process.platform')" != 'win32' ]]; then
  BIN="${WORK}/bin"
  mkdir -p "$BIN"
  cat >"${BIN}/npm" <<'STUB'
#!/bin/sh
exec "$STUB_NODE" "$STUB_ENTRY" "$@"
STUB
  chmod +x "${BIN}/npm"
  : >"${WORK}/fallback.log"
  FALLBACK_OUT=$(
    PATH="$BIN" npm_execpath='' STUB_NODE="$NODE" STUB_ENTRY="$NPM_STUB" \
      STUB_LOG="${WORK}/fallback.log" STUB_FAIL_ON='' "$NODE" "$CHECK" 2>&1
  )
  FALLBACK_CODE=$?
  if [[ "$FALLBACK_CODE" == 0 && "$(cat "${WORK}/fallback.log")" == "$(printf '%s\n' "${STEPS[@]}")" ]]; then
    ok "direct Node invocation retains the PATH-based npm fallback"
  else
    nope "direct Node invocation retains the PATH-based npm fallback" "$FALLBACK_OUT"
  fi
else
  printf '  skip PATH-based npm fallback (requires POSIX executables)\n'
fi

# Fail-fast: the gate stops at the first failing step and exits with its status.
FAIL_ON="${STEPS[1]}" run
expect_code "a failing step exits non-zero, with the step's status" 3
expect_out "names the failing step" "failed at step 2/${#STEPS[@]} (npm run ${STEPS[1]})"
if [[ "$RUN_LOG" == "$(printf '%s\n%s\n' "${STEPS[0]}" "${STEPS[1]}")" ]]; then
  ok "stops at the first failure"
else
  nope "stops at the first failure" "$RUN_LOG"
fi

FAIL_ON='' run --nonsense
expect_code "an unrecognised argument exits non-zero" 2

# A copy of the runner over a package.json whose first step no longer exists.
# Both entry points must name it and exit non-zero rather than print "undefined".
FAKE="${WORK}/fake"
mkdir -p "${FAKE}/scripts"
cp "$CHECK" "${FAKE}/scripts/check.js"
SOURCE="${REPO_ROOT}/package.json" TARGET="${FAKE}/package.json" DROP="${STEPS[0]}" node -e '
  const fs = require("fs");
  const { scripts } = JSON.parse(fs.readFileSync(process.env.SOURCE, "utf8"));
  delete scripts[process.env.DROP];
  fs.writeFileSync(process.env.TARGET, JSON.stringify({ scripts }));
'

expect_missing_script() {
  local label="$1"
  shift
  local out code
  out=$(node "${FAKE}/scripts/check.js" "$@" 2>&1)
  code=$?
  if [[ "$code" != 0 && "$out" == *"no such npm script: ${STEPS[0]}"* ]]; then
    ok "$label"
  else
    nope "$label (exit ${code})" "$out"
  fi
}

expect_missing_script "--list fails loudly when a step's npm script is gone" --list
expect_missing_script "a run fails loudly when a step's npm script is gone"

printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
