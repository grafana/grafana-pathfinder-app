# Experiment testing

How to force yourself into a specific experiment arm for local development, QA, and demos. The flag shapes and product intent live in [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) — this doc focuses on the manual override workflow.

All overrides go through `window.__pathfinderExperiment`, the debug surface created in [`src/utils/experiments/experiment-debug.ts`](../../src/utils/experiments/experiment-debug.ts) at plugin boot. It's available in any DevTools console where Pathfinder is loaded — except when Pathfinder is fully dismounted (`pathfinder.enabled=false` hides the plugin, taking the debug surface with it; use raw `localStorage` writes in that case).

## Current experiments

| Flag                                                | Variants                             | What treatment does                                                                                                        |
| --------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pathfinder.highlighted-guide-experiment`           | `excluded` / `control` / `treatment` | Both `control` and `treatment` keep Pathfinder visible — they differ only in which `guideId` is auto-opened + featured.    |
| `pathfinder.interactive-learning-banner-experiment` | `excluded` / `control` / `treatment` | `treatment` shows a dismissible explanatory banner on the context page and above opened guides. `control` renders nothing. |

See [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) for the full flag shapes and variant tables.

A related pre-post change — **PLG Onboarding Flow Revamp** — auto-opens Pathfinder from the Cloud onboarding survey. It is not a Pathfinder MTFF flag; identify it in analytics by `source` on `pathfinder_docs_panel_interaction`. See [PLG Onboarding Flow Revamp](#plg-onboarding-flow-revamp-pre-post).

## Debug-surface API

```js
__pathfinderExperiment.flags; // list of known flag names
__pathfinderExperiment.setOverride(flag, value);
__pathfinderExperiment.removeOverride(flag);
__pathfinderExperiment.clearOverrides();
__pathfinderExperiment.showOverrides(); // returns the current overrides object
__pathfinderExperiment.showExposures(); // lists (flag, variant) pairs already reported to analytics on this browser
__pathfinderExperiment.clearExposures(); // clears the analytics dedup markers so the next reload re-fires pathfinder_feature_flag_evaluated
__pathfinderExperiment.bannerVariant(); // interactive-learning banner arm, or 'not-enrolled' if no panel has opened yet
```

`bannerVariant` is a function rather than a property because that experiment enrolls lazily — see its section below. Calling it never enrolls you; it only reads what enrollment already resolved.

Overrides are persisted in `localStorage` under `grafana-pathfinder-flag-overrides`, evaluated on every page load via the synchronous `getFeatureFlagValue` / `getHighlightedGuideConfig` readers — they bypass MTFF entirely and produce a `[OpenFeature] Using local override for '<flag>'` warning every time they're read, which doubles as a visible reminder that you're in dev mode.

## Reset to a clean baseline

Run this between tests and at the end of a demo. It drops the override, wipes the once-per-browser markers, the panel-mode preference, the analytics exposure dedup markers, and the extension-sidebar docking state.

```js
// 1. Drop every Pathfinder flag override
__pathfinderExperiment.clearOverrides();

// 2. Wipe highlighted-guide auto-open markers + resetCache sentinel
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-highlighted-guide-'))
  .forEach((k) => localStorage.removeItem(k));

// 3. Wipe analytics exposure-dedup markers (so pathfinder_feature_flag_evaluated fires again)
__pathfinderExperiment.clearExposures();

// 4. Wipe the interactive-learning banner dismissal
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-interactive-learning-banner-dismissed-'))
  .forEach((k) => localStorage.removeItem(k));

// 5. Clear leftover panel-mode (in case earlier floating-mode tests left it sticky)
localStorage.removeItem('grafana-pathfinder-app-panel-mode');

// 6. Release the extension sidebar in case another plugin (Assistant, IRM, …) is docked
localStorage.removeItem('grafana.navigation.extensionSidebarDocked');

