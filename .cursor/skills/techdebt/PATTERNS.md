# techdebt — Pattern Catalog

Each pattern entry has:

- **Definition** — one sentence
- **Severity** — 1 (cosmetic), 2 (maintenance hazard), 3 (correctness or compounding risk). Used in `hotspot_score = churn_90d × severity`.
- **High-confidence signature** — emit by default when all bullets apply
- **Suggestive signature** — partial match; emit only with `--suggestive`
- **Disqualifiers** — hard filters. If any disqualifier applies, drop the candidate or demote to suggestive.

The skill MUST check disqualifiers before emitting a finding. See `SKILL.md` for the protocol.

---

## Category A — Local syntactic (single-file, AST-detectable)

### A1 — Cargo-Cult Commentary

- **Definition**: Comments that restate what the code says rather than explaining why, creating a second source of truth that drifts.
- **Severity**: 1
- **High-confidence signature**:
  - Comment line above a statement whose text paraphrases the statement's identifiers (e.g., `// Set the user name` above `user.name = input.value`).
  - JSDoc/docstring on a function whose `@param` descriptions only restate parameter types and names.
  - Comment density (comment lines ÷ LOC) > 30% in a file that is not a public library API surface.
- **Suggestive signature**:
  - Multiple block comments inside a single function narrating each step.
  - Comment refers to behavior absent from the code below it (requires `git blame` to confirm drift).
- **Disqualifiers**:
  - File is a documented public API surface (exported types in a library package, OpenAPI schemas, generated docs source).
  - Comment references external context: ticket ID, RFC, bug ID, browser/runtime quirk, regulatory requirement.
  - Comment explains _why_ a non-obvious choice was made — test: does it contain "because" or contrast with an alternative?

### A2 — God Component / Large Component

- **Definition**: A single component owning too many responsibilities — too many hooks, props, state slices, or rendering branches.
- **Severity**: 3
- **High-confidence signature** (two or more must apply):
  - LOC > 300 in a single component file.
  - Props count > 10 on a single component.
  - Hook calls > 8 inside a single function component.
  - Separate `useState` / `useReducer` calls > 6 with low referential overlap between slices.
- **Suggestive signature**:
  - Component returns JSX from multiple internal `renderHeader` / `renderBody` / `renderFooter`-style helpers.
  - Generic component name (`Container`, `Wrapper`, `Page`, `Manager`) — naming itself signals diffuse responsibility.
- **Disqualifiers**:
  - Top-level route/page component legitimately composing multiple concerns. (Flag with softer threshold if at all.)
  - Form with many genuine fields — count fields, not just props.
  - Generated code (codegen, GraphQL types, OpenAPI clients).

### A3 — Over-Specified Defense

- **Definition**: Guard clauses, null checks, or error handling for cases that cannot occur given the types or call sites.
- **Severity**: 2
- **High-confidence signature**:
  - Null/undefined check on a parameter whose TypeScript type is non-nullable.
  - `try`/`catch` wrapping code that cannot throw (pure synchronous computation, no I/O).
  - `default` branch on a `switch` over an exhaustive union type, especially one that throws "unreachable."
  - Hypothetical features beyond stated requirements (e.g., OAuth wiring with no auth requirement; retry logic on an in-process function call).
- **Suggestive signature**:
  - Optional-chain ladders (`if (x && x.y && x.y.z)`) against fully-typed objects.
  - Re-validation of input shapes already validated upstream (requires call-site tracing).
- **Disqualifiers**:
  - Public API boundary: network, file I/O, IPC, user input, third-party callbacks.
  - Defending against documented bugs in a third-party library.
  - Type assertion or guard added because TypeScript's flow analysis cannot prove safety (look for `// eslint-disable` or comments to this effect).

### A4 — Multiple Booleans for State

- **Definition**: Two or more boolean state variables in the same component where only certain combinations are valid — a discriminated union or enum would be clearer.
- **Severity**: 2
- **High-confidence signature**:
  - Single component has ≥ 3 boolean state variables (`isLoading`, `isError`, `isSuccess`, `isIdle`, ...) that are mutually exclusive in practice.
  - JSX contains conditions like `!isLoading && !isError && data` — implicit state machine encoded in `&&` chains.
