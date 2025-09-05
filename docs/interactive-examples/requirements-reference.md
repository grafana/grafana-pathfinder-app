# Requirements and Objectives Reference

This comprehensive guide covers all supported requirements and objectives for interactive tutorial elements. Requirements control when elements become enabled, while objectives provide auto-completion when desired states are already achieved.

## System Overview

### Requirements vs Objectives
- **Requirements** (`data-requirements`): Preconditions that must be met for action execution
- **Objectives** (`data-objectives`): Desired outcomes that auto-complete steps when already achieved
- **Priority**: Objectives always win - if objectives are met, requirements are ignored
- **Syntax**: Both use identical syntax and checking functions

### Checking Behavior
- **Event-Driven**: Requirements checked when DOM changes, navigation occurs, or user actions trigger updates
- **Performance**: Intelligent caching and debouncing prevent excessive API calls
- **Error Recovery**: Failed requirements show "Fix this" buttons where automatic fixes are possible
- **Live Updates**: Requirements continuously monitored and re-evaluated as conditions change

## Core Concepts

### Syntax and Validation
- **Requirements**: Comma-separated conditions in `data-requirements="requirement1,requirement2"`
- **Objectives**: Comma-separated conditions in `data-objectives="objective1,objective2"`
- **AND Logic**: ALL conditions must pass (no OR logic supported)
- **Live Checking**: Continuously monitored and re-evaluated as system state changes
- **User Feedback**: Failed conditions show helpful explanations with actionable buttons

### Priority System
1. **Objectives First**: If objectives are met, step is auto-completed regardless of requirements
2. **Sequential Dependencies**: Previous steps must complete before next steps become eligible
3. **Requirements Validation**: Only checked if objectives are not met and step is eligible
4. **Error Display**: Shows most actionable error message to user

### Auto-Fix Capabilities
Some requirements can be automatically fixed:
- **Navigation**: `navmenu-open` can auto-open and dock navigation menu
- **Parent Navigation**: Can auto-expand collapsed navigation sections
- **Permissions**: Some permission issues provide helpful guidance
- **User Action**: "Fix this" buttons appear when automatic fixes are available

## Complete Requirements Reference

### Navigation and UI State Requirements

### `navmenu-open`

**Purpose**: Ensures the navigation menu is open and visible.

```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="a[data-testid='Nav menu item'][href='/connections']"
  data-requirements="navmenu-open"
>
  Click Connections in the left-side menu.
</li>
```

**Explanation when failed**: "The navigation menu needs to be open and docked. Click 'Fix this' to automatically open and dock the navigation menu."

**Auto-Fix**: ✅ Yes - automatically opens and docks navigation menu

**Implementation**: Checks for `#mega-menu-toggle` button state and navigation visibility

### `exists-reftarget`

**Purpose**: Verifies the target element specified in `data-reftarget` exists on the page.

```html
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Save dashboard" 
    data-requirements="exists-reftarget"
    data-hint="Ensures the save button is available before trying to click it">
  Save your dashboard changes.
</li>
```

**Explanation when failed**: "The target element must be visible and available on the page."

**Auto-Fix**: ❌ No - requires manual user action or navigation

**Implementation**: Uses `document.querySelector()` to verify element existence

### `navmenu-closed`

**Purpose**: Ensures the navigation menu is closed/hidden (opposite of navmenu-open).

```html
<li class="interactive" 
    data-targetaction="highlight" 
    data-reftarget="button[data-testid='main-content-button']"
    data-requirements="navmenu-closed"
    data-hint="Some actions work better with navigation closed">
  Focus on main content area
</li>
```

**Explanation when failed**: "Please close the navigation menu first."

**Auto-Fix**: ❌ No - user should manually close navigation

## Page and Navigation Requirements

### `on-page:<path>`

**Purpose**: Ensures the user is on a specific page or URL path.

```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="button[data-testid='add-panel-button']"
  data-requirements="on-page:/dashboard"
>
  Add a new panel to your dashboard.
</li>
```

**Examples**:

- `on-page:/dashboard` - User must be on any dashboard page
- `on-page:/connections` - User must be on the connections page
- `on-page:/admin` - User must be on any admin page

**Explanation when failed**: "Navigate to the '{path}' page first."

## User Authentication and Permissions

### `is-admin`

**Purpose**: Requires the user to have Grafana admin privileges.

```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/admin/users" data-requirements="is-admin">
  Open the user management page.
</li>
```

**Explanation when failed**: "You need administrator privileges to perform this action. Please log in as an admin user."

### `has-role:<role>`

**Purpose**: Checks if the user has a specific organizational role.

