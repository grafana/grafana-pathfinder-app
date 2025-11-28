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

Every JSON guide has three required fields and one optional field:

```json
{
  "id": "my-guide-id",
  "title": "My Guide Title",
  "blocks": [],
  "match": {
    "urlPrefix": ["/dashboards"],
    "tags": ["beginner", "dashboards"]
  }
}
```

| Field    | Type        | Required | Description                             |
| -------- | ----------- | -------- | --------------------------------------- |
| `id`     | string      | ✅       | Unique identifier for the guide         |
| `title`  | string      | ✅       | Display title shown in the UI           |
| `blocks` | JsonBlock[] | ✅       | Array of content and interactive blocks |
| `match`  | object      | ❌       | Metadata for recommendation matching    |

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

**YouTube Example:**

```json
{
  "type": "video",
  "src": "https://www.youtube.com/embed/dQw4w9WgXcQ",
  "provider": "youtube",
  "title": "Getting Started with Grafana"
}
```

**Native Video Example:**

```json
{
  "type": "video",
  "src": "https://example.com/tutorial.mp4",
  "provider": "native",
  "title": "Tutorial Video"
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

| Field           | Type     | Required | Default | Description                                        |
| --------------- | -------- | -------- | ------- | -------------------------------------------------- |
| `action`        | string   | ✅       | —       | Action type (see below)                            |
| `reftarget`     | string   | ✅       | —       | CSS selector or button text                        |
| `content`       | string   | ✅       | —       | Markdown description shown to user                 |
| `targetvalue`   | string   | ❌       | —       | Value for `formfill` actions                       |
| `tooltip`       | string   | ❌       | —       | Tooltip shown on highlight (supports markdown)     |
| `requirements`  | string[] | ❌       | —       | Conditions that must be met                        |
| `objectives`    | string[] | ❌       | —       | Objectives marked complete after this step         |
| `skippable`     | boolean  | ❌       | `false` | Allow skipping if requirements fail                |
| `hint`          | string   | ❌       | —       | Hint shown when step cannot be completed           |
| `showMe`        | boolean  | ❌       | `true`  | Show the "Show me" button                          |
| `doIt`          | boolean  | ❌       | `true`  | Show the "Do it" button                            |
| `completeEarly` | boolean  | ❌       | `false` | Mark step complete BEFORE action executes          |
| `verify`        | string   | ❌       | —       | Post-action verification (e.g., `"on-page:/path"`) |

**Action Types:**

| Action      | Description          | `reftarget`             | `targetvalue` |
| ----------- | -------------------- | ----------------------- | ------------- |
| `highlight` | Highlight an element | CSS selector            | —             |
| `button`    | Click a button       | Button text or selector | —             |
| `formfill`  | Enter text in input  | CSS selector            | Text to enter |
| `navigate`  | Navigate to URL      | URL path                | —             |
| `hover`     | Hover over element   | CSS selector            | —             |

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

---

### Step Structure

Steps used in `multistep` and `guided` blocks share this structure:

```json
{
  "action": "highlight",
  "reftarget": "selector",
  "targetvalue": "value for formfill",
  "requirements": ["step-requirement"],
  "tooltip": "Tooltip text",
  "skippable": true
}
```

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
  JsonGuide,
  JsonBlock,
  JsonMarkdownBlock,
  JsonHtmlBlock,
  JsonSectionBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonImageBlock,
  JsonVideoBlock,
  JsonStep,
} from '../types/json-guide.types';
```

Type guards are also available:

```typescript
import {
  isMarkdownBlock,
  isHtmlBlock,
  isSectionBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isImageBlock,
  isVideoBlock,
} from '../types/json-guide.types';
```
