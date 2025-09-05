# Feature Flags System

The Grafana Pathfinder plugin includes a feature flag system for enabling experimental functionality. This system allows administrators to control which features are available to users.

## Overview

Feature flags are managed through the `FeatureFlagService` and can be configured via:

1. **Provisioning** (persistent, recommended for production)
2. **Plugin Configuration UI** (persistent, user-friendly)
3. **Browser Console** (session-only, for development/testing)

## Available Feature Flags

### `custom_docs`

**Purpose**: Enables custom documentation repositories functionality

**What it does**:

- Unlocks the "Custom Docs" configuration tab in plugin settings
- Allows administrators to configure custom GitHub repositories as documentation sources
- Integrates custom docs with the recommendation system

**When disabled**:

- Shows "Feature Not Available" message with admin contact information
- Custom docs configuration UI is hidden
- Only built-in recommendations are shown

## Configuration Methods

### Method 1: Provisioning (Recommended)

Configure via the plugin provisioning file:

```yaml
# provisioning/plugins/app.yaml
apiVersion: 1

apps:
  - type: 'grafana-grafanadocsplugin-app'
    org_id: 1
    org_name: 'grafanalabs'
    disabled: false
    jsonData:
      docsBaseUrl: https://grafana.com
      features: custom_docs # Enable custom docs feature
      tutorialUrl: ''
```

### Method 2: Environment Variables

Set environment variables for the Grafana container:

```bash
# Docker Compose
environment:
  GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_FEATURES: custom_docs

# Kubernetes
env:
  - name: GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_FEATURES
    value: "custom_docs"
```

### Method 3: Plugin Configuration UI

1. Navigate to **Administration → Plugins**
2. Find **Grafana Pathfinder** and click **Configure**
3. Go to the **Configuration** tab
4. Add `custom_docs` to the **Features** field
5. Click **Save configuration**

### Method 4: Browser Console (Development Only)

For development and testing purposes:

```javascript
// Enable feature (session-only)
window.features.enable('custom_docs');

// Disable feature
window.features.disable('custom_docs');

// Check if feature is enabled
window.features.isEnabled('custom_docs');

// List all enabled features
window.features.list();
```

## Implementation Details

### Service Architecture

The feature flag system uses a singleton service pattern:

```typescript
import { FeatureFlagService, initializeFeatureFlags, useFeatureFlag } from './utils/feature-flag.service';

// Initialize with default features (typically done in bootstrap)
initializeFeatureFlags('custom_docs');

// React hook for checking feature state
const isEnabled = useFeatureFlag('custom_docs');

// Direct service access
const service = FeatureFlagService.getInstance();
const isEnabled = service.isEnabled('custom_docs');
```

### Storage

- **Session Storage**: Features are stored in browser session storage
- **Persistence**: Configuration-based features persist across sessions
- **Defaults**: Provisioned features are loaded as defaults on initialization

### Component Integration

Components check feature flags to conditionally render UI:

```typescript
const CustomDocsConfig = ({ plugin }: CustomDocsConfigProps) => {
  const isEnabledInConfig = /* check plugin config */;
  const isEnabledInSession = useFeatureFlag('custom_docs');
  const isCustomDocsEnabled = isEnabledInConfig || isEnabledInSession;

  if (!isCustomDocsEnabled) {
    return <FeatureNotAvailableAlert />;
  }

  return <CustomDocsConfigForm />;
};
```

## Multiple Feature Flags

The system supports comma-separated feature flags:

### Provisioning Example

```yaml
jsonData:
  features: custom_docs,feature2,feature3
```

### Environment Variable Example

```bash
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_FEATURES=custom_docs,feature2,feature3
```

### Browser Console Example

```javascript
// Enable multiple features
window.features.enable('custom_docs');
window.features.enable('feature2');
window.features.enable('feature3');

// Check multiple features
['custom_docs', 'feature2', 'feature3'].forEach((feature) => {
  console.log(`${feature}: ${window.features.isEnabled(feature)}`);
});
```

## Development Guidelines

### Adding New Feature Flags

1. **Define the feature**: Add the feature name to your constants
2. **Check in components**: Use `useFeatureFlag()` hook or service directly
3. **Update documentation**: Add the feature to this guide
4. **Test thoroughly**: Verify both enabled and disabled states

### Example Implementation

```typescript
// In component
const isNewFeatureEnabled = useFeatureFlag('new_feature');

// Conditional rendering
if (!isNewFeatureEnabled) {
  return <FeatureNotAvailable feature="new_feature" />;
}

return <NewFeatureComponent />;
```

### Testing Feature Flags

```javascript
// Test all combinations
const features = ['custom_docs', 'new_feature'];
const combinations = [[], ['custom_docs'], ['new_feature'], ['custom_docs', 'new_feature']];

combinations.forEach((combo) => {
  // Clear all features
  window.features.clear();

  // Enable combination
  combo.forEach((f) => window.features.enable(f));

  // Test UI state
  console.log('Testing:', combo);
  // Verify UI behavior matches expectations
});
```

## Troubleshooting

### Feature Not Working

1. **Check Configuration**: Verify feature is enabled in plugin settings
2. **Check Console**: Look for initialization errors in browser console
3. **Verify Spelling**: Feature flag names are case-sensitive
4. **Refresh Page**: Some features require page reload to take effect

### Console Debugging

```javascript
// Check current state
console.log('Features service:', window.features);
console.log('Enabled features:', window.features.list());
console.log('Custom docs enabled:', window.features.isEnabled('custom_docs'));

// Check plugin configuration
fetch('/api/plugins/grafana-grafanadocsplugin-app/settings')
  .then((r) => r.json())
  .then((data) => console.log('Plugin config:', data.jsonData));
```

### Common Issues

**"Feature flag not working after provisioning"**:

- Restart Grafana container to reload provisioning
- Verify environment variables are set correctly
- Check Grafana logs for provisioning errors

**"Browser console method not working"**:

- Ensure you're on a page where the plugin is loaded
- Check if `window.features` object exists
- Try refreshing the page after setting flags

**"UI not updating after enabling feature"**:

- Some components require page refresh
- Clear browser cache if issues persist
- Check browser console for JavaScript errors

## Security Considerations

### Access Control

- **Admin Only**: Feature flag configuration requires admin privileges
- **Session Isolation**: Browser console changes are session-only
- **Audit Trail**: Feature changes are logged in Grafana audit logs

### Safe Defaults

- **Conservative Defaults**: New features are disabled by default
- **Graceful Degradation**: Disabled features show helpful messages
- **Backwards Compatibility**: Existing functionality unaffected by new flags

## Best Practices

### For Administrators

1. **Use Provisioning**: Prefer provisioning over UI configuration for consistency
2. **Document Changes**: Keep track of which features are enabled in each environment
3. **Test Thoroughly**: Verify both enabled and disabled states work correctly
4. **Monitor Usage**: Check if users are actually using enabled experimental features

### For Developers

1. **Default Disabled**: New experimental features should default to disabled
2. **Clear Messaging**: Provide helpful messages when features are disabled
3. **Backwards Compatibility**: Don't break existing functionality with feature flags
4. **Clean Conditionals**: Use clear, readable feature flag checks in components

This feature flag system provides a flexible way to manage experimental functionality while maintaining a stable user experience for production deployments.
