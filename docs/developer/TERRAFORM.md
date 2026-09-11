# Provisioning guides with Terraform

Private guides can be provisioned into a Grafana Cloud stack with Terraform
today, using the Grafana provider's `grafana_apps_generic_resource`. No
provider change and no backend change are needed: `InteractiveGuide` is an App
Platform kind, and that resource manages any namespaced App Platform kind from
a Kubernetes-style manifest.

This replaces the [`scripts/upsert-guide.sh`](../../scripts/upsert-guide.sh)
workflow for stacks where the aggregator is already enabled, and adds three
things the scripts cannot do: deletion, drift detection, and real state.

This document is a **partial** answer to
[#1233](https://github.com/grafana/grafana-pathfinder-app/issues/1233). It
covers guide provisioning and nothing else — see [what this does not
solve](#what-this-does-not-solve).

## Prerequisites

- **A Grafana Cloud stack.** The aggregator
  (`pathfinderbackend.ext.grafana.app/v1alpha1`) does not run in OSS Grafana.
  Confirm it is serving with
  `curl -H "Authorization: Bearer $TOKEN" https://slug.grafana.net/apis/pathfinderbackend.ext.grafana.app/v1alpha1`
  — a healthy stack lists `interactiveguides` with `create`, `update` and
  `delete` among its verbs. There is no way to turn this on from Terraform;
  see [what this does not solve](#what-this-does-not-solve).
- **A service-account token with the Editor role.** Editor is the minimum for
  `create`/`update`/`delete`; reads need only Viewer. See
  [authentication](EXTERNAL_API.md#authentication).
- **Terraform and the Grafana provider.** The example below was verified with
  Terraform 1.16.1 and provider 4.46.0, and pins the provider accordingly. If
  you need an older floor, check the
  [registry](https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/apps_generic_resource)
  for the first version carrying `grafana_apps_generic_resource`.

## A minimal worked example

Three files in one directory:

```text
guides/
├── main.tf
└── intro-to-loki.json
```

### The guide

`intro-to-loki.json` holds the bare `spec` — the same shape the editor's
**Library → Export** produces, minus the Kubernetes envelope:

```json
{
  "id": "intro-to-loki",
  "title": "Intro to Loki",
  "schemaVersion": "1.0.0",
  "status": "published",
  "blocks": [
    {
      "type": "markdown",
      "id": "welcome",
      "content": "# Welcome\n\nLet's get started with Loki."
    }
  ]
}
```

`status` is `"draft"` or `"published"`. A draft is visible only in the editor
library; a published guide is live in the docs panel. Unlike
`upsert-guide.sh`, Terraform applies no defaults — declare `id`, `title`,
`schemaVersion` and `status` explicitly.

### The configuration

```hcl
terraform {
  required_version = ">= 1.11"
  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "~> 4.46"
    }
  }
}

variable "grafana_auth" {
  type      = string
  sensitive = true
}

provider "grafana" {
  url  = "https://slug.grafana.net"
  auth = var.grafana_auth
}

resource "grafana_apps_generic_resource" "intro_to_loki" {
  manifest = {
    apiVersion = "pathfinderbackend.ext.grafana.app/v1alpha1"
    kind       = "InteractiveGuide"
    metadata = {
      name = "intro-to-loki"
    }
    spec = jsondecode(file("${path.module}/intro-to-loki.json"))
  }
}
```

`metadata.name` is the resource name and must satisfy the [slug
rule](EXTERNAL_API.md#resource-name-slug-rule). Do not set
`metadata.namespace`: the provider discovers the stack namespace from
`/bootdata` on every operation, and a configured namespace that disagrees with
the discovered one is an error. If discovery fails, set `stack_id` on the
provider instead.

### Applying it

```bash
export TF_VAR_grafana_auth="$GRAFANA_SA_TOKEN"

terraform init
terraform plan
terraform apply
```

Terraform reports `1 added`. The guide is now in the stack's library and, at
`"status": "published"`, live in the docs panel.

Re-running `terraform plan` with nothing changed reports no changes. That
clean second plan is the property the bash scripts cannot offer, and it is
worth checking on a new manifest before trusting it — see [what "covered by
the CRD shape" means](#what-covered-by-the-crd-shape-means).

### Changing and removing a guide

Edit `intro-to-loki.json` and re-apply; Terraform updates the resource in
place, handling `resourceVersion` and retrying on a conflicting concurrent
write. Remove the resource block and apply, or run `terraform destroy`, and
the guide is deleted from the stack.

Deletion is the sharpest difference from the scripts. They are additive by
design: a milestone dropped from a package stays on the stack until someone
removes it by hand. Terraform removes what leaves your configuration. Note
that this cuts both ways — there is no revision history on these resources, so
a destroy cannot be undone from the API. Take an export first if the namespace
holds guides you cannot recreate.

### Paths and journeys

A learning path is not a separate kind. It is an `InteractiveGuide` whose
`spec.manifest.type` is `"path"` or `"journey"` and whose
`spec.manifest.milestones` lists the `spec.id` of each member guide. Each
member is its own resource.

Milestones must exist before the cover page that references them, or the path
points at guides that are not there yet. Express that with `depends_on`:

```hcl
resource "grafana_apps_generic_resource" "view_logs" {
  manifest = {
    apiVersion = "pathfinderbackend.ext.grafana.app/v1alpha1"
    kind       = "InteractiveGuide"
    metadata   = { name = "drilldown-logs-view-logs" }
    spec       = jsondecode(file("${path.module}/view-logs.json"))
  }
}

resource "grafana_apps_generic_resource" "drilldown_logs_path" {
  manifest = {
    apiVersion = "pathfinderbackend.ext.grafana.app/v1alpha1"
    kind       = "InteractiveGuide"
    metadata   = { name = "drilldown-logs-lj" }
    spec       = jsondecode(file("${path.module}/cover-page.json"))
  }

  depends_on = [grafana_apps_generic_resource.view_logs]
}
```

For a path, `metadata.name` and `spec.id` must not diverge — the manifest's
`milestones` key on `spec.id` while milestone resolution GETs by
`metadata.name`. See [`spec.id` must be a valid resource
name](EXTERNAL_API.md#specid-must-be-a-valid-resource-name).

## What "covered by the CRD shape" means

Terraform provisions guides reliably **for content the CRD fully declares**.
That qualifier is load-bearing, and this section is the reason the document
exists.

The CRD's block schema is generated from `kinds/interactiveguide.cue` in
[grafana-pathfinder-backend](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue).
That file, not this repository, decides which block fields exist. A field the
app accepts and the CUE does not declare is **silently pruned** on write:
Kubernetes drops it, the write still returns 200 or 201, and the field is gone
on the next read. There is no 422 and no error body.

Depth decides whether a field survives. Blocks nested three or more levels
deep fall under `x-kubernetes-preserve-unknown-fields` and are kept; anything
shallower is not. At the time of writing the gap is the `input` block's
`defaultValue` and the `dataCheck*` family, but that set moves in both
directions as the CUE changes, so do not trust any enumeration of it —
including this one.

### Why this matters more under Terraform than under the scripts

Under the bash scripts, pruning is a silent content loss: your guide uploads,
and a field is quietly missing.

Under Terraform it becomes a **plan that never converges**. The provider
refreshes `spec` from the server on every read, and while it recurses into
nested objects, it takes arrays from the server wholesale. `spec.blocks` is an
array. So a pruned field is absent from state while your configuration still
declares it, and Terraform proposes to add it back on every plan:

```text
~ blocks = [
    ~ {
        + defaultValue = "prefilled-by-terraform"
          id           = "probe-input"
      },
  ]

Plan: 0 to add, 1 to change, 0 to destroy.
```

Each apply reports a change, the server prunes the field again, and the next
plan shows the same diff. `terraform plan -detailed-exitcode` returns 2
forever, so the loop also breaks any CI gate built on a clean plan.

This is a provider-side diffing issue, not a Pathfinder one, and
`grafana_apps_generic_resource` is documented as experimental with diffing
semantics subject to change.

### Checking a manifest before you trust it

Two checks, in order of cost:

1. **Dry-run the content** with the existing script, which warns with the
   exact fields your blocks would lose and turns that warning into a failure
   under `--strict-blocks`:

   ```bash
   scripts/upsert-learning-path.sh \
     --stack slug.grafana.net \
     --package ./my-package \
     --dry-run --strict-blocks
   ```

   The block-field half of this check is local and needs no working stack. Its
   collision half does make a network call, which
   [#1869](https://github.com/grafana/grafana-pathfinder-app/issues/1869)
   currently blocks; the header then reports `Collisions: not checked` and the
   field validation still runs.

2. **Apply, then plan again.** A clean second plan means every field you
   declared survived the round trip. A diff that reappears after an apply is
   the permadiff above, and names the offending field.

Keep check 1 in CI even after moving provisioning to Terraform. It reports
which field is lossy; Terraform only reports that something is.

A dry run with no warnings is a statement about the CUE at its `main`, not
about the stack you are uploading to. A stack on an older backend prunes more.

## What Terraform gives you over the scripts

| Capability                                    | `upsert-guide.sh` | Terraform          |
| --------------------------------------------- | ----------------- | ------------------ |
| Create and update                             | Yes               | Yes                |
| `resourceVersion` handling, conflict retry    | Yes               | Yes                |
| Namespace discovery                           | Yes               | Yes                |
| Delete a guide that left the source of truth  | No                | Yes                |
| Detect an out-of-band edit                    | No                | Yes                |
| Ownership model                               | An annotation     | State plus manager |
| Reports which block field the CRD would prune | Yes               | No                 |

Ownership is worth a note. The scripts record provenance in a
`pathfinderbackend.ext.grafana.app/managed-by` annotation and refuse to
overwrite a resource that lacks it. Terraform stamps
`grafana.app/managedBy: terraform` and `grafana.app/managerId`, and knows what
it owns from state. The two models do not know about each other: a
Terraform-managed guide carries no `managed-by` annotation, so a later script
run treats it as foreign and refuses it, which is the safe direction. Pick one
owner per guide.

## What this does not solve

[#1233](https://github.com/grafana/grafana-pathfinder-app/issues/1233) asks
for three things. This document covers one and a half of them.

- **Guide provisioning** — covered, with the CRD-shape caveat above.
- **RBAC** — partly. `grafana_role` and `grafana_role_assignment` manage
  Grafana roles as code, and the [verb table](EXTERNAL_API.md#authentication)
  says which role each operation needs. Whether the aggregator's check can be
  narrowed by a custom role, rather than only by the built-in Viewer and
  Editor roles, is unconfirmed.
- **Enabling the API on a stack or organization** — not covered, and not a
  Terraform problem. Whether the aggregator runs on a stack is decided by a
  boot-time feature toggle owned by the Grafana Cloud control plane. No public
  API enables it per stack, and Terraform can only wrap an API that exists.
  `grafana_cloud_stack` exposes no feature-toggle surface. Until there is a
  programmatic path, enablement stays a manual step regardless of the tooling
  around it.

Two further limitations of the guide provisioning itself:

- **`allow_ui_updates = false` is not enforced for this kind.** The provider
  stamps the manager annotations, but a write from the block editor succeeds
  anyway. Terraform detects the edit and reverts it on the next apply, so the
  configuration still wins eventually — but nothing stops the edit, and the
  author is not warned that their change is temporary.
- **No typed resource.** A typed
  `grafana_apps_pathfinderbackend_interactiveguide_v1alpha1` would give
  plan-time schema validation instead of a silent prune. That is ergonomics on
  top of what the generic resource already does.

## Related

- [`EXTERNAL_API.md`](EXTERNAL_API.md) — the underlying API: envelope shape,
  the `spec.manifest` field table, the slug rule, error codes, and the bash
  helpers.
- [`CUSTOM_GUIDES.md`](CUSTOM_GUIDES.md) — the custom-guide lifecycle and the
  editor library.
- [`grafana_apps_generic_resource`](https://registry.terraform.io/providers/grafana/grafana/latest/docs/resources/apps_generic_resource)
  — provider documentation for the resource used here.
- [`grafana-pathfinder-backend/kinds/interactiveguide.cue`](https://github.com/grafana/grafana-pathfinder-backend/blob/main/kinds/interactiveguide.cue)
  — the authoritative schema for the spec, and the file that decides what gets
  pruned.
