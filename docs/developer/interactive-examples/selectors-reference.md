# Selectors reference

How to target DOM elements in interactive guides using the enhanced selector engine.

## Selector strategy

Follow this priority order when choosing selectors:

1. **`grafana:` selector paths** -- version-aware references to selectors maintained by Grafana core
2. **`data-testid` attributes** -- stable when no known Grafana selector path exists
3. **Semantic attributes** -- `href`, `aria-*`, `id`, `role`
4. **`:contains()` text matching** -- reliable for buttons and labels
5. **`:has()` structural matching** -- when you need to match by descendants
6. **CSS class selectors** -- least stable; avoid auto-generated class names

> Avoid selecting by auto-generated class names or deep DOM nesting. Use attributes (`data-testid`, `href`, `aria-*`, `id`) instead.

### Version-aware `grafana:` selectors

When the element picker recognizes a `data-testid` or `aria-label` from Grafana's E2E selector catalog, it emits a `grafana:` path instead of copying the rendered attribute value:

```text
grafana:components.RefreshPicker.runButton
grafana:pages.Login.username
grafana:components.Breadcrumbs.breadcrumb:Home
```

The final segment after the last colon is the argument for a parameterized selector. At runtime, Pathfinder resolves the path against the running Grafana version and queries both the resolved `data-testid` and `aria-label` forms. Reverse lookup covers both `components.*` and `pages.*`; if an attribute value maps ambiguously to multiple paths, the picker skips `grafana:` and uses its CSS strategies instead. The raw test ID remains available as an alternative selector.

### Generated structural fallbacks

The element picker only uses positional selectors as a last resort:

- A candidate that is not unique is scoped to the nearest stable ancestor with a test ID, a non-generated ID, or a stable `data-*` attribute.
- A bare tag such as `button` is accepted only when a stable ancestor makes the scoped form unique.
- An identity-less wrapper can borrow a stable descendant's identity with `:has()`. The generator prefers unique interactive descendants and tightens the selector with a parent-child relationship or stable ancestor scope until it identifies only the clicked wrapper.
- Primary and alternative selectors pass the same uniqueness and scoping checks. If no stable option exists, the picker can emit a positional fallback that Selector Health marks as structural.

The recorder ignores clicks inside `[data-pathfinder-content="true"]`, which marks Pathfinder's sidebar, floating panel, and full-screen surfaces. Record against the target Grafana UI, not controls inside Pathfinder itself.

## Pseudo-selectors

The enhanced selector engine supports complex CSS selectors including `:has()`, `:contains()`, and the custom `:nth-match()` pseudo-selector, with automatic fallback for older browsers.

### `:contains()` -- text matching

Finds elements containing specific text content (jQuery-style selector).

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "div:contains(\"checkoutservice\")",
  "content": "Highlight the checkout service container"
}
```

### `:has()` -- structural matching

Finds elements that contain specific descendant elements.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "div[data-cy=\"service-card\"]:has(p)",
  "content": "Highlight service cards that have descriptions"
}
```

### Combined `:has()` and `:contains()`

The most powerful pattern: combine structural and text matching for precise targeting.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "div[data-cy=\"wb-list-item\"]:has(p:contains(\"checkoutservice\"))",
  "content": "Highlight the checkout service item"
}
```

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "div[data-cy=\"service-config\"]:has(button:contains(\"Advanced\")) input[name=\"timeout\"]",
  "targetvalue": "30s",
  "content": "Configure timeout for advanced services"
}
```

### `:nth-match()` -- global occurrence matching (custom)

Finds the Nth occurrence of an element matching the selector **globally across the page**. This is different from `:nth-child()` and `:nth-of-type()`, which only look within a single parent.

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "div[data-testid=\"uplot-main-div\"]:nth-match(3)",
  "content": "Highlight the third chart on the page"
}
```

#### Why not `:nth-child()`?

`:nth-child(3)` means "match this element only if it is the 3rd child of its parent." When charts live in separate parent containers, `:nth-child()` fails because each chart is the 1st child of its own parent.

```html
<!-- Each chart is the 1st child of its own parent -- :nth-child(3) matches nothing -->
<div class="parent1">
  <div data-testid="uplot-main-div">First chart</div>
</div>
<div class="parent2">
  <div data-testid="uplot-main-div">Second chart</div>
</div>
<div class="parent3">
  <div data-testid="uplot-main-div">Third chart</div>
