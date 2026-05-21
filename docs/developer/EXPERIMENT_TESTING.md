# Experiment testing

How to force yourself into a specific experiment arm for local development, QA, and demos. The flag shapes and product intent live in [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) — this doc focuses on the manual override workflow.

All overrides go through `window.__pathfinderExperiment`, the debug surface created in [`src/utils/experiments/experiment-debug.ts`](../../src/utils/experiments/experiment-debug.ts) at plugin boot. It's available in any DevTools console where Pathfinder is loaded — except when Pathfinder is fully dismounted (the existing `pathfinder.experiment-variant` `control` arm hides the plugin, taking the debug surface with it; use raw `localStorage` writes in that case).

## Current experiments

| Flag                                      | Variants                             | What treatment does                                                                                                     |
| ----------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `pathfinder.experiment-variant`           | `excluded` / `control` / `treatment` | `control` hides Pathfinder entirely; `treatment` mounts the sidebar and auto-opens on `pages[]`.                        |
| `pathfinder.after-24h-experiment`         | `excluded` / `control` / `treatment` | `control` hides Pathfinder for users who first appeared >24h ago.                                                       |
| `pathfinder.highlighted-guide-experiment` | `excluded` / `control` / `treatment` | Both `control` and `treatment` keep Pathfinder visible — they differ only in which `guideId` is auto-opened + featured. |

See [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) for the full flag shapes and variant tables.

## Debug-surface API

```js
__pathfinderExperiment.flags; // list of known flag names
__pathfinderExperiment.setOverride(flag, value);
__pathfinderExperiment.removeOverride(flag);
__pathfinderExperiment.clearOverrides();
__pathfinderExperiment.showOverrides(); // returns the current overrides object
__pathfinderExperiment.showCache(); // dumps per-page treatment keys + reset sentinel + user-storage
__pathfinderExperiment.clearCache(); // clears the main-experiment auto-open tracking (sessionStorage + user-storage)
__pathfinderExperiment.refetch(); // re-evaluates pathfinder.experiment-variant from MTFF (5s rate limit)
__pathfinderExperiment.showExposures(); // lists (flag, variant) pairs already reported to analytics on this browser
__pathfinderExperiment.clearExposures(); // clears the analytics dedup markers so the next reload re-fires pathfinder_feature_flag_evaluated
```

Overrides are persisted in `localStorage` under `grafana-pathfinder-flag-overrides`, evaluated on every page load via the synchronous `getFeatureFlagValue` / `getExperimentConfig` / `getHighlightedGuideConfig` readers — they bypass MTFF entirely and produce a `[OpenFeature] Using local override for '<flag>'` warning every time they're read, which doubles as a visible reminder that you're in dev mode.

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

// 4. Clear leftover panel-mode (in case earlier floating-mode tests left it sticky)
localStorage.removeItem('grafana-pathfinder-app-panel-mode');

// 5. Release the extension sidebar in case another plugin (Assistant, IRM, …) is docked
localStorage.removeItem('grafana.navigation.extensionSidebarDocked');

location.reload();
```

After the reload, Pathfinder behaves like a brand-new visitor: no overrides, no markers, no docked plugin.

## `pathfinder.experiment-variant`

Forces the user into the main pathfinder experiment. **`control` dismounts Pathfinder entirely** — use this when validating "what does the product look like with no Pathfinder."

```js
// Treatment: sidebar auto-opens on the listed pages
__pathfinderExperiment.setOverride('pathfinder.experiment-variant', {
  variant: 'treatment',
  pages: ['/dashboards*', '/explore'],
  resetCache: false,
});
location.reload();

// Control: Pathfinder dismounted; native Grafana help only
__pathfinderExperiment.setOverride('pathfinder.experiment-variant', {
  variant: 'control',
  pages: [],
  resetCache: false,
});
location.reload();
```

After reload in `control`, `__pathfinderExperiment` is gone (Pathfinder didn't mount). To roll back, write to `localStorage.grafana-pathfinder-flag-overrides` directly or clear the key:

```js
localStorage.removeItem('grafana-pathfinder-flag-overrides');
location.reload();
```

**Resetting per-page auto-open markers**: the treatment arm tracks per-page auto-opens so the sidebar doesn't re-open on every reload of the same page. To re-test:

```js
// Either toggle resetCache once (sentinel-guarded — see FEATURE_FLAGS.md)
__pathfinderExperiment.setOverride('pathfinder.experiment-variant', {
  variant: 'treatment',
  pages: ['/dashboards*'],
  resetCache: true,
});
location.reload();

