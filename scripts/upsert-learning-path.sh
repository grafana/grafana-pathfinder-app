#!/usr/bin/env bash
# upsert-learning-path.sh — upload a package directory (learning path,
# journey, or standalone guide) to the Pathfinder Backend aggregator API.
#
# A package is a directory holding `manifest.json` + `content.json`, the
# two-file model used by grafana/interactive-tutorials. For a
# `type: "path"` or `type: "journey"` manifest this uploads every guide
# listed in `milestones`, then the path's own cover page — so the path
# never references a guide that does not exist yet. For `type: "guide"`
# it uploads the single package.
#
# Each package becomes one InteractiveGuide resource whose `spec.manifest`
# carries the package metadata. Per-resource create/update is delegated to
# upsert-guide.sh.
#
# Usage:
#   scripts/upsert-learning-path.sh \
#     --stack <hostname> \
#     --token <service-account-token> \
#     --package <path-to-package-dir> \
#     [--namespace <stacks-XXXX>] [--status draft|published] \
#     [--repository <name>] [--dry-run] [--verbose] \
#     [--continue-on-error] [--strict-blocks] [--overwrite]
#
# Example:
#   scripts/upsert-learning-path.sh \
#     --stack learn.grafana.net \
#     --token "$GRAFANA_SA_TOKEN" \
#     --package ~/Repos/interactive-tutorials/drilldown-logs-lj
#
# A milestone ID in `manifest.milestones` is the `id` field inside a
# subdirectory's own `manifest.json`, not the subdirectory name
# (`drilldown-logs-view-logs` lives in `view-logs/`). Subdirectories absent
# from `milestones` are ignored, which is what keeps website-only prelude
# pages (`business-value-*`) out of the upload.
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
#   1  argument / package / aggregator error, a refused overwrite, or a
#      --dry-run in which any resource failed to validate
#   64 usage error
#   66 package directory or file not readable
#   127 missing curl/jq

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
UPSERT_GUIDE="${SCRIPT_DIR}/upsert-guide.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") --stack <host> --token <token> --package <dir> [options]

Required:
  -s, --stack       Grafana stack hostname (e.g. learn.grafana.net or
                    <stack>.grafana.net). Without scheme.
  -t, --token       Service-account token (glsa_...) with Editor role.
  -p, --package     Package directory containing manifest.json and
                    content.json. For a path/journey manifest, milestone
                    guides are read from its subdirectories.

Optional:
  -n, --namespace       Override stack namespace (e.g. stacks-12345). Auto-
                        detected once from /api/frontend/settings if omitted.
      --status          "published" (default) or "draft". Draft packages are
                        hidden from My Learning and the docs panel.
      --repository      Value for manifest.repository. Omitted by default so
                        the CRD default ("app-platform") applies.
      --dry-run         Print what would be uploaded; make no writes.
      --verbose         Print each full spec payload.
      --continue-on-error  Keep going after a failed resource instead of
                        aborting on the first one. The path is then uploaded
                        even if a milestone failed, so it can end up
                        referencing a guide that isn't there.
      --strict-blocks   Fail instead of warning when content uses block
                        fields the InteractiveGuide CRD does not declare.
      --no-manifest     Upload content only, omitting spec.manifest. Escape
                        hatch for stacks whose CRD predates the field; the
                        path's milestone list is not published.
      --overwrite       Allow replacing guides in the namespace that this
                        tool did not upload. Refused by default, because a
                        write replaces spec wholesale and the API keeps no
                        revisions.
  -h, --help            Show this message.

Uploads milestones first and the path cover last. Re-running updates the
resources this tool already uploaded in place; it never deletes, so a
milestone dropped from the manifest is left behind on the stack.
EOF
}

STACK=
TOKEN=
PACKAGE=
NAMESPACE=
STATUS=published
REPOSITORY=
DRY_RUN=false
VERBOSE=false
CONTINUE_ON_ERROR=false
STRICT_BLOCKS=false
NO_MANIFEST=false
OVERWRITE=false

