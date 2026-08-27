# Customizable content with the `<assistant>` tag

This guide shows you how to make tutorial content customizable using the `<assistant>` HTML tag. This allows users to adapt queries, configurations, and other code examples to their specific environment using Grafana Assistant.

AI auto-heal is a separate feature that repairs failing interactive steps at runtime. See [AI auto-heal](AI_FIX.md) for its enablement, event contract, and patch flow.

## Table of contents

- [Quick start](#quick-start)
- [Basic usage](#basic-usage)
- [Content types](#content-types)
- [Examples](#examples)
- [Availability and datasource context](#availability-and-datasource-context)
- [Known limitations](#known-limitations)
- [Best practices](#best-practices)
- [Testing](#testing)

## Quick start

Wrap any query or configuration with an `<assistant>` tag to make it customizable:

```html
<assistant data-assistant-id="my-query" data-assistant-type="query">
  sum(rate(prometheus_http_requests_total[5m])) by (job)
</assistant>
```

**What users see:**

- A purple dotted underline (inline) or purple dotted left border (block)
- A "Customize" button on hover or after clicking the content
- A customized version generated for the selected or fallback data source
- Customization saved to localStorage
- A "Revert to original" action that restores the default
- A green solid border after customization

For JSON guides, use `assistantEnabled`, `assistantId`, and `assistantType` on a supported block, or use an `assistant` wrapper block. See [Assistant block](interactive-examples/json-guide-format.md#assistant-block) in the JSON guide format reference.

## Content types

The `data-assistant-type` attribute determines how the assistant customizes your content:

| Type     | Use for                        | Example                         |
| -------- | ------------------------------ | ------------------------------- |
| `query`  | PromQL, LogQL, SQL, etc.       | `rate(http_requests_total[5m])` |
| `config` | URLs, hostnames, settings      | `http://prometheus:9090`        |
| `code`   | YAML, JSON, scripts            | Alert rules, recording rules    |
| `text`   | Prose, explanations, templates | Descriptive text to personalize |

### Type 1: `query` - database queries

**Best for**: PromQL, LogQL, SQL, TraceQL, and other query languages

```html
<assistant data-assistant-id="rate-query" data-assistant-type="query"> rate(http_requests_total[5m]) </assistant>
```

✅ **Use when:**

- Metric names are generic/example (e.g., `http_requests_total`, `cpu_usage`)
- Labels vary by environment (e.g., `job`, `instance`, `namespace`)
- Query pattern is universal but specifics differ

❌ **Don't use when:**

- Query is a universal pattern (e.g., `up`, `1 + 1`)
- Metric names are standard across all Grafana instances

### Type 2: `config` - configuration values

**Best for**: Configuration snippets, URLs, hostnames, and settings

```html
<assistant data-assistant-id="datasource-url" data-assistant-type="config"> http://prometheus:9090 </assistant>
```

✅ **Use when:**

- URLs/hostnames differ by deployment
- Port numbers vary
- Environment-specific settings

❌ **Don't use when:**

- Default/standard values work for everyone
- Configuration is hard-coded in Grafana

### Type 3: `code` - code snippets

**Best for**: YAML configs, JSON, scripts, and structured code

```html
<assistant data-assistant-id="recording-rule" data-assistant-type="code">
  groups: - name: example rules: - record: job:http_requests:rate5m expr: sum(rate(http_requests_total[5m])) by (job)
</assistant>
```

✅ **Use when:**

- Code includes metric/resource names
- Variable names should match user's environment
- Structured configuration needs adaptation

❌ **Don't use when:**

- Code is a generic example/template
- No environment-specific values to customize

### Type 4: `text` - prose and explanations

**Best for**: Descriptive text, explanations, or templates that benefit from personalization

```html
<assistant data-assistant-id="intro-text" data-assistant-type="text">
  This dashboard monitors your HTTP services running in Kubernetes.
</assistant>
```

✅ **Use when:**

- Explanatory text references environment-specific names or concepts
- Templates need adaptation to the user's setup
- Prose describes infrastructure that varies by deployment

❌ **Don't use when:**

- Text is purely conceptual with no environment-specific references
- The content is already universal

## Basic usage

### Attributes

```html
<assistant data-assistant-id="unique-id" data-assistant-type="query"> Your content here </assistant>
```

| Attribute             | Required | Values                               | Purpose                                                             |
| --------------------- | -------- | ------------------------------------ | ------------------------------------------------------------------- |
| `data-assistant-id`   | No       | Any unique string                    | Stable identifier used in the localStorage key; generated if absent |
| `data-assistant-type` | No       | `query`, `config`, `code`, or `text` | Controls the customization prompt; defaults to `query`              |

Provide an explicit, stable ID for authored content even though the parser can generate one from the element path. Generated IDs can change when the surrounding document structure changes.

### Inline vs block rendering

A `<pre>` containing an `<assistant>` always renders as a block. A standalone `<assistant>` renders inline when it contains no `<pre>` or `<code>` descendant and its trimmed text is shorter than 100 characters; otherwise it renders as a block.

**Inline** (short content with no nested code markup):

```html
<p>Check availability with <assistant data-assistant-id="simple" data-assistant-type="query">up</assistant>.</p>
```

→ Renders with 🟣 purple dotted underline

**Block** (`<pre>` wrapper, nested code markup, or 100 or more characters):

```html
<pre>
  <assistant data-assistant-id="complex" data-assistant-type="query">
    histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le) )
  </assistant>
</pre>
```

→ Renders with 🟣 purple dotted left border in a code block

### Visual states

| State            | Border        | Button                          |
| ---------------- | ------------- | ------------------------------- |
| **Uncustomized** | Purple dotted | "Customize" (on hover or click) |
| **Customized**   | Green solid   | "Revert to original"            |
| **Generating**   | Purple dotted | "Generating..." (disabled)      |

## Examples

### Example 1: Simple inline query

```html
<p>Try this aggregation query:</p>
<assistant data-assistant-id="sum-query" data-assistant-type="query">
  sum(rate(http_requests_total[5m])) by (job)
</assistant>
```

→ Shows a purple dotted underline. The user can hover over or click the query to reveal the "Customize" button.

### Example 2: Multi-line query (block)

```html
<p>Calculate the 95th percentile latency:</p>
<pre>
  <assistant data-assistant-id="quantile-query" data-assistant-type="query">
    histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job) )
  </assistant>
</pre>
```

→ Shows purple dotted left border. Displays as a code block.

### Example 3: Query in an interactive step

Combine with interactive tutorial steps:

```html
<li
  class="interactive"
  data-reftarget="textarea.inputarea"
  data-targetaction="formfill"
  data-targetvalue="@@CLEAR@@ rate(prometheus_http_requests_total[5m])"
  data-requirements="exists-reftarget"
>
  Try this rate query:
  <pre><assistant data-assistant-id="rate-example" data-assistant-type="query">rate(prometheus_http_requests_total[5m])</assistant></pre>
</li>
```

→ The query can be customized and auto-filled into Grafana's query editor.

### Example 4: Configuration value

```html
<p>Set your Prometheus datasource URL:</p>
<assistant data-assistant-id="prom-url" data-assistant-type="config"> http://prometheus-server:9090 </assistant>
```

→ User can customize the URL to their environment.

### Example 5: YAML configuration

```html
<p>Example recording rule configuration:</p>
<assistant data-assistant-id="recording-rule" data-assistant-type="code">
  groups: - name: example interval: 30s rules: - record: job:http_requests:rate5m expr:
  sum(rate(http_requests_total[5m])) by (job)
</assistant>
```

→ User can adapt metric names and labels to their setup.

## Availability and datasource context

The "Customize" action appears only when Grafana Assistant is available. In assistant dev mode, Pathfinder substitutes a mock availability stream and mock generator so the UI can be tested without a live Assistant installation.

Before generation, Pathfinder reads the configured data sources and selects context in this order:

1. The data source selected in the current Explore left-pane URL state
2. The first configured Prometheus data source

The selected data source is provided to Grafana Assistant as Explore page context. For Prometheus, Loki, Tempo, and Pyroscope, Pathfinder also offers a metadata tool so the Assistant can discover real metrics, labels, services, or profiling data. Other data source types use a generic prompt with realistic common values.

## Known limitations

- Customization does not start when no data source can be selected.
- Outside Explore, the fallback is the first configured Prometheus data source rather than data source context from the surrounding guide.
- Metadata-backed customization is limited to Prometheus, Loki, Tempo, and Pyroscope. Other data source types do not query their available metadata.
- Assistant output may still require review even when metadata is available.

## Best practices

### 1. Choose good candidates

✅ **DO use `<assistant>` for:**

- Generic metric names (`http_requests_total`, `node_cpu_seconds_total`)
- Example hostnames/URLs (`http://prometheus:9090`)
- Common but environment-specific labels (`job`, `namespace`, `cluster`)
- Configuration that varies by deployment

❌ **DON'T use for:**

- Universal metrics that work everywhere (`up`, `grafana_*`)
- PromQL functions (`rate()`, `sum()`, `histogram_quantile()`)
- Conceptual explanations without executable code
- Content that has only one correct answer

### 2. Use descriptive IDs

```html
<!-- ✅ Good: Descriptive and hierarchical -->
<assistant data-assistant-id="query-error-rate" data-assistant-type="query">
  sum(rate(http_requests_total[5m])) by (job)
</assistant>

<!-- ❌ Bad: Generic and non-descriptive -->
<assistant data-assistant-id="q1" data-assistant-type="query"> sum(rate(http_requests_total[5m])) by (job) </assistant>
```

### 3. Provide context

Always explain what the customizable content does:

```html
<!-- ✅ Good: Clear explanation -->
<p>This query calculates the HTTP error rate as a percentage:</p>
<assistant data-assistant-id="error-rate" data-assistant-type="query">
  sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
</assistant>
<p>💡 The assistant can adapt the metric names and labels to match your datasource!</p>

<!-- ❌ Bad: No explanation -->
<assistant data-assistant-id="query1" data-assistant-type="query">
  sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
</assistant>
```

### 4. Use one or two per tutorial section

Avoid overwhelming users with too many customizable elements:

```html
<!-- ✅ Good: One or two key queries per section -->
<h3>Calculate Request Rate</h3>
<p>Use this query:</p>
<assistant data-assistant-id="rate-query" data-assistant-type="query"> rate(http_requests_total[5m]) </assistant>

<!-- ❌ Bad: Every example is customizable -->
<assistant data-assistant-id="q1">up</assistant>
<assistant data-assistant-id="q2">rate(metric[5m])</assistant>
<assistant data-assistant-id="q3">sum(metric)</assistant>
<assistant data-assistant-id="q4">avg(metric)</assistant>
```

## Testing

### Enable assistant dev mode

Test without Grafana Cloud by enabling dev mode for your user in the plugin configuration, then selecting "Enable Assistant (Dev Mode)." Both the parent dev-mode access check and the `enableAssistantDevMode` setting must be enabled. Reload the page after changing the setting.

### Verification checklist

After adding `<assistant>` tags to your tutorial:

- [ ] A purple dotted border appears on uncustomized content
- [ ] The "Customize" button appears on hover or after clicking the content
- [ ] Clicking "Customize" triggers generation (check the console in dev mode)
- [ ] A green solid border appears after customization
- [ ] The "Revert to original" button appears when customized
- [ ] The customization persists after a page reload
- [ ] Each explicit `data-assistant-id` is unique within the tutorial

### Check console logs (dev mode)

When customization triggers, you should see:

```
=== Inline Assistant Dev Mode ===
Origin: grafana-pathfinder-app/assistant-customizable
Prompt { prompt: "Customize this query ..." }
System Prompt { systemPrompt: "You are a Grafana prometheus expert. ..." }
=======================================
```

## Quick reference

### Anatomy of an `<assistant>` tag

```html
<assistant data-assistant-id="query-error-rate" data-assistant-type="query">
  sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
</assistant>
```

Use a stable `data-assistant-id` for persistence. Omit `data-assistant-type` only when the `query` default is appropriate.

### Common patterns

```html
<!-- Inline query in tutorial step -->
<assistant data-assistant-id="q1" data-assistant-type="query">metric_name</assistant>

<!-- Block query -->
<pre><assistant data-assistant-id="q2" data-assistant-type="query">sum(metric) by (label)</assistant></pre>

<!-- Config value -->
<code><assistant data-assistant-id="c1" data-assistant-type="config">http://localhost:9090</assistant></code>

<!-- YAML snippet -->
<assistant data-assistant-id="yaml1" data-assistant-type="code">
  scrape_configs: - job_name: 'example' static_configs: - targets: ['localhost:9090']
</assistant>
```

## Related documentation

- [Prometheus advanced queries](../../src/bundled-interactives/prometheus-advanced-queries/content.json) - Real tutorial with customizable queries
- [Authoring interactive journeys](./interactive-examples/authoring-interactive-journeys.md) - Creating interactive steps
- [JSON guide format](./interactive-examples/json-guide-format.md#assistant-block) - JSON assistant blocks and per-block attributes
- [Dev mode](./DEV_MODE.md) - Local development setup
- [AI auto-heal](./AI_FIX.md) - Separate runtime repair flow for failing interactive steps
- [Assistant integration code](../../src/integrations/assistant-integration/) - Implementation details
