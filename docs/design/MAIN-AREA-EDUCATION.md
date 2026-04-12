# Main-Area Education: Rendering Interactive Content Outside the Sidebar

## Overview

Render interactive learning content (guides, quizzes, terminal steps, code blocks) in
Grafana's main app area at a dedicated route, as an alternative to the right-hand sidebar.
This design covers **read-only and self-contained interactive content only** — guides
whose "Show Me" / "Do It" steps target external Grafana DOM elements remain sidebar-only.

### Goal URL

```
/a/grafana-pathfinder-app/learning?doc=bundled:prometheus-grafana-101
```

This mirrors the existing `?doc=` parameter used at the plugin root
(`/a/grafana-pathfinder-app?doc=...&page=...`) for sidebar auto-launch. The `doc`
parameter accepts Pathfinder package URL schemes only: `bundled:<id>`, `api:<name>`,
or an HTTPS base URL pointing to a package directory
(e.g. `https://interactive-learning.grafana.net/mypackage/`). Raw `/docs/...` paths and
bare HTML URLs are not supported in this route — use the sidebar for those.

The key difference: the root `?doc=` parameter opens content in the **sidebar** (and
optionally redirects the main area via `?page=`). The `/learning?doc=` route renders
content **in-place** in the main area, with no sidebar involvement.

---

## Architecture Context

### What already exists

| Component                                         | Location                                   | Role                                                            |
| ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `CombinedLearningJourneyPanel`                    | `src/components/docs-panel/docs-panel.tsx` | SceneObject that manages tabs, content loading, and rendering   |
| `ContentRenderer`                                 | `src/docs-retrieval/content-renderer.tsx`  | Pure content renderer (HTML/JSON → React), no layout dependency |
| `InteractiveSection/Step/Quiz/Terminal/CodeBlock` | `src/components/interactive-tutorial/`     | Self-contained interactive components using window events       |
| `findDocPage()`                                   | `src/utils/find-doc-page.ts`               | Resolves all URL schemes → `{ url, title, type, targetPage }`   |
| `fetchContent()`                                  | `src/docs-retrieval/content-fetcher.ts`    | Fetches and wraps content as `RawContent`                       |
| `ROUTES` enum                                     | `src/constants.ts`                         | Route definitions (`Home = ''`, `Context = 'context'`)          |
| `homePage` / `docsPage`                           | `src/pages/`                               | Existing SceneAppPage definitions                               |

### Why this is feasible

- `ContentRenderer` takes `RawContent` as a prop and has **zero sidebar dependencies**.
- Interactive components (`InteractiveQuiz`, `TerminalStep`, `CodeBlockStep`) are leaf
  components that communicate via window events and `user-storage.ts`. They work anywhere.
- `CombinedLearningJourneyPanel` already renders identically in both the sidebar
  (`ContextPanel.tsx`) and the full-page docs route (`docsPage.ts`).
- The only hard-coded DOM assumption is `id="inner-docs-content"` for scroll tracking,
  which lives inside `CombinedLearningJourneyPanel`'s own render tree.

### What does NOT work in the main area

- **"Show Me" steps**: `NavigationManager` highlights Grafana UI elements by CSS selector
  (`refTarget`). In the main area, the guide _replaces_ the content those selectors target.
- **"Do It" steps**: Execute actions (click buttons, fill forms) on Grafana DOM elements
  that aren't visible when the guide occupies the main area.
- **`openAndDockNavigation()`**: Manipulates the Grafana mega-menu toggle/dock buttons —
  assumes sidebar-alongside-content layout.

---

## Phased Implementation Plan

### Phase 1: Route, Page, and Basic Rendering

**Goal**: A working `/learning` route that renders a `MainAreaLearningPanel` in the
main app area, with `?doc=` parameter support for direct-linking to content.

#### 1.1 Add the route

**`src/constants.ts`** — add to `ROUTES` enum:

```typescript
export enum ROUTES {
  Home = '',
  Context = 'context',
  Learning = 'learning', // NEW
}
```

#### 1.2 Create the page definition

**`src/pages/learningPage.ts`** (new file) — modeled on `docsPage.ts`:

```typescript
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { MainAreaLearningPanel } from '../components/main-area-learning/main-area-learning-panel';

export const learningPage = new SceneAppPage({
  title: 'Learning',
  url: prefixRoute(ROUTES.Learning),
  routePath: ROUTES.Learning,
  getScene: learningScene,
});

function learningScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%', // Full height, not fixed 600px like docsPage
          body: new MainAreaLearningPanel({}),
        }),
      ],
    }),
  });
}
```

#### 1.3 Register in the app

**`src/components/App/App.tsx`** — add `learningPage` to the `SceneApp` pages array.

#### 1.4 Build `MainAreaLearningPanel`

**`src/components/main-area-learning/main-area-learning-panel.tsx`** (new file)

