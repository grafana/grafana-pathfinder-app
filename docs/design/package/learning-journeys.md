# Learning journeys

> Part of the [Pathfinder package design](../PATHFINDER-PACKAGE-DESIGN.md).
> See also: [Dependencies](./dependencies.md) · [Identity and resolution](./identity-and-resolution.md) · [Standards alignment](./standards-alignment.md) · [Implementation plan](../PACKAGE-IMPLEMENTATION-PLAN.md)

---

A learning journey is an ordered sequence of guides that build toward a larger outcome. Not a single guide package, a series of packages that decompose a complex topic into manageable steps — "Set up infrastructure alerting," "Configure a Linux server integration," "Visualize trace data."

Journeys are packages and contribute in the same way in the package system and the dependency graph. Other guides can `"depends": ["infrastructure-alerting"]` and mean "the user has completed the entire alerting journey." Journeys carry their own metadata, targeting, and `provides` capabilities — they are addressable, recommendable, and completable as a unit.

## The metapackage model

Journeys follow the Debian **metapackage** pattern: a package whose primary purpose is to compose other packages into a coherent experience. In Debian, `ubuntu-desktop` is a metapackage that depends on `nautilus`, `gedit`, `gnome-terminal`, and hundreds of other packages. Installing `ubuntu-desktop` gives you a complete desktop environment. The metapackage is the identity handle for the collection; the components are real, independently maintained packages.

We adopt the same principle. A journey is a metapackage. Its steps are real packages — not a special "sub-unit" type, not scoped fragments, not second-class entities. The package system has **one kind of thing**: a package. Some packages are metapackages that compose other packages into a coherent learning experience.

## Metapackage Advantages

We're adopting the Debian model so we can get the advantages they've had for 30 years of package management:

- **One identity model.** Steps have FQIs in the existing `repository/id` format, just like any other package. No fragment notation, no scoped identity, no new addressing scheme.
- **One set of tools.** The CLI validates steps with the same validation pipeline as standalone guides. The graph command shows steps as real nodes. The index builder can index them. Every tool that works for packages works for steps.
- **One dependency model.** Steps can use `depends`, `recommends`, `provides`, and the full dependency vocabulary. The metapackage uses `steps` for ordering but the dependency graph handles the rest.
- **Composition evolution.** A journey can add, remove, or reorder steps between versions without changing its external identity. The `steps` array in the journey manifest absorbs the evolution. Downstream dependents are unaffected.
- **Flavors and reuse.** Different metapackages can compose different subsets of a shared step pool. This is already visible in the content corpus:

| Journey                    | Steps                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `linux-server-integration` | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, restart-test-connection |
| `macos-integration`        | select-architecture, install-alloy, configure-alloy, install-dashboards-alerts, test-connection     |
| `mysql-integration`        | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, test-connection         |

Three journeys share `install-alloy`, `configure-alloy`, and `install-dashboards-alerts`. If those steps are real packages, they can be authored once and composed into multiple journeys — exactly as Debian metapackages compose shared components into different desktop experiences.

Step reuse is a structural capability enabled by the model, not a requirement imposed by it. Many journeys will have steps unique to that journey. The model accommodates both patterns without special-casing either.

## What metapackages don't give us

Two aspects of Debian metapackages do not apply:

**Ordering.** In Debian, `Depends: A, B, C` has no ordering semantics. Journeys need an explicit linear sequence. The `steps` field (described below) is **new machinery** that does not come from the Debian model. It is layered on top of the metapackage concept.

**Removal semantics.** In Debian, removing a metapackage allows `apt autoremove` to garbage-collect orphaned dependencies. There is no analogue in Pathfinder — you do not "uncomplete" a journey or "uninstall" a step.

## The `type` discriminator

