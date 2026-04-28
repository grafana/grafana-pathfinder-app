# Pathfinder AI authoring — implementation plan

> Implementation plan for [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Per-phase detailed plans live under [`docs/design/phases/`](./phases/) and are drafted when a phase becomes active.

This document is the living index for the AI authoring implementation. It defines the phase boundaries, exit criteria, and dependency order so that work can be parceled out, tracked, and progressively shipped without keeping the entire design in working memory.

The canonical design lives in the six design docs linked from [`PATHFINDER-AI-AUTHORING.md`](./PATHFINDER-AI-AUTHORING.md). This document does not redefine the design — it phases it.

## Status

| Phase | Title                                  | Status      | Detailed plan                                                                   | Tracking         |
| ----- | -------------------------------------- | ----------- | ------------------------------------------------------------------------------- | ---------------- |
| P0    | Assistant handoff spike                | Complete    | [ai-authoring-0-assistant-spike.md](./phases/ai-authoring-0-assistant-spike.md) | _epic issue TBD_ |
| P1    | CLI authoring foundation               | Not started | _to be drafted at start_                                                        | _epic issue TBD_ |
| P2    | CLI distribution                       | Not started | _to be drafted at start_                                                        | _epic issue TBD_ |
| P3    | Authoring tools on existing plugin MCP | Not started | _to be drafted at start_                                                        | _epic issue TBD_ |
| P4    | Assistant handoff and viewer link      | Not started | _to be drafted at start_                                                        | _epic issue TBD_ |
| P5    | Existing-tool migration and batch ops  | Deferred    | —                                                                               | —                |

Each row's "Detailed plan" cell is filled in when an agent runs the per-phase planning step and writes `docs/design/phases/ai-authoring-N-<slug>.md`.

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
P1 (CLI) --> P2 (distribution) --+--> P3 (MCP) --> P4 (Assistant + link)
                                  |
                                  +--> P5 (deferred follow-ups)
```

P0 is non-blocking until P4. P1 is the critical path for everything downstream. P2 must land before P3 because the MCP shell-out depends on the bundled binary being on disk inside the plugin tarball.

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

## P2 — CLI distribution

**Goal.** Both distribution channels for `pathfinder-cli` exist and the bundled binary ships inside the plugin tarball.

**Scope.** Sub-phase 7 of [`AGENT-AUTHORING.md` — Implementation plan](./AGENT-AUTHORING.md#implementation-plan):

- Docker image build and registry push wired into the existing release flow.
- Single-file Node binary build for `linux/amd64`, `linux/arm64`, `darwin` (Single Executable Applications or `pkg`).
- GitHub Actions: workflow artifacts on every merge to `main`; durable Release assets on tagged releases.
- Per-platform `mage build:*` targets copy the matching binary into `<plugin-dir>/cli/pathfinder-cli`.
- Smoke test after tarball assembly: `<plugin-dir>/cli/pathfinder-cli --version` returns `CURRENT_SCHEMA_VERSION`.

**Out of scope.** MCP shell-out integration (P3). npm publishing (deferred). Windows binary (deferred — Docker covers it).

**Dependencies.** P1.

**Exit criteria.**

- A locally built plugin tarball contains a working CLI binary at the bundled path on each supported platform.
- Tagged release attaches all three binaries.
- Docker image for the matching version is pushed.

---

## P3 — Authoring tools on the existing plugin MCP

**Goal.** Any MCP-capable client connected to the Pathfinder plugin's MCP endpoint can author a guide end-to-end via tool calls and receive a finalization payload.

**Scope.**

- Add authoring tools to `pkg/plugin/mcp.go` at the existing endpoint `/api/plugins/grafana-pathfinder-app/resources/mcp`. No separate service.
- Stateless artifact model — every mutation tool takes the artifact in and returns the artifact out. No `sessionId`, no server-side cache.
- Shell-out pattern: serialize artifact to a temp dir, invoke the bundled CLI binary via `exec.Command`, read the structured response, clean up.
- Tools (per [`HOSTED-AUTHORING-MCP.md` — Core tools](./HOSTED-AUTHORING-MCP.md#core-tools)):
  - `pathfinder_authoring_start` — first tool, returns context + workflow + tutorial + discovery hints.
  - `pathfinder_help` — pass-through for `pathfinder-cli <cmd> [<sub>] --help --format json`.
  - `pathfinder_create_package`, `pathfinder_add_block`, `pathfinder_add_step`, `pathfinder_add_choice`, `pathfinder_edit_block`, `pathfinder_remove_block`, `pathfinder_set_manifest`.
  - `pathfinder_inspect`, `pathfinder_validate`.
  - `pathfinder_finalize_for_app_platform` — returns the handoff structure defined in [`APP-PLATFORM-PUBLISH-HANDOFF.md`](./APP-PLATFORM-PUBLISH-HANDOFF.md), including the `localExport` fallback.
- `pathfinder_add_block` is intentionally permissive — the discriminator and arbitrary fields are forwarded; the CLI is the sole validator.
- Failure-mode coverage: missing/broken bundled binary, validation failure, finalization failure, schema mismatch.
- Documentation pass for the new tools (developer docs + agent context update in `AGENTS.md`).

**Out of scope.** Direct App Platform writes from the plugin (those are P4). Migrating existing tools (`validate_guide_json`, `create_guide_template`) — that's P5. Long-lived Node sidecar — explicitly deferred.

**Dependencies.** P1, P2.

**Exit criteria.**

- A non-Grafana-aware MCP client (Cursor, Claude Desktop) can connect, call `pathfinder_authoring_start`, build a multi-block guide via tool calls, validate, and call `pathfinder_finalize_for_app_platform` to receive a handoff containing both `appPlatform` instructions and a `localExport` fallback.
- Following `localExport`, the client can write `content.json` and `manifest.json` to the user's workspace and the resulting package round-trips through `pathfinder-cli validate`.
- The Go MCP performs no schema validation of its own — confirmed by code review and by an integration test that introduces a CLI-detectable schema violation and asserts the Go layer surfaces the CLI's structured error verbatim.

---

## P4 — Assistant handoff and viewer deep link

**Goal.** Grafana Assistant on Cloud can take a finalization payload, perform the App Platform write, and return a working floating-mode viewer link. Assistant on OSS falls through cleanly to `localExport`.

**Scope.**

- Teach Grafana Assistant to consume the handoff structure and execute the POST/PUT against `interactiveguides` using its existing namespace-resolution and authenticated-write capabilities.
- Implement the create-vs-update branching from [`APP-PLATFORM-PUBLISH-HANDOFF.md` — Create and update behavior](./APP-PLATFORM-PUBLISH-HANDOFF.md#create-and-update-behavior): POST for the auto-ID common path, GET-then-PUT only when an explicit `--id` was supplied at create time.
- Draft/published confirmation prompt — default to draft.
- Viewer deep link: return `floatingPath` on App Platform success; suppress on `localExport`.
- OSS fallback: detect absent App Platform and follow `localExport` without offering a link.
- Verify the existing `doc=api:<id>` resolution path (`module.tsx` → `findDocPage` → `fetchContent`) works for AI-authored resources unchanged.

**Out of scope.** Recommendation-engine parity for custom guides (downstream of CRD work, not this design). CRD extension to round-trip manifest fields.

**Dependencies.** P0 (resolved 2026-04-28 — green-light, see [spike report](./phases/ai-authoring-0-assistant-spike.md)), P3.

**Wiring items inherited from P0 (must be addressed in P4 planning):**

- **Pick the Assistant write-tool surface.** Assistant has no generic "call this App Platform path with this JSON body and method" tool. P4 must coordinate with the Assistant team and choose among: a Pathfinder-specific publish tool exposed by Assistant; a small generic App Platform write tool in Assistant; or documented reuse of an existing pattern. This is the first concrete decision in P4's plan.
- **Path is component-shaped, not template-shaped, on the Assistant side.** Assistant builds App Platform paths from `(group, version, namespace, resource, name)`. The handoff already exposes those component fields; P4 should not assume `itemPathTemplate`/`collectionPathTemplate` are consumed verbatim by Assistant. They remain useful for non-Assistant clients.
- **Confirmation UX is in the loop.** Assistant's per-tool confirmation layer means a publish action will surface a user-visible prompt. Design the handoff so that prompt reads sensibly and the boundary-decision-4 "AI client owns user agency" flow lands on this confirmation rather than an extra one in front of it.

**Exit criteria.**

- End-to-end: user asks Assistant on Cloud to create a guide → Assistant authors via MCP → asks for save/publish → POSTs to App Platform → returns floating viewer link → user clicks link → guide opens in Pathfinder.
- End-to-end on OSS: same flow up to publish, then `localExport` triggers, files written, no viewer link offered.
- Cross-doc consistency check: `id`, `metadata.name`, `?doc=api:<id>` are the same string at every boundary.

---

## P5 — Deferred follow-ups

Tracked here so they don't get lost; not scoped for the MVP.

- Migrate existing plugin MCP tools (`validate_guide_json`, `create_guide_template`) to the CLI shell-out pattern to retire the hand-maintained Go schema summaries in `pkg/plugin/mcp.go` (`guideSchemas`).
- `pathfinder-cli apply` batch command — collapse N mutations into one CLI invocation if cold-start cost becomes a measured bottleneck.
- Long-lived Node sidecar (one process per plugin, JSON-RPC over stdio) — only if measurement justifies it.
- npm publishing of the CLI as a standalone package, with version pinned to `CURRENT_SCHEMA_VERSION` via a prepublish script.
- CRD extension to round-trip manifest fields, lighting up recommendation-engine parity for custom guides for both block-editor and AI-authored guides simultaneously.

## Cross-cutting concerns

- **Schema is owned by the CLI, end to end.** Every phase preserves boundary decision 1: the Go MCP performs no schema validation. P3's review must enforce this.
- **One canonical ID.** P1 tightens the regex; P3's finalize tool and P4's Assistant handoff must use the same string verbatim — no transformation. Cross-checked at exit of P4.
- **Stateless artifact model.** P3 must not introduce server-side session state. If a future need emerges, the trigger is documented in [`AUTHORING-SESSION-ARTIFACTS.md` — Open questions](./AUTHORING-SESSION-ARTIFACTS.md#open-questions).
- **Plugin-release cadence is the update unit.** P3 onward, agents must call `pathfinder_authoring_start` and follow server-provided guidance rather than carrying authoring instructions locally. Skill files for Cursor/Claude Desktop should remain thin.
- **Assistant write-tool surface is a P4 coordination point** (from [P0 spike](./phases/ai-authoring-0-assistant-spike.md)). Assistant exposes no generic "call this App Platform path" tool today. P4 must pick a write-tool surface (Pathfinder-specific publish tool, generic App Platform write tool in Assistant, or documented reuse of an existing pattern) and coordinate with the Assistant team. Capability is verified-supported; only the wiring is open.
