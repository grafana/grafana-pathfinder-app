# Feature Toggles in grafana-pathfinder-app

This document explains how feature toggles are implemented in the grafana-pathfinder-app plugin using Grafana's built-in feature toggle system.

## Overview

The plugin uses Grafana's core feature toggle system (`config.featureToggles`) to control feature visibility. This approach:
- ✅ Leverages Grafana's existing infrastructure
- ✅ No additional dependencies required
- ✅ Simple, direct access via `@grafana/runtime`
- ✅ Works in both OSS and Cloud/Enterprise
- ✅ Consistent with Grafana's feature flag management

## Current Feature Toggles

### `grafanaPathfinderAutoOpenSidebar`

**Purpose**: Sets the default value for the "Open Panel on Launch" user preference. Users can always change this setting afterwards.

**Default**: Not set (undefined) - uses `DEFAULT_OPEN_PANEL_ON_LAUNCH` constant (currently `false`)

**Behavior**:
- **Not set** (undefined): Uses `DEFAULT_OPEN_PANEL_ON_LAUNCH` as the default value
- **`true`**: Sets user preference default to enabled (sidebar will auto-open by default)
- **`false`**: Sets user preference default to disabled (sidebar won't auto-open by default)

**Important**: The feature toggle only sets the **initial/default value**. Users can always override it in plugin settings.

**How it works**:
1. When plugin settings are first loaded, check if user has saved a preference
2. If user has a saved preference → use it (user choice takes precedence)
3. If no saved preference → use feature toggle value as default
4. If feature toggle not set → use `DEFAULT_OPEN_PANEL_ON_LAUNCH`

**Example scenarios**:
```
Toggle: not set + User hasn't configured = Uses DEFAULT (false) = No auto-open
Toggle: not set + User enabled it       = Uses user choice (true) = Auto-open ✓
Toggle: true    + User hasn't configured = Defaults to true = Auto-open ✓
Toggle: true    + User disabled it       = Uses user choice (false) = No auto-open
Toggle: false   + User hasn't configured = Defaults to false = No auto-open
Toggle: false   + User enabled it        = Uses user choice (true) = Auto-open ✓
```

**Use case**: Admins can set the default experience for users, but users always have final control.

**Naming Convention**: camelCase, prefixed with `grafanaPathfinder` to identify plugin-specific toggles

## How It Works

### Accessing Feature Toggles

Grafana exposes feature toggles to plugins via `config.featureToggles` from `@grafana/runtime`. The plugin uses a simple utility function to check toggle values:

```typescript
import { config } from '@grafana/runtime';

// Check a feature toggle
const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
const isEnabled = featureToggles?.['grafanaPathfinderAutoOpenSidebar'] ?? true;
```

### Utility Function

The plugin provides `getFeatureToggle()` in `src/utils/openfeature.ts`:

```typescript
import { FeatureFlags, getFeatureToggle } from '../../utils/openfeature';

const ConfigurationForm = () => {
  // Check feature toggle with default value
  const autoOpenEnabled = getFeatureToggle(
    FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH,
    true // Default value if toggle not found
  );

  if (!autoOpenEnabled) {
    return null; // Hide feature
  }

  return <div>Feature Content</div>;
};
```

### No Setup Required

## Adding a New Feature Toggle

### 1. Define the Toggle Constant

Add the toggle to `src/utils/openfeature.ts`:

```typescript
export const FeatureFlags = {
  // Existing toggles...
  
  // Your new toggle
  MY_NEW_FEATURE: 'grafanaPathfinderMyNewFeature',
} as const;
```

**Naming Convention**: Use camelCase format `grafanaPathfinder<FeatureName>` to identify plugin-specific toggles.

### 2. Use the Toggle in Your Component

```typescript
import { FeatureFlags, getFeatureToggle } from '../../utils/openfeature';

const MyComponent = () => {
  // Check toggle value
  const isMyFeatureEnabled = getFeatureToggle(
    FeatureFlags.MY_NEW_FEATURE,
    false // Default value if toggle not defined
  );

  if (!isMyFeatureEnabled) {
    return null; // Hide feature
  }

  return <div>My Feature Content</div>;
};
```

### 3. Register the Toggle in Grafana

#### For Grafana Cloud/Enterprise

Register the toggle in Grafana's feature toggle registry. This is typically done in:

**Location**: `pkg/services/featuremgmt/registry.go` (in Grafana core repository)

**Example**:
```go
{
  Name:            "grafanaPathfinderMyNewFeature",
  Description:     "Enable my new feature in grafana-pathfinder-app",
  State:           FeatureStateAlpha, // or Beta, GA
  Expression:      "true", // or targeting expression
  RequiresDevMode: false,
},
```

**Targeting Options**: You can use expressions to enable toggles conditionally:
- By organization: `"org == 1"`
- By user: `"user.login == 'admin'"`
- By license: `"license.hasLicense()"`
- Complex expressions: `"org == 1 || user.isGrafanaAdmin()"`

#### For Grafana OSS (Local Development)

For local testing, you can enable toggles via:

1. **Configuration file** (`custom.ini` or `grafana.ini`):
```ini
[feature_toggles]
enable = grafanaPathfinderMyNewFeature
```

2. **Environment variable**:
```bash
GF_FEATURE_TOGGLES_ENABLE=grafanaPathfinderMyNewFeature
```

3. **Command line**:
```bash
grafana-server --feature-toggles grafanaPathfinderMyNewFeature
```

## Testing

### Local Development (OSS)

1. **Enable the toggle** in your Grafana configuration:
   ```ini
   [feature_toggles]
   enable = grafanaPathfinderAutoOpenSidebar
   ```

2. **Restart Grafana** to apply the toggle

3. **Verify in browser console**:
   ```javascript
   // Check if toggle is enabled
   window.grafanaBootData.settings.featureToggles.grafanaPathfinderAutoOpenSidebar
   ```

### Testing Both States

To test both enabled and disabled states:

1. **Enabled**: Set toggle in config and restart Grafana
2. **Disabled**: Remove toggle from config and restart Grafana  
3. **Default behavior**: Remove toggle and verify default value works correctly

### Cloud/Enterprise Testing

1. **Register toggle** in Grafana's feature toggle registry
2. **Deploy Grafana** with the new toggle
3. **Enable toggle** via admin UI or configuration
4. **Deploy plugin** with code that uses the toggle
5. **Verify** toggle value in browser DevTools

## Deployment

### Plugin Deployment

The plugin can be deployed independently of Grafana. Feature toggles should be registered in Grafana first, but the plugin will gracefully fall back to default values if toggles are not found.

**Recommended Order**:
1. **Register toggle** in Grafana's feature toggle registry (if needed for Cloud/Enterprise)
2. **Deploy Grafana** with new toggle
3. **Deploy plugin** with code that uses the toggle

**Safe Deployment**: Because the plugin uses default values, you can deploy in any order. Missing toggles won't break functionality—they'll just use their defaults.

## Monitoring

### Checking Toggle State

In browser DevTools console:

```javascript
// View all feature toggles
window.grafanaBootData.settings.featureToggles

// Check specific toggle
window.grafanaBootData.settings.featureToggles.grafanaPathfinderMyNewFeature

// Or via config object
const config = require('@grafana/runtime').config;
console.log(config.featureToggles);
```

### Change History

Feature toggle changes are tracked in Grafana's repository:
- View registry changes: `git log -- pkg/services/featuremgmt/registry.go`
- Toggle state changes logged in Grafana's audit log (Enterprise)

## Best Practices

### 1. Default Values

Always provide sensible defaults that maintain existing behavior if flag evaluation fails:

```typescript
// Good: Feature hidden by default if flag fails
const showNewFeature = useBooleanFlagValue(
  FeatureFlags.NEW_FEATURE,
  false // Safe default
);

// Good: Maintain existing behavior if flag fails  
const showExistingFeature = useBooleanFlagValue(
  FeatureFlags.EXISTING_FEATURE,
  true // Backward compatible
);
```

### 2. Toggle Naming

- Use descriptive names: `grafanaPathfinderOpenPanelOnLaunchConfig` not `feature1`
- Include plugin prefix: `grafanaPathfinder<FeatureName>`
- Use camelCase to match Grafana's convention

### 3. Toggle Lifecycle

1. **Introduction**: Create toggle with default `false`, register in Grafana
2. **Validation**: Enable for testing, gather feedback, adjust targeting
3. **Stabilization**: Enable for all users once stable, or make feature default
4. **Cleanup**: Remove toggle from code once feature is permanent, remove from registry

### 4. Documentation

When adding a toggle:
- Document its purpose in code comments
- Add to `FeatureFlags` constant with descriptive comment
- Update this document's "Current Feature Toggles" section
- Include toggle name and purpose in PR description

### 5. Testing

- Test both toggle states (`true` and `false`)
- Test default value behavior (toggle not registered)
- Verify graceful degradation when toggle is missing
- Test in both OSS and Cloud environments if possible

## Common Issues

### Issue: Toggle always returns default value

**Causes**:
1. Toggle not registered in Grafana's feature toggle registry
2. Grafana hasn't been restarted after adding toggle to config
3. Toggle name mismatch (check for typos)
4. Feature toggles not available (`config.featureToggles` is undefined)

**Solution**: 
- Check toggle is in config: `[feature_toggles] enable = grafanaPathfinderMyToggle`
- Restart Grafana after config changes
- Verify in browser console: `window.grafanaBootData.settings.featureToggles`

### Issue: Toggle not available in Cloud

**Cause**: Toggle not registered in Grafana's feature toggle registry.

**Solution**: Register the toggle in `pkg/services/featuremgmt/registry.go` and deploy Grafana.

### Issue: Toggle changes not taking effect

**Cause**: Grafana needs to be restarted after configuration changes.

**Solution**: Restart Grafana. Feature toggles are loaded at startup, not dynamically.

## References

- [Grafana Feature Toggle Documentation](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/feature-toggles/)
- [Grafana Runtime Config](https://grafana.com/docs/grafana/latest/developers/plugins/create-a-plugin/extend-a-plugin/add-authentication-for-data-source-plugins/)
- Internal: `pkg/services/featuremgmt/` in Grafana repository

## Comparison: Feature Toggles vs OpenFeature

### When to use Grafana Feature Toggles (What we use)
- ✅ Plugin features that should be managed by Grafana admins
- ✅ Features that need to work in both OSS and Cloud
- ✅ Simple boolean toggles
- ✅ No additional dependencies needed

### When OpenFeature might be needed
- Plugin wants its own independent feature flag service
- Complex targeting beyond what Grafana provides
- Multi-variant experiments (A/B/C testing)
- Real-time flag updates without restarts

For most plugin use cases, Grafana's built-in feature toggles are sufficient and simpler.

## Support

For questions or issues with feature toggles:
1. Check this documentation first
2. Verify toggle state in browser console: `window.grafanaBootData.settings.featureToggles`
3. Check Grafana configuration files
4. Contact the grafana-pathfinder-app team
5. For Grafana core toggle issues, see Grafana's feature toggle documentation

