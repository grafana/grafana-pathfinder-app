# Learning paths

The `src/learning-paths/` module provides the business logic layer for the gamified learning system. It manages learning path definitions, badge awarding, streak tracking, and progress state. The UI components that render this data live in `src/components/LearningPaths/` and are documented separately.

## File listing

| File                            | Purpose                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `index.ts`                      | Public API barrel export                                                             |
| `paths-data.ts`                 | Runtime platform selection (OSS vs Grafana Cloud)                                    |
| `paths.json`                    | OSS path definitions (static, bundled guide IDs)                                     |
| `paths-cloud.json`              | Grafana Cloud path definitions (superset of OSS; includes URL-based paths)           |
| `badges.ts`                     | 12 badge definitions, trigger types, and earning logic                               |
| `learning-paths.hook.ts`        | Main `useLearningPaths()` hook — unified state management                            |
| `streak-tracker.ts`             | Streak calculation, milestones, and display helpers                                  |
| `fetch-path-guides.ts`          | Fetches guide lists from remote `index.json` for URL-based paths                     |
| `useNextLearningAction.ts`      | `useNextLearningAction()` hook and pure `computeNextAction()` for the UserProfileBar |
| `learning-paths.test.ts`        | Tests for the main hook                                                              |
| `fetch-path-guides.test.ts`     | Tests for remote guide fetching                                                      |
| `useNextLearningAction.test.ts` | Tests for next-action computation                                                    |

## Path types

Learning paths come in two variants based on how their guides are sourced.

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

For `path-completed` triggers, `isPathCompleted()` returns `false` when `path.guides.length === 0`. This is vacuous-truth protection for URL-based paths whose guides are fetched dynamically — without this guard, `[].every(...)` would return `true` and award the badge immediately. Badge awarding for URL-based paths is instead handled in `user-storage.ts` via `markMilestoneDone`.

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

Dates are compared as `YYYY-MM-DD` strings derived from the user's local timezone.

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

`useLearningPaths()` loads the user's `LearningProgress` from `learningProgressStorage` on mount. It listens for `CustomEvent('learning-progress-updated')` dispatched by the storage layer to sync state when progress changes elsewhere in the app (for example, when a guide is completed from the docs panel). If the event includes a `detail.progress` payload, it is used directly; otherwise, progress is re-read from storage.

### Marking guides completed

`markGuideCompleted(guideId)` delegates to `learningProgressStorage.markGuideCompleted()`, which handles streak updates, badge awarding, and event dispatch. The hook does not perform badge checks itself — it relies on the storage layer and event-driven synchronization.

### Dismissing celebrations

`dismissCelebration(badgeId)` removes a badge ID from `pendingCelebrations` both in local state and in persistent storage via `learningProgressStorage.dismissCelebration()`.

### Resetting a path

`resetPath(pathId)` clears progress for a path. The behavior differs by path type:

**Static paths**: For each guide ID in the path, clears the interactive step storage (`bundled:{guideId}`), interactive completion storage, and journey completion storage. Then removes the guide IDs from `completedGuides`.

**URL-based paths**: Clears milestone tracking (`milestoneCompletionStorage`), journey completion, and `completedGuides` for the fetched guide slugs. Also clears interactive steps and completions for any content key that starts with the path's normalized URL. After clearing, dispatches `CustomEvent('interactive-progress-cleared')` so UI components can refresh.

## Key hooks and exports

### `useLearningPaths()`

The primary hook exported from the module. Returns `UseLearningPathsReturn`:

| Property                      | Type                        | Description                                                |
| ----------------------------- | --------------------------- | ---------------------------------------------------------- |
| `paths`                       | `LearningPath[]`            | Paths for the current platform with dynamic guides merged  |
| `allBadges`                   | `Badge[]`                   | All defined badges                                         |
| `badgesWithStatus`            | `EarnedBadge[]`             | Badges with earned state and legacy badges appended        |
| `progress`                    | `LearningProgress`          | Current progress (guides, badges, streak, celebrations)    |
| `getPathGuides(pathId)`       | `(string) => PathGuide[]`   | Guides for a path with completion and current-guide status |
| `getPathProgress(pathId)`     | `(string) => number`        | Completion percentage (0–100)                              |
| `isPathCompleted(pathId)`     | `(string) => boolean`       | Whether progress is 100%                                   |
| `markGuideCompleted(guideId)` | `(string) => Promise<void>` | Delegates to storage layer                                 |
| `resetPath(pathId)`           | `(string) => Promise<void>` | Clears progress for a path                                 |
| `dismissCelebration(badgeId)` | `(string) => Promise<void>` | Removes a pending celebration                              |
| `streakInfo`                  | `StreakInfo`                | Current streak display info                                |
| `isLoading`                   | `boolean`                   | Initial progress loading state                             |
| `isDynamicLoading`            | `boolean`                   | Whether URL-based guide data is still being fetched        |

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

From the highest-priority path, it selects the first guide with `isCurrent: true`. For URL-based paths, the returned `guideUrl` points to the path URL; for static paths, it uses the guide's metadata URL or falls back to `bundled:{guideId}`.

## Integration points

### User storage (`src/lib/user-storage/`)

The module depends on several storage instances:

- `learningProgressStorage` — persists `LearningProgress`, handles `markGuideCompleted`, badge awarding, and streak updates
- `interactiveStepStorage` — per-guide interactive step progress (used by `resetPath`)
- `interactiveCompletionStorage` — interactive guide completion flags (used by `resetPath`)
- `journeyCompletionStorage` — journey-level completion (used by `resetPath`)
- `milestoneCompletionStorage` — milestone completion for URL-based paths (used by `resetPath`)

Badge awarding for static paths is handled by `learningProgressStorage`. Badge awarding for URL-based paths is handled by `markMilestoneDone` in `user-storage.ts`.

### UI components (`src/components/LearningPaths/`)

The components consume the hooks exported from this module to render learning path cards, badge collections, streak indicators, and the learning dashboard. The module provides the data and actions; the components handle rendering and user interaction.

### Content system (`src/docs-retrieval/`)

`fetchPathGuides()` fetches guide data from remote `index.json` files, using the same pattern as the content fetcher's learning journey metadata parser. Guide metadata resolution in the hook checks dynamically fetched metadata first, then falls back to the static `guideMetadata` from the JSON data files.

### Events

| Event                          | Dispatched by                  | Listened by                   |
| ------------------------------ | ------------------------------ | ----------------------------- |
| `learning-progress-updated`    | Storage layer (`user-storage`) | `useLearningPaths()` hook     |
| `interactive-progress-cleared` | `resetPath()`                  | UI components needing refresh |

## See also

- [Learning Paths components](../components/LearningPaths/README.md) — UI component documentation
- `src/types/learning-paths.types.ts` — TypeScript type definitions
- `src/lib/user-storage/` — Storage layer that handles persistence and badge awarding
