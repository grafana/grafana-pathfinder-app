# Dev mode

Dev mode enables developer and testing capabilities such as the DOM selector debug panel. It is gated twice, and both gates must be open before a single developer surface appears.

## The two gates

| Gate           | Scope           | Stored in                                                                                               | Who can change it                            |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `devMode`      | The whole stack | The `PathfinderSettings` App Platform resource, falling back to plugin `jsonData` where it isn't served | Anyone who can write plugin settings (admin) |
| `devModeOptIn` | This browser    | `localStorage`, via `src/lib/dev-mode-opt-in.ts`                                                        | The person at the keyboard                   |

`isDevModeEnabled()` requires both. An admin therefore keeps an instance-level veto — closing `devMode` hides developer surfaces for everyone, whatever they have opted into locally — while an individual's choice stays their own and never becomes an org-wide write.

### Why the opt-in is per-browser

It used to be a `devModeUserIds: number[]` array in plugin `jsonData`: a per-user allow-list kept in an org-wide, provisioning-owned blob. Grafana replaces `jsonData` wholesale on every write, so opting one person in rewrote every plugin setting — which is how toggling dev mode once unpinned the plugin from the nav (`aa1c2efd`).

`localStorage` was chosen over the hybrid user-storage layer for two reasons, both recorded in `src/lib/dev-mode-opt-in.ts`: the config bootstrap and `isDevModeEnabledGlobal()` are synchronous and `module.tsx` is on the critical path, and importing `lib/user-storage` would drag zod into `module.js`. The repo already keeps dev/debug toggles locally — see `StorageKeys.FLAG_OVERRIDES`.

The trade-off is deliberate: the opt-in does not follow you between browsers or devices. Re-enabling is one click.

### Upgrading from `devModeUserIds`

On the first load after upgrade, a browser that has recorded no choice of its own adopts an existing `devModeUserIds` entry for the signed-in user, and writes it through. That write is what makes it a migration rather than a rule: nothing ever clears `devModeUserIds`, so re-deriving from it on every publish would undo a later opt-out forever. Once this browser has recorded a choice — including an explicit "off" — the legacy array is never read again.

## Enabling dev mode

1. Add `?dev=true` to the plugin configuration URL to reveal the dev-mode controls:

   ```
   /plugins/grafana-pathfinder-app?tab=configuration&dev=true
   ```

   The URL parameter only makes the controls visible; it does not enable anything.

2. Tick **Dev mode**. This records your opt-in for this browser and, if the stack gate is still closed, opens it — writing only your half would leave the switch visibly doing nothing on a stack that has never had dev mode.

3. The page reloads and developer surfaces appear on every page.

**Dev mode for this stack** is the separate admin control for the gate itself. Turning it off hides developer surfaces for every user regardless of their own opt-in; turning it on does nothing on its own until someone also opts in.

## Using dev mode

When dev mode is enabled:

- **Debug panel**: the DOM selector debug panel appears at the bottom of the context panel
- **Advanced configuration**: extra plugin configuration fields become visible (recommender service URL, and so on)
- **Experimental sections**: live sessions and Coda terminal configuration sections appear on the configuration page (the features themselves are gated by their own toggles)
- **PR tester and URL tester**: diagnostic tools appear in the editor panel for testing guide URLs and PR previews
- **Cross-page**: works on all pages, not just where you enabled it

{{< admonition type="note" >}}
The block editor and kiosk mode used to require dev mode. Both are now public:

- The **block editor** is available to editors and admins through the dedicated **Editor** tab in the docs panel (since v2.8).
- **Kiosk mode** is gated by the `enableKioskMode` plugin setting (since v2.6).

Dev mode is no longer required for either.
{{< /admonition >}}

## Disabling dev mode

### For yourself

Untick **Dev mode** on the configuration page, or click **Leave dev mode** at the top of the debug panel. Either clears this browser's opt-in and reloads. Nobody else is affected, and the stack gate is left open for them.

### For the whole stack

Untick **Dev mode for this stack**. Every user's developer surfaces close immediately, whatever they have opted into.

## Technical implementation

### Utilities

Located in `src/utils/dev-mode.ts`:

| Function                               | Purpose                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `isDevModeEnabled(config)`             | Both gates, resolved synchronously from the published config               |
| `enableDevMode()` / `disableDevMode()` | Record this browser's opt-in. Neither touches the stack gate               |
| `toggleDevMode(currentState)`          | Flip this browser's opt-in and return the new value                        |
| `resolveDevModeOptIn()`                | Tri-state read for the config layer: `undefined` means "never chosen here" |
| `hasLegacyDevModeOptIn(config)`        | Whether a pre-migration `devModeUserIds` entry covers the signed-in user   |
| `adoptLegacyDevModeOptIn()`            | The one-shot write that retires that entry for this browser                |
| `isDevModeEnabledGlobal()`             | Simplified check using `window.__pathfinderPluginConfig`                   |
| `isAssistantDevModeEnabled(config)`    | Dev mode plus `enableAssistantDevMode`                                     |
| `isAssistantDevModeEnabledGlobal()`    | Global check for assistant dev mode                                        |

The stack gate is a tenant setting, so it is written through `saveTenantSettings` (`src/components/AppConfig/save-settings.ts`) like any other — never from `dev-mode.ts`.

### Assistant dev mode

A sub-feature that mocks the Grafana Assistant in OSS environments. When enabled:

- The assistant popover appears on text selection
- Prompts are logged to the console instead of opening the real assistant
- Controlled by `enableAssistantDevMode`, a tenant setting like `devMode`
- Only visible when the parent dev mode is also enabled

Enable it with the **Enable Assistant (Dev Mode)** checkbox on the configuration page, visible only when dev mode is active.

## Use cases

- **Testing interactive elements**: use the debug panel to test selectors and interactive actions
- **Guide development**: record and export guide steps
- **Selector generation**: generate optimal selectors for DOM elements
- **Action detection**: analyze what actions can be performed on elements
- **Assistant testing**: test assistant integration in OSS without Grafana Cloud
