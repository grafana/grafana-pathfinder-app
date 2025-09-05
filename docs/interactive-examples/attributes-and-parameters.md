# Interactive Elements: Attributes and Parameters

This comprehensive guide documents all data-\* attributes used to define interactive actions, their behaviors, and how to combine them effectively.

## Core Interactive Attributes

### Action Definition
- **data-targetaction**: The action type to execute (REQUIRED)
  - Supported: `highlight`, `button`, `formfill`, `navigate`, `sequence`, `multistep`
  - Each type has specific behavior patterns for Show/Do modes
  - See [Interactive Types Guide](interactive-types.md) for detailed behavior

- **data-reftarget**: The target reference (REQUIRED)
  - Meaning depends on `data-targetaction`:
    - `highlight`, `formfill`: CSS selector (prefer `data-testid` attributes)
    - `button`: Visible button text (exact or partial match)
    - `navigate`: Internal Grafana path (e.g., `/dashboard/new`) or absolute URL
    - `sequence`: Container selector (usually the section `<span>` with an `id`)
    - `multistep`: Not used (actions defined in child spans)

- **data-targetvalue**: Value for form filling actions (OPTIONAL)
  - Used only with `formfill` actions
  - Supports text, numbers, boolean values for checkboxes
  - For ARIA comboboxes: automatically tokenizes complex queries

### Control Attributes
- **data-doit**: Controls button behavior (OPTIONAL, defaults to `true`)
  - `true` (default): Shows both "Show me" and "Do it" buttons
  - `false`: Show-only mode - only "Show me" button, completes after showing
  - Useful for educational highlighting without state changes

- **data-skippable**: Allows skipping if requirements fail (OPTIONAL, defaults to `false`)
  - `true`: Shows "Skip" button when requirements aren't met
  - `false`: Step must meet requirements or be manually fixed
  - Only applies to individual steps, not sections

### Requirements and Objectives
- **data-requirements**: Comma-separated preconditions (OPTIONAL)
  - Must ALL pass for the element to be enabled
  - See [Requirements Reference](requirements-reference.md) for complete list
  - Examples: `navmenu-open`, `has-datasource:prometheus`, `is-admin`

- **data-objectives**: Auto-completion conditions (OPTIONAL)
  - When met, step/section is marked complete without execution
  - Uses same syntax as requirements
  - Always takes priority over requirements ("objectives win")
  - For sections: marks ALL child steps as complete

- **data-verify**: Post-action verification (OPTIONAL)
  - Conditions to check AFTER action execution
  - Uses same syntax as requirements
  - If verification fails, action is considered unsuccessful

### User Experience Attributes
- **data-hint**: Tooltip or hint text for UI elements (OPTIONAL)
  - Appears in button tooltips and requirement explanations
  - Provides context about what the action will do
  - Supports plain text only (no HTML)

- **data-targetcomment**: Rich HTML comment for highlighting (OPTIONAL)
  - Used with `<span class="interactive-comment">` for better UX
  - Prefer the span approach over this attribute

## Special Content Elements

### Interactive Comments
- **`<span class="interactive-comment">`**: Rich HTML content for contextual explanations
  - Appears as floating comment box during element highlighting
  - Supports HTML formatting: `<strong>`, `<code>`, `<em>`
  - Hidden in normal display via CSS (`display: none`)
  - Positioned automatically near highlighted elements
  - Includes Grafana logo and themed styling
  - Maximum recommended length: 250 characters for good UX

### Section Containers
- **Interactive Sections**: Use `<span>` with unique `id` for grouping steps
  - `data-targetaction="sequence"` for section-level "Do Section" button
  - Child elements are individual steps within the section
  - Supports section-level requirements and objectives
  - Manages sequential step execution and state persistence

### Multi-step Actions
- **Multi-step Container**: `<li data-targetaction="multistep">`
  - Contains multiple `<span class="interactive">` child actions
  - Child spans define internal actions (not rendered visually)
  - Executes all child actions in sequence with single "Do it" button
  - No "Show me" button (shows each action during execution)
  - Stops immediately on any failure

## Requirements Reference (Common Checks)

The system supports extensive requirement checking. See [Requirements Reference](requirements-reference.md) for complete documentation.

### DOM and Navigation
- `exists-reftarget` — Referenced element exists in DOM
- `navmenu-open` — Navigation menu is open/visible (auto-fixable)

### User and Permissions  
- `is-admin` — User has Grafana admin privileges
- `has-role:<role>` — User role check (`admin`, `editor`, `viewer`, `grafana-admin`)
- `has-permission:<permission>` — Specific Grafana permission

### Data Sources and Content
- `has-datasources` — At least one data source exists
- `has-datasource:<identifier>` — Specific data source by name/UID/type
- `has-plugin:<pluginId>` — Plugin installed and enabled
- `has-dashboard-named:<title>` — Dashboard with exact title exists

### System and Environment
- `on-page:<path>` — Current URL path matches
- `has-feature:<toggle>` — Feature toggle enabled
- `in-environment:<env>` — Environment matches
- `min-version:<x.y.z>` — Minimum Grafana version

