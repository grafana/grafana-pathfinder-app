#!/usr/bin/env bash
# upsert-guide.sh — create or update an InteractiveGuide via the
# Pathfinder Backend aggregator API.
#
# This is a convenience wrapper around the Kubernetes-style API at
# `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/.../interactiveguides`
# served by Grafana Cloud. It does what callers would otherwise have
# to write themselves: derive a slugified resource name, GET the
# existing resource (if any) to discover its `resourceVersion`, then
# POST (create) or PUT (update) accordingly.
#
# Usage:
#   scripts/upsert-guide.sh \
#     --stack <hostname> \
#     --token <service-account-token> \
#     --spec <path-to-spec.json> \
#     [--namespace <stacks-XXXX>]
#
# Example:
#   scripts/upsert-guide.sh \
#     --stack learn.grafana.net \
#     --token "$GRAFANA_SA_TOKEN" \
#     --spec ./my-guide.json
#
# The spec file should contain just the InteractiveGuide spec (no
# Kubernetes envelope). The editor's Library → Export emits a full
# K8s envelope; strip it with `jq .spec my-export.json > my-spec.json`
# first, or pass --from-export to skip the strip.
#
# Requirements:
#   - curl, jq
#   - A Grafana service-account token with at least the Editor role
#   - The aggregator (`pathfinderbackend.ext.grafana.com/v1alpha1`)
#     must be enabled on the stack — true for Grafana Cloud, not for
#     OSS Grafana
#
# Exit codes:
#   0  success
#   1  argument / spec / aggregator error
#   64 usage error
#   66 spec file not readable
#   127 missing curl/jq

set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") --stack <host> --token <token> --spec <file> [--namespace <ns>] [--from-export]

Required:
  -s, --stack       Grafana stack hostname (e.g. learn.grafana.net or
                    <stack>.grafana.net). Without scheme.
  -t, --token       Service-account token (glsa_...) with Editor role.
  -f, --spec        Path to a JSON file containing the InteractiveGuide
                    spec (the editor's spec field, without K8s envelope).

Optional:
  -n, --namespace   Override stack namespace (e.g. stacks-12345). Auto-
                    detected from /api/frontend/settings if omitted.
      --from-export Treat --spec as a full editor export (with K8s
                    envelope) and read \`.spec\` from it instead of
                    using the file as-is.
  -h, --help        Show this message.

Reads the spec, derives a slugified resource name from spec.id (or
spec.title), GETs the existing guide to discover its resourceVersion,
then POSTs (create) or PUTs (update) accordingly. Prints the resulting
resource as JSON on stdout.
EOF
}

STACK=
TOKEN=
SPEC=
NAMESPACE=
FROM_EXPORT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--stack) STACK="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -f|--spec) SPEC="$2"; shift 2 ;;
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    --from-export) FROM_EXPORT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "$STACK" && -n "$TOKEN" && -n "$SPEC" ]] || { usage >&2; exit 64; }
[[ -r "$SPEC" ]] || { echo "spec file not readable: $SPEC" >&2; exit 66; }

command -v curl >/dev/null || { echo "curl is required but not installed" >&2; exit 127; }
command -v jq >/dev/null || { echo "jq is required but not installed" >&2; exit 127; }

# Strip scheme if the caller accidentally included one.
STACK="${STACK#https://}"
STACK="${STACK#http://}"
STACK="${STACK%/}"

# Slug rule mirrors src/components/block-editor/hooks/useBackendGuides.ts:110-116
# so guides imported via this script and saved via the editor share names.
slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+|-+$//g'
}

# Auto-detect namespace if not provided.
if [[ -z "$NAMESPACE" ]]; then
  NAMESPACE=$(curl -sSf -H "Authorization: Bearer ${TOKEN}" "https://${STACK}/api/frontend/settings" \
    | jq -r '.namespace // empty') || true
  if [[ -z "$NAMESPACE" ]]; then
    echo "could not auto-detect namespace from /api/frontend/settings; pass --namespace explicitly" >&2
    exit 1
  fi
fi

# Extract the spec object — either the file as-is, or .spec from a
# full editor export.
if (( FROM_EXPORT )); then
  SPEC_JSON=$(jq '.spec' "$SPEC")
  if [[ "$SPEC_JSON" == "null" ]]; then
    echo "--from-export was set but $SPEC has no .spec field" >&2
    exit 1
  fi
else
  SPEC_JSON=$(jq '.' "$SPEC")
fi

RAW_NAME=$(echo "$SPEC_JSON" | jq -r '.id // .title // empty')
if [[ -z "$RAW_NAME" ]]; then
  echo "spec must include an 'id' or 'title' to derive a resource name" >&2
  exit 1
fi
NAME=$(slugify "$RAW_NAME")
if [[ -z "$NAME" ]]; then
  echo "spec.id/.title produced an empty slug after sanitisation" >&2
  exit 1
fi

BASE="https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NAMESPACE}/interactiveguides"

# GET to decide between create and update. We intentionally accept any
# status here so we can branch on it; -f would exit on non-2xx.
RESPONSE=$(curl -sS -w $'\n%{http_code}' -H "Authorization: Bearer ${TOKEN}" "${BASE}/${NAME}")
HTTP_CODE="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"

case "$HTTP_CODE" in
  200)
    RESOURCE_VERSION=$(echo "$BODY" | jq -r '.metadata.resourceVersion')
    if [[ -z "$RESOURCE_VERSION" || "$RESOURCE_VERSION" == "null" ]]; then
      echo "GET ${BASE}/${NAME} returned 200 but no metadata.resourceVersion" >&2
      exit 1
    fi
    ENVELOPE=$(jq -n \
      --arg name "$NAME" --arg ns "$NAMESPACE" --arg rv "$RESOURCE_VERSION" \
      --argjson spec "$SPEC_JSON" \
      '{
        apiVersion: "pathfinderbackend.ext.grafana.com/v1alpha1",
        kind: "InteractiveGuide",
        metadata: { name: $name, namespace: $ns, resourceVersion: $rv },
        spec: $spec
      }')
    echo "Updating ${NAME} (resourceVersion=${RESOURCE_VERSION})..." >&2
    curl -sSf -X PUT \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      "${BASE}/${NAME}" -d "$ENVELOPE"
    ;;
  404)
    ENVELOPE=$(jq -n \
      --arg name "$NAME" --arg ns "$NAMESPACE" \
      --argjson spec "$SPEC_JSON" \
      '{
        apiVersion: "pathfinderbackend.ext.grafana.com/v1alpha1",
        kind: "InteractiveGuide",
        metadata: { name: $name, namespace: $ns },
        spec: $spec
      }')
    echo "Creating ${NAME}..." >&2
    curl -sSf -X POST \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      "${BASE}" -d "$ENVELOPE"
    ;;
  401)
    echo "Authentication failed (HTTP 401). Check the service-account token." >&2
    exit 1
    ;;
  403)
    echo "Authorization failed (HTTP 403). The token's role probably lacks write on interactiveguides." >&2
    exit 1
    ;;
  *)
    echo "unexpected response from GET ${BASE}/${NAME}: HTTP ${HTTP_CODE}" >&2
    echo "$BODY" >&2
    exit 1
    ;;
esac
