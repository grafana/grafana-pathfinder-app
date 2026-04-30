# External guide-import API

Pathfinder's custom-guide storage is exposed as a Kubernetes-style HTTP
API on every Grafana Cloud stack where the Pathfinder Backend
aggregator is enabled. External tooling — CI pipelines, Terraform,
ad-hoc scripts — can read, write, and delete `InteractiveGuide`
resources directly with a Grafana service-account token. This is the
**same API the in-product editor uses** when you save a guide via
**Library → Save** or **Publish**, so guides written via this API are
indistinguishable from ones authored in the editor.

## When to use this

- CI / Terraform / scripts that push guides into a stack on merge.
- One-off bulk imports or migrations between stacks.
- Anything that needs full lifecycle (`list`/`get`/`create`/`update`/`delete`); the editor only exposes save/publish/unpublish.

For one-off authoring, the in-product editor is still the easier path.

## Prerequisites

- **Grafana Cloud** (or any stack where the
  `aggregation.pathfinderbackend-ext-grafana-com.enabled` feature
  toggle is on). The aggregator does **not** run in OSS Grafana.
- A **Grafana service-account token** with at least the **Editor**
  role on the stack. Create one in **Administration → Users and
  access → Service accounts**.
- The stack's **namespace** — `stacks-<numeric-id>` in Cloud,
  `default` in OSS. The numeric id is the same as the stack id; you
  can also fetch it from `/api/frontend/settings` (key `namespace`).

## Endpoint

```
{stack}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{namespace}/interactiveguides
```

| Operation | Method | Path                         |
| --------- | ------ | ---------------------------- |
| List      | GET    | `…/interactiveguides`        |
| Create    | POST   | `…/interactiveguides`        |
| Get       | GET    | `…/interactiveguides/{name}` |
| Update    | PUT    | `…/interactiveguides/{name}` |
| Delete    | DELETE | `…/interactiveguides/{name}` |

