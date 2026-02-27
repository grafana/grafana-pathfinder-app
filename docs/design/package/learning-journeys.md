# Learning paths and journeys

> Part of the [Pathfinder package design](../PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Dependencies](./dependencies.md) · [Identity and resolution](./identity-and-resolution.md) · [Standards alignment](./standards-alignment.md) · [Implementation plan](../PACKAGE-IMPLEMENTATION-PLAN.md)

---

The package model supports two levels of metapackage composition:

- A **path** is an ordered sequence of guides that build toward a focused outcome — "Set up a Linux server integration," "Configure infrastructure alerting," "Create your first dashboard."
- A **journey** is an ordered sequence of paths (or any packages) that build toward a larger learning arc — "Infrastructure mastery" composing linux-server-integration, kubernetes-integration, and alerting paths.

Both are packages and contribute in the same way in the package system and the dependency graph. Other packages can `"depends": ["infrastructure-alerting"]` and mean "the user has completed the entire alerting path." Paths and journeys carry their own metadata, targeting, and `provides` capabilities — they are addressable, recommendable, and completable as a unit.

## The metapackage model

Paths and journeys follow the Debian **metapackage** pattern: a package whose primary purpose is to compose other packages into a coherent experience. In Debian, `ubuntu-desktop` is a metapackage that depends on `nautilus`, `gedit`, `gnome-terminal`, and hundreds of other packages. Installing `ubuntu-desktop` gives you a complete desktop environment. The metapackage is the identity handle for the collection; the components are real, independently maintained packages.

We adopt the same principle at two levels. A path is a metapackage that composes guides. A journey is a metapackage that composes paths. Steps at both levels are real packages — not a special "sub-unit" type, not scoped fragments, not second-class entities. The package system has **one kind of thing**: a package. Some packages are metapackages that compose other packages into coherent learning experiences.

## Metapackage advantages

We're adopting the Debian model so we can get the advantages they've had for 30 years of package management:

- **One identity model.** Steps have bare IDs, just like any other package. No fragment notation, no scoped identity, no new addressing scheme.
- **One set of tools.** The CLI validates steps with the same validation pipeline as standalone guides. The graph command shows steps as real nodes. The index builder can index them. Every tool that works for packages works for steps.
- **One dependency model.** Steps can use `depends`, `recommends`, `provides`, and the full dependency vocabulary. The metapackage uses `steps` for ordering but the dependency graph handles the rest.
- **Composition evolution.** A path can add, remove, or reorder steps between versions without changing its external identity. The `steps` array in the path manifest absorbs the evolution. Downstream dependents are unaffected.
- **Flavors and reuse.** Different metapackages can compose different subsets of a shared step pool. This is already visible in the content corpus:

| Path                       | Steps                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `linux-server-integration` | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, restart-test-connection |
| `macos-integration`        | select-architecture, install-alloy, configure-alloy, install-dashboards-alerts, test-connection     |
| `mysql-integration`        | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, test-connection         |

Three paths share `install-alloy`, `configure-alloy`, and `install-dashboards-alerts`. If those steps are real packages, they can be authored once and composed into multiple paths — exactly as Debian metapackages compose shared components into different desktop experiences. A journey like `infrastructure-mastery` can then compose these paths into a larger arc.

Step reuse is a structural capability enabled by the model, not a requirement imposed by it. Many paths will have steps unique to that path. The model accommodates both patterns without special-casing either.

## What metapackages don't give us

Two aspects of Debian metapackages do not apply:

**Ordering.** In Debian, `Depends: A, B, C` has no ordering semantics. Paths and journeys need an explicit linear sequence. The `steps` field (described below) is **new machinery** that does not come from the Debian model. It is layered on top of the metapackage concept.

**Removal semantics.** In Debian, removing a metapackage allows `apt autoremove` to garbage-collect orphaned dependencies. There is no analogue in Pathfinder — you do not "uncomplete" a path or "uninstall" a step.

## The `type` discriminator

