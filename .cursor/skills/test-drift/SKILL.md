---
name: test-drift
description: 'Audit tests for drift against production code: stale mocks, partial mocks, contract literal mismatches, mock-only verification, dead API coverage, and incomplete setup for claimed behavior. Use when the user invokes /test-drift <target> or asks to find outdated tests.'
---

# test-drift — audit tests for source drift

Report-only audit for stale or misleading tests. This skill finds tests whose mocks, literals, or exercised APIs have drifted away from the production behavior they claim to protect.

## When to use

Use for `/test-drift <target>`, for PR review follow-up on test quality, or before refactors where tests will be used as safety nets.

Requires a concrete target. Accept a test file, source file, directory, glob, or `--changed` for the PR diff. Do not audit the whole repo unless the user explicitly asks for it.

## Invocation

```
/test-drift src/utils/experiments
/test-drift src/utils/experiments/experiment-utils.test.ts --mock-drift
/test-drift --changed
/test-drift src/components/docs-panel --contract --suggestive
```

Modes:

- `--mock-drift` — focus on Jest mock shape and pass-through issues.
- `--dead-api` — focus on tests for exported APIs with no non-test consumers.
- `--contract` — focus on storage keys, event names, feature flags, query params, and `data-test-*` literals.
- `--suggestive` — include lower-confidence candidates after high-confidence findings.
- `--changed` — resolve target from files changed against the current branch's merge base.

## Hard constraints

1. Do not edit files. This skill reports findings only.
2. Prefer false negatives over false positives. A finding must connect a test artifact to a real production symbol, branch, or contract.
3. Do not flag a test just because it uses mocks. Mocking is normal in this repo; flag only drift or missing verification.
4. Do not flag contract/tripwire tests for restating literals when the restatement is deliberate and matches the canonical source.
5. Do not expand from the target into unrelated subsystems. Read only target tests, paired implementation files, directly mocked modules, and canonical contract sources.

## Workflow

### 1. Resolve the target

Build the test file set:

- If target is a test file, use that file.
- If target is a source file, include nearby tests with matching basename plus tests that import it.
- If target is a directory or glob, include matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, and `*.spec.tsx` files.
- If `--changed`, diff against the merge base and include changed tests plus tests adjacent to changed source files.

Print: resolved test count, source count, and skipped files.

### 2. Build inventory

For each test file, collect:

- Imported production modules and named imports.
- `jest.mock` / `jest.doMock` calls and factory return keys.
- `jest.requireActual` pass-through use.
- Mock function declarations (`jest.fn`, `mockImplementation`, `mockResolvedValue`, `mockReturnValue`).
- Contract literals: storage keys, `CustomEvent` names, `addEventListener` names, feature-flag keys, query params, URL path fragments, and `data-test-*` literals.
- Assertions and their target: return value, DOM, storage, event, mock call, thrown error, or snapshot.

For each paired source module, collect:

- Exported symbols.
- Namespace-like exported objects (`StorageKeys`, constants tables, schemas, registries).
- Branches that clear, reset, migrate, sync, persist, or emit externally observable state.
- Non-test importers for exported symbols.

### 3. Load patterns

Read `.cursor/skills/test-drift/PATTERNS.md` every invocation. Do not rely on memory.

Run cheap mechanical filters first, then inspect narrowed candidates manually. Mechanical filters are evidence, not findings.

### 4. Classify risk before reporting

Classify each test file:

- **Mock-heavy**: many `jest.mock` / `jest.doMock` calls or large mock factories.
- **Contract/tripwire**: filename or describe block includes `contract`, `tripwire`, `parity`, `registry`, or `schema`.
- **External-state**: touches `localStorage`, `sessionStorage`, IndexedDB, events, feature flags, network clients, or Grafana runtime APIs.
- **Ordinary behavior**: component or pure-function tests without external contracts.

Use the classification to apply disqualifiers. Contract/tripwire tests get more tolerance for literal restatement; ordinary tests get more scrutiny for mock-only verification.

### 5. Check disqualifiers first

For every candidate, check the pattern's disqualifiers before emitting. If any disqualifier applies, drop it. If a disqualifier cannot be verified, demote to suggestive.

### 6. Report

Emit high-confidence findings first. Include suggestive findings only with `--suggestive`.

Per finding:

```markdown
### [Pattern ID] — [pattern name]

- **Confidence**: high | suggestive
- **Locations**:
  - `path/to/test.test.ts:12-34`
  - `path/to/source.ts:56-78`
- **Evidence**: One paragraph tying the test artifact to the source symbol, branch, or contract that drifted.
- **Disqualifiers checked**:
  - <checked item>
- **Suggested action**: Minimal test change that would close the gap.
```

If clean:

> No high-confidence test drift found in `<target>`. Run with `--suggestive` to include lower-confidence candidates.

## Validation guidance

When using this skill to evaluate a proposed test fix, run the narrowest relevant test command after the fix is applied by another workflow:

```
npm run test:ci -- --runTestsByPath <test-file> --no-cache
```

This skill itself does not require running tests to report drift, but passing tests are useful evidence after remediation.
