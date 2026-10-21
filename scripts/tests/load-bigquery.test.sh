#!/usr/bin/env bash
# Behavioural tests for scripts/load-bigquery.bash, run by `npm run test:scripts`.
#
# curl and bq are replaced by stubs on PATH, so `update` runs end to end
# without network or GCP credentials: the stub curl serves fixtures, and the
# stub bq records each load and keeps a copy of the NDJSON it was handed.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
LOADER="${REPO_ROOT}/scripts/load-bigquery.bash"

PASS=0
FAIL=0
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BIN="${WORK}/bin"
mkdir -p "$BIN"
export PATH="${BIN}:${PATH}"

cat >"${BIN}/curl" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    */packages/repository.json) cat "$STUB_REPOSITORY" ;;
    */index.json) printf '{"rules":[]}' ;;
  esac
done
EOF

cat >"${BIN}/bq" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_LOG"
[[ "$1" == load ]] || exit 0
table=
data=
for arg in "$@"; do
  case "$arg" in
    docs_site.*) table="${arg#docs_site.}" ;;
    --*) ;;
    *) [[ -n "$table" && -z "$data" ]] && data="$arg" ;;
  esac
done
cp "$data" "${STUB_CAPTURE}/${table}.ndjson"
EOF
chmod +x "${BIN}/curl" "${BIN}/bq"

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}

nope() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
  [[ -z "${2:-}" ]] || printf '%s\n' "$2" | sed 's/^/         /'
}

# Runs `update` against a fixture. Sets RUN_OUT, RUN_CODE, RUN_LOG, CAPTURE.
run_update() {
  local fixture="$1"
  CAPTURE="${WORK}/capture"
  rm -rf "$CAPTURE"
  mkdir -p "$CAPTURE"
  : >"${WORK}/bq.log"
  RUN_OUT=$(STUB_REPOSITORY="$fixture" STUB_LOG="${WORK}/bq.log" STUB_CAPTURE="$CAPTURE" \
    "$LOADER" update 2>&1)
  RUN_CODE=$?
  RUN_LOG=$(cat "${WORK}/bq.log")
}

row() { jq -c --arg id "$1" 'select(.id == $id)' "${CAPTURE}/pathfinder_packages.ndjson"; }

expect_jq() {
  local label="$1" id="$2" filter="$3"
  if row "$id" | jq -e "$filter" >/dev/null 2>&1; then
    ok "$label"
  else
    nope "$label" "$(row "$id")"
  fi
}

# --- fixtures ---------------------------------------------------------------

FIXTURE="${WORK}/repository.json"
cat >"$FIXTURE" <<'EOF'
{
  "demo-path": {
    "path": "demo-path/",
    "type": "path",
    "title": "Demo path",
    "category": "take-action",
    "author": { "name": "someone", "team": "interactive-learning" },
    "startingLocation": "/explore",
    "milestones": ["demo-guide"],
    "targeting": { "match": { "or": [{ "urlPrefix": "/explore" }] } },
    "testEnvironment": { "tier": "cloud" },
    "stats": { "version": 2, "blockCount": 12, "sectionCount": 3, "completableBlockCount": 4, "finalCompletablePosition": 9 }
  },
  "demo-guide": {
    "path": "demo-path/demo-guide/",
    "type": "guide",
    "title": "Demo guide",
    "depends": ["first", ["either-a", "either-b"]],
    "fieldFromTheFuture": "should not reach BigQuery"
  }
}
EOF

EMPTY="${WORK}/empty.json"
printf '{}' >"$EMPTY"

# --- package map ------------------------------------------------------------

echo "load-bigquery.bash"

run_update "$FIXTURE"
if [[ "$RUN_CODE" == 0 ]]; then
  ok "update exits 0"
else
  nope "update exits 0 (got ${RUN_CODE})" "$RUN_OUT"
fi

ROWS=$(wc -l <"${CAPTURE}/pathfinder_packages.ndjson" 2>/dev/null | tr -d ' ')
if [[ "$ROWS" == 2 ]]; then
  ok "one row per package"
else
  nope "one row per package (got ${ROWS:-none})"
fi

expect_jq "id comes from the map key" demo-path '.id == "demo-path" and .path == "demo-path/"'
expect_jq "author is flattened" demo-path '.author_name == "someone" and .author_team == "interactive-learning"'
expect_jq "stats are flattened into columns" demo-path \
  '.stats_version == 2 and .block_count == 12 and .section_count == 3 and .completable_block_count == 4 and .final_completable_position == 9'
expect_jq "targeting is kept whole" demo-path '.targeting.match.or[0].urlPrefix == "/explore"'
expect_jq "missing arrays load as empty" demo-guide '.milestones == [] and .provides == []'
expect_jq "an OR dependency clause survives" demo-guide '.depends[1] == ["either-a", "either-b"]'
expect_jq "unknown manifest fields are dropped" demo-guide 'has("fieldFromTheFuture") | not'
expect_jq "every row carries loaded_at" demo-guide '.loaded_at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$")'

SCHEMA_COLUMNS=$(jq -r '[.[].name] | sort | join(",")' "${REPO_ROOT}/scripts/bigquery/pathfinder-packages.schema.json")
ROW_COLUMNS=$(row demo-guide | jq -r 'keys | sort | join(",")')
if [[ "$SCHEMA_COLUMNS" == "$ROW_COLUMNS" ]]; then
  ok "filter output matches the schema columns"
else
  nope "filter output matches the schema columns" "schema: ${SCHEMA_COLUMNS}"$'\n'"rows:   ${ROW_COLUMNS}"
fi

if [[ "$RUN_LOG" == *"--replace docs_site.pathfinder_packages"*"pathfinder-packages.schema.json"* ]]; then
  ok "loads with --replace and the schema file"
else
  nope "loads with --replace and the schema file" "$RUN_LOG"
fi

# --- guard ------------------------------------------------------------------

run_update "$EMPTY"
if [[ "$RUN_CODE" != 0 ]]; then
  ok "an empty package map fails the run"
else
  nope "an empty package map fails the run" "$RUN_OUT"
fi
if [[ "$RUN_LOG" != *"pathfinder_packages"* ]]; then
  ok "an empty package map never reaches bq"
else
  nope "an empty package map never reaches bq" "$RUN_LOG"
fi

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
