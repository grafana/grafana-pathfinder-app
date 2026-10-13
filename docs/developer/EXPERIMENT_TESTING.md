# Experiment testing

How to put yourself into a specific experiment arm for local development, QA, and demos. The flag shapes and product intent live in [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md). Use Grafana's feature-control UI rather than a Pathfinder-specific localStorage override.

Open Grafana with `?featureControl=true` (for example, append it to the current URL), open the feature-control UI, and set the relevant Pathfinder flag there. Reload after changing a flag so Pathfinder initializes with the new value. The debug surface created in [`src/utils/experiments/experiment-debug.ts`](../../src/utils/experiments/experiment-debug.ts) remains available for inspecting exposure markers.

## Current experiments

| Flag                                                | Variants                                        | What treatment does                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pathfinder.auto-open-guide-experiment`             | `excluded` / `control` / `treatment`            | `treatment` opens Pathfinder with a configured guide on matched pages (up to three guides). `control` is unchanged.        |
| `pathfinder.interactive-learning-banner-experiment` | `excluded` / `control` / `treatment`            | `treatment` shows a dismissible explanatory banner on the context page and above opened guides. `control` renders nothing. |
| `pathfinder.help-button-nudge-experiment`           | `excluded` / `control` / `learn` / `learn_hint` | A sparkling Learn button beside Help, alone or with a dismissible learning hint; control is unchanged.                     |

See [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) for the full flag shapes and variant tables.

A related pre-post change — **PLG Onboarding Flow Revamp** — auto-opens Pathfinder from the Cloud onboarding survey. It is not a Pathfinder MTFF flag; identify it in analytics by `source` on `pathfinder_docs_panel_interaction`. See [PLG Onboarding Flow Revamp](#plg-onboarding-flow-revamp-pre-post).

## Help-button attention

Use a signed-in Cloud QA stack with analytics and Pathfinder frontend telemetry enabled. Set
`pathfinder.help-button-nudge-experiment` through feature control to `{ "variant": "control" }`,
`{ "variant": "learn" }`, `{ "variant": "learn_hint" }`, or `{ "variant": "excluded" }`, then reload with the sidebar closed.
On older Grafana hosts without local feature-control support, use a remote QA targeting rule.

For a quick visual check without remote assignment, open `?featureControl=true&pathfinderHelpPreview=learn`
(or `control` / `learn_hint`). Preview mode forces the variant through the SDK's development override,
sends no exposure or outcome telemetry, keeps dismissals in memory only, and shows a floating picker
to switch variants and reset. It does not verify assignment or attribution; use the flag override for that.

Disable **Open panel on launch** in the test stack's plugin configuration before this test,
and set `pathfinder.auto-open-sidebar` to `false`. The plugin setting and feature flag are
independent auto-open triggers: overriding the flag alone does not disable the plugin setting.
Avoid auto-open guide experiment payloads and deep links that open the panel. Any opening dismisses
the nudge for the tab, so clear the experiment's tab state after disabling those triggers.
Changing plugin configuration affects the whole stack; use a dedicated QA stack.

Before each fresh run, clear only this experiment's tab state:

```js
Object.keys(sessionStorage)
  .filter(
    (key) =>
      key.startsWith('pathfinder-help-button-nudge-v1:dismissed:') ||
      (key.startsWith('grafana-experiments:v2:') && key.includes('pathfinder-help-button-nudge-v1'))
  )
  .forEach((key) => sessionStorage.removeItem(key));
