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

- **One identity model.** Steps have bare IDs, just like any other package. No fragment notation, no scoped identity, no new addressing scheme.
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
/** Ordered array of bare package IDs that form the journey. Advisory linear sequence. */
steps?: string[];
```

Each entry in `steps` is a **bare package ID** that must resolve to an existing package in the repository index. The array defines the **recommended reading order** — the linear path the UI presents to users.

Steps may be physically nested as child directories of the journey (organizational convenience for journey-specific steps) or may be independent top-level packages (for steps shared across multiple journeys). The `steps` array makes no assumption about physical location — resolution is handled by the repository index, following the same bare-ID-to-path resolution used everywhere else in the package system. This follows the Debian convention where metapackage dependencies are independently located packages, not physically contained within the metapackage.

The `steps` field is valid only when `type` is `"journey"`. The CLI validates that:

- Every entry in `steps` resolves to an existing package in the repository index
- No duplicate entries exist in the array
- The `steps` array is non-empty when `type` is `"journey"`

## Journey directory structure

A journey directory contains its own `manifest.json` (with `type: "journey"`) and an optional `content.json` at the journey level that serves as a cover page or introduction. Journey-specific steps may be nested as child directories; shared steps live as independent top-level packages.

```
interactive-tutorials/
├── infrastructure-alerting/                ← journey metapackage
│   ├── manifest.json                       ← type: "journey", steps: [...]
│   ├── content.json                        ← optional cover/introduction page
│   ├── find-data-to-alert/                 ← journey-specific step (nested)
│   │   └── content.json
│   ├── build-your-query/                   ← journey-specific step (nested)
│   │   └── content.json
│   └── set-conditions/                     ← journey-specific step (nested)
│       └── content.json
├── install-alloy/                          ← shared step (top-level, reusable)
│   ├── content.json
│   └── manifest.json
├── configure-alloy/                        ← shared step (top-level, reusable)
│   └── content.json
├── linux-server-integration/               ← another journey reusing shared steps
│   ├── manifest.json                       ← steps: ["select-platform", "install-alloy", "configure-alloy", ...]
│   └── select-platform/                    ← journey-specific step (nested)
│       └── content.json
├── welcome-to-grafana/                     ← standalone guide (unchanged)
│   ├── content.json
│   └── manifest.json
```

In this example, `install-alloy` and `configure-alloy` are shared steps that appear in the `steps` arrays of multiple journeys (`linux-server-integration`, `macos-integration`, `mysql-integration`). They live as independent top-level packages — following the Debian convention where metapackage dependencies live in the pool independently, not physically contained within any metapackage. Journey-specific steps like `find-data-to-alert` and `select-platform` are nested under their journey for organizational convenience.

This introduces **nested package directories** — a package directory that may contain child package directories. The CLI must understand that a directory can contain both its own `manifest.json` and child package directories. This is a structural extension of the [package structure](../PATHFINDER-PACKAGE-DESIGN.md#package-structure) convention. Nesting is optional; the `steps` array uses bare package IDs resolved via the repository index regardless of physical location.

Step packages follow the same conventions as any package: they contain at minimum `content.json` and may optionally include `manifest.json` for step-specific metadata (e.g., `testEnvironment` for E2E routing of individual steps). Most steps need only `content.json`.

## Step ordering and completion semantics

**Ordering is advisory.** The `steps` array defines the suggested linear path. The UI presents steps in this order and encourages sequential progression. However, users are always permitted to jump into any step directly. The "steps" of a learning journey are packages like any other, and so can be used independently subject to dependencies.

**Completion is set-based.** "Completing the journey" means completing all steps, regardless of the order in which they were completed. A user who completes steps 1, 3, 5, 2, 4, 6, 7 has completed the journey identically to one who followed the linear path. Journey completion triggers the journey's `provides` capabilities and satisfies downstream `depends` references.

**Partial progress is tracked.** A user who has completed 5 of 7 steps is 71% through the journey. The UI can display progress based on the set of completed steps relative to the total step count.

## Journey-level metadata and dependencies

Journey-level `manifest.json` carries metadata and dependencies for the journey as a whole. Steps inherit the journey's context — they do not independently declare targeting or participate in the dependency graph unless there is a specific reason to do so. Other than that, journey metadata is the same as package metadata, differingly only with:

- `type: "journey"`
- `steps: ["step1", "step2"]`

**Decision: steps do not inherit metadata from the journey.** Steps are independently reusable packages — that is the core value proposition of the metapackage model. If step behavior changed depending on which journey references it (inherited targeting, inherited category), it would introduce context-dependent identity, undermining the "one kind of thing" principle. A step should behave the same whether it appears in `infrastructure-alerting`, `linux-server-integration`, or is referenced standalone. If a journey needs to customize how a step appears in its context (e.g., different introduction text), that is a presentation concern for the UI layer, not a metadata inheritance concern.

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

- **`paths.json`** defines editorially curated paths with badges, estimated time, icons, and platform targeting. It is a lightweight, inadequate predecessor to the dependency graph specification — a stand-in for not yet having the structural model that journey metapackages provide.
- **Journey metapackages** define structurally composed experiences with dependency semantics. They are the target replacement for `paths.json`.

**End-state:** `paths.json` will be retired after all migration work is complete. Journey metapackages subsume its role — ordering comes from `steps`, metadata comes from `manifest.json`, and dependency relationships come from the graph. During the transition, `paths.json` remains as a fallback and curated paths take priority over dependency-derived paths. A separate milestone will be needed to migrate everything that depends on `paths.json` (badges, icons, platform targeting, estimated time) into the package model before `paths.json` can be deleted.

The reconciliation between these two mechanisms during transition is addressed in [the learning journey integration phase](../PACKAGE-IMPLEMENTATION-PLAN.md#phase-4-learning-journey-integration).

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

## Decision: journey nesting is scoped out for Phase 5

**Decision:** Journey nesting is not supported in Phase 5. A journey's steps are guides (`type: "guide"` or absent). A journey cannot contain another journey as a step.

**Rationale:** The MVP can be successful without supporting nested journeys. Flat composition keeps validation, completion tracking, progress computation, and UI rendering simple. Recursive nesting adds complexity at every layer — what does "71% of a journey that contains a 50%-complete sub-journey" mean for progress display?

**This is an MVP scoping choice, not a semantic limitation of the model.** The Debian package model permits metapackages to depend on other metapackages, and virtual capabilities can be provided by packages that themselves depend on other virtual capabilities. Nothing in the package identity model, the dependency vocabulary, or the `provides` mechanism prevents a future phase from allowing `steps` to reference other journeys. If hierarchical content organization is needed (course -> module -> lesson), it can be introduced as a backward-compatible extension — either through the SCORM `type` extensions (`"course"`, `"module"`) or by relaxing the `steps` constraint to accept `type: "journey"` entries.
