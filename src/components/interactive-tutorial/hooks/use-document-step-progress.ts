/**
 * `useDocumentStepProgress` — owns the document-wide step-progress
 * publishing side-effect.
 *
 * Pattern J (contract surface) per the High-Risk Refactor Guidelines:
 * this hook owns two window globals and one CustomEvent that the
 * rest of the plugin reads.
 *
 *   - `window.__DocsPluginTotalSteps` — total step count across the
 *     document. Read by `src/lib/analytics.ts`.
 *   - `window.__DocsPluginCurrentStepIndex` — currently-executing
 *     step's document-wide index. Read by `src/lib/analytics.ts`.
 *   - `pathfinder-step-progress` CustomEvent — published whenever
 *     execution state or completion changes. Detail:
 *     `{ sectionId, totalSteps, documentStepIndex, completedCount }`.
 *     Consumed by `src/hooks/useStepProgressFromEvents.ts` to drive
 *     the FullScreenLayout / FloatingPanel progress chip.
 *
 * The hook performs a pure side-effect: no return value.
 * Behaviour and payload shapes match the pre-extraction effect
 * exactly — pinned by the contracts tripwire.
 */

import { useEffect } from 'react';

import { interactiveStepStorage } from '../../../lib/user-storage';
import type { StepInfo } from '../../../types/component-props.types';
import { getContentKey } from '../get-content-key';
import { getDocumentStepPosition, getTotalDocumentSteps } from '../../../global-state/section-registry';

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

      window.dispatchEvent(
        new CustomEvent('pathfinder-step-progress', {
          detail: {
            sectionId,
            totalSteps,
            documentStepIndex,
            completedCount: completedDocumentCount,
          },
        })
      );
    } catch {
      // no-op
    }
  }, [currentlyExecutingStep, stepComponents, sectionId, completedSteps]);
}