**Supported roles**:

- `admin` or `grafana-admin` - Grafana admin privileges
- `editor` - Editor permissions or higher
- `viewer` - Any logged-in user

```html
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Create dashboard"
  data-requirements="has-role:editor"
>
  Create a new dashboard.
</li>
```

**Examples**:

- `has-role:admin` - User must be organization admin
- `has-role:editor` - User must be editor or admin
- `has-role:viewer` - User must be logged in

**Explanation when failed**: "You need {role} role or higher to perform this action."

### `has-permission:<permission>`

**Purpose**: Verifies the user has a specific Grafana permission.

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/datasources/new"
  data-requirements="has-permission:datasources:create"
>
  Create a new data source.
</li>
```

**Explanation when failed**: "You need the '{permission}' permission to perform this action."

## Data Source Requirements

### `has-datasources`

**Purpose**: Ensures at least one data source is configured in Grafana.

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/dashboard/new"
  data-requirements="has-datasources"
>
  Create your first dashboard.
</li>
```

**Explanation when failed**: "At least one data source needs to be configured."

### `has-datasource:<identifier>`

**Purpose**: Checks for a specific data source by name, UID, or type.

**Search methods**:

- **By name**: Exact data source name match
- **By UID**: Exact data source UID match
- **By type**: Data source type (prometheus, loki, influxdb, etc.)

```html
<!-- By name -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="prometheus-datasource"
  data-requirements="has-datasource:prometheus-main"
>
  Select your Prometheus data source.
</li>

<!-- By type -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="textarea[data-testid='query-editor']"
  data-targetvalue="rate(http_requests_total[5m])"
  data-requirements="has-datasource:prometheus"
>
  Enter a Prometheus query.
</li>

<!-- By UID -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="div[data-testid='data-source-card']"
  data-requirements="has-datasource:P1809F7CD0C75ACF3"
>
  Configure your data source settings.
</li>
```

**Explanation when failed**: "The '{identifier}' data source needs to be configured first."

## Plugin and Extension Requirements

### `has-plugin:<pluginId>`

**Purpose**: Verifies a specific plugin is installed and enabled.

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/a/volkovlabs-rss-datasource"
  data-requirements="has-plugin:volkovlabs-rss-datasource"
>
  Configure the RSS data source plugin.
</li>
```

**Examples**:

- `has-plugin:grafana-clock-panel` - Clock panel plugin
- `has-plugin:volkovlabs-rss-datasource` - RSS data source plugin
- `has-plugin:grafana-piechart-panel` - Pie chart panel plugin

**Explanation when failed**: "The '{pluginId}' plugin needs to be installed and enabled."

## Dashboard and Content Requirements

### `has-dashboard-named:<title>`

**Purpose**: Ensures a dashboard with a specific title exists.

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/d/monitoring-overview"
  data-requirements="has-dashboard-named:System Monitoring"
>
  Open your monitoring dashboard.
</li>
```

**Examples**:

- `has-dashboard-named:System Overview` - Exact title match required
- `has-dashboard-named:Production Metrics` - Case-sensitive matching

**Explanation when failed**: "The dashboard '{title}' needs to exist first. Complete the previous tutorial or create it manually."

## System and Environment Requirements

### `has-feature:<toggle>`

**Purpose**: Checks if a Grafana feature toggle is enabled.

```html
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Query splitting"
  data-requirements="has-feature:queryLibrary"
>
  Use the query library feature.
</li>
```

**Examples**:

- `has-feature:alerting` - Alerting system enabled
- `has-feature:expressions` - Query expressions enabled
- `has-feature:live` - Live streaming enabled

**Explanation when failed**: "The '{feature}' feature needs to be enabled."

### `in-environment:<env>`

**Purpose**: Restricts functionality to specific Grafana environments.

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/admin/settings"
  data-requirements="in-environment:development"
>
  Access development settings.
</li>
```

**Examples**:

- `in-environment:development` - Development environment only
- `in-environment:production` - Production environment only
- `in-environment:cloud` - Grafana Cloud only

**Explanation when failed**: "This action is only available in the {env} environment."

### `min-version:<version>`

**Purpose**: Ensures Grafana version meets minimum requirements.

```html
<li class="interactive" data-targetaction="button" data-reftarget="Scene app" data-requirements="min-version:9.0.0">
  Open the new scene-based application.
</li>
```

**Examples**:

- `min-version:9.0.0` - Requires Grafana 9.0 or higher
- `min-version:10.2.1` - Requires specific patch version
- `min-version:8.5.0` - Legacy version requirement

**Explanation when failed**: "This feature requires Grafana version {version} or higher."

## Sequential and Dependency Requirements

### `section-completed:<sectionId>`

**Purpose**: Creates dependencies between tutorial sections, ensuring prerequisite sections are completed first.

```html
<span id="setup-datasource" class="interactive" data-targetaction="sequence">
  <!-- First section content -->