# Provenance written to every resource this tool uploads, so a later run can
# tell its own resources from guides authored elsewhere in the namespace.
MANAGED_BY_KEY="pathfinderbackend.ext.grafana.app/managed-by"
MANAGED_BY_VALUE="upsert-learning-path.sh"
SOURCE_PACKAGE_KEY="pathfinderbackend.ext.grafana.app/source-package"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--stack) STACK="$2"; shift 2 ;;
    -t|--token) TOKEN="$2"; shift 2 ;;
    -p|--package) PACKAGE="$2"; shift 2 ;;
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    --status) STATUS="$2"; shift 2 ;;
    --repository) REPOSITORY="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    --continue-on-error) CONTINUE_ON_ERROR=true; shift ;;
    --strict-blocks) STRICT_BLOCKS=true; shift ;;
    --no-manifest) NO_MANIFEST=true; shift ;;
    --overwrite) OVERWRITE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 64 ;;
  esac
done

[[ -n "$STACK" && -n "$TOKEN" && -n "$PACKAGE" ]] || { usage >&2; exit 64; }
[[ "$STATUS" == "published" || "$STATUS" == "draft" ]] || {
  echo "--status must be \"published\" or \"draft\", got: $STATUS" >&2; exit 64;
}
[[ -d "$PACKAGE" ]] || { echo "package directory not readable: $PACKAGE" >&2; exit 66; }
[[ -x "$UPSERT_GUIDE" ]] || { echo "missing or non-executable helper: $UPSERT_GUIDE" >&2; exit 1; }

command -v curl >/dev/null || { echo "curl is required but not installed" >&2; exit 127; }
command -v jq >/dev/null || { echo "jq is required but not installed" >&2; exit 127; }

PACKAGE="${PACKAGE%/}"

STACK="${STACK#https://}"
STACK="${STACK#http://}"
STACK="${STACK%/}"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

# Slug rule mirrors upsert-guide.sh, which derives metadata.name this way.
slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+|-+$//g'
}

