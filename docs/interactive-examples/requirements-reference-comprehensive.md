# Requirements and Objectives Reference - Comprehensive Guide

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

#### `navmenu-open`

**Purpose**: Ensures the navigation menu is open and visible.

**Auto-Fix**: ✅ Yes - automatically opens and docks navigation menu

**Implementation**: Checks for `#mega-menu-toggle` button state and navigation visibility

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

#### `exists-reftarget`

**Purpose**: Verifies the target element specified in `data-reftarget` exists on the page.

**Auto-Fix**: ❌ No - requires manual user action or navigation

**Implementation**: Uses `document.querySelector()` to verify element existence

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

#### `navmenu-closed`

**Purpose**: Ensures the navigation menu is closed/hidden (opposite of navmenu-open).

**Auto-Fix**: ❌ No - user should manually close navigation

**Implementation**: Checks navigation menu state via DOM inspection

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

### Page and Navigation Requirements

#### `on-page:<path>`

**Purpose**: Ensures the user is on a specific page or URL path.

**Auto-Fix**: ❌ No - user must navigate manually or use navigate action

**Implementation**: Compares current `location.pathname` with required path (supports partial matching)

**Path Matching**:
- **Exact Match**: `/dashboard/new` matches only that specific path
- **Partial Match**: `/dashboard` matches `/dashboard/new`, `/dashboard/edit`, etc.
- **Case Sensitive**: Paths are compared case-sensitively

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
- `on-page:/dashboard/new` - User must be on the new dashboard page specifically

**Explanation when failed**: "Navigate to the '{path}' page first."

### User Authentication and Permissions

#### `is-admin`

**Purpose**: Requires the user to have Grafana admin privileges.

**Auto-Fix**: ❌ No - requires different user login

**Implementation**: Checks `config.bootData.user.isGrafanaAdmin` flag

```html
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/admin/users" 
    data-requirements="is-admin"
    data-hint="User management requires admin privileges">
  Open the user management page.
</li>
```

**Explanation when failed**: "You need administrator privileges to perform this action. Please log in as an admin user."

#### `has-role:<role>`

**Purpose**: Checks if the user has a specific organizational role.

**Auto-Fix**: ❌ No - requires different user login or role assignment

**Implementation**: Checks `config.bootData.user.orgRole` and `isGrafanaAdmin` flag

**Supported roles**:
- `admin` or `grafana-admin` - Grafana admin privileges
- `editor` - Editor permissions or higher (includes admin)
- `viewer` - Any logged-in user (includes editor and admin)

```html
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Create dashboard"
  data-requirements="has-role:editor"
  data-hint="Dashboard creation requires editor permissions or higher"
>
  Create a new dashboard.
</li>
```

**Examples**:
- `has-role:admin` - User must be organization admin
- `has-role:editor` - User must be editor or admin
- `has-role:viewer` - User must be logged in

**Explanation when failed**: "You need {role} role or higher to perform this action."

#### `has-permission:<permission>`

**Purpose**: Verifies the user has a specific Grafana permission.

**Auto-Fix**: ❌ No - requires permission assignment by admin

**Implementation**: Uses Grafana's `hasPermission()` API

**Common Permissions**:
- `dashboards:read` - Can view dashboards
- `dashboards:write` - Can create/edit dashboards
- `dashboards:delete` - Can delete dashboards
- `datasources:read` - Can view data sources
- `datasources:write` - Can create/edit data sources
- `alerting:read` - Can view alerts
- `alerting:write` - Can create/edit alerts
- `users:read` - Can view users
- `users:write` - Can manage users

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/datasources/new"
  data-requirements="has-permission:datasources:create"
  data-hint="Creating data sources requires specific permissions"
>
  Create a new data source.
</li>
```

**Explanation when failed**: "You need the '{permission}' permission to perform this action."

### Data Source Requirements

#### `has-datasources`

**Purpose**: Ensures at least one data source is configured in Grafana.

**Auto-Fix**: ❌ No - user must configure data sources

**Implementation**: Calls `getDataSourceSrv().getList()` to check for any configured data sources

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/dashboard/new"
  data-requirements="has-datasources"
  data-hint="Dashboards need data sources to display information"
>
  Create your first dashboard.
</li>
```

