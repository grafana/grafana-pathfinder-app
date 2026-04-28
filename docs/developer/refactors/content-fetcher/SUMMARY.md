# Refactor summary — `content-fetcher.ts`

**Branch:** `refactor/content-fetcher`
**Worktree:** `/Users/davidallen/hax/pathfinder-refactor-content-fetcher`
**Baseline:** `ce8da8fb` (`main`)
**Range:** `ce8da8fb..f449c2ca` (17 commits across 6 phases)

## Target and motivation

`src/docs-retrieval/content-fetcher.ts` had grown to **1,171 lines** and absorbed every concern in the docs-retrieval pipeline: markdown rendering, JSON-guide metadata extraction, bundled JSON resolution via webpack `require()`, the raw HTTP state machine (variation-queue + direct-path drains, redirect handling, error classification), and package/resolver integration. The single file owned **6 distinct responsibility clusters** with **3 separate contract surfaces** (storage, URL schemes, `_packageResolver` singleton). Touching any one of them risked stepping on the others.

After the refactor:

| File                    |                    Lines | Owns                                                                                                                                                                  |
| ----------------------- | -----------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content-fetcher.ts`    | **448** (-723, **-62%**) | Orchestration hub: `fetchContent` entry point, dispatch, hash-fragment helpers, error formatting, JSON-guide wrap, journey-extras injection, backend-interactive shim |
| `raw-fetch.ts`          |                      497 | HTTP state machine: variation-queue drain, direct-path drain, redirects, HTTPS gate, JSON detection, error classification                                             |
| `package-fetcher.ts`    |                      342 | Package + resolver integration: singleton, `fetchPackageContent` / `fetchPackageById`, milestone/nav-link resolution, URL builders                                    |
| `metadata-extractor.ts` |                      301 | Metadata + learning-journey extraction (markdown + JSON paths)                                                                                                        |
| `bundled-loader.ts`     |                      283 | `bundled:` URL resolution via webpack `require()`                                                                                                                     |
| `markdown-renderer.ts`  |                      182 | `simpleMarkdownToHtml`, `wrapExpectBlockInOrangeOutline`, helpers                                                                                                     |
| **Total**               |                **2,053** | (vs. 1,171 baseline; +882 lines includes module docstrings, exhaustive invariant comments, and re-exposed contract docs that were previously implicit)                |

The public-API barrel `src/docs-retrieval/index.ts` is unchanged for external consumers.

## Patterns used and why

The investigation surveyed the file against the wiki's pattern catalog and selected three patterns:

- **Pattern A (Pure utility extraction)** — Phase 1 (markdown helpers) and Phase 2 (metadata + journey). Used where the logic is referentially-transparent data-in / data-out: regex-driven markdown rewriting, attribute parsing, title fallback chains. Direct extract + characterization tests.

- **Pattern J (Contract-surface extraction)** — Phase 2, Phase 3 (bundled loader), Phase 5 (package + resolver). Used where the module owns an _external contract_ that callers depend on: webpack-resolved bundled-asset paths (Phase 3), the `_packageResolver` singleton lifecycle (Phase 5), and the milestone-URL building rules (Phase 5). The Pattern J discipline — _pin the contract surface in characterization tests before moving the code_ — paid off in Phase 5 (see "Tripwires that paid off").

- **Pattern G (Async state-machine decomposition)** — Phase 4 (raw-fetch). The raw-fetch block was a 400-line state machine with two parallel drain orders, a trust/HTTPS asymmetry, three classes of redirect handling, and five error-type classifications. Pattern G prescribes pinning every observable interleaving in characterization tests **before** moving a single line. We pinned 24 invariants in `raw-fetch.pre-extraction.test.ts`, ran the full suite, then moved the code in a single atomic commit.

## Phase outline

| Phase | Pattern | Outcome                                                                                                                                               | Risk     |
| ----: | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
|     0 | —       | Baseline: 2,367 tests / 130 suites passing on `ce8da8fb`.                                                                                             | —        |
|     1 | A       | Extracted markdown helpers → `markdown-renderer.ts` (+17 unit tests).                                                                                 | LOW      |
|     2 | A + J   | Extracted metadata + journey extraction → `metadata-extractor.ts` (+27 unit tests).                                                                   | LOW      |
|     3 | J       | Extracted bundled-loader → `bundled-loader.ts` (+15 unit tests). Preserved `SAFE_PACKAGE_PATH` regex contract and webpack `require()` paths verbatim. | MED      |
|     4 | G       | Extracted raw-fetch state machine → `raw-fetch.ts` (+27 unit tests; 5 documented invariants). Backup branch: `refactor-content-fetcher-pre-phase-4`.  | **HIGH** |
|     5 | J       | Extracted package + resolver → `package-fetcher.ts` (+22 unit tests; 7 documented invariants). Backup branch: `refactor-content-fetcher-pre-phase-5`. | **HIGH** |
|     6 | —       | Residual orchestration-hub verification: +5 e2e assertions to `content-fetcher.test.ts`. No code movement.                                            | LOW      |

Net test delta across the refactor: **+113 unit/characterization tests** added across 6 new test files plus the e2e additions. Final `npm run test:ci`: **2,547 passing / 18 skipped / 0 failing** across 131 suites.

## Tripwires that paid off

Three pre-extraction characterization tests caught real risks before any code moved.

1. **Phase 4, raw-fetch HTTPS gate (`raw-fetch.pre-extraction.test.ts` test 7).**
   The PLAN said `enforceHttps` blocks when `response.url` downgrades to http. Pre-test assertion: error matches `/non-HTTPS/i`. **Live: failed** — the actual error was `"Redirect target is not in trusted domain list"`. Root cause: `isAllowedContentUrl` (which `fetchContent` calls _before_ `enforceHttps`) implicitly requires HTTPS for Grafana domains, so the trust gate trips first. Pre-extraction discovery prevented us from "fixing" the test post-extraction and silently breaking the layered-gate contract. Test was refined to pin the actual _layered_ behavior (`7a` = trust gate, `7b` = independent unit test of `enforceHttps`).

2. **Phase 5, package-fetcher strict-equality URL match (`package-fetcher.pre-extraction.test.ts`).**
   `fetchPackageContent` compares `m.url === contentUrl` with `===` rather than the normalized `urlsMatch` helper used elsewhere. A trailing-slash difference produces `currentMilestone === 0`. The pre-test pinned this asymmetry as **Invariant 2** in `package-fetcher.ts`. Without the pre-test, the natural urge during extraction is to "harmonize" with `urlsMatch` — which would silently change consumer behavior for any milestone whose URL canonicalization disagrees with the manifest.

3. **Phase 4, variation-path trust check (`raw-fetch.pre-extraction.test.ts` test 18).**
   The variation path uses `response.url || urlVariation` for trust validation, **without** an additional `enforceHttps` gate (unlike the direct path). Pre-test pinned the asymmetry as **Invariant 2** in `raw-fetch.ts`: variation URLs are deterministically constructed from a pre-validated input URL, so the variation URL itself is the trust anchor. Removing the asymmetry "for consistency" would break interactive-learning fetches in proxied/intercepted environments where `response.url` is empty.

## Surprises encountered

1. **`extractMetadata` precedes `JSON.parse` for native-JSON content.** Phase 6 PH6-5 expected an invalid `content.json` body to fall through to the HTML-wrap path (PLAN's wording). Live: the outer `try…catch` at `content-fetcher.ts:200` surfaces a `JSON.parse` error from `extractMetadata`'s `extractTitleFromJson` helper — not the wrap-fallthrough. The fallthrough catch _exists_ but is unreachable for the typical case because metadata extraction runs first. Pinned current behavior in PH6-5 with a regex (`/not valid JSON|JSON\.parse|Unexpected token/i`); a future refactor that wants the wrap-fallthrough to actually fire must restructure deliberately.

2. **`injectJourneyExtrasIntoJsonGuide` is a benign cycle source.** Both `content-fetcher.ts` and `package-fetcher.ts` need it: the orchestration hub calls it when wrapping non-package JSON guides, and `package-fetcher.fetchPackageContent` calls it when wrapping milestone content. Co-locating it in either module would require a back-import. We kept it in `content-fetcher.ts` (the "primary" use site) and accepted a unidirectional `package-fetcher → content-fetcher` import for `fetchContent` + `injectJourneyExtrasIntoJsonGuide`. No cycle results because `content-fetcher.ts` does not import from `package-fetcher.ts`.

3. **`enforceHttps` had to co-move with raw-fetch despite being called from the orchestration hub.** The direct path inside `fetchRawHtml` calls `enforceHttps` on redirect targets, and the orchestration `fetchContent` calls it up front on the input URL. Two options: (a) hub re-imports it from `raw-fetch`, (b) duplicate the logic. Chose (a): `content-fetcher.ts` now imports `{ enforceHttps }` from `./raw-fetch`. Single source of truth, no cycle.

## Candidate wiki improvements

Items the High-Risk Refactor Guidelines wiki could absorb from this run:

1. **Pattern G should explicitly require characterization tests for _trust/HTTPS asymmetries_ in fetch paths.** Phase 4's wiki guidance is good for queue/timer interleavings but doesn't call out gating-asymmetry as a failure class. Suggest adding a "trust-gate position" sub-checklist to Pattern G's invariant template.

2. **Pattern J should warn about `===` vs normalized-equals.** Phase 5's strict-equality URL match (`m.url === contentUrl`) is exactly the kind of "obviously wrong, fix it during extraction" trap Pattern J is designed to prevent. Suggest a pinned example in the wiki.

3. **A wiki note on "benign unidirectional imports vs. cycles."** The decision in surprise #2 wasn't covered by the wiki's anti-cycle guidance — it presented as "this is a cycle" when it is not. Suggest a worked example explaining when a downstream module re-importing an orchestration helper is OK.

4. **`npm run e2e` deferral protocol.** The wiki currently lists `npm run e2e` as a hard pre-merge gate. In a worktree without Docker / no Grafana stack, this is impractical. Suggest documenting an explicit deferral protocol (record in LOG, add in-suite e2e characterization, run the real e2e on the merge PR) so future refactors don't burn time fighting their environment.

## Artifacts

- **Pre-merge commits:** `ce8da8fb..f449c2ca` (17 commits) — atomic per the SKILL convention (pre-test + extract + post-test sandwich, plus one `.gitignore` chore at the start).
- **Backup branches preserved:** `refactor-content-fetcher-pre-phase-4`, `refactor-content-fetcher-pre-phase-5` (delete post-merge).
- **Transient state:** `.refactor/INVESTIGATION.md`, `.refactor/PLAN.md`, `.refactor/LOG.md` (gitignored; preserved on the worktree).

## Pre-merge gates

| Gate                    | Status                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `npm run typecheck`     | clean                                                                              |
| `npm run lint`          | clean                                                                              |
| `npm run prettier-test` | clean                                                                              |
| `npm run test:ci`       | 2,547 / 18 skipped / 0 failed across 131 suites                                    |
| `npm run build`         | clean (4 pre-existing warnings)                                                    |
| `npm run e2e`           | DEFERRED — runs on merge PR (Docker stack unavailable in worktree)                 |
| `npm run lint:go`       | DEFERRED — zero Go changes (`git diff --stat ce8da8fb..HEAD -- 'pkg/**'` is empty) |
| Architecture violations | none added                                                                         |
| Bootstrap contamination | none (root-level files untouched)                                                  |
| Public API change       | none (`src/docs-retrieval/index.ts` re-export paths updated only)                  |
