# Main-Area Education: Rendering Interactive Content Outside the Sidebar

## Strategic Context and Design Rationale

### Why this exists

In a separate repository, we are developing AI skills that can write sophisticated
Pathfinder packages automatically by consulting many different sources. The resulting
packages are primarily **not interactive** — they are narrative and conceptual in form,
with minimal or zero interactive sections (clicking buttons, performing multi-step
actions, etc.). They are much more likely to contain things like images and video.

The main-area learning view exists to **use Grafana Cloud as a proper shell for arbitrary
educational content**. By dismissing the left nav and the right-hand sidebar, we reclaim
the full viewport for content that doesn't need the Grafana UI alongside it.

### The URL as integration primitive

One of the core design decisions is a URL scheme where guides can be passed in and
displayed in the learning area. This enables a critical integration point: the AI skill
that writes content can subsequently **open Pathfinder at a particular URL and have that
content displayed in the main app area**. The URL is the contract between the content
authoring pipeline and the rendering surface.

```
/a/grafana-pathfinder-app/learning?doc=bundled:prometheus-grafana-101&fullscreen=true
```

### Future content forms

This educational content surface is not limited to the current JSON guide format. Future
content could include:

- **PowerPoint / Google Slides** rendered as individual images inside Grafana Cloud
- **Video-heavy guides** with narrative text and embedded media
- **AI-generated narrative content** that is conceptual rather than procedural
- **Mixed media presentations** combining text, images, diagrams, and code samples

The architecture should accommodate these forms without requiring structural changes to
the rendering pipeline.

### Design principles

1. **Grafana Cloud as a shell**: The learning view should be able to take over the full
   viewport, using Grafana only as the host frame (authentication, routing, chrome).
2. **URL-driven content**: Any content that can be addressed by URL should be displayable.
   The URL is the integration seam between content authoring and content rendering.
3. **Narrative-first**: The primary content type is read-and-learn, not click-and-do.
   Interactive steps are a secondary concern, and content with DOM-targeting interactivity
   is correctly routed to the sidebar.
4. **Content pipeline independence**: The rendering surface should not need to know how
   content was authored (AI skill, manual authoring, imported slides). It only needs a
   URL and a content format it can render.

---

## Overview

Render interactive learning content (guides, quizzes, terminal steps, code blocks) in
Grafana's main app area at a dedicated `/learning` route, as an alternative to the
right-hand sidebar. Only **read-only and self-contained interactive content** is supported
— guides whose "Show Me" / "Do It" steps target external Grafana DOM elements remain
sidebar-only (enforced by the safety gate in `guide-safety.ts`).

### Goal URL

```
/a/grafana-pathfinder-app/learning?doc=bundled:prometheus-grafana-101
```

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

## Future Work: Chrome Controls (`&nav=` and `&sidebar=`)

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
| **Top bar / breadcrumbs**             | Part of Grafana's SceneAppPage shell. No known toggle.                                                                                                          | **No** — this is Grafana core chrome. Hiding it would require injecting CSS (`display: none` on the header), which is fragile across Grafana versions. Not recommended.                                                                           |

#### Left nav control (`&nav=false`)

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

#### Right sidebar control (`&sidebar=false`)

On mount when `sidebar=false`:

1. Check if sidebar is mounted via `sidebarState.getIsSidebarMounted()`.
2. If mounted, publish `{ type: 'close-extension-sidebar', payload: {} }` via
   `getAppEvents()`.
3. Store previous state for restoration.

On unmount:

- If we closed the sidebar and it was previously open, re-open it via
  `sidebarState.openSidebar()`.

**Edge case**: If the sidebar mounts _after_ our page loads (e.g., experiment
orchestrator triggers it), we need to suppress that. The listener approach
(`pathfinder-sidebar-mounted` → immediately close) is less invasive than modifying
`module.tsx` initialization logic.

#### Restore on navigation

Both nav and sidebar state must be restored when the user leaves the `/learning` route.
Use a `useRef` to track whether **we** made the change — do not track "previous state."
This avoids two failure modes: (a) React Strict Mode double-invoking the effect, and (b)
the user manually restoring chrome while on the `/learning` route.

#### Full-screen preset

```
&fullscreen=true  →  equivalent to &nav=false&sidebar=false
```

#### Risks and mitigations

| Risk                                               | Mitigation                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafana changes nav toggle markup                  | Same risk `NavigationManager` already carries; add E2E test that verifies the toggle exists                                                                                  |
| User manually re-opens nav/sidebar during learning | Don't fight it — only apply chrome changes on initial mount, don't continuously enforce                                                                                      |
| Cleanup doesn't run (page crash, hard nav)         | Accept graceful degradation — user just sees normal chrome on next page load. Nav/sidebar state is already persistent in localStorage, so Grafana restores its own defaults. |
| `sidebar=false` races with experiment auto-open    | The `pathfinder-sidebar-mounted` listener approach handles this; add a test for the race                                                                                     |

---

## Analytics

Analytics events use the `MainArea<Event>` naming convention in the `UserInteraction`
enum (`src/lib/analytics.ts`). All events fire via `reportAppInteraction()` with typed
payloads. See the enum for the current set.

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
   routed to the main area via `pathfinder-open-in-main-area` event. See
   `src/global-state/link-interception.ts`.

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

- `locationService` is now imported in the panel (added for safety gate navigation).
  Phase 5 can reuse this import for chrome control navigation.
