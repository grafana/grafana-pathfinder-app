# Learning paths

The `src/learning-paths/` module provides the business logic layer for the gamified learning system. It manages learning path definitions, badge awarding, streak tracking, and progress state. The UI components that render this data live in `src/components/LearningPaths/` and are documented separately.

## File listing

| File                                           | Purpose                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `index.ts`                                     | Public API barrel export                                                                                |
| `paths-data.ts`                                | Runtime platform selection (OSS vs Grafana Cloud)                                                       |
| `paths.json`                                   | OSS path definitions (static, bundled guide IDs)                                                        |
| `paths-cloud.json`                             | Grafana Cloud path definitions (superset of OSS; includes URL-based paths)                              |
| `app-platform-paths.ts`                        | Adapts published App Platform path and journey packages into learning paths                             |
| `badge-coordinator.ts`                         | Orchestrates guide completion, badge awarding, streak updates, analytics, and progress events           |
| `badges.ts`                                    | 12 badge definitions, trigger types, and earning logic                                                  |
| `learning-paths.hook.ts`                       | Main `useLearningPaths()` hook — unified state management                                               |
| `streak-tracker.ts`                            | Streak calculation, milestones, and display helpers                                                     |
| `fetch-path-guides.ts`                         | Fetches guide lists from remote `index.json` for URL-based paths                                        |
| `useNextLearningAction.ts`                     | `useNextLearningAction()` hook and pure `computeNextAction()` for the UserProfileBar                    |
| `useDiscoverMore.ts`                           | `useDiscoverMore()` hook — surfaces external learning paths for the My Learning "Discover more" section |
| `launch-package-info.ts`                       | Pure `PackageOpenInfo` factories for the two manifest-backed My Learning launches                       |
| `learning-paths.test.ts`                       | Data-integrity tests for path, badge, and guide metadata definitions                                    |
| `fetch-path-guides.test.ts`                    | Tests for remote guide fetching                                                                         |
| `app-platform-paths.test.ts`                   | Tests for App Platform catalogue adaptation                                                             |
| `badge-coordinator.test.ts`                    | Tests for guide-completion orchestration                                                                |
| `learning-paths.hook.test.ts`                  | Tests for hook fetching, metadata resolution, and App Platform merging                                  |
| `learning-paths.completion-round-trip.test.ts` | Integration tests for guide completion flowing back into hook state                                     |
| `reset-path-completion.test.ts`                | Integration tests for path reset behavior                                                               |
| `useNextLearningAction.test.ts`                | Tests for next-action computation                                                                       |
| `useDiscoverMore.test.ts`                      | Tests for the Discover more hook                                                                        |

## Path types

Learning paths come from three sources.

### Static paths

Static paths declare their guides inline as an ordered array of bundled guide IDs:

```json
{
  "id": "getting-started",
  "title": "Getting started with Grafana",
  "guides": ["welcome-to-grafana", "prometheus-grafana-101", "first-dashboard"],
  "badgeId": "grafana-fundamentals"
}
```

Guide content for static paths is bundled in `src/bundled-interactives/`. The `guideMetadata` section of the JSON file maps each guide ID to its display title and estimated duration.

### URL-based paths

URL-based paths point to a remote docs site and declare `guides: []` in their static definition:

```json
{
  "id": "linux-server-integration",
  "title": "Monitor a Linux server",
  "url": "https://grafana.com/docs/learning-paths/linux-server-integration/",
  "guides": [],
  "badgeId": "penguin-wrangler"
}
```

At runtime, `fetchPathGuides()` fetches `{url}index.json` and parses the response (a Hugo/Jekyll page listing) into an ordered list of guide slugs and metadata. Items with `params.grafana.skip` set are filtered out. The slug is derived from the last segment of each item's `relpermalink`.

The `useLearningPaths()` hook merges these dynamically fetched guides into the path objects, so consumers see a unified `LearningPath` with a populated `guides` array regardless of the path type.

### App Platform paths

`fetchAppPlatformLearningPaths()` reads the stack's private custom-guide catalogue through `fetchCustomGuideRepository()`. It includes only published packages whose manifest type is `path` or `journey`, and includes only published milestone members in each synthesized path. The adapter marks every synthesized path with `isPrivate: true` and builds metadata for every published catalogue entry, using `backend-guide:{id}` URLs so path members launch through the App Platform content resolver.

These paths are fetched when `config.namespace` is available and appended after the bundled and URL-based paths. Their package manifest is carried on the `LearningPath` so the My Learning launch flow can preserve milestone context. In-progress private paths appear in the separate **Private paths** section, completed private paths join the shared **Completed** section, and their titles remain excluded from **Discover more**.

## Platform selection

