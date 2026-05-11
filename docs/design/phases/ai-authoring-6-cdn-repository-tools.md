# P6 — CDN repository tools (TS MCP)

> Implementation plan for phase 6 of [Pathfinder AI authoring](../PATHFINDER-AI-AUTHORING.md).
> Phase entry and exit criteria: [AI authoring implementation index — P6](../AI-AUTHORING-IMPLEMENTATION.md#p6--cdn-repository-tools-ts-mcp).
> Tracking issue: _epic issue TBD_.

**Status:** Complete
**Started:** 2026-05-08
**Completed:** 2026-05-08

---

## Preconditions

**Prior-phase exit criteria re-verified before starting:**

- [x] P3 TS MCP server present and registered tool groups discoverable (`src/cli/mcp/tools/index.ts`).
- [x] `npm run check` clean on `main`.

**Surface area this phase touches:**

- New: `src/cli/mcp/lib/repository-client.ts`, `src/cli/mcp/lib/__tests__/repository-client.test.ts`, `src/cli/mcp/tools/repository-tools.ts`, `src/cli/mcp/__tests__/repository-tools.test.ts`.
- Modified: `src/cli/mcp/tools/index.ts` (add `registerRepositoryTools` call), `src/cli/mcp/__tests__/server.test.ts` (extend tool-list assertion), `docs/developer/MCP_SERVER.md` (add Repository tools section).
- External contracts: four new MCP tools — `pathfinder_list_packages`, `pathfinder_get_package`, `pathfinder_get_manifest`, `pathfinder_launch_package`. Read-only, stateless, no auth.
- New env var: `PATHFINDER_REPOSITORY_URL` (defaults to `https://interactive-learning.grafana.net/packages/`).

**Open questions resolved during execution:**

- Naming clash with the deferred P5 `pathfinder_get_manifest` (session-scoped). Resolved in Decision log below.

---

## Tasks

- [x] **1.** Implement repository client with TTL-cached index + uncached per-package fetches, structured error union, non-fatal validation. (`src/cli/mcp/lib/repository-client.ts`)
- [x] **2.** Unit tests for the client — index, drift, NOT_FOUND, HTTP/network errors, env-var override, slash-normalization, TTL, in-flight dedup. (`src/cli/mcp/lib/__tests__/repository-client.test.ts`)
- [x] **3.** Implement `registerRepositoryTools` with the four tools and register in `tools/index.ts`. (`src/cli/mcp/tools/repository-tools.ts`)
- [x] **4.** Integration tests via `InMemoryTransport`: list filtering, get-package drift, manifest-only, launch with/without `instanceUrl` and with `panelMode=floating`, env-var override end-to-end. (`src/cli/mcp/__tests__/repository-tools.test.ts`)
- [x] **5.** Extend the tool-list assertion in `src/cli/mcp/__tests__/server.test.ts`.
- [x] **6.** Documentation pass — `docs/developer/MCP_SERVER.md` Repository tools section.
- [x] **7.** Flip status table for P6 in `docs/design/AI-AUTHORING-IMPLEMENTATION.md` and link this plan.

### Test plan

- Unit + integration: `npx jest src/cli/mcp` — 85 tests, includes 41 new P6 tests.
- Full: `npm run check`.

### Verification (matches index exit criteria)

- [x] All four tools callable against the default CDN with no configuration (covered by integration tests using mocked `fetch`).
- [x] `PATHFINDER_REPOSITORY_URL` overrides the default end-to-end (test: "honors the PATHFINDER_REPOSITORY_URL override end-to-end").
- [~] `pathfinder_launch_package` returns a `launchPath` that **resolves to the Pathfinder plugin** when appended to a Grafana instance origin (URL shape verified). However, the URL does not currently load the targeted CDN guide as an interactive tutorial — partial. Tracked as [#855](https://github.com/grafana/grafana-pathfinder-app/issues/855); see Deviations below.
- [x] Schema drift in CDN-hosted manifest does not hard-fail `pathfinder_get_package` or `pathfinder_get_manifest` — raw JSON returned alongside `validation.issues`.
- [x] `pkg/plugin/mcp.go` unchanged from `main`.

---

## Decision log

### 2026-05-08 — In-flight dedup added to `fetchRepositoryIndex`

- **Decision:** Module-scope `indexInFlight: Promise<...> | null` so concurrent callers share one fetch.
- **Alternatives considered:** Refactor `pathfinder_get_package` to do entry lookup once and bypass the cache for the second file fetch. Rejected because it leaks the cache shape into the tool layer and doesn't help any future caller that does its own parallel fetches.
- **Rationale:** The first integration test for `pathfinder_get_package` exposed two simultaneous misses on a cold cache (parallel `Promise.all([fetchPackageContent, fetchPackageManifest])`, each calling `fetchRepositoryIndex`). Mirrors the same pattern in `src/lib/package-recommendations-client.ts`.
- **Touches:** `src/cli/mcp/lib/repository-client.ts`, `__resetRepositoryClientForTests()`.

### 2026-05-08 — Naming clash with deferred P5 `pathfinder_get_manifest`

- **Decision:** Ship `pathfinder_get_manifest` with public-CDN semantics (input: `{ id }`).
- **Alternatives considered:** Rename to `pathfinder_get_repository_manifest` upfront. Rejected — overspecifies for an MVP that is the only manifest-getter today, and the symmetry with `pathfinder_get_package` is worth keeping.
- **Rationale:** P5 GCS-sessions is gated on triggers that may never fire. If/when P5 lands it must rename the session-scoped tool or take an `id?` vs `sessionToken?` discriminator. A header comment in `repository-tools.ts` flags this so the constraint is inherited.
- **Touches:** `src/cli/mcp/tools/repository-tools.ts` (header comment), this Decision log.

### 2026-05-08 — Validation is non-fatal, raw is always returned

- **Decision:** `fetchPackageContent` / `fetchPackageManifest` always return `{ ok: true, raw, parsed: T | null, validation }` on a successful HTTP fetch, even when Zod fails.
- **Alternatives considered:** Hard-fail on schema drift with a structured error.
- **Rationale:** P6 is a discovery surface. Schema drift on the public CDN is exactly the case where a client most needs to see the actual bytes (debugging, version lag). Hard-failing would be hostile.
- **Touches:** `src/cli/mcp/lib/repository-client.ts` (`PackageJsonResult<T>` shape), exit criterion.

---

## Deviations

### 2026-05-08 — `pathfinder_launch_package` ships partial

- **What was planned:** four fully-functional read-only tools, with `pathfinder_launch_package` returning a deep link that opens the targeted CDN guide as an interactive tutorial in Pathfinder.
- **What changed:** the URL the tool constructs is correct in shape (matches the path `src/utils/find-doc-page.ts:60-86` already anticipates) and resolves to the Pathfinder plugin, but the targeted CDN guide does **not** currently load as an interactive tutorial — Pathfinder opens to a generic docs view instead. The bug is in `handleAutoLaunchTutorial` (`src/components/docs-panel/docs-panel.tsx:1484-1522`), which routes `type: 'interactive'` URLs to `model.openDocsPage(url, title, { source })` without the `packageInfo` argument the recommendations panel passes. Without `packageInfo`, the content pipeline falls through to generic `fetchContent` instead of `fetchPackageContent`, and the package-aware interactive scaffolding never engages.
- **Reason:** P6 was scoped as additive to the TS MCP only — `pkg/plugin/mcp.go` and the Pathfinder app-side code were both explicitly out of scope. The fix lives on the app side, so it cannot ship in P6 without expanding scope. Two of three other P6 tools (`pathfinder_get_package`, `pathfinder_get_manifest`) cover the inspection use case; `pathfinder_list_packages` covers discovery. The launch tool ships marked partial rather than dropped because (a) its URL is correct and resolves to the plugin, (b) clients can still share the link as a "click here to see this guide in your Grafana" affordance even if interactive launch is not yet wired, and (c) the contract — request shape, response shape — is what we want long-term, so dropping and re-adding the tool would be churn.
- **Mitigation:** every success response includes a `warning: { status: "partial", message, tracking }` field pointing at [#855](https://github.com/grafana/grafana-pathfinder-app/issues/855). The tool description and the `MCP_SERVER.md` table both flag the partial status. A focused unit test (`repository-tools.test.ts` — "always surfaces a partial-status warning with a tracking link on success") asserts the warning is present so a future fix that removes it must do so deliberately.
- **Propagation:** issue #855 filed with full diagnosis, repro, proposed fix (estimated ~30 lines in `docs-panel.tsx` plus a test), and links back to PR #844 and this phase plan. Re-reviewed when the app-side fix PR opens.

---

## Handoff to next phase

- **Four read-only repository tools live on the TS MCP**: `pathfinder_list_packages`, `pathfinder_get_package`, `pathfinder_get_manifest`, `pathfinder_launch_package`. No auth, no per-instance state, work against the public CDN by default.
- **`PATHFINDER_REPOSITORY_URL` is the override knob** — env var, trailing slash optional. Process-level; all four tools read it.
- **In-flight dedup + 60 s TTL** on the index. Per-package fetches are uncached. Tests reset both via `__resetRepositoryClientForTests()`.
- **`pathfinder_get_manifest` naming**: future P5 GCS-sessions design must either rename its session-scoped variant or take an `id?` vs `sessionToken?` discriminator. Header comment in `src/cli/mcp/tools/repository-tools.ts` carries the constraint forward.
- **`pkg/plugin/mcp.go` deliberately unchanged** — exit criterion. Migrating Go MCP runtime tools (`list_guides`, `get_guide`, …) is still P5, independent of P6.
- **App-side untouched**: the `?doc=<interactive-learning.grafana.net URL>` deep-link pattern in `src/utils/find-doc-page.ts:60-86` already accepts CDN URLs via `isInteractiveLearningUrl`. No frontend work was needed to make `launchPath` resolve.
- **Reusable test scaffolding**: the InMemoryTransport `callTool` helper in `repository-tools.test.ts` mirrors the one in `finalize.test.ts` and `server.test.ts`. Worth lifting into a shared helper if a fourth phase repeats the pattern.