Implement as a `SceneObjectBase` subclass with a `static Component` property — the same
pattern as `CombinedLearningJourneyPanel`. Content loading state (loaded content,
loading/error status) lives in `useState` within the `Component` function, not in
`SceneObjectState`. This is required for correct integration with `SceneFlexItem`'s `body`
prop.

The `Component` function:

1. Reads `?doc=` from the URL on mount (via `new URLSearchParams(window.location.search)`)
2. Calls `findDocPage(docParam)` to resolve the URL
3. Calls `fetchContent(resolvedUrl)` to load content
4. Renders `ContentRenderer` with the loaded `RawContent`
5. Wraps the content in a container with `id="main-area-docs-content"` for scroll tracking
   (deliberately different from the sidebar's `inner-docs-content` to avoid ID conflicts
   when both views are mounted simultaneously)
6. Strips the `?doc=` param from the URL after processing (matching existing behavior in
   `module.tsx`)

**Loading and error states:**

- **Loading**: Show `SkeletonLoader` while `fetchContent()` is in flight.
- **Fetch error** (network failure, guide not found): Show a Grafana `Alert` component
  (variant `"error"`) with the error message and a "Try again" button that re-triggers
  the fetch.
- **Unresolvable URL scheme** (invalid `?doc=` value that `findDocPage()` cannot parse):
  Treat as missing param — fall through to the landing page (see 1.5).

Key decisions:

- **Single-content view, not tabbed** — the main area shows one guide at a time, not the
  sidebar's tab UI. Sidebar = multi-tab companion; main area = focused reading.
- **Full-height layout** — unlike `docsPage.ts` which uses `height: 600`, the learning
  page fills the viewport. Use `height: '100%'` and let Grafana's Scene layout handle it.
- **Reuse `ContentRenderer` directly** — don't wrap `CombinedLearningJourneyPanel`; the
  main area wants a simpler, focused experience without the recommendation tab and tab bar.
- **Static title "Learning"** — dynamic guide title in the breadcrumb is deferred to a
  follow-up. V1 shows "Learning" as the `SceneAppPage` title.

#### 1.5 Handle missing/invalid `?doc=`

If no `?doc=` param or an invalid one: render the `MyLearningTab` component (the learning
paths hub) as a landing page, so the URL `/a/grafana-pathfinder-app/learning` without
params is useful on its own.

**Content format restriction**: The `/learning` route accepts only Pathfinder package
format — guides that have both a `content.json` and a `manifest.json`. Specifically:

- `bundled:<id>` — always valid; bundled guides are in package format by definition.
- `https://<base>/` (or any external base URL) — treated as a package base URL.
  `content.json` is fetched from `<base>/content.json` and the manifest from
  `<base>/manifest.json`. If either is missing or the response is not valid package JSON,
  the request is rejected with an error.
- `api:<name>` — valid only if the API returns a package-format response.
- `/docs/...` paths and bare HTML URLs — **not supported** in the main area. Show a
  clear error: "This content format is not supported in the learning view. Open it in the
  Pathfinder sidebar instead." with a button that dispatches it to the sidebar.

This restriction exists because the main-area learning view is designed around the package
model's structured content and metadata (title, progress, step completion). Raw HTML docs
lack the structure needed for the progress header and interactive safety gate.

#### Tests — Phase 1

| Test                      | Type        | What it validates                                                                         |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Route registration        | Unit        | `ROUTES.Learning` exists and `prefixRoute` produces correct path                          |
| `?doc=` parsing           | Unit        | `MainAreaLearningPanel` correctly extracts, resolves, and cleans query params             |
| Invalid `?doc=` fallback  | Unit        | Invalid/missing param renders `MyLearningTab` landing                                     |
| Content render            | Integration | `ContentRenderer` mounts and renders `RawContent` inside the panel                        |
| Scroll container          | Unit        | The `main-area-docs-content` ID is present in the rendered DOM (not `inner-docs-content`) |
| Package format validation | Unit        | `bundled:` and HTTPS package base URLs accepted; `/docs/` paths rejected with fallback UI |
| Unsupported format UI     | Unit        | Non-package URLs render error alert with "Open in sidebar" button                         |
| Loading state             | Unit        | `SkeletonLoader` is shown while `fetchContent()` is in flight                             |
| Fetch error state         | Unit        | Network error renders error alert with "Try again" button                                 |

---

### Phase 2: Navigation and Deep Linking

**Goal**: Wire up navigation so users can reach the main-area learning view from existing
UI surfaces, and so links can be shared.

#### 2.1 "Open in main area" from MyLearningTab

**Decision: URL-based via prop override.** `MyLearningTab` stays route-agnostic. The
caller provides the `onOpenGuide` handler and controls the destination.

- When `MyLearningTab` is rendered inside `MainAreaLearningPanel` (i.e., as the landing
  page at `/learning`), the panel provides an `onOpenGuide` handler that navigates to
  `/a/grafana-pathfinder-app/learning?doc=<url>` using `locationService.push()` from
  `@grafana/runtime`.
- When `MyLearningTab` is rendered inside the sidebar, the sidebar provides an
  `onOpenGuide` handler that dispatches to the sidebar as today.

