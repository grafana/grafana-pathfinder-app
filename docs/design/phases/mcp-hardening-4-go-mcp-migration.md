# MCP hardening, slice 4 — migrate Go MCP runtime tools to TypeScript

> Hardening follow-up to [P3 — TypeScript MCP server](./ai-authoring-3-ts-mcp.md).
> Source: P5 deferred item in [AI-AUTHORING-IMPLEMENTATION.md](../AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups) — _"Migrate Go MCP runtime tools to the TS package"_ — promoted out of P5 and into its own MH4 slice when work began.
> Branch: `feat/mcp-progress`.
> Tracking issue: _to be filed_.

**Status:** Complete (browser-side D1 leg pending user verification)
**Started:** 2026-05-15
**Completed:** 2026-05-15

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

### Phase C — Go cleanup (Complete)

- [x] **C1. Delete migrated handlers from `pkg/plugin/mcp.go`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ `toolListGuides`, `toolGetGuide`, `toolGetGuideSchema`, `toolValidateGuideJSON`, `toolCreateGuideTemplate` and their argument/result types all removed.
- [x] **C2. Delete tool registrations in `mcpTools` slice.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Slice contains only the `launch_guide` entry.
- [x] **C3. Delete dispatch arms in `handleToolCall`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Switch keeps `launch_guide` + the `default` not-found arm.
- [x] **C4. Delete the `guideSchemas` map.** ✓ _Complete (2026-05-15, `a51c7c9f`)._
- [x] **C5. Drop now-unused identifiers.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ `schemaVersionPattern` removed; `errCodeInternal` removed (was already unused even pre-phase, surfaced by the diff). `validGuideIDPattern` retained for `toolLaunchGuide`. Imports `regexp`, `io/fs`, `strings`, `sync`, `time` all still needed.
- [x] **C6. Delete the `repositoryJSON` embed in `pkg/plugin/static.go`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Comment updated to reflect that `guidesFS` is now consumed only by `launch_guide`'s existence check.
- [x] **C7. Delete `pkg/plugin/static/repository.json`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._
- [x] **C8. Update `scripts/copy-static.js`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Removed the `repository.json` copy step; added an inline comment pointing at this phase doc.
- [x] **C9. Delete corresponding tests in `pkg/plugin/mcp_test.go`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ All `TestToolListGuides_*`, `TestToolGetGuide_*`, `TestToolGetGuideSchema_*`, `TestToolValidateGuideJSON_*`, `TestToolCreateGuideTemplate_*` removed. Helpers (`extractToolData`, `isToolError`, `mcpToolCall`) kept — still used by the `launch_guide` tests.
- [x] **C10. Update `TestToolsList`.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Asserts `len(tools) == 1` and `tool["name"] == "launch_guide"`.
- [x] **C11. Update `pkg/plugin/mcp.go` top-of-file status comment.** ✓ _Complete (2026-05-15, `a51c7c9f`)._ Removed the "SPIKE / STUB" framing — the file is now a deliberate, small in-process endpoint, not an experimental spike.
- [x] **C12. Update docs.** ✓ _Complete (2026-05-15, `a51c7c9f`)._
  - `docs/developer/MCP_SERVER.md` — collapsed the "Migrated from the Go MCP" subsection into a single "Go MCP endpoint" line linking to this phase doc.
  - `docs/design/AI-AUTHORING-IMPLEMENTATION.md` — MH4 row Status set to `Complete (2026-05-15)`.
  - `AGENTS.md` — `pkg/plugin/mcp.go` row, `pkg/plugin/static.go` row, and the backend request-paths bullet for `/mcp` all updated.
  - `CLAUDE.md` — inherits via `@AGENTS.md`; no separate mirror needed.

