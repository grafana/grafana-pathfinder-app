# P7 — GCS-backed authoring sessions

> Implementation plan for phase 7 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria graduate the deferred [P5 — GCS-backed authoring sessions](../AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups) bullet into its own phase. The design is fully specified in that bullet (storage layout, token format, tool-surface shape, concurrency, retention, confidentiality); this plan phases the implementation.
> Tracking issue: _epic issue TBD_.

**Status:** In progress (phases A + B complete; C + D pending)
**Started:** 2026-05-20
**Completed:** _YYYY-MM-DD_

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

### Phase C — Guidance + finalize lifecycle

> **Handoff context for a fresh agent.** Phases A + B left the following in place that this phase reuses:
>
> - `dispatchMutation()` and `resolveReadOnlyInput()` patterns in `src/cli/mcp/tools/mutation-tools.ts` and `src/cli/mcp/tools/inspection-tools.ts` are the canonical "exactly one of {artifact} / {sessionToken}" branch shape. Mirror it in finalize. If the helper looks identical to `resolveReadOnlyInput`, consider lifting it to a shared module rather than copy-pasting.
> - Wire-shaped error helpers in `src/cli/mcp/tools/result.ts`: `inputModeAmbiguousResult`, `inputModeMissingResult`, `invalidSessionTokenResult`, `sessionNotFoundResult`. Use these — don't invent new shapes.
> - `normalizeSessionToken()` is the canonical input-boundary normalizer (lowercases + validates). Always normalize before passing the token to the store.
> - `SessionStore.delete(token)` is already idempotent (in-memory ignores unknown tokens; GCS treats 404 as success). Just call it; don't try/catch unless you specifically want to log.
> - The current `pathfinder_finalize_for_app_platform` in `src/cli/mcp/tools/finalize.ts` takes `{artifact}` and returns a `clientGuidance` handoff payload (the P4 work). The handoff shape itself does not change; only the input mode and the post-success delete.
> - Server-level instructions live at `src/cli/mcp/lib/server-instructions.ts` (`SERVER_INSTRUCTIONS`). These are surfaced to MCP clients on `initialize` — reaching the model **before** tool selection. Consider whether they need a sessionToken-aware update alongside `authoring-start`. (Phase B did not touch these.)
> - `pathfinder_authoring_start` is the first tool the design expects an agent to call. Today it primes a purely stateless flow; Phase C is the rewrite to teach the session-mode workflow as the primary path with `{artifact}` mentioned as an OSS/airgap fallback.

- [ ] **14. Rewrite `src/cli/mcp/tools/authoring-start.ts`.** Per design: teach token issuance on first mutation, echo-back contract, that mutation responses are acks not full artifacts, that reads are explicit and on-demand (`pathfinder_list_blocks` / `pathfinder_get_block` / `pathfinder_get_manifest_session` / `pathfinder_inspect`), that the artifact returns only at finalize. Bias toward session-token mode; mention `{artifact}` fallback briefly with one trigger (no GCS in OSS / airgap). Update the existing `authoring-start.test.ts` snapshot (if any) in the same commit. Decide whether `SERVER_INSTRUCTIONS` in `lib/server-instructions.ts` needs a parallel update — most likely yes, since those instructions reach the model first.
- [ ] **15. `pathfinder_finalize_for_app_platform` accepts `{ sessionToken }` and deletes on success.** Mirror the discriminated input from `inspection-tools.ts`. Load → return the existing `clientGuidance` handoff payload (unchanged) → `store.delete(token)` on success only. Delete failure (rare but possible against GCS) logs but does not fail the response — the 7-day lifecycle rule is the safety net so we can't strand a session. Update the `finalize.test.ts` snapshot in the same commit; add a new test asserting the store is empty for that token after a successful finalize.

**Phase C deliverable.** Agent guidance now matches the new flow end-to-end: an MCP-aware client following `pathfinder_authoring_start` learns about session tokens, never tries to echo artifacts back through mutations, and finalize cleans up after itself. Happy-path drafts evict immediately on finalize; abandoned ones expire via the 7-day lifecycle rule that already ships in `scripts/deploy-mcp.sh`. No new tool surface beyond a `sessionToken` input on finalize.

### Phase D — Hardening + observability

- [ ] **16. Optional `Mcp-Session-Id` binding.** On first mutation that creates a session, capture the transport-layer `Mcp-Session-Id` header (if present) and persist a pin in the store (sidecar object `<token>/.pin`). Subsequent calls with a mismatched header return `404 not_found` (per design — not 403). Absence of the header skips the check entirely (stdio transport). Test covers all three paths.
- [ ] **17. Logging discipline.** Every session-mode tool logs `{ tokenPrefix, tokenHash, generation, artifactBytes, gcsLatencyMs }` only. Raw tokens never appear. A lint-style test greps the codebase for `console.log` patterns that would emit a full token and asserts none exist in `src/cli/mcp/`.
- [ ] **18. Cloud Run smoke test.** `./deploy-mcp.sh dev`, then run a scripted 20+ hop authoring loop against the deployed URL (a small `scripts/smoke-gcs-sessions.ts` that exercises create → many add-block → finalize). Capture wire-bytes (request + response sizes) and compare to the same loop in stateless mode. Confirm the 2026-05-01 telemetry projection (roughly O(N²) → O(N)).
- [ ] **19. Docs pass.** Update `docs/developer/MCP_SERVER.md` with a Sessions section (the two input modes, ack shape, retention, env vars). Update `docs/design/HOSTED-AUTHORING-MCP.md` if any contract drifted. Update `docs/design/AI-AUTHORING-IMPLEMENTATION.md`: flip P5's GCS bullet to point at this phase's plan and mark Complete in the index.

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

_Filled at exit._
