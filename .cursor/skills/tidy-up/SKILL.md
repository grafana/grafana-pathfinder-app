---
name: tidyup
description: Run typecheck, lint, and tests for both frontend and Go backend to tidy and test the code prior to committing and pushing.
---

# Tidy up

This skill runs a bunch of housekeeping tasks that need to be done prior to preparing code for commit
and push. Our CI system will fail code that has errors in prettier, and a common source of silly
CI build failures are things in this category.

For all steps, the intention is only to fix trivial syntax errors and or errors whose cause is
obvious in branch context. If you find semantic errors, missing code, or anything unusual,
STOP and ask the user what to do, do not proceed.

## Workflow

### Step 1: Run `npm run typecheck`

Fix all trivial TypeScript syntax errors.

### Step 2: Run `npm run lint:fix`

Fix all trivial linting errors.

Note: Prettier formatting is handled automatically by Husky's pre-commit hook via lint-staged, so it doesn't need to be run manually here.

### Step 3: Run frontend unit tests: `npm run test:ci`

All should pass; if unit tests break and the cause is obvious (i.e. a missing import,
or a slight syntax error) you can go ahead and fix them. If unit tests fail due to
changed functionality, STOP and ask the user what to do.

### Step 4: Run Go lint: `npm run lint:go`

Fix all Go linting errors. If golangci-lint reports issues, address them.

### Step 5: Run Go tests: `npm run test:go`

All Go tests should pass. If tests fail and the cause is obvious, fix them.
If tests fail due to changed functionality, STOP and ask the user what to do.

### Step 6: Build Go backend: `go build ./...`

Verify the Go backend compiles without errors.

## Summary

Provide very brief output that looks like this:

Typecheck: <N> files modified
Lint: <N> files modified
Frontend tests: (PASS|FAIL)
Go lint: (PASS|FAIL)
Go tests: (PASS|FAIL)
Go build: (PASS|FAIL)

If any step fails, provide details on why.
