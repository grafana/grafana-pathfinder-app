# External guide-import API

`POST /v1/guides/import` is a Grafana plugin resource endpoint served
by `grafana-pathfinder-app`. It lets external tooling — CI, Terraform,
ad-hoc scripts — push interactive guides into a Grafana stack with a
single, opinionated request.

The handler accepts the same `spec` shape the editor exports, derives
the resource name server-side, and proxies the call to Grafana's K8s
aggregator (`pathfinderbackend.ext.grafana.com/v1alpha1/interactiveguides`)
using the plugin's own service-account token. Callers never have to
wrap a Kubernetes envelope or do the GET-then-PUT-with-`resourceVersion`
dance themselves.

## When to use this vs. the K8s aggregated API

| You want to…                                                      | Use                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Push a guide from CI / Terraform / a script.                      | **`POST /v1/guides/import`** (this doc).                                      |
| Build something that lists, gets, or deletes guides.              | The aggregated API at `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/...`. |
| Mirror exactly what the in-product editor does for a single save. | The aggregated API.                                                           |

The import endpoint owns the friendlier UX: it takes the same `spec`
shape the editor exports, slugifies the resource name, picks `POST`
vs. `PUT` for you, and renders errors with stable codes.

## Endpoint

```
POST {stack}/api/plugins/grafana-pathfinder-app/resources/v1/guides/import
```

`{stack}` is your Grafana base URL (Cloud: `https://<stack>.grafana.net`;
local OSS: typically `http://localhost:3000`).

## Authentication and authorisation

Standard Grafana service-account token in
`Authorization: Bearer <token>`.

The plugin defines three roles in
[`src/plugin.json`](../../src/plugin.json):

| Role                        | Grafana grant | Actions                                     |
| --------------------------- | ------------- | ------------------------------------------- |
| Interactive learning User   | `Viewer`      | `…docs:read`, `…guides:read`                |
| Interactive learning Writer | `Editor`      | `…:read`, `…guides:write`                   |
| Interactive learning Admin  | `Admin`       | `…:read`, `…guides:write`, `…guides:delete` |

Import requires the **Editor** or **Admin** role. The handler enforces
this server-side via `req.PluginContext.User.Role`. Calls from a Viewer
token return **403**; calls without a user context return **401**.

The plugin also declares `iam.permissions` granting its own service
account read/write on `pathfinderbackend.ext.grafana.com/interactiveguides`
so the outbound aggregator call succeeds.

## Request

```json
{
  "kind": "InteractiveGuide",
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki",
    "schemaVersion": "1.0",
    "status": "draft",
    "blocks": [{ "type": "markdown", "content": "# Welcome\n\nLet's get started." }]
  },
  "overwrite": false
}
```

| Field       | Type    | Required | Description                                                                                                                                                                     |
| ----------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | string  | yes      | Must be `"InteractiveGuide"` in v1. Reserved for future kinds (e.g. `GuideCompletion`).                                                                                         |
| `spec`      | object  | yes      | The InteractiveGuide spec — same shape served by the aggregated API. The aggregator's CRD schema is the validator; this endpoint passes the spec through without re-validation. |
| `overwrite` | boolean | no       | When `true`, replaces the existing resource with the same slugified name. When `false` (default), the call returns 409 if the resource already exists.                          |

### Spec fields

| Field           | Type   | Required            | Description                                                                                                                                                                                                    |
| --------------- | ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string | one of `id`/`title` | Stable identifier for the guide. Used to derive the resource name.                                                                                                                                             |
| `title`         | string | one of `id`/`title` | Human-readable title. Used as the slug source when `id` is empty.                                                                                                                                              |
| `schemaVersion` | string | no                  | Optional content-format version (e.g. `"1.0"`).                                                                                                                                                                |
| `status`        | string | no                  | Publication status. Valid values: `"draft"` (hidden from the docs panel; visible in the editor library only) and `"published"` (live in the docs panel). When omitted, the editor treats the guide as a draft. |
| `blocks`        | array  | yes (may be empty)  | Content blocks. The authoritative schema lives in [grafana-pathfinder-backend/kinds/interactiveguide.cue](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue).         |

### Resource-name slug rule

The resource name is derived from `spec.id` (or `spec.title` if `id`
is empty). The rule mirrors the editor's slug logic in
`src/components/block-editor/hooks/useBackendGuides.ts:110-116` so
guides imported via this endpoint and saved via the editor share names:

1. Lowercase.
2. Replace any character outside `[a-z0-9-]` with `-`.
3. Collapse repeated `-` into a single `-`.
4. Trim leading/trailing `-`.

If both `spec.id` and `spec.title` slugify to the empty string, the
call returns `400 Bad Request`.

### Namespace

The namespace is **server-derived** from `req.PluginContext.Namespace`
(populated by Grafana per request — `stacks-<stack_id>` in Grafana
Cloud, `default` in OSS). Any `metadata.namespace` field in the request
body is ignored — there is no way for an external caller to write
into a different stack via this endpoint.

