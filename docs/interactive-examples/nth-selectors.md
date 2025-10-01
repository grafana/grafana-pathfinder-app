# Understanding :nth-child vs :nth-match Selectors

## The Problem with :nth-child()

When you write a selector like:

```css
div[data-testid='uplot-main-div']: nth-child(3);
```

You might expect it to find "the 3rd div with that test ID", but **that's not how CSS works**.

### What :nth-child() Actually Does

`:nth-child(3)` means: **"Match this element ONLY IF it is the 3rd child of its parent"**

#### Example That Fails:

```html
<div class="parent1">
  <div data-testid="uplot-main-div">First uplot</div>
</div>
<div class="parent2">
  <div data-testid="uplot-main-div">Second uplot</div>
</div>
<div class="parent3">
  <div data-testid="uplot-main-div">Third uplot</div>
</div>
```

Using `div[data-testid='uplot-main-div']:nth-child(3)` returns **nothing** because:

- The first div is the 1st child of parent1 ❌
- The second div is the 1st child of parent2 ❌
- The third div is the 1st child of parent3 ❌
- None of them are the 3rd child of their parent!

#### Example That Works:

```html
<div class="parent">
  <span>First child</span>
  <p>Second child</p>
  <div data-testid="uplot-main-div">Third child - this matches!</div>
</div>
```

Now `div[data-testid='uplot-main-div']:nth-child(3)` **works** because the div is actually the 3rd child of its parent.

### What about :nth-of-type()?

`:nth-of-type(3)` means: **"Match this element ONLY IF it is the 3rd element of its TYPE within its parent"**

This has the same limitation - it still looks at position within a parent, not globally.

## The Solution: :nth-match()

We've added a **custom pseudo-selector** `:nth-match(n)` that does what you probably want:

**`:nth-match(3)` means: "Find ALL elements matching this selector, then return the 3rd one"**

### Usage Examples

#### Get the 3rd uplot globally:

```html
<li class="interactive" data-targetaction="highlight" data-reftarget='div[data-testid="uplot-main-div"]:nth-match(3)'>
  Highlight the third chart on the page
</li>
```

#### Get the 1st occurrence (equivalent to :first-of-type globally):

```html
<li class="interactive" data-targetaction="focus" data-reftarget='div[data-testid="uplot-main-div"]:nth-match(1)'>
  Focus on the first chart
</li>
```

#### Get the 2nd button with a specific class:

```html
<li class="interactive" data-targetaction="button" data-reftarget="button.save-button:nth-match(2)">
  Click the second save button
</li>
```

## Quick Reference

| Selector             | What it means                                             | Use case                                                             |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `div:nth-child(3)`   | Element that is the 3rd child of its parent               | When you know the element's position in its parent                   |
| `div:nth-of-type(3)` | Element that is the 3rd div child of its parent           | When you know the element's position among siblings of the same type |
| `div:nth-match(3)`   | The 3rd div matching this selector in the entire document | **When you want the nth occurrence globally** ⭐                     |

## Browser Support

- `:nth-child()` and `:nth-of-type()` are standard CSS and work natively in all browsers
- `:nth-match()` is a custom implementation that uses `querySelectorAll` under the hood and works in all browsers through our enhanced selector engine

## Troubleshooting

### "No elements found" error

If you're getting "No elements found" when using `:nth-match(3)`, check:

1. **Does the base selector find any elements?**

   ```javascript
   // In browser console:
   document.querySelectorAll('div[data-testid="uplot-main-div"]').length;
   ```

2. **Are there at least 3 matches?**
   - `:nth-match(3)` needs at least 3 elements to exist
   - The error message will tell you how many were found: `wanted 3, found 2`

3. **Are the elements loaded yet?**
   - Add requirements to wait for page load: `data-requirements="location-match:/dashboards"`

### Still having issues?

Check the browser console for detailed error messages. The enhanced selector engine logs:

- What selector was used
- How many elements were found
- Whether fallback implementations were used
