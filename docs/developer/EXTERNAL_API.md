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
  `aggregation.pathfinderbackend-ext-grafana-app.enabled` feature
  toggle is on). The aggregator does **not** run in OSS Grafana.
- A **Grafana service-account token** with at least the **Editor**
  role on the stack. Create one in **Administration → Users and
  access → Service accounts**.
- The stack's **namespace** — `stacks-<numeric-id>` in Cloud,
  `default` in OSS. The numeric id is the same as the stack id; you
  can also fetch it from `/api/frontend/settings` (key `namespace`).

## Endpoint

```
{stack}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/{namespace}/interactiveguides
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
# spec.json — only `title` and `blocks` are strictly required; the
# script fills in everything else.
# {
#   "title": "Intro to Loki",
#   "blocks": [{ "type": "markdown", "content": "# Welcome" }]
# }

export PATHFINDER_SA_TOKEN="$GRAFANA_SA_TOKEN"

scripts/upsert-guide.sh \
  --stack learn.grafana.net \
  --spec ./spec.json
```

The script:

1. **Auto-detects the input format** — accepts either a bare spec or a full Kubernetes envelope (e.g. from Library → Export).
2. **Auto-detects the stack namespace** from `/api/frontend/settings` (or accepts `--namespace`).
3. **Fills in missing required fields**: defaults `status` to `"published"` and `schemaVersion` to `"1.0.0"`, and backfills `spec.id` from the slugified `title` when absent.
4. Slugifies the resource name from `spec.id` (or the slugified `spec.title` if `id` is missing).
5. GETs the existing resource to discover its `resourceVersion`.
6. POSTs (create) or PUTs (update) accordingly.
7. Prints the persisted resource as JSON.

To upload as a draft instead of publishing, set `"status": "draft"` explicitly in the spec — values you supply are always preserved.

Requirements: `curl`, `jq`. Run `scripts/upsert-guide.sh --help` for the full reference.

## Uploading a learning path

A learning path or journey is not a special kind — it's an
`InteractiveGuide` whose `spec.manifest.type` is `"path"` or
`"journey"` and whose `spec.manifest.milestones` lists the ids of its
member guides. Each member is its own `InteractiveGuide`.

