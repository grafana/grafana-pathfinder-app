# JSON Guide Format Reference

This document provides a comprehensive reference for the JSON guide format used to create interactive tutorials in Grafana Pathfinder.

## Overview

JSON guides are structured documents that combine content blocks (markdown, HTML, images, video) with interactive elements (highlight, button clicks, form fills) to create guided learning experiences.

### Why JSON?

- **Type-safe**: Strong TypeScript definitions catch errors at build time
- **Structured**: Block-based format is easier to parse, validate, and transform
- **Tooling-friendly**: Better support for editors, linters, and code generation
- **Extensible**: Block-based format supports content, interactive, and assessment blocks

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
- Best used for embedding rich static HTML content
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

| Field      | Type                                   | Required | Description                       |
| ---------- | -------------------------------------- | -------- | --------------------------------- |
| `src`      | string                                 | ✅       | Video URL (embed URL for YouTube) |
| `provider` | `"youtube"` \| `"native"` \| `"vimeo"` | ❌       | Video provider hint               |
| `title`    | string                                 | ❌       | Video title for accessibility     |
| `start`    | number                                 | ❌       | Start time in seconds             |
| `end`      | number                                 | ❌       | End time in seconds               |

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

| Field             | Type     | Required | Default             | Description                                                        |
| ----------------- | -------- | -------- | ------------------- | ------------------------------------------------------------------ |
| `action`          | string   | ✅       | —                   | Action type (see below)                                            |
| `reftarget`       | string   | ✅\*     | —                   | CSS selector or button text (\*optional for `noop` actions)        |
| `content`         | string   | ✅       | —                   | Markdown description shown to user                                 |
| `targetvalue`     | string   | ❌       | —                   | Value for `formfill` actions (supports regex, see below)           |
| `targetstate`     | string   | ❌       | —                   | Desired end state for a toggle target (see below)                  |
| `tooltip`         | string   | ❌       | —                   | Tooltip shown on highlight (supports markdown)                     |
| `requirements`    | string[] | ❌       | —                   | Conditions that must be met                                        |
| `objectives`      | string[] | ❌       | —                   | Objectives marked complete after this step                         |
| `skippable`       | boolean  | ❌       | `false`             | Allow skipping if requirements fail                                |
| `hint`            | string   | ❌       | —                   | Hint shown when step cannot be completed                           |
| `formHint`        | string   | ❌       | —                   | Hint shown when form validation fails (formfill only)              |
| `validateInput`   | boolean  | ❌       | `false`             | Require input to match `targetvalue` pattern                       |
| `showMe`          | boolean  | ❌       | `true`              | Show the "Show me" button                                          |
| `doIt`            | boolean  | ❌       | `true`              | Show the "Do it" button                                            |
| `completeEarly`   | boolean  | ❌       | `false`             | Mark step complete BEFORE action executes                          |
| `verify`          | string   | ❌       | —                   | Post-action verification (e.g., `"on-page:/path"`)                 |
| `lazyRender`      | boolean  | ❌       | `false`             | Enable progressive scroll discovery for virtualized containers     |
| `scrollContainer` | string   | ❌       | `".scrollbar-view"` | CSS selector for the scroll container when `lazyRender` is enabled |

**Action Types:**

| Action      | Description                    | `reftarget`             | `targetvalue`                          | `targetstate` |
| ----------- | ------------------------------ | ----------------------- | -------------------------------------- | ------------- |
| `highlight` | Highlight an element           | CSS selector            | —                                      | ✅            |
| `button`    | Click a button                 | Button text or selector | —                                      | ✅            |
| `formfill`  | Enter text in input            | CSS selector            | Text to enter                          | —             |
| `navigate`  | Navigate to URL                | URL path                | —                                      | —             |
| `hover`     | Hover over element             | CSS selector            | —                                      | —             |
| `noop`      | Informational step (no action) | Optional                | —                                      | —             |
| `popout`    | Dock or undock the docs panel  | —                       | `"floating"` or `"sidebar"` (required) | —             |

**Toggle targets — `targetstate`:**

Without `targetstate`, a step clicks its target unconditionally. For anything with
toggle semantics that is a trap: the step's effect depends on where the user left
the UI. Clicking Grafana's dashboard **+ New** button when the drawer is already
open _closes_ it, taking the next step's target out of the DOM with it.

