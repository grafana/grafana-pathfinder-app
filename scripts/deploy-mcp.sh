#!/usr/bin/env bash
# Manual deployment script for the Pathfinder authoring MCP server to Cloud Run.
#
# This script holds NO secrets, project IDs, region names, or service-account
# identifiers in tracked source. Everything operator-specific is read from a
# gitignored `.env` file (or pre-set environment variables) so the same script
# works for any developer's GCP project. Copy `.env.example` to `.env`, fill
# it in, and run.
#
# Required env (see `.env.example`):
#   PATHFINDER_GCP_PROJECT_ID         GCP project to deploy into.
#   PATHFINDER_GCP_REGION             Cloud Run region (e.g. us-central1).
#   PATHFINDER_GCP_AR_REPO            Artifact Registry repo name.
#   PATHFINDER_GCP_SERVICE_NAME       Cloud Run service name.
#   PATHFINDER_GCP_RESOURCE_PREFIX    Prefix for bucket + service-account ids.
#
# Optional env:
#   PATHFINDER_DEPLOY_ENV             Env scope name (default: dev). Used in
#                                     bucket + SA names; must be lowercase
#                                     alnum/hyphen, 3–20 chars.
#
# Usage:
#   scripts/deploy-mcp.sh                       # build + push + deploy at HEAD's short sha
#   scripts/deploy-mcp.sh <tag>                 # use a custom tag
#   scripts/deploy-mcp.sh --env=dev             # explicit env override
#   scripts/deploy-mcp.sh --env=dev <tag>       # env + tag
#   scripts/deploy-mcp.sh --skip-build          # redeploy the most recently pushed tag
#
# Prereqs (one-time):
#   gcloud auth login
#   gcloud auth configure-docker <region>-docker.pkg.dev
#   docker buildx create --use   # if you don't already have a buildx builder

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Handle --help / -h before doing anything else (no env needed for help).
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Load operator config from .env (gitignored). Lines are KEY=VALUE; blank
# lines and comments allowed. `set -a` exports everything we source so the
# values land in the script's environment without each line needing `export`.
# ---------------------------------------------------------------------------

ENV_FILE="${PATHFINDER_DEPLOY_ENV_FILE:-${REPO_ROOT}/.env}"
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "error: ${name} is required (set it in ${ENV_FILE} or export it)" >&2
    echo "       see .env.example for the full list" >&2
    exit 1
  fi
}

require_env PATHFINDER_GCP_PROJECT_ID
require_env PATHFINDER_GCP_REGION
require_env PATHFINDER_GCP_AR_REPO
require_env PATHFINDER_GCP_SERVICE_NAME
require_env PATHFINDER_GCP_RESOURCE_PREFIX

PROJECT_ID="${PATHFINDER_GCP_PROJECT_ID}"
REGION="${PATHFINDER_GCP_REGION}"
REPO="${PATHFINDER_GCP_AR_REPO}"
SERVICE="${PATHFINDER_GCP_SERVICE_NAME}"
RESOURCE_PREFIX="${PATHFINDER_GCP_RESOURCE_PREFIX}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

ENV_NAME="${PATHFINDER_DEPLOY_ENV:-dev}"

SKIP_BUILD=0
TAG=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --env=*) ENV_NAME="${arg#--env=}" ;;
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    *) TAG="$arg" ;;
  esac
done

# Validate env name early — used in resource names; must be safe for GCS bucket
# names and IAM service account ids. Lowercase, alphanumeric, hyphens, 3–20 chars.
if ! [[ "${ENV_NAME}" =~ ^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$ ]]; then
  echo "error: --env must match ^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$ (got: ${ENV_NAME})" >&2
  exit 1
fi

BUCKET="${RESOURCE_PREFIX}-${ENV_NAME}"
SERVICE_ACCOUNT_ID="${RESOURCE_PREFIX}-${ENV_NAME}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

if [ -z "$TAG" ]; then
  TAG="$(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    TAG="${TAG}-dirty"
  fi
fi
IMAGE="${IMAGE_BASE}:${TAG}"

echo "==> project   : ${PROJECT_ID}"
echo "==> region    : ${REGION}"
echo "==> env       : ${ENV_NAME}"
echo "==> service   : ${SERVICE}"
echo "==> bucket    : gs://${BUCKET}"
echo "==> sa        : ${SERVICE_ACCOUNT_EMAIL}"
echo "==> image     : ${IMAGE}"
echo

# ---------------------------------------------------------------------------
# Idempotent preflight: project, APIs, Artifact Registry repo.
# Cheap to re-run; quietly no-ops once everything is in place.
# ---------------------------------------------------------------------------

gcloud config set project "${PROJECT_ID}" --quiet >/dev/null

echo "==> ensuring required APIs are enabled..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com \
  --quiet >/dev/null

if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" >/dev/null 2>&1; then
  echo "==> creating Artifact Registry repo '${REPO}' in ${REGION}..."
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Pathfinder authoring MCP images" \
    --quiet
fi

