# Pathfinder authoring MCP service

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Depends on [Agent authoring CLI](./AGENT-AUTHORING.md) and [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md).

## Purpose

The Pathfinder authoring MCP service is the endpoint that AI clients use to author Pathfinder guides. It exposes the current authoring context, deterministic guide-authoring tools, and a finalization tool that prepares artifacts for Grafana App Platform publishing.

The service is not a replacement for the AI client. The client still reasons about the user's goal, asks clarifying questions, and decides what content to create. The MCP service owns the Pathfinder-specific authoring contract and makes that contract discoverable at runtime.

## Where it runs

The authoring MCP service is a **standalone TypeScript MCP server** that lives in this repository at `src/cli/` as a sibling entrypoint to the `pathfinder-cli` command. The CLI and the MCP server are two binary entrypoints of the same npm package: a single source tree, one schema runtime, two `package.json#bin` targets (`pathfinder-cli` and `pathfinder-mcp`).

The MCP server **imports CLI commands as library functions**. There is no shell-out, no temporary directory, no `exec.Command`, no per-call Node startup. Every authoring tool call is a synchronous function call against the same Zod schemas the CLI uses.

The server runs in two deployment modes:

1. **Self-serve (stdio transport).** `npx pathfinder-mcp` or `docker run grafana/pathfinder-cli mcp` for Cursor, Claude Desktop, or any local MCP client. The MCP client owns the process; auth is the user's local trust boundary.
2. **Centrally hosted (HTTP transport).** The same code runs as a Grafana-org service for clients that cannot connect to a user-local process — most importantly Grafana Assistant on Cloud. Authentication uses the Grafana MCP token-verifier pattern (FastMCP `MultiAuth` + `GrafanaGoogleTokenVerifier`); see [Authentication and authorization](#authentication-and-authorization) below.

This is a deliberate departure from an earlier draft of this design that placed authoring tools inside the existing Go plugin MCP at `/api/plugins/grafana-pathfinder-app/resources/mcp`. That earlier approach would have required shelling out from Go to a per-platform Node binary bundled inside the plugin tarball. Investigation found that the existing Go MCP is a dormant spike with no production callers, that the "ship in lockstep with the plugin" property it offered can be replaced by lockstep CI between the npm package and the plugin, and that the in-process TypeScript design is materially simpler — fewer build artifacts, no IPC, no per-call cold-start, and no class of bundled-binary failure modes. The existing `pkg/plugin/mcp.go` is preserved as a runtime-tools-only stub (see [Relationship to existing plugin MCP tools](#relationship-to-existing-plugin-mcp-tools)).

### Authentication and authorization

**Any authenticated identity that reaches the MCP may call the authoring tools.** There is no role-based gate at the MCP layer. The authoring tool surface is stateless and produces no Grafana-instance side effects on its own — it returns artifacts. Publish authority is enforced **downstream**, at the App Platform write performed by the Grafana-authorized client (see [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md)). A viewer-role user who reaches `pathfinder_finalize_for_app_platform` and tries to PUT the resulting payload will be rejected by the App Platform API; the error surface is correct without an additional MCP-side check.

Auth strategy by transport:

- **Stdio.** No auth at the MCP layer. The MCP server runs as a child process of a local MCP client (Cursor, Claude Desktop) and trusts the local user. This is the same trust model every stdio-transport MCP server uses.
- **HTTP (hosted).** The Grafana MCP token-verifier pattern. See FastMCP `MultiAuth` + `GrafanaGoogleTokenVerifier` in [`grafana/data-platform-tools` `mcp/mcp-data/server.py`](https://github.com/grafana/data-platform-tools/blob/5892defb0515fd66864ecb57627e5aafd8013fde/mcp/mcp-data/server.py#L143). Tokens are verified per request; no session state is established.

Pathfinder is OSS, the authoring tools are publicly available on GitHub, and the agent's authority to write into a Grafana instance is delegated downstream through the App Platform path. There is no new identity provider, rate limiter, or tenant model introduced by the MCP layer itself.

## Server responsibilities

The service owns:

1. **Authoring context delivery.** Provide the minimal instructions a model needs to begin authoring and discover more details through tools.
2. **Tool discovery.** Expose MCP tools with machine-readable input schemas and clear descriptions.
3. **Deterministic mutation.** Route authoring operations through the imported `pathfinder-cli` command functions so guide state changes are schema-validating and repeatable.
4. **Inspection.** Let clients query an artifact without parsing raw JSON.
5. **Validation.** Run the canonical Pathfinder validation pipeline (in the CLI) and return structured errors.
6. **Finalization.** Produce a publish handoff artifact for Grafana App Platform and a viewer link contract.
7. **Version reporting.** Report authoring context version, supported schema version, and tool contract version (all derived from `CURRENT_SCHEMA_VERSION`).

The service does not own:

- Grafana instance write authority — those calls are made by the Grafana-authorized client (see [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md)).
- Final user confirmation.
- Direct writes to private Grafana App Platform endpoints.
- Any schema knowledge of its own (see [Validation strategy](#validation-strategy) below).
- Server-side session state. The MVP authoring surface is stateless; see [Authoring artifacts — Stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model).

## Validation strategy

The MCP server **performs no schema validation of its own**. All validation lives in the `pathfinder-cli` command functions, which the MCP server imports directly from the same source tree (see [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution)). The CLI's exported `runX` functions (in place since P1 — see [`phases/ai-authoring-1-cli-foundation.md`](./phases/ai-authoring-1-cli-foundation.md)) are designed to be importable and are exercised by the CLI test suite without subprocess invocation. The MCP server composes against the same surface.

Each authoring tool call follows this pattern:

1. The MCP server receives the tool call with the in-flight artifact and mutation arguments.
2. The MCP tool dispatcher maps the call to the corresponding CLI command function (`create`, `add-block`, `edit-block`, `inspect`, etc.) and invokes it directly against the in-flight artifact.
3. The CLI command applies the mutation, validates the full package, and returns either the updated artifact or structured validation errors.
4. The MCP server returns the response to the caller.

There is no temporary directory, no JSON marshalling across an IPC boundary, no process spawn. **Per-call cost is a function call.**

This is what makes the design's core property hold end-to-end: **schema-illegal output is impossible because it is impossible in the CLI**, and the CLI is the only place schema knowledge lives. The MCP and CLI share a single TypeScript runtime, a single Zod schema instance, and ship in lockstep as one npm package — there is no IPC contract that could drift.

If batching multiple mutations into a single tool call ever becomes useful for clients (e.g., to avoid round-trips on large guides), [batch operations](./AGENT-AUTHORING.md#batch-operations) are already on the CLI roadmap. Unlike in the earlier shell-out design, batching here is purely a UX/throughput choice for clients; there is no Node cold-start to amortize.

## MCP surface

The first version prefers tools over optional MCP features because tool support is the most broadly available across clients. Prompts and resources can be added as progressive enhancement.

All authoring tools follow the [stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model): the in-flight artifact is passed in and returned out on every call. There is no `sessionId`.

### Core tools

| Tool                                   | Purpose                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pathfinder_authoring_start`           | **First tool.** Returns domain framing, workflow, discovery hints, block-type names, and a happy-path tutorial       |
| `pathfinder_help`                      | Returns CLI help for any command/subcommand by passing through `pathfinder-cli <cmd> [<sub>] --help --format json`   |
| `pathfinder_create_package`            | Returns a new authoring artifact with `content.json` and `manifest.json` initialized                                 |
| `pathfinder_add_block`                 | Appends a block to an artifact (permissive input; CLI is the validator); returns the updated artifact                |
| `pathfinder_add_step`                  | Appends a step to a `multistep` or `guided` block; returns the updated artifact                                      |
| `pathfinder_add_choice`                | Appends a choice to a `quiz` block; returns the updated artifact                                                     |
| `pathfinder_edit_block`                | Updates fields on an existing block by ID; returns the updated artifact                                              |
| `pathfinder_remove_block`              | Removes a block by ID (with `cascade` for non-empty containers); returns the updated artifact                        |
| `pathfinder_set_manifest`              | Updates manifest fields on the artifact; returns the updated artifact                                                |
| `pathfinder_inspect`                   | Reads artifact summary, block tree, or a specific block                                                              |
| `pathfinder_validate`                  | Runs full package validation against an artifact and returns structured issues                                       |
| `pathfinder_finalize_for_app_platform` | Returns an `InteractiveGuide` resource payload, publish instructions, viewer link fields, and `localExport` fallback |

`pathfinder_set_manifest` is included in the MVP tool surface so AI authoring produces correctly-shaped manifest data inside the artifact. **For the MVP, manifest data is artifact-local and is stripped on the way to the App Platform CRD** — the `InteractiveGuide` resource only persists content-shaped fields, which is a CRD limitation that affects all custom guides (block-editor and AI alike), not an AI-authoring design choice. Round-trip persistence of manifest data is a future improvement that requires extending the CRD; see [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

#### Tool-surface design notes

- **`pathfinder_add_block` is intentionally permissive.** Its input schema declares the `type` discriminator but accepts arbitrary additional fields. The MCP forwards everything to the imported CLI command, which is the sole validator. Per-block-type MCP tools were considered and rejected: they would re-introduce schema knowledge into the MCP layer (or require a Zod-to-JSONSchema generator at MCP startup), violating the design's core "CLI owns guide correctness" boundary. Any new block type that the CLI learns about is automatically supported by the MCP without code changes.
- **`pathfinder_help` is the discovery surface.** Agents call it with a command name (and optional subcommand) to get the field-level contract for any operation, mirroring the CLI's progressive-disclosure help. The MCP composes the same help surface the CLI exposes via `pathfinder-cli <cmd> [<sub>] --help --format json` — since the MCP imports the CLI module directly, this is a function call, not a shell-out. Promoting `--help --format json` to a stability contract is what makes this tool work; see [Agent authoring CLI — `--help --format json` is a stability contract](./AGENT-AUTHORING.md#--help---format-json-is-a-stability-contract).

### Optional tools

| Tool                                | Purpose                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `pathfinder_export_package`         | Returns a downloadable package bundle or raw `content.json`/`manifest.json` |
| `pathfinder_get_authoring_examples` | Returns examples scoped to a block type or workflow                         |

## Authoring context

`pathfinder_authoring_start` is **the first tool an agent calls**. Its tool description in the MCP listing makes that role obvious (e.g., "Always call this first before authoring a Pathfinder guide"). It returns the few lines of context an agent needs to be useful, plus the discovery hints to learn anything else from the CLI on demand.

The response includes both human-readable instructions and structured fields:

```json
{
  "status": "ok",
  "authoringContextVersion": "2026-04-28.1",
  "schemaVersion": "1.1.0",
  "domain": "You are authoring a Pathfinder interactive guide — a structured, schema-governed package of blocks (markdown, interactive steps, quizzes, etc.) that runs inside Grafana to teach a user how to accomplish something.",
  "workflow": [
    "Call pathfinder_create_package with a title (an ID will be auto-generated).",
    "Call pathfinder_add_block one block at a time, in display order. Use pathfinder_help to discover fields per block type.",
    "Call pathfinder_inspect after each section to confirm state. Use pathfinder_validate before finalizing.",
    "Call pathfinder_finalize_for_app_platform to produce the publish handoff.",
    "Ask the user whether to save as draft or publish, then write to the App Platform endpoint or fall back to localExport."
  ],
  "discovery": {
    "fieldHelpForAnyCommand": "pathfinder_help(command='add-block', subcommand='<block-type>')",
    "verifyArtifactState": "pathfinder_inspect",
    "checkBeforeFinalizing": "pathfinder_validate"
  },
  "blockTypes": [
    "markdown",
    "section",
    "interactive",
    "multistep",
    "guided",
    "quiz",
    "input",
    "image",
    "video",
    "html",
    "terminal",
    "terminal-connect",
    "code-block",
    "conditional",
    "assistant"
  ],
  "tutorial": {
    "summary": "A minimal 3-block guide: an intro markdown, an interactive navigation step, and a quiz to check understanding.",
    "steps": [
      "pathfinder_create_package(title='Getting started with Loki')",
      "pathfinder_add_block(type='markdown', parent=null, content='Welcome — in this guide you will...')",
      "pathfinder_add_block(type='interactive', action='navigate', reftarget='[data-testid=\"nav-item-connections\"]', content='Open Connections.')",
      "pathfinder_add_block(type='quiz', id='check', question='Which query language does Loki use?')",
      "pathfinder_add_choice(parent='check', id='a', text='LogQL', correct=true)",
      "pathfinder_validate(artifact=...)",
      "pathfinder_finalize_for_app_platform(artifact=..., status='draft')"
    ]
  },
  "instructions": "Use Pathfinder MCP tools to author guides. The artifact is passed in to and returned from every mutation call. Do not write raw guide JSON. When you don't know what fields a block type accepts, call pathfinder_help — never guess. Validate before finalizing."
}
```

This tool does not allocate a session — it returns context only. The client begins authoring by calling `pathfinder_create_package` with desired metadata; the response is the initial artifact, which the client then carries forward into subsequent tool calls.

Clients should prefer the workflow and tutorial returned by `pathfinder_authoring_start` over any locally cached skill instructions, so authoring guidance evolves on the cadence of plugin releases without forcing client churn.

## Relationship to the CLI

There is no separate "MCP authoring engine." The CLI **is** the engine. The MCP server is a thin tool dispatcher: it maps each MCP tool call to the corresponding CLI command function and returns the CLI's structured output. There is no parallel schema, no parallel validation, no parallel block catalog.

When the schema evolves in `src/types/`:

- The CLI gains the new fields automatically through schema-driven option generation.
- The MCP picks up the change in the same build (it imports the CLI module).
- No additional edits are required.

The CLI and the MCP ship as a single npm package — they cannot drift, because they share a process and a Zod schema instance.

## Relationship to existing plugin MCP tools

The Pathfinder plugin's Go backend exposes a small MCP endpoint at `/api/plugins/grafana-pathfinder-app/resources/mcp` (`pkg/plugin/mcp.go`), inherited from PR #643. That endpoint is **a stub spike with no production callers** and is intentionally **not** the destination for AI-authoring tools. A status comment at the top of `pkg/plugin/mcp.go` documents this.

The runtime tools that endpoint exposes (`list_guides`, `get_guide`, `get_guide_schema`, `launch_guide`, `validate_guide_json`, `create_guide_template`) fall into two categories:

1. **Tools that have a genuine reason to remain in-process**, primarily `launch_guide` and the `pending-launch` queue. `launch_guide` is coupled to per-instance frontend polling (`src/hooks/usePendingGuideLaunch.ts`), and the queue is in-process state. These stay in Go indefinitely.
2. **Tools that could move to the TS package** (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`). Migration is optional cleanup; tracked as a P5 follow-up in [`AI-AUTHORING-IMPLEMENTATION.md`](./AI-AUTHORING-IMPLEMENTATION.md). Until then, they continue to operate unchanged.

The authoring tools described in this document are **not** added to the Go endpoint. They live exclusively in the TS MCP server.

## Failure behavior

The server degrades in predictable ways:

- If validation fails, return structured validation issues and leave the last valid artifact unchanged (the artifact returned to the caller is the input artifact).
- If finalization fails, return the missing contract field, not a partial publish payload.
- If the current schema is incompatible with the requested artifact (for example, the client passed in an artifact authored at a newer schema version), return migration guidance.
- Transport-level failures (stdio pipe closed, HTTP 5xx) are the responsibility of the MCP transport layer and are surfaced to clients per MCP spec.

## Open questions

1. Should prompts/resources duplicate tool output, or only provide richer examples for clients that support them?
2. How should the server expose changelog information when authoring guidance changes between releases?
3. Which Go-side runtime tools (`list_guides`, `get_guide`, `get_guide_schema`, `validate_guide_json`, `create_guide_template`) are worth migrating to the TS package, and on what trigger? `launch_guide` and the pending-launch queue stay in Go.