`targetstate` declares the state you want instead of the click you want. The step
reads the control, clicks only if the state differs, then re-reads to confirm — so
it is safe to re-run and converges from either starting state.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "button[data-testid='data-testid Dashboard Sidebar new button']",
  "targetstate": "true",
  "content": "Open the edit sidebar."
}
```

`"true"` / `"false"` auto-detects the control's state signal, probing `checked`,
`aria-pressed`, `aria-expanded`, `aria-checked`, `aria-selected`, and finally an
`aria-label` that names the action ("Collapse …" means already expanded). If the
step targets a wrapper, it descends to the control that actually holds the state —
necessary for Grafana's `Switch`, where the stable `data-testid` sits on a wrapper
whose click does nothing.

A bare `true` / `false` is accepted too and means the same thing — validation
coerces it to the string form. The stored value is always a string, because the
backend `InteractiveGuide` CRD cannot model a field that is boolean-or-string
(the generated Kubernetes schema would be invalid), and a raw boolean sent to
that API is rejected. Prefer `"true"` when writing guides by hand so the file
matches what round-trips.

When a control carries its state somewhere else, name the attribute:

```json
{ "targetstate": "data-state:open" }
```

Naming an attribute also changes _where_ the state is read. The step looks for
that attribute on the element you selected first, then on its descendants —
rather than descending to the nearest checkbox or ARIA toggle, which is what the
`true`/`false` form does. That matters because the named-attribute form exists
for controls with no standard signal, so the element you point at usually is not
one the auto-detector would recognise. The click still lands on the interactive
control, which is not always the element carrying the attribute.

A step with `targetstate` never blocks. Requirements are unaffected — the
control exists in both states, so `exists-reftarget` still passes and "Do it"
stays enabled. Pressing it when the control is already in the requested state
does nothing and marks the step complete, so the user always moves on. Two
cases warn rather than fail:

- the control exposes no readable state → clicks unconditionally, i.e. exactly
  today's behaviour
- the click ran but the state did not change → completes, leaving the user free
  to set it by hand

So adding `targetstate` can never make a working step worse, and can never
strand someone mid-guide.

When there is nothing to change, the comment box says so — "Already in the right
position — nothing to change." is prepended above your own comment, so the guide
never instructs someone to flip a control that is already correct. This applies
to "Show me", to each step of a multistep, and to guided steps, which complete
straight away rather than waiting for a click that would undo the state.

Note that `targetstate` does not auto-complete a top-level step on arrival — the
user still presses "Do it", it just does nothing. Auto-completing an
already-satisfied step is what `objectives` is for.

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

#### Collapsible Block

Hides its nested blocks behind a toggle. Use it to gate solutions or example outputs so learners attempt an exercise before revealing the answer. Unlike a section, it is purely presentational and tracks no completion state.

````json
{
  "type": "collapsible",
  "title": "Show solution",
  "collapsed": true,
  "blocks": [
    {
      "type": "markdown",
      "content": "Here's one approach:\n\n```logql\n{app=\"foo\"} |= \"error\" | json\n```"
    }
  ]
}
````

| Field       | Type                | Required | Description                                         |
| ----------- | ------------------- | -------- | --------------------------------------------------- |
| `id`        | string              | ❌       | HTML id for the collapsible (usable as a deep-link) |
| `title`     | string              | ❌       | Label shown on the toggle (defaults to "Show more") |
| `collapsed` | boolean             | ❌       | Whether it starts collapsed (defaults to `true`)    |
| `blocks`    | content block array | ✅       | Content hidden behind the toggle                    |

> A collapsible is presentational: it accepts content blocks only — `markdown` (including fenced code), `html`, `image`, and `video`. Interactive steps and containers (`section`, `collapsible`, `conditional`) are rejected, so a collapsible never carries completion state. To gate interactive steps, use a `section`.

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

Individual steps accept `targetstate` too, and a sequence is where toggles bite
hardest — one blind click part-way through can remove the target the next step
needs:

```json
{
  "type": "multistep",
  "content": "Open the edit sidebar and add a panel.",
  "steps": [
    {
      "action": "highlight",
      "reftarget": "button[data-testid='data-testid Dashboard Sidebar new button']",
      "targetstate": "true"
    },
    {
      "action": "highlight",
      "reftarget": "div[data-testid='data-testid sidebar add new panel']"
    }
  ]
}
```

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

Steps accept `targetstate` here too, with the meaning adjusted for a step the
user performs: a control already in the requested state completes immediately
instead of asking the user to click it. Without that, the guide would tell
someone to click a toggle that is already correct, and their click would move it
the wrong way.

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

