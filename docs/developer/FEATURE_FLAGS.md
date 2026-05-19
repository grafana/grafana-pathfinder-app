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

- **`true`**: Pathfinder loads normally — sidebar is available, experiments run as configured
- **`false`**: Plugin is dismounted, the native Grafana help menu takes over (same behavior as being in an experiment control group)

**Important**: This flag is evaluated independently of the experiment flags. Even if a user is in the `excluded` variant for both experiments, setting `pathfinder.enabled` to `false` will dismount the plugin. Conversely, if `pathfinder.enabled` is `true`, the experiment variants still apply as normal.

**Tracking key**: `pathfinder_enabled`

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

**Multi-instance support**: Auto-open tracking is scoped per Grafana instance using hostname. This ensures that users with multiple Cloud instances (e.g., `company1.grafana.net` and `company2.grafana.net`) will see the sidebar auto-open independently per instance.

**Onboarding flow integration**: If a user first lands on the setup guide onboarding flow (`/a/grafana-setupguide-app/onboarding-flow`), the plugin defers auto-open. It listens for navigation events (`grafana:location-changed` and `locationService.getHistory().listen()`) and triggers auto-open when the user navigates away from onboarding to normal Grafana pages.

**Tracking key**: `auto_open_sidebar`

---

### `pathfinder.experiment-variant`

**Type**: Object (`ExperimentConfig`)

**Purpose**: A/B experiment for testing Pathfinder's impact on onboarding. Returns a JSON object with variant assignment, target pages, and cache reset control.

**Default**: `{ variant: 'excluded', pages: [], resetCache: false }`

**Returned object shape**:

```typescript
interface ExperimentConfig {
  variant: 'excluded' | 'control' | 'treatment';
  pages: string[]; // Target page paths where sidebar should auto-open (treatment only)
  resetCache?: boolean; // When toggled true, clears session storage to allow re-triggering auto-open
}
```

**Variant behavior**:

| Variant     | Sidebar registered | Auto-open | Behavior                                             |
| ----------- | ------------------ | --------- | ---------------------------------------------------- |
| `excluded`  | Yes                | Normal    | Not in experiment; normal Pathfinder behavior        |
| `control`   | No                 | No        | In experiment; no sidebar (native Grafana help only) |
| `treatment` | Yes                | Yes       | In experiment; sidebar auto-opens on target pages    |

**Target pages**: The `pages` array contains URL path patterns (with optional `*` wildcard suffix) where auto-open triggers. An empty array means auto-open on all pages.

**Cache reset**: The `resetCache` field allows operators to clear the "already shown" tracking via MTFF, enabling the sidebar to auto-open again for users who have already seen it.

**Tracking key**: `experiment_variant`

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

**Page-pattern semantics — note the difference**: Empty `pages` is treated as **no match**, NOT "all pages" (unlike `pathfinder.experiment-variant`). This makes the safe default of `{ variant: 'excluded', pages: [] }` a true no-op even if the variant is accidentally flipped without configuring pages. Patterns support the same `*` suffix wildcards as `matchPathPattern`.

**Once-per-browser semantics**: The auto-open marker is keyed `{hostname}:{guideId}` in localStorage (not sessionStorage). A new `guideId` from MTFF — including the arm-specific value at variant assignment time — produces a new key, so changing the experiment's guide naturally re-fires auto-open without operator intervention. Use `resetCache: true` to force-clear all markers for the current hostname (sentinel-guarded so true→true reloads don't repeatedly clear).

**Injection-only mode**: When `autoOpen` is `false`, both the sidebar auto-open _and_ the auto-launch of the guide tab are suppressed, but the Featured-slot injection still runs on matched pages. Useful for a subtler treatment variant where the operator wants the card visible without forcibly opening the sidebar.

**Auto-launch dispatch mechanics** (for QA / debugging): on a matched page, the orchestrator resolves the `guideId` through `findDocPage`, publishes `open-extension-sidebar`, waits for either `pathfinder-sidebar-mounted` or `pathfinder-panel-mounted`, then dispatches `auto-launch-tutorial` (the same event `?doc=` uses) tagged with `source: 'highlighted_guide_experiment'`. The `useAutoLaunchTutorial` hook routes that to `openDocsPage` / `openLearningJourney` depending on the resolved `type` (with the flag's `docType` winning over `findDocPage`'s URL-based inference). If `findDocPage` returns `null` for the configured `guideId` (typo, unsupported URL), the sidebar still opens and the Featured-slot card is the user's only entry point.

**Tracking key**: `highlighted_guide_experiment`

**Launch source**: Guide tabs opened by this flag are tagged with the `highlighted_guide_experiment` `LaunchSource` (aligned-by-construction — no alignment prompt is shown, since the operator already targeted the page).

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
    pollInterval: -1, // Flags fetched once on init, no polling
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

Use `getFeatureFlagValue()` for boolean flags or `getExperimentConfig()` for object-valued experiment flags:

```typescript
import { getFeatureFlagValue, getExperimentConfig } from '../../utils/openfeature';

// Boolean flag
const shouldAutoOpen = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);

// Experiment config (object flag)
const experimentConfig = getExperimentConfig('pathfinder.experiment-variant');
if (experimentConfig.variant === 'treatment') {
  // Auto-open sidebar on experimentConfig.pages
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
