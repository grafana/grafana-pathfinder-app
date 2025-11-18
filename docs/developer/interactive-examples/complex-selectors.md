# Complex DOM Selector Support

The enhanced selector engine supports complex CSS selectors including `:has()`, `:contains()`, and `:nth-match()` pseudo-selectors with automatic fallback for older browsers.

## Supported Complex Selectors

### `:nth-match()` Pseudo-Selector (Custom)

Finds the Nth occurrence of an element matching the selector globally. This is different from `:nth-child()` which only works within a parent.

```html
<!-- Get the 3rd chart on the page, regardless of parent structure -->
<li class="interactive" data-targetaction="highlight" data-reftarget='div[data-testid="uplot-main-div"]:nth-match(3)'>
  Highlight the third chart
</li>

<!-- Get the 2nd save button -->
<li class="interactive" data-targetaction="button" data-reftarget="button.save-btn:nth-match(2)">
  Click second save button
</li>
```

**Note:** See [nth-selectors.md](./nth-selectors.md) for detailed explanation of `:nth-child()` vs `:nth-match()` differences.

### `:contains()` Pseudo-Selector

Finds elements containing specific text content (jQuery-style selector).

```html
<!-- Find divs containing "checkoutservice" text -->
<li class="interactive" data-targetaction="highlight" data-reftarget='div:contains("checkoutservice")'>
  Highlight service containers
</li>

<!-- Case-insensitive matching -->
<li class="interactive" data-targetaction="highlight" data-reftarget='p:contains("ERROR")'>Find error messages</li>
```

### `:has()` Pseudo-Selector

Finds elements that contain specific descendant elements.

```html
<!-- Find divs that have paragraph children -->
<li class="interactive" data-targetaction="highlight" data-reftarget='div[data-cy="service-card"]:has(p)'>
  Highlight service cards with descriptions
</li>

<!-- Find articles containing buttons -->
<li class="interactive" data-targetaction="button" data-reftarget='article:has(button[data-action="configure"])'>
  Click configurable service cards
</li>
```

### Combined Complex Selectors

The most powerful feature: combining `:has()` and `:contains()` for precise targeting.

```html
<!-- Your exact use case: Find specific service containers -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget='div[data-cy="wb-list-item"]:has(p:contains("checkoutservice"))'
>
  Highlight the checkout service item
</li>

<!-- Find forms containing error messages -->
<li class="interactive" data-targetaction="highlight" data-reftarget='form:has(div:contains("error"))'>
  Highlight forms with validation errors
</li>

<!-- Find cards with specific buttons -->
<li
  class="interactive"
  data-targetaction="formfill"
  data-reftarget='div[data-cy="service-config"]:has(button:contains("Advanced")) input[name="timeout"]'
  data-targetvalue="30s"
>
  Configure timeout for advanced services
</li>
```

## Browser Compatibility

### Native Support

- **:has()**: Chrome 105+, Safari 17.2+, Firefox 140+
- **:contains()**: Not supported natively (jQuery extension)

### Automatic Fallback

The system automatically detects browser capabilities and provides JavaScript-based fallbacks:

```typescript
// The system handles this automatically
const result = querySelectorAllEnhanced('div:has(p:contains("text"))');

if (result.usedFallback) {
  console.log(`Used fallback: ${result.effectiveSelector}`);
}
```

## Performance Considerations

### Optimization Strategy

1. **Native First**: Always tries browser's native `querySelector()` first
2. **Smart Fallback**: Only uses JavaScript parsing when native fails
3. **Efficient Parsing**: Minimal DOM traversal for fallback implementations

### Best Practices

- Use specific base selectors to reduce search scope
- Prefer native CSS selectors when possible
- Test complex selectors in target browser environments

## Examples in Practice

### Service Management Interface

```html
<!-- Highlight specific service types -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget='div[data-service-type]:has(span:contains("Running"))'
>
  Show running services
</li>

<!-- Configure specific services -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget='div[data-cy="service-item"]:has(h3:contains("Auth Service")) button[data-action="configure"]'
>
  Configure the authentication service
</li>
```

### Dashboard Management

```html
<!-- Find dashboards with alerts -->
<li
  class="interactive"
  data-targetaction="highlight"
  data-reftarget='div[data-testid="dashboard-card"]:has(span:contains("alert"))'
>
  Highlight dashboards with active alerts
</li>

<!-- Edit specific dashboard panels -->
<li
  class="interactive"
  data-targetaction="button"
  data-reftarget='div[data-panel-id]:has(h2:contains("CPU Usage")) button[aria-label="Edit panel"]'
>
  Edit the CPU usage panel
</li>
```

## Error Handling

The enhanced selector engine provides robust error handling:

- **Invalid Syntax**: Gracefully handles malformed selectors
- **Missing Elements**: Returns empty arrays instead of throwing errors
- **Browser Compatibility**: Automatic fallback for unsupported features
- **Debug Information**: Detailed logging for troubleshooting

## Migration Guide

### Existing Selectors

