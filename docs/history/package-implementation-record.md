# Package implementation record

This document is the historical record of the Pathfinder package design implementation epic ([#622](https://github.com/grafana/grafana-pathfinder-app/issues/622)). It captures the complete phased execution: key decisions made, artifacts produced, and the rationale recorded at each stage. The implementation is complete as of April 2026.

**Living documents:** The canonical design spec remains at [`docs/design/PATHFINDER-PACKAGE-DESIGN.md`](../design/PATHFINDER-PACKAGE-DESIGN.md). Remaining future work is tracked as GitHub issues [#750](https://github.com/grafana/grafana-pathfinder-app/issues/750), [#751](https://github.com/grafana/grafana-pathfinder-app/issues/751), and [#752](https://github.com/grafana/grafana-pathfinder-app/issues/752).

---

## Cross-repo implementation plans

This epic spanned three repositories. Each had its own detailed implementation documents subordinate to this plan but authoritative for repo-internal decisions.

| External repo                                                               | Document                                                                                                                                                               | Covers                                                                                                                                                                                                                      | Aligns with phase | Status   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------- |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/RESOLUTION.md`                                                                                                                                            | Resolution endpoint implementation: types, repository loading, HTTP handler, periodic reload scheduler, tests, docs/deploy                                                                                                  | 4a                | Complete |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/V1-RECOMMEND.md`                                                                                                                                          | Package-aware `POST /api/v1/recommend`: virtual rule construction from targeting, mixed URL+package results, navigation enrichment                                                                                          | 4a                | Complete |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `docs/design/API-VERSIONING.md`                                                                                                                                        | `/api/v1/` routing convention, legacy `/recommend` coexistence, deprecation strategy (RFC 8594)                                                                                                                             | 4a, 4d            | Complete |
| [`grafana-recommender`](https://github.com/grafana/grafana-recommender)     | `openapi.yaml` on [`feat/package-resolution`](https://github.com/grafana/grafana-recommender/pull/158)                                                                 | OpenAPI 3.0 spec for all endpoints including `GET /api/v1/packages/{id}` and `POST /api/v1/recommend`                                                                                                                       | 4a, 4d            | Complete |
| [`interactive-tutorials`](https://github.com/grafana/interactive-tutorials) | `docs/history/migration-record.md` (consolidated from MIGRATION.md, MASS-MIGRATION-PLAN.md, DEDUPLICATION.md, POST-BATCH-VALIDATION-REPORT.md after project completed) | Full batch migration of 62 packages; CI enforcement (`manifest.json` required for every `content.json`); `index.json` frozen; all learning-journey static rules removed from `grafana-recommender` (deduplication complete) | 4b                | Complete |

---

## Canonical URLs

| Resource                  | URL                                                                                     | Notes                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Package repository (live) | `https://interactive-learning.grafana.net/packages/repository.json`                     | 288+ packages, CI-generated on every push (batch migration complete) |
| Recommender (production)  | `https://recommender.grafana.com`                                                       | Configured via `recommenderServiceUrl` plugin setting                |
| Recommender v1 recommend  | `POST {recommenderBaseUrl}/api/v1/recommend`                                            | Package-aware recommendations                                        |
| Recommender v1 packages   | `GET {recommenderBaseUrl}/api/v1/packages/{id}`                                         | Bare ID → CDN URL resolution                                         |
| Recommender OpenAPI spec  | [`openapi.yaml`](https://github.com/grafana/grafana-recommender/blob/main/openapi.yaml) | Private repo — use `gh` CLI. Source of truth for v1 types.           |
| CDN content base          | `https://interactive-learning.grafana.net/packages/`                                    | Package directories co-located with repository.json                  |
| Legacy recommend endpoint | `POST {recommenderBaseUrl}/recommend`                                                   | URL-backed only; deprecation per RFC 8594                            |

---

## Tier model

The codebase enforces a layered tier model via ratchet tests (`src/validation/architecture.test.ts`) and ESLint `no-restricted-imports` rules (`eslint.config.mjs`). Files in tier N may only import from tier N or lower. Tier 2 engines are laterally isolated — they cannot import from other Tier 2 engines.

| Tier | Directories                                                                                                                | Role                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 0    | `types/`, `constants/`                                                                                                     | Foundational types and configuration |
| 1    | `lib/`, `security/`, `styles/`, `global-state/`, `utils/`, `validation/`                                                   | Shared utilities and validation      |
| 2    | `context-engine/`, `docs-retrieval/`, `interactive-engine/`, `requirements-manager/`, `learning-paths/`, `package-engine/` | Domain engines (laterally isolated)  |
| 3    | `integrations/`                                                                                                            | Cross-engine orchestration           |
| 4    | `components/`, `pages/`                                                                                                    | Presentation layer                   |
| —    | `cli/`, `bundled-interactives/`, `test-utils/`, `img/`, `locales/`                                                         | Excluded from tier enforcement       |

**Key decisions recorded during this epic:**

- **Schemas at Tier 0.** All Zod schemas (`ContentJsonSchema`, `ManifestJsonSchema`, `DependencyClauseSchema`, `RepositoryJsonSchema`, etc.) and shared type definitions (`GraphNode`, `GraphEdge`, `DependencyGraph`) live in `src/types/` so they are importable by CLI, runtime engines, validation, and UI code.
- **Validation at Tier 1.** Content validation functions (`validateGuide()`, `validatePackage()`, `validateManifest()`) live in `src/validation/` at Tier 1. This eliminates the existing lateral violations from `docs-retrieval → validation` and prevents new ones from `package-engine → validation`. The `validation/` directory was moved from Tier 2 to Tier 1 because its production code depends only on Tier 0.
- **Package engine at Tier 2.** The `PackageResolver`, package loader, dependency resolver, and static catalog fetcher live together in `src/package-engine/` as a new Tier 2 engine with its own barrel export (`index.ts`). Lateral isolation means it cannot import from `docs-retrieval`, `learning-paths`, `context-engine`, or other Tier 2 engines.
- **Graph types at Tier 0, graph builder in CLI.** `GraphNode` and `GraphEdge` type definitions live in `src/types/` for broad importability. The graph construction logic (`build-graph` command) lives in `src/cli/` (excluded from tier enforcement).
- **Completion state is a consumer concern.** The package engine provides structural dependency resolution but does not check completion state. Determining whether dependencies are satisfied requires completion data from `learning-paths` — callers at Tier 3+ combine both. This avoids a lateral coupling between `package-engine` and `learning-paths`.
- **Open-world directory semantics.** Repository package discovery uses the `manifest.json`-presence heuristic: any subdirectory at any depth is a package candidate if and only if it contains `manifest.json`. Discovery skips `assets/` subtrees and ignores unknown files/directories elsewhere.

### Dual registration

Every new `src/` directory must be registered in **both** `TIER_MAP` in `src/validation/import-graph.ts` and the tier constants in `eslint.config.mjs`. The tier map completeness ratchet test will fail if a directory is missing. The ESLint config mirrors the tier map for editor-time feedback.

### Barrel export discipline

Every Tier 2 engine must have an `index.ts` barrel. External consumers must import through the barrel — the ratchet test enforces this.

### Strict indexed access

`noUncheckedIndexedAccess` is enabled. All indexed lookups return `T | undefined`. Code must handle the `undefined` case explicitly.

---

## Testing strategy

The testing layers referenced throughout this record:

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
| 4a: Backend resolution + v1 recommend routes  | Go tests + Layer 2 | ✅          |
| 4b: Content migration (interactive-tutorials) | Layer 1            | ✅          |
| 4c: E2E manifest pre-flight                   | Layer 3            | ✅          |
| 4d1: Frontend remote resolver + v1 groundwork | Layer 2            | ✅          |
| 4d2: Endpoint switch and v1 activation        | Layer 2            | ✅          |
| 4e: Integration verification                  | Layer 2 + Layer 3  | ✅          |
| 4f: Path migration tooling                    | Layer 1            | ⏸️ Optional |
| 4g: Docs-retrieval integration                | Layer 2            | ✅          |
| 8: Implementation cleanup                     | —                  | ✅          |

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
- `RepositoryEntry` extended to denormalize `author`, `targeting`, and `testEnvironment` from manifests — closes the gap between the design spec's "denormalized manifest metadata" intent and the Phase 2 implementation. `author` added to `PackageMetadataFields` (shared with `GraphNode`); `targeting` and `testEnvironment` added to `RepositoryEntry` only (operational concerns, not graph visualization). `build-repository` and `build-graph` updated to propagate the new fields.
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
- **Package loader** in `src/package-engine/loader.ts`: `loadBundledContent()`, `loadBundledManifest()` — all return `LoadOutcome<T>` discriminated union reusing `ResolutionError` codes; manifest loading uses `.loose()` (Zod v4 replacement for `.passthrough()`) to tolerate extension metadata; content loading self-contained within package engine (no import from `docs-retrieval`, intentional transitional duplication)
- **Barrel export** (`src/package-engine/index.ts`): resolver class + factory, loader functions + types, dependency query functions + types
- Bundled content URLs use `bundled:` scheme (e.g., `bundled:first-dashboard/content.json`) consistent with existing `bundled:` prefix convention in `docs-retrieval`
- Manifest loading is optional — resolver returns `manifest: undefined` when manifest fails to load, success when only content loads
- 72 Layer 2 tests across 3 test files: `resolver.test.ts`, `loader.test.ts`, `dependency-resolver.test.ts`

### Phase 3b: Package authoring documentation ✅

**Status:** Complete

**Key decisions and artifacts:**

- Package authoring guide published at `docs/developer/package-authoring.md`: field reference for `content.json` and `manifest.json`, dependency quick reference (AND/OR syntax, `provides`, `conflicts`, `replaces`), targeting and `testEnvironment` sections, copy-paste templates, worked example converting a bare guide to a package directory
- CLI tools updated in `docs/developer/CLI_TOOLS.md`: documented `validate --package`, `validate --packages`, `build-repository`, and `build-graph` commands with usage examples and CI workflow snippet
- Repository index reference included within the package authoring guide
- Authoring hub link added in `docs/developer/interactive-examples/authoring-interactive-journeys.md`

### Phase 4: Multi-repository resolution and pipeline completion

**Goal:** Extend from bundled-only resolution to multi-repository resolution via backend package routes, migrate content in `interactive-tutorials` to the package format, and wire the frontend to the recommender's v1 endpoints.

**Architecture decision: recommender-based resolution, not static catalog.** The original design proposed a static `packages-catalog.json` that aggregated all repository indexes into a single file fetched by the frontend plugin at startup. This was replaced with resolution routes on the recommender microservice for three reasons: (1) a pre-aggregated catalog suffers from freshness lag; (2) the frontend plugin holds the full catalog in memory for the session, which scales poorly as the content corpus grows; (3) the recommender already needs repository index data for targeting and dependency graph analysis anyway — adding resolution routes to the same service that already caches these indexes avoids duplicating infrastructure. The frontend's `PackageResolver` interface is unchanged — the implementation calls the recommender's resolution endpoint to get CDN URLs, then fetches content directly from CDN.

Phase 4 is decomposed into eight sub-phases, all now complete. Phase 4f was demoted to optional as the migration was completed without tooling.

```
Complete:  4a ✅, 4b ✅, 4c ✅, 4d1 ✅, 4d2 ✅, 4e ✅, 4g ✅
Optional:  4f (demoted — migration completed without tooling)
```

#### Phase 4a: Backend package resolution routes ✅

**Status:** Complete — [PR #158](https://github.com/grafana/grafana-recommender/pull/158) (`feat/package-resolution` branch). Deployed to production.

**Repo:** [`grafana-recommender`](https://github.com/grafana/grafana-recommender)

**What was delivered:**

- `GET /api/v1/packages/{id}` — bare ID resolution to CDN URLs (`cmd/recommender/packages.go`, 574 lines)
- `POST /api/v1/recommend` — package-aware recommendations with mixed URL-backed + package-backed results (`cmd/recommender/v1recommend.go`, 463 lines)
- Repository index management via `PACKAGE_REPOSITORY_URLS` env var (comma-separated `name|url` pairs)
- Shared periodic reload scheduler (`internal/reload/scheduler.go`): single-flight execution, trigger coalescing, bounded jitter (20%), configurable via `CONFIGS_RELOAD_INTERVAL_MINUTES`
- Virtual rule construction from `targeting.match` metadata in repository indexes
- Full metadata carry-through to v1 response via `manifest`: `type`, `category`, `author`, `startingLocation`, `milestones`, `recommends`, `suggests`, `depends`
- Featured recommendation support for packages (`type: "package"` in `featured.json`)
- OpenAPI 3.0 spec (`openapi.yaml`) with complete `V1Recommendation`, `PackageNavigation`, `PackageResolutionResponse`, `PackageResolutionError` schemas
- Prometheus metrics: `recommender_package_loading_errors_total`, `recommender_v1_package_resolutions_total`
- Go unit tests (1556 lines in `packages_test.go`, 946 lines in `v1recommend_test.go`) + E2E tests + load tests

**Key design decisions:**

- **Resolution response, not proxy or redirect.** `Cache-Control: public, max-age=<TTL>` on success (configurable via `PACKAGE_REPOSITORY_CACHE_TTL`, default `300`); `Cache-Control: no-cache` on 404.
- **Scheduled reload does NOT call `configureRecommenders`.** Avoids latent goroutine leak from GCSCohortMapper recreation.
- **V1 types are standalone in `cmd/recommender/`**, not extensions of `internal/recommender/` types. `V1Rule` is package-only (no `Url` field). URL-backed rules flow through existing `ruleRecommender.Recommend()` unchanged.
- **Deduplication key scheme:** URL-backed recs use `"url:"+url`; package-backed recs use `"pkg:"+packageId`. Prevents empty-string collisions.
- **Empty-match detection** uses `isEmptyMatchExpr` (marshal-to-`"{}"` approach) to handle future `MatchExpr` field additions automatically.
- **Navigation enrichment partially delivered.** `recommends`, `suggests`, `depends` are carried through. Path membership (`memberOf`) was not implemented.

**V1 response contract — package-backed items (`type === "package"`):**

```json
{
  "type": "package",
  "title": "Grafana Alerting 101",
  "description": "Hands-on guide: Learn how to create and test alerts in Grafana.",
  "source": "package",
  "matchAccuracy": 1.0,
  "matchedCriteria": ["urlPrefixIn:/alerting"],
  "contentUrl": "https://interactive-learning.grafana.net/packages/alerting-101/content.json",
  "manifestUrl": "https://interactive-learning.grafana.net/packages/alerting-101/manifest.json",
  "repository": "interactive-tutorials",
  "manifest": {
    "id": "alerting-101",
    "type": "guide",
    "description": "Hands-on guide: Learn how to create and test alerts in Grafana.",
    "category": "general",
    "author": { "team": "interactive-learning" },
    "startingLocation": "/alerting",
    "recommends": ["alerting-notifications"]
  }
}
```

URL-backed items: unchanged from legacy — `url` field present, no package/manifest fields.

**Note:** `contentUrl`/`manifestUrl` may be empty strings when the package ID was not found in the cached repository index at response time.

#### Phase 4b: Content migration (interactive-tutorials) ✅

**Status:** Complete — full batch migration. The live repository at `https://interactive-learning.grafana.net/packages/repository.json` contains **288+ packages** as of April 2026.

**Repo:** [`interactive-tutorials`](https://github.com/grafana/interactive-tutorials)
**Migration record:** [`docs/history/migration-record.md`](https://github.com/grafana/interactive-tutorials/blob/main/docs/history/migration-record.md)

**What was delivered:**

- 62 packages migrated in the batch (12 standalone guides, 21 learning paths, 3 special cases, plus previously migrated pilot guides); post-batch validation: 0 errors, 62 packages valid, 250 `repository.json` entries
- CI enforcement: `manifest.json` required for every `content.json` in `.github/workflows/validate-json.yml`
- `repository.json` is CI-generated, never committed. Published to CDN on every push.
- Dual CDN paths operational: `guides/` (legacy) + `packages/` (new, with `repository.json` co-located)
- Recommender deduplication complete: all `"type": "learning-journey"` static rules removed from `grafana-recommender`. `manifest.json` targeting is now the single source of truth for recommendation rules.
- `index.json` frozen: CI guard blocks changes; it serves the legacy `/recommend` endpoint only pending retirement.

**Key decisions from the migration:**

- **Dual CDN paths, not a cutover.** The `guides/` deploy (driven by `index.json`) continues unchanged.
- **`packages/` is a full directory tree copy** (all files, not just JSON) — packages may include non-JSON assets referenced by relative path.
- **`index.json` retirement trigger:** becomes redundant once the legacy `/recommend` endpoint is formally deprecated. With `index.json` now frozen and the v1 endpoint active, this is a planned future decommission.
- **Legacy deploy cleanup:** `guides/` CDN path can be removed once all traffic is confirmed on `packages/`.

#### Phase 4c: E2E manifest pre-flight ✅

**Status:** Complete
**Repo:** `grafana-pathfinder-app`

**Key decisions and artifacts:**

- `--package <dir>` flag on e2e command: loads `content.json` from the package directory. Manifest loading is optional — if `manifest.json` is absent, pre-flight is skipped entirely.
- `--tier <tier>` flag: declares the current test environment tier (default `"local"`). Used by the tier check.
- Pre-flight logic isolated in `src/cli/utils/manifest-preflight.ts` as pure functions: `checkTier`, `checkMinVersion`, `checkPlugins`, `loadManifestFromDir`, `runManifestPreflight`. No Commander dependency — fully unit-testable.
- **Tier check:** `cloud` guide against `local` environment → `skip` with exit 0. Unknown tiers pass through for forward compatibility.
- **Version check:** fetches `/api/health` to get the actual Grafana version; compares against `minVersion` using semver prefix comparison (handles pre-release suffixes like `12.2.0-pre`).
- **Plugin check:** fetches `/api/plugins` and checks each declared plugin ID. Missing plugins produce one `fail` result each; a fetch error produces a single `fail` for the entire check.
- **Tier mismatch skips immediately** — no network calls made for version or plugin checks when the tier doesn't match.
- 36 Layer 3 tests in `src/cli/__tests__/manifest-preflight.test.ts`

#### Phase 4d1: Frontend remote resolver and v1 groundwork ✅

**Status:** Complete
**Repo:** `grafana-pathfinder-app`

**Schema reconciliation note.** The Phase 4a plan text described package-backed fields as flat top-level properties on `V1Recommendation`. The actual OpenAPI spec nests package metadata under a `manifest` object (`V1PackageManifest`). The TypeScript types match the OpenAPI spec (source of truth):

- Top-level package fields: `contentUrl`, `manifestUrl`, `repository`, `manifest`
- `manifest` fields: `id`, `type`, `description?`, `category?`, `author?`, `startingLocation?`, `milestones?`, `depends?`, `recommends?`, `suggests?`, `provides?`, `conflicts?`, `replaces?`

**What was delivered:**

- `V1Recommendation`, `V1PackageManifest`, `V1RecommenderResponse`, and resolution response/error types at Tier 0
- `RecommenderPackageResolver` in `src/package-engine/recommender-resolver.ts`: calls `GET ${baseUrl}/api/v1/packages/${encodeURIComponent(packageId)}`; uses `new URL()` for construction (F4 security rule)
- `CompositePackageResolver` / `createCompositeResolver(pluginConfig)` in `src/package-engine/composite-resolver.ts`: bundled first, recommender second; recommender gated by `isRecommenderEnabled(pluginConfig)`
- Additive v1 sanitization and deduplication helpers in `ContextService`, kept off the live execution path
- Remote manifest parsing aligned with bundled-loader tolerance via `.loose()`
- Layer 2 tests for resolver behavior, composite fallback ordering, additive v1 helpers, and legacy-branch-isolation regression coverage

**Key design decisions:**

- The composite resolver preserves the single `PackageResolver` interface — consumers don't change. Bundled content always wins for packages that exist locally.
- The frontend never fetches or stores repository indexes — all multi-repo resolution logic lives in the recommender.
- **Manifest metadata passthrough.** Both the future v1 recommend handler and the `RecommenderPackageResolver` pass through the `manifest` object when present.

#### Phase 4d2: Endpoint switch and v1 activation ✅

**Status:** Complete — [PR #695](https://github.com/grafana/grafana-pathfinder-app/pull/695)
**Repo:** `grafana-pathfinder-app`

**Key decisions and artifacts:**

- `getExternalRecommendations()` now calls `POST /api/v1/recommend`. Response is parsed as `V1RecommenderResponse` and each item is sanitized via `sanitizeV1Recommendation` (allowlist-based; handles URL-backed and package-backed items).
- `deduplicateRecommendations()` applied before merging with bundled content — bundled packages always win for items that exist locally.
- `sanitizeLegacyRecommendation` was preserved as a rollback aid (with an eslint-disable comment); removed in Phase 8 once v1 path was confirmed stable.
- Package-backed recommendations flow through the live sanitization/dedup path but are not yet rendered distinctly by the UI (wired in Phase 4g).
- Tests updated: "V1 /api/v1/recommend endpoint integration" suite replaces the old legacy-branch-isolation suite.

#### Phase 4e: Integration verification ✅

**Status:** Complete
**Repo:** `grafana-pathfinder-app`

**What was delivered:**

- 16 Layer 2 integration tests in `src/package-engine/package-pipeline.integration.test.ts`
- Recommender resolution verification: 5 tests for `GET /api/v1/packages/{id}` (200, path metapackage, 404, `loadContent: true`)
- V1 recommend verification: fixture-based tests for package-backed + URL-backed coexistence, graceful degradation for unresolved packages, manifest navigation carry-through
- Composite resolver verification: 4 tests for bundled-miss/hit behavior vs. recommender fallthrough
- Deduplication: 2 tests confirming bundled content always wins over a remote duplicate
- Schema validation confirmed: all 10 bundled packages pass `validate --packages` with 0 errors

**Key decisions:**

- Tests use the real `createBundledResolver()` (backed by actual `repository.json`) so bundle-miss/hit behavior reflects production truth, not mocks.
- Rendering parity blocked on Phase 4g — verified that package-backed items flow through `ContextService.fetchRecommendations()` correctly; rendering fidelity was Phase 4g's concern.

#### Phase 4f: Path migration tooling ⏸️ Optional

**Status:** Demoted to optional — the full content migration (Phase 4b) was completed without this tooling. The migration skill in `interactive-tutorials` and manual agent work proved sufficient.

This phase originally proposed a `migrate-paths` CLI command to read `journeys.yaml` and generate draft `manifest.json` files for `*-lj` directories. **When to revisit:** If a large batch of learning paths needs migration simultaneously and the migration skill proves too slow for the volume.

#### Phase 4g: Docs-retrieval integration ✅

**Status:** Complete
**Repo:** `grafana-pathfinder-app`

**What was delivered:**

- `fetchBundledInteractive()` extended to handle the two-file package URL format (`bundled:<path>/content.json`). Paths containing `/` and ending in `.json` are resolved directly via `require('../bundled-interactives/<path>')`, bypassing the legacy `index.json` lookup.
- `fetchPackageContent(contentUrl, packageManifest?)` added to `docs-retrieval/content-fetcher.ts` — the primary fetch path for package-backed recommendations. Calls `fetchContent(contentUrl)` and overrides `type` to `'interactive'`. Attaches manifest metadata to `RawContent.metadata.packageManifest`.
- `fetchPackageById(packageId, packageManifest?)` added — by-ID fetch using the injected `PackageResolver`.
- `setPackageResolver(resolver)` module-level injection in `docs-retrieval`. `docs-retrieval` imports only the `PackageResolver` Tier 0 interface — never from `package-engine` (Tier 2). Concrete wiring at Tier 4.
- `ContentMetadata.packageManifest?: Record<string, unknown>` added to `src/types/content.types.ts`.
- `context-panel.tsx` click handlers fixed — `getRecommendationContentUrl(rec)` helper uses `contentUrl` for `type === 'package'` and `url` for all other types.
- Resolver wired in `CombinedLearningJourneyPanel` constructor — `setPackageResolver(createCompositeResolver(pluginConfig))` called at Tier 4.
- 18 Layer 2 tests in `src/docs-retrieval/package-content.test.ts`.

**Key decisions:**

- **`fetchContent(contentUrl)` already works for CDN URLs.** Package CDN URLs are trusted HTTPS domains that pass existing security validation.
- **Type override to `'interactive'`.** `determineContentType(url)` returns `'single-doc'` for CDN content.json URLs. `fetchPackageContent` overrides this to `'interactive'` so that `loadDocsTabContent` correctly upgrades the tab type.
- **Wiring is Tier 4, not Tier 3.** `CombinedLearningJourneyPanel` in `components/` (Tier 4) calls `setPackageResolver(createCompositeResolver(pluginConfig))` in its constructor.
- **`package-engine/loader.ts` intentionally retained.** Its typed domain objects (`ContentJson`, `ManifestJson`) are needed by `BundledPackageResolver.resolve(id, {loadContent: true})` and are a different contract from `RawContent`.

### Phase 8: Implementation cleanup ✅

**Status:** Complete — [PR #740](https://github.com/grafana/grafana-pathfinder-app/pull/740) (merged 2026-04-09)

**What was done (PR #740, -640 lines):**

- `sanitizeLegacyRecommendation` removed from `context.service.ts` — rollback aid for the v1 endpoint switch; v1 is stable in production
- `src/package-engine/dependency-resolver.ts` deleted — 10 exported functions + 1 interface with zero consumers outside their own test file; CLI `build-graph.ts` has independent copies that are canonical
- `loadBundledLegacyGuide` removed from `src/package-engine/loader.ts` — all bundled guides use package directory format since Phase 2
- Functional duplication resolved by deletion — `dependency-resolver.ts` is gone, so `build-graph.ts`'s local copies (`extractDependencyIds`, `buildProvidesMap`, `detectCycles`) are the surviving canonical implementation
- 11 regression tests added covering HTTP 500/403 fallback, empty recommendation arrays, unrecognized types, network errors, composite resolver error propagation, and the full `fetchPackageById` chain

---

## Summary

| Phase                                         | Status      | Unlocks                                                                                                                                                       | Testing layers     |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 0: Schema foundation                          | ✅          | Everything — `content.json` + `manifest.json` model, `testEnvironment` schema                                                                                 | Layer 1            |
| 1: CLI package validation                     | ✅          | CI validation, cross-file checks, dependency graph                                                                                                            | Layer 1            |
| 2: Bundled repository migration               | ✅          | End-to-end proof on local corpus, bundled `repository.json`                                                                                                   | Layer 1 + Layer 2  |
| 3: Plugin runtime resolution                  | ✅          | PackageResolver consuming bundled repo, local resolution tier                                                                                                 | Layer 2            |
| 3b: Package authoring documentation           | ✅          | Practitioner docs for package format and CLI commands                                                                                                         | —                  |
| 4a: Backend resolution + v1 recommend routes  | ✅          | Recommender resolves bare IDs via `GET /api/v1/packages/{id}`, surfaces packages via `POST /api/v1/recommend` with virtual rules, full metadata carry-through | Go tests + Layer 2 |
| 4b: Content migration (interactive-tutorials) | ✅          | 288+ packages live on CDN, CI enforcement, `index.json` frozen, recommender deduplication complete                                                            | Layer 1            |
| 4c: E2E manifest pre-flight                   | ✅          | Manifest-aware e2e pre-flight checks (tier, minVersion, plugins)                                                                                              | Layer 3            |
| 4d1: Frontend remote resolver + v1 groundwork | ✅          | V1 response types, `RecommenderPackageResolver`, `CompositePackageResolver`, dormant v1 response helpers, legacy-path isolation                               | Layer 2            |
| 4d2: Endpoint switch and v1 activation        | ✅          | `POST /api/v1/recommend` activated in `ContextService`, package-backed recommendations reach the live frontend seam                                           | Layer 2            |
| 4e: Integration verification                  | ✅          | 16 Layer 2 integration tests; composite resolver fallthrough, deduplication, CDN URL shape, mixed v1 response, schema validation                              | Layer 2 + Layer 3  |
| 4f: Path migration tooling                    | ⏸️ Optional | `migrate-paths` CLI — demoted; migration completed without tooling                                                                                            | Layer 1            |
| 4g: Docs-retrieval integration                | ✅          | Package resolver wired into rendering pipeline, content-type dispatch, metadata + navigation passthrough                                                      | Layer 2            |
| 8: Implementation cleanup                     | ✅          | Dead code removed (dependency-resolver, loadBundledLegacyGuide, sanitizeLegacyRecommendation), 11 regression tests added                                      | —                  |
