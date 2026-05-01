# Pathfinder authoring MCP server

The `pathfinder-mcp` server exposes the Pathfinder authoring CLI as a set of MCP tools, so any MCP-capable client (Cursor, Claude Desktop, MCP Inspector, Grafana Assistant) can author guides through tool calls instead of shell invocations.

It ships in the same npm package and Docker image as `pathfinder-cli` — there is one source tree, one Zod schema instance, and two `package.json#bin` entrypoints.

> Design source of truth: `docs/design/HOSTED-AUTHORING-MCP.md`, `docs/design/AUTHORING-SESSION-ARTIFACTS.md`, `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md`.

## Running locally

### Stdio (default)

```bash
# After npm run build:cli
node dist/cli/cli/mcp/index.js

# Or, once the npm package is published:
npx pathfinder-mcp

# Or via the Docker image:
docker run --rm -i ghcr.io/grafana/pathfinder-cli:main mcp
```

Stdio is the right transport for any MCP client that owns the server's process lifecycle (Cursor, Claude Desktop, MCP Inspector). Auth is the user's local trust boundary — the same model every stdio MCP server uses.

### HTTP (centrally hosted)

```bash
node dist/cli/cli/mcp/index.js --transport http --port 8080
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

The `mcp` first-arg routes through `scripts/docker-entrypoint.sh` to `pathfinder-mcp`; anything else routes to `pathfinder-cli`.

## Wiring a local agent to the running MCP

### Claude Code

```bash
# Local build (after npm run build:cli)
claude mcp add pathfinder -- node "$PWD/dist/cli/cli/mcp/index.js"

# Or via the local Docker image
claude mcp add pathfinder -- docker run --rm -i pathfinder-cli:dev mcp

# Or project-scoped — drop a .mcp.json at the repo root:
# {
#   "mcpServers": {
#     "pathfinder": { "command": "node", "args": ["./dist/cli/cli/mcp/index.js"] }
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
      "args": ["/absolute/path/to/dist/cli/cli/mcp/index.js"]
    }
  }
}
```

Swap the `command`/`args` for `docker run --rm -i pathfinder-cli:dev mcp` if you'd rather run from the image.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node "$PWD/dist/cli/cli/mcp/index.js"
```

Opens a UI at `http://localhost:5173` for poking at tools without an LLM in the loop.

## Tool surface

12 tools, registered in `src/cli/mcp/tools/`:

| Tool                                   | Module                | Wraps                                                                  |
| -------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `pathfinder_authoring_start`           | `authoring-start.ts`  | (static context block)                                                 |
| `pathfinder_help`                      | `help.ts`             | `formatHelpAsJson` over the CLI commands                               |
| `pathfinder_create_package`            | `artifact-tools.ts`   | `runCreate`                                                            |
| `pathfinder_add_block`                 | `mutation-tools.ts`   | `runAddBlock`                                                          |
| `pathfinder_add_step`                  | `mutation-tools.ts`   | `runAddStep`                                                           |
| `pathfinder_add_choice`                | `mutation-tools.ts`   | `runAddChoice`                                                         |
| `pathfinder_edit_block`                | `mutation-tools.ts`   | `runEditBlock`                                                         |
| `pathfinder_remove_block`              | `mutation-tools.ts`   | `runRemoveBlock`                                                       |
| `pathfinder_set_manifest`              | `mutation-tools.ts`   | `runSetManifest`                                                       |
| `pathfinder_inspect`                   | `inspection-tools.ts` | `runInspect`                                                           |
| `pathfinder_validate`                  | `inspection-tools.ts` | `runValidate`                                                          |
| `pathfinder_finalize_for_app_platform` | `finalize.ts`         | `runValidate` + handoff payload from `APP-PLATFORM-PUBLISH-HANDOFF.md` |

All authoring tools are **stateless**. The in-flight artifact (`{ content, manifest }`) is passed in and the updated artifact is returned out on every mutation. There is no `sessionId`.

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

The Docker image `ghcr.io/grafana/pathfinder-cli:main` includes the MCP entrypoint. The convenience `mcp` subcommand (defined in the image's bin routing during P2) delegates to `pathfinder-mcp`, so a hosted deployment is `docker run ghcr.io/grafana/pathfinder-cli:main mcp --transport http --port 8080`. Where the centrally hosted MCP runs is a P4 coordination point with the Assistant team.
