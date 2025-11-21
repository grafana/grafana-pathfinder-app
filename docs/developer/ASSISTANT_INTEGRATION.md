# Customizable Content with `<assistant>` Tag

This guide shows you how to make tutorial content customizable using the `<assistant>` HTML tag. This allows users to adapt queries, configurations, and other code examples to their specific environment using Grafana Assistant.

## Table of Contents

- [Quick Start](#quick-start)
- [Basic Usage](#basic-usage)
- [Content Types](#content-types)
- [Examples](#examples)
- [Known Limitations](#known-limitations)
- [Best Practices](#best-practices)
- [Testing](#testing)

## Quick Start

Wrap any query or configuration with an `<assistant>` tag to make it customizable:

```html
<assistant data-assistant-id="my-query" data-assistant-type="query">
  sum(rate(prometheus_http_requests_total[5m])) by (job)
</assistant>
```

**What users see:**

- 🟣 Purple dotted indicator (inline) or purple left border (block)
- ✨ "Customize" button on hover with gradient styling
- 🤖 AI generates a customized version for their datasources
- 💾 Customization saved to localStorage
- 🔄 "Revert to original" to restore default
- 🟢 Green border after customization

## Content Types

The `data-assistant-type` attribute determines how the assistant customizes your content:

| Type     | Use For                   | Example                         |
| -------- | ------------------------- | ------------------------------- |
| `query`  | PromQL, LogQL, SQL, etc.  | `rate(http_requests_total[5m])` |
| `config` | URLs, hostnames, settings | `http://prometheus:9090`        |
| `code`   | YAML, JSON, scripts       | Alert rules, recording rules    |

### Type 1: `query` - Database Queries

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

### Type 2: `config` - Configuration Values

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

### Type 3: `code` - Code Snippets

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

## Basic Usage

### Required Attributes

```html
<assistant
  data-assistant-id="unique-id"      <!-- Required: Unique identifier -->
  data-assistant-type="query">       <!-- Required: query|config|code -->
  Your content here
</assistant>
```

| Attribute             | Required | Values                       | Purpose                                             |
| --------------------- | -------- | ---------------------------- | --------------------------------------------------- |
| `data-assistant-id`   | ✅ Yes   | Any unique string            | Identifies this element (used for localStorage key) |
| `data-assistant-type` | ✅ Yes   | `query`, `config`, or `code` | Tells assistant what type of content to customize   |

### Inline vs Block Rendering

The tag automatically renders inline or block based on content:

**Inline** (single line, no newlines):

```html
<pre><assistant data-assistant-id="simple" data-assistant-type="query">up</assistant></pre>
```

→ Renders with 🟣 purple dotted underline

**Block** (multi-line, contains newlines):

```html
<assistant data-assistant-id="complex" data-assistant-type="query">
  histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le) )
</assistant>
```

→ Renders with 🟣 purple dotted left border in a code block

### Visual States

| State            | Border        | Indicator | Button                          |
| ---------------- | ------------- | --------- | ------------------------------- |
| **Uncustomized** | Purple dotted | 🟣        | "Customize" (on hover)          |
| **Customized**   | Green solid   | 🟢        | "Revert to original" (on hover) |
| **Generating**   | Purple dotted | 🟣        | "Generating..." (disabled)      |

## Examples

### Example 1: Simple Inline Query

```html
<p>Try this aggregation query:</p>
<pre><assistant data-assistant-id="sum-query" data-assistant-type="query">sum(rate(http_requests_total[5m])) by (job)</assistant></pre>
```

→ Shows purple dotted underline. User can click to customize.

### Example 2: Multi-Line Query (Block)

```html
<p>Calculate the 95th percentile latency:</p>
<assistant data-assistant-id="quantile-query" data-assistant-type="query">
  histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job) )
</assistant>
```

→ Shows purple dotted left border. Displays as a code block.

### Example 3: Query in Interactive Step

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

→ Query can be customized AND auto-filled into Grafana's query editor.

### Example 4: Configuration Value

```html
<p>Set your Prometheus datasource URL:</p>
<assistant data-assistant-id="prom-url" data-assistant-type="config"> http://prometheus-server:9090 </assistant>
```

→ User can customize the URL to their environment.

### Example 5: YAML Configuration

```html
<p>Example recording rule configuration:</p>
<assistant data-assistant-id="recording-rule" data-assistant-type="code">
  groups: - name: example interval: 30s rules: - record: job:http_requests:rate5m expr:
  sum(rate(http_requests_total[5m])) by (job)
</assistant>
```

→ User can adapt metric names and labels to their setup.

## Known Limitations

### ⚠️ No Datasource Context Support

**Issue:** The inline assistant cannot access datasource context.

**GitHub Issue:** [grafana/grafana-assistant-app#3267](https://github.com/grafana/grafana-assistant-app/issues/3267)

**What this means:**

- The assistant doesn't know which datasource the user has selected
- It cannot query for available metrics or labels
- Customizations are based on generic prompts and common patterns
- Results may be less accurate than they could be

**Recommendation:**

- Use customizable queries for examples that need adaptation
- Provide clear explanations of what metrics/labels to expect
- Mention this is a preview feature that will improve over time

## Best Practices

### 1. Choose Good Candidates

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

### 2. Use Descriptive IDs

```html
<!-- ✅ Good: Descriptive and hierarchical -->
<assistant data-assistant-id="query-error-rate" data-assistant-type="query">
  <assistant data-assistant-id="config-loki-endpoint" data-assistant-type="config">
    <assistant data-assistant-id="code-alert-rule-cpu" data-assistant-type="code">
      <!-- ❌ Bad: Generic and non-descriptive -->
      <assistant data-assistant-id="q1" data-assistant-type="query">
        <assistant
          data-assistant-id="example"
          data-assistant-type="query"
        ></assistant></assistant></assistant></assistant
></assistant>
```

### 3. Provide Context

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

### 4. One Per Tutorial Section

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

### Enable Dev Mode

Test without Grafana Cloud by enabling dev mode in browser console:

```javascript
window.__pathfinderPluginConfig = {
  enableAssistantDevMode: true,
};
// Reload the page
location.reload();
```

### Verification Checklist

After adding `<assistant>` tags to your tutorial:

- [ ] 🟣 Purple indicators appear on uncustomized content
- [ ] ✨ "Customize" button appears on hover
- [ ] 🤖 Clicking "Customize" triggers generation (check console in dev mode)
- [ ] 🟢 Green border appears after customization
- [ ] 🔄 "Revert to original" button appears when customized
- [ ] 💾 Customization persists after page reload
- [ ] 🆔 Each `data-assistant-id` is unique within the tutorial

### Check Console Logs (Dev Mode)

When customization triggers, you should see:

```
=== Inline Assistant Dev Mode ===
Origin: grafana-pathfinder-app/assistant-customizable
Prompt: Customize this query for a prometheus datasource...
System Prompt: You are a Grafana prometheus query expert...
=====================================
```

## Quick Reference

### Anatomy of an `<assistant>` Tag

```html
<assistant data-assistant-id="query-error-rate" ← Unique ID (required) data-assistant-type="query">
  ← Content type (required) sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
</assistant>
```

### Common Patterns

```html
<!-- Inline query in tutorial step -->
<pre><assistant data-assistant-id="q1" data-assistant-type="query">metric_name</assistant></pre>

<!-- Block query -->
<assistant data-assistant-id="q2" data-assistant-type="query"> sum(metric) by (label) </assistant>

<!-- Config value -->
<code><assistant data-assistant-id="c1" data-assistant-type="config">http://localhost:9090</assistant></code>

<!-- YAML snippet -->
<assistant data-assistant-id="yaml1" data-assistant-type="code">
  scrape_configs: - job_name: 'example' static_configs: - targets: ['localhost:9090']
</assistant>
```

## Related Documentation

- [Prometheus Advanced Queries](../../src/bundled-interactives/prometheus-advanced-queries.ts) - Real tutorial with 28 customizable queries
- [Interactive Tutorials Guide](./interactive-examples/README.md) - Creating interactive steps
- [Dev Mode](./DEV_MODE.md) - Local development setup
- [Assistant Integration Code](../../src/integrations/assistant-integration/) - Implementation details
