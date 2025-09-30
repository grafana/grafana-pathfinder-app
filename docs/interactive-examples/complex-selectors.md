# Complex DOM Selector Support

The enhanced selector engine now supports complex CSS selectors including `:has()` and `:contains()` pseudo-selectors with automatic fallback for older browsers.

## Supported Complex Selectors

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

The enhanced selector engine makes interactive tutorials more powerful and precise while maintaining full backward compatibility.
