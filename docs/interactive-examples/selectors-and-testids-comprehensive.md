# Selectors and Test IDs - Comprehensive Guide

This comprehensive guide provides stable selectors and patterns for targeting Grafana UI elements. These selectors are tested across different Grafana versions and themes to ensure reliability.

## Selector Stability Philosophy

### Preference Hierarchy (Most to Least Stable)
1. **`data-testid` attributes** - Explicitly designed for testing, most stable
2. **`id` attributes** - Stable when present, but not always available
3. **`href` attributes** - Stable for navigation elements
4. **ARIA attributes** - Stable and accessibility-friendly
5. **Semantic HTML** - Stable element types (`button`, `input`, etc.)
6. **CSS classes** - Less stable, use only when necessary

### Anti-Patterns to Avoid
❌ **Don't Use**:
- Auto-generated CSS classes (`.css-1234567`)
- Deep nested selectors (`.parent .child .grandchild`)
- Position-based selectors without context (`:nth-child(3)`)
- Framework-specific classes (`.react-component-xyz`)
- Styling-related classes (`.blue-button`, `.large-text`)

✅ **Do Use**:
- Semantic attributes (`data-testid`, `aria-label`, `role`)
- Stable structural attributes (`href`, `id`, `name`)
- Contextual pseudo-selectors (`:first-of-type` with element type)
- Logical grouping (attributes that define functionality)

## Navigation and Core Areas

### Main Navigation Menu

| Component | Preferred Selector | Fallback Options | Notes |
|-----------|-------------------|------------------|-------|
| **Nav menu item** | `a[data-testid='data-testid Nav menu item'][href='/path']` | `a[href='/path']` | Replace `/path` with target route |
| **Navigation container** | `nav[data-testid='navigation-mega-menu']` | `ul[aria-label='Navigation']`, `div[data-testid*='navigation']` | For checking if nav is open |
| **Menu toggle button** | `#mega-menu-toggle` | `button[aria-label*='menu']` | Opens/closes navigation |
| **Dock menu button** | `#dock-menu-button` | `button[aria-label*='dock']` | Docks navigation menu |

### Navigation Menu Items by Section

```html
<!-- Core sections -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/']">Home</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']">Dashboards</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/explore']">Explore</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerting']">Alerting</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']">Connections</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin']">Administration</li>

<!-- Admin subsections -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/users']">Admin → Users</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/plugins']">Admin → Plugins</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/admin/settings']">Admin → Settings</li>

<!-- Alerting subsections -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerting/list']">Alerting → Alert Rules</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/alerting/notifications']">Alerting → Contact Points</li>
```

### Header and Global Elements

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **App header** | `header[data-testid='grafana-app-header']` | `header[role='banner']` | Top header bar |
| **User menu** | `button[data-testid='user-menu']` | `button[aria-label*='user']` | User profile dropdown |
| **Search button** | `button[data-testid='search-button']` | `button[aria-label*='search']` | Global search |
| **Help menu** | `button[data-testid='help-button']` | `button[aria-label*='help']` | Help and documentation |
| **Main content** | `main[data-testid='main-content']` | `main[role='main']` | Primary content area |

## Dashboard and Panel Elements

### Dashboard Management

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **New dashboard** | `button[data-testid='new-dashboard']` | `a[href='/dashboard/new']` | Creates new dashboard |
| **Dashboard settings** | `button[data-testid='dashboard-settings']` | `button[aria-label*='settings']` | Dashboard configuration |
| **Save dashboard** | `button[data-testid='save-dashboard']` | Button text: `"Save"`, `"Save dashboard"` | Saves dashboard changes |
| **Dashboard title** | `input[data-testid='dashboard-title-input']` | `input[aria-label*='title']` | Dashboard name field |

### Panel Editing

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Add panel** | `button[data-testid='add-panel']` | Button text: `"Add panel"` | Creates new panel |
| **Panel edit** | `button[data-testid='panel-edit']` | `button[aria-label*='edit']` | Enters panel edit mode |
| **Query editor** | `textarea[data-testid='query-editor']` | `textarea.inputarea` | Monaco query editor |
| **Visualization picker** | `button[data-testid='toggle-viz-picker']` | `button[aria-label*='visualization']` | Opens viz picker |
| **Panel title** | `input[data-testid='Panel editor option pane field input Title']` | `input[aria-label*='title']` | Panel title field |

