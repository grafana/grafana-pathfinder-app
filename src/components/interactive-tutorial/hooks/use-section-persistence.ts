/**
 * `useSectionPersistence` — owns all storage IO + the
 * `interactive-progress-saved` CustomEvent dispatch for an
 * interactive section.
 *
 * Pattern J (contract-surface ownership move) per the High-Risk
 * Refactor Guidelines: this hook owns the four storage namespaces
 * that the section reads/writes:
 *   - `interactiveStepStorage`         — per-section completed set.
 *   - `interactiveCompletionStorage`   — document-wide percentage.
 *   - `sectionAcknowledgementStorage`  — per-section #842 ack flag.
 *   - `sectionCollapseStorage`         — per-section collapse flag
 *     (already partially owned by `useSectionAutoCollapse`; this
 *     hook only `.clear()`s it from the reset path).
 *
 * Plus the mount-only RESTORE effect which reads completion + ack
 * via `restoreFromStorage()` and dispatches `RESTORE` (with a
 * migration write of `ack=true` when the migration path fires).
 *
 * Preview-mode sandbox: every storage write is gated by
 * `isPreviewMode`. The `interactive-progress-saved` event STILL
 * fires in preview mode — `useGuidePreviewProgress` depends on it.
 * This is a deliberate, documented exception (#842 Bug 3).
 *
 * Behaviour matches the pre-extraction call sites exactly; the
 * Phase 0 contracts tripwire is the gate.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  interactiveCompletionStorage,
  interactiveStepStorage,
  sectionAcknowledgementStorage,
  sectionCollapseStorage,
} from '../../../lib/user-storage';
import type { StepInfo } from '../../../types/component-props.types';
import type { AcknowledgementAnalysis } from '../step-section-utils';
import { getContentKey } from '../get-content-key';
import { getTotalDocumentSteps } from '../section-registry';
import { type SectionAction, restoreFromStorage } from '../section-state';

export interface UseSectionPersistenceArgs {
  sectionId: string;
  isPreviewMode: boolean;
  /** Used by the mount-only restore to compute the migration. */
  stepComponents: StepInfo[];
  /** Used by the mount-only restore to compute the migration. */
  gateAnalysis: AcknowledgementAnalysis;
  /** Reducer dispatch to fire RESTORE on mount. */
  dispatch: React.Dispatch<SectionAction>;
}

export interface UseSectionPersistenceResult {
  /** Persist the section's completed set + document completion
   *  percentage, then dispatch `interactive-progress-saved`. Writes
   *  are skipped in preview mode; the event still fires. */
  persistCompletedSteps: (ids: Set<string>) => void;
  /** Clear the section's acknowledgement storage. Used by
   *  `handleStepReset` to mirror the reducer's ack-cleared invariant
   *  in storage. */
  clearStepAcknowledgement: () => void;
  /** Set the section's acknowledgement to true. Used by
   *  `handleMarkSectionComplete`. */
  setAcknowledgement: () => void;
  /** Clear all of this section's storage (step + collapse + ack).
   *  Used by `handleResetSection`. */
  clearAllStorage: () => void;
}

export function useSectionPersistence({
  sectionId,
  isPreviewMode,
  stepComponents,
  gateAnalysis,
  dispatch,
}: UseSectionPersistenceArgs): UseSectionPersistenceResult {
  // Persist completed steps using the user storage system.
  //
  // Preview-mode sandbox (#842, Bug 3): in block-editor preview the
  // section is a throwaway render — we must not pollute localStorage
  // with progress tied to a `block-editor://preview/...` content key.
  // Skip every write while preserving the in-window event dispatch
  // so listeners that drive ephemeral UI (useGuidePreviewProgress's
  // "hasProgress" → Reset guide button visibility) still react during
  // the same session.
  const persistCompletedSteps = useCallback(
    (ids: Set<string>) => {
      const contentKey = getContentKey();
      let percentage: number | undefined;
      if (!isPreviewMode) {
        interactiveStepStorage.setCompleted(contentKey, sectionId, ids);
        // Compute unified completion percentage across ALL sections
        // (including standalone).
        const docTotal = getTotalDocumentSteps();
        const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
        percentage = docTotal > 0 ? Math.round((allCompleted / docTotal) * 100) : undefined;
        if (percentage !== undefined) {
          interactiveCompletionStorage.set(contentKey, percentage);
        }
      }
      // Dispatch event to notify that progress was saved (for reset
      // button visibility). Fires in preview mode too —
      // `useGuidePreviewProgress` depends on it.
      if (ids.size > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey, hasProgress: true, completionPercentage: percentage },
          })
        );
      }
    },
    [sectionId, isPreviewMode]
  );

  const clearStepAcknowledgement = useCallback(() => {
    if (!isPreviewMode) {
      const contentKey = getContentKey();
      sectionAcknowledgementStorage.clear(contentKey, sectionId);
    }
  }, [sectionId, isPreviewMode]);

  const setAcknowledgement = useCallback(() => {
    if (!isPreviewMode) {
      const contentKey = getContentKey();
      sectionAcknowledgementStorage.set(contentKey, sectionId, true);
    }
  }, [sectionId, isPreviewMode]);

  const clearAllStorage = useCallback(() => {
    if (!isPreviewMode) {
      const contentKey = getContentKey();
      interactiveStepStorage.clear(contentKey, sectionId);
      sectionCollapseStorage.clear(contentKey, sectionId);
      sectionAcknowledgementStorage.clear(contentKey, sectionId);
    }
  }, [sectionId, isPreviewMode]);

  // Mount-only restore (#842, Bug 4 fix).
  //
  // The previous version re-fired whenever `stepComponents` changed
  // reference. The `didRestoreRef` guard makes the contract explicit:
  // "restore exactly once per InteractiveSection instance."
  //
  // Preview-mode sandbox: block-editor previews start fresh every
  // session — we skip the read entirely so stale entries from prior
  // buggy versions cannot resurrect.
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) {
      return;
    }
    didRestoreRef.current = true;
    if (isPreviewMode) {
      return;
    }
    const contentKey = getContentKey();
    let cancelled = false;
    Promise.all([
      interactiveStepStorage.getCompleted(contentKey, sectionId),
      sectionAcknowledgementStorage.get(contentKey, sectionId),
    ]).then(([restoredCompleted, restoredAck]) => {
      if (cancelled) {
        return;
      }
      // `gateAnalysis` and `stepComponents` are closed over for the
      // migration decision, evaluated once on first mount.
      const { state: restoredState, migrated } = restoreFromStorage({
        completed: restoredCompleted,
        acknowledged: restoredAck,
        stepComponents,
        gate: gateAnalysis,
      });
      dispatch({
        type: 'RESTORE',
        completed: restoredState.completed,
        acknowledged: restoredState.acknowledged,
        allStepIds: stepComponents.map((s) => s.stepId),
      });
      if (migrated) {
        sectionAcknowledgementStorage.set(contentKey, sectionId, true);
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally [] — true mount-only. Remounts (instance change)
    // re-trigger the effect via a fresh `didRestoreRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { persistCompletedSteps, clearStepAcknowledgement, setAcknowledgement, clearAllStorage };
}
