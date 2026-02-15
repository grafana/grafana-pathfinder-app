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

| Phase                               | Testing layers    |
| ----------------------------------- | ----------------- |
| 0: Schema foundation                | Layer 1           |
| 1: CLI package validation           | Layer 1           |
| 2: Plugin runtime resolution        | Layer 2           |
| 3: Pilot package migration          | Layer 2 + Layer 3 |
| 4: Learning journey integration     | Layer 1 + Layer 2 |
| 5: Layer 4 test environment routing | Layer 4           |
| 6: SCORM foundation                 | —                 |
| 7+: SCORM import pipeline           | —                 |

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
  - [ ] Resolution handled by service (Phase 2), not by parsing ID syntax
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
  - [ ] `build-graph` command: iterate over hardcoded repository list `["interactive-tutorials"]`, read each `repository.json` denormalized index, construct in-memory graph from metadata
  - [ ] Graph representation: nodes (full manifest metadata from denormalized `repository.json`) + edges (typed relationships)
  - [ ] Edge types: `depends`, `recommends`, `suggests`, `provides`, `conflicts`, `replaces`
  - [ ] Output format: D3 JSON with structure `{ nodes: GraphNode[], edges: GraphEdge[], metadata: {...} }`
  - [ ] `GraphNode` schema: `{ id, repository, title?, description?, category?, type, startingLocation, ...fullManifest }` (includes all manifest fields with defaults applied)
    - `id`: bare package ID (globally unique, e.g., `"welcome-to-grafana"`)
    - `repository`: provenance metadata (where package originated, e.g., `"interactive-tutorials"`)
  - [ ] `GraphEdge` schema: `{ source, target, type }` where `source` and `target` are bare package IDs
  - [ ] Handles packages with defaulted fields: missing dependency arrays treated as empty (no edges created), undefined metadata fields included in node as `undefined`
  - [ ] CNF dependency clauses: simplified implementation creates edges to all mentioned packages regardless of AND/OR semantics (note as limitation for future work — OR clauses are imprecise in this representation)
  - [ ] Graph lint checks against global catalog (all WARN severity during migration phase, no ERROR):
    - Dependency target doesn't exist in global catalog (broken reference)
    - `provides: ["foo"]` implies package `foo` must exist in global catalog (everything is a package, not a virtual capability)
    - Cycle detection in `depends` chains (error-level semantic issue)
    - Cycle detection in `recommends` chains (warning-level semantic issue)
    - Orphaned packages (no incoming or outgoing edges)
    - Packages with undefined `description` or `category` (quality issue)
  - [ ] `graph` command: wrapper that invokes `build-graph` and outputs D3 JSON to stdout or file
- [ ] `testEnvironment` field validation (present in schema since Phase 0)
- [ ] Integration tests with sample package trees (valid and invalid, with and without `manifest.json`)

**Why second:** Enables CI validation of packages in `interactive-tutorials` before guides are converted. Tooling is ready before content migrates.

### Phase 2: Plugin runtime resolution

**Goal:** The plugin can consume packages at runtime — loading bundled content locally and resolving non-bundled packages via resolution service.

**Testing layers:** Layer 2

**Architecture:**

The plugin uses a two-tier resolution strategy:

1. **Bundled content** (shipped with plugin): Local resolution via bundled dependency graph
2. **Non-bundled content** (external packages): Service-based resolution via HTTP endpoint

**Deliverables:**

- [ ] **Bundled content resolution:**
  - [ ] Plugin ships with bundled dependency graph JSON (generated from `build-graph` in Phase 1)
  - [ ] Graph includes only packages bundled with plugin (not `interactive-tutorials` packages)
  - [ ] Graph structure: `{ packages: { [id]: { manifest, contentUrl, repository } }, edges: [...] }`
  - [ ] Local package loader: resolve bare ID → lookup in bundled graph → load content from bundled location
  - [ ] Example bundled graph entry:
    ```json
    {
      "packages": {
        "welcome-to-grafana": {
          "manifest": {
            /* full manifest with defaults applied */
          },
          "contentUrl": "/bundled/welcome-to-grafana/content.json",
          "repository": "grafana-core-tutorials"
        }
      },
      "edges": [{ "source": "welcome-to-grafana", "target": "first-dashboard", "type": "recommends" }]
    }
    ```
- [ ] **Service-based resolution:**
  - [ ] Resolution service endpoint: `GET https://repo.service/resolve/{packageId}`
  - [ ] Service maintains global catalog (aggregates all `repository.json` files)
  - [ ] Service response: `{ contentUrl: "...", manifestUrl: "...", repository: "..." }` OR HTTP redirect to package location
  - [ ] Plugin resolution flow:
    1. Check bundled graph for package ID
    2. If not bundled, call resolution service endpoint
    3. Cache resolution results per session
    4. Fetch content from resolved URLs
  - [ ] Fallback: if service unavailable, bundled content still works (offline/OSS support)
- [ ] **Package loader:**
  - [ ] Load directory packages (`content.json` + `manifest.json`) from resolved locations
  - [ ] Fallback to single-file guides for backwards compatibility
  - [ ] Handle both local (bundled) and remote (HTTP) content sources
- [ ] **Dependency resolver:**
  - [ ] Resolve `depends`, `suggests`, and `provides` relationships using bundled graph or service
  - [ ] Support navigation and recommendations based on dependency edges
  - [ ] Handle circular dependencies gracefully
