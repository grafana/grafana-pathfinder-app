# Guided Interactions

Guided interactions provide a middle ground between fully automated "Do it" actions and manual user execution. The system highlights elements and displays instructions, then **waits for the user to manually perform the action** before proceeding to the next step.

## Overview

**Use guided interactions when:**

- Actions depend on CSS `:hover` states that can't be programmatically triggered
- You want users to learn by doing rather than watching automation
- UI elements are hidden behind hover states (like the RCA Workbench action buttons)
- You need users to experience the actual interaction flow

**Key differences from multistep:**

- **Multistep**: System performs all actions automatically
- **Guided**: System highlights and waits for user to perform actions manually

## Basic Syntax

```html
<div class="interactive" data-targetaction="guided">
  <!-- Internal action spans define the sequence -->
  <span class="interactive" data-targetaction="hover" data-reftarget='div[data-cy="wb-list-item"]'>
    <span class="interactive-comment">Hover to reveal the action buttons</span>
  </span>

  <span class="interactive" data-targetaction="button" data-reftarget="button.css-8mjxyo">
    <span class="interactive-comment">Click the revealed button to proceed</span>
  </span>

  <!-- Description shown to user -->
  Inspect service details
</div>
```

### Interactive Comments

Each internal action can have an `interactive-comment` span that appears as a tooltip when that step is highlighted:

```html
<span class="interactive" data-targetaction="hover" data-reftarget=".info-icon">
  <span class="interactive-comment"> The <strong>info icon</strong> reveals additional details when hovered. </span>
</span>
```

**Benefits:**

- Contextual help exactly when user needs it
- Supports HTML formatting (bold, code, links)
- Consistent with regular interactive steps
- Cleaner than inline `<ol>` lists

## Supported Action Types

Guided mode currently supports three action types:

### 1. Hover Actions

System highlights the element and waits for user to hover over it for 500ms.

```html
<div class="interactive" data-targetaction="guided">
  <span class="interactive" data-targetaction="hover" data-reftarget="div.table-row">
    <span class="interactive-comment">
      Hover your mouse over this row to reveal the action buttons. They only appear on hover!
    </span>
  </span>
  Hover over the table row to reveal actions
</div>
```

**Completion Detection**: User's mouse enters the highlighted area and stays for 500ms

### 2. Button Actions

System highlights the button and waits for user to click it.

```html
<div class="interactive" data-targetaction="guided">
  <span class="interactive" data-targetaction="button" data-reftarget='button[aria-label="Settings"]'> </span>
  Open the settings menu
</div>
```

**Completion Detection**: User clicks the highlighted element

### 3. Highlight Actions

Same as button actions - waits for user to click the element.

```html
<div class="interactive" data-targetaction="guided">
  <span class="interactive" data-targetaction="highlight" data-reftarget="#dashboard-panel"> </span>
  Select the dashboard panel
</div>
```

**Completion Detection**: User clicks the highlighted element

## Multi-Step Guided Sequences

Combine multiple actions in sequence. Each step highlights, waits for user completion, then moves to the next.

```html
<div class="interactive" data-targetaction="guided">
  <!-- Step 1: Hover to reveal buttons -->
  <span
    class="interactive"
    data-targetaction="hover"
    data-reftarget='div[data-cy="wb-list-item"]:contains("adaptive-logs-api")'
  >
    <span class="interactive-comment">
      Hover over the <code>adaptive-logs-api</code> row to reveal action buttons. The buttons are hidden until you
      hover!
    </span>
  </span>

  <!-- Step 2: Click revealed button -->
  <span class="interactive" data-targetaction="button" data-reftarget="button.css-8mjxyo">
    <span class="interactive-comment"> Click the <strong>graph/dashboard</strong> button that appeared. </span>
  </span>

  <!-- Step 3: Click another element -->
  <span class="interactive" data-targetaction="button" data-reftarget='button[data-testid="close-modal"]'>
    <span class="interactive-comment"> Close the modal to return to the workbench. </span>
  </span>

  Complete the service inspection workflow
</div>
```

