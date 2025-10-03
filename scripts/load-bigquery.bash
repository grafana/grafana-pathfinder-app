#!/usr/bin/env bash

set -euf -o pipefail

function usage {
  cat <<EOF
Manage the loading of interactive tutorial data into the Dev Advocacy BigQuery dataset.

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

  cat <<EOF
Creating BigQuery tables in ${project_id}.${dataset}...
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

function update_tables {
  local project_id="$1"
  local dataset="$2"
  local script_dir="$3"

  cat <<EOF
Updating BigQuery tables in ${project_id}.${dataset}...
EOF

  local remote_index_url='https://raw.githubusercontent.com/grafana/interactive-tutorials/main/index.json'

  cat <<EOF
Fetching and loading remote index.json from ${remote_index_url}...
EOF

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.interactive_tutorials" \
    <(curl -fsSL "${remote_index_url}" | jq -c '.rules[]') \
    'title:STRING,url:STRING,description:STRING,type:STRING,match:JSON'

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

  bq load \
    --project_id="${project_id}" \
    --source_format=NEWLINE_DELIMITED_JSON \
    --replace \
    "${dataset}.app_states" \
    <(jq -c '.[]' "${app_states_file}") \
    'title:STRING,best_doc_url:STRING,description:STRING,urlPrefix:STRING'

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
    create_tables "${PROJECT_ID}" "${DATASET}" "${LOCATION}"
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
