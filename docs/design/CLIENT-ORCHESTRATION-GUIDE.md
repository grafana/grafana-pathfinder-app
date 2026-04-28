# Client orchestration guide

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Uses [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md), [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md), and [Viewer deep link contract](./VIEWER-DEEP-LINK-CONTRACT.md).

## Purpose

Client orchestration is the behavior an AI agent follows when using the Pathfinder authoring MCP service. A client may be Grafana Assistant, Cursor, Claude Desktop, or another MCP-capable agent.

The client owns reasoning and user interaction. The MCP service owns Pathfinder-specific tools and authoring context.

## Responsibilities

The client should:

1. Understand the user's guide goal.
2. Ask clarifying questions when necessary.
3. Connect to the Pathfinder authoring MCP at `/api/plugins/grafana-pathfinder-app/resources/mcp`.
4. Call `pathfinder_authoring_start` to receive the current authoring context (always the first tool call).
5. Use deterministic MCP tools to build the guide. Use `pathfinder_help` to discover field-level details for any block type rather than guessing.
6. Inspect and validate the artifact.
7. Ask the user whether to save as draft, publish, export, or discard.
8. If authorized inside Grafana and App Platform is available, use the App Platform handoff to store the guide.
9. Otherwise (non-Grafana clients, or Assistant-on-OSS, or App Platform write failure), fall back to `localExport` — write `content.json` and `manifest.json` to a user-accessible directory.
10. Return a floating Pathfinder viewer link after successful App Platform storage; suppress the link when the path was local export.

The client should not:

- Hand-write raw guide JSON when an MCP tool can perform the mutation.
- Carry locally cached field-level schema knowledge — call `pathfinder_help` instead, so changes ride with plugin releases.
- Publish without explicit user confirmation.
- Invent App Platform endpoints instead of using the handoff contract.
- Return a viewer link before the App Platform write succeeds, or after a local-export fallback.

## Recommended workflow

### 1. Start authoring

Call `pathfinder_authoring_start`.

The response tells the client the current schema version, available tools, and workflow guidance. The client should prefer this server-provided guidance over locally cached skill instructions.

### 2. Clarify guide intent

Ask only the questions needed to create a useful first draft:

- Who is the learner?
- What should they accomplish?
- What Grafana page or workflow should the guide start from?
- Should the guide be read-only, interactive, or able to perform actions?
- Should the result be saved as draft or published after review?

If the user already gave enough context, proceed.

### 3. Build with tools

Use MCP authoring tools to create the package and append blocks in display order.

The client should inspect after major sections or after any error. It should use idempotent container creation when retrying.

### 4. Validate

Call `pathfinder_validate` before finalization.

If validation fails, fix the guide through MCP tools. Do not ask the user to debug raw JSON unless the problem is content-level ambiguity.

### 5. Finalize

Call `pathfinder_finalize_for_app_platform`.

The finalization response contains:

- App Platform resource payload
- Endpoint templates
- Conflict behavior
- Draft/published status guidance
- Viewer link fields

### 6. Confirm persistence

Before writing to Grafana, ask the user for confirmation.

Recommended prompt:

```text
I generated and validated the guide. Do you want me to save it as a draft in this Grafana instance, publish it for users of this instance, or leave it unsaved?
```

Default to draft when the user is unsure.

### 7. Publish through Grafana authority, OR fall back to local export

The handoff response includes both a primary `appPlatform` path and a `localExport` fallback. The client picks one based on its capabilities and the target environment.

**Primary path — App Platform write.** If the client has Grafana instance authority and the target instance supports App Platform (Grafana Cloud or Enterprise with the relevant CRDs):

1. Resolve the current namespace.
2. Fill the namespace into the handoff endpoint template.
3. Set `resource.spec.status` to `draft` or `published`.
4. POST to create.
5. **If the agent passed an explicit `--id`** (intentional overwrite of an existing guide): GET the existing resource, copy `metadata.resourceVersion`, and PUT if the user approved the overwrite. **If the ID was auto-generated** (the common path, with a random suffix): no overwrite check is needed.

**Fallback path — local export.** Three concrete cases trigger the fallback:

