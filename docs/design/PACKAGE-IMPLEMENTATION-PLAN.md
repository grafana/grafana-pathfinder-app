# Package implementation plan

This is the phased implementation plan for the [Pathfinder package design](./PATHFINDER-PACKAGE-DESIGN.md). It can be changed, elaborated, or removed as implementation proceeds — the design spec is the source of truth for the package format and will remain.

---

## Testing strategy alignment

This plan is designed to support and further the [content testing strategy](./TESTING_STRATEGY.md) ("Enablement Observability"). Each phase names which testing layer(s) it extends:

| Layer | Name                        | Speed      | Description                                           |
| ----- | --------------------------- | ---------- | ----------------------------------------------------- |
| 1     | Static analysis             | Instant    | Schema validation, lint, registry checks — no runtime |
| 2     | Engine unit tests           | Seconds    | Parser, executor, requirements — mocked DOM           |
| 3     | E2E integration             | Minutes    | Playwright against local Grafana                      |
| 4     | Live environment validation | 10-30 min+ | Cross-environment, version matrix, managed datasets   |

### Phase-to-layer mapping

| Phase                                       | Testing layers    |
| ------------------------------------------- | ----------------- |
| 0: Schema foundation                        | Layer 1           |
| 1: CLI package validation                   | Layer 1           |
| 2: Bundled repository migration             | Layer 1 + Layer 2 |
| 3: Plugin runtime resolution                | Layer 2           |
| 4: Pilot migration of interactive-tutorials | Layer 2 + Layer 3 |
| 5: Learning journey integration             | Layer 1 + Layer 2 |
| 6: Layer 4 test environment routing         | Layer 4           |
| 7: Repository registry service              | —                 |
| 8: SCORM foundation                         | —                 |
| 9+: SCORM import pipeline                   | —                 |

---

## Phases

### Phase 0: Schema foundation and Layer 1 extension

**Goal:** Define the two-file schema model (`ContentJsonSchema` + `ManifestJsonSchema`) and the repository index (`repository.json`) that resolves package ids to filesystem paths. Zero runtime changes. Full backwards compatibility.

**Testing layers:** Layer 1

**Deliverables:**

- [ ] Define `ContentJsonSchema` for `content.json` (`schemaVersion`, `id`, `title`, `blocks`)
- [ ] Define `ManifestJsonSchema` for `manifest.json` (flat metadata fields, flat dependency fields, `targeting`)
- [ ] **Package identity model:**
  - [ ] Package IDs are bare strings, globally unique (e.g., `"welcome-to-grafana"`)
  - [ ] No repository prefix in IDs (not `"repo/id"`, just `"id"`)
  - [ ] `repository` field in manifest is provenance metadata, not part of identity or resolution
  - [ ] Dependencies reference bare IDs: `depends: ["foo"]` not `depends: ["repo/foo"]`
  - [ ] Allows packages to move between repositories without ID changes
  - [ ] Resolution handled by PackageResolver (Phase 3), not by parsing ID syntax
- [ ] **Manifest field requirements and defaults:**
  - [ ] **Hard requirements (ERROR if missing):** `id`, `type`
  - [ ] **Defaults with INFO validation message:**
    - `repository` → `"interactive-tutorials"`
    - `language` → `"en"`
    - `schemaVersion` → `CURRENT_SCHEMA_VERSION` (currently `"1.1.0"`)
    - `depends` → `[]`
    - `recommends` → `[]`
    - `suggests` → `[]`
    - `provides` → `[]`
    - `conflicts` → `[]`
    - `replaces` → `[]`
  - [ ] **Defaults with WARN validation message:**
    - `description` → `undefined`
    - `category` → `undefined`
    - `targeting` → `undefined`
    - `startingLocation` → `"/"` (URL path where guide expects to execute before step 1)
  - [ ] **Defaults with INFO validation message:**
    - `author` → `undefined`
    - `testEnvironment` → default structure indicating Grafana Cloud is required
  - [ ] **Conditional ERROR:** `steps` is required when `type: "journey"`
  - [ ] Schema uses Zod `.default()` chaining to apply defaults during parsing
  - [ ] CLI validation emits ERROR/WARN/INFO messages based on missing field severity
