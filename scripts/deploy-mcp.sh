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
#
# Optional env:
#   PATHFINDER_DEPLOY_ENV             Env scope label (default: dev). Cosmetic
#                                     only; must be lowercase alnum/hyphen,
#                                     3–20 chars.
#   PATHFINDER_SESSION_TTL_HOURS      Sliding session TTL (default: 24).
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

PROJECT_ID="${PATHFINDER_GCP_PROJECT_ID}"
REGION="${PATHFINDER_GCP_REGION}"
REPO="${PATHFINDER_GCP_AR_REPO}"
SERVICE="${PATHFINDER_GCP_SERVICE_NAME}"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

# Dedicated runtime identity with zero role bindings. The MCP touches no GCP
# resource, so it needs no permissions — but a public, unauthenticated service
# must not run as the default compute SA, whose project-wide roles would be the
# blast radius of any compromise. SA id must fit GCP's 6–30 char limit.
SERVICE_ACCOUNT_ID="${SERVICE}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

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

# Validate env name early — cosmetic label only. Lowercase, alphanumeric,
# hyphens, 3–20 chars.
if ! [[ "${ENV_NAME}" =~ ^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$ ]]; then
  echo "error: --env must match ^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$ (got: ${ENV_NAME})" >&2
  exit 1
fi

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
echo "==> sa        : ${SERVICE_ACCOUNT_EMAIL} (no roles)"
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
# Create the runtime SA if absent (rationale at its definition above).
# ---------------------------------------------------------------------------

if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1; then
  echo "==> creating runtime service account '${SERVICE_ACCOUNT_EMAIL}' (no roles)..."
  gcloud iam service-accounts create "${SERVICE_ACCOUNT_ID}" \
    --display-name="Pathfinder MCP runtime (no roles)" \
    --quiet
  # SA creation is eventually consistent; wait until describe resolves so the
  # `gcloud run deploy --service-account` reference doesn't 400 on a cold project.
  for attempt in $(seq 1 30); do
    gcloud iam service-accounts describe "${SERVICE_ACCOUNT_EMAIL}" >/dev/null 2>&1 && break
    if [ "${attempt}" -eq 30 ]; then
      echo "error: service account ${SERVICE_ACCOUNT_EMAIL} did not become visible after 60s" >&2
      exit 1
    fi
    sleep 2
  done
fi

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
# Sessions live in the process's memory (see `src/cli/mcp/lib/session-store.ts`),
# so the service MUST run as a single always-on instance: --min/--max-instances=1
# keeps every session on one process and avoids cold-start eviction. Authoring is
# low-QPS and human-paced, so one instance at concurrency 80 is ample. A redeploy
# or instance recycle drops in-flight sessions — acceptable for short-lived drafts.
# ---------------------------------------------------------------------------

echo "==> deploying ${SERVICE} to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SERVICE_ACCOUNT_EMAIL}" \
  --port=8080 \
  --args=mcp,--transport,http,--host,0.0.0.0,--port,8080 \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=60s \
  --quiet

URL="$(gcloud run services describe "${SERVICE}" --region="${REGION}" --format='value(status.url)')"

echo
echo "✓ deployed: ${URL}"
echo "  endpoint: ${URL}/mcp"
echo "  runtime : ${SERVICE_ACCOUNT_EMAIL} (no roles)"
echo "  sessions: in-memory — ⚠ DO NOT raise --max-instances above 1; sessions are process-local and >1 instance scatters them (SESSION_NOT_FOUND mid-authoring)"
echo
echo "Smoke test:"
echo "  curl -sX POST '${URL}/mcp' \\"
echo "    -H 'content-type: application/json' \\"
echo "    -H 'accept: application/json, text/event-stream' \\"
echo "    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"smoke\",\"version\":\"0\"}}}'"
echo
echo "Wire an agent:"
echo "  claude mcp add --transport http pathfinder ${URL}/mcp"