</div>
```

#### Quick reference

| Selector             | Meaning                                                     | Use when                                       |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `div:nth-child(3)`   | Element that is the 3rd child of its parent                 | You know the element's position in its parent  |
| `div:nth-of-type(3)` | Element that is the 3rd `div` child of its parent           | You know the position among same-type siblings |
| `div:nth-match(3)`   | The 3rd `div` matching this selector in the entire document | You want the Nth global occurrence             |

### Browser compatibility

| Selector                         | Native support                            | Fallback                           |
| -------------------------------- | ----------------------------------------- | ---------------------------------- |
| `:has()`                         | Chrome 105+, Safari 17.2+, Firefox 140+   | Automatic JS fallback              |
| `:contains()`                    | Not natively supported (jQuery extension) | Automatic JS fallback              |
| `:nth-match()`                   | Custom implementation                     | Uses `querySelectorAll` internally |
| `:nth-child()`, `:nth-of-type()` | All browsers                              | Standard CSS                       |

The selector engine automatically detects browser capabilities and provides JavaScript-based fallbacks when native support is missing.

## Common stable selectors

Prefer these tested selectors over brittle CSS classes. When you find a new reliable selector, add it here.

### Navigation and core areas

| Component               | Preferred selector                                                | Notes                                                                      |
| ----------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Nav menu item (by href) | `a[data-testid='data-testid Nav menu item'][href='/connections']` | Replace `href` for Connections, Dashboards, Explore, Alerting, Admin, Home |
| Navigation container    | `div[data-testid="data-testid navigation mega-menu"]`             | Fallbacks: `ul[aria-label='Navigation']`, `div[data-testid*='navigation']` |

### Editor and panel building

| Component                   | Preferred selector                                                              | Notes                      |
| --------------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| Query mode toggle (Code)    | `div[data-testid="QueryEditorModeToggle"] label[for^="option-code-radiogroup"]` | Switch to Code mode        |
| Visualization picker toggle | `button[data-testid="data-testid toggle-viz-picker"]`                           | Opens visualization picker |
| Panel title input           | `input[data-testid="data-testid Panel editor option pane field input Title"]`   | Edit panel title           |

### Drilldowns (example)

| Component             | Preferred selector                                                                             | Notes                   |
| --------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- |
| Metrics drilldown app | `a[data-testid='data-testid Nav menu item'][href='/a/grafana-metricsdrilldown-app/drilldown']` | Opens app entrypoint    |
| Select metric action  | `button[data-testid="select-action_<metric_name>"]`                                            | Replace `<metric_name>` |
| Related metrics tab   | `button[data-testid="data-testid Tab Related metrics"]`                                        | Tab toggle              |
| Related logs tab      | `button[data-testid="data-testid Tab Related logs"]`                                           | Tab toggle              |

### Buttons by text

For generic buttons, use the `button` action with the button's visible text as the `reftarget`. The system finds buttons by text reliably.

```json
{
  "type": "interactive",
  "action": "button",
  "reftarget": "Add new data source",
  "content": "Click **Add new data source**"
}
```

```json
{ "type": "interactive", "action": "button", "reftarget": "Save & test", "content": "Click **Save & test**" }
```

### Inputs and fields

- Prefer attribute-stable selectors: `input[id='basic-settings-name']`, `input[placeholder='https://feed']`, `textarea.inputarea` (Monaco)
- ARIA comboboxes: the system detects `role='combobox'` and stages tokens with Enter presses

```json
{
  "type": "interactive",
  "action": "formfill",
  "reftarget": "input[id='basic-settings-name']",
  "targetvalue": "My Data Source",
  "content": "Enter the data source name"
}
```

## Hover-dependent selectors

Some UI elements only appear when hovering over their parent containers (e.g., Tailwind's `group-hover:` or CSS `:hover` states). Use the `hover` action to reveal elements before interacting with them.

### How hover actions work

**Show mode** (Show me): highlights the element that will be hovered; does not trigger hover events.

**Do mode** (Do it): dispatches `mouseenter`, `mouseover`, `mousemove` events, triggering CSS `:hover` and Tailwind `group-hover:` classes. Maintains hover state for 2 seconds (configurable). Subsequent actions can then interact with revealed elements.

### Hover-then-click with multistep

Use a `multistep` block to ensure hover and click happen as a single atomic sequence:

```json
{
  "type": "multistep",
  "content": "Inspect the checkout service workload",
  "steps": [
    {
      "action": "hover",
      "reftarget": "div[data-cy=\"wb-list-item\"]:contains(\"checkoutservice\")",
      "tooltip": "Hover to reveal action buttons"
    },
    {
      "action": "button",
      "reftarget": "Dashboard",
      "requirements": ["exists-reftarget"],
      "tooltip": "Click the Dashboard button"
    }
  ]
}
```

### Common patterns

**Hover-revealed action buttons:**

```json
{
  "type": "multistep",
  "content": "Edit user details",
  "steps": [
    { "action": "hover", "reftarget": "tr[data-row-id=\"user-123\"]" },
    { "action": "button", "reftarget": "Edit" }
  ]
}
```

**Hover-revealed menus:**

```json
{
  "type": "multistep",
  "content": "Open preferences from the settings menu",
  "steps": [
    { "action": "hover", "reftarget": "nav[role=\"navigation\"] > div:contains(\"Settings\")" },
    { "action": "button", "reftarget": "Preferences" }
  ]
}
```

### Timing

The default hover duration is 2000 ms, configured in `INTERACTIVE_CONFIG.delays.perceptual.hover`. This allows time for CSS transitions, hover styles, and subsequent actions.

## Selector resilience pipeline

Single-pass selector resolution is fragile against lazy-loaded UI and minor markup churn. The interactive engine ships with a resilience pipeline (`resolveSelectorPipeline`) that retries while lazy-loaded UI mounts and reports whether the match was exact or retried.

The pipeline runs through these stages:

1. **Resolve prefixes** — `grafana:` paths resolve against the running Grafana version; `panel:` paths resolve to a panel container by title.
2. **Exact attempt** — the enhanced query engine evaluates native CSS and the `:contains()`, `:has()`, `:text()`, and `:nth-match()` extensions. Plain-text `button` actions use button-text lookup. `data-testid` prefix matching is handled inside this query step and only succeeds for a unique prefix match.
3. **Retry with backoff** — the pipeline waits 200 ms, 600 ms, then 1.8 s between attempts. From the second retry onward, it can relax child combinators (`>`) to descendant combinators when the original selector still has no match.

Exact pipeline matches report confidence `1.0`; retried matches report `0.95`. Separately, the block editor derives the Selector Health badge from the selector's stability signals:

| Badge     | Confidence | Meaning                                                                    |
| --------- | ---------- | -------------------------------------------------------------------------- |
| 🟢 Green  | High       | Stable selector — `data-testid`, `aria-*`, `id`, or short `:text()` match. |
| 🟡 Yellow | Medium     | Multiple matches, semantic but generic, or `:contains()` on long strings.  |
| 🔴 Red    | Low        | Auto-generated CSS classes, deep DOM nesting, or no match.                 |

The block editor's **Test selector** button evaluates a selector against the live DOM and flash-highlights every match with numbered overlays, so you can confirm targeting before publishing.

### `panel:` domain prefix

Targeting Grafana panels by title is fragile because panel DOM identifiers are auto-generated. The `panel:` domain prefix scopes the rest of the selector to the panel matching the given title:

```json
{
  "type": "interactive",
  "action": "highlight",
  "reftarget": "panel:HTTP request rate input[data-testid='time-picker']",
  "content": "Open the time picker on the HTTP request rate panel."
}
```

The engine first locates the panel whose title matches `HTTP request rate`, then applies `input[data-testid='time-picker']` within that panel's bounds.

## Performance best practices

1. **Native first** -- the engine always tries the browser's native `querySelector()` before falling back to JavaScript parsing
2. **Specific base selectors** -- narrow the search scope (e.g., `div[data-testid="panel"]:has(...)` rather than `div:has(...)`)
3. **Prefer `data-testid`** -- fastest and most stable
4. **Test in target browsers** -- especially when using `:has()` on older Firefox
5. **Prefer `:text()` over `:contains()` for short button labels** — eliminates false positives on common words like "New" or "Save"
6. **Use `panel:` for panel targets** — far more stable than relying on auto-generated panel IDs

## Troubleshooting

### "No elements found" with `:nth-match()`

1. Verify the base selector finds elements: `document.querySelectorAll('div[data-testid="uplot-main-div"]').length` in the browser console
2. Confirm enough matches exist (`:nth-match(3)` needs at least 3 elements)
3. Ensure elements are loaded -- add `requirements: ["exists-reftarget"]` or `requirements: ["on-page:/dashboards"]`

### General selector issues

- **Invalid syntax** -- the engine handles malformed selectors gracefully and returns empty arrays
- **Missing elements** -- check requirements to ensure the page state is correct before the step runs
- **Browser compatibility** -- automatic fallback handles most cases; check the browser console for detailed logging