This requires that `MyLearningTab` accepts an `onOpenGuide` prop (verify the current
interface and add the prop if not already present). No route-awareness or condition
checking is needed inside `MyLearningTab` itself.

#### 2.2 Link interception routing when on `/learning`

**Decision**: When the user is on `/learning`, intercepted doc links open in the main area
and bypass the sidebar entirely.

**Implementation**: `link-interception.ts` must become context-aware. Add a check in
`handleGlobalClick`:

```typescript
import { mainAreaLearningState } from '../components/main-area-learning/main-area-learning-state';

// If main area is active, route to it instead of the sidebar
if (mainAreaLearningState.getIsActive()) {
  document.dispatchEvent(new CustomEvent('pathfinder-open-in-main-area', { detail: docsLink }));
  return;
}
// ...existing sidebar logic
```

`mainAreaLearningState` is a small singleton (analogous to `sidebarState`) that
`MainAreaLearningPanel` sets to active on mount and inactive on unmount.

`MainAreaLearningPanel` listens for `pathfinder-open-in-main-area` (not
`pathfinder-auto-open-docs`) to load new content in-place. This avoids the dual-handling
problem where both the sidebar and main area would catch the same event.

**New file**: `src/components/main-area-learning/main-area-learning-state.ts` — a small
singleton with `getIsActive()`, `setIsActive(active: boolean)`.

#### 2.3 MCP-driven guide launches

For MCP-initiated launches (via `sidebarState.openWithGuide()`), the existing flow opens
the sidebar. This remains unchanged — MCP guide launches always target the sidebar, not
the main area. The main area's `pathfinder-open-in-main-area` event is for link
interception only.

#### 2.4 Clean URL history

After loading content from `?doc=`, replace the URL with
`/a/grafana-pathfinder-app/learning` (no query param) using
`window.history.replaceState`. This matches the existing pattern in `module.tsx:179-182`.

#### 2.5 Back navigation

When the user navigates away from a guide (e.g., clicks a breadcrumb or the browser back
button), return to the learning hub landing page. Consider storing the last-viewed guide
URL in `user-storage.ts` (using a separate key from the sidebar's tab storage, to avoid
clobbering sidebar state) so the user can resume.

#### Tests — Phase 2

| Test                           | Type        | What it validates                                                                                     |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- |
| Deep link round-trip           | Integration | Navigate to `/learning?doc=bundled:X` → content renders → URL cleaned                                 |
| Main-area event routing        | Unit        | `pathfinder-open-in-main-area` event loads content in main area                                       |
| Link interception bypass       | Unit        | When `mainAreaLearningState.isActive`, `handleGlobalClick` dispatches to main area instead of sidebar |
| MyLearningTab navigation       | Unit        | `onOpenGuide` prop navigates to `/learning?doc=<url>` when provided by panel                          |
| MCP launch unchanged           | Unit        | `sidebarState.openWithGuide()` still targets the sidebar regardless of route                          |
| Back button                    | Integration | Browser back returns to landing page, not broken state                                                |
| URL param cleanup              | Unit        | `?doc=` is stripped after processing; repeated visits don't re-trigger                                |
| State active/inactive on mount | Unit        | `mainAreaLearningState` is set active on mount and inactive on unmount                                |

---

### Phase 3: Layout and Styling

**Goal**: The main-area learning view looks polished and takes advantage of the wider
viewport (vs. the narrow sidebar).

#### 3.1 Responsive content width

`ContentRenderer` currently renders in a narrow sidebar. In the main area, constrain
content to a comfortable reading width (e.g., `max-width: 48rem; margin: 0 auto`) while
allowing interactive components (terminals, code blocks) to use more width.

#### 3.2 Adapt interactive component sizing

- **`TerminalStep`** / **`CodeBlockStep`**: Allow wider/taller rendering in main area.
  These components likely already use `100%` width but may benefit from increased
  `min-height`.
- **`InteractiveQuiz`**: Should work unchanged — it's a card-style layout.
- **`InteractiveSection`**: Collapse/expand behavior should work as-is.

#### 3.3 Progress bar and guide header

Add a header area above the content showing:

- Guide title
- Progress indicator (reuse existing `interactiveCompletionStorage` data)
- "Open in sidebar" link (for users who want to switch to side-by-side mode)

#### 3.4 Handle the "Recommendations" panel

`CombinedLearningJourneyPanel` always includes a Recommendations tab via `ContextPanel`.
Since `MainAreaLearningPanel` uses `ContentRenderer` directly, this is a non-issue — but
if you later want to show recommendations, they can be added as a separate section below
the content.

#### Tests — Phase 3

| Test                   | Type            | What it validates                                                               |
| ---------------------- | --------------- | ------------------------------------------------------------------------------- |
| Max-width constraint   | Snapshot/visual | Content body has `max-width` applied                                            |
| Terminal sizing        | Integration     | `TerminalStep` renders at wider width without overflow                          |
| Progress display       | Unit            | Progress header reads from `interactiveCompletionStorage` and renders correctly |
| Responsive breakpoints | Visual          | Layout degrades gracefully at narrow viewport widths                            |