```

In all three active arms, verify exactly one `experiment_viewed` for the SDK session/assignment and a
`pathfinder_help_button_clicked_toolbar` outcome with the same exposure ID after the first toolbar
click, with `toolbar_target` set to `help` or `learn`. Control must have no Learn button and the
original Help styles. In `learn` and `learn_hint`, the Learn button must sit directly before Help,
open interactive learning, take keyboard focus, and sparkle until the first toolbar click or any
other route opens Pathfinder; afterwards the button stays, without sparkle, through panel open,
close, route changes, and a tab reload. Check light/dark themes, reduced motion (static sparkles),
and a mid-width desktop window for top-bar crowding. In `learn_hint`, the hint must point at Learn
and disappear on a toolbar click or another opening route. Close, and Escape with focus on the hint
or Learn, must dismiss only the hint, preserving subsequent click attribution; dismissal survives a
tab reload. Mobile dropdowns, hidden buttons, excluded/malformed/missing flags, analytics-disabled
sessions, and tabs that opened Pathfinder before the Help button appeared must produce neither a
Learn button nor an exposure. Exposing the toolbar after it mounts late should work.

The legacy `__pathfinderExperiment.clearExposures()` helper does not clear SDK storage. This is a
DOM-based integration: check the selector contract on every supported Grafana version before launch.
Unit tests exercise the real SDK with an in-memory OpenFeature provider; they do not prove remote
assignment, live appearance, or collector delivery.

## Debug-surface API

```js
__pathfinderExperiment.flags; // list of known flag names
__pathfinderExperiment.showExposures(); // lists (flag, variant) pairs already reported to analytics on this browser
__pathfinderExperiment.clearExposures(); // clears the analytics dedup markers so the next reload re-fires pathfinder_feature_flag_evaluated
__pathfinderExperiment.bannerVariant(); // interactive-learning banner arm, or 'not-enrolled' if no panel has opened yet
__pathfinderExperiment.autoOpenGuide(); // { variant, shown }: the auto-open guide arm ('not-enrolled' before activation) and the guides this browser was offered
__pathfinderExperiment.clearAutoOpenGuideMarkers(); // forget which guides were offered, so a reload offers them again
```

`bannerVariant` and `autoOpenGuide` are functions rather than properties because both experiments enroll after boot. Calling them never enrolls you; they only read what enrollment already resolved.

## Reset to a clean baseline

Run this between tests and at the end of a demo. It drops the override, wipes the once-per-browser markers, the panel-mode preference, the analytics exposure dedup markers, and the extension-sidebar docking state.

```js
// 1. Wipe the auto-open guide markers and the SDK's session assignments
__pathfinderExperiment.clearAutoOpenGuideMarkers();
Object.keys(sessionStorage)
  .filter((k) => k.startsWith('grafana-experiments:v2:'))
  .forEach((k) => sessionStorage.removeItem(k));

// 2. Wipe analytics exposure-dedup markers (so pathfinder_feature_flag_evaluated fires again)
__pathfinderExperiment.clearExposures();

// 3. Wipe the interactive-learning banner dismissal
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-interactive-learning-banner-dismissed-'))
  .forEach((k) => localStorage.removeItem(k));

// 4. Clear leftover panel-mode (in case earlier floating-mode tests left it sticky)
localStorage.removeItem('grafana-pathfinder-app-panel-mode');

// 5. Release the extension sidebar in case another plugin (Assistant, IRM, …) is docked
localStorage.removeItem('grafana.navigation.extensionSidebarDocked');

location.reload();
```

After the reload, Pathfinder behaves like a brand-new visitor: no overrides, no markers, no docked plugin.

## `pathfinder.auto-open-guide-experiment`

Tests whether opening Pathfinder with a relevant guide, on a page the operator chose, increases guide starts and completions. On a matched page, `treatment` opens the sidebar and launches the guide as a tab through the same `auto-launch-tutorial` seam as `?doc=`; the user stays where they were. `control` is counted at the same moment and sees nothing. The payload and enrollment rules are in [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md#pathfinderauto-open-guide-experiment).

### Prerequisites

The experiment runs on `@grafana-experiments/sdk`, which needs Pathfinder's Faro instance, so it only starts on a Cloud stack with `pathfinder.frontend-telemetry` on, a signed-in user, and analytics enabled. Locally there is no Faro, so it never activates; use the unit tests in `src/utils/experiments/auto-open-guide/` for the mechanics. Also disable **Open panel on launch** and `pathfinder.auto-open-sidebar`: Pathfinder must be closed and the extension sidebar undocked for an offer to happen.

### Selecting an arm

Open Grafana with `?featureControl=true`, set `pathfinder.auto-open-guide-experiment` in the feature-control UI, and reload:

```json
{
  "variant": "treatment",
  "experiences": [{ "guide": "bundled:first-dashboard", "pages": ["/explore*"] }]
}
```

Use `"variant": "control"` for the control arm. Navigate to a matched page with Pathfinder closed:

- **Treatment:** Pathfinder opens with the guide, and the guide leads the Featured slot on that page.
- **Control:** nothing visible changes. `__pathfinderExperiment.autoOpenGuide()` reports `control`.
- **Either arm:** a second visit does not offer the same guide again. A second experience is offered on its own page.

For interactive-learning guides, use the package content URL `https://interactive-learning.grafana.net/packages/<slug>/content.json`. The `/guides/<slug>/` web form bypasses `isPackageContentUrl`, so the guide opens as a single page with no milestones.

