#!/usr/bin/env bash
# Behavioural tests for scripts/upsert-learning-path.sh and the shared
# scripts/lib/app-platform.sh, run by `npm run test:scripts`.
#
# curl is replaced by scripts/tests/curl-stub.sh on PATH, so every case
# exercises the real script end to end without a stack: argument handling,
# hostname rejection, package translation, ordering, collision refusal,
# pagination, and what does *not* reach the wire.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
UPSERT="${REPO_ROOT}/scripts/upsert-learning-path.sh"

SENTINEL_TOKEN='glsa_sentinel_do_not_leak'
PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BIN="${WORK}/bin"
mkdir -p "$BIN"
cp "${SCRIPT_DIR}/curl-stub.sh" "${BIN}/curl"
chmod +x "${BIN}/curl"
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

# Runs the script with the stub on PATH. Sets RUN_OUT and RUN_CODE.
run() {
  local log="${WORK}/requests.log"
  : >"$log"
  RUN_OUT=$(STUB_LOG="$log" STUB_MODE="${MODE:-empty}" \
    "$UPSERT" --stack stack.invalid --token "$SENTINEL_TOKEN" "$@" 2>&1)
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

refute_out() {
  local label="$1" needle="$2"
  if [[ "$RUN_OUT" != *"$needle"* ]]; then
    ok "$label"
  else
    nope "$label (unexpected \"${needle}\")" "$RUN_OUT"
  fi
}

writes() { printf '%s\n' "$RUN_LOG" | grep -cE '^(POST|PUT)	' || true; }

# A create POSTs to the collection, so the resource name is in the payload
# rather than the URL. BODY lines are logged for writes only.
write_order() { printf '%s\n' "$RUN_LOG" | sed -n 's/^BODY	.*"name": *"\([^"]*\)".*/\1/p' | tr '\n' ' '; }

# --- fixtures ---------------------------------------------------------------

blocks='[{"type":"markdown","id":"b1","content":"hi"}]'

mkpkg() { # dir, id, type, milestones-json, blocks-json
  mkdir -p "$1"
  local ms=''
  [[ "$4" == "null" ]] || ms=",\"milestones\":$4"
  printf '{"id":"%s","type":"%s"%s}' "$2" "$3" "$ms" >"$1/manifest.json"
  printf '{"id":"%s","title":"T %s","blocks":%s}' "$2" "$2" "$5" >"$1/content.json"
}

# A two-milestone path. Directory names deliberately differ from the ids.
path_pkg() {
  local root="${WORK}/$1"
  rm -rf "$root"
  mkpkg "$root" lp path '["m-a","m-b"]' "$blocks"
  mkpkg "$root/first" m-a guide null "$blocks"
  mkpkg "$root/second" m-b guide null "$blocks"
  printf '%s' "$root"
}

echo "upsert-learning-path.sh"

# --- usage and argument handling --------------------------------------------

PKG=$(path_pkg base)

OUT=$("$UPSERT" --help 2>&1)
CODE=$?
if [[ "$CODE" == 0 ]]; then
  ok "--help exits 0"
else
  nope "--help exits 0 (got ${CODE})"
fi

OUT=$("$UPSERT" --stack 2>&1)
CODE=$?
if [[ "$CODE" == 64 && "$OUT" == *"requires a value"* ]]; then
  ok "an option with no value is a usage error, not an unbound-variable crash"
else
  nope "--stack with no value returns 64" "exit ${CODE}: ${OUT}"
fi

run --package "$PKG" --status sideways --dry-run
expect_code "an unknown --status is a usage error" 64

OUT=$("$UPSERT" --package "$PKG" --token t --dry-run 2>&1)
CODE=$?
if [[ "$CODE" == 64 ]]; then
  ok "a missing --stack is a usage error"
else
  nope "missing --stack returns 64 (got ${CODE})"
fi

# --- hostname validation ----------------------------------------------------

for bad in \
  '{trusted.invalid,attacker.invalid}' \
  'trusted.invalid@attacker.invalid' \
  'stack.invalid/apis/x' \
  'stack.invalid?a=b' \
  'stack invalid'; do
  OUT=$(STUB_MODE=empty "$UPSERT" --stack "$bad" --token "$SENTINEL_TOKEN" \
    --package "$PKG" --dry-run 2>&1)
  CODE=$?
  if [[ "$CODE" == 64 && "$OUT" == *"single hostname"* ]]; then
    ok "--stack rejects \"${bad}\" before attaching the token"
  else
    nope "--stack rejects \"${bad}\"" "exit ${CODE}: ${OUT}"
  fi
done

run --package "$PKG" --dry-run
expect_code "a plain hostname is accepted" 0

OUT=$(STUB_LOG=/dev/null STUB_MODE=empty "$UPSERT" --stack https://stack.invalid/ \
  --token "$SENTINEL_TOKEN" --package "$PKG" --dry-run 2>&1)
CODE=$?
if [[ "$CODE" == 0 ]]; then
  ok "a scheme and trailing slash are stripped"
else
  nope "scheme stripped" "$OUT"
fi

# --- credential handling ----------------------------------------------------

MODE=empty run --package "$PKG"
if [[ "$RUN_LOG" == *"$SENTINEL_TOKEN"* ]]; then
  nope "the token never reaches curl's argv"
else
  ok "the token never reaches curl's argv"
fi

# --- dry run: validation gate -----------------------------------------------

run --package "$PKG" --dry-run
expect_code "a clean package dry-runs green" 0
expect_out "the dry run counts every resource" "3 resources would be uploaded"
expect_out "the cover page is listed last" "[3/3]"
if [[ "$(writes)" == 0 ]]; then
  ok "a dry run writes nothing"
else
  nope "a dry run writes nothing (${RUN_LOG})"
fi

BAD=$(path_pkg mismatch)
printf '{"id":"not-lp","title":"T","blocks":%s}' "$blocks" >"$BAD/content.json"
run --package "$BAD" --dry-run
expect_code "a cover page whose content id disagrees with its manifest fails the dry run" 1
expect_out "the dry run reports the failure count" "Dry run failed"

for case_name in 'non-string title:{"id":"m-a","title":42,"blocks":BLOCKS}' \
  'empty blocks:{"id":"m-a","title":"T","blocks":[]}' \
  'a block with no type:{"id":"m-a","title":"T","blocks":[{}]}' \
  'a non-object block:{"id":"m-a","title":"T","blocks":["nope"]}'; do
  label="${case_name%%:*}"
  body="${case_name#*:}"
  BAD=$(path_pkg "shape")
  printf '%s' "${body/BLOCKS/$blocks}" >"$BAD/first/content.json"
  run --package "$BAD" --dry-run
  expect_code "${label} is rejected before any write" 1
done

# --- undeclared block fields ------------------------------------------------

UNKNOWN=$(path_pkg unknown)
printf '{"id":"m-a","title":"T","blocks":[{"type":"input","id":"i","defaultValue":"x"}]}' \
  >"$UNKNOWN/first/content.json"
run --package "$UNKNOWN" --dry-run
expect_code "an undeclared block field warns but still uploads" 0
expect_out "the warning names the field" "defaultValue"

run --package "$UNKNOWN" --dry-run --strict-blocks
expect_code "--strict-blocks turns that warning into a failure" 1

# Fields the CRD gained after the first draft of this script. The allowlist
# fell behind once; a false --strict-blocks rejection is the failure mode.
DECLARED=$(path_pkg declared)
printf '{"id":"m-a","title":"T","blocks":[{"type":"section","id":"s","title":"S","autoCollapse":true,"blocks":[{"type":"markdown","id":"m","content":"x"}]},{"type":"challenge","id":"c","title":"C","brief":"b","successCriteria":"s","vmTemplate":"t","setupCommands":["x"]},{"type":"interactive","id":"g","action":"button","reftarget":"Save","targetstate":"checked"}]}' \
  >"$DECLARED/first/content.json"
run --package "$DECLARED" --dry-run --strict-blocks
expect_code "fields the CRD does declare pass --strict-blocks" 0
refute_out "no false warning for autoCollapse" "autoCollapse"
refute_out "no false warning for targetstate" "targetstate"
refute_out "no false warning for successCriteria" "successCriteria"

# --- package structure errors ----------------------------------------------

MISSING=$(path_pkg missing)
rm -rf "${MISSING}/second"
run --package "$MISSING" --dry-run
expect_code "a milestone with no subdirectory fails" 1
expect_out "the message lists the ids it did find" "ids found:"

DUPE=$(path_pkg dupe)
mkpkg "${DUPE}/third" m-a guide null "$blocks"
run --package "$DUPE" --dry-run
expect_code "duplicate ids across subdirectories fail" 1

SELF=$(path_pkg self)
printf '{"id":"lp","type":"path","milestones":["lp","m-b"]}' >"$SELF/manifest.json"
run --package "$SELF" --dry-run
expect_code "a milestone sharing the package id fails" 1

SLUG=$(path_pkg slug)
printf '{"id":"My Path","type":"path","milestones":["m-a","m-b"]}' >"$SLUG/manifest.json"
printf '{"id":"My Path","title":"T","blocks":%s}' "$blocks" >"$SLUG/content.json"
run --package "$SLUG" --dry-run
expect_code "a package id that is not slug-shaped fails" 1
expect_out "the message explains why the slug has to match" "milestone resolution"

MALFORMED=$(path_pkg malformed)
printf 'not json at all' >"$MALFORMED/manifest.json"
run --package "$MALFORMED" --dry-run
expect_code "a malformed root manifest fails with the documented code" 1
expect_out "and names the file" "manifest.json is not readable"

PRELUDE=$(path_pkg prelude)
mkdir -p "${PRELUDE}/business-value"
printf 'not json' >"${PRELUDE}/business-value/manifest.json"
run --package "$PRELUDE" --dry-run
expect_code "a malformed non-milestone subdirectory is skipped, not fatal" 0
expect_out "and says which directory it skipped" "skipping"

# --- writes -----------------------------------------------------------------

MODE=empty run --package "$PKG"
expect_code "a clean package uploads" 0
expect_out "and reports what it did" "3 created, 0 updated, 0 failed"
if [[ "$(write_order)" == "m-a m-b lp " ]]; then
  ok "milestones are written before the cover page"
else
  nope "milestone-before-cover ordering" "order: $(write_order)"
fi

MODE=existing_ours run --package "$PKG"
expect_code "re-running an already-uploaded package succeeds" 0
expect_out "and reports updates rather than creates" "0 created, 3 updated"

MODE=existing_foreign run --package "$PKG"
expect_code "a name held by a guide this tool did not upload is refused" 1
expect_out "and says which one" "m-a"
if [[ "$(writes)" == 0 ]]; then
  ok "the refusal happens before the first write"
else
  nope "refused before writing (${RUN_LOG})"
fi

MODE=existing_foreign run --package "$PKG" --overwrite
expect_code "--overwrite allows the replacement" 0
expect_out "and reports it as a replacement" "replaced"

# The pre-flight listing is a snapshot. If the resource is detached between
# the listing and the write, the helper's own GET has to catch it.
MODE=detached run --package "$PKG"
expect_code "a resource detached after the pre-flight is still refused" 1
expect_out "and says which annotation it expected" "managed-by"

MODE=detached run --package "$PKG" --overwrite
expect_code "--overwrite drops that guard too" 0

MODE=reject_422 run --package "$PKG"
expect_code "a 422 fails the run" 1
expect_out "and hints at the CRD when the message names manifest" "predates spec.manifest"

# --- collision listing ------------------------------------------------------

MODE=paged_foreign run --package "$PKG"
expect_code "a collision on the second page of the listing is still found" 1
expect_out "and is reported" "m-a"

MODE=paged_broken run --package "$PKG"
expect_code "a listing that fails mid-drain fails closed" 1
expect_out "rather than treating the partial page as the whole collection" "could not list existing guides"
if [[ "$(writes)" == 0 ]]; then
  ok "and writes nothing"
else
  nope "no writes after a failed listing (${RUN_LOG})"
fi

MODE=list_not_a_collection run --package "$PKG"
expect_code "a 2xx body that is not a collection fails closed" 1

MODE=unreachable run --package "$PKG" --dry-run
expect_code "an unreachable stack still dry-runs" 0
expect_out "and says the collision check did not run" "Collisions: not checked"

MODE=unreachable run --package "$PKG"
expect_code "an unreachable stack refuses to write" 1

# --- signals ---------------------------------------------------------------

SIG_LOG="${WORK}/sig.log"
: >"$SIG_LOG"
STUB_LOG="$SIG_LOG" STUB_MODE=empty "$UPSERT" --stack stack.invalid \
  --token "$SENTINEL_TOKEN" --package "$PKG" >/dev/null 2>&1 &
SIG_PID=$!
sleep 0.3
kill -TERM "$SIG_PID" 2>/dev/null
wait "$SIG_PID"
SIG_CODE=$?
if [[ "$SIG_CODE" == 143 || "$SIG_CODE" == 0 ]]; then
  ok "SIGTERM exits with the documented code (${SIG_CODE})"
else
  nope "SIGTERM exits 143 or completes first (got ${SIG_CODE})"
fi

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
