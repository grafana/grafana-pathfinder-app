---
name: tidyup
description: Run npm run typecheck, npm run lint:fix, npm run prettier, and npm run test:ci to tidy and test the code prior to committing and pushing.
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

Fix all trivial syntax errors.

### Step 2: Run `npm run lint:fix`

Fix all trivial linting errors.

### Step 3: Run `npm run prettier`

Fix all trivial prettier issues; this will modify local files.

### Step 4: Run unit tests: `npm run test:ci`

All should pass; if unit tests break and the cause is obvious (i.e. a missing import,
or a slight syntax error) you can go ahead and fix them. If unit tests fail due to
changed functionality, STOP and ask the user what to do.

## Summary

Provide very brief output that looks like this:

Typecheck: <N> files modified
Lint: <N> files modified
Prettier: <N> files modified
Unit tests: (PASS|FAIL)

If any step fails, provide details on why.
