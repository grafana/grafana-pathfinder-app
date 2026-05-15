# MCP hardening, slice 4 — migrate Go MCP runtime tools to TypeScript

> Hardening follow-up to [P3 — TypeScript MCP server](./ai-authoring-3-ts-mcp.md).
> Source: P5 deferred item in [AI-AUTHORING-IMPLEMENTATION.md](../AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups) — _"Migrate Go MCP runtime tools to the TS package"_ — promoted out of P5 and into its own MH4 slice when work began.
> Branch: `feat/mcp-progress`.
> Tracking issue: _to be filed_.

**Status:** In progress
**Started:** 2026-05-15
**Completed:** _YYYY-MM-DD_

---

## Keep this plan in sync as you work

This file is the **load-bearing artifact** for the migration. It must stay accurate so an agent (or human) picking the work up at any point — including a fresh context window — can resume without re-deriving state.

**Hard rules for anyone modifying this plan during execution:**

1. **Tick the checkbox the moment a task lands.** Don't batch. Each `- [ ]` becomes `- [x]` in the same commit that completes the work (or the next commit at latest). Tasks listed without a checkbox are intentional — they are sub-points, not work items.
2. **Append commit SHAs to completed tasks** in the form `✓ _Complete (YYYY-MM-DD, <sha>)._` after the description. This makes the plan a per-task audit trail and lets a future agent `git show <sha>` to see exactly what landed.
3. **Update the `Status:` header** at the top when transitioning between phases (`In progress` stays through all of A → D; flip to `Complete` only when MH4 fully exits).
4. **Append to the Decision log** every time a non-trivial choice gets made that isn't pre-encoded in this plan — even one-liners. Never silently edit a Task to "make it match what you did"; record the gap in **Deviations** instead.
5. **At exit, fill `Handoff to next phase`** with 5–10 bullets covering: what's true now that wasn't, gotchas, design-doc drift, deferred punts.

If you find yourself doing meaningful work that isn't reflected here, pause and update this file before continuing. The plan and the code drift together — and the cost of re-reading the plan at the start of every session is small compared to the cost of guessing at history.

---

## Goal

`pkg/plugin/mcp.go` currently hosts six MCP tools over a per-instance HTTP endpoint (`/mcp`). Five are stateless and duplicate code that already exists or now exists on the TypeScript MCP server (`src/cli/mcp/`). The sixth, `launch_guide`, is architecturally inseparable from the Go plugin: it writes to an in-memory `pendingLaunches` queue that the per-instance frontend hook (`src/hooks/usePendingGuideLaunch.ts`) polls every 5 seconds — that state cannot live in the centrally-hosted Cloud Run TS MCP, which has no per-instance back-channel.

End state of MH4:

- Two new TS MCP tools (`pathfinder_get_schema`, `pathfinder_create_guide_template`) replace the Go tools that had no existing TS equivalent.
- The other three Go stateless tools (`list_guides`, `get_guide`, `validate_guide_json`) are retired in favor of existing TS equivalents (`pathfinder_list_packages`, `pathfinder_get_package`, `pathfinder_validate`).
- `pkg/plugin/mcp.go` shrinks to a JSON-RPC handler that registers only `launch_guide` and serves `/mcp/pending-launch` (GET + POST clear).
- `guideSchemas` (hand-maintained schema summaries), the `repositoryJSON` embed, the four migrated Go handler functions, and their tests are gone.
- One source of truth for the schema and the validator — the Zod schemas in `src/types/`.

**Out of scope:**

- `launch_guide` and the `pending-launch` queue. Stay in Go indefinitely.
- The deprecated `guidesFS` embed — kept for the `launch_guide` existence check unless a later cleanup pass removes that check.
- Renaming or restructuring the surviving Go MCP endpoints.

---

## Overlap matrix

