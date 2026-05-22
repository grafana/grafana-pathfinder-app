/**
 * Step completion store.
 *
 * Authoritative in-memory store for per-step completion, backed by
 * the existing `interactiveStepStorage` namespace so localStorage and
 * Grafana-user-storage shapes stay unchanged. Hydration is lazy and
 * scoped to the (contentKey, sectionId) the caller asks about.
 *
 * Every step component subscribes via `useStepCompletion(stepId, sectionId)`
 * and writes via `markStepCompleted` / `resetStep`. Section-managed steps
 * additionally fire `onStepComplete(stepId)` so the section reducer can
 * advance its cursor; the store's `markStepCompleted` write itself is
 * authoritative — no mirror-back hook is required.
 *
 * Lives in `global-state/` (Tier 1) so the requirements engine
 * (`requirements-manager`, Tier 2) can write authoritatively when the
 * FSM transitions to a terminal state (manual / skipped / objectives).
 * This collapses the previous dual-write pattern where the FSM updated
 * its own state and the step component separately wrote to the store —
 * a divergence on the skip and standalone-objectives paths.
 *
 * Reason values use `ProgressReason` (the Tier-1-resident union in
 * `./progress-events`), which is structurally identical to
 * `requirements-manager`'s `CompletionReason`. Kept structurally
 * duplicated rather than relocating the canonical type to Tier 0 —
 * the union is small + stable.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { interactiveCompletionStorage, interactiveStepStorage } from '../lib/user-storage';

import { getContentKey } from './content-key';
import { getTotalDocumentSteps } from './section-registry';
import { dispatchProgress, type ProgressReason } from './progress-events';

/** Synthetic section ID for steps that are not inside an `<InteractiveSection>`. */
export const STANDALONE_SECTION_ID = '__standalone__';

export interface StepCompletionEntry {
  completed: boolean;
  reason: ProgressReason | null;
  /** ms since epoch; 0 when restored from storage (storage doesn't persist the reason or timestamp today). */
  completedAt: number;
}

const IDLE_ENTRY: StepCompletionEntry = Object.freeze({
  completed: false,
  reason: null,
  completedAt: 0,
});

const entries = new Map<string, Map<string, Map<string, StepCompletionEntry>>>();
const hydratedSections = new Set<string>();
const listenersByContent = new Map<string, Set<() => void>>();

/**
 * Hydration race tracking.
 *
 * `ensureHydrated` marks a section as hydrated (in `hydratedSections`)
 * BEFORE the async `getCompleted` read resolves so that concurrent
 * `useStepCompletion` calls for the same section don't kick off
 * duplicate reads. The downside is a TOCTOU window: a reset path can
 * delete a cache entry while the storage snapshot is still in flight,
 * and the hydration callback would otherwise re-add that entry from
 * the stale snapshot, resurrecting cleared progress.
 *
 * The fix tracks per-section "cleared since hydration began":
 *   - `Set<string>` of IDs the user explicitly cleared (resetStep /
 *     resetSteps) — hydration filters those out of the snapshot.
 *   - `'all'` sentinel for `resetSection`, where every snapshot ID is
 *     stale by definition.
 *   - `undefined` for a section that finished hydrating already (or
 *     never started) — reset paths don't need to track anything.
 *
 * `markStepCompleted` / `markStepsCompleted` are additive and never
 * conflict with hydration's additive merge, so they don't touch this.
 */
const hydrationClears = new Map<string, Set<string> | 'all'>();

function noteHydrationClear(contentKey: string, sectionId: string, cleared: readonly string[] | 'all'): void {
  const key = `${contentKey}::${sectionId}`;
  const existing = hydrationClears.get(key);
  if (existing === undefined) {
    return;
  }
  if (existing === 'all') {
    return;
  }
  if (cleared === 'all') {
    hydrationClears.set(key, 'all');
    return;
  }
  cleared.forEach((id) => existing.add(id));
}

function sectionsFor(contentKey: string): Map<string, Map<string, StepCompletionEntry>> {
  let bySection = entries.get(contentKey);
  if (!bySection) {
    bySection = new Map();
    entries.set(contentKey, bySection);
  }
  return bySection;
}

function stepsFor(contentKey: string, sectionId: string): Map<string, StepCompletionEntry> {
  const bySection = sectionsFor(contentKey);
  let bySteps = bySection.get(sectionId);
  if (!bySteps) {
    bySteps = new Map();
    bySection.set(sectionId, bySteps);
  }
  return bySteps;
}

