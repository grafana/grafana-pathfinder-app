# DOM Selector Debug Panel

A powerful developer tool for creating and testing interactive tutorial selectors with Watch Mode, Record Mode, and automated testing capabilities.

## Enabling Debug Mode

### 1. Access Plugin Configuration

Navigate to the plugin configuration page with the dev mode parameter:

```
https://your-grafana.com/a/grafana-grafanadocsplugin-app?page=configuration&dev=true
```

### 2. Enable Dev Mode

1. Check the **"Dev Mode"** checkbox
2. Click **"Save configuration"**
3. Page will reload automatically

### 3. Access Debug Panel

1. Open the **Pathfinder sidebar** (click the book icon)
2. Stay on the **"Recommendations"** tab
3. Scroll to the bottom
4. You'll see **"DOM Selector Debug"** with an orange "Dev Mode" badge

## Debug Panel Features

The debug panel provides 5 powerful modes for selector development:

### 1. Simple Selector Tester

**Purpose:** Quick validation of CSS selectors with instant feedback

**Features:**

- Input field for any CSS selector
- Supports custom pseudo-selectors (`:contains()`, `:has()`, `:nth-match()`)
- "Show me" button - Highlights all matching elements
- "Do it" button - Highlights and clicks first match
- Match count display
- Success/error feedback

**Example Usage:**

```
1. Enter: button[data-testid="save-dashboard"]
2. Click "Show me" → Highlights all matching buttons
3. Shows: "Found 1 element (using fallback)"
```

### 2. MultiStep Debug (Auto-Execute)

**Purpose:** Test multi-step sequences with automated execution

**Features:**

- Textarea input for multi-line step definitions
- Format: `action|selector|value` (one per line)
- Automated show→delay→do execution pattern
- Progress indicator showing current step
- Uses production timing from `INTERACTIVE_CONFIG`

**Example Input:**

```
highlight|a[data-testid="Nav menu item"][href="/dashboards"]|
formfill|input[name="query"]|prometheus
button|Save Dashboard|
```

**Execution:**

1. Click "Run MultiStep"
2. Watch automated execution (shows each step, then performs it)
3. 1.8 second delay between steps
4. Success/error feedback

### 3. Guided Debug (Manual Execution)

**Purpose:** Test user-performed sequences where you manually click each element

**Features:**

- Same textarea format as MultiStep
- System highlights each element
- **YOU** perform the action manually
- Moves to next step after you click
- 30-second timeout per step
- Shows current step hint

**Example Flow:**

```
1. Enter guided steps (same format as MultiStep)
2. Click "Start Guided"
3. System highlights first element
4. You click the highlighted element
5. System moves to next step
6. Repeat until complete
```

**Perfect for:**

- Testing hover-dependent UIs
- Verifying selectors match the right elements
- Learning the actual interaction flow

### 4. Watch Mode - Capture Selectors

**Purpose:** Click any element in Grafana to automatically generate its selector

**Features:**

- Toggle button: "Watch Mode: ON/OFF"
- Pulsing animation when active
- **Non-blocking** - clicks proceed normally while capturing
- Smart selector generation with hierarchy walking
- Shows selector method (data-testid, id, aria-label, etc.)
- Uniqueness badge (green = unique, orange = X matches)
- "Copy" button for clipboard
- "Use in Simple Tester" pre-fills the selector field
- Supports multiple test ID conventions

**Workflow:**

```
1. Click "Watch Mode: OFF" → turns ON
2. Click any element in Grafana
3. Selector appears instantly
4. See method badge and uniqueness
5. Click "Copy" or "Use in Simple Tester"
6. Click multiple elements (doesn't auto-disable)
7. Click "Watch Mode: ON" → turns OFF when done
```

**Selector Priority:**

1. `data-testid` / `data-cy` / `data-test-id` / `data-qa`
2. Non-auto-generated `id`
3. `aria-label`
4. `name` attribute (for inputs)
5. `href` (normalized pathname for links)
6. Button text (if unique and not generic)
7. Parent context + `:contains()`
8. Standalone `:contains()`
9. `:nth-of-type()` with parent context

### 5. Record Mode - Capture Sequences

**Purpose:** Record multi-step workflows automatically by clicking/filling in Grafana

**Features:**