### Query Editor Components

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Query mode toggle** | `div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]` | `label[for*='code']` | Switch to code mode |
| **Run query** | `button[data-testid='run-query']` | Button text: `"Run query"`, `"Refresh"` | Executes query |
| **Query options** | `button[data-testid='query-options']` | `button[aria-label*='options']` | Query settings |
| **Add query** | `button[data-testid='add-query']` | Button text: `"Add query"` | Adds additional query |

### Visualization Components

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Time series viz** | `div[aria-label="Plugin visualization item Time series"]` | `[data-testid*='timeseries']` | Time series option |
| **Stat viz** | `div[aria-label="Plugin visualization item Stat"]` | `[data-testid*='stat']` | Stat panel option |
| **Table viz** | `div[aria-label="Plugin visualization item Table"]` | `[data-testid*='table']` | Table option |
| **Bar chart viz** | `div[aria-label="Plugin visualization item Bar chart"]` | `[data-testid*='barchart']` | Bar chart option |

## Data Source Management

### Connection Page Elements

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Add data source** | `button[data-testid='add-data-source']` | Button text: `"Add new data source"` | Creates new data source |
| **Data source search** | `input[data-testid='data-source-search']` | `input[placeholder*='search']` | Search data source types |
| **Data source card** | `div[data-testid='data-source-card']` | `a[href*='/connections/datasources/']` | Individual data source |

### Data Source Configuration

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Data source name** | `input[id='basic-settings-name']` | `input[data-testid='data-source-name']` | Name field |
| **Connection URL** | `input[id='connection-url']` | `input[data-testid='connection-url']` | URL field |
| **Save and test** | `button[data-testid='data-source-save-test']` | Button text: `"Save & test"` | Save/test button |
| **Test result** | `div[data-testid='data-source-test-result']` | `div[role='alert']` | Connection test result |

### Specific Data Source Types

#### Prometheus
```html
<!-- Prometheus data source selection -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/connections/datasources/prometheus']">
  Select Prometheus data source type
</li>

<!-- Prometheus-specific settings -->
<li class="interactive" data-targetaction="formfill" data-reftarget="input[data-testid='prometheus-config-url']" data-targetvalue="http://prometheus:9090">
  Set Prometheus server URL
</li>
```

#### Loki
```html
<!-- Loki data source selection -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/connections/datasources/loki']">
  Select Loki data source type
</li>

<!-- Loki-specific settings -->
<li class="interactive" data-targetaction="formfill" data-reftarget="input[data-testid='loki-config-url']" data-targetvalue="http://loki:3100">
  Set Loki server URL
</li>
```

## Alerting and Monitoring

### Alert Management

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **New alert rule** | `button[data-testid='new-alert-rule']` | Button text: `"New rule"` | Creates alert rule |
| **Alert rules list** | `div[data-testid='alert-rules-list']` | `table[data-testid='alert-rules-table']` | Lists existing rules |
| **Alert rule name** | `input[data-testid='alert-rule-name']` | `input[aria-label*='rule name']` | Rule name field |
| **Query condition** | `textarea[data-testid='alert-query-editor']` | `textarea[aria-label*='query']` | Alert query editor |

### Contact Points and Notifications

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **New contact point** | `button[data-testid='new-contact-point']` | Button text: `"Add contact point"` | Creates notification endpoint |
| **Contact point type** | `select[data-testid='contact-point-type']` | `select[aria-label*='type']` | Notification type dropdown |
| **Slack settings** | `input[data-testid='slack-webhook-url']` | `input[placeholder*='slack']` | Slack webhook URL |
| **Email settings** | `input[data-testid='email-addresses']` | `input[type='email']` | Email notification addresses |

## Plugin and App Management

### Plugin Interface

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Plugin search** | `input[data-testid='plugin-search']` | `input[placeholder*='Search']` | Plugin catalog search |
| **Install button** | `button[data-testid='plugin-install']` | Button text: `"Install"` | Install plugin |
| **Plugin config** | `button[data-testid='plugin-config']` | Button text: `"Configuration"` | Configure plugin |
| **Enable plugin** | `button[data-testid='plugin-enable']` | Button text: `"Enable"` | Enable installed plugin |

### App Plugin Navigation

#### Synthetic Monitoring
```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/a/grafana-synthetic-monitoring-app/">
  Open Synthetic Monitoring app
</li>
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='synthetic-monitoring-checks']">
  View monitoring checks
</li>
```

