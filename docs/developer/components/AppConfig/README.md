# AppConfig Component

The plugin configuration interface that allows administrators to set up the documentation plugin's API endpoints, authentication, feature settings, and terms acceptance.

## Files

### `AppConfig.tsx`

**Purpose**: Entry point for plugin configuration that delegates to ConfigurationForm
**Location**: `/src/components/AppConfig/AppConfig.tsx`
**Role**:

- Receives plugin configuration props from Grafana
- Passes props to `ConfigurationForm` for rendering
- Simple wrapper component for configuration interface

### `ConfigurationForm.tsx`

**Purpose**: Main configuration form with tabbed interface
**Location**: `/src/components/AppConfig/ConfigurationForm.tsx`
**Role**:

- Provides multi-tab configuration interface
- Manages plugin settings persistence and validation
- Updates the global configuration service
- Handles secure credential storage
- Integrates terms and conditions acceptance
- Manages interactive features configuration

**Key Features**:

- **Tabbed Interface**: Organizes configuration into logical sections
  - General Settings: API endpoints and authentication
  - Recommendations Config: Terms acceptance for AI recommendations
  - Interactive Features: Feature flag management
  - Dev Mode: Developer tools configuration
- **Configuration Management**: Forms for API endpoints, authentication, and feature settings
- **Credential Handling**: Secure password input with masked display
- **Validation**: Form validation with submit button state management
- **Auto-reload**: Automatically reloads the page after successful configuration
- **Terms Management**: Handles terms and conditions acceptance flow

**Configuration Fields**:

**General Settings:**

- `docsBaseUrl` - Base URL for the documentation service
- `docsUsername` - Username for authentication (optional)
- `docsPassword` - Password for authentication (optional, stored securely)

**Recommendations Config:**

- `acceptedTermsAndConditions` - Terms acceptance for recommendation service
- `recommenderServiceUrl` - URL for the AI recommendation service

**Interactive Features:**

- Feature flag toggles for experimental features

**Dev Mode:**

- `devModeUserIds` - List of user IDs with dev mode access
- Developer tools enablement

### `TermsAndConditions.tsx`

**Purpose**: Terms and conditions acceptance component
**Location**: `/src/components/AppConfig/TermsAndConditions.tsx`
**Role**:

- Displays terms and conditions text
- Handles acceptance checkbox
- Integrates with configuration form
- Required for enabling recommendation service

**Used By**:

- `ConfigurationForm.tsx` - Recommendations Config tab

### `InteractiveFeatures.tsx`

**Purpose**: Interactive features configuration component
**Location**: `/src/components/AppConfig/InteractiveFeatures.tsx`
**Role**:

- Provides UI for enabling/disabling interactive features
- Manages feature flag configuration
- Allows gradual feature rollout
- Supports A/B testing scenarios

**Used By**:

- `ConfigurationForm.tsx` - Interactive Features tab

### `terms-content.ts`

**Purpose**: Terms and conditions text content
**Location**: `/src/components/AppConfig/terms-content.ts`
**Role**:

- Contains the terms text to display
- Centralized content management
- Easy to update without code changes

**Used By**:

- Grafana admin interface (automatically loaded for app plugins)
- Plugin configuration pages in Grafana settings
- Accessed via: `/plugins/grafana-pathfinder-app?page=configuration`

**Dependencies**:

- `@grafana/ui` - UI components (Button, Field, Input, SecretInput, TabContent, TabsBar, etc.)
- `@grafana/data` - Plugin types and interfaces
- `@grafana/runtime` - Backend service and location service
- `src/constants` - Configuration constants and service
- `src/components/testIds` - Test identifiers
- `./TermsAndConditions` - Terms acceptance component
- `./InteractiveFeatures` - Feature flags component

**Configuration Structure**:

```typescript
interface DocsPluginConfig {
  // General Settings
  docsBaseUrl?: string;
  docsUsername?: string;
  docsPassword?: string;
  isDocsPasswordSet?: boolean;

  // Recommendations
  acceptedTermsAndConditions?: boolean;
  recommenderServiceUrl?: string;

  // Dev Mode
  devModeUserIds?: number[];

  // Feature Flags
  [key: string]: any; // Additional feature flags
}
```

**Configuration Flow**:

1. **Load Existing Config**: Reads current plugin configuration from `jsonData` and `secureJsonData`
2. **Tab Navigation**: Admin selects appropriate configuration tab
3. **Form Input**: Admin updates settings through form fields in selected tab
4. **Validation**: Ensures required fields are populated and formats are correct
5. **Terms Acceptance**: (Recommendations tab) Requires accepting terms to enable recommendations
6. **Save & Update**: Persists to plugin metadata and updates global `ConfigService`
7. **Reload**: Refreshes page to apply new configuration across plugin

**Security Features**:

- **Secret Storage**: Passwords stored in `secureJsonData` (encrypted, not queryable)
- **Masked Input**: Uses `SecretInput` for password fields with masked display
- **Reset Capability**: Allows clearing stored passwords
- **Dev Mode Protection**: User-based dev mode access control via user ID list

**Default Values**:

**General:**

- Docs Base URL: `https://grafana.com`
- Username: Empty (optional authentication)
- Password: Empty (optional authentication)

**Recommendations:**

- Recommender Service: `https://grafana-recommender-93209135917.us-central1.run.app`
- Terms Accepted: `false`

**Dev Mode:**

- Dev Mode Users: `[]` (empty list)

## Integration Points

### Configuration Service

Updates the global configuration via window object which provides settings to:

- `src/docs-retrieval/content-fetcher.ts` - For authenticated content fetching
- `src/components/docs-panel/context-panel.tsx` - For recommendation API calls
- `src/utils/dev-mode.ts` - For dev mode access control
- All components via `getConfigWithDefaults()` utility

### Plugin Lifecycle

- Configuration changes trigger plugin reload via `locationService.reload()`
- New settings are immediately available to all plugin components
- Secure credentials are handled separately from regular JSON data
- Window global config updated for module-level access

### Feature Flag Integration

- Interactive features configuration affects OpenFeature flags
- Feature flags control component visibility and behavior
- Allows gradual rollout of new features
- Supports A/B testing and experimentation

### Dev Mode Integration

- Dev mode user list stored in configuration
- Checked against current user ID at runtime
- Controls visibility of developer tools
- Enables block editor, PR tester, and URL tester

## Access Control

The configuration interface is only accessible to Grafana administrators with plugin management permissions. Different tabs may have different access requirements based on the organization's setup.

This component ensures the plugin can be properly configured for different environments, authentication requirements, and feature rollout strategies.