1. **Non-Grafana-aware MCP clients** (Cursor, Claude Desktop, etc.) that have no Grafana instance authority. The client already does file I/O in the user's workspace — write the package files there.
2. **Assistant-on-OSS.** Grafana Assistant now supports Grafana OSS, where App Platform is unavailable. The Assistant turn falls back to local export and tells the user where the files were written.
3. **App Platform write failure.** If the POST/PUT returns a non-recoverable error and the user has chosen not to retry, fall back to local export rather than losing the artifact.

In any of these cases:

- Write `artifact.content` to `<dir>/content.json` and `artifact.manifest` to `<dir>/manifest.json` as pretty-printed JSON.
- The `<dir>` should be in a place the user can find — project workspace, downloads folder, or a path the user names.
- Tell the user where the files were written.
- **Do not return a viewer link.** Local exports are not reachable through the Pathfinder deep-link path; the link only resolves after a successful App Platform write.

### 8. Return the viewer link (only after App Platform write succeeds)

After a successful App Platform write, return the floating viewer link:

```text
https://<grafana-instance>/a/grafana-pathfinder-app?doc=api%3A<resourceName>&panelMode=floating
```

Floating mode is preferred for assistant workflows because it lets the user keep Grafana Assistant and Pathfinder visible at the same time.

If the path was local export instead of App Platform write, **omit the viewer link** and tell the user the files' location instead.

## Grafana Assistant-specific behavior

Grafana Assistant is the primary target client for the full loop because it can operate inside the user's Grafana context. Two cases:

### Assistant on Cloud / Enterprise (App Platform available)

1. Assistant connects to the Pathfinder authoring MCP.
2. Assistant uses MCP tools to generate and validate a guide.
3. Assistant asks the user whether to save as draft or publish.
4. Assistant writes the `InteractiveGuide` resource through the private App Platform endpoint available in that Grafana instance.
5. Assistant returns a floating Pathfinder link to the user.

This split keeps publish authority with the Grafana-authorized client rather than the MCP service.

### Assistant on OSS (App Platform not available)

Grafana Assistant now supports Grafana OSS, where the App Platform `interactiveguides` endpoint does not exist. In this case Assistant falls through to the local-export branch:

1. Assistant connects to the Pathfinder authoring MCP and authors normally through step 6.
2. At publish time, Assistant detects the absence of App Platform (either by capability check at the start of the turn, or by trying the POST and getting a 404).
3. Assistant follows the handoff's `localExport` instructions to write `content.json` and `manifest.json` somewhere the OSS user can locate.
4. Assistant reports the local file path and **does not** return a viewer link.

The MCP service does not need to know which case applies — the same handoff response covers both.

## Error handling

| Failure                                 | Client behavior                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP unreachable                         | Report that authoring is unavailable; the artifact (if any) is still in client memory                                                       |
| Validation failed                       | Use MCP tools to fix the artifact before finalizing                                                                                         |
| App Platform endpoint unavailable       | Fall back to `localExport` — write `content.json`/`manifest.json` to a user-accessible directory and report the path. Suppress viewer link. |
| Resource conflict (explicit `--id`)     | Ask before overwriting; auto-generated IDs do not collide                                                                                   |
| Missing namespace                       | Ask the Grafana environment for namespace or fall back to `localExport`                                                                     |
| Viewer link fails                       | Confirm the resource exists and the current user can read it                                                                                |
| Client lacks Grafana instance authority | Fall back to `localExport` and tell the user another Grafana-authorized actor must perform the App Platform write                           |

The MVP authoring surface is stateless (see [Authoring artifacts — Stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model)), so there is no session that can expire. The client always holds the authoritative artifact between calls and can resume by replaying it into any tool.

## Relationship to skills

A Cursor or Claude skill can package this orchestration behavior for a specific client. The durable contract, however, is the Pathfinder authoring MCP plus this client workflow.

The skill should be thin:

- Call `pathfinder_authoring_start`.
- Follow server-provided instructions.
- Use MCP tools for mutation and validation.
- Follow the handoff and deep link contracts.

This keeps clients up to date as the server evolves.

## Open questions

1. Should Grafana Assistant expose a standard helper for resolving the current namespace?
2. Should Assistant ask for save/publish confirmation at the beginning, the end, or both?
3. How should non-Grafana clients present an App Platform handoff they cannot execute?
4. Should clients return both a floating link and a normal Pathfinder link?