---

### Phase 4: Content Safety Gate

**Goal**: Prevent guides with "Show Me" / "Do It" steps (that target external DOM) from
rendering broken in the main area.

#### 4.1 Safety classification via parsed detection

Since the main area is restricted to Pathfinder package format (see 1.5), all content goes
through `json-parser.ts` and produces structured `ParsedContent`. There is no HTML/external
content to classify.

**`isMainAreaSafe(content: ParsedContent): boolean`** — inspect all interactive elements:

- Check both `interactive` blocks (single-action) and `multistep` blocks (whose `steps`
  array may contain DOM-targeting actions).
- **Unsafe actions**: `'highlight' | 'button' | 'formfill' | 'hover'` — these target
  Grafana DOM elements that are not visible when the main area is occupied.
- **Safe actions**: `'noop'` and `'navigate'` — these do not target external DOM.
  Note: `navigate` with `openGuide` set loads a guide into the sidebar, which is expected
  and acceptable in a main-area context.
- A guide is safe if it contains **no** steps with unsafe actions. A single unsafe step
  makes the whole guide sidebar-only.
- `showMe` and `doIt` flags do not affect classification — even if buttons are hidden,
  the underlying action type determines safety.

No `Option A` static metadata field is needed for V1. The automated detection covers all
cases in the package-format-only content set.

#### 4.2 Gate rendering

In `MainAreaLearningPanel`, after fetching and parsing content, run the safety check:

- If safe: render normally.
- If unsafe: show a Grafana `Alert` (variant `"warning"`) explaining the guide requires
  the sidebar, with an "Open in sidebar" button.

**"Open in sidebar" button implementation** — varies by content source:

- `bundled:<id>` — strip the `bundled:` prefix and call
  `sidebarState.openWithGuide(id)`. Then navigate away from `/learning` using
  `locationService.push('/a/grafana-pathfinder-app')` so the guide opens alongside the
  normal Grafana UI.
- External package URL — dispatch a `pathfinder-open-in-main-area` is wrong here;
  instead dispatch `pathfinder-auto-open-docs` with the full URL, then navigate away from
  `/learning`.
- In both cases: navigate away from `/learning` immediately after dispatching, so the
  sidebar-targeted content can work against the actual Grafana UI.

#### 4.3 Surface safety in MyLearningTab

On guide cards, indicate which guides can open in the main area vs. sidebar-only. This
could be a subtle icon or tooltip — not a blocking gate, just information.

#### Tests — Phase 4

| Test                        | Type        | What it validates                                                                        |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| Detection accuracy          | Unit        | `isMainAreaSafe()` correctly classifies guides with showMe/doIt vs. quiz-only            |
| Noop steps pass             | Unit        | Guides with only `noop` interactive steps are classified as safe                         |
| Multistep block checked     | Unit        | Unsafe actions inside `multistep.steps` correctly classify the guide as unsafe           |
| Navigate+openGuide safe     | Unit        | `navigate` action (with or without `openGuide`) is classified as safe                    |
| Hidden buttons still unsafe | Unit        | Steps with `showMe: false` and `doIt: false` but unsafe `action` still fail safety check |
| Unsafe redirect             | Integration | Unsafe guide shows warning alert with "Open in sidebar" button                           |
| Bundled sidebar handoff     | Integration | "Open in sidebar" calls `sidebarState.openWithGuide(id)` and navigates away              |
| External sidebar handoff    | Integration | "Open in sidebar" dispatches `pathfinder-auto-open-docs` and navigates away              |
| Edge cases                  | Unit        | Mixed guides (some safe steps, some unsafe) are classified as unsafe                     |

---

### Phase 5: Chrome Controls (`&nav=` and `&sidebar=`)

**Goal**: URL parameters that selectively show/hide the left navigation and right-hand
extension sidebar, enabling a full-screen immersive learning experience.

```
/a/grafana-pathfinder-app/learning?doc=bundled:prometheus-grafana-101&nav=false&sidebar=false
```

#### How Grafana's UI chrome works (and what we can control)

| Chrome element                        | How it's managed                                                                                                                                                | Can we control it?                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Left nav (mega-menu)**              | Toggle via `#mega-menu-toggle` button click; docking state in `localStorage['grafana.navigation.extensionSidebarDocked']`                                       | **Yes, with caveats.** We can programmatically click the toggle to collapse it. There is no clean API — `NavigationManager` already does this via `openAndDockNavigation()`. Closing is the reverse: click the toggle when nav items are visible. |
| **Right sidebar (extension sidebar)** | Opened via `OpenExtensionSidebarEvent` through `getAppEvents().publish()`. Closed via `{ type: 'close-extension-sidebar', payload: {} }` on the same event bus. | **Yes.** We already publish these events in `sidebar.ts` and `TabBarActions.tsx`.                                                                                                                                                                 |
| **Top bar / breadcrumbs**             | Part of Grafana's SceneAppPage shell. No known toggle.                                                                                                          | **No** — this is Grafana core chrome. Hiding it would require injecting CSS (`display: none` on the header), which is fragile across Grafana versions. Not recommended for Phase 5.                                                               |

