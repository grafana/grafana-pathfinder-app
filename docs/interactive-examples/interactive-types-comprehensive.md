# Interactive Action Types - Comprehensive Guide

This comprehensive guide explains all supported interactive action types, their specific behaviors, implementation details, and when to use each type.

## Core Concepts

### Show vs Do Mode
Every interactive action supports two execution modes:
- **Show Mode**: Highlights/demonstrates the target without changing application state
- **Do Mode**: Actually performs the action (click, fill, navigate) and marks the step completed
- **Show-Only Mode**: When `data-doit="false"`, only Show mode is available and step completes after showing

### Target References
The `data-reftarget` attribute meaning varies by action type:
- **CSS Selectors**: For `highlight` and `formfill` actions
- **Button Text**: For `button` actions (exact or partial matching)
- **URLs/Paths**: For `navigate` actions (internal Grafana routes or external URLs)
- **Container Selectors**: For `sequence` actions (section containers with unique IDs)
- **Not Used**: For `multistep` actions (child spans define targets)

### Error Handling
All action types include:
- Automatic retry logic with configurable delays
- Graceful failure handling with user-friendly error messages
- Requirements checking before execution
- Post-action verification when specified

## Action Types

### highlight

**Purpose**: Focus on and optionally click specific DOM elements using CSS selectors.

**Target Reference**: CSS selector (prefer `data-testid`, `id`, `href`, or ARIA attributes)

**Behavior**:
- **Show Mode**: Ensures element visibility, scrolls into view, and highlights with visual feedback
- **Do Mode**: Ensures visibility, scrolls into view, then clicks the element
- **Navigation Handling**: Automatically opens navigation menu if target is within nav area
- **Multi-element Support**: Can target multiple elements with same selector

**Best Practices**:
- Use stable selectors that won't break with UI changes
- Include `exists-reftarget` requirement for DOM-dependent actions
- Prefer `data-testid` attributes over CSS classes
- Use pseudo-selectors (`:first-of-type`, `:last-child`) for precision

**Advanced Features**:
- Supports interactive comments for rich contextual explanations
- Handles single-element pseudo-selectors intelligently
- Automatic element visibility and scroll management
- Navigation menu auto-opening for nav elements

```html
<!-- Basic highlight action -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
  data-requirements="navmenu-open,exists-reftarget"
  data-hint="Opens the dashboards management page"
>
  Open Dashboards from the navigation menu
</li>

<!-- Highlight with rich comment -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="div[data-testid='panel-container']:first-of-type"
  data-requirements="on-page:/dashboard,exists-reftarget"
  data-doit="false"
>
  <span class="interactive-comment">
    This <strong>panel container</strong> holds your visualization. 
    It includes the <code>query editor</code>, <code>visualization picker</code>, 
    and <code>panel options</code> for complete customization.
  </span>
  Examine the first panel on this dashboard
</li>
```

### button

**Purpose**: Interact with buttons using their visible text content (recommended for stability).

**Target Reference**: Button text (supports exact and partial matching)

**Behavior**:
- **Show Mode**: Locates buttons by text, ensures visibility, and highlights
- **Do Mode**: Locates buttons by text, ensures visibility, then clicks
- **Text Matching**: Uses intelligent text matching (exact preferred, partial supported)
- **Multiple Buttons**: Handles multiple buttons with same text (clicks all)

**Advantages**:
- More stable than CSS selectors (text changes less frequently than DOM structure)
- Language-independent (works across different Grafana localizations)
- User-friendly (matches what users actually see)
- Automatic navigation handling for nav-area buttons

**Text Matching Logic**:
1. **Exact Match**: Preferred method, matches button text exactly
2. **Partial Match**: Fallback method, matches if button contains the text
3. **Whitespace Handling**: Normalizes whitespace and trims text
4. **Case Sensitivity**: Case-sensitive matching for precision

**Button Discovery**:
- Searches `<button>` elements and `[role="button"]`
- Includes `<input type="button">` and `<input type="submit">`
- Searches within button text content and `aria-label`
- Handles nested elements (icons, spans) within buttons

