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

- `tutorialUrl` - Override for the bundled tutorial index (optional)
- `enableCodaTerminal` - Show the Coda terminal UI
- `enableLiveSessions`, `peerjsHost`, `peerjsPort`, `peerjsKey`, `peerjsSecure` - Collaborative sessions

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

**Where settings are stored**:

Three stores own disjoint slices. See `src/constants.ts` for the authoritative
shape and `src/utils/pathfinder-settings-api.ts` for the client.

| Slice                                                                           | Store                                                                                                                                    | Written by               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Tenant settings (`PathfinderTenantSettings` — every field the config tabs edit) | `PathfinderSettings` App Platform resource, group `pathfinderbackend.ext.grafana.app`, one singleton named `default` per stack namespace | `saveTenantSettings`     |
| This user's dev-mode opt-in (`devModeOptIn`)                                    | `localStorage`, key `StorageKeys.DEV_MODE_OPT_IN`                                                                                        | `lib/dev-mode-opt-in.ts` |
| Provisioned fields (`stackId`, `secureJsonData.accessToken`)                    | plugin settings, written by Grafana Cloud stack-state-service                                                                            | provisioning only        |

Plugin `jsonData` also remains the **fallback** store for tenant settings
wherever the App Platform group is not served — OSS, self-managed, and local dev.

**Why not `jsonData` for everything**: Grafana replaces `jsonData` wholesale on
write and Cloud provisioning targets the same record, so the two writers
overwrote each other. A config save erased the provisioned `stackId` and broke
private guides (#1514), and an instance restart erased every admin setting by
re-asserting the provisioned blob.

**Configuration Structure**:

```typescript
// Tenant-owned; stored in the PathfinderSettings resource (jsonData as fallback).
interface PathfinderTenantSettings {
  recommenderServiceUrl: string;
  tutorialUrl: string;
  acceptedTermsAndConditions: boolean;
  termsVersion: string;
  enableAutoDetection: boolean;
  requirementsCheckTimeout: number;
  guidedStepTimeout: number;
  disableAutoCollapse: boolean;
  interceptGlobalDocsLinks: boolean;
  openPanelOnLaunch: boolean;
  enableLiveSessions: boolean;
  peerjsHost: string;
  peerjsPort: number;
  peerjsKey: string;
  peerjsSecure: boolean;
  enableCodaTerminal: boolean;
  enableAiAutoHeal: boolean;
  enableTwoTabController: boolean;
  devMode: boolean; // tenant gate; stored as `devModeEnabled`
  enableAssistantDevMode: boolean;
  enableKioskMode: boolean;
  kioskRulesUrl: string;
}

// Per-user; stored in localStorage.
interface PathfinderUserSettings {
  devModeOptIn: boolean;
}

// What consumers read: the resolved union, every field optional because a store
// may not have been written yet.
interface PathfinderPluginConfig extends Partial<PathfinderTenantSettings>, Partial<PathfinderUserSettings> {
  devModeUserIds?: number[]; // @deprecated, read-only legacy allow-list
  stackId?: string; // provisioned; never written by this plugin
}
```

**Configuration Flow**:

1. **Load Existing Config**: `usePathfinderPluginConfig` resolves the App Platform resource over `jsonData` over defaults, then folds in the per-user opt-in
2. **Tab Navigation**: Admin selects appropriate configuration tab
3. **Form Input**: Admin updates settings through form fields in selected tab
4. **Validation**: Ensures required fields are populated and formats are correct
5. **Terms Acceptance**: (Recommendations tab) Requires accepting terms to enable recommendations
6. **Save**: The tab passes only the fields it owns to `saveTenantSettings`, which re-reads current settings authoritatively and writes the resolved result
7. **Reload**: Refreshes page to apply new configuration across plugin

**Security Features**:

- **Secret Storage**: Secrets live in `secureJsonData` (encrypted, not queryable). No config tab writes them — the only value there is the provisioned `accessToken`
- **Least privilege**: Writing tenant settings requires the `pathfinder-backend:settings-editor` role, bound to admin. Reading is bound to viewer
- **Ownership isolation**: `configToSpec` projects through `TENANT_SETTING_KEYS`, so per-user and provisioned fields cannot reach the tenant resource
- **Dev Mode Protection**: two gates — the admin-controlled tenant `devMode` flag and the user's own opt-in. Both must be true

**Default Values**:

**General:**

- Docs Base URL: `https://grafana.com`
- Username: Empty (optional authentication)
- Password: Empty (optional authentication)

**Recommendations:**

- Recommender Service: `https://recommender.grafana.com` (auto-selected per environment; see `getDefaultRecommenderUrl()`)
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
