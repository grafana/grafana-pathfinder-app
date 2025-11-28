# Migrating HTML Guides to JSON Format

This guide walks through converting existing HTML interactive guides to the new JSON format.

## Why Migrate?

> **⚠️ Raw HTML support is deprecated.** All new guides must use JSON format. Existing HTML guides will continue to work but should be migrated to JSON.

**Raw HTML rendering is being phased out.** The plugin now routes all content through the JSON pipeline internally—even HTML content gets wrapped in a JSON guide with a single `html` block. This migration guide helps you convert to native JSON blocks for the best experience.

### Benefits of JSON Format

- **Required for new guides**: Raw HTML is deprecated; JSON is the only supported format for new content
- **Better maintainability**: Structured blocks are easier to edit, review, and diff
- **Type safety**: TypeScript definitions catch errors at build time
- **Cleaner separation**: Content and interactivity are clearly organized
- **Tooling support**: Better editor support, linting, and validation
- **Smaller payloads**: Native blocks are more compact than equivalent HTML

## Migration Strategy

You don't need to migrate everything at once. The JSON format supports `html` blocks, so you can:

1. **Wrap existing HTML** in a single `html` block (quickest)
2. **Gradual migration**: Convert sections incrementally
3. **Full rewrite**: Convert everything to native JSON blocks

## Quick Wrap (Minimal Effort)

The fastest migration is wrapping your entire HTML in a JSON guide:

**Before (HTML):**

```html
<h1>Welcome to Grafana</h1>
<p>This guide will show you around.</p>
<div data-targetaction="highlight" data-reftarget="[href='/dashboards']">Click Dashboards to continue.</div>
```

**After (JSON with HTML block):**

```json
{
  "id": "welcome-to-grafana",
  "title": "Welcome to Grafana",
  "blocks": [
    {
      "type": "html",
      "content": "<h1>Welcome to Grafana</h1><p>This guide will show you around.</p><div data-targetaction=\"highlight\" data-reftarget=\"[href='/dashboards']\">Click Dashboards to continue.</div>"
    }
  ]
}
```

This works because `html` blocks support all existing interactive attributes.

---

## Element-by-Element Conversion

### Basic Content

| HTML                 | JSON Block                         |
| -------------------- | ---------------------------------- |
| `<h1>`, `<h2>`, etc. | `markdown` with `#`, `##`          |
| `<p>`                | `markdown`                         |
| `<ul>`, `<ol>`       | `markdown` with `-` or `1.`        |
| `<code>`             | `markdown` with backticks          |
| `<pre><code>`        | `markdown` with fenced code blocks |
| `<img>`              | `image` block                      |
| `<iframe>` (YouTube) | `video` block                      |

**HTML:**

```html
<h2>Getting Started</h2>
<p>Welcome to <strong>Grafana</strong>!</p>
<ul>
  <li>Feature one</li>
  <li>Feature two</li>
</ul>
```

**JSON:**

```json
{
  "type": "markdown",
  "content": "## Getting Started\n\nWelcome to **Grafana**!\n\n- Feature one\n- Feature two"
}
```

### Images

**HTML:**

```html
<img src="https://example.com/image.png" alt="Screenshot" width="400" />
```

**JSON:**

```json
{
  "type": "image",
  "src": "https://example.com/image.png",
  "alt": "Screenshot",
  "width": 400
}
```

### Code Blocks

**HTML:**

```html
<pre><code class="language-promql">rate(http_requests_total[5m])</code></pre>
```

**JSON (markdown):**

````json
{
  "type": "markdown",
  "content": "```promql\nrate(http_requests_total[5m])\n```"
}
````

### Videos

**HTML:**

```html
<iframe src="https://www.youtube.com/embed/VIDEO_ID" title="Tutorial"></iframe>
```

**JSON:**

```json
{
  "type": "video",
  "src": "https://www.youtube.com/embed/VIDEO_ID",
  "provider": "youtube",
  "title": "Tutorial"
}
```

---

## Interactive Elements

### Single Interactive Step

**HTML:**

```html
<div
  data-targetaction="highlight"
  data-reftarget="a[href='/dashboards']"
  data-requirements="navmenu-open"
  data-skippable="true"
>
  <p>Find the <strong>Dashboards</strong> menu item.</p>
  <aside data-targetcomment>Dashboards contain your visualization panels.</aside>
</div>
```