## Responses

### Success

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "created": true,
  "resourceName": "intro-to-loki",
  "namespace": "stacks-12345",
  "resourceVersion": "47291",
  "status": "draft"
}
```

`created` is `true` when a new resource was added, `false` when an
existing resource was updated via `overwrite`. `status` echoes
`spec.status` from the persisted resource (omitted from the response
when unset).

### Errors

```json
{ "error": "guide \"intro-to-loki\" already exists; pass overwrite=true to replace it" }
```

| HTTP | When                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | Malformed JSON; `kind` is not `"InteractiveGuide"`; both `spec.id` and `spec.title` are empty or unslugifiable; spec is not a JSON object.                                      |
| 401  | No user context — typically a missing/invalid Bearer token rejected by Grafana before the request reaches the plugin.                                                           |
| 403  | Caller does not have `Editor` or `Admin`.                                                                                                                                       |
| 405  | Non-`POST` method on `/v1/guides/import`.                                                                                                                                       |
| 409  | Resource exists and `overwrite` is absent or `false`.                                                                                                                           |
| 422  | The aggregator rejected the resulting resource (e.g. unknown block field). The original message bubbles in the response body.                                                   |
| 501  | Custom guide storage is not available on this Grafana instance — i.e. `aggregation.pathfinderbackend-ext-grafana-com.enabled` is off. This is the OSS / pre-rollout Cloud path. |
| 502  | The aggregator's URL or the plugin SA token is missing from `cfg`, or the aggregator returned an "unavailable" status (`400/403/405/501/503`).                                  |
| 5xx  | Other aggregator errors bubble with their original code and message.                                                                                                            |

**OSS / pre-rollout Cloud:** The handler short-circuits with **501**
before any outbound call when the aggregator feature toggle is off,
mirroring the frontend's `isBackendApiAvailable` gate at
`src/utils/fetchBackendGuides.ts:16-22`. The response body is

```json
{
  "error": "custom guide storage is not available on this Grafana instance; the import API requires the pathfinderbackend.ext.grafana.com aggregator (Grafana Cloud)"
}
```

so callers can detect "this Grafana can't store guides" in one
deterministic call rather than interpreting a 502 from a doomed proxy
attempt.

## Examples

### Create a draft

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H "Content-Type: application/json" \
  "${STACK_URL}/api/plugins/grafana-pathfinder-app/resources/v1/guides/import" \
  -d @- <<'EOF'
{
  "kind": "InteractiveGuide",
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki",
    "blocks": [{ "type": "markdown", "content": "# Welcome" }]
  }
}
EOF
```

### From an editor export

The editor's **Library → Export** flow produces a JSON payload that
includes a Kubernetes envelope. Strip everything but `spec` (e.g. with
`jq .spec`) and wrap it for the import endpoint:

```bash
SPEC=$(jq -c .spec my-exported-guide.json)
curl -sS -X POST \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H "Content-Type: application/json" \
  "${STACK_URL}/api/plugins/grafana-pathfinder-app/resources/v1/guides/import" \
  -d "{\"kind\":\"InteractiveGuide\",\"spec\":${SPEC},\"overwrite\":true}"
```

### Idempotent re-import

```bash
curl -sS -X POST -H "Authorization: Bearer $SA_TOKEN" -H "Content-Type: application/json" \
  "${STACK_URL}/api/plugins/grafana-pathfinder-app/resources/v1/guides/import" \
  -d "{\"kind\":\"InteractiveGuide\",\"spec\":${SPEC},\"overwrite\":true}"
```

## Versioning

The endpoint is path-versioned (`/v1/guides/import`). Breaking changes
to the body shape will land at `/v2/...`; the v1 path will be
maintained for at least one minor release after a v2 ship.

The `kind` discriminator in the body is forward-compatible — when
GuideCompletion or future kinds want import semantics they can land
at the same path with a new `kind` value, no path bump.

## Limitations (v1)

- Single-guide-per-request only.
- No `DELETE` / `LIST` / `GET` on this path — callers use the existing
  K8s aggregated API directly.
- No dry-run.
- RBAC is role-based (Editor/Admin string comparison). A finer-grained
  action-level check via `authz.EnforcementClient` (the SLO/Assistant
  pattern) is on the v1.x roadmap.
- Asset import (images referenced by markdown blocks) is out of scope.

## See also

- [`CUSTOM_GUIDES.md`](CUSTOM_GUIDES.md) — full custom-guide lifecycle.
- [`pkg/plugin/guides_import.go`](../../pkg/plugin/guides_import.go) —
  handler implementation.
- [`pkg/plugin/guides_client.go`](../../pkg/plugin/guides_client.go) —
  K8s aggregator client.
- [`grafana-pathfinder-backend/kinds/interactiveguide.cue`](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue)
  — authoritative spec schema.
