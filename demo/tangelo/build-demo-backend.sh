#!/usr/bin/env bash
# Builds the plugin backend for the Tangelo demo container with the tangelodemo
# tag (pkg/plugin/tangelo_demo.go). Never ship this binary: the tag swaps the
# App Platform completion store for an in-memory one and lets jsonData redirect
# the webhook.
set -euo pipefail

cd "$(dirname "$0")/../.."

arch="$(uname -m)"
case "$arch" in
  arm64 | aarch64) goarch=arm64 ;;
  x86_64 | amd64) goarch=amd64 ;;
  *)
    echo "unsupported architecture: $arch" >&2
    exit 1
    ;;
esac

CGO_ENABLED=0 GOOS=linux GOARCH="$goarch" go build \
  -tags 'arrow_json_stdlib tangelodemo' \
  -o "dist/gpx_grafana-pathfinder-app_linux_${goarch}" \
  ./pkg
echo "built dist/gpx_grafana-pathfinder-app_linux_${goarch} (tangelodemo)"
