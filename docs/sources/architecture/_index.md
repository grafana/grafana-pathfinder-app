---
title: Architecture
menuTitle: Architecture
description: Understand how the Interactive learning plugin operates and how it communicates with the Recommender service and the Pathfinder backend.
weight: 1
---

# Interactive learning architecture

Interactive learning is an app plugin built on the Grafana plugin SDK. Its primary mount point is the Grafana **extension sidebar** — the same surface used by Grafana Assistant — which lets the plugin operate alongside any part of the Grafana UI.

The plugin is composed of a React + TypeScript frontend and a Go backend. The frontend handles all UI, recommendation rendering, and step execution; the backend handles network proxying, custom-guide storage, and (optionally) sandbox VM and terminal session management.

## High-level subsystems

Interactive learning has six subsystems that work together:

| Subsystem                        | Responsibility                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Context engine**               | Detects what the user is doing in Grafana — current path, dashboard, data sources, search params, role — and produces a context object.                      |
| **Recommendation pipeline**      | Sends context to the recommender, applies fallbacks (bundled / packaged guides), deduplicates, and renders the recommendations panel.                        |
| **Documentation renderer**       | Fetches and renders guide content as a React component tree (not an iframe), with progressive lazy-loading and variable substitution.                        |
| **Interactive engine**           | Executes step actions (highlight, click, form fill, navigate, hover, popout, multistep, guided), checks requirements, and tracks completion.                 |
| **Block editor / custom guides** | Lets editors and admins author their own guides and persist them to the Pathfinder backend as Kubernetes-style custom resources.                             |
| **Live sessions and Coda**       | Optional features — peer-to-peer collaborative guide presentations (Live sessions) and ephemeral sandbox VMs accessible through an in-panel terminal (Coda). |

![Interactive learning architecture](/media/docs/pathfinder/architecture.png)

## Context engine

The context engine continuously observes Grafana state and produces a `ContextData` object. The following table outlines the data points it collects.

{{< fixed-table >}}

| Metric                | Example                                                | Description                                                                             | Sent to Recommender   |
| --------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------- |
| **currentPath**       | `/explore`                                             | Current URL pathname from the Grafana location service                                  | Yes (as `path`)       |
| **currentUrl**        | `/explore?left={"datasource":"prometheus"}`            | Full URL including pathname, search params, and hash                                    | No                    |
| **pathSegments**      | `['d', 'abc123', 'my-dashboard']`                      | URL path split into segments for entity / action detection                              | No                    |
| **dataSources**       | `[{id: 1, name: 'Prometheus', type: 'prometheus'}]`    | Configured data sources from the Grafana API                                            | Yes (types only)      |
| **dashboardInfo**     | `{id: 5, title: 'My Dashboard', uid: 'abc123'}`        | Dashboard metadata when viewing a dashboard                                             | No                    |
| **tags**              | `['dashboard:edit', 'selected-datasource:prometheus']` | Contextual tags derived from path, actions, data sources, and user interactions         | Yes                   |
| **visualizationType** | `timeseries`, `gauge`, `table`                         | Detected panel / visualization type from EchoSrv events when creating or editing panels | No (included in tags) |
| **grafanaVersion**    | `11.3.0`                                               | Current Grafana version from build info                                                 | No                    |
| **timestamp**         | `2026-04-27T10:30:00.000Z`                             | ISO timestamp when context was retrieved                                                | No                    |
| **searchParams**      | `{editPanel: '2', tab: 'queries'}`                     | URL query parameters as key-value pairs                                                 | No                    |
| **user_id**           | `a1b2c3...` (hashed)                                   | Hashed user identifier for Cloud users, generic `oss-user` for OSS                      | Yes                   |
| **user_email**        | `d4e5f6...` (hashed)                                   | Hashed user email for Cloud users, generic `oss-user@example.com` for OSS               | Yes                   |
| **user_role**         | `Admin`, `Editor`, `Viewer`                            | The user's organization role from Grafana                                               | Yes                   |
| **platform**          | `cloud` or `oss`                                       | Whether running on Grafana Cloud or self-hosted OSS                                     | Yes                   |
| **source**            | `instance123.grafana.net` or `oss-source`              | Cloud instance hostname or generic OSS identifier                                       | Yes                   |

{{< /fixed-table >}}

Hashing of `user_id` and `user_email` happens client-side before the request leaves the browser. The plugin never sends raw user identifiers to the recommender.

## Recommendation pipeline

The recommendation pipeline produces the cards you see in the docs panel. It uses a multi-source strategy:

1. **Recommender service** — A REST API hosted by Grafana Labs that pattern-matches on the context object and returns recommendations.
2. **Bundled guides** — Guides packaged into the plugin bundle (in `src/bundled-interactives/`). Used as a fallback when the recommender is unreachable, and also for guides that should always be available.
3. **Custom guides** — Guides published by editors and admins through the [block editor](../block-editor/), stored in the Pathfinder backend.
4. **Package resolver** — A composite resolver that turns recommendations into renderable guides by fetching each one from its canonical source (CDN, bundled, or backend) and applying any local user state.

The recommender service URL auto-selects based on the Grafana instance hostname (production, ops, or development) — administrators can override this in plugin settings if needed. The recommender service is **disabled by default** for OSS Grafana instances; admins can enable it from the plugin configuration page.

{{< admonition type="note" >}}
The recommender service is enabled by default on Grafana Cloud. On OSS, an administrator must enable it under **Plugin configuration > Recommendations**. For more information, refer to the [Administrators reference](../administrators-reference/).
{{< /admonition >}}

## Documentation renderer

