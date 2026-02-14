# Pathfinder package design

## Table of contents

- [Motivation](#motivation)
- [Design principles](#design-principles)
- [Package structure](#package-structure)
- [Separation of content and metadata](#separation-of-content-and-metadata)
- [Identity model](#identity-model)
- [Phase 1 schema](#phase-1-schema)
- [Metadata](#metadata)
- [Dependencies](#dependencies)
- [Learning journeys](#learning-journeys)
- [Targeting](#targeting)
- [Backwards compatibility](#backwards-compatibility)
- [CLI extensions](#cli-extensions)
- [Alignment with external formats](#alignment-with-external-formats)
- [Future-proofing](#future-proofing)
- [Deferred concerns](#deferred-concerns)
- [Phased roadmap](#phased-roadmap)
- [Decision log](#decision-log)

---

## Motivation

Today, a guide is a single `content.json` file with four root fields: `schemaVersion`, `id`, `title`, `blocks`. All metadata about how, when, and where to surface a guide lives outside the guide itself — in `index.json` (recommendation rules), in `paths.json` (learning path ordering), and in the heads of content authors.

This creates structural problems that are already present or imminent:

### Scattered metadata

A guide's identity is spread across at least three unrelated files. The guide itself only knows its `id` and `title`. Its description, URL targeting, and platform rules live in `index.json`. Its ordering within a learning path lives in `paths.json`. Its estimated duration lives in `paths.json` under `guideMetadata`. There is no single **package** to understand "what is this guide, what does it need, and where does it fit?"

### No dependency semantics

Debian-style dependencies are needed (test environment routing, learning path ordering, capability abstraction). But there is nowhere to put this data today.

### SCORM and external content import

A SCORM course decomposition produces multiple interrelated guides with rich metadata (author, language, difficulty, rights, provenance). The current schema has no place for any of this. Without a package model, imported content would lose all of its metadata. See [SCORM analysis](./SCORM.md) for the full feasibility study.

### Learning journey composition

Docs partners already express inter-guide dependencies in YAML (see [alignment with external formats](#alignment-with-external-formats)). The website team is planning to display guides on the web. Both need guides to be self-describing — carrying their own relationship metadata rather than relying on external manifests. The [learning journeys](#learning-journeys) section defines the metapackage model that formalizes multi-guide composition.

### E2E Layer 4 routing

The [testing strategy](./TESTING_STRATEGY.md) requires guide-level metadata (tier, datasets, plugins, minimum version) to route guides to appropriate test environments. This metadata naturally lives alongside dependencies.

### Content-as-Code lifecycle

As the content corpus grows from ~45 guides toward 100-200+, decentralized ownership becomes essential. Each guide package should carry enough metadata to be self-describing for CI, recommendation, testing, and rendering — without depending on centralized manifests.

---

## Design principles

1. **Backwards compatible.** All new fields are optional. Existing guides with only `{ schemaVersion, id, title, blocks }` continue to pass validation without changes.

2. **Self-describing.** A package carries enough metadata to be understood in isolation — its identity, its dependencies, its recommended targeting, and its authorship.

3. **Debian-inspired dependencies.** We adopt the proven dependency vocabulary from the [Debian package system](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends), which has refined these semantics over decades.

4. **Grafana-first, extensible later.** The format serves Grafana interactive guides today. It is designed with open extensibility for non-Grafana content (SCORM import, compliance training, etc.) but does not gold-plate for those use cases now.

5. **Advisory targeting.** Packages suggest how they should be recommended. The recommender retains authority to override or change how a package is surfaced.

6. **Vet field names against standards.** Before finalizing metadata field names, cross-reference Dublin Core, IEEE LOM, and SCORM to avoid backward-incompatible renames later.

7. **Separate content from metadata.** Content (`content.json`) and package metadata (`manifest.json`) live in separate files within the package directory. Different consumers read only the file they need; different roles author only the file they own. This follows the Debian model where `control` metadata is physically separate from package data.

---

## Package structure

A package is a **directory** containing at minimum `content.json`. A `manifest.json` file carries metadata, dependencies, and targeting. An optional `assets/` directory holds non-JSON resources (images, diagrams, supplementary files). The directory name matches the guide `id`:

```
interactive-tutorials/
├── welcome-to-grafana/
│   ├── content.json          ← content blocks (block editor's domain)
│   └── manifest.json          ← metadata, dependencies, targeting
├── prometheus-grafana-101/
│   ├── content.json
│   ├── manifest.json
│   └── assets/               ← optional non-JSON assets
│       └── architecture.png
├── first-dashboard/
│   └── content.json          ← manifest.json optional; standalone guide
└── advanced-alerting/
    ├── content.json
    └── manifest.json
```

### Files in a package

| File            | Required | Owner                                  | Contains                                           |
| --------------- | -------- | -------------------------------------- | -------------------------------------------------- |
| `content.json`  | Yes      | Content authors (block editor)         | `schemaVersion`, `id`, `title`, `blocks`           |
| `manifest.json` | No       | Product, enablement, recommender teams | Flat metadata, dependency fields, `targeting`      |
| `assets/`       | No       | Content authors                        | Images, diagrams, supplementary non-JSON resources |

For backwards compatibility, bare files (`welcome-to-grafana.json`) continue to work. The directory convention is adopted for new guides and migrated incrementally.

---

## Separation of content and metadata

### The Debian precedent

A Debian `.deb` binary package contains **two separate archives**: `control.tar.gz` (metadata, dependencies, maintainer scripts) and `data.tar.gz` (the installable files). The package manager reads `control.tar.gz` to make dependency and conflict decisions without ever extracting `data.tar.gz`. This physical separation is deliberate: metadata and content serve different consumers, are authored by different tools, and change for different reasons.

We adopt the same principle. A Pathfinder package separates metadata (`manifest.json`) from content (`content.json`).

### Multiple consumers, different needs

As the content corpus grows toward 100-200+ guides, different systems consume package data for different purposes. No single consumer needs the full merged artifact:

| Consumer                    | Reads           | Why                                                                    |
| --------------------------- | --------------- | ---------------------------------------------------------------------- |
| Pathfinder plugin           | `content.json`  | Renders blocks in the sidebar; metadata is irrelevant                  |
| Recommender (`build-index`) | `manifest.json` | Needs `targeting.match` and `description`; blocks are irrelevant       |
| Learning path engine        | `manifest.json` | Needs `dependencies` for DAG traversal; blocks are irrelevant          |
| LMS / catalog search        | `manifest.json` | Searches by title, category, difficulty, author; blocks are irrelevant |
| E2E test runner             | Both            | Needs blocks to execute and `testEnvironment` for routing              |
| CLI validator               | Both            | Cross-validates content structure and package metadata                 |

Separating the files means each consumer can parse only the file it needs. A recommender indexing 200 packages reads 200 small `manifest.json` files rather than 200 large `content.json` files that include potentially hundreds of content blocks each.

### Authoring role separation

Different roles own different concerns:

| Role                  | Edits           | Tool                                        |
| --------------------- | --------------- | ------------------------------------------- |
| Tech writers          | `content.json`  | Block editor                                |
| Enablement / product  | `manifest.json` | Text editor, CLI, or future metadata editor |
| Recommender engineers | `manifest.json` | Text editor or recommender tooling          |
| Content architects    | `manifest.json` | Text editor, dependency graph tools         |

The block editor can read and write `content.json` without needing to understand, preserve, or risk clobbering metadata fields. It never touches `manifest.json`. This keeps the block editor focused on content authoring — its primary purpose.

Git history stays clean: content changes produce diffs in `content.json`; metadata and targeting changes produce diffs in `manifest.json`. Reviews are scoped to the concern being changed. Merge conflicts between content authors and metadata managers are eliminated.

### Logical merge

The CLI and build tools assemble a **logical guide** by merging `content.json` and `manifest.json` at validation and build time. The `id` field appears in both files and must match — this is a cross-file consistency check enforced by the CLI. When `manifest.json` is absent, the guide is standalone: it has content but no package metadata.

### The `assets/` directory

Packages may include an optional `assets/` directory for non-JSON resources: images, architecture diagrams, supplementary PDFs, or other files referenced by the guide content. Assets are:

- **Not parsed** by the CLI or plugin — they are opaque files
- **Referenced** from content blocks via relative paths (e.g., `./assets/architecture.png`)
- **Bundled** alongside the package for distribution
- **Aligned with SCORM** — SCORM packages include static assets alongside SCO content

The `assets/` convention is adopted now but asset resolution and rendering are deferred to a future phase.

---

## Identity model

Packages are identified by a **repository** token and a local **id**. The fully qualified identifier (FQI) is `repository/id`.

### Repository

The `repository` field is a short name token that identifies which collection of guides this package belongs to. It is **not** a resolvable URL — it is a stable token, analogous to a Debian repository name ("main", "contrib", "backports").

Examples:

- `"interactive-tutorials"` — the public Grafana guides repository
- `"private-guides"` — a private team's guide collection
- `"sales-enablement"` — a non-Grafana content collection (future)

The mapping from repository token to a concrete location (GitHub repo, API endpoint, artifact registry) is an **external concern**, resolved by a configuration layer that is out of scope for this design. This allows the same package format to work across GitHub, Bitbucket, internal APIs, or any future storage backend.

### Fully qualified identifier

The FQI is always `repository/id`:

- `interactive-tutorials/welcome-to-grafana`
- `private-guides/onboarding-101`

FQIs are used in:

- Dependency references (`depends`, `recommends`, etc.)
- Learning path definitions (`paths.json`)
- Recommender rules
- Future CRD serialization

### Bare ID resolution

When a dependency reference contains no `/`, it is resolved within the same repository. This makes same-repo references concise. In `manifest.json`:

```json
{
  "id": "advanced-alerting",
  "repository": "interactive-tutorials",
  "depends": ["intro-to-alerting"],
  "recommends": ["private-guides/deep-dive-alerting"]
}
```

Here `"intro-to-alerting"` resolves to `interactive-tutorials/intro-to-alerting` (same repo). `"private-guides/deep-dive-alerting"` is a cross-repo reference.

### Default repository

When `repository` is absent, the default is `"interactive-tutorials"`. This provides backwards compatibility for all existing guides, which live in the `interactive-tutorials` repo and do not carry a `repository` field.

---

## Phase 1 schema

Phase 1 defines two file schemas and a merged logical type. All new fields are optional for backwards compatibility.

### Content schema (`content.json`)

The content file is what the block editor produces. It contains only the fields needed to render the guide: schemaVersion, id, title, blocks: []

### Manifest schema (`manifest.json`)

The manifest file carries metadata, dependencies, and targeting as flat fields. It is authored by product, enablement, or recommender teams — not by the block editor:

```typescript
interface ManifestJson {
  /** Schema version — "1.1.0" for packages */
  schemaVersion?: string;
  /** Local identifier — must match content.json id */
  id: string;
  /** Repository token for multi-repo identity (default: "interactive-tutorials") */
  repository?: string;

  // --- Metadata (flat, following Debian conventions) ---

  /** Full description for discoverability and display */
  description?: string;
  /** Content language — BCP 47 tag (default: "en") */
  language?: string;
  /** Content category for taxonomy alignment */
  category?: string;
  /** Content author or owning team */
  author?: { name?: string; team?: string };

  // --- Dependencies (Debian-style) ---

  /** Hard prerequisites — must be completed before this guide is accessible */
  depends?: DependencyList;
  /** Soft prerequisites — recommended but not required */
  recommends?: DependencyList;
  /** Related content for enrichment ("you might also like") */
  suggests?: DependencyList;
  /** Virtual capabilities this guide provides on completion */
  provides?: string[];
  /** Guides this one conflicts with (mutually exclusive) */
  conflicts?: string[];
  /** Guides this one supersedes entirely */
  replaces?: string[];

  // --- Targeting ---

  /** Advisory recommendation targeting */
  targeting?: GuideTargeting;
}
```

### Merged logical type

The CLI and build tools assemble both files into a logical `JsonGuide` for validation, index generation, and runtime consumption. The `id` field must match across both files:

```typescript
interface JsonGuide {
  /** Schema version — "1.1.0" for packages */
  schemaVersion?: string;

  /** Repository token for multi-repo identity (default: "interactive-tutorials") */
  repository?: string;

  /** Local identifier — FQI is repository/id */
  id: string;

  /** Display title */
  title: string;

  /** Content blocks */
  blocks: JsonBlock[];

  // --- Metadata (flat) ---

  /** Full description for discoverability and display */
  description?: string;
  /** Content language — BCP 47 tag (default: "en") */
  language?: string;
  /** Content category for taxonomy alignment */
  category?: string;
  /** Content author or owning team */
  author?: { name?: string; team?: string };

  // --- Dependencies (Debian-style) ---

  /** Hard prerequisites — must be completed before this guide is accessible */
  depends?: DependencyList;
  /** Soft prerequisites — recommended but not required */
  recommends?: DependencyList;
  /** Related content for enrichment ("you might also like") */
  suggests?: DependencyList;
  /** Virtual capabilities this guide provides on completion */
  provides?: string[];
  /** Guides this one conflicts with (mutually exclusive) */
  conflicts?: string[];
  /** Guides this one supersedes entirely */
  replaces?: string[];

  /** Advisory recommendation targeting */
  targeting?: GuideTargeting;
}
```

When `manifest.json` is absent, the logical `JsonGuide` is identical to `content.json` — a standalone guide with no package metadata.

### Example: complete Phase 1 package

A package with both files:

**`prometheus-grafana-101/content.json`** — authored by the block editor:

```json
{
  "schemaVersion": "1.1.0",
  "id": "prometheus-grafana-101",
  "title": "Prometheus & Grafana 101",
  "blocks": [{ "type": "markdown", "content": "# Prometheus & Grafana 101\n\nIn this guide..." }]
}
```

**`prometheus-grafana-101/manifest.json`** — authored by product/enablement:

```json
{
  "schemaVersion": "1.1.0",
  "id": "prometheus-grafana-101",
  "repository": "interactive-tutorials",
  "description": "Learn to use Prometheus and Grafana to monitor your infrastructure.",
  "language": "en",
  "category": "data-availability",
  "author": {
    "name": "Enablement Team",
    "team": "interactive-learning"
  },
  "depends": ["welcome-to-grafana"],
  "recommends": ["first-dashboard"],
  "suggests": ["loki-grafana-101", "prometheus-advanced-queries"],
  "provides": ["datasource-configured"],
  "targeting": {
    "match": {
      "and": [{ "urlPrefixIn": ["/connections"] }, { "targetPlatform": "oss" }]
    }
  }
}
```

---

## Metadata

Metadata fields live **flat** at the top level of `manifest.json`, not nested under a `metadata` wrapper. This follows the Debian `control` file convention where `Description`, `Maintainer`, and other metadata are peer fields alongside `Depends` and `Recommends` — not grouped under a header. Flat structure keeps the file shallow, easy to scan, and simple to validate.

Metadata fields live in `manifest.json`, not in `content.json`. This keeps the block editor's file clean and focused on content.

### Fields

| Field         | Type                               | Default | Description                                                                                                                                      |
| ------------- | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description` | `string`                           | —       | Full description for discoverability and display                                                                                                 |
| `language`    | `string`                           | `"en"`  | Content language ([BCP 47](https://www.rfc-editor.org/info/bcp47) tag, e.g., `"en"`, `"es"`, `"ja"`). Defaults to `"en"` when absent.            |
| `category`    | `string`                           | —       | Content category for taxonomy alignment. Convention aligns with docs team taxonomy: `"data-availability"`, `"query-visualize"`, `"take-action"`. |
| `author`      | `{ name?: string; team?: string }` | —       | Content author or owning team                                                                                                                    |

### Rationale for each field

| Field         | Consumer                                            | Rationale                                                        |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `description` | Recommendations, web display, index.json generation | Consolidates `summary` from `index.json` into the package        |
| `language`    | i18n, SCORM import, web display                     | Minimal overhead, critical for non-English content               |
| `category`    | Taxonomy, docs team alignment, recommendations      | Aligns with docs team's journey categories                       |
| `author`      | Failure routing, attribution, provenance            | Testing strategy identifies ownership as critical for escalation |

### Namespace collision note

Flat metadata fields share the top-level namespace with identity fields (`id`, `repository`), dependency fields (`depends`, `recommends`, etc.), and `targeting`. This is acceptable because:

- The field inventory is bounded and well-understood — drawn from established standards (Dublin Core, IEEE LOM, Debian)
- Field names are specific and self-describing (`description`, `language`, `author` do not collide with `depends`, `provides`, `targeting`)
- The `manifest.json` schema is validated by Zod, which catches any accidental field reuse at compile time
- Future fields will be vetted against the existing namespace before adoption (see [design principle 6](#design-principles))

If the namespace ever becomes crowded (unlikely given the standards-aligned vocabulary), a future schema version could introduce grouping — but the current field set does not warrant it.

### Deferred metadata fields

These fields are not in Phase 1 but the schema is designed to accept them as backward-compatible additions in future phases:

| Field                | Phase       | Reason to defer                                                                                                      |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `estimatedDuration`  | Phase 2+    | No compelling MVP consumer. Format TBD (ISO 8601 duration vs. SCORM `typicalLearningTime`). Needed if SCORM arrives. |
| `difficulty`         | Phase 2+    | No MVP consumer for filtering or display. Useful for SCORM import and future recommendation ranking.                 |
| `keywords`           | Phase 2+    | No consumer yet; recommendations use URL-based rules                                                                 |
| `rights`             | SCORM phase | Only needed for imported content with licensing                                                                      |
| `source`             | SCORM phase | Provenance tracking for imported content                                                                             |
| `educationalContext` | SCORM phase | Educational context classification                                                                                   |

---

## Dependencies

Dependency fields live flat at the top level of `manifest.json`, alongside metadata fields. They express structural relationships between guides — prerequisites, recommendations, capabilities, and conflicts.

### Fields

Dependency fields live flat at the top level of `manifest.json`, alongside metadata and targeting. Each dependency field that accepts guide references (`depends`, `recommends`, `suggests`) uses the `DependencyList` type, which supports AND/OR logic. Fields that declare capabilities or relationships (`provides`, `conflicts`, `replaces`) use plain `string[]`.

```typescript
/**
 * A dependency clause: either a single reference (string)
 * or an OR-group of alternatives (string[]).
 */
type DependencyClause = string | string[];

/**
 * A list of dependency clauses combined with AND.
 * Each clause is either a bare string (single reference)
 * or an array of strings (OR-group of alternatives).
 *
 * Follows Debian's dependency syntax in JSON form:
 * - Debian: `A | B, C`  (comma = AND, pipe = OR)
 * - JSON:   `[["A", "B"], "C"]`
 */
type DependencyList = DependencyClause[];
```

All references use FQI format (`"repository/id"`) for cross-repo or bare `id` for same-repo. See [identity model](#identity-model).

### AND/OR semantics

Dependency lists use **conjunctive normal form** (CNF): the outer array is AND, inner arrays are OR. This maps directly to Debian's established syntax where commas separate AND-clauses and pipes separate OR-alternatives.

| JSON                     | Meaning                          | Debian equivalent |
| ------------------------ | -------------------------------- | ----------------- |
| `["A", "B"]`             | A **and** B                      | `A, B`            |
| `[["A", "B"]]`           | A **or** B                       | `A \| B`          |
| `[["A", "B"], "C"]`      | (A **or** B) **and** C           | `A \| B, C`       |
| `["A", ["B", "C"], "D"]` | A **and** (B **or** C) **and** D | `A, B \| C, D`    |

**Example** — a guide that requires completion of `welcome-to-grafana` AND either `prometheus-grafana-101` or `loki-grafana-101`:

```json
{
  "depends": ["welcome-to-grafana", ["prometheus-grafana-101", "loki-grafana-101"]]
}
```

This complements virtual capabilities (`provides`): OR-groups express direct alternatives between concrete guides, while `provides` expresses abstract capability satisfaction. Both mechanisms coexist.

### Dependency semantics

These follow the [Debian package dependency model](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends) exactly:

| Field        | Semantics                                                                                             | Example                                   |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `depends`    | Guide B **must** be completed before A is accessible. Hard gate.                                      | `"depends": ["intro-to-alerting"]`        |
| `recommends` | Most users benefit from completing B first, but it's not required. System may prompt but won't block. | `"recommends": ["prometheus-quickstart"]` |
| `suggests`   | B contains related content that enhances understanding of A. Informational only.                      | `"suggests": ["oncall-integration"]`      |
| `provides`   | Completing A satisfies any dependency on capability X. Enables virtual capabilities.                  | `"provides": ["datasource-configured"]`   |
| `conflicts`  | A and B cannot be meaningfully used together (deprecated content, mutually exclusive environments).   | `"conflicts": ["deprecated-alerting-v9"]` |
| `replaces`   | A supersedes B entirely. Completion of A may mark B as unnecessary.                                   | `"replaces": ["alerting-techniques-v10"]` |

### Virtual capabilities

The `provides` field enables flexible learning paths. Multiple guides can provide the same abstract capability:

- `prometheus-grafana-101` provides `"datasource-configured"`
- `loki-grafana-101` provides `"datasource-configured"`
- `first-dashboard` depends on `"datasource-configured"` — either guide satisfies it

### Relationship to block-level requirements

| Concern         | Block-level `requirements`                     | Guide-level dependencies                                |
| --------------- | ---------------------------------------------- | ------------------------------------------------------- |
| **Scope**       | Single step/block                              | Entire guide                                            |
| **Purpose**     | Runtime gating ("can this step execute now?")  | Structural metadata ("what does this guide need?")      |
| **Format**      | String array (`["has-datasource:prometheus"]`) | Flat fields (`depends`, `recommends`, etc.) with CNF OR |
| **Evaluation**  | Real-time in browser during guide execution    | Pre-flight by test runner; UI filtering                 |
| **Persistence** | No                                             | Capabilities persist on guide completion                |

### Relationship to learning paths

Learning paths exist as **both** curated collections and dependency-derived structures:

- **Curated**: `paths.json` continues to define editorially curated learning paths with explicit ordering, badging, and presentation metadata. This is a human editorial product.
- **Derived**: The dependency graph formed by `depends`/`recommends`/`suggests` is a structural relationship that the recommender can exploit to compute on-the-fly learning paths based on user context and graph topology.

Both coexist. `paths.json` references guides by FQI. The dependency graph is a parallel structure that enriches the recommender's understanding of content relationships.

---

## Learning journeys

A learning journey is an ordered sequence of guides that build toward a larger outcome. Not a single guide package, a series of packages that decompose a complex topic into manageable steps — "Set up infrastructure alerting," "Configure a Linux server integration," "Visualize trace data."

Journeys are packages and contribute in the same way in the package system and the dependency graph. Other guides can `"depends": ["infrastructure-alerting"]` and mean "the user has completed the entire alerting journey." Journeys carry their own metadata, targeting, and `provides` capabilities — they are addressable, recommendable, and completable as a unit.

### The metapackage model

Journeys follow the Debian **metapackage** pattern: a package whose primary purpose is to compose other packages into a coherent experience. In Debian, `ubuntu-desktop` is a metapackage that depends on `nautilus`, `gedit`, `gnome-terminal`, and hundreds of other packages. Installing `ubuntu-desktop` gives you a complete desktop environment. The metapackage is the identity handle for the collection; the components are real, independently maintained packages.

We adopt the same principle. A journey is a metapackage. Its steps are real packages — not a special "sub-unit" type, not scoped fragments, not second-class entities. The package system has **one kind of thing**: a package. Some packages are metapackages that compose other packages into a coherent learning experience.

### Metapackage Advantages

We're adopting the Debian model so we can get the advantages they've had for 30 years of package management:

- **One identity model.** Steps have FQIs in the existing `repository/id` format, just like any other package. No fragment notation, no scoped identity, no new addressing scheme.
- **One set of tools.** The CLI validates steps with the same validation pipeline as standalone guides. The graph command shows steps as real nodes. The index builder can index them. Every tool that works for packages works for steps.
- **One dependency model.** Steps can use `depends`, `recommends`, `provides`, and the full dependency vocabulary. The metapackage uses `steps` for ordering but the dependency graph handles the rest.
- **Composition evolution.** A journey can add, remove, or reorder steps between versions without changing its external identity. The `steps` array in the journey manifest absorbs the evolution. Downstream dependents are unaffected.
- **Flavors and reuse.** Different metapackages can compose different subsets of a shared step pool. This is already visible in the content corpus:

| Journey | Steps |
|---|---|
| `linux-server-integration` | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, restart-test-connection |
| `macos-integration` | select-architecture, install-alloy, configure-alloy, install-dashboards-alerts, test-connection |
| `mysql-integration` | select-platform, install-alloy, configure-alloy, install-dashboards-alerts, test-connection |

Three journeys share `install-alloy`, `configure-alloy`, and `install-dashboards-alerts`. If those steps are real packages, they can be authored once and composed into multiple journeys — exactly as Debian metapackages compose shared components into different desktop experiences.

Step reuse is a structural capability enabled by the model, not a requirement imposed by it. Many journeys will have steps unique to that journey. The model accommodates both patterns without special-casing either.

### What metapackages don't give us

Two aspects of Debian metapackages do not apply:

**Ordering.** In Debian, `Depends: A, B, C` has no ordering semantics. Journeys need an explicit linear sequence. The `steps` field (described below) is **new machinery** that does not come from the Debian model. It is layered on top of the metapackage concept.

**Removal semantics.** In Debian, removing a metapackage allows `apt autoremove` to garbage-collect orphaned dependencies. There is no analogue in Pathfinder — you do not "uncomplete" a journey or "uninstall" a step.

### The `type` discriminator

The `manifest.json` `type` field distinguishes guides from journeys. This field was anticipated in [future-proofing](#the-type-discriminator-future) for SCORM; journeys are the first concrete use.

| Type | Meaning | Has `steps`? | Has content blocks? |
|---|---|---|---|
| `"guide"` (default) | Single standalone lesson | No | Yes |
| `"journey"` | Metapackage composing an ordered sequence of guides | Yes | Optional (cover page) |
| `"course"` | SCORM-imported course (future) | Future | Future |
| `"module"` | Grouping of related guides without strict ordering (future) | Future | Future |

When `type` is absent, the default is `"guide"`. All existing packages continue to work without changes.

The `"journey"` type establishes the composition pattern that `"course"` and `"module"` will refine for SCORM. See [relationship to SCORM](#relationship-to-scorm) below.

### The `steps` field

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

### Journey directory structure

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

This introduces **nested package directories** — a package directory that contains child package directories. The CLI must understand that a directory can contain both its own `manifest.json` and child package directories. This is a structural extension of the [package structure](#package-structure) convention.

Step packages follow the same conventions as any package: they contain at minimum `content.json` and may optionally include `manifest.json` for step-specific metadata (e.g., `testEnvironment` for E2E routing of individual steps). Most steps need only `content.json`.

### Step ordering and completion semantics

**Ordering is advisory.** The `steps` array defines the suggested linear path. The UI presents steps in this order and encourages sequential progression. However, users are always permitted to jump into any step directly. The "steps" of a learning journey are packages like any other, and so can be used independently subject to dependencies.

**Completion is set-based.** "Completing the journey" means completing all steps, regardless of the order in which they were completed. A user who completes steps 1, 3, 5, 2, 4, 6, 7 has completed the journey identically to one who followed the linear path. Journey completion triggers the journey's `provides` capabilities and satisfies downstream `depends` references.

**Partial progress is tracked.** A user who has completed 5 of 7 steps is 71% through the journey. The UI can display progress based on the set of completed steps relative to the total step count.

### Journey-level metadata and dependencies

Journey-level `manifest.json` carries metadata and dependencies for the journey as a whole. Steps inherit the journey's context — they do not independently declare targeting or participate in the dependency graph unless there is a specific reason to do so. Other than that, journey metadata is the same as package metadata, differingly only with:

* `type: "journey"`
* `steps: ["step1", "step2"]`

TBD decision: whether or not steps underneath a journey should inherit
some metadata from the journey package. Leaning towards "no", because
the principle is that the underlying packages are independently reusable.

### Example: complete journey package

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

### Relationship to `paths.json`

Journey metapackages and curated learning paths (`paths.json`) coexist:

- **`paths.json`** defines editorially curated paths with badges, estimated time, icons, and platform targeting. They are currently a stand-in for not
yet having this structure, and will need to be migrated in due time.
- **Journey metapackages** define structurally composed experiences with dependency semantics. They are a content architecture product.

A `paths.json` entry can reference a journey as a single unit, or a journey can subsume the role of a `paths.json` entry entirely. The reconciliation between these two mechanisms is addressed in [Phase 3](#phase-3-learning-journey-integration-2-3-weeks) of the roadmap.

### Relationship to SCORM

The journey metapackage model provides the concrete bridge to SCORM's content organization model:

| SCORM concept | Package model equivalent |
|---|---|
| Organization (tree of Items) | Journey metapackage with `steps` |
| Item (with sequencing rules) | Step ordering via `steps` array |
| SCO (shareable content object) | Step package (guide) |
| Forward-only sequencing | Advisory `steps` ordering |
| Prerequisites | `manifest.json` → `depends` |

SCORM's `Organization` element is structurally equivalent to a journey metapackage: both compose content objects into an ordered sequence with metadata. The SCORM import pipeline (Phase 5-6) does not need to invent a composition model — it writes into the one established by journeys. The future `type: "course"` becomes a refinement of the journey concept (potentially with stricter sequencing semantics), not a separate system.

### TBD Decision: Can Journeys Nest?

* Yes: if journeys are just metapackages, metapackages can contain metapackages (everything is a first class package)
* No: A journey's steps are guides (`type: "guide"` or absent). A journey cannot contain another journey as a step. This keeps the model flat and avoids recursive nesting complexity. If hierarchical content organization is needed (course → module → lesson), the SCORM `type` extensions (`"course"`, `"module"`) will address it in a future phase. For now, the composition model is one level deep: journeys contain guides.

---

## Targeting

Targeting rules are declared in `manifest.json`.

### Purpose

Packages carry an **advisory** `targeting` field that suggests how the recommender should surface the content. The recommender retains full authority to override, modify, or ignore these suggestions.

### Structure

The `match` field follows the recommender's `MatchExpr` grammar, which supports:

- Boolean combinators: `and`, `or`
- URL matching: `urlRegex`, `urlPrefix`, `urlPrefixIn`
- Datasource context: `datasource`, `datasourceIn`, `allDatasources`, `noDatasources`
- Role-based matching: `userRole`, `userRoleIn`
- Tag matching: `tag`, `tagIn`, `allTags`
- Cohort targeting: `cohort`, `cohortIn`
- Platform targeting: `targetPlatform`, `targetPlatformIn`

**We introduce nothing novel here, we only reuse MatchExpr**.

### Example

```json
{
  "targeting": {
    "match": {
      "and": [
        { "urlPrefixIn": ["/connections", "/datasources"] },
        { "targetPlatform": "oss" },
        { "noDatasources": true }
      ]
    }
  }
}
```

This says: "I'm most relevant when the user is on a connections/datasources page, on OSS, and has no datasources configured yet." The recommender may honor this or apply its own logic.

### Schema validation

The package schema validates `targeting` loosely — it checks that the field is a valid JSON object but does not enforce the full `MatchExpr` grammar. The recommender's rule definition language can evolve independently without requiring package schema changes.

### Relationship to index.json

Today, the recommender consumes `index.json` for recommendation rules. In the package model, `index.json` becomes a **build artifact** derived from scanning packages. A future `pathfinder-cli build-index` command will:

1. Scan all package directories
2. For each package, read `manifest.json` and `content.json`:
   - Taking `title` from `content.json`
   - Taking `description` from `manifest.json`
   - Computing `url` from the package's deployment location
   - Copying `match` from `manifest.json` → `targeting.match`
   - Setting `source` to the package FQI
3. Output a single `index.json` file

The recommender only needs `manifest.json` for most operations (targeting, description). It reads `content.json` only for the `title` field, which could alternatively be duplicated as a flat field in `manifest.json` in the future if needed.

Until `build-index` is implemented, `index.json` continues to be maintained separately. This is noted as a [deferred concern](#deferred-concerns).

---

## Backwards compatibility

### Schema level

`JsonGuideSchema` uses `.passthrough()` (via `.loose()`) which means unknown fields are allowed. Existing guides with only `{ schemaVersion, id, title, blocks }` in a single file pass validation without changes. The two-file model is additive — `manifest.json` is optional.

### KNOWN_FIELDS

For `content.json`: the existing `KNOWN_FIELDS._guide` applies unchanged. If `content.json` contains metadata/dependency/targeting fields (e.g., from a legacy single-file guide), they are accepted via `.passthrough()` but the canonical location is `manifest.json`.

For `manifest.json`: a new `KNOWN_FIELDS._manifest` set includes `'schemaVersion'`, `'id'`, `'repository'`, `'description'`, `'language'`, `'category'`, `'author'`, `'depends'`, `'recommends'`, `'suggests'`, `'provides'`, `'conflicts'`, `'replaces'`, and `'targeting'`.

### Schema version

The version bumps from `"1.0.0"` to `"1.1.0"`:

- `1.0.0` → `1.1.0`: backward-compatible addition of the two-file package model
- Consumers that don't understand the new fields safely ignore them
- The `.passthrough()` pattern already ensures this
- Both `content.json` and `manifest.json` carry `schemaVersion` independently

### Default values

| Field           | Default when absent                                                                          |
| --------------- | -------------------------------------------------------------------------------------------- |
| `manifest.json` | No package metadata (standalone guide with content only)                                     |
| `repository`    | `"interactive-tutorials"`                                                                    |
| `language`      | `"en"`                                                                                       |
| `targeting`     | No targeting (not recommended contextually; only reachable via direct link or learning path) |
| `assets/`       | No assets                                                                                    |

### Migration path

1. Existing bare `*.json` files continue to work indefinitely
2. When a guide gains package structure, move it into a directory: `first-dashboard.json` → `first-dashboard/content.json`
3. When a guide gains metadata, create `manifest.json` alongside `content.json`
4. This is done incrementally, one guide at a time
5. The CLI accepts bare files, directory paths with only `content.json`, and full packages with both files

### Legacy single-file guides

For backwards compatibility, the CLI also accepts a single `content.json` that contains metadata/dependency/targeting fields inline (the original unified-file design). When the CLI encounters this, it treats the file as both content and package metadata. This ensures that any guide authored before the two-file split continues to work. New guides should use the two-file model.

### Consolidation of external metadata

- `index.json` entries (`summary`, `url`, `targetPlatform`) can be gradually migrated into `manifest.json` fields (`description`, `targeting`)
- `paths.json` guide ordering can be derived from `depends` chains in `manifest.json`
- Both external files continue to work during transition — they are the fallback when packages don't carry their own `manifest.json`

---

## CLI extensions

### Schema validation of new fields

The CLI validates `content.json` and `manifest.json` with separate schemas, then performs cross-file consistency checks when both are present.

#### Shared sub-schemas

```typescript
/** A single reference or OR-group of alternatives */
const DependencyClauseSchema = z.union([z.string(), z.array(z.string()).min(1)]);

/** AND-list of dependency clauses (CNF: outer = AND, inner array = OR) */
const DependencyListSchema = z.array(DependencyClauseSchema);

const AuthorSchema = z
  .object({
    name: z.string().optional(),
    team: z.string().optional(),
  })
  .strict();

const GuideTargetingSchema = z
  .object({
    match: z.record(z.unknown()).optional(),
  })
  .passthrough();
```

#### Content schema (`content.json`)

```typescript
export const ContentJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
});
```

#### Manifest schema (`manifest.json`)

```typescript
export const ManifestJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Manifest id is required'),
  repository: z.string().optional(),
  // Metadata (flat)
  description: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  // Dependencies (flat, with CNF OR support)
  depends: DependencyListSchema.optional(),
  recommends: DependencyListSchema.optional(),
  suggests: DependencyListSchema.optional(),
  provides: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  replaces: z.array(z.string()).optional(),
  // Targeting
  targeting: GuideTargetingSchema.optional(),
});
```

#### Merged logical schema (for legacy single-file guides)

For backwards compatibility with single-file guides that carry all fields:

```typescript
export const JsonGuideSchemaStrict = z.object({
  schemaVersion: z.string().optional(),
  repository: z.string().optional(),
  id: z.string().min(1, 'Guide id is required'),
  title: z.string().min(1, 'Guide title is required'),
  blocks: z.array(JsonBlockSchema),
  // Metadata (flat)
  description: z.string().optional(),
  language: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  // Dependencies (flat, with CNF OR support)
  depends: DependencyListSchema.optional(),
  recommends: DependencyListSchema.optional(),
  suggests: DependencyListSchema.optional(),
  provides: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  replaces: z.array(z.string()).optional(),
  // Targeting
  targeting: GuideTargetingSchema.optional(),
});
```

### Package-level validation (new capability)

```bash
# Validate a single guide file (existing behavior)
npx pathfinder-cli validate ./guides/welcome-to-grafana/content.json

# Validate a package directory (new)
npx pathfinder-cli validate --package ./guides/welcome-to-grafana/

# Validate all packages in a directory tree (new)
npx pathfinder-cli validate --packages ./guides/
```

Package-level validation adds checks that single-file validation cannot perform:

| Check                         | What it validates                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Directory structure           | Package directory contains `content.json`                                               |
| ID consistency (directory)    | `content.json` `id` matches directory name                                              |
| ID consistency (cross-file)   | `manifest.json` `id` matches `content.json` `id` (when both present)                    |
| Manifest.json structure       | `manifest.json` passes `ManifestJsonSchema` validation (when present)                   |
| Dependency resolution (local) | All same-repo `depends`/`recommends` reference guide IDs that exist in the tree         |
| Circular dependency detection | No cycles in the dependency graph                                                       |
| Capability coverage           | Every `depends` target either exists as a guide ID or is `provides`-d by some guide     |
| Cross-repo references         | Warns on unresolvable cross-repo references (cannot validate without external metadata) |
| Conflict consistency          | `conflicts` pairs that are not symmetric generate a warning                             |
| Assets directory              | Warns if `content.json` references assets that don't exist in `assets/`                 |

### Dependency graph command (new)

```bash
# Output dependency graph as text
npx pathfinder-cli graph ./guides/

# Output as DOT format for visualization
npx pathfinder-cli graph --format dot ./guides/ | dot -Tsvg > graph.svg
```

Displays the dependency DAG across all packages in a directory tree. Useful for debugging, documentation, and verifying learning path structures.

### Future: build-index command

```bash
# Scan packages and produce index.json for the recommender
npx pathfinder-cli build-index ./guides/ --output index.json
```

This is noted as a future command and is **out of scope** for this design. See [deferred concerns](#deferred-concerns).

---

## Alignment with external formats

### Docs team learning journey YAML

The Grafana docs team expresses inter-guide relationships in a YAML format:

```yaml
- id: prom-data-source
  category: data-availability
  links:
    - to: metrics-drilldown
```

This maps naturally to the package model:

| YAML field   | Package equivalent           |
| ------------ | ---------------------------- |
| `id`         | `id`                         |
| `category`   | `category`                   |
| `links[].to` | `suggests` (or `recommends`) |

The `links.to` relationships are soft recommendations — "completing prom-data-source enables you to better pursue metrics-drilldown." These are `suggests` or `recommends` in Debian vocabulary, not hard `depends`.

The `category` field aligns directly. The documented convention uses the same taxonomy: `"data-availability"`, `"query-visualize"`, `"take-action"`.

The docs team's `*-lj` directory structure — a top-level directory containing ordered sub-directories of guides — maps directly to the [journey metapackage model](#learning-journeys). The top-level directory becomes the journey package with a `manifest.json` declaring `type: "journey"` and a `steps` array. Each sub-directory is a step package.

### Dublin Core / IEEE LOM

Phase 1 metadata field names are chosen to align with established standards where applicable:

| Package field         | Dublin Core      | IEEE LOM                          | Notes                                           |
| --------------------- | ---------------- | --------------------------------- | ----------------------------------------------- |
| `description`         | `dc:description` | `general.description`             | Direct alignment                                |
| `language`            | `dc:language`    | `general.language`                | BCP 47 tag; defaults to `"en"`                  |
| `author.name`         | `dc:creator`     | `lifeCycle.contribute.entity`     | Simplified structure                            |
| `difficulty`\*        | —                | `educational.difficulty`          | Deferred to Phase 2+; enum subset of LOM values |
| `estimatedDuration`\* | —                | `educational.typicalLearningTime` | Deferred to Phase 2+; format to be vetted       |

\* Deferred fields — not in Phase 1, but names are vetted against standards now to avoid future renames.

### SCORM

The package format is designed to be the **output target** for a future SCORM import pipeline. The two-file model aligns naturally with SCORM's separation of `imsmanifest.xml` (metadata) from content files:

| SCORM concept              | Package equivalent                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Package (ZIP)              | Package directory                                                                                             |
| `imsmanifest.xml` metadata | `manifest.json`                                                                                               |
| Organization tree          | [Journey metapackage](#learning-journeys) with `steps` array                                                  |
| Item (with sequencing)     | Step ordering via `steps` array                                                                               |
| SCO (interactive content)  | Step package — `content.json` with content blocks                                                             |
| Asset (static content)     | `assets/` directory within package                                                                            |
| Prerequisites              | `manifest.json` → `depends`                                                                                   |
| Sequencing (forward-only)  | Advisory `steps` ordering (see [step ordering and completion semantics](#step-ordering-and-completion-semantics)) |

The SCORM import pipeline writes two files per guide: `content.json` (converted from SCO HTML) and `manifest.json` (converted from `imsmanifest.xml` metadata). This separation means the importer naturally produces the correct package structure. For multi-SCO courses, the importer produces a journey metapackage with step packages — the same structure used for natively authored learning journeys.

SCORM-specific fields (`source`, `rights`, `educationalContext`) are deferred to the SCORM implementation phase but will be backward-compatible flat additions to `manifest.json`.

---

## Future-proofing

### Extensible flat namespace

Metadata fields live flat at the top level of `manifest.json`. Adding new optional fields is always backward-compatible. The Zod schema uses `.passthrough()` for forward compatibility — unknown fields in newer packages generate warnings but don't fail validation. See [namespace collision note](#namespace-collision-note) for why flat structure is safe given the bounded, standards-aligned field inventory.

### The `source` provenance pattern (future)

When SCORM import arrives, `manifest.json` gains a flat `source` field:

```json
{
  "id": "acme-sales-training",
  "source": {
    "format": "SCORM",
    "version": "1.2",
    "importedAt": "2026-02-07T00:00:00Z",
    "originalIdentifier": "com.acme.sales-training",
    "importToolVersion": "1.0.0"
  }
}
```

This pattern generalizes to any import source (xAPI, QTI, custom formats). The `format` discriminator allows tooling to branch on provenance.

### The `type` discriminator (future)

The `type` field is introduced with `"guide"` and `"journey"` in [learning journeys](#learning-journeys). Journeys are the first use of this discriminator, establishing the composition pattern.

Future `type` values for SCORM extend the same pattern:

- `"course"`: SCORM course decomposition — a refinement of the journey concept with potentially stricter sequencing semantics (course → modules → guides)
- `"module"`: Grouping of related guides without strict ordering (section overview rendering)

Both future types will build on the metapackage and `steps` infrastructure established by journeys, not introduce parallel composition machinery. Default remains `"guide"` for all existing content.

### Test environment metadata (future)

A flat `testEnvironment` field will be added to `manifest.json` when Layer 4 E2E infrastructure is ready to consume it:

```json
{
  "id": "advanced-alerting",
  "testEnvironment": {
    "tier": "managed",
    "minVersion": "11.0.0",
    "datasets": ["prometheus-sample-metrics"],
    "datasources": ["prometheus"],
    "plugins": ["grafana-oncall-app"]
  }
}
```

### Schema versioning strategy

| Version | Scope                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- |
| `1.0.0` | Current: single-file `content.json` with `id`, `title`, `blocks`, `schemaVersion`               |
| `1.1.0` | Phase 1 packages: two-file model (`content.json` + `manifest.json`), `assets/` directory, `type` and `steps` for journeys |
| `1.2.0` | Future: adds `source`, `keywords`, `difficulty`, `estimatedDuration`, `testEnvironment`; extends `type` with `"course"` and `"module"` |
| `2.0.0` | Reserved for breaking changes (field removal, semantic changes)                                 |

Any consumer can inspect `schemaVersion` and decide which fields to expect.

### CRD serialization readiness

The package format uses plain JSON with no Grafana-specific runtime dependencies. The CLI merges `content.json` and `manifest.json` into the logical `JsonGuide` type, which maps cleanly to Kubernetes Custom Resource Definitions:

```yaml
apiVersion: pathfinder.grafana.com/v1alpha1
kind: Guide
metadata:
  name: interactive-tutorials-prometheus-grafana-101
spec:
  # From content.json
  id: prometheus-grafana-101
  title: 'Prometheus & Grafana 101'
  blocks: [...]
  # From manifest.json (flat metadata and dependencies)
  repository: interactive-tutorials
  description: '...'
  language: en
  category: data-availability
  depends:
    - welcome-to-grafana
  targeting:
    match:
      and:
        - urlPrefixIn: ['/connections']
        - targetPlatform: oss
```

The CRD is a merged view — it does not reflect the file-level split. The split is an authoring concern; the CRD is a distribution and runtime concern.

---

## Deferred concerns

These are explicitly out of scope for this design but are documented here for future reference.

### Repository resolution

The `repository` field is a short name token. Mapping tokens to concrete locations (GitHub repos, API endpoints, artifact registries) requires a resolution layer that is not designed here. When multi-repo dependency resolution becomes necessary, a configuration mechanism (analogous to `apt`'s `sources.list`) will map repository tokens to fetch locations.

### Recommender index generation

A `pathfinder-cli build-index` command will scan packages and produce `index.json` for the recommender. Until this is built, `index.json` is maintained separately. The command should:

1. Scan all package directories in a tree
2. Read `manifest.json` for `description`, `targeting.match`, and FQI; read `content.json` for `title`
3. Assemble a recommender `Rule` per package
4. Output a single `index.json` file

Note: the recommender index is built primarily from `manifest.json`. The only field it needs from `content.json` is `title`. A future optimization could duplicate `title` as a flat field in `manifest.json` to avoid reading content files during index generation.

### Recommender consumption of package metadata

The recommender currently only consumes `index.json`. Evolving it to consume richer package metadata (difficulty, category, dependencies) for smarter recommendations is a future integration concern.

### CRD serialization

Packages will eventually be serialized to Kubernetes CRDs for the app platform backend. The package format is designed to map cleanly, but the CRD schema, API version, and serialization tooling are not designed here.

### Non-Grafana content

The format supports non-Grafana content by design (no Grafana-specific assumptions in `metadata`), but Phase 1 targets Grafana interactive guides exclusively. Non-Grafana use cases (sales training, compliance) are enabled by the extensible schema but not actively developed.

---

## Phased roadmap

### Phase 0: Schema foundation (1-2 weeks)

**Goal:** Define the two-file schema model (`ContentJsonSchema` + `ManifestJsonSchema`). Zero runtime changes. Full backwards compatibility.

**Deliverables:**

- [ ] Define `ContentJsonSchema` for `content.json` (`schemaVersion`, `id`, `title`, `blocks`)
- [ ] Define `ManifestJsonSchema` for `manifest.json` (flat metadata fields, flat dependency fields, `targeting`)
- [ ] Define shared sub-schemas (`DependencyClauseSchema`, `DependencyListSchema`, `AuthorSchema`, `GuideTargetingSchema`)
- [ ] Retain merged `JsonGuideSchemaStrict` for backwards compatibility with single-file guides
- [ ] Add `KNOWN_FIELDS._manifest` for `manifest.json` fields
- [ ] Bump `CURRENT_SCHEMA_VERSION` to `"1.1.0"`
- [ ] Add unit tests for content schema, package schema, and cross-file ID consistency
- [ ] Run `validate:strict` to confirm all existing guides still pass
- [ ] Update schema-coupling documentation

**Why first:** Everything downstream depends on the schema accepting these fields and the two-file model being defined.

### Phase 1: CLI package validation (2-3 weeks)

**Goal:** The CLI can validate a directory as a package (both `content.json` and `manifest.json`) and validate cross-package dependencies.

**Deliverables:**

- [ ] `--package` flag: validate a directory (expects `content.json`, optionally `manifest.json`)
- [ ] Cross-file consistency: `id` match between `content.json` and `manifest.json`
- [ ] `--packages` flag: validate a tree of package directories
- [ ] Dependency graph validator: resolution, cycle detection, capability coverage (reads from `manifest.json`)
- [ ] Cross-repo reference warnings (unresolvable without external metadata)
- [ ] `graph` command: output dependency DAG as text or DOT format
- [ ] Asset reference validation: warn if `content.json` references assets not in `assets/`
- [ ] Integration tests with sample package trees (valid and invalid, with and without `manifest.json`)

**Why second:** Enables CI validation of packages in `interactive-tutorials` before guides are converted. Tooling is ready before content migrates.

### Phase 2: Pilot package migration (1-2 weeks)

**Goal:** Convert 3-5 existing guides to the two-file package format and validate end-to-end.

**Deliverables:**

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` to directory packages
- [ ] For each, create `manifest.json` with flat metadata (description, language, category, author)
- [ ] Add dependency fields (depends, provides, suggests) to `manifest.json` to express the "Getting started" learning path
- [ ] Add `targeting` with recommender match expressions to `manifest.json`
- [ ] Verify plugin loads and renders `content.json` correctly (ignoring `manifest.json` at runtime)
- [ ] Verify `validate --packages` passes in CI (validates both files)
- [ ] Document the two-file package authoring workflow for content authors and metadata managers

**Why third:** Proof-of-concept that validates schema, CLI, and runtime work together. Small scope (3-5 guides) catches issues early.

### Phase 3: Learning journey integration (2-3 weeks)

**Goal:** Journey metapackages are a working package type. The CLI validates journeys, the dependency graph treats them as first-class nodes, and learning paths can use package dependencies alongside curated `paths.json`. See [learning journeys](#learning-journeys) for the full design.

**Deliverables:**

- [ ] Add `type` field to `ManifestJsonSchema` (`"guide"` default, `"journey"`)
- [ ] Add `steps` field to `ManifestJsonSchema` (ordered `string[]`, valid when `type: "journey"`)
- [ ] CLI: validate journey directories — nested step packages, `steps` array referencing child directories, cover page `content.json`
- [ ] CLI: dependency graph treats journeys as single nodes; `--expand-journeys` flag shows internal step structure
- [ ] Pilot: convert 1-2 existing `*-lj` directories to journey metapackages with `manifest.json`
- [ ] Validate step reuse: confirm that a step package can appear in multiple journey `steps` arrays
- [ ] Utility to compute learning paths from dependency DAG
- [ ] Reconciliation: curated `paths.json` takes priority; dependency-derived paths fill gaps
- [ ] UI: learning path cards use package metadata (description, category) when available
- [ ] Align with docs partners' YAML format for learning journey relationships

**Why fourth:** First user-visible payoff of the package model. Introduces the metapackage composition pattern that SCORM `"course"` and `"module"` types will later build on. Content authors and docs partners see dependency declarations reflected in the learning experience.

### Phase 4: Test environment metadata (2-3 weeks)

**Goal:** Guides declare test environment requirements; E2E runner uses them for routing.

**Deliverables:**

- [ ] Add flat `testEnvironment` field to `ManifestJsonSchema` (tier, minVersion, datasets, plugins, datasources)
- [ ] Extend CLI validation for testEnvironment fields in `manifest.json`
- [ ] E2E runner reads `manifest.json` for testEnvironment routing decisions
- [ ] Document testEnvironment authoring guidelines (authored in `manifest.json`)

**Why fifth:** Layer 4 foundation from the testing strategy. Depends on the package format being stable and adopted.

### Phase 5: SCORM foundation (3-4 weeks)

**Goal:** Extend the package format for SCORM import needs. Schema extensions only — not the importer itself. Builds on the `type` discriminator and metapackage composition model established by journeys in Phase 3.

**Deliverables:**

- [ ] Extend `type` field with `"course"` and `"module"` values (journey's `"guide"` and `"journey"` already in place from Phase 3)
- [ ] Add flat `source` field to `manifest.json` for provenance tracking
- [ ] Add flat `keywords`, `rights`, `educationalContext`, `difficulty`, `estimatedDuration` fields to `manifest.json`
- [ ] Course/module rendering in web display mode (table-of-contents page)
- [ ] Design SCORM import pipeline CLI interface

**Why sixth:** Extends the package format so it can receive SCORM-imported content. The journey metapackage model from Phase 3 provides the composition infrastructure; SCORM types refine it with import-specific semantics. The actual importer follows the phased plan in [SCORM.md](./SCORM.md).

### Phase 6+: SCORM import pipeline

Follows the 5-phase plan in the [SCORM analysis](./SCORM.md): parser, extractor, transformer, assembler, enhanced assessment types, scoring. The package format from Phases 0-5 is the foundation it writes to.

### Summary

| Phase                | Effort    | Unlocks                                             |
| -------------------- | --------- | --------------------------------------------------- |
| 0: Schema            | 1-2 weeks | Everything — `content.json` + `manifest.json` model |
| 1: CLI               | 2-3 weeks | CI validation, cross-file checks, dependency graph  |
| 2: Pilot             | 1-2 weeks | Proof-of-concept, runtime validation                |
| 3: Learning journeys | 2-3 weeks | Metapackage model, `type`/`steps`, docs partner alignment |
| 4: Test environment  | 2-3 weeks | Layer 4 E2E routing                                      |
| 5: SCORM foundation  | 3-4 weeks | SCORM import readiness, extends `type` with course/module |
| 6+: SCORM import     | 15+ weeks | Full SCORM conversion pipeline                      |

Total for Phases 0-4 (core package model): **8-12 weeks**. Delivers a fully functional package system serving learning journeys, E2E testing, and content lifecycle management — before any SCORM work begins.

---

## Decision log

Decisions made during the design discussion, with rationale.

| #   | Decision                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Packages are directories containing `content.json`                | Natural extension point for assets, sidecars; aligns with SCORM decomposition                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D2  | Identity: `repository` token + `id`, FQI = `repository/id`        | Follows Debian model; repository is a token, not a URL; resolution is external                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D3  | Default repository: `"interactive-tutorials"`                     | Backwards compat for all existing guides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D4  | Bare ID references resolve within same repository                 | Concise same-repo references; cross-repo uses FQI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D5  | Namespacing from Phase 1                                          | Avoids collision risk as multi-repo becomes real; semantic IDs over UUIDs                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D6  | Single `category` string                                          | Aligns with docs team taxonomy; multi-category deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D7  | `targeting.match` follows recommender's MatchExpr grammar         | Package suggests, recommender decides; loosely validated to avoid coupling                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D8  | Learning paths: both curated and derived                          | `paths.json` is editorial; dependency graph is structural; both coexist                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D9  | Multi-repo; resolution deferred                                   | Packages across repos is a known requirement; resolution mechanism is future work                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D10 | Grafana-first, extensible for non-Grafana                         | No gold-plating for SCORM; open extensibility is the goal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D11 | `build-index` deferred                                            | Recommender currently uses separately maintained `index.json`; future CLI command                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D12 | Vet metadata field names against standards                        | Cross-reference Dublin Core / IEEE LOM / SCORM before finalizing names                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D13 | Schema version `"1.1.0"` for package extension                    | Backward-compatible addition; minor version bump per semver                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D14 | Separate `content.json` (content) from `manifest.json` (metadata) | Follows Debian `control`/`data` separation. Multiple consumers (plugin, recommender, LMS, E2E runner) each need different data; separate files avoid full-parsing a large unified file. Block editor stays focused on content; metadata is managed by different roles with different tools. Eliminates merge conflicts between content and metadata changes.                                                                                                                                                                             |
| D15 | Optional `assets/` directory for non-JSON resources               | Aligns with SCORM asset packaging. Images, diagrams, and supplementary files live alongside content. Asset resolution deferred but convention established now.                                                                                                                                                                                                                                                                                                                                                                           |
| D16 | Flat metadata and dependency fields in `manifest.json`            | Follows Debian `control` file convention where all fields are peers at the same level. Reduces nesting depth, simplifies authoring and validation. Namespace collision risk is acceptable given the bounded, standards-aligned field inventory (see [namespace collision note](#namespace-collision-note)).                                                                                                                                                                                                                              |
| D17 | CNF OR syntax for dependency lists (nested arrays)                | Maps directly to Debian's comma + pipe semantics (`A \| B, C` → `[["A", "B"], "C"]`). Outer array = AND, inner array = OR. Backwards compatible: existing `["A", "B"]` (all strings) retains AND semantics. No string parsing required; fully validatable with Zod.                                                                                                                                                                                                                                                                      |
| D18 | Default `language` to `"en"`                                      | All existing content is English. Explicit default avoids mandatory boilerplate while preserving the field for future i18n and SCORM import.                                                                                                                                                                                                                                                                                                                                                                                              |
| D19 | Defer `estimatedDuration` and `difficulty` to Phase 2+            | No compelling MVP consumer for either field. No UI component displays them; no recommender logic consumes them. Field names are vetted against IEEE LOM now to avoid future renames. Will be needed if SCORM import or recommendation ranking arrives.                                                                                                                                                                                                                                                                                   |
| D20 | Metadata file named `manifest.json`, not `package.json`           | Avoids collision with Node.js `package.json`, which would cause friction with npm, IDEs, GitHub dependency graphs, and toolchain root detection across 100-200+ guide directories. `manifest.json` is semantically accurate (the file is a manifest of identity, metadata, dependencies, and targeting), parallels SCORM's `imsmanifest.xml`, is familiar to web developers (PWA/extension manifests), and survives the Phase 5 `type` expansion (a manifest for a course is still a manifest). No major toolchain claims this filename. |
| D21 | Journeys use the Debian metapackage model; steps are real packages | Package uniformity — one kind of thing, one identity model, one tooling set. Avoids inventing a "sub-unit" concept with scoped identity, fragment notation, or different validation rules. Follows the Debian metapackage precedent for composing coherent experiences from discrete components. Enables step reuse across journeys (the "flavors" advantage visible in the integration journeys that share `install-alloy`, `configure-alloy`, and `install-dashboards-alerts`). |
| D22 | `type` discriminator pulled forward with `"guide"` and `"journey"` | Journeys need the type discriminator now. Originally deferred to Phase 5 for SCORM. The journey `type` establishes the composition pattern that SCORM's `"course"` and `"module"` types will refine, not a separate system. |
| D23 | `steps` is a new ordered array field, not a Debian dependency construct | Debian `Depends` has no ordering semantics — `A, B, C` is conjunction, not sequence. Advisory linear ordering requires new machinery layered on top of the Debian model. The `steps` array is the single source of truth for step ordering; not dependency chains, not filesystem ordering, not a separate paths file. |
| D24 | Step ordering is advisory; journey completion is set-based | Users can jump into any step directly. Completion = all steps done, regardless of order. The `steps` array is the suggested reading path, not an enforcement mechanism. This matches the design constraint that journeys should encourage but not require sequential progression. |
| D25 | Nested package directories are permitted | Journey directories contain step package directories. The CLI must handle directory-within-directory package structure. This enables both physical containment (steps live under their journey) and logical flatness (steps are real packages with FQIs). |

---

## References

### Internal

- [Testing strategy](./TESTING_STRATEGY.md) — Content-as-Code vision and testing pyramid
- [SCORM analysis](./SCORM.md) — SCORM import feasibility study
- [Schema types](../../src/types/json-guide.types.ts) — Current TypeScript type definitions
- [Schema validation](../../src/types/json-guide.schema.ts) — Current Zod schemas
- [CLI validate command](../../src/cli/commands/validate.ts) — Current validation CLI
- [Bundled guides index](../../src/bundled-interactives/index.json) — Current recommendation manifest
- [Learning paths](../../src/learning-paths/paths.json) — Current curated learning paths

### External standards

- [Debian package dependencies](https://www.debian.org/doc/manuals/debian-faq/pkg-basics.en.html#depends)
- [Dublin Core metadata](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)
- [IEEE LOM (Learning Object Metadata)](https://standards.ieee.org/ieee/1484.12.1/7699/)
- [SCORM specifications](https://scorm.com/scorm-explained/technical-scorm/content-packaging)
- [BCP 47 language tags](https://www.rfc-editor.org/info/bcp47)
- [ISO 8601 durations](https://en.wikipedia.org/wiki/ISO_8601#Durations)

### Recommender

- Grafana-recommender rule definition (internal) — Authoritative `Rule` and `MatchExpr` definitions