- [ ] Layer 2 unit tests for bundled resolution, service resolution (mocked endpoint), package loader, and dependency resolver

**Why third:** Bridges the gap between static validation (Phases 0-1) and real content migration (Phase 3). Establishes the runtime architecture for both bundled and distributed packages. Without runtime resolution, the plugin cannot load packages even if they pass validation.

### Phase 3: Pilot package migration

**Goal:** Convert 3-5 existing guides to the two-file package format and validate end-to-end.

**Testing layers:** Layer 2 + Layer 3

**Deliverables:**

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` to directory packages
- [ ] For each, create `manifest.json` with flat metadata (description, language, category, author)
- [ ] Add dependency fields (depends, provides, suggests) to `manifest.json` to express the "Getting started" learning path
- [ ] Add `targeting` with recommender match expressions to `manifest.json`
- [ ] Pilot guides include `testEnvironment` in their manifests
- [ ] Verify plugin loads and renders `content.json` correctly (ignoring `manifest.json` at runtime)
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

**Why fourth:** Proof-of-concept that validates schema, CLI, and runtime work together. Small scope (3-5 guides) catches issues early. Layer 3 e2e integration validates the full authoring-to-testing pipeline.

### Phase 4: Learning journey integration

**Goal:** Journey metapackages are a working package type. The CLI validates journeys, the dependency graph treats them as first-class nodes, and learning paths can use package dependencies alongside curated `paths.json`. See [learning journeys](./PATHFINDER-PACKAGE-DESIGN.md#learning-journeys) for the full design.

**Testing layers:** Layer 1 + Layer 2

**Deliverables:**

- [ ] Add `type` field to `ManifestJsonSchema` (`"guide"` default, `"journey"`)
- [ ] Add `steps` field to `ManifestJsonSchema` (ordered `string[]` of bare package IDs, valid when `type: "journey"`)
- [ ] CLI: validate journey directories — nested step packages, `steps` array referencing child packages by bare ID, cover page `content.json`
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

**Why fifth:** First user-visible payoff of the package model. Introduces the metapackage composition pattern that SCORM `"course"` and `"module"` types will later build on. Content authors and docs partners see dependency declarations reflected in the learning experience.

### Phase 5: Layer 4 test environment routing

**Goal:** Route guides to managed test environments using `testEnvironment` metadata. The schema field is already in place from Phase 0, and the e2e CLI already reads it from Phase 3 — this phase focuses on Layer 4 infrastructure.

**Testing layers:** Layer 4

**Deliverables:**

- [ ] Environment routing: match `testEnvironment.tier` to available managed environments
- [ ] Version matrix testing: run guides against multiple Grafana versions per `testEnvironment.minVersion`
- [ ] Dataset and plugin provisioning: provision `testEnvironment.datasets` and `testEnvironment.plugins` in managed environments
- [ ] Document testEnvironment authoring guidelines (authored in `manifest.json`)

**Why sixth:** Layer 4 foundation from the testing strategy. Depends on the package format being stable and adopted. Narrower than originally scoped because `testEnvironment` schema (Phase 0) and e2e CLI reading (Phase 3) are already complete.

### Phase 6: SCORM foundation

**Goal:** Extend the package format for SCORM import needs. Schema extensions only — not the importer itself. Builds on the `type` discriminator and metapackage composition model established by journeys in Phase 4.

**Deliverables:**

- [ ] Extend `type` field with `"course"` and `"module"` values (journey's `"guide"` and `"journey"` already in place from Phase 4)
- [ ] Add flat `source` field to `manifest.json` for provenance tracking
- [ ] Add flat `keywords`, `rights`, `educationalContext`, `difficulty`, `estimatedDuration` fields to `manifest.json`
- [ ] Course/module rendering in web display mode (table-of-contents page)
- [ ] Design SCORM import pipeline CLI interface

**Why seventh:** Extends the package format so it can receive SCORM-imported content. The journey metapackage model from Phase 4 provides the composition infrastructure; SCORM types refine it with import-specific semantics. The actual importer follows the phased plan in [SCORM.md](./SCORM.md).

### Phase 7+: SCORM import pipeline

Follows the 5-phase plan in the [SCORM analysis](./SCORM.md): parser, extractor, transformer, assembler, enhanced assessment types, scoring. The package format from Phases 0-6 is the foundation it writes to.

---

## Summary

| Phase                               | Unlocks                                                                       | Testing layers    |
| ----------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| 0: Schema foundation                | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema | Layer 1           |
| 1: CLI package validation           | CI validation, cross-file checks, dependency graph                            | Layer 1           |
| 2: Plugin runtime resolution        | Package loading, FQI resolution, runtime dependency graph                     | Layer 2           |
| 3: Pilot package migration          | Proof-of-concept, runtime validation, e2e pre-flight checks                   | Layer 2 + Layer 3 |
| 4: Learning journey integration     | Metapackage model, `type`/`steps`, docs partner alignment                     | Layer 1 + Layer 2 |
| 5: Layer 4 test environment routing | Managed environment routing, version matrix, dataset provisioning             | Layer 4           |
| 6: SCORM foundation                 | SCORM import readiness, extends `type` with course/module                     | —                 |
| 7+: SCORM import pipeline           | Full SCORM conversion pipeline                                                | —                 |
