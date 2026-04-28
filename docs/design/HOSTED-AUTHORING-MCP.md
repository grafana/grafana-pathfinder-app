# Pathfinder authoring MCP service

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Depends on [Agent authoring CLI](./AGENT-AUTHORING.md) and [Authoring artifacts](./AUTHORING-SESSION-ARTIFACTS.md).

## Purpose

The Pathfinder authoring MCP service is the endpoint that AI clients use to author Pathfinder guides. It exposes the current authoring context, deterministic guide-authoring tools, and a finalization tool that prepares artifacts for Grafana App Platform publishing.

The service is not a replacement for the AI client. The client still reasons about the user's goal, asks clarifying questions, and decides what content to create. The MCP service owns the Pathfinder-specific authoring contract and makes that contract discoverable at runtime.

## Where it runs

The authoring MCP service is **not a new, centrally hosted service**. It is an extension of the existing plugin MCP endpoint at `/api/plugins/grafana-pathfinder-app/resources/mcp` (`pkg/plugin/mcp.go`).

This has direct consequences for the design:

- Authn and authz are inherited from Grafana's plugin resource endpoint contract. No new identity provider, rate limiter, or tenant model to build.
- Updates ship via plugin releases, alongside frontend, backend, and CLI changes. The whole authoring stack moves in lockstep.
- The endpoint is per-Grafana-instance, in-process. There is no multi-tenant hosted infrastructure.
- It can serve any MCP-capable client that can reach the Grafana instance.

An earlier draft of this design proposed a separately hosted MCP service so authoring updates could ship without client churn. We instead achieve "ship without client churn" by treating the plugin release as the unit of update and by [thin-client orchestration](./CLIENT-ORCHESTRATION-GUIDE.md) — clients call `pathfinder_authoring_start` and follow server-provided instructions rather than carrying authoring guidance locally.

## Server responsibilities

The service owns:

1. **Authoring context delivery.** Provide the minimal instructions a model needs to begin authoring and discover more details through tools.
2. **Tool discovery.** Expose MCP tools with machine-readable input schemas and clear descriptions.
3. **Deterministic mutation.** Route authoring operations through the bundled `pathfinder-cli` binary so guide state changes are schema-validating and repeatable.
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

