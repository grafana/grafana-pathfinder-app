#!/usr/bin/env bash
# Bounded TLC check of the completion write queue model (pilot for #2421).
# Local only; not part of `npm run check` or CI.
#
# Usage: formal/completion-queue/check.sh [--only NAME] [--timeout SECONDS] [--out DIR]
#
# Each run gets one verdict:
#   PASS        TLC explored the whole bounded state space and found no violation
#   VIOLATION   TLC found an invariant (or deadlock) violation; trace saved
#   INCOMPLETE  TLC was stopped by the wall-clock budget before finishing
#   TOOLING     TLC or Java failed (parse error, bad config, crash, checksum)
# A run is "as expected" when its verdict matches the EXPECT column below.
#
# Exit status: 0 all runs as expected, 1 a verdict differs from EXPECT,
#              2 tooling failure, 3 incomplete exploration (worst wins: 2 > 3 > 1).
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SPEC="$HERE/CompletionQueue.tla"

TLA2TOOLS_VERSION="1.7.4"
TLA2TOOLS_URL="https://github.com/tlaplus/tlaplus/releases/download/v${TLA2TOOLS_VERSION}/tla2tools.jar"
TLA2TOOLS_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TOOLS_DIR="$HERE/.tools"
JAR="${TLA2TOOLS:-$TOOLS_DIR/tla2tools-${TLA2TOOLS_VERSION}.jar}"
JAVA_BIN="${JAVA:-java}"

ONLY=""
TIMEOUT=300
OUT="$HERE/out/$(date +%Y%m%dT%H%M%S)"
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

tooling_fail() { echo "TOOLING: $*" >&2; exit 2; }

sha256_of() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }

if [ ! -f "$JAR" ]; then
  [ -n "${TLA2TOOLS:-}" ] && tooling_fail "TLA2TOOLS=$JAR does not exist"
  mkdir -p "$TOOLS_DIR" || tooling_fail "cannot create $TOOLS_DIR"
  echo "Downloading tla2tools $TLA2TOOLS_VERSION into $TOOLS_DIR" >&2
  curl -fsSL -o "$JAR.partial" "$TLA2TOOLS_URL" || tooling_fail "download failed"
  mv "$JAR.partial" "$JAR"
fi
[ "$(sha256_of "$JAR")" = "$TLA2TOOLS_SHA256" ] || tooling_fail "checksum mismatch for $JAR (expected $TLA2TOOLS_SHA256)"

# The commit at which the model was last confirmed to describe these files.
# Move it forward only after re-reading the diff against the model.
SYNC_COMMIT="1555214d4317494b1c9314b5c72eb9c484ffe8b9"
COVERED="src/completion-records/completion-write-queue.ts
src/completion-records/completion-write-storage.ts
src/completion-records/completion-write-hook.ts
src/completion-records/completion-write-timing.ts
pkg/plugin/completion_records_write.go"
REPO="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO" ] || ! git -C "$REPO" cat-file -e "$SYNC_COMMIT^{commit}" 2>/dev/null; then
  echo "DRIFT: cannot compare covered code with sync commit $SYNC_COMMIT" >&2
else
  # shellcheck disable=SC2086 # COVERED is a newline-separated path list
  changed="$(cd "$REPO" && git diff --name-only "$SYNC_COMMIT" -- $COVERED)"
  if [ -n "$changed" ]; then
    echo "DRIFT: covered code changed since sync commit ${SYNC_COMMIT:0:10}; re-read it against the model before trusting a PASS:" >&2
    echo "$changed" | sed 's/^/  /' >&2
  fi
fi

JAVA_MAJOR="$("$JAVA_BIN" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')"
[ -n "$JAVA_MAJOR" ] && [ "$JAVA_MAJOR" -ge 11 ] || tooling_fail "need Java 11 or later (JAVA=$JAVA_BIN)"

# NAME | TABS | EVENTS | PARTIALS | MAXATT | EXPIRY | CLEAR | GRAN | VARIANT | INVARIANT | EXPECT
# MAXATT 0 is exact for every variant but retryKey: no guard reads the counter.
MATRIX='
p1-cross-tab-op       |t1,t2|c1,p1|p1|0|TRUE |TRUE |op  |none             |ClearedStaysCleared|VIOLATION
p1-cross-tab-task     |t1,t2|c1,p1|p1|0|TRUE |TRUE |task|none             |ClearedStaysCleared|VIOLATION
p1-one-tab            |t1   |c1,p1|p1|0|TRUE |TRUE |op  |none             |ClearedStaysCleared|PASS
p1-one-tab-mutant     |t1   |c1,p1|p1|0|TRUE |TRUE |op  |noMembershipCheck|ClearedStaysCleared|VIOLATION
p2-key-stable         |t1,t2|c1,p1|p1|0|TRUE |TRUE |op  |none             |OneRecordPerEvent  |PASS
p2-key-mutant         |t1,t2|c1,p1|p1|1|TRUE |TRUE |op  |retryKey         |OneRecordPerEvent  |VIOLATION
p3-no-loss            |t1,t2|c1,p1|p1|0|TRUE |TRUE |op  |none             |NoSilentLoss       |PASS
p3-no-loss-mutant     |t1,t2|c1,p1|p1|0|TRUE |TRUE |op  |dropOnTransient  |NoSilentLoss       |VIOLATION
t1-send-race-no-expiry|t1,t2|c1   |  |0|FALSE|FALSE|op  |none             |ExclusiveSend      |VIOLATION
t1-send-task-no-expiry|t1,t2|c1   |  |0|FALSE|FALSE|task|none             |ExclusiveSend      |PASS
t1-send-task-expiry   |t1,t2|c1   |  |0|TRUE |FALSE|task|none             |ExclusiveSend      |VIOLATION
fix-transient-only    |t1,t2|c1,p1|p1|0|TRUE |TRUE |task|fixTransientOnly |ClearedStaysCleared|VIOLATION
fix-both-task         |t1,t2|c1,p1|p1|0|TRUE |TRUE |task|fixBoth          |ClearedStaysCleared|PASS
fix-both-task-no-loss |t1,t2|c1,p1|p1|0|TRUE |TRUE |task|fixBoth          |NoSilentLoss       |PASS
fix-both-op           |t1,t2|c1,p1|p1|0|TRUE |TRUE |op  |fixBoth          |ClearedStaysCleared|VIOLATION
'

