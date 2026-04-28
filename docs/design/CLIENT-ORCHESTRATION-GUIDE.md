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
3. Connect to the hosted Pathfinder authoring MCP service.
4. Request the current authoring context.
5. Use deterministic MCP tools to build the guide.
6. Inspect and validate the artifact.
7. Ask the user whether to save as draft, publish, export, or discard.
8. If authorized inside Grafana, use the App Platform handoff to store the guide.
9. Return a floating Pathfinder viewer link after successful storage.

The client should not:

- Hand-write raw guide JSON when an MCP tool can perform the mutation.
- Publish without explicit user confirmation.
- Invent App Platform endpoints instead of using the handoff contract.
- Return a viewer link before the App Platform write succeeds.

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

### 7. Publish through Grafana authority

If the client has Grafana instance authority, it should:

1. Resolve the current namespace.
2. Fill the namespace into the handoff endpoint template.
3. Set `resource.spec.status` to `draft` or `published`.
4. POST to create.
5. On conflict, GET the existing resource, copy `metadata.resourceVersion`, and PUT if the user approved overwrite/update.

If the client does not have Grafana authority, it should return the generated package or handoff artifact and explain that another Grafana-authorized actor must perform the write.

### 8. Return the viewer link

After a successful write, return the floating viewer link:

```text
https://<grafana-instance>/a/grafana-pathfinder-app?doc=api%3A<resourceName>&panelMode=floating
```

Floating mode is preferred for assistant workflows because it lets the user keep Grafana Assistant and Pathfinder visible at the same time.

## Grafana Assistant-specific behavior

Grafana Assistant is the primary target client for the full loop because it can operate inside the user's Grafana context.

Expected behavior:

1. Assistant connects to the Pathfinder authoring MCP.
2. Assistant uses MCP tools to generate and validate a guide.
3. Assistant asks the user whether to save as draft or publish.
4. Assistant writes the `InteractiveGuide` resource through the private App Platform endpoint available in that Grafana instance.
5. Assistant returns a floating Pathfinder link to the user.

This split keeps publish authority with the Grafana-authorized client rather than the MCP service.

## Error handling

| Failure                           | Client behavior                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| MCP unreachable                   | Report that authoring is unavailable; the artifact (if any) is still in client memory |
| Validation failed                 | Use MCP tools to fix the artifact before finalizing                                   |
| App Platform endpoint unavailable | Explain that the guide was generated but cannot be stored in this instance            |
| Resource conflict                 | Ask before overwriting unless the user explicitly requested update                    |
| Missing namespace                 | Ask the Grafana environment for namespace or report that publish cannot proceed       |
| Viewer link fails                 | Confirm the resource exists and the current user can read it                          |

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
