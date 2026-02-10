# Requirements reference

Requirements control when interactive elements become enabled. They are specified as a `requirements` array on any interactive, section, guided, multistep, conditional, or quiz block. All requirements in the array must pass for the block to be enabled.

## Core concepts

- **Requirements**: an array of condition strings -- e.g., `["navmenu-open", "on-page:/dashboard"]`
- **Validation**: all requirements must pass for the element to become enabled
- **Live checking**: event-driven rechecks respond to DOM/navigation changes and relevant clicks; an optional scoped heartbeat can re-validate fragile prerequisites for a short window
- **User feedback**: failed requirements show helpful explanations with "Fix this" or "Retry" buttons

## Navigation and UI state requirements

### `navmenu-open`

Ensures the navigation menu is open and visible.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "a[data-testid='data-testid Nav menu item'][href='/connections']",
  "requirements": ["navmenu-open"],
  "content": "Click **Connections** in the left-side menu."
}
```

If the user closes the navigation after a fix, the system re-detects the change and reverts the step to the fix state.

### `exists-reftarget`

Verifies the target element specified in `reftarget` exists on the page.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Save dashboard",
  "requirements": ["exists-reftarget"],
  "content": "Save your dashboard changes."
}
```

### `form-valid`

Ensures the current form on the page passes validation.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Save",
  "requirements": ["form-valid"],
  "content": "Save your configuration."
}
```

## Page and navigation requirements

### `on-page:<path>`

Ensures the user is on a specific page or URL path.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "button[data-testid='add-panel-button']",
  "requirements": ["on-page:/dashboard"],
  "content": "Add a new panel to your dashboard."
}
```

Examples:

- `on-page:/dashboard` -- any dashboard page
- `on-page:/connections` -- connections page
- `on-page:/admin` -- any admin page

## User authentication and permissions

### `is-logged-in`

Ensures the user is authenticated.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/dashboards",
  "requirements": ["is-logged-in"],
  "content": "View your dashboards."
}
```

### `is-admin`

Requires Grafana admin privileges.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/admin/users",
  "requirements": ["is-admin"],
  "content": "Open the user management page."
}
```

### `is-editor`

Requires at least Editor role in the current organization.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Save dashboard",
  "requirements": ["is-editor"],
  "content": "Save your dashboard changes."
}
```

### `has-role:<role>`

Checks if the user has a specific organizational role.

Supported roles: `admin` (or `grafana-admin`), `editor`, `viewer`.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Create dashboard",
  "requirements": ["has-role:editor"],
  "content": "Create a new dashboard."
}
```

### `has-permission:<permission>`

Verifies the user has a specific Grafana permission.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/datasources/new",
  "requirements": ["has-permission:datasources:create"],
  "content": "Create a new data source."
}
```

## Data source requirements

### `has-datasources`

Ensures at least one data source is configured.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/dashboard/new",
  "requirements": ["has-datasources"],
  "content": "Create your first dashboard."
}
```

### `has-datasource:<identifier>`

Checks for a specific data source by name or type (case-insensitive). Searches name first, then type.

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "textarea[data-testid='query-editor']",
  "targetvalue": "rate(http_requests_total[5m])",
  "requirements": ["has-datasource:prometheus"],
  "content": "Enter a Prometheus query."
}
```

Does **not** test connectivity -- use `datasource-configured` for that.

### `datasource-configured:<identifier>`

Checks that a specific data source exists **and** passes a connection test. Searches by name or type (case-insensitive), then runs the data source's health check endpoint.

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "textarea[data-testid='query-editor']",
  "targetvalue": "{job=\"grafana\"}",
  "requirements": ["datasource-configured:loki"],
  "content": "Enter a Loki query."
}
```

Difference from `has-datasource`:

| Requirement | Checks existence | Checks connectivity |
| --- | --- | --- |
| `has-datasource:X` | Yes | No |
| `datasource-configured:X` | Yes | Yes |

## Plugin and extension requirements

### `has-plugin:<pluginId>`

Verifies a specific plugin is installed (may be disabled).

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/a/volkovlabs-rss-datasource",
  "requirements": ["has-plugin:volkovlabs-rss-datasource"],
  "content": "Configure the RSS data source plugin."
}
```

### `plugin-enabled:<pluginId>`

Verifies a specific plugin is installed **and** enabled (ready to use).

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/a/volkovlabs-rss-datasource",
  "requirements": ["plugin-enabled:volkovlabs-rss-datasource"],
  "content": "Open the RSS data source plugin."
}
```

Difference from `has-plugin`:

| Requirement | Checks installed | Checks enabled |
| --- | --- | --- |
| `has-plugin:X` | Yes | No |
| `plugin-enabled:X` | Yes | Yes |