location.reload();
```

After the reload, Pathfinder behaves like a brand-new visitor: no overrides, no markers, no docked plugin.

## `pathfinder.highlighted-guide-experiment`

A/B test for guide content. Both `control` and `treatment` keep Pathfinder visible, auto-open the sidebar, **and auto-launch the configured `guideId` as a tab** on matched pages — using the same `auto-launch-tutorial` seam as the `?doc=` deep link. The user stays on the page they were on; no navigation happens. The Featured-slot injection still runs in parallel so the card is also visible in the recommendations tab. Use this to compare two candidate guides on the same page.

### `guideId` URL form (read this before configuring an interactive-learning guide)

For guides hosted on `interactive-learning.grafana.net`, **always use the package content URL**:

```
https://interactive-learning.grafana.net/packages/<slug>/content.json
```

This is the form `openLearningJourney` / `openDocsPage` recognise as a package URL (`isPackageContentUrl` in [src/docs-retrieval/package-info-from-url.ts](../../src/docs-retrieval/package-info-from-url.ts)) — that's the gate that triggers the sibling `manifest.json` fetch which populates milestones, the toolbar, and the multi-page navigation. The platform also serves the same guide under `https://interactive-learning.grafana.net/guides/<slug>/`, but that public web-page form bypasses the package gate and falls through to a plain `fetchContent(url)` call — the guide opens as a single page with no milestones. If you only see one page when you expected a learning journey, this is almost always the URL form. See "Common gotchas" below.

### Control — interactive package

```js
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  variant: 'control',
  pages: ['/a/grafana-irm-app*'],
  guideId: 'https://interactive-learning.grafana.net/packages/irm-configuration/content.json',
  docType: 'interactive',
  autoOpen: true,
  resetCache: false,
});
location.reload();
```

### Treatment — learning journey

Forces the Featured card type to `learning-journey` so the click-through opens with milestone UI rather than as a single docs page.

```js
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  variant: 'treatment',
  pages: ['/a/grafana-irm-app*'],
  guideId: 'https://interactive-learning.grafana.net/packages/grafana-irm-configuration-lj/content.json',
  docType: 'learning-journey',
  autoOpen: true,
  resetCache: false,
});
location.reload();
```

### Injection-only mode (no auto-open, no auto-launch)

Use this to test the Featured-slot injection without the sidebar auto-popping or the guide auto-launching as a tab:

```js
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  variant: 'treatment',
  pages: ['/a/grafana-irm-app*'],
  guideId: 'bundled:my-guide',
  autoOpen: false,
  resetCache: false,
});
location.reload();
```

### Resetting the once-per-browser auto-open

The auto-open marker is keyed `(hostname, guideId)`. A different `guideId` re-arms automatically; the same `guideId` needs an explicit reset:

```js
// Option 1: flip resetCache to true (sentinel-guarded — toggle to false first if you've already used true once)
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  // ...same config...
  resetCache: true,
});
location.reload();

// Option 2: wipe the markers directly
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-highlighted-guide-'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

### Diagnostic logs

When the override is active and `variant !== 'excluded'`, the orchestrator emits **exactly one** line per page load explaining its decision:

- `Highlighted-guide auto-open fired (boot) for guideId: …` — success at boot.
- `Highlighted-guide auto-open fired (navigation) for guideId: …` — success after SPA navigation into a matched page.
- `Highlighted-guide auto-open skipped: autoOpen=false (injection-only mode)` — `autoOpen: false` is configured.
- `Highlighted-guide auto-open skipped: guideId is empty` — `guideId` is missing.
- `Highlighted-guide auto-open skipped at boot: path "/foo" does not match pages […] (nav listener armed)` — wrong page; the listener will fire on the next matching navigation.
- `Highlighted-guide auto-open skipped: already opened for guideId="…"` — once-per-browser marker present (use the reset above).
- `Highlighted-guide auto-open skipped: extension sidebar owned by another plugin` — Assistant, IRM, or another plugin owns the sidebar slot; release with the reset snippet's step 5.

## Verifying analytics

Three events fire end-to-end for the highlighted-guide experiment. Filter the Rudderstack devtools (or your local analytics tap) for:

| Event                               | When                                                                                                                                               | Key properties                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pathfinder_feature_flag_evaluated` | First time you hit a matched `(hostname, flag, variant)` on this browser — see dedup below                                                         | `flag_key`, `flag_value`, `tracking_key`, `variant`                                                                                              |
| `pathfinder_docs_panel_interaction` | When the sidebar mounts after auto-open                                                                                                            | `action: 'auto-open'`, `source: 'highlighted_guide_experiment'`                                                                                  |
| `pathfinder_open_resource_click`    | Fires twice: once when the guide auto-launches as a tab (`trigger_source: 'auto_launch_tutorial'`), and again if the user clicks the Featured card | `content_title`, `content_url`, `content_type`, `interaction_location` (`docs_panel` for auto-launch, `featured_card_button` for the card click) |

