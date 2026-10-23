#!/usr/bin/env bash

set -euf -o pipefail

function usage {
  cat <<EOF
Manage the loading of interactive guide data into the Dev Advocacy BigQuery dataset.

Usage:
  $0 <create|update>

Examples:
  $0 create
  $0 update
EOF
}

function create_tables {
  local project_id="$1"
  local dataset="$2"
  local location="$3"
  local script_dir="$4"

  cat <<EOF
Creating BigQuery tables in ${project_id}.${dataset}...
EOF

  cat <<EOF
Creating pathfinder_packages table...
EOF

  bq mk \
    --project_id="${project_id}" \
    --location="${location}" \
    --table \
    "${dataset}.pathfinder_packages" \
    "${script_dir}/bigquery/pathfinder-packages.schema.json"

  cat <<EOF
✓ pathfinder_packages table created successfully
EOF

  cat <<EOF
Creating app_states table...
EOF

  bq mk \
    --project_id="${project_id}" \
    --location="${location}" \
    --table \
    "${dataset}.app_states" \
    'title:STRING,best_doc_url:STRING,description:STRING,urlPrefix:STRING'

  cat <<EOF
✓ app_states table created successfully
EOF

  cat <<EOF
Creating interactive_tutorials table...
EOF

  bq mk \
    --project_id="${project_id}" \
    --location="${location}" \
    --table \
    "${dataset}.interactive_tutorials" \
    'title:STRING,url:STRING,description:STRING,type:STRING,match:JSON'

  cat <<EOF
✓ interactive_tutorials table created successfully

All tables created successfully in ${project_id}.${dataset}
EOF
}

function existing_package_count {
  local project_id="$1"
  local dataset="$2"
  local output errors errors_file status=0

  # stderr stays out of the JSON: on a runner, gcloud warns there about the active account even when bq succeeds.
  errors_file=$(mktemp) || return 1
  output=$(bq show --project_id="${project_id}" --format=json "${dataset}.pathfinder_packages" 2> "${errors_file}") || status=$?
  errors=$(cat "${errors_file}")
  rm -f "${errors_file}"

  if (( status == 0 )); then
    jq -re '.numRows // "0" | tonumber' <<< "${output}" || {
      printf 'could not read numRows from bq show:\n%s\n' "${output}" >&2
      return 1
    }
  elif [[ "${output}${errors}" == *"Not found"* ]]; then
    echo ''
  else
    printf '%s\n%s\n' "${output}" "${errors}" >&2
    return 1
  fi
}

