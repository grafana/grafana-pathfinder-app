# P1 — CLI authoring foundation

> Implementation plan for phase 1 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P1](../AI-AUTHORING-IMPLEMENTATION.md#p1--cli-authoring-foundation).
> Tracking issue: _epic issue TBD_.

**Status:** In progress
**Started:** 2026-04-28
**Completed:** _—_

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

- [ ] An agent following only the ~20-line context block in [`AGENT-AUTHORING.md` — Agent context injection](../AGENT-AUTHORING.md#agent-context-injection) can author a multi-block guide that passes `validatePackage()`.
- [ ] All listed tests pass; `npm run check` is clean.
- [ ] The CLI version equals `CURRENT_SCHEMA_VERSION`.

### Splittable

If this exceeds one PR:

- **P1a** — tasks 1, 2, 3, 4, 7 (schema changes + bridge + registry + package-IO + version wiring; no new user-facing commands).
- **P1b** — tasks 5, 6 (commands + full test suite). The exit criterion above belongs to P1b.

---

## Decision log

_Appended during execution._

---

## Deviations

_Appended during execution._

---

## Handoff to next phase

_Filled at exit._