</span>

<span
  id="create-dashboard"
  class="interactive"
  data-targetaction="sequence"
  data-requirements="section-completed:setup-datasource"
>
  <!-- Second section - requires first to be completed -->
</span>
```

**Examples**:

- `section-completed:data-source-setup` - Previous section must be done
- `section-completed:user-onboarding` - Onboarding must be complete
- `section-completed:basic-configuration` - Basic setup required

**Explanation when failed**: "Complete the '{sectionId}' section before continuing to this section."

## Combining Multiple Requirements

Requirements can be combined using commas. **All requirements must pass** for the element to be enabled.

### Common combinations

```html
<!-- User must be admin AND on admin page -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Delete user"
  data-requirements="is-admin,on-page:/admin/users"
>
  Remove the selected user.
</li>

<!-- Must have data source AND be on dashboard page -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="div[data-testid='panel-editor']"
  data-requirements="has-datasource:prometheus,on-page:/dashboard"
>
  Configure your panel query.
</li>

<!-- Plugin required AND specific feature enabled -->
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/a/my-custom-app"
  data-requirements="has-plugin:my-custom-app,has-feature:customApps"
>
  Launch the custom application.
</li>

<!-- Sequential dependency with navigation -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Add panel"
  data-requirements="section-completed:datasource-setup,on-page:/dashboard"
>
  Add your first panel.
</li>
```

## Advanced Usage Patterns

### Progressive requirements

Build complexity gradually by using different requirement sets:

```html
<!-- Basic setup -->
<li class="interactive" data-requirements="has-datasources">Start with any data source.</li>

<!-- Specific setup -->
<li class="interactive" data-requirements="has-datasource:prometheus">Now use Prometheus specifically.</li>

<!-- Advanced features -->
<li class="interactive" data-requirements="has-datasource:prometheus,has-feature:expressions,min-version:9.0.0">
  Use advanced Prometheus expressions.
</li>
```

### Error handling and user guidance

Each requirement provides helpful error messages and, where possible, "Fix this" buttons:

- **Automatic fixes**: `navmenu-open` can auto-open the navigation
- **Retry buttons**: Most requirements offer retry functionality
- **Clear explanations**: Users understand what needs to be done
- **Contextual help**: Error messages explain why the requirement exists

### Testing requirements locally

For development and testing, you can simulate different requirement states:

```javascript
// In browser console - simulate admin user
window.grafanaBootData.user.isGrafanaAdmin = true;

// Simulate feature toggles
window.grafanaBootData.settings.featureToggles.myFeature = true;

// Check current requirements state
console.log('Current user:', window.grafanaBootData.user);
console.log('Feature toggles:', window.grafanaBootData.settings.featureToggles);
```

## Best Practices

### Requirement design

- **Start simple**: Begin with basic requirements, add complexity gradually
- **User context**: Consider what state users will realistically be in
- **Clear dependencies**: Make prerequisite relationships obvious
- **Fallback paths**: Provide alternative ways to meet requirements when possible

### Error messaging

- **Actionable**: Tell users exactly what to do next
- **Context**: Explain why the requirement exists
- **Progressive**: Guide users through a logical sequence
- **Helpful**: Provide "Fix this" options where technically possible

### Performance considerations

- **Efficient checking**: Requirements are checked efficiently with caching
- **Throttled updates**: Live monitoring is throttled to prevent performance issues
- **Smart triggers**: Only relevant changes trigger re-evaluation
- **Graceful degradation**: Failed requirement checks don't break the experience

## Troubleshooting

### Common issues

**"Requirements never pass"**:

- Check browser console for detailed error messages
- Verify requirement syntax matches examples exactly
- Ensure required elements/data actually exist

**"Requirements pass but shouldn't"**:

- Requirements may be cached - try refreshing the page
- Check for typos in requirement names
- Verify case sensitivity for names and identifiers

**"Fix this button doesn't work"**:

- Only certain requirements support automatic fixing
- Check browser console for error details
- Some fixes require specific user permissions

### Debug tools

Enable development mode logging:

```javascript
localStorage.setItem('grafana-docs-debug', 'true');
// Reload page to see detailed requirement checking logs
```

Check requirement state:

```javascript
// Access the sequential requirements manager
const manager = window.SequentialRequirementsManager?.getInstance();
if (manager) {
  manager.logCurrentState();
}
```
