# DOM selector debug panel

A developer tool panel for creating interactive guides within Grafana.

## Enabling debug mode

### 1. Access plugin configuration

Navigate to the plugin configuration page with the dev mode parameter:

```
https://your-grafana.com/a/grafana-pathfinder-app?page=configuration&dev=true
```

### 2. Enable dev mode

1. Check the **"Dev Mode"** checkbox
2. Click **"Save configuration"**
3. Page will reload automatically

### 3. Access debug panel

1. Open the **Pathfinder sidebar** (click the book icon)
2. Stay on the **"Recommendations"** tab
3. Scroll to the bottom
4. You'll see **"DOM Selector Debug"** with an orange "Dev Mode" badge

## Debug panel features

The debug panel provides two main tools for guide development:

### 1. Interactive guide editor

The main authoring tool for creating and editing JSON guides.
This block-based editor provides a visual interface for composing guides from different block types.

Features:

- Visual block editor for guide composition
- Support for all block types (text, interactive, multistep, guided, section, etc.)
- Import/export JSON guides
- Preview mode
- GitHub PR integration

### 2. URL tester

A utility for testing URL patterns and verifying which documentation pages match specific URLs.

## Development workflow

**Recommended process:**

1. Open the **Interactive guide editor**
2. Create or import a guide
3. Use the block palette to add content blocks
4. Test with preview mode
5. Export JSON or create GitHub PR