- "Start Recording" / "Stop Recording" toggle
- Red blinking dot indicator
- Captures clicks instantly
- Captures form fills on blur/change (final value)
- Shows step count badge
- Displays recorded steps with:
  - Step number
  - Human-readable description
  - Code format (`action|selector|value`)
  - Delete button per step
- "Clear All" button
- "Copy All" button (clipboard)
- "Load into MultiStep" button (auto-fills MultiStep textarea)

**Workflow:**

```
1. Click "Start Recording" (red dot appears)
2. Perform actions in Grafana:
   - Click "Dashboards" menu
   - Fill search field: "Prometheus"
   - Click "Prometheus" result
3. Click "Stop Recording"
4. See 3 captured steps with selectors
5. Click "Load into MultiStep"
6. Click "Run MultiStep" to replay
```

**Action Detection:**

- `<input>`, `<textarea>`, `<select>` → `formfill`
- `<button>` with unique text → `button`
- `<button>` without unique text → `highlight`
- `<a href="http...">` → `navigate`
- `<a href="/...">` → `highlight`
- Everything else → `highlight`

**Smart Features:**

- Walks up DOM hierarchy to find interactive parents
- Filters out debug panel clicks
- Handles nested elements (icons inside buttons)
- Generates context-aware selectors

## Selector Generation Algorithm

The debug panel uses sophisticated selector generation powered by `src/utils/selector-generator.ts`.

### Hierarchy Walking

When you click an element, the system walks up the DOM tree (up to 5 levels) to find the best selectable parent:

**Example:** Clicking an SVG icon inside a navigation link

```html
<a data-testid="Nav menu item" href="/dashboards">
  <span><svg>...</svg></span>
  <span>Dashboards</span> ← You click here
</a>
```

**Process:**

1. Click on `<span>`
2. Walks up: `span` → `span` → `a` (has data-testid!) → STOP
3. Returns: `a[data-testid="Nav menu item"][href="/dashboards"]` ✅

### Scoring System

Elements are scored based on attribute quality:

- `data-testid`: +100 points (highest)
- Non-auto-generated `id`: +80 points
- `aria-label`: +70 points
- `name`: +60 points
- `href`: +55 points
- Tag type bonuses: `<a>` +40, `<button>` +35
- Tag penalties: `<span>` -20, `<div>` -15, `<svg>` -25

### Auto-Generated Detection

**Filters out:**

- Emotion classes (`css-*`)
- Long hashes (8+ alphanumeric)
- UUID patterns
- React-generated IDs (`react-*`, `id-123`)
- Utility classes (`flex`, `p-2`, `m-0`, etc.)

**Keeps:**

- BEM patterns (`block__element--modifier`)
- Simple kebab-case (`nav-menu`, `panel-header`)

### Text Handling

**Normalizes:**

- RTL/LTR marks (removed)
- Whitespace (collapsed to single space)
- Multi-line text (flattened)

**Generic word filter** (always need context):

```
'new', 'add', 'save', 'cancel', 'close', 'ok', 'yes', 'no',
'edit', 'delete', 'remove', 'update', 'submit', 'back', 'next'
```

### URL Handling

**Normalizes hrefs** to pathname only:

- Before: `a[href="/dashboard/new?orgId=1&from=now-6h"]`
- After: `a[href="/dashboard/new"]`

Drops query strings and hashes for stability.

### Fallback Chain

1. Test ID (`data-testid`, `data-cy`, `data-test-id`, `data-qa`, `data-test-subj`)
2. Non-auto-generated ID
3. `aria-label`
4. `name` (inputs)
5. `href` (normalized)
6. Unique button text
7. Parent context + `:contains()`
8. Standalone `:contains()`
9. Parent + `:nth-of-type()`
10. Tag only (last resort)

**Guarantees a result** - no element is ever un-selectable!

## Action Detection Algorithm

The debug panel automatically detects appropriate action types using `src/utils/action-detector.ts`.

### Detection Rules

```typescript
// Form elements
<input> / <textarea> / <select> → formfill

// Buttons
<button> with unique text → button
<button> without unique text → highlight

// Links
<a href="http://external.com"> → navigate
<a href="/internal"> → highlight

// Everything else
* → highlight
```

### Smart Features

**Hierarchy Walking:**