trim() { echo "$1" | sed 's/^ *//; s/ *$//'; }
set_of() { local v; v="$(trim "$1")"; [ -z "$v" ] && echo "{}" || echo "{${v//,/, }}"; }

mkdir -p "$OUT" || tooling_fail "cannot create $OUT"
cp "$SPEC" "$OUT/" || tooling_fail "cannot copy spec"
SUMMARY="$OUT/summary.tsv"
printf 'name\tverdict\texpected\tas_expected\tdistinct_states\tdepth\tseconds\tconfig\n' > "$SUMMARY"
echo "TLC $TLA2TOOLS_VERSION, Java $JAVA_MAJOR, output in $OUT"
printf '%-24s %-11s %-11s %-4s %10s %6s %8s\n' NAME VERDICT EXPECTED OK STATES DEPTH SECONDS

worst=0
rank() { case "$1" in 2) echo 3 ;; 3) echo 2 ;; 1) echo 1 ;; *) echo 0 ;; esac; }
bump() { [ "$(rank "$1")" -gt "$(rank "$worst")" ] && worst="$1"; return 0; }

ran=0
while IFS='|' read -r name tabs events partials maxatt expiry clear gran variant inv expect; do
  name="$(trim "$name")"
  [ -z "$name" ] && continue
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  ran=$((ran + 1))
  cfg="$OUT/$name.cfg"
  log="$OUT/$name.out"
  cat > "$cfg" <<EOF
CONSTANTS
  Tabs = $(set_of "$tabs")
  Events = $(set_of "$events")
  Partials = $(set_of "$partials")
  MaxAttempts = $(trim "$maxatt")
  AllowExpiry = $(trim "$expiry")
  AllowClear = $(trim "$clear")
  Granularity = "$(trim "$gran")"
  Variant = "$(trim "$variant")"
SPECIFICATION Spec
INVARIANT TypeOK
INVARIANT $(trim "$inv")
EOF
  case "$tabs" in *,*) echo "SYMMETRY TabSymmetry" >> "$cfg" ;; esac
  start=$(date +%s)
  ( cd "$OUT" && perl -e 'alarm shift; exec @ARGV' "$TIMEOUT" \
      "$JAVA_BIN" -XX:+UseParallelGC -Xmx4g -cp "$JAR" tlc2.TLC \
      -workers 1 -fp 0 -seed 0 -cleanup -metadir "$OUT/states-$name" \
      -config "$cfg" "$OUT/CompletionQueue.tla" ) > "$log" 2>&1
  code=$?
  secs=$(( $(date +%s) - start ))
  states="$(sed -n 's/.* \([0-9,]*\) distinct states found.*/\1/p' "$log" | tail -1 | tr -d ,)"
  depth="$(sed -n 's/^The depth of the complete state graph search is \([0-9]*\).*/\1/p' "$log" | tail -1)"
  if [ "$code" -eq 142 ]; then
    verdict=INCOMPLETE
  elif [ "$code" -eq 0 ] && grep -q '^Model checking completed. No error has been found.' "$log"; then
    verdict=PASS
  elif { [ "$code" -eq 12 ] || [ "$code" -eq 11 ]; } && grep -qE '^Error: (Invariant .* is violated|Deadlock reached)' "$log"; then
    verdict=VIOLATION
  else
    verdict=TOOLING
  fi
  expect="$(trim "$expect")"
  ok=yes
  [ "$verdict" = "$expect" ] || ok=no
  case "$verdict" in
    TOOLING) bump 2 ;;
    INCOMPLETE) bump 3 ;;
    *) [ "$ok" = yes ] || bump 1 ;;
  esac
  if [ "$verdict" = VIOLATION ]; then
    grep -E '^State [0-9]+: <' "$log" | sed 's/ line [0-9].*//' > "$OUT/$name.path.txt"
  fi
  printf '%-24s %-11s %-11s %-4s %10s %6s %8s\n' "$name" "$verdict" "$expect" "$ok" "${states:--}" "${depth:--}" "$secs"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$verdict" "$expect" "$ok" "${states:-}" "${depth:-}" "$secs" "$cfg" >> "$SUMMARY"
done <<EOF
$MATRIX
EOF

[ "$ran" -gt 0 ] || tooling_fail "no matrix row matched --only $ONLY"
case "$worst" in
  0) echo "RESULT: all $ran runs as expected" ;;
  1) echo "RESULT: a verdict differs from EXPECT (see $SUMMARY)" ;;
  2) echo "RESULT: tooling failure (see the .out files in $OUT)" ;;
  3) echo "RESULT: incomplete exploration; raise --timeout or shrink the bounds" ;;
esac
exit "$worst"