#### 5.1 Parse chrome control params

In `MainAreaLearningPanel`, on mount:

```typescript
const params = new URLSearchParams(window.location.search);
const showNav = params.get('nav') !== 'false'; // default: show
const showSidebar = params.get('sidebar') !== 'false'; // default: show
```

These are **opt-out** — omitting them gives standard Grafana chrome. Only `=false`
suppresses.

#### 5.2 Left nav control (`&nav=false`)

On mount when `nav=false`:

1. Check if left nav is currently visible by querying for nav menu items:
   `document.querySelectorAll('a[data-testid="data-testid Nav menu item"]').length > 0`
2. If visible, click `#mega-menu-toggle` to collapse it.
3. Store the **previous state** so we can restore on unmount.

On unmount (user navigates away from `/learning`):

- If we collapsed the nav, restore it by clicking `#mega-menu-toggle` again.

**Important**: This uses the same DOM manipulation pattern as `NavigationManager.openAndDockNavigation()`
but in reverse. It's not a clean API, but it's the same technique the interactive engine
already relies on — if Grafana changes the nav toggle, both systems break together, which
is better than having two different fragile approaches.

#### 5.3 Right sidebar control (`&sidebar=false`)

On mount when `sidebar=false`:

1. Check if sidebar is mounted via `sidebarState.getIsSidebarMounted()`.
2. If mounted, publish `{ type: 'close-extension-sidebar', payload: {} }` via
   `getAppEvents()`.
3. Store previous state for restoration.

On unmount:

- If we closed the sidebar and it was previously open, re-open it via
  `sidebarState.openSidebar()`.

**Edge case**: If the sidebar mounts _after_ our page loads (e.g., experiment
orchestrator triggers it), we need to suppress that. Options:

- Set a flag that the sidebar initialization in `module.tsx` checks.
- Listen for `pathfinder-sidebar-mounted` and immediately close if `sidebar=false`
  is active.

Recommendation: use the listener approach — it's less invasive than modifying `module.tsx`
initialization logic.

#### 5.4 Restore on navigation

Both nav and sidebar state must be restored when the user leaves the `/learning` route.
Use a `useRef` to track whether **we** made the change — do not track "previous state."
This avoids two failure modes: (a) React Strict Mode double-invoking the effect, and (b)
the user manually restoring chrome while on the `/learning` route.

```typescript
const navCollapsedByUs = useRef(false);
const sidebarClosedByUs = useRef(false);

useEffect(() => {
  // Apply: only change if we need to and the state isn't already what we want
  if (!showNav && isNavVisible()) {
    collapseNav();
    navCollapsedByUs.current = true;
  }
  if (!showSidebar && sidebarState.getIsSidebarMounted()) {
    closeSidebar();
    sidebarClosedByUs.current = true;
  }

  return () => {
    // Restore only if we made the change AND the state still matches what we set.
    // If the user manually re-expanded the nav, isNavVisible() returns true here —
    // we don't fight it.
    if (navCollapsedByUs.current && !isNavVisible()) {
      expandNav();
    }
    navCollapsedByUs.current = false;

    if (sidebarClosedByUs.current && !sidebarState.getIsSidebarMounted()) {
      sidebarState.openSidebar('Interactive learning');
    }
    sidebarClosedByUs.current = false;
  };
}, [showNav, showSidebar]);
```

**Why this handles Strict Mode:** In development, React runs effects twice
(mount → cleanup → mount). On the first mount, we collapse the nav and set
`navCollapsedByUs.current = true`. The cleanup restores the nav (it's collapsed, matching
what we set) and clears the ref. On the second mount, the nav is visible again —
we collapse it and set the ref again. In production only one mount ever runs, so behaviour
is identical.

**Why this handles user mid-session changes:** If the user manually re-expands the nav
while on `/learning`, on unmount `isNavVisible()` returns `true` — the condition
`!isNavVisible()` is false — so we do not collapse it. We never fight the user's choice.

#### 5.5 Full-screen preset

For convenience, consider a shorthand param that implies both:

```
&fullscreen=true  →  equivalent to &nav=false&sidebar=false
```

This keeps URLs cleaner for the most common immersive use case.

#### Risks and mitigations

| Risk                                               | Mitigation                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana changes nav toggle markup                  | Same risk `NavigationManager` already carries; add E2E test that verifies the toggle exists                                                                                  |
| User manually re-opens nav/sidebar during learning | Don't fight it — only apply chrome changes on initial mount, don't continuously enforce                                                                                      |
| Cleanup doesn't run (page crash, hard nav)         | Accept graceful degradation — user just sees normal chrome on next page load. Nav/sidebar state is already persistent in localStorage, so Grafana restores its own defaults. |
| `sidebar=false` races with experiment auto-open    | The `pathfinder-sidebar-mounted` listener approach handles this; add a test for the race                                                                                     |

