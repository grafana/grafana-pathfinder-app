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

Docs partners already express inter-guide dependencies in YAML (see [alignment with external formats](#alignment-with-external-formats)). The website team is planning to display guides on the web. Both need guides to be self-describing — carrying their own relationship metadata rather than relying on external manifests.

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

7. **Separate content from metadata.** Content (`content.json`) and package metadata (`package.json`) live in separate files within the package directory. Different consumers read only the file they need; different roles author only the file they own. This follows the Debian model where `control` metadata is physically separate from package data.

---

## Package structure

A package is a **directory** containing at minimum `content.json`. A `package.json` file carries metadata, dependencies, and targeting. An optional `assets/` directory holds non-JSON resources (images, diagrams, supplementary files). The directory name matches the guide `id`:

```
interactive-tutorials/
├── welcome-to-grafana/
│   ├── content.json          ← content blocks (block editor's domain)
│   └── package.json          ← metadata, dependencies, targeting
├── prometheus-grafana-101/
│   ├── content.json
│   ├── package.json
│   └── assets/               ← optional non-JSON assets
│       └── architecture.png
├── first-dashboard/
│   └── content.json          ← package.json optional; standalone guide
└── advanced-alerting/
    ├── content.json
    └── package.json
```

### Files in a package

| File           | Required | Owner                                  | Contains                                           |
| -------------- | -------- | -------------------------------------- | -------------------------------------------------- |
| `content.json` | Yes      | Content authors (block editor)         | `schemaVersion`, `id`, `title`, `blocks`           |
| `package.json` | No       | Product, enablement, recommender teams | `metadata`, `dependencies`, `targeting`            |
| `assets/`      | No       | Content authors                        | Images, diagrams, supplementary non-JSON resources |

For backwards compatibility, bare files (`welcome-to-grafana.json`) continue to work. The directory convention is adopted for new guides and migrated incrementally.

---

## Separation of content and metadata

### The Debian precedent

A Debian `.deb` binary package contains **two separate archives**: `control.tar.gz` (metadata, dependencies, maintainer scripts) and `data.tar.gz` (the installable files). The package manager reads `control.tar.gz` to make dependency and conflict decisions without ever extracting `data.tar.gz`. This physical separation is deliberate: metadata and content serve different consumers, are authored by different tools, and change for different reasons.

We adopt the same principle. A Pathfinder package separates metadata (`package.json`) from content (`content.json`).

### Multiple consumers, different needs

As the content corpus grows toward 100-200+ guides, different systems consume package data for different purposes. No single consumer needs the full merged artifact:

| Consumer                    | Reads          | Why                                                                       |
| --------------------------- | -------------- | ------------------------------------------------------------------------- |
| Pathfinder plugin           | `content.json` | Renders blocks in the sidebar; metadata is irrelevant                     |
| Recommender (`build-index`) | `package.json` | Needs `targeting.match` and `metadata.description`; blocks are irrelevant |
| Learning path engine        | `package.json` | Needs `dependencies` for DAG traversal; blocks are irrelevant             |
| LMS / catalog search        | `package.json` | Searches by title, category, difficulty, author; blocks are irrelevant    |
| E2E test runner             | Both           | Needs blocks to execute and `dependencies.testEnvironment` for routing    |
| CLI validator               | Both           | Cross-validates content structure and package metadata                    |

Separating the files means each consumer can parse only the file it needs. A recommender indexing 200 packages reads 200 small `package.json` files rather than 200 large `content.json` files that include potentially hundreds of content blocks each.

### Authoring role separation

Different roles own different concerns:

| Role                  | Edits          | Tool                                        |
| --------------------- | -------------- | ------------------------------------------- |
| Tech writers          | `content.json` | Block editor                                |
| Enablement / product  | `package.json` | Text editor, CLI, or future metadata editor |
| Recommender engineers | `package.json` | Text editor or recommender tooling          |
| Content architects    | `package.json` | Text editor, dependency graph tools         |

The block editor can read and write `content.json` without needing to understand, preserve, or risk clobbering metadata fields. It never touches `package.json`. This keeps the block editor focused on content authoring — its primary purpose.

Git history stays clean: content changes produce diffs in `content.json`; metadata and targeting changes produce diffs in `package.json`. Reviews are scoped to the concern being changed. Merge conflicts between content authors and metadata managers are eliminated.

### Logical merge

The CLI and build tools assemble a **logical guide** by merging `content.json` and `package.json` at validation and build time. The `id` field appears in both files and must match — this is a cross-file consistency check enforced by the CLI. When `package.json` is absent, the guide is standalone: it has content but no package metadata.

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

When a dependency reference contains no `/`, it is resolved within the same repository. This makes same-repo references concise. In `package.json`:

```json
{
  "id": "advanced-alerting",
  "repository": "interactive-tutorials",
  "dependencies": {
    "depends": ["intro-to-alerting"],
    "recommends": ["private-guides/deep-dive-alerting"]
  }
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

### Package schema (`package.json`)

The package file carries metadata, dependencies, and targeting. It is authored by product, enablement, or recommender teams — not by the block editor:

```typescript
interface PackageJson {
  /** Schema version — "1.1.0" for packages */
  schemaVersion?: string;
  /** Local identifier — must match content.json id */
  id: string;
  /** Repository token for multi-repo identity (default: "interactive-tutorials") */
  repository?: string;
  /** Package metadata for discoverability and attribution */
  metadata?: GuideMetadata;
  /** Debian-style dependency declarations */
  dependencies?: GuideDependencies;
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

  /** Package metadata for discoverability and attribution */
  metadata?: GuideMetadata;

  /** Debian-style dependency declarations */
  dependencies?: GuideDependencies;

  /** Advisory recommendation targeting */
  targeting?: GuideTargeting;
}
```

When `package.json` is absent, the logical `JsonGuide` is identical to `content.json` — a standalone guide with no package metadata.

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

**`prometheus-grafana-101/package.json`** — authored by product/enablement:

```json
{
  "schemaVersion": "1.1.0",
  "id": "prometheus-grafana-101",
  "repository": "interactive-tutorials",
  "metadata": {
    "description": "Learn to use Prometheus and Grafana to monitor your infrastructure.",
    "language": "en",
    "estimatedDuration": "PT10M",
    "difficulty": "beginner",
    "category": "data-availability",
    "author": {
      "name": "Enablement Team",
      "team": "interactive-learning"
    }
  },
  "dependencies": {
    "depends": ["welcome-to-grafana"],
    "recommends": ["first-dashboard"],
    "suggests": ["loki-grafana-101", "prometheus-advanced-queries"],
    "provides": ["datasource-configured"]
  },
  "targeting": {
    "match": {
      "and": [{ "urlPrefixIn": ["/connections"] }, { "targetPlatform": "oss" }]
    }
  }
}
```

---

## Metadata

All metadata fields live in `package.json`, not in `content.json`. This keeps the block editor's file clean and focused on content.

### Fields

```typescript
interface GuideMetadata {
  /** Full description for discoverability and display */
  description?: string;

  /** Content language (BCP 47 tag, e.g., "en", "es", "ja") */
  language?: string;

  /**
   * Estimated time to complete.
   * Format TBD — will be vetted against ISO 8601 duration (e.g., "PT10M")
   * and SCORM typicalLearningTime before finalizing.
   */
  estimatedDuration?: string;

  /** Difficulty level */
  difficulty?: 'beginner' | 'intermediate' | 'advanced';

  /**
   * Content category for taxonomy alignment.
   * Free-form string; documented convention aligns with docs team
   * taxonomy: "data-availability", "query-visualize", "take-action".
   */
  category?: string;

  /** Content author or owning team */
  author?: {
    name?: string;
    team?: string;
  };
}
```

### Rationale for each field

| Field               | Consumer                                            | Rationale                                                                    |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `description`       | Recommendations, web display, index.json generation | Consolidates `summary` from `index.json` into the package                    |
| `language`          | i18n, SCORM import, web display                     | Minimal overhead, critical for non-English content                           |
| `estimatedDuration` | Learning paths UI, web display                      | Currently in `paths.json` as `estimatedMinutes` — should live in the package |
| `difficulty`        | Recommendations, web display                        | Gap identified in SCORM analysis (G1)                                        |
| `category`          | Taxonomy, docs team alignment, recommendations      | Aligns with docs team's journey categories                                   |
| `author`            | Failure routing, attribution, provenance            | Testing strategy identifies ownership as critical for escalation             |

### Deferred metadata fields

These fields are not in Phase 1 but the schema is designed to accept them as backward-compatible additions in future phases:

| Field                | Phase       | Reason to defer                                      |
| -------------------- | ----------- | ---------------------------------------------------- |
| `keywords`           | Phase 2+    | No consumer yet; recommendations use URL-based rules |
| `rights`             | SCORM phase | Only needed for imported content with licensing      |
| `source`             | SCORM phase | Provenance tracking for imported content             |
| `educationalContext` | SCORM phase | Educational context classification                   |

---

## Dependencies

Dependencies are declared in `package.json`. They express structural relationships between guides — prerequisites, recommendations, capabilities, and conflicts.

### Fields

```typescript
interface GuideDependencies {
  /** Hard prerequisites — must be completed before this guide is accessible */
  depends?: string[];

  /** Soft prerequisites — recommended but not required */
  recommends?: string[];

  /** Related content for enrichment ("you might also like") */
  suggests?: string[];

  /** Virtual capabilities this guide provides on completion */
  provides?: string[];

  /** Guides this one conflicts with (mutually exclusive) */
  conflicts?: string[];

  /** Guides this one supersedes entirely */
  replaces?: string[];
}
```

**TODO**: Do we want to support logical AND/OR in dependencies/recommends/etc? Alternatively, if
the `GuideTargeting` Api Spec can be reused here.

All references use FQI format (`"repository/id"`) for cross-repo or bare `id` for same-repo. See [identity model](#identity-model).

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

| Concern         | Block-level `requirements`                     | Guide-level `dependencies`                         |
| --------------- | ---------------------------------------------- | -------------------------------------------------- |
| **Scope**       | Single step/block                              | Entire guide                                       |
| **Purpose**     | Runtime gating ("can this step execute now?")  | Structural metadata ("what does this guide need?") |
| **Format**      | String array (`["has-datasource:prometheus"]`) | Structured object with named fields                |
| **Evaluation**  | Real-time in browser during guide execution    | Pre-flight by test runner; UI filtering            |
| **Persistence** | No                                             | Capabilities persist on guide completion           |

### Relationship to learning paths

Learning paths exist as **both** curated collections and dependency-derived structures:

- **Curated**: `paths.json` continues to define editorially curated learning paths with explicit ordering, badging, and presentation metadata. This is a human editorial product.
- **Derived**: The dependency graph formed by `depends`/`recommends`/`suggests` is a structural relationship that the recommender can exploit to compute on-the-fly learning paths based on user context and graph topology.

Both coexist. `paths.json` references guides by FQI. The dependency graph is a parallel structure that enriches the recommender's understanding of content relationships.

---

## Targeting

Targeting rules are declared in `package.json`.

### Purpose

Packages carry an advisory `targeting` field that suggests how the recommender should surface the content. The recommender retains full authority to override, modify, or ignore these suggestions.

### Structure

```typescript
interface GuideTargeting {
  /**
   * Match expression following the recommender's MatchExpr grammar.
   * Loosely validated in the package schema — the authoritative definition
   * lives in the grafana-recommender service.
   *
   * @see recommender repo (internal)
   */
  match?: Record<string, unknown>;
}
```

The `match` field follows the recommender's `MatchExpr` grammar, which supports:

- Boolean combinators: `and`, `or`
- URL matching: `urlRegex`, `urlPrefix`, `urlPrefixIn`
- Datasource context: `datasource`, `datasourceIn`, `allDatasources`, `noDatasources`
- Role-based matching: `userRole`, `userRoleIn`
- Tag matching: `tag`, `tagIn`, `allTags`
- Cohort targeting: `cohort`, `cohortIn`
- Platform targeting: `targetPlatform`, `targetPlatformIn`

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
2. For each package, read `package.json` and `content.json`:
   - Taking `title` from `content.json`
   - Taking `description` from `package.json` → `metadata.description`
   - Computing `url` from the package's deployment location
   - Copying `match` from `package.json` → `targeting.match`
   - Setting `source` to the package FQI
3. Output a single `index.json` file

The recommender only needs `package.json` for most operations (targeting, metadata). It reads `content.json` only for the `title` field, which could alternatively be duplicated into `package.json` metadata in the future if needed.

Until `build-index` is implemented, `index.json` continues to be maintained separately. This is noted as a [deferred concern](#deferred-concerns).

---

## Backwards compatibility

### Schema level

`JsonGuideSchema` uses `.passthrough()` (via `.loose()`) which means unknown fields are allowed. Existing guides with only `{ schemaVersion, id, title, blocks }` in a single file pass validation without changes. The two-file model is additive — `package.json` is optional.

### KNOWN_FIELDS

For `content.json`: the existing `KNOWN_FIELDS._guide` applies unchanged. If `content.json` contains metadata/dependency/targeting fields (e.g., from a legacy single-file guide), they are accepted via `.passthrough()` but the canonical location is `package.json`.

For `package.json`: a new `KNOWN_FIELDS._package` set includes `'schemaVersion'`, `'id'`, `'repository'`, `'metadata'`, `'dependencies'`, and `'targeting'`.

### Schema version

The version bumps from `"1.0.0"` to `"1.1.0"`:

- `1.0.0` → `1.1.0`: backward-compatible addition of the two-file package model
- Consumers that don't understand the new fields safely ignore them
- The `.passthrough()` pattern already ensures this
- Both `content.json` and `package.json` carry `schemaVersion` independently

### Default values

| Field          | Default when absent                                                                          |
| -------------- | -------------------------------------------------------------------------------------------- |
| `package.json` | No package metadata (standalone guide with content only)                                     |
| `repository`   | `"interactive-tutorials"`                                                                    |
| `metadata`     | No metadata (guide is opaque)                                                                |
| `dependencies` | No dependencies (standalone guide)                                                           |
| `targeting`    | No targeting (not recommended contextually; only reachable via direct link or learning path) |
| `assets/`      | No assets                                                                                    |

### Migration path

1. Existing bare `*.json` files continue to work indefinitely
2. When a guide gains package structure, move it into a directory: `first-dashboard.json` → `first-dashboard/content.json`
3. When a guide gains metadata, create `package.json` alongside `content.json`
4. This is done incrementally, one guide at a time
5. The CLI accepts bare files, directory paths with only `content.json`, and full packages with both files

### Legacy single-file guides

For backwards compatibility, the CLI also accepts a single `content.json` that contains metadata/dependency/targeting fields inline (the original unified-file design). When the CLI encounters this, it treats the file as both content and package metadata. This ensures that any guide authored before the two-file split continues to work. New guides should use the two-file model.

### Consolidation of external metadata

- `index.json` entries (`summary`, `url`, `targetPlatform`) can be gradually migrated into `package.json` `metadata` and `targeting`
- `paths.json` guide ordering can be derived from `dependencies.depends` chains in `package.json`
- Both external files continue to work during transition — they are the fallback when packages don't carry their own `package.json`

---

## CLI extensions

### Schema validation of new fields

The CLI validates `content.json` and `package.json` with separate schemas, then performs cross-file consistency checks when both are present.

#### Shared sub-schemas

```typescript
const GuideMetadataSchema = z
  .object({
    description: z.string().optional(),
    language: z.string().optional(),
    estimatedDuration: z.string().optional(),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    category: z.string().optional(),
    author: z
      .object({
        name: z.string().optional(),
        team: z.string().optional(),
      })
      .optional(),
  })
  .strict();

const GuideDependenciesSchema = z
  .object({
    depends: z.array(z.string()).optional(),
    recommends: z.array(z.string()).optional(),
    suggests: z.array(z.string()).optional(),
    provides: z.array(z.string()).optional(),
    conflicts: z.array(z.string()).optional(),
    replaces: z.array(z.string()).optional(),
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

#### Package schema (`package.json`)

```typescript
export const PackageJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Package id is required'),
  repository: z.string().optional(),
  metadata: GuideMetadataSchema.optional(),
  dependencies: GuideDependenciesSchema.optional(),
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
  metadata: GuideMetadataSchema.optional(),
  dependencies: GuideDependenciesSchema.optional(),
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
| ID consistency (cross-file)   | `package.json` `id` matches `content.json` `id` (when both present)                     |
| Package.json structure        | `package.json` passes `PackageJsonSchema` validation (when present)                     |
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

| YAML field   | Package equivalent                        |
| ------------ | ----------------------------------------- |
| `id`         | `id`                                      |
| `category`   | `metadata.category`                       |
| `links[].to` | `dependencies.suggests` (or `recommends`) |

The `links.to` relationships are soft recommendations — "completing prom-data-source enables you to better pursue metrics-drilldown." These are `suggests` or `recommends` in Debian vocabulary, not hard `depends`.

The `category` field aligns directly with `metadata.category`. The documented convention uses the same taxonomy: `"data-availability"`, `"query-visualize"`, `"take-action"`.

### Dublin Core / IEEE LOM

Phase 1 metadata field names are chosen to align with established standards where applicable:

| Package field       | Dublin Core      | IEEE LOM                          | Notes                     |
| ------------------- | ---------------- | --------------------------------- | ------------------------- |
| `description`       | `dc:description` | `general.description`             | Direct alignment          |
| `language`          | `dc:language`    | `general.language`                | BCP 47 tag                |
| `author.name`       | `dc:creator`     | `lifeCycle.contribute.entity`     | Simplified structure      |
| `difficulty`        | —                | `educational.difficulty`          | Enum subset of LOM values |
| `estimatedDuration` | —                | `educational.typicalLearningTime` | Format to be vetted       |

### SCORM

The package format is designed to be the **output target** for a future SCORM import pipeline. The two-file model aligns naturally with SCORM's separation of `imsmanifest.xml` (metadata) from content files:

| SCORM concept              | Package equivalent                      |
| -------------------------- | --------------------------------------- |
| Package (ZIP)              | Package directory                       |
| `imsmanifest.xml` metadata | `package.json`                          |
| Organization tree          | Multiple packages linked by `depends`   |
| SCO (interactive content)  | `content.json` with content blocks      |
| Asset (static content)     | `assets/` directory within package      |
| Prerequisites              | `package.json` → `dependencies.depends` |
| Sequencing (forward-only)  | Linear `depends` chain                  |

The SCORM import pipeline writes two files per guide: `content.json` (converted from SCO HTML) and `package.json` (converted from `imsmanifest.xml` metadata). This separation means the importer naturally produces the correct package structure.

SCORM-specific fields (`metadata.source`, `metadata.rights`, `metadata.educationalContext`) are deferred to the SCORM implementation phase but will be backward-compatible additions to `package.json`.

---

## Future-proofing

### Extensible metadata namespace

The `metadata` object in `package.json` is a bag of optional fields. Adding new fields is always backward-compatible. The Zod sub-schema uses `.strict()` for validation precision in the current version, but the outer package schema uses `.passthrough()` for forward compatibility. Unknown sub-fields in newer packages generate warnings but don't fail validation.

### The `source` provenance pattern (future)

When SCORM import arrives, `package.json` gains `metadata.source`:

```json
{
  "id": "acme-sales-training",
  "metadata": {
    "source": {
      "format": "SCORM",
      "version": "1.2",
      "importedAt": "2026-02-07T00:00:00Z",
      "originalIdentifier": "com.acme.sales-training",
      "importToolVersion": "1.0.0"
    }
  }
}
```

This pattern generalizes to any import source (xAPI, QTI, custom formats). The `format` discriminator allows tooling to branch on provenance.

### The `type` discriminator (future)

Adding `type: "guide" | "course" | "module"` enables:

- SCORM course decomposition (course → modules → guides)
- Different rendering (course renders as table-of-contents, module as section overview)
- Different validation rules per type
- Default: `"guide"` for all existing content

### Test environment metadata (future)

`dependencies.testEnvironment` will be added to `package.json` when Layer 4 E2E infrastructure is ready to consume it:

```json
{
  "id": "advanced-alerting",
  "dependencies": {
    "testEnvironment": {
      "tier": "managed",
      "minVersion": "11.0.0",
      "datasets": ["prometheus-sample-metrics"],
      "datasources": ["prometheus"],
      "plugins": ["grafana-oncall-app"]
    }
  }
}
```

### Schema versioning strategy

| Version | Scope                                                                                       |
| ------- | ------------------------------------------------------------------------------------------- |
| `1.0.0` | Current: single-file `content.json` with `id`, `title`, `blocks`, `schemaVersion`           |
| `1.1.0` | Phase 1 packages: two-file model (`content.json` + `package.json`), `assets/` directory     |
| `1.2.0` | Future: adds `type`, `metadata.source`, `metadata.keywords`, `dependencies.testEnvironment` |
| `2.0.0` | Reserved for breaking changes (field removal, semantic changes)                             |

Any consumer can inspect `schemaVersion` and decide which fields to expect.

### CRD serialization readiness

The package format uses plain JSON with no Grafana-specific runtime dependencies. The CLI merges `content.json` and `package.json` into the logical `JsonGuide` type, which maps cleanly to Kubernetes Custom Resource Definitions:

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
  # From package.json
  repository: interactive-tutorials
  metadata:
    description: '...'
    difficulty: beginner
  dependencies:
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
2. Read `package.json` for `metadata.description`, `targeting.match`, and FQI; read `content.json` for `title`
3. Assemble a recommender `Rule` per package
4. Output a single `index.json` file

Note: the recommender index is built primarily from `package.json`. The only field it needs from `content.json` is `title`. A future optimization could duplicate `title` in `package.json` metadata to avoid reading content files during index generation.

### Recommender consumption of package metadata

The recommender currently only consumes `index.json`. Evolving it to consume richer package metadata (difficulty, category, dependencies) for smarter recommendations is a future integration concern.

### CRD serialization

Packages will eventually be serialized to Kubernetes CRDs for the app platform backend. The package format is designed to map cleanly, but the CRD schema, API version, and serialization tooling are not designed here.

### Non-Grafana content

The format supports non-Grafana content by design (no Grafana-specific assumptions in `metadata`), but Phase 1 targets Grafana interactive guides exclusively. Non-Grafana use cases (sales training, compliance) are enabled by the extensible schema but not actively developed.

---

## Phased roadmap

### Phase 0: Schema foundation (1-2 weeks)

**Goal:** Define the two-file schema model (`ContentJsonSchema` + `PackageJsonSchema`). Zero runtime changes. Full backwards compatibility.

**Deliverables:**

- [ ] Define `ContentJsonSchema` for `content.json` (`schemaVersion`, `id`, `title`, `blocks`)
- [ ] Define `PackageJsonSchema` for `package.json` (`schemaVersion`, `id`, `repository`, `metadata`, `dependencies`, `targeting`)
- [ ] Define shared sub-schemas (`GuideMetadataSchema`, `GuideDependenciesSchema`, `GuideTargetingSchema`)
- [ ] Retain merged `JsonGuideSchemaStrict` for backwards compatibility with single-file guides
- [ ] Add `KNOWN_FIELDS._package` for `package.json` fields
- [ ] Bump `CURRENT_SCHEMA_VERSION` to `"1.1.0"`
- [ ] Add unit tests for content schema, package schema, and cross-file ID consistency
- [ ] Run `validate:strict` to confirm all existing guides still pass
- [ ] Update schema-coupling documentation

**Why first:** Everything downstream depends on the schema accepting these fields and the two-file model being defined.

### Phase 1: CLI package validation (2-3 weeks)

**Goal:** The CLI can validate a directory as a package (both `content.json` and `package.json`) and validate cross-package dependencies.

**Deliverables:**

- [ ] `--package` flag: validate a directory (expects `content.json`, optionally `package.json`)
- [ ] Cross-file consistency: `id` match between `content.json` and `package.json`
- [ ] `--packages` flag: validate a tree of package directories
- [ ] Dependency graph validator: resolution, cycle detection, capability coverage (reads from `package.json`)
- [ ] Cross-repo reference warnings (unresolvable without external metadata)
- [ ] `graph` command: output dependency DAG as text or DOT format
- [ ] Asset reference validation: warn if `content.json` references assets not in `assets/`
- [ ] Integration tests with sample package trees (valid and invalid, with and without `package.json`)

**Why second:** Enables CI validation of packages in `interactive-tutorials` before guides are converted. Tooling is ready before content migrates.

### Phase 2: Pilot package migration (1-2 weeks)

**Goal:** Convert 3-5 existing guides to the two-file package format and validate end-to-end.

**Deliverables:**

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` to directory packages
- [ ] For each, create `package.json` with `metadata` (description, difficulty, estimatedDuration, author, category)
- [ ] Add `dependencies` (depends, provides, suggests) to `package.json` to express the "Getting started" learning path
- [ ] Add `targeting` with recommender match expressions to `package.json`
- [ ] Verify plugin loads and renders `content.json` correctly (ignoring `package.json` at runtime)
- [ ] Verify `validate --packages` passes in CI (validates both files)
- [ ] Document the two-file package authoring workflow for content authors and metadata managers

**Why third:** Proof-of-concept that validates schema, CLI, and runtime work together. Small scope (3-5 guides) catches issues early.

### Phase 3: Learning journey integration (2-3 weeks)

**Goal:** Learning paths can use package dependencies alongside curated `paths.json`.

**Deliverables:**

- [ ] Utility to compute learning paths from dependency DAG
- [ ] Reconciliation: curated `paths.json` takes priority; dependency-derived paths fill gaps
- [ ] UI: learning path cards use package metadata (description, difficulty, estimatedDuration) when available
- [ ] Align with docs partners' YAML format for learning journey relationships
- [ ] Validate that `recommends`/`suggests` from packages align with docs team's `links.to` semantics

**Why fourth:** First user-visible payoff of the package model. Content authors and docs partners see dependency declarations reflected in the learning experience.

### Phase 4: Test environment metadata (2-3 weeks)

**Goal:** Guides declare test environment requirements; E2E runner uses them for routing.

**Deliverables:**

- [ ] Add `dependencies.testEnvironment` to `PackageJsonSchema` (tier, minVersion, datasets, plugins, datasources)
- [ ] Extend CLI validation for testEnvironment fields in `package.json`
- [ ] E2E runner reads `package.json` for testEnvironment routing decisions
- [ ] Document testEnvironment authoring guidelines (authored in `package.json`)

**Why fifth:** Layer 4 foundation from the testing strategy. Depends on the package format being stable and adopted.

### Phase 5: SCORM foundation (3-4 weeks)

**Goal:** Extend the package format for SCORM import needs. Schema extensions only — not the importer itself.

**Deliverables:**

- [ ] Add `type` field to `PackageJsonSchema` (`"guide"` | `"course"` | `"module"`)
- [ ] Add `metadata.source` to `package.json` for provenance tracking
- [ ] Add `metadata.keywords`, `metadata.rights`, `metadata.educationalContext` to `package.json`
- [ ] Course/module rendering in web display mode (table-of-contents page)
- [ ] Design SCORM import pipeline CLI interface

**Why sixth:** Extends the package format so it can receive SCORM-imported content. The actual importer follows the phased plan in [SCORM.md](./SCORM.md).

### Phase 6+: SCORM import pipeline

Follows the 5-phase plan in the [SCORM analysis](./SCORM.md): parser, extractor, transformer, assembler, enhanced assessment types, scoring. The package format from Phases 0-5 is the foundation it writes to.

### Summary

| Phase                | Effort    | Unlocks                                            |
| -------------------- | --------- | -------------------------------------------------- |
| 0: Schema            | 1-2 weeks | Everything — `content.json` + `package.json` model |
| 1: CLI               | 2-3 weeks | CI validation, cross-file checks, dependency graph |
| 2: Pilot             | 1-2 weeks | Proof-of-concept, runtime validation               |
| 3: Learning journeys | 2-3 weeks | User-visible value, docs partner alignment         |
| 4: Test environment  | 2-3 weeks | Layer 4 E2E routing                                |
| 5: SCORM foundation  | 3-4 weeks | SCORM import readiness, `type` discriminator       |
| 6+: SCORM import     | 15+ weeks | Full SCORM conversion pipeline                     |

Total for Phases 0-4 (core package model): **8-12 weeks**. Delivers a fully functional package system serving learning journeys, E2E testing, and content lifecycle management — before any SCORM work begins.

---

## Decision log

Decisions made during the design discussion, with rationale.

| #   | Decision                                                         | Rationale                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Packages are directories containing `content.json`               | Natural extension point for assets, sidecars; aligns with SCORM decomposition                                                                                                                                                                                                                                                                                |
| D2  | Identity: `repository` token + `id`, FQI = `repository/id`       | Follows Debian model; repository is a token, not a URL; resolution is external                                                                                                                                                                                                                                                                               |
| D3  | Default repository: `"interactive-tutorials"`                    | Backwards compat for all existing guides                                                                                                                                                                                                                                                                                                                     |
| D4  | Bare ID references resolve within same repository                | Concise same-repo references; cross-repo uses FQI                                                                                                                                                                                                                                                                                                            |
| D5  | Namespacing from Phase 1                                         | Avoids collision risk as multi-repo becomes real; semantic IDs over UUIDs                                                                                                                                                                                                                                                                                    |
| D6  | Single `metadata.category` string                                | Aligns with docs team taxonomy; multi-category deferred                                                                                                                                                                                                                                                                                                      |
| D7  | `targeting.match` follows recommender's MatchExpr grammar        | Package suggests, recommender decides; loosely validated to avoid coupling                                                                                                                                                                                                                                                                                   |
| D8  | Learning paths: both curated and derived                         | `paths.json` is editorial; dependency graph is structural; both coexist                                                                                                                                                                                                                                                                                      |
| D9  | Multi-repo; resolution deferred                                  | Packages across repos is a known requirement; resolution mechanism is future work                                                                                                                                                                                                                                                                            |
| D10 | Grafana-first, extensible for non-Grafana                        | No gold-plating for SCORM; open extensibility is the goal                                                                                                                                                                                                                                                                                                    |
| D11 | `build-index` deferred                                           | Recommender currently uses separately maintained `index.json`; future CLI command                                                                                                                                                                                                                                                                            |
| D12 | Vet metadata field names against standards                       | Cross-reference Dublin Core / IEEE LOM / SCORM before finalizing names                                                                                                                                                                                                                                                                                       |
| D13 | Schema version `"1.1.0"` for package extension                   | Backward-compatible addition; minor version bump per semver                                                                                                                                                                                                                                                                                                  |
| D14 | Separate `content.json` (content) from `package.json` (metadata) | Follows Debian `control`/`data` separation. Multiple consumers (plugin, recommender, LMS, E2E runner) each need different data; separate files avoid full-parsing a large unified file. Block editor stays focused on content; metadata is managed by different roles with different tools. Eliminates merge conflicts between content and metadata changes. |
| D15 | Optional `assets/` directory for non-JSON resources              | Aligns with SCORM asset packaging. Images, diagrams, and supplementary files live alongside content. Asset resolution deferred but convention established now.                                                                                                                                                                                               |

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
