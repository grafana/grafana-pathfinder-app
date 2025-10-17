# Dev Mode

Dev mode is a per-user feature that enables developer/testing capabilities like the DOM Selector Debug Panel.

## Key Features

- **Per-User**: Stored in browser localStorage, not instance-wide plugin settings
- **Persistent**: Stays enabled across page navigations and sessions
- **Non-Intrusive**: Only affects the user who enables it, not other users of the same Grafana instance

## Enabling Dev Mode

### Show the Dev Mode Toggle

Add `?dev=true` to the plugin configuration URL to reveal the dev mode toggle:

```
/plugins/grafana-pathfinder-app?tab=configuration&dev=true
```

**Note**: The URL parameter only makes the toggle visible - it does NOT enable dev mode automatically.

### Enable Dev Mode

1. Visit the plugin configuration page with `?dev=true`
2. Check the "Dev Mode (Per-User)" checkbox
3. The setting is immediately saved to your browser's localStorage
4. Navigate to any page - the debug panel will be visible on all pages

## Using Dev Mode

When dev mode is enabled:

- **Debug Panel**: The DOM Selector Debug Panel appears at the bottom of the context panel
- **Components Page**: A special "Components" recommendation appears for testing
- **Cross-Page**: Works on all pages, not just where you enabled it

## Disabling Dev Mode

You can disable dev mode in two ways:

### From Configuration Page

1. Visit the plugin configuration page (the dev mode checkbox will be visible if dev mode is enabled)
2. Uncheck the "Dev Mode (Per-User)" checkbox
3. Dev mode is immediately disabled

### From Debug Panel (Quick Disable)

1. Click the "Leave Dev Mode" button at the top of the debug panel
2. The page will reload with dev mode disabled (no confirmation needed)

## Technical Implementation

### Storage

Dev mode state is stored in `localStorage` under the key `grafana-pathfinder-dev-mode`.

### Utilities

Located in `src/utils/dev-mode.ts`:

- `isDevModeEnabled()`: Check if dev mode is active
- `enableDevMode()`: Enable dev mode for current user
- `disableDevMode()`: Disable dev mode for current user
- `toggleDevMode()`: Toggle dev mode state

### Migration from Plugin Settings

Previously, dev mode was stored in plugin settings (jsonData), which affected all users instance-wide.
The setting has been deprecated in plugin settings and migrated to localStorage for per-user control.

The `devMode` field in `DocsPluginConfig` is now deprecated and always returns `false`.
Use `isDevModeEnabled()` from `utils/dev-mode.ts` instead.

## Use Cases

- **Testing Interactive Elements**: Use the debug panel to test selectors and interactive actions
- **Tutorial Development**: Record and export tutorial steps
- **Selector Generation**: Generate optimal selectors for DOM elements
- **Action Detection**: Analyze what actions can be performed on elements
