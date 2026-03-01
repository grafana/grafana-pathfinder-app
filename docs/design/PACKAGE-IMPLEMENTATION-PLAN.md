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

| Phase                                       | Testing layers     |
| ------------------------------------------- | ------------------ |
| 0: Schema foundation                        | Layer 1            |
| 1: CLI package validation                   | Layer 1            |
| 2: Bundled repository migration             | Layer 1 + Layer 2  |
| 3: Plugin runtime resolution                | Layer 2            |
| 3b: Package authoring documentation         | —                  |
| 4a: Backend package resolution routes       | Go tests + Layer 2 |
| 4b: Pilot migration (interactive-tutorials) | Layer 1            |
| 4c: E2E manifest pre-flight                 | Layer 3            |
| 4d: Frontend remote resolver                | Layer 2            |
| 4e: Integration verification                | Layer 2 + Layer 3  |
| 4f: Path migration tooling                  | Layer 1            |
| 4g: Docs-retrieval integration              | Layer 2            |
| 5: Path and journey integration             | Layer 1 + Layer 2  |
| 6: Layer 4 test environment routing         | Layer 4            |
| 7: Dynamic repository registry              | —                  |
| 8: SCORM foundation                         | —                  |
| 9+: SCORM import pipeline                   | —                  |
| 10: Implementation cleanup                  | —                  |

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

### Phase 3b: Package authoring documentation ✅

**Status:** Complete

**Key decisions and artifacts:**

- Package authoring guide published at `docs/developer/package-authoring.md`: field reference for `content.json` and `manifest.json`, dependency quick reference (AND/OR syntax, `provides`, `conflicts`, `replaces`), targeting and `testEnvironment` sections, copy-paste templates, worked example converting a bare guide to a package directory
- CLI tools updated in `docs/developer/CLI_TOOLS.md`: documented `validate --package`, `validate --packages`, `build-repository`, and `build-graph` commands with usage examples and CI workflow snippet
- Repository index reference included within the package authoring guide: what `repository.json` is, the two publication strategies (committed lockfile vs CI-generated), freshness check setup
- Authoring hub link added in `docs/developer/interactive-examples/authoring-interactive-journeys.md`

### Phase 4: Pilot migration, backend resolution, and pipeline completion

**Goal:** Extend from bundled-only resolution to multi-repository resolution via backend package routes, migrate pilot guides in `interactive-tutorials` to the package format, add manifest-aware e2e pre-flight checks, and provide path migration tooling.

**Testing layers:** Layer 1 + Layer 2 + Layer 3