## Configuration Options

### Step Timeout

Control how long to wait for user action before showing skip option (default: 30 seconds):

```html
<div class="interactive" data-targetaction="guided" data-step-timeout="45000">
  <!-- 45 second timeout per step -->
  <span class="interactive" data-targetaction="hover" ...></span>
  Complex interaction with longer timeout
</div>
```

### Skippable Steps

Allow users to skip the guided interaction if they can't complete it:

```html
<div class="interactive" data-targetaction="guided" data-skippable="true">
  <span class="interactive" data-targetaction="hover" ...></span>
  Optional guided step
</div>
```

### Requirements

Guided steps support the same requirements system as other interactive elements:

```html
<div class="interactive" data-targetaction="guided" data-requirements="exists-reftarget">
  <span class="interactive" data-targetaction="button" ...></span>
  Click the button (only enabled when button exists)
</div>
```

## Integration with Sections

Guided steps integrate seamlessly with interactive sections. When a section encounters a guided step during "Do Section" execution:

1. **Section pauses** before the guided step
2. **User must manually click** the guided step's "Start guided interaction" button
3. **User performs** each action as highlighted
4. **Step completes** when all actions are done
5. **User clicks "Resume"** to continue with remaining automated steps

### Example: Mixed Automation and Guided

```html
<div class="interactive-section" data-requirements="exists-reftarget">
  <h3>RCA Workbench Investigation</h3>

  <!-- Automated step -->
  <div class="interactive" data-targetaction="button" data-reftarget="Clear">Clear previous entries</div>

  <!-- Automated step -->
  <div
    class="interactive"
    data-targetaction="formfill"
    data-reftarget='input[data-testid="search"]'
    data-targetvalue="adaptive-logs-api"
  >
    Search for service
  </div>

  <!-- GUIDED STEP - section pauses here -->
  <div class="interactive" data-targetaction="guided">
    <span
      class="interactive"
      data-targetaction="hover"
      data-reftarget='div[data-cy="wb-list-item"]:contains("adaptive-logs-api")'
    >
    </span>
    <span class="interactive" data-targetaction="button" data-reftarget="button.css-8mjxyo"> </span>
    Manually inspect service (hover reveals buttons)
  </div>

  <!-- Automated steps continue after guided completes -->
  <div class="interactive" data-targetaction="button" data-reftarget="Dashboard">Open dashboard view</div>
</div>
```

**Execution Flow:**

1. User clicks "Do Section (4 steps)"
2. Steps 1-2 execute automatically
3. **Section pauses at step 3 (guided)**
4. User manually clicks guided step's button
5. User performs hover and click as guided
6. Guided step completes
7. User clicks "Resume (1 step)" to finish step 4

## Timeout Behavior

When a step times out (default 30 seconds):

- **Timer expires**: Progress indicator shows "Timed out"
- **Error message**: "Step X timed out. Click 'Skip' to continue or 'Retry' to try again."
- **Options**:
  - **Retry**: Restart the current step
  - **Skip**: Mark step as complete and move to next (only if `data-skippable="true"`)

```html
<div class="interactive" data-targetaction="guided" data-step-timeout="20000" data-skippable="true">
  <span class="interactive" data-targetaction="hover" ...></span>
  This step times out after 20 seconds and can be skipped
</div>
```

## Real-World Example: RCA Workbench

This example shows the actual Grafana RCA Workbench pattern where action buttons are hidden until hover:

```html
<div class="interactive-section">
  <h3>Investigate Service Issues</h3>

  <div class="interactive" data-targetaction="guided" data-requirements="exists-reftarget" data-step-timeout="45000">
    <!-- Step 1: Hover over the service row to reveal action buttons -->
    <span
      class="interactive"
      data-targetaction="hover"
      data-reftarget='div[data-cy="wb-list-item"]:contains("adaptive-logs-api")'
    >
    </span>

    <!-- Step 2: Click the revealed graph/dashboard button -->
    <span class="interactive" data-targetaction="button" data-reftarget="button.css-8mjxyo:has(svg.svg-icon)"> </span>

    <p>The RCA Workbench hides action buttons until you hover over a service row. This guided interaction will:</p>
    <ol>
      <li>Highlight the service row - <strong>hover your mouse over it</strong></li>
      <li>Highlight the revealed button - <strong>click it</strong></li>
    </ol>
  </div>
</div>
```

## Best Practices

### 1. Use Descriptive Messages

Provide clear instructions in the children content:

```html
<div class="interactive" data-targetaction="guided">
  <span class="interactive" data-targetaction="hover" ...></span>
  <span class="interactive" data-targetaction="button" ...></span>

  <strong>What you'll do:</strong>
  <ol>
    <li>Hover over the workload row</li>
    <li>Click the "Dashboard" button that appears</li>
  </ol>
</div>
```

### 2. Set Appropriate Timeouts

- **Simple actions** (single click): 15-20 seconds
- **Moderate complexity** (hover + click): 30 seconds (default)
- **Complex workflows** (multiple steps): 45-60 seconds

### 3. Make Complex Steps Skippable

If a step might be confusing or depend on specific UI state:

```html
<div class="interactive" data-targetaction="guided" data-skippable="true" data-step-timeout="30000">...</div>
```

### 4. Combine with Requirements

Ensure target elements exist before starting guided interaction:

```html
<div class="interactive" data-targetaction="guided" data-requirements="exists-reftarget">
  <span class="interactive" data-targetaction="button" data-reftarget='button[aria-label="Create"]'> </span>
  Click the Create button
</div>
```

### 5. Use in Sections for Mixed Workflows

Combine automated and guided steps for optimal user experience:

```html
<div class="interactive-section">
  <h3>Dashboard Setup</h3>

  <!-- Automated: Navigation and setup -->
  <div class="interactive" data-targetaction="navigate" data-reftarget="/dashboards">Navigate to dashboards</div>

  <!-- Guided: User interaction needed for hover-dependent UI -->
  <div class="interactive" data-targetaction="guided">
    <span data-targetaction="hover" data-reftarget=".dashboard-row"></span>
    <span data-targetaction="button" data-reftarget="Edit"></span>
    Open dashboard editor
  </div>

  <!-- Automated: Continue with form filling -->
  <div class="interactive" data-targetaction="formfill" ...>Set dashboard name</div>
</div>
```

## Comparison: Guided vs Multistep

| Feature                 | Multistep            | Guided                        |
| ----------------------- | -------------------- | ----------------------------- |
| **Execution**           | Fully automated      | User performs manually        |
| **Hover support**       | Simulated (limited)  | Real hover (works everywhere) |
| **CSS :hover**          | Cannot trigger       | Triggers naturally            |
| **Learning**            | Watch automation     | Learn by doing                |
| **Speed**               | Fast                 | User-paced                    |
| **Reliability**         | Depends on selectors | Depends on user               |
| **Section integration** | Runs in sequence     | Pauses section                |

## Advanced Usage

### Per-Step Requirements

Check requirements for individual internal actions:

```html
<div class="interactive" data-targetaction="guided">
  <span
    class="interactive"
    data-targetaction="hover"
    data-reftarget=".service-row"
    data-requirements="exists-reftarget"
  >
  </span>
  <span
    class="interactive"
    data-targetaction="button"
    data-reftarget="button.action-btn"
    data-requirements="exists-reftarget"
  >
  </span>
  Multi-step with per-action validation
</div>
```

### Complex Selectors

Use enhanced selectors with `:contains()` and `:has()`:

```html
<div class="interactive" data-targetaction="guided">
  <span
    class="interactive"
    data-targetaction="hover"
    data-reftarget='div[data-cy="wb-list-item"]:has(p:contains("specific-service"))'
  >
  </span>
  <span class="interactive" data-targetaction="button" data-reftarget='button:text("Dashboard")'> </span>
  Find and interact with specific service by name
</div>
```

### Hints for Context

Provide helpful context via the hints attribute:

```html
<div
  class="interactive"
  data-targetaction="guided"
  data-hint="Action buttons only appear when hovering over table rows"
>
  <span data-targetaction="hover" ...></span>
  <span data-targetaction="button" ...></span>
  Reveal and click hidden action button
</div>
```

## Troubleshooting

### Guided Step Won't Start

**Symptom**: "Start guided interaction" button is disabled

**Solutions**:

1. Check requirements are met
2. Verify target elements exist using browser DevTools
3. Try "Fix this" button if available
4. Check selector syntax

### Step Times Out Immediately

**Symptom**: Timeout error appears right away

**Causes**:

- Element not visible on page
- Selector doesn't match any elements
- Element is in closed navigation/menu

**Solutions**:

1. Add `data-requirements="exists-reftarget"` to validate
2. Use "Show me" mode first to verify selector
3. Add navigation requirements if needed

### Section Doesn't Resume After Guided

**Symptom**: After completing guided step, "Resume" button doesn't appear

**Solutions**:

1. Ensure guided step is inside an `interactive-section`
2. Check that guided step properly calls `onStepComplete`
3. Verify section's `currentStepIndex` advanced past guided step

### Click Detection Not Working

**Symptom**: User clicks but step doesn't complete

**Causes**:

- Clicking outside the highlighted element
- Element is disabled or has `pointer-events: none`
- Element is covered by another layer

**Solutions**:

1. Ensure highlight clearly shows clickable area
2. Check element is actually clickable in DevTools
3. Verify z-index stacking doesn't block clicks

## Migration from Multistep

If you have a multistep that fails due to CSS hover limitations:

**Before (multistep - may fail):**

```html
<div class="interactive" data-targetaction="multistep">
  <span data-targetaction="hover" data-reftarget=".row"></span>
  <span data-targetaction="button" data-reftarget="Edit"></span>
  Edit item
</div>
```

**After (guided - works reliably):**

```html
<div class="interactive" data-targetaction="guided">
  <span data-targetaction="hover" data-reftarget=".row"></span>
  <span data-targetaction="button" data-reftarget="Edit"></span>
  Edit item
</div>
```

Just change `multistep` to `guided` - the syntax is identical!

## Technical Details

### Event Detection

- **Hover**: Listens for `mouseenter` + 500ms dwell time (prevents accidental hovers)
- **Click**: Listens for `click` event with `capture: true` for reliability
- **Timeout**: Configurable per step, defaults to 30 seconds

### Section Integration

When "Do Section" encounters a guided step:

1. Section execution **pauses** (loop exits)
2. `currentStepIndex` marks the pause point
3. Section blocking overlay **removed**
4. User sees highlighted guided step ready to click
5. After guided completion, "Resume" button continues from next step

### No Full-Page Blocking

Unlike automated steps, guided interactions don't block the page. Users can:

- Interact with the highlighted elements
- Scroll to see context
- Cancel by clicking away (timeout still applies)

This design prevents the "spotlight overlay" complexity while maintaining clear visual guidance.

## Limitations

### Not Yet Supported

- **Form fill actions**: Coming in future update
- **Navigate actions**: Incompatible with guided model (user leaves page)
- **Nested guided**: Guided steps inside guided steps not supported

### Browser Requirements

- Modern browsers with `AbortController` support
- Event listeners with `signal` option
- `mouseenter`/`mouseleave` events

### Performance Considerations

- Each guided step creates temporary event listeners (cleaned up after completion)
- Timeouts are properly cleared to prevent memory leaks
- Highlights use existing CSS animation system (no additional overhead)
