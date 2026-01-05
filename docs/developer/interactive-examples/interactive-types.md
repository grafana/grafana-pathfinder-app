### Interactive types

This guide explains the supported interactive types, when to use each, what `reftarget` expects, and how Show vs Do behaves.

> **Note**: This document shows examples in both HTML format (for legacy guides) and JSON format (for new guides). See [json-guide-format.md](./json-guide-format.md) for the complete JSON reference.

## Concepts

- **Show vs Do**: Every action runs in two modes. Show highlights the target without changing state; Do performs the action (click, fill, navigate) and marks the step completed.
- **Targets**: Depending on the action, `reftarget` is either a CSS selector, button text, a URL/path, or a section container selector.

## Types

### highlight

- **Purpose**: Focus and (on Do) click a specific element by CSS selector.
- **reftarget**: CSS selector.
- **Show**: Ensures visibility and highlights.
- **Do**: Ensures visibility then clicks.
- **Use when**: The target element is reliably selectable via a CSS selector (often `data-testid`-based).

**HTML:**

```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']"
>
  Open Dashboards
</li>
```

**JSON:**

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "a[data-testid='data-testid Nav menu item'][href='/dashboards']",
  "content": "Open Dashboards"
}
```

### button

- **Purpose**: Interact with buttons by their visible text.
- **reftarget**: Button text (exact match preferred; partial supported but less stable).
- **Show**: Highlights matching buttons.
- **Do**: Clicks matching buttons.
- **Use when**: The button text is stable; avoids brittle CSS.

**HTML:**

```html
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">Save the data source</li>
```

**JSON:**

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Save & test",
  "content": "Save the data source"
}
```

### formfill

- **Purpose**: Fill inputs, textareas (including Monaco), selects, and ARIA comboboxes.
- **reftarget**: CSS selector for the input element.
- **targetvalue**: String to set.
- **Show**: Highlights the field.
- **Do**: Sets the value and fires the right events; ARIA comboboxes are handled token-by-token; Monaco editors use enhanced events.
- **Use when**: Setting values in fields or editors.

**HTML:**

```html
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[id='connection-url']"
  data-targetvalue="http://prometheus:9090"
>
  Set URL
</li>
```

**JSON:**

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

- **Purpose**: Navigate to a Grafana route or external URL.
- **reftarget**: Internal path (e.g. `/dashboard/new`) or absolute URL.
- **Show**: Indicates the intent to navigate.
- **Do**: Uses Grafana `locationService.push` for internal paths; opens new tab for external URLs.
- **Use when**: The interaction is pure navigation.

**HTML:**

```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/dashboard/new">Create dashboard</li>
```

**JSON:**

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/dashboard/new",
  "content": "Create dashboard"
}
```

### sequence

- **Purpose**: Group and run a list of steps inside a container.
- **reftarget**: Container selector (typically the section `<span>` with an `id`).
- **Behavior**: Show highlights each step; Do performs each step with timing and completion management.
- **Use when**: Teaching a linear set of steps as a single section with "Do Section".

**HTML:**

```html
<span id="setup-datasource" class="interactive" data-targetaction="sequence" data-reftarget="span#setup-datasource">
  <ul>
    <li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/connections']">Open Connections</li>
    <li
      class="interactive"
      data-targetaction="formfill"
      data-reftarget="input[id='basic-settings-name']"
      data-targetvalue="prometheus-datasource"
    >
      Name it
    </li>
  </ul>
</span>
```

**JSON (section block):**

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

- **Purpose**: A single "step" that internally performs multiple actions in order.
- **Definition**: A `<li class="interactive" data-targetaction="multistep">` with internal `<span class="interactive" ...>` actions.
- **Behavior**: Handles its own Show/Do timing and requirement checks per internal action.
- **Use when**: A user-facing instruction bundles multiple micro-actions that should run as one.

**HTML:**

```html
<li class="interactive" data-targetaction="multistep">
  <span class="interactive" data-targetaction="button" data-reftarget="Add visualization"></span>
  <span class="interactive" data-targetaction="button" data-reftarget="prometheus-datasource"></span>
  Click Add visualization, then pick the data source.
</li>
```

**JSON:**

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

**Note**: Normally, multistep actions do not have reftargets, since they act as containers for other
interactive actions. If you specify the requirement of `exists-reftarget` for a multistep action,
you are recommended to also specify `data-reftarget` to be equal to the first reftarget of the
first interactive action in the multistep sequence.

### guided

- **Purpose**: Highlights elements and waits for the user to perform actions manually.
- **Behavior**: System highlights each step and waits for user interaction before proceeding.
- **Use when**: Actions depend on CSS `:hover` states or you want users to learn by doing.

**JSON only** (no HTML equivalent):

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

### hover

- **Purpose**: Hover over an element (useful in guided blocks for revealing hover-dependent UI).
- **reftarget**: CSS selector for the element to hover.
- **Use when**: UI elements are hidden behind hover states.

**JSON:**

```json
{
  "type": "interactive",
  "action": "hover",
  "reftarget": "div[data-testid='table-row']",
  "content": "Hover over the row to reveal action buttons"
}
```

## Choosing the right type

| Need                                    | Action/Block Type                    |
| --------------------------------------- | ------------------------------------ |
| Click by CSS selector                   | `highlight`                          |
| Click by button text                    | `button`                             |
| Enter text/select values                | `formfill`                           |
| Route change                            | `navigate`                           |
| Hover to reveal hidden UI               | `hover`                              |
| Teach a linear section                  | `section` (JSON) / `sequence` (HTML) |
| Bundle micro-steps into one (automated) | `multistep`                          |
| User performs steps manually            | `guided`                             |