- **Suggestive signature**:
  - Two booleans where one is the negation of a derived value of the other.
- **Disqualifiers**:
  - Booleans are genuinely orthogonal (e.g., `isExpanded` + `isSelected` on a tree node — they vary independently).

### A5 — Any-Type / Non-Null Assertion Cluster

- **Definition**: Concentrated use of `any`, `as unknown as`, or `!` non-null assertions, especially in recently-added code.
- **Severity**: 2
- **High-confidence signature**:
  - More than 2 of (`any`, `as unknown as`, `!` non-null assertion) per 100 LOC in a single file.
  - A cluster of these in a single recent commit (use `git log -p` to confirm).
- **Suggestive signature**:
  - A function whose return type is `any` because the body lost type narrowing partway through.
- **Disqualifiers**:
  - Test files (looser typing is conventional).
  - Interop layer with an untyped library (look for the import).
  - Type assertion with an adjacent comment justifying why TypeScript flow analysis cannot prove the narrowing.

---

## Category B — Cross-file structural (corpus-similarity)

> No embedding service is assumed. The agent is the similarity engine. In `Evidence`, state the explicit comparison: which symbols, what's structurally identical, what's cosmetically different (variable names, statement order, equivalent control flow). Normalize bodies before judging — strip imports, JSX scaffolding, and comments.

### B1 — Near-Duplicate Function

- **Definition**: Two or more functions implementing the same logic with cosmetic differences (renamed variables, reordered statements, equivalent control flow).
- **Severity**: 3
- **High-confidence signature**:
  - Two functions in different files have structurally identical bodies after normalization (rename variables, ignore JSX scaffolding, sort independent statements).
  - Signatures are compatible (same arity, parameter types substitutable).
  - Neither function imports the other (rules out delegation).
- **Suggestive signature**:
  - Functions whose bodies share the same algorithm shape but diverge on one branch.
  - Differently-named functions implementing the same data transformation.
- **Disqualifiers**:
  - Similarity is in trivial boilerplate (React component shells around different JSX content). Re-normalize stripping JSX entirely; if what remains is small, drop.
  - Intentional variant — adjacent files with names that signal variation (`Button.tsx` and `IconButton.tsx`), or one explicitly extends the other.
  - Generated code, fixtures, examples, test snapshots.

### B2 — Reinvented Hook

- **Definition**: A custom hook (or inline hook composition in a component) that duplicates the structure of an exported hook elsewhere in the project.
- **Severity**: 2
- **High-confidence signature**:
  - Component contains a sequence of hook calls (e.g., `useState` + `useEffect` + `useCallback`) whose data flow matches an exported hook in the project.
  - The component's file does not import the existing hook.
- **Suggestive signature**:
  - Inline `useEffect`-with-`fetch`-and-loading-state when the project has a data-fetching hook (`useQuery`, `useFetch`, etc.).
- **Disqualifiers**:
  - The existing hook lives in a package boundary the component genuinely can't import.
  - The inline version has materially different behavior (different cache key strategy, different error-handling contract, different cleanup semantics).

### B3 — Reinvented Library Function

- **Definition**: A function whose signature and body match a well-known utility from a library already in `package.json`.
- **Severity**: 2
- **High-confidence signature**:
  - Function body matches the normalized shape of a known utility (`debounce`, `throttle`, `groupBy`, `pick`, `omit`, `chunk`, `uniq`, `flatten`, `deepClone`, `isEqual`, date math, etc.).
  - That library is in `package.json` dependencies.
- **Suggestive signature**:
  - Function name matches a well-known utility name regardless of whether the library is installed — surface as "consider adopting the library version."
- **Disqualifiers**:
  - The reimplementation is materially different (type-safe variant the library lacks, different edge-case behavior).
  - The library version has a known cost in this context (e.g., full `lodash` in a client bundle without per-method imports).
  - The implementation predates the dependency being added — check `git log -L` if churn is low.

### B4 — Convergent Re-Bugging

- **Definition**: The same latent bug appearing in multiple places where the same logic was independently reimplemented.
- **Severity**: 3
- **High-confidence signature**:
  - A B1 hit (near-duplicate functions) where the duplicates share an anti-pattern: missing null check on the same field, same off-by-one, same race-condition shape, same forgotten edge case.