### Tutorial Flow
- `section-completed:<sectionId>` — Previous section completed

### Combining Requirements
- Use commas to combine: `navmenu-open,has-datasource:prometheus,is-admin`
- ALL requirements must pass (AND logic)
- Failed requirements show helpful error messages with "Fix this" buttons where possible

## Comprehensive Examples

### Basic Actions

#### Highlight with Requirements
```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
  data-requirements="navmenu-open"
  data-hint="Opens the connections page where you manage data sources"
>
  Click Connections in the left-side menu.
</li>
```

#### Button by Text (Recommended)
```html
<li 
  class="interactive" 
  data-targetaction="button" 
  data-reftarget="Save & test"
  data-requirements="exists-reftarget"
  data-verify="has-datasource:prometheus"
>
  Save the data source and verify connection
</li>
```

#### Form Filling with Verification
```html
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[role='combobox'][aria-autocomplete='list']"
  data-targetvalue="container = 'alloy'"
  data-requirements="exists-reftarget"
  data-hint="This will filter logs by container name"
>
  Enter container label filter
</li>
```

#### Navigation with Objectives
```html
<li 
  class="interactive" 
  data-targetaction="navigate" 
  data-reftarget="/dashboard/new"
  data-objectives="on-page:/dashboard/new"
  data-requirements="has-datasources"
>
  Navigate to create a new dashboard
</li>
```

### Advanced Patterns

#### Interactive Section with Dependencies
```html
<span
  id="create-dashboard"
  class="interactive"
  data-targetaction="sequence"
  data-reftarget="span#create-dashboard"
  data-requirements="has-datasource:prometheus"
  data-objectives="has-dashboard-named:My Dashboard"
  data-hint="This section will create a complete dashboard with panels"
>
  <ul>
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="New"
        data-requirements="navmenu-open">
      Click New button
    </li>
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="a[href='/dashboard/new']"
        data-requirements="exists-reftarget">
      Select New dashboard option
    </li>
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[data-testid='dashboard-title-input']"
        data-targetvalue="My Dashboard"
        data-verify="has-dashboard-named:My Dashboard">
      Set dashboard title
    </li>
  </ul>
</span>
```

#### Multi-step Action with Error Handling
```html
<li class="interactive" 
    data-targetaction="multistep" 
    data-requirements="on-page:/dashboard/new"
    data-hint="Creates visualization panel in 3 steps">
  <span class="interactive" 
        data-targetaction="button" 
        data-reftarget="Add visualization"
        data-requirements="exists-reftarget"></span>
  <span class="interactive" 
        data-targetaction="button" 
        data-reftarget="prometheus-datasource"
        data-requirements="has-datasource:prometheus"></span>
  <span class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="textarea[data-testid='query-editor']"
        data-targetvalue="up"
        data-requirements="exists-reftarget"></span>
  Click Add visualization, select data source, then enter query.
</li>
```

#### Show-only Mode with Rich Comments
```html
<li
  class="interactive"
  data-reftarget='div[data-testid="uplot-main-div"]:first-of-type'
  data-targetaction="highlight"
  data-doit="false"
  data-requirements="exists-reftarget"
>
  <span class="interactive-comment">
    This <strong>metrics panel</strong> shows log volume over time with different log levels 
    (<code>debug</code>, <code>info</code>, <code>warn</code>, <code>error</code>). 
    The legend displays total counts for each level, helping you understand 
    your application's <em>logging patterns</em>.
  </span>
  Examine the metrics visualization panel above the logs.
</li>
```

#### Skippable Step with Admin Requirements
```html
<li
  class="interactive"
  data-targetaction="navigate"
  data-reftarget="/admin/plugins"
  data-requirements="is-admin"
  data-skippable="true"
  data-hint="Requires admin permissions - can be skipped if you don't have access"
>
  Navigate to plugin management (admin only)
</li>
```

#### Complex Requirements with Fix Options
```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="button[data-testid='panel-edit-button']"
  data-requirements="navmenu-open,on-page:/dashboard,has-role:editor"
  data-objectives="on-page:/dashboard/edit"
  data-hint="Opens panel editor - navigation menu will be opened automatically if needed"
>
  <span class="interactive-comment">
    The <strong>Edit</strong> button allows you to modify panel queries, 
    visualization settings, and display options. This requires <code>Editor</code> 
    permissions or higher.
  </span>
  Click the Edit button to modify the panel
</li>
```

## Best Practices and Authoring Guidelines

### Selector Best Practices
- **Prefer stable attributes**: Use `data-testid`, `href`, `id`, and ARIA attributes over CSS classes
- **Button text over selectors**: Use `button` action with visible text instead of CSS selectors when possible
- **Specific pseudo-selectors**: Use `:first-of-type`, `:last-child` for precise targeting
- **ARIA attributes**: Leverage `role`, `aria-label`, `aria-describedby` for accessibility-based selection

