/**
 * Owns document-wide step-progress publishing (Pattern J contract surface).
 *
 * Writes two window globals read by `lib/analytics`
 * (`__DocsPluginTotalSteps`, `__DocsPluginCurrentStepIndex`) and emits
 * `pathfinder:progress` with `kind: 'document'`, consumed by
 * `useStepProgressFromEvents` to drive the panel progress chip.
 * Payload shape pinned by the contracts tripwire.
 */

import { useEffect } from 'react';

import { interactiveStepStorage } from '../../../lib/user-storage';
import type { StepInfo } from '../../../types/component-props.types';
import { getContentKey } from '../get-content-key';
import { getDocumentStepPosition, getTotalDocumentSteps } from '../../../global-state/section-registry';
import { dispatchProgress } from '../../../global-state/progress-events';

export interface UseDocumentStepProgressArgs {
  sectionId: string;
  currentlyExecutingStep: string | null;
  stepComponents: StepInfo[];
  /** Used only as an effect dependency to re-fire on completion
   *  changes (the function reads the latest count from storage
   *  inside the effect body). */
  completedSteps: ReadonlySet<string>;
}

export function useDocumentStepProgress({
  sectionId,
  currentlyExecutingStep,
  stepComponents,
  completedSteps,
}: UseDocumentStepProgressArgs): void {
  useEffect(() => {
    try {
      // `totalDocumentSteps` is a module-level mutable counter (not
      // React state), so it's read fresh inside the effect rather
      // than as a dep.
      const totalSteps = getTotalDocumentSteps();
      (window as any).__DocsPluginTotalSteps = totalSteps;

      let documentStepIndex: number | undefined;
      if (currentlyExecutingStep) {
        const executingStepInfo = stepComponents.find((s) => s.stepId === currentlyExecutingStep);
        if (executingStepInfo) {
          const { stepIndex } = getDocumentStepPosition(sectionId, executingStepInfo.index);
          documentStepIndex = stepIndex;
          (window as any).__DocsPluginCurrentStepIndex = stepIndex;
        }
      }

      // Total completed across ALL sections in the document — read
      // from shared storage (the same source `persistCompletedSteps`
      // writes to) so the chip reflects unified progress, not just
      // this section.
      const contentKey = getContentKey();
      const completedDocumentCount = interactiveStepStorage.countAllCompleted(contentKey);

      dispatchProgress({
        kind: 'document',
        contentKey,
        sectionId,
        totalSteps,
        documentStepIndex,
        completedCount: completedDocumentCount,
      });
    } catch {
      // no-op
    }
  }, [currentlyExecutingStep, stepComponents, sectionId, completedSteps]);
}