### Why the exposure event might not fire

`pathfinder_feature_flag_evaluated` is **deduped per browser per (hostname, flag, variant)** — once you've been exposed to an arm on a given stack, the event won't refire on subsequent page loads. This keeps exposure-event volume proportional to "users in each arm" rather than "pageviews per user," which is what every A/B analysis tool expects.

The dedup state lives in `localStorage` under `grafana-pathfinder-experiment-exposure-reported-{hostname}:{flagKey}:{variant}`. The debug surface exposes two helpers for inspecting and resetting it:

```js
// Inspect: which (flag, variant) tuples have already fired the event on this stack?
// Returns an array of { key, flag, variant } and pretty-prints the count.
__pathfinderExperiment.showExposures();
// e.g. → [
//   { key: '…experiment-variant:treatment', flag: 'pathfinder.experiment-variant',           variant: 'treatment' },
//   { key: '…highlighted-guide:control',    flag: 'pathfinder.highlighted-guide-experiment', variant: 'control'   },
// ]

// Reset: wipe all dedup markers for this hostname so the next reload re-fires.
__pathfinderExperiment.clearExposures();
location.reload();
```

When to use them:

- **You expect an exposure event but it isn't showing up in analytics.** Run `showExposures()` first — if the (flag, variant) pair is listed, the event already fired on a previous load. Run `clearExposures()` and reload to force it to fire again.
- **Demoing an experiment and want a fresh exposure on each demo run.** Bake `clearExposures()` into the reset between demos (step 3 of the reset snippet already does this).
- **Validating variant reassignment behavior.** A user moved from `control` → `treatment` writes a _new_ marker (`...:treatment` vs `...:control`), so the event refires automatically. Use `showExposures()` to confirm both arms appear in the marker list after a reassignment test.

Variant reassignment is the **only** condition where the event auto-refires across page loads without manual reset; everything else (same browser, same arm, same hostname) is deduped.

## `pathfinder.interactive-learning-banner-experiment`

Tests whether explaining interactive learning up front increases guide engagement. `treatment` renders a dismissible explanatory banner on the context page and above opened guide content; `control` and `excluded` render nothing.

### Treatment

```js
__pathfinderExperiment.setOverride('pathfinder.interactive-learning-banner-experiment', { variant: 'treatment' });
location.reload();
```

Open the sidebar. The banner sits above the profile bar, and its only control is the dismiss affordance.

### Above an opened guide

The banner has a second placement, above rendered guide content, so a guide reached without ever passing through the context page still explains itself. Auto-open is the case worth checking:

```js
// With the treatment override set, load a guide directly — no sidebar visit first.
location.href = '/?doc=<guide-url>';
```

The banner appears above the guide content, and the shown event carries `interaction_location: interactive_learning_banner_guide` rather than `interactive_learning_banner`. Both placements share one dismissal: close it above the guide, hit "Return to my learning", and it is gone from the context page too (and the reverse).

For the floating and full-screen surfaces, add `&panelMode=floating` or `&panelMode=fullscreen`. Those enroll from their own mount effects, so the exposure fires even though the sidebar never mounted.

### Control

```js
__pathfinderExperiment.setOverride('pathfinder.interactive-learning-banner-experiment', { variant: 'control' });
location.reload();
```

No banner. The exposure event still fires on first sidebar open — that is the point of a control arm.

### Enrollment fires on panel open, not on boot

This is the one thing that behaves differently from the highlighted-guide experiment. The flag is evaluated lazily the first time any Pathfinder surface mounts (sidebar, floating, or full-screen), so:

- `__pathfinderExperiment.bannerVariant()` returns `'not-enrolled'` until you open Pathfinder, then the arm.
- `pathfinder_feature_flag_evaluated` for this flag appears on first panel open, not on page load. If you are watching the network tab from boot expecting it immediately, that is why it is missing.
- Reloading without opening Pathfinder produces no exposure at all. That is intended — a user who never opened the panel never had the chance to see the banner.