# Block fields the InteractiveGuide CRD declares. Source of truth is
# #Block/#NestedBlock/#Step in grafana-pathfinder-backend/kinds/interactiveguide.cue;
# anything else is pruned or rejected on write, so warn before it silently
# disappears. Recursion stops at depth 3, where the CRD switches to
# x-kubernetes-preserve-unknown-fields.
read -r -d '' UNKNOWN_BLOCK_FIELDS_JQ <<'JQ' || true
def BLOCK: ["action","alt","assistantEnabled","assistantId","assistantType","blocks","checkboxLabel","choices","completeEarly","completionMode","conditions","content","description","display","doIt","formHint","height","hint","id","inputType","lazyRender","maxAttempts","multiSelect","objectives","pattern","placeholder","prompt","provider","question","reftarget","required","requirements","scrollContainer","showMe","skippable","src","stepTimeout","steps","targetvalue","title","tooltip","type","validateInput","validationMessage","variableName","verify","whenFalse","whenFalseSectionConfig","whenTrue","whenTrueSectionConfig","width"];
def STEP: ["action","description","formHint","lazyRender","reftarget","requirements","scrollContainer","skippable","targetvalue","tooltip","validateInput"];
def scan(depth):
  if depth > 2 then empty
  else
    (keys - BLOCK)[],
    ((.steps // [])[] | (keys - STEP)[]),
    ([(.blocks // [])[], (.whenTrue // [])[], (.whenFalse // [])[]][] | scan(depth + 1))
  end;
[.blocks[]? | scan(1)] | unique | join(", ")
JQ

# Maps a source manifest.json onto a CRD-valid spec.manifest: the typed
# fields verbatim, `depends` widened from bare IDs to CNF singleton clauses,
# and every remaining key swept into additionalFields (the CRD's escape
# hatch) so nothing is lost on the way in.
build_manifest() {
  jq --arg repo "$REPOSITORY" '
    ["id","type","repository","description","milestones","author","category","depends"] as $typed
    | . as $m
    | ($m | with_entries(. as $e | select(($typed | index($e.key)) == null and $e.value != null))) as $rest
    | (($m.author // {}) | with_entries(select(.value != null))) as $allAuthor
    | ($allAuthor | {name, team} | with_entries(select(.value != null))) as $author
    # The CRD declares only name and team on #Author, so anything else an
    # author block carries (email, github, ...) would fall between the typed
    # field and additionalFields. Sweep it in rather than drop it.
    | ($allAuthor | del(.name, .team)) as $authorExtra
    | ($rest + (if ($authorExtra | length) > 0 then {author: $authorExtra} else {} end)) as $extra
    | (($m.depends // []) | map(if type == "array" then . else [.] end)) as $depends
    | (($m.type // "") | . == "path" or . == "journey") as $isMeta
    | (if $repo != "" then $repo else ($m.repository // "") end) as $repository
    | {type: $m.type}
    + (if $repository != "" then {repository: $repository} else {} end)
    + (if $m.description != null then {description: $m.description} else {} end)
    + (if $m.category != null then {category: $m.category} else {} end)
    + (if ($author | length) > 0 then {author: $author} else {} end)
    + (if $isMeta and (($m.milestones // []) | length) > 0 then {milestones: $m.milestones} else {} end)
    + (if ($depends | length) > 0 then {depends: $depends} else {} end)
    + (if ($extra | length) > 0 then {additionalFields: $extra} else {} end)
  ' "$1"
}

CREATED=0
UPDATED=0
OVERWROTE=0
FAILED=0
FAILED_NAMES=

# Composes one package directory into a spec and hands it to upsert-guide.sh.
upsert_package() {
  local dir="$1" label="$2" expected_id="$3"
  local manifest="${dir}/manifest.json" content="${dir}/content.json"

  [[ -r "$manifest" ]] || { echo "missing manifest.json in ${dir}" >&2; return 1; }
  [[ -r "$content" ]] || { echo "missing content.json in ${dir}" >&2; return 1; }

  local id title blocks
  id=$(jq -r '.id // empty' "$content")
  title=$(jq -r '.title // empty' "$content")
  blocks=$(jq -r 'if (.blocks | type) == "array" then (.blocks | length) else "" end' "$content")

  [[ -n "$id" ]] || { echo "${dir}/content.json has no .id" >&2; return 1; }
  [[ -n "$title" ]] || { echo "${dir}/content.json has no .title" >&2; return 1; }
  [[ -n "$blocks" ]] || { echo "${dir}/content.json .blocks is missing or not an array" >&2; return 1; }

  if [[ -n "$expected_id" && "$id" != "$expected_id" ]]; then
    echo "${dir}/content.json .id is \"${id}\" but manifest.json declares \"${expected_id}\"" >&2
    return 1
  fi

  # The catalogue and manifest.milestones key on spec.id, while the resolver
  # and backend-guide: URLs GET by metadata.name — which upsert-guide.sh
  # slugifies from spec.id. If they diverge every milestone 404s silently.
  if [[ "$(slugify "$id")" != "$id" ]]; then
    echo "package id \"${id}\" is not a valid resource name (would upload as \"$(slugify "$id")\")." >&2
    echo "spec.id and metadata.name must match or milestone resolution breaks. Rename the package." >&2
    return 1
  fi

  local owner=-
  if [[ "$COLLISION_CHECK" == true ]]; then
    owner=$(existing_owner "$id")
    if [[ "$owner" != "-" && "$owner" != "$MANAGED_BY_VALUE" ]]; then
      if [[ "$OVERWRITE" == false ]]; then
        echo "  refusing to overwrite \"${id}\" in ${NAMESPACE}: this tool did not upload it." >&2
        echo "  A write replaces spec wholesale and the API keeps no revisions, so the" >&2
        echo "  existing guide could not be restored. Rename the package, or pass" >&2
        echo "  --overwrite to replace it deliberately." >&2
        return 1
      fi
      echo "  warning: replacing \"${id}\", which this tool did not upload" >&2
    fi
  fi

  local unknown
  unknown=$(jq -r "$UNKNOWN_BLOCK_FIELDS_JQ" "$content")
  if [[ -n "$unknown" ]]; then
    echo "  warning: ${id} uses block fields the CRD does not declare: ${unknown}" >&2
    if [[ "$STRICT_BLOCKS" == true ]]; then
      echo "  --strict-blocks is set; refusing to upload lossy content." >&2
      return 1
    fi
  fi

  local manifest_obj spec_file
  spec_file="${TMP_DIR}/$(slugify "$id").json"
  if [[ "$NO_MANIFEST" == true ]]; then
    manifest_obj=
    jq --arg status "$STATUS" '. + {status: $status}' "$content" > "$spec_file"
  else
    manifest_obj=$(build_manifest "$manifest") || true
    [[ -n "$manifest_obj" ]] || { echo "could not build spec.manifest from ${manifest}" >&2; return 1; }
    jq --argjson manifest "$manifest_obj" --arg status "$STATUS" \
      '. + {status: $status, manifest: $manifest}' "$content" > "$spec_file"
  fi

  if [[ "$DRY_RUN" == true ]]; then
    local note=
    if [[ "$owner" == "$MANAGED_BY_VALUE" ]]; then
      note="  (updates existing)"
    elif [[ "$owner" != "-" ]]; then
      note="  << replaces a guide this tool did not upload"
    fi
    printf '  %-7s %s  (%s blocks)%s\n' "$label" "$id" "$blocks" "$note"
    if [[ "$VERBOSE" == true ]]; then
      sed 's/^/    /' "$spec_file"
    elif [[ -n "$manifest_obj" ]]; then
      echo "$manifest_obj" | sed 's/^/      /'
    fi
    return 0
  fi

  local output
  if ! output=$("$UPSERT_GUIDE" --stack "$STACK" --token "$TOKEN" \
      --namespace "$NAMESPACE" --spec "$spec_file" \
      --annotation "${MANAGED_BY_KEY}=${MANAGED_BY_VALUE}" \
      --annotation "${SOURCE_PACKAGE_KEY}=${PKG_ID}" 2>&1); then
    printf '  %-7s %s  FAILED\n' "$label" "$id"
    echo "$output" | sed 's/^/      /' >&2
    # Anchored to the status line write_resource emits; a bare "422" also
    # matches namespace digits like stacks-4220.
    if echo "$output" | grep -q 'HTTP 422'; then
      echo "      hint: a 422 means the CRD rejected a field. If it names \"manifest\"," >&2
      echo "      this stack's InteractiveGuide CRD predates spec.manifest support." >&2
    fi
    return 1
  fi

  if echo "$output" | grep -q '^Creating '; then
    CREATED=$((CREATED + 1))
    printf '  %-7s %s  created\n' "$label" "$id"
  elif [[ "$owner" != "-" && "$owner" != "$MANAGED_BY_VALUE" ]]; then
    OVERWROTE=$((OVERWROTE + 1))
    printf '  %-7s %s  replaced (was not uploaded by this tool)\n' "$label" "$id"
  else
    UPDATED=$((UPDATED + 1))
    printf '  %-7s %s  updated\n' "$label" "$id"
  fi
  [[ "$VERBOSE" == false ]] || echo "$output" | sed 's/^/      /'
}

ROOT_MANIFEST="${PACKAGE}/manifest.json"
ROOT_CONTENT="${PACKAGE}/content.json"
[[ -r "$ROOT_MANIFEST" ]] || { echo "missing manifest.json in ${PACKAGE}" >&2; exit 66; }
[[ -r "$ROOT_CONTENT" ]] || { echo "missing content.json in ${PACKAGE}" >&2; exit 66; }

PKG_TYPE=$(jq -r '.type // empty' "$ROOT_MANIFEST")
PKG_ID=$(jq -r '.id // empty' "$ROOT_MANIFEST")
case "$PKG_TYPE" in
  guide|path|journey) ;;
  "") echo "${ROOT_MANIFEST} has no .type" >&2; exit 1 ;;
  *) echo "${ROOT_MANIFEST} has unsupported .type \"${PKG_TYPE}\" (expected guide, path or journey)" >&2; exit 1 ;;
esac

MILESTONES=()
if [[ "$PKG_TYPE" != "guide" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && MILESTONES+=("$line")
  done < <(jq -r '.milestones[]? // empty' "$ROOT_MANIFEST")
  if [[ ${#MILESTONES[@]} -eq 0 ]]; then
    echo "${ROOT_MANIFEST} is a ${PKG_TYPE} but lists no milestones" >&2
    exit 1
  fi
  if [[ "$(jq -r '.blocks | length' "$ROOT_CONTENT")" == "0" ]]; then
    echo "warning: ${PKG_ID} is a ${PKG_TYPE} with an empty cover page; the milestone toolbar renders onto it" >&2
  fi
fi

# Milestone IDs are the `id` inside each subdirectory's manifest, so index
# them rather than assuming the directory name. A tab-delimited string keeps
# this working on bash 3.2, which has no associative arrays.
INDEX=
for dir in "$PACKAGE"/*/; do
  [[ -d "$dir" && -r "${dir}manifest.json" ]] || continue
  # Not every subdirectory is a milestone, so a manifest that isn't parseable
  # JSON — or isn't an object — must not abort the run. Without the fallback
  # this is a bare assignment under `set -e` and a malformed prelude page
  # (`business-value-*`) kills the upload with an undocumented exit code.
  sub_id=$(jq -r '.id // empty' "${dir}manifest.json" 2>/dev/null) || {
    echo "warning: skipping ${dir%/} (manifest.json is not readable as a JSON object)" >&2
    continue
  }
  [[ -n "$sub_id" ]] || continue
  INDEX="${INDEX}${sub_id}	${dir%/}
"
done

lookup_dir() {
  printf '%s' "$INDEX" | awk -F'\t' -v id="$1" '$1 == id { print $2; exit }'
}

DUPES=$(printf '%s' "$INDEX" | cut -f1 | LC_ALL=C sort | uniq -d | paste -sd' ' -)
if [[ -n "$DUPES" ]]; then
  echo "duplicate package ids among ${PACKAGE} subdirectories: ${DUPES}" >&2
  echo "ids map to resource names, so duplicates would overwrite each other" >&2
  exit 1
fi

# The check above only compares subdirectories with each other, so it misses a
# milestone that shares the root package's id. Both would resolve to the same
# resource name and the cover page, uploaded last, would silently replace the
# milestone it points at.
for milestone in ${MILESTONES[@]+"${MILESTONES[@]}"}; do
  if [[ "$milestone" == "$PKG_ID" ]]; then
    echo "milestone \"${milestone}\" has the same id as the package itself" >&2
    echo "both map to resource name \"$(slugify "$PKG_ID")\", so the cover page would" >&2
    echo "overwrite the milestone. Rename one of them." >&2
    exit 1
  fi
done

# Resolved in dry-run too: without a namespace there is no collection to
# list, and the collision check below is the part of the preview that
# actually needs the stack. A dry run must still work offline, so failure
# there degrades to a warning instead of aborting.
if [[ -z "$NAMESPACE" ]]; then
  NAMESPACE=$(curl -sSf -H "Authorization: Bearer ${TOKEN}" "https://${STACK}/api/frontend/settings" \
    | jq -r '.namespace // empty') || true
  if [[ -z "$NAMESPACE" && "$DRY_RUN" == false ]]; then
    echo "could not auto-detect namespace from /api/frontend/settings; pass --namespace explicitly" >&2
    exit 1
  fi
fi

# Resource names are slugified package ids from a third-party content repo,
# and a write replaces spec wholesale. A milestone id like `getting-started`
# can therefore land on a hand-authored guide of that name — with no
# revision verb in the API and no copy in the source repo, that overwrite is
# unrecoverable. LIST the collection once and compare provenance so an
# in-place update of our own resource stays silent while a collision with
# anyone else's stops the run.
EXISTING=
COLLISION_CHECK=false
if [[ -n "$NAMESPACE" ]]; then
  LIST_URL="https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NAMESPACE}/interactiveguides"
  if LIST_JSON=$(curl -sSf -H "Authorization: Bearer ${TOKEN}" "$LIST_URL" 2>/dev/null); then
    EXISTING=$(echo "$LIST_JSON" | jq -r --arg key "$MANAGED_BY_KEY" '
      .items[]? | [.metadata.name, (.metadata.annotations[$key] // "")] | @tsv')
    COLLISION_CHECK=true
  elif [[ "$DRY_RUN" == false && "$OVERWRITE" == false ]]; then
    echo "could not list existing guides at ${LIST_URL}" >&2
    echo "listing is how this tool avoids clobbering guides it did not upload." >&2
    echo "Grant the token list access, or pass --overwrite to write without the check." >&2
    exit 1
  else
    echo "warning: could not list existing guides; not checking for collisions" >&2
  fi
fi

# Prints the managed-by annotation of an existing resource, "unmanaged" when
# it exists without one, or "-" when the name is free. Tab-delimited string
# plus awk keeps this working on bash 3.2, which has no associative arrays.
existing_owner() {
  printf '%s\n' "$EXISTING" | awk -F'\t' -v n="$1" '
    $1 == n { print ($2 == "" ? "unmanaged" : $2); found = 1; exit }
    END { if (!found) print "-" }'
}

TOTAL=$(( ${#MILESTONES[@]} + 1 ))
RESOURCES="resources"
[[ "$TOTAL" -ne 1 ]] || RESOURCES="resource"
echo "Package:   ${PKG_ID} (${PKG_TYPE}, ${TOTAL} ${RESOURCES})"
[[ -z "$NAMESPACE" ]] || echo "Namespace: ${NAMESPACE}"
echo "Status:    ${STATUS}"
[[ "$DRY_RUN" == false ]] || echo "Mode:      dry run, no writes"
echo

# Vet every name the run would write before writing any of them. The
# per-resource check inside upsert_package would also refuse, but only after
# the earlier milestones had been replaced — and milestones upload first, so
# by the time a colliding cover page is reached the damage is done.
if [[ "$COLLISION_CHECK" == true && "$OVERWRITE" == false ]]; then
  CLASHES=
  for name in ${MILESTONES[@]+"${MILESTONES[@]}"} "$PKG_ID"; do
    clash_owner=$(existing_owner "$name")
    if [[ "$clash_owner" != "-" && "$clash_owner" != "$MANAGED_BY_VALUE" ]]; then
      CLASHES="${CLASHES} ${name}"
    fi
  done
  if [[ -n "$CLASHES" ]]; then
    echo "refusing to write: these guides already exist in ${NAMESPACE} and were not" >&2
    echo "uploaded by this tool:${CLASHES}" >&2
    echo "A write replaces spec wholesale and the API keeps no revisions, so they could" >&2
    echo "not be restored. Rename the colliding packages, or pass --overwrite." >&2
    exit 1
  fi
fi

STEP=0
for milestone in ${MILESTONES[@]+"${MILESTONES[@]}"}; do
  STEP=$((STEP + 1))
  dir=$(lookup_dir "$milestone")
  if [[ -z "$dir" ]]; then
    echo "  [${STEP}/${TOTAL}]      milestone \"${milestone}\" has no subdirectory under ${PACKAGE}" >&2
    echo "  ids found: $(printf '%s' "$INDEX" | cut -f1 | paste -sd' ' -)" >&2
    FAILED=$((FAILED + 1))
    FAILED_NAMES="${FAILED_NAMES} ${milestone}"
    [[ "$CONTINUE_ON_ERROR" == true ]] || exit 1
    continue
  fi
  if ! upsert_package "$dir" "[${STEP}/${TOTAL}]" "$milestone"; then
    FAILED=$((FAILED + 1))
    FAILED_NAMES="${FAILED_NAMES} ${milestone}"
    [[ "$CONTINUE_ON_ERROR" == true ]] || exit 1
  fi
done

STEP=$((STEP + 1))
if ! upsert_package "$PACKAGE" "[${STEP}/${TOTAL}]" "$PKG_ID"; then
  FAILED=$((FAILED + 1))
  FAILED_NAMES="${FAILED_NAMES} ${PKG_ID}"
fi

echo
if [[ "$DRY_RUN" == true ]]; then
  VALID=$((TOTAL - FAILED))
  if [[ "$FAILED" -gt 0 ]]; then
    echo "Dry run failed: ${FAILED} of ${TOTAL} ${RESOURCES} did not validate."
  else
    echo "Dry run complete: ${VALID} ${RESOURCES} would be uploaded."
  fi
else
  SUMMARY="Done. ${CREATED} created, ${UPDATED} updated"
  [[ "$OVERWROTE" -eq 0 ]] || SUMMARY="${SUMMARY}, ${OVERWROTE} replaced"
  echo "${SUMMARY}, ${FAILED} failed."
fi

# One gate for both modes. A dry run that exits 0 on a fault the real run
# treats as fatal is worse than no preview at all: wired up as a CI check it
# greenlights an upload that then half-publishes the path.
if [[ "$FAILED" -gt 0 ]]; then
  echo "Failed:${FAILED_NAMES}" >&2
  exit 1
fi
