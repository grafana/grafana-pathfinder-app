#!/usr/bin/env bash
# app-platform.sh — helpers shared by the InteractiveGuide authoring scripts.
# Sourced, never executed.
#
# Owns the three things upsert-guide.sh and upsert-learning-path.sh have to
# agree on: the slug rule that decides a resource's identity, how a stack
# hostname is accepted, and how a credentialed request to the aggregator is
# built. Each existed in both scripts before, and resource naming is the very
# contract they warn callers about.

# metadata.name derivation. Mirrors
# src/components/block-editor/hooks/useBackendGuides.ts so a guide imported by
# these scripts and one saved by the block editor land on the same name.
ap_slugify() {
  echo "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+|-+$//g'
}

# `$2` is unbound under `set -u` when an option is passed without a value, so
# without this the script dies on a bash internal message instead of the usage
# code its own contract documents.
ap_require_value() {
  [[ -n "${2:-}" ]] || {
    echo "$1 requires a value" >&2
    exit 64
  }
}

ap_normalize_stack() {
  local stack="$1"
  stack="${stack#https://}"
  stack="${stack#http://}"
  printf '%s' "${stack%/}"
}

# One DNS hostname, optionally with a port. The token rides on every request as
# an Authorization header, so a --stack carrying userinfo (`trusted@attacker`),
# a path, or a brace expansion would hand it to whatever curl resolved instead.
ap_validate_stack() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]] || {
    echo "--stack must be a single hostname with an optional port, got: $1" >&2
    echo "Pass the bare host (learn.grafana.net), no scheme, path or credentials." >&2
    exit 64
  }
}

AP_CURL_CONFIG=

# curl reads the Authorization header from a 0600 config file rather than an
# argv -H, so the token is not exposed in the process table for the length of a
# multi-resource run. Unquoted on purpose: curl takes the rest of the line
# verbatim, which quoting would subject to backslash escaping.
ap_auth_init() {
  AP_CURL_CONFIG=$(mktemp)
  printf 'header = Authorization: Bearer %s\n' "$1" >"$AP_CURL_CONFIG"
}

ap_auth_cleanup() {
  [[ -z "$AP_CURL_CONFIG" ]] || rm -f "$AP_CURL_CONFIG"
}

# --globoff makes brackets and braces in a URL literal rather than a request
# multiplier; --proto '=https' stops a typo or redirect carrying the token over
# cleartext.
ap_curl() {
  curl -sS --globoff --proto '=https' --config "$AP_CURL_CONFIG" "$@"
}

ap_guides_url() {
  printf 'https://%s/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/%s/interactiveguides' "$1" "$2"
}

ap_detect_namespace() {
  ap_curl -f "https://${1}/api/frontend/settings" | jq -r '.namespace // empty'
}