The `manifest.json` `type` field distinguishes the three package types. It is a required field with no default — every manifest must declare its type.

| Type        | Meaning                                                              | Has `steps`? | Has content blocks?   |
| ----------- | -------------------------------------------------------------------- | ------------ | --------------------- |
| `"guide"`   | Single standalone lesson                                             | No           | Yes                   |
| `"path"`    | Metapackage composing an ordered sequence of guides                  | Yes          | Optional (cover page) |
| `"journey"` | Metapackage composing an ordered sequence of paths (or any packages) | Yes          | Optional (cover page) |
| `"course"`  | SCORM-imported course (future)                                       | Future       | Future                |
| `"module"`  | Grouping of related guides without strict ordering (future)          | Future       | Future                |

The `"path"` and `"journey"` types establish the two-level composition pattern that `"course"` and `"module"` will refine for SCORM. See [relationship to SCORM](#relationship-to-scorm) below.

## The `steps` field

Path and journey manifests declare step ordering via a `steps` array:

```typescript
/** Ordered array of bare package IDs. Advisory linear sequence. Required when type is "path" or "journey". */
steps?: string[];
```

Each entry in `steps` is a **bare package ID** that must resolve to an existing package in the repository index. The array defines the **recommended reading order** — the linear sequence the UI presents to users.

**Steps reference packages, not types.** The CLI validates that each entry in `steps` resolves to an existing package, but does NOT enforce the type of the referenced package. The type hierarchy (guides in paths, paths in journeys) is a **convention**, not a schema constraint. This follows the Debian model where metapackages can depend on any package, including other metapackages. In practice:

- A path's steps are typically guides
- A journey's steps are typically paths
- But a journey can include guides directly if that's the right composition

Steps may be physically nested as child directories of the metapackage (organizational convenience for steps specific to that path or journey) or may be independent top-level packages (for steps shared across multiple metapackages). The `steps` array makes no assumption about physical location — resolution is handled by the repository index, following the same bare-ID-to-path resolution used everywhere else in the package system. This follows the Debian convention where metapackage dependencies are independently located packages, not physically contained within the metapackage.

The `steps` field is valid when `type` is `"path"` or `"journey"`. The CLI validates that:

- Every entry in `steps` resolves to an existing package in the repository index
- No duplicate entries exist in the array
- The `steps` array is non-empty when `type` is `"path"` or `"journey"`
- No cycles exist in `steps` chains (a step cannot transitively contain its parent)

## Directory structure

A path or journey directory contains its own `manifest.json` and an optional `content.json` that serves as a cover page or introduction. Steps specific to that metapackage may be nested as child directories; shared steps live as independent top-level packages.

```
interactive-tutorials/
├── infrastructure-alerting/                ← path metapackage
│   ├── manifest.json                       ← type: "path", steps: [...]
│   ├── content.json                        ← optional cover/introduction page
│   ├── find-data-to-alert/                 ← path-specific step (nested)
│   │   └── content.json
│   ├── build-your-query/                   ← path-specific step (nested)
│   │   └── content.json
│   └── set-conditions/                     ← path-specific step (nested)
│       └── content.json
├── install-alloy/                          ← shared step (top-level, reusable)
│   ├── content.json
│   └── manifest.json
├── configure-alloy/                        ← shared step (top-level, reusable)
│   └── content.json
├── linux-server-integration/               ← another path reusing shared steps
│   ├── manifest.json                       ← type: "path", steps: ["select-platform", "install-alloy", ...]
│   └── select-platform/                    ← path-specific step (nested)
│       └── content.json
├── infrastructure-mastery/                 ← journey metapackage (composes paths)
│   ├── manifest.json                       ← type: "journey", steps: ["linux-server-integration", ...]
│   └── content.json                        ← optional cover page
├── welcome-to-grafana/                     ← standalone guide (unchanged)
│   ├── content.json
│   └── manifest.json
```

In this example, `install-alloy` and `configure-alloy` are shared steps that appear in the `steps` arrays of multiple paths (`linux-server-integration`, `macos-integration`, `mysql-integration`). They live as independent top-level packages — following the Debian convention where metapackage dependencies live in the pool independently, not physically contained within any metapackage. Path-specific steps like `find-data-to-alert` and `select-platform` are nested under their path for organizational convenience. The journey `infrastructure-mastery` composes paths rather than guides directly.

This introduces **nested package directories** — a package directory that may contain child package directories. The CLI must understand that a directory can contain both its own `manifest.json` and child package directories. This is a structural extension of the [package structure](../PATHFINDER-PACKAGE-DESIGN.md#package-structure) convention. Nesting is optional; the `steps` array uses bare package IDs resolved via the repository index regardless of physical location.

Step packages follow the same conventions as any package: they contain at minimum `content.json` and may optionally include `manifest.json` for step-specific metadata (e.g., `testEnvironment` for E2E routing of individual steps). Most steps need only `content.json`.

## Step ordering and completion semantics

**Ordering is advisory.** The `steps` array defines the suggested linear sequence. The UI presents steps in this order and encourages sequential progression. However, users are always permitted to jump into any step directly. Steps are packages like any other, and can be used independently subject to dependencies.

**Completion is set-based at each level.** Completing a path means completing all its steps, regardless of order. Completing a journey means completing all its steps (typically paths), which transitively means completing all guides in all constituent paths. A user who completes steps 1, 3, 5, 2, 4, 6, 7 has completed the path identically to one who followed the linear order. Completion triggers the metapackage's `provides` capabilities and satisfies downstream `depends` references.

**Partial progress is tracked.** A user who has completed 5 of 7 steps is 71% through the path. For journeys, progress can be displayed at two levels: path-level progress (3 of 5 paths complete) and aggregate guide-level progress (23 of 35 total guides complete). The UI determines which level to display based on context.

## Metapackage-level metadata and dependencies

Path and journey `manifest.json` files carry metadata and dependencies for the metapackage as a whole. Metapackage metadata is the same as any package metadata, differing only in:

- `type: "path"` or `type: "journey"`
- `steps: ["step1", "step2", ...]`

**Decision: steps do not inherit metadata from the metapackage.** Steps are independently reusable packages — that is the core value proposition of the metapackage model. If step behavior changed depending on which path or journey references it (inherited targeting, inherited category), it would introduce context-dependent identity, undermining the "one kind of thing" principle. A step should behave the same whether it appears in `infrastructure-alerting`, `linux-server-integration`, or is referenced standalone. If a metapackage needs to customize how a step appears in its context (e.g., different introduction text), that is a presentation concern for the UI layer, not a metadata inheritance concern.

## Example: path metapackage

**`infrastructure-alerting/manifest.json`** — path composing guides:

```json
{
  "schemaVersion": "1.1.0",
  "id": "infrastructure-alerting",
  "type": "path",
  "repository": "interactive-tutorials",
  "description": "Create your first infrastructure alert rule in Grafana Cloud, from finding data to monitoring your rule.",
  "category": "take-action",
  "author": { "team": "interactive-learning" },
  "steps": [
    "find-data-to-alert",
    "build-your-query",
    "set-conditions",
    "evaluation-and-labels",
    "notification-settings",
    "save-and-activate",
    "monitor-your-rule"
  ],
  "depends": ["welcome-to-grafana"],
  "provides": ["infrastructure-alerting-configured"],
  "recommends": ["prometheus-path"],
  "targeting": {
    "match": { "urlPrefixIn": ["/alerting"] }
  }
}
```

**`infrastructure-alerting/content.json`** — optional cover page:

```json
{
  "schemaVersion": "1.1.0",
  "id": "infrastructure-alerting",
  "title": "Infrastructure alerting",
  "blocks": [
    {
      "type": "markdown",
      "content": "# Infrastructure alerting\n\nLearn to create alert rules that monitor your infrastructure metrics and logs. This path walks you through finding data, building queries, setting conditions, and activating your first alert rule."
    }
  ]
}
```

**`infrastructure-alerting/find-data-to-alert/content.json`** — step content:

```json
{
  "schemaVersion": "1.1.0",
  "id": "infrastructure-alerting-find-data-to-alert",
  "title": "Find data to alert on",
  "blocks": [
    {
      "type": "markdown",
      "content": "Before creating an alert rule, you need to know the exact metric or log query you want to monitor..."
    }
  ]
}
```

## Example: journey metapackage

**`infrastructure-mastery/manifest.json`** — journey composing paths:

```json
{
  "schemaVersion": "1.1.0",
  "id": "infrastructure-mastery",
  "type": "journey",
  "repository": "interactive-tutorials",
  "description": "Master infrastructure monitoring in Grafana — from server setup through alerting and optimization.",
  "category": "take-action",
  "steps": ["linux-server-integration", "kubernetes-integration", "infrastructure-alerting"],
  "provides": ["infrastructure-mastery-complete"],
  "targeting": {
    "match": { "urlPrefixIn": ["/connections", "/alerting"] }
  }
}
```

Each step in the journey is a path that itself contains guide steps. Completing the journey means completing all three paths (and transitively, all guides within those paths).

## Relationship to `paths.json`

Path and journey metapackages and curated learning paths (`paths.json`) coexist:

- **`paths.json`** defines editorially curated paths with badges, estimated time, icons, and platform targeting. It is a lightweight predecessor to the dependency graph specification — a stand-in for not yet having the structural model that path metapackages provide.
- **Path and journey metapackages** define structurally composed experiences with dependency semantics. They are the target replacement for `paths.json`.

**End-state:** `paths.json` will be retired after all migration work is complete. Path metapackages subsume its role — ordering comes from `steps`, metadata comes from `manifest.json`, and dependency relationships come from the graph. During the transition, `paths.json` remains as a fallback and curated paths take priority over dependency-derived paths. A separate milestone will be needed to migrate everything that depends on `paths.json` (badges, icons, platform targeting, estimated time) into the package model before `paths.json` can be deleted.

The reconciliation between these two mechanisms during transition is addressed in [the path and journey integration phase](../PACKAGE-IMPLEMENTATION-PLAN.md#phase-5-path-and-journey-integration).

## Relationship to SCORM

The path and journey metapackage model provides the concrete bridge to SCORM's content organization model:

| SCORM concept                  | Package model equivalent                 |
| ------------------------------ | ---------------------------------------- |
| Organization (tree of Items)   | Journey or path metapackage with `steps` |
| Item (with sequencing rules)   | Step ordering via `steps` array          |
| SCO (shareable content object) | Step package (guide)                     |
| Forward-only sequencing        | Advisory `steps` ordering                |
| Prerequisites                  | `manifest.json` → `depends`              |

SCORM's `Organization` element is structurally equivalent to a path or journey metapackage: both compose content objects into an ordered sequence with metadata. The SCORM import pipeline does not need to invent a composition model — it writes into the one established by paths and journeys. The future `type: "course"` becomes a refinement of the metapackage concept (potentially with stricter sequencing semantics), not a separate system.

## Decision: steps reference packages, not types

**Decision:** The `steps` field references bare package IDs. The CLI validates that each entry resolves to an existing package, but does not enforce the package type of the referenced package.

**Rationale:** The type hierarchy (guides in paths, paths in journeys) is the conventional usage pattern, not an enforced constraint. This follows the Debian model where metapackages can depend on any package, including other metapackages. Enforcing type restrictions on `steps` would require the CLI to resolve and inspect the type of every referenced package during validation, adding complexity without clear benefit — content review already enforces sensible composition. The model naturally supports cases where a journey includes a standalone guide alongside its paths, without requiring that guide to be wrapped in a single-step path.

**Cycle detection is enforced.** While the type of steps is not restricted, cycles in `steps` chains are always an error. A step cannot transitively contain its parent metapackage. The graph builder detects and reports cycles.