## Dashboard and content requirements

### `dashboard-exists`

Ensures at least one dashboard exists in the current organization.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/dashboards",
  "requirements": ["dashboard-exists"],
  "content": "View your existing dashboards."
}
```

### `has-dashboard-named:<title>`

Ensures a dashboard with a specific title exists (case-insensitive).

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/d/monitoring-overview",
  "requirements": ["has-dashboard-named:System Monitoring"],
  "content": "Open your monitoring dashboard."
}
```

## System and environment requirements

### `has-feature:<toggle>`

Checks if a Grafana feature toggle is enabled.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Query splitting",
  "requirements": ["has-feature:queryLibrary"],
  "content": "Use the query library feature."
}
```

### `in-environment:<env>`

Restricts functionality to specific Grafana environments.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/admin/settings",
  "requirements": ["in-environment:development"],
  "content": "Access development settings."
}
```

Values: `development`, `production`, `cloud`.

### `min-version:<version>`

Ensures Grafana version meets a minimum semver requirement.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Scene app",
  "requirements": ["min-version:9.0.0"],
  "content": "Open the new scene-based application."
}
```

## Renderer context requirements

### `renderer:<renderer>`

Controls content visibility based on the rendering context. Used for context-aware content that should differ between the Pathfinder app and other rendering environments (e.g., a public documentation website).

Supported values:

| Value | In Pathfinder app | Description |
| --- | --- | --- |
| `pathfinder` | Always `true` | Content is shown in the Pathfinder app |
| `website` | Always `false` | Content is only for website/public docs context |

```json
{
  "type": "conditional",
  "conditions": ["renderer:pathfinder"],
  "whenTrue": [
    { "type": "markdown", "content": "Click **Show me** below to highlight the button in the Grafana UI." }
  ],
  "whenFalse": [
    { "type": "markdown", "content": "Navigate to the Connections page in your Grafana instance." }
  ]
}
```

This requirement is evaluated differently by different rendering tools, allowing the same guide source to produce different content in different contexts.

## Variable requirements

### `var-<variableName>:<expectedValue>`

Checks if a guide response variable has a specific value. Variables are set by [input blocks](./json-guide-format.md#input-block).

```json
{
  "type": "section",
  "title": "Advanced configuration",
  "requirements": ["var-termsAccepted:true"],
  "blocks": []
}
```

Syntax: `var-{variableName}:{expectedValue}`

Examples:

- `var-termsAccepted:true` -- boolean variable must be `true`
- `var-experienceLevel:advanced` -- text variable must equal `"advanced"`
- `var-datasourceName:prometheus` -- variable must match specific value

Used with conditional blocks:

```json
{
  "type": "conditional",
  "conditions": ["var-isProd:true"],
  "whenTrue": [{ "type": "markdown", "content": "Production settings enabled." }],
  "whenFalse": [{ "type": "markdown", "content": "Development mode active." }]
}
```

See [variable substitution](./json-guide-format.md#variable-substitution) for more details.

## Sequential and dependency requirements

### `section-completed:<sectionId>`

Creates dependencies between sections, ensuring prerequisite sections are completed first.

```json
{
  "type": "section",
  "id": "create-dashboard",
  "title": "Create a dashboard",
  "requirements": ["section-completed:setup-datasource"],
  "blocks": []
}
```

## Combining multiple requirements

All requirements in the array must pass. Use multiple entries for AND logic.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Delete user",
  "requirements": ["is-admin", "on-page:/admin/users"],
  "content": "Remove the selected user."
}
```

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/a/my-custom-app",
  "requirements": ["has-plugin:my-custom-app", "has-feature:customApps"],
  "content": "Launch the custom application."
}
```

### Progressive requirements

Build complexity gradually:

```json
[
  {
    "type": "interactive",
    "action": "highlight",
    "reftarget": "div[data-testid='panel']",
    "requirements": ["has-datasources"],
    "content": "Start with any data source."
  },
  {
    "type": "interactive",
    "action": "highlight",
    "reftarget": "div[data-testid='panel']",
    "requirements": ["has-datasource:prometheus"],
    "content": "Now use Prometheus specifically."
  },
  {
    "type": "interactive",
    "action": "highlight",
    "reftarget": "div[data-testid='panel']",
    "requirements": ["has-datasource:prometheus", "has-feature:expressions", "min-version:9.0.0"],
    "content": "Use advanced Prometheus expressions."
  }
]
```

## Objectives system

Objectives declare what a guide step will accomplish. They use the same syntax as requirements but serve a different purpose.

### Purpose

1. **Auto-completion**: if an objective is already met when a user visits a guide, the step is automatically marked complete with an "Already done!" message
2. **Skip unnecessary work**: users do not need to redo steps they have already accomplished

### Syntax

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Install plugin",
  "requirements": ["exists-reftarget"],
  "objectives": ["has-plugin:volkovlabs-rss-datasource"],
  "content": "Install the RSS data source plugin."
}
```

