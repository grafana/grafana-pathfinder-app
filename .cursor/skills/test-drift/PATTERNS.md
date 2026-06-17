# test-drift — pattern catalog

Each pattern has:

- **Definition** — one sentence.
- **Severity** — 1 (maintenance risk), 2 (test safety-net risk), 3 (likely misleading or missing verification for important behavior).
- **High-confidence signature** — emit by default when all bullets apply and no disqualifier matches.
- **Suggestive signature** — emit only with `--suggestive`.
- **Disqualifiers** — hard filters.

## TD1 — outdated module mock shape

- **Definition**: A Jest module factory returns a hand-written shape that no longer matches the production module or the subject's required contract.
- **Severity**: 3
- **High-confidence signature**:
  - Test uses `jest.mock` or `jest.doMock` with an object factory for a production module.
  - The mocked module contains a namespace-like object, constants table, registry, schema map, or function bag.
  - The subject under test reads a property that is absent from the mock, or the canonical source has a contract key the test claims to cover but the mock omits.
  - The test still passes because the missing property is not asserted directly or only affects an unseeded branch.
- **Suggestive signature**:
  - Mocked object has fewer keys than a nearby exported constants table and the test targets code that reads that table.
  - Mock factory is older than recent changes to the mocked source module.
- **Disqualifiers**:
  - Mock intentionally exposes only the one key under test and the test asserts that exact narrow behavior.
  - Mock spreads `jest.requireActual` before overriding specific members.
  - Missing export is unrelated to the subject under test.
  - Mock represents an external package, not a repo module.

## TD2 — partial mock without pass-through

- **Definition**: A test replaces a multi-export production module without passing through real exports, making the test vulnerable to stale module shape.
- **Severity**: 2
- **High-confidence signature**:
  - `jest.mock` or `jest.doMock` targets a repo module with multiple exports.
  - The mock factory does not call `jest.requireActual`.
  - The subject under test imports or indirectly depends on more exports than the mock provides.
  - At least one missing export affects initialization, branching, or contract construction.
- **Suggestive signature**:
  - The mock factory is large and manually repeats several production values.
  - The mocked module has churned recently.
- **Disqualifiers**:
  - The test uses `jest.isolateModules` to explicitly test initialization with a synthetic module shape.
  - The mocked module is a framework boundary where a complete fake is clearer than pass-through.
  - The source module has one export or the mock covers every export used by the subject.

## TD3 — contract literal drift

- **Definition**: A test repeats an external contract literal that disagrees with the canonical constant or registry.
- **Severity**: 3
- **High-confidence signature**:
  - Literal is a storage key, event name, feature-flag key, query parameter, route, `data-test-*` value, schema value, or public registry key.
  - A canonical constant, schema, registry, or contract helper exists in production code.
  - The test's literal differs from the canonical value, omits a required dynamic prefix/suffix, or asserts only a subset of the canonical contract while claiming full coverage.
- **Suggestive signature**:
  - Test repeats a contract literal even though a canonical constant is importable from a lower or same tier.
  - Test has comments claiming compatibility with an old key but no assertion against the old key.
- **Disqualifiers**:
  - Test is a deliberate contract lock that restates the canonical string to catch accidental constant edits.
  - Literal is fixture data rather than a contract.
  - Test covers migration from old literal to new literal and asserts both sides.

## TD4 — mock-only verification

- **Definition**: A test asserts that a mock was called but does not assert the observable behavior that call is supposed to produce.
- **Severity**: 2
- **High-confidence signature**:
  - Test's primary assertion is `toHaveBeenCalled`, `toHaveBeenCalledWith`, or a mock call count.
  - The implementation path should also produce observable state: DOM output, return value, storage mutation, emitted event, navigation, or error result.
  - The observable state is not asserted anywhere in the test or describe block.
- **Suggestive signature**:
  - Test asserts both a mock call and weak existence checks such as `toBeDefined` or `toBeTruthy`.
- **Disqualifiers**:
  - The mock call is itself the contract, such as analytics event payload, logger invocation, callback prop invocation, or command adapter boundary.
  - Another assertion in the same test verifies the resulting state.
  - Test is an explicit smoke test.

## TD5 — dead API coverage

- **Definition**: A test exercises an exported production symbol with no non-test consumers, giving confidence in code that may not be reachable.
- **Severity**: 1
- **High-confidence signature**:
  - Test imports an exported production function, class, constant, or hook.
  - Grep/import graph shows no non-test importers and no framework, CLI, schema, route, or dynamic-entry usage.
  - The export is not part of a documented public API or barrel surface.
- **Suggestive signature**:
  - Export has only one non-test importer that is itself unused outside tests.
- **Disqualifiers**:
  - Export is intentionally public through a barrel or package boundary.
  - Export is used by reflection, dynamic import, schema tooling, CLI entry points, plugin registration, or external consumers.
  - Test is a characterization test before planned refactor and the export is temporary by design.

## TD6 — unseeded behavior branch

- **Definition**: A test name or setup claims to verify reset, cleanup, migration, sync, or fallback behavior but seeds only part of the state the implementation handles.
- **Severity**: 3
- **High-confidence signature**:
  - Test name or describe block claims broad behavior: clears all state, migrates old format, syncs storages, resets experiment state, restores tabs, or handles fallback.
  - Implementation branch touches multiple observable stores, keys, emitted events, or outputs.
  - Test seeds and asserts only one of those observables, leaving at least one changed branch unexercised.
- **Suggestive signature**:
  - Test asserts cleanup but does not seed pre-existing state.
  - Test covers only happy-path state for a function whose name includes `reset`, `clear`, `restore`, `sync`, `migrate`, or `fallback`.
- **Disqualifiers**:
  - Test name is intentionally narrow and another test covers the remaining branch.
  - Unseeded branch is defensive handling for unavailable browser APIs or impossible states.
  - The implementation delegates cleanup to another function that has direct tests.
