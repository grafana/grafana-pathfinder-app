# Guided interactions

Guided interactions highlight elements and display instructions, then **wait for the user to manually perform the action** before proceeding to the next step. They provide a middle ground between fully automated multistep actions and unassisted manual execution.

## When to use guided

- Actions depend on CSS `:hover` states that cannot be programmatically triggered
- You want users to learn by doing rather than watching automation
- UI elements are hidden behind hover states (e.g., RCA Workbench action buttons)
- You need users to experience the actual interaction flow

### Guided vs multistep

| Feature             | Multistep            | Guided                        |
| ------------------- | -------------------- | ----------------------------- |
| Execution           | Fully automated      | User performs manually        |
| Hover support       | Simulated (limited)  | Real hover (works everywhere) |
| CSS `:hover`        | Cannot trigger       | Triggers naturally            |
| Learning            | Watch automation     | Learn by doing                |
| Speed               | Fast                 | User-paced                    |
| Reliability         | Depends on selectors | Depends on user               |
| Section integration | Runs in sequence     | Pauses section                |

## Basic syntax

A guided block contains a `content` description and a `steps` array. Each step specifies an `action` and `reftarget`.

```json
{
  "type": "guided",
  "content": "Inspect the checkout service details",
  "steps": [
    {
      "action": "hover",
      "reftarget": "div[data-cy=\"wb-list-item\"]:contains(\"checkoutservice\")",
      "description": "Hover over the checkout service row to reveal action buttons"
    },
    {
      "action": "button",
      "reftarget": "Dashboard",
      "description": "Click the Dashboard button that appeared"
    }
  ]
}
```

The `description` field on each step appears as a tooltip/instruction when that step is highlighted.

## Supported action types

Guided mode supports these action types within its steps:

### Hover

The system highlights the element and waits for the user to hover over it for 500 ms.

```json
{
  "type": "guided",
  "content": "Hover over the table row to reveal actions",
  "steps": [
    {
      "action": "hover",
      "reftarget": "div.table-row",
      "description": "Hover your mouse over this row to reveal the action buttons"
    }
  ]
}
```

### Button

The system highlights the button and waits for the user to click it.

```json
{
  "type": "guided",
  "content": "Open the settings menu",
  "steps": [
    {
      "action": "button",
      "reftarget": "button[aria-label=\"Settings\"]",
      "description": "Click the Settings button"
    }
  ]
}
```

### Highlight

Same as button -- waits for the user to click the highlighted element.

```json
{
  "type": "guided",
  "content": "Select the dashboard panel",
  "steps": [
    {
      "action": "highlight",
      "reftarget": "#dashboard-panel",
      "description": "Click the panel to select it"
    }
  ]
}
```

## Configuration

### `stepTimeout`

Controls how long to wait for user action before showing a skip/retry option. Default: 30000 ms (30 seconds).

```json
{
  "type": "guided",
  "content": "Complex interaction with longer timeout",
  "stepTimeout": 45000,
  "steps": [{ "action": "hover", "reftarget": "div.service-row" }]
}
```

### `skippable`

Allows users to skip the entire guided interaction if they cannot complete it.

```json
{
  "type": "guided",
  "content": "Optional guided step",
  "skippable": true,
  "steps": [{ "action": "hover", "reftarget": "div.row" }]
}
```

Individual steps can also be marked skippable:

```json
{
  "steps": [
    { "action": "hover", "reftarget": "div.row", "skippable": true },
    { "action": "button", "reftarget": "Edit" }
  ]
}
```

### `completeEarly`

When `true`, the guided block can mark itself complete if the user performs the expected action before the guide formally reaches that step.

```json
{
  "type": "guided",
  "content": "Hover and click the action button",
  "completeEarly": true,
  "steps": [
    { "action": "hover", "reftarget": "tr[data-row-id=\"user-123\"]" },
    { "action": "button", "reftarget": "Edit" }
  ]
}
```

### `requirements` and `objectives`

Guided blocks support the same requirements and objectives system as other interactive blocks.