The `manifest.json` `type` field distinguishes guides from journeys. This field was anticipated in [standards alignment](./standards-alignment.md#the-type-discriminator-future) for SCORM; journeys are the first concrete use.

| Type                | Meaning                                                     | Has `steps`? | Has content blocks?   |
| ------------------- | ----------------------------------------------------------- | ------------ | --------------------- |
| `"guide"` (default) | Single standalone lesson                                    | No           | Yes                   |
| `"journey"`         | Metapackage composing an ordered sequence of guides         | Yes          | Optional (cover page) |
| `"course"`          | SCORM-imported course (future)                              | Future       | Future                |
| `"module"`          | Grouping of related guides without strict ordering (future) | Future       | Future                |

When `type` is absent, the default is `"guide"`. All existing packages continue to work without changes.

The `"journey"` type establishes the composition pattern that `"course"` and `"module"` will refine for SCORM. See [relationship to SCORM](#relationship-to-scorm) below.

## The `steps` field

Journey manifests declare step ordering via a `steps` array:

```typescript
/** Ordered array of step directory names within the journey. Advisory linear sequence. */
steps?: string[];
```

Each entry in `steps` is a directory name that must exist as a child directory of the journey directory. The array defines the **recommended reading order** — the linear path the UI presents to users.

The `steps` field is valid only when `type` is `"journey"`. The CLI validates that:

- Every entry in `steps` corresponds to a child directory containing at least `content.json`
- No duplicate entries exist in the array
- The `steps` array is non-empty when `type` is `"journey"`

## Journey directory structure

A journey directory contains its own `manifest.json` (with `type: "journey"`) and nested step package directories. An optional `content.json` at the journey level serves as a cover page or introduction.

```
interactive-tutorials/
├── infrastructure-alerting/                ← journey metapackage
│   ├── manifest.json                       ← type: "journey", steps: [...]
│   ├── content.json                        ← optional cover/introduction page
│   ├── find-data-to-alert/                 ← step package (real package, nested)
│   │   └── content.json
│   ├── build-your-query/
│   │   └── content.json
│   ├── set-conditions/
│   │   └── content.json
│   ├── evaluation-and-labels/
│   │   └── content.json
│   ├── notification-settings/
│   │   └── content.json
│   ├── save-and-activate/
│   │   └── content.json
│   └── monitor-your-rule/
│       └── content.json
├── welcome-to-grafana/                     ← standalone guide (unchanged)
│   ├── content.json
│   └── manifest.json
```

This introduces **nested package directories** — a package directory that contains child package directories. The CLI must understand that a directory can contain both its own `manifest.json` and child package directories. This is a structural extension of the [package structure](../PATHFINDER-PACKAGE-DESIGN.md#package-structure) convention.

Step packages follow the same conventions as any package: they contain at minimum `content.json` and may optionally include `manifest.json` for step-specific metadata (e.g., `testEnvironment` for E2E routing of individual steps). Most steps need only `content.json`.

## Step ordering and completion semantics

**Ordering is advisory.** The `steps` array defines the suggested linear path. The UI presents steps in this order and encourages sequential progression. However, users are always permitted to jump into any step directly. The "steps" of a learning journey are packages like any other, and so can be used independently subject to dependencies.

**Completion is set-based.** "Completing the journey" means completing all steps, regardless of the order in which they were completed. A user who completes steps 1, 3, 5, 2, 4, 6, 7 has completed the journey identically to one who followed the linear path. Journey completion triggers the journey's `provides` capabilities and satisfies downstream `depends` references.

**Partial progress is tracked.** A user who has completed 5 of 7 steps is 71% through the journey. The UI can display progress based on the set of completed steps relative to the total step count.

## Journey-level metadata and dependencies

Journey-level `manifest.json` carries metadata and dependencies for the journey as a whole. Steps inherit the journey's context — they do not independently declare targeting or participate in the dependency graph unless there is a specific reason to do so. Other than that, journey metadata is the same as package metadata, differingly only with:

- `type: "journey"`
- `steps: ["step1", "step2"]`

TBD decision: whether or not steps underneath a journey should inherit
some metadata from the journey package. Leaning towards "no", because
the principle is that the underlying packages are independently reusable.

## Example: complete journey package

**`infrastructure-alerting/manifest.json`** — journey metapackage:

```json
{
  "schemaVersion": "1.1.0",
  "id": "infrastructure-alerting",
  "type": "journey",
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
  "recommends": ["prometheus-lj"],
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
      "content": "# Infrastructure alerting\n\nLearn to create alert rules that monitor your infrastructure metrics and logs. This journey walks you through finding data, building queries, setting conditions, and activating your first alert rule."
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

## Relationship to `paths.json`

Journey metapackages and curated learning paths (`paths.json`) coexist:

- **`paths.json`** defines editorially curated paths with badges, estimated time, icons, and platform targeting. They are currently a stand-in for not
  yet having this structure, and will need to be migrated in due time.
- **Journey metapackages** define structurally composed experiences with dependency semantics. They are a content architecture product.

A `paths.json` entry can reference a journey as a single unit, or a journey can subsume the role of a `paths.json` entry entirely. The reconciliation between these two mechanisms is addressed in [the learning journey integration phase](../PACKAGE-IMPLEMENTATION-PLAN.md#phase-4-learning-journey-integration).

## Relationship to SCORM

The journey metapackage model provides the concrete bridge to SCORM's content organization model:

| SCORM concept                  | Package model equivalent         |
| ------------------------------ | -------------------------------- |
| Organization (tree of Items)   | Journey metapackage with `steps` |
| Item (with sequencing rules)   | Step ordering via `steps` array  |
| SCO (shareable content object) | Step package (guide)             |
| Forward-only sequencing        | Advisory `steps` ordering        |
| Prerequisites                  | `manifest.json` → `depends`      |

SCORM's `Organization` element is structurally equivalent to a journey metapackage: both compose content objects into an ordered sequence with metadata. The SCORM import pipeline (Phase 5-6) does not need to invent a composition model — it writes into the one established by journeys. The future `type: "course"` becomes a refinement of the journey concept (potentially with stricter sequencing semantics), not a separate system.

## TBD Decision: Can Journeys Nest?

- Yes: if journeys are just metapackages, metapackages can contain metapackages (everything is a first class package)
- No: A journey's steps are guides (`type: "guide"` or absent). A journey cannot contain another journey as a step. This keeps the model flat and avoids recursive nesting complexity. If hierarchical content organization is needed (course → module → lesson), the SCORM `type` extensions (`"course"`, `"module"`) will address it in a future phase. For now, the composition model is one level deep: journeys contain guides.
