# JSON Guide Format Reference

This document provides a comprehensive reference for the JSON guide format used to create interactive tutorials in Grafana Pathfinder.

## Overview

JSON guides are structured documents that combine content blocks (markdown, HTML, images, video) with interactive elements (highlight, button clicks, form fills) to create guided learning experiences.

### Why JSON?

- **Type-safe**: Strong TypeScript definitions catch errors at build time
- **Structured**: Block-based format is easier to parse, validate, and transform
- **Tooling-friendly**: Better support for editors, linters, and code generation
- **Migration path**: HTML blocks allow gradual migration from existing HTML guides

## Root Structure

Every JSON guide has three required fields:

```json
{
  "id": "my-guide-id",
  "title": "My Guide Title",
  "blocks": []
}
```

| Field    | Type        | Required | Description                             |
| -------- | ----------- | -------- | --------------------------------------- |
| `id`     | string      | ✅       | Unique identifier for the guide         |
| `title`  | string      | ✅       | Display title shown in the UI           |
| `blocks` | JsonBlock[] | ✅       | Array of content and interactive blocks |

## Block Types

### Content Blocks

#### Markdown Block

The primary block type for formatted text content.

````json
{
  "type": "markdown",
  "content": "# Heading\n\nParagraph with **bold** and *italic* text.\n\n- List item 1\n- List item 2\n\n```promql\nrate(http_requests_total[5m])\n```"
}
````

**Supported Markdown Features:**

- Headings (`#`, `##`, `###`, etc.)
- Bold (`**text**`) and italic (`*text*`)
- Inline code (`` `code` ``)
- Fenced code blocks with syntax highlighting
- Links (`[text](url)`)
- Unordered lists (`-` or `*`)
- Ordered lists (`1.`, `2.`, etc.)
- Tables

**Example with table:**

```json
{
  "type": "markdown",
  "content": "| Column 1 | Column 2 |\n|----------|----------|\n| Value 1  | Value 2  |"
}
```

#### HTML Block

For raw HTML content. Use sparingly—prefer markdown for new content.

```json
{
  "type": "html",
  "content": "<div class='custom-box'><p>Custom HTML content</p></div>"
}
```

**Notes:**

- HTML is sanitized before rendering (XSS protection)
- Supports interactive attributes (`data-targetaction`, etc.)
- Best used for migration from existing HTML guides
- Can contain `<pre><code>` blocks with syntax highlighting

#### Image Block

Embed images with optional dimensions.

```json
{
  "type": "image",
  "src": "https://example.com/image.png",
  "alt": "Description for accessibility",
  "width": 400,
  "height": 300
}
```

| Field    | Type   | Required | Description                |
| -------- | ------ | -------- | -------------------------- |
| `src`    | string | ✅       | Image URL                  |
| `alt`    | string | ❌       | Alt text for accessibility |
| `width`  | number | ❌       | Display width in pixels    |
| `height` | number | ❌       | Display height in pixels   |

#### Video Block

Embed YouTube or native HTML5 video.

```json
{
  "type": "video",
  "src": "https://www.youtube.com/embed/VIDEO_ID",
  "provider": "youtube",
  "title": "Video Title"
}
```

| Field      | Type                      | Required | Description                           |
| ---------- | ------------------------- | -------- | ------------------------------------- |
| `src`      | string                    | ✅       | Video URL (embed URL for YouTube)     |
| `provider` | `"youtube"` \| `"native"` | ❌       | Video provider (default: `"youtube"`) |
| `title`    | string                    | ❌       | Video title for accessibility         |
| `start`    | number                    | ❌       | Start time in seconds                 |
| `end`      | number                    | ❌       | End time in seconds                   |

**YouTube Example:**

```json
{
  "type": "video",
  "src": "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "provider": "youtube",
  "title": "Getting Started with Grafana",
  "start": 10,
  "end": 120
}
```

**Native Video Example:**

```json
{
  "type": "video",
  "src": "https://example.com/tutorial.mp4",
  "provider": "native",
  "title": "Tutorial Video",
  "start": 5,
  "end": 60
}
```

