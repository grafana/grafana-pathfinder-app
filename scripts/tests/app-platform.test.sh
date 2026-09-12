#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)

# shellcheck source=scripts/lib/app-platform.sh
source "${REPO_ROOT}/scripts/lib/app-platform.sh"

WORK=$(mktemp -d)
SERVER_PID=

cleanup() {
  [[ -z "$SERVER_PID" ]] || kill "$SERVER_PID" 2>/dev/null || true
  ap_auth_cleanup
  rm -rf "$WORK"
}
trap cleanup EXIT

PORT_FILE="${WORK}/port"
HEADER_FILE="${WORK}/authorization"
SERVER_FILE="${WORK}/server.js"

cat >"$SERVER_FILE" <<'JS'
const fs = require('node:fs');
const http = require('node:http');

const [portFile, headerFile] = process.argv.slice(2);

const server = http.createServer((req, res) => {
  fs.writeFileSync(headerFile, req.headers.authorization ?? '');
  res.writeHead(200);
  res.end('ok');
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    process.exit(1);
  }
  fs.writeFileSync(portFile, String(address.port));
});
JS

node "$SERVER_FILE" "$PORT_FILE" "$HEADER_FILE" &
SERVER_PID=$!

for _ in {1..100}; do
  [[ -s "$PORT_FILE" ]] && break
  sleep 0.05
done

if [[ ! -s "$PORT_FILE" ]]; then
  echo "FAIL: local HTTP server did not start" >&2
  exit 1
fi

TOKEN="sentinel-config-token"
ap_auth_init "$TOKEN"

PORT=$(cat "$PORT_FILE")
if ! curl -sS --fail --noproxy '*' --config "$AP_CURL_CONFIG" \
  "http://127.0.0.1:${PORT}/" >/dev/null; then
  echo "FAIL: curl request failed" >&2
  exit 1
fi

wait "$SERVER_PID"
SERVER_PID=

ACTUAL=$(cat "$HEADER_FILE")
if [[ "$ACTUAL" != "Bearer ${TOKEN}" ]]; then
  echo "FAIL: Authorization header was not parsed from the curl config" >&2
  exit 1
fi

echo "  ok   real curl receives the Authorization header from its config"