#### Incident Management
```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/a/grafana-incident-app/">
  Open Incident Management app
</li>
<li class="interactive" data-targetaction="button" data-reftarget="Create incident">
  Create new incident
</li>
```

## Form Elements and Inputs

### Input Field Patterns

| Field Type | Preferred Selector | Alternative | Notes |
|------------|-------------------|-------------|-------|
| **Text input by ID** | `input[id='field-name']` | `input[data-testid='field-name']` | Most reliable |
| **Text input by placeholder** | `input[placeholder='Enter value']` | `input[aria-label='Enter value']` | When ID unavailable |
| **Textarea** | `textarea[data-testid='text-area']` | `textarea[aria-label='description']` | Multi-line text |
| **Select dropdown** | `select[data-testid='dropdown']` | `select[aria-label='Choose option']` | Dropdown selection |
| **Checkbox** | `input[type='checkbox'][data-testid='option']` | `input[type='checkbox'][id='option']` | Boolean options |
| **Radio button** | `input[type='radio'][value='option']` | `input[type='radio'][id='option']` | Single choice |

### Advanced Input Types

#### ARIA Comboboxes (Autocomplete)
```html
<!-- Label filter in Explore -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="input[role='combobox'][aria-autocomplete='list']"
    data-targetvalue='job="prometheus"'
    data-requirements="exists-reftarget,on-page:/explore">
  Enter label filter
</li>

<!-- Data source selector -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="input[role='combobox'][aria-label*='data source']"
    data-targetvalue="prometheus"
    data-requirements="exists-reftarget">
  Select Prometheus data source
</li>
```

#### Monaco Code Editors
```html
<!-- PromQL query editor -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea.inputarea.monaco-mouse-cursor-text"
    data-targetvalue="rate(cpu_usage[5m])"
    data-requirements="exists-reftarget">
  Enter PromQL query
</li>

<!-- JSON configuration editor -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="textarea[data-testid='json-editor']"
    data-targetvalue='{"interval": "30s"}'
    data-requirements="exists-reftarget">
  Configure JSON settings
</li>
```

## Button Patterns and Text Matching

### Primary Action Buttons

| Action | Button Text Options | Context Requirements | Notes |
|--------|-------------------|---------------------|-------|
| **Save** | `"Save"`, `"Save dashboard"`, `"Save & test"` | Varies by page | Most common save action |
| **Create** | `"Create"`, `"New"`, `"Add new"` | Depends on context | Creation actions |
| **Delete** | `"Delete"`, `"Remove"`, `"Delete dashboard"` | Admin/edit permissions | Destructive actions |
| **Edit** | `"Edit"`, `"Edit panel"`, `"Configure"` | Edit permissions | Modification actions |
| **Test** | `"Test"`, `"Test connection"`, `"Save & test"` | Configuration context | Validation actions |

### Context-Specific Buttons

#### Dashboard Actions
```html
<li class="interactive" data-targetaction="button" data-reftarget="Add panel">Add new panel to dashboard</li>
<li class="interactive" data-targetaction="button" data-reftarget="Save dashboard">Save dashboard changes</li>
<li class="interactive" data-targetaction="button" data-reftarget="Share">Share dashboard with team</li>
<li class="interactive" data-targetaction="button" data-reftarget="Settings">Configure dashboard settings</li>
```

#### Panel Actions
```html
<li class="interactive" data-targetaction="button" data-reftarget="Apply">Apply panel changes</li>
<li class="interactive" data-targetaction="button" data-reftarget="Discard">Discard panel changes</li>
<li class="interactive" data-targetaction="button" data-reftarget="Duplicate">Duplicate this panel</li>
<li class="interactive" data-targetaction="button" data-reftarget="Remove">Remove panel from dashboard</li>
```

#### Data Source Actions
```html
<li class="interactive" data-targetaction="button" data-reftarget="Add new data source">Create new data source</li>
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">Save and test data source</li>
<li class="interactive" data-targetaction="button" data-reftarget="Delete">Delete data source</li>
<li class="interactive" data-targetaction="button" data-reftarget="Reset">Reset to defaults</li>
```

### Button Text Matching Strategies

#### Exact Matching (Preferred)
```html
<!-- Most reliable -->
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">Save data source</li>
<li class="interactive" data-targetaction="button" data-reftarget="Add visualization">Create new panel</li>
```