- **Suggestive signature**:
  - Two functions implement the same task and both lack a check the codebase performs elsewhere for similar inputs.
- **Disqualifiers**:
  - None. When B4 hits, always surface it — fixing it fixes multiple latent bugs at once.

---

## Category C — Delegation and architectural (graph-level)

### C1 — Prop Drilling

- **Definition**: A prop passed through N consecutive components in the render tree without being read or transformed by intermediate components.
- **Severity**: 2
- **High-confidence signature**:
  - Named prop appears in the props interface of ≥ 3 consecutive components along a render path.
  - Intermediate components only forward the prop — no read, no transform, no conditional logic on it.
- **Suggestive signature**:
  - Prop drilled through 2 levels with the third level imminent (look at recent diffs).
- **Disqualifiers**:
  - Theming, locale, auth, or other context-like values where the pattern is intentional and context API was deliberately avoided. Check for comments or ADRs explaining the choice.
  - Render-prop wrappers or higher-order components whose contract is forwarding.

### C2 — Pass-Through Delegation (Middle Man)

- **Definition**: A function whose entire body is a single call to another function with the same arguments — Fowler's Middle Man at function granularity.
- **Severity**: 1
- **High-confidence signature**:
  - Function body is exactly `return otherFn(...args)` (or near-equivalent allowing only argument renaming).
  - No transformation, validation, logging, or side effect occurs in the wrapper.
- **Suggestive signature**:
  - Class or module whose exported surface is predominantly thin pass-throughs to a single delegate.
- **Disqualifiers**:
  - The wrapper is the public API boundary that intentionally hides the inner function. (In that case, the _inner_ should be internal — flag the visibility mismatch instead.)
  - The wrapper exists to apply a type narrowing or generic constraint that adds real safety. Verify by checking the signatures differ in a load-bearing way.

### C3 — Drift Hub

- **Definition**: A file with high churn, high incoming dependency count, and monotonic growth — the place where compounding debt accumulates.
- **Severity**: 3
- **High-confidence signature**:
  - File is in the top 5% of churn over the last 90 days (`git log --since="90 days ago" --pretty=format:"%H" -- <file> | wc -l` ranked against the subsystem).
  - Incoming imports above a subsystem-relative threshold (rule of thumb: > 8 importers in subsystems of < 100 files; scale up for larger subsystems).
  - Average lines-added-per-commit exceeds lines-removed (`git log --shortstat --since="90 days ago" -- <file>`).
- **Suggestive signature**:
  - High churn but moderate fan-in.
  - High fan-in but moderate churn.
- **Disqualifiers**:
  - None. C3 is a prioritization signal — when it fires alongside other patterns, those patterns should be ranked first.

### C4 — Orphan Cluster

