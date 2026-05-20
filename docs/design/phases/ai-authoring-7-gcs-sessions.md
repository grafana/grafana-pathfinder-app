# P7 — GCS-backed authoring sessions

> Implementation plan for phase 7 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria graduate the deferred [P5 — GCS-backed authoring sessions](../AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups) bullet into its own phase. The design is fully specified in that bullet (storage layout, token format, tool-surface shape, concurrency, retention, confidentiality); this plan phases the implementation.
> Tracking issue: _epic issue TBD_.

**Status:** Complete
**Started:** 2026-05-20
**Completed:** 2026-05-20

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [ ] P3 TS MCP server present, mutation tools route through `state-bridge.ts` (`src/cli/mcp/tools/state-bridge.ts`).
- [ ] `deploy-mcp.sh` currently deploys to Cloud Run successfully against project `your-gcp-project`, region `us-central1`.
- [ ] `npm run check` clean on `main`.

**Surface area this phase touches:**

- New: `src/cli/mcp/lib/session-store.ts` (interface + in-memory impl), `src/cli/mcp/lib/session-store-gcs.ts` (GCS impl), `src/cli/mcp/lib/session-token.ts` (Crockford base32 generator + validator + logging helpers), `src/cli/mcp/lib/__tests__/*.test.ts`.
- Modified: `src/cli/mcp/tools/mutation-tools.ts` (discriminated input — `{sessionToken}` OR `{artifact}`), `src/cli/mcp/tools/inspection-tools.ts` (session-mode `inspect` / `validate`), `src/cli/mcp/tools/authoring-start.ts` (rewrite guidance), `src/cli/mcp/tools/finalize.ts` (explicit DELETE on success), `src/cli/mcp/tools/index.ts` (register new read tools).
- New tools: `pathfinder_get_manifest_session` (session-scoped — see naming note below), `pathfinder_list_blocks`, `pathfinder_get_block`.
- Modified: `deploy-mcp.sh` — environment parameterization (`ENV` defaults `dev`), idempotent bucket bootstrap, dedicated service account creation, IAM bindings, lifecycle rule application, env var passthrough to Cloud Run service.
- New: `package.json` adds `@google-cloud/storage` dependency (already transitively allowed; lockfile updated).
- New env vars on the deployed service: `PATHFINDER_SESSION_BUCKET` (e.g., `test-bucket`), `PATHFINDER_SESSION_STORE` (`gcs` | `memory`, defaults to `memory` for safety; deploy script sets `gcs`).

**Open questions to resolve during execution:**

