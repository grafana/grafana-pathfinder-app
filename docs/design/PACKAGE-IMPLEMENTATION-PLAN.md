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
- **Open-world directory semantics.** Repository package discovery uses the `manifest.json`-presence heuristic: any subdirectory at any depth is a package candidate if and only if it contains `manifest.json`. Discovery skips `assets/` subtrees and ignores unknown files/directories elsewhere — not warned, not errored. This is the directory-level analog of `.passthrough()` in the JSON schemas. See [extension metadata](./PATHFINDER-PACKAGE-DESIGN.md#extension-metadata).

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
| 3b: Package authoring documentation         | —                 |
| 4a: Static catalog types and build CLI      | Layer 1           |
| 4b: Pilot migration (interactive-tutorials) | Layer 1           |
| 4c: E2E manifest pre-flight                 | Layer 3           |
| 4d: Static catalog resolver                 | Layer 2           |
| 4e: Integration verification                | Layer 2 + Layer 3 |
| 4f: Path migration tooling                  | Layer 1           |
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

### Phase 2: Bundled repository migration ✅

**Status:** Complete

**Key decisions and artifacts:**

- 10 guides migrated to package directories (`<guide-name>/content.json` + `manifest.json`)
- `repository.json` generated with 10 packages, committed as lockfile (CI verifies freshness via rebuild + diff)
- Dependency graph validated: 0 errors, 3 warnings (orphaned test/demo/reference packages — expected)
- `static-links/` retained as-is — these are recommendation rules consumed by the context engine, not content packages. They use a different schema (`rules` array with `match` expressions) and don't conform to `content.json`/`manifest.json`. Migration deferred: when the recommender adopts package `targeting.match` metadata, static-links become redundant and can be removed.
- `index.json` retained for backwards compatibility — `filename` fields updated to point to directory paths (e.g., `welcome-to-grafana/content.json`). The content-fetcher and context engine continue to use it unchanged.
- `repository` field set to `"bundled"` to distinguish from the external `interactive-tutorials` repo (which uses the schema default `"interactive-tutorials"`)
- `testEnvironment.tier` set per guide: `"local"` for OSS guides, `"cloud"` for cloud-only guides
- Dependency relationships expressed: `loki-grafana-101` depends on `prometheus-grafana-101`; dashboard and query guides recommend their respective welcome tours; `provides` capabilities declared for downstream resolution
- `targeting.match` uses the recommender's match expression grammar (`urlPrefix`, `targetPlatform`, `and`/`or` combinators)
- Pre-commit hook **not implemented** — the project has no pre-commit infrastructure (no `.husky/`, no `.lintstagedrc`). CI freshness check (`repository:check` script) is the enforcement mechanism instead.
- CI: new `validate-packages` job in `.github/workflows/ci.yml` builds CLI, validates packages, and checks `repository.json` freshness. Added to CI gate.
- npm scripts added: `validate:packages`, `repository:build`, `repository:check`
- Layer 1 + Layer 2 tests: 43 tests in `bundled-guides.test.ts` (guide content validation) and `bundled-repository.test.ts` (repository schema, freshness, ID consistency, dependency integrity, cycle detection)
- `RepositoryEntry` extended to denormalize `author`, `targeting`, and `testEnvironment` from manifests — closes the gap between the design spec's "denormalized manifest metadata" intent and the Phase 2 implementation. `author` added to `PackageMetadataFields` (shared with `GraphNode`); `targeting` and `testEnvironment` added to `RepositoryEntry` only (operational concerns, not graph visualization). `build-repository` and `build-graph` updated to propagate the new fields. Design spec field lists in `identity-and-resolution.md` and Phase 4 catalog format updated to match.
- `testEnvironment.minVersion` set to `"12.2.0"` across all 10 bundled guides
- `author` set to `{ name: "Interactive Learning", team: "Grafana Developer Advocacy" }` across all 10 bundled guides
- `recommends` connections aligned with `paths.json`: `first-dashboard` now recommends `prometheus-grafana-101` (getting-started path); `prometheus-advanced-queries` now recommends `loki-grafana-101` (observability-basics path)
- CI fix: removed invalid `persist-credentials` parameter from `actions/setup-node` steps in `ci.yml` (valid only on `actions/checkout`)

### Phase 3: Plugin runtime resolution ✅

**Status:** Complete

**Key decisions and artifacts:**

- Resolution types (`PackageResolutionSuccess`, `PackageResolutionFailure`, `PackageResolution`, `ResolveOptions`, `PackageResolver`, `ResolutionError`) added to `src/types/package.types.ts` at Tier 0; exported from `src/types/index.ts` for broad importability
- `package-engine` registered as Tier 2 in both `TIER_MAP` (`src/validation/import-graph.ts`) and `TIER_2_ENGINES` (`eslint.config.mjs`); architecture ratchet tests pass with unchanged violation counts (vertical=4, lateral=9, barrel=0)
- **`BundledPackageResolver`** in `src/package-engine/resolver.ts`: constructor accepts `RepositoryJson`, resolves bare IDs to `bundled:<path>content.json` / `bundled:<path>manifest.json` URLs; `createBundledResolver()` factory loads bundled `repository.json` via webpack `require()`
- **Package loader** in `src/package-engine/loader.ts`: `loadBundledContent()`, `loadBundledManifest()`, `loadBundledLegacyGuide()` — all return `LoadOutcome<T>` discriminated union reusing `ResolutionError` codes; manifest loading uses `.loose()` (Zod v4 replacement for `.passthrough()`) to tolerate extension metadata; content loading self-contained within package engine (no import from `docs-retrieval`, intentional transitional duplication)
- **Structural dependency resolver** in `src/package-engine/dependency-resolver.ts`: `getProviders()`, `getPackageDependencies()`, `getTransitiveDependencies()` (DFS with visited set for cycle safety), `getRecommendedBy()`, `getDependedOnBy()`, `flattenDependencyList()`, `buildProvidesIndex()`, `listPackageIds()`, `getRepositoryEntry()` — all pure functions taking `RepositoryJson` as parameter, no state
- **Barrel export** (`src/package-engine/index.ts`): resolver class + factory, loader functions + types, dependency query functions + types
- Bundled content URLs use `bundled:` scheme (e.g., `bundled:first-dashboard/content.json`) consistent with existing `bundled:` prefix convention in `docs-retrieval`
- Manifest loading is optional — resolver returns `manifest: undefined` when manifest fails to load, success when only content loads; this supports future packages that may lack manifests during migration
- 72 Layer 2 tests across 3 test files: `resolver.test.ts` (mocked loader for content paths, real bundled repo for factory), `loader.test.ts` (real bundled content integration), `dependency-resolver.test.ts` (pure fixture-based unit tests including cycle handling)

**Why fourth:** Completes the local end-to-end cycle: bundled content is migrated (Phase 2), and the plugin can now load and resolve it at runtime. Establishes the `PackageResolver` interface that later tiers (static catalog in Phase 4, registry service in Phase 7) will implement.

### Phase 3b: Package authoring documentation

**Goal:** Produce practitioner-facing documentation for the two-file package model, covering the full CLI surface introduced in Phases 0-3. Pulled forward from Phase 4 line 202 so content authors can begin using the package format without waiting for the pilot migration.

**Deliverables:**

- [ ] **Package authoring guide** (`docs/developer/package-authoring.md`): field reference for `content.json` and `manifest.json`, dependency quick reference (AND/OR syntax, `provides`, `conflicts`, `replaces`), targeting and `testEnvironment` sections, copy-paste templates, worked example converting a bare guide to a package directory
- [ ] **CLI tools update** (`docs/developer/CLI_TOOLS.md`): document `validate --package`, `validate --packages`, `build-repository`, and `build-graph` commands with usage examples and CI workflow snippet
- [ ] **Repository index reference** (section within package authoring guide): what `repository.json` is, the two publication strategies (committed lockfile vs CI-generated), freshness check setup
- [ ] **Authoring hub link** (`docs/developer/interactive-examples/authoring-interactive-journeys.md`): add package authoring guide to the reference docs table

**What this does NOT include:** No code changes — schemas, engine, and CLI are unchanged. No design spec changes. No AGENTS.md updates.

### Phase 4: Pilot migration, static catalog, and pipeline completion

**Goal:** Extend from bundled-only resolution to multi-repository resolution via a static catalog, migrate pilot guides in `interactive-tutorials` to the package format, add manifest-aware e2e pre-flight checks, and provide path migration tooling.

**Testing layers:** Layer 1 + Layer 2 + Layer 3

Phase 4 is decomposed into six sub-phases. Sub-phases 4a, 4b, 4c, and 4f can run in parallel (Wave 1). Sub-phase 4d depends on 4a (Wave 2). Sub-phase 4e depends on 4b and 4d (Wave 3).

```
Wave 1 (parallel): 4a, 4b, 4c, 4f
Wave 2:            4d (after 4a)
Wave 3:            4e (after 4b + 4d)
```

#### Phase 4a: Static catalog types and build CLI

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 1
**Can start:** Immediately

New types, schemas, and a CLI command that aggregates multiple `repository.json` files into a single `packages-catalog.json` with full URLs instead of relative paths.

- [ ] `CatalogEntry` and `CatalogJson` types in `src/types/package.types.ts` — structurally like `RepositoryEntry` but with `contentUrl` and `manifestUrl` (URLs) instead of `path`
- [ ] Corresponding Zod schemas in `src/types/package.schema.ts`
- [ ] `build-catalog` CLI command in `src/cli/commands/build-catalog.ts` — accepts `name:baseUrl:repoPath` entries (e.g., `bundled:bundled::src/bundled-interactives/repository.json` and `tutorials:https://cdn.grafana.com/tutorials/:path/to/repository.json`), resolves paths to URLs, merges, outputs `packages-catalog.json`
- [ ] Register in `src/cli/index.ts`
- [ ] Layer 1 tests: schema validation, URL generation, merge behavior, duplicate ID handling
- [ ] Update `docs/developer/CLI_TOOLS.md` with `build-catalog` usage

**Key design decision:** The `build-catalog` command maps each repository's relative paths to absolute URLs. The entry format `name:baseUrl:repoPath` provides this. The `bundled:` scheme uses an empty base URL (indicating no remote URL — bundled content uses a different fetch path in the resolver).

#### Phase 4b: Pilot migration (interactive-tutorials)

**Repo:** `interactive-tutorials` (external)
**Testing:** Layer 1 (validation passes in that repo's CI)
**Can start:** Immediately

Convert 3-5 existing guides to the two-file package format and set up CI-generated `repository.json` publication. Uses the package authoring docs from Phase 3b as the reference.

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` (and optionally 1-2 more) to `content.json` + `manifest.json` directory packages
- [ ] Each `manifest.json` includes: `type`, `description`, `category`, `author`, `startingLocation`, dependency fields (`depends`, `recommends`, `provides`), `targeting` with match expressions, `testEnvironment`
- [ ] CI pipeline: `pathfinder-cli build-repository` runs in CI, outputs `repository.json` as build artifact (not committed to git)
- [ ] CI pipeline: `pathfinder-cli build-graph` runs in CI for dependency visualization
- [ ] CDN publication step (or staging equivalent) for `repository.json` alongside guide content
- [ ] `validate --packages` passes in CI

**Prerequisite:** The `interactive-tutorials` repo needs `pathfinder-cli` available — either as a devDependency or built from this repo during CI.

#### Phase 4c: E2E manifest pre-flight

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 3
**Can start:** Immediately

Extend the e2e CLI to read `manifest.json` for pre-flight environment checks before running guide tests.

- [ ] Extend `src/cli/commands/e2e.ts` to accept `--package <dir>` (loads `content.json` from the package directory instead of a bare JSON file)
- [ ] When `manifest.json` exists in the package dir, read `testEnvironment` for pre-flight checks:
  - [ ] `tier`: verify the current test environment matches (e.g., skip cloud-only guides when testing against local Docker)
  - [ ] `minVersion`: check Grafana version via API before running (fail fast with clear message)
  - [ ] `plugins`: verify required plugins are installed
- [ ] Pre-flight failures produce structured skip/fail messages, not silent passes
- [ ] Layer 3 tests for the pre-flight checking logic

**Scope boundary:** This does NOT add full Layer 4 test environment routing (that's Phase 6). It adds manifest-aware pre-flight checks to the existing e2e runner.

#### Phase 4d: Static catalog resolver

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2
**Depends on:** 4a (needs `CatalogJson` types and schema)

A second `PackageResolver` implementation that fetches content from a static catalog (CDN-published `packages-catalog.json`), plus a composite resolver that chains bundled and catalog resolution.

- [ ] `StaticCatalogResolver` implementing `PackageResolver` in `src/package-engine/`:
  - [ ] Constructor accepts a fetched `CatalogJson`
  - [ ] `resolve()` looks up the package in the catalog, returns `PackageResolution` with CDN URLs
  - [ ] Content/manifest loading via `fetch()` when `loadContent` option is true
- [ ] `CatalogFetcher` (or inline in resolver factory): on startup, fetch catalog from configured CDN URL; cache in memory for session duration; fall back to empty catalog on network failure
- [ ] `CompositePackageResolver` (or `createCompositeResolver()` factory):
  - [ ] Checks bundled resolver first (baseline content always available)
  - [ ] Falls back to static catalog resolver (extended content from remote repos)
  - [ ] Same `PackageResolver` interface — callers don't know which tier resolved
- [ ] Runtime ID consistency check: after loading remote content, verify `content.id` and `manifest.id` match the requested `packageId`. Not needed for bundled content (build-time invariants), but critical for remote content where catalog/CDN drift can cause mismatched payloads.
- [ ] Export from `src/package-engine/index.ts` barrel
- [ ] Layer 2 tests: catalog resolution, composite resolution ordering, fallback behavior, ID consistency check, network failure handling

**Key design decision:** The composite resolver preserves the single `PackageResolver` interface — consumers don't change. The resolution priority (bundled first, catalog second) means bundled content always wins for packages that exist in both, providing offline/OSS baseline support.

#### Phase 4e: Integration verification

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2 + Layer 3
**Depends on:** 4b (pilot guides exist and are published) + 4d (catalog resolver works)

End-to-end verification that the plugin correctly loads and renders `content.json` from both bundled and remote sources through the new composite resolver.

- [ ] Integration test: create a composite resolver with bundled repo + a test catalog pointing to the pilot guides from 4b, verify resolution succeeds for both bundled and remote packages
- [ ] Verify rendered output matches between bundled and remote loading of the same guide
- [ ] Verify `build-catalog` correctly aggregates the bundled `repository.json` and the `interactive-tutorials` `repository.json` into a single catalog
- [ ] Verify `validate --packages` passes against the pilot migration output
- [ ] Update this document with Phase 4 completion notes and key decisions

#### Phase 4f: Path migration tooling

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 1
**Can start:** Immediately

A `migrate-paths` CLI command that reads existing learning path metadata from external sources and generates draft `manifest.json` files.

- [ ] `migrate-paths` command in `src/cli/commands/migrate-paths.ts`
- [ ] Reads `journeys.yaml` from `website/content/docs/learning-journeys/` (path provided as CLI arg)
- [ ] Reads markdown front-matter from `*.md` files in the same directory for title, description, and metadata
- [ ] Generates draft `manifest.json` files (with `type: "path"`) for all `*-lj` directories in `interactive-tutorials`
- [ ] Uses bare package IDs throughout (no repository prefix in `id` field or dependency references)
- [ ] Sets `repository: "interactive-tutorials"` as provenance metadata (not used for resolution)
- [ ] Maps `journeys.yaml` `links.to` relationships → `recommends` field in `manifest.json` using bare IDs (soft dependencies, not hard `depends`)
- [ ] Extracts `startingLocation` from existing `index.json` `url` field or `targeting.match` URL rules during migration (first URL from targeting becomes `startingLocation`, falls back to `"/"` if no URL rules present)
- [ ] Outputs to a staging directory for human review and refinement before committing
- [ ] Register in `src/cli/index.ts`
- [ ] Layer 1 tests with fixture YAML/MD files

**Scope boundary:** This produces draft manifests. The actual migration (committing them to `interactive-tutorials`, validating, rebuilding repository.json) is a follow-up human or agent task.

**Why fifth:** By this point, the end-to-end pipeline is already proven on bundled content (Phases 2-3). Phase 4 extends to external content with confidence, adds the remote resolution tier, and validates the full authoring-to-testing pipeline across repositories. The sub-phase decomposition enables parallel agent execution across the independent work streams.

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
| 3b: Package authoring documentation         | Practitioner docs for package format and CLI commands                           | —                 |
| 4a: Static catalog types and build CLI      | Catalog schema and `build-catalog` CLI for multi-repo aggregation               | Layer 1           |
| 4b: Pilot migration (interactive-tutorials) | External repo guides in package format, CI-generated repository.json            | Layer 1           |
| 4c: E2E manifest pre-flight                 | Manifest-aware e2e pre-flight checks (tier, minVersion, plugins)                | Layer 3           |
| 4d: Static catalog resolver                 | Remote content resolution via static catalog, composite resolver                | Layer 2           |
| 4e: Integration verification                | Full pipeline verified across bundled and remote sources                        | Layer 2 + Layer 3 |
| 4f: Path migration tooling                  | `migrate-paths` CLI for draft manifest generation from existing paths           | Layer 1           |
| 5: Path and journey integration             | Two-level metapackage model (paths + journeys), `steps`, docs partner alignment | Layer 1 + Layer 2 |
| 6: Layer 4 test environment routing         | Managed environment routing, version matrix, dataset provisioning               | Layer 4           |
| 7: Repository registry service              | Dynamic multi-repo resolution, rapid content updates, ecosystem scale           | —                 |
| 8: SCORM foundation                         | SCORM import readiness, extends `type` with course/module                       | —                 |
| 9+: SCORM import pipeline                   | Full SCORM conversion pipeline                                                  | —                 |
