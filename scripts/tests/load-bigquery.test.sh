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
if [[ "$1" == show ]]; then
  case "$STUB_EXISTING" in
    missing) echo "BigQuery error in show operation: Not found: Table docs_site.pathfinder_packages" && exit 1 ;;
    broken) echo "BigQuery error in show operation: Access Denied" && exit 1 ;;
    *) printf '{"numRows":"%s"}\n' "$STUB_EXISTING" && exit 0 ;;
  esac
fi
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

# Runs `update` against a fixture. EXISTING is the current table's row count,
# or missing/broken for `bq show` failures. Sets RUN_OUT, RUN_CODE, RUN_LOG, CAPTURE.
run_update() {
  local fixture="$1"
  CAPTURE="${WORK}/capture"
  rm -rf "$CAPTURE"
  mkdir -p "$CAPTURE"
  : >"${WORK}/bq.log"
  RUN_OUT=$(STUB_REPOSITORY="$fixture" STUB_LOG="${WORK}/bq.log" STUB_CAPTURE="$CAPTURE" \
    STUB_EXISTING="${EXISTING:-2}" ALLOW_PACKAGE_DROP="${ALLOW:-}" "$LOADER" update 2>&1)
  RUN_CODE=$?
  RUN_LOG=$(cat "${WORK}/bq.log")
}

loaded() { [[ "$RUN_LOG" == *"--replace docs_site.pathfinder_packages"* ]]; }

expect_refused() {
  local label="$1"
  if [[ "$RUN_CODE" != 0 ]] && ! loaded; then
    ok "$label"
  else
    nope "$label (exit ${RUN_CODE})" "$RUN_OUT"
  fi
}

expect_loaded() {
  local label="$1"
  if [[ "$RUN_CODE" == 0 ]] && loaded; then
    ok "$label"
  else
    nope "$label (exit ${RUN_CODE})" "$RUN_OUT"
  fi
}

mkfixture() { # file, jq expression applied to the base fixture
  jq "$2" "$FIXTURE" >"$1"
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
expect_refused "an empty package map is refused"

NINE="${WORK}/nine.json"
mkfixture "$NINE" '[range(9) as $i | {key: "guide-\($i)", value: {path: "guide-\($i)/", type: "guide", title: "Guide \($i)"}}] | from_entries'

EXISTING=10 run_update "$NINE"
expect_loaded "a 10% drop is allowed"

EXISTING=11 run_update "$NINE"
expect_refused "a drop of more than 10% is refused"
if [[ "$RUN_OUT" == *"9 packages, down from 11"* ]]; then
  ok "and says how far the catalog shrank"
else
  nope "and says how far the catalog shrank" "$RUN_OUT"
fi

EXISTING=732 run_update "$FIXTURE"
expect_refused "a two-package response cannot replace 732 rows"

EXISTING=732 ALLOW=true run_update "$FIXTURE"
expect_loaded "ALLOW_PACKAGE_DROP=true lets an intended drop through"

EXISTING=missing run_update "$FIXTURE"
expect_loaded "a missing table is created on the first run"

EXISTING=broken run_update "$FIXTURE"
expect_refused "a failed table lookup is refused rather than treated as a first run"

for case in \
  'no-title|.["demo-guide"] |= del(.title)' \
  'empty-path|.["demo-guide"].path = ""' \
  'unknown-type|.["demo-guide"].type = "tutorial"'; do
  name="${case%%|*}"
  mkfixture "${WORK}/${name}.json" "${case#*|}"
  run_update "${WORK}/${name}.json"
  expect_refused "an entry with ${name} is refused"
  if [[ "$RUN_OUT" == *"demo-guide"* ]]; then
    ok "and names the bad entry (${name})"
  else
    nope "and names the bad entry (${name})" "$RUN_OUT"
  fi
done

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
