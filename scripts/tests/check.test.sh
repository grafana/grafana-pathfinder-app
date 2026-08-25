#!/usr/bin/env bash
# Behavioural tests for scripts/check.js — the pre-merge gate runner — run by
# `npm run test:scripts`.
#
# npm is replaced by a stub on PATH, so the runner is exercised end to end
# without spending minutes on the real gate: the stub records every step it is
# asked to run and can be told to fail on one of them.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
CHECK="${REPO_ROOT}/scripts/check.js"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BIN="${WORK}/bin"
mkdir -p "$BIN"
cat >"${BIN}/npm" <<'STUB'
#!/usr/bin/env bash
# Stands in for npm. Logs "<script>" per invocation and fails on STUB_FAIL_ON.
printf '%s\n' "$2" >>"${STUB_LOG:-/dev/null}"
[[ "$2" == "${STUB_FAIL_ON:-}" ]] && exit 3
exit 0
STUB
chmod +x "${BIN}/npm"
export PATH="${BIN}:${PATH}"

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

nope() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
  [[ -z "${2:-}" ]] || printf '%s\n' "$2" | sed 's/^/         /'
}

# Runs the runner with the stub on PATH. Sets RUN_OUT, RUN_CODE and RUN_LOG.
run() {
  local log="${WORK}/steps.log"
  : >"$log"
  RUN_OUT=$(STUB_LOG="$log" STUB_FAIL_ON="${FAIL_ON:-}" node "$CHECK" "$@" 2>&1)
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

printf '\n  %d passed, %d failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