[`scripts/upsert-learning-path.sh`](../../scripts/upsert-learning-path.sh)
uploads a whole package directory — the two-file `manifest.json` +
`content.json` model used by
[grafana/interactive-tutorials](https://github.com/grafana/interactive-tutorials):

```bash
scripts/upsert-learning-path.sh \
  --stack learn.grafana.net \
  --package ./drilldown-logs-lj
```

It resolves each id in `milestones` to the subdirectory whose
`manifest.json` declares that id — the directory name is not the id
(`drilldown-logs-view-logs` lives in `view-logs/`) — uploads the
milestones first and the path's own cover page last, so the path never
references a guide that doesn't exist yet. Subdirectories absent from
`milestones` are ignored, which keeps website-only prelude pages
(`business-value-*`) out of the upload.

Per-resource create/update is delegated to `upsert-guide.sh`, so the
slug rule, namespace detection, and RBAC are identical. Pass
`--dry-run` to see every payload without writing, and `--help` for the
full flag list. Re-running updates the resources it already uploaded —
see [Not overwriting someone else's
guide](#not-overwriting-someone-elses-guide) for what happens when a
name is already taken by something it didn't upload.

### `spec.id` must be a valid resource name

For a standalone guide, `metadata.name` and `spec.id` may diverge
harmlessly. For a path they must not:

- `manifest.milestones` and the custom-guide catalogue key on **`spec.id`**.
- Milestone resolution and `backend-guide:` content URLs GET by **`metadata.name`**.

`metadata.name` is the slugified `spec.id`, so any id that isn't
already slug-shaped produces a resource the path can't reach, and every
milestone 404s with no error surfaced in the UI. The script refuses to
upload in that case; rename the package instead.

### Block fields the CRD doesn't declare

The CRD's block schema is generated from `_blockFields` / `#Block` /
`#NestedBlock` / `#Step` in `kinds/interactiveguide.cue`. A field the app
accepts and that file does not declare is **silently pruned**: there is
no 422 and no warning from the API, the write returns 200, and the field
is gone on the next GET. Blocks nested three or more levels deep fall
under `x-kubernetes-preserve-unknown-fields` and survive; anything
shallower does not.

The gap is currently the `input` block: `defaultValue`, which costs the
input its prefilled value, and the whole `dataCheck*` family
(`dataCheckQuery`, `dataCheckBlocking`, `dataCheckFailureMessage`,
`dataCheckTimeFrom`, `dataCheckTimeTo`), which lands the picker without
its data check — it renders, and the check simply never runs.

It has been much wider, and it moves in both directions. At one point
the CUE was missing twenty-six fields including `autoCollapse`,
`targetstate` and the `vm*` family; the transcription in
`upsert-learning-path.sh` then fell behind the CUE catching up, so
`--strict-blocks` briefly rejected content the CRD would have accepted.

So don't trust an enumeration in this document, including the one above.
Two things keep it honest instead:

- `upsert-learning-path.sh` warns per resource with the exact fields
  your content would lose, and `--strict-blocks` turns that warning into
  a failure. Run it with `--dry-run` before an upload — that is the live
  check.
- `src/validation/upsert-script-crd-fields.test.ts` fails when the app's
  `KNOWN_FIELDS` gains a block field the script's `BLOCK` allowlist
  lacks, so app-side drift cannot land silently.

Neither can see the backend repo. When the CUE changes, update the
`BLOCK` / `STEP` arrays in `upsert-learning-path.sh` and the
`PRUNED_BY_CRD` set in that test together. A stack running an older
backend prunes more than the current CUE implies, so a warning-free dry
run is a statement about `kinds/interactiveguide.cue` at HEAD, not about
the stack you are uploading to.

### Not overwriting someone else's guide

Resource names are slugified package ids, and a write replaces `spec`
wholesale. A milestone id like `getting-started` will therefore land on
a hand-authored guide of that name — and because the API has no
revision verb and the source repo holds no copy, that overwrite cannot
be undone.

`upsert-learning-path.sh` LISTs the collection before writing — draining
`metadata.continue`, because this API truncates a single-page read
without saying so — and compares provenance. Every resource it uploads
carries:

| Annotation                                         | Value                     |
| -------------------------------------------------- | ------------------------- |
| `pathfinderbackend.ext.grafana.app/managed-by`     | `upsert-learning-path.sh` |
| `pathfinderbackend.ext.grafana.app/source-package` | the root package id       |

A name carrying that `managed-by` value is one of ours and is updated
in place. A name without it belongs to someone else, and the run is
**refused before anything is written** — the check covers every name in
the package up front, so a collision on the cover page cannot leave the
milestones already replaced. Pass `--overwrite` to replace them
deliberately; the summary then reports them as `replaced` rather than
`updated`.

That pre-flight is a snapshot, so each write re-checks ownership too:
`upsert-guide.sh --require-annotation` compares the annotation against
the same GET whose `resourceVersion` the update sends. A resource created
or detached between the listing and the write is refused rather than
replaced.

`upsert-guide.sh` merges its annotations over whatever the resource
already carries, so an update through the scripts preserves annotations
another tool set. The block editor's save, publish, and unpublish do the
same — each carries `metadata.annotations` and `metadata.labels` through
from the resource it last read, so editing a script-uploaded guide no
longer detaches it from the package. The exception is a confirmed
name-collision overwrite, which intentionally inherits neither the
previous resource's `spec.manifest` nor its annotations; after one of
those the next run refuses the package as foreign, and `--overwrite` is
the answer.

`--dry-run` performs the same LIST, so the preview marks each resource
as new, an update, or a collision. It exits non-zero on any validation
failure, which makes it usable as a CI gate. If the stack is
unreachable the collision check is skipped with a warning and the rest
of the validation still runs — the header then prints
`Collisions: not checked`, so a preview that only linted JSON says so.

Re-running is additive. Existing resources are updated in place, but
nothing is ever deleted, so a milestone dropped from `manifest.json`
stays on the stack until removed by hand.

### Undoing a run

There is no revision history on these resources, so a run cannot be
rolled back by the API and reverting the script changes nothing that
already happened. What a completed or half-completed run leaves behind:

| What the run did                          | How to undo it                                                |
| ----------------------------------------- | ------------------------------------------------------------- |
| Created a resource                        | `DELETE` it (see [Delete](#delete))                           |
| Updated one of its own                    | Re-upload the previous package contents                       |
| Replaced a foreign guide                  | Restore from a pre-write export; the API holds no copy        |
| Left a dropped milestone                  | `DELETE` it; the script never deletes                         |
| Failed partway (no `--continue-on-error`) | Fix the cause and re-run — writes are idempotent and converge |

Take an export first if the namespace holds guides you cannot recreate.
`--dry-run` plus the collision refusal is what makes that rarely
necessary, not the ability to undo.

### Keeping the token out of the process table

Both scripts accept the token in `$PATHFINDER_SA_TOKEN` as well as
`--token`, and prefer it:

```bash
export PATHFINDER_SA_TOKEN="$GRAFANA_SA_TOKEN"
scripts/upsert-learning-path.sh --stack learn.grafana.net --package ./drilldown-logs-lj
```

An argv token is readable from the process table by any process running
as the same user for as long as the command runs — a multi-resource
upload is not instant. Inside the scripts the token never reaches curl's
argv either: it goes in a `0600` curl config file, and payloads are sent
with `--data-binary @file`. `--stack` must be a bare hostname with an
optional port; a value carrying userinfo, a path, or a brace expansion is
rejected before the token is attached to anything.

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
  "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
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
| `apiVersion`               | yes      | Always `pathfinderbackend.ext.grafana.app/v1alpha1`.                                                                                                                                                                                                               |
| `kind`                     | yes      | Always `InteractiveGuide`.                                                                                                                                                                                                                                         |
| `metadata.name`            | yes      | Resource name, typically a slug — see [Resource-name slug rule](#resource-name-slug-rule).                                                                                                                                                                         |
| `metadata.namespace`       | yes      | Must match the namespace in the URL (`stacks-<id>` in Cloud).                                                                                                                                                                                                      |
| `metadata.resourceVersion` | on PUT   | Echoed from a prior GET. Required for updates so the server can detect concurrent writes (you'll get 409 on a stale value — re-GET and retry).                                                                                                                     |
| `spec.id`                  | yes      | Stable identifier for the guide. Persisted alongside the resource name.                                                                                                                                                                                            |
| `spec.title`               | yes      | Human-readable title shown in the editor library and docs panel.                                                                                                                                                                                                   |
| `spec.schemaVersion`       | no       | Optional content-format version (e.g. `"1.0"`).                                                                                                                                                                                                                    |
| `spec.status`              | no       | Publication state. Valid values: `"draft"` (visible only in the editor library) and `"published"` (live in the docs panel). Omitted = treated as draft.                                                                                                            |
| `spec.blocks`              | yes      | Array of content blocks. The full schema is owned by the CUE definition in [grafana-pathfinder-backend/kinds/interactiveguide.cue](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue) — that file is the source of truth. |
| `spec.manifest`            | no       | Package metadata: grouping, sequencing, dependencies. Absent for content-only guides. See [Manifest](#manifest).                                                                                                                                                   |

The CRD schema **is the validator**. Submit unknown fields and you'll
get a `422 Unprocessable Entity` with a K8s `Status` envelope explaining
which field is wrong.

### Manifest

`spec.manifest` is what makes a guide a member of a package repository,
and what makes a path a path.

| Field              | Required | Description                                                                                                                                                                    |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`             | yes      | `"guide"`, `"path"`, or `"journey"`. Only `path`/`journey` may carry `milestones`.                                                                                             |
| `repository`       | yes      | Provenance label. Defaults to `"app-platform"` when omitted, so in practice you can leave it out.                                                                              |
| `description`      | no       | Short summary shown in listings and used as the milestone label when the member guide's content isn't loaded.                                                                  |
| `milestones`       | no       | Ordered list of member package ids, for `path`/`journey`. Each id must be the `spec.id` of another `InteractiveGuide` in the namespace.                                        |
| `author`           | no       | `{ name?, team? }`. The CRD declares no other keys; `upsert-learning-path.sh` moves any it finds (`email`, `github`, …) to `additionalFields.author` instead of dropping them. |
| `category`         | no       | Free-form grouping label.                                                                                                                                                      |
| `depends`          | no       | CNF (AND of ORs): an **array of arrays**. A single dependency is a singleton clause — `[["a"], ["b"]]` is "a AND b", `[["a","b"]]` is "a OR b". A bare string is not accepted. |
| `additionalFields` | no       | Free-form escape hatch, `x-kubernetes-preserve-unknown-fields`. Anything not typed above goes here.                                                                            |

`recommends`, `suggests`, `provides`, `targeting`, `testEnvironment`,
`startingLocation`, and the generated `stats` stamp have no typed home yet, so
`upsert-learning-path.sh` writes them under `additionalFields` rather
than dropping them — as it does for any manifest key the CRD doesn't
declare, including surplus `author` subkeys. Note that the frontend reads `recommends` and
`suggests` from the top level of the manifest, so they have no effect
while they live in `additionalFields` — promoting a key out of
`additionalFields` into a real CUE field is additive and safe.

## Examples

In the examples below, `$STACK` is your Grafana hostname (e.g.
`learn.grafana.net`), `$NS` is your namespace (e.g. `stacks-12345`),
and `$TOKEN` is the service-account token.

### Create

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides" \
  -d @- <<'EOF'
{
  "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
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
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki"
```

### List

```bash
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides"
```

### Update

GET the current resource to read its `resourceVersion`, then PUT with
that version echoed in `metadata.resourceVersion`:

```bash
RV=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki" \
  | jq -r .metadata.resourceVersion)

curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki" \
  -d @- <<EOF
{
  "apiVersion": "pathfinderbackend.ext.grafana.app/v1alpha1",
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
  "message": "Operation cannot be fulfilled on interactiveguides.pathfinderbackend.ext.grafana.app \"intro-to-loki\": the object has been modified; please apply your changes to the latest version and try again"
}
```

### Delete

```bash
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://${STACK}/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/${NS}/interactiveguides/intro-to-loki"
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
  "message": "InteractiveGuide.pathfinderbackend.ext.grafana.app \"intro-to-loki\" is invalid: spec.blocks[0].type: …"
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
