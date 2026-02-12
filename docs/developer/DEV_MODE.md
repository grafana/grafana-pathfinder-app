# Dev mode

Dev mode is a per-user feature that enables developer/testing capabilities like the DOM Selector Debug Panel.

## Key features

- **Per-user scoping**: Stored in plugin jsonData (server-side), but scoped to specific user IDs via `devModeUserIds`
- **Persistent**: Survives across page navigations, sessions, and browser restarts (server-side storage)
- **Admin-controlled**: Only users with admin permissions can modify plugin settings
- **Non-intrusive**: Only the user(s) whose ID is in the `devModeUserIds` array see dev features

## Enabling dev mode

### Show the dev mode toggle

Add `?dev=true` to the plugin configuration URL to reveal the dev mode toggle:

```
/plugins/grafana-pathfinder-app?tab=configuration&dev=true
```

**Note**: The URL parameter only makes the toggle visible - it does NOT enable dev mode automatically.

### Enable dev mode

1. Visit the plugin configuration page with `?dev=true`
2. Check the "Dev mode (per-user)" checkbox
3. The setting is saved to plugin jsonData on the server (requires admin permissions)
4. The page reloads to apply changes globally
5. Navigate to any page - the debug panel will be visible on all pages

## Using dev mode

When dev mode is enabled:

- **Debug panel**: The DOM Selector Debug Panel appears at the bottom of the context panel
- **Advanced configuration**: Additional plugin configuration fields become visible (recommender service URL, etc.)
- **Experimental features**: Live sessions and Coda terminal sections appear on the configuration page
- **Cross-page**: Works on all pages, not just where you enabled it

## Disabling dev mode

You can disable dev mode in two ways:

### From configuration page

1. Visit the plugin configuration page (the dev mode checkbox will be visible if dev mode is enabled)
2. Uncheck the "Dev mode (per-user)" checkbox
3. The page reloads with dev mode disabled

### From debug panel (quick disable)

1. Click the "Leave dev mode" button at the top of the debug panel
2. The page will reload with dev mode disabled

## Technical implementation

### Storage

Dev mode state is stored in **plugin jsonData** (server-side, in Grafana's database) using two fields:

- `devMode: boolean` - Whether dev mode is enabled for the instance
- `devModeUserIds: number[]` - Array of user IDs who have dev mode access

Both fields are written via `updatePluginSettings()` in `src/utils/utils.plugin.ts`. This ensures:

- Tamper-proof storage (cannot be manipulated via browser DevTools)
- Admin-only modification (requires plugin settings permissions)
- Multi-user support (multiple developers can have access simultaneously)

### Security model

The `isDevModeEnabled()` check requires **both** conditions to be true:

1. `devMode` is `true` in jsonData
2. The current user's ID is in the `devModeUserIds` array

This hybrid approach provides instance-wide storage with per-user scoping.

### Utilities

Located in `src/utils/dev-mode.ts`:

| Function                                     | Purpose                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `isDevModeEnabled(config, userId?)`          | Check if dev mode is active for a specific user                                       |
| `enableDevMode(userId, userIds?)`            | Add a user to the dev mode access list (async, writes to server)                      |
| `disableDevMode()`                           | Disable dev mode for all users (clears flag and user list)                            |
| `disableDevModeForUser(userId, userIds?)`    | Remove a specific user from the access list                                           |
| `toggleDevMode(userId, state, userIds?)`     | Toggle dev mode on/off for a specific user                                            |
| `isDevModeEnabledGlobal()`                   | Simplified check using `window.__pathfinderPluginConfig` (no config param needed)     |
| `isAssistantDevModeEnabled(config, userId?)` | Check if assistant dev mode is enabled (requires dev mode + `enableAssistantDevMode`) |
| `isAssistantDevModeEnabledGlobal()`          | Global check for assistant dev mode                                                   |

### Assistant dev mode

A sub-feature of dev mode that mocks the Grafana Assistant in OSS environments. When enabled:

- The assistant popover appears on text selection
- Prompts are logged to console instead of opening the real assistant
- Controlled by `enableAssistantDevMode` in plugin jsonData
- Only visible when the parent dev mode is also enabled

Enable via the "Enable Assistant (Dev Mode)" checkbox on the configuration page (visible only when dev mode is active).

## Use cases

- **Testing interactive elements**: Use the debug panel to test selectors and interactive actions
- **Guide development**: Record and export guide steps
- **Selector generation**: Generate optimal selectors for DOM elements
- **Action detection**: Analyze what actions can be performed on elements
- **Assistant testing**: Test assistant integration in OSS without Grafana Cloud
