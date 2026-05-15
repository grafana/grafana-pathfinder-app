# Pathfinder authoring MCP server

The `pathfinder-cli mcp` subcommand exposes the Pathfinder authoring CLI as a set of MCP tools, so any MCP-capable client (Cursor, Claude Desktop, MCP Inspector, Grafana Assistant) can author guides through tool calls instead of shell invocations.

It ships in the same npm package and Docker image as the rest of `pathfinder-cli` — one source tree, one Zod schema instance, one `package.json#bin` entrypoint with subcommand dispatch.

> Design source of truth: `docs/design/HOSTED-AUTHORING-MCP.md`, `docs/design/AUTHORING-SESSION-ARTIFACTS.md`, `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md`.

## Running locally

### Stdio (default)

```bash
# After npm run build:cli
node dist/cli/cli/index.js mcp

# Or, once the npm package is published:
npx pathfinder-cli mcp

# Or via the Docker image:
docker run --rm -i ghcr.io/grafana/pathfinder-cli:main mcp
```

Stdio is the right transport for any MCP client that owns the server's process lifecycle (Cursor, Claude Desktop, MCP Inspector). Auth is the user's local trust boundary — the same model every stdio MCP server uses.

### HTTP (centrally hosted)

```bash
node dist/cli/cli/index.js mcp --transport http --port 8080
```

The HTTP transport uses the SDK's StreamableHTTP transport in **stateless mode** — `sessionIdGenerator` is omitted so each request gets a fresh transport and there is no server-side session state.

**The HTTP transport ships without authentication for the MVP.** See the resolved open question in `docs/design/AI-AUTHORING-IMPLEMENTATION.md` ("Does the hosted HTTP MCP need auth at all?"). The MCP holds no privileged resource — Assistant performs the App Platform write with its own credentials downstream.

In-process abuse mitigations (all in `transports/http.ts`):

| Constant                  | Default | Behavior on breach                                             |
| ------------------------- | ------- | -------------------------------------------------------------- |
| `MAX_REQUEST_BYTES`       | 1 MB    | 413 with structured JSON-RPC error                             |
| `PER_CALL_WALLCLOCK_MS`   | 30 s    | 504 with structured JSON-RPC error; tool call abandoned        |
| `MAX_CONCURRENT_REQUESTS` | 100     | 503 with `Retry-After: 1`; LB should shed to a healthy replica |
| `KEEPALIVE_TIMEOUT_MS`    | 5 s     | Idle keep-alive connections close (slowloris mitigation)       |
| `HEADERS_TIMEOUT_MS`      | 10 s    | Header-stalling clients are dropped                            |
| `REQUEST_TIMEOUT_MS`      | 60 s    | Hard cap on the full request lifecycle                         |

Every request emits one JSON line to stderr with `{ts, remote, method, path, status, durationMs, bytesIn, outcome}` for operational triage. Deploy-time edge rate limits and autoscaling ceilings stack on top.

### Healthcheck

`GET /healthz` returns `{"status":"ok"}` without constructing an `McpServer`. Use this for k8s liveness/readiness probes — do **not** point probes at `/mcp` (would consume a concurrency slot and tmpdir on every probe).

## Building and running the Docker image locally

```bash
# Build (multi-stage; no host node_modules needed)
docker build -f Dockerfile.cli -t pathfinder-cli:dev .

# CLI entrypoint
docker run --rm pathfinder-cli:dev --version            # → 1.1.0
docker run --rm -v "$PWD:/workspace" pathfinder-cli:dev validate ./my-guide

# MCP entrypoint (stdio — `-i` keeps stdin attached)
docker run --rm -i pathfinder-cli:dev mcp

# MCP entrypoint (HTTP)
docker run --rm -p 8080:8080 pathfinder-cli:dev mcp --transport http --port 8080 --host 0.0.0.0
```

The `mcp` first-arg routes through `scripts/docker-entrypoint.sh` to `pathfinder-cli mcp`; anything else routes to `pathfinder-cli`.

## Wiring a local agent to the running MCP

### Claude Code

```bash
# Local build (after npm run build:cli)
claude mcp add pathfinder -- node "$PWD/dist/cli/cli/index.js" mcp

# Or via the local Docker image
claude mcp add pathfinder -- docker run --rm -i pathfinder-cli:dev mcp

# Or project-scoped — drop a .mcp.json at the repo root:
# {
#   "mcpServers": {
#     "pathfinder": { "command": "node", "args": ["./dist/cli/cli/index.js", "mcp"] }
#   }
# }
```