- Clicks on icons/spans find parent buttons/links
- Walks up 5 levels to find interactive elements
- Returns first interactive parent found

**Always Captures** (except):

- Clicks within debug panel itself
- Modal backdrops
- Blocking overlays

## Real-World Examples

### Example 1: Navigation Link

**HTML:**

```html
<a data-testid="data-testid Nav menu item" href="/dashboards">
  <span class="css-abc123">
    <svg>...</svg>
  </span>
  <span>Dashboards</span>
</a>
```

**Watch Mode Result:**

```
Selector: a[data-testid="data-testid Nav menu item"][href="/dashboards"]
Method: data-testid
Uniqueness: Unique ✓
```

### Example 2: Generic Button

**HTML:**

```html
<div data-testid="toolbar">
  <button class="css-xyz123">New</button>
</div>
```

**Watch Mode Result:**

```
Selector: div[data-testid="toolbar"] button:contains("New")
Method: contains
Uniqueness: Unique ✓
```

### Example 3: Data Source Button

**HTML:**

```html
<div data-testid="data-source-card">
  <button>
    gdev-testdata
    <ul>
      <li>default</li>
    </ul>
  </button>
</div>
```

**Watch Mode Result:**

```
Selector: div[data-testid="data-source-card"] button:contains("gdev-testdata default")
Method: contains
Uniqueness: Unique ✓
```

### Example 4: Visualization Picker

**HTML:**

```html
<div aria-label="Plugin visualization item Stat" data-testid="Plugin visualization item Stat">
  <img src=".../stat.svg" />
  <div>Stat</div>
  <span>Big stat values & sparklines</span>
</div>
```

**Watch Mode Result:**

```
Selector: div[data-testid="Plugin visualization item Stat"]
Method: data-testid
Uniqueness: Unique ✓
```

## Best Practices

### Using Watch Mode

1. **Enable once, capture multiple** - Watch Mode stays ON for multiple captures
2. **Click anywhere** - Even icons, spans, or deeply nested elements
3. **Check uniqueness** - Green badge = good to use, orange = may need refinement
4. **Copy immediately** - Selectors are captured even if page navigates

### Using Record Mode

1. **Clear workflow** - Record complete workflows in one session
2. **Natural interaction** - Clicks and fills work normally while recording
3. **Review before using** - Check generated selectors for accuracy
4. **Edit if needed** - Delete unwanted steps, adjust order
5. **Test in MultiStep** - Load and run to verify the sequence works

### Selector Quality Checks

**Good selectors:**

- ✅ Use `data-testid` or other test attributes
- ✅ Include normalized hrefs for links
- ✅ Have parent context for generic elements
- ✅ Are unique (green badge)

**Acceptable selectors:**

- ⚠️ Use `:contains()` with stable text
- ⚠️ Multiple matches (orange badge) - may need refinement
- ⚠️ Use `:nth-of-type()` - fragile but works

**Avoid manually creating:**

- ❌ Selectors with `css-*` classes
- ❌ Long auto-generated IDs
- ❌ Utility classes like `flex`, `p-2`

### Development Workflow

**Recommended process:**

1. **Record Mode** - Capture workflow automatically
2. **Review** - Check generated selectors
3. **Refine** - Use Watch Mode to improve specific selectors
4. **Test** - Run in MultiStep Debug
5. **Verify** - Test in actual tutorial
6. **Document** - Add to tutorial content

## Technical Details

### Browser Compatibility

**Works in:**

- Chrome/Edge 90+
- Firefox 90+
- Safari 15+

**Requirements:**

- Event capture phase support
- `querySelectorAll` API
- `clipboard.writeText()` for copy features

### Performance

**Optimized for:**

- Real-time selector generation (< 5ms)
- Non-blocking event capture
- Minimal DOM queries
- Efficient hierarchy walking

**Limitations:**

- Maximum 5-level hierarchy walk
- Text limited to 50 characters for `:contains()`
- 300px max height for recorded steps list

### Integration with Interactive System

The debug panel uses the same infrastructure as production tutorials:

**Shared Components:**

- `querySelectorAllEnhanced()` - Enhanced selector engine
- `executeInteractiveAction()` - Action execution
- `NavigationManager` - Element highlighting
- `INTERACTIVE_CONFIG` - Timing configuration

