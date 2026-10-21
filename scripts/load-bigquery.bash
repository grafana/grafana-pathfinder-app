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

function load_packages {
  local project_id="$1"
  local dataset="$2"
  local script_dir="$3"

  local repository_url='https://interactive-learning.grafana.net/packages/repository.json'
  local temp_repository_file temp_packages_file
  temp_repository_file=$(mktemp)
  temp_packages_file=$(mktemp)

  cat <<EOF
Fetching and loading ${repository_url}...
EOF

  curl -fsSL "${repository_url}" > "${temp_repository_file}"

  # --replace swaps the whole table, so a truncated or empty CDN response must not reach it.
  if ! jq -e 'type == "object" and length > 0' "${temp_repository_file}" > /dev/null; then
    cat <<EOF
✗ ${repository_url} is not a non-empty package map; refusing to replace pathfinder_packages
EOF
    rm -f "${temp_repository_file}" "${temp_packages_file}"
    return 1
  fi

  jq -c \
    --arg loaded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -f "${script_dir}/bigquery/pathfinder-packages.jq" \
    "${temp_repository_file}" > "${temp_packages_file}"

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.pathfinder_packages" \
    "${temp_packages_file}" \
    "${script_dir}/bigquery/pathfinder-packages.schema.json"

  rm -f "${temp_repository_file}" "${temp_packages_file}"

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

  load_packages "${project_id}" "${dataset}" "${script_dir}"

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
