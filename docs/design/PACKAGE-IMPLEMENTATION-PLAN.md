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

### Cross-repo implementation plans

This plan spans three repositories. Each has its own detailed implementation documents that are subordinate to this plan but authoritative for repo-internal decisions. Agents working on a phase should read the relevant external documents before starting.

| External repo                                                               | Document                                                                                               | Covers                                                                                                                             | Aligns with phase | Status                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------- |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/RESOLUTION.md`                                                                            | Resolution endpoint implementation: types, repository loading, HTTP handler, periodic reload scheduler, tests, docs/deploy         | 4a                | Complete                    |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/V1-RECOMMEND.md`                                                                          | Package-aware `POST /api/v1/recommend`: virtual rule construction from targeting, mixed URL+package results, navigation enrichment | 4a, 5             | Complete (Phase 5 deferred) |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/API-VERSIONING.md`                                                                        | `/api/v1/` routing convention, legacy `/recommend` coexistence, deprecation strategy (RFC 8594)                                    | 4a, 4d            | Complete                    |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `openapi.yaml` on [`feat/package-resolution`](https://github.com/grafana/grafana-recommender/pull/158) | OpenAPI 3.0 spec for all endpoints including `GET /api/v1/packages/{id}` and `POST /api/v1/recommend`                              | 4a, 4d            | Complete                    |
| [`interactive-tutorials`](https://github.com/grafana/interactive-tutorials) | `docs/MIGRATION.md` + [PR #142](https://github.com/grafana/interactive-tutorials/pull/142)             | Full migration: documentation, migration skill, content migration, CI integration, deploy pipeline                                 | 4b                | Complete                    |

### Canonical URLs

| Resource                  | URL                                                                 | Notes                                                 |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Package repository (live) | `https://interactive-learning.grafana.net/packages/repository.json` | 31 packages, CI-generated on every push               |
| Recommender (production)  | `https://recommender.grafana.com`                                   | Configured via `recommenderServiceUrl` plugin setting |
| Recommender v1 recommend  | `POST https://recommender.grafana.com/api/v1/recommend`             | Package-aware recommendations (pending deploy)        |
| Recommender v1 packages   | `GET https://recommender.grafana.com/api/v1/packages/{id}`          | Bare ID → CDN URL resolution (pending deploy)         |
| CDN content base          | `https://interactive-learning.grafana.net/packages/`                | Package directories co-located with repository.json   |
| Legacy recommend endpoint | `POST https://recommender.grafana.com/recommend`                    | URL-backed only; deprecation per RFC 8594             |

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

| Phase                                         | Testing layers     | Status      |
| --------------------------------------------- | ------------------ | ----------- |
| 0: Schema foundation                          | Layer 1            | ✅          |
| 1: CLI package validation                     | Layer 1            | ✅          |
| 2: Bundled repository migration               | Layer 1 + Layer 2  | ✅          |
| 3: Plugin runtime resolution                  | Layer 2            | ✅          |
| 3b: Package authoring documentation           | —                  | ✅          |
| 4a: Backend resolution + v1 recommend routes  | Go tests + Layer 2 | ✅ (PR)     |
| 4b: Content migration (interactive-tutorials) | Layer 1            | ✅          |
| 4c: E2E manifest pre-flight                   | Layer 3            | —           |
| 4d: Frontend remote resolver + v1 migration   | Layer 2            | **Next**    |
| 4e: Integration verification                  | Layer 2 + Layer 3  | —           |
| 4f: Path migration tooling                    | Layer 1            | ⏸️ Optional |
| 4g: Docs-retrieval integration                | Layer 2            | —           |
| 5: Path and journey integration               | Layer 1 + Layer 2  | —           |
| 6: Layer 4 test environment routing           | Layer 4            | —           |
| 7: Dynamic repository registry                | —                  | —           |
| 8: SCORM foundation                           | —                  | —           |
| 9+: SCORM import pipeline                     | —                  | —           |
| 10: Implementation cleanup                    | —                  | —           |

---

## Phases

### Phase 0: Schema foundation and Layer 1 extension ✅

**Status:** Complete

**Key decisions and artifacts:**