### Requirements and Objectives
- **Minimal requirements**: Keep `data-requirements` focused and specific
- **Logical grouping**: Combine related requirements with commas (AND logic)
- **Use objectives wisely**: Apply `data-objectives` for outcome-based auto-completion
- **Verification patterns**: Use `data-verify` for post-action state validation
- **Skippable considerations**: Only make steps skippable when requirements might legitimately fail

### Content Organization
- **Unique section IDs**: Ensure container `id` attributes are unique and referenced correctly in `data-reftarget`
- **Comment placement**: Place `<span class="interactive-comment">` at the start of elements
- **Show-only usage**: Use `data-doit='false'` for educational highlighting without state changes
- **Progressive disclosure**: Start with simple actions, build complexity gradually

### Interactive Comments Formatting
- **UI elements**: Use `<strong>` for UI element names (buttons, menus, panels)
- **Technical terms**: Use `<code>` for technical terms, commands, and code snippets  
- **Emphasis**: Use `<em>` for conceptual emphasis and important points
- **Length limits**: Keep comments under 250 characters for optimal UX
- **Rich context**: Explain WHY something is important, not just WHAT it is

### Error Handling and User Experience
- **Helpful error messages**: Provide clear explanations when requirements fail
- **Fix buttons**: Leverage auto-fix capabilities for common issues (navigation, permissions)
- **Graceful degradation**: Handle missing elements and API failures gracefully
- **Progress indicators**: Use sections to show tutorial progress and allow resumption
- **State persistence**: Section completion is automatically saved across browser sessions

### Performance Considerations
- **Efficient selectors**: Avoid complex nested selectors that are slow to evaluate
- **Requirement checking**: Combine related checks to minimize API calls
- **Debounced updates**: System automatically debounces rapid requirement changes
- **Lazy loading**: Requirements are checked only when steps become eligible

### Testing and Validation
- **Selector testing**: Verify selectors work across different Grafana themes and versions
- **Requirement validation**: Test requirement combinations under different user roles
- **Cross-browser testing**: Ensure interactive elements work in supported browsers
- **Mobile considerations**: Test on tablet devices where interactive tutorials might be used

### Common Pitfalls to Avoid
- **Brittle selectors**: Avoid selecting by auto-generated CSS classes or deep nesting
- **Missing requirements**: Always include `exists-reftarget` for DOM-dependent actions
- **Overly complex multisteps**: Break down complex workflows into separate sections
- **Unclear objectives**: Ensure objectives clearly represent the desired end state
- **Missing verification**: Add `data-verify` for actions that should change system state
- **Inconsistent formatting**: Follow HTML formatting standards for maintainability

## Advanced Usage Patterns

### Conditional Logic with Requirements
```html
<!-- Different paths based on user permissions -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/admin/plugins" 
    data-requirements="is-admin"
    data-hint="Admin path for plugin management">
  Go to Admin → Plugins (admin users)
</li>

<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/plugins" 
    data-requirements="has-role:viewer" 
    data-skippable="true"
    data-hint="Viewer path - limited plugin access">
  Go to Plugin catalog (non-admin users can skip if no access)
</li>
```

### Dynamic Content with Objectives
```html
<!-- Auto-complete if user already has the desired state -->
<span id="setup-prometheus" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#setup-prometheus"
      data-objectives="has-datasource:type:prometheus"
      data-hint="Skip entire section if Prometheus already configured">
  <h3>Set up Prometheus Data Source</h3>
  <!-- Steps only run if Prometheus not already configured -->
</span>
```

### Error Recovery Patterns
```html
<!-- Step with multiple fallback options -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Create dashboard" 
    data-requirements="has-datasources,has-permission:dashboards:write"
    data-skippable="true"
    data-hint="Requires data sources and dashboard write permissions">
  Create new dashboard (skippable if no permissions)
</li>
```

### Progressive Enhancement
```html
<!-- Start with basic functionality -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='query-input']" 
    data-targetvalue="up"
    data-requirements="exists-reftarget">
  Enter basic query
</li>

<!-- Add advanced features for capable users -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='query-input']" 
    data-targetvalue="rate(http_requests_total[5m])"
    data-requirements="has-feature:expressions,min-version:9.0.0"
    data-skippable="true">
  Use advanced rate function (skip if not available)
</li>
```

## Troubleshooting Common Issues

### Element Not Found
```html
<!-- Always include exists-reftarget for DOM-dependent actions -->
<li class="interactive" 
    data-targetaction="highlight" 
    data-reftarget="button[data-testid='save-button']" 
    data-requirements="exists-reftarget,on-page:/dashboard/edit">
  Click Save button
</li>
```

### Requirements Never Pass
- Check browser console for detailed error messages
- Verify requirement syntax matches examples exactly  
- Ensure required elements/data actually exist
- Test requirements in isolation

### Performance Issues
- Use specific selectors instead of broad searches
- Combine related requirements to reduce API calls
- Avoid deeply nested CSS selectors
- Consider using `data-objectives` for expensive state checks

### Accessibility Concerns
- Include `data-hint` for screen reader users
- Use semantic HTML structure
- Test with keyboard navigation
- Ensure interactive elements have proper ARIA labels