**JSON:**

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "a[href='/dashboards']",
  "requirements": ["navmenu-open"],
  "skippable": true,
  "content": "Find the **Dashboards** menu item.",
  "tooltip": "Dashboards contain your visualization panels."
}
```

### Attribute Mapping

| HTML Attribute               | JSON Field             | Default |
| ---------------------------- | ---------------------- | ------- |
| `data-targetaction`          | `action`               | —       |
| `data-reftarget`             | `reftarget`            | —       |
| `data-targetvalue`           | `targetvalue`          | —       |
| `data-requirements`          | `requirements` (array) | —       |
| `data-objectives`            | `objectives` (array)   | —       |
| `data-skippable="true"`      | `skippable: true`      | `false` |
| `data-hint`                  | `hint`                 | —       |
| `data-showme="false"`        | `showMe: false`        | `true`  |
| `data-doit="false"`          | `doIt: false`          | `true`  |
| `data-complete-early="true"` | `completeEarly: true`  | `false` |
| `data-verify`                | `verify`               | —       |
| `<aside data-targetcomment>` | `tooltip`              | —       |

**Note:** Requirements in HTML are comma-separated strings; in JSON they're arrays:

- HTML: `data-requirements="navmenu-open, is-admin"`
- JSON: `"requirements": ["navmenu-open", "is-admin"]`

### Button Visibility Control

Control which buttons appear using `showMe` and `doIt`:

| Setting         | "Show me" | "Do it" | Use Case                      |
| --------------- | --------- | ------- | ----------------------------- |
| Default         | ✅        | ✅      | Normal interactive step       |
| `doIt: false`   | ✅        | ❌      | Educational highlight only    |
| `showMe: false` | ❌        | ✅      | Direct action without preview |

**HTML (show-only):**

```html
<div data-targetaction="highlight" data-reftarget="div[data-testid='dashboard-panel']" data-doit="false">
  <p>Notice the <strong>metrics panel</strong> displaying your data.</p>
  <aside data-targetcomment>This panel shows real-time metrics from your Prometheus data source.</aside>
</div>
```

**JSON (show-only):**

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "div[data-testid='dashboard-panel']",
  "content": "Notice the **metrics panel** displaying your data.",
  "tooltip": "This panel shows real-time metrics from your Prometheus data source.",
  "doIt": false
}
```

### Execution Control

Use `completeEarly` and `verify` for advanced step completion control:

**HTML:**

```html
<div
  data-targetaction="navigate"
  data-reftarget="/d/my-dashboard"
  data-complete-early="true"
  data-verify="on-page:/d/my-dashboard"
>
  <p>Open the dashboard.</p>
</div>
```

**JSON:**

```json
{
  "type": "interactive",
  "action": "navigate",
  "reftarget": "/d/my-dashboard",
  "content": "Open the dashboard.",
  "completeEarly": true,
  "verify": "on-page:/d/my-dashboard"
}
```

### Interactive Sections (Sequences)

**HTML:**

```html
<section id="tour" data-targetaction="sequence">
  <h3>Tour of Grafana</h3>
  <div data-targetaction="highlight" data-reftarget="[href='/']">
    <p>Start at Home.</p>
  </div>
  <div data-targetaction="highlight" data-reftarget="[href='/dashboards']">
    <p>Then Dashboards.</p>
  </div>
</section>
```

**JSON:**

```json
{
  "type": "section",
  "id": "tour",
  "title": "Tour of Grafana",
  "blocks": [
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "[href='/']",
      "content": "Start at Home."
    },
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "[href='/dashboards']",
      "content": "Then Dashboards."
    }
  ]
}
```

### Multistep (Internal Actions)

**HTML:**

```html
<div data-targetaction="multistep" data-requirements="navmenu-open">
  <p>This will navigate automatically.</p>
  <div data-internalaction="button" data-reftarget="[href='/explore']"></div>
  <div data-internalaction="highlight" data-reftarget="[data-testid='query-editor']"></div>
</div>
```

**JSON:**

```json
{
  "type": "multistep",
  "content": "This will navigate automatically.",
  "requirements": ["navmenu-open"],
  "steps": [
    {
      "action": "button",
      "reftarget": "[href='/explore']"
    },
    {
      "action": "highlight",
      "reftarget": "[data-testid='query-editor']"
    }
  ]
}
```

### Guided (User-Performed)

**HTML:**

```html
<div data-targetaction="guided" data-step-timeout="30000" data-complete-early="true">
  <p>Follow along by clicking each element.</p>
  <div data-guidedaction="highlight" data-reftarget="[href='/dashboards']" data-targetcomment="Click Dashboards"></div>
  <div data-guidedaction="highlight" data-reftarget="[aria-label='New']" data-targetcomment="Now click New"></div>
</div>
```

