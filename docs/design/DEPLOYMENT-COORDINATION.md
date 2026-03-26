# Deployment coordination

This document coordinates the cross-repo rollout of the Pathfinder package system across three repositories. It sequences work that no single repo owns, tracks external blockers, and defines rollback procedures.

**Date:** 2026-03-23

**Related documents:**

| Document | Repo | Purpose |
|----------|------|---------|
| [PACKAGE-IMPLEMENTATION-PLAN.md](./PACKAGE-IMPLEMENTATION-PLAN.md) | pathfinder-app | Phase-by-phase implementation within this repo |
| [MIGRATION.md](https://github.com/grafana/interactive-tutorials/blob/main/docs/design/MIGRATION.md) | interactive-tutorials | Guide and learning journey migration to package format |
| [DEDUPLICATION.md](https://github.com/grafana/interactive-tutorials/blob/main/docs/design/DEDUPLICATION.md) | interactive-tutorials | Removing duplicate recommendation rules after migration |
| [V1-RECOMMEND.md](https://github.com/grafana/grafana-recommender/blob/main/docs/design/V1-RECOMMEND.md) | grafana-recommender | Package-aware v1 recommendation endpoint design |
| [CONFIGURATION.md](https://github.com/grafana/grafana-recommender/blob/main/docs/developer/CONFIGURATION.md) | grafana-recommender | Env var reference and production config audit |

---

## Current state (as of 2026-03-23)

| Component | State |
|-----------|-------|
| Pathfinder phases 0–4g | Complete on `feat/phase-4g` branch, not yet merged to main |
| `constants.ts` | Contains temporary Cloud Run dev URL — **must be reverted before merge** |
| Recommender v1 code | Merged to `main` in grafana-recommender |
| Recommender prod deploy | Blocked on [issue #170](https://github.com/grafana/grafana-recommender/issues/170) (env vars in deployment_tools) |
| Content migration | 31 of ~194 directories have `manifest.json`; 1 of 19 LJs migrated (`prometheus-lj`) |
| CDN `packages/` path | Live at `https://interactive-learning.grafana.net/packages/repository.json` (31 entries) |
| Deduplication | Not started; blocked on migration progress and recommender prod deploy |

---

## Rollout sequence

### Step 1: Fix constants.ts and merge pathfinder PR

**Repo:** `grafana-pathfinder-app`
**Branch:** `feat/phase-4g`
**Blocking:** Step 2 must complete first (or Steps 1 and 2 must be coordinated to land within hours of each other)

Actions:
1. Revert `DEFAULT_RECOMMENDER_SERVICE_URL` to `'https://recommender.grafana.com'`
2. Remove `'grafana-recommender-93209135917.us-central1.run.app'` from `ALLOWED_RECOMMENDER_DOMAINS`
3. Squash or revert the "DANGER" commit (`2bbcd850`)
4. Run `npm run check` to verify all checks pass
5. Merge to main

**Degradation risk if merged before recommender v1 is in prod:** The v1 endpoint switch in Phase 4d2 changed the frontend from `POST /recommend` (legacy) to `POST /api/v1/recommend`. If the production recommender doesn't have v1 routes yet, the call returns a fast 404. The code at `context.service.ts:472-479` handles this gracefully — no crash, no timeout — but the fallback is **bundled interactives + static link rules only** (`getFallbackRecommendations` at line 329). It does **not** fall back to the legacy `/recommend` endpoint.

This is a significant degradation, not a cosmetic one. The legacy `/recommend` endpoint returns contextual docs-page recommendations, learning journeys, and interactive guides tailored to the user's current page. The fallback provides only ~10 bundled interactives and static docs-page links from `bundled-interactives/static-links/` (16 rule files covering major URL contexts). Users would notice fewer and less relevant recommendations.

**Three options for sequencing Steps 1 and 2:**

| Option | Approach | User impact | Risk |
|--------|----------|-------------|------|
| **A: Step 2 first** | Promote recommender to prod, verify v1 works, then merge the pathfinder PR | Zero degradation | Merge conflicts accumulate on the long-lived branch while waiting for deployment_tools PR |
| **B: Tight coordination** | Prepare both in parallel; merge the pathfinder PR within hours of the recommender prod promotion | Brief degradation window (hours) | Requires coordinating across repos; if the recommender promotion fails, users see degradation until rollback |
| **C: Step 1 first, accept degradation** | Merge pathfinder PR immediately, accept the fallback-only state until the recommender catches up | Degradation for days/weeks while issue #170 is resolved | Simplest execution; feature branch risk eliminated immediately |

**Recommendation:** Option A (deploy recommender first) is the safest default. The feature branch has been stable and merge conflicts, while a real risk, are manageable. Option B is preferred if the deployment_tools PR can be fast-tracked. Option C is acceptable only if there is a reason to believe the branch will become unmergeable if left longer.

**What Step 1 unblocks:** Eliminates merge conflict risk from a long-lived feature branch. Future phases (5+) can be developed from main. The `sanitizeLegacyRecommendation` rollback path is preserved in the code (Phase 4d2 decision) if the v1 switch ever needs to be reverted.

### Step 2: Pin env vars and promote recommender to prod

**Repo:** `grafana/deployment_tools`
**Blocking:** [grafana-recommender#170](https://github.com/grafana/grafana-recommender/issues/170)

Actions:
1. Open PR in `grafana/deployment_tools` adding env vars to `ksonnet/lib/docs/recommender.libsonnet`:
   - `PACKAGE_REPOSITORY_URLS` = `interactive-tutorials|https://interactive-learning.grafana.net/packages/repository.json`
   - `CONFIGS_RELOAD_INTERVAL_MINUTES` = `20`
   - `PACKAGE_REPOSITORY_CACHE_TTL` = `300`
   - `MAX_RECOMMENDATIONS` = `10`
2. Merge and verify on `devUsCentral0` and `prodUsCentral0`
3. Update `CONFIGURATION.md` and `RUNBOOK.md` in grafana-recommender
4. Promote via `promote.yml` workflow dispatch

**What this unblocks:** The 31 already-migrated packages begin appearing as package-backed recommendations alongside existing URL-backed recommendations. The warning banner from Step 1 disappears. Duplication is limited to these 31 packages and is expected.

**Note:** `promote.yml` has a cosmetic bug where the success Slack message reports the old tag instead of the new one — tracked in [grafana-recommender#177](https://github.com/grafana/grafana-recommender/issues/177).

### Step 3: Phased guide migration with per-batch deduplication

**Repos:** `interactive-tutorials` (migration) + `grafana-recommender` (dedup)
**Blocking:** Step 2 (recommender must be in prod to verify equivalence against live behavior)

This replaces the original plan of "complete all migration, then deduplicate in one PR." Instead, migration and deduplication proceed together in batches to keep the duplication window narrow.

**Per-batch protocol:**

1. **Select a batch.** Group by learning journey — migrate the LJ and all its step guides together. Standalone guides can be batched by theme or done individually.

2. **Migrate the batch** in `interactive-tutorials`:
   - Run the migration skill (`.cursor/skills/migrate-guide/SKILL.md`) on each guide/LJ in the batch
   - Validate with `validate --packages`
   - Merge to main; CI generates updated `repository.json` and deploys to CDN

3. **Validate equivalence** for the batch:
   - Compare the new `targeting.match` in each manifest against the corresponding static recommender rule(s)
   - Verify no recommendation gaps using the recommender's `coverage-report` CLI
   - Scoped to the batch — don't audit rules for unmigrated guides

4. **Remove corresponding static rules** in `grafana-recommender`:
   - Submit a PR removing only the `"type": "learning-journey"` entries that this batch's packages now cover
   - Include an audit table: for each removed rule, link to the corresponding `manifest.json` on `main` of `interactive-tutorials`
   - CI validates remaining rules; coverage report confirms no gaps

5. **Verify in production:**
   - Confirm the recommender no longer returns duplicates for the batch's guides
   - Confirm package-backed recommendations appear with correct metadata

**Batch sizing guidance:**
- Learning journeys: one LJ per batch (the LJ + all its step guides). Each LJ is 5–15 guides.
- Standalone guides: batch 5–10 together. These are simpler — no path structure, no milestones.
- The migration skill supports parallel execution (each guide in its own directory, no shared writes), so a batch can be migrated in a single session.

**Tracking:** Each batch should be a single PR in `interactive-tutorials` and a corresponding single PR in `grafana-recommender`. Cross-link the PRs in their descriptions.

### Step 4: Freeze index.json

**Repo:** `interactive-tutorials`
**Blocking:** All batches from Step 3 complete

Once every guide has a `manifest.json` with `targeting.match`:
1. Stop accepting changes to `index.json`
2. Leave `index.json` in place — the legacy `/recommend` endpoint still consumes it
3. Enable the CI enforcement step (in `validate-json.yml`) that fails the build if any `content.json` lacks a sibling `manifest.json`

`index.json` is removed later, gated on Prometheus metrics showing zero traffic to the legacy `/recommend` endpoint. See [DEDUPLICATION.md Phase 4](https://github.com/grafana/interactive-tutorials/blob/main/docs/design/DEDUPLICATION.md).

### Step 5: Legacy cleanup

**Repos:** All three
**Blocking:** Prometheus metrics confirm legacy endpoint traffic is negligible

Actions (each independently gated on metrics):
1. Remove `sanitizeLegacyRecommendation` and its eslint-disable comment in `context.service.ts` (pathfinder-app, Phase 8 candidate)
2. Remove `index.json` from `interactive-tutorials`
3. Remove the `guides/` CDN deploy step from `interactive-tutorials` deploy pipeline
4. Retire the legacy `/recommend` endpoint in `grafana-recommender`

These are the **one-way doors** — see the reversibility analysis below.

---

## Cross-repo dependency map

```
Step 2: Pin env vars + promote recommender ──── depends on: deployment_tools PR (issue #170)
       │
       ▼
Step 1: Fix constants.ts + merge pathfinder PR ── depends on: recommender v1 in prod (Step 2)
       │                                           (or accept degradation — see options above)
       ▼
Step 3: Phased migration + dedup ──────────── depends on: Steps 1 + 2 both complete
  (batches run in parallel across interactive-tutorials + grafana-recommender)
       │
       ▼
Step 4: Freeze index.json ────────────────── depends on: all batches complete (Step 3)
       │
       ▼
Step 5: Legacy cleanup ───────────────────── depends on: Prometheus metrics gate
```

Step 2 is the critical path. Step 1 preparation (fixing `constants.ts`, preparing the PR for merge) can proceed in parallel with Step 2, but the actual merge should wait for v1 to be live in production — unless the degradation tradeoff is accepted (see Option C above).

---

## Reversibility analysis

| Action | Reversible? | How |
|--------|-------------|-----|
| Merge pathfinder PR (Step 1) | Yes | Revert commit; or change one line in `getExternalRecommendations()` to call `/recommend` instead of `/api/v1/recommend` and re-enable `sanitizeLegacyRecommendation`. **Note:** if merged before recommender v1 is live, users experience degraded recommendations (bundled + static only) until the recommender catches up or the commit is reverted. |
| Promote recommender to prod (Step 2) | Yes | `promote.yml` accepts a `previous` input for rollback; Kubernetes config is version-controlled |
| Migrate a guide batch (Step 3, migration) | Yes | `manifest.json` files are additive; `git revert` the merge commit removes them; `repository.json` regenerates automatically |
| Remove static recommender rules (Step 3, dedup) | Yes | `git revert` the dedup PR restores the rules; recommender CI validates on merge |
| Freeze `index.json` (Step 4) | Yes | Unfreeze by accepting changes again; no data is lost |
| Remove `index.json` (Step 5) | **One-way door** | Restoring it requires reconstructing the rule set from manifests; not impossible but error-prone |
| Remove `guides/` CDN path (Step 5) | **One-way door** | CDN content is deleted; the `packages/` path must be confirmed serving before this happens |
| Retire legacy `/recommend` (Step 5) | **One-way door** | Any client still calling `/recommend` breaks; gated on traffic metrics |

**Key insight:** Everything through Step 4 is fully reversible. The one-way doors are all in Step 5, which is explicitly gated on production metrics confirming zero legacy traffic.

---

## Content propagation delay

When a new batch of guides is migrated and deployed, there is a multi-layer cache chain before the recommender serves the new packages:

| Layer | TTL | Notes |
|-------|-----|-------|
| CDN edge cache | Up to 60 min | GCS bucket default |
| Recommender repository fetch | `CONFIGS_RELOAD_INTERVAL_MINUTES` (20 min) | Periodic reload from CDN |
| Recommender in-memory cache | `PACKAGE_REPOSITORY_CACHE_TTL` (300s / 5 min) | Response-level cache |
| Frontend client cache | Browser session | Recommendations fetched per page navigation |

**Worst case:** ~85 minutes from CDN publish to user visibility. After a batch migration, allow at least this window before verifying equivalence in production.

---

## External blockers

| Blocker | Repo | Status | Tracks |
|---------|------|--------|--------|
| Pin env vars in k8s config | `grafana/deployment_tools` | Not started | [grafana-recommender#170](https://github.com/grafana/grafana-recommender/issues/170) |
| promote.yml Slack message bug | `grafana-recommender` | Filed | [grafana-recommender#177](https://github.com/grafana/grafana-recommender/issues/177) |
| Pathfinder PR merge | `grafana-pathfinder-app` | Blocked on constants.ts fix | [grafana-pathfinder-app#697](https://github.com/grafana/grafana-pathfinder-app/pull/697) |

---

## Decision log

| # | Date | Decision | Rationale |
|---|------|----------|-----------|
| 1 | 2026-03-23 | Recommender prod deploy should precede pathfinder PR merge (preferred) | The v1 404 fallback is bundled + static links only — no legacy `/recommend` fallback. This is a significant degradation (users lose contextual docs-page recs, learning journeys, and most interactive guides). Merging first is possible (Option C) but not preferred. |
| 2 | 2026-03-23 | Phased dedup per batch, not big-bang after full migration | Keeps duplication window narrow; each batch is independently verifiable |
| 3 | 2026-03-23 | Coordination lives in its own doc, not inline in PACKAGE-IMPLEMENTATION-PLAN.md | Different audience (cross-repo sequencing vs single-repo phase execution); different update cadence |