```json
{
  "type": "guided",
  "content": "Click the button (only enabled when it exists)",
  "requirements": ["exists-reftarget"],
  "objectives": ["on-page:/dashboards/edit"],
  "steps": [{ "action": "button", "reftarget": "button[aria-label=\"Create\"]" }]
}
```

### Per-step requirements

Individual steps can declare their own requirements:

```json
{
  "type": "guided",
  "content": "Multi-step with per-action validation",
  "steps": [
    {
      "action": "hover",
      "reftarget": ".service-row",
      "requirements": ["exists-reftarget"]
    },
    {
      "action": "button",
      "reftarget": "button.action-btn",
      "requirements": ["exists-reftarget"]
    }
  ]
}
```

## Integration with sections

Guided blocks integrate seamlessly with sections. When a section's "Do section" execution reaches a guided block:

1. Section **pauses** before the guided step
2. User manually clicks the guided step's "Start guided interaction" button
3. User **performs** each action as highlighted
4. Step **completes** when all actions are done
5. User clicks **Resume** to continue with remaining automated steps

### Mixed automation and guided

```json
{
  "type": "section",
  "title": "RCA Workbench investigation",
  "blocks": [
    {
      "type": "interactive",
      "action": "button",
      "reftarget": "Clear",
      "content": "Clear previous entries"
    },
    {
      "type": "interactive",
      "action": "formfill",
      "reftarget": "input[data-testid=\"search\"]",
      "targetvalue": "adaptive-logs-api",
      "content": "Search for service"
    },
    {
      "type": "guided",
      "content": "Manually inspect service (hover reveals buttons)",
      "steps": [
        {
          "action": "hover",
          "reftarget": "div[data-cy=\"wb-list-item\"]:contains(\"adaptive-logs-api\")",
          "description": "Hover over the service row to reveal action buttons"
        },
        {
          "action": "button",
          "reftarget": "Dashboard",
          "description": "Click the Dashboard button"
        }
      ]
    },
    {
      "type": "interactive",
      "action": "button",
      "reftarget": "Dashboard",
      "content": "Open dashboard view"
    }
  ]
}
```

**Execution flow:**

1. User clicks "Do section (4 steps)"
2. Steps 1-2 execute automatically
3. Section pauses at step 3 (guided)
4. User manually starts the guided interaction
5. User performs hover and click as guided
6. Guided step completes
7. User clicks "Resume (1 step)" to finish step 4

## Timeout behavior

When a step times out (default 30 seconds):

- Progress indicator shows "Timed out"
- Error message: "Step X timed out. Click 'Skip' to continue or 'Retry' to try again."
- **Retry**: restarts the current step
- **Skip**: marks step as complete and moves to next (only when `skippable` is `true`)

## Troubleshooting

### Guided step will not start

The "Start guided interaction" button is disabled.

1. Check that requirements are met
2. Verify target elements exist using browser DevTools
3. Check selector syntax

### Step times out immediately

Element is not visible, selector does not match, or element is in a closed menu.

1. Add `"requirements": ["exists-reftarget"]` to validate target presence
2. Use "Show me" mode first to verify the selector
3. Add navigation requirements if needed (e.g., `"on-page:/dashboards"`)

### Click detection not working

User clicks but the step does not complete.

- Ensure the click is inside the highlighted element boundary
- Check the element is not disabled or covered by `pointer-events: none`
- Verify z-index stacking does not block clicks

### Section does not resume after guided

After completing the guided step, the "Resume" button does not appear.

1. Ensure the guided block is inside a `section` block
2. Verify section's step index advanced past the guided step

## Technical details

### Event detection

- **Hover**: listens for `mouseenter` + 500 ms dwell time (prevents accidental hovers)
- **Click**: listens for `click` event with `capture: true` for reliability
- **Timeout**: configurable per step via `stepTimeout`, defaults to 30000 ms

### No full-page blocking

Unlike automated steps, guided interactions do not block the page. Users can interact with highlighted elements, scroll for context, or cancel (timeout still applies).

### Limitations

- **Form fill actions**: not supported in guided mode
- **Navigate actions**: incompatible with guided model (user would leave the page)
- **Nested guided**: guided steps inside guided steps are not supported