#### Tests — Phase 5

| Test                              | Type        | What it validates                                       |
| --------------------------------- | ----------- | ------------------------------------------------------- |
| Default chrome                    | Unit        | No params → nav and sidebar remain untouched            |
| `nav=false` collapses nav         | Integration | Nav menu items removed from DOM after mount             |
| `sidebar=false` closes sidebar    | Integration | `close-extension-sidebar` event published               |
| Restore on unmount                | Integration | Nav/sidebar return to previous state when leaving route |
| `fullscreen=true` shorthand       | Unit        | Equivalent to `nav=false&sidebar=false`                 |
| Race with auto-open               | Integration | Sidebar stays closed even if experiment triggers open   |
| Params only parsed on `/learning` | Unit        | Chrome params on other routes are ignored               |

---

## Analytics Instrumentation

The main-area learning surface must be fully instrumented in parallel with the existing
sidebar events. All events use `reportAppInteraction(UserInteraction.X, { ... })` from
`src/lib/analytics.ts`.

Add the following entries to the `UserInteraction` enum. Naming convention:
`MainArea<Event>` to clearly segregate from sidebar events.

| Event constant                  | Trigger                                                                           | Key payload fields                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `MainAreaPageView`              | `MainAreaLearningPanel` mounts (even with no `?doc=` param)                       | `has_doc_param: boolean`, `chrome_nav: string`, `chrome_sidebar: string`               |
| `MainAreaGuideLoaded`           | Content successfully fetched and rendered                                         | `guide_url: string`, `guide_title: string`, `is_safe: boolean`, `load_time_ms: number` |
| `MainAreaGuideLoadFailed`       | `fetchContent()` throws or returns an error                                       | `guide_url: string`, `error_message: string`                                           |
| `MainAreaUnsupportedFormat`     | User attempts to load a non-package-format URL (e.g., `/docs/...`, bare HTML)     | `guide_url: string`, `url_scheme: string`                                              |
| `MainAreaSafetyGateBlocked`     | Safety gate classifies a guide as unsafe for main area                            | `guide_url: string`, `unsafe_action_types: string[]`                                   |
| `MainAreaOpenInSidebarClicked`  | User clicks "Open in sidebar" from the safety gate or unsupported-format fallback | `guide_url: string`, `trigger: 'safety_gate' \| 'unsupported_format'`                  |
| `MainAreaLinkIntercepted`       | `handleGlobalClick` routes an intercepted link to the main area                   | `intercepted_url: string`, `link_title: string`                                        |
| `MainAreaChromeControlApplied`  | `nav=false` or `sidebar=false` (or `fullscreen=true`) params are processed        | `nav_hidden: boolean`, `sidebar_hidden: boolean`                                       |
| `MainAreaGuideNavigatedInPlace` | `pathfinder-open-in-main-area` event loads a new guide replacing the current one  | `new_url: string`, `previous_url: string`                                              |

These events parallel the existing sidebar analytics (e.g., `DocsPanelInteraction`,
`GlobalDocsLinkIntercepted`) but are clearly scoped to the main-area surface. Keeping them
separate enables per-surface funnel analysis.

---

## File Inventory

### New files