```html
<!-- Simple button action -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Save & test"
    data-requirements="exists-reftarget"
    data-verify="has-datasource:prometheus">
  Save the data source and test connection
</li>

<!-- Button with complex text -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Add new data source"
    data-requirements="on-page:/connections,is-admin"
    data-hint="Creates a new data source configuration">
  Click the Add New Data Source button
</li>

<!-- Partial text matching -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Create"
    data-requirements="exists-reftarget"
    data-hint="Matches any button containing 'Create' in the text">
  Click any Create button
</li>
```

### formfill

**Purpose**: Fill form inputs, textareas, selects, and specialized editors with values.

**Target Reference**: CSS selector for the form element

**Target Value**: String value to set (required for this action type)

**Supported Elements**:
- **Text Inputs**: `<input type="text">`, `<input type="email">`, etc.
- **Textareas**: Regular `<textarea>` and Monaco code editors
- **Select Elements**: `<select>` dropdowns with option values
- **Checkboxes/Radio**: `<input type="checkbox">`, `<input type="radio">`
- **ARIA Comboboxes**: Advanced autocomplete inputs with `role="combobox"`

**Behavior**:
- **Show Mode**: Locates field, ensures visibility, and highlights
- **Do Mode**: Locates field, sets value, fires appropriate events, then marks complete
- **Event Handling**: Fires proper DOM events (`input`, `change`, `blur`, `focus`)
- **React Integration**: Uses native value setters to bypass React's controlled inputs

**Advanced Features**:

#### ARIA Combobox Support
- **Tokenization**: Automatically splits complex queries into tokens
- **Staged Entry**: Enters each token separately with Enter key presses
- **Operator Handling**: Recognizes operators (`=`, `!=`, `=~`, `!~`) and types them as keystrokes
- **Quote Handling**: Preserves or strips quotes as needed for UI parsing
- **Menu Interaction**: Handles dropdown menus and autocomplete suggestions

#### Monaco Editor Support
- **Content Clearing**: Uses Ctrl+A + Delete to clear existing content
- **Enhanced Events**: Fires Monaco-specific events for proper integration
- **Syntax Highlighting**: Preserves syntax highlighting after value insertion
- **Undo Integration**: Works with Monaco's undo/redo system

#### Value Processing
- **Boolean Values**: For checkboxes, `"true"/"false"` or `"1"/"0"`
- **Select Options**: Matches option values or visible text
- **Whitespace**: Preserves significant whitespace in values
- **Special Characters**: Handles special characters and encoding properly

```html
<!-- Basic input field -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[id='connection-url']"
  data-targetvalue="http://prometheus:9090"
  data-requirements="exists-reftarget"
  data-verify="has-datasource:prometheus"
  data-hint="Sets the Prometheus server URL"
>
  Enter the Prometheus server URL
</li>

<!-- ARIA combobox with complex query -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[role='combobox'][aria-autocomplete='list']"
  data-targetvalue='container="alloy" level="error"'
  data-requirements="exists-reftarget,on-page:/explore"
  data-hint="Filters logs by container and log level"
>
  Enter log filter query
</li>

<!-- Monaco code editor -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="textarea.inputarea.monaco-mouse-cursor-text"
  data-targetvalue="rate(http_requests_total[5m])"
  data-requirements="exists-reftarget,has-datasource:prometheus"
  data-hint="Enters a PromQL query for request rate"
>
  Enter Prometheus query in the code editor
</li>

<!-- Checkbox selection -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[type='checkbox'][data-testid='enable-alerting']"
  data-targetvalue="true"
  data-requirements="exists-reftarget,has-permission:alerting:write"
>
  Enable alerting for this dashboard
</li>

<!-- Select dropdown -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="select[data-testid='visualization-type']"
  data-targetvalue="stat"
  data-requirements="exists-reftarget,on-page:/dashboard/edit"
>
  Select Stat visualization type
</li>
```

### navigate

**Purpose**: Navigate to internal Grafana routes or external URLs.

**Target Reference**: URL path (internal Grafana route or external URL)

**Behavior**:
- **Show Mode**: Provides visual indication of navigation intent (no actual navigation)
- **Do Mode**: Performs actual navigation using appropriate method
- **Internal Routes**: Uses Grafana's `locationService.push()` for proper SPA navigation
- **External URLs**: Opens in new tab/window with security attributes (`noopener`, `noreferrer`)

**Route Types**:

