# Pathfinder package design

## Table of contents

- [Motivation](#motivation)
- [Design principles](#design-principles)
- [Package structure](#package-structure)
- [Separation of content and metadata](#separation-of-content-and-metadata)
- [Identity model](#identity-model)
- [Repository index](#repository-index)
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
- [Implementation plan](#implementation-plan)
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

Packages are identified by a **bare ID** — a globally unique string such as `"welcome-to-grafana"`. IDs contain no repository prefix and no path information. The `repository` field in `manifest.json` is provenance metadata (recording where a package originated), not part of the package's identity. When `repository` is absent, the default is `"interactive-tutorials"`. Resolution from bare ID to content location is handled by the [package resolver](./package/identity-and-resolution.md#package-resolution), not by the ID format.

> **Full detail:** [package/identity-and-resolution.md — Identity model](./package/identity-and-resolution.md#identity-model)

---

## Repository index

Each repository publishes a compiled `repository.json` that maps bare package IDs to filesystem paths and denormalized manifest metadata, following the Debian `Packages` index precedent. The file is generated by `pathfinder-cli build-repository`. The publication strategy varies by repository change velocity: low-velocity repositories (e.g., bundled guides in the plugin repo) commit `repository.json` as a lockfile verified in CI; high-velocity repositories (e.g., `interactive-tutorials`) generate it as a CI build artifact and publish directly to CDN, keeping it out of git entirely. Denormalization is safe because the file is always a compiled build artifact, never hand-edited. This decouples package identity from physical directory layout and enables dependency graph building from the index alone.

> **Full detail:** [package/identity-and-resolution.md — Repository index](./package/identity-and-resolution.md#repository-index)

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
  /** Bare package identifier — globally unique, must match content.json id */
  id: string;
  /** Repository provenance — records which repository this package originated from (default: "interactive-tutorials") */
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
  /** URL path where guide expects to begin execution (default: "/") */
  startingLocation?: string;

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

  /** Repository provenance — records which repository this package originated from (default: "interactive-tutorials") */
  repository?: string;

  /** Bare package identifier — globally unique */
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
  /** URL path where guide expects to begin execution (default: "/") */
  startingLocation?: string;

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
  "startingLocation": "/connections",
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

| Field              | Type                               | Default | Description                                                                                                                                      |
| ------------------ | ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `description`      | `string`                           | —       | Full description for discoverability and display                                                                                                 |
| `language`         | `string`                           | `"en"`  | Content language ([BCP 47](https://www.rfc-editor.org/info/bcp47) tag, e.g., `"en"`, `"es"`, `"ja"`). Defaults to `"en"` when absent.            |
| `category`         | `string`                           | —       | Content category for taxonomy alignment. Convention aligns with docs team taxonomy: `"data-availability"`, `"query-visualize"`, `"take-action"`. |
| `author`           | `{ name?: string; team?: string }` | —       | Content author or owning team                                                                                                                    |
| `startingLocation` | `string`                           | `"/"`   | URL path where guide expects to begin execution. Explicit contract for guide execution context.                                                  |

### Rationale for each field

| Field              | Consumer                                            | Rationale                                                                             |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `description`      | Recommendations, web display, index.json generation | Consolidates `summary` from `index.json` into the package                             |
| `language`         | i18n, SCORM import, web display                     | Minimal overhead, critical for non-English content                                    |
| `category`         | Taxonomy, docs team alignment, recommendations      | Aligns with docs team's journey categories                                            |
| `author`           | Failure routing, attribution, provenance            | Testing strategy identifies ownership as critical for escalation                      |
| `startingLocation` | Auto-recovery, e2e routing, recommender index       | Explicit contract for guide execution context; replaces implicit URL-based assumption |

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

Dependency fields (`depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`) live flat in `manifest.json` and follow the Debian package dependency model exactly. Dependencies use conjunctive normal form (CNF) with AND/OR semantics, support virtual capabilities via `provides`, and coexist with both curated learning paths (`paths.json`) and block-level `requirements`.

> **Full detail:** [package/dependencies.md](./package/dependencies.md)

---

## Learning journeys

A learning journey is an ordered sequence of guides that build toward a larger outcome, following the Debian **metapackage** pattern. Journeys are first-class packages with a `type: "journey"` discriminator and a `steps` array declaring the recommended reading order. Steps are real packages — not fragments or sub-units — enabling step reuse across journeys, a single identity model, and uniform tooling. Completion is set-based (all steps done, regardless of order), and ordering is advisory.

> **Full detail:** [package/learning-journeys.md](./package/learning-journeys.md)

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
   - Setting `source` to the bare package ID
3. Output a single `index.json` file

The recommender only needs `manifest.json` for most operations (targeting, description). It reads `content.json` only for the `title` field, which could alternatively be duplicated as a flat field in `manifest.json` in the future if needed.

Until `build-index` is implemented, `index.json` continues to be maintained separately. This is noted as a [deferred concern](#deferred-concerns).

---

## Backwards compatibility

### Schema level

`JsonGuideSchema` uses `.passthrough()` (via `.loose()`) which means unknown fields are allowed. Existing guides with only `{ schemaVersion, id, title, blocks }` in a single file pass validation without changes. The two-file model is additive — `manifest.json` is optional.

### KNOWN_FIELDS

For `content.json`: the existing `KNOWN_FIELDS._guide` applies unchanged. If `content.json` contains metadata/dependency/targeting fields (e.g., from a legacy single-file guide), they are accepted via `.passthrough()` but the canonical location is `manifest.json`.

For `manifest.json`: a new `KNOWN_FIELDS._manifest` set includes `'schemaVersion'`, `'id'`, `'repository'`, `'description'`, `'language'`, `'category'`, `'author'`, `'startingLocation'`, `'depends'`, `'recommends'`, `'suggests'`, `'provides'`, `'conflicts'`, `'replaces'`, and `'targeting'`.

### Schema version

The version bumps from `"1.0.0"` to `"1.1.0"`:

- `1.0.0` → `1.1.0`: backward-compatible addition of the two-file package model
- Consumers that don't understand the new fields safely ignore them
- The `.passthrough()` pattern already ensures this
- Both `content.json` and `manifest.json` carry `schemaVersion` independently

### Default values

| Field              | Default when absent                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `manifest.json`    | No package metadata (standalone guide with content only)                                     |
| `repository`       | `"interactive-tutorials"`                                                                    |
| `language`         | `"en"`                                                                                       |
| `startingLocation` | `"/"`                                                                                        |
| `targeting`        | No targeting (not recommended contextually; only reachable via direct link or learning path) |
| `assets/`          | No assets                                                                                    |

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

The CLI gains separate Zod schemas for `content.json` and `manifest.json` with cross-file consistency checks, package-level validation (directory structure, ID consistency, dependency resolution, cycle detection), and a dependency graph command. Schemas include shared sub-schemas for `DependencyList` (CNF AND/OR), `Author`, and `GuideTargeting`.

> **Full detail:** [package/cli-extensions.md](./package/cli-extensions.md)

---

## Alignment with external formats

The package model aligns with three external standards: the Grafana docs team's learning journey YAML (category taxonomy, `links.to` → `suggests`/`recommends`), Dublin Core / IEEE LOM metadata conventions (field names vetted for future compatibility), and SCORM's content packaging model (two-file separation, organization trees → journey metapackages).

> **Full detail:** [package/standards-alignment.md — Alignment with external formats](./package/standards-alignment.md#alignment-with-external-formats)

---

## Future-proofing

The format is designed for backward-compatible evolution: an extensible flat namespace in `manifest.json`, a `source` provenance pattern for SCORM import, a `type` discriminator for courses and modules, `testEnvironment` metadata for E2E routing, a schema versioning strategy (`1.0.0` → `1.1.0` → `1.2.0`), and CRD serialization readiness for Kubernetes.

> **Full detail:** [package/standards-alignment.md — Future-proofing](./package/standards-alignment.md#future-proofing)

---

## Deferred concerns

These are explicitly out of scope for this design but are documented here for future reference.

### Multi-repository package discovery

With bare IDs, the system needs a way to discover packages across multiple independently managed repositories. The [implementation plan](./PACKAGE-IMPLEMENTATION-PLAN.md) addresses this in phases: bundled content is migrated first as a local repository (Phase 2), a static catalog (Phase 4) aggregates all `repository.json` files into a single `packages-catalog.json` published to CDN, and a registry service (Phase 7) provides dynamic resolution with automatic catalog aggregation. All implement the same `PackageResolver` interface (see [package resolution](./package/identity-and-resolution.md#package-resolution)).

Until multi-repo is needed, the bundled repository is the only repository and resolution is handled by reading `repository.json` directly.

### Recommender index generation and `index.json` retirement

Today, the recommender consumes a hand-maintained `index.json` for targeting rules. After packages carry their own `targeting` in `manifest.json`, the recommender's input can be derived from `repository.json`, which includes denormalized metadata from each package's `manifest.json`.

The migration is incremental: as packages gain `manifest.json`, their targeting is compiled into the repository index. Guides that haven't migrated retain entries in the legacy `index.json`. When the last guide migrates, `index.json` is deleted. The details of the recommender's consumption format (whether it reads `repository.json` directly or receives a transformed subset) are deferred until the pilot migration (Phase 4) validates the end-to-end flow.

### Recommender consumption of package metadata

The recommender currently only consumes `index.json`. Evolving it to consume richer package metadata (difficulty, category, dependencies) for smarter recommendations is a future integration concern.

### CRD serialization

Packages will eventually be serialized to Kubernetes CRDs for the app platform backend. The package format is designed to map cleanly, but the CRD schema, API version, and serialization tooling are not designed here.

### `conflicts` and `replaces` enforcement

The `conflicts` and `replaces` dependency fields are included in the schema from Phase 1 for strict adherence to the Debian dependency vocabulary. The graph builder represents them as edges and the graph lint validates symmetric conflict declarations. However, no runtime system enforces these fields in the MVP — no recommender suppression, no UI warnings, no completion state migration. Enforcement behavior will be defined when a concrete consumer needs it. See [dependencies — deferred enforcement](./package/dependencies.md#deferred-enforcement-conflicts-and-replaces) for the full rationale.

### Non-Grafana content

The format supports non-Grafana content by design (no Grafana-specific assumptions in `metadata`), but Phase 1 targets Grafana interactive guides exclusively. Non-Grafana use cases (sales training, compliance) are enabled by the extensible schema but not actively developed.

---

## Implementation plan

The phased implementation plan for this design is maintained separately in
[PACKAGE-IMPLEMENTATION-PLAN.md](./PACKAGE-IMPLEMENTATION-PLAN.md).

---

## Decision log

35 design decisions with rationale are tracked in the decision log, covering identity model, dependency semantics, metadata conventions, journey composition, repository indexing, multi-repo resolution strategy, and implementation phasing.

> **Full decision log:** [package/decision-log.md](./package/decision-log.md)

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
