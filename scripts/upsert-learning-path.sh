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
#   130 interrupted (SIGINT)
#   143 terminated (SIGTERM)

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
UPSERT_GUIDE="${SCRIPT_DIR}/upsert-guide.sh"
# shellcheck source=scripts/lib/app-platform.sh
source "${SCRIPT_DIR}/lib/app-platform.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") --stack <host> --token <token> --package <dir> [options]

Required:
  -s, --stack       Grafana stack hostname (e.g. learn.grafana.net or
                    <stack>.grafana.net). Without scheme.
  -t, --token       Service-account token (glsa_...) with Editor role.
                    Prefer \$PATHFINDER_SA_TOKEN: an argv token is readable
                    from the process table while the script runs.
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
TOKEN="${PATHFINDER_SA_TOKEN:-}"
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
    -s|--stack) ap_require_value "$1" "${2-}"; STACK="$2"; shift 2 ;;
    -t|--token) ap_require_value "$1" "${2-}"; TOKEN="$2"; shift 2 ;;
    -p|--package) ap_require_value "$1" "${2-}"; PACKAGE="$2"; shift 2 ;;
    -n|--namespace) ap_require_value "$1" "${2-}"; NAMESPACE="$2"; shift 2 ;;
    --status) ap_require_value "$1" "${2-}"; STATUS="$2"; shift 2 ;;
    --repository) ap_require_value "$1" "${2-}"; REPOSITORY="$2"; shift 2 ;;
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

STACK=$(ap_normalize_stack "$STACK")
ap_validate_stack "$STACK"

TMP_DIR=$(mktemp -d)
# The signal handlers must exit: bash resumes the script after a trap that
# doesn't, so a Ctrl-C would delete TMP_DIR and keep uploading from spec files
# that no longer exist.
trap 'rm -rf "$TMP_DIR"; ap_auth_cleanup' EXIT
trap 'rm -rf "$TMP_DIR"; ap_auth_cleanup; exit 130' INT
trap 'rm -rf "$TMP_DIR"; ap_auth_cleanup; exit 143' TERM

ap_auth_init "$TOKEN"
# The child gets the token through the environment. Passing it as an argument
# would put it in the process table once per resource.
export PATHFINDER_SA_TOKEN="$TOKEN"

# Block fields the InteractiveGuide CRD declares. Source of truth is
# _blockFields/#Block/#NestedBlock/#Step in
# grafana-pathfinder-backend/kinds/interactiveguide.cue; anything else is pruned
# or rejected on write, so warn before it silently disappears. Recursion stops
# at depth 3, where the CRD switches to x-kubernetes-preserve-unknown-fields.
#
# scripts/tests/upsert-learning-path.test.sh pins these against the app's own
# KNOWN_FIELDS, so a block field the app gains and the CRD lacks fails a test
# rather than surfacing as a silent prune on someone's upload.
read -r -d '' UNKNOWN_BLOCK_FIELDS_JQ <<'JQ' || true
def BLOCK: ["action","alt","assistantEnabled","assistantId","assistantType","authorNote","autoCollapse","blocks","brief","buttonText","checkboxLabel","choices","code","collapsed","command","completeEarly","completionMode","conditions","content","datasourceFilter","description","display","doIt","end","failureMessage","formHint","height","hint","hintLevels","id","inputType","language","lazyRender","maxAttempts","mode","multiSelect","objectives","openGuide","pattern","placeholder","prompt","provider","question","reftarget","required","requirements","screens","scrollContainer","setupCommands","setupScript","showMe","shuffle","skippable","snippetId","src","start","stepTimeout","steps","successCriteria","targetstate","targetvalue","title","tooltip","type","validateInput","validationMessage","variableName","verify","vmApp","vmScenario","vmTemplate","welcome","whenFalse","whenFalseSectionConfig","whenTrue","whenTrueSectionConfig","width"];
def STEP: ["action","description","formHint","id","lazyRender","reftarget","requirements","scrollContainer","skippable","targetstate","targetvalue","tooltip","validateInput"];
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

record_failure() {
  FAILED=$((FAILED + 1))
  FAILED_NAMES="${FAILED_NAMES} $1"
}

validated() {
  [[ " ${FAILED_NAMES} " != *" $1 "* ]]
}