**JSON:**

```json
{
  "type": "guided",
  "content": "Follow along by clicking each element.",
  "stepTimeout": 30000,
  "completeEarly": true,
  "steps": [
    {
      "action": "highlight",
      "reftarget": "[href='/dashboards']",
      "tooltip": "Click Dashboards"
    },
    {
      "action": "highlight",
      "reftarget": "[aria-label='New']",
      "tooltip": "Now click New"
    }
  ]
}
```

---

## Full Migration Example

### Original HTML Guide

```html
<h1>First Dashboard</h1>

<p>Learn to create your first Grafana dashboard.</p>

<img src="https://grafana.com/dashboard-example.png" alt="Dashboard" />

<section id="create-dashboard" data-targetaction="sequence">
  <h3>Create a Dashboard</h3>

  <div data-targetaction="highlight" data-reftarget="a[href='/dashboards']" data-requirements="navmenu-open">
    <p>Navigate to <strong>Dashboards</strong>.</p>
    <aside data-targetcomment>The Dashboards section contains all your visualizations.</aside>
  </div>

  <div data-targetaction="button" data-reftarget="New" data-requirements="on-page:/dashboards" data-skippable="true">
    <p>Click <strong>New</strong> to create a dashboard.</p>
  </div>
</section>

<h2>Congratulations!</h2>
<p>You've created your first dashboard.</p>
```

### Migrated JSON Guide

```json
{
  "id": "first-dashboard",
  "title": "First Dashboard",
  "blocks": [
    {
      "type": "markdown",
      "content": "# First Dashboard\n\nLearn to create your first Grafana dashboard."
    },
    {
      "type": "image",
      "src": "https://grafana.com/dashboard-example.png",
      "alt": "Dashboard"
    },
    {
      "type": "section",
      "id": "create-dashboard",
      "title": "Create a Dashboard",
      "blocks": [
        {
          "type": "interactive",
          "action": "highlight",
          "reftarget": "a[href='/dashboards']",
          "requirements": ["navmenu-open"],
          "content": "Navigate to **Dashboards**.",
          "tooltip": "The Dashboards section contains all your visualizations."
        },
        {
          "type": "interactive",
          "action": "button",
          "reftarget": "New",
          "requirements": ["on-page:/dashboards"],
          "skippable": true,
          "content": "Click **New** to create a dashboard."
        }
      ]
    },
    {
      "type": "markdown",
      "content": "## Congratulations!\n\nYou've created your first dashboard."
    }
  ]
}
```

---

## Registering the Migrated Guide

Update `src/bundled-interactives/index.json`:

```json
{
  "id": "first-dashboard",
  "title": "First Dashboard",
  "summary": "Learn to create a dashboard in Grafana.",
  "filename": "first-dashboard.json",
  "url": ["/"]
}
```

JSON is the standard format—no `format` field needed.

---

## Validation Checklist

After migration, verify:

- [ ] Guide loads without errors
- [ ] All interactive elements work (Show me, Do it)
- [ ] Requirements are checked correctly
- [ ] Tooltips display properly
- [ ] Sections can be executed as sequences
- [ ] Multistep/guided blocks execute in order
- [ ] Images and videos render
- [ ] Code blocks have syntax highlighting
- [ ] Markdown formatting renders correctly

---

## Common Pitfalls

### 1. Escaping JSON Strings

Markdown content with quotes or special characters needs proper escaping:

```json
{
  "content": "Click the \"Settings\" button"
}
```

### 2. Newlines in Markdown

Use `\n` for newlines within markdown content:

```json
{
  "content": "# Title\n\nParagraph one.\n\nParagraph two."
}
```

### 3. Requirements as Arrays

Remember to convert comma-separated requirements to arrays:

- ❌ `"requirements": "navmenu-open, is-admin"`
- ✅ `"requirements": ["navmenu-open", "is-admin"]`

### 4. Nested Quotes in HTML Blocks

HTML blocks with attributes need careful quote handling:

```json
{
  "type": "html",
  "content": "<div class='container' data-value=\"test\">Content</div>"
}
```

Or escape inner quotes:

```json
{
  "type": "html",
  "content": "<div class=\"container\" data-value=\"test\">Content</div>"
}
```

---

## Getting Help

- See [json-guide-format.md](./json-guide-format.md) for the complete format reference
- See [requirements-reference.md](./requirements-reference.md) for available requirements
- Check `src/bundled-interactives/json-guide-demo.json` for a working example of all block types
