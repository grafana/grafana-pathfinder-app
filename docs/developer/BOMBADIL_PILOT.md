# Bombadil guide-lifecycle pilot

Investigation for [#2420](https://github.com/grafana/grafana-pathfinder-app/issues/2420), related to [#603](https://github.com/grafana/grafana-pathfinder-app/issues/603). Not a required check and not part of `npm run check`. The Bombadil spec and its own `package.json` (pinning `@antithesishq/bombadil` 0.7.10) live in `bombadil/`, outside `tests/` because the spec runs in Bombadil's runtime, not plain Node, which the architecture reachability check requires of `tests/`. The Playwright harness lives in `tests/bombadil/`.

## Properties

| Property                       | Statement                                                                                                        | Existing coverage                                  | Extra exploration sought                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `previewNeverCompletesDurably` | A `#pf-pr-` preview guide never appears on a queued completion fact (`COMPLETION-MODEL.md`, PR-tester preview).  | Unit tests on the marker and recorder.             | Preview opened between real guides, resets and reloads. |
| `reopeningCreatesNothing`      | Queue items plus attempt keys rise only in a transition where the reader did Do it or Mark complete.             | `completion-tracking.spec.ts`, attempt unit tests. | Reopen, close, reset and reload ordering.               |
| `progressStaysWithItsGuide`    | A stored percentage for a content key rises only when the evidence action ran while that key was the active tab. | Per-guide cases in `completion-tracking.spec.ts`.  | Guide switching mid-progress.                           |

Observation uses the product's own storage (write queue, attempt keys, interactive-completion, tabs), read by extractors. No product code was changed. Limit: P3's "active tab" comes from the product's persisted tab state, so it is not fully independent of the code under test.

## Run it

Needs the plugin built (`npm run build:all`) and the isolated e2e stack:

```bash
docker compose -f docker-compose.yaml -f docker-compose.e2e.yaml -p pathfinder-e2e up -d grafana   # :3010
(cd bombadil && npm ci)
cd tests/bombadil
BOMBADIL_TIME_LIMIT=90s ../../node_modules/.bin/playwright test -c playwright.config.ts run.pilot
# controlled violation, expects exit 2; add BOMBADIL_REPLAY=1 to attempt a replay
BOMBADIL_FAULT=reopen-mints ... # or preview-completion, cross-credit
```

Bounds: `BOMBADIL_TIME_LIMIT` (default 90s), one tab, admin session, actions limited to the custom ones in `bombadil/spec/guide-lifecycle.ts`, navigation limited to the proxy origin by `--allow-url`. No Bombadil default properties or generic click/input actions are exported. Cleanup: the harness closes its servers; `docker compose -p pathfinder-e2e down`. Output per run in `tests/bombadil/out/<run>/`: `meta.json` (revision, dirty flag, Grafana and Bombadil versions, fault, exit code), `bombadil.log`, `console.log`, `final.png`, `trace/` (trace.jsonl plus screenshots; treat as sensitive).

Fixtures are served outside the browser (`fixture-servers.ts`): a reverse proxy answers the completion write route with 404 (so facts stay in the queue) and the catalogue, and a local HTTPS server stands in for the CDN. Playwright `page.route` cannot be used because it stalls Bombadil's CDP attach.

## Trial results (one machine, Grafana 13.3.1, 2026-11-15)

Two rounds. Round 1 launched every guide with a full page load, so Grafana rebooted on each. Round 2 launches guides in-app by dispatching the `pathfinder-auto-open-docs` event that link interception uses, and keeps full loads and reloads rare.

Clean runs, 120s each, three per round, exit 0, 0 violations, 0 false positives in both rounds.

| Round | States per run | do-it   | mark-complete | reset | in-app switch | reload / full load |
| ----- | -------------- | ------- | ------------- | ----- | ------------- | ------------------ |
| 1     | ~2200          | 11-31   | 5-9           | 5-13  | 0             | ~140               |
| 2     | ~2540          | 206-216 | 47-51         | 87-95 | 413-421       | ~100               |

Round 2 raised Do it about 10x and put roughly a third of actions into the lifecycle (Do it, Mark complete, reset, switch, close, reload), up from about 2%. About 45% of states are still `Wait`.

Controlled violations (60s each, both rounds): all three properties detected (exit 2). The faults write the storage shape of the defect from an init script, so they show the properties can see a violation, not that the product has one. The preview fault also hooks the in-app launch event, because round 2 no longer reloads for previews.

Replay: 0 of 6 attempts succeeded (3 faults in each round), including after clearing storage and re-arming the once-per-tab reset. Each `--reproduce` ended with `reproduction and original test diverged!`. `bombadil browser shrink` manages its own browser and has no external-browser mode, so it cannot use these fixtures (local CDN host mapping, proxy) and was not run.

Other findings:

- Reloading or navigating before the Grafana shell has rendered restarts boot and the page never settles, so actions are gated on the shell being ready.
- JavaScript coverage instrumentation is disabled (`--instrument-javascript=`); with it the Grafana bundles did not boot in budget, so exploration is unguided by coverage.
- No defect found in about 15,000 clean states across six runs. The real product behaved correctly (attempts and facts appear only after Mark complete).
- Maintenance: about 300 lines of spec plus three harness files; storage key literals in the spec are checked against `src/lib/storage-keys.ts` and `testIds` by the harness's first test.

## Recommendation: stop (park the pilot, do not wire to CI)

The round-2 stop rule was: stop if replay still fails, or if clean runs find nothing once yield is fixed. Both held. Yield is fixed and the properties are sensitive, but a failure found in CI could not be reproduced or shrunk, and six runs found nothing the scripted suites miss.

Keep the directory as a manual tool; add no CI job. Revisit if Bombadil adds replay against an externally managed browser, or if a completion bug class appears that depends on action ordering. The cheaper follow-up that keeps the value is to promote the three properties to deterministic cases in `tests/completion-tracking.spec.ts` (preview-after-real-guide, reopen-after-reset, switch-mid-progress). That is not done here.