**Explanation when failed**: "At least one data source needs to be configured."

#### `has-datasource:<identifier>`

**Purpose**: Checks for a specific data source by name, UID, or type.

**Auto-Fix**: ❌ No - user must configure the specific data source

**Implementation**: Searches configured data sources using `getDataSourceSrv().getList()`

**Search methods**:
- **By name**: Exact data source name match (case-insensitive)
- **By UID**: Exact data source UID match
- **By type**: Data source type (prometheus, loki, influxdb, etc.)

**Type Syntax**: Use `type:` prefix for type-based matching

```html
<!-- By name -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="prometheus-datasource"
  data-requirements="has-datasource:prometheus-main"
  data-hint="Selects the specific Prometheus data source"
>
  Select your Prometheus data source.
</li>

<!-- By type -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="textarea[data-testid='query-editor']"
  data-targetvalue="rate(http_requests_total[5m])"
  data-requirements="has-datasource:type:prometheus"
  data-hint="PromQL queries require a Prometheus-type data source"
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

**Common Data Source Types**:
- `prometheus` - Prometheus metrics
- `loki` - Loki logs  
- `tempo` - Tempo traces
- `influxdb` - InfluxDB time series
- `elasticsearch` - Elasticsearch
- `postgres` - PostgreSQL
- `mysql` - MySQL
- `cloudwatch` - AWS CloudWatch

**Explanation when failed**: "The '{identifier}' data source needs to be configured first."

### Plugin and Extension Requirements

#### `has-plugin:<pluginId>`

**Purpose**: Verifies a specific plugin is installed and enabled.

**Auto-Fix**: ❌ No - user must install plugin through admin interface

**Implementation**: Calls `/api/plugins` endpoint to check installed plugins

**Plugin ID Format**: Use the exact plugin ID from the Grafana plugin catalog

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/a/volkovlabs-rss-datasource"
  data-requirements="has-plugin:volkovlabs-rss-datasource"
  data-hint="RSS data source plugin must be installed first"
>
  Configure the RSS data source plugin.
</li>
```

**Common Plugin IDs**:
- `grafana-clock-panel` - Clock panel plugin
- `volkovlabs-rss-datasource` - RSS data source plugin
- `grafana-piechart-panel` - Pie chart panel plugin
- `grafana-worldmap-panel` - World map panel plugin
- `grafana-synthetic-monitoring-app` - Synthetic monitoring app

**Explanation when failed**: "The '{pluginId}' plugin needs to be installed and enabled."

### Dashboard and Content Requirements

#### `has-dashboard-named:<title>`

**Purpose**: Ensures a dashboard with a specific title exists.

**Auto-Fix**: ❌ No - user must create the dashboard

**Implementation**: Calls `/api/search` endpoint to find dashboards by title (case-insensitive)

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/d/monitoring-overview"
  data-requirements="has-dashboard-named:System Monitoring"
  data-hint="Tutorial assumes this dashboard exists from previous steps"
>
  Open your monitoring dashboard.
</li>
```

**Examples**:
- `has-dashboard-named:System Overview` - Exact title match required
- `has-dashboard-named:Production Metrics` - Case-insensitive matching
- `has-dashboard-named:My First Dashboard` - Handles spaces and special characters

**Explanation when failed**: "The dashboard '{title}' needs to exist first. Complete the previous tutorial or create it manually."

### System and Environment Requirements

#### `has-feature:<toggle>`

**Purpose**: Checks if a Grafana feature toggle is enabled.

**Auto-Fix**: ❌ No - requires admin configuration

**Implementation**: Checks `config.featureToggles[featureName]` configuration

**Common Feature Toggles**:
- `alerting` - Unified alerting system
- `expressions` - Query expressions
- `live` - Live streaming
- `queryLibrary` - Query library feature
- `scenes` - Scenes framework
- `publicDashboards` - Public dashboard sharing

```html
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget="Query splitting"
  data-requirements="has-feature:queryLibrary"
  data-hint="Query library feature must be enabled"