- `validation` moved to Tier 1 in both `TIER_MAP` and `eslint.config.mjs`; lateral ratchet dropped from 11 → 9
- Types in `src/types/package.types.ts`: `ContentJson`, `ManifestJson`, `RepositoryJson`, `RepositoryEntry`, `GraphNode`, `GraphEdge`, `DependencyGraph`, and all dependency/author/targeting types. Resolution types (`PackageResolution`, `PackageResolver`) removed — deferred to Phase 3 implementation.
- Zod schemas in `src/types/package.schema.ts`: `ContentJsonSchema`, `ManifestJsonSchema`, `ManifestJsonObjectSchema`, `RepositoryJsonSchema`, `RepositoryEntrySchema`, `DependencyClauseSchema`, `DependencyListSchema`, `AuthorSchema`, `GuideTargetingSchema`, `TestEnvironmentSchema`, `PackageTypeSchema`, `GraphNodeSchema`, `GraphEdgeSchema`, `DependencyGraphSchema`
- `ManifestJsonSchema` uses `.refine()` for the conditional `milestones` requirement; `ManifestJsonObjectSchema` is the base shape before refinement for composition use
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
- Graph lint checks implemented: broken refs, broken milestones, cycles (DFS-based), orphans, missing description/category
- Cycle detection uses DFS with separate checks for depends (error), recommends (warn), milestones (error)
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

### Phase 4: Multi-repository resolution and pipeline completion

**Goal:** Extend from bundled-only resolution to multi-repository resolution via backend package routes, migrate content in `interactive-tutorials` to the package format, and wire the frontend to the recommender's v1 endpoints.

**Testing layers:** Layer 1 + Layer 2 + Layer 3

