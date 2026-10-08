/**
 * `useStoredSectionCompletion` — whether the section was already complete in
 * storage when it mounted.
 *
 * A completion that arrives through hydration (the store's lazy read, the ack
 * restore, the #842 migration) looks identical to a reader's completion once
 * `isCompleted` flips, so the completion effect asks this hook which it is.
 * The answer is derived with the same pure functions the live state uses, from
 * the same storage reads, so it agrees with where hydration will land.
 *
 * Preview mode reads nothing: block-editor previews start fresh every session.
 */

import { useEffect, useState } from 'react';

import { interactiveStepStorage, sectionAcknowledgementStorage } from '../../../lib/user-storage';
import type { StepInfo } from '../../../types/component-props.types';
import type { AcknowledgementAnalysis } from '../step-section-utils';
import { getContentKey } from '../get-content-key';
import { deriveSectionState, restoreFromStorage } from '../section-state';

export type StoredSectionCompletion = 'pending' | 'complete' | 'incomplete';

export interface UseStoredSectionCompletionArgs {
  sectionId: string;
  isPreviewMode: boolean;
  stepComponents: StepInfo[];
  gateAnalysis: AcknowledgementAnalysis;
}

export function useStoredSectionCompletion({
  sectionId,
  isPreviewMode,
  stepComponents,
  gateAnalysis,
}: UseStoredSectionCompletionArgs): StoredSectionCompletion {
  const [stored, setStored] = useState<StoredSectionCompletion>(isPreviewMode ? 'incomplete' : 'pending');

  useEffect(() => {
    if (isPreviewMode) {
      return;
    }
    const contentKey = getContentKey();
    let cancelled = false;
    Promise.all([
      interactiveStepStorage.getCompleted(contentKey, sectionId),
      sectionAcknowledgementStorage.get(contentKey, sectionId),
    ])
      .then(([completed, acknowledged]) => {
        if (cancelled) {
          return;
        }
        const { state } = restoreFromStorage({ completed, acknowledged, stepComponents, gate: gateAnalysis });
        const derived = deriveSectionState(state, stepComponents, gateAnalysis, false, completed);
        setStored(derived.isCompleted ? 'complete' : 'incomplete');
      })
      .catch(() => {
        if (!cancelled) {
          setStored('incomplete');
        }
      });
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: the question is what storage held at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only snapshot; later roster changes must not re-read
  }, []);

  return stored;
}