---

### Interactive Blocks

#### Interactive Block (Single Action)

A single interactive step with "Show me" and "Do it" buttons.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "a[data-testid='data-testid Nav menu item'][href='/dashboards']",
  "content": "Click on **Dashboards** to view your dashboards.",
  "tooltip": "The Dashboards section shows all your visualization panels.",
  "requirements": ["navmenu-open"],
  "objectives": ["visited-dashboards"],
  "skippable": true,
  "hint": "Open the navigation menu first"
}
```

| Field           | Type     | Required | Default | Description                                              |
| --------------- | -------- | -------- | ------- | -------------------------------------------------------- |
| `action`        | string   | ✅       | —       | Action type (see below)                                  |
| `reftarget`     | string   | ✅       | —       | CSS selector or button text                              |
| `content`       | string   | ✅       | —       | Markdown description shown to user                       |
| `targetvalue`   | string   | ❌       | —       | Value for `formfill` actions (supports regex, see below) |
| `tooltip`       | string   | ❌       | —       | Tooltip shown on highlight (supports markdown)           |
| `requirements`  | string[] | ❌       | —       | Conditions that must be met                              |
| `objectives`    | string[] | ❌       | —       | Objectives marked complete after this step               |
| `skippable`     | boolean  | ❌       | `false` | Allow skipping if requirements fail                      |
| `hint`          | string   | ❌       | —       | Hint shown when step cannot be completed                 |
| `formHint`      | string   | ❌       | —       | Hint shown when form validation fails (formfill only)    |
| `validateInput` | boolean  | ❌       | `false` | Require input to match `targetvalue` pattern             |
| `showMe`        | boolean  | ❌       | `true`  | Show the "Show me" button                                |
| `doIt`          | boolean  | ❌       | `true`  | Show the "Do it" button                                  |
| `completeEarly` | boolean  | ❌       | `false` | Mark step complete BEFORE action executes                |
| `verify`        | string   | ❌       | —       | Post-action verification (e.g., `"on-page:/path"`)       |

**Action Types:**

| Action      | Description          | `reftarget`             | `targetvalue` |
| ----------- | -------------------- | ----------------------- | ------------- |
| `highlight` | Highlight an element | CSS selector            | —             |
| `button`    | Click a button       | Button text or selector | —             |
| `formfill`  | Enter text in input  | CSS selector            | Text to enter |
| `navigate`  | Navigate to URL      | URL path                | —             |
| `hover`     | Hover over element   | CSS selector            | —             |

**Formfill Validation:**

By default, any non-empty input completes a `formfill` step. Use `validateInput: true` to require the input to match the `targetvalue` pattern:

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "input[data-testid='prometheus-url']",
  "targetvalue": "^https?://",
  "validateInput": true,
  "formHint": "URL must start with http:// or https://",
  "content": "Enter your Prometheus server URL."
}
```

**Regex Pattern Support:**

When `validateInput` is `true`, `targetvalue` is treated as a regex pattern if it:

- Starts with `^` or `$`, or
- Is enclosed in `/pattern/` syntax

| `targetvalue`          | Matches                                   |
| ---------------------- | ----------------------------------------- |
| `prometheus`           | Exact string "prometheus"                 |
| `^https?://`           | Strings starting with http:// or https:// |
| `/^[a-z]+$/`           | Lowercase letters only                    |
| `rate\\(.*\\[5m\\]\\)` | Pattern containing "rate(...[5m])"        |

**Button Visibility Control:**

Control which buttons appear for each step:

| Setting               | "Show me" Button | "Do it" Button | Use Case                      |
| --------------------- | ---------------- | -------------- | ----------------------------- |
| Default (both `true`) | ✅               | ✅             | Normal interactive step       |
| `doIt: false`         | ✅               | ❌             | Educational highlight only    |
| `showMe: false`       | ❌               | ✅             | Direct action without preview |
| Both `false`          | ❌               | ❌             | Auto-complete step (rare)     |

**Show-Only Example:**

Use `doIt: false` to create educational steps that only highlight elements without requiring user action. Perfect for guided tours and explanations.

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

