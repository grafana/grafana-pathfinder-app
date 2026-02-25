# Package implementation plan

This is the phased implementation plan for the [Pathfinder package design](./PATHFINDER-PACKAGE-DESIGN.md). It can be changed, elaborated, or removed as implementation proceeds — the design spec is the source of truth for the package format and will remain.

---

## Progressive refinement

This plan is executed phase-by-phase. Each phase is assigned to an agent, and early-phase execution will tend to surface decisions that affect later phases. The plan is a living document: agents completing a phase should update it with findings, key decisions made, and any refinements to later phases that follow from those decisions.

**Agent execution protocol:** Before implementing an assigned phase:

1. stop and review all completed phases, including any decisions recorded in them.
2. If a prior-phase decision renders a later-phase specification ambiguous or contradictory, ask questions to drive out ambiguity before proceeding with implementation.
3. Do not assume that the original specification for your phase is still correct — validate it against the current state of the codebase and all decisions made in prior phases.
4. All phases are executed on isolated branches; and a phase cannot be complete until you've
   run the tidyup skill, committed, pushed branch to remote, and opened a PR with that PR linked back to this epic: https://github.com/grafana/grafana-pathfinder-app/issues/622
5. When you are finished executing a phase **update this document** with your key decisions, and remove implementation detail, to leave behind a document maximally useful to the next agent.

---

### Tier model

The codebase enforces a layered tier model via ratchet tests (`src/validation/architecture.test.ts`) and ESLint `no-restricted-imports` rules (`eslint.config.mjs`). Files in tier N may only import from tier N or lower. Tier 2 engines are laterally isolated — they cannot import from other Tier 2 engines.

| Tier | Directories                                                                                                                          | Role                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 0    | `types/`, `constants/`                                                                                                               | Foundational types and configuration |
| 1    | `lib/`, `security/`, `styles/`, `global-state/`, `utils/`, `validation/`                                                             | Shared utilities and validation      |
| 2    | `context-engine/`, `docs-retrieval/`, `interactive-engine/`, `requirements-manager/`, `learning-paths/`, **`package-engine/`** (new) | Domain engines (laterally isolated)  |
| 3    | `integrations/`                                                                                                                      | Cross-engine orchestration           |
| 4    | `components/`, `pages/`                                                                                                              | Presentation layer                   |
| —    | `cli/`, `bundled-interactives/`, `test-utils/`, `img/`, `locales/`                                                                   | Excluded from tier enforcement       |

**Key decisions for this plan:**

