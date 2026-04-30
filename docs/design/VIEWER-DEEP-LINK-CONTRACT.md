# Viewer deep link contract

> Part of [Pathfinder AI authoring](./PATHFINDER-AI-AUTHORING.md).
> Consumed by [Grafana App Platform publish handoff](./APP-PLATFORM-PUBLISH-HANDOFF.md) and [Client orchestration guide](./CLIENT-ORCHESTRATION-GUIDE.md).

## Purpose

After an AI client publishes a generated guide into a Grafana instance, it needs a URL it can give the user to immediately view that guide.

The viewer deep link contract defines how a published App Platform `InteractiveGuide` resource maps to a Pathfinder URL.

## Existing resolution path

Pathfinder already supports custom backend guides through the `doc` query parameter:

```text
/a/grafana-pathfinder-app?doc=api:<resourceName>
```

At runtime:

1. `module.tsx` reads the `doc` query parameter.
2. `findDocPage()` maps `api:<resourceName>` to `backend-guide:<resourceName>`.
3. `fetchContent()` sees the `backend-guide:` prefix.
4. `fetchContent()` loads the App Platform `InteractiveGuide` resource from the current Grafana namespace.
5. Pathfinder renders the guide in a tab.

## Link fields

The MCP publish handoff should return these fields:

```json
{
  "docParam": "api:hello-world-x7q2k1",
  "path": "/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1",
  "floatingPath": "/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1&panelMode=floating"
}
```

The client turns `path` or `floatingPath` into an absolute URL by resolving it against the current Grafana instance origin.

Example:

```text
https://example.grafana.net/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1&panelMode=floating
```

The trailing `-x7q2k1` segment is the auto-generated random suffix that the CLI's `create` command appends to keep IDs unique without a pre-publish lookup (see [Agent authoring CLI — `create`](./AGENT-AUTHORING.md#create)). When an agent passes an explicit `--id`, the suffix is absent and the URL uses the supplied ID verbatim (e.g., `?doc=api%3Ahello-world`).

## Floating mode

For Grafana Assistant workflows, the recommended link is `floatingPath`.

```text
/a/grafana-pathfinder-app?doc=api%3Ahello-world-x7q2k1&panelMode=floating
```

`panelMode=floating` avoids competition between Grafana Assistant and Pathfinder for the right-hand sidebar. Pathfinder already supports this mode when opening guide links.

## Resource name requirement

The link key is the App Platform resource name:

```json
{
  "metadata": {
    "name": "hello-world"
  }
}
```

The Pathfinder authoring design unifies all package-level identifiers — `metadata.name` equals `content.id` equals `manifest.id` equals the package directory name. There is no transformation between them, no derivation step at the publish boundary, and no separate `resourceName` field. The single canonical kebab-case `id` is enforced at authoring time by the CLI's Zod schema (see [Agent authoring CLI — `create`](./AGENT-AUTHORING.md#create)) so it is guaranteed valid as a Kubernetes resource name.

The publish handoff returns this value as the top-level `id` field; the same value appears in `resource.metadata.name`, `appPlatform.itemPathTemplate`, and `viewer.docParam`. See [Grafana App Platform publish handoff — Handoff output](./APP-PLATFORM-PUBLISH-HANDOFF.md#handoff-output).

Changing `metadata.name` after publication changes the viewer URL. Existing links will no longer resolve unless the old resource remains available.

## Encoding

The `doc` parameter value should be URL encoded when placed into a browser URL:

| Raw value         | Encoded query fragment  |
| ----------------- | ----------------------- |
| `api:hello-world` | `doc=api%3Ahello-world` |

The handoff should return prebuilt relative paths so clients do not have to guess encoding behavior.

## Status and visibility

The deep link can only load a guide that the current Grafana user can read from the App Platform endpoint.

Recommended client behavior:

- If saved as `draft`, return the link only to users who can read the draft resource and explain that it may not be visible to regular users.
- If saved as `published`, return the link as the normal share/view URL for users of that Grafana instance.
- If the App Platform write fails, do not return a viewer link as if it were live.

## Deep links require an App Platform write

The viewer deep link only resolves to a guide that exists as an `InteractiveGuide` resource in the user's Grafana instance. **It does not resolve any other path.**

Specifically:

- The link does not resolve a local-export package on the user's filesystem. If the agent fell back to `localExport` (see [Grafana App Platform publish handoff — Local-export fallback](./APP-PLATFORM-PUBLISH-HANDOFF.md#local-export-fallback)) — for non-Grafana clients or for Assistant-on-OSS — the agent must suppress the viewer link and tell the user where the local files were written instead.
- The link does not resolve before a successful POST/PUT. The agent should never give the user the link until the App Platform write returns success.
- The link does not resolve in environments without App Platform (Grafana OSS today). The handoff response still contains `viewer.path`, but the agent should treat it as inert in those environments.

## Failure behavior

If the user opens a link before the guide exists, Pathfinder will fail to load the backend guide. The client should return the viewer link only after the POST or PUT succeeds.

If the backend API is unavailable in the target Grafana instance, the client should report that the guide was generated but could not be stored or viewed through Pathfinder custom guides, and follow `localExport` to preserve the work.

## Future considerations

1. A future URL may include a `source` query parameter for analytics attribution, for example `source=assistant`.
2. If App Platform resources later support stable aliases, links could use aliases instead of `metadata.name`.
3. A future publish tool may return both edit and view links if Pathfinder exposes editor deep links for custom guides.