# Everything checkable without the stack, plus the spec file the write step
# sends. Runs for every package before the first write: milestones upload
# before the cover page, so a fault caught late leaves published milestones
# with no path sequencing them.
validate_package() {
  local dir="$1" label="$2" expected_id="$3"
  local manifest="${dir}/manifest.json" content="${dir}/content.json"

  [[ -r "$manifest" ]] || { echo "missing manifest.json in ${dir}" >&2; return 1; }
  [[ -r "$content" ]] || { echo "missing content.json in ${dir}" >&2; return 1; }

  # Types, not just presence: the CRD requires strings where the app schema
  # does, and a numeric .title or a block without a .type is a 422 at write
  # time — after earlier milestones have already been replaced.
  local shape
  shape=$(jq -r '
    if (type != "object") then "content.json is not a JSON object"
    elif ((.id | type) != "string" or (.id | length) == 0) then "content.json .id must be a non-empty string"
    elif ((.title | type) != "string" or (.title | length) == 0) then "content.json .title must be a non-empty string"
    elif ((.blocks | type) != "array") then "content.json .blocks must be an array"
    elif ((.blocks | length) == 0) then "content.json .blocks is empty"
    elif ([.blocks[] | select(type != "object")] | length) > 0 then "content.json .blocks contains a non-object entry"
    elif ([.blocks[] | select((.type | type) != "string" or (.type | length) == 0)] | length) > 0 then "content.json has a block with no .type"
    else "" end' "$content" 2>/dev/null) || {
    echo "${content} is not readable as a JSON object" >&2
    return 1
  }
  [[ -z "$shape" ]] || { echo "${content}: ${shape#content.json }" >&2; return 1; }

  local fields id blocks
  fields=$(jq -r '[.id, (.blocks | length)] | @tsv' "$content") || {
    echo "${content} is not readable as a JSON object" >&2
    return 1
  }
  IFS=$'\t' read -r id blocks <<<"$fields"

  if [[ -n "$expected_id" && "$id" != "$expected_id" ]]; then
    echo "${content} .id is \"${id}\" but manifest.json declares \"${expected_id}\"" >&2
    return 1
  fi

  # The catalogue and manifest.milestones key on spec.id, while the resolver
  # and backend-guide: URLs GET by metadata.name — which upsert-guide.sh
  # slugifies from spec.id. If they diverge every milestone 404s silently.
  if [[ "$(ap_slugify "$id")" != "$id" ]]; then
    echo "package id \"${id}\" is not a valid resource name (would upload as \"$(ap_slugify "$id")\")." >&2
    echo "spec.id and metadata.name must match or milestone resolution breaks. Rename the package." >&2
    return 1
  fi

  # A failed scan must not read as "nothing would be pruned": --strict-blocks
  # is set precisely to guarantee that, and errexit is disabled in here because
  # every call site invokes this in a condition context.
  local unknown
  unknown=$(jq -r "$UNKNOWN_BLOCK_FIELDS_JQ" "$content") || {
    echo "could not scan ${content} for undeclared block fields" >&2
    return 1
  }
  if [[ -n "$unknown" ]]; then
    echo "  warning: ${id} uses block fields the CRD does not declare: ${unknown}" >&2
    if [[ "$STRICT_BLOCKS" == true ]]; then
      echo "  --strict-blocks is set; refusing to upload lossy content." >&2
      return 1
    fi
  fi

  local manifest_obj spec_file
  spec_file="${TMP_DIR}/$(ap_slugify "$id").json"
  if [[ "$NO_MANIFEST" == true ]]; then
    manifest_obj=
    jq --arg status "$STATUS" '. + {status: $status}' "$content" > "$spec_file" || {
      echo "could not build a spec from ${content}" >&2
      return 1
    }
  else
    manifest_obj=$(build_manifest "$manifest") || true
    [[ -n "$manifest_obj" ]] || { echo "could not build spec.manifest from ${manifest}" >&2; return 1; }
    jq --argjson manifest "$manifest_obj" --arg status "$STATUS" \
      '. + {status: $status, manifest: $manifest}' "$content" > "$spec_file" || {
      echo "could not build a spec from ${content}" >&2
      return 1
    }
  fi

  [[ "$DRY_RUN" == true ]] || return 0

  local note='' owner='-'
  [[ "$COLLISION_CHECK" == false ]] || owner=$(existing_owner "$id")
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
}

