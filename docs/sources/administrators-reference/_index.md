---
title: Administrators reference
menuTitle: Administrators reference
description: Learn about the administrators features of the Interactive learning plugin.
weight: 1
---

# Administrators reference

This section covers the administrator features of the Interactive learning plugin. These features allow Grafana administrators to tailor the Interactive learning plugin to the needs of Grafana users.

## Accessing the configuration page

You can access the configuration page in two ways:

1. Click the settings gear icon in the top right corner of the expanded Interactive learning sidebar.
2. Navigate to **Administration** > **Plugins and data** > **Plugins**, search for "Interactive learning".

## Configuration options

The plugin page contains several tabs that control different aspects of the Interactive learning plugin.

### Recommendations

The recommender service provides personalized documentation recommendations based on your current context in Grafana.
When disabled, Interactive learning only displays bundled examples and static recommendations.

**To enable the recommender service:**

1. Review the data usage information to understand what data is collected and how it's used.
2. Toggle **Enable context-aware recommendations** to enable the service.
3. Click **Save settings**.

When you enable the recommender service, Interactive learning sends contextual data to Grafana's hosted recommendation service.
The service uses this data to provide personalized documentation recommendations.
For more information about data collection and privacy, refer to the data usage details in the configuration page and the [Architecture](/docs/grafana/latest/pathfinder/architecture/) documentation.

{{< admonition type="note" >}}
The recommender service is enabled by default for Grafana Cloud instances.
For open source Grafana instances, administrators must enable it manually.
{{< /admonition >}}

The recommender service URL is auto-selected based on the Grafana instance hostname (production, ops, or development). Most administrators do not need to change it.

### Custom guides (block editor)

Editors and admins can author custom interactive guides directly inside Grafana with the block editor and publish them to the docs panel for everyone on the instance. The block editor is available from the **Editor** tab in the docs panel — no dev mode is required. Permissions are enforced by Grafana role: only users with editor or admin role see the Editor tab and can publish guides.

For the end-user authoring workflow, refer to the [Block editor guide](../block-editor/).

### Auto-launch guide URL

You can configure a guide or documentation page to automatically open when users open the Interactive learning sidebar.
This feature is useful for demo scenarios or onboarding new users.

**To configure auto-launch:**

1. Navigate to the **Plugin Configuration** section.
2. Enter the full URL of a learning path or documentation page in the **Auto-launch guide URL** field.
3. Click **Save configuration**.

Example URL:

- `https://grafana.com/tutorials/grafana-fundamentals/`

### Global link interception (Experimental)

Global link interception allows Interactive learning to intercept documentation links anywhere in Grafana and open them in the sidebar instead of a new tab.

{{< admonition type="warning" >}}
This is an experimental feature and may not work with all documentation links.
{{< /admonition >}}

**To enable global link interception:**

1. Navigate to the **Global Link Interception** section in the configuration page.
2. Toggle **Intercept documentation links globally** to enable the feature.
3. Click **Save configuration**.

When enabled, clicking documentation links anywhere in Grafana automatically opens the sidebar and displays the documentation inside.
If the sidebar hasn't fully loaded, links are queued and opened when ready.

**Keyboard modifiers:**

You can override link interception using keyboard modifiers:

- Hold **Ctrl** (Windows/Linux) or **Cmd** (Mac) while clicking to open links in a new tab instead.
- Middle-click also opens links in a new tab.

### Open panel on launch

You can configure Interactive learning to automatically open when users first load Grafana.

{{< admonition type="warning" >}}
This is an experimental feature.
{{< /admonition >}}

**To enable auto-open:**

1. Navigate to the **Open Panel on Launch** section in the configuration page.
2. Toggle **Automatically open Interactive learning panel when Grafana loads** to enable the feature.
3. Click **Save configuration**.

The sidebar opens when Grafana loads for the first time in a browser session.
It won't reopen on subsequent page navigations within Grafana.
The panel resets to auto-open behavior when you refresh the page or start a new browser session.

**Onboarding flow handling:** If a user first lands on the setup guide onboarding flow (`/a/grafana-setupguide-app/onboarding-flow`), the sidebar will wait and auto-open when they navigate away to normal Grafana pages. This ensures the onboarding experience isn't interrupted while still providing the auto-open benefit.