- **Schemas at Tier 0.** All Zod schemas (`ContentJsonSchema`, `ManifestJsonSchema`, `DependencyClauseSchema`, `RepositoryJsonSchema`, etc.) and shared type definitions (`GraphNode`, `GraphEdge`, `DependencyGraph`) live in `src/types/` so they are importable by CLI, runtime engines, validation, and UI code. Resolution types (`PackageResolution`, `PackageResolver`) are defined in the Phase 3 spec but deferred to that phase's implementation.
- **Validation at Tier 1.** Content validation functions (`validateGuide()` and future `validatePackage()`, `validateManifest()`) live in `src/validation/` at Tier 1. This eliminates the existing lateral violations from `docs-retrieval → validation` and prevents new ones from `package-engine → validation`. The `validation/` directory was moved from Tier 2 to Tier 1 because its production code depends only on Tier 0 (Zod schemas and types). Architecture ratchet tests remain in `validation/` — they are test files, excluded from tier enforcement.
- **Package engine at Tier 2.** The `PackageResolver`, package loader, dependency resolver, and static catalog fetcher live together in `src/package-engine/` as a new Tier 2 engine with its own barrel export (`index.ts`). Lateral isolation means it cannot import from `docs-retrieval`, `learning-paths`, `context-engine`, or other Tier 2 engines.
- **Graph types at Tier 0, graph builder in CLI.** `GraphNode` and `GraphEdge` type definitions live in `src/types/` for broad importability. The graph construction logic (`build-graph` command) lives in `src/cli/` (excluded from tier enforcement).
- **Completion state is a consumer concern.** The package engine provides structural dependency resolution ("which packages provide capability X?") but does not check completion state. Determining whether dependencies are satisfied requires completion data from `learning-paths` — callers at Tier 3+ combine both. This avoids a lateral coupling between `package-engine` and `learning-paths`.
- **Open-world directory semantics.** Package discovery uses the `content.json`-presence heuristic: a subdirectory is a package if and only if it contains `content.json`. Unknown files and subdirectories in or alongside package directories are silently ignored — not warned, not errored. This is the directory-level analog of `.passthrough()` in the JSON schemas. See [extension metadata](./PATHFINDER-PACKAGE-DESIGN.md#extension-metadata).

### Dual registration

Every new `src/` directory must be registered in **both** `TIER_MAP` in `src/validation/import-graph.ts` and the tier constants in `eslint.config.mjs`. The tier map completeness ratchet test will fail if a directory is missing. The ESLint config mirrors the tier map for editor-time feedback. Tier changes (e.g., moving `validation` from Tier 2 to Tier 1) require updates in both places.

### Barrel export discipline

Every Tier 2 engine must have an `index.ts` barrel. External consumers must import through the barrel — the ratchet test enforces this. When creating the package engine, design the barrel export surface (`PackageResolver`, `PackageResolution`, loader functions) up front.

### Strict indexed access

`noUncheckedIndexedAccess` is enabled. All indexed lookups (e.g., `repository.json` package lookups by ID, catalog entries, step arrays) return `T | undefined`. Code must handle the `undefined` case explicitly.

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
| 5: Path and journey integration             | Layer 1 + Layer 2 |
| 6: Layer 4 test environment routing         | Layer 4           |
| 7: Repository registry service              | —                 |
| 8: SCORM foundation                         | —                 |
| 9+: SCORM import pipeline                   | —                 |

---

## Phases

### Phase 0: Schema foundation and Layer 1 extension ✅

**Status:** Complete

**Key decisions and artifacts:**

- `validation` moved to Tier 1 in both `TIER_MAP` and `eslint.config.mjs`; lateral ratchet dropped from 11 → 9
- Types in `src/types/package.types.ts`: `ContentJson`, `ManifestJson`, `RepositoryJson`, `RepositoryEntry`, `GraphNode`, `GraphEdge`, `DependencyGraph`, and all dependency/author/targeting types. Resolution types (`PackageResolution`, `PackageResolver`) removed — deferred to Phase 3 implementation.
- Zod schemas in `src/types/package.schema.ts`: `ContentJsonSchema`, `ManifestJsonSchema`, `ManifestJsonObjectSchema`, `RepositoryJsonSchema`, `RepositoryEntrySchema`, `DependencyClauseSchema`, `DependencyListSchema`, `AuthorSchema`, `GuideTargetingSchema`, `TestEnvironmentSchema`, `PackageTypeSchema`, `GraphNodeSchema`, `GraphEdgeSchema`, `DependencyGraphSchema`
- `ManifestJsonSchema` uses `.refine()` for the conditional `steps` requirement; `ManifestJsonObjectSchema` is the base shape before refinement for composition use
- `CURRENT_SCHEMA_VERSION` bumped to `"1.1.0"`; `KNOWN_FIELDS._manifest` added with 18 field names
- `JsonGuideSchemaStrict` retained unchanged for backwards compatibility
- `build-repository` CLI command implemented in `src/cli/commands/build-repository.ts`
- 66 Layer 1 tests in `src/validation/package-schema.test.ts` and `src/validation/build-repository.test.ts`
- Schema-coupling docs updated (`.cursor/rules/schema-coupling.mdc`) with two-file model coverage
- CI verification for bundled `repository.json` deferred to Phase 2 (when bundled content is migrated to package directories)
- `testEnvironment` default is `{ tier: 'cloud' }` (indicating Grafana Cloud required)
- `GuideTargetingSchema.match` is `z.record(z.string(), z.unknown()).optional()` — loosely typed since the recommender owns match semantics

### Phase 1: CLI package validation (Layer 1 completion) ✅

**Status:** Complete

**Key decisions and artifacts:**

- `validatePackage()` and `validatePackageTree()` in `src/validation/validate-package.ts` (Tier 1, exported from barrel)
- `--package <dir>` flag on validate command: validates a single package directory
- `--packages <dir>` flag on validate command: validates a tree of package directories
- Cross-file ID consistency enforced: content.json `id` must match manifest.json `id` (error code: `id_mismatch`)
- Asset reference validation: regex scans content.json for `./assets/*` references, warns if file missing
- Severity-based validation messages: ERROR for required fields, WARN for recommended fields, INFO for defaulted fields
- `testEnvironment` validation: warns on unrecognized tier values and invalid semver in minVersion
- `build-graph` CLI command in `src/cli/commands/build-graph.ts`: reads `name:path` repository entries, outputs D3 JSON
- Graph lint checks implemented: broken refs, broken steps, cycles (DFS-based), orphans, missing description/category
- Cycle detection uses DFS with separate checks for depends (error), recommends (warn), steps (error)
- CNF dependency clauses flattened: all mentioned package IDs get edges regardless of AND/OR semantics (noted as limitation)
- Virtual capability nodes created for provides targets that don't match real packages (`virtual: true` flag)
- `ValidationWarning.type` extended with `'missing-asset'` variant
- 38 Layer 1 tests in `src/validation/validate-package.test.ts` and `src/validation/build-graph.test.ts`
- All 90 test suites pass (1872 tests, 0 failures)

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

- [ ] **Package engine setup** (`src/package-engine/`, Tier 2):
  - [ ] Create `src/package-engine/` directory with `index.ts` barrel export
  - [ ] Register in `TIER_MAP` (`src/validation/import-graph.ts`) as tier 2 and in `TIER_2_ENGINES` / tier constants (`eslint.config.mjs`)
  - [ ] Verify `npm run test:ci` passes with new engine registered (tier map completeness test)
- [ ] **PackageResolver implementation** (in `src/package-engine/`):
  - [ ] Reads bundled `repository.json` to build in-memory package lookup
  - [ ] Resolves bare ID → content URL + manifest URL from bundled repository paths
  - [ ] `resolve()` returns a discriminated union — either package information or a rich error. Resolution can fail due to nonexistent ID, network failure, or other errors. Callers must discriminate before accessing data (works with `noUncheckedIndexedAccess`).
  - [ ] Resolution interface (type definitions in `src/types/`, Tier 0):
    ```typescript
    interface PackageResolutionSuccess {
      ok: true;
      id: string;
      contentUrl: string;
      manifestUrl: string;
      repository: string;
      /** Populated when resolve options request content loading */
      manifest?: ManifestJson;
      /** Populated when resolve options request content loading */
      content?: ContentJson;
    }
    interface ResolutionError {
      code: 'not-found' | 'network-error' | 'parse-error' | 'validation-error';
      message: string;
    }
    interface PackageResolutionFailure {
      ok: false;
      id: string;
      error: ResolutionError;
    }
    type PackageResolution = PackageResolutionSuccess | PackageResolutionFailure;
    interface ResolveOptions {
      /** When true, fetch and populate manifest and content on the resolution result */
      loadContent?: boolean;
    }
    interface PackageResolver {
      resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution>;
    }
    ```
  - [ ] Repositories are internal to the resolver — URLs pointing to indexes, not first-class objects
- [ ] **Package loader** (in `src/package-engine/`):
  - [ ] Load directory packages (`content.json` + `manifest.json`) from resolved locations. Package directories may contain additional files and subdirectories placed by extension tools (see [extension metadata](./PATHFINDER-PACKAGE-DESIGN.md#extension-metadata)); the loader reads only the known core files and does not warn about unknown directory contents.
  - [ ] Fallback to single-file guides for backwards compatibility — the loader recognizes old-format single-file JSON and parses it using schemas from `src/types/` (Tier 0) and validation from `src/validation/` (Tier 1). This is self-contained within the package engine; no import from `docs-retrieval` is needed.
  - [ ] Handle local (bundled) content sources
  - [ ] **Transitional duplication note:** During the migration period, content loading logic will exist in both `docs-retrieval` (existing paths) and `package-engine` (new package loading + legacy fallback). The duplication is intentional — it avoids a lateral coupling between the two Tier 2 engines. Full resolution depends on work in the external `grafana-recommender` microservice (outside this plan's scope) to adopt package resolution; until then, both code paths must remain.
- [ ] **Structural dependency resolution** (in `src/package-engine/`):
  - [ ] Resolve structural `depends`, `suggests`, and `provides` relationships using metadata from `repository.json` directly (not from CLI-generated graph)
  - [ ] **Provides-aware resolution (structural only):** given a dependency target, determine which packages provide that capability. Example: `getProviders("datasource-configured")` returns `["configure-prometheus", "configure-loki"]`. The package engine answers "which packages satisfy this?" — not "is it satisfied?"
  - [ ] **Satisfaction checking is a consumer concern.** Determining whether a dependency is actually satisfied requires completion state from `learning-paths` (Tier 2). The package engine cannot import from `learning-paths` (lateral isolation). Consumers at Tier 3+ (integrations) or Tier 4 (components) combine structural resolution from the package engine with completion data from `learning-paths` to determine satisfaction.
  - [ ] Support navigation and recommendations based on dependency metadata
  - [ ] Handle circular dependencies gracefully
- [ ] Plugin runtime does **not** consume the CLI-generated dependency graph — that artifact is for the recommender service, visualization, and lint tooling. This keeps client memory bounded as the content corpus grows.
- [ ] **Barrel export surface** (`src/package-engine/index.ts`): export `PackageResolver`, the resolution type union, loader functions, and structural dependency query functions. Design for stability — consumers should not need internal imports.
- [ ] Layer 2 unit tests for bundled resolution, package loader, and structural dependency resolver

**Why fourth:** Completes the local end-to-end cycle: bundled content is migrated (Phase 2), and the plugin can now load and resolve it at runtime. Establishes the `PackageResolver` interface that later tiers (static catalog in Phase 4, registry service in Phase 7) will implement.

### Phase 4: Pilot migration of interactive-tutorials

**Goal:** Migrate 3-5 guides from `interactive-tutorials` to the package format, add static catalog resolution for remote content, and validate the full authoring-to-testing pipeline across both bundled and external repositories.

**Testing layers:** Layer 2 + Layer 3

> **Re-planning note:** Phase 4 combines multiple distinct work streams (pilot migration, static catalog resolution, CDN publication, path migration tooling, e2e extension, documentation). When Phases 0-3 are complete, decompose Phase 4 into sub-phases based on decisions made during earlier phases. The right decomposition depends on context that does not yet exist.

**Deliverables:**

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` to directory packages in `interactive-tutorials`
- [ ] For each, create `manifest.json` with flat metadata (description, language, category, author, startingLocation)
- [ ] Add dependency fields (depends, provides, suggests) to `manifest.json` to express the "Getting started" learning path
- [ ] Add `targeting` with recommender match expressions to `manifest.json`
- [ ] Pilot guides include `testEnvironment` in their manifests
- [ ] **`interactive-tutorials` repository index publication:**
  - [ ] `repository.json` generated as a CI build artifact during the `interactive-tutorials` CI pipeline, not committed to git
  - [ ] Published to CDN alongside guide content — always available to the plugin runtime without being a tracked file in the repository
  - [ ] Same `pathfinder-cli build-repository` command as Phase 0/2, different publication strategy: CI-generated + CDN-published rather than committed lockfile (appropriate for high-velocity content repository where guides change frequently)
  - [ ] Dependency graph JSON follows the same CI-generated + CDN-published pattern
- [ ] **Static catalog resolution** (in `src/package-engine/` — extends the PackageResolver from Phase 3):
  - [ ] Build process: CLI aggregates all `repository.json` files (bundled committed lockfile + CDN-published remote indexes) into single `packages-catalog.json`, published to CDN
  - [ ] Catalog format includes denormalized metadata: `{ version: "1.0.0", packages: { [id]: { contentUrl, manifestUrl, repository, title, type, description, category, startingLocation, depends, recommends, suggests, provides, conflicts, replaces } } }` — structurally equivalent to `repository.json` but with URLs instead of paths, enabling dependency resolution from the catalog alone without additional per-package manifest fetches
  - [ ] Plugin fetch strategy: on startup, fetch catalog from CDN; cache in memory for session; fall back to bundled repository if fetch fails (offline/OSS support)
  - [ ] Plugin resolution flow: check bundled repository first (baseline content), then static catalog (extended content)
  - [ ] Same `PackageResolver` interface and `PackageResolution` discriminated union — adds a second resolution tier
- [ ] Verify plugin loads and renders `content.json` correctly from both bundled and remote sources
- [ ] Verify `validate --packages` passes in CI (validates both files)
- [ ] Extend e2e CLI to read `manifest.json` for pre-flight environment checks (Layer 3 enhancement)
- [ ] Document the two-file package authoring workflow for content authors and metadata managers
- [ ] **Path migration tooling:**
  - [ ] `migrate-paths` command: tool-assisted migration of existing learning path metadata
  - [ ] Reads `website/content/docs/learning-journeys/journeys.yaml` (external repo) for dependency graph data
  - [ ] Reads markdown front-matter from `website/content/docs/learning-journeys/*.md` for title, description, and metadata
  - [ ] Generates draft `manifest.json` files (with `type: "path"`) for all `*-lj` directories in `interactive-tutorials`
  - [ ] Uses bare package IDs throughout (no repository prefix in `id` field or dependency references)
  - [ ] Sets `repository: "interactive-tutorials"` as provenance metadata (not used for resolution)
  - [ ] Maps `journeys.yaml` `links.to` relationships → `recommends` field in `manifest.json` using bare IDs (soft dependencies, not hard `depends`)
  - [ ] Extracts `startingLocation` from existing `index.json` `url` field or `targeting.match` URL rules during migration (first URL from targeting becomes `startingLocation`, falls back to `"/"` if no URL rules present)
  - [ ] Outputs draft manifests for human review and refinement before committing

**Why fifth:** By this point, the end-to-end pipeline is already proven on bundled content (Phases 2-3). This phase extends to external content with confidence, adds the remote resolution tier, and validates the full authoring-to-testing pipeline across repositories. Layer 3 e2e integration validates the complete workflow.

### Phase 5: Path and journey integration

**Goal:** Paths and journeys are working metapackage types at two composition levels. A path (`type: "path"`) composes guides into an ordered sequence; a journey (`type: "journey"`) composes paths (or any packages) into a larger learning arc. The CLI validates both, the dependency graph treats them as first-class nodes, and learning paths can use package dependencies alongside curated `paths.json`. See [learning paths and journeys](./PATHFINDER-PACKAGE-DESIGN.md#learning-journeys) for the full design.

**Testing layers:** Layer 1 + Layer 2

**Deliverables:**

- [ ] **Path metapackages** (`type: "path"`):
  - [ ] CLI: validate path packages — `steps` array entries resolve to existing packages in the repository index (by bare ID), cover page `content.json` optional
  - [ ] Steps may be nested child directories (organizational convenience) or independent top-level packages (for reuse). The CLI validates via repository index resolution, not filesystem child-directory checks.
  - [ ] Pilot: convert 1-2 existing `*-lj` directories to path metapackages with `manifest.json`
  - [ ] Validate step reuse: confirm that a guide package can appear in multiple paths' `steps` arrays
- [ ] **Journey metapackages** (`type: "journey"`):
  - [ ] CLI: validate journey packages — `steps` array entries resolve to existing packages (typically paths, but any package type is valid)
  - [ ] Journey-level `content.json` serves as a cover page (optional)
  - [ ] Pilot: compose 1-2 journeys from existing paths to validate two-level composition
- [ ] **`steps` field semantics (both levels):**
  - [ ] `steps` is an ordered `string[]` of bare package IDs — the CLI validates that each entry resolves to an existing package but does NOT enforce the type of the referenced package. The type hierarchy (guides in paths, paths in journeys) is convention, not a schema constraint.
  - [ ] Completion is set-based at each level: path complete = all steps complete; journey complete = all steps complete (transitively, all constituent guides)
  - [ ] Ordering is advisory — the UI presents steps in array order but users may jump to any step
- [ ] **Dependency graph representation:**
  - [ ] Paths and journeys appear as regular nodes with their respective `type` values (everything is a package)
  - [ ] Steps appear as independent package nodes in the graph (they are packages, can be reused across multiple metapackages)
  - [ ] Metapackage has `steps` edges to each of its step packages in `steps` array order
  - [ ] `steps` array contains bare package IDs (e.g., `["step-1", "step-2"]`), no repository prefix
  - [ ] Graph lint: `steps` references must resolve to existing packages in global catalog
  - [ ] Cycle detection in `steps` chains (error-level — a step cannot transitively contain its parent)
- [ ] **Learning path reconciliation** (Tier 3+ — `integrations/` or `components/`):
  - [ ] Utility to compute learning paths from dependency DAG — this logic needs both `package-engine` (structural dependency graph) and `learning-paths` (curated `paths.json`, completion state), so it must live at Tier 3+ where it can import from multiple Tier 2 engines
  - [ ] Reconciliation: curated `paths.json` takes priority; dependency-derived paths fill gaps
- [ ] UI: learning path cards use package metadata (description, category) when available
- [ ] Align with docs partners' YAML format for learning path relationships
- [ ] Layer 1 unit tests for path and journey schema validation (`type`, `steps`, nested structure)
- [ ] Layer 2 unit tests for metapackage-specific logic (step resolution, completion tracking, navigation across both levels)

**Why sixth:** First user-visible payoff of the package model. Introduces two-level metapackage composition (paths compose guides, journeys compose paths) that SCORM `"course"` and `"module"` types will later build on. Content authors and docs partners see dependency declarations reflected in the learning experience.

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
  - [ ] Detects package ID collisions across repositories — the registry maintains a compound key (repository + package ID) internally, distinguishing the same bare ID published by different repositories. The `PackageResolver` resolves bare IDs using priority-based clobber semantics (first repository in priority order wins). This evolves the identity model: Phases 0-6 assume globally unique bare IDs; Phase 7 introduces registry-scoped uniqueness with deterministic resolution order.
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

**Goal:** Extend the package format for SCORM import needs. Schema extensions only — not the importer itself. Builds on the `type` discriminator (Phase 0) and two-level metapackage composition model established by paths and journeys in Phase 5.

**Deliverables:**

- [ ] Extend `type` field with `"course"` and `"module"` values (`"guide"`, `"path"`, and `"journey"` already in place from Phase 0)
- [ ] Add flat `source` field to `manifest.json` for provenance tracking
- [ ] Add flat `keywords`, `rights`, `educationalContext`, `difficulty`, `estimatedDuration` fields to `manifest.json`
- [ ] Course/module rendering in web display mode (table-of-contents page)
- [ ] Design SCORM import pipeline CLI interface

**Why ninth:** Extends the package format so it can receive SCORM-imported content. The path and journey metapackage model from Phase 5 provides the composition infrastructure; SCORM types refine it with import-specific semantics. The actual importer follows the phased plan in [SCORM.md](./SCORM.md).

### Phase 9+: SCORM import pipeline

Follows the 5-phase plan in the [SCORM analysis](./SCORM.md): parser, extractor, transformer, assembler, enhanced assessment types, scoring. The package format from Phases 0-8 is the foundation it writes to.

---

## Summary

| Phase                                       | Unlocks                                                                         | Testing layers    |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ----------------- |
| 0: Schema foundation                        | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema   | Layer 1           |
| 1: CLI package validation                   | CI validation, cross-file checks, dependency graph                              | Layer 1           |
| 2: Bundled repository migration             | End-to-end proof on local corpus, bundled `repository.json`                     | Layer 1 + Layer 2 |
| 3: Plugin runtime resolution                | PackageResolver consuming bundled repo, local resolution tier                   | Layer 2           |
| 4: Pilot migration of interactive-tutorials | Remote content, static catalog, full authoring-to-testing pipeline              | Layer 2 + Layer 3 |
| 5: Path and journey integration             | Two-level metapackage model (paths + journeys), `steps`, docs partner alignment | Layer 1 + Layer 2 |
| 6: Layer 4 test environment routing         | Managed environment routing, version matrix, dataset provisioning               | Layer 4           |
| 7: Repository registry service              | Dynamic multi-repo resolution, rapid content updates, ecosystem scale           | —                 |
| 8: SCORM foundation                         | SCORM import readiness, extends `type` with course/module                       | —                 |
| 9+: SCORM import pipeline                   | Full SCORM conversion pipeline                                                  | —                 |