The Go MCP endpoint **performs no schema validation of its own**. All validation lives in the bundled `pathfinder-cli` binary, which is shipped inside the plugin tarball at a known path (e.g., `<plugin-dir>/cli/pathfinder-cli`) and is built from the same TypeScript source as the public `pathfinder-cli` Docker image (see [Agent authoring CLI — Distribution](./AGENT-AUTHORING.md#distribution)).

Each authoring tool call follows this pattern:

1. The Go MCP receives the tool call with the in-flight artifact and mutation arguments.
2. The artifact is serialized to a temporary directory as `content.json` and `manifest.json`.
3. The Go MCP invokes the bundled CLI binary via `exec.Command` with the equivalent CLI subcommand (`create`, `add-block`, `edit-block`, `inspect`, etc.) and `--format json`.
4. The CLI applies the mutation, validates the full package, writes if valid, and emits structured output.
5. The Go MCP reads the updated artifact (or the structured validation errors) and returns the response to the caller.
6. The temporary directory is cleaned up.

This is what makes the design's core property hold end-to-end: **schema-illegal output is impossible because it is impossible in the CLI**, and the CLI is the only place schema knowledge lives. When the schema evolves in `src/types/`, both the public CLI image and the bundled CLI binary move in lockstep — the Go MCP requires no edits.

Per-call cost is dominated by Node startup (~100-200ms cold-start). For a 20-block guide this accumulates to a few seconds across the authoring session, which is acceptable for the MVP. The escape hatch when this becomes a problem is [batch operations](./AGENT-AUTHORING.md#batch-operations) — already on the CLI roadmap — which collapse N mutations into a single CLI invocation.

## MCP surface

The first version prefers tools over optional MCP features because tool support is the most broadly available across clients. Prompts and resources can be added as progressive enhancement.

All authoring tools follow the [stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model): the in-flight artifact is passed in and returned out on every call. There is no `sessionId`.

### Core tools

| Tool                                   | Purpose                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pathfinder_authoring_start`           | Returns current authoring context, schema version, supported workflow, and recommended first actions |
| `pathfinder_create_package`            | Returns a new authoring artifact with `content.json` and `manifest.json` initialized                 |
| `pathfinder_add_block`                 | Appends a block to an artifact using schema-derived input constraints; returns the updated artifact  |
| `pathfinder_add_step`                  | Appends a step to a `multistep` or `guided` block; returns the updated artifact                      |
| `pathfinder_add_choice`                | Appends a choice to a `quiz` block; returns the updated artifact                                     |
| `pathfinder_edit_block`                | Updates fields on an existing block by ID; returns the updated artifact                              |
| `pathfinder_remove_block`              | Removes a block by ID (with `cascade` for non-empty containers); returns the updated artifact        |
| `pathfinder_set_manifest`              | Updates manifest fields on the artifact; returns the updated artifact                                |
| `pathfinder_inspect`                   | Reads artifact summary, block tree, or a specific block                                              |
| `pathfinder_validate`                  | Runs full package validation against an artifact and returns structured issues                       |
| `pathfinder_finalize_for_app_platform` | Returns an `InteractiveGuide` resource payload, publish instructions, and viewer link fields         |

`pathfinder_set_manifest` is included in the MVP tool surface so AI authoring produces correctly-shaped manifest data inside the artifact. **For the MVP, manifest data is artifact-local and is stripped on the way to the App Platform CRD** — the `InteractiveGuide` resource only persists content-shaped fields. Round-trip persistence of manifest data is a future improvement that requires extending the CRD; see [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

### Optional tools

| Tool                                | Purpose                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `pathfinder_export_package`         | Returns a downloadable package bundle or raw `content.json`/`manifest.json`                 |
| `pathfinder_get_authoring_examples` | Returns examples scoped to a block type or workflow                                         |
| `pathfinder_get_block_help`         | Returns concise help for a block type without requiring the client to shell out to CLI help |

## Authoring context

`pathfinder_authoring_start` returns both human-readable instructions and structured fields.

Example shape:

```json
{
  "status": "ok",
  "authoringContextVersion": "2026-04-28.1",
  "schemaVersion": "1.1.0",
  "workflow": [
    "Create a package",
    "Add blocks in display order",
    "Inspect and validate",
    "Finalize for App Platform",
    "Ask the user whether to save draft or publish"
  ],
  "tools": {
    "create": "pathfinder_create_package",
    "inspect": "pathfinder_inspect",
    "finalize": "pathfinder_finalize_for_app_platform"
  },
  "instructions": "Use Pathfinder MCP tools to author guides. The artifact is passed in to and returned from every mutation call. Do not write raw guide JSON. Validate before finalizing."
}
```

This tool does not allocate a session — it returns context only. The client begins authoring by calling `pathfinder_create_package` with desired metadata; the response is the initial artifact, which the client then carries forward into subsequent tool calls.

## Relationship to the CLI

There is no separate "MCP authoring engine." The CLI **is** the engine. The Go MCP endpoint does not duplicate guide schema logic, validation rules, or block catalog summaries — it marshals tool arguments, invokes the bundled CLI binary, and returns the CLI's structured output.

When the schema evolves in `src/types/`:

- The CLI gains the new fields automatically through schema-driven option generation.
- The bundled binary picks up the change through normal builds.
- The Go MCP requires no edits.

This eliminates the drift previously visible in the existing plugin-side MCP, where simplified Go schema summaries had to manually track the canonical Zod schemas.

## Relationship to existing plugin MCP tools

The existing plugin MCP at `/api/plugins/grafana-pathfinder-app/resources/mcp` already exposes runtime tools (`list_guides`, `get_guide`, `launch_guide`, `validate_guide_json`, `create_guide_template`). The authoring tools described here are added to that same endpoint. Existing tools continue to operate as before.

The previously-documented hand-maintained Go schema summaries (`guideSchemas` in `pkg/plugin/mcp.go`) remain in place for those existing tools. New authoring tools do not use them — they delegate to the bundled CLI binary, which is the canonical validator. Over time, existing tools may be migrated to the CLI shell-out pattern to retire those summaries; see [Open questions](#open-questions).

## Failure behavior

The service degrades in predictable ways:

- If the bundled CLI binary is missing or fails to start, the tool returns a structured error indicating an installation problem; the artifact is unchanged.
- If validation fails, return structured validation issues and leave the last valid artifact unchanged (the artifact returned to the caller is the input artifact).
- If finalization fails, return the missing contract field, not a partial publish payload.
- If the current schema is incompatible with the requested artifact (for example, the client passed in an artifact authored at a newer schema version), return migration guidance.

## Open questions

1. Should prompts/resources duplicate tool output, or only provide richer examples for clients that support them?
2. How should the service expose changelog information when authoring guidance changes between plugin releases?
3. Should existing plugin MCP tools (`validate_guide_json`, `create_guide_template`) be migrated to the CLI shell-out pattern as part of the authoring rollout, to retire the hand-maintained Go schema summaries?