### Re-testing

Each guide is offered once per browser. Run `__pathfinderExperiment.clearAutoOpenGuideMarkers()`, clear the SDK's `grafana-experiments:v2:` sessionStorage entries (step 1 of the reset snippet), then reload. The legacy `clearExposures()` helper does not touch SDK storage.

### Verifying analytics

| Event                                 | When                                                    | Key properties                                                                                           |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `experiment_viewed` (Faro)            | Once per SDK session and assignment, at the first offer | `experiment_id: pathfinder-auto-open-guide-v1`, `variant`, `exposure_id`                                 |
| `pathfinder_auto_open_guide_eligible` | Every offer, in both arms                               | `experiment_auto_open_guide`, `exposure_id`, `experience_index`, `opened`                                |
| `pathfinder_docs_panel_interaction`   | Treatment, when the sidebar mounts after the pop-out    | `action: 'auto-open'`, `source: 'auto_open_guide_experiment'`, `experiments` enrichment                  |
| `pathfinder_open_resource_click`      | Treatment, when the guide auto-launches as a tab        | `trigger_source: 'auto_launch_tutorial'`, `interaction_location: 'docs_panel'`, `experiments` enrichment |

After activation, every Pathfinder analytics event carries the arm in `experiments`, so guide progress and completion can be compared across arms.

## Legacy exposure dedup (`pathfinder_feature_flag_evaluated`)

The interactive-learning banner still uses the legacy `TrackingHook` exposure. The SDK experiments (auto-open guide, Help button nudge) do not.

### Why the exposure event might not fire

`pathfinder_feature_flag_evaluated` is **deduped per browser per (hostname, flag, variant)** — once you've been exposed to an arm on a given stack, the event won't refire on subsequent page loads. This keeps exposure-event volume proportional to "users in each arm" rather than "pageviews per user," which is what every A/B analysis tool expects.

The dedup state lives in `localStorage` under `grafana-pathfinder-experiment-exposure-reported-{hostname}:{flagKey}:{variant}`. The debug surface exposes two helpers for inspecting and resetting it:

```js
// Inspect: which (flag, variant) tuples have already fired the event on this stack?
// Returns an array of { key, flag, variant } and pretty-prints the count.
__pathfinderExperiment.showExposures();
// e.g. → [
//   { key: '…interactive-learning-banner-experiment:control', flag: 'pathfinder.interactive-learning-banner-experiment', variant: 'control' },
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

Open Grafana with `?featureControl=true`, set `pathfinder.interactive-learning-banner-experiment` to `{ variant: 'treatment' }` in the feature-control UI, and reload.

Open the sidebar. The banner sits above the profile bar, and its only control is the dismiss affordance.

### Above an opened guide

The banner has a second placement, above rendered guide content, so a guide reached without ever passing through the context page still explains itself. Auto-open is the case worth checking:

```js
// With the treatment arm set, load a guide directly — no sidebar visit first.
location.href = '/?doc=<guide-url>';
```

The banner appears above the guide content, and the shown event carries `interaction_location: interactive_learning_banner_guide` rather than `interactive_learning_banner`. Both placements share one dismissal: close it above the guide, hit "Return to my learning", and it is gone from the context page too (and the reverse).

For the floating and full-screen surfaces, add `&panelMode=floating` or `&panelMode=fullscreen`. Those enroll from their own mount effects, so the exposure fires even though the sidebar never mounted.

### Control

Set `pathfinder.interactive-learning-banner-experiment` to `{ variant: 'control' }` in Grafana's feature-control UI and reload.

No banner. The exposure event still fires on first sidebar open — that is the point of a control arm.

### Enrollment fires on panel open, not on boot

The flag is evaluated lazily the first time any Pathfinder surface mounts (sidebar, floating, or full-screen), so:

- `__pathfinderExperiment.bannerVariant()` returns `'not-enrolled'` until you open Pathfinder, then the arm.
- `pathfinder_feature_flag_evaluated` for this flag appears on first panel open, not on page load. If you are watching the network tab from boot expecting it immediately, that is why it is missing.
- Reloading without opening Pathfinder produces no exposure at all. That is intended — a user who never opened the panel never had the chance to see the banner.

Concretely, the exposure fires on the first of these in a browser:

- the sidebar opens, or
- a guide or learning path renders for the first time in any mode (sidebar, floating, or full-screen)

### Verifying banner analytics

Filter Rudderstack (or your local analytics tap) for:

| Event                                              | When                                                                                          | Key properties                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pathfinder_feature_flag_evaluated`                | First sidebar open **or** first guide / learning-path render in any mode — never on page load | `flag_key: pathfinder.interactive-learning-banner-experiment`, `tracking_key`, `variant` |
| `pathfinder_interactive_learning_banner_shown`     | Banner actually painted (once per page load, whichever placement rendered first)              | `interaction_location`                                                                   |
| `pathfinder_interactive_learning_banner_dismissed` | User dismisses the banner                                                                     | `interaction_location`                                                                   |

`interaction_location` is the placement:

| Value                               | Placement                              |
| ----------------------------------- | -------------------------------------- |
| `interactive_learning_banner`       | Context page (above the profile bar)   |
| `interactive_learning_banner_guide` | Above a rendered guide / learning path |

Control renders nothing, so `shown` and `dismissed` are **treatment-only by construction**. Do not use them for the engagement comparison — they cannot exist on control. Compare guide-interaction events that carry the experiments enrichment (`pathfinder_open_resource_click`, `pathfinder_docs_panel_interaction`, Show me / Do it, and so on). The exposure event is the one that exists on both arms.