`getPathsData()` in `paths-data.ts` returns the appropriate `PathsDataSet` (paths array + guide metadata) based on the current Grafana edition:

- **OSS**: loads `paths.json` — contains OSS-only paths with static bundled guides.
- **Grafana Cloud**: loads `paths-cloud.json` — contains all OSS paths plus cloud-only and URL-based paths.

The detection uses `config.bootData.settings.cloudMigrationIsTarget` from `@grafana/runtime`. When `true`, the cloud data set is selected; otherwise, it falls back to OSS.

The `PathsDataSet` interface:

```typescript
interface PathsDataSet {
  paths: LearningPath[];
  guideMetadata: Record<string, GuideMetadataEntry>;
}
```

## Badge system

### Definitions

The `BADGES` array in `badges.ts` defines 12 badges. Each badge has an `id`, `title`, `description`, `icon`, an optional `emoji`, and a `trigger` that determines how it is earned.

### Trigger types

| Trigger type      | Fields                | Condition                                                    |
| ----------------- | --------------------- | ------------------------------------------------------------ |
| `guide-completed` | `guideId?` (optional) | Any guide completed, or a specific guide if `guideId` is set |
| `path-completed`  | `pathId`              | All guides in the specified path are in `completedGuides`    |
| `streak`          | `days`                | `streakDays >= days` in the user's progress                  |

### Awarding logic

`getBadgesToAward()` iterates all badges, skipping already-earned ones, and checks each trigger against the current `LearningProgress` and available `LearningPath[]`.

For `path-completed` triggers, `isPathCompleted()` returns `false` when `path.guides.length === 0`. This is vacuous-truth protection for URL-based paths whose guides are fetched dynamically — without this guard, `[].every(...)` would return `true` and award the badge immediately. Badge awarding for URL-based paths is instead handled in `docs-retrieval/learning-journey-helpers.ts` via `markMilestoneDone`.

### Helper functions

- `getBadgeById(id)` — look up a single badge definition
- `getBadgesByTriggerType(type)` — filter badges by trigger type
- `getEarnedBadgeCount(progress)` — count earned badges
- `getTotalBadgeCount()` — total badge count (currently 12)
- `sortBadgesForDisplay(badges, earnedIds)` — sort earned badges first, preserving original order within groups

### Legacy badge handling

`useLearningPaths()` preserves badges from previous versions that no longer appear in the `BADGES` array. These are displayed with the title derived from the badge ID (kebab-case converted to title case) and a generic "This badge was earned in a previous version" description. Legacy badges are flagged with `isLegacy: true` so the UI can distinguish them.

## Streak tracking

`streak-tracker.ts` provides pure functions for streak calculation and display.

### Core calculation

`calculateUpdatedStreak(currentStreak, lastActivityDate)` returns the updated streak count:

| Scenario                                           | Result                              |
| -------------------------------------------------- | ----------------------------------- |
| No previous activity (`lastActivityDate` is empty) | `1`                                 |
| Last activity was today                            | No change (returns `currentStreak`) |
| Last activity was yesterday                        | `currentStreak + 1`                 |
| Gap of more than one day                           | Reset to `1`                        |

Dates are compared as UTC `YYYY-MM-DD` strings derived with `toISOString()`.

### Display info

`getStreakInfo(currentStreak, lastActivityDate)` returns a `StreakInfo` object for display purposes:

- `days` — current streak count (0 if broken)
- `isActiveToday` — whether the user has logged activity today
- `isAtRisk` — `true` when the user was active yesterday but not yet today

If more than one day has elapsed since the last activity, the streak is reported as broken (`days: 0`).

### Milestones

`STREAK_MILESTONES` is `[3, 7, 14, 30]`. Related functions:

- `checkStreakMilestone(previous, new)` — returns the milestone crossed, or `null`
- `getNextMilestone(current)` — returns the next milestone to reach, or `null` if all achieved
- `getMilestoneProgress(current)` — percentage progress toward the next milestone

### Visibility

`shouldShowStreak(streakInfo)` returns `true` when the streak is active (`days > 0`) or at risk. `getStreakMessage(streakInfo)` returns a human-readable status string.

## Progress management

### State loading and synchronization

`useLearningPaths()` loads the user's `LearningProgress` from `learningProgressStorage` on mount. It listens for `CustomEvent('learning-progress-updated')` dispatched by the completion coordinator and storage helpers to sync state when progress changes elsewhere in the app (for example, when a guide is completed from the docs panel). If the event includes a `detail.progress` payload, it is used directly; otherwise, progress is re-read from storage.

### Marking guides completed

