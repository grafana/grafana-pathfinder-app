# Grafana App Platform publish handoff

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Produced by [Pathfinder authoring MCP service](./HOSTED-AUTHORING-MCP.md) and consumed by [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md).
> Viewer links are defined in [Viewer deep link contract](./VIEWER-DEEP-LINK-CONTRACT.md).

## Purpose

The publish handoff lets the Pathfinder authoring MCP prepare a completed guide for storage in a Grafana instance without itself performing the App Platform write.

The MCP service returns a machine-actionable App Platform resource payload and exact instructions. A Grafana-authorized client, such as Grafana Assistant, performs the final POST or PUT through the user's Grafana instance.

## Why handoff instead of direct write

Although the authoring MCP runs inside the Grafana plugin (see [Pathfinder authoring MCP service — Where it runs](./HOSTED-AUTHORING-MCP.md#where-it-runs)), it is an MCP server reachable by external clients and is responsible for authoring, not for executing writes against the App Platform on the user's behalf. Grafana Assistant, when running inside a user's Grafana context, has the authority needed to call private instance APIs and is the natural actor for the final write.

This split preserves the right boundaries:

- MCP service owns guide authoring and validation.
- Grafana Assistant owns instance-authenticated writes.
- App Platform owns instance-scoped persistence and authorization.
- The user owns the save/publish decision.

## Target resource

The current Pathfinder custom-guide storage target is an App Platform resource:

```json
{
  "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
  "kind": "InteractiveGuide",
  "metadata": {
    "name": "hello-world"
  },
  "spec": {
    "id": "hello-world",
    "title": "Hello world",
    "schemaVersion": "1.1.0",
    "blocks": [],
    "status": "draft"
  }
}
```

`metadata.name` is the App Platform resource name and the key used by Pathfinder deep links. It must be stable after first publication.

## Handoff tool

The MCP service exposes a finalization tool named `pathfinder_finalize_for_app_platform`.

Inputs:

```json
{
  "artifact": { "content": { ... }, "manifest": { ... } },
  "status": "draft"
}
```

The artifact is passed in directly, matching the [stateless model](./AUTHORING-SESSION-ARTIFACTS.md#stateless-model) used by all authoring tools. There is no `sessionId`. There is no separate `resourceName` input — the App Platform resource name is taken from `artifact.content.id`, which is already kebab-shaped and validated by the CLI (see [Agent authoring CLI](./AGENT-AUTHORING.md#create) for the canonical ID format).

`status` defaults to `draft`. The client should use `published` only after explicit user confirmation.

## Handoff output

The tool returns structured fields, not only prose instructions:

```json
{
  "status": "ready",
  "id": "hello-world",
  "title": "Hello world",
  "validation": {
    "isValid": true,
    "errors": [],
    "warnings": []
  },
  "appPlatform": {
    "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
    "kind": "InteractiveGuide",
    "resource": "interactiveguides",
    "namespacePlaceholder": "{namespace}",
    "collectionPathTemplate": "/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{namespace}/interactiveguides",
    "itemPathTemplate": "/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{namespace}/interactiveguides/hello-world",
    "createMethod": "POST",
    "updateMethod": "PUT"
  },
  "resource": {
    "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
    "kind": "InteractiveGuide",
    "metadata": {
      "name": "hello-world"
    },
    "spec": {
      "id": "hello-world",
      "title": "Hello world",
      "schemaVersion": "1.1.0",
      "blocks": [],
      "status": "draft"
    }
  },
  "viewer": {
    "docParam": "api:hello-world",
    "path": "/a/grafana-pathfinder-app?doc=api%3Ahello-world",
    "floatingPath": "/a/grafana-pathfinder-app?doc=api%3Ahello-world&panelMode=floating"
  },
  "instructions": [
    "Resolve the current Grafana namespace.",
    "Ask the user whether to save as draft or publish.",
    "POST resource to collectionPathTemplate for create.",
    "If the resource already exists, GET it, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to itemPathTemplate.",
    "After a successful write, send the user viewer.floatingPath on their Grafana instance."
  ]
}
```

The `id` field at the top level is the canonical package identifier — equal to `artifact.content.id`, `artifact.manifest.id`, `resource.metadata.name`, and the resource name embedded in `appPlatform.itemPathTemplate` and `viewer.docParam`. It is not transformed at any boundary. There is no separate `resourceName` field. Clients fill `metadata.namespace` into the `resource` object if the App Platform API requires it.

## Create and update behavior

Recommended client behavior:

1. Resolve current Grafana namespace.
2. Ask user whether to save as draft or publish.
3. Set `resource.spec.status` to the selected status.
4. Try to create with `POST /apis/.../namespaces/{namespace}/interactiveguides`.
5. If the resource exists, ask before overwriting unless the user already requested update.
6. For update, fetch the existing resource, copy `metadata.resourceVersion`, and `PUT /apis/.../interactiveguides/{id}`.
7. Return the viewer link after success.

This matches the existing block editor's optimistic concurrency model, where `resourceVersion` protects against clobbering concurrent edits.

## Draft versus published

`draft` means the guide is saved to the instance but not visible in the Pathfinder docs panel. `published` means the guide is visible to users of that Grafana instance.

The default should be `draft` unless the user explicitly asks to publish. Client agents should not publish silently.

## Validation requirements

The MCP service must validate before returning `status: "ready"`. If validation fails, it should return `status: "invalid"` and omit the App Platform write payload or mark it unusable.

The Grafana-authorized client may also validate defensively before writing, but the MCP service is the primary authoring validation boundary.

## Fields dropped at publish (MVP)

The current `InteractiveGuide` CRD only persists content-shaped fields. The authoring artifact is package-shaped — it carries a fully-formed `manifest.json` alongside `content.json` (see [Authoring artifacts — Artifact shape](./AUTHORING-SESSION-ARTIFACTS.md#artifact-shape)) — but the MVP publish path projects only `artifact.content` into the resource `spec`.

The following manifest fields are present in the artifact, used for in-flight authoring, and **dropped on the way to the CRD**:

- `description`
- `language`
- `category`
- `author`
- `startingLocation`
- `depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`
- `targeting`
- `milestones` (for `path` and `journey` package types)
- `repository`

This means a guide created by AI authoring and persisted to the CRD today carries only its content, title, and ID into Grafana. A user editing the published guide later through the block editor will not see the manifest data the AI generated.

Authoring tools still produce correctly-shaped manifest data inside the artifact because:

- The manifest is required input for future package export (`pathfinder_export_package`), independent of CRD persistence.
- Round-tripping the manifest is a future improvement that requires extending the CRD; producing it correctly today means no schema migration of historical artifacts will be needed.
- Clients that know the manifest is present can choose to export the package as a file rather than (or in addition to) publishing to the CRD.

**Future improvement.** Extending the CRD to carry manifest fields — either as a peer of `spec` or as a sub-field — lights up persistence without changing the authoring tool surface or the artifact shape. This is out of scope for the MVP. See [open question 1](#open-questions).

## Open questions

1. What is the smallest change to the `InteractiveGuide` CRD that round-trips `manifest.json` data — a peer field, a `spec.manifest` sub-field, or a separate paired resource? When this is decided, the publish handoff projects the artifact's manifest into that location instead of dropping it.
2. Should the MCP service include a suggested `id` collision policy when the chosen ID already exists in the target namespace?
3. Should clients always ask before overwriting an existing `InteractiveGuide`, or can some contexts opt into update-by-default?
4. Should the handoff include a source/provenance annotation once the App Platform resource schema supports it?
