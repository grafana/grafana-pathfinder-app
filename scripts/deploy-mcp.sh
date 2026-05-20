#!/usr/bin/env bash
# Manual deployment script for the Pathfinder authoring MCP server to Cloud Run.
#
# This is the committed version. The previous (gitignored) deploy-mcp.sh at
# the repo root is now a stale copy; once this version is exercised in dev
# and trusted, delete the root copy.
#
# Hardcoded to the your-gcp-project project / us-central1 region for a
# one-developer manual deploy loop. Project + region remain hardcoded as the
# next axis to parameterize when staging / prod arrive.
#
# Environment selection (P7 — GCS-backed authoring sessions):
#   The script is parameterized by --env (default: dev) so dev / staging / prod
#   can co-exist later. Only `dev` is exercised today. The Cloud Run service
#   name itself stays env-agnostic for now so the existing dev URL does not
#   move; bucket + service account are env-scoped.
#
# Usage:
#   scripts/deploy-mcp.sh                       # build + push + deploy at HEAD's short sha, env=dev
#   scripts/deploy-mcp.sh <tag>                 # use a custom tag, env=dev
#   scripts/deploy-mcp.sh --env=dev             # explicit env (currently same as default)
#   scripts/deploy-mcp.sh --env=dev <tag>       # env + tag
#   scripts/deploy-mcp.sh --skip-build          # redeploy the most recently pushed tag
#
# Prereqs (one-time):
#   gcloud auth login
#   gcloud auth configure-docker us-central1-docker.pkg.dev
#   docker buildx create --use   # if you don't already have a buildx builder

set -euo pipefail

PROJECT_ID="your-gcp-project"
REGION="us-central1"
REPO="pathfinder"
SERVICE="pathfinder-mcp"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

ENV_NAME="dev"

SKIP_BUILD=0
TAG=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --env=*) ENV_NAME="${arg#--env=}" ;;
    -h|--help)
      sed -n '2,28p' "$0"
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

BUCKET="pathfinder-mcp-${ENV_NAME}"
SERVICE_ACCOUNT_ID="pathfinder-mcp-${ENV_NAME}"
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
# The bucket holds ephemeral authoring sessions written by `pathfinder-mcp`
# under `<session-token>/{content,manifest}.json`. Per P7 design:
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
LIFECYCLE_FILE="$(mktemp -t pathfinder-mcp-lifecycle.XXXXXX.json)"
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
    --description="Cloud Run identity for pathfinder-mcp in env=${ENV_NAME}; scoped to gs://${BUCKET}" \
    --quiet
fi

echo "==> granting roles/storage.objectAdmin on gs://${BUCKET} to ${SERVICE_ACCOUNT_EMAIL}..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --condition=None \
  --quiet >/dev/null

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
# Deploy. The image's ENTRYPOINT routes the first arg "mcp" to pathfinder-mcp;
# we pass --transport http so Cloud Run can talk to it over HTTP/1.1.
# --allow-unauthenticated matches the resolved P3 decision (open + edge
# mitigations); flip to --no-allow-unauthenticated for IAM-gated testing.
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
echo "Wire an agent:"
echo "  claude mcp add --transport http pathfinder ${URL}/mcp"
