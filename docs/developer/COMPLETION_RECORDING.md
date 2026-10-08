# Completion recording — the seam end to end

How a reader's click becomes a durable progress or completion record, which modules own each hop, and what a change must keep true. Load this when you add an interactive block, add or refactor a surface that renders guides (sidebar, floating, full screen, guide reader, or a new view mode), add a way to finish or reset a guide, or read raw `CompletionRecord` rows.

This page is the map. The contracts it routes to live elsewhere and win when they disagree with this page:

- `docs/design/COMPLETION-MODEL.md` — why progress is counted the way it is (decision records).
- `docs/developer/STEP_MODEL.md` — the completion store's read/write surface, reset eviction, cross-tab sync.
- `docs/design/BACKEND_PROXY_PATTERN.md` §11 — the write proxy, identity, retry taxonomy.
- `docs/developer/FEATURE_FLAGS.md` and `docs/developer/TELEMETRY.md` — the flags and analytics events named below.
- `docs/design/CONCERN_DETAILS.md` → `completion-records` — review questions and named invariants.

## Why this seam is fragile

Most of the pipeline is reached by **convention**, not by types. A surface that never registers an identity, a block that never calls the store, or a renderer mount without `onGuideComplete` all type-check, render correctly, and record nothing. Nothing throws; the progress observer logs at debug level and returns. Review routing cannot see an omission either, because an omission adds no lines to a diff. Treat every extension checklist below as mandatory, and prefer a change that turns an omission into a compile or test failure.

## Two signals, one pipeline

A guide produces two kinds of record:

- **Partial progress** — an _attempt_: one record per `(user, attemptId)`, updated in place as the reader's percentage rises, with no `completedAt` until it reaches 100.
- **Terminal completion** — one fact per `(kind, guideSource, guideId)` per completion, emitted through the single recorder. When the guide had an open attempt, the terminal fact carries that `attemptId` and closes it.

```text
block component ──markStepCompleted / markStepsCompleted / section acknowledgement──▶ completion-store
completion-store ──guideProgress() against the frozen index──▶ percentage
completion-store ──dispatchProgress({kind:'guide', origin})──▶ pathfinder:progress
                         │                                          │
                         ▼                                          ▼
         ContentRenderer terminal triggers              progress-observer (origin 'change' only)
                         │                                          │ lookupGuideIdentity(contentKey)
                         ▼                                          ▼
     surface onGuideComplete                              guide-attempts (mint, high-water)
     → recordGuideCompletionForSurface                              │
     → completion-recorder (attemptEligible)                        │ records mode + flag
                         │                                          ▼
                         └────────────▶ completion-write-hook → completion-write-queue
                                                     │
                                                     ▼
                       POST /completion-records (Go) → attempt upsert or legacy create
                                                     │
                                  ┌──────────────────┴──────────────────┐
                                  ▼                                     ▼
                  /completion-records/my collation          assignment satisfaction
                  (completions + inProgress)                (raw rows, terminal only)
```

## The hops

### 1. Evidence — blocks write to the completion store

`src/global-state/completion-store.ts` is the only producer of a guide's percentage. Blocks never compute or announce one; they write **evidence** keyed by the parser-assigned step id:

- `markStepCompleted(stepId, sectionId, reason)` — one step. Persists with origin `'change'`.
- `markStepsCompleted(stepIds, sectionId, reason)` — bulk (Do section, objectives auto-complete). Persists with origin `'change'`.
- `refreshAndNotifyGuideProgress(contentKey, 'change')` — a section acknowledgement (`interactive-section.tsx`), which writes no step. A section that storage already held complete at mount (`hydrated` on its section event) refreshes through `refreshGuidePercentageOnLoad` instead, announcing `'load'`.

The Mark complete control (`src/components/mark-complete/MarkCompleteFooter.tsx`), `markMilestoneDone` and `backfillLegacyMilestoneCompletion` (`src/docs-retrieval/learning-journey-helpers.ts`, folding legacy milestone data into the store) write 100 to the percentage namespace themselves and announce it with no origin. They are terminal paths, not progress: the observer ignores 100. Any other direct `dispatchProgress({ kind: 'guide' })` outside the store is a bypass.