- [ ] Include `testEnvironment` field in `ManifestJsonSchema` from day one with default structure
- [ ] Define shared sub-schemas (`DependencyClauseSchema`, `DependencyListSchema`, `AuthorSchema`, `GuideTargetingSchema`)
- [ ] Retain merged `JsonGuideSchemaStrict` for backwards compatibility with single-file guides
- [ ] Add `KNOWN_FIELDS._manifest` for `manifest.json` fields
- [ ] Bump `CURRENT_SCHEMA_VERSION` to `"1.1.0"`
- [ ] Define `repository.json` specification (bare package id → `{ path, ...metadata }` mapping, compiled build artifact)
- [ ] Denormalize manifest metadata into `repository.json` entries: each entry uses bare package ID as key and includes `{ path, title, description, category, type, startingLocation, depends, recommends, suggests, provides, conflicts, replaces }` — enables dependency graph building without re-reading every `manifest.json`
- [ ] Example structure: `{ "welcome-to-grafana": { "path": "welcome-to-grafana/", "title": "...", "type": "guide", ... } }`
- [ ] **Forward compatibility:** repository.json format serves both static catalog aggregation (Phase 4) and future repository registry ingestion (Phase 7). Design for dual use: build-time aggregation and runtime discovery.
- [ ] Implement `pathfinder-cli build-repository` command (scans package tree, reads both `content.json` and `manifest.json` for each package, emits denormalized `repository.json` with bare IDs)
- [ ] Add pre-commit hook for `interactive-tutorials` that regenerates `repository.json` on commit
- [ ] CI verification: rebuild `repository.json` from scratch, diff against committed version, fail on divergence
- [ ] Add Layer 1 unit tests for content schema, package schema, cross-file ID consistency, and repository index generation — extending the existing validation infrastructure in `src/validation/`
- [ ] Run `validate:strict` to confirm all existing guides still pass
- [ ] Update schema-coupling documentation

**Why first:** Everything downstream depends on the schema accepting these fields, the two-file model being defined, and the identity model being established. Without `repository.json`, package IDs cannot be resolved to filesystem paths — especially for nested journey step packages.

### Phase 1: CLI package validation (Layer 1 completion)

**Goal:** The CLI can validate a directory as a package (both `content.json` and `manifest.json`) and validate cross-package dependencies. Completes Layer 1 coverage for the package model.

**Testing layers:** Layer 1

**Deliverables:**

- [ ] `--package` flag: validate a directory (expects `content.json`, optionally `manifest.json`)
- [ ] Cross-file consistency: `id` match between `content.json` and `manifest.json`
- [ ] `--packages` flag: validate a tree of package directories
- [ ] Asset reference validation: warn if `content.json` references assets not in `assets/`
- [ ] **Dependency graph builder:**
  - [ ] `build-graph` command: iterate over a repository list (e.g., `["bundled-interactives", "interactive-tutorials"]`), read each `repository.json` denormalized index, construct in-memory graph from metadata
  - [ ] Graph representation: nodes (full manifest metadata from denormalized `repository.json`) + edges (typed relationships)
  - [ ] Edge types: `depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`
  - [ ] Output format: D3 JSON with structure `{ nodes: GraphNode[], edges: GraphEdge[], metadata: {...} }`
  - [ ] `GraphNode` schema: `{ id, repository, title?, description?, category?, type, startingLocation, ...fullManifest }` (includes all manifest fields with defaults applied)
    - `id`: bare package ID (globally unique, e.g., `"welcome-to-grafana"`)
    - `repository`: provenance metadata (where package originated, e.g., `"interactive-tutorials"`)
  - [ ] `GraphEdge` schema: `{ source, target, type }` where `source` and `target` are bare package IDs
  - [ ] Handles packages with defaulted fields: missing dependency arrays treated as empty (no edges created), undefined metadata fields included in node as `undefined`
  - [ ] CNF dependency clauses: simplified implementation creates edges to all mentioned packages regardless of AND/OR semantics (note as limitation for future work — OR clauses are imprecise in this representation)
  - [ ] Virtual capability handling in graph output:
    - Graph command output (D3 JSON): virtual capabilities appear as virtual nodes (distinguished by a `virtual: true` flag on the node) with `provides` edges from real packages. This preserves the abstraction in visualization.
    - Runtime dependency resolution: virtual nodes are resolved to their providing packages directly (no virtual node in the resolution path — just "is any provider completed?")
  - [ ] **Virtual capability resolution:**
    - [ ] Build a provides map: scan all packages' `provides` arrays to create a mapping from virtual capability name → set of providing package IDs
    - [ ] Dependency targets are satisfied if they match a real package ID **or** if any package in the catalog declares `provides: ["that-target"]`
    - [ ] Virtual capability names declared in `provides` do NOT need to exist as real packages — this follows the Debian virtual package model (e.g., `"datasource-configured"` is a virtual capability provided by multiple real packages)
  - [ ] Graph lint checks against global catalog (all WARN severity during migration phase, no ERROR):
    - Dependency target doesn't exist as a real package ID AND is not provided by any package in the catalog (broken reference)
    - Cycle detection in `depends` chains (error-level semantic issue)
    - Cycle detection in `recommends` chains (warning-level semantic issue)
    - Orphaned packages (no incoming or outgoing edges)
    - Packages with undefined `description` or `category` (quality issue)
  - [ ] `graph` command: wrapper that invokes `build-graph` and outputs D3 JSON to stdout or file