>
  Use the query library feature.
</li>
```

**Explanation when failed**: "The '{feature}' feature needs to be enabled."

#### `in-environment:<env>`

**Purpose**: Restricts functionality to specific Grafana environments.

**Auto-Fix**: ❌ No - environment is fixed at deployment

**Implementation**: Checks `config.buildInfo.env` value

**Environment Values**:
- `development` - Development environment
- `production` - Production environment  
- `cloud` - Grafana Cloud
- `enterprise` - Grafana Enterprise

```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/admin/settings"
  data-requirements="in-environment:development"
  data-hint="Development settings only available in dev environment"
>
  Access development settings.
</li>
```

**Explanation when failed**: "This action is only available in the {env} environment."

#### `min-version:<version>`

**Purpose**: Ensures Grafana version meets minimum requirements.

**Auto-Fix**: ❌ No - requires Grafana upgrade

**Implementation**: Compares `config.buildInfo.version` using semantic version logic

**Version Format**: Use semantic versioning (major.minor.patch)

```html
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Scene app" 
    data-requirements="min-version:9.0.0"
    data-hint="Scenes framework introduced in Grafana 9.0">
  Open the new scene-based application.
</li>
```

**Examples**:
- `min-version:9.0.0` - Requires Grafana 9.0 or higher
- `min-version:10.2.1` - Requires specific patch version
- `min-version:8.5.0` - Legacy version requirement

**Explanation when failed**: "This feature requires Grafana version {version} or higher."

### Sequential and Dependency Requirements

#### `section-completed:<sectionId>`

**Purpose**: Creates dependencies between tutorial sections, ensuring prerequisite sections are completed first.

**Auto-Fix**: ❌ No - user must complete prerequisite sections

**Implementation**: Checks DOM for section element with `id` and `completed` CSS class

**Section ID Format**: Must match the `id` attribute of the prerequisite section

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

## Advanced Requirements

### Custom Data Source Patterns

#### `has-datasource:type:<type>`

**Purpose**: Checks for data sources of a specific type (more flexible than exact name matching).

```html
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue='{job="prometheus"}'
    data-requirements="has-datasource:type:prometheus"
    data-hint="Requires any Prometheus data source">
  Enter Prometheus query
</li>
```

#### `has-datasource:name:<exact-name>`

**Purpose**: Checks for data source with exact name (case-sensitive).

```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Production Prometheus"
    data-requirements="has-datasource:name:Production Prometheus"
    data-hint="Requires exact name match">
  Select production data source
</li>
```

### Complex Permission Patterns

#### `has-permission:<action>:<resource>`

**Purpose**: Granular permission checking for specific actions on resources.

```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Delete dashboard"
    data-requirements="has-permission:dashboards:delete"
    data-hint="Requires dashboard deletion permissions">
  Delete the dashboard
</li>
```

**Common Permission Patterns**:
- `dashboards:read`, `dashboards:write`, `dashboards:delete`
- `datasources:read`, `datasources:write`, `datasources:delete`
- `alerting:read`, `alerting:write`, `alerting:delete`
- `users:read`, `users:write`, `users:delete`
- `orgs:read`, `orgs:write`, `orgs:delete`

### Feature Toggle Patterns

#### `has-feature:<feature>:<subfeature>`

**Purpose**: Check for specific sub-features within larger feature sets.

```html
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="button[data-testid='query-history']"
    data-requirements="has-feature:queryLibrary:history"
    data-hint="Query history sub-feature must be enabled">
  View query history
</li>
```

## Combining Multiple Requirements

Requirements can be combined using commas. **All requirements must pass** for the element to be enabled.

### Logical Combinations

#### AND Logic (Default)
```html
<!-- All conditions must be true -->
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Create alert"
    data-requirements="has-datasource:prometheus,has-permission:alerting:write,on-page:/alerting"
    data-hint="Requires Prometheus data source, alerting permissions, and alerting page">
  Create a new alert rule