# ---------------------------------------------------------------------------
# Idempotent preflight: GCS session bucket + 7-day lifecycle rule + SA + IAM.
#
# The bucket holds ephemeral authoring sessions written by the deployed
# service under `<session-token>/{content,manifest,generation,.pin}`. Per
# P7 design:
#   - uniform bucket-level access (no per-object ACLs)
#   - public-access-prevention (no public access, ever)
#   - 7-day lifecycle delete (debug-only retention; happy-path drafts evict
#     explicitly on finalize)
#   - dedicated SA per env, scoped to this bucket only — never project-wide
# ---------------------------------------------------------------------------

if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  echo "==> creating GCS bucket 'gs://${BUCKET}' in ${REGION}..."
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention \
    --quiet
fi

echo "==> applying 7-day lifecycle rule to gs://${BUCKET}..."
LIFECYCLE_FILE="$(mktemp -t pathfinder-lifecycle.XXXXXX.json)"
trap 'rm -f "${LIFECYCLE_FILE}"' EXIT
cat >"${LIFECYCLE_FILE}" <<'JSON'
{
  "lifecycle": {
    "rule": [
      {
        "action": { "type": "Delete" },
        "condition": { "age": 7 }
      }
    ]
  }
}
JSON
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="${LIFECYCLE_FILE}" \
  --quiet >/dev/null

if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
  echo "==> creating service account '${SERVICE_ACCOUNT_EMAIL}'..."
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_ID}" \
    --display-name="Pathfinder MCP (${ENV_NAME})" \
    --description="Cloud Run identity for ${SERVICE} in env=${ENV_NAME}; scoped to gs://${BUCKET}" \
    --quiet

  # IAM propagation is eventually consistent — a freshly-created SA is not
  # immediately visible to the IAM policy binding API. Poll until describe
  # succeeds against the SA before issuing any binding that references it.
  # Without this, the next `add-iam-policy-binding` call fails with a 400
  # "Service account does not exist" on a cold project.
  echo "==> waiting for service account to propagate..."
  for attempt in $(seq 1 30); do
    if gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
      break
    fi
    if [ "${attempt}" -eq 30 ]; then
      echo "error: service account ${SERVICE_ACCOUNT_EMAIL} did not become visible after 60s" >&2
      exit 1
    fi
    sleep 2
  done
fi

echo "==> granting roles/storage.objectAdmin on gs://${BUCKET} to ${SERVICE_ACCOUNT_EMAIL}..."
# Even after `describe` succeeds, the binding API sometimes lags by a few
# seconds. Retry the binding itself on transient "does not exist" 400s.
for attempt in $(seq 1 10); do
  if gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
      --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
      --role="roles/storage.objectAdmin" \
      --condition=None \
      --quiet >/dev/null 2>&1; then
    break
  fi
  if [ "${attempt}" -eq 10 ]; then
    echo "error: IAM binding for ${SERVICE_ACCOUNT_EMAIL} on gs://${BUCKET} failed after 10 retries" >&2
    # Surface the actual error on the last try (without 2>/dev/null) so the operator sees the cause.
    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
      --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
      --role="roles/storage.objectAdmin" \
      --condition=None \
      --quiet
    exit 1
  fi
  sleep 3
done

# ---------------------------------------------------------------------------
# Build (linux/amd64 — matches Cloud Run regardless of host arch) and push.
# ---------------------------------------------------------------------------

if [ "${SKIP_BUILD}" -eq 1 ]; then
  echo "==> --skip-build set; assuming ${IMAGE} already exists in the registry."
else
  echo "==> building ${IMAGE} for linux/amd64..."
  docker buildx build \
    --platform linux/amd64 \
    -f Dockerfile.cli \
    -t "${IMAGE}" \
    --push \
    .
fi

# ---------------------------------------------------------------------------
# Deploy. The image's ENTRYPOINT routes the first arg "mcp" to the MCP
# subcommand; we pass --transport http so Cloud Run can talk to it over
# HTTP/1.1. --allow-unauthenticated matches the resolved P3 decision
# (open + edge mitigations); flip to --no-allow-unauthenticated for
# IAM-gated testing.
#
# PATHFINDER_SESSION_STORE=gcs activates the GCS-backed session store wired
# in P7 phase A. The in-memory default is used everywhere except this
# deployed service (and any other --set-env-vars caller).
# ---------------------------------------------------------------------------

echo "==> deploying ${SERVICE} to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SERVICE_ACCOUNT_EMAIL}" \
  --port=8080 \
  --args=mcp,--transport,http,--host,0.0.0.0,--port,8080 \
  --set-env-vars="PATHFINDER_SESSION_STORE=gcs,PATHFINDER_SESSION_BUCKET=${BUCKET}" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --max-instances=10 \
  --timeout=60s \
  --quiet

URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)')"

echo
echo "✓ deployed: ${URL}"
echo "  endpoint: ${URL}/mcp"
echo "  bucket:   gs://${BUCKET}  (env=${ENV_NAME}, 7-day TTL)"
echo
echo "Smoke test:"
echo "  curl -sX POST '${URL}/mcp' \\"
echo "    -H 'content-type: application/json' \\"
echo "    -H 'accept: application/json, text/event-stream' \\"
echo "    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"version\":\"0\"}}}'"
echo
echo "End-to-end session-mode smoke:"
echo "  npx tsx scripts/smoke-gcs-sessions.ts --url=${URL}/mcp --hops=25"
echo
echo "Wire an agent:"
echo "  claude mcp add --transport http pathfinder ${URL}/mcp"
