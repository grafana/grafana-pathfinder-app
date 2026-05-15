# MCP hardening, slice 5 — retire the Go MCP entirely

> Follow-up to [MH4 — migrate Go MCP runtime tools to TypeScript](./mcp-hardening-4-go-mcp-migration.md).
> Branch: `feat/mcp-progress`.
> Tracking issue: _to be filed_.

**Status:** Not started
**Started:** _YYYY-MM-DD_
**Completed:** _YYYY-MM-DD_

---

## Keep this plan in sync as you work

Same rules as MH4 — this file is load-bearing for resumability:

1. **Tick the checkbox the moment a task lands.** Don't batch. `- [ ]` → `- [x]` in the same commit (or the next one). Bullets without checkboxes are sub-points, not work items.
2. **Append commit SHAs** to completed tasks in the form `✓ _Complete (YYYY-MM-DD, <sha>)._` — makes the plan a per-task audit trail.
3. **Update the `Status:` header** when transitioning between phases (`In progress` through all of A → C; flip to `Complete` only when MH5 fully exits).
4. **Append to Decision log** for any non-trivial choice not pre-encoded here. Record deviations in **Deviations**, never by silently editing a Task.
5. **At exit, fill `Handoff to next phase`** with 5–10 bullets covering what's true now that wasn't, gotchas, and any design-doc drift you noticed.

---

## Goal

`pkg/plugin/mcp.go` post-MH4 hosts exactly one tool (`launch_guide`) and a per-instance pending-launch queue consumed by `src/hooks/usePendingGuideLaunch.ts`. MH4's plan said both stayed "indefinitely" because the queue was the only back-channel a per-tenant MCP had to its in-page UI.

