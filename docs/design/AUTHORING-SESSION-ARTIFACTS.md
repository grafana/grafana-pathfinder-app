# Authoring artifacts

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Used by [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md) and [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md).

## Purpose

An authoring artifact is the validated package state produced by an AI client building a Pathfinder guide through MCP tools. The MVP authoring surface is **stateless**: the artifact is passed in to and returned from every mutation tool call. There are no server-side sessions to allocate, persist, or expire. This pairs directly with the CLI shell-out validation strategy — every tool call is a pure function of its arguments (see [Pathfinder authoring MCP service — Validation strategy](./HOSTED-AUTHORING-MCP.md#validation-strategy)).

The artifact can be inspected, validated, exported, or finalized for Grafana App Platform publication.

## Design goals

1. **Keep the model out of raw JSON editing.** The client uses tools to mutate artifact state rather than rewriting whole files.
2. **Make retries safe.** Tool calls support idempotent retries via durable artifact IDs — the package `id` and per-block IDs that the CLI auto-assigns when the author does not supply one (see [Agent authoring CLI — Auto-assignment of IDs](./AGENT-AUTHORING.md#auto-assignment-of-ids)).
3. **Preserve validated checkpoints.** A failed mutation returns the previous valid artifact unchanged, never a partial write.
4. **Support handoff.** Final artifacts must be convertible to App Platform `InteractiveGuide` resources and deep links.
5. **Allow future export.** The artifact model retains enough package structure to export `content.json`, `manifest.json`, and eventually assets.

## Stateless model

Every mutation tool call has the shape:

```
input:  { artifact, mutation_args }
output: { artifact, validation, hints }
```

The MCP holds no session, no checkpoint counter, no per-client lifecycle state. Tool calls are pure functions of their arguments. The client carries the artifact between calls and passes it back on every mutation.

This is feasible because:

- The CLI's [validate-on-write](./AGENT-AUTHORING.md#validate-on-write) model means failed mutations leave the artifact unchanged — there is no notion of a "half-applied" state to recover from.
- All addressable elements have durable IDs in the artifact itself. Retries refer to blocks by ID, not by index or session-scoped handle.
- Idempotency for container creation is provided by the CLI's `--if-absent` flag, which is a property of the artifact's contents, not of any session.

If future scale or UX requirements demonstrate a need for server-side sessions (very large artifacts that are expensive to round-trip, multi-actor concurrent edits, latency targets the round-trip violates), a stateful model can be layered in later. The MVP avoids that complexity entirely.

## Artifact shape

The canonical artifact is package-shaped, mirroring the CLI's two-file package model. Even though the MVP App Platform target only persists content-shaped fields, the manifest is generated correctly into the artifact and is preserved end-to-end by the authoring tools — only the publish step strips it. See [Grafana App Platform publish handoff — Fields dropped at publish](./APP-PLATFORM-PUBLISH-HANDOFF.md#fields-dropped-at-publish-mvp).

```json
{
  "content": {
    "schemaVersion": "1.1.0",
    "id": "hello-world",
    "title": "Hello world",
    "blocks": []
  },
  "manifest": {
    "schemaVersion": "1.1.0",
    "id": "hello-world",
    "type": "guide",
    "description": "A first guide generated with Pathfinder AI authoring"
  },
  "assets": [],
  "metadata": {
    "createdBy": "mcp",
    "authoringContextVersion": "2026-04-28.1"
  }
}
```

The `content.id` and `manifest.id` are required to match — this is a cross-file consistency check enforced by the CLI. They are kebab-case (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) and serve as the canonical package identifier, used unchanged as the App Platform `metadata.name` and the viewer deep link key.

## Validate-on-write model

Mutation tools follow the CLI validate-on-write model:

1. Receive the current artifact and the requested mutation in the tool call.
2. Apply the mutation by invoking the bundled `pathfinder-cli` binary against a serialized copy of the artifact.
3. The CLI validates the full artifact.
4. If validation passes, the CLI writes the new artifact; the MCP returns the new artifact to the client.
5. If validation fails, the CLI returns structured errors and does not write; the MCP returns the original artifact and the validation errors to the client.

The artifact is the source of truth between calls. There is no MCP-side cache, no persisted scratch state, no expiration.

## Idempotency

Retries are safe by construction:

- **Container creation** is idempotent via the CLI's `--if-absent` flag. If the container exists and matches the requested fields, the call is a no-op; if it differs, the call returns a conflict error; if it is absent, it is created.
- **Leaf block creation** is append-first. A retry of `add-block` for a leaf creates an additional block. To avoid duplicates after an ambiguous failure, clients should `inspect` the artifact and confirm state before retrying. The artifact is small enough that round-tripping is cheap.
- **Edit and remove** target blocks by their durable ID. Repeating an `edit-block` call with identical fields produces the same artifact. Repeating a `remove-block` call after the block is gone returns "not found," which the client treats as success.

This is the artifact-equivalent of conditional updates without ETags: the artifact's contents are themselves the state the client is conditioning on.

## Finalization output

Finalization does not persist into Grafana. It produces a handoff artifact consumed by a Grafana-authorized client.

Finalization output must include:

- Current artifact summary
- Validation result
- App Platform `InteractiveGuide` resource payload (content-shaped; manifest data is artifact-local and stripped on the way to the CRD for the MVP)
- POST/PUT endpoint templates
- Draft/published status recommendation
- Viewer deep link fields

The exact handoff contract is defined in [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md).

## Open questions

1. How should assets be represented in the artifact before App Platform supports package assets?
2. When the CRD is extended to carry manifest fields (see [open question 1 in the publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md#open-questions)), what is the smallest change to the artifact-to-resource projection that lights up manifest persistence end-to-end?
3. If a future need for stateful sessions emerges, what concrete signal triggers the transition — artifact size, multi-actor editing, or latency targets?
