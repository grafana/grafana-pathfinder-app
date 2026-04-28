# P1 — CLI authoring foundation

> Implementation plan for phase 1 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P1](../AI-AUTHORING-IMPLEMENTATION.md#p1--cli-authoring-foundation).
> Tracking issue: _epic issue TBD_.

**Status:** Complete
**Started:** 2026-04-28
**Completed:** 2026-04-28

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [x] P0 spike report committed at [`docs/design/phases/ai-authoring-0-assistant-spike.md`](./ai-authoring-0-assistant-spike.md) — green-light. P0 outcomes feed P4 only and do not gate P1.
- [ ] `npm run check` clean on `cli-authoring` at start of work.

**Surface area this phase touches:**

- **Schema (tier 0).**
  - `src/types/json-guide.schema.ts` — `.describe()` annotations on commonly used block schemas; optional `id` field added to leaf block schemas; introspection consumed by the new bridge.
  - `src/types/package.schema.ts` — `ContentJsonSchema.id` and `ManifestJsonObjectSchema.id` tightened from `z.string().min(1)` to kebab-case regex `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` with max length 253.
- **CLI (excluded from tier enforcement).**
  - `src/cli/index.ts` — wire `program.version()` to `CURRENT_SCHEMA_VERSION`; register the new authoring commands.
  - `src/cli/utils/schema-options.ts` — new. Zod-to-Commander bridge.
  - `src/cli/utils/block-registry.ts` — new. `BLOCK_SCHEMA_MAP`.
  - `src/cli/utils/package-io.ts` — new. Read-mutate-validate-write core.
  - `src/cli/utils/output.ts` — new. Shared `--quiet` and `--format json` formatting.
  - `src/cli/commands/create.ts`, `add-block.ts`, `add-step.ts`, `add-choice.ts`, `set-manifest.ts`, `inspect.ts`, `edit-block.ts`, `remove-block.ts` — new.
  - `src/cli/__tests__/` — bridge unit tests, registry completeness, per-command tests, integration test, `--help --format json` stability shape.
- **Validation (tier 1).** No changes. The new commands consume `validatePackage()` and the existing per-block schemas as-is.
- **Go side.** `pkg/plugin/mcp.go` `validGuideIDPattern` (`^[a-z0-9][a-z0-9-]*$`) is laxer than the new TS regex (it allows trailing hyphens). Tighten the Go regex to match the TS canonical form in the same change set so both sides agree.
- **External contracts.** `pathfinder-cli <cmd> [<sub>] --help --format json` shape becomes a stability contract (consumed by P3's `pathfinder_help` pass-through). Establish the keys listed in [AGENT-AUTHORING.md — `--help --format json` is a stability contract](../AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract) in this phase and freeze them in tests.

**Codebase audit findings (done at draft):**

- All bundled package IDs in `src/bundled-interactives/` are already kebab-case (`block-editor-tutorial`, `e2e-framework-test`, `first-dashboard`, `first-dashboard-cloud`, `json-guide-demo`, `loki-grafana-101`, `prometheus-advanced-queries`, `prometheus-grafana-101`, `welcome-to-grafana`, `welcome-to-grafana-cloud`). The id-regex tightening is free for in-tree content.
- The `interactive-tutorials` repository is not vendored here; audit to be re-confirmed against the live repo before merging task 1 (see Open question below).
- Existing CLI version is hardcoded `'1.0.0'` in `src/cli/index.ts` and is wrong already — task 7 fixes this.

**Open questions to resolve during execution:**

- Confirm the `interactive-tutorials` repository contains no non-kebab IDs before merging the regex tightening. If any are found, normalize them in the same change set per the design doc.
- Decide where the package-id `--id` regex constant lives so both `ContentJsonSchema` and `ManifestJsonObjectSchema` reference one source. Most likely a new export in `package.schema.ts`.
- Confirm `commander@^14` (the version pinned in `package.json`) supports the option-registration patterns the bridge needs (variadic / repeatable options, dynamic option registration after `addCommand`). If not, fall back to the documented Commander API.

---

## Tasks

### 1. Schema descriptions, leaf-block IDs, and canonical id regex

- [ ] **1a.** Export a single `PACKAGE_ID_REGEX` (and `PACKAGE_ID_MAX_LENGTH = 253`) from `src/types/package.schema.ts`. Tighten `ContentJsonSchema.id` and `ManifestJsonObjectSchema.id` to use it. Add Zod tests for the regex (positive: `loki-101`, `a`, `welcome-to-grafana-cloud`; negative: `Loki`, `loki_101`, `-loki`, `loki-`, 254-char string).
- [ ] **1b.** Tighten `validGuideIDPattern` in `pkg/plugin/mcp.go` to `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` so the Go side agrees with the TS canonical form. Update the corresponding Go test.
- [ ] **1c.** Add an optional `id: z.string().optional()` (with the same regex via `.regex(...)` if cheap; otherwise plain string for now) to the leaf block schemas that don't have one: `JsonMarkdownBlockSchema`, `JsonHtmlBlockSchema`, `JsonImageBlockSchema`, `JsonVideoBlockSchema`, `JsonInteractiveBlockSchema`, `JsonInputBlockSchema`, `JsonTerminalBlockSchema`, `JsonTerminalConnectBlockSchema`, `JsonCodeBlockBlockSchema`. This is purely additive — existing guides remain valid. Update `KNOWN_FIELDS` if needed.
- [ ] **1d.** Add `.describe()` text to commonly used block schemas first: `JsonMarkdownBlockSchema`, `JsonInteractiveBlockSchema`, `JsonSectionBlockSchema`, `JsonMultistepBlockSchema`, `JsonGuidedBlockSchema`, `JsonQuizBlockSchema`, plus the shared `JsonStepSchema` and `JsonQuizChoiceSchema`. Other block types can have descriptions added incrementally; bridge falls back to a generic description.

### 2. Zod-to-Commander bridge

- [ ] **2.** Implement `src/cli/utils/schema-options.ts` with the conceptual API in [AGENT-AUTHORING.md — The bridge module](../AGENT-AUTHORING.md#the-bridge-module). Map `z.string` / `z.number` / `z.boolean` / `z.enum` / `z.array(z.string())` / `z.literal` per the table. Skip fields named `type`, `blocks`, `whenTrue`, `whenFalse`, `steps`. Read `.describe()` for help text; fall back to `"<name> (<type>, optional)"`. Camel-case field names convert to kebab-case flag names (`refTarget` → `--reftarget`, `showMe` → `--show-me`).

### 3. Block schema registry

- [ ] **3a.** Implement `src/cli/utils/block-registry.ts` with `BLOCK_SCHEMA_MAP` keyed exactly per the design doc's table. Export `getBlockSchema(type: string)` plus a typed `BlockType` union derived from the map keys.
- [ ] **3b.** Add a registry-completeness test in `src/cli/__tests__/block-registry.test.ts` asserting `Object.keys(BLOCK_SCHEMA_MAP).sort()` equals `[...VALID_BLOCK_TYPES].sort()`. This is the "forgetting to register a new block type fails CI" gate.

### 4. Package IO core

- [ ] **4.** Implement `src/cli/utils/package-io.ts`. Public surface:
  - `readPackage(dir): { content: ContentJson, manifest: ManifestJson }` — parses both files, throws structured error on missing/malformed input.
  - `writePackage(dir, { content, manifest })` — writes both files with stable JSON formatting.
  - `mutateAndValidate(dir, mutator)` — read, apply `mutator` in memory, run `validatePackage()` against the in-memory state (using the existing tier-1 validator after wiring it to accept in-memory inputs, or by writing to a temp dir and re-reading; design preference: extend `validatePackage` to accept in-memory inputs to avoid double-write).
  - Helpers: `findBlockById(content, id)`, `findContainerById(content, id)`, `appendBlock(content, block, parentId?, branch?)`, `appendStep(content, step, parentId)`, `appendChoice(content, choice, parentId)`, `editBlock(content, id, partial)`, `removeBlock(content, id, opts?)`.

### 5. Authoring commands and shared output

- [ ] **5a.** Implement `src/cli/utils/output.ts` — shared formatter. Accepts a structured success/error record and renders it as either default text, `--quiet` single line, or `--format json`. JSON shape per [AGENT-AUTHORING.md — Structured output](../AGENT-AUTHORING.md#structured-output---format-json).
- [ ] **5b.** Implement `src/cli/commands/create.ts`. Auto-id default form `<kebab-of-title>-<6-char-base32-suffix>` (use crypto-random base32 alphabet — no `0`, `1`, `8`, `9`, `i`, `l`, `o`, `u` — to avoid ambiguous chars; document in code).
- [ ] **5c.** Implement `src/cli/commands/add-block.ts`. Iterates `BLOCK_SCHEMA_MAP` to register one subcommand per block type. Adds shared `--parent`, `--branch`, `--id`, `--if-absent` options. Container types (`section`, `conditional`, `assistant`, `multistep`, `guided`, `quiz`) require `--id`. Leaf types auto-assign `<type>-<n>` if `--id` omitted.
- [ ] **5d.** Implement `src/cli/commands/add-step.ts` (parent must be `multistep` or `guided`).
- [ ] **5e.** Implement `src/cli/commands/add-choice.ts` (parent must be `quiz`).
- [ ] **5f.** Implement `src/cli/commands/set-manifest.ts` using the bridge against `ManifestJsonObjectSchema`.
- [ ] **5g.** Implement `src/cli/commands/inspect.ts` (read-only; supports `--block <id>`, `--at <jsonpath>`, `--format text|json`).
- [ ] **5h.** Implement `src/cli/commands/edit-block.ts` (scalar merge / array replace; reject `--type`; reject structural fields; error with available containers / IDs on misses).
- [ ] **5i.** Implement `src/cli/commands/remove-block.ts` (require `--cascade` for non-empty containers).
- [ ] **5j.** Add a `formatHelpAsJson(cmd: Command)` helper used by every command when `--help --format json` is requested. Top-level keys: `command`, `summary`, `required`, `optional`, `constraints`, `addressing`. Per-flag keys: `name`, `valueType`, `enum`, `repeatable`, `description`, `default`. Freeze this shape in tests (task 6f).

### 6. Test suite

- [ ] **6a.** Bridge unit tests — one assertion per Zod field type → Commander option mapping; `.describe()` round-trip; field-skipping (`type`, `blocks`, etc.).
- [ ] **6b.** Per-command tests in `src/cli/__tests__/` using in-memory fixtures (no subprocess). Each command has happy-path + at least one failure-path test.
- [ ] **6c.** Integration test — author a multi-block guide via successive command invocations and assert the resulting `content.json` + `manifest.json` round-trip through `validatePackage()`.
- [ ] **6d.** Auto-ID tests — leaf blocks without `--id` get `<type>-<n>` with per-type counter; IDs appear in success output; IDs are present in written `content.json`. `create` without `--id` produces the `<kebab-of-title>-<6-char-base32-suffix>` form and is regex-valid.
- [ ] **6e.** `--if-absent` tests — no-op on match, error on conflict, normal create on absence.
- [ ] **6f.** `--quiet`, `--format json`, and `--help --format json` shape tests — assert the stable keys above. This is the freeze that P3 will rely on.
- [ ] **6g.** `edit-block` tests — scalar merge, array replace, reject `--type`, reject structural fields, validate-on-write.
- [ ] **6h.** `remove-block` tests — leaf success, container without `--cascade` fails, cascade success, validate-on-write.

### 7. CLI version coupling

- [ ] **7.** In `src/cli/index.ts`, replace `program.name('pathfinder-cli')...version('1.0.0')` with `version(CURRENT_SCHEMA_VERSION)`. Add a smoke test asserting the printed version equals `CURRENT_SCHEMA_VERSION`.

### Test plan

- `npm run typecheck`
- `npm run lint`
- `npm run prettier-test`
- `npm run test:ci` (covers all new tests under `src/cli/`, `src/types/`, `src/validation/`)
- `npm run lint:go` and `npm run test:go` (covers the tightened Go regex)
- `npm run check` for the full pre-merge gate
- Manual: build the CLI (`tsc` or the existing build path), run `pathfinder-cli create /tmp/p1-smoke --title "P1 Smoke"` and the rest of the [Agent usage example](../AGENT-AUTHORING.md#agent-usage-example), confirm the resulting package validates with `pathfinder-cli validate /tmp/p1-smoke`.

### Verification (matches index exit criteria)

- [x] An agent following only the ~20-line context block in [`AGENT-AUTHORING.md` — Agent context injection](../AGENT-AUTHORING.md#agent-context-injection) can author a multi-block guide that passes `validatePackage()`. Mechanically verified by `src/cli/__tests__/authoring-integration.test.ts` (the design's full Loki guide example) and by an end-to-end smoke run against the built CLI binary.
- [x] All listed tests pass: `npm run typecheck` clean, `npm run lint` clean, `npm run prettier-test` clean, `npm run test:go` ok, `npm run test:ci` 136 suites / 2662 tests pass. `npm run lint:go` only fails locally because `golangci-lint` is not installed; CI runs it.
- [x] The CLI version equals `CURRENT_SCHEMA_VERSION` — `pathfinder-cli --version` prints `1.1.0` (currently `CURRENT_SCHEMA_VERSION = '1.1.0'`).

### Splittable

If this exceeds one PR:

- **P1a** — tasks 1, 2, 3, 4, 7 (schema changes + bridge + registry + package-IO + version wiring; no new user-facing commands).
- **P1b** — tasks 5, 6 (commands + full test suite). The exit criterion above belongs to P1b.

---

## Decision log

### 2026-04-28 — `grot-guide` excluded from CLI authoring surface

- **Decision:** Add a `CLI_EXCLUDED_BLOCK_TYPES` set to `block-registry.ts` containing `grot-guide`. Force the registry-completeness test to assert every `VALID_BLOCK_TYPES` entry is _either_ registered _or_ explicitly excluded.
- **Alternatives considered:** Register `grot-guide` in `BLOCK_SCHEMA_MAP` and accept a no-op `add-block grot-guide` command (its `welcome` / `screens` fields are nested objects with no flag projection).
- **Rationale:** `grot-guide` is authored through the dedicated decision-tree editor; mapping it to `add-block` would expose a no-op subcommand and confuse agents discovering via `--help`. The exclusion-set pattern means future block types added to `VALID_BLOCK_TYPES` force a deliberate decision: register for CLI authoring or document why excluded.
- **Touches:** `src/cli/utils/block-registry.ts`, `src/cli/__tests__/block-registry.test.ts`.

### 2026-04-28 — Empty containers transit-through during authoring

- **Decision:** `validatePackageState` and the CLI's `parseFileWithSchema` filter "At least one (step|choice|screen|condition) is required" Zod issues. Schema-level `.min(1)` constraints are kept for the canonical schema; the standalone `validate-package` (used by `pathfinder-cli validate --package`) still surfaces them.
- **Alternatives considered:** Drop `.min(1)` from `JsonMultistepBlockSchema.steps`, `JsonGuidedBlockSchema.steps`, `JsonQuizBlockSchema.choices` outright. Or: require the agent to provide the first step/choice inline at container creation time.
- **Rationale:** The design's example flow (`add-block guided` → `add-step` → `add-step`) holds a transient empty container between calls. Dropping `.min(1)` would weaken the contract for non-CLI consumers; inline-step creation would force a more complex command surface. Filtering during authoring lets the CLI build packages incrementally while keeping the published-guide validator strict.
- **Touches:** `src/cli/utils/package-io.ts` (`isEmptyContainerCompletenessMessage`), `src/cli/commands/add-block.ts` (`filterEmptyContainerIssues`).

### 2026-04-28 — `validatePackageState` is in-CLI; `validatePackage` stays disk-aware

- **Decision:** Build a CLI-specific `validatePackageState(content, manifest)` in `src/cli/utils/package-io.ts` rather than refactor `src/validation/validate-package.ts` to accept in-memory inputs. Keep the canonical disk-aware `validatePackage(dir)` as the publishing gate.
- **Alternatives considered:** Refactor `validate-package.ts` to expose an in-memory entry point (matches the per-phase plan's "design preference").
- **Rationale:** The disk-aware validator emits "you omitted X" diagnostics by comparing raw vs. parsed input — that's only useful for fresh-package linting, not every mutation. A CLI-specific in-memory variant lets us pay one Zod re-parse per mutation and skip diagnostics that depend on raw-vs-default disambiguation. The split keeps `validate-package.ts` untouched (no risk to the existing `validate` command callers) and surfaces empty-container completeness only at finalization.
- **Touches:** `src/cli/utils/package-io.ts`.

### 2026-04-28 — Bridge gains `skipExisting` and `forceOptional` modes

- **Decision:** Extend `registerSchemaOptions` with two opt-in modes: `skipExisting` (silently skip flags already on the command) and `forceOptional` (strip `makeOptionMandatory()` from every emitted option).
- **Alternatives considered:** Move all multi-schema option composition (e.g., `edit-block`'s union of every block schema) outside the bridge into a per-command pre-pass.
- **Rationale:** `edit-block` aggregates options from every block schema and shares fields like `--id` / `--content`; without `skipExisting` the second registration collides at runtime. `forceOptional` solves the patch-vs-create asymmetry: schemas mark `image.src` and `manifest.id` as required at _create_ time, but they're already present (and unmodified) at _patch_ time. Making both modes opt-in keeps the default tight (callers that pass a clean schema get a loud failure on duplicate-flag bugs).
- **Touches:** `src/cli/utils/schema-options.ts`, `src/cli/commands/edit-block.ts`, `src/cli/commands/set-manifest.ts`.

### 2026-04-28 — Dependency-list arrays surface as `--name <item>` repeatable flags

- **Decision:** Extend `describeField` to recognize `z.array(z.union([z.string(), z.array(z.string())]))` and treat it as `array-string` for CLI purposes. Single-string deps (`--depends welcome-to-grafana`) work via the CLI; OR-groups (`["a", "b"]` meaning "either a or b") require manual JSON editing.
- **Alternatives considered:** Skip dependency-list fields entirely (force JSON editing), or invent CLI syntax for OR-groups.
- **Rationale:** The bare-string dependency case dominates real-world usage; the OR-group case is rare and already requires careful authoring. Surfacing the bare-string form preserves the agent-context promise that `set-manifest --recommends X` works without making the bridge accept arbitrary union element types.
- **Touches:** `src/cli/utils/schema-options.ts`.

---

## Deviations

### 2026-04-28 — `add-block <type> <dir>` argument order (vs. design's `<dir> <type>`)

- **What was planned:** [`AGENT-AUTHORING.md` — Command surface](../AGENT-AUTHORING.md#command-surface) shows `pathfinder-cli add-block <dir> <type>` throughout (e.g., `pathfinder-cli add-block my-guide/ section --id setup`).
- **What changed:** The implementation registers each block type as a Commander subcommand, so the user invokes `pathfinder-cli add-block <type> <dir>` (subcommand name first, then the directory argument).
- **Reason:** Commander resolves the first positional argument after `add-block` as the subcommand name. With the design's `<dir> <type>` order, Commander interprets the directory path as the subcommand and rejects it with `unknown command '/tmp/.../my-guide'`. Putting `<type>` first preserves Commander's idiomatic per-subcommand `--help` (`pathfinder-cli add-block interactive --help` works) and matches the help output the agent context block points at.
- **Propagation:** [`AGENT-AUTHORING.md`](../AGENT-AUTHORING.md) updated in this PR — the agent context block, command surface examples, and the design's "Agent usage example" all swap to `<type> <dir>`. The `pathfinder-cli` invocation success-output hint already displays the correct order. No effect on P3+ since the MCP layer constructs commands programmatically and does not depend on positional ordering.

### 2026-04-28 — Empty-container completeness is filtered (not enforced) during authoring

- **What was planned:** [`AGENT-AUTHORING.md` — Validate-on-write](../AGENT-AUTHORING.md#validate-on-write) promises every mutation runs the _full_ `validatePackage()` pipeline.
- **What changed:** The CLI's in-memory `validatePackageState` filters "At least one X is required" Zod issues for `multistep.steps`, `guided.steps`, `quiz.choices`, `grot-guide.screens`, and `conditional.conditions`. The standalone `pathfinder-cli validate --package` (which calls `validate-package.ts`) still surfaces these.
- **Reason:** The design's exact authoring flow (`add-block guided` → `add-step`) holds a transient empty `steps: []` between calls. Without filtering, `mutateAndValidate` would refuse to persist the `add-block guided` step. Filtering only "at least one X required" preserves every other validation guarantee.
- **Propagation:** [`AGENT-AUTHORING.md` — Validate-on-write](../AGENT-AUTHORING.md#validate-on-write) updated to note the in-flight exception and where it's surfaced (at `validate --package`). No effect on the CRD or App Platform layers; published guides still get the strict check.

---

## Handoff to next phase

The next phase (P2 — CLI distribution) inherits a fully-functional authoring CLI. P3 (MCP authoring tools) inherits both the CLI binary and the `--help --format json` stability contract.

- **CLI is end-to-end functional.** All eight authoring commands plus `inspect` and the existing `validate` work against any package directory. Validate-on-write is enforced for every mutation; invalid state never persists. Verified by 178 new unit + integration tests and a full subprocess smoke run against the built binary.
- **Schema is the single source of truth.** Adding a new field to a block schema in `json-guide.schema.ts` automatically surfaces as a CLI flag (no Commander glue). Adding a new block type to `VALID_BLOCK_TYPES` triggers a registry-completeness test failure until the type is registered or excluded — this is the gate against silent drift.
- **Stable error codes.** The `PackageIOErrorCode` union (`NOT_FOUND`, `BLOCK_NOT_FOUND`, `CONTAINER_NOT_FOUND`, `WRONG_PARENT_KIND`, `BRANCH_REQUIRED`, `DUPLICATE_ID`, `CONTAINER_REQUIRES_ID`, `CONTAINER_HAS_CHILDREN`, `IF_ABSENT_CONFLICT`, `SCHEMA_VALIDATION`, `WRITE_FAILED`, `INVALID_JSON`, `ID_MISMATCH`, `CONTENT_MISSING`) is part of the public contract for P3 — the MCP layer's `--format json` pass-through depends on these strings. Don't rename casually.
- **`--help --format json` is frozen.** The shape (`command`, `summary`, `required`, `optional`, `addressing`, `subcommands` plus per-flag `name`, `valueType`, `enum`, `repeatable`, `description`, `default`) is locked by `output.test.ts`. P3's `pathfinder_help` tool can pass through verbatim.
- **Bundled binary path is on the table for P2.** The existing `npm run build:cli` produces the dist artifact at `dist/cli/cli/index.js`. P2 needs to wrap this in a single-file binary (Node SEA or `pkg`) and copy it into `<plugin-dir>/cli/pathfinder-cli` per the AGENT-AUTHORING.md distribution section.
- **Reusable test scaffolding.** `src/cli/__tests__/commands.test.ts` and `authoring-integration.test.ts` use exported `runX` functions (not subprocess invocations), keeping the test suite fast (~2s for the full CLI suite). P3 can compose against the same surface for the MCP shell-out tests once the CLI binary is in place.
- **Watch-outs for P2/P3 agents.**
  - `add-block` argument order is `<type> <dir>` (deviation from the design doc — see Deviations).
  - `set-manifest` and `edit-block` use bridge `forceOptional: true`. Don't copy that pattern into create-flow commands or you'll break required-field enforcement.
  - The empty-container filter is in two places (`parseFileWithSchema` at read time, `validatePackageState` at write time). When P3 surfaces validation issues over MCP, route through `validatePackageState` to match CLI semantics; route through the standalone `validatePackage(dir)` only for the explicit `pathfinder_validate` tool that gates publishing.
  - `JsonGrotGuideBlock` now has `id?: string` in both schema and TS interface (added to satisfy union-coverage), but it is _intentionally excluded_ from CLI authoring via `CLI_EXCLUDED_BLOCK_TYPES`.
  - `KNOWN_FIELDS` in `json-guide.schema.ts` got `id` added to every block-type entry. If P3 introduces server-side schema mirroring, copy from `KNOWN_FIELDS`, not from a hand-maintained list.