Pathfinder fetches guide content as JSON and renders it through a React component tree — never an iframe. This lets the rendered guide use the same Grafana theme, components, and styles as the rest of the UI, and it makes images, videos, code blocks, and interactive controls feel native.

The renderer is **block-based** — every guide is a list of typed blocks (markdown, image, video, section, conditional, interactive, multistep, guided, quiz, input, code-block, grot-guide, and others). Each block type maps to a specific React component. Variable substitution (`{{variableName}}`) and conditional branches (`has-datasource:prometheus`, `is-admin`, `var-policyAccepted:true`) are evaluated at render time, so the same guide can render different content for different users.

Long guides use **progressive scroll discovery**: blocks reveal themselves and re-resolve their selectors as the reader scrolls into them, so a guide can target elements inside virtualized containers (for example, long dashboard lists) without having to keep them all mounted.

## Interactive engine

The interactive engine powers the **Show me** and **Do it** buttons inside guides. It supports several action types:

| Action      | What it does                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- |
| `highlight` | Highlights an element by CSS selector and (on Do) clicks it.                                  |
| `button`    | Finds and (on Do) clicks a button by visible text.                                            |
| `formfill`  | Sets the value of an input, textarea (including Monaco), select, or ARIA combobox.            |
| `navigate`  | Routes to a Grafana page or opens an external URL in a new tab. Internal paths are validated. |
| `hover`     | Dispatches mouse events to reveal hover-only UI (menus, row action buttons).                  |
| `noop`      | Informational step with no action.                                                            |
| `popout`    | Toggles the docs panel between docked (sidebar) and floating window modes.                    |

Steps can be grouped into:

- **Sections** — A linear sequence with a single Do section button.
- **Multistep blocks** — A sequence that runs all actions automatically when Do it is clicked.
- **Guided blocks** — A sequence the user performs themselves; the engine highlights each step and waits for the user to act.
- **Conditional blocks** — Two branches of content rendered based on a runtime condition (data source presence, user role, variable values).

Each step can declare **requirements** that must be met before it can run — for example `navmenu-open`, `is-admin`, `has-datasource:prometheus`, or `on-page:/dashboards`. The requirements manager checks them, and where it can, offers a Fix button that performs the prerequisite for the user.

### Selector resilience

Targeting elements in a constantly-evolving UI like Grafana is hard, so the interactive engine ships with a **selector resilience pipeline** that escalates strategies until it finds a match:

1. **Native CSS** — `querySelector` against the user-provided selector.
2. **Enhanced selectors** — `:contains()`, `:has()`, `:nth-match()`, and the custom `panel:` domain prefix.
3. **`:text()` exact match** — for short button labels (under 20 characters), eliminating false positives that substring matches would produce.
4. **`data-testid` prefix matching** — when the exact ID isn't found but a unique prefix exists.
5. **Retry with backoff** — exponential backoff (200 ms / 600 ms / 1.8 s) gives lazy-loaded UI time to mount.

Each resolution also returns a **confidence score** that the block editor surfaces as a Selector Health badge (green / yellow / red), so guide authors can spot fragile selectors before publishing.

## Block editor and custom guides

The [block editor](../block-editor/) lets editors and admins compose guides without writing any JSON. Guides flow through three states:

| State     | Storage                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| Not saved | Browser localStorage only.                                                                    |
| Draft     | Saved to the Pathfinder backend; visible only in the editor's library, not in the docs panel. |
| Published | Saved to the Pathfinder backend; visible to all users of the Grafana instance.                |

The backend stores guides as `InteractiveGuide` custom resources in the `pathfinderbackend.ext.grafana.com/v1alpha1` API group. The backend is shipped as part of the plugin's Go server — there is no external service to deploy. Custom guides are scoped to the Grafana stack they are published on; they are not shared between stacks.

The block editor can also import and export the underlying JSON, which is useful for bringing a guide from a development stack to production, or for review through a GitHub pull request.

## The floating panel

The Pathfinder docs panel can render in two modes:

- **Docked** — the default; lives in the Grafana extension sidebar.
- **Floating** — a free-floating, resizable, draggable window that you can position anywhere on screen and minimize to a small pill.

Switching modes is a user action (the **Pop out** button at the top of the panel) but can also be driven by a guide step (the `popout` action). Geometry, minimized state, and dock target are persisted per-instance, so the panel returns to where you last left it.

## Tracking user progress

Pathfinder uses two storage tiers for progress:

- **localStorage** for unauthenticated state — open tabs, in-flight progress, last-visited milestone, custom-guide drafts in progress, recently-used VM options.
- **Grafana user-storage** (server-side) for state that needs to follow the user across browsers — completed milestones, badges, streaks, and per-instance auto-open flags.

State that lives in both is reconciled by timestamp on read — the most recent value wins. This means progress made in one browser shows up in another after a refresh.

Tabs and the per-tab guide progression persist across sessions until the user explicitly closes a tab.

## Live sessions (experimental)

Live sessions enable a presenter to broadcast their **Show me** and **Do it** actions to attendees over a peer-to-peer WebRTC connection. The plugin uses a small PeerJS signalling server to bootstrap the connection; once peers are connected, all guide data flows directly between browsers without round-tripping through any server. Presenters authenticate with an ECDSA P-256 key pair to prevent peer ID impersonation on the signalling layer.

## Coda terminal (optional)

When enabled, Coda gives a guide direct access to a 30-minute sandbox VM through a terminal panel inside the docs panel. The plugin's Go backend handles VM provisioning, SSH key management, and the WebSocket-to-SSH relay; the frontend never sees the credentials. Guide authors can drop a `terminal-connect` block into a guide to provision a specific VM template (generic Linux, sample-app, or Alloy scenario) and a `terminal` block to run commands in the resulting session.