Concretely, the exposure fires on the first of these in a browser:

- the sidebar opens, or
- a guide or learning path renders for the first time in any mode (sidebar, floating, or full-screen)

### Verifying banner analytics

Filter Rudderstack (or your local analytics tap) for:

| Event                                           | When                                                                                          | Key properties                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pathfinder_feature_flag_evaluated`             | First sidebar open **or** first guide / learning-path render in any mode — never on page load | `flag_key: pathfinder.interactive-learning-banner-experiment`, `tracking_key`, `variant`                |
| `pathfinder_interactive_learning_banner_shown`  | Banner actually painted (once per page load, whichever placement rendered first)              | `interaction_location`                                                                                  |
| `pathfinder_interactive_learning_banner_dismissed` | User dismisses the banner                                                                  | `interaction_location`                                                                                  |

`interaction_location` is the placement:

| Value                            | Placement                                      |
| -------------------------------- | ---------------------------------------------- |
| `interactive_learning_banner`    | Context page (above the profile bar)           |
| `interactive_learning_banner_guide` | Above a rendered guide / learning path      |

Control renders nothing, so `shown` and `dismissed` are **treatment-only by construction**. Do not use them for the engagement comparison — they cannot exist on control. Compare guide-interaction events that carry the experiments enrichment (`pathfinder_open_resource_click`, `pathfinder_docs_panel_interaction`, Show me / Do it, and so on). The exposure event is the one that exists on both arms.

The same per-browser `(hostname, flag, variant)` dedup as the highlighted-guide experiment applies to `pathfinder_feature_flag_evaluated`. Use `__pathfinderExperiment.showExposures()` / `clearExposures()` if you expect an exposure and it is missing.

### Resetting the dismissal

The banner stays dismissed per browser. `clearOverrides()` does not clear it:

```js
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-interactive-learning-banner-dismissed-'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

## PLG Onboarding Flow Revamp (pre-post)

This is **not** a Pathfinder MTFF experiment and has no `__pathfinderExperiment` override. From **2026-08-26 00:00 UTC**, the Grafana Cloud onboarding flow (setup-guide) auto-opens Pathfinder when a user who clicked the Frontend Observability or Synthetics recommendation tile lands on the matching product page.

The parent onboarding A/B is `setup-guide.onboarding-plg` (treatment = the survey-led onboarding). The Pathfinder auto-open is a follow-on change on that treatment experience, analysed as a **pre vs post** cut — not a Pathfinder `control` / `treatment` split.