- **`pathfinder_get_manifest` naming clash with P6's repository tool.** P6's [decision log](./ai-authoring-6-cdn-repository-tools.md#2026-05-08--naming-clash-with-deferred-p5-pathfinder_get_manifest) flagged this exact case. Resolution at execution: either rename the session-scoped one (`pathfinder_get_manifest_session` is the working title here) or collapse to one tool with a discriminated input (`{ id }` vs `{ sessionToken }`). Pick during Task 5; both are reversible.
- **`expectedGeneration` ergonomics on mutations.** Design says agents _may_ pass it. Default behavior chosen up front (per discuss with user): server retries once on 412, then surfaces the structured error — agents do not have to think about it. Confirm during Task 4.
- **Optional `Mcp-Session-Id` binding (Task 8).** Design lists it as optional. Default to on if implementable cheaply; fall back to off (and document) if it forces non-trivial transport-layer plumbing.

---

## Tasks

_Phases A–D below group tasks into shippable PRs. Each PR leaves `main` shippable and `./deploy-mcp.sh dev` working end-to-end._

### Phase A — Infrastructure + storage seam (no public tool surface change) — COMPLETE 2026-05-20

- [x] **1. Parameterize `scripts/deploy-mcp.sh` by environment.** `--env=<name>` flag (defaults `dev`); derives `BUCKET="pathfinder-mcp-${ENV_NAME}"`, `SERVICE_ACCOUNT="pathfinder-mcp-${ENV_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"`. `SERVICE` stays env-agnostic so the existing dev URL does not move. Project + region remain hardcoded; flagged in the script header as the next axis to parameterize when staging/prod arrive.
- [x] **2. Idempotent bucket bootstrap in `scripts/deploy-mcp.sh`.** Preflight block:
  - Enables `storage.googleapis.com` + `iam.googleapis.com`.
  - Creates `gs://${BUCKET}` if absent with `--uniform-bucket-level-access --public-access-prevention`.
  - Applies a 7-day lifecycle delete rule via an inline `mktemp` heredoc JSON. Script self-contained.
- [x] **3. Dedicated service account in `scripts/deploy-mcp.sh`.** Creates `${SERVICE_ACCOUNT_EMAIL}` if absent. Grants `roles/storage.objectAdmin` **scoped to the bucket** via `gcloud storage buckets add-iam-policy-binding`. `gcloud run deploy` now passes `--service-account=${SERVICE_ACCOUNT_EMAIL}` and `--set-env-vars="PATHFINDER_SESSION_STORE=gcs,PATHFINDER_SESSION_BUCKET=${BUCKET}"`.
- [x] **4. `SessionStore` interface + in-memory impl.** `src/cli/mcp/lib/session-store.ts` exports the interface, `SessionPreconditionFailedError` with `{code, expected, actual}`, the `SESSION_GENERATION_ABSENT` sentinel, and `InMemorySessionStore`. 13 unit tests covering create-from-absent, double-create rejection, expected/actual on precondition failure, monotonic update generation, no-mutation-on-failed-save, idempotent delete, recreate-after-delete, token isolation, two racing creates, two racing updates.
- [x] **5. GCS impl.** `src/cli/mcp/lib/session-store-gcs.ts` adds `GcsSessionStore` against `@google-cloud/storage@^7`. Layout: `<token>/content.json` + `<token>/manifest.json` + `<token>/generation` (lock object pinning the session's logical generation). Save order is artifact-first, generation-last (with `ifGenerationMatch`); a 412 on the generation write surfaces as `SessionPreconditionFailedError` after a peek. 14 tests against an in-memory GCS fake. `@google-cloud/storage` added to `dependencies` and to `RUNTIME_DEPS` in `scripts/cli-build-utils.js` so the Docker runtime image installs it.
- [x] **6. Token generator + logging helpers.** `src/cli/mcp/lib/session-token.ts` ships `generateSessionToken`, `isValidSessionToken`, `normalizeSessionToken`, `tokenLogPrefix`, `tokenLogHash`. 22-char lowercase Crockford base32, 110 bits from `crypto.randomBytes`. 19 unit tests.
- [x] **7. Wire the store into `state-bridge.ts` without changing public tool input.** Added `withSession(token, store, runner)` and `withFreshSession(token, store, seed, runner)`. Both skip the store write when the CLI runner reports failure — explicit "breakingRunner" test asserts a runner that writes invalid output but reports an error does not land. 8 unit tests covering happy path, SESSION_NOT_FOUND, no-write-on-error, propagation of `SessionPreconditionFailedError` from a concurrent writer, fresh-session mint, no half-minted sessions, mint-over-existing rejection.

**Phase A deliverable — DELIVERED.** `scripts/deploy-mcp.sh --env=dev` (default) deploys the service with the bucket, SA, IAM, lifecycle rule, and env vars all wired, but no tool calls actually use the bucket yet — `authoring-start` still primes stateless flow; mutation tools still take `{artifact}`. The store exists, is callable from any node module via `withSession` / `withFreshSession`, and 173 MCP-suite tests pass.

### Phase B — Session-mode mutations + fine-grained reads — COMPLETE 2026-05-20

- [x] **B-extra. Env-driven `SessionStore` factory.** `src/cli/mcp/lib/session-store-factory.ts` resolves `PATHFINDER_SESSION_STORE` (memory | gcs, default memory) + `PATHFINDER_SESSION_BUCKET`, memoized. `buildServer({sessionStore})` accepts an injected store; stdio + http transports resolve the factory once at startup and pass it through. 6 unit tests.
- [x] **8. Discriminated input on every mutation tool.** All 6 mutation tools accept either `{artifact}` (unchanged stateless contract) or `{sessionToken, expectedGeneration?}`. A shared `dispatchMutation()` helper handles mode resolution + token normalization + branch routing. Session-mode acks drop the artifact body — agent receives `{sessionToken, generation, summary, outcome}` only. New wire codes (INPUT_MODE_AMBIGUOUS / INPUT_MODE_MISSING / INVALID_SESSION_TOKEN / SESSION_NOT_FOUND / CONCURRENT_MODIFICATION) ship as helper functions in `result.ts`. 10 integration tests.
- [x] **9. `pathfinder_create_package` mints a session on every call.** Both `pathfinder_create_package` and `pathfinder_create_guide_template` now mint a fresh token, persist the seed artifact at generation 1, and return both `sessionToken+generation` AND the artifact — so stateless flows still work end-to-end. `mintSession()` retries up to 4× on token collision (astronomically rare given ~110 bits of entropy). 5 tests.
- [x] **10. Failed-mutation invariant test.** Dedicated `failed-mutation-invariant.test.ts` snapshots `{generation, artifact}` before/after each failing call and asserts byte-for-byte equality. 6 scenarios: SCHEMA_VALIDATION on empty fields, NOT_FOUND on phantom edit/remove targets, semantic error on add_step against a markdown parent, ok→fail leaves at the ok generation, 5 consecutive failures do not drift the generation.
- [x] **11. Three new fine-grained read tools.** `pathfinder_list_blocks` (tree summary), `pathfinder_get_block` (one block by id), `pathfinder_get_manifest_session` (named with `_session` suffix to dodge the P6 `pathfinder_get_manifest` collision flagged in the P6 decision log). 8 unit tests covering happy paths + SESSION_NOT_FOUND + INVALID_SESSION_TOKEN + NOT_FOUND-with-generation-echoed.
- [x] **12. `pathfinder_inspect` and `pathfinder_validate` accept `{sessionToken}`.** Shared `resolveReadOnlyInput()` helper in `inspection-tools.ts` keeps the two tools in lockstep. Inspect is the "pull full artifact" escape hatch in session-mode; validate returns structured errors only. 7 tests.
- [x] **13. `expectedGeneration` server-side retry-once.** `dispatchSessionMutation()` in `state-bridge.ts` implements the policy: omit `expectedGeneration` → retry once on 412 against refetched state, then surface CONCURRENT_MODIFICATION; pass `expectedGeneration` → surface immediately on any mismatch (no retry — the agent expressed an expectation). 9 unit tests using a `makeRacingStore()` wrapper that bumps the generation between load and save once.

**Phase B deliverable — DELIVERED.** Session-mode is live end-to-end. Stateless `{artifact}` mode untouched on every tool. Re-deploying via `scripts/deploy-mcp.sh` exposes 3 new tools (`pathfinder_list_blocks`, `pathfinder_get_block`, `pathfinder_get_manifest_session`) and discriminated input on the 8 existing mutation/inspection tools. 224 MCP-suite tests pass (was 173 at end of phase A — 51 new in phase B).

### Phase C — Guidance + finalize lifecycle — COMPLETE 2026-05-20

> **Handoff context for a fresh agent.** Phases A + B left the following in place that this phase reuses:
>
> - `dispatchMutation()` and `resolveReadOnlyInput()` patterns in `src/cli/mcp/tools/mutation-tools.ts` and `src/cli/mcp/tools/inspection-tools.ts` are the canonical "exactly one of {artifact} / {sessionToken}" branch shape. Mirror it in finalize. If the helper looks identical to `resolveReadOnlyInput`, consider lifting it to a shared module rather than copy-pasting.
> - Wire-shaped error helpers in `src/cli/mcp/tools/result.ts`: `inputModeAmbiguousResult`, `inputModeMissingResult`, `invalidSessionTokenResult`, `sessionNotFoundResult`. Use these — don't invent new shapes.
> - `normalizeSessionToken()` is the canonical input-boundary normalizer (lowercases + validates). Always normalize before passing the token to the store.
> - `SessionStore.delete(token)` is already idempotent (in-memory ignores unknown tokens; GCS treats 404 as success). Just call it; don't try/catch unless you specifically want to log.
> - The current `pathfinder_finalize_for_app_platform` in `src/cli/mcp/tools/finalize.ts` takes `{artifact}` and returns a `clientGuidance` handoff payload (the P4 work). The handoff shape itself does not change; only the input mode and the post-success delete.
> - Server-level instructions live at `src/cli/mcp/lib/server-instructions.ts` (`SERVER_INSTRUCTIONS`). These are surfaced to MCP clients on `initialize` — reaching the model **before** tool selection. Consider whether they need a sessionToken-aware update alongside `authoring-start`. (Phase B did not touch these.)
> - `pathfinder_authoring_start` is the first tool the design expects an agent to call. Today it primes a purely stateless flow; Phase C is the rewrite to teach the session-mode workflow as the primary path with `{artifact}` mentioned as an OSS/airgap fallback.

- [x] **14. Rewrite `src/cli/mcp/tools/authoring-start.ts`.** Per design: teach token issuance on first mutation, echo-back contract, that mutation responses are acks not full artifacts, that reads are explicit and on-demand (`pathfinder_list_blocks` / `pathfinder_get_block` / `pathfinder_get_manifest_session` / `pathfinder_inspect`), that the artifact returns only at finalize. Bias toward session-token mode; mention `{artifact}` fallback briefly with one trigger (no GCS in OSS / airgap). Update the existing `authoring-start.test.ts` snapshot (if any) in the same commit. Decide whether `SERVER_INSTRUCTIONS` in `lib/server-instructions.ts` needs a parallel update — most likely yes, since those instructions reach the model first.
- [x] **15. `pathfinder_finalize_for_app_platform` accepts `{ sessionToken }` and deletes on success.** Mirror the discriminated input from `inspection-tools.ts`. Load → return the existing `clientGuidance` handoff payload (unchanged) → `store.delete(token)` on success only. Delete failure (rare but possible against GCS) logs but does not fail the response — the 7-day lifecycle rule is the safety net so we can't strand a session. Update the `finalize.test.ts` snapshot in the same commit; add a new test asserting the store is empty for that token after a successful finalize.

**Phase C deliverable — DELIVERED.** `pathfinder_authoring_start` now teaches session-mode as the primary contract (sessionToken minted on first mutation, mutation acks vs. explicit reads, finalize returns the artifact and deletes the session) and demotes `{artifact}` to a one-paragraph OSS / airgap fallback. `SERVER_INSTRUCTIONS` received a matching one-paragraph session-mode primer so MCP-aware clients see the same posture on `initialize` before tool selection (still under the 40-line layer-3 budget). `pathfinder_finalize_for_app_platform` accepts `{sessionToken}` in place of `{artifact}` using a shared `resolveReadOnlyInput` helper lifted to `src/cli/mcp/tools/read-input.ts` (inspect / validate now consume the same helper). Successful finalize deletes the session server-side; validation failures leave the session intact so the caller can fix and retry; delete failures log but do not fail the response (the 7-day bucket lifecycle rule is the safety net). The handoff payload shape is unchanged — the existing snapshot test still passes. 230 MCP-suite tests pass (was 224 at end of phase B — 6 new in phase C covering session-mode load, delete-on-success, no-delete-on-validation-failure, ambiguous / missing input, and SESSION_NOT_FOUND).

### Phase D — Hardening + observability — COMPLETE 2026-05-20

- [x] **16. Optional `Mcp-Session-Id` binding.** Pin persisted at mint via `SessionStore.bindMcpSessionId`; in-memory uses a parallel Map, GCS writes a sidecar object at `<token>/.pin`. Every session-mode entry point (mutations, inspect/validate, finalize, session-reads) runs `enforceMcpSessionPin` from `src/cli/mcp/lib/session-pin.ts` before touching the store. Mismatch surfaces as `SESSION_NOT_FOUND` (404, not 403 — the pin is a confidentiality boundary). Absence of the header on a subsequent call skips the check (stdio fallback); sessions minted without a pin are never lazily bound. 8 new tests in `__tests__/session-pin.test.ts` cover MATCH / MISMATCH / ABSENT across mutation, read, inspect, and finalize, and assert that a mismatched finalize does NOT delete the session.
- [x] **17. Logging discipline.** Added `src/cli/mcp/__tests__/logging-discipline.test.ts` — a lint-style scanner that walks every non-test `.ts` file under `src/cli/mcp/`, finds every `console.*` / `process.std{err,out}.write` call, and fails if any references a session token without wrapping it in `tokenLogPrefix()` / `tokenLogHash()`. Sanity-checked against a synthetic violator (caught and rejected) before committing. Also extended the HTTP access log with `sessionTokenPrefix` (12 chars, human-readable) and `sessionTokenHash` (SHA-256-derived, stable for cross-line grouping) — derived from the `sessionToken` arg on `tools/call` so operators can trace one authoring session across hops without raw tokens landing in Cloud Logging.
- [x] **18. Cloud Run smoke test.** `scripts/smoke-gcs-sessions.ts` runs a 25-hop authoring loop (configurable via `--hops=`) against any deployed MCP HTTP endpoint, exercises BOTH modes, and prints the side-by-side wire-bytes comparison plus a verification step that calls `pathfinder_finalize_for_app_platform` and asserts a follow-up `pathfinder_list_blocks` against the same token returns `SESSION_NOT_FOUND`. Invoked via `npx tsx scripts/smoke-gcs-sessions.ts --url=https://<service>/mcp`. Cannot be exercised against a live deploy from the implementation context; the actual run lands in the verification log when a maintainer runs `scripts/deploy-mcp.sh --env=dev` followed by the smoke script.
- [x] **19. Docs pass.** `docs/developer/MCP_SERVER.md` gains a Sessions section (two input modes, ack shape, env vars, retention, Mcp-Session-Id binding, wire codes), bumps the tool count from 18 → 21 (the three new session-read tools), and updates the access-log section with the new `sessionTokenPrefix` / `sessionTokenHash` fields. `docs/design/HOSTED-AUTHORING-MCP.md` gets a "two input modes" rewrite of the `sessionId` paragraph and a 2026-05-20 note on the original stateless-only doesNotOwn bullet. `docs/design/AI-AUTHORING-IMPLEMENTATION.md` gains a P7 row in the status table and the P5 "GCS-backed authoring sessions" bullet is flipped to **Done — shipped as P7** with a pointer to the phase plan.

**Phase D deliverable — DELIVERED.** Hardening, observability, and docs land together. Session tokens never appear in logs (lint test enforces this for `src/cli/mcp/`); `Mcp-Session-Id` mismatches surface as `SESSION_NOT_FOUND`; the access log now carries `sessionTokenPrefix` / `sessionTokenHash` for cross-line correlation; `scripts/smoke-gcs-sessions.ts` is the canonical post-deploy smoke check; the operator-facing and design-facing docs match what shipped. 247 MCP-suite tests pass (was 230 at end of phase C — 8 new pin tests + 4 new GCS pin tests + 3 lint tests + 2 new access-log tests).

### Test plan

- Unit + integration: `npx jest src/cli/mcp` adds session-store, token, and session-mode tool tests. Target: ~30–50 new tests, including the failed-mutation invariant.
- Manual: `./deploy-mcp.sh dev`, then `scripts/smoke-gcs-sessions.ts` against the resulting URL.
- Full: `npm run check`.

### Verification (matches the P5 GCS-sessions design bullet)

- [ ] First mutation without `sessionToken` mints a token; every mutation ack carries it.
- [ ] Mutations return acks, not artifacts. Reads are explicit (`get_manifest_session`, `list_blocks`, `get_block`, `inspect`, `validate`).
- [ ] Failed CLI mutation leaves the bucket state unchanged (test covers).
- [ ] `ifGenerationMatch` is enforced; two replicas racing on the same token resolve via 412 → refetch → retry once → surface.
- [ ] `pathfinder_create_package` without `sessionToken` mints one. No separate `start_session` tool exists.
- [ ] Stateless `{artifact}` mode still works on every mutation tool.
- [ ] `pathfinder_finalize_for_app_platform` deletes the session on success.
- [ ] Bucket has a 7-day lifecycle rule applied; uniform bucket-level access on; IAM-only; no public ACLs.
- [ ] Tokens are 22-char Crockford base32, no `I/L/O/U`, lowercased on input.
- [ ] `Mcp-Session-Id` binding works when present, falls back gracefully when absent.
- [ ] Logs never contain raw tokens or artifact bodies.
- [ ] `./deploy-mcp.sh dev` is the single command that brings up bucket + SA + IAM + service.

---

## Decision log

_Appended during execution._

### 2026-05-20 — Skip `pathfinder_apply_ops`

- **Decision:** Do not implement the batched-mutations tool from the design's earlier draft.
- **Alternatives considered:** Ship `apply_ops` for multi-op atomicity / latency amortization.
- **Rationale:** Token amortization and context-hygiene benefits already won by session-token mode + ack responses. The two residual arguments (cumulative GCS latency, all-or-nothing semantics) are speculative; carrying a parallel batch API costs schema, tests, docs, and per-tool guidance. Revisitable later with real workload data.
- **Touches:** scope; deferred-followups bullet in the parent index when this phase ships.

### 2026-05-20 — `expectedGeneration` defaults to server-side retry-once

- **Decision:** Server retries once on 412, then surfaces a structured `CONCURRENT_MODIFICATION` error.
- **Alternatives considered:** Last-write-wins; surface 412 immediately and require agent to retry.
- **Rationale:** Keeps agents out of the concurrency model for the common case (single replica, single agent). The structured error remains available for the rare two-replica race so agents _can_ reason about it if they want to.
- **Touches:** Task 13.

### 2026-05-20 — `pathfinder_get_manifest_session` keeps the `_session` suffix

- **Decision:** Ship the session-scoped manifest read tool as `pathfinder_get_manifest_session`, leaving P6's `pathfinder_get_manifest` (CDN repository tool) unchanged.
- **Alternatives considered:** Collapse to one tool with a discriminated input (`{id}` vs `{sessionToken}`); rename P6's variant to `pathfinder_get_repository_manifest`.
- **Rationale:** The two tools read different data sources (public CDN vs session bucket) and serve different mental models. Discriminated input would force agents to remember which keys go with which source. Renaming P6 retroactively would have churned an already-shipped public tool. The `_session` suffix carries the meaning visibly in the tool name and the agent never has to remember which mode goes with which input shape.
- **Touches:** `src/cli/mcp/tools/session-read-tools.ts`, the P6 [decision log naming-clash entry](./ai-authoring-6-cdn-repository-tools.md#2026-05-08--naming-clash-with-deferred-p5-pathfinder_get_manifest).

### 2026-05-20 — Lift the read-only input resolver into a shared module

- **Decision:** Move `resolveReadOnlyInput` out of `inspection-tools.ts` into a new `src/cli/mcp/tools/read-input.ts` shared by inspect, validate, and finalize.
- **Alternatives considered:** Copy-paste the helper into finalize; keep all three tools in `inspection-tools.ts`.
- **Rationale:** The handoff note in the Phase C section flagged the duplication risk explicitly. Three callers all need byte-identical input semantics and error wire shapes (INPUT_MODE_AMBIGUOUS / INPUT_MODE_MISSING / INVALID_SESSION_TOKEN / SESSION_NOT_FOUND); the only shape variation finalize needed was an extra `sessionToken` field on the success branch so it can call `store.delete()` after handoff. Lifting now is one file change; lifting later after Phase D adds more callers would touch more sites.
- **Touches:** Task 15. New file `src/cli/mcp/tools/read-input.ts`; `inspection-tools.ts` reduced to its registration logic.

### 2026-05-20 — Finalize does not delete on validation failure

- **Decision:** Session deletion happens only on the `status: ready` branch of finalize. The `status: invalid` branch leaves the session intact.
- **Alternatives considered:** Always delete on finalize (treat finalize as terminal regardless of outcome); never delete (let the lifecycle rule do all eviction).
- **Rationale:** The agent's natural recovery path after `status: invalid` is to call the structured CLI errors back into a mutation tool and re-finalize. Deleting on validation failure would force a fresh `pathfinder_create_package` and lose all in-flight context for a recoverable problem. The 7-day lifecycle rule still bounds the worst case if the agent abandons the session after a failed finalize.
- **Touches:** Task 15.

### 2026-05-20 — `SERVER_INSTRUCTIONS` gets the session-mode primer, not a layer-3 rewrite

- **Decision:** Add one paragraph to `SERVER_INSTRUCTIONS` covering session-mode posture; keep the rest of layer 3 unchanged.
- **Alternatives considered:** Leave layer 3 alone (rely entirely on `pathfinder_authoring_start` for session-mode teaching); rewrite layer 3 to lead with the session-mode contract.
- **Rationale:** Layer 3 reaches the model **before** tool selection, so an agent that hasn't yet called `pathfinder_authoring_start` still needs the session-mode anchor to avoid defaulting to threading full artifacts. But layer 3 is paid per connection — every connected client pays the length forever — so the detailed shape/rules belong in layer 2 (`pathfinder_authoring_start`, paid once per session). One paragraph in layer 3 is the minimum that anchors the contract without bloating the per-connection cost. Length budget (40-line ceiling, slice-3) is preserved.
- **Touches:** Task 14. `src/cli/mcp/lib/server-instructions.ts` (+1 paragraph), test in `src/cli/mcp/lib/__tests__/server-instructions.test.ts` unchanged (still passes).

### 2026-05-20 — Pin enforcement lives in `resolveReadOnlyInput` and `dispatchMutation`, not in every tool

- **Decision:** The `enforceMcpSessionPin` helper is called from exactly two places — the shared `resolveReadOnlyInput` helper (covers inspect / validate / finalize) and the mutation dispatcher's session-mode branch (covers all 6 mutation tools). Session-read tools call the helper via a local `resolveToken` wrapper. No per-tool pin check.
- **Alternatives considered:** Inline the pin check in every tool registration; push it into `withSession` in `state-bridge.ts`.
- **Rationale:** Three shared chokepoints already exist in the session-mode tool surface; adding pin enforcement to them gives 100% coverage with three call sites instead of ten. Pushing it into `state-bridge` would have worked for mutations but would have left the read tools (which bypass `state-bridge`) needing a parallel implementation, defeating the consolidation.
- **Touches:** Task 16. `lib/session-pin.ts`, `tools/read-input.ts`, `tools/mutation-tools.ts`, `tools/session-read-tools.ts`.

### 2026-05-20 — Lazy pin binding is explicitly NOT implemented

- **Decision:** Sessions minted without an `Mcp-Session-Id` header (stdio, curl without the header) get NO pin and stay unpinned forever. Subsequent HTTP calls with a header do not lazily install a pin.
- **Alternatives considered:** Lazy-bind on the first HTTP call that carries a header (TOFU-style); reject unpinned sessions when reached over HTTP.
- **Rationale:** Lazy binding would let any HTTP caller who guessed (or sniffed) an unpinned token claim it permanently — by being the first to call with a header, they'd lock everyone else out. Token entropy (~110 bits) makes guessing infeasible in practice, but the design posture is "the pin is a confidentiality boundary, not an auth surface": if we cannot positively bind at mint, we do not bind at all. Stdio interop wins; the alternative would have broken stdio→HTTP handoff for any legitimate workflow.
- **Touches:** Task 16. `lib/session-pin.ts` documents this in its module header.

### 2026-05-20 — Access log carries token-derived correlators, not the token itself

- **Decision:** Extend the HTTP access log with `sessionTokenPrefix` (12 chars) and `sessionTokenHash` (SHA-256-derived). Both are emitted on `tools/call` requests whose args carry a `sessionToken`. Raw tokens never appear in the log.
- **Alternatives considered:** Don't extend the log (rely on operators to grep prefixes out of tool args, which they can't because args aren't logged); log the full token (rejected immediately — bearer credentials, 7-day TTL).
- **Rationale:** The smallest change that gives operators what they actually need (cross-line correlation for one authoring session) while preserving the bearer-credential posture. The two fields are also what the design literally specifies ("Logs include tokenPrefix, tokenHash, generation, artifactBytes, gcsLatencyMs"). `generation` is already discoverable from response bodies in the application logs; `artifactBytes` / `gcsLatencyMs` are valuable but require per-tool instrumentation that would be Phase E or later.
- **Touches:** Task 17. `transports/http.ts`.

### 2026-05-20 — In-memory `SessionStore` is the local-dev default

- **Decision:** `PATHFINDER_SESSION_STORE` defaults to `memory`; `deploy-mcp.sh` sets it to `gcs` for the deployed service.
- **Alternatives considered:** Filesystem-backed local store; require GCS even locally via emulator.
- **Rationale:** In-memory is the smallest viable surface for local dev — no disk persistence required, no emulator dep. Matches the design's "deferred is not durable" stance. Cloud Run gets `gcs` via the deploy script so the bucket is exercised on every deploy.
- **Touches:** Tasks 4, 5, 7; env var contract.

---

## Deviations

### 2026-05-20 — Deploy script lives at `scripts/deploy-mcp.sh`, not the repo root

- **What was planned:** modify the root-level `deploy-mcp.sh` in place.
- **What changed:** the root-level `deploy-mcp.sh` is gitignored as a "personal manual-deploy" script and remains so; the committed, parameterized version lives at `scripts/deploy-mcp.sh`. `.gitignore` was tightened to anchor the rule at the root (`/deploy-mcp.sh`) so the `scripts/` path is tracked.
- **Reason:** the root script is the developer's personal scratch copy; turning it into committed infra (now that it provisions a shared GCS bucket + SA) crosses a posture line that wasn't worth bundling into phase A without an explicit decision. Per user direction.
- **Propagation:** the surface-area note in Preconditions still mentions `deploy-mcp.sh` because the project's docs treat the personal copy as the canonical name; the path is updated above in the Phase A tasks. Once `scripts/deploy-mcp.sh` is exercised in dev and trusted, the root copy should be deleted (a TODO comment in the script header records this).

---

## Handoff to next phase

P7 is complete; no immediate follow-up phase is planned. The remaining open items are operational rather than implementation:

- **Run `scripts/smoke-gcs-sessions.ts` against a fresh `scripts/deploy-mcp.sh --env=dev`** to confirm the 2026-05-01 telemetry projection (roughly O(N²) → O(N) wire bytes) holds in production. The script reports the side-by-side numbers; record the actual ratio in this section once exercised.
- **Per-tool structured logging** (`artifactBytes`, `gcsLatencyMs`) was sized as deferrable in the Phase D access-log decision and is not implemented. Pick up if/when an operator needs per-call GCS latency attribution that the existing `durationMs` cannot give them.
- **Mcp-Session-Id binding integration with a real Grafana Assistant deployment** — the implementation matches the design (`enforceMcpSessionPin` shape, 404-not-403, stdio fallback) but has only been exercised against the InMemorySessionStore in tests. The first real Cloud Run hit with a Grafana Assistant client carrying an `Mcp-Session-Id` header is the load-bearing validation; surface any drift here.

The phase plan, decision log, and deviations are otherwise complete and ready to archive when the parent epic ships.
