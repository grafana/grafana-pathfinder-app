/**
 * `useSectionPersistence` — owns ack + collapse storage for an
 * interactive section, plus the mount-only RESTORE effect that decides
 * the #842 migration.
 *
 * Post-C2 the section reducer carries only `acknowledged` — step
 * completion lives in the canonical `completion-store`, which has its
 * own lazy hydration and write path. This hook no longer touches step
 * storage on writes; it only reads it once at mount to compute the
 * migration decision (was every step completed under pre-#842 rules?
 * if so, auto-ack).
 *
 * Storage namespaces still touched here:
 *   - `sectionAcknowledgementStorage`  — per-section #842 ack flag.
 *   - `sectionCollapseStorage`         — per-section collapse flag
 *     (cleared from the reset path; primary owner is
 *     `useSectionAutoCollapse`).
 *   - `interactiveStepStorage`         — read-only at mount for the
 *     migration decision; the store handles the write path now.
 *
 * Preview-mode sandbox: ack/collapse writes are gated by `isPreviewMode`.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  interactiveStepStorage,
  sectionAcknowledgementStorage,
  sectionCollapseStorage,
} from '../../../lib/user-storage';
import type { StepInfo } from '../../../types/component-props.types';
import type { AcknowledgementAnalysis } from '../step-section-utils';
import { getContentKey } from '../get-content-key';
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
  /** Clear the section's acknowledgement storage. Used by
   *  `handleStepReset` to mirror the reducer's ack-cleared invariant
   *  in storage. */
  clearStepAcknowledgement: () => void;
  /** Set the section's acknowledgement to true. Used by
   *  `handleMarkSectionComplete`. */
  setAcknowledgement: () => void;
  /** Clear this section's ack + collapse storage. Step completion is
   *  cleared via the store's `resetSection` helper, not here. */
  clearAckAndCollapseStorage: () => void;
}

export function useSectionPersistence({
  sectionId,
  isPreviewMode,
  stepComponents,
  gateAnalysis,
  dispatch,
}: UseSectionPersistenceArgs): UseSectionPersistenceResult {
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

  const clearAckAndCollapseStorage = useCallback(() => {
    if (!isPreviewMode) {
      const contentKey = getContentKey();
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
      // migration decision, evaluated once on first mount. Completion
      // data hydrates separately via the completion store; here we only
      // read it to decide whether to migrate the ack.
      const { state: restoredState, migrated } = restoreFromStorage({
        completed: restoredCompleted,
        acknowledged: restoredAck,
        stepComponents,
        gate: gateAnalysis,
      });
      dispatch({ type: 'RESTORE', acknowledged: restoredState.acknowledged });
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

  return { clearStepAcknowledgement, setAcknowledgement, clearAckAndCollapseStorage };
}