**Phase C exit:** ✓ `mage test` green (15 tests); ✓ `mage build:darwinARM64` green (`dist/gpx_grafana-pathfinder-app_darwin_arm64` built); ✓ `pkg/plugin/mcp.go` shrunk from 885 → 338 lines; ✓ `mcp_test.go` shrunk from 642 → 347 lines; ✓ `tools/list` returns exactly one tool (asserted by `TestToolsList`). `golangci-lint` not run locally (binary not installed); will be exercised by CI.

### Phase D — End-to-end verification (Backend complete; browser leg pending user)

- [x] **D1 (Go backend half).** ✓ _Complete (2026-05-15)._ Local stack via `docker compose up -d` against the freshly built `dist/gpx_grafana-pathfinder-app_linux_arm64` (Apple Silicon container is aarch64; the linux_amd64 binary built by `npm run build:backend` was the wrong arch — discovered mid-smoke). Against `/api/plugins/grafana-pathfinder-app/resources/mcp`: `tools/list` returns exactly `[launch_guide]`; each of the five retired tool names returns JSON-RPC error `-32601 unknown tool: <name>`; `launch_guide { guideId: "first-dashboard" }` returns `status: "queued"`; `GET /mcp/pending-launch` returns `{"guideId":"first-dashboard"}`; `launch_guide { guideId: "does-not-exist" }` returns `isError: true, "guide not found: does-not-exist"`; `POST /mcp/pending-launch/clear` empties the queue; subsequent GET returns `{}`.
- [ ] **D1 (frontend hook leg).** Browser-side verification: with the stack running, opening Grafana and triggering `launch_guide` should cause `src/hooks/usePendingGuideLaunch.ts` to resolve within ~5s and open the guide in the Pathfinder sidebar. Not run in this session — needs a human in front of `http://localhost:3000`.
- [x] **D2.** ✓ _Complete (2026-05-15)._ Stdio harness at `/tmp/mh4-d-smoke.mjs` drove `node dist/cli/cli/index.js mcp`. `pathfinder_get_schema { name: "guide" }` returned a JSON Schema object with `x-schema-version: "1.1.0"` and `blocks` in the payload. (Note: schema is keyed by `pathfinder_get_schema`'s wrapper; `x-schema-version` is on the wrapper, not buried inside the inner schema. Harness handles both shapes.)
- [x] **D3.** ✓ _Complete (2026-05-15)._ Same harness: `pathfinder_create_guide_template { id: "test-migration", title: "Migration test" }` returned an artifact with both `content` and `manifest`; `content.blocks` had the markdown intro and the section placeholder. Round-trip through `pathfinder_validate { artifact: { content, manifest } }` returned `status: "ok"` with `issues: []`. (Note: `pathfinder_validate` takes a nested `{ artifact }` argument, not flat `{ content, manifest }` — the harness was corrected mid-smoke.)
- [x] **D4.** ✓ _Complete (2026-05-15)._ `npm run check` parts in order: `typecheck` clean; `lint` 0 errors / 1 pre-existing unrelated warning (`src/utils/openfeature-tracking.test.ts:57` unused eslint-disable); `prettier-test` clean; `docs:sync-terms:check` clean; `lint:go` clean (`golangci-lint` v2.12.2, 0 issues — installed mid-session via `brew install golangci-lint`); `test:go` ok (cached); `test:ci` 199 suites / 3605 tests passed / 18 skipped / 27.5s.

### Test plan

- Phase A: unit tests for new tools in `src/cli/mcp/__tests__/`, server tool-list assertion bumped.
- Phase C: existing Go-side `launch_guide` / pending-launch / protocol tests stay; deleted-tool tests are removed in lockstep with the handlers.
- Phase D: real-instance smoke (Grafana + plugin); CLI smoke (`npx pathfinder-cli mcp`).
- Commands a reviewer can run end-to-end: `npm run typecheck`, `npx jest src/cli/mcp/`, `mage test`, `mage build`, `npm run check`.

### Verification (matches index exit criteria)

The MH4 entry in the index has no formal exit criteria column (the hardening track uses the per-slice "Closes" column instead). Effective exit conditions:

- [x] All five Go stateless tools have a TS-side path (additive or pre-existing). _(After Phase A.)_
- [x] `pkg/plugin/mcp.go` exposes only `launch_guide` via `tools/list`. _(After Phase C — asserted by `TestToolsList` and confirmed by D1 live smoke.)_
- [x] `guideSchemas` (hand-maintained schema strings) no longer exists in the Go tree. _(After Phase C.)_
- [x] `npm run check` clean. _(D4 — typecheck + lint + prettier + docs:sync + lint:go + test:go + test:ci all green; one pre-existing unrelated lint warning.)_
- [x] D1 backend smoke passes — `launch_guide` queues, expires/clears, and rejects unknown IDs end-to-end. The browser-side hook leg is still pending a human in front of the dev stack.

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

### 2026-05-15 — Removed `errCodeInternal` even though the plan didn't call it out

- **What.** The plan's C5 listed `schemaVersionPattern` as the unused identifier to delete. While trimming, `errCodeInternal` (one of the JSON-RPC error-code constants) was also unused — it had no callers even before phase C. Removed it in the same commit to keep the const block honest.
- **Impact.** None functional. The remaining error codes (`errCodeParse`, `errCodeInvalid`, `errCodeNotFound`, `errCodeParams`) are all live.
- **Why this is not in the Decision log.** Pure dead-code cleanup, no design tradeoff.

---

## Handoff to next phase

- **Single source of truth for the guide schema.** `pkg/plugin/mcp.go` no longer carries the hand-maintained `guideSchemas` map. The Zod schemas in `src/types/` are now the only place a schema definition lives — `pathfinder_get_schema` exposes them via `exportSchema` / `exportAllSchemas` / `listSchemas`. Any future schema change is a one-file edit.
- **Go MCP endpoint is now intentionally minimal.** `tools/list` returns exactly one tool (`launch_guide`); everything else lives in the TS MCP. The top-of-file comment was rewritten from "SPIKE / STUB" to "in-process runtime endpoint" — this file is no longer experimental, it's a small deliberate surface.
- **`launch_guide`'s existence check is preserved.** `pkg/plugin/static.go` still embeds `static/guides/*.json` for `fs.Stat` inside `toolLaunchGuide`. This is defense-in-depth (open question OQ2 resolved no). A future MH5 cleanup pass could drop both the embed and the check; the frontend's content resolution would catch unknown IDs lazily.
- **`scripts/copy-static.js` no longer copies `repository.json`.** Only per-guide `content.json` files are copied into `pkg/plugin/static/guides/`. If a future Go feature needs the repository index, the script will need a one-line restore — not the embed.
- **MCP tool surface broke for any caller that named the migrated tools.** The Go endpoint no longer answers to `list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, or `create_guide_template`. The Go MCP was undocumented and labeled "non-production" pre-MH4, so blast radius is expected to be zero — but if a stray internal script broke, the migration paths are in the overlap matrix at the top of this doc.
- **Pending Phase D.** D1 (real-instance `launch_guide` smoke through `npm run server`) and D4 (`npm run check`) haven't been run on the destructive commit yet. The Go side is green (`mage test`, `mage build:darwinARM64`, `go vet`); the full pre-merge gate is the next step before PR.
- **Design-doc drift.** `docs/design/AI-AUTHORING-IMPLEMENTATION.md` still has prose under the P5 / P6 sections that refers to the Go MCP runtime tools as "deferred" — those bullets are now historical context. Worth a sweep on the next AI-authoring doc edit, but not a blocker. `docs/design/HOSTED-AUTHORING-MCP.md` and the per-phase MH plans need no edit.
- **No client-orchestration impact.** AI clients drive the TS MCP via `pathfinder-cli mcp` (stdio or HTTP) — the Cloud Run deploy and stdio clients are both untouched by this slice. The browser/plugin-side `launch_guide` flow (assistant integration → per-instance `/mcp` POST → `usePendingGuideLaunch.ts` polling) is also untouched.