function validate_packages {
  local repository_file="$1"

  if ! jq -e 'type == "object" and length > 0 and all(.[]; type == "object")' "${repository_file}" > /dev/null; then
    cat <<EOF
✗ repository.json is not a non-empty map of package objects
EOF
    return 1
  fi

  local invalid_ids
  invalid_ids=$(jq -r '
    to_entries[]
    | select(
        (.value.path | type) != "string" or (.value.path | length) == 0
        or (.value.title | type) != "string"
        or (.value.type | IN("guide", "path", "journey") | not)
      )
    | .key' "${repository_file}") || return 1
  if [[ -n "${invalid_ids}" ]]; then
    cat <<EOF
✗ packages missing a path, title or known type:
${invalid_ids}
EOF
    return 1
  fi

  local missing_milestones
  missing_milestones=$(jq -r '
    . as $catalog
    | to_entries[]
    | .key as $path_id
    | .value.milestones // [] | .[]
    | select(($catalog[.].type // "") != "guide")
    | "\($path_id) -> \(.)"' "${repository_file}") || return 1
  if [[ -n "${missing_milestones}" ]]; then
    cat <<EOF
✗ milestones that are not guides in the catalog:
${missing_milestones}
EOF
    return 1
  fi

  # A path's stats are its own body plus every milestone (build-stats rolls them up), so they can never be smaller.
  local short_paths
  short_paths=$(jq -r '
    . as $catalog
    | to_entries[]
    | select(.value.milestones)
    | .key as $path_id
    | .value.stats as $own
    | [.value.milestones[] | $catalog[.].stats] as $members
    | select(
        $own == null or ($members | any(. == null))
        or $own.blockCount < ($members | map(.blockCount) | add)
        or $own.sectionCount < ($members | map(.sectionCount) | add)
        or $own.completableBlockCount < ($members | map(.completableBlockCount) | add)
      )
    | $path_id' "${repository_file}") || return 1
  if [[ -n "${short_paths}" ]]; then
    cat <<EOF
✗ paths whose stats do not cover their milestones (stale build-stats?):
${short_paths}
EOF
    return 1
  fi
}

function check_row_count {
  local project_id="$1"
  local dataset="$2"
  local rows_file="$3"

  local new_count existing_count
  new_count=$(wc -l < "${rows_file}" | tr -d ' ') || return 1
  existing_count=$(existing_package_count "${project_id}" "${dataset}") || return 1

  if [[ -z "${existing_count}" ]]; then
    cat <<EOF
pathfinder_packages does not exist yet; the load will create it with ${new_count} rows
EOF
  elif (( new_count * 10 < existing_count * 9 )) && [[ "${ALLOW_PACKAGE_DROP:-}" != 'true' ]]; then
    cat <<EOF
✗ the catalog produces ${new_count} rows, down from ${existing_count} in pathfinder_packages (more than 10%)
  Set ALLOW_PACKAGE_DROP=true (the allow_package_drop workflow input) if the drop is intended.
EOF
    return 1
  fi
}

# Called from `||` in update_tables, where errexit is off, so every step checks its own status.
function fetch_and_load_packages {
  local project_id="$1"
  local dataset="$2"
  local script_dir="$3"
  local work_dir="$4"

  local repository_url='https://interactive-learning.grafana.net/packages/repository.json'
  local repository_file="${work_dir}/repository.json"
  local rows_file="${work_dir}/rows.ndjson"

  cat <<EOF
Fetching and loading ${repository_url}...
EOF

  curl -fsSL "${repository_url}" > "${repository_file}" || return 1

  # --replace swaps the whole table, so a truncated, partial or malformed response must not reach it.
  validate_packages "${repository_file}" || return 1

  jq -c \
    --arg loaded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -f "${script_dir}/bigquery/pathfinder-packages.jq" \
    "${repository_file}" > "${rows_file}" || return 1

  if [[ ! -s "${rows_file}" ]]; then
    cat <<EOF
✗ repository.json produced no rows
EOF
    return 1
  fi

  check_row_count "${project_id}" "${dataset}" "${rows_file}" || return 1

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.pathfinder_packages" \
    "${rows_file}" \
    "${script_dir}/bigquery/pathfinder-packages.schema.json" || return 1
}

function load_packages {
  local project_id="$1"
  local dataset="$2"
  local script_dir="$3"

  local work_dir status=0
  work_dir=$(mktemp -d) || return 1
  fetch_and_load_packages "${project_id}" "${dataset}" "${script_dir}" "${work_dir}" || status=1
  rm -rf "${work_dir}"

  if (( status != 0 )); then
    cat <<EOF
✗ pathfinder_packages was not replaced
EOF
    return 1
  fi

  cat <<EOF
✓ pathfinder_packages table loaded successfully
EOF
}

function update_tables {
  local project_id="$1"
  local dataset="$2"
  local script_dir="$3"

  cat <<EOF
Updating BigQuery tables in ${project_id}.${dataset}...
EOF

  local packages_status=0
  load_packages "${project_id}" "${dataset}" "${script_dir}" || packages_status=1

  local remote_index_url='https://raw.githubusercontent.com/grafana/interactive-tutorials/main/index.json'
  local temp_index_file
  temp_index_file=$(mktemp)

  cat <<EOF
Fetching and loading remote index.json from ${remote_index_url}...
EOF

  curl -fsSL "${remote_index_url}" | jq -c '.rules[]' >  "${temp_index_file}"

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.interactive_tutorials" \
    "${temp_index_file}" \
    'title:STRING,url:STRING,description:STRING,type:STRING,match:JSON'

  rm -f "${temp_index_file}"

  cat <<EOF
✓ interactive_tutorials table loaded successfully
EOF

  local app_states_file="${script_dir}/app-states.json"

  if [[ ! -f "${app_states_file}" ]]; then
    cat <<EOF
✗ app-states.json not found at ${app_states_file}
EOF
    return 1
  fi

  cat <<EOF
Loading app-states.json into app_states table...
EOF

  local temp_app_states_file
  temp_app_states_file=$(mktemp)

  jq -c '.[]' "${app_states_file}" > "${temp_app_states_file}"

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.app_states" \
    "${temp_app_states_file}" \
    'title:STRING,best_doc_url:STRING,description:STRING,urlPrefix:STRING'

  rm -f "${temp_app_states_file}"

  cat <<EOF
✓ app_states table loaded successfully
EOF

  if (( packages_status != 0 )); then
    cat <<EOF

✗ interactive_tutorials and app_states were updated, but pathfinder_packages was not (see above)
EOF
    return 1
  fi

  cat <<EOF

All tables updated successfully in ${project_id}.${dataset}
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

PROJECT_ID='grafanalabs-global'
DATASET='docs_site'
LOCATION='us'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$1" in
  --help | -h)
    usage
    exit 0
    ;;
  create)
    create_tables "${PROJECT_ID}" "${DATASET}" "${LOCATION}" "${SCRIPT_DIR}"
    ;;
  update)
    update_tables "${PROJECT_ID}" "${DATASET}" "${SCRIPT_DIR}"
    ;;
  *)
    cat <<EOF
Unknown command: $1
EOF
    usage
    exit 2
    ;;
esac