#### Partial Matching (Fallback)
```html
<!-- When exact text varies -->
<li class="interactive" data-targetaction="button" data-reftarget="Save">Save (matches "Save", "Save dashboard", etc.)</li>
<li class="interactive" data-targetaction="button" data-reftarget="Create">Create (matches various create buttons)</li>
```

#### Multi-Language Considerations
```html
<!-- English-specific -->
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">English interface</li>

<!-- Selector-based for internationalization -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button[data-testid='save-test-button']">
  Works across languages
</li>
```

## Specialized Components

### Explore Interface

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Data source picker** | `div[data-testid='data-source-picker']` | `button[aria-label*='data source']` | Explore data source |
| **Query editor** | `textarea[data-testid='explore-query-editor']` | `textarea.inputarea` | Explore query input |
| **Run query** | `button[data-testid='explore-run-query']` | Button text: `"Run query"` | Execute exploration query |
| **Query history** | `button[data-testid='query-history']` | `button[aria-label*='history']` | Previous queries |
| **Query inspector** | `button[data-testid='query-inspector']` | `button[aria-label*='inspector']` | Query details |

### Time and Refresh Controls

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Time range picker** | `button[data-testid='time-range-picker']` | `button[aria-label*='time range']` | Set time range |
| **Refresh button** | `button[data-testid='refresh-button']` | Button text: `"Refresh"` | Manual refresh |
| **Auto-refresh** | `button[data-testid='auto-refresh']` | `button[aria-label*='auto refresh']` | Auto-refresh settings |
| **Zoom out** | `button[data-testid='zoom-out']` | `button[aria-label*='zoom out']` | Expand time range |

### Panel Visualization Elements

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Panel container** | `div[data-testid='panel-container']` | `div[data-panel-id]` | Individual panel |
| **Panel header** | `div[data-testid='panel-header']` | `div[data-testid*='panel-title']` | Panel title area |
| **Panel menu** | `button[data-testid='panel-menu']` | `button[aria-label*='panel menu']` | Panel options |
| **Legend** | `div[data-testid='legend']` | `div[aria-label*='legend']` | Chart legend |
| **Tooltip** | `div[data-testid='tooltip']` | `div[role='tooltip']` | Data point tooltip |

## Admin and Configuration Elements

### User Management

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Add user** | `button[data-testid='add-user']` | Button text: `"Add user"` | Create new user |
| **User list** | `table[data-testid='users-table']` | `div[data-testid='users-list']` | Users listing |
| **User role** | `select[data-testid='user-role']` | `select[aria-label*='role']` | Role assignment |
| **Delete user** | `button[data-testid='delete-user']` | Button text: `"Delete"` | Remove user |

### Plugin Management

| Component | Preferred Selector | Alternative | Notes |
|-----------|-------------------|-------------|-------|
| **Plugin catalog** | `div[data-testid='plugin-catalog']` | `div[data-testid='plugins-list']` | Available plugins |
| **Installed plugins** | `div[data-testid='installed-plugins']` | `div[data-testid='plugins-installed']` | Installed plugins |
| **Plugin search** | `input[data-testid='plugin-search']` | `input[placeholder*='Search plugins']` | Plugin search |
| **Plugin install** | `button[data-testid='plugin-install']` | Button text: `"Install"` | Install plugin |
| **Plugin config** | `button[data-testid='plugin-config']` | Button text: `"Configuration"` | Configure plugin |

## Advanced Selector Patterns

### Pseudo-Selectors for Precision

#### First/Last Element Selection
```html
<!-- First panel on dashboard -->
<li class="interactive" data-targetaction="highlight" data-reftarget="div[data-testid='panel-container']:first-of-type">
  Examine the first panel
</li>

<!-- Last item in list -->
<li class="interactive" data-targetaction="highlight" data-reftarget="li[data-testid='nav-item']:last-child">
  Look at the last navigation item
</li>

<!-- Specific position -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button[data-testid='action-button']:nth-of-type(2)">
  Click the second action button
</li>
```

#### Attribute-Based Selection
```html
<!-- By ARIA attributes -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button[aria-expanded='false']">
  Find collapsed menu button
</li>

<!-- By data attributes -->
<li class="interactive" data-targetaction="highlight" data-reftarget="div[data-panel-id]">
  Select any dashboard panel
</li>

<!-- By role attributes -->
<li class="interactive" data-targetaction="formfill" data-reftarget="input[role='combobox']" data-targetvalue="filter">
  Enter value in autocomplete field
</li>
```

