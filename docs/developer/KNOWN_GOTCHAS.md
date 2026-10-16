# Known gotchas

Environment and CI traps that make a red check look like your branch's fault. Each entry says how to tell the trap from a real failure. Remove an entry when its cause is fixed.

## A fresh worktree fails typecheck with about 100,000 errors

`.config/tsconfig.json` sets `typeRoots` to `../node_modules/@types`, a relative path. A new `git worktree` has no `node_modules`, so `npm run typecheck` reports a flood of `Cannot find name 'describe'` and `Cannot find name 'expect'` errors. Link or install dependencies before any typecheck, test, or `npm run check` in a worktree:

```bash
ln -s <main-checkout>/node_modules <worktree>/node_modules
```

Tell subagents dispatched into worktrees about this before they start.

## A local check fails on files you did not touch

A local tool that is newer or older than the CI pin can report findings CI does not. Compare your version to the pin:

- Prettier: `./node_modules/.bin/prettier --version` against `package-lock.json`. A mismatch rewrites untouched files; run `npm ci`.
- golangci-lint: `golangci-lint --version` against `GOLANGCI_LINT_VERSION` in `.github/workflows/ci.yml`.
- Go: `go version` against the `go` line in `go.mod`.

Then reproduce on a pristine `origin/main` worktree. If main fails the same way, the failure is not yours. Never regenerate a golden file (for example with `go test -update`) under a toolchain that differs from the pin.

## `go test -race -shuffle=on ./pkg/plugin` fails on main

The `withFrozenTime` helper in `pkg/plugin/package_recommendations_test.go` writes the package-global `timeNow` while a package-recommendations background refresh reads it. With `-shuffle=on`, the race fails most runs on plain main, and the blamed test changes from run to run. CI runs `-race` without `-shuffle`, so this never blocks a PR. Before investigating a shuffled failure, compare against a pristine main worktree.

## A green CI Gate does not cover the e2e matrix

`playwright-tests` is not in the `ci-gate` job's `needs:` in `.github/workflows/ci.yml`. The e2e version matrix, including the React 19 host job and the jobs that prove the `grafanaDependency` floor, is advisory. On a dependency or host-compatibility PR, read the e2e jobs by name instead of trusting the gate.

## The two-tab pairing fail-open test flakes in CI

`fails open to a stripped local check when the live tab never answers (§6.5)` in `src/components/interactive-tutorial/interactive-step.test.tsx` can time out on a slow CI runner with only a `heartbeat` posted (first seen July 2026). If it fails on a PR that does not touch interactive-tutorial or cross-tab code, rerun the failed jobs before debugging.
