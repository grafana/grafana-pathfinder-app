#!/usr/bin/env bash
# upsert-guide.sh — create or update an InteractiveGuide via the
# Pathfinder Backend aggregator API.
#
# This is a convenience wrapper around the Kubernetes-style API at
# `/apis/pathfinderbackend.ext.grafana.app/v1alpha1/.../interactiveguides`
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
#     [--namespace <stacks-XXXX>] [--annotation key=value]...
#
# Example:
#   scripts/upsert-guide.sh \
#     --stack learn.grafana.net \
#     --token "$GRAFANA_SA_TOKEN" \
#     --spec ./my-guide.json
#
# The spec file may be either a bare InteractiveGuide spec or a full
# Kubernetes envelope (e.g. the editor's Library → Export); the script
# auto-detects the format. Missing fields default to
# `status: "published"` and `schemaVersion: "1.0.0"`, and `spec.id` is
# backfilled from the slugified title when absent — so a guide JSON
# containing just `title` and `blocks` uploads as-is.
#
# Requirements:
#   - curl, jq
#   - A Grafana service-account token with at least the Editor role
#   - The aggregator (`pathfinderbackend.ext.grafana.app/v1alpha1`)
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
Usage: $(basename "$0") --stack <host> --token <token> --spec <file> [--namespace <ns>]

Required:
  -s, --stack       Grafana stack hostname (e.g. learn.grafana.net or
                    <stack>.grafana.net). Without scheme.
  -t, --token       Service-account token (glsa_...) with Editor role.
  -f, --spec        Path to a JSON file containing the InteractiveGuide.
                    Either a bare spec or a full Kubernetes envelope
                    (e.g. from Library → Export); format is auto-detected.

Optional:
  -n, --namespace   Override stack namespace (e.g. stacks-12345). Auto-
                    detected from /api/frontend/settings if omitted.
  -a, --annotation  key=value to record in metadata.annotations. Repeatable.
                    On update, merged into the resource's existing
                    annotations rather than replacing them.
  -h, --help        Show this message.

Defaults applied to the spec when missing:
  status            "published"  (set "status": "draft" in the spec to override)
  schemaVersion     "1.0.0"
  id                slugified from .title

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
ANNOTATIONS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--stack) STACK="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -f|--spec) SPEC="$2"; shift 2 ;;
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    -a|--annotation) ANNOTATIONS+=("$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "$STACK" && -n "$TOKEN" && -n "$SPEC" ]] || { usage >&2; exit 64; }
[[ -r "$SPEC" ]] || { echo "spec file not readable: $SPEC" >&2; exit 66; }

command -v curl >/dev/null || { echo "curl is required but not installed" >&2; exit 127; }
command -v jq >/dev/null || { echo "jq is required but not installed" >&2; exit 127; }

# Fold --annotation key=value pairs into an object. Validated here so a
# malformed pair fails before any network call. Splits on the first "=" so
# values may contain further "=".
ANNOTATIONS_JSON=$(printf '%s\n' ${ANNOTATIONS[@]+"${ANNOTATIONS[@]}"} | jq -Rs '
  split("\n") | map(select(length > 0))
  | map(
      (index("=")) as $i
      | if $i == null or $i == 0
        then error("--annotation must be key=value, got: " + .)
        else {key: .[0:$i], value: .[$i+1:]}
        end
    )
  | from_entries
') || exit 64

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

# Auto-detect the input format. A full Kubernetes envelope has
# top-level `apiVersion` and an object `spec`; anything else is a
# bare spec.
IS_ENVELOPE=$(jq -r '
  if (has("apiVersion") and has("spec") and (.spec | type) == "object")
  then "yes" else "no" end
' "$SPEC")
if [[ "$IS_ENVELOPE" == "yes" ]]; then
  SPEC_JSON=$(jq '.spec' "$SPEC")
else
  SPEC_JSON=$(jq '.' "$SPEC")
fi

# Apply defaults for fields the CRD requires that authors commonly
# omit. Existing values are preserved — set "status": "draft" in the
# spec to upload as a draft instead of published.
SPEC_JSON=$(echo "$SPEC_JSON" | jq '
  (if (.schemaVersion // "") == "" then .schemaVersion = "1.0.0" else . end)
  | (if (.status // "") == "" then .status = "published" else . end)
')

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

# Backfill spec.id from the derived slug when missing, so the
# persisted spec round-trips with a stable identifier.
if [[ -z "$(echo "$SPEC_JSON" | jq -r '.id // ""')" ]]; then
  SPEC_JSON=$(echo "$SPEC_JSON" | jq --arg id "$NAME" '.id = $id')
fi

BASE="https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NAMESPACE}/interactiveguides"

# Writes the envelope and prints the response. Deliberately not `curl -f`:
# on a rejection the K8s Status body names the offending field, and -f
# discards it.
write_resource() {
  local method="$1" url="$2" payload="$3" response code body
  response=$(curl -sS -w $'\n%{http_code}' -X "$method" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    "$url" -d "$payload")
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$code" != 2* ]]; then
    local detail
    detail=$(echo "$body" | jq -r '.message // empty' 2>/dev/null) || detail=
    [[ -n "$detail" ]] || detail="$body"
    echo "${method} ${url} failed: HTTP ${code}" >&2
    echo "$detail" >&2
    return 1
  fi
  echo "$body"
}

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
    # Merge our annotations over the resource's existing ones so a PUT
    # doesn't drop annotations set by the editor or another tool.
    EXISTING_ANN=$(echo "$BODY" | jq '.metadata.annotations // {}')
    ENVELOPE=$(jq -n \
      --arg name "$NAME" --arg ns "$NAMESPACE" --arg rv "$RESOURCE_VERSION" \
      --argjson spec "$SPEC_JSON" \
      --argjson existingAnn "$EXISTING_ANN" --argjson ann "$ANNOTATIONS_JSON" \
      '($existingAnn + $ann) as $merged
      | {
        apiVersion: "pathfinderbackend.ext.grafana.app/v1alpha1",
        kind: "InteractiveGuide",
        metadata: ({ name: $name, namespace: $ns, resourceVersion: $rv }
          + (if ($merged | length) > 0 then { annotations: $merged } else {} end)),
        spec: $spec
      }')
    echo "Updating ${NAME} (resourceVersion=${RESOURCE_VERSION})..." >&2
    write_resource PUT "${BASE}/${NAME}" "$ENVELOPE"
    ;;
  404)
    ENVELOPE=$(jq -n \
      --arg name "$NAME" --arg ns "$NAMESPACE" \
      --argjson spec "$SPEC_JSON" --argjson ann "$ANNOTATIONS_JSON" \
      '{
        apiVersion: "pathfinderbackend.ext.grafana.app/v1alpha1",
        kind: "InteractiveGuide",
        metadata: ({ name: $name, namespace: $ns }
          + (if ($ann | length) > 0 then { annotations: $ann } else {} end)),
        spec: $spec
      }')
    echo "Creating ${NAME}..." >&2
    write_resource POST "${BASE}" "$ENVELOPE"
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