# Uploads the spec validate_package composed for one already-vetted package.
write_package() {
  local label="$1" id="$2"
  local spec_file owner='-'
  spec_file="${TMP_DIR}/$(ap_slugify "$id").json"

  [[ "$COLLISION_CHECK" == false ]] || owner=$(existing_owner "$id")
  [[ "$owner" == "-" || "$owner" == "$MANAGED_BY_VALUE" ]] ||
    echo "  warning: replacing \"${id}\", which this tool did not upload" >&2

  # The pre-flight listing is a snapshot; this makes the helper re-check
  # ownership against the same GET whose resourceVersion it sends, so a
  # resource created or detached since the listing cannot be replaced silently.
  local guard=()
  [[ "$OVERWRITE" == true ]] ||
    guard=(--require-annotation "${MANAGED_BY_KEY}=${MANAGED_BY_VALUE}")

  local output
  if ! output=$("$UPSERT_GUIDE" --stack "$STACK" \
      --namespace "$NAMESPACE" --spec "$spec_file" \
      ${guard[@]+"${guard[@]}"} \
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

  if echo "$output" | grep -q 'action=create'; then
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

# Both root files are read by bare command substitutions below, which under
# `set -e` would abort on jq's own exit code with nothing but its parse error.
for root_file in "$ROOT_MANIFEST" "$ROOT_CONTENT"; do
  jq -e 'type == "object"' "$root_file" >/dev/null 2>&1 || {
    echo "${root_file} is not readable as a JSON object" >&2
    exit 1
  }
done

PKG_TYPE=$(jq -r '.type // empty' "$ROOT_MANIFEST")
PKG_ID=$(jq -r '.id // empty' "$ROOT_MANIFEST")
case "$PKG_TYPE" in
  guide|path|journey) ;;
  "") echo "${ROOT_MANIFEST} has no .type" >&2; exit 1 ;;
  *) echo "${ROOT_MANIFEST} has unsupported .type \"${PKG_TYPE}\" (expected guide, path or journey)" >&2; exit 1 ;;
esac

[[ -n "$PKG_ID" ]] || { echo "${ROOT_MANIFEST} has no .id" >&2; exit 1; }
# PKG_ID is stamped onto every milestone as an annotation value before the cover
# page validates its own id, so a value carrying a newline and an `=` could
# forge the managed-by key the overwrite guard reads.
if [[ "$(ap_slugify "$PKG_ID")" != "$PKG_ID" ]]; then
  echo "package id \"${PKG_ID}\" is not a valid resource name (would upload as \"$(ap_slugify "$PKG_ID")\")." >&2
  echo "spec.id and metadata.name must match or milestone resolution breaks. Rename the package." >&2
  exit 1
fi

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
    echo "both map to resource name \"$(ap_slugify "$PKG_ID")\", so the cover page would" >&2
    echo "overwrite the milestone. Rename one of them." >&2
    exit 1
  fi
done

# Resolved in dry-run too: without a namespace there is no collection to
# list, and the collision check below is the part of the preview that
# actually needs the stack. A dry run must still work offline, so failure
# there degrades to a warning instead of aborting.
if [[ -z "$NAMESPACE" ]]; then
  NAMESPACE=$(ap_detect_namespace "$STACK") || true
  if [[ -z "$NAMESPACE" && "$DRY_RUN" == false ]]; then
    echo "could not auto-detect namespace from /api/frontend/settings; pass --namespace explicitly" >&2
    exit 1
  fi
fi

# Resource names are slugified package ids from a third-party content repo,
# and a write replaces spec wholesale. A milestone id like `getting-started`
# can therefore land on a hand-authored guide of that name — with no
# revision verb in the API and no copy in the source repo, that overwrite is
# unrecoverable. LIST the collection and compare provenance so an in-place
# update of our own resource stays silent while a collision with anyone
# else's stops the run.
LIST_URL=
[[ -z "$NAMESPACE" ]] || LIST_URL=$(ap_guides_url "$STACK" "$NAMESPACE")