**Benefits:**

- Selectors tested in debug panel work in tutorials
- Same action types and behavior
- Consistent timing and delays
- Real production environment testing

## Advanced Features

### Multi-Convention Test ID Support

Supports test IDs from multiple frameworks:

- `data-testid` (Grafana standard)
- `data-cy` (Cypress)
- `data-test-id` (Jest)
- `data-qa` (QA tools)
- `data-test-subj` (Elastic)

### Copy Button Feedback

All copy buttons show visual feedback:

- Turns green ✓
- Icon changes to checkmark
- Text changes to "Copied!"
- Automatically resets after 2 seconds
- Smooth scale animation

### Text Wrapping

Long selectors automatically wrap:

- Word-break at boundaries
- Monospace font for readability
- Max width constraints
- Horizontal scroll prevention

## Troubleshooting

### Watch Mode Not Capturing

**Problem:** Clicking elements doesn't capture selectors

**Solutions:**

1. Ensure Watch Mode is ON (pulsing button)
2. Check you're not clicking inside the debug panel
3. Try clicking different parts of the element
4. Some elements may be in iframes (not supported)

### Record Mode Missing Clicks

**Problem:** Clicks aren't being recorded

**Solutions:**

1. Ensure Record Mode is ON (red dot visible)
2. Check element is interactive (button, link, input)
3. Verify not clicking modal backdrops
4. Some rapid clicks may be debounced

### Selector Doesn't Work in Tutorial

**Problem:** Captured selector fails when used in tutorial

**Solutions:**

1. Check uniqueness badge - orange means multiple matches
2. Test selector in Simple Tester first
3. Add parent context if needed
4. Verify element exists when tutorial runs

### Generic Button Text

**Problem:** Getting just `New` or `Save` instead of better selectors

**Solutions:**

1. ✅ This is now `button:contains("New")` which works!
2. If parent has data-testid, will be scoped: `div[data-testid="..."] button:contains("New")`
3. Generic words always use `:contains()` format

## API Reference

### Exported Utilities

```typescript
// From src/utils/selector-generator.ts
export function generateBestSelector(element: HTMLElement): string;
export function getSelectorInfo(element: HTMLElement): {
  selector: string;
  method: string;
  isUnique: boolean;
  matchCount: number;
};

// From src/utils/action-detector.ts
export function detectActionType(element: HTMLElement, event?: Event): DetectedAction;
export function getActionDescription(action: DetectedAction, element: HTMLElement): string;
export function shouldCaptureElement(element: HTMLElement): boolean;
```

### Usage in Other Contexts

These utilities are fully generic and can be used outside the debug panel:

```typescript
import { generateBestSelector, getSelectorInfo } from '@/utils/selector-generator';

// E2E testing
const selector = generateBestSelector(myElement);
await page.locator(selector).click();

// Analytics
const info = getSelectorInfo(clickedElement);
analytics.track('click', {
  selector: info.selector,
  method: info.method,
  unique: info.isUnique,
});

// Browser extensions
document.addEventListener('click', (e) => {
  const selector = generateBestSelector(e.target as HTMLElement);
  console.log('Clicked:', selector);
});
```

## Configuration

### Timing Configuration

Adjust timing in `src/constants/interactive-config.ts`:

```typescript
delays: {
  multiStep: {
    defaultStepDelay: 1800,  // Delay between steps
    showToDoIterations: 18,   // Show→Do delay (18 × 100ms)
    baseInterval: 100,        // Base interval
  }
}
```

### Selector Generation Tuning

Modify `src/utils/selector-generator.ts`:

```typescript
// Add custom generic words
const genericWords = ['new', 'add', 'save' /* add more */];

// Adjust hierarchy depth
function findBestElementInHierarchy(element: HTMLElement, maxDepth = 5);

// Add custom test ID conventions
const testIdAttrs = ['data-testid', 'data-cy' /* add more */];
```

## Contributing

When you discover good selector patterns:

1. Document them in `docs/interactive-examples/selectors-and-testids.md`
2. Share findings with the team
3. Consider adding to selector generator priorities
4. Update bundled tutorials with improved selectors

The DOM Selector Debug Panel is your essential tool for rapid interactive tutorial development! 🎯