</li>
```

#### Progressive Requirements
```html
<!-- Start with basic requirements -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="button[data-testid='basic-panel']"
    data-requirements="has-datasources">
  Create basic visualization
</li>

<!-- Add more specific requirements -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue="rate(http_requests_total[5m])"
    data-requirements="has-datasource:prometheus,has-feature:expressions,min-version:9.0.0">
  Enter advanced Prometheus query
</li>
```

### Common Requirement Patterns

#### Admin Operations
```html
<li class="interactive"
    data-targetaction="navigate"
    data-reftarget="/admin/plugins"
    data-requirements="is-admin,navmenu-open"
    data-hint="Plugin management requires admin access">
  Manage plugins
</li>
```

#### Data Source Dependent Actions
```html
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue="up"
    data-requirements="has-datasource:prometheus,on-page:/explore"
    data-hint="Explore page with Prometheus data source required">
  Query Prometheus metrics
</li>
```

#### Sequential Tutorial Dependencies
```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Add panel"
    data-requirements="section-completed:datasource-setup,on-page:/dashboard"
    data-hint="Must complete data source setup before adding panels">
  Add your first panel
</li>
```

## Objectives Usage Patterns

### Auto-Completion Scenarios

#### Skip Completed Setup
```html
<span id="setup-prometheus"
      class="interactive"
      data-targetaction="sequence"
      data-reftarget="span#setup-prometheus"
      data-objectives="has-datasource:type:prometheus"
      data-hint="Skips entire section if Prometheus already configured">
  <h3>Set up Prometheus Data Source</h3>
  <!-- Steps only execute if Prometheus not already configured -->
</span>
```

#### Smart Navigation
```html
<li class="interactive"
    data-targetaction="navigate"
    data-reftarget="/dashboard/new"
    data-objectives="on-page:/dashboard/new"
    data-requirements="has-datasources"
    data-hint="Auto-completes if user is already on target page">
  Navigate to dashboard creation
</li>
```

#### State-Based Completion
```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Enable alerting"
    data-objectives="has-feature:alerting"
    data-requirements="is-admin,exists-reftarget"
    data-hint="Auto-completes if alerting already enabled">
  Enable the alerting feature
</li>
```

### Section-Level Objectives

When section objectives are met, ALL child steps are automatically marked complete:

```html
<span id="install-plugin"
      class="interactive"
      data-targetaction="sequence"
      data-reftarget="span#install-plugin"
      data-objectives="has-plugin:grafana-clock-panel"
      data-hint="Entire section skipped if plugin already installed">
  
  <h3>Install Clock Panel Plugin</h3>
  
  <ul>
    <!-- All these steps are marked complete if plugin already installed -->
    <li class="interactive" data-targetaction="navigate" data-reftarget="/admin/plugins">
      Go to plugins page
    </li>
    <li class="interactive" data-targetaction="formfill" data-reftarget="input[type='search']" data-targetvalue="clock">
      Search for clock plugin
    </li>
    <li class="interactive" data-targetaction="button" data-reftarget="Install">
      Install the plugin
    </li>
  </ul>
</span>
```

## Error Handling and User Experience

### Auto-Fix Capabilities

#### Navigation Fixes
```html
<!-- Navigation menu auto-fix -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="a[href='/connections']"
    data-requirements="navmenu-open"
    data-hint="Navigation menu will be opened automatically">
  Click Connections menu item
</li>

<!-- Parent navigation expansion -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="a[href='/alerting/list']"
    data-requirements="navmenu-open,exists-reftarget"
    data-hint="Parent alerting section will be expanded if needed">
  Click Alerting → Alert Rules
</li>
```

#### Requirement Retry Logic
- **Automatic Retry**: Failed requirements are rechecked when DOM changes
- **User Retry**: "Retry" button manually triggers requirement recheck
- **Fix Then Retry**: "Fix this" button attempts automatic fix, then rechecks

### Error Messages and Recovery

#### Helpful Error Messages
```html
<li class="interactive"
    data-targetaction="button"
    data-reftarget="Create alert"
    data-requirements="has-datasource:prometheus,has-permission:alerting:write"
    data-hint="Clear explanation of what's needed">
  Create alert rule