The per-browser `(hostname, flag, variant)` dedup described under [Legacy exposure dedup](#legacy-exposure-dedup-pathfinder_feature_flag_evaluated) applies. Use `__pathfinderExperiment.showExposures()` / `clearExposures()` if you expect an exposure and it is missing.

### Resetting the dismissal

The banner stays dismissed per browser. Changing the feature-control value does not clear it:

```js
Object.keys(localStorage)
  .filter((k) => k.startsWith('grafana-pathfinder-interactive-learning-banner-dismissed-'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

## PLG Onboarding Flow Revamp (pre-post)

This is **not** a Pathfinder MTFF experiment and has no `__pathfinderExperiment` override. From **2026-08-26 00:00 UTC**, the Grafana Cloud onboarding flow (setup-guide) auto-opens Pathfinder when a user who clicked the Frontend Observability or Synthetics recommendation tile lands on the matching product page.

The parent onboarding A/B is `setup-guide.onboarding-plg` (treatment = the survey-led onboarding). The Pathfinder auto-open is a follow-on change on that treatment experience, analysed as a **pre vs post** cut — not a Pathfinder `control` / `treatment` split.

Do not confuse these auto-opens with [`pathfinder.auto-open-guide-experiment`](#pathfinderauto-open-guide-experiment). That flag tags `source: 'auto_open_guide_experiment'`. The onboarding revamp tags a dedicated `plg-survey-*` source.

### How to identify the cohort

Spine: `grafanalabs-global.rudderstack.pathfinder_docs_panel_interaction` where `action = 'auto-open'` and `source` is one of:

| `source`                   | Survey tile (`onboarding_flow_event.component_key_properties_recommendation`) | Product page                                        |
| -------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| `plg-survey-frontend-o11y` | `frontend-o11y`                                                               | FE O11y / Kowalski (`/a/grafana-kowalski-app*`)     |
| `plg-survey-monitor-url`   | `monitor-url`                                                                 | Synthetics (`/a/grafana-synthetic-monitoring-app*`) |

The auto-open row does **not** carry `resource_info`, `suggested_urls`, or `experiments.guideId` for these sources (all null). The guide that opened is the first `pathfinder_open_resource_click` with `interaction_location = 'docs_panel'` immediately after auto-open:

| `source`                   | Guide slug                       |
| -------------------------- | -------------------------------- |
| `plg-survey-frontend-o11y` | `welcome-frontend-observability` |
| `plg-survey-monitor-url`   | `sm-ping-check-tutorial`         |

### Pre vs post windows

| Period                               | Clock                                             | Cohort event                                                                                     |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pre-change (no Pathfinder auto-open) | 2026-08-04 00:00 UTC through 2026-08-26 00:00 UTC | Survey-tile click (`onboarding_survey_recommendation_click` for `frontend-o11y` / `monitor-url`) |
| Post-change                          | 2026-08-26 00:00 UTC onward                       | `plg-survey-*` auto-open                                                                         |

Join `setup-guide.onboarding-plg` separately if you need the parent A/B population. Not every `plg-survey-*` auto-open has a `feature_toggle_event` row on `user_id` — resolve assignment on `org_id` (and tolerate null `user_id` on the flag).

### Gotchas for this readout

- **Never use `context_traits_org_id`** on these Rudderstack events — it is org 1. Resolve org via instance URL + `user_id` / email through `stg_grafana_instance_url_xref` (same pattern as `rpt_pathfinder_onboarding_experiment`).
- `plg-survey-*` is an **analytics source string** set by the onboarding flow when it auto-opens the sidebar. It is not a Pathfinder `LaunchSource`, so alignment-prompt classification treats it as unknown (needs check). That does not affect the auto-open event itself.
- Staff users should be excluded via `core_users.is_staff`, not by filtering Rudderstack traits.

## Common gotchas

- **`__pathfinderExperiment` is undefined.** Pathfinder is dismounted — the `pathfinder.enabled` kill-switch is `false`. Open Grafana with `?featureControl=true`, enable the flag in the feature-control UI, and reload.
- **A feature-control value had no effect.** Confirm the JSON shape and variant spelling, then reload. Anything outside `excluded` / `control` / `treatment` is rejected by the flag consumer. An auto-open guide payload with an unresolvable guide, no pages, or more than three experiences is rejected whole. See [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md#pathfinderauto-open-guide-experiment).
- **The auto-open guide experiment never activates.** Check the prerequisites above: no Faro locally, Pathfinder must be closed, nothing docked, no `?doc=` on the URL, and the guide not already offered on this browser.
- **Only one page renders / no milestones for an interactive-learning guide.** The guide points at the `/guides/<slug>/` web URL rather than the `/packages/<slug>/content.json` package URL. The web URL bypasses `isPackageContentUrl` so the sibling `manifest.json` is never fetched and the docs panel falls through to a plain `fetchContent` render. Quick console probe: `fetch('https://interactive-learning.grafana.net/packages/<slug>/manifest.json').then(r => r.status)` should return `200`.
- **The Featured card still appears after closing the auto-launched guide.** Intentional in treatment — the card is the way back to the guide.
- **Demos: floating-mode leftovers from older builds.** Pathfinder used to switch to floating mode for highlighted guides. If your `localStorage.grafana-pathfinder-app-panel-mode` is stuck on `'floating'`, run step 4 of the reset snippet.
- **MTFF in production.** Feature-control values are local browser overrides for development and QA. Production MTFF values come from the Grafana Cloud feature-flag service and are evaluated once per page load on boot.
