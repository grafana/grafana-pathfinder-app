# Step model — canonical shape end to end

How a single interactive step flows from authored JSON to the engine action that drives Grafana's UI. Each row is a representation; each transition is the function that produces the next form.

| Layer          | Representation                                                                                      | Field naming                       | Owner                                |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| Author content | JSON block (`action`, `reftarget`, `targetvalue`, `tooltip`, `requirements[]`, optional `id`)       | lowercase, dashed where applicable | `src/types/json-guide.schema.ts`     |
| Parsed IR      | `ParsedElement.props` (`targetAction`, `refTarget`, `targetValue`, `targetComment`, `requirements`) | camelCase                          | `src/docs-retrieval/json-parser.ts`  |
| React props    | `InteractiveStepProps`, `InteractiveSectionProps`, etc.                                             | camelCase                          | `src/types/component-props.types.ts` |
| Engine payload | `InteractiveElementData` (`targetAction`, `refTarget`, `targetValue`, `targetComment`)              | camelCase                          | `src/types/interactive.types.ts`     |
| DOM attributes | `data-targetaction`, `data-reftarget`, `data-targetvalue`                                           | dashed-lowercase per W3C           | DOM, dev tooling                     |

The JSON authoring layer and the DOM-attribute layer keep their lowercase forms (external conventions); every JS object in between is camelCase.

## JSON field aliasing

The canonical JSON form is lowercase (`action`, `reftarget`, `targetvalue`). The runtime parser additionally tolerates the camelCase aliases (`targetAction`, `refTarget`, `targetValue`) on raw JSON input — when both are present, the lowercase form wins; when only the camelCase alias is set, the Zod validator still rejects the guide (CLI flag generation depends on the canonical-only schema). Schema-level acceptance of camelCase aliases is a deliberate follow-up.

Authors can also write an explicit `id` on an interactive block; the parser plumbs it through to `ParsedElement.props.stepId`, overriding the section's positional `${sectionId}-step-N` convention. This is the recommended path for stable `section-completed:` requirement targets.

## Completion store — single source of truth

Step completion lives in `src/components/interactive-tutorial/completion-store.ts`. The store IS the source of truth — `SectionState` no longer carries a parallel `completed` set, and step components no longer maintain a local `isLocallyCompleted` flag. The store backs the existing `interactiveStepStorage` namespace so localStorage shape is preserved.

Public API:

- `useStepCompletion(stepId, sectionId?)` — `useSyncExternalStore`-backed live read for a single step.
- `useSectionCompletion(sectionId)` — `ReadonlySet<string>` of completed step IDs for the section, stable identity between renders that didn't change membership.
- `markStepCompleted(stepId, sectionId | undefined, reason)` — single-step write.
- `resetStep(stepId, sectionId?)` — single-step clear.
- `markStepsCompleted(stepIds, sectionId, reason?)` — atomic bulk write (used by the section's objectives-auto-complete and run-section paths).
- `resetSteps(stepIds, sectionId)` — atomic tail-reset used by the section's individual-step redo path.
- `resetSection(sectionId)` — atomic clear used by the section's full-reset path.
- `getGuideProgress(contentKey)` — `{ completed, total, percentage }` snapshot.
- `evictSectionCache(sectionId)` — drop a section's cache + hydration marker without writing storage. Called by `InteractiveSection`'s preview-mode unmount path so a remount under the same preview key starts fresh.

Hydration is lazy and per-section. Preview-mode content keys (`block-editor://preview/...`, `devtools`) bypass storage writes entirely — the in-memory cache still updates so ephemeral preview UI keeps reacting.

## Section reducer — minimal state

`section-state.ts` owns one bit: `acknowledged: true | null` (the #842 gate). Cursor is a pure derivation of `(stepIds, completedSet)` via `computeCursor(stepIds, completed)`; the completion set comes from `useSectionCompletion`. Reducer actions:

- `RESTORE` — `{ acknowledged }`. Mount-only.
- `ACKNOWLEDGE` — `{ completedCount }`. Refused when `completedCount === 0` (#842 Bug 1 structural invariant).
- `CLEAR_ACK` — fired by every reset path (single-step redo, section reset, run-section restart) so re-completing always re-triggers the gate.

The store handles completion writes; the reducer coordinates the ack bit. Call sites in `interactive-section.tsx` always do "store write THEN dispatch" so the ack-rejected-when-empty invariant is enforced by call-site sequence + reducer guard.

## Step-type registry — single source for type metadata

`src/components/interactive-tutorial/step-type-registry.ts` lists every tracked interactive step type via `STEP_TYPE_SCHEMAS`. Each schema carries:

- `kind` — runtime discriminant
- `parseTypeKey` — the `ParsedElement.type` string the JSON parser emits
- `idPrefix` — stepId numbering prefix
- `refTarget` — where the section stores ref callbacks
- `toStepInfoExtension(props)` / `toEnhancedProps(ctx)` — section orchestration glue

`STEP_TYPE_PARSE_KEYS` (derived from the schemas) drives `content-renderer.tsx`'s `INTERACTIVE_STEP_TYPES` set. Adding a new step type means editing the registry and `section-child-classifier.ts`'s `INTERACTIVE_STEP_COMPONENT_TYPES` — see `.cursor/rules/tracked-step-types.mdc` for the full checklist.

## Unified progress event

`src/global-state/progress-events.ts` defines the unified `pathfinder:progress` event:

```ts
type ProgressEventDetail =
  | { kind: 'step'; stepId; sectionId?; completed; reason }
  | { kind: 'section'; sectionId; completed; percentage? }
  | { kind: 'guide'; contentKey; percentage; hasProgress };
```

Listeners use `subscribeProgressEvent(detail => ...)`. The store fires `kind: 'step'` from `markStepCompleted` / `resetStep`, `kind: 'guide'` from its `persistSection` writes. `interactive-section.tsx` fires `kind: 'section'` when the section transitions to a terminal state. The four legacy events (`interactive-step-completed`, `section-completed`, `interactive-section-completed`, `interactive-progress-saved`) are gone.

The orphan `step-auto-skipped` listener at `step-checker.hook.ts:746` was removed in C3 — there were no dispatchers anywhere in the repo.

`interactive-progress-cleared` (dispatched by `handleResetSection` and `useContentReset`) is the one remaining legacy event — it still drives ephemeral preview / alignment UI and will fold into `kind: 'guide'` with `hasProgress: false` once those listeners migrate.

## Tab loader

`docs-panel.tsx` exposes `loadTab(tabId, url, options?)` as the unified entry point. It dispatches to the legacy `loadTabContent` / `loadDocsTabContent` pair internally based on `shouldUseDocsLoader` + `packageInfo`. The previous explicit branches in `initializeRestoredActiveTab`, `setActiveTab`, `reloadActiveTab`, and `useContentReset` are gone.

## Content-key resolution

`src/global-state/content-key.ts` is the typed module that owns `getContentKey()`. It reads from the typed module state first, falling back to the legacy `window.__DocsPluginActiveTabUrl` / `__DocsPluginContentKey` globals so consumers can migrate piecemeal.

## Importing the types

Each layer owns its own types — there is no central re-export module. Import directly from the authoritative location:

- `StepCompletionEntry`, `GuideProgress`, `UseStepCompletionResult` — `src/components/interactive-tutorial/completion-store.ts`
- `ProgressEventDetail` — `src/global-state/progress-events.ts`
- `CompletionReason` — `src/requirements-manager` (barrel)
- `InteractiveElementData`, `InteractiveActionType` — `src/types/interactive.types.ts`
- `SectionState`, `SectionAction`, `computeCursor`, `deriveSectionState` — `src/components/interactive-tutorial/section-state.ts`
