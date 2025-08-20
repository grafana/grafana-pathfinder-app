# AppConfig Component

The plugin configuration interface that allows administrators to set up the documentation plugin's API endpoints, authentication, and other settings.

## Files

### `AppConfig.tsx`

**Purpose**: Admin configuration form for plugin settings
**Role**:

- Provides UI for configuring API endpoints and authentication
- Handles plugin settings persistence and validation
- Updates the global configuration service
- Manages secure credential storage

**Key Features**:

- **Configuration Management**: Form for setting recommender service URL, docs base URL, and authentication
- **Credential Handling**: Secure password input with masked display
- **Validation**: Form validation with submit button state management
- **Auto-reload**: Automatically reloads the page after successful configuration

**Configuration Fields**:

- `recommenderServiceUrl` - URL for the AI recommendation service
- `docsBaseUrl` - Base URL for the documentation service
- `docsUsername` - Username for authentication (optional)
- `docsPassword` - Password for authentication (optional, stored securely)

**Used By**:

- Grafana admin interface (automatically loaded for app plugins)
- Plugin configuration pages in Grafana settings

**Dependencies**:

- `@grafana/ui` - UI components (Button, Field, Input, SecretInput, etc.)
- `@grafana/data` - Plugin types and interfaces
- `@grafana/runtime` - Backend service and location service
- `src/constants` - Configuration constants and service
- `src/components/testIds` - Test identifiers

**State Management**:

```typescript
type State = {
  recommenderServiceUrl: string;
  docsBaseUrl: string;
  docsUsername: string;
  docsPassword: string;
  isDocsPasswordSet: boolean;
};
```

**Configuration Flow**:

1. **Load Existing Config**: Reads current plugin configuration from `jsonData`
2. **Form Input**: Admin updates settings through form fields
3. **Validation**: Ensures required fields are populated
4. **Save & Update**: Persists to plugin metadata and updates `ConfigService`
5. **Reload**: Refreshes page to apply new configuration

**Security Features**:

- **Secret Storage**: Passwords stored in `secureJsonData` (not queryable)
- **Masked Input**: Uses `SecretInput` for password fields
- **Reset Capability**: Allows clearing stored passwords

**Default Values**:

- Recommender Service: `https://grafana-recommender-93209135917.us-central1.run.app`
- Docs Base URL: `https://grafana.com`
- Username: Empty (optional authentication)
- Password: Empty (optional authentication)

## Integration Points

### Configuration Service

Updates the global `ConfigService` which provides configuration to:

- `src/utils/docs-fetcher.ts` - For authenticated content fetching
- `src/utils/single-docs-fetcher.ts` - For docs content retrieval
- `src/components/docs-panel/context-panel.tsx` - For recommendation API calls

### Plugin Lifecycle

- Configuration changes trigger plugin reload via `locationService.reload()`
- New settings are immediately available to all plugin components
- Secure credentials are handled separately from regular JSON data

This component ensures the plugin can be properly configured for different environments and authentication requirements.
