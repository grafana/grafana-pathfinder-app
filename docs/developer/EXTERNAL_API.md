# External import API

Pathfinder exposes an HTTP endpoint for pushing interactive guides into a Grafana stack from outside the in-product editor. This is the entry-point for CI pipelines, Terraform, and ad-hoc scripts.

> **The handler lives in the backend repo**, not this one. The authoritative reference is [`grafana/grafana-pathfinder-backend/docs/EXTERNAL_API.md`](https://github.com/grafana/grafana-pathfinder-backend/blob/main/docs/EXTERNAL_API.md). This page is a pointer plus a quick example for app-repo readers.

## Endpoint

```
POST {stack}/api/plugins/pathfinderbackend-app/resources/v1/import
```

`{stack}` is your Grafana base URL (Cloud: `https://<stack>.grafana.net`; local OSS: typically `http://localhost:3000`).

## Authentication

Standard Grafana service-account Bearer token. The caller needs `plugins.app:access` on `pathfinderbackend-app`.

## Request body

```json
{
  "kind": "InteractiveGuide",
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki",
    "schemaVersion": "1.0",
    "blocks": [{ "type": "markdown", "content": "# Welcome" }]
  },
  "overwrite": false
}
```

- `spec` is the same shape produced by the editor's **Library → Export** flow (without the Kubernetes envelope — extract with `jq .spec my-export.json`).
- `overwrite: true` replaces an existing guide with the same slugified name. The default is to return 409 if the resource already exists.
- The resource name is derived server-side by slugifying `spec.id` (or `spec.title` if `id` is absent), matching the rule used by `useBackendGuides.saveGuide`.
- The namespace is server-derived; `metadata.namespace` in the body is ignored.

## Response

```json
{
  "created": true,
  "resourceName": "intro-to-loki",
  "namespace": "stacks-12345",
  "resourceVersion": "47291"
}
```

`created` is `true` for new guides, `false` for overwrite-update.

## Quick example

```bash
SPEC=$(jq -c .spec my-exported-guide.json)
curl -sS -X POST \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H "Content-Type: application/json" \
  "${STACK_URL}/api/plugins/pathfinderbackend-app/resources/v1/import" \
  -d "{\"kind\":\"InteractiveGuide\",\"spec\":${SPEC},\"overwrite\":true}"
```

## Choosing this vs. the aggregated API

The aggregated Kubernetes-style API at `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/...` is also externally callable and supports the full CRUD lifecycle (list, get, delete). Use it when you need read-side access or a kubectl-shaped client.

Use this `/v1/import` endpoint when you specifically want the friendly upsert semantics without hand-wrapping the Kubernetes envelope or doing the GET-then-PUT-with-`resourceVersion` dance yourself.

## Full reference

For the complete error matrix, versioning policy, and roadmap (including v1.1 RBAC and `spec.status` round-trip plans), see the backend repo's [`docs/EXTERNAL_API.md`](https://github.com/grafana/grafana-pathfinder-backend/blob/main/docs/EXTERNAL_API.md).
