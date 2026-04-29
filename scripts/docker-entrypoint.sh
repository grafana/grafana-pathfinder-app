#!/bin/sh
# Pathfinder CLI/MCP image entrypoint.
#
# Routes the container's first positional argument to either pathfinder-cli
# (default) or pathfinder-mcp (when the first arg is the literal string
# "mcp"). See Dockerfile.cli for routing examples.

set -e

if [ "$1" = "mcp" ]; then
  shift
  exec pathfinder-mcp "$@"
fi

exec pathfinder-cli "$@"