- [ ] `testEnvironment` field validation (present in schema since Phase 0)
- [ ] Integration tests with sample package trees (valid and invalid, with and without `manifest.json`)

**Why second:** Enables CI validation of packages in `interactive-tutorials` before guides are converted. Tooling is ready before content migrates.

### Phase 2: Bundled repository migration

**Goal:** Migrate bundled content (`src/bundled-interactives/`) into the package directory structure, write manifests for each guide, and generate `repository.json` and dependency graph via CLI. Prove the end-to-end pipeline on a small, controlled corpus before migrating external content.

**Testing layers:** Layer 1 + Layer 2

**Deliverables:**

- [ ] Restructure `src/bundled-interactives/` into package directories:
  - [ ] Each guide becomes a directory (e.g., `welcome-to-grafana/content.json` instead of `welcome-to-grafana.json`)
  - [ ] Static link files in `static-links/` migrated to package directories
  - [ ] Existing `index.json` retained during transition for backwards compatibility
- [ ] Write `manifest.json` for each bundled guide:
  - [ ] Seed metadata from current `index.json` entries (`summary` → `description`, `url` → `startingLocation`, `targetPlatform` → `targeting.match`)
  - [ ] Add dependency fields to express relationships between bundled guides
  - [ ] Add `targeting` with recommender match expressions
  - [ ] Set `repository` provenance metadata for the bundled repository
- [ ] Generate `repository.json` for the bundled repository using `pathfinder-cli build-repository` from Phase 1
- [ ] Generate dependency graph using `pathfinder-cli build-graph` from Phase 1 (for lint validation — not for plugin runtime consumption)
- [ ] Validate all bundled packages pass `validate --packages` in CI
- [ ] Add pre-commit hook for bundled repository that regenerates `repository.json` on commit
- [ ] CI verification: rebuild `repository.json`, diff against committed version, fail on divergence

**Why third:** Proves the full end-to-end pipeline (schema → CLI → repository index → graph) on a small, controlled corpus that lives inside the plugin repository. By the time external content migrates (Phase 4), the migration pattern is already validated and the tooling is battle-tested.

### Phase 3: Plugin runtime resolution

**Goal:** The plugin can consume packages at runtime using the bundled `repository.json`. Single local resolution tier — no remote content, no static catalog. Architecture designed for forward compatibility with additional resolution tiers in later phases.

**Testing layers:** Layer 2

**Deliverables:**

- [ ] **PackageResolver implementation:**
  - [ ] Reads bundled `repository.json` to build in-memory package lookup
  - [ ] Resolves bare ID → content URL + manifest URL from bundled repository paths
  - [ ] `resolve()` always returns ID and URLs; `loadContent` option fetches and populates manifest and content objects
  - [ ] Resolution interface:
    ```typescript
    interface PackageResolution {
      id: string;
      contentUrl: string;
      manifestUrl: string;
      repository: string;
      /** Populated when resolve options request content loading */
      manifest?: ManifestJson;
      /** Populated when resolve options request content loading */
      content?: ContentJson;
    }
    interface ResolveOptions {
      /** When true, fetch and populate manifest and content on the resolution result */
      loadContent?: boolean;
    }
    interface PackageResolver {
      resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution>;
    }
    ```
  - [ ] Repositories are internal to the resolver — URLs pointing to indexes, not first-class objects
