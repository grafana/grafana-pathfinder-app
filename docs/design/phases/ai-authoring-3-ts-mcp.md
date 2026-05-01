# P3 — TypeScript MCP server

> Implementation plan for phase 3 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P3](../AI-AUTHORING-IMPLEMENTATION.md#p3--typescript-mcp-server).
> Tracking issue: _epic issue TBD_.

**Status:** Complete
**Started:** 2026-04-30
**Completed:** 2026-04-30

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [ ] P1 exit holds — an agent can author a multi-block guide via the CLI that passes `validatePackage()`; `npm run check` clean on `main`.
- [ ] P2 exit holds — `ghcr.io/grafana/pathfinder-cli:main-<sha>` builds and runs; `pathfinder-cli --version` returns `CURRENT_SCHEMA_VERSION`; the `pathfinder-mcp` bin slot is reserved (currently routed to `src/cli/mcp-placeholder.ts`).
- [ ] `package.json#bin.pathfinder-mcp` resolves to a real entrypoint after this phase replaces the placeholder.
- [ ] `pkg/plugin/mcp.go` is unchanged from `main` (preserved as a stub per the design).

**Surface area this phase touches:**

- **New code:**
  - `src/cli/mcp/` — server entrypoint, transport adapters (stdio + HTTP), tool registry, dispatchers. Replaces `src/cli/mcp-placeholder.ts` in `package.json#bin`.
  - `src/cli/mcp/tools/` — one file per MCP tool (or grouped by family). Each tool is a thin dispatcher that calls a CLI command function and shapes the response for MCP.
  - `src/cli/mcp/__tests__/` — unit tests per tool, integration tests per transport, end-to-end test that drives a multi-block guide through the tool surface.
  - `src/cli/commands/_runners.ts` (or per-command exports) — pure `runX(args, artifact) -> result` functions extracted from each `commands/*.ts`. Today the action logic is inline in `.action(async function () { ... })`; it must be reachable without a Commander parse cycle.
- **Modified:**
  - `src/cli/commands/*.ts` — refactor each `.action(...)` body to delegate to an exported `runX` function. The Commander wrapper stays. **The CLI's external behavior (flags, output, exit codes) must not change.**
  - `src/cli/utils/output.ts` (or sibling) — ensure structured-error shape is exposed as a typed value the MCP can return verbatim, not just as a stringified `printOutcome` side effect.
  - `package.json#bin.pathfinder-mcp` — point at the compiled `dist/cli/mcp/index.js`.
  - `tsconfig.cli.json` — include the new `mcp/` subtree.
  - `Dockerfile.cli` — verify the `mcp` subcommand routing still works once the placeholder is replaced (P2 already wired this).
  - `AGENTS.md` and a developer doc (`docs/developer/MCP_SERVER.md` — new) — agent context for the new tools.
- **External contracts introduced:**
  - MCP tool shapes (input + output JSON schemas) for the 11 tools listed in scope. Versioned by `CURRENT_SCHEMA_VERSION`.
  - HTTP transport route layout (per FastMCP / chosen MCP TS SDK conventions).
  - The `pathfinder_finalize_for_app_platform` payload shape — must match [`APP-PLATFORM-PUBLISH-HANDOFF.md`](../APP-PLATFORM-PUBLISH-HANDOFF.md) exactly. P4 reads this verbatim.
- **Explicitly not touched:**
  - `pkg/plugin/mcp.go` (Go MCP runtime tools — stays a stub).
  - The plugin tarball — CLI is not copied in (decoupled in P2).
  - Schema files in `src/types/json-guide.schema.ts` — the MCP performs no schema validation of its own.

**Open questions to resolve during execution:**

- **MCP TypeScript SDK choice.** The design references the FastMCP Python pattern as a reference, but P3 is TypeScript. Pick between `@modelcontextprotocol/sdk` (official MCP TS SDK) and any FastMCP-equivalent. Decision should be recorded in the decision log on selection. Both transports (stdio + HTTP) must come from the same SDK to keep the codebase one-shape.
- **Refactor strategy for `runX` extraction.** Either (a) extract a pure function alongside each Commander definition in the existing files, or (b) lift all runners into a shared `commands/_runners.ts`. Pick one and apply uniformly — do not mix.
- **HTTP rate-limit posture for the MVP open endpoint** (per the [resolved auth question](../AI-AUTHORING-IMPLEMENTATION.md#does-the-hosted-http-mcp-need-auth-at-all)). What goes in code (request size cap, per-call CPU/wallclock budget) vs. what goes in deploy config (per-IP edge limits, autoscaling ceiling). Document the boundary. The hosted deployment itself is out of scope for this phase, but the in-process budgets are not.
- **Hosting target for the HTTP transport.** Where the centrally hosted MCP runs is a P4 coordination point with the Assistant team. P3 must produce a deployable artifact (the `mcp` subcommand of the existing image already covers this) but does not pick the hosting model.

---

## Tasks

Atomic-commit-sized. Reference phase ID in commit messages (`P3: ...`, `P3a: ...` for sub-steps).

### Stage A — CLI runner extraction (no behavior change)

- [ ] **A1.** Refactor `src/cli/commands/create.ts` so the action body becomes an exported `runCreate(args, opts) -> CommandResult` and the Commander `.action(...)` is a thin adapter that calls it and prints. Add unit test asserting the runner returns the same structured shape it currently prints.
- [ ] **A2.** Repeat A1 for: `add-block`, `add-step`, `add-choice`, `edit-block`, `remove-block`, `set-manifest`, `inspect`, `validate`.
  - Out of scope for P3: `build-graph`, `build-repository`, `e2e`, `move-block`, `rename-id`, `requirements`, `schema`. These have no MCP tool counterpart in P3 scope and stay untouched unless a runner refactor incidentally cleans them.
- [ ] **A3.** Introduce a typed `CommandOutcome` (or extend the existing one in `src/cli/utils/output.ts`) that the MCP can return verbatim — preserving `status`, `code`, `message`, and structured `details` for validation errors. Update `printOutcome` callers as needed.
- [ ] **A4.** `npm run check` clean. CLI external behavior unchanged (verified by the existing per-command tests).

### Stage B — MCP server skeleton

- [ ] **B1.** Add the chosen MCP TS SDK to `package.json` (runtime deps; if FastMCP-equivalent, also update the slim runtime manifest emitted by `scripts/cli-build-utils.js`).
- [ ] **B2.** Create `src/cli/mcp/index.ts` — entrypoint. Parses `--transport stdio|http` (default stdio), dispatches to the corresponding transport bootstrap. `--version` returns `CURRENT_SCHEMA_VERSION`.
- [ ] **B3.** Create `src/cli/mcp/server.ts` — registers all tools with the SDK against a single tool-registry table. Tools are listed once; both transports share the registry.
- [ ] **B4.** Create `src/cli/mcp/transports/stdio.ts` and `src/cli/mcp/transports/http.ts`. HTTP transport binds to `--port` (default 8080), exposes the SDK's HTTP route shape, and applies the in-process budgets (request size cap, per-call wallclock).
- [ ] **B5.** Replace `src/cli/mcp-placeholder.ts` with the real entrypoint in `package.json#bin.pathfinder-mcp`. Delete the placeholder.
- [ ] **B6.** Update `tsconfig.cli.json` to include `src/cli/mcp/**`. Verify `dist/cli/mcp/index.js` is produced and executable.
- [ ] **B7.** Update `Dockerfile.cli` and `scripts/cli-build-utils.js` if the slim runtime manifest needs the new dep.

### Stage C — Tool implementations

Each tool: zod input schema, dispatcher to the corresponding `runX`, output marshalling, unit test, and registry entry. Keep tools thin — no new business logic.

- [ ] **C1.** `pathfinder_authoring_start` — returns context + workflow + tutorial + discovery hints. Sources its content from a single typed module so it is easy to update in one place. Per the [HOSTED-AUTHORING-MCP — Core tools](../HOSTED-AUTHORING-MCP.md#core-tools) spec.
- [ ] **C2.** `pathfinder_help` — composes the same `--help --format json` surface the CLI exposes; reuses the CLI's existing JSON-help machinery (already a stability contract per P1).
- [ ] **C3.** `pathfinder_create_package` → `runCreate`.
- [ ] **C4.** `pathfinder_add_block` → `runAddBlock`. **Intentionally permissive** — the discriminator and arbitrary fields are forwarded; the CLI command is the sole validator.
- [ ] **C5.** `pathfinder_add_step` → `runAddStep`.
- [ ] **C6.** `pathfinder_add_choice` → `runAddChoice`.
- [ ] **C7.** `pathfinder_edit_block` → `runEditBlock`.
- [ ] **C8.** `pathfinder_remove_block` → `runRemoveBlock`.
- [ ] **C9.** `pathfinder_set_manifest` → `runSetManifest`.
- [ ] **C10.** `pathfinder_inspect` → `runInspect`.
- [ ] **C11.** `pathfinder_validate` → `runValidate`.
- [ ] **C12.** `pathfinder_finalize_for_app_platform` → returns the handoff payload defined in [`APP-PLATFORM-PUBLISH-HANDOFF.md`](../APP-PLATFORM-PUBLISH-HANDOFF.md), including the `localExport` fallback. Snapshot test the shape so any drift is loud.

### Stage D — Failure-mode coverage

- [ ] **D1.** Validation failure path — the MCP surfaces the CLI's structured error verbatim (asserted by code review and an integration test that injects a schema violation).
- [ ] **D2.** Finalization failure path (e.g., package not yet valid) — clear, non-misleading error.
- [ ] **D3.** Schema-mismatch path — input violates the tool's zod schema before it reaches the runner.
- [ ] **D4.** Stdio pipe closed — server exits cleanly with appropriate code.
- [ ] **D5.** HTTP request size cap, per-call wallclock budget — exceeded inputs return a typed error rather than crashing the worker.

### Stage E — Documentation and agent context

- [ ] **E1.** Add `docs/developer/MCP_SERVER.md` — what the server is, how to run it locally (stdio + HTTP), tool list, how to add a tool, where the deployable artifact lives.
- [ ] **E2.** Update `AGENTS.md` to point at the MCP server doc from the on-demand-context table.
- [ ] **E3.** Update [`AI-AUTHORING-IMPLEMENTATION.md`](../AI-AUTHORING-IMPLEMENTATION.md) status table when this phase completes; fill **Handoff to next phase** below.

### Test plan

- **Unit (per tool):** input-schema validation, runner-call shape, output marshalling. Run via `npm run test:ci`.
- **Unit (runners):** every extracted `runX` has a test asserting it returns the structured shape the MCP relies on, separately from any Commander wrapper.
- **Integration (stdio):** spawn `node dist/cli/mcp/index.js --transport stdio`, drive a full create → add-block × N → validate → finalize sequence over MCP, assert the final payload matches the handoff shape and the package round-trips through `pathfinder-cli validate`.
- **Integration (HTTP):** boot `--transport http --port 0`, do the same sequence over HTTP. Assert size cap and wallclock budget reject oversized / pathological inputs.
- **End-to-end (smoke, manual):** `npx -p ghcr.io/grafana/pathfinder-cli:main-<sha> mcp` — wire to MCP Inspector, exercise `pathfinder_authoring_start`, build a 3-block guide, finalize.
- **Regression:** all existing CLI tests still pass after the runner refactor; `npm run check` clean.

### Verification (matches index exit criteria)

- [ ] A non-Grafana-aware MCP client (Cursor, Claude Desktop) can connect to `npx pathfinder-mcp` over stdio, call `pathfinder_authoring_start`, build a multi-block guide via tool calls, validate, and call `pathfinder_finalize_for_app_platform` to receive a handoff containing both `appPlatform` instructions and a `localExport` fallback.
- [ ] The same code, run with the HTTP transport, accepts requests with the same tool surface. (No auth in the MVP — see [resolved open question](../AI-AUTHORING-IMPLEMENTATION.md#does-the-hosted-http-mcp-need-auth-at-all). Edge rate-limiting / autoscaling is a deploy concern, not a code concern.)
- [ ] Following `localExport`, the client can write `content.json` and `manifest.json` to the user's workspace and the resulting package round-trips through `pathfinder-cli validate`.
- [ ] The MCP server performs no schema validation of its own — confirmed by code review (the only validator entry points are the imported `runX` functions) and by the D1 integration test.
- [ ] `pkg/plugin/mcp.go` is unchanged from `main` (apart from the spike/stub status comment already on this branch).

---

## Decision log

_Appended during execution._

### 2026-04-30 — HTTP transport ships without auth for the MVP

- **Decision:** The HTTP transport ships open. No `MultiAuth`, no `GrafanaGoogleTokenVerifier` at the MCP layer. Abuse mitigation is in-process budgets (request size cap, per-call CPU/wallclock) plus deploy-time edge rate limits and autoscaling ceilings.
- **Alternatives considered:** (a) Auth required, broad audience (any signed-in Grafana Cloud user). (b) Anonymous tier + authenticated tier with higher limits.
- **Rationale:** The MCP holds no privileged resource — Assistant performs the App Platform write with its own credentials in P4, and the tools wrap the open-source CLI anyone can `npx` locally. Open preserves the OSS / airgapped story and removes a coordination dependency on the Assistant token surface. The dominant threat is cost (DoS), addressable without an identity provider. Decision is reversible — adding a token verifier later does not change the tool surface.
- **Touches:** `src/cli/mcp/transports/http.ts` (no auth middleware), `AI-AUTHORING-IMPLEMENTATION.md` (open question marked resolved), `HOSTED-AUTHORING-MCP.md` (auth section will need a follow-up edit to reflect the deferred posture — see Deviations).

---

## Deviations

_Appended during execution._

### 2026-04-30 — `HOSTED-AUTHORING-MCP.md` "Authentication and authorization" section is now stale

- **What was planned:** That doc describes the HTTP transport using FastMCP `MultiAuth + GrafanaGoogleTokenVerifier`.
- **What changed:** Per the resolved open question, the MVP HTTP transport ships without auth.
- **Reason:** See decision-log entry above.
- **Propagation:** Flagged — `HOSTED-AUTHORING-MCP.md` "Authentication and authorization" section still references the FastMCP / Grafana token-verifier pattern. Update in a follow-up doc PR (or fold into a P4 docs pass when the hosted deployment target is chosen).

### 2026-04-30 — Per-call ephemeral tmpdir in the state bridge

- **What was planned:** `HOSTED-AUTHORING-MCP.md` calls out "no temporary directory, no `exec.Command`, no per-call Node startup" as design properties.
- **What changed:** `src/cli/mcp/tools/state-bridge.ts` writes the in-flight artifact to a per-call `os.tmpdir()` directory, invokes the CLI runner against it, reads the updated artifact back, and removes the tmpdir before returning.
- **Reason:** The CLI's `runX` functions are directory-oriented (read → mutate → validate → write through `mutateAndValidate(dir, mutator)`). A clean refactor to an in-memory state mode would touch eight runners and `mutateAndValidate` itself, with drift risk because each runner owns CLI-strict guards we want the MCP to inherit verbatim. The tmpdir bridge keeps "the CLI is the sole validator" exactly while shipping P3 in scope. The deviation is bounded — tmpdir is per-call (stateless model still holds), no `exec.Command`, no Node cold-start (it's an in-process function call).
- **Propagation:** Documented in `docs/developer/MCP_SERVER.md` ("State bridge" section). Follow-up: refactor `mutateAndValidate` and each `runX` to accept an in-memory state mode so the bridge collapses to a function call. Tracked here; not re-triggered in P4.

---

## Handoff to next phase

- **What is now true that wasn't before:** A standalone TypeScript MCP server (`pathfinder-mcp`) ships in the same npm package and Docker image as `pathfinder-cli`. Twelve tools (`pathfinder_authoring_start`, `pathfinder_help`, `pathfinder_create_package`, `pathfinder_add_block`/`add_step`/`add_choice`/`edit_block`/`remove_block`/`set_manifest`, `pathfinder_inspect`, `pathfinder_validate`, `pathfinder_finalize_for_app_platform`) are reachable over **stdio** (`pathfinder-mcp`) and **HTTP** (`pathfinder-mcp --transport http --port <n>`). The CLI is the sole validator end-to-end — confirmed by the integration test that introduces a CLI-strict violation (`pathfinder_add_block` with a conditional block lacking conditions) and asserts the MCP surfaces `SCHEMA_VALIDATION` verbatim.
- **Finalize payload shape (P4 reads this verbatim):** `src/cli/mcp/tools/finalize.ts` constructs the handoff. The integration test in `src/cli/mcp/__tests__/server.test.ts` (`drives a full authoring flow end-to-end`) asserts the key fields (`appPlatform.itemPathTemplate`, `viewer.floatingPath`, `localExport`). P4 should snapshot the full shape before it starts depending on additional fields.
- **HTTP transport ships open** (no auth) per the resolved open question. Abuse mitigations are `MAX_REQUEST_BYTES` (1 MB) and `PER_CALL_WALLCLOCK_MS` (30 s) in `src/cli/mcp/transports/http.ts` plus deploy-time edge rate limits and autoscaling. P4 should not assume any token verifier on the MCP — the App Platform write authority lives entirely with Assistant's credentials.
- **State bridge deviation:** Mutation tools marshal the in-flight artifact through a per-call ephemeral `os.tmpdir()` because the CLI runners are directory-oriented. Documented in `docs/developer/MCP_SERVER.md` and in this plan's Deviations. Follow-up to refactor `mutateAndValidate` to an in-memory state mode is **not** a P4 prerequisite — it is a quality-of-life cleanup independent of Assistant integration.
- **CLI runner extraction is complete** for the eight authoring commands the MCP uses (`runCreate`, `runAddBlock`, `runAddStep`, `runAddChoice`, `runEditBlock`, `runRemoveBlock`, `runSetManifest`, `runInspect`, `runValidate`). The pattern is: each command file exports a pure async function that the Commander `.action(...)` wrapper calls. Future CLI commands should follow the same shape so they are MCP-importable from day one.
- **Deferred items:**
  - `HOSTED-AUTHORING-MCP.md` "Authentication and authorization" section still describes the original FastMCP token-verifier pattern. Needs a doc PR or a fold-in to P4's docs pass.
  - Hosting model for the HTTP transport (where the centrally hosted MCP runs so Assistant can reach it) is a P4 coordination point with the Assistant team — already noted in P4 wiring items.
  - In-memory state mode for `mutateAndValidate` (collapses the tmpdir bridge to a function call). Quality-of-life only.
  - **Agent UX hardening — see [`MCP-AGENT-UX-HARDENING.md`](../MCP-AGENT-UX-HARDENING.md).** Living design doc capturing functional feedback observed when real agents drive `pathfinder-mcp` (artifact corruption between calls, YouTube link normalization, `reftarget` selector hallucination, unaddressable steps in multistep blocks, hop-over-hop artifact growth). Not a P4 prerequisite. Other agents who discover new failure modes during testing should append findings to that doc as numbered issues — it is the source of truth for a future MCP hardening phase.
- **Specific files P4 will be touching:** Assistant-side write-tool surface (out of this repo); the handoff payload in `src/cli/mcp/tools/finalize.ts` (read-only from P4 — do not change shape without snapshot bumps); the viewer deep-link path emitted by the finalize tool (`/a/grafana-pathfinder-app?doc=api%3A<id>&panelMode=floating`) — verify it matches the live `module.tsx` → `findDocPage` → `fetchContent` resolver.