function notify(contentKey: string): void {
  const set = listenersByContent.get(contentKey);
  if (!set) {
    return;
  }
  set.forEach((listener) => listener());
}

function subscribeToContent(contentKey: string, listener: () => void): () => void {
  let set = listenersByContent.get(contentKey);
  if (!set) {
    set = new Set();
    listenersByContent.set(contentKey, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) {
      listenersByContent.delete(contentKey);
    }
  };
}

function ensureHydrated(contentKey: string, sectionId: string): void {
  const key = `${contentKey}::${sectionId}`;
  if (hydratedSections.has(key)) {
    return;
  }
  hydratedSections.add(key);
  hydrationClears.set(key, new Set());
  interactiveStepStorage
    .getCompleted(contentKey, sectionId)
    .then((stored) => {
      // Race guard: `evictContentCache` / `evictSectionCache` may have
      // wiped this section's entry while the storage read was in flight.
      // Without this check the resolver would lazily recreate the section
      // map via `stepsFor(...)` and resurrect cleared progress from the
      // stale snapshot — making "Reset guide" durably ineffective until
      // the next mount.
      if (!hydratedSections.has(key)) {
        hydrationClears.delete(key);
        return;
      }
      const cleared = hydrationClears.get(key);
      hydrationClears.delete(key);
      // Whole section was reset during hydration → the entire storage
      // snapshot is stale. The reset path has already cleared storage,
      // so nothing more to do.
      if (cleared === 'all') {
        return;
      }
      const bySteps = stepsFor(contentKey, sectionId);
      const hadClears = cleared !== undefined && cleared.size > 0;
      let changed = false;
      stored.forEach((stepId) => {
        // The user explicitly cleared this ID since hydration started;
        // don't resurrect it from the stale snapshot.
        if (cleared?.has(stepId)) {
          return;
        }
        if (!bySteps.has(stepId)) {
          bySteps.set(stepId, { completed: true, reason: null, completedAt: 0 });
          changed = true;
        }
      });
      if (changed) {
        bumpSectionVersion(contentKey, sectionId);
        notify(contentKey);
      }
      // Reconcile storage with the filtered cache. Without this, the
      // cleared IDs would persist in storage and reappear on next reload.
      if (hadClears) {
        persistSection(contentKey, sectionId);
      }
    })
    .catch((error) => {
      hydrationClears.delete(key);
      console.warn('[completion-store] hydration failed', { contentKey, sectionId, error });
    });
}

function isPreviewContentKey(contentKey: string): boolean {
  return contentKey.indexOf('devtools') > -1 || contentKey.startsWith('block-editor://preview/');
}

function persistSection(contentKey: string, sectionId: string): void {
  const bySteps = stepsFor(contentKey, sectionId);
  const completedIds = new Set<string>();
  bySteps.forEach((entry, stepId) => {
    if (entry.completed) {
      completedIds.add(stepId);
    }
  });
  // Preview-mode sandbox (#842 Bug 3): block-editor previews must not
  // pollute localStorage with progress tied to throwaway content keys.
  // The in-memory cache + the events still update so ephemeral UI
  // (preview "Reset guide" button) keeps reacting.
  const isPreview = isPreviewContentKey(contentKey);
  if (!isPreview) {
    // Empty completedIds → fully clear the storage entry rather than
    // leaving an empty Set marker. Keeps the "no progress" predicate
    // (`hasProgress`) and reset-detection clean.
    if (completedIds.size === 0) {
      interactiveStepStorage.clear(contentKey, sectionId);
    } else {
      interactiveStepStorage.setCompleted(contentKey, sectionId, completedIds);
    }
  }
  const percentage = isPreview ? undefined : refreshGuidePercentage(contentKey);
  if (completedIds.size > 0 && percentage !== undefined) {
    dispatchProgress({ kind: 'guide', contentKey, percentage, hasProgress: true });
  }
  // Tail-reset / partial-reset coverage for the legacy
  // `interactive-progress-cleared` event. The manual reset paths
  // (handleResetSection, useContentReset, block-editor preview reset)
  // dispatch this event directly; the store also drops to zero progress
  // when the user redoes the first step or runs a reset path that
  // doesn't go through one of those manual sites. Fire here whenever
  // the *guide* total falls to zero so the alignment-prompt and
  // preview-reset-button consumers see every clear path. Guarded on
  // !isPreview to mirror persistence; the preview path manages its own
  // dispatch elsewhere.
  if (!isPreview && completedIds.size === 0 && typeof window !== 'undefined') {
    const guideTotal = interactiveStepStorage.countAllCompleted(contentKey);
    if (guideTotal === 0) {
      window.dispatchEvent(new CustomEvent('interactive-progress-cleared', { detail: { contentKey } }));
    }
  }
}