`markGuideCompleted(guideId)` delegates to the Tier 2 coordinator in `badge-coordinator.ts`. The coordinator loads and persists progress through `learningProgressStorage`, updates the streak, evaluates and records new badges, reports badge analytics, and dispatches the progress event. The storage layer only persists learning progress and exposes focused mutation helpers. The coordinator function is also exported directly from the module's `index.ts` barrel for completion flows that do not need the hook.

### Dismissing celebrations

`dismissCelebration(badgeId)` removes a badge ID from `pendingCelebrations` both in local state and in persistent storage via `learningProgressStorage.dismissCelebration()`.

### Resetting a path

`resetPath(pathId)` clears progress for a path. The behavior differs by path type:

**Static and App Platform paths**: Clears interactive steps, interactive completion, and journey completion for both the path's own keys and each member guide under both `bundled:` and `backend-guide:` schemes. It also clears milestone completion for the path keys, evicts the corresponding in-memory completion cache entries, and removes the member guide IDs from `completedGuides`. Clearing both schemes lets the same reset path handle bundled and App Platform entries without inferring the source from bare guide IDs.

**URL-based paths**: Clears milestone tracking for the path URL and removes the fetched guide slugs from `completedGuides`. It discovers interactive and journey completion keys by normalized URL prefix, clears them in batches (including the path URL's own journey-completion key), clears matching interactive steps, and evicts matching in-memory completion cache entries.

After either reset path, the hook dispatches `CustomEvent('interactive-progress-cleared')` and reloads learning progress so UI components refresh.

The My Learning **Reset all progress** action is broader: it discards queued durable completion writes, then clears all learning progress, journey completion, milestone checklists, interactive steps, interactive completion, and in-memory completion caches before dispatching the same refresh event. Clearing milestone storage prevents an old checklist from immediately re-crossing the whole-path completion threshold after the reset. The `discardQueuedCompletionWrites()` call runs first, before the reset's first `await`: a completion write that has not left the browser is still the user's to withdraw, and a drain scheduled before the reset would otherwise fire inside that window and mint durable records for the guides they just asked us to forget.

## Key hooks and exports

### `useLearningPaths()`

The primary hook exported from the module. Returns `UseLearningPathsReturn`:

| Property                              | Type                                      | Description                                                |
| ------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `paths`                               | `LearningPath[]`                          | Bundled, URL-based, and App Platform paths                 |
| `allBadges`                           | `Badge[]`                                 | All defined badges                                         |
| `badgesWithStatus`                    | `EarnedBadge[]`                           | Badges with earned state and legacy badges appended        |
| `progress`                            | `LearningProgress`                        | Current progress (guides, badges, streak, celebrations)    |
| `getPathGuides(pathId)`               | `(string) => PathGuide[]`                 | Guides for a path with completion and current-guide status |
| `getPathProgress(pathId)`             | `(string) => number`                      | Completion percentage (0–100)                              |
| `isPathCompleted(pathId)`             | `(string) => boolean`                     | Whether progress is 100%                                   |
| `getGuideUrlForPath(guideId, pathId)` | `(string, string) => string \| undefined` | Resolves a guide URL within its parent path                |
| `markGuideCompleted(guideId)`         | `(string) => Promise<void>`               | Delegates to the completion coordinator                    |
| `resetPath(pathId)`                   | `(string) => Promise<void>`               | Clears progress for a path                                 |
| `dismissCelebration(badgeId)`         | `(string) => Promise<void>`               | Removes a pending celebration                              |
| `streakInfo`                          | `StreakInfo`                              | Current streak display info                                |
| `isLoading`                           | `boolean`                                 | Initial progress loading state                             |
| `isDynamicLoading`                    | `boolean`                                 | Whether URL-based guide data is still being fetched        |

### `useGuideCompletion()`

A convenience hook that wraps `useLearningPaths()` and returns only `{ markGuideCompleted }`. Used by guide rendering components that need to mark completion without the full learning paths state.

### `useNextLearningAction()`

Returns a `LearningProfileSummary` for the UserProfileBar:

| Property          | Type                         | Description                        |
| ----------------- | ---------------------------- | ---------------------------------- |
| `badgesEarned`    | `number`                     | Count of earned non-legacy badges  |
| `badgesTotal`     | `number`                     | Count of non-legacy badges         |
| `guidesCompleted` | `number`                     | Total completed guide count        |
| `streakDays`      | `number`                     | Current streak days                |
| `isActiveToday`   | `boolean`                    | Whether user has been active today |
| `nextAction`      | `NextLearningAction \| null` | Next recommended guide to open     |
| `isLoading`       | `boolean`                    | Loading state                      |

### `computeNextAction()`

A pure function (no hooks) that computes the next learning action. It sorts paths with the following priority:

1. In-progress paths, ordered by highest completion percentage first
2. Not-started paths
3. Completed paths are skipped

From the highest-priority path, it selects the first guide with `isCurrent: true`. It prefers the path-scoped URL already resolved on that guide, which opens the actual next module for URL-based paths and uses `backend-guide:` URLs for App Platform members. It then falls back to the path URL, static metadata, or `bundled:{guideId}` in that order.

### `useDiscoverMore()`

Surfaces novel external learning paths for the My Learning "Discover more" section. It deliberately bypasses the context recommender's path-targeting — which returns few or zero packages on the home surface — and instead pulls the full upstream package index (`repository.json`, proxied by the backend) via `fetchOnlinePackageRecommendations`. It keeps only `path`-typed entries (whole learning paths, not individual guides), mapping each to a `DiscoverMoreItem` whose `contentUrl` points at the package's `content.json`. When an entry has an inlined manifest, the hook validates it with `ManifestJsonObjectSchema` and carries the valid result on the item. My Learning passes that manifest to `prepareGuideLaunch()` as `packageInfo`, avoiding a redundant manifest fetch while preserving milestone context; when it is absent or invalid, launch preparation can derive package context from the content URL. The hook returns up to `count` items (default 5), skipping any whose title is already shown elsewhere on the page (via `excludeTitles`). It fails soft: the client never throws and yields an empty index when offline, so the UI renders an empty state rather than an error.

## Integration points

### User storage (`src/lib/user-storage/`)

The module depends on several storage instances:

- `learningProgressStorage` — persists `LearningProgress` and provides focused badge, streak, guide-removal, and reset operations
- `interactiveStepStorage` — per-guide interactive step progress (used by `resetPath`)
- `interactiveCompletionStorage` — interactive guide completion flags (used by `resetPath`)
- `journeyCompletionStorage` — journey-level completion (used by `resetPath`)
- `milestoneCompletionStorage` — milestone completion for URL-based and package-backed paths (used by resets)

Static guide completion flows through `markGuideCompleted()` in `badge-coordinator.ts`, which evaluates badges against the bundled path definitions. URL-based and App Platform journey milestones flow through `markMilestoneDone` in `docs-retrieval/learning-journey-helpers.ts`; it updates local completion state and emits completion facts (including the whole-journey `journey_completed` trigger) through the `completion-records` recorder.

### UI components (`src/components/LearningPaths/`)

The components consume the hooks exported from this module to render learning path cards, badge collections, streak indicators, and the learning dashboard. `MyLearningTab` separates incomplete paths by `isPrivate`: `PrivatePathsSection` renders organization-published paths above the curated courses and badges, while returning nothing when there are no private paths. The module provides the data and actions; the components handle rendering and user interaction.

### Content system (`src/docs-retrieval/`)

`fetchPathGuides()` fetches guide data from remote `index.json` files, using the same pattern as the content fetcher's learning journey metadata parser. Guide metadata resolution is scoped to a path for dynamically fetched guides, then falls back to App Platform catalogue metadata and finally the static `guideMetadata` from the JSON data files. Remote- and catalogue-derived metadata maps use null prototypes, while static lookup is gated with `Object.hasOwn()` so authored IDs cannot resolve inherited object properties.

### App Platform package system

`app-platform-paths.ts` consumes the private catalogue exposed by `src/lib/custom-guide-repository-client.ts`. That client calls the backend `/custom-guide-repository` proxy, applies a short per-namespace cache with in-flight request deduplication, and fails soft to an empty catalogue when the capability or request is unavailable. My Learning launches `backend-guide:` member URLs through the package-content resolver while carrying the parent manifest as package context.

The shared resolver lifecycle lives in `src/docs-retrieval/content-fetcher/package-resolver-registry.ts`. During synchronous plugin initialization, `module.tsx` registers a factory before any panel mounts. The factory dynamically imports and constructs the composite resolver only on the first `getPackageResolver()` call, and the registry memoizes that promise. Package-content consumers use it to resolve milestones, related package links, path base URLs, and bare package IDs. A refreshed plugin configuration re-registers the factory so the next read uses the current settings.

### Events

| Event                          | Dispatched by                              | Listened by                   |
| ------------------------------ | ------------------------------------------ | ----------------------------- |
| `learning-progress-updated`    | Completion coordinator and storage helpers | `useLearningPaths()` hook     |
| `interactive-progress-cleared` | Path reset and Reset all progress          | UI components needing refresh |

## See also

- [Learning Paths components](../components/LearningPaths/README.md) — UI component documentation
- `src/types/learning-paths.types.ts` — TypeScript type definitions
- `src/lib/user-storage.ts` — Storage layer for learning progress and completion state
