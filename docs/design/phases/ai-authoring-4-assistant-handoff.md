# P4 — Assistant handoff and viewer deep link

> Implementation plan for phase 4 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P4](../AI-AUTHORING-IMPLEMENTATION.md#p4--assistant-handoff-and-viewer-deep-link).
> Tracking epic: [grafana/grafana-pathfinder-app#811 — `epic(authoring): Pathfinder AI authoring`](https://github.com/grafana/grafana-pathfinder-app/issues/811). All commits on branch `p4-assistant-handoff-rescoped` and the surfaced PR must reference epic #811 (e.g. `Refs #811`) so the work threads back into the authoring epic.

**Status:** In progress
**Started:** 2026-05-01
**Completed:** _YYYY-MM-DD_

---

## Preconditions

**Prior-phase exit criteria to re-verify before starting:**

- [ ] P3 exit holds — `pathfinder_finalize_for_app_platform` (`src/cli/mcp/tools/finalize.ts`) returns the snapshot-tested shape; `npm run check` clean on `main`.
- [ ] The Cloud Run deployment of `pathfinder-mcp` is reachable via the URL printed by the gitignored `deploy-mcp.sh`. Auth posture is `--allow-unauthenticated` per the [resolved P3 open question](../AI-AUTHORING-IMPLEMENTATION.md#does-the-hosted-http-mcp-need-auth-at-all).
- [ ] The existing `?doc=api:<id>` viewer resolution path (`src/module.tsx` → `src/utils/find-doc-page.ts:28` → `fetchContent` `backend-guide:` branch) resolves block-editor-authored `InteractiveGuide` resources today.
- [ ] Grafana Assistant supports per-instance MCP server configuration per [the public docs](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/configure/mcp-servers/). No Assistant-repo work is required for first-cut integration.

**Surface area this phase touches:**

- **New code:** none. P4 is design-doc and instruction-string work plus integration testing.
- **Modified:**
  - `src/cli/mcp/tools/finalize.ts` — rewrite `instructions` and `localExport.instructions` to be capability-branched and deterministic. Additive fields permitted (e.g. a `clientGuidance` map keyed by branch). Pure response-shape change; no business logic.
  - `src/cli/mcp/__tests__/finalize.test.ts` — snapshot updated in lockstep with the rewrite. Diff is reviewed inline.
  - `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md` — "Handoff output" example, "Create and update behavior" steps, "Local-export fallback" section. Kept in sync with the new wire shape in the same commit.
  - `docs/design/HOSTED-AUTHORING-MCP.md` — "Where it runs" + "Authentication and authorization" sections currently describe MultiAuth + GrafanaGoogleTokenVerifier and a hypothetical Grafana-org service. Replace with the deployed Cloud Run reality (`--allow-unauthenticated` + edge mitigations). Operator-specific details (project, region, service URL) stay out — they live in the gitignored `deploy-mcp.sh`.
  - `docs/developer/MCP_SERVER.md` — add an "Inspecting deployed logs" runbook section. Names the runtime (Cloud Run), points operators at `deploy-mcp.sh` for specifics, gives the canonical `gcloud logging read` query against the structured-JSON access-log fields already documented there. Closes [hardening issue #6](../MCP-AGENT-UX-HARDENING.md) cheaply.
  - `docs/design/AI-AUTHORING-IMPLEMENTATION.md` — P4 row + the P5 deferred-follow-ups list. Records the rescope and moves "broad rollout to all Assistant instances via Assistant's default MCP list" into P5.
- **External contracts modified:**
  - The `pathfinder_finalize_for_app_platform` output shape — `instructions[]` and `localExport.instructions[]` change in shape and content; the `appPlatform`, `resource`, `viewer`, and `localExport.files` fields are stable and must not regress (existing snapshot test enforces this; updated diff is the authoritative record).
- **Explicitly not touched:**
  - `src/utils/find-doc-page.ts`, `src/module.tsx` — viewer resolution path. Verified, not modified, unless Stage A2 surfaces a real bug (out-of-scope to design around speculatively).
  - `src/components/block-editor/ImportGuideModal.tsx` — the OSS re-publish loop the new `localExport` instructions point users at. Read-only; no UI changes.
  - `pkg/plugin/mcp.go` — unchanged from `main` per the P3 cross-cutting concern.
  - The Grafana Assistant repository — broad rollout via Assistant's default MCP list is deferred to P5.
  - Hardening issues #1–#5 from [`MCP-AGENT-UX-HARDENING.md`](../MCP-AGENT-UX-HARDENING.md). Only #6 is incidentally closed by Stage C.
  - The `InteractiveGuide` CRD shape and the `aggregation.pathfinderbackend-ext-grafana-com.enabled` feature toggle.

**Open questions to resolve during execution:**

- **OQ1. Capability-branch taxonomy and field shape.** The current single-path instructions assume the agent self-classifies its environment. Stage A1 picks the branches and the wire shape. Working assumption: three branches — (a) Grafana-aware client with App Platform available, (b) Grafana-aware client on OSS / aggregator disabled, (c) non-Grafana-aware client (Cursor, Claude Desktop). Open: a single labeled-prose `instructions[]` versus a structured `clientGuidance` object keyed by branch. The structured form is more agent-readable but is a larger contract change.
- **OQ2. Error-code → action mapping.** Stage A1 records the deterministic rule that goes into the rewritten instructions. Working draft: `404` on collection path → CRD missing → fall through to `localExport`; `403` → user lacks permission → tell user, offer `localExport`, do not retry; `409` on PUT → stale `resourceVersion` → re-GET, ask user, retry once; `5xx` / network timeout → retry once, then `localExport`.
- **OQ3. OSS re-publish copy.** Wording for the new `localExport` instructions that names the block-editor import flow specifically enough that an end user can find it without screenshots. Reviewed by a non-engineer in Stage D.
- **OQ4. Suggested confirmation prompt copy.** Sentence-cased per the Grafana Writers' Toolkit (`AGENTS.md`). Working draft: `Publish guide "<title>" to <namespace> as <status>?`. Lands in the Grafana-aware-with-App-Platform branch only.
- **OQ5. Viewer URL absolutization step.** The handoff returns `viewer.floatingPath` as a relative path. The new instructions explicitly tell the agent to join it with the user's Grafana instance origin before surfacing. Confirmed in Stage A1; encoded in Stage B.

---

## Tasks

Atomic-commit-sized. Reference epic in every commit message (`P4: <subject>` + `Refs #811` trailer).

### Stage A — Design and verification (de-risks the rewrite)

- [ ] **A1.** Walk the current `pathfinder_finalize_for_app_platform` payload against each of the three working-assumption client branches (Grafana+AppPlatform / Grafana+OSS / non-Grafana). For each branch, list which existing fields the agent uses and which it ignores. Pick the wire shape (single labeled `instructions[]` vs. structured `clientGuidance` object — OQ1). Record decision and the chosen error-code → action table (OQ2) in the Decision log. **Output: a numbered branch taxonomy ready for Stage B to encode.**
- [ ] **A2.** Verify the existing `?doc=api:<id>` resolution path resolves an AI-authored `InteractiveGuide` end-to-end on a local Grafana with the aggregator enabled. Method: drive `pathfinder-mcp` over stdio to author a tiny guide → hand-roll a `curl` POST against `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/<ns>/interactiveguides` → open `/a/grafana-pathfinder-app?doc=api:<id>&panelMode=floating` → confirm the guide renders in floating mode. Record outcome in the Decision log.
- [ ] **A3.** Capture the canonical-`id` cross-doc consistency snapshot from A2's run: `content.id`, `manifest.id`, handoff top-level `id`, `resource.metadata.name`, `viewer.docParam`, the URL the user clicked. Assert all six are byte-identical. Record in the Decision log. (Closes index exit criterion 3 ahead of the integration tests in Stage D.)

### Stage B — Rewrite the handoff instructions

- [ ] **B1.** Rewrite `src/cli/mcp/tools/finalize.ts` `instructions` (and any new `clientGuidance` field per A1) to encode the three branches. The Grafana-aware-with-App-Platform branch contains: (a) ask draft-vs-published before writing, (b) the error-code → action rule from A1, (c) join `viewer.floatingPath` with the user's Grafana origin to produce an absolute URL, (d) only return the link after a successful 2xx, (e) the suggested confirmation prompt copy (OQ4).
- [ ] **B2.** Rewrite `localExport.instructions` to (a) skip the draft/published prompt — irrelevant for local-export, (b) tell the agent to tell the user about the block-editor import flow (Pathfinder → block editor → Import → paste or upload `content.json`). The Grafana-aware-OSS branch and the non-Grafana-client branch both end here; they differ only in whether the agent attempted the App Platform write first.
- [ ] **B3.** Update `src/cli/mcp/__tests__/finalize.test.ts` snapshot to match. The diff is the authoritative record of the contract change — review inline.
- [ ] **B4.** Update [`APP-PLATFORM-PUBLISH-HANDOFF.md`](../APP-PLATFORM-PUBLISH-HANDOFF.md) to match: "Handoff output" example, "Create and update behavior" steps, "Local-export fallback" section. Design doc and wire payload land in the same commit so they cannot drift.

### Stage C — Documentation cleanup (resolves drift introduced by the P3 deploy reality)

- [ ] **C1.** Update [`HOSTED-AUTHORING-MCP.md` — Where it runs](../HOSTED-AUTHORING-MCP.md#where-it-runs) and the "Authentication and authorization" subsection to match deployed reality: Cloud Run, `--allow-unauthenticated`, edge-mitigated. Replace the MultiAuth / GrafanaGoogleTokenVerifier prose with a pointer to the resolved P3 open question. Do **not** name project ID, region, or service URL — those stay operator-local in `deploy-mcp.sh`.
- [ ] **C2.** Add a short "Inspecting deployed logs" runbook section to `docs/developer/MCP_SERVER.md`. Names the runtime (Cloud Run), points operators at `deploy-mcp.sh` for project/service specifics, shows the canonical `gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=<svc>' --limit=50 --format=json` query, notes that the structured access-log fields documented above appear under `jsonPayload`. Closes [hardening issue #6](../MCP-AGENT-UX-HARDENING.md#6-deployment--log-inspection-discoverability-for-future-agents).
- [ ] **C3.** Update the P4 row in [`AI-AUTHORING-IMPLEMENTATION.md`](../AI-AUTHORING-IMPLEMENTATION.md) status table and the corresponding section. Move "broad rollout to all Assistant instances via Assistant's default MCP list" into the P5 deferred-follow-ups list with a note that it requires Assistant-team coordination on the write-tool surface (per the [P0 spike Handoff](./ai-authoring-0-assistant-spike.md#handoff-to-next-phase)).

### Stage D — Integration tests on real instances

- [ ] **D1.** **Per-instance integration test on a Grafana Cloud instance.** Configure the deployed `pathfinder-mcp` Cloud Run URL as a per-instance MCP server in Grafana Assistant per [the docs](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/configure/mcp-servers/). Drive a turn end-to-end: ask Assistant to create a guide → MCP authors it → finalize call returns the new branched instructions → Assistant prompts draft/published → user confirms publish → Assistant performs the write → Assistant returns the absolute floating-mode URL → user clicks → guide opens in Pathfinder. Capture the turn transcript on epic #811.
- [ ] **D2.** **Per-instance integration test on Grafana OSS** (or Cloud with `aggregation.pathfinderbackend-ext-grafana-com.enabled` off). Same flow up to publish; verify the new instructions route the agent to `localExport`, files are written, the user is told about the block-editor import path, no viewer link is offered.
- [ ] **D3.** **Non-Grafana-client smoke test.** From Cursor or Claude Desktop with `npx pathfinder-mcp` over stdio, drive the same flow. Verify the new instructions route straight to `localExport` (no POST attempted), files land in the user's workspace, the agent surfaces the block-editor import path.
- [ ] **D4.** **Update path with explicit `--id`.** Author with `--id existing-guide`, finalize → agent performs GET-then-PUT → verify `resourceVersion` is preserved. Then simulate a stale `resourceVersion` (concurrent edit) and verify the 409 path matches the OQ2 rule (re-GET + user confirm).
- [ ] **D5.** Have a non-engineer read the new `localExport` re-publish copy in context (OQ3). Adjust if it surprises them.

### Test plan

- Snapshot test: `src/cli/mcp/__tests__/finalize.test.ts` passes after Stage B updates it intentionally; the diff is reviewed inline.
- Unit test coverage: existing tests on `finalize.ts` exercise the success and `invalid` branches; ensure the new branched output is exercised by adding a test per branch (Grafana+AppPlatform / Grafana+OSS / non-Grafana) asserting the right `instructions` block surfaces.
- Integration tests: Stage D1 / D2 / D3 / D4 are real-instance tests; outcomes recorded as comments on epic #811 (transcript or screen recording).
- Manual: Stage D5 non-engineer read-through.
- Reviewer commands on the Pathfinder side: `npm run check`, `npm run test:ci`. No Assistant-side or infra-side tests are owned by this phase.

### Verification (matches index exit criteria)

- [ ] End-to-end on Cloud: user asks Assistant to create a guide → Assistant authors via MCP → asks for save/publish → POSTs to App Platform → returns floating viewer link → user clicks → guide opens in Pathfinder. (D1, D4.)
- [ ] End-to-end on OSS: same flow up to publish, then `localExport` triggers, files written, no viewer link offered. (D2, D3, D5.)
- [ ] Cross-doc consistency check: `id`, `metadata.name`, `?doc=api:<id>` are the same string at every boundary. (A3.)

---

## Decision log

_Appended during execution. Each entry: date, decision, alternatives considered, rationale._

_(empty)_

---

## Deviations

_Appended during execution. Departures from this plan, with reason. May be empty._

_(empty)_

---

## Handoff to next phase

_Filled at exit. P4 closes the AI-authoring MVP for per-instance Assistant integration. The handoff should make clear:_

- _Which client-capability branches the new instructions encode, so future hardening or rollout phases inherit the right contract._
- _What the OSS re-publish loop looks like to the user (block-editor import), so a P5 doc/UX agent does not re-invent it._
- _Which design docs were touched so a P5/P6 agent reads the current state, not the pre-rescope draft of `HOSTED-AUTHORING-MCP.md` or the original `instructions[]` shape in the handoff._
- _The Cloud Run deploy is operator-local; the runbook in `MCP_SERVER.md` is the canonical pointer, the project/service specifics are not in tracked files._
- _Hardening issues #1–#5 in `MCP-AGENT-UX-HARDENING.md` remain open and unowned by P4._