Restart Claude Code, then run `/mcp` to confirm `pathfinder` is connected. Try: _"Use the `pathfinder_authoring_start` tool and show me what it returns."_

### Cursor

Settings → MCP → "Add new MCP server", or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pathfinder": {
      "command": "node",
      "args": ["/absolute/path/to/dist/cli/cli/index.js", "mcp"]
    }
  }
}
```

Swap the `command`/`args` for `docker run --rm -i pathfinder-cli:dev mcp` if you'd rather run from the image.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node "$PWD/dist/cli/cli/index.js" mcp
```

Opens a UI at `http://localhost:5173` for poking at tools without an LLM in the loop.

## Tool surface

18 tools, registered in `src/cli/mcp/tools/`:

| Tool                                   | Module                | Wraps                                                                                 |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `pathfinder_authoring_start`           | `authoring-start.ts`  | (static context block)                                                                |
| `pathfinder_help`                      | `help.ts`             | `formatHelpAsJson` over the CLI commands                                              |
| `pathfinder_create_package`            | `artifact-tools.ts`   | `runCreate`                                                                           |
| `pathfinder_create_guide_template`     | `artifact-tools.ts`   | `newPackageState` + pre-populated starter blocks; round-tripped through `runValidate` |
| `pathfinder_add_block`                 | `mutation-tools.ts`   | `runAddBlock`                                                                         |
| `pathfinder_add_step`                  | `mutation-tools.ts`   | `runAddStep`                                                                          |
| `pathfinder_add_choice`                | `mutation-tools.ts`   | `runAddChoice`                                                                        |
| `pathfinder_edit_block`                | `mutation-tools.ts`   | `runEditBlock`                                                                        |
| `pathfinder_remove_block`              | `mutation-tools.ts`   | `runRemoveBlock`                                                                      |
| `pathfinder_set_manifest`              | `mutation-tools.ts`   | `runSetManifest`                                                                      |
| `pathfinder_inspect`                   | `inspection-tools.ts` | `runInspect`                                                                          |
| `pathfinder_validate`                  | `inspection-tools.ts` | `runValidate`                                                                         |
| `pathfinder_finalize_for_app_platform` | `finalize.ts`         | `runValidate` + handoff payload from `APP-PLATFORM-PUBLISH-HANDOFF.md`                |
| `pathfinder_list_packages`             | `repository-tools.ts` | CDN `repository.json` + filters (P6)                                                  |
| `pathfinder_get_package`               | `repository-tools.ts` | CDN `content.json` + `manifest.json` for one id                                       |
| `pathfinder_get_manifest`              | `repository-tools.ts` | CDN `manifest.json` only (cheaper variant)                                            |
| `pathfinder_launch_package`            | `repository-tools.ts` | Builds `?doc=<cdn-url>` deep link — **partial**, see [#855][p6-launch-bug]            |
| `pathfinder_get_schema`                | `schema-tools.ts`     | `exportSchema` / `exportAllSchemas` / `listSchemas` from `src/cli/commands/schema.ts` |

[p6-launch-bug]: https://github.com/grafana/grafana-pathfinder-app/issues/855

### Repository tools (P6)

The four `repository-tools.ts` tools are read-only against a public package CDN. They are stateless (no artifact in/out) and need no auth.

- **Default repository**: `https://interactive-learning.grafana.net/packages/`.
- **Override**: set `PATHFINDER_REPOSITORY_URL` (trailing slash optional) on the process. The HTTP transport's deploy passes this through unchanged; for stdio clients, set it on the `npx pathfinder-cli mcp` invocation.
- **Caching**: `repository.json` is cached in-process for 60 seconds with single-flight dedup. Per-package `content.json` / `manifest.json` fetches are uncached.
- **Validation is non-fatal**: the get-tools always return `raw` (the bytes the CDN served) plus a `validation` report. Schema drift surfaces as `validation.issues` and never hard-fails. This is intentional — these tools are a discovery surface and clients debugging drift need to see the actual bytes.
- **Errors are structured, never thrown**: `{ status: "error", code, message, httpStatus? }` with `code` ∈ `HTTP_ERROR | NETWORK_ERROR | PARSE_ERROR | NOT_FOUND`.
- **`pathfinder_launch_package`** returns a relative `launchPath` always; an absolute `launchUrl` when `instanceUrl` is provided. Pass `panelMode: "floating"` to append `&panelMode=floating`. The link is consumed by the existing `?doc=<interactive-learning.grafana.net URL>` path in `src/utils/find-doc-page.ts:60-86` (`isInteractiveLearningUrl` allowlist).
- **`pathfinder_launch_package` ships PARTIAL** — see [#855][p6-launch-bug]. The URL it builds resolves to the Pathfinder plugin but does not currently load the targeted CDN guide as an interactive tutorial; it opens to a generic docs view instead. Every successful response carries a `warning: { status: "partial", message, tracking }` field so agents and clients see the limitation at runtime. The bug is in the app-side `auto-launch-tutorial` handler (`src/components/docs-panel/docs-panel.tsx`), which calls `openDocsPage(url, title)` without the `packageInfo` argument the recommendations panel passes — so the package-aware content pipeline never engages. The MCP tool will keep working as-is once the app-side fix lands.

> Naming note: a future P5 GCS-sessions design also proposes a `pathfinder_get_manifest` tool — but session-scoped, taking a `sessionToken`. P6 ships first with the public-CDN semantics; if/when P5 lands it must rename or add a discriminator. See [P6 phase plan — Decision log](../design/phases/ai-authoring-6-cdn-repository-tools.md#decision-log).

### Migrated from the Go MCP

Two tools were ported from the now-deprecated `pkg/plugin/mcp.go` runtime to the TS server:

- **`pathfinder_get_schema`** replaces the Go `get_guide_schema`. The Go version returned a hand-maintained JSON Schema string from a `guideSchemas` map (`pkg/plugin/mcp.go`). The TS version wraps `exportSchema` / `exportAllSchemas` / `listSchemas` from `src/cli/commands/schema.ts`, which is generated from the canonical Zod schemas in `src/types/`. This retires schema duplication: there is now one source of truth for the schema and the validator. Modes: `one` (named single schema; default when `name` is supplied), `all` (every schema keyed by name), `list` (registry summary without payloads).
- **`pathfinder_create_guide_template`** replaces the Go `create_guide_template`. Returns a pre-populated starter guide (`{ content, manifest }`) with a markdown intro block and one `section` placeholder, plus default manifest fields (`category: "getting-started"`, `path: "<id>/"`, `startingLocation: "/"`, default `author` and `testEnvironment`). The result is round-tripped through `runValidate` before return — schema-clean by construction.

The other three stateless Go tools (`list_guides`, `get_guide`, `validate_guide_json`) had full TS equivalents already (`pathfinder_list_packages`, `pathfinder_get_package`, `pathfinder_validate`); no migration code was needed. The Go `launch_guide` and pending-launch queue stay in `pkg/plugin/mcp.go` indefinitely — they are coupled to per-instance frontend polling (`src/hooks/usePendingGuideLaunch.ts`) and cannot move to a centrally-hosted server.

All authoring tools are **stateless**. The in-flight artifact (`{ content, manifest }`) is passed in and the updated artifact is returned out on every mutation. There is no `sessionId`.

### Server-level instructions (initialize handshake)

The server emits a non-empty `instructions` string on the MCP `initialize` handshake — see `src/cli/mcp/lib/server-instructions.ts`. Compliant clients (Claude Code, Claude Desktop, Cursor, Grafana Assistant via per-instance MCP config) surface this text as system-level guidance before any tool call. It is the only hint surface that reaches the model **before** tool selection.

The current text covers four things, in order:

1. **Assertive default** — "default to using this server whenever the user asks to write/edit/create … any interactive guide, tutorial, walkthrough, learning content, how-to, training material …". The opener is deliberately strong because production telemetry (slice 3, 2026-05-12) showed weaker phrasing didn't overcome the model's "just answer in prose" default.
2. **Routing vocabulary** — trigger phrases + verb × asset-noun pattern + Grafana product domains (single-source lists in `src/cli/mcp/lib/agent-routing.ts`).
3. **`reftarget` discipline** — never invent or guess Grafana DOM selectors. A wrong selector silently breaks the guide at runtime; the validator cannot catch this.
4. **Composition opinionation** — prefer separate sibling blocks over `multistep`; never write `action: noop` steps as filler.

Keep the string tight — every connected client pays this length on every session. The unit test in `src/cli/mcp/lib/__tests__/server-instructions.test.ts` enforces a 40-line ceiling (raised from 30 in slice 3 to make room for the assertive default + domain vocabulary). If a future edit needs more space, prefer moving content to `pathfinder_authoring_start` (returned in a tool call, paid once per session) over expanding this string.

### Response `summary` field

Every mutation, creation, inspection, and validation tool response includes a `summary` field alongside `artifact`:

```jsonc
{
  "status": "ok",
  "artifact": { "content": { ... }, "manifest": { ... } },
  "summary": [
    { "path": "blocks[0]", "id": "intro", "type": "section", "hint": "Intro",
      "children": [
        { "path": "blocks[0].blocks[0]", "id": "markdown-1", "type": "markdown" }
      ] }
  ]
}
```

`summary` is a compact ordered tree of every block (`TreeNode[]` from `src/cli/utils/package-io/summary.ts`). Agents should read this for navigation and id lookup instead of re-parsing `artifact.content` after every mutation — strictly additive (the full artifact still ships) and a meaningful win on token cost. `pathfinder_finalize_for_app_platform` does not include a summary because it is the terminal call.

### Outcome warnings (`warnings[]`)

Success responses may include an optional `warnings` array carrying soft, non-fatal feedback that the agent (or a human reviewer) should consider. The shape:

```jsonc
{
  "status": "ok",
  "artifact": { ... },
  "summary": [ ... ],
  "warnings": [
    {
      "code": "UNVERIFIED_SELECTOR",
      "message": "reftarget set without verification. ...",
      "path": "blocks[2].steps[0]/reftarget"
    }
  ]
}
```

Codes are stable strings — the registry below is authoritative; new codes are added in lockstep with `src/cli/utils/warnings.ts`. Clients should render warnings prominently (text mode does so by default; quiet mode suppresses for one-line invariants). Warnings are **never** errors — the call succeeded, and the agent should not retry on a warning alone.

**Code registry:**

| Code                         | Emitted by                                                                                | Meaning                                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MULTISTEP_COMPOSITION_HINT` | `runAddBlock` on `type: 'multistep'` append                                               | Composition nudge. `multistep` is for tightly-coupled ordered steps; prefer separate sibling blocks for loose sequences, and never use `action: noop` as filler.                                                        |
| `UNVERIFIED_SELECTOR`        | `runAddBlock` / `runAddStep` / `runEditBlock` whenever a non-empty `reftarget` is written | The CLI cannot verify a selector against the live Grafana DOM. Confirm against a running instance before publishing — wrong selectors silently break the guide at runtime.                                              |
| `INPUT_NORMALIZED`           | `runAddBlock` / `runEditBlock` whenever the CLI rewrites a user-supplied value            | Teach-on-write signal. Naming says what got rewritten (e.g., `youtube.com/watch?v=ID` → `youtube.com/embed/ID`). The call succeeded with the canonical form; pass the canonical form next time to avoid the round-trip. |

The MCP layer surfaces `warnings` verbatim through `outcomeResult` — no transformation. CLI users see the same payload via `--format json` and a `Warnings:` block in text mode (suppressed in `--quiet`).

### Artifact integrity (`__etag`)

Every response that returns an artifact embeds an `__etag` string at the artifact envelope (sibling to `content` and `manifest`):

```jsonc
{
  "status": "ok",
  "artifact": {
    "content": { ... },
    "manifest": { ... },
    "__etag": "a1b2c3d4e5f60718"
  }
}
```

The agent's contract is to **echo the artifact back verbatim — including `__etag` — on every subsequent mutation call**. The MCP layer recomputes the etag of `{content, manifest}` and compares; on mismatch, it returns an `ARTIFACT_MUTATED` error before any dispatch happens, with remediation-shaped text:

```jsonc
{
  "status": "error",
  "code": "ARTIFACT_MUTATED",
  "message": "The artifact you passed in does not match the integrity tag the server issued. ...",
  "data": { "expected": "...", "actual": "...", "field": "__etag" },
}
```

This pinpoints the actual bug class — agent re-serializing or reformatting fields between hops — rather than letting it surface as a misleading `SCHEMA_VALIDATION`. When the input has no `__etag` (first call, older client), the check is skipped. The CLI runner never sees `__etag`; it is stripped at the MCP / state-bridge boundary.

The etag is a SHA-256 over canonical-form (sorted-key) JSON of `{content, manifest}`, truncated to 16 hex chars / 64 bits. Determinism guards against whitespace and key-order shuffles. Array order is preserved (semantically meaningful for `blocks`). Not security-relevant — this is an integrity check, not authentication.

### Access log fields

The HTTP transport emits one structured JSON line per request with these fields. `tokens{In,Out}Estimate` are heuristic (`ceil(bytes / 4)`); use them for spotting outliers and trends, not for billing reconciliation.

```jsonc
{
  "ts": "2026-05-01T12:34:56.789Z",
  "remote": "10.0.0.1",
  "method": "POST",
  "path": "/mcp",
  "status": 200,
  "durationMs": 17,
  "bytesIn": 432,
  "bytesOut": 1180,
  "tokensInEstimate": 108,
  "tokensOutEstimate": 295,
  "outcome": "ok",
}
```

### Inspecting deployed logs

The hosted HTTP transport runs on Google Cloud Run. The deploy is operator-local — the script lives at `deploy-mcp.sh` in this repo and is gitignored, so the project ID, region, service name, and resulting URL are not in tracked files. Ask the operator (or read `deploy-mcp.sh` if you have a copy) for the specifics; the runtime model is fixed.

Once you know the project and service, the canonical query for the structured access log fields above is:

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=<service-name>' \
  --project=<project-id> \
  --limit=50 \
  --format=json
```

The fields documented in [Access log fields](#access-log-fields) appear under each entry's `jsonPayload`. To filter for a single request shape, add `jsonPayload.path="/mcp"` or `jsonPayload.outcome="error"` to the filter expression. For a recent test run, sort newest-first with `--freshness=10m`.

This is the verification path for any change that emits or modifies access-log fields, structured outcomes, or tool-call telemetry — drive the deployed service, then read the logs back. A local stdio run will not exercise the HTTP transport's logging code path.

## CLI is the sole validator

The MCP performs no schema validation of its own. Each mutation tool dispatches to the corresponding CLI `runX` function, which is the only place block-shape, condition syntax, and cross-file checks live.

The MCP input schemas are intentionally permissive (`record<string, unknown>` for block fields). Any CLI-strict guard added to a runner is automatically picked up by the MCP without code changes.

## State bridge

The CLI runners read and write directories on disk; the MCP's stateless artifact model passes the artifact in/out as JSON. The `tools/state-bridge.ts` `withArtifact` helper marshals one to the other through a per-call ephemeral tmpdir.

> This is a documented deviation from the design's "no temporary directory" property in `HOSTED-AUTHORING-MCP.md`. The deviation is acceptable because the tmpdir is per-call (no cross-call state), the CLI stays the sole validator, and the cost is bounded (two small JSON file writes against `os.tmpdir()`). Tracked in the P3 phase plan deviations; follow-up is to refactor `mutateAndValidate` and each `runX` to accept an in-memory state mode so the bridge can collapse to a function call.

## Adding a tool

1. Pick or create a file under `src/cli/mcp/tools/`.
2. Import the relevant `runX` (and any related types).
3. Define a permissive zod input schema — schema knowledge stays in the CLI.
4. Wrap the call: `withArtifact(artifact, (dir) => runX({ dir, ... }))` for mutations, or call the runner directly for read-only/validation tools.
5. Return `outcomeResult(outcome, updatedArtifact, summary)` — `withArtifact` returns `summary` automatically; for tools that don't go through the bridge, build it with `buildArtifactSummary(content)` from `package-io/summary`.
6. Register the new function call from `tools/index.ts`.
7. Add a test in `src/cli/mcp/__tests__/server.test.ts` that drives the new tool through the in-memory transport pair.

## Tests

```bash
npx jest src/cli/mcp/__tests__/server.test.ts
```

The integration tests use the SDK's `InMemoryTransport.createLinkedPair()` to exercise the real registration + dispatch path without spawning a subprocess. End-to-end coverage includes a full create → add-block → inspect → validate → finalize flow.

## Deployable artifact

The Docker image `ghcr.io/grafana/pathfinder-cli:main` includes the MCP server as the `pathfinder-cli mcp` subcommand. The image entrypoint routes a leading `mcp` arg through to it, so a hosted deployment is `docker run ghcr.io/grafana/pathfinder-cli:main mcp --transport http --port 8080`. Where the centrally hosted MCP runs is a P4 coordination point with the Assistant team.