**Multi-instance support:** If you have multiple Grafana instances (for example, multiple Cloud instances), each instance tracks its own auto-open state independently, so the sidebar will auto-open once per session on each instance.

### interactive guide features

interactive guides include auto-completion detection and timing parameters that control how guides behave.

#### Auto-completion detection (Experimental)

Auto-completion detection automatically marks guide steps as complete when users perform actions themselves without clicking **Do it** buttons.

{{< admonition type="warning" >}}
This is an experimental feature.
{{< /admonition >}}

**To enable auto-completion:**

1. Navigate to the **interactive guide Features** section in the configuration page.
2. Toggle **Enable automatic step completion** to enable the feature.
3. Click **Save configuration**.

When enabled, the system detects user actions and completes guide steps automatically for a more natural learning experience.
Steps still verify requirements before completion.

When disabled, users must click **Do it** buttons to complete guide steps.

#### Advanced settings

You can fine-tune timing parameters for interactive guide behavior.

**Requirements check timeout:**

Maximum time to wait for requirement validation.

- Range: 1000-10000ms
- Default: 3000ms

**Guided step timeout:**

Maximum time to wait for users to complete guided steps.

- Range: 5000-120000ms (5s-2min)
- Default: 30000ms

To modify these settings:

1. Navigate to the **Advanced Settings** section under **interactive guide Features**.
2. Enter new values for the timeout fields.
3. Click **Save configuration** to apply changes, or click **Reset to defaults** to restore default values.

### Kiosk mode

Kiosk mode displays a full-screen catalog of interactive guides over Grafana, useful for in-booth and onboarding scenarios. When enabled, a kiosk button appears in the sidebar header and the catalog opens over the rest of the UI.

**To enable kiosk mode:**

1. Navigate to the **Interactive Features** tab on the plugin configuration page.
2. Toggle **Enable kiosk mode** (`enableKioskMode`).
3. Click **Save configuration**.

You can configure a custom CDN URL for the kiosk rules JSON and supply an HTML banner block at the top of the overlay (sanitized via DOMPurify before render). Each catalog tile opens its target guide in a new tab via the `?doc=` deep link.

### Coda sandbox terminal

When enabled, Coda gives a guide direct access to a 30-minute sandbox VM through a terminal panel inside the docs panel. This is useful for guides that walk through Linux configuration, Alloy scenarios, or sample-app setup.

To enable the terminal, your administrator must register the plugin with a Coda enrollment key. See the [Coda VM system](https://github.com/grafana/grafana-pathfinder-app/blob/main/docs/developer/CODA.md) developer reference for the registration flow. Once registered, toggle **Enable Coda terminal** in plugin settings to expose the terminal block types in the block editor and the terminal panel in the docs panel.

### Live sessions (experimental)

Live sessions enable a presenter to broadcast their **Show me** and **Do it** actions to attendees over a peer-to-peer WebRTC connection. This is gated behind a plugin setting and requires a PeerJS signalling server. See the [Live sessions developer reference](https://github.com/grafana/grafana-pathfinder-app/blob/main/docs/developer/LIVE_SESSIONS.md) for setup, scaling considerations, and known limitations.

### Dev mode

Dev mode is a per-user developer feature that exposes the DOM Selector Debug Panel and similar diagnostic tools.

{{< admonition type="warning" >}}
Dev mode disables several security protections and should only be enabled in isolated development environments.
Never enable dev mode in production or when viewing untrusted content.
{{< /admonition >}}

Dev mode is only visible when you access the configuration page with `?dev=true` in the URL or when it's already enabled for your user.

**Security protections disabled in dev mode:**

- Bypasses branch validation for GitHub repositories.
- Allows loading content from any localhost URL.
- Exposes debug tools that can manipulate the Grafana DOM.
- Bypasses source validation for interactive content.

**To enable dev mode:**

1. Navigate to the configuration page with `?dev=true` in the URL.
2. Review the security warnings.
3. Toggle **Dev Mode** to enable the feature.

The page reloads automatically to apply changes. Dev mode is stored per-user and requires admin permissions to change.

When dev mode is enabled, you can also configure the **Recommender service URL** to point to a local development instance.

{{< admonition type="note" >}}
The block editor and kiosk mode used to require dev mode in earlier versions. Both are now available without dev mode — the block editor through the **Editor** tab, kiosk mode through the `enableKioskMode` plugin setting.
{{< /admonition >}}