- [ ] **Package loader:**
  - [ ] Load directory packages (`content.json` + `manifest.json`) from resolved locations
  - [ ] Fallback to single-file guides for backwards compatibility
  - [ ] Handle local (bundled) content sources
- [ ] **Dependency resolution from repository.json:**
  - [ ] Resolve `depends`, `suggests`, and `provides` relationships using metadata from `repository.json` directly (not from CLI-generated graph)
  - [ ] **Provides-aware resolution:** when checking whether a `depends` target is satisfied, check both real package completion and virtual capability satisfaction (i.e., has the user completed any package that `provides` the target capability?)
  - [ ] Support navigation and recommendations based on dependency metadata
  - [ ] Handle circular dependencies gracefully
- [ ] Plugin runtime does **not** consume the CLI-generated dependency graph — that artifact is for the recommender service, visualization, and lint tooling. This keeps client memory bounded as the content corpus grows.
- [ ] Layer 2 unit tests for bundled resolution, package loader, and dependency resolver

**Why fourth:** Completes the local end-to-end cycle: bundled content is migrated (Phase 2), and the plugin can now load and resolve it at runtime. Establishes the `PackageResolver` interface that later tiers (static catalog in Phase 4, registry service in Phase 7) will implement.

### Phase 4: Pilot migration of interactive-tutorials

**Goal:** Migrate 3-5 guides from `interactive-tutorials` to the package format, add static catalog resolution for remote content, and validate the full authoring-to-testing pipeline across both bundled and external repositories.

**Testing layers:** Layer 2 + Layer 3