| Go tool                 | TS equivalent                                                                            | Action                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `list_guides`           | `pathfinder_list_packages` (`src/cli/mcp/tools/repository-tools.ts:39`) — reads CDN      | Delete Go handler in Phase C. Doc consumers point at TS tool.                                  |
| `get_guide`             | `pathfinder_get_package` (`src/cli/mcp/tools/repository-tools.ts:72`)                    | Delete Go handler in Phase C.                                                                  |
| `get_guide_schema`      | **None pre-MH4.** CLI `exportSchema`/`exportAllSchemas` (`src/cli/commands/schema.ts`).  | **Phase A:** add `pathfinder_get_schema`. **Phase C:** delete Go handler + `guideSchemas` map. |
| `validate_guide_json`   | `pathfinder_validate` (`src/cli/mcp/tools/inspection-tools.ts:52`) — wraps `runValidate` | Delete Go handler in Phase C. TS validator is stricter (Zod vs. ad-hoc field checks).          |
| `create_guide_template` | `pathfinder_create_package` returns **blank** artifact                                   | **Phase A:** add `pathfinder_create_guide_template` (richer starter). **Phase C:** delete Go.  |
| `launch_guide`          | **Stays in Go.** Coupled to `usePendingGuideLaunch.ts` per-instance polling.             | Untouched.                                                                                     |

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [x] P3 (TS MCP server) Complete — `pathfinder-cli mcp` stdio + HTTP transports work.
- [x] `npm run check` clean on `main`.
- [x] `pkg/plugin/mcp.go` still labeled "experimental MCP spike (PR #643) — non-production" in its top-of-file comment (verified 2026-05-15).

**Surface area this phase touches:**

