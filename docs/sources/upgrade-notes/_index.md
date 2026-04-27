---
title: Upgrade notes
menuTitle: Upgrade notes
description: Important information about upgrading Interactive learning, including breaking changes and migration guides.
weight: 100
---

# Upgrade notes

This section contains the headline changes for each Interactive learning release, including breaking changes and migration steps. For the full per-release detail, see the project [CHANGELOG](https://github.com/grafana/grafana-pathfinder-app/blob/main/CHANGELOG.md).

## Version 2.9: Floating panel and popout step

**Released April 2026.**

### What changed

- **Floating panel mode** — Users can pop the docs panel out of the sidebar into a free-floating, resizable, draggable window. Click the **Pop out** button at the top of the panel to detach, drag it anywhere, resize from any edge, or minimize to a pill. Click again or drag back to the right edge to dock it.
- **Popout step type** — Guide authors can now build a `popout` action into a guide step so the panel automatically docks or undocks at the right moment. Useful when a guide step needs the right sidebar for something else (for example, Grafana Assistant). Configured from the block editor with a single dropdown (`floating` or `sidebar`).

### Action required

None — both features ship enabled and require no configuration.

## Version 2.8: Block editor available without dev mode

**Released April 2026.**

### What changed

- **Block editor moved out of dev mode** — Editors and admins can now access the block editor through a dedicated **Editor** tab in the docs panel, without enabling dev mode. The Editor tab is permission-gated and only appears for users with editor or admin role.
- **Combobox formfill fix** — Form-fill steps that target a Grafana combobox now open the dropdown before entering tokens, fixing intermittent step-completion failures.
- **Kiosk session ID tracking** — Kiosk mode now emits session IDs for analytics.

### Action required

If your team has documentation referencing "enable dev mode to access the block editor," update it — dev mode is no longer required.

## Version 2.7: Package engine integration

**Released March 2026.**

### What changed

- **Package engine integration** — The full package pipeline (composite resolver, package-aware fetching, milestone resolution) is wired into the recommendation panel. Recommendations from the recommender are resolved through this pipeline, falling back to bundled and CDN-served packages as needed.
- **Package completion tracking** — Per-package completion state and navigation links between related packages are persisted across sessions and surfaced in the docs panel.
- **Package pill icon** — Recommendations backed by a package now show a distinct pill icon, so users can tell at a glance whether a card is a single guide or a learning path.
- **Recommender URL auto-selection** — The plugin now picks the right recommender API URL automatically based on the Grafana instance's hostname (production / ops / development). Administrators can still override the URL in plugin settings.

### Action required

If you author **path** or **journey** packages, the manifest field that lists child guides is `steps` and the runtime concept that displays them is `milestones`. No manifest migration is required, but be aware of the terminology when reading docs and code.

## Version 2.6: Kiosk mode without dev mode

**Released March 2026.**

### What changed

- **Kiosk mode no longer requires dev mode** — Administrators can enable kiosk mode through the `enableKioskMode` toggle in plugin settings. The kiosk button appears in the sidebar header for all users on instances where it's enabled.
- **Open guide after navigate step** — A `navigate` step can now open a guide in the sidebar after the SPA navigation completes (using a new `openGuide` field). Backward-compatible: existing `?doc=` query parameters in target URLs are detected automatically.
- **Selector picker scoping fixes** — The element picker no longer picks form controls outside the immediate hover area, preventing surprising selector results when authoring guides with the block editor.
- **Plugin settings data-loss fix** — Saving any single configuration tab no longer wipes settings from other tabs. This was a Cloud-deployment regression triggered by version updates.

### Action required

If you previously enabled kiosk mode through dev mode, you can now enable it directly from the plugin settings page. The settings UI exposes the `enableKioskMode` toggle in the **Interactive Features** tab.

## Version 2.5: Selector resilience engine

**Released February 2026.**

### What changed

- **Selector resilience engine** — Single-pass selector resolution has been replaced with a multi-strategy pipeline:
  - `resolveWithRetry()` exponential backoff (200 ms / 600 ms / 1.8 s).
  - `:text()` exact match for short button labels (under 20 characters), eliminating false positives.
  - `data-testid` prefix matching when exact match fails (uniqueness-guarded).
  - `panel:` domain selector prefix to resolve Grafana panels by title.
  - Unified resolver with confidence scoring.
- **Selector Health badge** — An inline indicator (green / yellow / red dot, stability score, match count) on every selector field in the block editor.
- **Test selector button** — Evaluates the selector against the live DOM and flash-highlights the matched elements with numbered overlays.
- **Shift+Click hover capture** — Hold Shift during recording to capture a hover step without clicking through.
- **Alt+Click form capture** — Hold Alt during recording to force-capture any element as a form-fill, with the typed value picked up on blur.
- **Auto-populate requirements** — Recorded steps auto-populate `exists-reftarget` and `navmenu-open` requirements when relevant.

### Action required

None — existing guides benefit from the resilient resolver without any changes. If you authored guides relying on substring matches for short button labels, you may notice fewer false positives.

## Version 2.4: Kiosk mode and Coda Alloy scenarios

**Released January–February 2026.**

### What changed

- **Kiosk mode** — A full-screen overlay that presents interactive guide tiles over Grafana, configured through the **Interactive Features** tab. Initially gated behind dev mode, then opened up in v2.6.
- **Custom guide deep links** — `?doc=api:<resourceName>` opens a custom guide stored as a backend resource.
- **Navigate handler path validation** — Internal navigation paths are validated against denied routes (`/logout`, `/profile/password`, `/admin/*`, `/api/*`). Admin users can still navigate to admin-only paths since RBAC is enforced server-side.
- **Alloy scenario VM template** — `vm-aws-alloy-scenario` template for the Coda terminal, with animated progress bar during provisioning, quota cleanup, and persistent VM options for auto-reconnect on refresh.

### Action required

None — these features ship enabled and require no configuration. The navigate path validation is a defense-in-depth measure and does not affect well-formed guides.

## Earlier upgrades

For releases before v2.4, see the [CHANGELOG](https://github.com/grafana/grafana-pathfinder-app/blob/main/CHANGELOG.md). Notable earlier highlights:

- **v2.3.6** — `pathfinder.enabled` global kill-switch feature flag for Cloud-wide rollout control. Workshop ECDSA P-256 presenter authentication for Live sessions.
- **v2.3.0** — `terminal-connect` block type for guides; block editor lifecycle redesigned around a single smart primary button (Save as draft → Update draft → Publish → Update).
- **v2.2.1** — Draft and publish lifecycle for library guides in the block editor.
- **v2.2.0** — `code-block` block type with syntax highlighting, copy-to-clipboard, and step completion.

## Version 1.1.83: New content delivery infrastructure

{{< admonition type="warning" >}}
**Breaking change:** You must upgrade to version 1.1.83 or later to continue loading interactive guides.
{{< /admonition >}}

Starting with version 1.1.83, interactive guides are served from a dedicated content delivery network (CDN) instead of GitHub raw URLs:

| Environment | Domain                                 |
| ----------- | -------------------------------------- |
| Production  | `interactive-learning.grafana.net`     |
| Development | `interactive-learning.grafana-dev.net` |
| Operations  | `interactive-learning.grafana-ops.net` |

### Why

- **Improved reliability** — Dedicated infrastructure for serving interactive content.
- **Better performance** — Optimized CDN delivery for faster content loading.
- **Simplified architecture** — No backend proxy routes for content fetching.

### Migration steps

1. Update the Interactive learning plugin to version 1.1.83 or later.
2. Restart your Grafana instance.
3. Verify guides load correctly by opening the Interactive learning sidebar.

For content creators: no changes required to your content. The CDN serves the same JSON format used previously. GitHub raw URLs (`raw.githubusercontent.com`) are still supported in dev mode for testing.

### Getting help

If you encounter issues after upgrading, verify you're on 1.1.83 or later, check the browser console for specific errors, and report issues on the [GitHub repository](https://github.com/grafana/grafana-pathfinder-app/issues).