Which block types count is fixed by `COMPLETION_AFFORDANCE_BLOCK_TYPES` (`src/lib/guide-stats/completion-affordance.ts`), kept in step with the runtime registry `STEP_TYPE_PARSE_KEYS` (`src/components/interactive-tutorial/step-type-registry.ts`). See `.cursor/rules/tracked-step-types.mdc` for the four-site registry.

### 2. Percentage and origin

The store bridges stored evidence into `guideProgress` (`src/lib/guide-stats/`) against the frozen per-key index in `global-state/active-guide-index.ts`, and announces `{ kind: 'guide', contentKey, percentage, hasProgress, origin }` on `pathfinder:progress` (`src/global-state/progress-events.ts`).

`origin` is the attempt contract:

| origin     | Meaning                                                    | Can start or raise an attempt |
| ---------- | ---------------------------------------------------------- | ----------------------------- |
| `'change'` | A step or section write the reader just made               | Yes                           |
| `'load'`   | A recompute of evidence already stored (hydration, reopen) | No                            |
| absent     | Resets, terminal 100% announcements, anything else         | No                            |

A new path that replays stored evidence — cross-device resume, sync, migration, restore — must never reach a `'change'` producer, or reopening a guide mints a phantom attempt.

### 3. Content key and identity

The event names a **content key** (a URL or path), not a guide. The key is ambient: `getContentKey()` in `src/global-state/content-key.ts` prefers the active tab URL and falls back to the renderer's `__DocsPluginContentKey`. `resolveGuideContentKey` lets a block-editor preview URL win. The sidebar publishes it through `useGlobalActiveTabExposure`; the floating, full-screen and guide-reader surfaces publish their own guide's key in the sidebar's spelling (`currentUrl || baseUrl`) through `usePublishSurfaceContentKey` (`src/hooks/`). Both run in a layout effect.

Only the surface rendering a guide holds the manifest that turns a key into an identity. Each surface calls `useGuideIdentityRegistration(content.url, surfaceCompletionInput)` (`src/components/content-renderer/`), which:

- resolves the identity through `resolveSurfaceGuideIdentity` — the **same** derivation `recordGuideCompletionForSurface` uses, so live progress and the terminal record key on one identity;
- resolves the content key in a passive effect, relying on the surface's key already being published by a layout effect;
- registers into `src/completion-records/guide-identity-registry.ts`: the latest mounted surface wins, and its cleanup restores the previous owner without removing another surface's registration.

`resolveSurfaceGuideIdentity` returns `null` — no attempt — for milestones, path and journey manifests, and guides with no manifest identity. Milestones and journeys are not attempt-eligible.

### 4. Observation — attempts

`src/completion-records/progress-observer.ts`, installed by `armCompletionWriteHook`, acts only on a `kind: 'guide'` event with origin `'change'`, a percentage in 1..99, a non-preview key, a registered identity, and a guide not already recorded complete. Under the origin-wide Web Lock (`withAttemptLock`) it:

1. reads or mints the attempt (`src/completion-records/guide-attempts.ts`);
2. ignores a closed attempt or a percentage at or below the high-water mark;
3. in `records` mode with `pathfinder.progress-records` on, hands the partial to the write queue, and stops if the queue declines it;
4. raises the high-water mark and reports a `guide_progress` threshold (0 on mint, then the highest of 25/50/75 crossed) when `pathfinder.progress-analytics` is on.

An attempt's **mode is fixed at mint**. It is `records` only when there is a queue owner, Web Locks work, the backend capability (`progress-records-capability.ts`) is `'yes'`, and `pathfinder.progress-records` is on; otherwise `analytics`. Unknown capability preserves the legacy completion path.

### 5. Terminal completion

`ContentRenderer` (`src/components/content-renderer/content-renderer.tsx`) fires `onGuideComplete(source, contentKey)` once per content, from the first of:

- every interactive section in its container completed;
- a `kind: 'guide'` event at 100% whose key matches the ambient key the surface published (`resolveGuideContentKey(content.url)`);
- the Mark complete control.

A reset re-arms it. Each surface forwards to `recordGuideCompletionForSurface` (`src/docs-retrieval/learning-journey-helpers.ts`), the single surface-neutral router. It decides milestone versus bundled versus standalone guide, and calls the recorder with `attemptEligible` true only for an ordinary guide. Journey refreshes pass `attemptEligible: false`.

`src/completion-records/completion-recorder.ts` emits once per `(kind, guideSource, guideId)`. It attaches the guide's attempt (minting one if none exists and the fact is eligible), reports the `guide_completed` analytics event under its own guard, and — only once a subscriber durably accepts the fact — sets the durable guard, closes the attempt, and raises its high-water mark to 100.

### 6. Queue and write

`completion-write-hook.ts` turns facts and partials into `CompletionWriteBody`s. `attemptId` goes on the wire only for a `records`-mode attempt; every other body is byte-identical to what released plugins accept. `completion-write-queue.ts`:

- names attempt items `${attemptId}-${percent}`, so same-percent writes from two tabs collapse;
- lets a later partial of the same attempt supersede a queued one, and debounces partials;
- holds a partial while capability is `unknown`, drops it on `no` or when its attempt is no longer current;
- on a lost attempt **completion**, reopens the attempt so the re-completion records under the same `attemptId`.

The Go side (`pkg/plugin/completion_records_attempt.go`) upserts one record per `(userID, attemptId)`: a stored percent at or above the incoming one is a no-op (monotonic, replay-safe), and `completedAt`, source and duration are written only at 100. An older CRD that still requires `completedAt` maps to a retryable 503, so partials wait for the schema.

### 7. Consumers of raw rows

- `pkg/plugin/completion_records.go` `collateCompletions` — completed rows become completions; rows with an empty `completedAt` become `inProgress`, shown only if the attempt started after the last completion.
- `pkg/plugin/assignment_satisfaction.go` — evaluates per row against `acceptCompletionsFrom`. A partial row is excluded today **only because** an empty `completedAt` fails `parseCompletionTime`. A new consumer must exclude partials explicitly.

### 8. Reset

`resetGuideProgress` (`src/components/docs-panel/hooks/resetGuideProgress.ts`) clears step, percentage and mark storage, evicts the store cache, derives the identity the writer would have used, and calls `invalidateEmittedCompletion`. That lifts both guards and calls `clearAttempt`, which also discards the queue's partials for that attempt. "Reset all" goes through `invalidateAllEmittedCompletions` → `clearAllAttempts` and `discardQueuedCompletionWrites`. The next `'change'` mints a fresh attempt.

## Invariants

- **Owner-scoped attempts.** Attempts are device-local, stored under the `(user, org)` queue owner, never synchronized through user storage, and legacy unscoped entries are never adopted.
- **Monotonic.** Within an attempt the client high-water mark and the stored percent only rise.
- **Terminal is terminal.** Only a 100% write sets `completedAt`. A closed attempt accepts no more partials until a reset clears it.
- **Retry identity.** A retried completion reuses its idempotency key; a lost attempt completion reopens and reuses its `attemptId`.
- **Origin.** Only a reader's write is `'change'`. Initialization, hydration, cross-tab sync and restore are never `'change'`. **Known deviation:** objectives auto-complete (`interactive-section.tsx`, `step-checker.hook.ts`) runs from an effect with no reader action yet saves with `'change'`, so opening a guide whose objectives are already met can start an attempt. Tracked in [#2102](https://github.com/grafana/grafana-pathfinder-app/issues/2102); do not copy the pattern into a new path.
- **One identity per surface render.** The identity registered for live progress and the identity recorded at completion come from the same `SurfaceCompletionInput`.
- **Separate guards.** The analytics guard (`completionReportedStorage`) and the durable guard (`completionEmittedStorage`) are independent; a dropped write lifts only the durable one.

