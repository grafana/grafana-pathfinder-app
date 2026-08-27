#!/bin/sh
set -eu

exec node /app/dist/cli/cli/index.js e2e "$@"