### Key behaviors

- **Objectives always win**: if objectives are met, the step is marked complete regardless of requirements state
- **All-or-nothing**: when multiple objectives are specified, ALL must be met
- **Same syntax as requirements**: use any requirement type as an objective

### Objectives vs requirements

| Aspect | Requirements | Objectives |
| --- | --- | --- |
| Purpose | Gate when step CAN execute | Gate WHETHER step NEEDS to execute |
| When met | Step becomes enabled | Step is auto-completed |
| Empty/missing | Always allowed to execute | Must be manually completed |

## Validation rules

The CLI validates condition syntax statically. Invalid conditions produce **warnings** in normal mode and **errors** in strict mode (`--strict`).

### Limits

- Maximum 10 components per condition string (comma-separated)

### Syntax rules

- Fixed types (`is-admin`, `is-logged-in`, `is-editor`, `exists-reftarget`, `navmenu-open`, `has-datasources`, `dashboard-exists`, `form-valid`) cannot have arguments
- Parameterized types (`has-datasource:X`, `on-page:/path`, `var-name:value`) require an argument after the colon
- Path arguments (e.g., `on-page:`) should start with `/`
- Version arguments (e.g., `min-version:`) should be semver format (e.g., `11.0.0`)
- Variable arguments (e.g., `var-`) use format `var-{variableName}:{expectedValue}`

### Common errors

| Invalid | Error | Fix |
| --- | --- | --- |
| `is-admin:true` | Unexpected argument | `is-admin` |
| `has-datasource:` | Missing argument | `has-datasource:prometheus` |
| `has-datasource` | Unknown type | `has-datasource:X` or `has-datasources` |
| `on-page:dashboard` | Invalid path format | `on-page:/dashboard` |
| `min-version:latest` | Invalid version format | `min-version:11.0.0` |
| `var-myVar` | Missing value | `var-myVar:true` |
| `var-:value` | Missing variable name | `var-variableName:value` |

## Complete requirements reference table

### Fixed requirements (no parameters)

| Requirement | Purpose |
| --- | --- |
| `navmenu-open` | Navigation menu is open and visible |
| `exists-reftarget` | Target element exists on the page |
| `form-valid` | Current form passes validation |
| `is-logged-in` | User is authenticated |
| `is-admin` | User has Grafana admin privileges |
| `is-editor` | User has at least Editor role |
| `has-datasources` | At least one data source is configured |
| `dashboard-exists` | At least one dashboard exists |

### Parameterized requirements

| Requirement | Purpose |
| --- | --- |
| `on-page:<path>` | User is on a specific page |
| `has-role:<role>` | User has a specific organizational role |
| `has-permission:<permission>` | User has a specific Grafana permission |
| `has-datasource:<identifier>` | Specific data source exists (by name or type) |
| `datasource-configured:<identifier>` | Specific data source exists and passes connection test |
| `has-plugin:<pluginId>` | Specific plugin is installed |
| `plugin-enabled:<pluginId>` | Specific plugin is installed and enabled |
| `has-dashboard-named:<title>` | Dashboard with specific title exists |
| `has-feature:<toggle>` | Feature toggle is enabled |
| `in-environment:<env>` | Running in a specific environment |
| `min-version:<version>` | Grafana version meets minimum requirement |
| `section-completed:<sectionId>` | Another section has been completed |
| `var-<name>:<value>` | Guide variable has expected value |
| `renderer:<renderer>` | Rendering context matches (`pathfinder` or `website`) |

## Error handling and user guidance

Each requirement provides helpful error messages and, where possible, "Fix this" buttons:

- **Automatic fixes**: `navmenu-open` can auto-open the navigation
- **Retry buttons**: most requirements offer retry functionality
- **Clear explanations**: users understand what needs to be done
- **Contextual help**: error messages explain why the requirement exists

## Troubleshooting

**Requirements never pass:**

- Check browser console for detailed error messages
- Verify requirement syntax matches examples exactly
- Ensure required elements/data actually exist

**Requirements pass but should not:**

- Requirements may be cached -- try refreshing the page
- Check for typos in requirement names
- Verify case sensitivity for names and identifiers

**"Fix this" button does not work:**

- Only certain requirements support automatic fixing
- Check browser console for error details
- Some fixes require specific user permissions

### Debug tools

Enable development mode logging:

```javascript
localStorage.setItem('grafana-docs-debug', 'true');
// Reload page to see detailed requirement checking logs
```
