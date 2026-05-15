# Pathfinder AI authoring — implementation plan

> Implementation plan for [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Per-phase detailed plans live under [`docs/design/phases/`](./phases/) and are drafted when a phase becomes active.

This document is the living index for the AI authoring implementation. It defines the phase boundaries, exit criteria, and dependency order so that work can be parceled out, tracked, and progressively shipped without keeping the entire design in working memory.

The canonical design lives in the six design docs linked from [`PATHFINDER-AI-AUTHORING.md`](./PATHFINDER-AI-AUTHORING.md). This document does not redefine the design — it phases it.

## Status

| Phase | Title                                  | Status      | Detailed plan                                                                             | Tracking         |
| ----- | -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- | ---------------- |
| P0    | Assistant handoff spike                | Complete    | [ai-authoring-0-assistant-spike.md](./phases/ai-authoring-0-assistant-spike.md)           | _epic issue TBD_ |
| P1    | CLI authoring foundation               | Complete    | [ai-authoring-1-cli-foundation.md](./phases/ai-authoring-1-cli-foundation.md)             | _epic issue TBD_ |
| P2    | npm + Docker distribution              | Complete    | [ai-authoring-2-distribution.md](./phases/ai-authoring-2-distribution.md)                 | _epic issue TBD_ |
| P3    | TypeScript MCP server                  | Complete    | [ai-authoring-3-ts-mcp.md](./phases/ai-authoring-3-ts-mcp.md)                             | _epic issue TBD_ |
| P4    | Assistant handoff and viewer link      | In progress | [ai-authoring-4-assistant-handoff.md](./phases/ai-authoring-4-assistant-handoff.md)       | _epic issue TBD_ |
| P5    | Existing-tool migration and follow-ups | Deferred    | —                                                                                         | —                |
| P6    | CDN repository tools (TS MCP)          | Complete    | [ai-authoring-6-cdn-repository-tools.md](./phases/ai-authoring-6-cdn-repository-tools.md) | _epic issue TBD_ |

Each row's "Detailed plan" cell is filled in when an agent runs the per-phase planning step and writes `docs/design/phases/ai-authoring-N-<slug>.md`.

### MCP hardening (post-P3 follow-ups)

Parallel track to P4–P6. Sources from [`MCP-AGENT-UX-HARDENING.md`](./MCP-AGENT-UX-HARDENING.md) — the living parking lot for "the server works, but agents misuse it in predictable ways" findings. Each slice is sized to land independently; they share the M1/M2/M3 plumbing introduced in slice 1.

| Slice | Title                                         | Status                | Detailed plan                                                                                           | Closes                                                                                                                                       |
| ----- | --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| MH1   | Routing, composition, and selector discipline | Complete              | [mcp-hardening-1-routing-and-composition.md](./phases/mcp-hardening-1-routing-and-composition.md)       | Hardening issues #3, #7, #8 + M1 + M2 plumbing                                                                                               |
| MH2   | Artifact integrity + input normalization      | Complete              | [mcp-hardening-2-integrity-and-normalize.md](./phases/mcp-hardening-2-integrity-and-normalize.md)       | Hardening issues #1, #2 + M3 plumbing                                                                                                        |
| MH3   | Routing telemetry response                    | Complete              | [mcp-hardening-3-routing-telemetry-response.md](./phases/mcp-hardening-3-routing-telemetry-response.md) | Further close on issue #7 from production trace                                                                                              |
| MH4   | Migrate Go MCP runtime tools to TS            | Complete (2026-05-15) | [mcp-hardening-4-go-mcp-migration.md](./phases/mcp-hardening-4-go-mcp-migration.md)                     | P5 "migrate Go MCP runtime tools" deferred item                                                                                              |
| MH5   | Retire the Go MCP entirely                    | Complete (2026-05-15) | [mcp-hardening-5-retire-go-mcp.md](./phases/mcp-hardening-5-retire-go-mcp.md)                           | Removes `launch_guide` + pending-launch queue — both architecturally obsolete under the central TS MCP + Assistant web-surface handover (P4) |

All three landed 2026-05-12 under PR #869. Hardening issues #4 (step/choice block ids) and #5 (hop-over-hop growth, tracked in the P5 GCS-sessions entry) remain open. Issue #6 (deploy/log discoverability) is closed incidentally by the P4 runbook task.

## How to use this document

1. Pick the next not-started phase whose dependencies are met.
2. Copy [`phases/_template.md`](./phases/_template.md) to `docs/design/phases/ai-authoring-N-<slug>.md` and fill the **Preconditions** and **Tasks** sections. The phase entry below is the contract; the per-phase plan is the implementation breakdown.
3. Update the status table — set the status to `In progress` and link the plan and tracking issue.
4. Execute. Append to **Decision log** and **Deviations** as you go. Land changes against the exit criteria. Reference the phase ID in commit messages (`P1: ...`, `P3a: ...`) so `git log` is a per-phase audit trail.
5. At exit, fill the **Handoff to next phase** section. Mark `Complete` in the status table.
6. When the full epic ships, archive the index and the per-phase plans to `docs/history/` with a one-paragraph **Record** summary, mirroring [`docs/history/package-implementation-record.md`](../history/package-implementation-record.md).

### Per-phase plan structure

Every per-phase plan uses the same five-section template so cross-phase context handoff is mechanical, not improvised. See [`phases/_template.md`](./phases/_template.md) for the canonical skeleton.

| Section               | When filled                        | Purpose                                                                                                                                                          |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preconditions         | At draft                           | What must be true on arrival. Prior-phase exit criteria to re-verify, files/APIs/symbols this phase will touch. Orients the agent picking up the work.           |
| Tasks                 | At draft, checked during execution | Numbered breakdown with file paths, atomic-commit-sized. Stays a contract — deviations get recorded below, not by silently rewriting.                            |
| Decision log          | Appended during execution          | Choices made where the design left room; alternatives considered; rationale. What the next phase's agent reads to understand "why did P*n* land it this way."    |
| Deviations            | Appended during execution          | Departures from the design or this plan, with reason. Distinct from decisions because deviations may need to propagate back into the design docs or this index.  |
| Handoff to next phase | At exit                            | **The only mandatory exit section.** 5–10 bullets max: what's now true that wasn't before, gotchas, reusable fixtures, deferred punts, design docs that drifted. |

Decision log and Deviations are append-only and may be empty if the phase ran cleanly. Handoff is required at exit.

## Dependency graph

```
P0 (spike) -----------------------+
                                  |
P1 (CLI) --> P2 (distribution) --+--> P3 (TS MCP) --> P4 (Assistant + link)
                                  |
                                  +--> P5 (deferred follow-ups)
                                  |
                                  +--> P6 (CDN repository tools)
```

P0 is non-blocking until P4. P1 is the critical path for everything downstream. P2 lands before P3 because the TS MCP server is published as a second entrypoint of the same npm package the CLI ships in — once the package layout and publishing pipeline exist (P2), P3 adds the MCP entrypoint to it. There is no shell-out boundary, no bundled binary, and no plugin-tarball coupling.

---

## P0 — Assistant handoff spike

**Goal.** De-risk boundary decision 8 in the parent design: confirm Grafana Assistant can use a runtime-supplied path (`appPlatform.itemPathTemplate`) to perform an authenticated POST/PUT against the App Platform `interactiveguides` resource within an Assistant turn.

**Scope.**

- Source-dive Assistant's existing instance-API integration.
- Validate that an MCP-handoff → Assistant → App-Platform write is achievable using existing capabilities, or identify the specific gap.
- Produce a short spike report.

**Out of scope.** Any production code. Any Pathfinder-side changes.

**Dependencies.** None.

**Exit criteria.**

- Spike report committed (under `docs/design/phases/ai-authoring-0-assistant-spike.md` or as a comment on the epic issue).
- One of: green-light to proceed with P4 as designed, or a gap identified and assigned as a P3-or-earlier prerequisite.

**Why first (and parallel).** This is the only currently-unprototyped piece of the design. It does not block P1–P3 but must be resolved before P4 begins.

---

## P1 — CLI authoring foundation

**Goal.** A `pathfinder-cli` an agent can use end-to-end on a developer machine to author a valid guide package, with validate-on-write, schema-driven flags, and agent-oriented output.

**Scope.** Sub-phases 1–6 of [`AGENT-AUTHORING.md` — Implementation plan](./AGENT-AUTHORING.md#implementation-plan):

- Schema `.describe()` annotations on commonly used block types.
- Optional `id` field on leaf block schemas (additive).
- Tighten the package `id` regex to kebab-case, max 253 chars (Kubernetes resource-name compatible), aligning the TS schema with the existing Go-side regex.
- `src/cli/utils/schema-options.ts` — Zod-to-Commander bridge.
- `src/cli/utils/block-registry.ts` — `BLOCK_SCHEMA_MAP` + completeness test.
- `src/cli/utils/package-io.ts` — read-mutate-validate-write core.
- Commands: `create`, `add-block`, `add-step`, `add-choice`, `set-manifest`, `inspect`, `edit-block`, `remove-block`.
- Shared output formatting: `--quiet`, `--format json`.
- `--if-absent` on container `add-block`.
- Auto-ID assignment for leaf blocks (`<type>-<n>`) and for the package `id` on `create` (`<kebab-of-title>-<6-char-base32-suffix>`).
- Full test suite (bridge unit tests, per-command tests, integration test, registry completeness, idempotency, output-shape, auto-ID, edit/remove semantics).
- `pathfinder-cli <cmd> [<sub>] --help --format json` produces the stable shape promised in [`AGENT-AUTHORING.md` — `--help --format json` is a stability contract](./AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract).

**Out of scope.** Any binary or Docker packaging (P2). Any MCP integration (P3). Any documentation work beyond inline `--help` (a separate doc pass lives at the end of P3).

**Dependencies.** None internal. Audit `src/bundled-interactives/` and the `interactive-tutorials` repository for non-kebab IDs before tightening the regex; normalize in the same change set if any are found.

**Exit criteria.**

- An agent following only the ~20-line context block in [`AGENT-AUTHORING.md` — Agent context injection](./AGENT-AUTHORING.md#agent-context-injection) can author a multi-block guide that passes `validatePackage()`.
- All listed tests pass; `npm run check` is clean.
- The CLI version equals `CURRENT_SCHEMA_VERSION`.

**Splittable.** If the phase is too large to land in one PR, split into:

- **P1a** — schema changes, bridge, registry, package-IO. No new user-facing commands. Internal-only.
- **P1b** — commands, output formatting, full test suite.

The split is mechanical; the exit criterion above belongs to P1b.

---

## P2 — npm + Docker distribution

**Goal.** The `pathfinder-cli` npm package and `grafana/pathfinder-cli` Docker image are published, version-pinned to `CURRENT_SCHEMA_VERSION`, and ready to host the `pathfinder-cli mcp` subcommand that P3 adds.

**Scope.** Sub-phase 7 of [`AGENT-AUTHORING.md` — Implementation plan](./AGENT-AUTHORING.md#implementation-plan):

- npm package layout: single `pathfinder-cli` package with `package.json#bin` exposing `pathfinder-cli` (existing entrypoint from P1); the MCP server arrives in P3 as a subcommand under the same bin.
- Prepublish script: pin `package.json` version to `CURRENT_SCHEMA_VERSION` so MCP and CLI versions cannot drift.
- Docker image: `grafana/pathfinder-cli:<version>`. Wraps the published npm package. Convenience entrypoint routes to `pathfinder-cli` by default and forwards a leading `mcp` arg through to the `pathfinder-cli mcp` subcommand.
- GitHub Actions: build the package and run smoke tests on every merge to `main`; publish to npm and push the Docker image on tagged releases.
- Smoke tests after release publish:
  - `npx pathfinder-cli@<version> --version` returns `CURRENT_SCHEMA_VERSION`.
  - `docker run --rm grafana/pathfinder-cli:<version> --version` returns `CURRENT_SCHEMA_VERSION`.

**Out of scope.** Per-platform single-file binaries / Node SEA / `pkg` — explicitly retired. Plugin-tarball bundling — explicitly retired (the plugin is no longer the distribution unit for the CLI). The `pathfinder-cli mcp` subcommand code itself — added in P3. Windows binary — deferred (Docker covers it).

**Dependencies.** P1.

**Exit criteria.**

- `pathfinder-cli@<CURRENT_SCHEMA_VERSION>` is installable from the npm registry and `npx` runs it.
- `grafana/pathfinder-cli:<CURRENT_SCHEMA_VERSION>` is in the container registry and runs.
- Both versions match `CURRENT_SCHEMA_VERSION` exactly (verified by smoke test).
- Plugin tarball contents are unchanged from `main` — the CLI is no longer copied into the tarball.

---

## P3 — TypeScript MCP server

**Goal.** Any MCP-capable client can connect to the standalone TypeScript MCP server, author a guide end-to-end via tool calls, and receive a finalization payload. The server runs from the same npm package as the CLI and imports CLI commands as library functions.

**Scope.**

- Add a `mcp` subcommand to `pathfinder-cli` under `src/cli/mcp/`. Same compiled `dist/` tree, registered alongside the other subcommands in `src/cli/index.ts`.
- Tool dispatchers map each MCP tool call to the corresponding imported CLI command function (`runCreate`, `runAddBlock`, …) — no shell-out, no temp directory, no `exec.Command`. The CLI test suite already exercises these functions directly without subprocess invocation; P3 composes against the same surface.
- Stateless artifact model — every mutation tool takes the artifact in and returns the artifact out. No `sessionId`, no server-side cache.
- Two transports from one codebase:
  - **stdio** — the default for local MCP clients (Cursor, Claude Desktop, MCP Inspector). Trust-the-local-user auth model.
  - **HTTP** — for centrally hosted deployment. **MVP ships without auth** (see [open question resolution](#does-the-hosted-http-mcp-need-auth-at-all)); abuse mitigations are edge rate-limiting, request size caps, and autoscaling ceilings. Auth is deferred to a later phase if usage patterns demand it.
- Tools (per [`HOSTED-AUTHORING-MCP.md` — Core tools](./HOSTED-AUTHORING-MCP.md#core-tools)):
  - `pathfinder_authoring_start` — first tool, returns context + workflow + tutorial + discovery hints.
  - `pathfinder_help` — composes the same `--help --format json` surface the CLI exposes, as a function call.
  - `pathfinder_create_package`, `pathfinder_add_block`, `pathfinder_add_step`, `pathfinder_add_choice`, `pathfinder_edit_block`, `pathfinder_remove_block`, `pathfinder_set_manifest`.
  - `pathfinder_inspect`, `pathfinder_validate`.
  - `pathfinder_finalize_for_app_platform` — returns the handoff structure defined in [`APP-PLATFORM-PUBLISH-HANDOFF.md`](./APP-PLATFORM-PUBLISH-HANDOFF.md), including the `localExport` fallback.
- `pathfinder_add_block` is intentionally permissive — the discriminator and arbitrary fields are forwarded; the CLI command function is the sole validator.
- Failure-mode coverage: validation failure, finalization failure, schema mismatch, transport-level failures (stdio pipe closed, HTTP 5xx).
- Documentation pass for the new tools (developer docs + agent context update in `AGENTS.md`).

**Out of scope.** Direct App Platform writes from the MCP (those are P4). Migrating Go MCP runtime tools (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`) — that's P5. Editing `pkg/plugin/mcp.go` — explicitly excluded; the existing Go MCP is unchanged.

**Dependencies.** P1, P2.

**Exit criteria.**

- A non-Grafana-aware MCP client (Cursor, Claude Desktop) can connect to `npx pathfinder-cli mcp` over stdio, call `pathfinder_authoring_start`, build a multi-block guide via tool calls, validate, and call `pathfinder_finalize_for_app_platform` to receive a handoff containing both `appPlatform` instructions and a `localExport` fallback.
- The same code, run with the HTTP transport behind the Grafana token verifier, accepts authenticated requests with the same tool surface.
- Following `localExport`, the client can write `content.json` and `manifest.json` to the user's workspace and the resulting package round-trips through `pathfinder-cli validate`.
- The MCP server performs no schema validation of its own — confirmed by code review (the only validator entry points are the imported CLI command functions) and by an integration test that introduces a CLI-detectable schema violation and asserts the MCP surfaces the CLI's structured error verbatim.
- `pkg/plugin/mcp.go` is unchanged from `main` (apart from the spike/stub status comment added on this branch).

---

## P4 — Assistant handoff and viewer deep link

**Goal.** Per-instance Grafana Assistant integration with the deployed `pathfinder-cli mcp` succeeds: the agent receives capability-branched, deterministic instructions; the App Platform write performed by Assistant lands and the user clicks through to a working floating-mode viewer link; OSS and non-Grafana clients fall through to `localExport` cleanly and are pointed at the block-editor Import flow as the re-publish path.

**Scope.**

- Rewrite `src/cli/mcp/tools/finalize.ts` instructions to a structured `clientGuidance` object keyed by client capability (`grafanaAppPlatform` / `grafanaOss` / `nonGrafanaClient`), each with explicit `appliesWhen`, `steps`, and (where applicable) `errorHandling` and `confirmationPrompt` fields. Replace the prose `instructions[]` with a routing-only preamble.
- Encode deterministic error-code → action rules (404 → switch to `grafanaOss`; 403 → tell user, offer `localExport`; 409 on PUT → re-GET, confirm, retry once; 5xx/timeout → retry once, then `localExport`; other 4xx → surface verbatim, offer `localExport`).
- Surface the existing block-editor Import flow (`src/components/block-editor/ImportGuideModal.tsx`) in `localExport.instructions` and in both fallback branches as the user's re-publish path.
- Verify the `?doc=api:<id>` resolution path works for AI-authored resources unchanged (`src/module.tsx` → `src/utils/find-doc-page.ts` → `fetchContent` `backend-guide:` branch).
- Capture the cross-doc canonical-`id` consistency snapshot at every boundary.
- Sync [`APP-PLATFORM-PUBLISH-HANDOFF.md`](./APP-PLATFORM-PUBLISH-HANDOFF.md), [`HOSTED-AUTHORING-MCP.md`](./HOSTED-AUTHORING-MCP.md), and [`docs/developer/MCP_SERVER.md`](../developer/MCP_SERVER.md) with deployed reality (Cloud Run, open + edge mitigations) and add a deployed-logs runbook.
- Real-instance integration tests: Cloud (Assistant configured per [the per-instance MCP-server docs](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/configure/mcp-servers/)), OSS / aggregator-off, and a non-Grafana client (Cursor or Claude Desktop over stdio).

**Out of scope.**

- **Broad rollout to all Assistant instances via Assistant's default MCP list.** Requires Assistant-team coordination on the write-tool surface from the [P0 spike Handoff](./phases/ai-authoring-0-assistant-spike.md#handoff-to-next-phase). Moved to [P5 — Deferred follow-ups](#p5--deferred-follow-ups).
- MCP agent UX hardening issues #1–#5 from [`MCP-AGENT-UX-HARDENING.md`](./MCP-AGENT-UX-HARDENING.md) — owned by a separate hardening phase. Issue #6 (deploy/log-inspection discoverability) is incidentally closed by the runbook task in this phase.
- Recommendation-engine parity for custom guides (downstream of CRD work).
- CRD extension to round-trip manifest fields.

**Dependencies.** P0 (resolved 2026-04-28 — green-light, see [spike report](./phases/ai-authoring-0-assistant-spike.md)), P3. The hosted Cloud Run deploy already exists; P4 redeploys after the instruction rewrite lands.

**Detailed plan.** [`phases/ai-authoring-4-assistant-handoff.md`](./phases/ai-authoring-4-assistant-handoff.md). Tracked under epic [grafana/grafana-pathfinder-app#811](https://github.com/grafana/grafana-pathfinder-app/issues/811); commits on the `p4-assistant-handoff-rescoped` branch reference the epic via `Refs #811`.

**Exit criteria.**

- End-to-end on Cloud (per-instance Assistant config): user asks Assistant to create a guide → Assistant authors via MCP → asks draft/published → user confirms → POST to App Platform → Assistant returns absolute floating viewer URL → user clicks → guide opens in Pathfinder.
- End-to-end on OSS / aggregator-off: same flow up to publish, then `localExport` triggers, files written, user pointed at the block-editor Import flow, no viewer link offered.
- Non-Grafana client (Cursor or Claude Desktop over stdio): the `nonGrafanaClient` branch fires, no POST attempted, files land in the workspace, block-editor Import path surfaced.
- Cross-doc consistency check: `id`, `metadata.name`, `?doc=api:<id>` are the same string at every boundary.

**Status note (2026-05-01, after first integration tests).** D3 (non-Grafana client) passes end-to-end. D1 (Cloud Assistant) is **partial**: Assistant correctly drives the authoring loop and reads `clientGuidance.grafanaAppPlatform`, then stops at the publish step because it has no generic App Platform write tool, falling through to the block-editor Import flow. This is the [P0 spike](./phases/ai-authoring-0-assistant-spike.md#handoff-to-next-phase) executor gap, not an instruction-quality gap. **The MCP server will not be extended to perform the write itself** — the central Cloud Run deployment holds no per-instance credentials by design (see [HOSTED-AUTHORING-MCP.md — The MCP server does not write to App Platform — by deployment design](./HOSTED-AUTHORING-MCP.md#the-mcp-server-does-not-write-to-app-platform--by-deployment-design)). Closing D1 requires giving Assistant a write capability, drafted in Assistant's tool-pattern (operation enum, scoping field, format hints, endpoint + payload shape, confirmation policy). Tracked as P4 OQ6 in the [phase plan](./phases/ai-authoring-4-assistant-handoff.md).

**Status note (2026-05-15, executor work in flight).** A frontend-only PR in the assistant repo (#6457, open) closes the D1 executor gap. Shape:

- Two web-surface tools registered with Assistant's existing `tool()` factory: `pathfinder_manage_guide_drafts` (`list`/`get`/`apply`/`delete`) and `pathfinder_publish_guide` (`publish`/`unpublish`).
- Both register with `deferLoading: true` — they only enter conversation context when the agent searches for them, driven by the existing tool-search hooks in our `clientGuidance.grafanaAppPlatform` text.
- Registration gated on `aggregation.pathfinderbackend-ext-grafana-com.enabled` + frontend `isEditor()`. Writes flow through Assistant's session-authenticated `getBackendSrv()` — consistent with our "MCP holds no per-instance credentials" posture, no MCP server change required.
- Safety invariants: `apply` forces `spec.status === 'draft'` and refuses to mutate currently-published guides; `metadata.resourceVersion` is stripped on create; `pathfinder_publish_guide` is `alwaysRequiresConfirmation` (cannot be bypassed by skill-level `allowedTools`).
- Scope is web sidebar / Workspace only — Slack / MS Teams / A2A / CLI surfaces are explicitly deferred (an earlier Go-handler draft was removed because it was unregistered dead code). A `Pathfinder authoring` skill template ships in the same PR to prime the agent on tool selection.
- An Assistant-team-owned follow-up tracks consolidating the pair into a generic `app_platform_write` tool with an allow-list registry; the per-resource tools land first as the concrete shipping vehicle.

**Pathfinder-side follow-up (post-merge, in this repo).** Update `clientGuidance.grafanaAppPlatform.steps` in `src/cli/mcp/tools/finalize.ts` to name `pathfinder_manage_guide_drafts` and `pathfinder_publish_guide` directly, replacing the current "POST to the collection path" prose with the two-tool draft-then-publish flow. Update the `finalize.test.ts` snapshot in the same commit.

---

## P5 — Deferred follow-ups

Tracked here so they don't get lost; not scoped for the MVP.

- **Broad rollout to all Assistant instances via Assistant's default MCP list (deferred from P4).** P4 ships per-instance Assistant integration via [the public MCP-server config docs](https://grafana.com/docs/grafana-cloud/machine-learning/assistant/configure/mcp-servers/) — operators add the deployed Cloud Run URL on their own instance. Broad rollout, where every Cloud Assistant instance reaches `pathfinder-cli mcp` by default, requires coordination with the Assistant team on the write-tool surface (see [P0 spike Handoff](./phases/ai-authoring-0-assistant-spike.md#handoff-to-next-phase) — Pathfinder-specific publish tool vs. generic App Platform write tool vs. existing-pattern reuse) and on the default-MCP-list mechanism. Re-evaluate after P4 ships and per-instance integration is exercised in production.
- ~~Migrate Go MCP runtime tools to the TS package~~ — **done.** The five stateless tools (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`) were migrated under [MH4](./phases/mcp-hardening-4-go-mcp-migration.md) (2026-05-15). The remaining `launch_guide` tool, the per-instance pending-launch queue, and the frontend polling hook (`src/hooks/usePendingGuideLaunch.ts`) were then retired in full under [MH5](./phases/mcp-hardening-5-retire-go-mcp.md) (2026-05-15) — the per-instance back-channel was made unused once the architecture pivoted to a single centrally-hosted TS MCP on Cloud Run plus Grafana Assistant's web-surface tools for the handover (P4 status note, 2026-05-15). `pkg/plugin/mcp.go` no longer exists; the `/mcp` and `/mcp/pending-launch` routes return 404.
- `pathfinder-cli apply` batch command — collapse N mutations into one CLI invocation if it becomes useful for human authors. Originally motivated by amortizing Node cold-start across MCP tool calls, which no longer applies once the MCP imports the CLI directly. Re-evaluate against the human-authoring use case.
- CRD extension to round-trip manifest fields, lighting up recommendation-engine parity for custom guides for both block-editor and AI-authored guides simultaneously.
- **GCS-backed authoring sessions (deferred from P3).** The current stateless model passes the full `{content, manifest}` artifact in _and_ out of every mutation tool. Real multi-hop authoring runs on Cloud Run (2026-05-01) showed total wire bytes scaling roughly O(N²) in the number of hops — a 27-hop adversarial guide cost ~50× more agent-side tokens than a single-shot author of the same final artifact. Token cost is the visible problem; the deeper one is **agent confabulation** — when the artifact lives in the agent's context across hops, the agent occasionally edits it speculatively between mutations, producing extra validation roundtrips. Both are solved by storing the artifact server-side and removing it from the wire. This is **not** a package repository (see [Repository-ification deferred](#) below) — App Platform is the per-tenant package store; this bucket is ephemeral working storage for drafts.
  - **Trigger.** Re-open after P4 ships in production, when (a) per-instance Assistant traffic exceeds a few real authoring runs per day, or (b) agent-confabulation cost becomes legible in real session traces. Until then, the stateless design's simplicity and zero-state-liability outweigh the token win.

  - **Storage layout.** Each session is a package directory at `gs://pathfinder-cli-mcp/<SESSION_TOKEN>/`, mirroring the on-disk package layout exactly:

    ```
    gs://pathfinder-cli-mcp/<SESSION_TOKEN>/content.json
    gs://pathfinder-cli-mcp/<SESSION_TOKEN>/manifest.json
    ```

    `<SESSION_TOKEN>` is the bearer capability (high entropy, opaque). The guide `id` field inside `content.json` stays as P1's kebab-case-with-suffix value. These two identifiers serve different purposes — token = access key, guide id = human identity — and must not be conflated.

  - **Session token format.** 22 chars Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) ≈ 110 bits of entropy. Source: `crypto.randomBytes`, never `Math.random`. Lowercased server-side on input. Avoids tokenization-fragile alphabets (no `+/=` from base64; no lookalikes from `I/L/O/U`). Created server-side on first mutation; returned in the `sessionToken` field of every mutation response. LLM-visible — the agent passes it back verbatim on subsequent calls, distinct from the transport-layer `Mcp-Session-Id` HTTP header which the LLM never sees.

  - **Tool surface change — mutations return acks, not artifacts.** Load-bearing design decision. Each mutation tool (`create_package`, `add_block`, `add_step`, `add_choice`, `edit_block`, `remove_block`, `set_manifest`) implements read-modify-write against GCS: load `{content, manifest}` by `sessionToken`, invoke the imported CLI command function on the in-memory artifact, write the result back via `ifGenerationMatch`, and return a small confirmation:

    ```ts
    add_block({ sessionToken, block }) -> { sessionToken, generation, added: { kind, id } }
    ```

    The full artifact does not return to the agent's context. This is what removes both the token cost and the confabulation surface — the agent cannot drift on an artifact it does not have. **If the CLI command function errors (validation failure, schema violation), GCS is not updated** — the failed mutation leaves the session in its prior valid state and the agent receives the CLI's structured error verbatim, preserving the P3 "MCP performs no schema validation" contract. Reads become explicit, fine-grained, on-demand:
    - `pathfinder_get_manifest({ sessionToken })` — manifest only
    - `pathfinder_list_blocks({ sessionToken })` — block IDs and types, no content
    - `pathfinder_get_block({ sessionToken, blockId })` — one block
    - `pathfinder_inspect({ sessionToken })` — full artifact (escape hatch)
    - `pathfinder_validate({ sessionToken })` — structured errors only
    - `pathfinder_finalize_for_app_platform({ sessionToken })` — handoff payload, **the one place the full artifact returns to context**, because the agent's job there is to forward bytes to App Platform.

  - **`pathfinder_apply_ops` is not needed.** An earlier sketch proposed a batched-mutations tool to amortize per-call artifact cost. Once mutations are GCS-backed and return acks, per-call cost is already small and `apply_ops` collapses into "what mutations do" with no batching primitive needed. Skip it.

  - **First mutation creates the session implicitly.** `pathfinder_create_package` called without a `sessionToken` mints one and returns it. No separate `start_session` tool.

  - **Stateless `{artifact}` mode preserved as fallback.** Every mutation tool still accepts `{artifact}` instead of `{sessionToken}` for: GCS unreachable, token corrupted past recovery, non-Grafana clients that want stateless, OSS / airgapped deployments without a backing bucket. `pathfinder_authoring_start` biases guidance toward `sessionToken` mode but the artifact-mode code path is not removed.

  - **Concurrency.** GCS object generation numbers + `ifGenerationMatch` preconditions on every write. Mutation acks include `generation`; agents may pass `expectedGeneration` on the next call for optimistic concurrency. Two replicas racing on the same session resolve via 412 → refetch → retry. Storage is the coordination layer — no per-session lock, no cross-replica sticky routing, no Redis.

  - **Retention — 7-day TTL, debug-only.** GCS bucket lifecycle rule: object age > 7 days → delete. The MCP also issues an explicit `DELETE` on `pathfinder_finalize_for_app_platform` success, so happy-path drafts evict immediately. The 7-day window exists for one reason: debugging failed/abandoned authoring runs. Long-term retention is a governance problem we explicitly do not take on — App Platform is where retained content lives, under each tenant's existing governance.

  - **Confidentiality.** The token is the bearer capability:
    - **Bucket is private.** Uniform bucket-level access on, no public ACLs, IAM-only. Service account scoped to this one bucket.
    - **No GCS URLs cross the trust boundary.** Clients only ever see `<SESSION_TOKEN>`. All reads/writes flow through the MCP server, which holds the bucket credential.
    - **No enumeration tool.** The MCP exposes no "list sessions" surface. P6's `pathfinder_list_packages` reads the public CDN repository, not this bucket.
    - **Optional bind-to-`Mcp-Session-Id` on first write.** First mutation pins `<SESSION_TOKEN>` to the client's transport-layer `Mcp-Session-Id`. Subsequent mismatched calls return `404 not_found` (not `403`, to avoid confirming existence). Falls back gracefully when no `Mcp-Session-Id` is present (stdio transport).
    - **Don't log content. Ever.** Log `sessionToken` _prefix_ (12 chars) or hash, `generation`, `artifactBytes`, `gcsLatencyMs`. Cloud Run access logs are queryable by support; raw tokens in logs would re-introduce the leak surface we just closed.

  - **`pathfinder_authoring_start` rewrite.** Current guidance primes the agent on a stateless artifact-passing flow. The new guidance must teach: you receive a `sessionToken` on first mutation; pass it on every subsequent call; mutation responses are small confirmations, not the full artifact; use `inspect` / `get_manifest` / `get_block` / `list_blocks` to read state on demand; the artifact returns to your context only at finalize. This is the prompt-side fix that prevents defensive re-fetching after every mutation.

  - **Cost.** Trivial. Class A ops ~$0.005/1000, Class B ~$0.0004/1000, storage ~$0.02/GB/month. A 30-hop run is ~$0.0002 in operations. At 1000 sessions/day with 7-day retention, expected resident set is well under 5 GB. Budget $5–10/month and don't think about it again.

  - **Latency.** GCS in-region single-object GET/PUT is ~20–50ms p50, ~100–200ms p99. A 30-hop run pays ~1–3s of cumulative storage latency, dwarfed by LLM hop time. Writes are issued after the in-memory mutation succeeds; only the read on session entry blocks the response.

  - **What this does not solve.** The agent's _own_ conversation history still grows hop-over-hop with prior tool acks and read responses. GCS removes the artifact from the wire and from the agent's working memory of "what the guide looks like" — but it does not compact the conversation history itself. Compaction is the agent host's job, out of scope for this server.

  - **Repository-ification deferred.** `gs://pathfinder-cli-mcp/` is _not_ a package repository in the [PATHFINDER-PACKAGE-DESIGN.md](./PATHFINDER-PACKAGE-DESIGN.md) sense. It has no `repository.json`, no per-tenant attribution, no notion of authorship, no published artifacts. Promoting it would require (a) tenant identity at the MCP layer, which the open + edge-rate-limit posture explicitly does not provide, (b) `repository.json` generation, (c) a publish-vs-draft governance model, and (d) durable retention with a real data-handling posture. None of those are in scope; all are better solved by App Platform under each tenant's existing governance.

  - **Precondition: data-handling posture sign-off.** Even with anonymous bearer tokens and 7-day TTL, this design durably stores user-authored content on a service we operate. Users will paste customer-internal hostnames, real emails, or other sensitive strings into drafts. The mitigations (no logging of content, short TTL, deletion-on-finalize, private bucket, token-as-capability) are sufficient for ephemeral debug, but the _decision_ to retain at all needs an explicit yes from whoever owns the data-handling policy for the deployed Cloud Run service. This is a precondition for the phase, not a discovery during deploy review. If the answer is no, fall back to in-memory cache only (lose the debug archive) or to no caching (lose the token economy and confabulation fix).

The "long-lived Node sidecar" item from earlier drafts of this design is no longer applicable — the MCP server itself is a Node process, so there is no Go-Node bridge to optimize.

---

## P6 — CDN repository tools (TS MCP)

**Goal.** Expose a small set of read-only tools on the TS MCP server that operate against the public Pathfinder package repository on the CDN (default: `https://interactive-learning.grafana.net/packages/`). Lets MCP clients discover, inspect, and deep-link to published packages without any per-instance Grafana plugin involvement.

**Scope.**

- New CDN client `src/cli/mcp/lib/repository-client.ts` — Node `fetch` against `repository.json` and per-package `content.json` / `manifest.json`. 60-second in-process TTL on `repository.json` only; per-package fetches are uncached. Repository base URL is read from `PATHFINDER_REPOSITORY_URL` (env var) with the CDN URL above as the default. Slash-normalization mirrors `buildPackageFileUrl` in `src/lib/package-recommendations-client.ts`.
- New tool group `src/cli/mcp/tools/repository-tools.ts`, registered alongside the existing groups in `src/cli/mcp/tools/index.ts`. Stateless; no artifact in/out.
- Tools:
  - `pathfinder_list_packages` — list packages from `repository.json`. Optional filters: `type` (`guide`/`path`/`journey`), `category`, `q` (substring on title and description). Returns `{ baseUrl, packages: [...] }`.
  - `pathfinder_get_package` — fetch full `content.json` + `manifest.json` for one package by `id`. Returns the raw JSON plus a non-fatal `validation` field (Zod parse result via `ContentJsonSchema` and `ManifestJsonObjectSchema.loose()`); schema drift does not hard-fail the tool.
  - `pathfinder_get_manifest` — manifest-only fetch for one package by `id`. Cheaper variant for dependency / composition exploration.
  - `pathfinder_launch_package` — construct the existing `?doc=<cdn-content-url>` deep link the Pathfinder app already understands (see `src/utils/find-doc-page.ts` case 2 — `interactive-learning.grafana.net` URLs are already accepted via `isInteractiveLearningUrl`). Returns a relative `launchPath` (`/a/grafana-pathfinder-app?doc=...`) plus an absolute `launchUrl` when the caller passes `instanceUrl`. Optional `panelMode: "floating"` matches `finalize.ts`.
- Tests follow the pattern in `src/package-engine/online-cdn-resolver.test.ts` — mock `fetch` and exercise: filtered list, unknown id, malformed JSON (validation fallback), CDN 5xx, env var override, launch URL construction with and without `instanceUrl`, slash-normalization edges.
- Docker image passes `PATHFINDER_REPOSITORY_URL` through unchanged (env vars flow through; no Dockerfile changes needed).

**Out of scope.**

- **The Go MCP server (`pkg/plugin/mcp.go`) is explicitly out of scope.** These tools are added to the TypeScript MCP server only. The Go endpoint is not extended, and no equivalent of these tools is added there. The existing P5 migration item (moving `list_guides` / `get_guide` / `get_guide_schema` / `validate_guide_json` / `create_guide_template` from Go to TS) is independent of P6 and remains deferred.
- App-side changes — none needed; the `?doc=<interactive-learning.grafana.net URL>` deep-link pattern already works.
- Multi-repository discovery, registry-scoped IDs, or anything from the [`PATHFINDER-PACKAGE-DESIGN.md`](./PATHFINDER-PACKAGE-DESIGN.md) Phase 7 work — P6 reads one repository, configured by env var.
- Authentication on the CDN client — the repository is public.

**Dependencies.** P3 (TS MCP server must exist before adding tools to it).

**Exit criteria.**

- An MCP client can call `pathfinder_list_packages`, `pathfinder_get_package`, `pathfinder_get_manifest`, and `pathfinder_launch_package` against the default CDN with no configuration.
- Setting `PATHFINDER_REPOSITORY_URL` overrides the default, end-to-end (process env → tool → fetch URL).
- `pathfinder_launch_package` returns a `launchPath` that, when appended to a Grafana instance origin, opens the targeted CDN guide in Pathfinder.
- Schema drift in a CDN-hosted manifest does not hard-fail `pathfinder_get_package` or `pathfinder_get_manifest` — raw JSON is still returned alongside the validation issues.
- `pkg/plugin/mcp.go` is unchanged.

## Cross-cutting concerns

- **Schema is owned by the CLI, end to end.** Every phase preserves boundary decision 1: the MCP performs no schema validation of its own. With the MCP and CLI sharing one TypeScript runtime and one Zod schema instance, this is structurally enforced — not just a code-review check.
- **One canonical ID.** P1 tightens the regex; P3's finalize tool and P4's Assistant handoff must use the same string verbatim — no transformation. Cross-checked at exit of P4.
- **Stateless artifact model.** P3 must not introduce server-side session state. If a future need emerges, the trigger is documented in [`AUTHORING-SESSION-ARTIFACTS.md` — Open questions](./AUTHORING-SESSION-ARTIFACTS.md#open-questions). A concrete deferred-work entry exists in [P5 — Deferred follow-ups](#p5--deferred-follow-ups) with sizing data from the 2026-05-01 Cloud Run telemetry run.
- **CLI and MCP ship in lockstep as one npm package.** Schema version is pinned to `CURRENT_SCHEMA_VERSION` via the P2 prepublish script, so the CLI and MCP entrypoints cannot publish at different versions. Plugin and MCP package releases are coordinated through CI but published independently — the plugin no longer carries the CLI binary, so plugin and CLI release cadences are decoupled.
- **Server-provided context, not client-cached instructions.** P3 onward, agents must call `pathfinder_authoring_start` and follow server-provided guidance rather than carrying authoring instructions locally. Skill files for Cursor/Claude Desktop should remain thin.
- **Assistant write-tool surface is a P4 coordination point** (from [P0 spike](./phases/ai-authoring-0-assistant-spike.md)). Assistant exposes no generic "call this App Platform path" tool today. P4 must pick a write-tool surface and coordinate with the Assistant team.
- **Assistant connection target is a P4 coordination point.** Since the authoring MCP no longer lives at the per-instance plugin URL, P4 must coordinate with the Assistant team on where the centrally hosted TS MCP runs and how Assistant's tool list points at it.

## Open questions

### Does the hosted HTTP MCP need auth at all?

**Status.** Resolved 2026-04-30 — **Option 1: Open + edge rate-limiting for the MVP.** Auth is deferred. Re-evaluate if usage patterns or abuse warrant it; the decision is reversible since adding a token verifier later does not change the tool surface.

**Why.** The MCP holds no privileged resource — Assistant performs the App Platform write with its own credentials in P4, and the tools wrap the open-source CLI anyone can `npx` locally. Shipping open preserves the OSS / airgapped story and removes a coordination dependency on the Assistant token surface. The dominant threat is cost (DoS), addressable with edge rate limits, request size caps, CPU/wallclock budgets, and autoscaling ceilings — none of which require an identity provider.

**What this means for P3.** The HTTP transport ships without `MultiAuth` / `GrafanaGoogleTokenVerifier`. P3 plan should call out the rate-limit / size-cap / budget posture as the abuse-mitigation surface. The original auth context below is preserved for posterity and for any future re-evaluation.

---

**Original context (preserved for posterity):**

**Context.** P3 scope currently specifies `MultiAuth + GrafanaGoogleTokenVerifier` on the HTTP transport, inherited from an earlier design where the MCP itself was going to write to App Platform. Under the current design that write is performed by the controlling agent (Grafana Assistant in P4), using _its_ credentials — the MCP itself touches no privileged resource. The tools are a stateless RPC wrapper around the same open-source CLI anyone can `npx` locally. So the original reason for auth (the MCP holding write capability) no longer applies.

**Arguments for leaving it fully open.**

- No privileged resource behind the endpoint — pure CPU on a JSON artifact.
- OSS / airgapped Grafana users get a hosted authoring path without needing a Grafana Cloud account. This is a meaningful product story: "Pathfinder authoring works for everyone, not just Cloud customers."
- One less coordination dependency on the Assistant token surface.
- Local stdio (`npx pathfinder-cli mcp`) already covers the no-account case, but a hosted open endpoint removes the install step.

**Arguments for requiring auth.**

- Abuse attribution and per-subject rate limiting become trivial.
- A signed-in identity gives a natural cost-control knob if usage explodes.
- Reduces public attack surface (though the surface is small — see "what an abuser gets" below).

**What an abuser actually gets if it's open.** Free Zod validation as a service. Not valuable enough to attract targeted abuse, but trivially easy to point a botnet at for resource exhaustion. The realistic threat is _cost_, not _compromise_.

**Mitigations that don't require auth.** Per-IP rate limits at the edge, request size caps, CPU/wallclock budget per call, autoscaling ceiling. These are cheap and address the dominant threat (DoS / runaway cost) without excluding airgapped or non-Cloud users.

**Resolution criteria.** Pick one of:

1. **Open + edge rate-limiting.** Preserves the OSS / airgapped story. Accept DoS-via-cost as a managed risk with hard autoscaling caps.
2. **Auth required, broad audience.** Accept any signed-in Grafana Cloud user (not just Assistant). Loses the airgapped story; gains attribution.
3. **Both.** Anonymous tier with strict rate limits + authenticated tier with higher limits. More surface, more ops.

_Resolved — see status note at the top of this section._
