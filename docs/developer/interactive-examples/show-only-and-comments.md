### Show-only actions and interactive comments

This guide covers two recently added features that enhance the interactive guide experience: **show-only mode** with `data-doit='false'` and **contextual comment boxes** with `<span class="interactive-comment">`.

## Show-only mode with `data-doit='false'`

### Purpose

Creates educational interactions that focus on **pointing out and explaining** UI elements without requiring the user to take action. Perfect for:

- Highlighting important interface elements for recognition
- Explaining concepts without changing application state
- Creating guided tours that focus on observation rather than interaction

### How it works

When `data-doit='false'` is set:

1. **Only "Show me" button appears** (no "Do it" button)
2. **Step completes automatically** after showing the element
3. **No state changes** occur in the application
4. **Focus is on education** rather than action

### Basic usage

```html
<li
  class="interactive"
  data-reftarget='div[data-testid="uplot-main-div"]:first-of-type'
  data-targetaction="highlight"
  data-doit="false"
  data-showme-text="Show highlight"
>
  Examine the metrics visualization panel above the logs.
</li>
```

### Default behavior (for comparison)

```html
<!-- Default behavior (data-doit defaults to true) -->
<li class="interactive" data-reftarget='button[data-testid="save-dashboard"]' data-targetaction="highlight">
  Save your dashboard changes.
</li>
```

This shows both "Show me" and "Do it" buttons, requiring user action to complete.

## Interactive comments with `<span class="interactive-comment">`

### Purpose

Provides **rich, contextual explanations** that appear as floating comment boxes when interactive elements are highlighted. These create engaging, informative overlays that:

- Explain **what the user is looking at** in detail
- Provide **context and background** about UI elements
- Support **rich HTML formatting** (bold, code, emphasis)
- Display with **professional styling** and Grafana branding

### How it works

1. **Content extraction**: Comment spans are found during HTML parsing
2. **CSS hiding**: The span itself is hidden (`display: none`)
3. **Floating display**: Content appears as a positioned comment box during highlighting
4. **Smart positioning**: Box appears left, right, or below the target based on available space
5. **Rich formatting**: Supports HTML tags for enhanced presentation

### Visual features

- **Orange glow border** for attention
- **Grafana logo** for branding
- **Smooth animations** (fade in/out)
- **Responsive positioning** with directional arrows
- **Typography support** for code, bold, emphasis

### Basic example

```html
<li
  class="interactive"
  data-reftarget='div[data-testid="uplot-main-div"]:first-of-type'
  data-targetaction="highlight"
  data-doit="false"
>
  <span class="interactive-comment"
    >This <strong>metrics panel</strong> shows log volume over time with different log levels (debug, info, etc.).</span
  >
  Examine the <strong>metrics visualization panel</strong> above the logs.
</li>
```

### Rich formatting example

```html
<li
  class="interactive"
  data-reftarget='a[data-testid="Nav menu item"][href="/connections"]'
  data-targetaction="highlight"
  data-doit="false"
>
  <span class="interactive-comment"
    >The <strong>Connections</strong> section is where you manage all your data sources. This is your central hub for
    connecting Grafana to various data backends like <code>Prometheus</code>, <code>Loki</code>, <code>InfluxDB</code>,
    and more.</span
  >
  Click on the Connections menu item.
</li>
```

### Complex content example

```html
<li
  class="interactive"
  data-reftarget='textarea[data-testid="query-editor"]'
  data-targetaction="formfill"
  data-targetvalue="avg(alloy_component_controller_running_components{})"
  data-doit="false"
>
  <span class="interactive-comment"
    >This is <strong>PromQL</strong> (Prometheus Query Language)! The <code>avg()</code> function calculates the average
    value, and <code>alloy_component_controller_running_components{}</code> is a metric that tracks running components.
    The empty <code>{}</code> means we're not filtering by labels.</span
  >
  The query editor shows a PromQL query for monitoring component health.
</li>
```

## Combining features

Show-only mode and interactive comments work perfectly together to create **guided educational experiences**:

```html
<li
  class="interactive"
  data-reftarget='div[data-testid="visualization-picker"]'
  data-targetaction="highlight"
  data-doit="false"
>
  <span class="interactive-comment"
    >Grafana offers <strong>many visualization types</strong>: <em>Time series</em> for trends, <em>Bar charts</em> for
    comparisons, <em>Heatmaps</em> for distributions, <em>Tables</em> for raw data, and <em>Stat</em> for single values.
    Choose based on your data story!</span
  >
  Notice the variety of visualization options available in the picker.
</li>
```

## Best practices

### When to use show-only mode

- **Orientation guides**: Showing where important UI elements are located
- **Feature explanations**: Pointing out interface elements without changing state
- **Concept education**: Teaching about what things do rather than how to use them
- **Progressive disclosure**: Building understanding before hands-on interaction

### When to use interactive comments

- **Context is crucial**: When users need background to understand what they're seeing
- **Complex interfaces**: When UI elements aren't self-explanatory
- **Educational content**: When you want to teach concepts alongside actions
- **Rich explanations**: When plain text isn't sufficient for the explanation

### Content guidelines

#### For interactive comments:

- **Start with the element name** in bold: `<strong>Connections</strong> section`
- **Use code formatting** for technical terms: `<code>Prometheus</code>`
- **Add emphasis** for key concepts: `<em>mission control center</em>`
- **Keep length reasonable** (250 characters max for good UX)
- **Focus on "what" and "why"** rather than "how"

#### For show-only actions:

- **Use descriptive text** that matches the comment
- **Focus on observation** verbs: "Examine", "Notice", "Observe"
- **Avoid action** verbs: "Click", "Enter", "Select"

## Technical notes

### CSS styling

Interactive comments inherit theme colors automatically and include:

```css
.interactive-comment-box {
  /* Positioned absolutely near highlighted elements */
  max-width: 250px;
  z-index: 10002;
  animation: fadeInComment 0.3s ease-out;
}

.interactive-comment-content {
  /* Orange glow border for attention */
  border: 2px solid rgba(255, 136, 0, 0.5);
  box-shadow: 0 0 15px rgba(255, 136, 0, 0.4);
  /* Theme-aware colors */
  background: var(--grafana-colors-background-primary);
  color: var(--grafana-colors-text-primary);
}
```

### HTML parsing

Comments are extracted during content processing and passed to React components as `targetComment` props:

```typescript
// In html-parser.ts
const commentSpans = el.querySelectorAll('span.interactive-comment');
if (commentSpans.length > 0) {
  interactiveComment = commentSpans[0].innerHTML;
}
```

### Integration with requirements

Both features work seamlessly with the requirements system:

```html
<li
  class="interactive"
  data-reftarget='div[data-testid="dashboard-panel"]'
  data-targetaction="highlight"
  data-requirements="on-page:/dashboard"
  data-doit="false"
>
  <span class="interactive-comment"
    >This <strong>panel</strong> displays real-time metrics from your <code>Prometheus</code> data source.</span
  >
  Look at the dashboard panel showing your metrics.
</li>
```

The requirements must still be met before the element can be shown, but no "Do it" action is required.
