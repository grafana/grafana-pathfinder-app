#!/usr/bin/env bash
# Draw the completion queue model and its counterexamples with pstack's
# /statechart skill, pinned to one commit of cursor/plugins (pilot for #2421).
#
# Usage: formal/completion-queue/statechart.sh [--out DIR] [--variant NAME]
# Needs: git, Node 23.6+ (or Bun/Deno), Java 11+, and the pinned tla2tools jar
# that check.sh downloads and verifies. Downloads pstack into .tools/ on first use.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
PSTACK_REPO="https://github.com/cursor/plugins.git"
PSTACK_COMMIT="e1cc03121a0e71129a4fb730d7c5528a0a3e43c8"
PSTACK_DIR="$HERE/.tools/pstack-$PSTACK_COMMIT"
JAR="${TLA2TOOLS:-$HERE/.tools/tla2tools-1.7.4.jar}"
OUT="$HERE/out/statechart-$(date +%Y%m%dT%H%M%S)"
VARIANT="none"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f "$JAR" ] || { echo "TOOLING: run check.sh first to fetch and verify $JAR" >&2; exit 2; }

if [ ! -x "$PSTACK_DIR/pstack/skills/statechart/scripts/statechart" ]; then
  rm -rf "$PSTACK_DIR"
  mkdir -p "$PSTACK_DIR" || exit 2
  if ! { git -C "$PSTACK_DIR" init -q &&
    git -C "$PSTACK_DIR" remote add origin "$PSTACK_REPO" &&
    git -C "$PSTACK_DIR" sparse-checkout set pstack/skills/statechart &&
    git -C "$PSTACK_DIR" fetch -q --depth 1 origin "$PSTACK_COMMIT" &&
    git -C "$PSTACK_DIR" checkout -q FETCH_HEAD; }; then
    echo "TOOLING: cannot fetch pstack $PSTACK_COMMIT" >&2
    exit 2
  fi
fi
[ "$(git -C "$PSTACK_DIR" rev-parse HEAD)" = "$PSTACK_COMMIT" ] ||
  { echo "TOOLING: pstack checkout is not at $PSTACK_COMMIT" >&2; exit 2; }

mkdir -p "$OUT" || exit 2
cp "$HERE/CompletionQueue.tla" "$HERE/view.mjs" "$OUT/"

# Bounds are small: the skill draws the whole graph only up to 500 TLC states,
# and only bug paths above that. No SYMMETRY, which the skill says merges states.
chart() {
  local name="$1" tabs="$2"
  cat > "$OUT/$name.cfg" <<EOF
CONSTANTS
  Tabs = $tabs
  Events = {c1}
  Partials = {}
  MaxAttempts = 0
  AllowExpiry = FALSE
  AllowClear = TRUE
  Granularity = "task"
  Variant = "$VARIANT"
SPECIFICATION Spec
INVARIANT TypeOK
INVARIANT ClearedStaysCleared
INVARIANT OneRecordPerEvent
INVARIANT NoSilentLoss
EOF
  TLA2TOOLS="$JAR" "$PSTACK_DIR/pstack/skills/statechart/scripts/statechart" \
    "$OUT/CompletionQueue.tla" --config "$OUT/$name.cfg" --view "$OUT/view.mjs" --out "$OUT/$name" > "$OUT/$name.log" 2>&1
  echo "$name: statechart exit $?; report $OUT/$name/report.md"
}

chart two-tabs "{t1, t2}"
chart one-tab "{t1}"
