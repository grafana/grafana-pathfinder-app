# Interactive types

This guide explains the supported interactive action types, when to use each, what `reftarget` expects, and how Show vs Do behaves. See [json-guide-format.md](./json-guide-format.md) for the complete JSON reference.

## Concepts

- **Show vs Do**: every action runs in two modes. Show highlights the target without changing state; Do performs the action (click, fill, navigate) and marks the step completed.
- **Targets**: depending on the action, `reftarget` is either a CSS selector, button text, a URL/path, or omitted entirely (for `noop`).

## Action types

### highlight

- **Purpose**: focus and (on Do) click a specific element by CSS selector.
- **reftarget**: CSS selector.
- **Show**: ensures visibility and highlights.
- **Do**: ensures visibility then clicks.
- **Use when**: the target element is reliably selectable via a CSS selector (often `data-testid`-based).

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "a[data-testid='data-testid Nav menu item'][href='/dashboards']",
  "content": "Open Dashboards"
}
```

### button

- **Purpose**: interact with buttons by their visible text.
- **reftarget**: button text (exact match preferred; partial supported but less stable).
- **Show**: highlights matching buttons.
- **Do**: clicks matching buttons.
- **Use when**: the button text is stable; avoids brittle CSS.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Save & test",
  "content": "Save the data source"
}
```

### formfill

- **Purpose**: fill inputs, textareas (including Monaco), selects, and ARIA comboboxes.
- **reftarget**: CSS selector for the input element.
- **targetvalue**: string to set.
- **Show**: highlights the field.
- **Do**: sets the value and fires the right events; ARIA comboboxes are handled token-by-token; Monaco editors use enhanced events.
- **Use when**: setting values in fields or editors.

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "input[id='connection-url']",
  "targetvalue": "http://prometheus:9090",
  "content": "Set URL"
}
```

### navigate

- **Purpose**: navigate to a Grafana route or external URL.
- **reftarget**: internal path (e.g., `/dashboard/new`) or absolute URL.
- **Show**: indicates the intent to navigate.
- **Do**: uses Grafana `locationService.push` for internal paths; opens a new tab for external URLs.
- **Use when**: the interaction is pure navigation.

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/dashboard/new",
  "content": "Create dashboard"
}
```

### hover

- **Purpose**: hover over an element to reveal hover-dependent UI.
- **reftarget**: CSS selector for the element to hover.
- **Show**: highlights the element without triggering hover events.
- **Do**: dispatches `mouseenter`, `mouseover`, `mousemove` events, triggering CSS `:hover` and Tailwind `group-hover:` classes. Maintains hover state for 2 seconds.
- **Use when**: UI elements are hidden behind hover states. Commonly used inside `multistep` or `guided` blocks.

```json
{
  "type": "interactive",
  "action": "hover",
  "reftarget": "div[data-testid='table-row']",
  "content": "Hover over the row to reveal action buttons"
}
```

### noop

- **Purpose**: informational step with no action. Displays content without interacting with the page.
- **reftarget**: optional (not required).
- **Show**: displays the step content as a comment/annotation.
- **Do**: completes immediately without performing any action.
- **Use when**: you need an informational step in a `multistep` or `guided` sequence (e.g., to explain what will happen next), or as a placeholder step that the user simply reads.

```json
{
  "type": "interactive",
  "action": "noop",
  "content": "The next step will open the configuration panel. Review the current settings before proceeding."
}
```

With an optional `reftarget` to highlight an area for reference:

```json
{
  "type": "interactive",
  "action": "noop",
  "reftarget": "div[data-testid='status-panel']",
  "content": "Notice the current status indicator before we make changes."
}
```

## Block types

### section

- **Purpose**: group and run a list of steps inside a container.
- **Behavior**: Show highlights each step; Do performs each step with timing and completion management.
- **Use when**: teaching a linear set of steps as a single section with "Do section".

```json
{
  "type": "section",
  "id": "setup-datasource",
  "title": "Set up data source",
  "blocks": [
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "a[href='/connections']",
      "content": "Open Connections"
    },
    {
      "type": "interactive",
      "action": "formfill",
      "reftarget": "input[id='basic-settings-name']",
      "targetvalue": "prometheus-datasource",
      "content": "Name it"
    }
  ]
}
```

### multistep

- **Purpose**: a single "step" that internally performs multiple actions in order.
- **Behavior**: handles its own Show/Do timing and requirement checks per internal action.
- **Use when**: a user-facing instruction bundles multiple micro-actions that should run as one.

```json
{
  "type": "multistep",
  "content": "Click Add visualization, then pick the data source.",
  "steps": [
    { "action": "button", "reftarget": "Add visualization" },
    { "action": "button", "reftarget": "prometheus-datasource" }
  ]
}
```

If you specify `"requirements": ["exists-reftarget"]` on a multistep, also set `reftarget` to the first step's target so the requirement check has something to find.

### guided

- **Purpose**: highlights elements and waits for the user to perform actions manually.
- **Behavior**: system highlights each step and waits for user interaction before proceeding.
- **Use when**: actions depend on CSS `:hover` states or you want users to learn by doing.

```json
{
  "type": "guided",
  "content": "Follow along by clicking each highlighted element.",
  "stepTimeout": 30000,
  "steps": [
    {
      "action": "highlight",
      "reftarget": "a[href='/dashboards']",
      "description": "Click Dashboards to continue"
    },
    {
      "action": "button",
      "reftarget": "New",
      "description": "Now click New to create a dashboard"
    }
  ]
}
```

See [guided-interactions.md](./guided-interactions.md) for detailed documentation.

## Choosing the right type

| Need | Action/block type |
| --- | --- |
| Click by CSS selector | `highlight` |
| Click by button text | `button` |
| Enter text / select values | `formfill` |
| Route change | `navigate` |
| Hover to reveal hidden UI | `hover` |
| Informational step (no action) | `noop` |
| Teach a linear section | `section` |
| Bundle micro-steps into one (automated) | `multistep` |
| User performs steps manually | `guided` |
