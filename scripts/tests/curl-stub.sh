#!/usr/bin/env bash
# A stand-in for curl, put on PATH by upsert-learning-path.test.sh so the
# upload scripts can be exercised without a stack.
#
# Reads STUB_MODE for which stack to imitate, appends every invocation to
# STUB_LOG so a test can assert on request order and on what did *not* reach
# the wire, and honours the flags the scripts actually pass: --config, -f,
# -w '\n%{http_code}', -X, --data-binary @file.

set -uo pipefail

STUB_LOG="${STUB_LOG:-/dev/null}"
STUB_MODE="${STUB_MODE:-empty}"
MANAGED_BY_KEY='pathfinderbackend.ext.grafana.app/managed-by'

url=
method=GET
want_code=false
fail_on_error=false
payload_file=
next_is_x=false
for arg in "$@"; do
  if [[ "$next_is_x" == true ]]; then
    method="$arg"
    next_is_x=false
    continue
  fi
  case "$arg" in
    -X) next_is_x=true ;;
    -f | --fail) fail_on_error=true ;;
    -w) want_code=true ;;
    --data-binary) ;;
    @*) payload_file="${arg#@}" ;;
    https://*) url="$arg" ;;
  esac
done

printf '%s\t%s\n' "$method" "$url" >>"$STUB_LOG"
printf 'ARGV\t%s\n' "$*" >>"$STUB_LOG"
[[ -z "$payload_file" || ! -r "$payload_file" ]] || printf 'BODY\t%s\n' "$(tr -d '\n' <"$payload_file")" >>"$STUB_LOG"

respond() {
  local code="$1" body="$2"
  if [[ "$fail_on_error" == true && "$code" != 2* ]]; then
    echo "curl: (22) The requested URL returned error: ${code}" >&2
    exit 22
  fi
  if [[ "$want_code" == true ]]; then
    printf '%s\n%s' "$body" "$code"
  else
    printf '%s' "$body"
  fi
  exit 0
}

unreachable() {
  echo "curl: (6) Could not resolve host" >&2
  exit 6
}

item() { # name, managed-by value ("" for none)
  if [[ -z "$2" ]]; then
    printf '{"metadata":{"name":"%s"}}' "$1"
  else
    printf '{"metadata":{"name":"%s","annotations":{"%s":"%s"}}}' "$1" "$MANAGED_BY_KEY" "$2"
  fi
}

[[ "$STUB_MODE" != "unreachable" ]] || unreachable

# Writes first: a POST lands on the same collection URL a LIST does.
if [[ "$method" != GET ]]; then
  [[ "$STUB_MODE" != "reject_422" ]] ||
    respond 422 '{"kind":"Status","message":"InteractiveGuide in version \"v1alpha1\" cannot be handled: strict decoding error: unknown field \"spec.manifest\""}'
  respond 200 '{"metadata":{"name":"ok"}}'
fi

case "$url" in
  */api/frontend/settings)
    respond 200 '{"namespace":"stacks-1"}'
    ;;
  */interactiveguides | */interactiveguides\?*)
    case "$STUB_MODE" in
      existing_ours)
        respond 200 "{\"items\":[$(item m-a upsert-learning-path.sh),$(item lp upsert-learning-path.sh)]}"
        ;;
      existing_foreign)
        respond 200 "{\"items\":[$(item m-a "")]}"
        ;;
      detached)
        # The listing says the resource is ours; the live GET says it is not.
        respond 200 "{\"items\":[$(item m-a upsert-learning-path.sh)]}"
        ;;
      paged_foreign)
        if [[ "$url" == *continue=page2* ]]; then
          respond 200 "{\"items\":[$(item m-a "")]}"
        fi
        respond 200 '{"items":[],"metadata":{"continue":"page2"}}'
        ;;
      paged_broken)
        [[ "$url" != *continue=page2* ]] || respond 500 '{"kind":"Status","message":"boom"}'
        respond 200 '{"items":[],"metadata":{"continue":"page2"}}'
        ;;
      list_not_a_collection)
        respond 200 '<html>login</html>'
        ;;
      *)
        respond 200 '{"items":[]}'
        ;;
    esac
    ;;
  */interactiveguides/*)
    name="${url##*/}"
    case "$STUB_MODE" in
      existing_ours)
        respond 200 "{\"metadata\":{\"name\":\"${name}\",\"resourceVersion\":\"7\",\"annotations\":{\"${MANAGED_BY_KEY}\":\"upsert-learning-path.sh\"}}}"
        ;;
      existing_foreign | detached)
        respond 200 "{\"metadata\":{\"name\":\"${name}\",\"resourceVersion\":\"7\"}}"
        ;;
      *)
        respond 404 '{"kind":"Status","code":404}'
        ;;
    esac
    ;;
esac

respond 200 '{"metadata":{"name":"ok"}}'
