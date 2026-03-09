---
name: tidyup
description: Run typecheck, lint, and tests for both frontend and Go backend to tidy and test the code prior to committing and pushing.
---

# Tidy up

This skill runs housekeeping tasks that need to pass before code is committed and pushed.
CI runs `npm run check` (typecheck, lint, prettier, lint:go, test:go, test:ci) and rejects
code that fails any of those. Running this skill catches those failures early and fixes what
it can.

> **Read-only alternative:** If you only want to _validate_ without fixing anything,
> run `npm run check` directly. It mirrors the CI gate exactly.

## Hard constraints

These constraints are absolute and override any other instructions:

1. **Only fix trivial errors** — missing imports, unused variables, minor type mismatches,
   formatting issues, and similar mechanical problems whose fix is obvious from context.
2. **NEVER fix semantic or functional errors** without explicit user approval. If the code
   compiles but does something wrong, that is not a tidy-up task.
3. **NEVER delete, comment-out, or weaken test assertions** to make tests pass.
4. **NEVER modify architecture allowlists** (`ALLOWED_VERTICAL_VIOLATIONS`,
   `ALLOWED_LATERAL_VIOLATIONS`, `ALLOWED_BARREL_VIOLATIONS` in `architecture.test.ts`).
5. **NEVER update Jest snapshots** without user approval — snapshot changes reflect
   intentional UI changes that require human review.
6. **Cap at 2 fix-and-retry cycles per step.** If a step still fails after two rounds of
   fixes, STOP and ask the user.
7. **If a single step produces more than ~10 errors**, STOP and ask the user before
   attempting fixes. The branch likely has deeper issues that should not be bulk-fixed.

## Prerequisites

Before running any steps, verify the environment:

1. **Working directory** is the repository root (where `package.json` lives).
2. **`node_modules/` exists.** If missing, run `npm install` and wait for it to complete.
3. **Go toolchain is available.** Run `go version` and `mage --version`. If either fails,
   warn the user and skip Go steps (4–6) rather than aborting the entire workflow.

## Workflow

Steps are numbered to match the order CI runs them. **Frontend steps (1–3) must run
sequentially** because each step may fix files that later steps depend on. **Go steps (4–6)
are independent of frontend steps** and can run in parallel with Step 3 (frontend tests)
using parallel tool calls to save wall-clock time.

```
                    ┌─────────────────┐
                    │  Prerequisites  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  1. Typecheck   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ 2. Lint+Prettier│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐  ┌──▼───────┐  ┌──▼──────────┐
     │ 3. FE tests    │  │ 4. Go    │  │ 5. Go tests │
     │ (npm test:ci)  │  │    lint  │  │             │
     └────────┬───────┘  └──┬───────┘  └──┬──────────┘
              │              │              │
              │              │     ┌────────▼────────┐
              │              │     │ 6. Go build     │
              │              │     └────────┬────────┘
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │    Summary      │
                    └─────────────────┘
```

### Step 1: Typecheck — `npm run typecheck`

Run `tsc --noEmit` via `npm run typecheck`.

- If errors are found and are trivially fixable (missing imports, minor type annotations),
  fix them and **re-run `npm run typecheck`** to verify.
- Cap at 2 fix-and-retry cycles. If errors remain after the second retry, STOP and report.

### Step 2: Lint + Prettier — `npm run lint:fix`

Run `npm run lint:fix` which executes both ESLint with `--fix` and Prettier with `--write`.

- After `lint:fix` completes, **verify** by running `npm run lint && npm run prettier-test`.
- If verification still reports errors, inspect them. Fix trivially fixable ones and re-verify.
- Cap at 2 fix-and-retry cycles.

Note: Husky's pre-commit hook runs Prettier on staged files, but that only covers files
already staged. The agent may have modified files during Step 1, so running Prettier
explicitly here catches everything.

### Step 3: Frontend tests — `npm run test:ci`

Run `npm run test:ci` (Jest with `--maxWorkers 4`).

- If tests pass, move on.
- If tests fail and the cause is trivial (missing import, minor syntax), fix and re-run.
- **STOP and ask the user** if:
  - Tests fail due to changed functionality or intentional behavior changes.
  - `architecture.test.ts` fails (tier boundary violations are not trivial fixes).
  - Snapshot mismatches occur (require user decision on whether to update).

**Parallelism:** Once Step 2 is verified clean, launch Step 3 and Steps 4–6 in parallel
using concurrent tool calls.

### Step 4: Go lint — `npm run lint:go`

Run `npm run lint:go` (executes `mage -v lint` / golangci-lint).

- Fix trivially fixable Go lint errors (formatting, unused imports) and re-run to verify.
- Cap at 2 fix-and-retry cycles.

### Step 5: Go tests — `npm run test:go`

Run `npm run test:go` (executes `mage -v test`).

- If tests pass, move on.
- If tests fail and the cause is trivial, fix and re-run.
- **STOP and ask the user** if tests fail due to changed functionality.

### Step 6: Go build — `go build ./...`

Run from the **repository root**:

```bash
go build ./...
```

This verifies the entire Go module compiles. If it fails after Steps 4–5 passed, the issue
is likely a missing dependency — try `go mod tidy` and rebuild once before stopping.

## Troubleshooting

Common failures and how to handle them:

| Symptom                                 | Likely cause                                            | Action                                                   |
| --------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `Cannot find module '...'` in typecheck | Missing npm dependency or stale `node_modules`          | Run `npm install`, then retry Step 1                     |
| 50+ typecheck errors                    | Branch is far behind main or has structural issues      | STOP and ask — do not attempt bulk fixes                 |
| `architecture.test.ts` fails            | Import violates tier boundary                           | STOP — these require intentional architectural decisions |
| Jest snapshot mismatch                  | Intentional UI change                                   | STOP — ask user whether to run `jest --updateSnapshot`   |
| `Cannot find package` in Go build       | Missing Go dependency                                   | Run `go mod tidy`, retry                                 |
| Go lint `could not load`                | Go module cache stale or missing dependency             | Run `go mod download`, retry                             |
| `lint:fix` creates unstaged changes     | Agent modified files that aren't tracked by lint-staged | Expected — these will be included in the commit          |

## Summary

When all steps complete, provide output in this format:

```
Tidy-up complete

| Step            | Result | Files modified |
|-----------------|--------|----------------|
| Typecheck       | PASS   | 3              |
| Lint + Prettier | PASS   | 5              |
| Frontend tests  | PASS   | --             |
| Go lint         | PASS   | 0              |
| Go tests        | PASS   | --             |
| Go build        | PASS   | --             |
```

- **Result** is PASS, FAIL, or SKIPPED (if Go toolchain was unavailable).
- **Files modified** is the count of files the agent changed to fix errors in that step,
  or `--` for steps that only validate.
- If any step failed, include a brief explanation of why below the table.
