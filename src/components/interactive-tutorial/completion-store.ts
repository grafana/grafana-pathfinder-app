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
 * advance its cursor; the section's persist effect mirrors completions
 * back into the store through `syncSectionCompletionCache`.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { interactiveCompletionStorage, interactiveStepStorage } from '../../lib/user-storage';
import type { CompletionReason } from '../../requirements-manager';
import { getContentKey } from '../../global-state/content-key';

import { getTotalDocumentSteps } from './section-registry';
import { dispatchProgress } from '../../global-state/progress-events';

/** Synthetic section ID for steps that are not inside an `<InteractiveSection>`. */
export const STANDALONE_SECTION_ID = '__standalone__';

export interface StepCompletionEntry {
  completed: boolean;
  reason: CompletionReason | null;
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
  interactiveStepStorage
    .getCompleted(contentKey, sectionId)
    .then((stored) => {
      const bySteps = stepsFor(contentKey, sectionId);
      let changed = false;
      stored.forEach((stepId) => {
        if (!bySteps.has(stepId)) {
          bySteps.set(stepId, { completed: true, reason: null, completedAt: 0 });
          changed = true;
        }
      });
      if (changed) {
        bumpSectionVersion(contentKey, sectionId);
        notify(contentKey);
      }
    })
    .catch((error) => {
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
}

function refreshGuidePercentage(contentKey: string): number | undefined {
  const docTotal = getTotalDocumentSteps();
  if (docTotal < 1) {
    return undefined;
  }
  const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
  const percentage = Math.round((allCompleted / docTotal) * 100);
  interactiveCompletionStorage.set(contentKey, percentage);
  return percentage;
}

export interface UseStepCompletionResult {
  completed: boolean;
  reason: CompletionReason | null;
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

export function markStepCompleted(stepId: string, sectionId: string | undefined, reason: CompletionReason): void {
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
    return { completed, total, percentage: 0 };
  }
  const percentage = Math.round((completed / total) * 100);
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
 * Replace the in-memory cache of completed steps for a section without
 * writing to storage. Used by `use-section-persistence.ts` when the
 * section's reducer is the authority for its own completed set — the
 * section writes storage itself; this call keeps the store cache in
 * sync so cross-step reads (e.g. `useStepCompletion` from a sibling
 * component) return current values.
 */
export function syncSectionCompletionCache(
  contentKey: string,
  sectionId: string,
  completedIds: Set<string>,
  reason: CompletionReason = 'manual'
): void {
  ensureHydrated(contentKey, sectionId);
  const bySteps = stepsFor(contentKey, sectionId);
  let changed = false;
  // Add entries for newly completed steps.
  completedIds.forEach((stepId) => {
    const existing = bySteps.get(stepId);
    if (!existing || !existing.completed) {
      bySteps.set(stepId, { completed: true, reason, completedAt: Date.now() });
      changed = true;
    }
  });
  // Remove entries no longer in the set so resets propagate to the cache.
  bySteps.forEach((entry, stepId) => {
    if (entry.completed && !completedIds.has(stepId)) {
      bySteps.delete(stepId);
      changed = true;
    }
  });
  if (changed) {
    bumpSectionVersion(contentKey, sectionId);
    notify(contentKey);
  }
}

/**
 * Atomic bulk reset of every step within a section. Used by the section
 * reducer's RESET_SECTION path so a single dispatch produces a single
 * notify pass rather than one per step.
 */
export function resetSection(sectionId: string): void {
  const contentKey = getContentKey();
  const bySteps = entries.get(contentKey)?.get(sectionId);
  if (!bySteps || bySteps.size === 0) {
    return;
  }
  bySteps.clear();
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
  sectionVersions.delete(`${contentKey}::${sectionId}`);
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
  const bySteps = entries.get(contentKey)?.get(sectionId);
  if (!bySteps) {
    return;
  }
  let changed = false;
  stepIds.forEach((id) => {
    if (bySteps.delete(id)) {
      changed = true;
    }
  });
  if (changed) {
    bumpSectionVersion(contentKey, sectionId);
    persistSection(contentKey, sectionId);
    notify(contentKey);
  }
}

/**
 * Atomic bulk mark of every step in a section (used by COMPLETE_ALL — the
 * objectives-based auto-completion path).
 */
export function markStepsCompleted(
  stepIds: readonly string[],
  sectionId: string,
  reason: CompletionReason = 'manual'
): void {
  if (stepIds.length === 0) {
    return;
  }
  const contentKey = getContentKey();
  ensureHydrated(contentKey, sectionId);
  const bySteps = stepsFor(contentKey, sectionId);
  let changed = false;
  const now = Date.now();
  stepIds.forEach((id) => {
    const existing = bySteps.get(id);
    if (!existing || !existing.completed) {
      bySteps.set(id, { completed: true, reason, completedAt: now });
      changed = true;
    }
  });
  if (changed) {
    bumpSectionVersion(contentKey, sectionId);
    persistSection(contentKey, sectionId);
    notify(contentKey);
  }
}

/** Test-only reset. Drops the in-memory cache and forgets hydration. */
export function resetCompletionStoreForTests(): void {
  entries.clear();
  hydratedSections.clear();
  listenersByContent.clear();
  sectionVersions.clear();
}