| File                                           | Change                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/cli/mcp/tools/schema-tools.ts`            | **Phase A** — new file; registers `pathfinder_get_schema` (three modes: `one` / `all` / `list`).                                                                              |
| `src/cli/mcp/tools/artifact-tools.ts`          | **Phase A** — extend with `pathfinder_create_guide_template` (pre-populated starter, round-tripped through `runValidate`).                                                    |
| `src/cli/mcp/tools/index.ts`                   | **Phase A** — register the new schema-tools group.                                                                                                                            |
| `src/cli/mcp/__tests__/schema-tools.test.ts`   | **Phase A** — new test file (modes + error branches + per-name coverage).                                                                                                     |
| `src/cli/mcp/__tests__/artifact-tools.test.ts` | **Phase A** — new test file (happy path + defaults + invalid id + round-trip through `pathfinder_validate`).                                                                  |
| `src/cli/mcp/__tests__/server.test.ts`         | **Phase A** — update the `lists every authoring tool` assertion to include the two new tools (count goes 16 → 18).                                                            |
| `docs/developer/MCP_SERVER.md`                 | **Phase A** — catalog entry for new tools + a "Migrated from the Go MCP" subsection. **Phase C** — collapse to one-line note that Go MCP hosts only `launch_guide`.           |
| `docs/design/AI-AUTHORING-IMPLEMENTATION.md`   | **Phase A** — add MH4 row. **Phase C** — mark Complete with date and link the handoff section here.                                                                           |
| `pkg/plugin/mcp.go`                            | **Phase C** — delete five tool handlers, five `tools/list` entries, five dispatch arms, the `guideSchemas` map, the `validationIssue` / `schemaVersionPattern` if now unused. |
| `pkg/plugin/static.go`                         | **Phase C** — delete the `repositoryJSON` embed (only consumed by the deleted `toolListGuides`); keep `guidesFS` for `launch_guide`'s existence check.                        |
| `pkg/plugin/static/repository.json`            | **Phase C** — delete (no Go consumer left).                                                                                                                                   |
| `scripts/copy-static.js`                       | **Phase C** — drop the repository.json copy step; keep the per-guide content.json copy (still embedded for `launch_guide`).                                                   |
| `pkg/plugin/mcp_test.go`                       | **Phase C** — delete tests for the five migrated tools; update `TestToolsList` to assert single-tool surface; keep protocol / `launch_guide` / pending-launch tests.          |
| `AGENTS.md`                                    | **Phase C** — update the `pkg/plugin/mcp.go` row to "Hosts only `launch_guide` and the pending-launch queue; all other MCP authoring tools live in `src/cli/mcp/`."           |
| `CLAUDE.md`                                    | **Phase C** — mirror AGENTS.md.                                                                                                                                               |

**Public APIs that change:**

- **MCP `tools/list` on the Go endpoint** shrinks from 6 tools to 1 (`launch_guide` only). Any client that named the Go tools by name breaks. Risk surface is documented as low: the Go MCP is labeled "non-production" in its own top-of-file comment and has no developer-facing connection docs.
- **TS MCP `tools/list`** grows by 2 (`pathfinder_get_schema`, `pathfinder_create_guide_template`). Additive — no client breaks.

**Open questions resolved up-front in the plan:**

- **OQ1.** Coexist `pathfinder_create_guide_template` and `pathfinder_create_package`? **Decision:** yes — sibling tools, parity with the Go contract. Collapsing to one tool with a `template` flag is a small future change.
- **OQ2.** Drop the `guidesFS` embed and the `launch_guide` existence check? **Decision:** no — keep both. Defense-in-depth is cheap. Tracked as a possible MH5 cleanup.
- **OQ3.** Where to track? **Decision:** new MH4 row in the post-P3 hardening track. The work shares the "one canonical source of truth" theme.
- **OQ4.** Phase A and C in one PR or two? **Decision:** two — additive lands first, soaks, then destructive. Plan-text was honored in practice (A committed alone in `d697f75a` before any Go change).

---

## Tasks

Atomic-commit-sized. Reference slice ID in commit messages (`MH4: ...`).

### Phase A — Additive TS tools (Complete)

- [x] **A1. `pathfinder_get_schema`.** ✓ _Complete (2026-05-15, `d697f75a`)._ New file `src/cli/mcp/tools/schema-tools.ts`. Thin wrapper over `exportSchema` / `exportAllSchemas` / `listSchemas` from `src/cli/commands/schema.ts`. Three modes: `one` (named single schema), `all` (every schema keyed by name), `list` (registry summary). Honors `includeVersion` flag (defaults to true).
- [x] **A2. `pathfinder_create_guide_template`.** ✓ _Complete (2026-05-15, `d697f75a`)._ Extension to `src/cli/mcp/tools/artifact-tools.ts`. Uses `newPackageState` to scaffold, pre-populates the two starter blocks (markdown intro + section with one placeholder markdown step), fills manifest defaults (`category: "getting-started"`, `path: "<id>/"`, `startingLocation: "/"`, default author + testEnvironment), then round-trips through `runValidate` for guaranteed schema-cleanness.
- [x] **A3. Register the new tool group.** ✓ _Complete (2026-05-15, `d697f75a`)._ `src/cli/mcp/tools/index.ts` imports and calls `registerSchemaTools(server)`.
- [x] **A4. Tests.** ✓ _Complete (2026-05-15, `d697f75a`)._ Two new test files using the `InMemoryTransport` pattern from `repository-tools.test.ts`: `schema-tools.test.ts` (8 tests across all modes + error branches), `artifact-tools.test.ts` (6 tests). Also updated `server.test.ts` tool-list assertion (16 → 18). 118/118 MCP tests pass.
- [x] **A5. Docs (additive).** ✓ _Complete (2026-05-15, `d697f75a`)._ `docs/developer/MCP_SERVER.md` catalog updated (18 tools) + "Migrated from the Go MCP" subsection explaining the overlap matrix. MH4 row added to `docs/design/AI-AUTHORING-IMPLEMENTATION.md` hardening track.

**Phase A exit:** ✓ `npx jest src/cli/mcp/` green (118 tests), `npm run typecheck` clean, two new tools appear in `pathfinder_help` output and `tools/list` JSON-RPC response on a local `npx pathfinder-cli mcp`.

### Phase B — Doc-only deprecation pass (optional, skip if Phase C lands soon)

- [ ] **B1.** Add a "Go MCP runtime tools (deprecated)" section to `docs/developer/MCP_SERVER.md` listing the five Go tools and naming the TS replacement for each. Rationale: schema correctness (canonical Zod runtime), removed schema duplication.
- [ ] **B2.** Update the `pkg/plugin/mcp.go` row in `AGENTS.md` and `CLAUDE.md` to flag that the runtime tools are deprecated pending Phase C.

**Note (2026-05-15):** Phase B is only worth doing as a standalone step if Phase C is delayed by more than a release cycle. If C follows A directly, the deprecation prose is moot (the tools disappear). Default: skip B, fold the AGENTS.md/CLAUDE.md updates into C.

### Phase C — Go cleanup (Not started)

The irreversible step. Land in its own commit after Phase A has been exercised on `main` or `feat/mcp-progress` for at least one cycle.

- [ ] **C1. Delete migrated handlers from `pkg/plugin/mcp.go`:**
  - `toolListGuides` (`pkg/plugin/mcp.go:329-363` + types at 301-327)
  - `toolGetGuide` (`pkg/plugin/mcp.go:373-404` + types at 369-371)
  - `toolGetGuideSchema` (`pkg/plugin/mcp.go:414-431` + types at 410-412)
  - `toolValidateGuideJSON` (`pkg/plugin/mcp.go:575-687` + types at 566-573 — includes `validationIssue` struct)
  - `toolCreateGuideTemplate` (`pkg/plugin/mcp.go:700-779` + types at 693-698)
- [ ] **C2. Delete tool registrations in `mcpTools` slice** (`pkg/plugin/mcp.go:106-208` — keep only the `launch_guide` entry at lines 154-167).
- [ ] **C3. Delete dispatch arms in `handleToolCall`** (`pkg/plugin/mcp.go:280-291` — keep only the `launch_guide` arm at 286-287).
- [ ] **C4. Delete the `guideSchemas` map** (`pkg/plugin/mcp.go:433-517`).
- [ ] **C5. Drop now-unused identifiers.** `schemaVersionPattern` (`pkg/plugin/mcp.go:39`) was used only inside `toolValidateGuideJSON`; verify and delete. `validGuideIDPattern` (line 36) stays — `toolLaunchGuide` still uses it. Imports: `regexp` stays (for `validGuideIDPattern`), `io/fs` stays (for `launch_guide` existence check).
- [ ] **C6. Delete the `repositoryJSON` embed in `pkg/plugin/static.go`** (only consumed by the deleted `toolListGuides`). Keep `guidesFS` (used by `toolLaunchGuide` at line 540 for the existence check).
- [ ] **C7. Delete `pkg/plugin/static/repository.json`** on disk.
- [ ] **C8. Update `scripts/copy-static.js`** to skip copying `repository.json` (no Go consumer); keep the per-guide content.json copy loop.
- [ ] **C9. Delete corresponding tests in `pkg/plugin/mcp_test.go`:**
  - `TestToolListGuides_*` (3 tests, lines 213-255)
  - `TestToolGetGuide_*` (4 tests, lines 261-301)
  - `TestToolGetGuideSchema_*` (2 tests, lines 307-326)
  - `TestToolValidateGuideJSON_*` (6 tests, lines 483-580)
  - `TestToolCreateGuideTemplate_*` (3 tests, lines 586-641)
- [ ] **C10. Update `TestToolsList`** (`pkg/plugin/mcp_test.go:180-207`) to assert that the only tool returned is `launch_guide`.
- [ ] **C11. Update `pkg/plugin/mcp.go` top-of-file status comment** (lines 3-21) to reflect the post-cleanup reality: the file now hosts only `launch_guide` and the pending-launch queue.
- [ ] **C12. Update docs:**
  - `docs/developer/MCP_SERVER.md` — collapse the "Migrated from the Go MCP" subsection to a single line referencing this phase doc; remove the deprecation prose if Phase B was skipped.
  - `docs/design/AI-AUTHORING-IMPLEMENTATION.md` — flip the MH4 row Status to `Complete`, set Completed date, link this file in the "Detailed plan" column.
  - `AGENTS.md` — update the `pkg/plugin/mcp.go` row in the backend section.
  - `CLAUDE.md` — mirror.

**Phase C exit:** `mage test` green; `mage build` green; `pkg/plugin/mcp.go` line count roughly halved; `tools/list` JSON-RPC response from the Go endpoint returns exactly one tool (`launch_guide`).

### Phase D — End-to-end verification (Not started)

- [ ] **D1.** Boot a local Grafana with the plugin (`npm run server`). From any MCP client, call `launch_guide` against the Go endpoint — confirm the per-instance polling hook (`src/hooks/usePendingGuideLaunch.ts`) still resolves and opens the guide. Exercises the surviving Go code path.
- [ ] **D2.** Connect a stdio MCP client to `npx pathfinder-cli mcp`. Call `pathfinder_get_schema` with `name="guide"` — confirm the returned JSON Schema includes `x-schema-version: <CURRENT_SCHEMA_VERSION>` and the strict block-union refinements.
- [ ] **D3.** Same client: call `pathfinder_create_guide_template { id: "test-migration", title: "Migration test" }`. Confirm the output has the markdown intro + section blocks, and that round-tripping through `pathfinder_validate` returns `status: "ok"`.
- [ ] **D4.** `npm run check` (full pre-merge gate: typecheck + lint + prettier + lint:go + test:go + test:ci) — clean.

### Test plan

- Phase A: unit tests for new tools in `src/cli/mcp/__tests__/`, server tool-list assertion bumped.
- Phase C: existing Go-side `launch_guide` / pending-launch / protocol tests stay; deleted-tool tests are removed in lockstep with the handlers.
- Phase D: real-instance smoke (Grafana + plugin); CLI smoke (`npx pathfinder-cli mcp`).
- Commands a reviewer can run end-to-end: `npm run typecheck`, `npx jest src/cli/mcp/`, `mage test`, `mage build`, `npm run check`.

### Verification (matches index exit criteria)

The MH4 entry in the index has no formal exit criteria column (the hardening track uses the per-slice "Closes" column instead). Effective exit conditions:

- [x] All five Go stateless tools have a TS-side path (additive or pre-existing). _(After Phase A.)_
- [ ] `pkg/plugin/mcp.go` exposes only `launch_guide` via `tools/list`. _(After Phase C.)_
- [ ] `guideSchemas` (hand-maintained schema strings) no longer exists in the Go tree. _(After Phase C.)_
- [ ] `npm run check` clean. _(Continuous.)_
- [ ] D1 smoke passes — `launch_guide` end-to-end still works after the Go cleanup. _(After Phase D.)_

---

## Decision log

### 2026-05-15 — Phase A scope: ship the additive tools first

- **Decision.** Land Phase A (two new TS tools + tests + docs) as a self-contained commit before any Go change. Committed as `d697f75a` on `feat/mcp-progress`.
- **Alternatives considered.** (1) Phase A + C in one commit — faster but tangles additive and destructive review. (2) Skip the new `pathfinder_create_guide_template` tool and just use `pathfinder_create_package` (blank artifact) — loses parity with the Go contract.
- **Rationale.** A is reviewable as one coherent change; C can be reviewed separately. The new tools improve correctness over their Go counterparts (`pathfinder_get_schema` reads canonical Zod schemas; `pathfinder_create_guide_template` round-trips through `runValidate`).
- **Touches.** `src/cli/mcp/tools/schema-tools.ts` (new), `src/cli/mcp/tools/artifact-tools.ts`, `src/cli/mcp/tools/index.ts`, two new test files, `src/cli/mcp/__tests__/server.test.ts` (tool count), `docs/developer/MCP_SERVER.md`, `docs/design/AI-AUTHORING-IMPLEMENTATION.md`.

### 2026-05-15 — Two-PR sequencing for A and C

- **Decision.** Phase A and Phase C land as separate commits (and likely separate PRs). Phase A has soaked alone; Phase C will follow.
- **Alternatives considered.** Single-PR migration — collapses review surface but means a Go-side bug blocks the TS-side win.
- **Rationale.** Additive changes have a cheaper rollback than destructive ones. Splitting matches the open question OQ4's default.
- **Touches.** Branch/PR strategy on `feat/mcp-progress`. No file impact.

### 2026-05-15 — Keep `guidesFS` and the `launch_guide` existence check

- **Decision.** Phase C deletes the `repositoryJSON` embed but keeps `guidesFS` and the `fs.Stat` existence check inside `toolLaunchGuide` (`pkg/plugin/mcp.go:540`).
- **Alternatives considered.** Drop the check; let the frontend's resolution logic discover invalid IDs.
- **Rationale.** Defense-in-depth on an internal-RPC tool is cheap. Removing the check changes contract semantics (sync-rejection becomes "queued, fails later") for negligible code-size win.
- **Touches.** `pkg/plugin/static.go` (Phase C), `pkg/plugin/mcp.go` (Phase C; existence check preserved).

---

## Deviations

_Appended during execution. Currently empty._

---

## Handoff to next phase

_Filled at exit. Required: 5–10 bullets covering what's now true that wasn't before, gotchas, deferred punts, design docs that drifted._
