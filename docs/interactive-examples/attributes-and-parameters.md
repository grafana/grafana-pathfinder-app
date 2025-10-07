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
- **data-doit**: Controls button behavior. Set to `'false'` for show-only mode (no "Do it" button, completes after showing). Defaults to `true`.
- **data-hint**: Tooltip or hint text for UI.
 - **data-showme-text**: Overrides the "Show me" button label for this step.

## Special content elements

- **`<span class="interactive-comment">`**: Rich HTML content that appears as a floating comment box during element highlighting. Supports bold, code, and emphasis formatting. Hidden in normal display but shown as contextual overlay.

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

### show-only mode with rich comments

```html
<li
  class="interactive"
  data-reftarget='div[data-testid="uplot-main-div"]:first-of-type'
  data-targetaction="highlight"
  data-doit="false"
>
  <span class="interactive-comment"
    >This <strong>metrics panel</strong> shows log volume over time with different log levels (<code>debug</code>,
    <code>info</code>, <code>warn</code>, <code>error</code>). The legend displays total counts for each level.</span
  >
  Examine the metrics visualization panel above the logs.
</li>
```

## Authoring tips

- Prefer `data-testid`, `href`, `id`, and ARIA attributes over CSS classes in selectors.
- For buttons, prefer the `button` action with text over CSS selectors.
- Keep `data-requirements` minimal and specific; group with commas.
- Use `data-objectives` for outcome-based auto-completion when the state is already satisfied.
- For sequences, ensure the container `id` is unique and referenced by `data-reftarget`.
- Use `data-doit='false'` for educational/explanatory interactions that don't require user action.
- Place `<span class="interactive-comment">` content at the start of the element for better organization.
- In interactive comments, use `<strong>` for UI element names, `<code>` for technical terms, and `<em>` for emphasis.