| File                                                                  | Purpose                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/pages/learningPage.ts`                                           | SceneAppPage route definition                             |
| `src/components/main-area-learning/main-area-learning-panel.tsx`      | SceneObjectBase subclass + renderer for main-area content |
| `src/components/main-area-learning/main-area-learning-panel.test.tsx` | Unit tests                                                |
| `src/components/main-area-learning/main-area-learning-state.ts`       | Active-state singleton; used by link-interception routing |
| `src/components/main-area-learning/main-area-learning-state.test.ts`  | Unit tests for singleton                                  |
| `src/utils/guide-safety.ts`                                           | `isMainAreaSafe()` utility (Phase 4)                      |
| `src/utils/guide-safety.test.ts`                                      | Safety classification tests                               |
| `src/utils/chrome-control.ts`                                         | Nav/sidebar show/hide helpers (Phase 5)                   |
| `src/utils/chrome-control.test.ts`                                    | Chrome control tests                                      |

### Modified files

| File                                             | Change                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `src/constants.ts`                               | Add `Learning = 'learning'` to `ROUTES`                           |
| `src/components/App/App.tsx`                     | Register `learningPage` in `SceneApp` pages                       |
| `src/components/LearningPaths/MyLearningTab.tsx` | Add `onOpenGuide` prop support if not present (Phase 2)           |
| `src/global-state/link-interception.ts`          | Add `mainAreaLearningState.getIsActive()` routing check (Phase 2) |
| `src/lib/analytics.ts`                           | Add `MainArea*` entries to `UserInteraction` enum                 |

---

## Resolved decisions

1. **Tab persistence scope**: Separate storage keys. The main-area view must not clobber
   the sidebar's tab state. Use a `main-area-last-viewed` key in `user-storage.ts`,
   distinct from the sidebar's tab storage keys.

2. **Concurrent rendering**: Fine as-is. Sidebar and main area use independent component
   instances. The only shared state is step-completion (keyed by content URL, idempotent).
   The `main-area-docs-content` scroll container ID (vs. the sidebar's `inner-docs-content`)
   eliminates the only ID conflict.

3. **Link interception routing**: When `/learning` is active, intercepted doc links are
   routed to the main area via `pathfinder-open-in-main-area` event. See Phase 2.2.

4. **Title/breadcrumb**: Static title "Learning" for V1. Dynamic guide title in the
   breadcrumb is a follow-up.

---

## Implementation Log

### Phase 1 — Completed 2026-04-11

**Files created:**

| File                                                                  | Purpose                                          |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `src/pages/learningPage.ts`                                           | SceneAppPage route definition                    |
| `src/pages/learningPage.test.ts`                                      | Route registration tests                         |
| `src/components/main-area-learning/main-area-learning-panel.tsx`      | SceneObjectBase + renderer for main-area content |
| `src/components/main-area-learning/main-area-learning-panel.test.tsx` | Unit tests (22 tests)                            |
| `src/components/main-area-learning/index.ts`                          | Barrel export                                    |

**Files modified:**

| File                         | Change                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/constants.ts`           | Added `Learning = 'learning'` to `ROUTES` enum                                                                                    |
| `src/lib/analytics.ts`       | Added `MainAreaPageView`, `MainAreaGuideLoaded`, `MainAreaGuideLoadFailed`, `MainAreaUnsupportedFormat` to `UserInteraction` enum |
| `src/constants/testIds.ts`   | Added `mainAreaLearning` test ID namespace (8 IDs)                                                                                |
| `src/components/App/App.tsx` | Registered `learningPage` in SceneApp pages array                                                                                 |

**Deviations from design:**

- Initial state (landing, unsupported format) is computed synchronously via
  `resolveDocParam()` passed to `useState(initializer)` rather than using `setState`
  inside the mount effect. This avoids the `react-hooks/set-state-in-effect` lint rule.
- Imports `fetchContent` and `ContentRenderer` from the `docs-retrieval` barrel
  (`src/docs-retrieval/index.ts`) rather than directly from internal files, per the
  architecture ratchet's barrel export discipline.