| Field            | Type         | Required | Default          | Description                                                                 |
| ---------------- | ------------ | -------- | ---------------- | --------------------------------------------------------------------------- |
| `question`       | string       | ✅       | —                | Question text (supports markdown)                                           |
| `choices`        | QuizChoice[] | ✅       | —                | Answer choices (see below)                                                  |
| `multiSelect`    | boolean      | ❌       | `false`          | Allow multiple answers (checkboxes vs radio)                                |
| `completionMode` | string       | ❌       | `"correct-only"` | `"correct-only"` or `"max-attempts"`                                        |
| `maxAttempts`    | number       | ❌       | `3`              | Attempts before revealing answer (max-attempts)                             |
| `requirements`   | string[]     | ❌       | —                | Requirements for this quiz                                                  |
| `skippable`      | boolean      | ❌       | `false`          | Allow skipping                                                              |
| `shuffle`        | boolean      | ❌       | `true`           | Randomize choice display order. Set to `false` to render in authored order. |

**Choice Structure:**

| Field     | Type    | Required | Description                                                                                                             |
| --------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`      | string  | ✅       | Choice identifier (e.g., "a", "b", "c")                                                                                 |
| `text`    | string  | ✅       | Choice text (supports markdown)                                                                                         |
| `correct` | boolean | ❌       | Is this a correct answer?                                                                                               |
| `hint`    | string  | ❌       | Hint shown when this wrong choice is selected                                                                           |
| `pinned`  | boolean | ❌       | When the quiz is shuffled, keep this choice at its authored index. Useful for "All of the above" / "None of the above". |

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

**Shuffle and Pinned Choices:**

By default, quiz choices are shuffled on each view to prevent learners from memorizing answer positions. Authors can opt out at the block level, or pin individual choices to their authored index — useful for "All of the above" / "None of the above" answers that must stay in a specific slot.

```json
{
  "type": "quiz",
  "question": "Which Grafana data source uses PromQL?",
  "choices": [
    { "id": "a", "text": "Loki" },
    { "id": "b", "text": "Prometheus", "correct": true },
    { "id": "c", "text": "Tempo" },
    { "id": "d", "text": "All of the above", "pinned": true, "hint": "Only one is correct." }
  ]
}
```

To preserve the authored order across all renders (e.g., when ordering matters pedagogically), set `shuffle: false`:

```json
{
  "type": "quiz",
  "question": "Order matters here — pick the lowest tier.",
  "shuffle": false,
  "choices": [
    { "id": "a", "text": "Free", "correct": true },
    { "id": "b", "text": "Pro" },
    { "id": "c", "text": "Advanced" },
    { "id": "d", "text": "Enterprise" }
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

| Field               | Type                                      | Required | Default | Description                                                                          |
| ------------------- | ----------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------ |
| `prompt`            | string                                    | ✅       | —       | Question/instruction shown to user (supports markdown)                               |
| `inputType`         | `"text"` \| `"boolean"` \| `"datasource"` | ✅       | —       | Input type: text field, checkbox, or datasource picker                               |
| `variableName`      | string                                    | ✅       | —       | Identifier for storing/referencing the response                                      |
| `placeholder`       | string                                    | ❌       | —       | Placeholder text for text input                                                      |
| `checkboxLabel`     | string                                    | ❌       | —       | Label for boolean checkbox                                                           |
| `defaultValue`      | string \| boolean                         | ❌       | —       | Default value for the input                                                          |
| `required`          | boolean                                   | ❌       | `false` | Whether a response is required to proceed                                            |
| `pattern`           | string                                    | ❌       | —       | Regex pattern for text validation                                                    |
| `validationMessage` | string                                    | ❌       | —       | Custom message shown when validation fails                                           |
| `datasourceFilter`  | string                                    | ❌       | —       | Filter datasources by type (e.g., `"prometheus"`). Only for `"datasource"` inputType |
| `requirements`      | string[]                                  | ❌       | —       | Requirements that must be met for this input                                         |
| `skippable`         | boolean                                   | ❌       | `false` | Whether this input can be skipped                                                    |

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

**Datasource Picker Example:**

```json
{
  "type": "input",
  "prompt": "Select the Prometheus data source you want to use for this guide:",
  "inputType": "datasource",
  "variableName": "selectedDatasource",
  "datasourceFilter": "prometheus",
  "required": true
}
```

When `inputType` is `"datasource"`, the block renders a datasource picker dropdown. The `datasourceFilter` property limits the list to datasources of a specific type.

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

#### Code Block

A code snippet with copy-to-clipboard and (in supported contexts) an Insert button that types the code into a Grafana Monaco editor.

```json
{
  "type": "code-block",
  "content": "Try this PromQL query:",
  "code": "rate(http_requests_total[5m])",
  "language": "promql",
  "reftarget": "textarea.inputarea"
}
```

| Field          | Type     | Required | Description                                                            |
| -------------- | -------- | -------- | ---------------------------------------------------------------------- |
| `content`      | string   | ❌       | Markdown description shown above the code block                        |
| `code`         | string   | ✅       | The code snippet                                                       |
| `language`     | string   | ❌       | Syntax highlighting language (e.g., `promql`, `logql`, `yaml`, `json`) |
| `reftarget`    | string   | ✅       | Verified CSS selector of the target Monaco editor                      |
| `requirements` | string[] | ❌       | Conditions that must be met for this step                              |
| `objectives`   | string[] | ❌       | Objectives marked complete after this step                             |
| `skippable`    | boolean  | ❌       | Allow skipping                                                         |

#### Terminal Block

A shell command shown with copy-to-clipboard and an "Execute" button that runs the command in the Coda terminal panel.

```json
{
  "type": "terminal",
  "content": "Install nginx:",
  "command": "sudo apt-get install -y nginx"
}
```

| Field          | Type     | Required | Description                                                 |
| -------------- | -------- | -------- | ----------------------------------------------------------- |
| `content`      | string   | ✅       | Markdown description shown above the command                |
| `command`      | string   | ✅       | The shell command                                           |
| `requirements` | string[] | ❌       | Conditions that must be met (commonly `is-terminal-active`) |
| `skippable`    | boolean  | ❌       | Allow skipping                                              |

Terminal blocks only render in the docs panel when the administrator has enabled the Coda terminal integration.

#### Terminal Connect Block

A button that provisions a sandbox VM (via Coda) and opens a terminal panel inside the docs panel.

```json
{
  "type": "terminal-connect",
  "content": "Connect to an nginx sandbox to follow along:",
  "buttonText": "Connect to nginx sandbox",
  "vmTemplate": "vm-aws-sample-app",
  "vmApp": "nginx"
}
```

| Field        | Type   | Default             | Description                                               |
| ------------ | ------ | ------------------- | --------------------------------------------------------- |
| `content`    | string | —                   | Markdown description shown above the button               |
| `buttonText` | string | `"Try in terminal"` | Button label                                              |
| `vmTemplate` | string | `""` (→ `vm-aws`)   | VM template to provision                                  |
| `vmApp`      | string | `""`                | App name for `vm-aws-sample-app`                          |
| `vmScenario` | string | `""`                | Scenario ID for `vm-aws-alloy-scenario` (may contain `/`) |

See [`CODA.md`](../CODA.md) for the full VM template catalog and lifecycle details.

#### Grot Guide block

A choose-your-own-adventure decision tree where each screen offers options that branch to other screens.

```json
{
  "type": "grot-guide",
  "id": "intro-tree",
  "welcome": {
    "title": "Choose your path",
    "body": "Pick the path that best matches your goal.",
    "ctas": [{ "text": "Start", "screenId": "start" }]
  },
  "screens": [
    {
      "type": "question",
      "id": "start",
      "title": "What do you want to do?",
      "options": [
        { "text": "Set up Prometheus", "screenId": "prometheus" },
        { "text": "Set up Loki", "screenId": "loki" }
      ]
    },
    {
      "type": "result",
      "id": "prometheus",
      "title": "Set up Prometheus",
      "body": "Open the connections page to add a Prometheus data source.",
      "links": []
    },
    {
      "type": "result",
      "id": "loki",
      "title": "Set up Loki",
      "body": "Open the connections page to add a Loki data source.",
      "links": []
    }
  ]
}
```

| Field     | Type                | Required | Description                       |
| --------- | ------------------- | -------- | --------------------------------- |
| `id`      | string              | ❌       | Block ID                          |
| `welcome` | `GrotGuideWelcome`  | ✅       | Welcome copy and entry-point CTAs |
| `screens` | `GrotGuideScreen[]` | ✅       | Question and result screens       |

Welcome CTAs and question options use `{ "text", "screenId" }`; every `screenId` must resolve to a screen. A question screen has `type: "question"` and an `options` array. A result screen has `type: "result"`, markdown `body`, and optional links. The block editor includes a YAML import flow for converting Grot Guide YAML directly into JSON.

#### Challenge block

A capture-the-flag style task: a title, a markdown brief, optional progressive hints, and a "Check my work" button that evaluates a single requirement token. The `mode` field picks the execution model, and most of the other fields follow from it.

| Mode         | Behavior                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"standard"` | Runs against the learner's own Grafana. Nothing is provisioned, and the brief and "Check my work" are available immediately. `successCriteria` is any Pathfinder requirement, such as `has-datasource:prometheus`. |
| `"coda"`     | Provisions a Coda VM with a terminal, runs the setup script, then reveals "Check my work". `successCriteria` is typically `coda-exit-zero:<command>`.                                                              |

`mode` is optional, and it resolves to a different value depending on how the block reaches you:

- **Omitted in JSON** — the runtime treats the block as `"coda"`. Challenges predate `"standard"`, so an existing guide with no `mode` keeps its original Coda behavior.
- **Created in the block editor** — the challenge form writes `mode` explicitly and seeds a brand-new block with `"standard"`, the cheaper authoring path. Opening a legacy block that has no `mode` infers `"coda"`, either from the presence of a VM or setup field or as the safe fallback.

**Always write `mode` explicitly in hand-written JSON.** A challenge with no `mode` resolves to `"coda"` and provisions a VM, which is rarely what an author omitting the field intended. Read the availability note at the end of this section before choosing that path.

Standard mode:

```json
{
  "type": "challenge",
  "mode": "standard",
  "title": "Connect your first data source",
  "brief": "Add a Prometheus data source so the rest of this guide has something to query.",
  "successCriteria": "has-datasource:prometheus",
  "failureMessage": "No Prometheus data source yet — check the connections page.",
  "hintLevels": [
    { "text": "Start from Connections > Data sources." },
    { "text": "The Add new data source button is in the top right." }
  ]
}
```

Coda mode:

```json
{
  "type": "challenge",
  "mode": "coda",
  "title": "Fix the broken scrape config",
  "brief": "The Prometheus config in `/etc/prometheus` has an invalid scrape setting. Repair it so `promtool check config` passes.",
  "vmTemplate": "vm-aws",
  "setupScript": "set -euo pipefail\nsed -i 's/scrape_interval:/scrape_intervall:/' /etc/prometheus/prometheus.yml",
  "successCriteria": "coda-exit-zero:promtool check config /etc/prometheus/prometheus.yml"
}
```

| Field             | Type                     | Required | Default   | Description                                                                        |
| ----------------- | ------------------------ | -------- | --------- | ---------------------------------------------------------------------------------- |
| `mode`            | `"coda"` \| `"standard"` | ❌       | see above | Execution model                                                                    |
| `title`           | string                   | ✅       | —         | Short title shown above the brief                                                  |
| `brief`           | string                   | ✅       | —         | Markdown problem statement                                                         |
| `successCriteria` | string                   | ✅       | —         | Requirement evaluated when the user clicks "Check my work"                         |
| `id`              | string                   | ❌       | —         | Block ID                                                                           |
| `vmTemplate`      | string                   | ❌       | `vm-aws`  | VM template to provision; ignored when `mode` is `"standard"`                      |
| `vmScenario`      | string                   | ❌       | —         | Scenario for the `alloy-scenario` template; ignored when `mode` is `"standard"`    |
| `vmApp`           | string                   | ❌       | —         | App for the `sample-app` template; ignored when `mode` is `"standard"`             |
| `setupScript`     | string                   | ❌       | —         | Bash script run server-side once the VM is ready                                   |
| `setupCommands`   | string[]                 | ❌       | —         | **Deprecated** — bash commands run sequentially server-side; prefer `setupScript`  |
| `hintLevels`      | `{ text: string }[]`     | ❌       | `[]`      | Progressive hints revealed on demand                                               |
| `failureMessage`  | string                   | ❌       | —         | Message shown when the success check fails, replacing the checker's own error text |
| `requirements`    | string[]                 | ❌       | —         | Prerequisite conditions for the challenge                                          |
| `objectives`      | string[]                 | ❌       | —         | Objectives marked complete after this block                                        |
| `skippable`       | boolean                  | ❌       | `false`   | Allow skipping                                                                     |

`requirements`, `objectives`, and `skippable` are accepted by the schema, but the challenge runtime does not receive them yet — the block always renders, never contributes to objective tracking, and shows no skip control. Do not rely on them to gate a challenge or to credit an objective.

`hintLevels` is an array of objects, not an array of strings. Each entry is `{ "text": "..." }` with non-empty text, and hints are revealed one at a time in array order. Hints appear only once the challenge is ready to attempt or has failed a check, so a learner stuck waiting on VM provisioning cannot reach them.

`setupScript` and `setupCommands` are not equivalent. The whole `setupScript` string is passed to the remote login shell as a single command with a 120-second budget, so multi-line scripts, heredocs, and control flow all work. Each `setupCommands` entry is a separate remote invocation with its own 30-second budget and no shared shell state, so `cd`, `export`, and heredocs do not carry from one entry to the next; the first non-zero exit abandons the remaining entries.

`setupScript` takes precedence, but only when it is non-empty after trimming — a whitespace-only `setupScript` falls through to `setupCommands`. `setupCommands` is kept only for back-compat: opening a legacy block in the block editor joins the array with newlines into `setupScript` and drops `setupCommands` on save, so a block migrates the first time an author edits it. Write `setupScript` in new content.

Switching a challenge from `"coda"` to `"standard"` in the block editor discards `setupScript` along with the VM fields, and switching back does not restore it. Copy the script out first if you might need it again.

Coda mode is gated on two settings at once: the plugin's Coda-terminal setting, and per-user dev mode for the user viewing the guide. Both must be on, so coda mode is currently a development-only path rather than something an administrator turns on for everyone. When the gate is closed the block neither errors nor hides — it sits on "Provisioning challenge VM…" indefinitely, offering only a Cancel button ([#1541](https://github.com/grafana/grafana-pathfinder-app/issues/1541)). Because a challenge with no `mode` resolves to `"coda"`, an omitted `mode` is the most common way to reach that state. `"standard"` mode has no such dependency and works on every stack.

#### Data check block

Verifies that the learner's data source actually holds the data the guide is about to teach against, so a tutorial about container CPU does not run to completion against an instance that has none.

The learner picks a data source of the type you name, then runs the check. The step completes only when the check passes; when it fails the step stays incomplete and shows a warning underneath.

This is a step, not a `requirements` token, and deliberately so. Requirement tokens are re-evaluated by several timers — a 2-second per-step subscription, a 3-second heartbeat, a 5-second section recheck, plus a retry harness — so a query behind one would run over and over. A data check runs once, when the learner presses the button.

`mode` picks which check you offer:

| Mode       | Behavior                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"query"`  | Runs your `query` against the selected data source. Passes when it returns at least one row. Deterministic, and the only mode that works without the Grafana Assistant.                    |
| `"ai"`     | The assistant investigates the data source — reading its metadata and running up to three queries of its own — and returns a pass/fail verdict on your `aiPrompt`.                         |
| `"either"` | Offers both and lets the learner pick; passing either completes the step. When the assistant is unavailable the AI button simply does not render, so the step degrades to a working check. |

```json
{
  "type": "data-check",
  "id": "check-container-metrics",
  "datasourceType": "prometheus",
  "mode": "either",
  "title": "Check you have container metrics",
  "content": "This guide builds a panel from container CPU data. Pick your Prometheus data source and confirm the data is there.",
  "query": "container_cpu_usage_seconds_total",
  "aiPrompt": "the user has container CPU metrics",
  "failureMessage": "No container CPU data found — install cAdvisor first.",
  "skippable": true
}
```

| Field            | Type                                                     | Required  | Default  | Description                                                         |
| ---------------- | -------------------------------------------------------- | --------- | -------- | ------------------------------------------------------------------- |
| `datasourceType` | `"prometheus"` \| `"loki"` \| `"tempo"` \| `"pyroscope"` | ✅        | —        | Type the learner picks from                                         |
| `mode`           | `"query"` \| `"ai"` \| `"either"`                        | ✅        | —        | Which check to offer                                                |
| `query`          | string                                                   | see above | —        | Required when `mode` is `"query"` or `"either"`                     |
| `aiPrompt`       | string                                                   | see above | —        | Required when `mode` is `"ai"` or `"either"`                        |
| `id`             | string                                                   | ❌        | —        | Block ID                                                            |
| `title`          | string                                                   | ❌        | —        | Short heading shown above the check                                 |
| `content`        | string                                                   | ❌        | —        | Markdown shown above the data source picker                         |
| `timeFrom`       | string                                                   | ❌        | `now-1h` | Query range start                                                   |
| `timeTo`         | string                                                   | ❌        | `now`    | Query range end                                                     |
| `failureMessage` | string                                                   | ❌        | —        | Shown under the step when the check fails                           |
| `variableName`   | string                                                   | ❌        | —        | Guide variable the chosen data source uid is stored under           |
| `requirements`   | string[]                                                 | ❌        | —        | Prerequisite conditions                                             |
| `objectives`     | string[]                                                 | ❌        | —        | Objectives marked complete after this block                         |
| `skippable`      | boolean                                                  | ❌        | `false`  | Show a Skip button so a learner without the data can still continue |

Write the query in the language of the data source type: PromQL for `prometheus`, LogQL for `loki`, TraceQL for `tempo`, and `<profileTypeId>|<labelSelector>` for `pyroscope`. Queries are capped at 100 data points with a 15-second timeout, and the pass rule is simply "returned at least one row" — write a more specific query when you need a stricter bar.

Set `skippable` unless the data is genuinely essential. A learner on an empty development instance otherwise has no way past the step.

Give every data check an explicit `id`. Completion state is keyed off a hash that does not include the block type, so converting an existing block into a data check at the same position can otherwise inherit the old block's completed state.

`variableName` stores the chosen data source **uid**, not its name, and makes it available to later blocks as `{{yourVariableName}}`. Without it the pick is still remembered for the guide; it just is not addressable from other blocks.

The `"ai"` and `"either"` modes need the Grafana Assistant to be available in the instance. There is no separate admin flag. The assistant cannot pick the data source — it is fixed to the learner's selection — and it can run at most three queries per check.

#### Snippet reference block

A pointer to a published snippet. The renderer never sees this block — the guide schema accepts `snippet-ref`, and every ref is expanded after validation and before render, splicing the referenced snippet's blocks in at the ref's position. A guide therefore picks up the snippet's published content on every load, subject to a short cache: successful resolutions are held for five minutes, so a republished snippet can take that long to appear. Failed resolutions are not cached, so a broken ref is retried on every load.

```json
{
  "type": "snippet-ref",
  "snippetId": "connect-prometheus-data-source"
}
```

| Field       | Type   | Required | Description                                                                                                             |
| ----------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `snippetId` | string | ✅       | Upstream snippet ID, resolved after validation and before render. Must be kebab-case: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| `id`        | string | ❌       | Stable identifier for this snippet-ref instance                                                                         |

A ref may sit at the top level of `blocks`, or nested inside a `section`, a `conditional` (in either `whenTrue` or `whenFalse`), or an `assistant`. It may not sit inside a `collapsible` — that container holds content blocks only, and the schema rejects a ref there.

Snippets cannot reference other snippets. The snippet schema rejects `snippet-ref` at every supported nesting depth, so a snippet body may contain any other block type but never a ref.

If a ref cannot be resolved — unknown ID, catalog fetch failure — it is replaced with an inert markdown placeholder naming the snippet ID and an error code. The guide still renders, but nothing interactive appears in the ref's place. The resolver does not distinguish a missing snippet from a transient failure, so an unknown ID reports `network-error` rather than a not-found code.

---

### Block Types Summary

| Block Type         | Category    | Description                                                                     |
| ------------------ | ----------- | ------------------------------------------------------------------------------- |
| `markdown`         | Content     | Formatted text with headings, lists, code, tables                               |
| `html`             | Content     | Raw HTML for migration/custom content                                           |
| `image`            | Content     | Embedded images with optional dimensions                                        |
| `video`            | Content     | YouTube, Vimeo, or native HTML5 video embeds                                    |
| `code-block`       | Content     | Code snippet with copy and Monaco-editor insert                                 |
| `section`          | Structure   | Container for grouped interactive steps with "Do Section"                       |
| `collapsible`      | Structure   | Hides nested content behind a toggle                                            |
| `conditional`      | Structure   | Shows different content based on runtime conditions                             |
| `assistant`        | Structure   | Wraps blocks with AI-powered customization                                      |
| `interactive`      | Interactive | Single-action step (highlight, button, formfill, navigate, hover, noop, popout) |
| `multistep`        | Interactive | Automated sequence of actions                                                   |
| `guided`           | Interactive | User-performed sequence with detection                                          |
| `terminal`         | Interactive | A shell command with copy and execute (requires Coda terminal)                  |
| `terminal-connect` | Interactive | Button that provisions a sandbox VM and opens a terminal panel                  |
| `challenge`        | Interactive | Task with hints and a "Check my work" success check                             |
| `data-check`       | Interactive | Confirms the learner's data source holds the data the guide needs               |
| `grot-guide`       | Interactive | Choose-your-own-adventure decision tree                                         |
| `quiz`             | Assessment  | Knowledge check with single/multiple choice                                     |
| `input`            | Assessment  | Collects user responses as variables                                            |
| `snippet-ref`      | Reusable    | Expands a published snippet in place before render                              |

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

| Field             | Type     | Required | Default             | Description                                                                 |
| ----------------- | -------- | -------- | ------------------- | --------------------------------------------------------------------------- |
| `action`          | string   | ✅       | —                   | Action type: `highlight`, `button`, `formfill`, `navigate`, `hover`, `noop` |
| `reftarget`       | string   | ✅\*     | —                   | CSS selector or button text (\*optional for `noop`)                         |
| `targetvalue`     | string   | ❌       | —                   | Value for `formfill` actions (supports regex patterns)                      |
| `requirements`    | string[] | ❌       | —                   | Requirements for this specific step                                         |
| `tooltip`         | string   | ❌       | —                   | Tooltip shown during multistep execution                                    |
| `description`     | string   | ❌       | —                   | Description shown in guided steps panel                                     |
| `skippable`       | boolean  | ❌       | `false`             | Whether this step can be skipped (guided only)                              |
| `formHint`        | string   | ❌       | —                   | Hint shown when form validation fails                                       |
| `validateInput`   | boolean  | ❌       | `false`             | Require input to match `targetvalue` pattern                                |
| `lazyRender`      | boolean  | ❌       | `false`             | Enable progressive scroll discovery for virtualized containers              |
| `scrollContainer` | string   | ❌       | `".scrollbar-view"` | CSS selector for the scroll container when `lazyRender` is enabled          |

**Note:** The `tooltip` property is primarily used in `multistep` blocks (shown during automated execution), while `description` is used in `guided` blocks (shown in the steps panel as instructions for the user).

---

## Requirements

Requirements control when interactive elements are accessible. Common requirements:

| Requirement               | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `navmenu-open`            | Navigation menu must be open                          |
| `is-admin`                | User must have admin role                             |
| `is-logged-in`            | User must be authenticated                            |
| `exists-reftarget`        | Target element must exist in DOM                      |
| `on-page:/path`           | User must be on specific page                         |
| `has-datasource:X`        | Specific data source must exist                       |
| `datasource-configured:X` | Specific data source must exist and pass health check |
| `has-plugin:X`            | Specific plugin must be installed                     |
| `plugin-enabled:X`        | Specific plugin must be installed and enabled         |
| `renderer:pathfinder`     | Content only for Pathfinder app context               |

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

1. Create a package directory in `src/bundled-interactives/` (e.g., `src/bundled-interactives/my-guide/`) and place the guide content in `content.json` inside it.
2. Add an entry to `src/bundled-interactives/index.json` with the `filename` pointing to `<dir>/content.json`:

```json
{
  "id": "my-guide",
  "title": "My Guide Title",
  "summary": "A brief description of what this guide covers.",
  "filename": "my-guide/content.json",
  "url": ["/"],
  "targetPlatform": "oss"
}
```

| Field            | Required | Description                                                    |
| ---------------- | -------- | -------------------------------------------------------------- |
| `id`             | ✅       | Unique identifier, matches `bundled:id` URL                    |
| `title`          | ✅       | Display title in the guide list                                |
| `summary`        | ✅       | Brief description shown in the guide list                      |
| `filename`       | ✅       | Path to `content.json` relative to `src/bundled-interactives/` |
| `url`            | ❌       | URL patterns where this guide is recommended                   |
| `targetPlatform` | ❌       | `"oss"` or `"cloud"` to filter by platform                     |

The guide will appear in the homepage list and can be opened via `bundled:my-guide`.

> **Package metadata**: For a richer package with metadata, dependencies, and targeting, add a `manifest.json` alongside `content.json`. See [package authoring](../package-authoring.md) for the full two-file model.

---

## TypeScript Types

All types are exported from `src/types/json-guide.types.ts`:

```typescript
import {
  // Root structure
  JsonGuide,

  // Block union
  JsonBlock,

  // Content blocks
  JsonMarkdownBlock,
  JsonHtmlBlock,
  JsonImageBlock,
  JsonVideoBlock,

  // Structural blocks
  JsonSectionBlock,
  JsonCollapsibleBlock,
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
  JsonTerminalBlock,
  JsonTerminalConnectBlock,
  JsonChallengeBlock,
  JsonCodeBlockBlock,
  JsonGrotGuideBlock,
  JsonSnippetRefBlock,
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
  isCollapsibleBlock,
  isConditionalBlock,
  isAssistantBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isQuizBlock,
  isInputBlock,
  isTerminalBlock,
  isTerminalConnectBlock,
  isChallengeBlock,
  isCodeBlockBlock,
  isGrotGuideBlock,
  isSnippetRefBlock,
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

The prescriptive coupling checklist and the limits of the automated drift checks are documented in [schema-type coupling rules](../../../.cursor/rules/schema-coupling.mdc). The recursive JSON guide schemas rely on manual paired review plus focused tests; unlike several non-recursive package schemas, they are not declared with `satisfies z.ZodType<T>`.

## See also

- [Authoring interactive guides](./authoring-interactive-journeys.md) — starting point, external repo link, and full reference index
- [Interactive types](./interactive-types.md) — action type details, Show vs Do behavior
- [Selectors reference](./selectors-reference.md) — targeting DOM elements with the enhanced selector engine
- [Requirements reference](./requirements-reference.md) — pre-condition and post-condition system
- [Guided interactions](./guided-interactions.md) — user-performed action mode