- **Definition**: A set of files that import each other heavily but are rarely imported by the rest of the codebase — a dead or near-dead subsystem.
- **Severity**: 2
- **High-confidence signature**:
  - Strongly connected component in the import graph with low external in-degree (the cluster's external in-degree summed across files is less than its internal edge count).
  - The cluster's only external callers are its own tests.
- **Suggestive signature**:
  - A cluster reachable only via one entry-point file that is itself rarely imported.
- **Disqualifiers**:
  - Feature-flagged code intentionally dormant (look for flag references).
  - Code reachable only via dynamic import (`await import(...)`) — grep for dynamic imports targeting the cluster.
  - CLI entry points / scripts that are invoked by build tooling, not imported.

---

## Category D — Process debt

### D1 — Stale Memory Drift

- **Definition**: Agent-facing memory files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*`) describe an architecture or constraint that the current code no longer reflects.
- **Severity**: 2
- **High-confidence signature**:
  - A memory/doc file claims a specific file path, symbol, or import edge that no longer exists. Verify by `grep` against current code.
  - A memory/doc file states a constraint ("X must not depend on Y", "always use Z for W") that the current code violates.
- **Suggestive signature**:
  - Memory file last modified > 90 days before files it describes (`git log -1 --format=%ct`); content references symbols that have churned heavily since.
- **Disqualifiers**:
  - Doc is dated/scoped to a milestone (e.g., header says "as of v2.x") and the current version differs.
  - Constraint is documented as aspirational future state, not current.

### D2 — Test-Generation Debt

- **Definition**: Tests that exercise code without asserting meaningful behavior — generated to satisfy coverage rather than verify correctness.
- **Severity**: 3
- **High-confidence signature**:
  - Test file has assertions-per-test ratio < 1 on average (count `expect(` / `assert*` / `should.` per `it(` or `test(`).
  - Multiple tests whose only assertions are `toBeDefined`, `toBeTruthy`, `not.toThrow`, or equivalent existence checks.
  - Mock-heavy tests where the mocks are the only thing being verified (test asserts a mock was called, but the mock has no contract that ties it to real behavior).
- **Suggestive signature**:
  - Snapshot-only tests on logic-bearing functions (snapshots ratify whatever the code does today).
  - Tests with identical `arrange` blocks differing only in trivial parameter values, all asserting the same shape.
- **Disqualifiers**:
  - Smoke tests explicitly intended to verify wiring / module loading. Check filename or describe-block name.
  - Type-only tests (e.g., `tsd` test suites) that legitimately use existence assertions.
  - Tests for code whose only contract is "does not throw" (e.g., logger initializers).

---

## Category E — Operational debt (extraction-seam patterns)

These detect the high-risk seams that resist refactoring: imperative resource managers, ad-hoc async state machines, module-level mutable state, and scattered contract surfaces. Agentic engineering amplifies all of them — agents extend existing files rather than introduce new modules, so these patterns accrete in place.

Each E-pattern is intentionally scoped small so that one finding = one chip-away session.

### E1 — Imperative Resource Manager Mixed with Logic

- **Definition**: A file or class owns timers, observers, or external subscriptions AND also contains business logic, with no clear separation between resource lifecycle and behavior.
- **Severity**: 2
- **High-confidence signature**:
  - File contains 2+ of: `setInterval`, `setTimeout` (long-lived), `addEventListener`, `MutationObserver`, `IntersectionObserver`, `ResizeObserver`, `requestAnimationFrame` loops, external subscriptions (`.subscribe(`).
  - Same file contains business logic functions (transformations, decisions, validation, content shaping) that are NOT the resource's direct callback.
  - Resource cleanup (`removeEventListener` / `clearInterval` / `disconnect` / `.unsubscribe()`) is scattered across multiple methods or absent.
- **Suggestive signature**:
  - Resource setup and cleanup are >100 LOC apart in the same file.
  - Resource managed via `useRef` for the handle and `useEffect` for setup, with cleanup logic that has grown beyond the effect's return.
- **Disqualifiers**:
  - File is explicitly a resource wrapper (name like `useEventListener`, `*Manager`, `*Subscription`) — its purpose IS resource management.
  - Framework integration boundary where this is conventional (`useEffect`-based DOM listener attachment for a single event with paired cleanup is fine).

### E2 — Inline Async State Machine

- **Definition**: Ad-hoc async coordination (debounce + retry + cancellation + in-flight tracking) embedded in a component method or hook body instead of a named state-machine helper.
- **Severity**: 3
- **High-confidence signature**:
  - A single function or hook body contains 3+ of: `setTimeout` for debounce, `AbortController`, `Promise.race`, retry loop with backoff (recursive or `for` with sleep), `useRef` for "is this the latest call" tracking, manual cancellation tokens.
  - Stale-result guarding via `if (ref.current !== thisCallId) return;` or equivalent.
- **Suggestive signature**:
  - Inline debounce-and-fetch pattern when another file in the project has the same pattern (suggests both should adopt a shared machine).
  - `useEffect` with cleanup that cancels an in-flight async — usually the seed of a state machine that hasn't been extracted.
- **Disqualifiers**:
  - Genuinely one-off async with no concurrency concerns (single event, no cancellation needed).
  - Framework-provided coordination (`react-query`, `SWR`, RTK Query) in use — inline code is just configuration.

### E3 — Singleton Used Outside Boundary

- **Definition**: A module-level singleton instance (not a class) is imported by deep business logic where dependency injection would let tests substitute it.
- **Severity**: 2
- **High-confidence signature**:
  - File exports a pre-constructed instance (`export const fooManager = new FooManager()` or `export const x = createX()`).
  - That export is imported by ≥ 3 non-test files.
  - At least one consumer is inside a React component, hook, or pure business function (not just a boundary like an entry point or framework integration).
  - Tests for the consumers contain `jest.mock(...)` or equivalent targeting this module — direct evidence the singleton is a test-friction point.
- **Suggestive signature**:
  - Singleton holds mutable state that varies the consumer's behavior across calls (not just a function bag).
- **Disqualifiers**:
  - Singleton IS the boundary (analytics, logger, telemetry, feature-flag client, error reporter) — global is intentional.
  - Singleton has no mutable state and exposes only pure functions — it's a namespace, not a singleton in the load-bearing sense.

### E4 — Module-Level Mutable Registry

- **Definition**: A file-level `let`, `Map`, `Set`, or array declared outside any function or class, mutated by exported functions in the file — a hidden project singleton with no named lifecycle owner.
- **Severity**: 3
- **High-confidence signature**:
  - Top-level declaration: `let foo`, `const bar = new Map()`, `const baz = new Set()`, or `const xs: T[] = []` outside any function/class scope.
  - Mutation observed in ≥ 2 exported functions of the file (`.set(`, `.add(`, `.push(`, reassignment).
  - No paired init/dispose, no React provider hosting it, no service that owns its lifecycle.
- **Suggestive signature**:
  - Module-level cache without TTL, eviction, or explicit clear.
  - Module-level array used as an event bus or queue.
  - Test files clear the registry in `beforeEach` / `afterEach` — strong signal the lifecycle is implicit and tests are working around it.
- **Disqualifiers**:
  - Read-only constants table (frozen, no mutations after first assignment).
  - Memoization cache with a documented eviction strategy or explicit `clear()` exported.
  - Module-level state that IS the framework's intended pattern (e.g., a Redux store, a Zustand store) — the lifecycle owner is the framework.

### E5 — Contract Surface Scatter

- **Definition**: An external contract value (CustomEvent name, storage key, URL query param, test ID, feature-flag identifier) appears as a string literal in multiple files instead of a single shared constant.
- **Severity**: 2
- **High-confidence signature**:
  - Identical string literal appears in ≥ 3 files; the literal is one of:
    - A CustomEvent type (used with `dispatchEvent` / `addEventListener` / `new CustomEvent`)
    - A storage key (`localStorage.{get,set,remove}Item`, `sessionStorage.*`, IndexedDB store/object name)
    - A URL query parameter (`searchParams.get`/`set`/`has`/`delete`)
    - A `data-testid` attribute value
    - A feature-flag key (project-conventional pattern: `getFlag('...')`, `isEnabled('...')`)
  - At least one consumer is in a different package boundary than the producer (different top-level subdirectory).
- **Suggestive signature**:
  - Same literal in exactly 2 production files.
  - A shared constant exists for this value AND the raw literal also appears elsewhere — bypass-in-progress.
- **Disqualifiers**:
  - The literal IS the shared constant: declared once and re-exported / imported elsewhere — grep confirms the other occurrences are imports of the constant, not duplicate literals.
  - Test fixtures intentionally re-stating the contract for documentation.
  - Migration window where old and new keys coexist intentionally — look for a comment or ADR.

### E6 — Bootstrap Orchestration at Root

- **Definition**: A designated entry-point file accumulates multiple subsystem setup concerns whose ordering matters, instead of delegating to focused bootstrap modules.
- **Severity**: 3
- **High-confidence signature**:
  - File is the project's designated entry point (matches `package.json` `main` / `module` / `exports` field, or follows convention: `src/index.*`, `src/main.*`, `src/module.*`, `src/App.*`, `src/server.*`).
  - File exceeds 150 LOC and contains ≥ 3 distinct setup concerns at top level (e.g., feature-flag init + routing registration + storage init + telemetry boot + i18n config + service registration).
  - Setup ordering matters and is encoded by source-line order rather than explicit dependency declarations (no init graph; reorder = breakage).
- **Suggestive signature**:
  - Entry-point file with 5+ side-effectful imports (imports invoked for their side effects, not for symbols).
  - Top-level `await` or IIFE pattern doing multi-step boot.
- **Disqualifiers**:
  - Framework-conventional thin boilerplate (e.g., Vite `main.tsx` with `<App />` mount; Next.js `_app.tsx`).
  - Entry file delegates to focused modules and the orchestration itself is thin (count actual logic lines, not import lines).