- `fetchContent` is imported as `fetchUnifiedContent` (the barrel's export name) and
  aliased back to `fetchContent` locally.

**Notes for Phase 2 (Navigation and Deep Linking):**

- `handleOpenGuideInMainArea` uses full-page navigation (`window.location.assign`).
  Phase 2 should replace with `locationService.push()` for SPA navigation.
- `mainAreaLearningState` singleton does not yet exist — Phase 2 needs to create
  `src/components/main-area-learning/main-area-learning-state.ts` for the
  `getIsActive()` / `setIsActive()` API used by link interception routing.
- "Open in sidebar" button reuses `HomePanel`'s sidebar dispatch pattern
  (`pathfinder-auto-open-docs` event + `sidebarState.openSidebar()` fallback).
- Only 4 of 9 planned `MainArea*` analytics events are implemented. The remaining 5
  (`MainAreaSafetyGateBlocked`, `MainAreaOpenInSidebarClicked`,
  `MainAreaLinkIntercepted`, `MainAreaChromeControlApplied`,
  `MainAreaGuideNavigatedInPlace`) should be added in Phases 2-5.
- `MyLearningTab` already has the `onOpenGuide` prop — no changes were needed to its
  interface. Phase 2 just needs to provide a different handler when rendered in the
  main area vs. sidebar.

### Phase 2 — Completed 2026-04-12

**Files created:**

| File                                                | Purpose                                              |
| --------------------------------------------------- | ---------------------------------------------------- |
| `src/global-state/main-area-learning-state.ts`      | Active-state singleton for link interception routing |
| `src/global-state/main-area-learning-state.test.ts` | Unit tests for singleton                             |

**Files modified:**

| File                                                                  | Change                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/analytics.ts`                                                | Added `MainAreaLinkIntercepted`, `MainAreaGuideNavigatedInPlace` to enum                             |
| `src/components/main-area-learning/main-area-learning-panel.tsx`      | SPA navigation, active state wiring, `pathfinder-open-in-main-area` listener, mutable state refactor |
| `src/components/main-area-learning/main-area-learning-panel.test.tsx` | Added 6 Phase 2 tests, updated mocks                                                                 |
| `src/global-state/link-interception.ts`                               | Context-aware routing: main area check before sidebar dispatch                                       |

**Deviations from design:**

- `mainAreaLearningState` lives in `src/global-state/` (not `src/components/main-area-learning/`)
  to comply with the architecture ratchet's tier import rules. `link-interception.ts`
  (Tier 2 global-state) cannot import from `components/` (Tier 3).
- SPA navigation uses in-place content loading via `loadContent()` rather than
  `locationService.push()`. The component resolves and fetches content directly,
  avoiding a URL round-trip. This is simpler and avoids re-mounting the component.
- The frozen `initial` state pattern from Phase 1 was refactored to separate mutable
  `useState` calls (initialized from `resolveDocParam`) so `handleOpenGuideInMainArea`
  can transition from landing → content view. The mount effect still avoids synchronous
  `setState` — only async `loadContent` and side-effect-only `reportAppInteraction`.
- Removed `prefixRoute` and `ROUTES` imports from the panel (no longer needed).

**Notes for Phase 3 (Layout and Styling):**

- Content now loads in-place without page reload. Phase 3 styling should account for
  smooth content transitions (e.g., skeleton → content → new skeleton → new content).
- `loadContent` is reused for both initial mount and in-place navigation.
- The `max-width: 48rem` constraint from the design should be applied to the content
  container (`#main-area-docs-content`), not the outer panel container.

**Notes for Phase 4 (Content Safety Gate):**

- `handleOpenGuideInMainArea` is the right place to add the `isMainAreaSafe()` check.
  Both direct calls (from `MyLearningTab`) and `pathfinder-open-in-main-area` events
  flow through this callback.
- 6 of 9 planned `MainArea*` analytics events are now implemented. Remaining 3:
  `MainAreaSafetyGateBlocked`, `MainAreaOpenInSidebarClicked`,
  `MainAreaChromeControlApplied` — for Phases 4-5.

### Phase 3 — Completed 2026-04-12

**Files created:**

| File                                                               | Purpose                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| `src/components/main-area-learning/guide-progress-header.tsx`      | Progress header with title, completion %, sidebar button |
| `src/components/main-area-learning/guide-progress-header.test.tsx` | Unit tests for progress header (8 tests)                 |

**Files modified:**

| File                                                                  | Change                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/components/main-area-learning/main-area-learning-panel.tsx`      | Added `contentBody` style (max-width 48rem), integrated GuideProgressHeader   |
| `src/components/main-area-learning/main-area-learning-panel.test.tsx` | Added 5 Phase 3 tests, `success` color in mock theme, completion storage mock |
| `src/constants/testIds.ts`                                            | Added `progressHeader`, `progressBar`, `openInSidebarHeaderButton`            |

**Deviations from design:**

- None — implementation matches design spec.

**Notes for Phase 4 (Content Safety Gate):**

- `GuideProgressHeader` only renders when `content` is set. The safety gate (Phase 4)
  prevents `setContent()` for unsafe guides, so the header naturally won't appear for
  blocked guides.
- The `handleOpenInSidebar` callback from the header reuses the same sidebar handoff
  pattern as the unsupported format handler.

### Phase 4 — Completed 2026-04-12

**Files created:**

| File                             | Purpose                                                |
| -------------------------------- | ------------------------------------------------------ |
| `src/utils/guide-safety.ts`      | `isMainAreaSafe()` — safety classifier for JSON guides |
| `src/utils/guide-safety.test.ts` | Safety classification tests (23 tests)                 |

**Files modified:**

| File                                                                  | Change                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/main-area-learning/main-area-learning-panel.tsx`      | Safety gate in `loadContent`, `handleSafetyGateOpenInSidebar`, warning alert render block     |
| `src/components/main-area-learning/main-area-learning-panel.test.tsx` | Added 5 Phase 4 tests, `guide-safety` mock, `locationService.push` mock, `openWithGuide` mock |
| `src/lib/analytics.ts`                                                | Added `MainAreaSafetyGateBlocked`, `MainAreaOpenInSidebarClicked` to enum                     |
| `src/constants/testIds.ts`                                            | Added `safetyGateWarning`, `safetyGateOpenInSidebarButton`                                    |
| `docs/design/MAIN-AREA-EDUCATION.md`                                  | Phase 3 and Phase 4 implementation log entries                                                |

**Deviations from design:**

- `isMainAreaSafe()` operates on the raw JSON string (`RawContent.content`) rather than
  `ParsedContent`. This avoids double-parsing — `ContentRenderer` already parses the
  content internally. JSON.parse + recursive block walk is simpler and more efficient.
- The safety check runs inside `loadContent()` (after `fetchContent` returns) rather
  than in `handleOpenGuideInMainArea()`. This ensures the check runs for both initial
  mount loads and in-place navigation, with a single code path.
- `unsafe_action_types` analytics payload is a comma-joined string (not an array)
  because `reportAppInteraction` only accepts `string | number | boolean` values.
- Phase 4.3 (surface safety in MyLearningTab guide cards) is deferred — it requires
  pre-classifying all guides at list render time, which needs a caching strategy.

**Notes for Phase 5 (Chrome Controls):**

- 8 of 9 planned `MainArea*` analytics events are now implemented. Remaining 1:
  `MainAreaChromeControlApplied` — for Phase 5.
- `locationService` is now imported in the panel (added for safety gate navigation).
  Phase 5 can reuse this import for chrome control navigation.