`{name}` is the resource name — typically a slug derived from the
guide id or title. See [Resource-name slug rule](#resource-name-slug-rule).

## Quick start: the upsert script

The repo ships [`scripts/upsert-guide.sh`](../../scripts/upsert-guide.sh),
a small bash helper that handles the create-or-update dance for you:

```bash
# spec.json:
# {
#   "id": "intro-to-loki",
#   "title": "Intro to Loki",
#   "schemaVersion": "1.0",
#   "status": "draft",
#   "blocks": [{ "type": "markdown", "content": "# Welcome" }]
# }

scripts/upsert-guide.sh \
  --stack learn.grafana.net \
  --token "$GRAFANA_SA_TOKEN" \
  --spec ./spec.json
```

The script:

1. Auto-detects the stack namespace from `/api/frontend/settings` (or accepts `--namespace`).
2. Slugifies the resource name from `spec.id` (or `spec.title` if `id` is empty).
3. GETs the existing resource to discover its `resourceVersion`.
4. POSTs (create) or PUTs (update) accordingly.
5. Prints the persisted resource as JSON.

If the spec you have is a **full editor export** (Library → Export — includes a
Kubernetes envelope), pass `--from-export` and the script will pick out the
`.spec` field for you:

```bash
scripts/upsert-guide.sh \
  --stack learn.grafana.net \
  --token "$GRAFANA_SA_TOKEN" \
  --spec ./my-export.json \
  --from-export
```

Requirements: `curl`, `jq`. Run `scripts/upsert-guide.sh --help` for the full reference.

## Authentication

Every request needs a `Authorization: Bearer <service-account-token>`
header. The aggregator's RBAC checks the user's permissions for the
operation:

| Verb                           | Required role      |
| ------------------------------ | ------------------ |
| `get` / `list`                 | Viewer (or higher) |
| `create` / `update` / `delete` | Editor (or higher) |

A 401 response means Grafana didn't accept the token; a 403 means the
token's role is too low for the operation.

## Resource shape

The wire format is the standard Kubernetes envelope:

```json
{
  "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
  "kind": "InteractiveGuide",
  "metadata": {
    "name": "intro-to-loki",
    "namespace": "stacks-12345",
    "resourceVersion": "47291"
  },
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki",
    "schemaVersion": "1.0",
    "status": "draft",
    "blocks": [{ "type": "markdown", "content": "# Welcome\n\nLet's get started." }]
  }
}
```

| Field                      | Required | Description                                                                                                                                                                                                                                                        |
| -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiVersion`               | yes      | Always `pathfinderbackend.ext.grafana.com/v1alpha1`.                                                                                                                                                                                                               |
| `kind`                     | yes      | Always `InteractiveGuide`.                                                                                                                                                                                                                                         |
| `metadata.name`            | yes      | Resource name, typically a slug — see [Resource-name slug rule](#resource-name-slug-rule).                                                                                                                                                                         |
| `metadata.namespace`       | yes      | Must match the namespace in the URL (`stacks-<id>` in Cloud).                                                                                                                                                                                                      |
| `metadata.resourceVersion` | on PUT   | Echoed from a prior GET. Required for updates so the server can detect concurrent writes (you'll get 409 on a stale value — re-GET and retry).                                                                                                                     |
| `spec.id`                  | yes      | Stable identifier for the guide. Persisted alongside the resource name.                                                                                                                                                                                            |
| `spec.title`               | yes      | Human-readable title shown in the editor library and docs panel.                                                                                                                                                                                                   |
| `spec.schemaVersion`       | no       | Optional content-format version (e.g. `"1.0"`).                                                                                                                                                                                                                    |
| `spec.status`              | no       | Publication state. Valid values: `"draft"` (visible only in the editor library) and `"published"` (live in the docs panel). Omitted = treated as draft.                                                                                                            |
| `spec.blocks`              | yes      | Array of content blocks. The full schema is owned by the CUE definition in [grafana-pathfinder-backend/kinds/interactiveguide.cue](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue) — that file is the source of truth. |

The CRD schema **is the validator**. Submit unknown fields and you'll
get a `422 Unprocessable Entity` with a K8s `Status` envelope explaining
which field is wrong.

## Examples

In the examples below, `$STACK` is your Grafana hostname (e.g.
`learn.grafana.net`), `$NS` is your namespace (e.g. `stacks-12345`),
and `$TOKEN` is the service-account token.

### Create

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides" \
  -d @- <<'EOF'
{
  "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
  "kind": "InteractiveGuide",
  "metadata": { "name": "intro-to-loki", "namespace": "stacks-12345" },
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki",
    "schemaVersion": "1.0",
    "status": "draft",
    "blocks": [{ "type": "markdown", "content": "# Welcome" }]
  }
}
EOF
```

Responds 201 with the persisted resource. The returned
`metadata.resourceVersion` is what you'll need for any subsequent update.

### Get

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki"
```

### List

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides"
```

### Update

GET the current resource to read its `resourceVersion`, then PUT with
that version echoed in `metadata.resourceVersion`:

```bash
RV=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki" \
  | jq -r .metadata.resourceVersion)

curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki" \
  -d @- <<EOF
{
  "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
  "kind": "InteractiveGuide",
  "metadata": { "name": "intro-to-loki", "namespace": "${NS}", "resourceVersion": "${RV}" },
  "spec": {
    "id": "intro-to-loki",
    "title": "Intro to Loki (updated)",
    "schemaVersion": "1.0",
    "status": "published",
    "blocks": [{ "type": "markdown", "content": "# Welcome v2" }]
  }
}
EOF
```

If someone else updated the resource between your GET and your PUT,
you get a 409 telling you to re-fetch and retry:

```json
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "code": 409,
  "reason": "Conflict",
  "message": "Operation cannot be fulfilled on interactiveguides.pathfinderbackend.ext.grafana.com \"intro-to-loki\": the object has been modified; please apply your changes to the latest version and try again"
}
```

### Delete

```bash
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki"
```

## Resource-name slug rule

The editor derives resource names from the guide id (or title, if id
is empty) using this rule
([`useBackendGuides.ts:110-116`](../../src/components/block-editor/hooks/useBackendGuides.ts)):

1. Lowercase.
2. Replace any character outside `[a-z0-9-]` with `-`.
3. Collapse repeated `-` into a single `-`.
4. Trim leading/trailing `-`.

If you want a guide imported via the API to share its name with one
saved via the editor, use the same rule. `scripts/upsert-guide.sh`
applies it for you.

## Errors

The aggregator returns standard Kubernetes `Status` envelopes:

```json
{
  "kind": "Status",
  "apiVersion": "v1",
  "status": "Failure",
  "code": 422,
  "reason": "Invalid",
  "message": "InteractiveGuide.pathfinderbackend.ext.grafana.com \"intro-to-loki\" is invalid: spec.blocks[0].type: …"
}
```

Common cases:

| HTTP | Reason        | When                                                                         |
| ---- | ------------- | ---------------------------------------------------------------------------- |
| 401  | -             | Missing or invalid Bearer token.                                             |
| 403  | -             | Token's role is too low for the operation (need Editor for writes).          |
| 404  | NotFound      | The named guide doesn't exist (or, on listing, the namespace doesn't exist). |
| 409  | AlreadyExists | POST against a name that already exists. Use PUT to update.                  |
| 409  | Conflict      | Stale `resourceVersion` on PUT. Re-GET and retry.                            |
| 422  | Invalid       | Spec failed CRD validation — message names the offending field.              |

## Choosing this vs. the editor

| If you want to…                            | Use                 |
| ------------------------------------------ | ------------------- |
| Hand-author a guide with live preview      | The editor in-app   |
| Push 50 guides from a CI run               | This API            |
| Sync guides from a git repo on every merge | This API            |
| Mirror a stack's guides into another stack | This API + list/get |
| Edit a single guide quickly                | The editor in-app   |

## Related

- [`CUSTOM_GUIDES.md`](CUSTOM_GUIDES.md) — full custom-guide lifecycle (draft/publish, the editor library, status badges).
- [`scripts/upsert-guide.sh`](../../scripts/upsert-guide.sh) — the bash helper.
- [`src/components/block-editor/hooks/useBackendGuides.ts`](../../src/components/block-editor/hooks/useBackendGuides.ts) — the editor's frontend client (calls the same endpoints from the browser via the user's session).
- [`grafana-pathfinder-backend/kinds/interactiveguide.cue`](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue) — authoritative CUE schema for the spec.