Do not confuse these auto-opens with [`pathfinder.highlighted-guide-experiment`](#pathfinderhighlighted-guide-experiment). That flag tags `source: 'highlighted_guide_experiment'`. The onboarding revamp tags a dedicated `plg-survey-*` source.

### How to identify the cohort

Spine: `grafanalabs-global.rudderstack.pathfinder_docs_panel_interaction` where `action = 'auto-open'` and `source` is one of:

| `source`                    | Survey tile (`onboarding_flow_event.component_key_properties_recommendation`) | Product page |
| --------------------------- | ----------------------------------------------------------------------------- | ------------ |
| `plg-survey-frontend-o11y`  | `frontend-o11y`                                                               | FE O11y / Kowalski (`/a/grafana-kowalski-app*`) |
| `plg-survey-monitor-url`    | `monitor-url`                                                                 | Synthetics (`/a/grafana-synthetic-monitoring-app*`) |

The auto-open row does **not** carry `resource_info`, `suggested_urls`, or `experiments.guideId` for these sources (all null). The guide that opened is the first `pathfinder_open_resource_click` with `interaction_location = 'docs_panel'` immediately after auto-open:

| `source`                   | Guide slug                         |
| -------------------------- | ---------------------------------- |
| `plg-survey-frontend-o11y` | `welcome-frontend-observability`   |
| `plg-survey-monitor-url`   | `sm-ping-check-tutorial`           |

### Pre vs post windows

| Period | Clock | Cohort event |
| ------ | ----- | ------------ |
| Pre-change (no Pathfinder auto-open) | 2026-08-04 00:00 UTC through 2026-08-26 00:00 UTC | Survey-tile click (`onboarding_survey_recommendation_click` for `frontend-o11y` / `monitor-url`) |
| Post-change | 2026-08-26 00:00 UTC onward | `plg-survey-*` auto-open |

Join `setup-guide.onboarding-plg` separately if you need the parent A/B population. Not every `plg-survey-*` auto-open has a `feature_toggle_event` row on `user_id` — resolve assignment on `org_id` (and tolerate null `user_id` on the flag).

### Gotchas for this readout

- **Never use `context_traits_org_id`** on these Rudderstack events — it is org 1. Resolve org via instance URL + `user_id` / email through `stg_grafana_instance_url_xref` (same pattern as `rpt_pathfinder_onboarding_experiment`).
- `plg-survey-*` is an **analytics source string** set by the onboarding flow when it auto-opens the sidebar. It is not a Pathfinder `LaunchSource`, so alignment-prompt classification treats it as unknown (needs check). That does not affect the auto-open event itself.
- Staff users should be excluded via `core_users.is_staff`, not by filtering Rudderstack traits.

## Common gotchas

- **`__pathfinderExperiment` is undefined.** Pathfinder is dismounted — the `pathfinder.enabled` kill-switch is `false` (or overridden off). Clear `localStorage.grafana-pathfinder-flag-overrides` and reload, or write `{"pathfinder.enabled": true}` into that key.
- **`setOverride` had no effect, or opened a guide you didn't configure — and there's no `Using local override` warning.** Check the `variant` spelling. Anything outside `excluded` / `control` / `treatment` rejects the whole override, and a rejected override is **ignored in favor of the remote MTFF value** — it does _not_ fall back to the default config. On a local OSS stack there is no MTFF provider, so nothing happens and the symptom is silence; on a Cloud stack whose flag is live you get the _remote_ arm's `guideId` auto-launched instead of yours. Look for `[OpenFeature] Rejected the override payload for 'pathfinder.highlighted-guide-experiment'` in the console — it names the reason (`unknown_variant` or `invalid_shape`) and fires once per page load. Note that an unrecognized variant never fired an exposure event even before it was validated, so a missing `pathfinder_feature_flag_evaluated` is not a useful clue here. See the variant table in [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md#pathfinderhighlighted-guide-experiment).
- **Auto-launch landed but I see the wrong tab.** The orchestrator dispatches `auto-launch-tutorial` which calls `openDocsPage` / `openLearningJourney` — those make the new guide tab active automatically. If you instead see the editor / devtools tab from a prior session, the configured `guideId` failed to resolve through `findDocPage`: check the console for `findDocPage returned null for guideId="…"` and fix the id (`bundled:<id>`, `api:<id>`, or a full URL on a whitelisted host).
- **Auto-launch fires but the guide opens as the wrong type (docs page vs learning journey).** Set the flag's `docType` explicitly (`'docs-page' | 'learning-journey' | 'interactive'`). The operator override wins over `findDocPage`'s URL-based inference.
- **Only one page renders / no milestones for an interactive-learning guide.** `guideId` is pointing at the `/guides/<slug>/` web URL rather than the `/packages/<slug>/content.json` package URL. The web URL bypasses `isPackageContentUrl` so the sibling `manifest.json` is never fetched and the docs panel falls through to a plain `fetchContent` render. Swap the URL form (see "`guideId` URL form" above). Quick console probe to confirm both URL forms exist for your guide: `fetch('https://interactive-learning.grafana.net/packages/<slug>/manifest.json').then(r => r.status)` should return `200`.
- **The Featured card still appears even though the guide auto-launched.** Intentional — the card is kept as a re-entry point if the user closes the auto-launched tab. To suppress it, the `injectHighlightedGuide` seam in `src/context-engine/context.service.ts` would need to gate on auto-launch success.
- **`resetCache: true` didn't clear my marker.** The reset is sentinel-guarded so an operator-facing `true` doesn't re-clear on every reload. Toggle it false → reload → true → reload, or wipe the storage prefix directly.
- **Demos: floating-mode leftovers from older builds.** Pathfinder used to switch to floating mode for highlighted guides. If your `localStorage.grafana-pathfinder-app-panel-mode` is stuck on `'floating'`, run step 4 of the reset snippet.
- **MTFF in production.** This whole flow is local-override only. MTFF flag values aren't editable from the browser — they come from the Grafana Cloud feature-flag service and are evaluated once per page load on boot.
