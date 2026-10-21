#!/usr/bin/env bash
# Copies the bundled guides that also live in grafana/interactive-tutorials
# from a checkout of that repo into src/bundled-interactives/, so the
# sync-bundled-guides workflow can open a PR when they drift.
#
# Usage: scripts/sync-bundled-guides.sh <interactive-tutorials-dir> [bundled-dir]
#
# interactive-tutorials is the source of truth for content.json and
# manifest.json. Two manifest fields stay owned here: `repository` is always
# "bundled", and `stats` is dropped for `npm run stats:build` to restamp.
# A guide not yet published upstream is skipped, never deleted.

set -euo pipefail

GUIDES=(
  welcome-to-grafana
  welcome-to-grafana-cloud
  first-dashboard
  first-dashboard-cloud
  prometheus-grafana-101
  prometheus-advanced-queries
  loki-grafana-101
)

UPSTREAM=${1:?usage: sync-bundled-guides.sh <interactive-tutorials-dir> [bundled-dir]}
BUNDLED=${2:-src/bundled-interactives}

[[ -d "$UPSTREAM" ]] || {
  echo "upstream directory not found: ${UPSTREAM}" >&2
  exit 1
}
[[ -d "$BUNDLED" ]] || {
  echo "bundled directory not found: ${BUNDLED}" >&2
  exit 1
}

STATUS=0
for id in "${GUIDES[@]}"; do
  src="${UPSTREAM}/${id}"
  dest="${BUNDLED}/${id}"

  if [[ ! -e "${src}/content.json" && ! -e "${src}/manifest.json" ]]; then
    echo "missing ${id}"
    continue
  fi
  if [[ ! -f "${src}/content.json" || ! -f "${src}/manifest.json" ]]; then
    echo "incomplete ${id}: upstream needs both content.json and manifest.json" >&2
    STATUS=1
    continue
  fi

  upstream_id=$(jq -r '.id // empty' "${src}/manifest.json")
  if [[ "$upstream_id" != "$id" ]]; then
    echo "mismatch ${id}: upstream manifest id is '${upstream_id}'" >&2
    STATUS=1
    continue
  fi

  mkdir -p "$dest"
  cp "${src}/content.json" "${dest}/content.json"
  jq '{id, type, repository: "bundled"} + del(.repository, .stats)' \
    "${src}/manifest.json" >"${dest}/manifest.json.tmp"
  mv "${dest}/manifest.json.tmp" "${dest}/manifest.json"
  echo "synced ${id}"
done

exit "$STATUS"
