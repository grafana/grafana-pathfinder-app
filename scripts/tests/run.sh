#!/usr/bin/env bash
# Shell-script test entry point (`npm run test:scripts`).
#
# Parses every tracked script, then runs the behavioural suites. shellcheck is
# advisory locally — it is not a dependency of this repo — but the CI job
# installs it, so a warning that lands here fails there.

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)
cd "$REPO_ROOT" || exit 1

STATUS=0

SHELL_FILES=()
while IFS= read -r file; do
  SHELL_FILES+=("$file")
done < <(git ls-files '*.sh')

echo "bash -n over ${#SHELL_FILES[@]} scripts"
for file in "${SHELL_FILES[@]}"; do
  bash -n "$file" || STATUS=1
done

# Scoped to the authoring scripts rather than every tracked .sh: the older
# scripts carry warnings of their own, and cleaning them up belongs to a PR
# that is about them. Widen the glob when they are fixed.
CHECKED=(scripts/lib/*.sh scripts/upsert-*.sh scripts/tests/*.sh)

if command -v shellcheck >/dev/null; then
  echo "shellcheck --severity=warning over ${#CHECKED[@]} scripts"
  # Style-level hints are excluded on purpose: SC2001 fires on the `sed` used
  # for per-line indentation, which parameter expansion cannot do.
  shellcheck -x --severity=warning "${CHECKED[@]}" || STATUS=1
else
  echo "shellcheck not installed; skipping (CI installs it)"
fi

for suite in "${SCRIPT_DIR}"/*.test.sh; do
  echo
  bash "$suite" || STATUS=1
done

exit "$STATUS"