#### Content-Based Selection
```html
<!-- By text content -->
<li class="interactive" data-targetaction="highlight" data-reftarget="span:contains('Prometheus')">
  Find Prometheus-related text
</li>

<!-- By title attribute -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button[title*='refresh']">
  Find refresh-related button
</li>
```

### Complex Selector Combinations

#### Multiple Attribute Matching
```html
<!-- Combine multiple stable attributes -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="a[data-testid='nav-item'][href='/dashboard'][aria-current='page']">
  Highlight current dashboard nav item
</li>

<!-- Type and state combination -->
<li class="interactive"
    data-targetaction="formfill"
    data-reftarget="input[type='text'][data-testid='search'][aria-label*='Search']"
    data-targetvalue="prometheus">
  Search for Prometheus
</li>
```

#### Hierarchical Selection
```html
<!-- Within specific containers -->
<li class="interactive"
    data-targetaction="highlight"
    data-reftarget="nav[data-testid='navigation'] a[href='/connections']">
  Find Connections link within navigation
</li>

<!-- Scoped to specific areas -->
<li class="interactive"
    data-targetaction="button"
    data-reftarget="div[data-testid='panel-editor'] button[aria-label*='save']">
  Save button within panel editor
</li>
```

## Testing and Validation

### Selector Reliability Testing

#### Cross-Version Testing
```javascript
// Test selectors across Grafana versions
const testSelectors = [
  "a[data-testid='data-testid Nav menu item'][href='/dashboards']",
  "button[data-testid='add-panel']",
  "input[id='basic-settings-name']"
];

testSelectors.forEach(selector => {
  const element = document.querySelector(selector);
  console.log(`${selector}: ${element ? 'Found' : 'Not found'}`);
});
```

#### Theme Compatibility
- Test selectors in light and dark themes
- Verify `data-testid` attributes persist across themes
- Check that ARIA attributes remain stable
- Validate button text doesn't change with themes

#### Browser Compatibility
- Test in Chrome, Firefox, Safari, Edge
- Verify pseudo-selectors work consistently
- Check that complex selectors perform adequately
- Ensure mobile browsers handle selectors correctly

### Maintenance Strategies

#### Selector Monitoring
- **Regular Audits**: Periodically verify selectors still work
- **Version Testing**: Test with new Grafana releases
- **Fallback Planning**: Maintain alternative selectors for critical elements
- **Documentation Updates**: Keep selector guides current

#### Deprecation Handling
- **Graceful Degradation**: Provide fallback selectors for deprecated elements
- **Migration Paths**: Document how to update tutorials when selectors change
- **Backward Compatibility**: Support old selectors during transition periods
- **Communication**: Notify tutorial authors of selector changes

## Performance Optimization

### Efficient Selector Design

#### Fast Selectors
```html
<!-- ID-based (fastest) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="#unique-element-id">

<!-- data-testid (fast and stable) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button[data-testid='save-button']">

<!-- Single attribute (fast) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/dashboard/new']">
```

#### Slow Selectors (Avoid)
```html
<!-- Complex nesting (slow) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="div.container > div.row > div.col > button">

<!-- Multiple classes (slow) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="button.btn.btn-primary.btn-large">

<!-- Universal selectors (very slow) -->
<li class="interactive" data-targetaction="highlight" data-reftarget="* > button">
```

### Selector Caching
- **Query Results**: DOM query results are cached when possible
- **Validation Cache**: Element existence checks are cached briefly
- **Invalidation**: Cache cleared when DOM changes significantly
- **Performance Monitoring**: Slow selectors are logged for optimization

## Best Practices Summary

### Selector Design Principles
- **Stability First**: Choose selectors that won't break with minor UI updates
- **Specificity Balance**: Specific enough to target correctly, general enough to be stable
- **Performance Awareness**: Avoid selectors that require complex DOM traversal
- **Accessibility Integration**: Leverage ARIA attributes for semantic selection

### Documentation Standards
- **Provide Alternatives**: Always include fallback selectors
- **Context Information**: Document when and where selectors work
- **Update Frequency**: Keep selector lists current with Grafana releases
- **Usage Examples**: Show selectors in context with complete interactive elements

### Quality Assurance
- **Regular Testing**: Verify selectors work across different environments
- **Performance Monitoring**: Track selector query performance
- **User Feedback**: Monitor for selector-related tutorial failures
- **Continuous Improvement**: Update documentation based on real-world usage