## Extension checklists

### Adding an interactive block

- [ ] Decide whether it is completable — can emit evidence — not merely interactive. Passive blocks stay out of `COMPLETION_AFFORDANCE_BLOCK_TYPES`.
- [ ] Update the four-site registry in `.cursor/rules/tracked-step-types.mdc`.
- [ ] Record completion only through `markStepCompleted` / `markStepsCompleted` under the parser's `props.stepId`. Never call `dispatchProgress({ kind: 'guide' })` or compute a guide percentage — a block-local metric (for example "watched %") is not guide progress.
- [ ] Run `completion-affordance.parity.test.ts` and `progress.parity.test.ts`.

### Adding or refactoring a guide-rendering surface

- [ ] Build one `SurfaceCompletionInput` and pass it to both `useGuideIdentityRegistration` and `recordGuideCompletionForSurface` (via `onGuideComplete`). `onGuideComplete` is optional on `ContentRenderer`; omitting it silently records nothing.
- [ ] Call the registration hook unconditionally, above any early return.
- [ ] Publish this surface's content key with `usePublishSurfaceContentKey`, in the sidebar's spelling, so the store writes under this surface's guide and not the sidebar's. The hook's layout effect runs before registration's passive effect.
- [ ] Keep `ContentRenderer`'s `key` stable per content; a remount re-arms terminal completion.
- [ ] Mirror an existing surface test: `DocsPanelContentArea.test.tsx`, `FloatingPanelContent.test.tsx`, `GuideReaderOverlay.test.tsx`.

### Adding a way to finish a guide

- [ ] Route through `ContentRenderer`'s terminal trigger or `recordGuideCompletionForSurface`. Do not call `recordGuideCompletion` directly from a component.
- [ ] Keep `attemptEligible` false for milestones and journeys.

### Adding a reset or clear path

- [ ] Go through `resetGuideProgress` or `invalidateEmittedCompletion` / `invalidateAllEmittedCompletions`, so the attempt and queued partials clear with the storage. Clearing storage alone leaves a closed attempt that blocks re-completion.
- [ ] A reset-all path also calls `discardQueuedCompletionWrites` before any `await`, as `MyLearningTab.tsx` does. `invalidateAllEmittedCompletions` clears the queue only once the write hook is armed, through the `onAttemptReset` listener, and a scheduled drain can fire between the reset and that clear.

### Reading raw `CompletionRecord` rows

- [ ] Treat a row with empty `completedAt` (or `completionPercent < 100`) as in progress, explicitly — not as a parse failure.
- [ ] Add a test with a matching partial row that must not count as done.

## Tests that protect each hop

| Hop                      | Tests                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence and percentage  | `src/global-state/completion-store.test.tsx`, `src/lib/guide-stats/progress.parity.test.ts`, `completion-affordance.parity.test.ts`                              |
| Identity registration    | `src/completion-records/guide-identity-registry.test.ts`, `src/components/content-renderer/useGuideIdentityRegistration.test.tsx`, the three surface tests above |
| Observation and attempts | `progress-observer.test.ts`, `guide-attempts.test.ts`, `guide-attempt-coordination.test.ts`, `progress-records.test.ts`                                          |
| Terminal routing         | `src/docs-retrieval/learning-journey-helpers.completion-boundary.test.ts`, `completion-recorder.test.ts`                                                         |
| Queue and write          | `completion-write-queue.test.ts`, `completion-write-queue.attempts.test.ts`, `completion-write-hook.test.ts`                                                     |
| Backend                  | `pkg/plugin/completion_records_attempt_test.go`, `completion_records_test.go`, `assignment_satisfaction_test.go`                                                 |
| Reset                    | `src/components/docs-panel/hooks/resetGuideProgress.test.ts`                                                                                                     |

Known gap, tracked in [#2095](https://github.com/grafana/grafana-pathfinder-app/issues/2095): no runtime test proves each completable block's component reaches the store with `origin: 'change'`.