function refreshGuidePercentage(contentKey: string): number | undefined {
  const docTotal = getTotalDocumentSteps();
  const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
  if (docTotal < 1) {
    // All-passive guide: `registerSectionSteps` only counts non-passive
    // steps, so a guide whose sections are entirely passive reports
    // docTotal === 0 even after the user acknowledges every section.
    // The passive ack still writes an ack-marker entry that
    // `countAllCompleted` sees, so when `allCompleted > 0` the guide
    // is effectively 100% complete. Without this branch the persisted
    // percentage stays unset and My Learning shows 0% for a fully-done
    // guide (F-1 follow-up to PR #909).
    if (allCompleted > 0) {
      interactiveCompletionStorage.set(contentKey, 100);
      return 100;
    }
    return undefined;
  }
  const percentage = Math.round((allCompleted / docTotal) * 100);
  interactiveCompletionStorage.set(contentKey, percentage);
  return percentage;
}

export interface UseStepCompletionResult {
  completed: boolean;
  reason: ProgressReason | null;
}

export function useStepCompletion(stepId: string, sectionId: string = STANDALONE_SECTION_ID): UseStepCompletionResult {
  const contentKey = getContentKey();
  ensureHydrated(contentKey, sectionId);

  const subscribe = useCallback((listener: () => void) => subscribeToContent(contentKey, listener), [contentKey]);

  const getSnapshot = useCallback((): StepCompletionEntry => {
    const entry = entries.get(contentKey)?.get(sectionId)?.get(stepId);
    return entry ?? IDLE_ENTRY;
  }, [contentKey, sectionId, stepId]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { completed: snapshot.completed, reason: snapshot.reason };
}

export function markStepCompleted(stepId: string, sectionId: string | undefined, reason: ProgressReason): void {
  const contentKey = getContentKey();
  const resolvedSection = sectionId ?? STANDALONE_SECTION_ID;
  ensureHydrated(contentKey, resolvedSection);

  const bySteps = stepsFor(contentKey, resolvedSection);
  const existing = bySteps.get(stepId);
  if (existing && existing.completed && existing.reason === reason) {
    return;
  }
  bySteps.set(stepId, { completed: true, reason, completedAt: Date.now() });
  bumpSectionVersion(contentKey, resolvedSection);
  persistSection(contentKey, resolvedSection);
  notify(contentKey);
  // Step-level progress event. Section-managed steps additionally fire
  // a kind:'section' event from `interactive-section.tsx` when the
  // section transitions to a terminal state.
  dispatchProgress({
    kind: 'step',
    stepId,
    sectionId: resolvedSection === STANDALONE_SECTION_ID ? undefined : resolvedSection,
    completed: true,
    reason,
  });
}

export function resetStep(stepId: string, sectionId: string | undefined = STANDALONE_SECTION_ID): void {
  const contentKey = getContentKey();
  const resolvedSection = sectionId ?? STANDALONE_SECTION_ID;
  // Race guard: must run BEFORE the early-return below, because the
  // pending hydration snapshot may still contain this ID even when the
  // in-memory cache doesn't have it yet.
  noteHydrationClear(contentKey, resolvedSection, [stepId]);
  const bySteps = stepsFor(contentKey, resolvedSection);
  if (!bySteps.has(stepId)) {
    return;
  }
  bySteps.delete(stepId);
  bumpSectionVersion(contentKey, resolvedSection);
  persistSection(contentKey, resolvedSection);
  notify(contentKey);
  dispatchProgress({
    kind: 'step',
    stepId,
    sectionId: resolvedSection === STANDALONE_SECTION_ID ? undefined : resolvedSection,
    completed: false,
    reason: 'none',
  });
}

export interface GuideProgress {
  completed: number;
  total: number;
  percentage: number;
}

export function getGuideProgress(contentKey: string): GuideProgress {
  const total = getTotalDocumentSteps();
  const completedRaw = interactiveStepStorage.countAllCompleted(contentKey);
  const completed = completedRaw < 0 ? 0 : completedRaw;
  if (total < 1) {
    // All-passive guide: the only persisted entry is an ack-marker from
    // a passive section the user acknowledged, so `completed > 0` while
    // `total === 0`. Treat that 0/0 as 100% instead of dividing into the
    // 0% NaN trap — without this the progress chip reads 0% even after
    // the user finishes the guide (F-1 follow-up to PR #909).
    return { completed, total, percentage: completed > 0 ? 100 : 0 };
  }
  // Defensive ceiling. `countAllCompleted` reads roster-blind from
  // storage; if a guide ships a v2 schema that renames or removes a
  // step under stable IDs (`MF-1`), storage may temporarily hold IDs
  // that the current roster doesn't recognise, producing > 100%. The
  // structural fix is `reconcileSection` which self-heals on first
  // mount; this clamp covers the pre-reconcile window so users never
  // see "167% complete" in a progress chip.
  const percentage = Math.min(100, Math.round((completed / total) * 100));
  return { completed, total, percentage };
}

/** Subscribe to per-content progress changes. Returns an unsubscribe function. */
export function subscribeProgress(contentKey: string, listener: () => void): () => void {
  return subscribeToContent(contentKey, listener);
}

/**
 * Read the live set of completed step IDs for a single section. The returned
 * set is a stable reference when the membership hasn't changed, so consumers
 * can use it as a `useMemo` / dependency-array input without churn.
 *
 * Replaces `SectionState.completed: Set<string>` — the store is now the
 * single source of truth for completion data, and the section reducer
 * keeps only its acknowledgement state.
 */
export function useSectionCompletion(sectionId: string): ReadonlySet<string> {
  const contentKey = getContentKey();
  ensureHydrated(contentKey, sectionId);

  const subscribe = useCallback((listener: () => void) => subscribeToContent(contentKey, listener), [contentKey]);

  const getSnapshot = useCallback((): number => {
    // Return a primitive "version" — bumps whenever the section's cache
    // changes. useSyncExternalStore re-renders only when this changes,
    // not on every other section's writes. The `useMemo` below builds
    // the actual Set from the version + sectionId.
    return sectionVersionFor(contentKey, sectionId);
  }, [contentKey, sectionId]);

  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // `version` is the bump signal that drives this memo — the deps array
  // intentionally reads from it even though the body computes the result
  // from the mutable `entries` map. Without `version` in the deps, the
  // memo would never invalidate when a sibling step write updates the
  // map in place.
  return useMemo(() => {
    const bySteps = entries.get(contentKey)?.get(sectionId);
    if (!bySteps) {
      return EMPTY_STEP_SET;
    }
    const result = new Set<string>();
    bySteps.forEach((entry, stepId) => {
      if (entry.completed) {
        result.add(stepId);
      }
    });
    return result;
  }, [contentKey, sectionId, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

const EMPTY_STEP_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

/**
 * Per-section change counter. Bumped every time the section's bucket
 * changes; the snapshot returned by `useSectionCompletion`'s
 * `getSnapshot` is just this number, so React's render-skip works even
 * when the underlying Set's identity would otherwise churn.
 */
const sectionVersions = new Map<string, number>();
function sectionVersionFor(contentKey: string, sectionId: string): number {
  return sectionVersions.get(`${contentKey}::${sectionId}`) ?? 0;
}
function bumpSectionVersion(contentKey: string, sectionId: string): void {
  const key = `${contentKey}::${sectionId}`;
  sectionVersions.set(key, (sectionVersions.get(key) ?? 0) + 1);
}

/**
 * Atomic bulk reset of every step within a section. Used by the section
 * reducer's RESET_SECTION path so a single dispatch produces a single
 * notify pass rather than one per step.
 */
export function resetSection(sectionId: string): void {
  const contentKey = getContentKey();
  // Note the clear before inspecting the cache — pending hydration's
  // snapshot may still contain IDs even when the in-memory cache is empty.
  noteHydrationClear(contentKey, sectionId, 'all');
  const bySteps = entries.get(contentKey)?.get(sectionId);
  const hadEntries = bySteps !== undefined && bySteps.size > 0;
  // Pending hydration: the in-memory cache may be empty even though the
  // storage snapshot contains entries that the user just asked to drop.
  // Clear storage now so the reset survives even if the user navigates
  // away before hydration resolves.
  const hydrationPending = hydrationClears.has(`${contentKey}::${sectionId}`);
  if (!hadEntries && !hydrationPending) {
    return;
  }
  const clearedIds: string[] = [];
  if (bySteps) {
    bySteps.forEach((entry, stepId) => {
      if (entry.completed) {
        clearedIds.push(stepId);
      }
    });
    bySteps.clear();
  }
  if (hadEntries) {
    bumpSectionVersion(contentKey, sectionId);
  }
  persistSection(contentKey, sectionId);
  if (hadEntries) {
    notify(contentKey);
    // Symmetric with resetSteps — fire per-step events so reactive
    // listeners (interactive-conditional, requirement re-checks) see
    // the clear, not just the section-level `interactive-progress-cleared`
    // dispatched by the section's own reset handler.
    clearedIds.forEach((id) => {
      dispatchProgress({
        kind: 'step',
        stepId: id,
        sectionId,
        completed: false,
        reason: 'none',
      });
    });
  }
}

/**
 * Drop any stored completion IDs that are not in the section's current
 * roster, then persist the filtered set. Self-heals on first mount post
 * guide-edit so storage doesn't accumulate orphan IDs after authors
 * rename / delete steps under stable IDs (`MF-1`).
 *
 * Called from `InteractiveSection` once `stepComponents` is known. The
 * call is idempotent — when storage is already aligned with the roster
 * (the common case after the first reconcile) it is a Set-membership
 * check + early return with no writes and no notify.
 *
 * Pre-conditions:
 *   - `roster` must contain every stepId the section currently renders
 *     (including non-completed ones). The function uses the roster as
 *     the authoritative allow-list; anything in storage that is not in
 *     the roster is dropped.
 *   - Safe to call before hydration completes. The hydration `.then`
 *     handler runs `persistSection` itself when it filters cleared IDs,
 *     and this function's writes are additive merges on the same cache.
 */
export function reconcileSection(sectionId: string, roster: readonly string[]): void {
  const contentKey = getContentKey();
  // Make sure the section has been hydrated so we have a complete view
  // of what's in storage. Idempotent — short-circuits if already done.
  ensureHydrated(contentKey, sectionId);
  const bySteps = entries.get(contentKey)?.get(sectionId);
  if (!bySteps || bySteps.size === 0) {
    return;
  }
  const allowed = new Set(roster);
  const orphaned: string[] = [];
  bySteps.forEach((_entry, stepId) => {
    if (!allowed.has(stepId)) {
      orphaned.push(stepId);
    }
  });
  if (orphaned.length === 0) {
    return;
  }
  orphaned.forEach((stepId) => bySteps.delete(stepId));
  bumpSectionVersion(contentKey, sectionId);
  persistSection(contentKey, sectionId);
  notify(contentKey);
}

/**
 * Evict the in-memory completion cache + hydration marker for a section
 * without touching storage or firing notify. Used by `InteractiveSection`
 * on unmount in preview mode so a remount under the same preview key
 * starts from an empty cache rather than inheriting the prior session's
 * in-memory state.
 */
export function evictSectionCache(sectionId: string): void {
  const contentKey = getContentKey();
  const bySection = entries.get(contentKey);
  if (bySection) {
    bySection.delete(sectionId);
    if (bySection.size === 0) {
      entries.delete(contentKey);
    }
  }
  hydratedSections.delete(`${contentKey}::${sectionId}`);
  hydrationClears.delete(`${contentKey}::${sectionId}`);
  sectionVersions.delete(`${contentKey}::${sectionId}`);
}

/**
 * Evict every in-memory completion entry, hydration marker, and version
 * counter for an entire content key. Notifies subscribers so the next
 * render reads an empty set.
 *
 * Counterpart to `interactiveStepStorage.clearAllForContent` for the
 * in-memory cache. Reset paths that nuke storage for a whole guide
 * (`useContentReset`, `useGuidePreviewProgress.reset`,
 * `learning-paths.hook` per-guide reset) MUST call this — otherwise
 * the cache still holds the prior completions, and the next render
 * resurrects them even though storage is empty.
 *
 * Safe to call with any contentKey, including ones the store hasn't
 * seen — entries / hydration markers / version counters are all
 * Map-keyed by exact string and unknown keys are no-ops.
 */
export function evictContentCache(contentKey: string): void {
  entries.delete(contentKey);
  const prefix = `${contentKey}::`;
  for (const key of Array.from(hydratedSections)) {
    if (key.startsWith(prefix)) {
      hydratedSections.delete(key);
    }
  }
  for (const key of Array.from(hydrationClears.keys())) {
    if (key.startsWith(prefix)) {
      hydrationClears.delete(key);
    }
  }
  for (const key of Array.from(sectionVersions.keys())) {
    if (key.startsWith(prefix)) {
      sectionVersions.delete(key);
    }
  }
  // Subscribers (every `useStepCompletion` / `useSectionCompletion` for
  // this content key) re-read snapshots and see the now-empty cache,
  // so the UI flips from "completed" back to "not completed" without
  // waiting for a remount.
  notify(contentKey);
}

/**
 * Atomic bulk reset of the tail of a section (used by RESET_STEP — the
 * user redoes step N, which also clears steps N+1..end).
 */
export function resetSteps(stepIds: readonly string[], sectionId: string): void {
  if (stepIds.length === 0) {
    return;
  }
  const contentKey = getContentKey();
  // Note the clear before the deletes — even IDs absent from the
  // in-memory cache may still be in the pending storage snapshot.
  noteHydrationClear(contentKey, sectionId, stepIds);
  const bySteps = entries.get(contentKey)?.get(sectionId);
  if (!bySteps) {
    return;
  }
  let changed = false;
  const clearedIds: string[] = [];
  stepIds.forEach((id) => {
    if (bySteps.delete(id)) {
      changed = true;
      clearedIds.push(id);
    }
  });
  if (changed) {
    bumpSectionVersion(contentKey, sectionId);
    persistSection(contentKey, sectionId);
    notify(contentKey);
    // Per-step progress events keep listeners (interactive-conditional,
    // step-checker recheck, etc.) symmetric with the single-step
    // `resetStep` path. Without this, a tail-reset would silently skip
    // their reactive paths.
    clearedIds.forEach((id) => {
      dispatchProgress({
        kind: 'step',
        stepId: id,
        sectionId,
        completed: false,
        reason: 'none',
      });
    });
  }
}

/**
 * Atomic bulk mark of every step in a section (used by COMPLETE_ALL — the
 * objectives-based auto-completion path).
 */
export function markStepsCompleted(
  stepIds: readonly string[],
  sectionId: string,
  reason: ProgressReason = 'manual'
): void {
  if (stepIds.length === 0) {
    return;
  }
  const contentKey = getContentKey();
  ensureHydrated(contentKey, sectionId);
  const bySteps = stepsFor(contentKey, sectionId);
  let changed = false;
  const now = Date.now();
  const newlyCompleted: string[] = [];
  stepIds.forEach((id) => {
    const existing = bySteps.get(id);
    if (!existing || !existing.completed) {
      bySteps.set(id, { completed: true, reason, completedAt: now });
      changed = true;
      newlyCompleted.push(id);
    }
  });
  if (changed) {
    bumpSectionVersion(contentKey, sectionId);
    persistSection(contentKey, sectionId);
    notify(contentKey);
    // Per-step events keep `interactive-conditional` and other
    // `kind: 'step'` listeners reactive after objectives-based and
    // run-section bulk completions; without these dispatches an
    // `exists-reftarget` branch could stay stale until the next DOM /
    // location event.
    newlyCompleted.forEach((id) => {
      dispatchProgress({
        kind: 'step',
        stepId: id,
        sectionId,
        completed: true,
        reason,
      });
    });
  }
}

/**
 * Drop every content key's in-memory completion cache, hydration
 * marker, and version counter. Counterpart to
 * `interactiveStepStorage.clearAll()` for the store. Used by the
 * "Reset progress" action in My Learning, which nukes every guide's
 * storage at once and needs the store to follow.
 *
 * All subscribers (across every content key) are notified so the UI
 * re-reads empty sets immediately.
 */
export function evictAllContentCaches(): void {
  const contentKeys = Array.from(listenersByContent.keys());
  entries.clear();
  hydratedSections.clear();
  hydrationClears.clear();
  sectionVersions.clear();
  // Notify each content key that had active subscribers so their
  // `useStepCompletion` / `useSectionCompletion` hooks re-render. We
  // don't clear `listenersByContent` itself — subscribers are still
  // mounted; they just need to re-snapshot.
  contentKeys.forEach((contentKey) => notify(contentKey));
}

/** Test-only reset. Drops the in-memory cache and forgets hydration. */
export function resetCompletionStoreForTests(): void {
  entries.clear();
  hydratedSections.clear();
  hydrationClears.clear();
  listenersByContent.clear();
  sectionVersions.clear();
}
