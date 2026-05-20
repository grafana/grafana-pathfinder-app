# P7 — GCS-backed authoring sessions

> Implementation plan for phase 7 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria graduate the deferred [P5 — GCS-backed authoring sessions](../AI-AUTHORING-IMPLEMENTATION.md#p5--deferred-follow-ups) bullet into its own phase. The design is fully specified in that bullet (storage layout, token format, tool-surface shape, concurrency, retention, confidentiality); this plan phases the implementation.
> Tracking issue: _epic issue TBD_.

**Status:** Not started
**Started:** _YYYY-MM-DD_
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

### Phase A — Infrastructure + storage seam (no public tool surface change)

- [ ] **1. Parameterize `deploy-mcp.sh` by environment.** Add `ENV` (defaults `dev`); derive `BUCKET="pathfinder-mcp-${ENV}"`, `SERVICE_ACCOUNT="pathfinder-mcp-${ENV}@${PROJECT_ID}.iam.gserviceaccount.com"`, optionally `SERVICE="pathfinder-mcp-${ENV}"` (decide at execution — for now keep `SERVICE` unchanged to avoid disturbing the existing dev URL). Project + region stay hardcoded for now; flagged in script comment as the next axis to parameterize when staging/prod arrive.
- [ ] **2. Idempotent bucket bootstrap in `deploy-mcp.sh`.** Add a preflight block (mirroring the existing artifact-registry block) that:
  - Enables `storage.googleapis.com`.
  - Creates `gs://${BUCKET}` if absent (`gcloud storage buckets create`) with uniform bucket-level access on, region matching `${REGION}`, no public access.
  - Applies the 7-day lifecycle rule via `gcloud storage buckets update --lifecycle-file=`. Lifecycle JSON lives in a heredoc inside the script (no separate file) — keeps the script self-contained.
- [ ] **3. Dedicated service account in `deploy-mcp.sh`.** Create `${SERVICE_ACCOUNT}` if absent. Grant `roles/storage.objectAdmin` **scoped to the bucket** (`gcloud storage buckets add-iam-policy-binding`), not project-wide. Update the `gcloud run deploy` call to `--service-account=${SERVICE_ACCOUNT}` and `--set-env-vars=PATHFINDER_SESSION_BUCKET=${BUCKET},PATHFINDER_SESSION_STORE=gcs`.
- [ ] **4. `SessionStore` interface + in-memory impl.** `src/cli/mcp/lib/session-store.ts` exports `interface SessionStore { load(token): Promise<{ artifact, generation } | null>; save(token, artifact, ifGenerationMatch): Promise<{ generation }>; delete(token): Promise<void>; }`. In-memory impl backed by a `Map`, with generation counters incrementing on each write. Throws structured `{ code: 'PRECONDITION_FAILED', expected, actual }` on `ifGenerationMatch` mismatch. Unit tests cover happy path, generation-mismatch, delete-then-load, concurrent writes via `Promise.all`.
- [ ] **5. GCS impl.** `src/cli/mcp/lib/session-store-gcs.ts` wraps `@google-cloud/storage`. Reads bucket name from `PATHFINDER_SESSION_BUCKET` (constructor arg, env-driven). Objects laid out per design: `<token>/content.json` and `<token>/manifest.json` under the bucket root. `save` is two `file.save({ resumable: false, preconditionOpts: { ifGenerationMatch } })` writes; `load` is two parallel reads; `delete` is `bucket.deleteFiles({ prefix: '<token>/' })`. Unit tests use the `@google-cloud/storage` testing patterns we already lean on elsewhere (mock the GCS client at module level — see `src/lib/package-recommendations-client.ts` test for the pattern).
- [ ] **6. Token generator + logging helpers.** `src/cli/mcp/lib/session-token.ts`: `generateSessionToken(): string` (22 chars Crockford base32 via `crypto.randomBytes(14)` → reject-and-retry on lookalikes; lowercased output), `isValidSessionToken(s): boolean`, `tokenLogPrefix(s): string` (first 12 chars), `tokenLogHash(s): string` (SHA-256 hex first 16 chars). Unit tests: entropy bound, alphabet excludes `I/L/O/U`, validator rejects mixed-case / wrong-length / wrong-alphabet, prefix and hash are deterministic.
- [ ] **7. Wire the store into `state-bridge.ts` without changing public tool input.** Add `withSession(token, store, runner)`: load from store → invoke runner via existing `withArtifact`-style tmpdir flow → save back to store with `ifGenerationMatch`. **No mutation-tool input schema change yet** — this task is the seam, not the wire-up. A unit test exercises the seam end-to-end against the in-memory store.

**Phase A deliverable.** `./deploy-mcp.sh dev` deploys the service with the bucket, SA, and env vars all wired, but no tool calls actually use the bucket yet (`authoring-start` still primes stateless flow; mutation tools still take `{artifact}`). The store exists, is callable from a Node REPL, and tests pass. Rollback = drop one PR, deployed service is unchanged in behavior.

### Phase B — Session-mode mutations + fine-grained reads

- [ ] **8. Discriminated input on every mutation tool.** Each of `pathfinder_add_block`, `pathfinder_add_step`, `pathfinder_add_choice`, `pathfinder_edit_block`, `pathfinder_remove_block`, `pathfinder_set_manifest` accepts **either** `{ sessionToken, expectedGeneration? }` **or** `{ artifact }`. Zod schemas branch via `z.union` with a `superRefine` that requires exactly one. Token-mode dispatch: `withSession(...)` returns the ack `{ sessionToken, generation, added/edited/removed: { kind, id } }` per design. Artifact-mode dispatch is the current code path, unchanged.
- [ ] **9. `pathfinder_create_package` mints a session on token-less call.** When called without `sessionToken`, mint via `generateSessionToken()`, store the initial artifact, return `{ sessionToken, generation }`. When called with `sessionToken`, refuse with `ALREADY_INITIALIZED` (a session is one package; mint a new one for a new package).
- [ ] **10. Failed-mutation invariant test.** Introduce a CLI-detectable schema violation (the existing `ARTIFACT_MUTATED` path in `mutation-tools.ts` is the model) and assert that GCS/in-memory state is **unchanged** afterwards. This is the load-bearing test for the P3 "MCP performs no schema validation" contract.
- [ ] **11. New fine-grained read tools.** `pathfinder_list_blocks({ sessionToken })`, `pathfinder_get_block({ sessionToken, blockId })`, and the renamed `pathfinder_get_manifest_session({ sessionToken })` (final name decided in Open questions). Registered in `src/cli/mcp/tools/index.ts`. Tests cover unknown token (404), unknown block id, happy path.
- [ ] **12. `pathfinder_inspect` and `pathfinder_validate` accept `{ sessionToken }`.** Same discriminated-input pattern as mutations. Inspect returns the full artifact; validate returns structured errors only. Existing `{ artifact }` mode preserved.
- [ ] **13. `expectedGeneration` server-side retry-once.** On `PRECONDITION_FAILED` from the store, refetch and retry the mutation once. If it fails again, surface `{ status: 'error', code: 'CONCURRENT_MODIFICATION', expected, actual }`. Test covers both the retry-succeeds and retry-fails paths.

**Phase B deliverable.** Token-mode is live end-to-end. Stateless `{artifact}` mode untouched (fallback per design). Re-deploying via `./deploy-mcp.sh dev` exposes the new tools.

### Phase C — Guidance + finalize lifecycle

- [ ] **14. Rewrite `src/cli/mcp/tools/authoring-start.ts`.** Per design: teach token issuance on first mutation, echo-back contract, that mutation responses are acks not full artifacts, that reads are explicit and on-demand, that the artifact returns only at finalize. Bias toward session-token mode; mention `{artifact}` fallback briefly with one trigger (no GCS in OSS/airgap). Update the snapshot test.
- [ ] **15. `pathfinder_finalize_for_app_platform` accepts `{ sessionToken }` and deletes on success.** Load → return the existing handoff payload → `store.delete(token)` on success. Delete failure logs but does not fail the response (lifecycle rule is the safety net). Update `finalize.test.ts` snapshot in the same commit.

**Phase C deliverable.** Agent guidance now matches the new flow. Happy-path drafts evict immediately; abandoned ones expire via lifecycle.

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

### 2026-05-20 — In-memory `SessionStore` is the local-dev default

- **Decision:** `PATHFINDER_SESSION_STORE` defaults to `memory`; `deploy-mcp.sh` sets it to `gcs` for the deployed service.
- **Alternatives considered:** Filesystem-backed local store; require GCS even locally via emulator.
- **Rationale:** In-memory is the smallest viable surface for local dev — no disk persistence required, no emulator dep. Matches the design's "deferred is not durable" stance. Cloud Run gets `gcs` via the deploy script so the bucket is exercised on every deploy.
- **Touches:** Tasks 4, 5, 7; env var contract.

---

## Deviations

_Appended during execution._

---

## Handoff to next phase

_Filled at exit._