#### Internal Grafana Routes
- **Dashboard Routes**: `/dashboard/new`, `/d/dashboard-uid`
- **Admin Routes**: `/admin/plugins`, `/admin/users`
- **App Routes**: `/a/app-plugin-id/path`
- **Core Routes**: `/explore`, `/alerting`, `/connections`

#### External URLs
- **Documentation**: `https://grafana.com/docs/`
- **API Endpoints**: `https://api.example.com/`
- **External Tools**: `https://prometheus.io/`

**Navigation Handling**:
- **State Preservation**: Maintains Grafana application state during internal navigation
- **Security**: External URLs include security attributes to prevent window.opener attacks
- **Error Handling**: Graceful failure if navigation is blocked or fails
- **Verification**: Can use `data-verify="on-page:/target/path"` to confirm navigation success

**Use Cases**:
- Moving between Grafana sections
- Opening configuration pages
- Linking to external documentation
- Deep-linking to specific dashboards or panels

```html
<!-- Internal Grafana navigation -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/dashboard/new"
    data-requirements="has-datasources"
    data-verify="on-page:/dashboard/new"
    data-hint="Creates a new dashboard">
  Navigate to create a new dashboard
</li>

<!-- Navigation with objectives -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/connections/datasources"
    data-objectives="on-page:/connections"
    data-requirements="is-admin"
    data-hint="Opens data source management page">
  Go to data source configuration
</li>

<!-- External URL navigation -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="https://grafana.com/docs/grafana/latest/panels/visualizations/"
    data-hint="Opens Grafana documentation in new tab">
  View visualization documentation
</li>

<!-- App plugin navigation -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/a/grafana-synthetic-monitoring-app/"
    data-requirements="has-plugin:grafana-synthetic-monitoring-app"
    data-verify="on-page:/a/grafana-synthetic-monitoring-app/">
  Open Synthetic Monitoring app
</li>
```

### sequence

**Purpose**: Group multiple related steps into a cohesive section with coordinated execution.