When `doIt` is false:

- Only the "Show me" button appears (no "Do it" button)
- Step completes automatically after showing the element
- No state changes occur in the application
- Focus is on education rather than interaction

**Execution Control:**

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

| Field           | Description                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completeEarly` | Marks step as complete immediately when action starts (before completion). Useful for navigation where you want to continue the flow without waiting. |
| `verify`        | Post-action verification requirement. The step is only marked complete when this condition is met. Common: `"on-page:/path"`                          |

#### Section Block

Groups related interactive steps into a sequence with "Do Section" functionality.

```json
{
  "type": "section",
  "id": "explore-tour",
  "title": "Explore the Interface",
  "requirements": ["is-logged-in"],
  "objectives": ["completed-tour"],
  "blocks": [
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "...",
      "content": "First step..."
    },
    {
      "type": "interactive",
      "action": "highlight",
      "reftarget": "...",
      "content": "Second step..."
    }
  ]
}
```

| Field          | Type        | Required | Description                         |
| -------------- | ----------- | -------- | ----------------------------------- |
| `id`           | string      | ❌       | HTML id for the section             |
| `title`        | string      | ❌       | Section heading                     |
| `blocks`       | JsonBlock[] | ✅       | Nested blocks (usually interactive) |
| `requirements` | string[]    | ❌       | Section-level requirements          |
| `objectives`   | string[]    | ❌       | Objectives for the entire section   |

#### Conditional Block

Shows different content based on runtime condition evaluation. Conditions use the same syntax as requirements (e.g., `has-datasource:prometheus`, `is-admin`). When ALL conditions pass, the `whenTrue` branch is shown; otherwise, the `whenFalse` branch is shown.

```json
{
  "type": "conditional",
  "conditions": ["has-datasource:prometheus"],
  "description": "Show Prometheus-specific content or fallback",
  "whenTrue": [
    {
      "type": "markdown",
      "content": "Great! You have Prometheus configured. Let's write some PromQL queries."
    }
  ],
  "whenFalse": [
    {
      "type": "markdown",
      "content": "You'll need to set up a Prometheus data source first."
    },
    {
      "type": "interactive",
      "action": "navigate",
      "reftarget": "/connections/datasources/new",
      "content": "Click here to add a data source."
    }
  ]
}
```

| Field                    | Type                      | Required | Default    | Description                                                  |
| ------------------------ | ------------------------- | -------- | ---------- | ------------------------------------------------------------ |
| `conditions`             | string[]                  | ✅       | —          | Conditions to evaluate (uses requirement syntax)             |
| `whenTrue`               | JsonBlock[]               | ✅       | —          | Blocks shown when ALL conditions pass                        |
| `whenFalse`              | JsonBlock[]               | ✅       | —          | Blocks shown when ANY condition fails                        |
| `description`            | string                    | ❌       | —          | Author note (not shown to users)                             |
| `display`                | `"inline"` \| `"section"` | ❌       | `"inline"` | Display mode for the branch content                          |
| `whenTrueSectionConfig`  | ConditionalSectionConfig  | ❌       | —          | Section config for the pass branch (when display is section) |
| `whenFalseSectionConfig` | ConditionalSectionConfig  | ❌       | —          | Section config for the fail branch (when display is section) |

**Display Modes:**

| Mode      | Behavior                                                                 |
| --------- | ------------------------------------------------------------------------ |
| `inline`  | Content renders directly without wrapper (default)                       |
| `section` | Content wrapped with section styling, collapse controls, and "Do" button |

**Section Display Mode:**

When `display` is `"section"`, each branch can have its own section configuration:

```json
{
  "type": "conditional",
  "conditions": ["has-datasource:loki"],
  "display": "section",
  "whenTrueSectionConfig": {
    "title": "Explore your logs",
    "objectives": ["viewed-logs"]
  },
  "whenFalseSectionConfig": {
    "title": "Set up Loki",
    "requirements": ["is-admin"]
  },
  "whenTrue": [
    {
      "type": "interactive",
      "action": "navigate",
      "reftarget": "/explore",
      "content": "Open Explore to query your logs."
    }
  ],
  "whenFalse": [
    {
      "type": "markdown",
      "content": "You need to configure Loki before exploring logs."
    }
  ]
}
```

**ConditionalSectionConfig:**

| Field          | Type     | Description                       |
| -------------- | -------- | --------------------------------- |
| `title`        | string   | Section title for this branch     |
| `requirements` | string[] | Requirements that must be met     |
| `objectives`   | string[] | Objectives tracked for completion |

**Multiple Conditions:**

All conditions must pass for `whenTrue` to be shown:

```json
{
  "type": "conditional",
  "conditions": ["has-datasource:prometheus", "has-feature:alerting", "is-editor"],
  "whenTrue": [
    {
      "type": "markdown",
      "content": "You're ready to create Prometheus alerting rules!"
    }
  ],
  "whenFalse": [
    {
      "type": "markdown",
      "content": "You need Prometheus, alerting enabled, and editor permissions."
    }
  ]
}
```

#### Multistep Block

Executes multiple actions **automatically** when user clicks "Do it".

```json
{
  "type": "multistep",
  "content": "This will automatically navigate to Explore and open the query editor.",
  "requirements": ["navmenu-open"],
  "skippable": true,
  "steps": [
    {
      "action": "button",
      "reftarget": "a[href='/explore']",
      "tooltip": "Navigating to Explore..."
    },
    {
      "action": "highlight",
      "reftarget": "[data-testid='query-editor']",
      "tooltip": "This is the query editor!"
    }
  ]
}
```

| Field          | Type       | Required | Description                       |
| -------------- | ---------- | -------- | --------------------------------- |
| `content`      | string     | ✅       | Description shown to user         |
| `steps`        | JsonStep[] | ✅       | Sequence of steps to execute      |
| `requirements` | string[]   | ❌       | Requirements for the entire block |
| `objectives`   | string[]   | ❌       | Objectives tracked                |
| `skippable`    | boolean    | ❌       | Allow skipping                    |

#### Guided Block

Highlights elements and **waits for user** to perform actions.

```json
{
  "type": "guided",
  "content": "Follow along by clicking each highlighted element.",
  "stepTimeout": 30000,
  "completeEarly": true,
  "requirements": ["navmenu-open"],
  "steps": [
    {
      "action": "highlight",
      "reftarget": "a[href='/dashboards']",
      "tooltip": "Click Dashboards to continue..."
    },
    {
      "action": "highlight",
      "reftarget": "button[aria-label='New dashboard']",
      "tooltip": "Now click New to create a dashboard"
    }
  ]
}
```

| Field           | Type       | Required | Description                              |
| --------------- | ---------- | -------- | ---------------------------------------- |
| `content`       | string     | ✅       | Description shown to user                |
| `steps`         | JsonStep[] | ✅       | Sequence of steps for user to perform    |
| `stepTimeout`   | number     | ❌       | Timeout per step in ms (default: 30000)  |
| `completeEarly` | boolean    | ❌       | Complete when user performs action early |
| `requirements`  | string[]   | ❌       | Requirements for the block               |
| `objectives`    | string[]   | ❌       | Objectives tracked                       |
| `skippable`     | boolean    | ❌       | Allow skipping                           |

#### Quiz Block

Knowledge assessment with single or multiple choice questions.

```json
{
  "type": "quiz",
  "question": "Which query language does Prometheus use?",
  "completionMode": "correct-only",
  "choices": [
    { "id": "a", "text": "SQL", "hint": "SQL is used by traditional databases, not Prometheus." },
    { "id": "b", "text": "PromQL", "correct": true },
    { "id": "c", "text": "GraphQL", "hint": "GraphQL is an API query language, not for metrics." },
    { "id": "d", "text": "LogQL", "hint": "LogQL is for Loki logs, not Prometheus metrics." }
  ]
}
```

| Field            | Type         | Required | Default          | Description                                     |
| ---------------- | ------------ | -------- | ---------------- | ----------------------------------------------- |
| `question`       | string       | ✅       | —                | Question text (supports markdown)               |
| `choices`        | QuizChoice[] | ✅       | —                | Answer choices (see below)                      |
| `multiSelect`    | boolean      | ❌       | `false`          | Allow multiple answers (checkboxes vs radio)    |
| `completionMode` | string       | ❌       | `"correct-only"` | `"correct-only"` or `"max-attempts"`            |
| `maxAttempts`    | number       | ❌       | `3`              | Attempts before revealing answer (max-attempts) |
| `requirements`   | string[]     | ❌       | —                | Requirements for this quiz                      |
| `skippable`      | boolean      | ❌       | `false`          | Allow skipping                                  |

**Choice Structure:**

| Field     | Type    | Required | Description                                   |
| --------- | ------- | -------- | --------------------------------------------- |
| `id`      | string  | ✅       | Choice identifier (e.g., "a", "b", "c")       |
| `text`    | string  | ✅       | Choice text (supports markdown)               |
| `correct` | boolean | ❌       | Is this a correct answer?                     |
| `hint`    | string  | ❌       | Hint shown when this wrong choice is selected |

**Completion Modes:**

| Mode           | Behavior                                                |
| -------------- | ------------------------------------------------------- |
| `correct-only` | Quiz completes only when user selects correct answer(s) |
| `max-attempts` | After `maxAttempts` wrong tries, reveals correct answer |

**Multi-Select Example:**

```json
{
  "type": "quiz",
  "question": "Which of these are valid Grafana data sources? (Select all that apply)",
  "multiSelect": true,
  "choices": [
    { "id": "a", "text": "Prometheus", "correct": true },
    { "id": "b", "text": "Microsoft Word", "hint": "Word is not a data source!" },
    { "id": "c", "text": "Loki", "correct": true },
    { "id": "d", "text": "InfluxDB", "correct": true }
  ]
}
```

**Blocking Behavior:**

When a quiz is inside a section, subsequent steps automatically show "Complete previous step" until the quiz is completed. This enforces learning progression.

#### Input Block

Collects user responses that can be stored as variables and used elsewhere in the guide. Variables can be referenced in content using `{{variableName}}` syntax or checked as requirements using `var-variableName:value` syntax.

```json
{
  "type": "input",
  "prompt": "What is the name of your Prometheus data source?",
  "inputType": "text",
  "variableName": "prometheusName",
  "placeholder": "e.g., prometheus-main",
  "required": true,
  "pattern": "^[a-zA-Z][a-zA-Z0-9-]*$",
  "validationMessage": "Name must start with a letter and contain only letters, numbers, and dashes"
}
```

| Field               | Type                    | Required | Default | Description                                            |
| ------------------- | ----------------------- | -------- | ------- | ------------------------------------------------------ |
| `prompt`            | string                  | ✅       | —       | Question/instruction shown to user (supports markdown) |
| `inputType`         | `"text"` \| `"boolean"` | ✅       | —       | Input type: text field or checkbox                     |
| `variableName`      | string                  | ✅       | —       | Identifier for storing/referencing the response        |
| `placeholder`       | string                  | ❌       | —       | Placeholder text for text input                        |
| `checkboxLabel`     | string                  | ❌       | —       | Label for boolean checkbox                             |
| `defaultValue`      | string \| boolean       | ❌       | —       | Default value for the input                            |
| `required`          | boolean                 | ❌       | `false` | Whether a response is required to proceed              |
| `pattern`           | string                  | ❌       | —       | Regex pattern for text validation                      |
| `validationMessage` | string                  | ❌       | —       | Custom message shown when validation fails             |
| `requirements`      | string[]                | ❌       | —       | Requirements that must be met for this input           |
| `skippable`         | boolean                 | ❌       | `false` | Whether this input can be skipped                      |

**Text Input Example:**

```json
{
  "type": "input",
  "prompt": "Enter the URL of your Prometheus server:",
  "inputType": "text",
  "variableName": "prometheusUrl",
  "placeholder": "http://localhost:9090",
  "required": true,
  "pattern": "^https?://",
  "validationMessage": "URL must start with http:// or https://"
}
```

**Boolean (Checkbox) Example:**

```json
{
  "type": "input",
  "prompt": "Before continuing, please confirm you understand the requirements.",
  "inputType": "boolean",
  "variableName": "policyAccepted",
  "checkboxLabel": "I understand and accept the terms",
  "required": true
}
```

**Using Variables:**

Once a response is collected, it can be used in two ways:

1. **In content** — Use `{{variableName}}` syntax for dynamic text:

```json
{
  "type": "markdown",
  "content": "Your data source **{{prometheusName}}** is now configured at `{{prometheusUrl}}`."
}
```

2. **In requirements** — Use `var-variableName:value` to gate content:

```json
{
  "type": "section",
  "title": "Advanced configuration",
  "requirements": ["var-policyAccepted:true"],
  "blocks": [...]
}
```

See the [Variable Substitution](#variable-substitution) section for more details.

#### Assistant Block

Wraps child blocks with AI-powered customization capabilities. Each child block gets a "Customize" button that uses Grafana Assistant to adapt content to the user's actual environment (datasources, metrics, etc.).

````json
{
  "type": "assistant",
  "assistantId": "prom-queries",
  "assistantType": "query",
  "blocks": [
    {
      "type": "markdown",
      "content": "Here's a sample PromQL query:\n\n```promql\nrate(http_requests_total[5m])\n```"
    },
    {
      "type": "interactive",
      "action": "formfill",
      "reftarget": "textarea[data-testid='query-editor']",
      "targetvalue": "rate(http_requests_total[5m])",
      "content": "Enter this query in the editor."
    }
  ]
}
````

| Field           | Type                                            | Required | Description                                                            |
| --------------- | ----------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `assistantId`   | string                                          | ❌       | Unique ID prefix for wrapped elements (auto-generated if not provided) |
| `assistantType` | `"query"` \| `"config"` \| `"code"` \| `"text"` | ❌       | Type of content - affects AI prompts and customization behavior        |
| `blocks`        | JsonBlock[]                                     | ✅       | Child blocks to wrap with assistant functionality                      |

**Assistant Types:**

| Type     | Use Case                                       |
| -------- | ---------------------------------------------- |
| `query`  | PromQL, LogQL, or other query language content |
| `config` | Configuration snippets (YAML, JSON, etc.)      |
| `code`   | Code examples that may need adaptation         |
| `text`   | General text content                           |

**AssistantProps on Individual Blocks:**

Instead of using a wrapper block, you can enable AI customization directly on `markdown` and `interactive` blocks:

````json
{
  "type": "markdown",
  "content": "Try this query:\n\n```promql\nsum(rate(http_requests_total[5m])) by (status_code)\n```",
  "assistantEnabled": true,
  "assistantId": "http-query-example",
  "assistantType": "query"
}
````

| Field              | Type                                            | Description                                                             |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `assistantEnabled` | boolean                                         | Enable AI customization for this block                                  |
| `assistantId`      | string                                          | Unique ID for localStorage persistence (auto-generated if not provided) |
| `assistantType`    | `"query"` \| `"config"` \| `"code"` \| `"text"` | Type of content for AI prompts                                          |

When `assistantEnabled` is `true`, the block displays a "Customize" button that invokes Grafana Assistant to adapt the content based on the user's configured datasources and environment.

---

### Block Types Summary

| Block Type    | Category    | Description                                                       |
| ------------- | ----------- | ----------------------------------------------------------------- |
| `markdown`    | Content     | Formatted text with headings, lists, code, tables                 |
| `html`        | Content     | Raw HTML for migration/custom content                             |
| `image`       | Content     | Embedded images with optional dimensions                          |
| `video`       | Content     | YouTube or native HTML5 video embeds                              |
| `section`     | Structure   | Container for grouped interactive steps with "Do Section"         |
| `conditional` | Structure   | Shows different content based on runtime conditions               |
| `assistant`   | Structure   | Wraps blocks with AI-powered customization                        |
| `interactive` | Interactive | Single-action step (highlight, button, formfill, navigate, hover) |
| `multistep`   | Interactive | Automated sequence of actions                                     |
| `guided`      | Interactive | User-performed sequence with detection                            |
| `quiz`        | Assessment  | Knowledge check with single/multiple choice                       |
| `input`       | Assessment  | Collects user responses as variables                              |

---

### Step Structure

Steps used in `multistep` and `guided` blocks share this structure:

```json
{
  "action": "highlight",
  "reftarget": "selector",
  "targetvalue": "value for formfill",
  "requirements": ["step-requirement"],
  "tooltip": "Tooltip shown during multistep execution",
  "description": "Description shown in guided steps panel",
  "skippable": true,
  "formHint": "Hint for formfill validation",
  "validateInput": false
}
```

| Field           | Type     | Required | Default | Description                                                         |
| --------------- | -------- | -------- | ------- | ------------------------------------------------------------------- |
| `action`        | string   | ✅       | —       | Action type: `highlight`, `button`, `formfill`, `navigate`, `hover` |
| `reftarget`     | string   | ✅       | —       | CSS selector or button text                                         |
| `targetvalue`   | string   | ❌       | —       | Value for `formfill` actions (supports regex patterns)              |
| `requirements`  | string[] | ❌       | —       | Requirements for this specific step                                 |
| `tooltip`       | string   | ❌       | —       | Tooltip shown during multistep execution                            |
| `description`   | string   | ❌       | —       | Description shown in guided steps panel                             |
| `skippable`     | boolean  | ❌       | `false` | Whether this step can be skipped (guided only)                      |
| `formHint`      | string   | ❌       | —       | Hint shown when form validation fails                               |
| `validateInput` | boolean  | ❌       | `false` | Require input to match `targetvalue` pattern                        |

**Note:** The `tooltip` property is primarily used in `multistep` blocks (shown during automated execution), while `description` is used in `guided` blocks (shown in the steps panel as instructions for the user).

---

## Requirements

Requirements control when interactive elements are accessible. Common requirements:

| Requirement        | Description                      |
| ------------------ | -------------------------------- |
| `navmenu-open`     | Navigation menu must be open     |
| `is-admin`         | User must have admin role        |
| `is-logged-in`     | User must be authenticated       |
| `exists-reftarget` | Target element must exist in DOM |
| `on-page:/path`    | User must be on specific page    |

See [requirements-reference.md](./requirements-reference.md) for the complete list.

---

## Variable Substitution

Variables collected by [Input blocks](#input-block) can be used throughout the guide in two ways:

### Content Substitution

Use `{{variableName}}` syntax to insert variable values into any content string:

```json
{
  "type": "markdown",
  "content": "Your data source **{{datasourceName}}** is configured at `{{datasourceUrl}}`."
}
```

If the variable is not set, `[not set]` is displayed as a fallback.

### Variable Requirements

Use the `var-` prefix in requirements to gate content based on user responses:

```json
{
  "type": "section",
  "title": "Advanced configuration",
  "requirements": ["var-termsAccepted:true"],
  "blocks": [...]
}
```

**Syntax:** `var-{variableName}:{expectedValue}`

| Example                         | Description                           |
| ------------------------------- | ------------------------------------- |
| `var-termsAccepted:true`        | Boolean variable must be `true`       |
| `var-experienceLevel:advanced`  | Text variable must equal `"advanced"` |
| `var-datasourceName:prometheus` | Variable must match specific value    |

### Complete Variable Flow Example

```json
{
  "id": "custom-datasource-guide",
  "title": "Configure your data source",
  "blocks": [
    {
      "type": "input",
      "prompt": "What would you like to name your data source?",
      "inputType": "text",
      "variableName": "dsName",
      "placeholder": "e.g., my-prometheus",
      "required": true
    },
    {
      "type": "input",
      "prompt": "I confirm this data source will be used for production monitoring.",
      "inputType": "boolean",
      "variableName": "isProd",
      "checkboxLabel": "Yes, this is for production"
    },
    {
      "type": "markdown",
      "content": "## Setting up {{dsName}}\n\nLet's configure your new data source."
    },
    {
      "type": "section",
      "title": "Production hardening",
      "requirements": ["var-isProd:true"],
      "blocks": [
        {
          "type": "markdown",
          "content": "Since **{{dsName}}** is for production, let's enable high availability settings."
        }
      ]
    }
  ]
}
```

---

## Complete Example

```json
{
  "id": "dashboard-basics",
  "title": "Dashboard Basics",
  "blocks": [
    {
      "type": "markdown",
      "content": "# Getting Started with Dashboards\n\nIn this guide, you'll learn how to navigate to the dashboards section and create your first dashboard."
    },
    {
      "type": "section",
      "id": "navigation",
      "title": "Navigate to Dashboards",
      "blocks": [
        {
          "type": "interactive",
          "action": "highlight",
          "reftarget": "a[data-testid='data-testid Nav menu item'][href='/dashboards']",
          "requirements": ["navmenu-open"],
          "content": "First, let's find the **Dashboards** section in the navigation menu.",
          "tooltip": "Dashboards contain your visualizations and panels."
        },
        {
          "type": "interactive",
          "action": "button",
          "reftarget": "New",
          "requirements": ["on-page:/dashboards", "exists-reftarget"],
          "skippable": true,
          "content": "Click **New** to start creating a dashboard."
        }
      ]
    },
    {
      "type": "markdown",
      "content": "## Congratulations!\n\nYou've learned the basics of dashboard navigation. Next, try adding panels to your dashboard."
    }
  ]
}
```

---

## Bundling a JSON Guide

To add a JSON guide to the plugin:

1. Create your `.json` file in `src/bundled-interactives/`
2. Add an entry to `src/bundled-interactives/index.json`:

```json
{
  "id": "my-guide",
  "title": "My Guide Title",
  "summary": "A brief description of what this guide covers.",
  "filename": "my-guide.json",
  "url": ["/"],
  "targetPlatform": "oss"
}
```

| Field            | Required | Description                                  |
| ---------------- | -------- | -------------------------------------------- |
| `id`             | ✅       | Unique identifier, matches `bundled:id` URL  |
| `title`          | ✅       | Display title in the guide list              |
| `summary`        | ✅       | Brief description shown in the guide list    |
| `filename`       | ✅       | JSON filename in `src/bundled-interactives/` |
| `url`            | ❌       | URL patterns where this guide is recommended |
| `targetPlatform` | ❌       | `"oss"` or `"cloud"` to filter by platform   |

The guide will appear in the homepage list and can be opened via `bundled:my-guide`.

---

## TypeScript Types

All types are exported from `src/types/json-guide.types.ts`:

```typescript
import {
  // Root structure
  JsonGuide,
  JsonMatchMetadata,

  // Block union
  JsonBlock,

  // Content blocks
  JsonMarkdownBlock,
  JsonHtmlBlock,
  JsonImageBlock,
  JsonVideoBlock,

  // Structural blocks
  JsonSectionBlock,
  JsonConditionalBlock,
  ConditionalDisplayMode,
  ConditionalSectionConfig,
  JsonAssistantBlock,
  AssistantProps,

  // Interactive blocks
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonInteractiveAction,
  JsonStep,

  // Assessment blocks
  JsonQuizBlock,
  JsonQuizChoice,
  JsonInputBlock,
} from '../types/json-guide.types';
```

Type guards are also available:

```typescript
import {
  isMarkdownBlock,
  isHtmlBlock,
  isImageBlock,
  isVideoBlock,
  isSectionBlock,
  isConditionalBlock,
  isAssistantBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isQuizBlock,
  isInputBlock,
  hasAssistantEnabled,
} from '../types/json-guide.types';
```

**Zod Schemas:**

Runtime validation schemas are available in `src/types/json-guide.schema.ts`:

```typescript
import {
  JsonGuideSchema,
  JsonGuideSchemaStrict,
  JsonBlockSchema,
  CURRENT_SCHEMA_VERSION,
} from '../types/json-guide.schema';
```
