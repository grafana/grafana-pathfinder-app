### Interactive types

This guide explains the supported interactive types, when to use each, what `data-reftarget` expects, and how Show vs Do behaves.

## Concepts
- **Show vs Do**: Every action runs in two modes. Show highlights the target without changing state; Do performs the action (click, fill, navigate) and marks the step completed.
- **Targets**: Depending on the action, `data-reftarget` is either a CSS selector, button text, a URL/path, or a section container selector.

## Types

### highlight
- **Purpose**: Focus and (on Do) click a specific element by CSS selector.
- **reftarget**: CSS selector.
- **Show**: Ensures visibility and highlights.
- **Do**: Ensures visibility then clicks.
- **Use when**: The target element is reliably selectable via a CSS selector (often `data-testid`-based).
```html
<li class="interactive" data-targetaction="highlight" data-reftarget="a[data-testid='data-testid Nav menu item'][href='/dashboards']">Open Dashboards</li>
```

### button
- **Purpose**: Interact with buttons by their visible text.
- **reftarget**: Button text (exact match preferred; partial supported but less stable).
- **Show**: Highlights matching buttons.
- **Do**: Clicks matching buttons.
- **Use when**: The button text is stable; avoids brittle CSS.
```html
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">Save the data source</li>
```

### formfill
- **Purpose**: Fill inputs, textareas (including Monaco), selects, and ARIA comboboxes.
- **reftarget**: CSS selector for the input element.
- **targetvalue**: String to set.
- **Show**: Highlights the field.
- **Do**: Sets the value and fires the right events; ARIA comboboxes are handled token-by-token; Monaco editors use enhanced events.
- **Use when**: Setting values in fields or editors.
```html
<li class="interactive" data-targetaction="formfill" data-reftarget="input[id='connection-url']" data-targetvalue="http://prometheus:9090">Set URL</li>
```

### navigate
- **Purpose**: Navigate to a Grafana route or external URL.
- **reftarget**: Internal path (e.g. `/dashboard/new`) or absolute URL.
- **Show**: Indicates the intent to navigate.
- **Do**: Uses Grafana `locationService.push` for internal paths; opens new tab for external URLs.
- **Use when**: The interaction is pure navigation.
```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/dashboard/new">Create dashboard</li>
```

### sequence
- **Purpose**: Group and run a list of steps inside a container.
- **reftarget**: Container selector (typically the section `<span>` with an `id`).
- **Behavior**: Show highlights each step; Do performs each step with timing and completion management.
- **Use when**: Teaching a linear set of steps as a single section with “Do Section”.
```html
<span id="setup-datasource" class="interactive" data-targetaction="sequence" data-reftarget="span#setup-datasource">
  <ul>
    <li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/connections']">Open Connections</li>
    <li class="interactive" data-targetaction="formfill" data-reftarget="input[id='basic-settings-name']" data-targetvalue="prometheus-datasource">Name it</li>
  </ul>
</span>
```

### multistep
- **Purpose**: A single “step” that internally performs multiple actions in order.
- **Definition**: A `<li class="interactive" data-targetaction="multistep">` with internal `<span class="interactive" ...>` actions.
- **Behavior**: Handles its own Show/Do timing and requirement checks per internal action.
- **Use when**: A user-facing instruction bundles multiple micro-actions that should run as one.
```html
<li class="interactive" data-targetaction="multistep">
  <span class="interactive" data-targetaction="button" data-reftarget="Add visualization"></span>
  <span class="interactive" data-targetaction="button" data-reftarget="prometheus-datasource"></span>
  Click Add visualization, then pick the data source.
</li>
```

## Choosing the right type
- **Click by CSS selector**: highlight
- **Click by button text**: button
- **Enter text/select values**: formfill
- **Route change**: navigate
- **Teach a linear section**: sequence
- **Bundle micro-steps into one**: multistep