**Architecture decision: recommender-based resolution, not static catalog.** The original design proposed a static `packages-catalog.json` that aggregated all repository indexes into a single file fetched by the frontend plugin at startup. This was replaced with resolution routes on the recommender microservice ([`grafana-recommender`](https://github.com/grafana/grafana-recommender)) for three reasons: (1) a pre-aggregated catalog suffers from freshness lag — any content repo update requires rebuilding and re-publishing the catalog; (2) the frontend plugin holds the full catalog in memory for the session, which scales poorly as the content corpus grows; (3) the recommender already needs repository index data for targeting and dependency graph analysis anyway — adding resolution routes to the same service that already caches these indexes avoids duplicating infrastructure. Moving resolution to the recommender keeps the frontend thin (it only needs bare IDs and the recommender URL), puts index caching where memory is cheap (server-side), and avoids build-time coupling between the plugin and every content repository's publication cadence. The frontend's `PackageResolver` interface is unchanged — the implementation calls the recommender's resolution endpoint to get CDN URLs, then fetches content directly from CDN. The recommender is a pure lookup service: bare ID in, CDN URLs out. Bundled content continues to resolve locally for offline/OSS support.

Phase 4 is decomposed into seven sub-phases. Phases 4a and 4b are complete. The remaining critical path is 4d → 4e → 4g. Phase 4c can run in parallel with 4d. Phase 4f has been demoted to optional.

```
Complete:          4a ✅, 4b ✅
Wave 1 (parallel): 4d (after 4a merge+deploy), 4c
Wave 2:            4e (after 4d)
Wave 3:            4g (after 4e)
Optional:          4f (demoted — migration completed without tooling)
```

#### Phase 4a: Backend package resolution routes ✅

**Status:** Complete — [PR #158](https://github.com/grafana/grafana-recommender/pull/158) (`feat/package-resolution` branch). Pending merge and deploy.

**Repo:** [`grafana-recommender`](https://github.com/grafana/grafana-recommender)
**Testing:** Go unit tests (1556 lines in `packages_test.go`, 946 lines in `v1recommend_test.go`) + E2E tests + load tests

**What was delivered:**

- [x] `GET /api/v1/packages/{id}` — bare ID resolution to CDN URLs (`cmd/recommender/packages.go`, 574 lines)
- [x] `POST /api/v1/recommend` — package-aware recommendations with mixed URL-backed + package-backed results (`cmd/recommender/v1recommend.go`, 463 lines)
- [x] Repository index management via `PACKAGE_REPOSITORY_URLS` env var (comma-separated `name|url` pairs)
- [x] Shared periodic reload scheduler (`internal/reload/scheduler.go`): single-flight execution, trigger coalescing, bounded jitter (20%), configurable via `CONFIGS_RELOAD_INTERVAL_MINUTES`
- [x] Virtual rule construction from `targeting.match` metadata in repository indexes
- [x] Full metadata carry-through to v1 response: `packageType`, `category`, `author`, `startingLocation`, `milestones`, `navigation` (recommends/suggests/depends)
- [x] Featured recommendation support for packages (`type: "package"` in `featured.json`)
- [x] OpenAPI 3.0 spec (`openapi.yaml`) with complete `V1Recommendation`, `PackageNavigation`, `PackageResolutionResponse`, `PackageResolutionError` schemas
- [x] Prometheus metrics: `recommender_package_loading_errors_total`, `recommender_v1_package_resolutions_total`, per-endpoint duration/in-flight via `metricsMiddleware`
- [x] X-Request-ID middleware and request-scoped structured logging for v1 endpoints
- [x] E2E test infrastructure (`docker-compose.e2e.yaml`) and load test coverage (`load.js`)

**Key design decisions (confirmed in implementation):**

- **Resolution response, not proxy or redirect.** `Cache-Control: public, max-age=<TTL>` on success (configurable via `PACKAGE_REPOSITORY_CACHE_TTL`, default `300`); `Cache-Control: no-cache` on 404.
- **Scheduled reload does NOT call `configureRecommenders`.** Avoids latent goroutine leak from GCSCohortMapper recreation. Scheduled reload runs `loadAllConfigs` + `refreshRecommenderFromLoadedConfig` only.
- **V1 types are standalone in `cmd/recommender/`**, not extensions of `internal/recommender/` types. `V1Rule` is package-only (no `Url` field). URL-backed rules flow through existing `ruleRecommender.Recommend()` unchanged and are converted to `V1Recommendation` by the handler. This kept `internal/recommender/rules.go` and `types.go` untouched.
- **Deduplication key scheme:** URL-backed recs use `"url:"+url`; package-backed recs use `"pkg:"+packageId`. Prevents empty-string collisions.
- **Empty-match detection** uses `isEmptyMatchExpr` (marshal-to-`"{}"` approach) to handle future `MatchExpr` field additions automatically.
- **Navigation enrichment is partially delivered.** `recommends`, `suggests`, `depends` are carried through from repository.json. Path membership (`memberOf`) is deferred to Phase 5.

**V1 response contract (from `openapi.yaml`):**

Package-backed items (`type === "package"`):

```json
{
  "type": "package",
  "title": "Grafana Alerting 101",
  "description": "Hands-on guide...",
  "source": "package",
  "matchAccuracy": 1.0,
  "matchedCriteria": ["urlPrefixIn:/alerting"],
  "packageId": "alerting-101",
  "contentUrl": "https://interactive-learning.grafana.net/packages/alerting-101/content.json",
  "manifestUrl": "https://interactive-learning.grafana.net/packages/alerting-101/manifest.json",
  "repository": "interactive-tutorials",
  "packageType": "guide",
  "category": "general",
  "author": { "name": "...", "team": "interactive-learning" },
  "startingLocation": "/alerting",
  "navigation": { "recommends": [...], "suggests": [...], "depends": [...] }
}
```

URL-backed items (`type !== "package"`): unchanged from legacy — `url` field present, no package fields.

#### Phase 4b: Content migration (interactive-tutorials) ✅

**Status:** Complete — full migration (not just a pilot). The live repository at `https://interactive-learning.grafana.net/packages/repository.json` contains **31 packages**.

**Repo:** [`interactive-tutorials`](https://github.com/grafana/interactive-tutorials)
**Testing:** Layer 1 (validation passes in that repo's CI)

**What was delivered:**

- [x] **31 packages migrated** with `content.json` + `manifest.json` in package directories, including:
  - 20+ standalone guides (alerting-101, explore-drilldowns-101, first-dashboard, logql-101, irm-configuration, k8s-cpu, k8s-mem, rca-demo, sm-setting-up-your-first-check, tour-of-visualizations, and more)
  - 1 learning path: `prometheus-lj` (path metapackage + 9 step guides with `depends`/`recommends` chains)
  - Each manifest includes: `type`, `description`, `category`, `author`, `startingLocation`, dependency fields, `targeting` with match expressions, `testEnvironment`
- [x] CI pipeline: `validate --packages`, `build-repository`, `build-graph` in `validate-json.yml`
- [x] `repository.json` is CI-generated, never committed. Published to CDN on every push.
- [x] Dual CDN paths operational: `guides/` (legacy) + `packages/` (new, with `repository.json` co-located)
- [x] CDN verified live: `https://interactive-learning.grafana.net/packages/repository.json` returns 31 entries with correct metadata
- [x] Migration skill (`.cursor/skills/migrate-guide/SKILL.md`) used for mechanical scale-out

**Key decisions from the migration:**

- **Dual CDN paths, not a cutover.** The `guides/` deploy (driven by `index.json`) continues unchanged. The `packages/` deploy is a parallel step.
- **`packages/` is a full directory tree copy** (all files, not just JSON) — packages may include non-JSON assets referenced by relative path.
- **Coexistence with `index.json`:** `index.json` continues to serve as the recommendation rules source for the legacy `POST /recommend` endpoint. Once the recommender's `POST /api/v1/recommend` is deployed and the frontend migrates to it (Phase 4d), virtual rules from `repository.json` targeting replace `index.json` rules.

**Remaining future work (not blocking):**

- `index.json` retirement: once the frontend migrates to `/api/v1/recommend` and virtual rules from `repository.json` targeting cover all `index.json` rules, `index.json` becomes redundant.
- CI enforcement: require `manifest.json` for every `content.json` (gated on confirmation that all guides have been migrated).
- Legacy deploy cleanup: remove `guides/` CDN path once all traffic moves to `packages/`.

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

#### Phase 4d: Frontend remote resolver and v1 recommend migration

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2
**Depends on:** 4a (backend routes must be deployed)
**Status:** Not started — **this is the critical path** once the recommender PR merges

Two integration points with the recommender's versioned API:

1. **Recommendation flow** (primary discovery path): migrate from `POST /recommend` to `POST /api/v1/recommend`. The v1 response contains both package-backed and URL-backed recommendations. Package-backed items (`type === "package"`) carry `contentUrl`, `manifestUrl`, `packageId`, `repository`, `packageType`, `category`, `author`, `startingLocation`, `milestones`, and `navigation`. The frontend discriminates on `type` to determine rendering behavior — no separate resolution call is needed for contextually recommended packages.

2. **Direct resolution flow** (by-ID loading): `RecommenderPackageResolver` calls `GET /api/v1/packages/{id}` for deep links, `milestones` navigation, or any case where the frontend needs a specific package by bare ID outside the recommendation flow.

Both flows are composed with the existing `BundledPackageResolver` for offline/OSS fallback.

##### Step 1: V1 response types at Tier 0

Define TypeScript types matching the recommender's OpenAPI `V1Recommendation` and `V1RecommenderResponse` schemas. These go in `src/types/` at Tier 0 for broad importability.

- [ ] **`V1Recommendation` interface** — discriminated union on `type`:
  - Common fields: `type`, `title`, `description?`, `source?`, `matchAccuracy?`, `matchedCriteria?`, `missingCriteria?`
  - URL-backed fields (when `type !== "package"`): `url`
  - Package-backed fields (when `type === "package"`): `packageId`, `contentUrl`, `manifestUrl`, `repository`, `packageType?`, `category?`, `author?: { name?: string; team?: string }`, `startingLocation?`, `milestones?: string[]`, `navigation?: PackageNavigation`
- [ ] **`PackageNavigation` interface**: `recommends?: string[]`, `suggests?: string[]`, `depends?: string[]`
  - `memberOf` is **not** in this phase — it arrives in Phase 5
- [ ] **`V1RecommenderResponse` interface**: `recommendations: V1Recommendation[]`, `featured?: V1Recommendation[]`
- [ ] **Type guard**: `isPackageRecommendation(rec: V1Recommendation): rec is V1Recommendation & { packageId: string }` — discriminates on `type === "package"`
- [ ] Export from `src/types/index.ts`

**Design note on `Recommendation` evolution:** The existing `Recommendation` interface in `src/types/context.types.ts` has `url: string` as a required field and an index signature (`[key: string]: any`). Rather than widening this legacy type (which would require auditing all consumers), the v1 migration introduces `V1Recommendation` as a parallel type. The `ContextService.getExternalRecommendations()` method will normalize v1 responses into the existing `Recommendation` shape for URL-backed items and a new package-aware shape for package-backed items. Full `Recommendation` type evolution (removing the index signature, making `url` optional) is a Phase 10 cleanup candidate.

##### Step 2: Migrate `getExternalRecommendations()` to v1 endpoint

The migration point is in `src/context-engine/context.service.ts`, method `getExternalRecommendations()`:

- [ ] **Change endpoint URL** from `${configWithDefaults.recommenderServiceUrl}/recommend` to `${configWithDefaults.recommenderServiceUrl}/api/v1/recommend`
  - Same `ContextPayload` request body — the v1 endpoint accepts the identical `RecommendationContext` schema
  - Same `AbortController` timeout pattern
- [ ] **Parse response as `V1RecommenderResponse`** instead of `RecommenderResponse`
- [ ] **Update `sanitizeRecommendation` allowlist** to include new v1 fields: `packageId`, `contentUrl`, `manifestUrl`, `repository`, `packageType`, `category`, `author`, `startingLocation`, `milestones`, `navigation`
  - Current sanitization (line ~502 in `context.service.ts`) uses an explicit allowlist to prevent prototype pollution — all new fields must be enumerated
- [ ] **Discriminate response items by type:**
  - `type === "package"` → construct a package-aware recommendation with `contentUrl`/`manifestUrl` for content fetching, pass through metadata fields
  - Any other `type` → existing behavior (URL-backed, `url` field used as link)
- [ ] **Pass through `navigation`** when present (carries `recommends`, `suggests`, `depends` from Phase 4a; `memberOf` added in Phase 5)
- [ ] **Merge with bundled interactive recommendations** — existing `getBundledInteractiveRecommendations()` continues to provide offline/local recommendations; v1 package-backed items from the recommender are merged alongside them with appropriate deduplication (same `packageId` or matching `title`)

##### Step 3: `RecommenderPackageResolver`

Implements `PackageResolver` for by-ID loading via the recommender's `GET /api/v1/packages/{id}` endpoint.

- [ ] **`RecommenderPackageResolver`** in `src/package-engine/recommender-resolver.ts`:
  - [ ] Constructor accepts `recommenderBaseUrl: string` (from `configWithDefaults.recommenderServiceUrl`)
  - [ ] `resolve(packageId, options?)` calls `GET ${baseUrl}/api/v1/packages/${encodeURIComponent(packageId)}`
  - [ ] On `200`: parse `PackageResolutionResponse` (`id`, `contentUrl`, `manifestUrl`, `repository`), return `PackageResolutionSuccess`
  - [ ] On `404`: parse `PackageResolutionError` (`{"error": "package not found", "code": "not-found"}`), return failure with `code: 'not-found'`
  - [ ] On `400`: parse `PackageResolutionError` (`{"error": "invalid package id", "code": "bad-request"}`), map to `code: 'not-found'` (invalid IDs don't exist)
  - [ ] On network error: return failure with `code: 'network-error'`
  - [ ] When `options?.loadContent` is true: fetch `contentUrl` and `manifestUrl` from CDN directly, parse and populate `content` and `manifest` on the resolution result
  - [ ] URL construction uses `new URL()` (F3 security rule)

##### Step 4: `CompositePackageResolver`

- [ ] **`createCompositeResolver(pluginConfig)`** factory in `src/package-engine/composite-resolver.ts`:
  - [ ] Always includes `BundledPackageResolver` (baseline content, works offline/OSS)
  - [ ] Conditionally includes `RecommenderPackageResolver` only when `isRecommenderEnabled(pluginConfig)` is true
  - [ ] Resolution order: bundled first, recommender second. Bundled content always wins for packages that exist locally.
  - [ ] Same `PackageResolver` interface — callers don't know which tier resolved
- [ ] Export from `src/package-engine/index.ts` barrel

##### Step 5: Tests

- [ ] Layer 2 tests for `RecommenderPackageResolver`: successful resolution, 404 handling, 400 handling, network error, CDN content loading
- [ ] Layer 2 tests for `CompositePackageResolver`: bundled-first ordering, fallback to recommender, recommender-disabled behavior, bundled-miss-recommender-hit
- [ ] Layer 2 tests for v1 response handling in context service: package-backed discrimination, URL-backed passthrough, mixed results, sanitization of new fields, navigation passthrough, deduplication with bundled items

**Key design decisions:**

- The composite resolver preserves the single `PackageResolver` interface — consumers don't change. Bundled content always wins for packages that exist locally, providing offline/OSS baseline support.
- **Recommender gated by plugin setting.** No circuit-breaker is needed: `isRecommenderEnabled(pluginConfig)` is the gate.
- The frontend never fetches or stores repository indexes — all multi-repo resolution logic lives in the recommender.
- **Navigation passthrough.** Both the v1 recommend handler and the `RecommenderPackageResolver` pass through `navigation` when present. In Phase 4d, `navigation` carries `recommends`/`suggests`/`depends` from the recommender (already implemented in 4a). Phase 5 adds `memberOf`. The frontend does not render navigation in Phase 4d — it passes the data through so Phase 4g/5 can consume it.

#### Phase 4e: Integration verification

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2 + Layer 3
**Depends on:** 4b (pilot guides exist and are published) + 4d (frontend resolver works)

End-to-end verification that the plugin correctly loads and renders `content.json` from both bundled and remote sources through the composite resolver and backend routes.

- [ ] **Recommender resolution verification:** Configure the recommender with `PACKAGE_REPOSITORY_URLS=interactive-tutorials|https://interactive-learning.grafana.net/packages/repository.json`. Verify:
  - [ ] `GET /api/v1/packages/alerting-101` returns 200 with correct CDN URLs under `packages/` path
  - [ ] `GET /api/v1/packages/prometheus-lj` returns 200 (path metapackage)
  - [ ] `GET /api/v1/packages/nonexistent` returns 404 with structured error
- [ ] **V1 recommend verification:** Send `POST /api/v1/recommend` with user context matching pilot guide targeting:
  - [ ] Verify `alerting-101` appears as a package-backed recommendation (with `contentUrl`, `manifestUrl`) when user context includes `/alerting` URL prefix
  - [ ] Verify URL-backed recommendations (from existing rules) coexist in the response
- [ ] **Composite resolver verification:** Verify the composite resolver correctly falls through from bundled (miss) to recommender (hit) for remote-only packages
- [ ] **Rendering parity:** Verify rendered output matches between bundled and remote loading of the same guide
- [ ] **Schema validation:** Verify `validate --packages` passes against the pilot migration output
- [ ] Update this document with Phase 4 completion notes and key decisions

#### Phase 4f: Path migration tooling ⏸️

**Status:** Demoted to optional — the full content migration (Phase 4b) was completed without this tooling. The migration skill in `interactive-tutorials` and manual agent work proved sufficient.

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 1

This phase originally proposed a `migrate-paths` CLI command to read `journeys.yaml` and generate draft `manifest.json` files for `*-lj` directories. The `prometheus-lj` path was migrated directly using the migration skill, and additional `*-lj` directories referenced in the live repository (`drilldown-metrics-lj`, `private-data-source-connect-lj`) can be migrated the same way when their content is ready.

**When to revisit:** If a large batch of learning paths needs migration simultaneously and the migration skill proves too slow for the volume. Otherwise, this tooling adds maintenance burden without clear payoff.

#### Phase 4g: Docs-retrieval integration

**Repo:** `grafana-pathfinder-app`
**Testing:** Layer 2
**Depends on:** 4e (composite resolver verified end-to-end)

Wire the composite `PackageResolver` into the `docs-retrieval` fetch pipeline so that `docs-retrieval` becomes the single entry point for all content fetching — both static documentation and interactive packages. This resolves the "intentional transitional duplication" from Phase 3 and establishes the fetch architecture that Phase 5's navigation enrichment depends on.

**Scope refinement (post-4a).** The recommender's v1 response already carries full package metadata (`packageType`, `category`, `author`, `startingLocation`, `milestones`, `navigation`) inline. This means the docs-retrieval integration is specifically about _rendering_ package content after the recommendation flow delivers it — not about fetching metadata separately. The metadata is available from the moment a v1 recommendation is received. Phase 4g wires the content fetch (from `contentUrl`/`manifestUrl`) into the existing renderer, and ensures the v1 metadata fields propagate through to the UI components that need them.

**Architecture decision: docs-retrieval dispatches by content type.** The dispatch signal already exists: the `Recommendation` interface carries a `type` field, and with Phase 4d's v1 migration, package-backed items have `type === "package"`. Phase 4g wires this discriminator to route package content through the `PackageResolver` for rendering. Additionally, v1 package-backed recommendations arrive with `contentUrl`/`manifestUrl` pre-resolved — the primary fetch path uses these URLs directly rather than requiring a separate `resolve()` call. The `CompositePackageResolver.resolve()` path is used for secondary loading (deep links, milestone navigation, step expansion).

- **Static documentation / URL-backed recommendations:** fetched via the existing `docs-retrieval` pipeline, unchanged
- **Package-backed recommendations:** content fetched from `contentUrl` CDN URL (pre-resolved in the v1 response), rendered through the existing content renderer

The composite resolver is injected into `docs-retrieval` via dependency inversion. Both `docs-retrieval` and `package-engine` are Tier 2 engines (laterally isolated). The `PackageResolver` interface is at Tier 0. Concrete wiring happens at Tier 3+ (`integrations/`).

- [ ] **Content-type dispatch in `docs-retrieval`:**
  - [ ] Add a code path that identifies package-backed content (from v1 response `type === "package"`) vs. static documentation
  - [ ] For package-backed content: fetch from pre-resolved `contentUrl` CDN URL, pass through `navigation` and metadata for UI consumption
  - [ ] For by-ID loading (deep links, milestone steps): delegate to the injected `CompositePackageResolver`
  - [ ] Static documentation continues through the existing fetch path unchanged
- [ ] **Dependency injection of `PackageResolver`:**
  - [ ] `docs-retrieval` accepts a `PackageResolver` (Tier 0 interface) — it does not import from `package-engine` (Tier 2)
  - [ ] Tier 3+ wiring code creates the `CompositePackageResolver` (bundled-first, recommender-fallback) and passes it into docs-retrieval's fetch pipeline
- [ ] **Remove transitional duplication:**
  - [ ] Identify and remove any content-loading code in `package-engine` that duplicated `docs-retrieval` logic (noted as "intentional transitional duplication" in Phase 3)
  - [ ] Verify that the bundled loader and recommender resolver paths both produce content that the existing renderer can consume without changes
- [ ] **Surface navigation and metadata to UI:**
  - [ ] Pass through `navigation` (recommends/suggests/depends) from v1 response to the content display components
  - [ ] Pass through package metadata (`category`, `author`, `startingLocation`) for richer UI cards
  - [ ] `milestones` on path-type packages available for path progress display (full rendering deferred to Phase 5)
- [ ] Layer 2 tests: content-type dispatch routing, pre-resolved CDN URL fetch, by-ID fallback to composite resolver, static docs bypass, navigation passthrough, metadata passthrough

**Why here:** Phase 4e proves the composite resolver works end-to-end. Phase 4g connects it to the rendering pipeline so that resolved content actually reaches the user. This must land before Phase 5 because Phase 5 extends navigation with `memberOf` path membership — that data has no path to the UI unless the renderer is consuming content through the package resolver and passing navigation through to display components.

### Phase 5: Path and journey integration

**Decomposition note:** This phase has significant breadth (recommender `memberOf` enrichment, frontend navigation UI, path progress, migration/deprecation) and should be decomposed into sub-phases before execution, in light of decisions made during Phase 4. Defer decomposition until Phase 4 is complete.

**Goal:** Paths and journeys are working metapackage types with full navigation support. The recommender computes `memberOf` (path membership) so the frontend can render path progress and "next step" navigation without client-side graph reasoning.

**Testing layers:** Layer 1 + Layer 2

**What Phase 4 already delivered toward this goal:**

- **Path metapackages validated in production.** The `interactive-tutorials` repository (Phase 4b) contains `prometheus-lj` — a real `type: "path"` metapackage with a 9-entry `milestones` array, path-level cover page, and step-level `depends`/`recommends` chains. The CLI validates `milestones` references, dependency graph representation, and cycle detection.
- **`recommends`/`suggests`/`depends` navigation already flows.** Phase 4a's v1 response carries `navigation: { recommends, suggests, depends }` from repository.json metadata. Phase 4d passes this through to the frontend. Phase 4g surfaces it to UI components. By the time Phase 5 begins, basic navigation links ("recommended next", "related content", "prerequisites") are already functional.
- **`milestones` array available in v1 response.** For `type: "path"` packages, the v1 response includes `milestones: string[]` at the top level of the recommendation item. The frontend has the structural data for path progress display; Phase 5 adds the semantic `memberOf` enrichment that tells a _step guide_ which paths it belongs to.

**What Phase 5 adds — narrowed scope:**

The remaining work is specifically about `memberOf` path membership enrichment and the frontend UI that consumes it. `recommends`/`suggests`/`depends` are already flowing.

**Navigation enrichment design:** See `docs/design/V1-RECOMMEND.md` Phase 5 in `grafana-recommender` for the `computeNavigation` implementation design. The `navigation` field is extended with `memberOf`:

```json
{
  "navigation": {
    "memberOf": [
      {
        "id": "getting-started",
        "title": "Getting started with Grafana",
        "milestones": ["welcome-to-grafana", "prometheus-grafana-101", "first-dashboard", "loki-grafana-101"]
      }
    ],
    "recommends": ["loki-grafana-101", "prometheus-advanced-queries"],
    "suggests": ["explore-drilldowns-101"],
    "depends": []
  }
}
```

- `memberOf`: which paths/journeys this package participates in. Each entry carries the parent's `id`, `title`, and full `milestones` array. The frontend derives position, total, next structural milestone, and completion-aware next (first incomplete milestone) locally. This avoids baking structural navigation decisions into the recommender response.
- `recommends`/`suggests`/`depends`: **already flowing from Phase 4a** — Phase 5 does not change these.

**Completion state phasing:** In Phase 5, the recommender computes `navigation` from structural graph data only. The frontend overlays client-side completion state. Server-side completion state is a future concern beyond this plan's scope.

**Deliverables:**

- [ ] **Recommender `memberOf` enrichment** (in `grafana-recommender`):
  - [ ] Implement `computeMemberOf(packageID, repos)` — scan all `type: "path"` and `type: "journey"` entries whose `milestones` arrays contain this package ID
  - [ ] Each `memberOf` entry includes the parent's `id`, `title`, and full `milestones` array
  - [ ] Add `memberOf` to the `PackageNavigation` type in the OpenAPI spec
  - [ ] Extend both `GET /api/v1/packages/{id}` and `POST /api/v1/recommend` responses
  - [ ] Go unit tests: single-path membership, multi-path membership, cross-repository membership, packages with no parent metapackage
- [ ] **Frontend `memberOf` type extension:**
  - [ ] Extend `PackageNavigation` in `src/types/` with `memberOf?: Array<{ id: string; title: string; milestones: string[] }>`
- [ ] **Journey metapackages** (`type: "journey"`):
  - [ ] CLI: validate journey packages — `milestones` array entries resolve to existing packages (typically paths, but any package type is valid)
  - [ ] Journey-level `content.json` serves as a cover page (optional)
  - [ ] Pilot: compose 1-2 journeys from existing paths to validate two-level composition
- [ ] **Frontend navigation display** (in `grafana-pathfinder-app`):
  - [ ] UI: display path/journey progress computed from `memberOf[].milestones` and local completion state (position, total, completed count)
  - [ ] UI: "next step" navigation computed locally — next incomplete step from `memberOf[].milestones` using completion data, not structural array order
  - [ ] UI: path context selection — when multiple `memberOf` entries exist, select which path to display based on navigation context (e.g., which path the user arrived from), defaulting to the first entry
  - [ ] UI: recommended content links using `navigation.recommends` and `navigation.suggests` (data already flowing from Phase 4d/4g; Phase 5 adds the UI rendering)
  - [ ] UI: learning path cards use package metadata (description, category) from the v1 response
  - [ ] Frontend overlays client-side completion state on the structural navigation for display
- [ ] **`paths.json` deprecation path:** With navigation provided by the recommender's resolution response, curated `paths.json` becomes redundant once all paths are expressed as metapackages with `milestones` arrays. During transition, `paths.json` continues to serve as the fallback for paths not yet migrated to metapackages.
- [ ] Align with docs partners' YAML format for learning path relationships
- [ ] Layer 2 unit tests for frontend navigation display logic (progress computation from `memberOf[].milestones`, completion-aware next milestone, path context selection, `recommends`/`suggests` rendering)

**Why sixth:** First user-visible payoff of the package model. The `memberOf` enrichment completes the navigation picture — users see where they are in a learning path, what's next, and what's related. Content authors and docs partners see dependency declarations reflected in the learning experience. The recommender's enriched resolution response eliminates the need for client-side graph reasoning, keeping the frontend thin.

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
  - [ ] Recommender endpoints evolve to return bare package IDs alongside URLs (the frontend can resolve bare IDs via the `GET /api/v1/packages/{id}` resolution route from Phase 4a)
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

| Phase                                         | Status      | Unlocks                                                                                                                                                       | Testing layers     |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 0: Schema foundation                          | ✅          | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema                                                                                 | Layer 1            |
| 1: CLI package validation                     | ✅          | CI validation, cross-file checks, dependency graph                                                                                                            | Layer 1            |
| 2: Bundled repository migration               | ✅          | End-to-end proof on local corpus, bundled `repository.json`                                                                                                   | Layer 1 + Layer 2  |
| 3: Plugin runtime resolution                  | ✅          | PackageResolver consuming bundled repo, local resolution tier                                                                                                 | Layer 2            |
| 3b: Package authoring documentation           | ✅          | Practitioner docs for package format and CLI commands                                                                                                         | —                  |
| 4a: Backend resolution + v1 recommend routes  | ✅ (PR)     | Recommender resolves bare IDs via `GET /api/v1/packages/{id}`, surfaces packages via `POST /api/v1/recommend` with virtual rules, full metadata carry-through | Go tests + Layer 2 |
| 4b: Content migration (interactive-tutorials) | ✅          | 31 packages live on CDN, CI-generated `repository.json`, dual CDN paths, migration skill                                                                      | Layer 1            |
| 4c: E2E manifest pre-flight                   | —           | Manifest-aware e2e pre-flight checks (tier, minVersion, plugins)                                                                                              | Layer 3            |
| 4d: Frontend remote resolver + v1 migration   | **Next**    | V1 response types, `RecommenderPackageResolver`, `CompositePackageResolver`, `POST /api/v1/recommend` migration                                               | Layer 2            |
| 4e: Integration verification                  | —           | Full pipeline verified across bundled and remote sources                                                                                                      | Layer 2 + Layer 3  |
| 4f: Path migration tooling                    | ⏸️ Optional | `migrate-paths` CLI — demoted; migration completed without tooling                                                                                            | Layer 1            |
| 4g: Docs-retrieval integration                | —           | Package resolver wired into rendering pipeline, content-type dispatch, metadata + navigation passthrough                                                      | Layer 2            |
| 5: Path and journey integration               | —           | `memberOf` path membership enrichment, frontend path progress UI, journey metapackages, `paths.json` deprecation                                              | Layer 1 + Layer 2  |
| 6: Layer 4 test environment routing           | —           | Managed environment routing, version matrix, dataset provisioning                                                                                             | Layer 4            |
| 7: Dynamic repository registry                | —           | Dynamic registry, webhook refresh, ecosystem scale (multi-tenancy deferred)                                                                                   | —                  |
| 8: SCORM foundation                           | —           | SCORM import readiness, extends `type` with course/module                                                                                                     | —                  |
| 9+: SCORM import pipeline                     | —           | Full SCORM conversion pipeline                                                                                                                                | —                  |
| 10: Implementation cleanup                    | —           | Dead code removal, duplication consolidation, spec-implementation alignment                                                                                   | —                  |