**Architecture decision: recommender-based resolution, not static catalog.** The original design proposed a static `packages-catalog.json` that aggregated all repository indexes into a single file fetched by the frontend plugin at startup. This was replaced with resolution routes on the recommender microservice ([`grafana-recommender`](https://github.com/grafana/grafana-recommender)) for three reasons: (1) a pre-aggregated catalog suffers from freshness lag — any content repo update requires rebuilding and re-publishing the catalog; (2) the frontend plugin holds the full catalog in memory for the session, which scales poorly as the content corpus grows; (3) the recommender already needs repository index data for targeting and dependency graph analysis anyway — adding resolution routes to the same service that already caches these indexes avoids duplicating infrastructure. Moving resolution to the recommender keeps the frontend thin (it only needs bare IDs and the recommender URL), puts index caching where memory is cheap (server-side), and avoids build-time coupling between the plugin and every content repository's publication cadence. The frontend's `PackageResolver` interface is unchanged — the implementation calls the recommender's resolution endpoint to get CDN URLs, then fetches content directly from CDN. The recommender is a pure lookup service: bare ID in, CDN URLs out. Bundled content continues to resolve locally for offline/OSS support.

Phase 4 is decomposed into seven sub-phases. Sub-phases 4a, 4b, 4c, and 4f can run in parallel (Wave 1). Sub-phase 4d depends on 4a (Wave 2). Sub-phase 4e depends on 4b and 4d (Wave 3). Sub-phase 4g depends on 4e (Wave 4).

```
Wave 1 (parallel): 4a, 4b, 4c, 4f
Wave 2:            4d (after 4a)
Wave 3:            4e (after 4b + 4d)
Wave 4:            4g (after 4e)
```

#### Phase 4a: Backend package resolution routes

**Repo:** [`grafana-recommender`](https://github.com/grafana/grafana-recommender) (the Go recommender microservice — **not** the Go plugin backend in `grafana-pathfinder-app/pkg/`). A local clone lives at `../grafana-recommender/` relative to this repo for agent inspection; see `AGENTS.md` there for repo conventions.
**Testing:** Go unit tests + Layer 2
**Can start:** Immediately

Add a package resolution endpoint to the recommender microservice. The recommender already fetches external configuration via URL (see `loadFromURL` and `STATE_RECOMMENDATIONS_URL` in `cmd/recommender/main.go`); the same pattern extends to fetching and caching remote `repository.json` files. The resolution endpoint resolves a bare package ID across repositories in priority order and returns a JSON resolution body containing CDN URLs for the package's content and manifest — the frontend then fetches directly from CDN. The recommender never proxies or redirects to content; it is a pure lookup service.

- [ ] **Resolution endpoint in `cmd/recommender/main.go` (or a new `packages.go` handler file):**
  - [ ] `GET /api/packages/{id}` — resolves the bare package ID and returns a resolution response:
    ```json
    {
      "id": "prometheus-grafana-101",
      "contentUrl": "https://interactive-learning.grafana.net/guides/prometheus-grafana-101/content.json",
      "manifestUrl": "https://interactive-learning.grafana.net/guides/prometheus-grafana-101/manifest.json",
      "repository": "interactive-tutorials"
    }
    ```
  - [ ] Returns 404 with a structured `ResolutionError` when the package is not found
  - [ ] Returns appropriate cache headers for downstream caching (resolution responses are cacheable — they are a pure function of the package ID and the current repository index state)
- [ ] **Repository index management:**
  - [ ] Config-driven list of repository URLs (e.g., `https://cdn.grafana.com/interactive-tutorials/repository.json`) via environment variable (consistent with the recommender's existing `STATE_RECOMMENDATIONS_URL` pattern)
  - [ ] Periodic fetch and in-memory caching of each repository's `repository.json` with configurable TTL (aligned with the recommender's existing ~20-minute refresh cycle)
  - [ ] Repository priority ordering: remote repositories ordered by configuration
  - [ ] Graceful degradation: if a remote repository is unreachable, use the last cached version; if no cache exists, skip that repository
- [ ] **Resolution logic:**
  - [ ] Given a bare package ID, check repositories in priority order until a match is found
  - [ ] Construct content/manifest CDN URLs from the matched `RepositoryEntry.path` and the repository's base URL
  - [ ] Return URLs in the resolution response — the recommender does not fetch, proxy, or redirect to the content itself
- [ ] **Go unit tests** for resolution logic, priority ordering, caching, fallback behavior, ID consistency checks
- [ ] **Shared repository index** between resolution routes and the recommender — the recommender's existing periodic refresh of content indexes (via `loadAllConfigs`) can be unified with the package resolution index, since both consume the same `repository.json` files
- [ ] **Update `openapi.yaml`** in `grafana-recommender` with the new resolution endpoints

**Key design decisions:**

- **Resolution response, not proxy or redirect.** The recommender returns a JSON body with CDN URLs for the package's content and manifest. The frontend fetches from CDN directly. This keeps the recommender as a lightweight lookup service — it never proxies content or issues HTTP redirects. One resolution request gives the frontend both URLs, which it can fetch in parallel from CDN. Content is already CDN-hosted (the `interactive-tutorials` CI builds and publishes to CDN), so the recommender only needs to map bare IDs to CDN paths using its cached `repository.json` indexes.
- **Resolution responses are cacheable.** The response is a pure function of the package ID and the current repository index state. Cache headers can be set based on the repository refresh TTL.
- Repository configuration lives in environment variables (consistent with the recommender's existing config pattern) so that different deployments can point to different content repositories without code changes.
- The recommender and resolution routes share the same cached repository indexes — one refresh cycle, two consumers. The `loadAllConfigs` / `/reload` pattern extends to include repository index refresh.
- **Enriched resolution with navigation (Phase 5).** The resolution response is designed to be extended with graph-derived navigation fields (`memberOf` with parent `steps`, `recommended`) when path and journey integration lands. The recommender holds the full dependency graph from its cached repository indexes and is the natural place to provide metapackage membership data. See Phase 5 for the navigation enrichment design.

#### Phase 4b: Pilot migration (interactive-tutorials)

**Repo:** [`interactive-tutorials`](https://github.com/grafana/interactive-tutorials) (external content repository). A local clone lives at `../interactive-tutorials/` relative to this repo for agent inspection.
**Testing:** Layer 1 (validation passes in that repo's CI)
**Can start:** Immediately

Convert 3-5 existing guides to the two-file package format and set up CI-generated `repository.json` publication. Uses the package authoring docs from Phase 3b as the reference.

- [ ] Convert `welcome-to-grafana`, `prometheus-grafana-101`, `first-dashboard` (and optionally 1-2 more) to `content.json` + `manifest.json` directory packages
- [ ] Each `manifest.json` includes: `type`, `description`, `category`, `author`, `startingLocation`, dependency fields (`depends`, `recommends`, `provides`), `targeting` with match expressions, `testEnvironment`
- [ ] CI pipeline: `pathfinder-cli build-repository` runs in CI, outputs `repository.json` as build artifact (not committed to git)
- [ ] CI pipeline: `pathfinder-cli build-graph` runs in CI for dependency visualization
- [ ] CDN publication step (or staging equivalent) for `repository.json` alongside guide content
- [ ] `validate --packages` passes in CI

**CLI availability:** The `interactive-tutorials` CI already checks out `grafana-pathfinder-app`, installs dependencies, and builds the CLI for guide validation (see `.github/workflows/validate-json.yml`, `validate-guides` job). The same cross-repo checkout pattern extends to run `build-repository`, `build-graph`, and `validate --packages`.

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

#### Phase 4d: Frontend remote resolver

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2
**Depends on:** 4a (backend routes must exist)

A thin frontend `PackageResolver` implementation that resolves bare package IDs by calling the recommender's resolution endpoint from Phase 4a, then fetching content directly from CDN using the URLs in the resolution response. Composed with the existing `BundledPackageResolver` for offline fallback.

- [ ] `RecommenderPackageResolver` implementing `PackageResolver` in `src/package-engine/`:
  - [ ] `resolve()` calls `GET /api/packages/{id}` on the recommender microservice directly (the recommender already allows cross-origin requests via `Access-Control-Allow-Origin: *`). The recommender URL is discovered via the same mechanism the frontend already uses for `/recommend` calls (see `configWithDefaults.recommenderServiceUrl` in `src/constants.ts` — defaults to `https://recommender.grafana.com`, configurable via plugin settings).
  - [ ] The resolution response contains `contentUrl` and `manifestUrl` pointing to CDN. When `loadContent` is requested, the resolver fetches from those CDN URLs directly.
  - [ ] Handles 404 as `not-found`, network failures as `network-error`
- [ ] `CompositePackageResolver` (or `createCompositeResolver()` factory):
  - [ ] Checks `BundledPackageResolver` first (baseline content, works offline/OSS)
  - [ ] Falls back to `RecommenderPackageResolver` only if the user has enabled the online recommender in plugin settings (the existing setting that gates recommender use for OSS). When this setting is off, the recommender resolver is not instantiated — bundled-miss means the package does not exist.
  - [ ] Same `PackageResolver` interface — callers don't know which tier resolved
- [ ] Export from `src/package-engine/index.ts` barrel
- [ ] Layer 2 tests: composite resolution ordering, bundled-first behavior, fallback to recommender, network failure handling, CDN fetch from resolved URLs

**Key design decisions:**

- The composite resolver preserves the single `PackageResolver` interface — consumers don't change. The resolution priority (bundled first, recommender second) means bundled content always wins for packages that exist locally, providing offline/OSS baseline support.
- **Recommender gated by plugin setting.** The `RecommenderPackageResolver` is only instantiated when the user has enabled the online recommender in plugin settings (the existing setting that gates recommender use for OSS). When the setting is off, the composite resolver contains only the bundled resolver — no network calls are attempted, and a bundled-miss means the package does not exist. This eliminates latency and error noise in environments where the recommender is genuinely unavailable. No circuit-breaker is needed: the setting is the gate.
- The frontend never fetches or stores repository indexes — all multi-repo resolution logic lives in the recommender. The frontend receives CDN URLs from the resolution response and fetches content directly.
- The resolution response will be extended with graph-derived navigation fields in Phase 5 (`memberOf` with parent `steps`, `recommended`). The `RecommenderPackageResolver` should be designed to pass these through to callers when present, even though Phase 4d does not consume them yet.

#### Phase 4e: Integration verification

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2 + Layer 3
**Depends on:** 4b (pilot guides exist and are published) + 4d (frontend resolver works)

End-to-end verification that the plugin correctly loads and renders `content.json` from both bundled and remote sources through the composite resolver and backend routes.

- [ ] Integration test: configure the recommender with the `interactive-tutorials` repository URL, verify that the recommender resolves pilot guide IDs and returns content
- [ ] Verify the composite resolver correctly falls through from bundled (miss) to backend (hit) for remote-only packages
- [ ] Verify rendered output matches between bundled and remote loading of the same guide
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

**Why fifth:** By this point, the end-to-end pipeline is already proven on bundled content (Phases 2-3). Phase 4 extends to external content with confidence via recommender resolution routes. The frontend stays thin — it resolves bundled content locally and delegates remote resolution to the recommender, which shares its repository index cache with the recommendation engine. The sub-phase decomposition enables parallel agent execution across the independent work streams.

#### Phase 4g: Docs-retrieval integration

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2
**Depends on:** 4e (composite resolver verified end-to-end)

Wire the composite `PackageResolver` into the `docs-retrieval` fetch pipeline so that `docs-retrieval` becomes the single entry point for all content fetching — both static documentation and interactive packages. This resolves the "intentional transitional duplication" from Phase 3 and establishes the fetch architecture that Phase 5's navigation enrichment depends on.

**Architecture decision: docs-retrieval dispatches by content type.** Not all content is interactive guides — some is static documentation from a different CDN that doesn't participate in the package system. `docs-retrieval` must distinguish content type and dispatch accordingly:

- **Static documentation:** fetched via the existing `docs-retrieval` pipeline, unchanged
- **Interactive guide, path, or journey:** delegated to the composite `PackageResolver`, which checks the bundled loader first and falls back to the recommender resolver if configured

The composite resolver is injected into `docs-retrieval` via dependency inversion. Both `docs-retrieval` and `package-engine` are Tier 2 engines (laterally isolated — cannot import from each other). The `PackageResolver` interface is defined at Tier 0 (`src/types/package.types.ts`), so `docs-retrieval` can depend on the interface without violating lateral isolation. The concrete wiring — creating the `CompositePackageResolver` and injecting it into the docs-retrieval fetch pipeline — happens at Tier 3+ (`integrations/`), where both Tier 2 engines are accessible.

- [ ] **Content-type dispatch in `docs-retrieval`:**
  - [ ] Add a code path that identifies interactive content (guide, path, journey) vs. static documentation
  - [ ] When interactive content is identified, delegate to the injected `PackageResolver` instead of the existing fetch logic
  - [ ] Static documentation continues through the existing fetch path unchanged
- [ ] **Dependency injection of `PackageResolver`:**
  - [ ] `docs-retrieval` accepts a `PackageResolver` (Tier 0 interface) — it does not import from `package-engine` (Tier 2)
  - [ ] Tier 3+ wiring code creates the `CompositePackageResolver` (bundled-first, recommender-fallback) and passes it into docs-retrieval's fetch pipeline
- [ ] **Remove transitional duplication:**
  - [ ] Identify and remove any content-loading code in `package-engine` that duplicated `docs-retrieval` logic (noted as "intentional transitional duplication" in Phase 3)
  - [ ] Verify that the bundled loader and recommender resolver paths both produce content that the existing renderer can consume without changes
- [ ] Layer 2 tests: content-type dispatch routing, injected resolver receives interactive content requests, static docs bypass the resolver, fallback behavior when no resolver is injected (e.g., OSS without recommender)

**Why here:** Phase 4e proves the composite resolver works end-to-end. Phase 4g connects it to the rendering pipeline so that resolved content actually reaches the user. This must land before Phase 5 because Phase 5 enriches the resolution response with navigation data (`memberOf`, `recommended`) — that data has no path to the UI unless the renderer is consuming content through the package resolver.

### Phase 5: Path and journey integration

**Decomposition note:** This phase has significant breadth (CLI validation, recommender enrichment, frontend UI, migration/deprecation) and should be decomposed into sub-phases before execution, in light of decisions made during Phase 4. Defer decomposition until Phase 4 is complete.

**Goal:** Paths and journeys are working metapackage types at two composition levels. A path (`type: "path"`) composes guides into an ordered sequence; a journey (`type: "journey"`) composes paths (or any packages) into a larger learning arc. The CLI validates both, the dependency graph treats them as first-class nodes, and the recommender's resolution response provides graph-derived navigation so the frontend can render "next step" and path progress without client-side graph reasoning. See [learning paths and journeys](./PATHFINDER-PACKAGE-DESIGN.md#learning-journeys) for the full design.

**Testing layers:** Layer 1 + Layer 2

**Architecture decision: graph navigation lives in the recommender.** The full dependency graph (all repositories, all `steps` arrays, all `depends`/`recommends` edges) lives in the recommender's cached repository indexes. The recommender is the natural place to compute graph-derived navigation because: (1) it already holds the complete topology across every repository; (2) it will eventually consume completion state for smarter recommendations; (3) keeping graph reasoning server-side means the frontend stays a renderer, not a graph engine. The resolution response from Phase 4a's `GET /api/packages/{id}` is extended with a `navigation` field:

```json
{
  "id": "prometheus-grafana-101",
  "contentUrl": "https://interactive-learning.grafana.net/guides/prometheus-grafana-101/content.json",
  "manifestUrl": "https://interactive-learning.grafana.net/guides/prometheus-grafana-101/manifest.json",
  "repository": "interactive-tutorials",
  "navigation": {
    "memberOf": [
      {
        "id": "getting-started",
        "type": "path",
        "steps": ["welcome-to-grafana", "prometheus-grafana-101", "first-dashboard", "loki-grafana-101"]
      },
      {
        "id": "observability-basics",
        "type": "path",
        "steps": [
          "welcome-to-grafana",
          "first-dashboard",
          "prometheus-grafana-101",
          "prometheus-advanced-queries",
          "loki-grafana-101"
        ]
      }
    ],
    "recommended": ["loki-grafana-101", "prometheus-advanced-queries"]
  }
}
```

- `memberOf`: which paths/journeys this package participates in. Each entry carries the parent's `id`, `type`, and full `steps` array. The frontend derives everything it needs locally: position (`steps.indexOf(currentId)`), total (`steps.length`), next structural step, and completion-aware next (first incomplete step). This avoids baking structural navigation decisions into the recommender response that may conflict with the frontend's completion-aware logic.
- `recommended`: packages linked via `recommends` edges in the dependency graph — "where else might the user go from here?"

This replaces the earlier "learning path reconciliation at Tier 3+" design. The frontend does not need a Tier 3+ utility to stitch `package-engine` and `learning-paths` together — the recommender provides navigation directly.

**Completion state phasing:** In Phase 5, the recommender computes `navigation` from structural graph data only (array order in `steps`, `recommends` edges). The frontend overlays client-side completion state for display (e.g., showing which steps are done, highlighting the next incomplete step). In a future phase beyond this plan's scope, the frontend will send completion data to the recommender alongside context (using the existing `POST /recommend` payload pattern), and the recommender will return completion-aware navigation. Server-side completion state is a further future concern. This phasing keeps the resolution response cacheable in Phase 5 while leaving a clean path to personalized navigation later.

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
- [ ] **Recommender navigation enrichment** (in `grafana-recommender`):
  - [ ] Extend `GET /api/packages/{id}` resolution response with `navigation` field (`memberOf` with parent `steps`, `recommended`)
  - [ ] `memberOf` computed by scanning all metapackages whose `steps` arrays contain this package ID; each entry includes the parent's `id`, `type`, and full `steps` array
  - [ ] `recommended` computed from `recommends` edges in the dependency graph
  - [ ] Go unit tests for navigation computation (single-path membership, multi-path membership, journey-level membership, packages with no parent metapackage)
- [ ] **Frontend navigation display** (in `grafana-pathfinder-app`):
  - [ ] UI: display path/journey progress computed from `memberOf[].steps` and local completion state (position, total, completed count)
  - [ ] UI: "next step" navigation computed locally — next incomplete step from `memberOf[].steps` using completion data, not structural array order
  - [ ] UI: path context selection — when multiple `memberOf` entries exist, select which path to display based on navigation context (e.g., which path the user arrived from), defaulting to the first entry
  - [ ] UI: recommended content links using `navigation.recommended`
  - [ ] UI: learning path cards use package metadata (description, category) from the resolution response when available
  - [ ] Frontend overlays client-side completion state on the structural navigation for display
- [ ] **`paths.json` deprecation path:** With navigation provided by the recommender's resolution response, curated `paths.json` becomes redundant once all paths are expressed as metapackages with `steps` arrays. During transition, `paths.json` continues to serve as the fallback for paths not yet migrated to metapackages.
- [ ] Align with docs partners' YAML format for learning path relationships
- [ ] Layer 1 unit tests for path and journey schema validation (`type`, `steps`, nested structure)
- [ ] Layer 2 unit tests for frontend navigation display logic (progress computation from `memberOf[].steps`, completion-aware next step, path context selection, `recommended` rendering)

**Why sixth:** First user-visible payoff of the package model. Introduces two-level metapackage composition (paths compose guides, journeys compose paths) that SCORM `"course"` and `"module"` types will later build on. Content authors and docs partners see dependency declarations reflected in the learning experience. The recommender's enriched resolution response eliminates the need for client-side graph reasoning, keeping the frontend thin.

### Phase 6: Layer 4 test environment routing

**Goal:** Route guides to managed test environments using `testEnvironment` metadata. The schema field is already in place from Phase 0, and the e2e CLI already reads it from Phase 4 — this phase focuses on Layer 4 infrastructure.

**Testing layers:** Layer 4

**Deliverables:**

- [ ] Environment routing: match `testEnvironment.tier` to available managed environments
- [ ] Version matrix testing: run guides against multiple Grafana versions per `testEnvironment.minVersion`
- [ ] Dataset and plugin provisioning: provision `testEnvironment.datasets` and `testEnvironment.plugins` in managed environments
- [ ] Document testEnvironment authoring guidelines (authored in `manifest.json`)

**Why seventh:** Layer 4 foundation from the testing strategy. Depends on the package format being stable and adopted. Narrower than originally scoped because `testEnvironment` schema (Phase 0) and e2e CLI reading (Phase 4) are already complete.

### Phase 7: Dynamic repository registry

**Goal:** Evolve the recommender's config-driven repository list (Phase 4a) into a dynamic registry that supports repository discovery and ecosystem-scale package management. Phase 4a establishes the recommender resolution routes and config-driven repository list; Phase 7 makes the registry dynamic and adds operational capabilities.

**Deliverables:**

- [ ] **Dynamic repository discovery:**
  - [ ] `GET /api/registry` endpoint returns the live list of known repositories with their locations and priority
  - [ ] Repositories can be added/removed via API without service restarts (upgrade from Phase 4a's config-driven list)
  - [ ] Webhook or polling triggers for immediate repository index refresh when content repos publish updates (upgrade from Phase 4a's TTL-based refresh)
- [ ] **Cross-repository identity evolution:**
  - [ ] Registry maintains a compound key (repository + package ID) internally, distinguishing the same bare ID published by different repositories
  - [ ] Resolution continues to use priority-based clobber semantics (first repository in priority order wins), but the registry can report shadowed packages for diagnostics
  - [ ] This evolves the identity model: Phases 0-6 assume globally unique bare IDs; Phase 7 introduces registry-scoped uniqueness with deterministic resolution order
- [ ] **Performance and reliability at scale:**
  - [ ] Resolution result caching with TTL (builds on Phase 4a's in-memory cache)
  - [ ] Service monitoring: track resolution failures, index staleness, repository availability
  - [ ] Graceful degradation: if specific repository unavailable, serve from cached index
  - [ ] Target: 1000+ packages across many repositories
- [ ] **Recommender evolution:**
  - [ ] Recommender endpoints evolve to return bare package IDs alongside URLs (the frontend can resolve bare IDs via the `GET /api/packages/{id}` resolution route from Phase 4a)
  - [ ] Dependency graph data from repository indexes feeds into recommendation quality

**Deferred: multi-tenancy.** Multi-tenancy (different users/orgs seeing different package catalogs, per-tenant repository priority ordering) is a future concern beyond Phase 7. It requires tenant identity to be available to the recommender API, which is not currently the case. Multi-tenancy changes the resolution contract from a pure function of package ID to a function of (package ID, tenant context), affecting caching, index structure, and the request model. It will be designed separately when the prerequisite (tenant identity on the recommender API) is in place.

**Why eighth:** Extends Phase 4a's resolution from a config-driven bootstrap to a production registry. Enables rapid content updates (webhook-triggered refresh), independent repository management, and ecosystem growth. The resolution endpoint and frontend resolver from Phase 4 are unchanged — only the recommender's repository discovery and refresh mechanisms evolve.

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

### Phase 10: Implementation cleanup

**Goal:** Revisit code committed in earlier phases that may be unnecessary given design decisions made in later phases. This is a scheduled debt reconciliation pass — earlier phases were executed under assumptions that later phases refined or replaced.

**Known candidates:**

- [ ] **`src/package-engine/dependency-resolver.ts`:** Exports 10 structural dependency query functions (`getProviders`, `getTransitiveDependencies`, `getRecommendedBy`, `getDependedOnBy`, etc.) from the package-engine barrel. No consumer outside its own test file. The CLI graph builder (`src/cli/commands/build-graph.ts`) implements equivalent logic independently (`extractDependencyIds`, `buildProvidesMap`, `detectCycles`). The Phase 5 decision (graph navigation lives in the recommender) means the frontend will not need client-side dependency queries. **Action:** verify no runtime or CLI code path imports these functions; if confirmed, delete the module and its tests. If the CLI graph builder should share this logic instead of duplicating it, consolidate into `validation/` (Tier 1) where both CLI and future consumers can reach it.
- [ ] **`loadBundledLegacyGuide` in `src/package-engine/loader.ts`:** Exported from the barrel but unused outside its own module and tests. Phase 2 migrated all bundled guides to the package directory format. **Action:** verify no import path; if confirmed, remove the function and its tests.
- [ ] **Functional duplication between `build-graph.ts` and `dependency-resolver.ts`:** `extractDependencyIds` duplicates `flattenDependencyList`/`flattenClause`; `buildProvidesMap` duplicates `buildProvidesIndex`. If both modules survive cleanup, one should consume the other. If `dependency-resolver.ts` is deleted, the CLI's local copies are canonical and no action is needed.
- [ ] **Resolution type alignment:** The design spec in `identity-and-resolution.md` shows a flat `PackageResolution` interface (success-only shape). The implementation uses a discriminated union (`PackageResolutionSuccess | PackageResolutionFailure` with `ok: true/false`). Reconcile the spec to match the implementation or vice versa — the discriminated union is more expressive and should likely win.

**Process:** For each candidate, confirm the usage analysis, execute the deletion or consolidation, run the tidy-up skill, and verify all tests pass with unchanged violation counts.

---

## Summary

| Phase                                       | Unlocks                                                                                                 | Testing layers     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------ |
| 0: Schema foundation                        | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema                           | Layer 1            |
| 1: CLI package validation                   | CI validation, cross-file checks, dependency graph                                                      | Layer 1            |
| 2: Bundled repository migration             | End-to-end proof on local corpus, bundled `repository.json`                                             | Layer 1 + Layer 2  |
| 3: Plugin runtime resolution                | PackageResolver consuming bundled repo, local resolution tier                                           | Layer 2            |
| 3b: Package authoring documentation         | Practitioner docs for package format and CLI commands                                                   | —                  |
| 4a: Backend package resolution routes       | Recommender resolves bare IDs across repos, shared index with recommendation engine                     | Go tests + Layer 2 |
| 4b: Pilot migration (interactive-tutorials) | External repo guides in package format, CI-generated repository.json                                    | Layer 1            |
| 4c: E2E manifest pre-flight                 | Manifest-aware e2e pre-flight checks (tier, minVersion, plugins)                                        | Layer 3            |
| 4d: Frontend remote resolver                | Thin frontend resolver calling recommender routes, composite with bundled fallback                      | Layer 2            |
| 4e: Integration verification                | Full pipeline verified across bundled and remote sources                                                | Layer 2 + Layer 3  |
| 4f: Path migration tooling                  | `migrate-paths` CLI for draft manifest generation from existing paths                                   | Layer 1            |
| 4g: Docs-retrieval integration              | Package resolver wired into rendering pipeline, content-type dispatch, transitional duplication removed | Layer 2            |
| 5: Path and journey integration             | Two-level metapackage model, recommender navigation enrichment, `paths.json` deprecation path           | Layer 1 + Layer 2  |
| 6: Layer 4 test environment routing         | Managed environment routing, version matrix, dataset provisioning                                       | Layer 4            |
| 7: Dynamic repository registry              | Dynamic registry, webhook refresh, ecosystem scale (multi-tenancy deferred)                             | —                  |
| 8: SCORM foundation                         | SCORM import readiness, extends `type` with course/module                                               | —                  |
| 9+: SCORM import pipeline                   | Full SCORM conversion pipeline                                                                          | —                  |
| 10: Implementation cleanup                  | Dead code removal, duplication consolidation, spec-implementation alignment                             | —                  |