</li>
```

**Failed Requirements Show**:
- Specific requirement that failed
- User-friendly explanation of what's needed
- Actionable next steps ("Fix this", "Retry", "Skip")
- Context about why the requirement exists

#### Skippable Steps
```html
<li class="interactive"
    data-targetaction="navigate"
    data-reftarget="/admin/plugins"
    data-requirements="is-admin"
    data-skippable="true"
    data-hint="Admin-only feature - can be skipped by non-admin users">
  Access plugin management (admin only)
</li>
```

**Skippable Behavior**:
- Shows "Skip" button when requirements fail
- Skipped steps are marked complete for flow purposes
- Visual indicator shows step was skipped (different from completed)
- Allows tutorial progression despite missing permissions/setup

### Performance and Optimization

#### Efficient Requirement Checking
```html
<!-- Group related requirements -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='query-editor']"
    data-targetvalue="rate(cpu_usage[5m])"
    data-requirements="has-datasource:prometheus,on-page:/explore,exists-reftarget"
    data-hint="Groups related checks for efficiency">
  Enter CPU usage query
</li>
```

#### Smart Caching
- Requirements results are cached until relevant state changes
- DOM monitoring triggers selective rechecking
- API calls are debounced to prevent excessive requests
- Failed requirements are retried intelligently

## Testing and Validation

### Requirement Testing Strategies

#### Unit Testing Requirements
```javascript
// Example test structure for requirement validation
describe('has-datasource requirement', () => {
  it('should pass when prometheus datasource exists', async () => {
    // Mock data source service
    // Test requirement checking
    // Verify result
  });
  
  it('should fail when datasource missing', async () => {
    // Test failure case
    // Verify error message
  });
});
```

#### Integration Testing
- Test requirement combinations under different user roles
- Validate auto-fix functionality
- Verify error messages are helpful and accurate
- Test performance under various system states

#### Manual Testing Checklist
- [ ] Requirements work across different Grafana versions
- [ ] Error messages are clear and actionable
- [ ] Auto-fix functionality works reliably
- [ ] Requirements don't conflict with each other
- [ ] Performance is acceptable with complex requirement sets

### Debugging Requirements

#### Browser Console Debugging
```javascript
// Enable debug logging
localStorage.setItem('grafana-docs-debug', 'true');

// Check current requirement state
const manager = window.SequentialRequirementsManager?.getInstance();
if (manager) {
  manager.logCurrentState();
}

// Manual requirement checking
const checker = await import('./requirements-checker.utils');
const result = await checker.checkRequirements({
  requirements: 'has-datasource:prometheus',
  targetAction: 'button',
  refTarget: 'test'
});
console.log(result);
```

#### Common Debug Patterns
- **Network Issues**: Check browser network tab for failed API calls
- **Permission Problems**: Verify user role and permissions in browser console
- **DOM Issues**: Ensure target elements exist and are visible
- **Timing Issues**: Check if requirements are checked too early in page lifecycle

## Best Practices Summary

### Requirement Design
- **Start Simple**: Begin with basic requirements, add complexity gradually
- **User Context**: Consider what state users will realistically be in
- **Clear Dependencies**: Make prerequisite relationships obvious
- **Fallback Paths**: Provide alternative ways to meet requirements when possible

### Error Messaging
- **Actionable**: Tell users exactly what to do next
- **Context**: Explain why the requirement exists
- **Progressive**: Guide users through a logical sequence
- **Helpful**: Provide "Fix this" options where technically possible

### Performance Considerations
- **Efficient Checking**: Requirements are checked efficiently with caching
- **Throttled Updates**: Live monitoring is throttled to prevent performance issues
- **Smart Triggers**: Only relevant changes trigger re-evaluation
- **Graceful Degradation**: Failed requirement checks don't break the experience

### Accessibility and Usability
- **Screen Readers**: Requirement explanations are accessible
- **Keyboard Navigation**: All interactive elements support keyboard access
- **Visual Feedback**: Clear visual indicators for requirement states
- **Progressive Enhancement**: Works without JavaScript for basic content