# Drains metadata.continue: this API truncates a single-page read without
# saying so (docs/design/BACKEND_PROXY_PATTERN.md), and a truncated page read
# as the whole collection makes every name on a later page look free.
# Fails whole rather than partial — a half-listing is what silently disables
# the guard. errexit is off in here because the caller invokes it in a
# condition context.
MAX_LIST_PAGES=100
collect_existing() {
  [[ -n "$LIST_URL" ]] || return 1
  local token='' page items acc='' pages=0
  while :; do
    local url="${LIST_URL}?limit=500"
    [[ -z "$token" ]] || url="${url}&continue=${token}"
    page=$(ap_curl -f "$url" 2>/dev/null) || return 1
    # A 2xx body is not proof of a collection: with no -L a redirect page also
    # parses, and `.items[]?` would then read as "the namespace is empty".
    echo "$page" | jq -e '(.items | type) == "array"' >/dev/null 2>&1 || return 1
    items=$(echo "$page" | jq -r --arg key "$MANAGED_BY_KEY" '
      .items[] | [.metadata.name, (.metadata.annotations[$key] // "")] | @tsv') || return 1
    [[ -z "$items" ]] || acc="${acc}${items}
"
    token=$(echo "$page" | jq -r '.metadata.continue // ""') || return 1
    [[ -n "$token" ]] || break
    pages=$((pages + 1))
    [[ "$pages" -lt "$MAX_LIST_PAGES" ]] || {
      echo "warning: stopped listing after ${MAX_LIST_PAGES} pages" >&2
      return 1
    }
  done
  printf '%s' "$acc"
}

EXISTING=
COLLISION_CHECK=false
# Whether the check ran is reported below, in both modes: a dry run that
# silently skips it is a JSON linter claiming to be a collision gate.
if EXISTING=$(collect_existing); then
  COLLISION_CHECK=true
elif [[ "$DRY_RUN" == false && "$OVERWRITE" == false ]]; then
  echo "could not list existing guides at ${LIST_URL:-<no namespace resolved>}" >&2
  echo "listing is how this tool avoids clobbering guides it did not upload." >&2
  echo "Grant the token list access, or pass --overwrite to write without the check." >&2
  exit 1
else
  echo "warning: could not list existing guides; not checking for collisions" >&2
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
echo "Package:    ${PKG_ID} (${PKG_TYPE}, ${TOTAL} ${RESOURCES})"
[[ -z "$NAMESPACE" ]] || echo "Namespace:  ${NAMESPACE}"
echo "Status:     ${STATUS}"
[[ "$DRY_RUN" == false ]] || echo "Mode:       dry run, no writes"
[[ "$COLLISION_CHECK" == true ]] || echo "Collisions: not checked"
echo

# One gate for both modes. A dry run that exits 0 on a fault the real run
# treats as fatal is worse than no preview at all: wired up as a CI check it
# greenlights an upload that then half-publishes the path.
report_and_exit() {
  echo
  if [[ "$DRY_RUN" == true ]]; then
    if [[ "$FAILED" -gt 0 ]]; then
      echo "Dry run failed: ${FAILED} of ${TOTAL} ${RESOURCES} did not validate."
    else
      echo "Dry run complete: ${TOTAL} ${RESOURCES} would be uploaded."
    fi
  else
    local summary="Done. ${CREATED} created, ${UPDATED} updated"
    [[ "$OVERWROTE" -eq 0 ]] || summary="${summary}, ${OVERWROTE} replaced"
    echo "${summary}, ${FAILED} failed."
  fi

  if [[ "$FAILED" -gt 0 ]]; then
    echo "Failed:${FAILED_NAMES}" >&2
    exit 1
  fi
  exit 0
}

# Milestones upload before the cover page, so every check that can refuse the
# run has to happen before the first write — otherwise a cover page rejected on
# its own content leaves the milestones already replaced, with nothing
# sequencing them. Only the provenance lookup here needs the stack.
ORDER=(${MILESTONES[@]+"${MILESTONES[@]}"} "$PKG_ID")
CLASHES=
STEP=0
for name in "${ORDER[@]}"; do
  STEP=$((STEP + 1))
  if [[ "$name" == "$PKG_ID" ]]; then
    dir="$PACKAGE"
  else
    dir=$(lookup_dir "$name")
  fi
  if [[ -z "$dir" ]]; then
    echo "  [${STEP}/${TOTAL}]      milestone \"${name}\" has no subdirectory under ${PACKAGE}" >&2
    echo "  ids found: $(printf '%s' "$INDEX" | cut -f1 | paste -sd' ' -)" >&2
    record_failure "$name"
    continue
  fi
  validate_package "$dir" "[${STEP}/${TOTAL}]" "$name" || record_failure "$name"
  if [[ "$COLLISION_CHECK" == true && "$OVERWRITE" == false ]]; then
    clash_owner=$(existing_owner "$name")
    if [[ "$clash_owner" != "-" && "$clash_owner" != "$MANAGED_BY_VALUE" ]]; then
      CLASHES="${CLASHES} ${name}"
    fi
  fi
done

if [[ -n "$CLASHES" ]]; then
  echo "refusing to write: these guides already exist in ${NAMESPACE} and were not" >&2
  echo "uploaded by this tool:${CLASHES}" >&2
  echo "A write replaces spec wholesale and the API keeps no revisions, so they could" >&2
  echo "not be restored. Rename the colliding packages, or pass --overwrite." >&2
  exit 1
fi

[[ "$DRY_RUN" == false ]] || report_and_exit
[[ "$FAILED" -eq 0 || "$CONTINUE_ON_ERROR" == true ]] || report_and_exit

STEP=0
for name in "${ORDER[@]}"; do
  STEP=$((STEP + 1))
  validated "$name" || continue
  write_package "[${STEP}/${TOTAL}]" "$name" || {
    record_failure "$name"
    [[ "$CONTINUE_ON_ERROR" == true ]] || report_and_exit
  }
done

report_and_exit
