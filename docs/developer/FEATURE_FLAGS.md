# Feature flags in grafana-pathfinder-app

This document explains how feature flags are implemented in the grafana-pathfinder-app plugin using the OpenFeature SDK and Grafana's Multi-Tenant Feature Flag Service (MTFF).

## Overview

The plugin uses the [OpenFeature](https://openfeature.dev/) standard with the OFREP Web Provider to evaluate feature flags dynamically at runtime via Grafana Cloud's MTFF service. This approach:

- Leverages a vendor-neutral open standard (OpenFeature)
- Supports boolean, string, number, and object-valued flags
- Enables A/B experiments with variant assignment and targeting
- Provides domain-isolated evaluation (does not conflict with Grafana core or other plugins)
- Includes automatic analytics tracking via `TrackingHook`

## Current feature flags

### `pathfinder.enabled`

**Type**: Boolean

**Purpose**: Global kill-switch for the Pathfinder plugin during cloud-wide rollout. This is separate from the A/B experiments — it controls whether Pathfinder is available at all for a given stack.

**Default**: `true` (Pathfinder loads normally if the flag is not set)

**Behavior**:

- **`true`**: Pathfinder loads normally — sidebar is available, the highlighted-guide experiment runs as configured
- **`false`**: Plugin is dismounted, the native Grafana help menu takes over

**Important**: This is the only gate on whether Pathfinder mounts. It is evaluated independently of the highlighted-guide experiment: setting `pathfinder.enabled` to `false` dismounts the plugin regardless; when `true`, the experiment applies as normal.

**Tracking key**: `pathfinder_enabled`

---

### `pathfinder.frontend-telemetry`

**Type**: Boolean

**Purpose**: Remote kill-switch for the Faro telemetry stream (errors, sessions, views, logs, and the analytics-event mirror). Independent of `pathfinder.enabled` — this stops the telemetry, not the plugin. Telemetry is already gated to Grafana Cloud; the flag exists so the stream can be cut fleet-wide without a release if the collector or the filtering misbehaves.

**Default**: `true` (telemetry runs if the flag is not set, and if MTFF is unreachable)

**Behavior**:

- **`true`**: `initFaro()` runs, subject to its own Grafana Cloud / analytics-enabled / hostname gates
- **`false`**: the Faro SDK chunk is never even imported

**Tracking key**: `frontend_telemetry`

---

### `pathfinder.session-replay`

**Type**: Boolean

**Purpose**: Records a masked rrweb session replay of the page, so a guide that goes wrong can be watched back rather than reconstructed from events. Requires `pathfinder.frontend-telemetry`, which owns the Faro instance the recording rides on.

**Default**: `true` (recording happens if the flag is not set, and if MTFF is unreachable)

**Behavior**:

- **`true`**: the recorder is registered the first time Pathfinder is opened in any surface, and runs for the rest of the page — including after Pathfinder is closed again
- **`false`**: neither the replay module nor the rrweb bundle is fetched

**This flag is read once, at plugin bootstrap.** Flipping it to `false` stops _new_ recordings; a tab that is already recording carries on until it is reloaded or closed, and recordings already ingested are unaffected. See [Stopping a recording](TELEMETRY.md#stopping-a-recording) for why, and for what the actual remediation path is.

**Important**: this is an off-switch, not an opt-in — recording is the default state on every Cloud stack where telemetry is enabled. Two consequences worth holding onto:

1. **Never let this run alongside Grafana core's own recorder.** Core ships one behind the `faroSessionReplay` toggle, which is `@default false` in `@grafana/data` — so there is no automatic default-state collision; it takes an operator deliberately enabling core's toggle on a stack that also has this flag on. The consequence if that happens is real: two rrweb instances on one page double DOM serialization per mutation, and rrweb's global proxy of `CSSStyleSheet.prototype.insertRule` is not idempotent-guarded, so they compound on Emotion's hot path. `resolveSessionReplayOptions` yields automatically when `config.featureToggles.faroSessionReplay === true`, but that toggle is private-preview and may not be surfaced to the frontend at all, so still set `pathfinder.session-replay` to `false` on any stack where core's goes true.
2. Recordings are only playable on a stack with Grafana's private-preview Session Replay enabled. That is already on for the ops stack Pathfinder reports to; elsewhere the events are ingested with no UI to view them.

See the privacy invariants in [`TELEMETRY.md`](TELEMETRY.md) for what masking does and does not cover.

**Tracking key**: `session_replay`

---

### `pathfinder.session-replay-sampling-rate`

**Type**: Number

**Purpose**: Volume dial on top of `pathfinder.session-replay` — the fraction of replay-eligible sessions that actually get recorded. Every rrweb event becomes a Faro event carrying a JSON DOM payload, and a Grafana dashboard mutates continuously, so this is the knob to reach for if collector volume becomes a problem before reaching for the switch.

**Default**: `1` (record every eligible session)

**Behavior**: the decision is a deterministic hash of the session id, so a session either has a recording for its whole life or never does — you never get half a replay. `0` records nobody, same net effect as setting `pathfinder.session-replay` to `false`, the difference being intent: the boolean says "off", the rate says "sampled out".

**Important**: this is a remote number, so it can arrive as anything. `resolveSamplingRate` in `src/lib/telemetry/replay.ts` range-checks it at the point of use and **falls back to `1`** for anything that isn't a finite number in `[0, 1]` — a `100` meant as a percentage, a string from a mistyped MTFF value, `NaN`. An earlier Faro sample-rate flag was deleted rather than clamped ([#1275](https://github.com/grafana/grafana-pathfinder-app/pull/1275)) precisely because a fat-fingered value was indistinguishable from a deliberate one; failing to the default rather than to zero is what earns this one its place.

**Tracking key**: `session_replay_sampling_rate`

---

### `pathfinder.auto-open-sidebar`

**Type**: Boolean

**Purpose**: Controls whether the sidebar automatically opens on first Grafana load per session. Users can always change this setting afterwards via plugin configuration.

**Default**: `false` (uses `DEFAULT_OPEN_PANEL_ON_LAUNCH` constant from `src/constants.ts`)

**Behavior**:

- **`true`**: Sidebar auto-opens on first page load per session
- **`false`**: Sidebar only opens when the user explicitly requests it

**Important**: The feature flag only sets the **initial/default value**. Users can always override it in plugin settings. The resolution priority is:

1. User's saved preference in plugin settings (takes precedence)
2. Feature flag value from MTFF
3. `DEFAULT_OPEN_PANEL_ON_LAUNCH` constant (fallback)

**Behavior on launch**: When enabled, the sidebar auto-opens on each Grafana load (deferred past the onboarding flow as described below). There is no persistent "already shown" suppression — the toggle simply reflects whether the panel opens on launch. This config-driven auto-open lives in `src/utils/sidebar-auto-open.ts`.

**Onboarding flow integration**: If a user first lands on the setup guide onboarding flow (`/a/grafana-setupguide-app/onboarding-flow`), the plugin defers auto-open. It listens for navigation events via `locationService.getHistory().listen()` (with a `popstate` fallback) and triggers auto-open when the user navigates away from onboarding to normal Grafana pages.

**Tracking key**: `auto_open_sidebar`

---

### `pathfinder.highlighted-guide-experiment`

**Type**: Object (`HighlightedGuideConfig`)

**Purpose**: A/B test which guide performs better when surfaced as the featured guide on a specific Grafana page. Both arms keep Pathfinder visible — they differ only in which guide id is highlighted. When a matched page is visited, the Pathfinder sidebar auto-opens (once per browser per `guideId`) **and the configured guide is auto-launched as a sidebar tab** — the same seam used by the `?doc=` deep link. The user stays on the page they were on; no `locationService.replace` is called. The Featured-slot injection still runs in parallel so the card remains a re-entry point if the user closes the auto-launched tab.

This flag is independent of `pathfinder.experiment-variant`: it does not hide Pathfinder, and its auto-open will simply no-op when the user's existing experiment dismounts the plugin.

**Default**: `{ variant: 'excluded', pages: [], guideId: '', autoOpen: true, resetCache: false }`

**Returned object shape**:

```typescript
interface HighlightedGuideConfig {
  variant: 'excluded' | 'control' | 'treatment';
  pages: string[]; // URL path patterns where the sidebar should auto-open (empty ⇒ no match)
  guideId: string; // Doc id or shorthand: 'bundled:<id>' | 'api:<id>' | 'backend-guide:<id>' | full URL
  autoOpen: boolean; // false ⇒ only Featured-slot injection, no auto-open of the sidebar
  resetCache: boolean; // When toggled true, clears the once-per-browser markers
  docType?: 'docs-page' | 'learning-journey' | 'interactive';
  // Optional override for the Featured-card type and click-through flow. When omitted,
  // `findDocPage` infers the type from the URL pattern. Set explicitly when the inference
  // is wrong — e.g. a `/docs/learning-paths/...` URL that should open as a learning journey.
}
```

**Variant behavior**:

| Variant     | Auto-launch + injection | Notes                                                                              |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `excluded`  | No                      | Normal Pathfinder behavior — flag is a no-op                                       |
| `control`   | Yes (variant A)         | Open sidebar + auto-launch the arm's `guideId` as a tab + inject Featured (slot A) |
| `treatment` | Yes (variant B)         | Open sidebar + auto-launch the arm's `guideId` as a tab + inject Featured (slot B) |

A typical A/B setup serves the **same** `pages[]` to both arms with **different** `guideId` values, so the only thing varying between cohorts is the guide content. Analytics distinguishes which arm via the existing `TrackingHook` exposure event (`pathfinder_feature_flag_evaluated` with `tracking_key: highlighted_guide_experiment`).

**Those three values are the whole set.** The variant arrives from MTFF, so it can be anything; a value outside the table — a typo'd `treament`, a stale arm name, an empty string — rejects the **entire** payload. Rejection is whole-payload, not field-level: `pages`, `guideId`, `docType` and `resetCache` are all discarded along with the bad variant, so "rename an arm and set `resetCache: true`" clears nothing. Nobody is enrolled — no auto-open, no once-per-browser marker, and no arm attached to analytics or session telemetry. Renaming an arm therefore turns it off rather than half-enrolling its cohort under a bogus label.

**Where a rejected payload lands depends on the source**, which is the thing to know when debugging:

| Rejected payload from             | Result                                                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MTFF (the remote flag)            | The default `excluded` config above                                                                                                                             |
| `localStorage` override (QA/demo) | The override is **ignored** and the remote MTFF value applies. Locally there is no MTFF provider, so this looks like the default — on a Cloud stack it does not |

Either way the plugin logs a `warn` naming the source and a low-cardinality reason (`unknown_variant` or `invalid_shape`), once per source per page load. An unrecognized variant never produced a `pathfinder_feature_flag_evaluated` exposure event in the first place — `reportFeatureFlagExposure` only tracks `control` and `treatment` — so exposure counts are not a signal that a payload is broken. The `warn` is.

**Page-pattern semantics — note the difference**: Empty `pages` is treated as **no match**, NOT "all pages" (unlike `pathfinder.experiment-variant`). This makes the safe default of `{ variant: 'excluded', pages: [] }` a true no-op even if the variant is accidentally flipped without configuring pages. Patterns support the same `*` suffix wildcards as `matchPathPattern`.

**Once-per-browser semantics**: The auto-open marker is keyed `{hostname}:{guideId}` in localStorage (not sessionStorage). A new `guideId` from MTFF — including the arm-specific value at variant assignment time — produces a new key, so changing the experiment's guide naturally re-fires auto-open without operator intervention. Use `resetCache: true` to force-clear all markers for the current hostname (sentinel-guarded so true→true reloads don't repeatedly clear).

**Injection-only mode**: When `autoOpen` is `false`, both the sidebar auto-open _and_ the auto-launch of the guide tab are suppressed, but the Featured-slot injection still runs on matched pages. Useful for a subtler treatment variant where the operator wants the card visible without forcibly opening the sidebar.

**Auto-launch dispatch mechanics** (for QA / debugging): on a matched page, the orchestrator resolves the `guideId` through `findDocPage`, publishes `open-extension-sidebar`, waits for either `pathfinder-sidebar-mounted` or `pathfinder-panel-mounted`, then dispatches `auto-launch-tutorial` (the same event `?doc=` uses) tagged with `source: 'highlighted_guide_experiment'`. The `useAutoLaunchTutorial` hook routes that to `openDocsPage` / `openLearningJourney` depending on the resolved `type` (with the flag's `docType` winning over `findDocPage`'s URL-based inference). If `findDocPage` returns `null` for the configured `guideId` (typo, unsupported URL), the sidebar still opens and the Featured-slot card is the user's only entry point.

**Tracking key**: `highlighted_guide_experiment`

**Launch source**: Guide tabs opened by this flag are tagged with the `highlighted_guide_experiment` `LaunchSource` (aligned-by-construction — no alignment prompt is shown, since the operator already targeted the page).

### `pathfinder.interactive-learning-banner-experiment`

**Purpose**: A/B test whether an explanatory banner at the top of the context page increases engagement with interactive guides.

**Type**: `object` (experiment flag — object-valued so it emits exposure events)

**Default**: `{ variant: 'excluded' }`

**Shape**: variant-only. Unlike the highlighted-guide flag there is no `pages` targeting — the banner explains Pathfinder itself, not the underlying Grafana page.

```typescript
interface InteractiveLearningBannerConfig {
  variant: 'excluded' | 'control' | 'treatment';
}
```

**Variant behavior**:

| Variant     | Banner | Notes                                                            |
| ----------- | ------ | ---------------------------------------------------------------- |
| `excluded`  | No     | Not in the experiment. Identical to pre-experiment behavior.     |
| `control`   | No     | In the experiment, no banner. Identical rendering to `excluded`. |
| `treatment` | Yes    | Dismissible explanatory banner at the top of the context page.   |

A rejected payload (not an object, missing `variant`, or an unknown arm) falls back to `excluded`, so a fat-fingered MTFF value enrolls nobody. Rejection sources behave the same way as the highlighted-guide flag (see the table above).

**Exposure timing — this flag differs from the others.** Every other flag is read at boot in `src/module.tsx`, so its exposure fires on page load. This one is read lazily by `enrollInteractiveLearningBannerExperiment` when a Pathfinder panel first opens, because "entered the experiment" should mean "had the chance to see the banner". Evaluating the flag is what emits the exposure, so the call site is the timing contract — `src/utils/experiments/enrollment-boundary.test.ts` pins the allowed call sites for that reason. `getActiveExperiments` reads the memoised arm rather than evaluating, so analytics enrichment can never enroll a user who has not opened Pathfinder.

Enrollment also re-stamps the Faro session `experiments` attribute, because `initFaro` stamped it at boot before any arm was known. That re-stamp lives inside `enrollInteractiveLearningBannerExperiment` rather than at a panel-open seam: it is the only point ordered after the arm resolves, and it covers every surface (sidebar, floating, full-screen) without each having to remember to do it. Expect the session attribute to gain this cohort mid-session, on first panel open.

**Dismissal**: persisted per browser under `grafana-pathfinder-interactive-learning-banner-dismissed-{hostname}`. Dismissing hides the banner permanently but does **not** un-enroll the user — they stay in the treatment arm for analysis.

**Behavior events** (in addition to the exposure): `pathfinder_interactive_learning_banner_shown` (once per page load) and `..._banner_dismissed`, both carrying `interaction_location: interactive_learning_banner`.

**Code**: everything except the registry entry lives in [`src/utils/experiments/interactive-learning-banner.ts`](../../src/utils/experiments/interactive-learning-banner.ts) and [`src/components/InteractiveLearningBanner/`](../../src/components/InteractiveLearningBanner/), so retiring the experiment is a directory delete plus the registry entry.

**Tracking key**: `interactive_learning_banner_experiment`

---

## Backend aggregation toggles (not MTFF)

Separate from the OpenFeature flags above, two Grafana **App Platform APIService aggregation toggles** gate whether the plugin's aggregated backend APIs are served on a stack. They live in core Grafana config (`config.featureToggles`), not MTFF, and are read server-side in the Go backend — not through `openfeature.ts`. They are **not interchangeable**: each gates a different API group, and enabling one does not enable the other.

| Toggle                                                  | Gates                                                                                                              | Go constant                                                                     | Group         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------- |
| `aggregation.pathfinderbackend-ext-grafana-app.enabled` | Custom guide catalogue + the private `interactiveguides` resolver (the whole Custom Guides / private-path surface) | `customGuideAggregationToggle` (`pkg/plugin/custom_guide_repository_client.go`) | GAP `.app`    |
| `aggregation.pathfinderbackend-ext-grafana-com.enabled` | The completion-records proxy                                                                                       | `pathfinderBackendAggregationToggle` (`pkg/plugin/app_platform_client.go`)      | legacy `.com` |

The toggle name is the API group with dots replaced by dashes. The frontend derives the `.app` toggle in `src/utils/interactive-guides-api.ts`; the Go constants mirror that derivation. Custom guides migrated to the GAP `.app` group; completion-records stays on the legacy `.com` group until it migrates too, which is why both exist. The private-guide surface additionally requires OBO (on-behalf-of) token provisioning on the stack — the aggregation toggle alone does not make it reachable.

---

## How it works

### Architecture

The plugin connects to MTFF via the OFREP (OpenFeature Remote Evaluation Protocol) Web Provider:

```
Plugin (React)  -->  OpenFeature SDK  -->  OFREPWebProvider  -->  MTFF (/apis/features.grafana.app/...)
```

### Initialization

OpenFeature is initialized once at plugin load time in `src/module.tsx`:

```typescript
import { initializeOpenFeature } from './utils/openfeature';

await initializeOpenFeature();
```

This sets up the OFREP provider with the current namespace as targeting context:

```typescript
await OpenFeature.setProviderAndWait(
  OPENFEATURE_DOMAIN,
  new OFREPWebProvider({
    baseUrl: `/apis/features.grafana.app/v0alpha1/namespaces/${namespace}`,
    disableVisibilityRefresh: true, // Do not refresh
    cacheMode: 'disabled', // Do not write to localStorage
    timeoutMs: 10_000,
  }),
  {
    targetingKey: config.namespace,
    namespace: config.namespace,
    ...config.openFeatureContext,
  }
);
```

The domain `grafana-pathfinder-app` isolates this plugin's flags from Grafana core and other plugins.

### Evaluating flags

#### In React components (hooks)

Use the re-exported OpenFeature React hooks:

```typescript
import { useBooleanFlag } from '../../utils/openfeature';

const MyComponent = () => {
  const autoOpen = useBooleanFlag('pathfinder.auto-open-sidebar', false);
  // ...
};
```

Available hooks:

- `useBooleanFlag(flagName, defaultValue)` - For boolean flags
- `useStringFlag(flagName, defaultValue)` - For string flags
- `useNumberFlag(flagName, defaultValue)` - For number flags

These hooks must be used within an `OpenFeatureProvider` component tree.

#### In non-React code (synchronous)

Use `getFeatureFlagValue()` for boolean flags or `getHighlightedGuideConfig()` for the highlighted-guide experiment object flag:

```typescript
import { getFeatureFlagValue, getHighlightedGuideConfig } from '../../utils/openfeature';

// Boolean flag
const shouldAutoOpen = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);

// Highlighted-guide experiment config (object flag)
const config = getHighlightedGuideConfig();
if (config.variant !== 'excluded') {
  // Auto-open + feature config.guideId on config.pages
}
```

#### Async evaluation with guaranteed readiness

Use `evaluateFeatureFlag()` when you need to wait for the provider to be ready:

```typescript
import { evaluateFeatureFlag } from '../../utils/openfeature';

const autoOpen = await evaluateFeatureFlag('pathfinder.auto-open-sidebar');
```

### Exposure dedup

`pathfinder_feature_flag_evaluated` fires **once per (hostname, flag, variant) combination per browser**, persisted in localStorage under `grafana-pathfinder-experiment-exposure-reported-{hostname}:{flagKey}:{variant}`. Subsequent page loads where the user is still in the same arm produce zero events; variant reassignment (e.g. control → treatment) yields a new key and re-fires, which is what downstream A/B tools expect for fresh-arm exposures.

The hook keeps an in-memory `Set` as a fast path so the same flag never fires twice within a single page load, even when localStorage is unavailable.

### Analytics tracking

All flag evaluations are automatically tracked via `TrackingHook` (added during initialization). Flags with a `trackingKey` defined in `pathfinderFeatureFlags` are reported to analytics using that key.

## Adding a new feature flag

### 1. Define the flag

Add the flag to `pathfinderFeatureFlags` in `src/utils/openfeature.ts`:

```typescript
const pathfinderFeatureFlags = {
  // Existing flags...

  'pathfinder.my-new-feature': {
    valueType: 'boolean',
    values: [true, false],
    defaultValue: false,
    trackingKey: 'my_new_feature', // Optional: enables analytics tracking
  },
} as const satisfies Record<`pathfinder.${string}`, FeatureFlag>;
```

**Naming convention**: Use kebab-case format `pathfinder.<feature-name>`.

### 2. Use the flag

```typescript
// React component
import { useBooleanFlag } from '../../utils/openfeature';

const MyComponent = () => {
  const isEnabled = useBooleanFlag('pathfinder.my-new-feature', false);
  if (!isEnabled) return null;
  return <div>My feature content</div>;
};

// Non-React code
import { getFeatureFlagValue } from '../../utils/openfeature';
const isEnabled = getFeatureFlagValue('pathfinder.my-new-feature', false);
```

### 3. Register the flag in MTFF

Register the flag in the Multi-Tenant Feature Flag Service so it can be evaluated at runtime. This is managed through Grafana's internal MTFF configuration.

### 4. Document the flag

- Add to the "Current feature flags" section in this document
- Include purpose, type, default, behavior, and tracking key

## Testing

### Grafana Cloud

Feature flags are evaluated via MTFF. To test:

1. Register the flag in MTFF with appropriate targeting
2. Deploy the plugin
3. Verify in browser console:

```javascript
// View experiment config
window.__pathfinderExperiment;
```

### Local development (Grafana OSS)

MTFF is not available in OSS. Flags will use their default values. To test non-default states, you can:

1. Use the experiment debug utilities exposed on `window.__pathfinderExperiment`
2. Mock the OpenFeature provider in tests

### Testing both states

- **Default behavior**: Ensure the flag's default value produces correct behavior
- **Enabled/disabled**: Verify both flag states work correctly
- **Error handling**: Verify graceful fallback when evaluation fails (should return default value)

## Best practices

### 1. Default values

Always provide sensible defaults that maintain existing behavior if flag evaluation fails:

```typescript
// Good: Feature hidden by default if flag fails
const showNewFeature = useBooleanFlag('pathfinder.new-feature', false);

// Good: Maintain existing behavior if flag fails
const showExistingFeature = useBooleanFlag('pathfinder.existing-feature', true);
```

### 2. Flag naming

- Use descriptive kebab-case names: `pathfinder.auto-open-sidebar` not `pathfinder.feature1`
- Always prefix with `pathfinder.` to identify plugin-specific flags
- Use consistent naming for tracking keys (snake_case): `auto_open_sidebar`

### 3. Flag lifecycle

1. **Introduction**: Define flag with safe default, register in MTFF
2. **Validation**: Enable for testing, gather feedback, adjust targeting
3. **Stabilization**: Enable for all users once stable
4. **Cleanup**: Remove flag from code once feature is permanent

## Common issues

### Issue: Flag always returns default value

**Causes**:

1. `config.namespace` not available (prevents OpenFeature initialization)
2. MTFF not reachable (network/auth issue)
3. Flag not registered in MTFF
4. Flag name mismatch (check for typos)

**Solution**:

- Check browser console for `[OpenFeature]` warnings
- Verify initialization succeeded (no errors in console)
- Verify flag name matches MTFF registration exactly

### Issue: Flag not available in OSS

**Cause**: MTFF is a Grafana Cloud service. OSS instances cannot reach it.

**Solution**: This is expected. Flags will use their default values in OSS. Design defaults accordingly.

## References

- [OpenFeature specification](https://openfeature.dev/specification)
- [OpenFeature React SDK](https://openfeature.dev/docs/reference/technologies/client/web/)
- [OFREP Web Provider](https://github.com/open-feature/js-sdk-contrib/tree/main/libs/providers/ofrep-web)
- Source: `src/utils/openfeature.ts`