**Target Reference**: Container selector (must reference the section's own container)

**Structure**: Must be applied to a container element (typically `<span>`) with child interactive elements

**Behavior**:
- **Show Mode**: Highlights each child step in sequence without executing
- **Do Mode**: Executes all child steps in order with "show then do" pattern
- **State Management**: Tracks completion of individual steps and overall section
- **Persistence**: Section completion state persists across browser sessions
- **Sequential Execution**: Steps execute with proper timing delays and visual feedback

**Section Features**:

#### State Management
- **Individual Step Tracking**: Each step can be completed independently
- **Section Completion**: Section is complete when all steps are done
- **Progress Persistence**: Uses localStorage to remember completion across sessions
- **Resume Capability**: Can resume from last uncompleted step
- **Reset Functionality**: "Reset Section" button to clear all progress

#### Execution Flow
- **Requirements Check**: Validates section-level requirements before starting
- **Step-by-Step**: Each step shows (highlights) then executes (does)
- **Error Handling**: Stops execution on first failure, shows helpful error messages
- **Timing Control**: Configurable delays between show/do phases and between steps
- **Cancellation**: Users can cancel section execution mid-flow

#### Visual Feedback
- **Progress Indicators**: Shows current step and overall progress
- **Completion States**: Visual indicators for completed, current, and pending steps
- **Section Status**: Section header shows completion checkmark or spinner
- **Button States**: "Do Section" vs "Resume" vs "Reset Section" based on progress

**Requirements and Objectives**:
- **Section-level**: Applied to entire section, checked before execution starts
- **Step-level**: Individual steps can have their own requirements
- **Objectives**: When section objectives are met, ALL child steps are marked complete
- **Dependencies**: Can depend on other sections using `section-completed:section-id`

```html
<!-- Complete section example -->
<span id="setup-datasource" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#setup-datasource"
      data-requirements="is-admin"
      data-objectives="has-datasource:prometheus"
      data-hint="Creates and configures a Prometheus data source">
  
  <h3>Set up Prometheus Data Source</h3>
  <p>This section will guide you through creating a new Prometheus data source.</p>
  
  <ul>
    <li class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/connections/datasources"
        data-requirements="navmenu-open"
        data-verify="on-page:/connections">
      Navigate to data source management
    </li>
    
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Add new data source"
        data-requirements="exists-reftarget">
      Click Add New Data Source
    </li>
    
    <li class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="a[href='/connections/datasources/prometheus']"
        data-requirements="exists-reftarget">
      Select Prometheus from the list
    </li>
    
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[id='basic-settings-name']"
        data-targetvalue="prometheus-datasource"
        data-requirements="exists-reftarget"
        data-hint="Sets a descriptive name for the data source">
      Enter data source name
    </li>
    
    <li class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[id='connection-url']"
        data-targetvalue="http://prometheus:9090"
        data-requirements="exists-reftarget">
      Set the Prometheus server URL
    </li>
    
    <li class="interactive" 
        data-targetaction="button" 
        data-reftarget="Save & test"
        data-requirements="exists-reftarget"
        data-verify="has-datasource:prometheus-datasource">
      Save and test the connection
    </li>
  </ul>
</span>

<!-- Section with dependencies -->
<span id="create-dashboard" 
      class="interactive" 
      data-targetaction="sequence" 
      data-reftarget="span#create-dashboard"
      data-requirements="section-completed:setup-datasource"
      data-objectives="has-dashboard-named:Monitoring Dashboard"
      data-hint="Creates a dashboard using the configured data source">
  
  <h3>Create Monitoring Dashboard</h3>
  <p>Now let's create a dashboard to visualize our Prometheus metrics.</p>
  
  <!-- Child steps here -->
</span>
```

### multistep

**Purpose**: Execute multiple related actions as a single cohesive step with one "Do it" button.

**Target Reference**: Not used (actions defined by child `<span>` elements)

**Structure**: Container element with multiple `<span class="interactive">` child actions

**Behavior**:
- **No Show Mode**: Multi-steps don't have a "Show me" button (would be confusing for multiple actions)
- **Single Do Button**: One "Do it" button executes all internal actions in sequence
- **Show-then-Do Pattern**: Each internal action is shown (highlighted) then executed
- **Sequential Execution**: Actions execute in DOM order with configurable delays
- **Immediate Failure**: Stops execution on first failed action

**Internal Action Definition**:
- **Child Spans**: Each `<span class="interactive">` defines one internal action
- **Full Action Support**: Supports all action types (`button`, `highlight`, `formfill`, `navigate`)
- **Individual Requirements**: Each internal action can have its own requirements
- **Just-in-Time Checking**: Requirements checked immediately before each action
- **No Visual Rendering**: Child spans are metadata only (not visually rendered)

**Execution Flow**:
1. **Overall Requirements**: Check multi-step level requirements first
2. **Action Loop**: For each internal action:
   - Check action-specific requirements just-in-time
   - Show the action (highlight target)
   - Wait for show delay
   - Execute the action (click, fill, etc.)
   - Wait for step delay
3. **Completion**: Mark entire multi-step as complete when all actions succeed
4. **Error Handling**: Stop and show error message on any failure

**Timing Configuration**:
- **Show-to-Do Delay**: Time between highlighting and executing each action
- **Step Delay**: Time between completing one action and starting the next
- **Cancellation**: Users can cancel execution mid-sequence
- **Progress Display**: Button shows current action progress ("Executing 2/4...")

**Use Cases**:
- **UI Workflows**: Multi-click workflows that should be atomic
- **Form Sequences**: Multiple form fields that should be filled together
- **Navigation + Action**: Navigate then perform action on new page
- **Complex Interactions**: Workflows that are too complex for individual steps

**Error Handling**:
- **Requirements Failures**: Show specific error for failed action
- **Execution Failures**: Display action-specific error messages
- **Recovery Options**: "Fix this" or "Retry" buttons where applicable
- **State Preservation**: Maintains partial completion state for debugging

```html
<!-- Basic multi-step workflow -->
<li class="interactive" 
    data-targetaction="multistep"
    data-requirements="on-page:/dashboard/new"
    data-hint="Creates a visualization panel in 3 steps">
  
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
  
  Click Add visualization, select Prometheus data source, then enter a basic query.
</li>

<!-- Complex multi-step with navigation -->
<li class="interactive" 
    data-targetaction="multistep"
    data-requirements="is-admin"
    data-objectives="has-plugin:grafana-clock-panel"
    data-hint="Installs and enables the clock panel plugin">
  
  <span class="interactive" 
        data-targetaction="navigate" 
        data-reftarget="/admin/plugins"
        data-requirements="navmenu-open"></span>
  
  <span class="interactive" 
        data-targetaction="formfill" 
        data-reftarget="input[placeholder='Search Grafana plugins']"
        data-targetvalue="clock"
        data-requirements="exists-reftarget"></span>
  
  <span class="interactive" 
        data-targetaction="button" 
        data-reftarget="Install"
        data-requirements="exists-reftarget"></span>
  
  Navigate to plugins, search for clock panel, and install it.
</li>

<!-- Multi-step with error recovery -->
<li class="interactive" 
    data-targetaction="multistep"
    data-requirements="on-page:/connections"
    data-skippable="true"
    data-hint="Tests data source connection - can skip if already working">
  
  <span class="interactive" 
        data-targetaction="highlight" 
        data-reftarget="button[data-testid='data-source-test-button']"
        data-requirements="exists-reftarget"></span>
  
  <span class="interactive" 
        data-targetaction="button" 
        data-reftarget="Test"
        data-requirements="exists-reftarget"></span>
  
  Highlight the test button, then click it to verify the connection.
</li>
```

## Action Type Selection Guide

### When to Use Each Type

| Action Type | Use When | Advantages | Considerations |
|-------------|----------|------------|----------------|
| **highlight** | Clicking elements with stable CSS selectors | Precise targeting, works with any clickable element | Requires stable selectors, can break with UI changes |
| **button** | Clicking buttons with stable text | Text is more stable than DOM, user-friendly | Text might change with localization |
| **formfill** | Setting values in form fields | Handles complex inputs, Monaco editors, ARIA comboboxes | Requires understanding of form element types |
| **navigate** | Moving between pages/sections | Clean navigation, handles internal/external URLs | Can't verify page content loaded |
| **sequence** | Teaching multi-step workflows | Progress tracking, resumable, state persistence | More complex setup, requires container structure |
| **multistep** | Bundling related micro-actions | Atomic execution, single user decision | No individual step control, all-or-nothing execution |

### Decision Tree

```
What do you want to do?
├── Click something
│   ├── Button with stable text → button
│   ├── Element with stable selector → highlight
│   └── Multiple related clicks → multistep
├── Fill a form field
│   ├── Simple input → formfill
│   ├── Complex editor (Monaco) → formfill
│   └── Multiple fields → sequence or multistep
├── Navigate somewhere
│   ├── Internal Grafana route → navigate
│   ├── External URL → navigate
│   └── Navigate + do something → multistep
└── Teach a workflow
    ├── Linear steps with checkpoints → sequence
    ├── Atomic multi-action → multistep
    └── Just explanation → highlight with data-doit="false"
```

### Best Practices by Type

#### highlight Actions
- Always include `exists-reftarget` requirement
- Use `data-testid` attributes when available
- Include navigation requirements for nav elements
- Add interactive comments for educational value

#### button Actions
- Prefer exact text matches over partial
- Include `exists-reftarget` for safety
- Test across different UI languages if applicable
- Use for primary user actions (Save, Create, etc.)

#### formfill Actions
- Understand the input type (text, checkbox, select, Monaco, ARIA)
- Include appropriate requirements (`exists-reftarget`, page location)
- Use `data-verify` to confirm the value was set correctly
- Consider user context (what values make sense)

#### navigate Actions
- Use `data-verify="on-page:/target"` to confirm navigation
- Include requirements for navigation permissions
- Consider using `data-objectives` for pages user might already be on
- Handle both internal routes and external URLs appropriately

#### sequence Actions
- Use unique, stable `id` attributes for containers
- Structure child steps logically
- Include section-level requirements and objectives
- Consider step dependencies and error recovery

#### multistep Actions
- Keep internal actions focused and related
- Include requirements at both multistep and action levels
- Use for workflows that should be atomic
- Provide clear user messaging about what will happen

### Common Anti-Patterns to Avoid

❌ **Don't**: Use `highlight` for simple button clicks with stable text
✅ **Do**: Use `button` action for better stability

❌ **Don't**: Create single-step sequences
✅ **Do**: Use individual interactive steps

❌ **Don't**: Use `multistep` for unrelated actions
✅ **Do**: Use separate steps or a `sequence`

❌ **Don't**: Use `navigate` for actions that need to happen on the target page
✅ **Do**: Use `multistep` with navigate + action

❌ **Don't**: Use `formfill` without checking the element exists
✅ **Do**: Always include `exists-reftarget` requirement

❌ **Don't**: Mix different interaction paradigms in one tutorial
✅ **Do**: Be consistent with action types and patterns

## Advanced Usage Patterns

### Conditional Actions
```html
<!-- Different actions based on user state -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Enable" 
    data-requirements="exists-reftarget"
    data-hint="Enable the feature if not already enabled">
  Enable the feature
</li>

<li class="interactive" 
    data-targetaction="highlight" 
    data-reftarget="span[data-testid='feature-enabled']"
    data-objectives="exists-reftarget"
    data-doit="false"
    data-hint="Feature is already enabled">
  <span class="interactive-comment">
    The feature is <strong>already enabled</strong> as indicated by this green status indicator.
  </span>
  Notice the feature is already enabled
</li>
```

### Progressive Enhancement
```html
<!-- Start with basic functionality -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='query-input']" 
    data-targetvalue="up">
  Enter a basic query
</li>

<!-- Add advanced features for capable environments -->
<li class="interactive" 
    data-targetaction="formfill" 
    data-reftarget="input[data-testid='query-input']" 
    data-targetvalue="rate(http_requests_total[5m])"
    data-requirements="has-feature:expressions,min-version:9.0.0"
    data-skippable="true">
  Use advanced rate function (skip if not available)
</li>
```

### Error Recovery Workflows
```html
<!-- Primary action -->
<li class="interactive" 
    data-targetaction="button" 
    data-reftarget="Connect" 
    data-requirements="has-datasource:prometheus"
    data-verify="on-page:/dashboard">
  Connect to Prometheus and go to dashboards
</li>

<!-- Fallback action -->
<li class="interactive" 
    data-targetaction="navigate" 
    data-reftarget="/connections/datasources/new"
    data-requirements="is-admin"
    data-skippable="true"
    data-hint="Alternative if connection failed">
  Or create a new data source if connection failed
</li>
```

## Testing and Validation

### Action Testing Checklist

#### For All Actions
- [ ] Requirements are appropriate and complete
- [ ] Error messages are helpful and actionable
- [ ] Actions work in different Grafana themes
- [ ] Actions work for different user roles
- [ ] Selectors are stable across UI updates

#### highlight Actions
- [ ] Elements are properly highlighted and visible
- [ ] Navigation menu opens if needed
- [ ] Multiple elements are handled correctly
- [ ] Interactive comments display properly

#### button Actions
- [ ] Button text matching works reliably
- [ ] Actions work with icon buttons
- [ ] Partial matching doesn't select wrong buttons
- [ ] Actions work across different languages

#### formfill Actions
- [ ] Values are set correctly in target fields
- [ ] Appropriate DOM events are fired
- [ ] React controlled inputs update properly
- [ ] ARIA comboboxes tokenize correctly
- [ ] Monaco editors preserve syntax highlighting

#### navigate Actions
- [ ] Internal navigation preserves app state
- [ ] External URLs open in new tabs safely
- [ ] Verification confirms successful navigation
- [ ] Back/forward browser buttons work correctly

#### sequence Actions
- [ ] Section completion persists across sessions
- [ ] Individual steps can be completed independently
- [ ] Resume functionality works correctly
- [ ] Reset clears all completion state
- [ ] Error handling stops execution appropriately

#### multistep Actions
- [ ] All internal actions execute in correct order
- [ ] Progress display updates correctly
- [ ] Cancellation works at any point
- [ ] Error recovery shows specific failure point
- [ ] Requirements checking works for each action

### Performance Considerations

- **Selector Efficiency**: Use specific selectors to avoid slow DOM queries
- **Requirements Optimization**: Group related requirements to minimize API calls
- **Event Throttling**: System automatically throttles rapid requirement changes
- **Memory Usage**: Large sequences persist minimal state data
- **Network Requests**: Requirements checking is cached and debounced

### Accessibility Guidelines

- **Screen Readers**: Include `data-hint` attributes for context
- **Keyboard Navigation**: Ensure interactive elements are keyboard accessible
- **Focus Management**: Actions properly manage focus state
- **ARIA Labels**: Use ARIA attributes in selectors when appropriate
- **Color Contrast**: Interactive highlighting works in high contrast modes