All existing selectors continue to work unchanged:

```html
<!-- These still work exactly as before -->
<li data-reftarget='button[data-testid="save-button"]'>...</li>
<li data-reftarget="#dashboard-title">...</li>
<li data-reftarget=".panel-header">...</li>
```

### New Complex Selectors

You can now use advanced selectors for more precise targeting:

```html
<!-- Before: Less precise -->
<li data-reftarget="button">...</li>

<!-- After: More precise -->
<li data-reftarget='div[data-cy="config-panel"]:has(button:contains("Save"))'>...</li>
```

The enhanced selector engine makes interactive guides more powerful and precise while maintaining full backward compatibility.

## Hover-Dependent Interactions

Some UI elements only appear when hovering over their parent containers (e.g., Tailwind's `group-hover:` classes or CSS `:hover` states). The `hover` action type triggers these hover states before interacting with the revealed elements.

### Example: Hover to Reveal Buttons

```html
<div class="interactive-section" data-requirements="exists-reftarget">
  <h3>Workload Details Actions</h3>

  <!-- Step 1: Hover to reveal buttons -->
  <div
    class="interactive"
    data-targetaction="hover"
    data-reftarget='div[data-cy="wb-list-item"]:contains("checkoutservice")'
    data-requirements="exists-reftarget"
  >
    Hover over the checkoutservice workload row
  </div>

  <!-- Step 2: Click the now-visible button -->
  <div class="interactive" data-targetaction="button" data-reftarget="Dashboard" data-requirements="exists-reftarget">
    Click the Dashboard button
  </div>
</div>
```

### Multi-Step with Hover

For seamless hover-then-click sequences, use `InteractiveMultiStep`:

```html
<div class="interactive" data-targetaction="multistep">
  <!-- Internal action 1: Hover -->
  <span
    class="interactive"
    data-targetaction="hover"
    data-reftarget='div[data-cy="wb-list-item"]:contains("checkoutservice")'
    data-requirements="exists-reftarget"
  ></span>

  <!-- Internal action 2: Click revealed button -->
  <span
    class="interactive"
    data-targetaction="button"
    data-reftarget="Dashboard"
    data-requirements="exists-reftarget"
  ></span>

  Complete workload inspection workflow
</div>
```

### How Hover Actions Work

**Show Mode** (Show me button):

- Highlights the element that will be hovered
- Does not trigger hover events
- Useful for demonstrating which element to hover over

**Do Mode** (Do it button):

- Dispatches mouse events: `mouseenter`, `mouseover`, `mousemove`
- Triggers CSS `:hover` pseudo-classes and Tailwind `group-hover:` classes
- Maintains hover state for 2 seconds (configurable)
- Allows subsequent actions to interact with revealed elements
- Does not clean up hover state (natural mouse movement handles this)

### Common Use Cases

#### Hover-Revealed Action Buttons

```html
<!-- Many UI frameworks hide action buttons until hover -->
<div class="interactive" data-targetaction="multistep">
  <span data-targetaction="hover" data-reftarget='tr[data-row-id="user-123"]'></span>
  <span data-targetaction="button" data-reftarget="Edit"></span>
  Edit user details
</div>
```

#### Hover-Revealed Menus

```html
<!-- Dropdown menus that appear on hover -->
<div class="interactive" data-targetaction="multistep">
  <span data-targetaction="hover" data-reftarget='nav[role="navigation"] > div:contains("Settings")'></span>
  <span data-targetaction="button" data-reftarget="Preferences"></span>
  Open preferences from settings menu
</div>
```

#### Hover-Revealed Tooltips with Actions

```html
<!-- Interactive tooltips with clickable elements -->
<div class="interactive" data-targetaction="multistep">
  <span data-targetaction="hover" data-reftarget='[data-tooltip-trigger="info"]'></span>
  <span data-targetaction="button" data-reftarget="Learn more"></span>
  Access additional information
</div>
```

### Timing Configuration

The default hover duration is 2000ms (2 seconds), configured in `INTERACTIVE_CONFIG.delays.perceptual.hover`. This provides enough time for:

- CSS transitions to complete
- User to observe the hover effect
- Browser to fully apply hover styles
- Subsequent actions to execute while hover is active

### Best Practices

1. **Use Complex Selectors**: Combine `:has()` and `:contains()` for precise targeting

   ```html
   data-reftarget='div[data-cy="list-item"]:has(p:contains("specific-name"))'
   ```

2. **Sequence Matters**: Always hover before clicking revealed elements

   ```html
   <!-- Correct: Hover first, then click -->
   <span data-targetaction="hover" ...></span>
   <span data-targetaction="button" ...></span>
   ```

3. **Requirements Check**: Ensure elements exist before hovering

   ```html
   data-requirements="exists-reftarget"
   ```

4. **Multi-Step for Atomicity**: Use `multistep` to ensure hover and click happen together
   ```html
   <div data-targetaction="multistep">
     <!-- Hover and click as a single unit -->
   </div>
   ```