**Deliverables:**

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` to directory packages in `interactive-tutorials`
- [ ] For each, create `manifest.json` with flat metadata (description, language, category, author, startingLocation)
- [ ] Add dependency fields (depends, provides, suggests) to `manifest.json` to express the "Getting started" learning path
- [ ] Add `targeting` with recommender match expressions to `manifest.json`
- [ ] Pilot guides include `testEnvironment` in their manifests
- [ ] **Static catalog resolution:**
  - [ ] Build process: CLI aggregates all `repository.json` files into single `packages-catalog.json`, published to CDN
  - [ ] Catalog format: `{ version: "1.0.0", packages: { [id]: { contentUrl, manifestUrl, repository } } }`
  - [ ] Plugin fetch strategy: on startup, fetch catalog from CDN; cache in memory for session; fall back to bundled repository if fetch fails (offline/OSS support)
  - [ ] Plugin resolution flow: check bundled repository first (baseline content), then static catalog (extended content)
  - [ ] Same `PackageResolver` interface — adds a second resolution tier
- [ ] Verify plugin loads and renders `content.json` correctly from both bundled and remote sources
- [ ] Verify `validate --packages` passes in CI (validates both files)
- [ ] Extend e2e CLI to read `manifest.json` for pre-flight environment checks (Layer 3 enhancement)
- [ ] Document the two-file package authoring workflow for content authors and metadata managers
- [ ] **Journey migration tooling:**
  - [ ] `migrate-journeys` command: tool-assisted migration of existing journey metadata
  - [ ] Reads `website/content/docs/learning-journeys/journeys.yaml` (external repo) for dependency graph data
  - [ ] Reads markdown front-matter from `website/content/docs/learning-journeys/*.md` for title, description, and metadata
  - [ ] Generates draft `manifest.json` files for all `*-lj` directories in `interactive-tutorials`
  - [ ] Uses bare package IDs throughout (no repository prefix in `id` field or dependency references)
  - [ ] Sets `repository: "interactive-tutorials"` as provenance metadata (not used for resolution)
  - [ ] Maps `journeys.yaml` `links.to` relationships → `recommends` field in `manifest.json` using bare IDs (soft dependencies, not hard `depends`)
  - [ ] Extracts `startingLocation` from existing `index.json` `url` field or `targeting.match` URL rules during migration (first URL from targeting becomes `startingLocation`, falls back to `"/"` if no URL rules present)
  - [ ] Outputs draft manifests for human review and refinement before committing

**Why fifth:** By this point, the end-to-end pipeline is already proven on bundled content (Phases 2-3). This phase extends to external content with confidence, adds the remote resolution tier, and validates the full authoring-to-testing pipeline across repositories. Layer 3 e2e integration validates the complete workflow.

### Phase 5: Learning journey integration

**Goal:** Journey metapackages are a working package type. The CLI validates journeys, the dependency graph treats them as first-class nodes, and learning paths can use package dependencies alongside curated `paths.json`. See [learning journeys](./PATHFINDER-PACKAGE-DESIGN.md#learning-journeys) for the full design.

**Testing layers:** Layer 1 + Layer 2

**Deliverables:**

- [ ] Add `type` field to `ManifestJsonSchema` (`"guide"` default, `"journey"`)
- [ ] Add `steps` field to `ManifestJsonSchema` (ordered `string[]` of bare package IDs, valid when `type: "journey"`)
- [ ] CLI: validate journey packages — `steps` array entries resolve to existing packages in the repository index (by bare ID), cover page `content.json`. Steps may be nested child directories (organizational convenience for journey-specific steps) or independent top-level packages (for shared/reused steps). The CLI validates via repository index resolution, not filesystem child-directory checks.
- [ ] **Dependency graph representation for journeys:**
  - [ ] Journey metapackages appear as regular nodes with `type: "journey"` (everything is a package)
  - [ ] Journey steps appear as independent package nodes in the graph (they are packages, can be reused across multiple journeys)
  - [ ] Journey metapackage has edges to its steps: linear `recommends` chain from journey node to each step in `steps` array order
  - [ ] `steps` array contains bare package IDs (e.g., `["step-1", "step-2"]`), no repository prefix
  - [ ] Graph lint: journey `steps` references must resolve to existing packages in global catalog
- [ ] Pilot: convert 1-2 existing `*-lj` directories to journey metapackages with `manifest.json`
- [ ] Validate step reuse: confirm that a step package can appear in multiple journey `steps` arrays
- [ ] Utility to compute learning paths from dependency DAG
- [ ] Reconciliation: curated `paths.json` takes priority; dependency-derived paths fill gaps
- [ ] UI: learning path cards use package metadata (description, category) when available
- [ ] Align with docs partners' YAML format for learning journey relationships
- [ ] Layer 1 unit tests for journey schema validation (`type`, `steps`, nested structure)
- [ ] Layer 2 unit tests for journey-specific logic (step resolution, completion tracking, metapackage navigation)

**Why sixth:** First user-visible payoff of the package model. Introduces the metapackage composition pattern that SCORM `"course"` and `"module"` types will later build on. Content authors and docs partners see dependency declarations reflected in the learning experience.

### Phase 6: Layer 4 test environment routing

**Goal:** Route guides to managed test environments using `testEnvironment` metadata. The schema field is already in place from Phase 0, and the e2e CLI already reads it from Phase 4 — this phase focuses on Layer 4 infrastructure.

**Testing layers:** Layer 4

**Deliverables:**

- [ ] Environment routing: match `testEnvironment.tier` to available managed environments
- [ ] Version matrix testing: run guides against multiple Grafana versions per `testEnvironment.minVersion`
- [ ] Dataset and plugin provisioning: provision `testEnvironment.datasets` and `testEnvironment.plugins` in managed environments
- [ ] Document testEnvironment authoring guidelines (authored in `manifest.json`)

**Why seventh:** Layer 4 foundation from the testing strategy. Depends on the package format being stable and adopted. Narrower than originally scoped because `testEnvironment` schema (Phase 0) and e2e CLI reading (Phase 4) are already complete.

### Phase 7: Repository registry service

**Goal:** Replace static catalog (Phase 4) with dynamic repository registry service that supports multiple repositories, rapid content updates without plugin releases, and scalable multi-repo ecosystem.

**Deliverables:**

- [ ] **Registry service architecture:**
  - [ ] Service endpoint: `GET /registry` returns list of known repositories with their locations
  - [ ] Service endpoint: `GET /resolve/{packageId}` returns package resolution (same `PackageResolution` format)
  - [ ] Example registry response:
    ```json
    {
      "repositories": {
        "interactive-tutorials": "https://cdn.grafana.com/repos/interactive-tutorials/",
        "partner-integrations": "https://partners.grafana.com/packages/"
      }
    }
    ```
  - [ ] Example resolution response:
    ```json
    {
      "id": "welcome-to-grafana",
      "contentUrl": "https://cdn.grafana.com/packages/v1/welcome-to-grafana/content.json",
      "manifestUrl": "https://cdn.grafana.com/packages/v1/welcome-to-grafana/manifest.json",
      "repository": "interactive-tutorials"
    }
    ```
- [ ] **Catalog aggregation:**
  - [ ] Service dynamically aggregates all `repository.json` files from known repositories
  - [ ] Maintains global catalog in memory/cache (refresh on interval or webhook trigger)
  - [ ] Detects and reports package ID collisions across repositories (ERROR on duplicate IDs)
- [ ] **Repository discovery:**
  - [ ] Config-driven registry: service reads repository list from configuration file
  - [ ] Repositories can be added/removed without service code changes
  - [ ] Each repository publishes `repository.json` at known location
- [ ] **Plugin integration:**
  - [ ] Plugin detects registry availability (feature flag or endpoint probe)
  - [ ] If registry available, use dynamic resolution; otherwise fall back to static catalog (Phase 4)
  - [ ] Same `PackageResolver` interface — only implementation changes
  - [ ] Gradual cutover: can run both approaches simultaneously during transition
- [ ] **Performance and reliability:**
  - [ ] Resolution result caching (per-session in plugin, TTL-based in service)
  - [ ] Service monitoring: track resolution failures, catalog staleness, repository availability
  - [ ] Graceful degradation: if specific repository unavailable, serve from cached catalog
- [ ] **Use cases that justify registry over static catalog:**
  - [ ] Rapid content updates: new packages available immediately without plugin release
  - [ ] Partner/team repositories: independent content publishing without central coordination
  - [ ] Multi-tenancy: different users/orgs see different package catalogs (future extension)
  - [ ] Scale: 1000+ packages across many repositories

**Why eighth:** Addresses scalability limitations of static catalog (Phase 4). Enables rapid content updates, independent repository management, and ecosystem growth. Static catalog remains as fallback for offline/OSS support.

### Phase 8: SCORM foundation

**Goal:** Extend the package format for SCORM import needs. Schema extensions only — not the importer itself. Builds on the `type` discriminator and metapackage composition model established by journeys in Phase 5.

**Deliverables:**

- [ ] Extend `type` field with `"course"` and `"module"` values (journey's `"guide"` and `"journey"` already in place from Phase 5)
- [ ] Add flat `source` field to `manifest.json` for provenance tracking
- [ ] Add flat `keywords`, `rights`, `educationalContext`, `difficulty`, `estimatedDuration` fields to `manifest.json`
- [ ] Course/module rendering in web display mode (table-of-contents page)
- [ ] Design SCORM import pipeline CLI interface

**Why ninth:** Extends the package format so it can receive SCORM-imported content. The journey metapackage model from Phase 5 provides the composition infrastructure; SCORM types refine it with import-specific semantics. The actual importer follows the phased plan in [SCORM.md](./SCORM.md).

### Phase 9+: SCORM import pipeline

Follows the 5-phase plan in the [SCORM analysis](./SCORM.md): parser, extractor, transformer, assembler, enhanced assessment types, scoring. The package format from Phases 0-8 is the foundation it writes to.

---

## Summary

| Phase                                       | Unlocks                                                                       | Testing layers    |
| ------------------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| 0: Schema foundation                        | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema | Layer 1           |
| 1: CLI package validation                   | CI validation, cross-file checks, dependency graph                            | Layer 1           |
| 2: Bundled repository migration             | End-to-end proof on local corpus, bundled `repository.json`                   | Layer 1 + Layer 2 |
| 3: Plugin runtime resolution                | PackageResolver consuming bundled repo, local resolution tier                 | Layer 2           |
| 4: Pilot migration of interactive-tutorials | Remote content, static catalog, full authoring-to-testing pipeline            | Layer 2 + Layer 3 |
| 5: Learning journey integration             | Metapackage model, `type`/`steps`, docs partner alignment                     | Layer 1 + Layer 2 |
| 6: Layer 4 test environment routing         | Managed environment routing, version matrix, dataset provisioning             | Layer 4           |
| 7: Repository registry service              | Dynamic multi-repo resolution, rapid content updates, ecosystem scale         | —                 |
| 8: SCORM foundation                         | SCORM import readiness, extends `type` with course/module                     | —                 |
| 9+: SCORM import pipeline                   | Full SCORM conversion pipeline                                                | —                 |