That framing is obsolete. The architecture pivoted to a single centrally-hosted TS MCP on Cloud Run, and Grafana Assistant's handover (closing the D1 executor gap in P4) lands via two **web-surface tools** in the Assistant repo — `pathfinder_manage_guide_drafts` and `pathfinder_publish_guide` — that call Assistant's session-authenticated `getBackendSrv()` against the App Platform aggregator. See [AI-AUTHORING-IMPLEMENTATION.md, P4 status note (2026-05-15)](../AI-AUTHORING-IMPLEMENTATION.md#p4--assistant-handoff-and-viewer-deep-link). "No MCP server change required" — the per-instance Go MCP is not on the new handover path. The "open the published guide" leg is now served by `pathfinder_finalize_for_app_platform`'s viewer deep link (P4), not by the pending-launch queue.

So `launch_guide` and the queue are pure artifacts of the abandoned per-tenant MCP model. They are unused in production, and the architectural direction no longer calls for them.

End state of MH5:

- `pkg/plugin/mcp.go`, `pkg/plugin/mcp_test.go`, and `pkg/plugin/static.go` are deleted.
- The `static/guides/*.json` embed (consumed only by the `launch_guide` existence check) is gone.
- The `/mcp`, `/mcp/pending-launch`, and `/mcp/pending-launch/clear` routes in `pkg/plugin/resources.go` are unregistered. The plugin returns Grafana's default 404 for any of those paths — fine; nothing couples to them.
- `src/hooks/usePendingGuideLaunch.ts` and its three mount sites (`ContextPanel`, `FullScreenPanel`, `FloatingPanelManager`) are gone, along with the hook's test and the Jest mock entries in two `docs-panel` test files.
- `scripts/copy-static.js` is deleted; the `copy-static` npm script and its callers in `build:backend*` are gone.
- The "Go MCP endpoint" section in `docs/developer/MCP_SERVER.md` collapses to a one-liner saying the Go MCP no longer exists. AGENTS.md's `pkg/plugin/mcp.go` and `static.go` rows go away. `docs/design/HOSTED-AUTHORING-MCP.md` and `AI-AUTHORING-IMPLEMENTATION.md` lose the "stays in Go indefinitely" prose.

**Out of scope:**

- Returning a structured 410 Gone on the retired `/mcp*` paths. Decision (see [Decision log](#decision-log)): 404 is fine; no current consumers.
- Touching any other resource handler in `resources.go` (sample-apps, vms, package-recommendations, health, coda registration, etc.).
- The Coda VM / stream / terminal subsystems. Untouched.
- Any change to the central TS MCP on Cloud Run — that's the architecturally correct surface and continues unchanged.

---

## Preconditions

**Prior-phase exit criteria to re-verify:**

- [ ] MH4 Complete on `feat/mcp-progress` (last commit `8697495d` or later).
- [ ] `pkg/plugin/mcp.go` exposes only `launch_guide` via `tools/list` (asserted by `TestToolsList`; was confirmed live in MH4 phase D).
- [ ] Assistant handover PR (#6457 in the assistant repo) is the canonical handover surface — re-confirm by reading the AI-AUTHORING-IMPLEMENTATION.md P4 status note immediately before starting MH5.

**Surface area this phase touches:**

| File                                                             | Change                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/usePendingGuideLaunch.ts`                             | **Phase A** — delete.                                                                                                                                                                                                       |
| `src/hooks/usePendingGuideLaunch.test.ts`                        | **Phase A** — delete.                                                                                                                                                                                                       |
| `src/hooks/index.ts`                                             | **Phase A** — drop the `usePendingGuideLaunch` re-export.                                                                                                                                                                   |
| `src/components/App/ContextPanel.tsx`                            | **Phase A** — drop the `usePendingGuideLaunch` import + call site.                                                                                                                                                          |
| `src/components/full-screen/FullScreenPanel.tsx`                 | **Phase A** — drop the import + call site + the surrounding "polls the Pathfinder backend for MCP launch_guide handoffs" comment block.                                                                                     |
| `src/components/floating-panel/FloatingPanelManager.tsx`         | **Phase A** — drop the import + call site.                                                                                                                                                                                  |
| `src/components/docs-panel/docs-panel.tab-restore-guard.test.ts` | **Phase A** — drop the `usePendingGuideLaunch: jest.fn()` mock entry.                                                                                                                                                       |
| `src/components/docs-panel/docs-panel.alignment.test.ts`         | **Phase A** — drop the `usePendingGuideLaunch: jest.fn()` mock entry.                                                                                                                                                       |
| `src/global-state/sidebar.ts`                                    | **Phase A** — drop the "Used by the MCP launch_guide tool via the frontend polling hook" comment; the helper itself stays (it's the open-tab plumbing, not launch_guide-bound).                                             |
| `pkg/plugin/mcp.go`                                              | **Phase B** — delete entire file.                                                                                                                                                                                           |
| `pkg/plugin/mcp_test.go`                                         | **Phase B** — delete entire file.                                                                                                                                                                                           |
| `pkg/plugin/static.go`                                           | **Phase B** — delete entire file (`guidesFS` was the last consumer-side embed, used only by `launch_guide`'s existence check).                                                                                              |
| `pkg/plugin/static/guides/*.json`                                | **Phase B** — delete the on-disk copy. The source of truth (`src/bundled-interactives/<id>/content.json`) is unaffected.                                                                                                    |
| `pkg/plugin/resources.go`                                        | **Phase B** — unregister `/mcp`, `/mcp/pending-launch`, `/mcp/pending-launch/clear`. Routes return Grafana's default 404 afterward.                                                                                         |
| `scripts/copy-static.js`                                         | **Phase B** — delete the script.                                                                                                                                                                                            |
| `package.json`                                                   | **Phase B** — drop the `copy-static` npm script; drop the `npm run copy-static &&` prefix from `build:backend`, `build:backend:linux-arm64`, `build:backend:darwin`, `build:backend:darwin-arm64`, `build:backend:windows`. |
| `AGENTS.md`                                                      | **Phase C** — drop the `pkg/plugin/mcp.go` and `pkg/plugin/static.go` rows from the backend file tree; drop the `/mcp` and `/mcp/pending-launch` bullet from the backend request-paths section.                             |
| `CLAUDE.md`                                                      | **Phase C** — inherits via `@AGENTS.md`; verify no separate mirror.                                                                                                                                                         |
| `docs/developer/MCP_SERVER.md`                                   | **Phase C** — collapse the "Go MCP endpoint" section to a one-line note that the Go MCP was retired in MH5.                                                                                                                 |
| `docs/design/HOSTED-AUTHORING-MCP.md`                            | **Phase C** — strip the "stays in Go indefinitely" prose around `launch_guide` and the pending-launch queue; replace with a back-pointer to MH5.                                                                            |
| `docs/design/AI-AUTHORING-IMPLEMENTATION.md`                     | **Phase C** — rewrite the P5 line-252 prose so `launch_guide` is no longer flagged as indefinite-stay; add MH5 row to the hardening track table; flip its Status to Complete on exit.                                       |
| `docs/design/phases/mcp-hardening-4-go-mcp-migration.md`         | **Phase C** — append a one-line note under "Handoff to next phase" that MH5 supersedes the "indefinite" framing in MH4.                                                                                                     |

**Public APIs that change:**

- `POST /api/plugins/grafana-pathfinder-app/resources/mcp` — was JSON-RPC over HTTP serving `launch_guide`; now 404. No documented consumer.
- `GET|POST /api/plugins/grafana-pathfinder-app/resources/mcp/pending-launch*` — was the per-instance launch queue read by the frontend polling hook; now 404. Polling hook is gone.

Both endpoints were undocumented and labeled "non-production" through most of their life. Blast radius expected to be zero.

**Open questions resolved up-front:**

- **OQ1.** 410 Gone vs 404 on retired `/mcp*` paths? **Decision (user, 2026-05-15):** 404. No coupling exists today; the cost of carrying a 410 stub is unjustified.
- **OQ2.** Keep `guidesFS` / `static/guides/*.json` for any other Go consumer? **Decision:** no — grep confirms `launch_guide` was the only reader of either.
- **OQ3.** Phase ordering. Frontend first, then backend, then docs. Frontend-first is the safe order: after Phase A the polling hook is gone but the backend route still serves harmlessly; Phase B then yanks the backend with no live caller. **Decision:** A → B → C.

---

## Tasks

Atomic-commit-sized. Reference slice ID in commit messages (`MH5: ...`).

### Phase A — Frontend retirement (Not started)

After this phase: the frontend no longer polls. The Go `/mcp/pending-launch` route is still alive but has no caller in this repo.

- [ ] **A1. Delete `src/hooks/usePendingGuideLaunch.ts`** and its test `src/hooks/usePendingGuideLaunch.test.ts`.
- [ ] **A2. Update `src/hooks/index.ts`** — drop the `usePendingGuideLaunch` re-export. Confirm `src/hooks/` still has at least one other export (or delete the barrel if empty).
- [ ] **A3. Drop call sites:**
  - `src/components/App/ContextPanel.tsx` — import + `usePendingGuideLaunch()` line.
  - `src/components/full-screen/FullScreenPanel.tsx` — import + `usePendingGuideLaunch()` line + the surrounding "Polls the Pathfinder backend for MCP launch_guide handoffs" comment block.
  - `src/components/floating-panel/FloatingPanelManager.tsx` — import + `usePendingGuideLaunch()` line.
- [ ] **A4. Drop Jest mock entries** in `src/components/docs-panel/docs-panel.tab-restore-guard.test.ts` and `src/components/docs-panel/docs-panel.alignment.test.ts` (`usePendingGuideLaunch: jest.fn()`). Confirm the surrounding mock block still type-checks without it.
- [ ] **A5. Clean up the stale comment** in `src/global-state/sidebar.ts` ("Used by the MCP launch_guide tool via the frontend polling hook"). The helper itself stays — it's used by other tab-open paths.
- [ ] **A6. Run `npm run typecheck` + `npm run test:ci`** — both clean. Existing snapshots may need an update if any of the three components rendered the hook as a visible effect (unlikely; the hook does no rendering).

**Phase A exit:** `npm run typecheck` + `npm run test:ci` green. Grep for `usePendingGuideLaunch` in `src/` returns zero hits. Grep for `pending-launch` in `src/` returns zero hits.

### Phase B — Backend retirement (Not started)

The destructive Go cut. After this phase: the plugin binary has no MCP code at all.

- [ ] **B1. Delete `pkg/plugin/mcp.go`** (all 338 lines).
- [ ] **B2. Delete `pkg/plugin/mcp_test.go`** (all tests).
- [ ] **B3. Delete `pkg/plugin/static.go`** — `guidesFS` was the last embed; nothing else uses it.
- [ ] **B4. Delete `pkg/plugin/static/guides/*.json`** and the empty `static/` directory.
- [ ] **B5. Unregister routes in `pkg/plugin/resources.go`** — drop the three `mux.HandleFunc` calls (lines 20–22):
  - `mux.HandleFunc("/mcp", a.handleMCP)`
  - `mux.HandleFunc("/mcp/pending-launch", a.handlePendingLaunch)`
  - `mux.HandleFunc("/mcp/pending-launch/clear", a.handlePendingLaunch)`
- [ ] **B6. Delete `scripts/copy-static.js`** and the directory if it's now empty (likely still has other scripts).
- [ ] **B7. Update `package.json`:**
  - Delete the `"copy-static": "node scripts/copy-static.js"` script.
  - Drop the `npm run copy-static && ` prefix from every `build:backend*` variant (linux, linux-arm64, darwin, darwin-arm64, windows). `build:all` does not invoke `copy-static` directly — verify.
- [ ] **B8. Run `mage test`, `mage build:linux`, `mage build:linuxARM64`** (or `npm run build:backend` + `npm run build:backend:linux-arm64`) — both green. `pkg/plugin/` should have no remaining references to launch_guide, pending-launch, guideSchemas, repositoryJSON, or guidesFS.
- [ ] **B9. Smoke 404 locally.** `npm run server`, rebuild the linux_arm64 binary if running on Apple Silicon (gotcha from MH4 phase D), then:
  - `curl -i -b cookies http://localhost:3000/api/plugins/grafana-pathfinder-app/resources/mcp` → 404
  - `curl -i -b cookies http://localhost:3000/api/plugins/grafana-pathfinder-app/resources/mcp/pending-launch` → 404

**Phase B exit:** Both routes return 404. `mage test` and `mage build:*` green. `grep -rn "launch_guide\|pending-launch\|guidesFS\|guideSchemas\|repositoryJSON\|copy-static" pkg/ scripts/ src/` returns zero hits.

### Phase C — Docs sweep (Not started)

- [ ] **C1. Update `AGENTS.md`** — remove `pkg/plugin/mcp.go` and `pkg/plugin/static.go` rows from the backend file tree; remove the `POST /mcp` + `GET|POST /mcp/pending-launch` bullet from the backend request-paths section.
- [ ] **C2. Update `docs/developer/MCP_SERVER.md`** — collapse the "Go MCP endpoint" section to a single line stating the Go MCP was retired in MH5; link this phase doc.
- [ ] **C3. Update `docs/design/HOSTED-AUTHORING-MCP.md`** — strip the paragraphs around lines 201/203/223 that frame `launch_guide` and the pending-launch queue as "indefinite-stay" / "genuine reason to remain in-process"; replace with a back-pointer to MH5.
- [ ] **C4. Update `docs/design/AI-AUTHORING-IMPLEMENTATION.md`:**
  - Add MH5 row to the hardening track table; flip its Status to `Complete (YYYY-MM-DD)` on exit.
  - Rewrite the P5 line-252 prose so `launch_guide` is no longer flagged as indefinite-stay — the bullet is now historical; either delete it or fold it into the MH4/MH5 history block.
- [ ] **C5. Append to `docs/design/phases/mcp-hardening-4-go-mcp-migration.md` Handoff** — one line that MH5 supersedes the "indefinite" framing in MH4.
- [ ] **C6. Confirm `CLAUDE.md` requires no separate edit** (it inherits via `@AGENTS.md`).
- [ ] **C7. Run `npm run check`** — typecheck + lint + prettier + docs:sync + lint:go + test:go + test:ci all clean.

**Phase C exit:** All five rule docs aligned. `npm run check` green. No file in the repo still says the Go MCP is "non-production", "indefinite", "stays", or "experimental spike" with respect to `launch_guide` / pending-launch.

### Test plan

- Phase A: existing Jest suite covers the panels; we delete the hook's own test and verify no other test depends on it.
- Phase B: existing `mage test` covers the survivor surface; deleted-tool tests are removed in the same commit as the handlers.
- Phase C: `npm run check` is the gate.
- Manual smoke: curl 404 on `/mcp` and `/mcp/pending-launch` after Phase B (covered in B9).

### Verification (effective exit conditions)

- [ ] `pkg/plugin/mcp.go`, `pkg/plugin/mcp_test.go`, `pkg/plugin/static.go`, `pkg/plugin/static/guides/`, `scripts/copy-static.js`, `src/hooks/usePendingGuideLaunch.ts`, `src/hooks/usePendingGuideLaunch.test.ts` all deleted.
- [ ] `/mcp` and `/mcp/pending-launch*` return 404.
- [ ] `npm run check` clean.
- [ ] Grep across the repo for `launch_guide`, `pending-launch`, `guidesFS`, `guideSchemas`, `repositoryJSON`, `copy-static` returns only entries inside historical phase plans (MH4) and design-history breadcrumbs — nothing live.

---

## Decision log

### 2026-05-15 — Retire the Go MCP entirely, including launch_guide

- **Decision.** Drop `pkg/plugin/mcp.go` and the pending-launch queue along with it. MH4 had left `launch_guide` in place "indefinitely"; MH5 reverses that on the strength of architectural reframing, not a pure cleanup motive.
- **Rationale.** The per-tenant MCP architecture that justified `launch_guide` (a tool callable by an in-Grafana agent to open a guide in the local sidebar, via per-instance polling) was superseded by (a) the central Cloud Run TS MCP, and (b) Grafana Assistant's web-surface tools — `pathfinder_manage_guide_drafts` and `pathfinder_publish_guide` — which sit in the Assistant repo (PR #6457) and route through Assistant's own session-authenticated frontend, not through any MCP back-channel. The "open the published guide" step now uses the viewer deep link returned by `pathfinder_finalize_for_app_platform` (P4). `launch_guide` is not on the new handover path and has no other documented caller.
- **Alternatives considered.**
  - _Keep `launch_guide` as defense-in-depth._ Loses about 50% of the deletable surface and keeps a route that nothing reads. Rejected.
  - _Move the queue to a non-MCP REST endpoint and keep just the in-page write path._ Same architectural drift — would still bind Pathfinder to a per-instance back-channel that the new design doesn't use. Rejected.

### 2026-05-15 — 404 instead of 410 Gone on retired routes

- **Decision.** Let the retired `/mcp` and `/mcp/pending-launch*` paths fall through to Grafana's default 404. No structured 410 Gone stub.
- **Rationale.** No coupling exists today; the cost of carrying and testing a 410 stub is unjustified. If a stray caller surfaces post-merge, a one-line route handler is a cheap follow-up.

---

## Deviations

_Appended during execution. Currently empty._

---

## Handoff to next phase

_Filled at exit. Required: 5–10 bullets covering what's now true that wasn't, gotchas, deferred punts, design docs that drifted._
