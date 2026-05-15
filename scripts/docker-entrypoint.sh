#!/bin/sh
# Pathfinder CLI image entrypoint.
#
# Routes the container's first positional argument. When the first arg is
# the literal string "mcp" we forward to `pathfinder-cli mcp`; otherwise
# everything is passed straight to `pathfinder-cli`. See Dockerfile.cli for
# routing examples.

set -e

if [ "$1" = "mcp" ]; then
  shift
  exec pathfinder-cli mcp "$@"
fi

exec pathfinder-cli "$@"
