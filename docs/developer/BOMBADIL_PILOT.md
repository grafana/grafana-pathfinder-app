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

Clean runs, 120s each, three runs: exit 0, 0 violations, 0 false positives.

| Run | States | do-it | mark-complete | reset | reopen-panel | open-guide/preview |
| --- | ------ | ----- | ------------- | ----- | ------------ | ------------------ |
| 1   | 2203   | 31    | 9             | 13    | 108          | 136                |
| 2   | 2089   | 11    | 7             | 5     | 82           | 143                |
| 3   | 2211   | 21    | 5             | 8     | 104          | 141                |

Controlled violations (60s each): all three properties detected (exit 2). The faults write the storage shape of the defect from an init script, so they show the properties can see a violation, not that the product has one.

Replay: 0 of 3 succeeded. Each `--reproduce` ended with `reproduction and original test diverged!` (exit 1), expected given Grafana's variable boot time and a stateful browser.

Other findings:

- About 85% of states are `Wait` while Grafana boots after each full navigation; only about 2% of actions are Do it, Mark complete or reset. Meaningful coverage per minute is low.
- Reloading or navigating before the Grafana shell has rendered restarts boot and the page never settles, so actions are gated on the shell being ready.
- JavaScript coverage instrumentation is disabled (`--instrument-javascript=`); with it the Grafana bundles did not boot in budget.
- No new defect found. The real product behaved correctly across all three clean runs (attempts and facts appear only after Mark complete).
- Maintenance: about 250 lines of spec plus three harness files; storage key literals in the spec are checked against `src/lib/storage-keys.ts` and `testIds` by the harness's first test.

## Recommendation: revise

The setup is reproducible and the properties are sensitive, but yield is low and replay failed. Before proposing a time-bounded, non-blocking CI job: speed up navigation (open guides through in-app tabs rather than full loads), raise the share of Do it and Mark complete actions, add a second step state so reset races are reachable, and re-measure replay with `bombadil browser shrink`. Stop if replay still fails after that. No confirmed defect, so no regression test was added.
