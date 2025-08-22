### Attributes and parameters for interactive elements

This guide documents the core data-\* attributes used to define interactive actions and how to combine them.

## Core attributes

- **data-targetaction**: The action type to execute.
  - Supported: `highlight`, `button`, `formfill`, `navigate`, `sequence`, `multistep`.
- **data-reftarget**: The target reference; meaning depends on `data-targetaction`.
  - `highlight`, `formfill`: CSS selector.
  - `button`: Visible button text.
  - `navigate`: Internal path or absolute URL.
  - `sequence`: Container selector (usually the section `<span>` with an `id`).
- **data-targetvalue**: Optional value for `formfill` actions.
- **data-requirements**: Comma-separated preconditions that must pass for the action to be enabled.
- **data-objectives**: Conditions which, when already true, mark a step or section complete without execution.
- Optional: **data-hint**: Tooltip or hint text for UI.

## Requirements reference (selection)

Common checks supported by the system:

- `exists-reftarget` — the referenced element must exist.
- `navmenu-open` — navigation must be open/visible.
- `has-datasources` — at least one data source exists.
- `has-datasource:<name|uid|type>` — specific data source exists (e.g., `has-datasource:prometheus`, `has-datasource:type:loki`).
- `has-plugin:<pluginId>` — plugin installed/enabled (e.g., `has-plugin:volkovlabs-rss-datasource`).
- `has-dashboard-named:<title>` — dashboard with exact title exists.
- `has-permission:<permission>` — user has a specific permission.
- `has-role:<role>` — role check (`admin`, `editor`, `viewer`, `grafana-admin`).
- `is-admin` — Grafana admin privileges required.
- `on-page:<path>` — current path matches.
- `has-feature:<toggle>` — feature toggle enabled.
- `in-environment:<env>` — environment matches.
- `min-version:<x.y.z>` — minimum Grafana version.
- `section-completed:<sectionId>` — depends on another section being completed.

## Examples

### highlight with requirements

```html
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget="a[data-testid='data-testid Nav menu item'][href='/connections']"
  data-requirements="navmenu-open"
>
  Click Connections in the left-side menu.
</li>
```

### button by text (no CSS required)

```html
<li class="interactive" data-targetaction="button" data-reftarget="Save & test">Save the data source</li>
```

### formfill for ARIA combobox

```html
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget="input[role='combobox'][aria-autocomplete='list']"
  data-targetvalue="container = 'alloy'"
>
  Enter container label
</li>
```

### navigate to internal route

```html
<li class="interactive" data-targetaction="navigate" data-reftarget="/dashboard/new">Create a new dashboard</li>
```

### sequence (section) that groups steps

```html
<span
  id="create-dashboard"
  class="interactive"
  data-targetaction="sequence"
  data-reftarget="span#create-dashboard"
  data-requirements="has-datasource:prometheus"
>
  <ul>
    <li class="interactive" data-targetaction="button" data-reftarget="New"></li>
    <li class="interactive" data-targetaction="highlight" data-reftarget="a[href='/dashboard/new']"></li>
  </ul>
</span>
```

### multistep (internal spans define the actions)

```html
<li class="interactive" data-targetaction="multistep" data-hint="Runs 2 actions">
  <span class="interactive" data-targetaction="button" data-reftarget="Add visualization"></span>
  <span class="interactive" data-targetaction="button" data-reftarget="prometheus-datasource"></span>
  Click Add visualization, then select the data source.
</li>
```

## Authoring tips

- Prefer `data-testid`, `href`, `id`, and ARIA attributes over CSS classes in selectors.
- For buttons, prefer the `button` action with text over CSS selectors.
- Keep `data-requirements` minimal and specific; group with commas.
- Use `data-objectives` for outcome-based auto-completion when the state is already satisfied.
- For sequences, ensure the container `id` is unique and referenced by `data-reftarget`.