// Or nuke the cache via the debug helper
__pathfinderExperiment.clearCache();
location.reload();
```

## `pathfinder.after-24h-experiment`

Same shape as `pathfinder.experiment-variant`. `control` also dismounts Pathfinder.

```js
__pathfinderExperiment.setOverride('pathfinder.after-24h-experiment', {
  variant: 'control',
  pages: [],
  resetCache: false,
});
location.reload();
```

## `pathfinder.highlighted-guide-experiment`

A/B test for guide content. Both `control` and `treatment` keep Pathfinder visible, auto-open the sidebar, **and auto-launch the configured `guideId` as a tab** on matched pages — using the same `auto-launch-tutorial` seam as the `?doc=` deep link. The user stays on the page they were on; no navigation happens. The Featured-slot injection still runs in parallel so the card is also visible in the recommendations tab. Use this to compare two candidate guides on the same page.

### `guideId` URL form (read this before configuring an interactive-learning guide)

For guides hosted on `interactive-learning.grafana.net`, **always use the package content URL**:

```
https://interactive-learning.grafana.net/packages/<slug>/content.json
```

This is the form `openLearningJourney` / `openDocsPage` recognise as a package URL (`isPackageContentUrl` in [src/docs-retrieval/package-info-from-url.ts](../../src/docs-retrieval/package-info-from-url.ts)) — that's the gate that triggers the sibling `manifest.json` fetch which populates milestones, the toolbar, and the multi-page navigation. The platform also serves the same guide under `https://interactive-learning.grafana.net/guides/<slug>/`, but that public web-page form bypasses the package gate and falls through to a plain `fetchContent(url)` call — the guide opens as a single page with no milestones. If you only see one page when you expected a learning journey, this is almost always the URL form. See "Common gotchas" below.

### Treatment — interactive package

```js
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  variant: 'treatment',
  pages: ['/a/grafana-irm-app*'],
  guideId: 'https://interactive-learning.grafana.net/packages/irm-configuration/content.json',
  docType: 'interactive',
  autoOpen: true,
  resetCache: false,
});
location.reload();
```

### Control — learning journey

Forces the Featured card type to `learning-journey` so the click-through opens with milestone UI rather than as a single docs page.

```js
__pathfinderExperiment.setOverride('pathfinder.highlighted-guide-experiment', {
  variant: 'control',
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

## Common gotchas

- **`__pathfinderExperiment` is undefined.** Pathfinder is dismounted — usually because you're in `control` on `pathfinder.experiment-variant` or `pathfinder.after-24h-experiment`. Clear `localStorage.grafana-pathfinder-flag-overrides` and reload, or write the override directly into `localStorage`.
- **Auto-launch landed but I see the wrong tab.** The orchestrator dispatches `auto-launch-tutorial` which calls `openDocsPage` / `openLearningJourney` — those make the new guide tab active automatically. If you instead see the editor / devtools tab from a prior session, the configured `guideId` failed to resolve through `findDocPage`: check the console for `findDocPage returned null for guideId="…"` and fix the id (`bundled:<id>`, `api:<id>`, or a full URL on a whitelisted host).
- **Auto-launch fires but the guide opens as the wrong type (docs page vs learning journey).** Set the flag's `docType` explicitly (`'docs-page' | 'learning-journey' | 'interactive'`). The operator override wins over `findDocPage`'s URL-based inference.
- **Only one page renders / no milestones for an interactive-learning guide.** `guideId` is pointing at the `/guides/<slug>/` web URL rather than the `/packages/<slug>/content.json` package URL. The web URL bypasses `isPackageContentUrl` so the sibling `manifest.json` is never fetched and the docs panel falls through to a plain `fetchContent` render. Swap the URL form (see "`guideId` URL form" above). Quick console probe to confirm both URL forms exist for your guide: `fetch('https://interactive-learning.grafana.net/packages/<slug>/manifest.json').then(r => r.status)` should return `200`.
- **The Featured card still appears even though the guide auto-launched.** Intentional — the card is kept as a re-entry point if the user closes the auto-launched tab. To suppress it, the `injectHighlightedGuide` seam in `src/context-engine/context.service.ts` would need to gate on auto-launch success.
- **`resetCache: true` didn't clear my marker.** The reset is sentinel-guarded so an operator-facing `true` doesn't re-clear on every reload. Toggle it false → reload → true → reload, or wipe the storage prefix directly.
- **Demos: floating-mode leftovers from older builds.** Pathfinder used to switch to floating mode for highlighted guides. If your `localStorage.grafana-pathfinder-app-panel-mode` is stuck on `'floating'`, run step 4 of the reset snippet.
- **MTFF in production.** This whole flow is local-override only. MTFF flag values aren't editable from the browser — they come from the Grafana Cloud feature-flag service and are evaluated once per page load on boot.
