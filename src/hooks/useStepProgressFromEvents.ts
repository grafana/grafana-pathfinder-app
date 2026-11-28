import { useLayoutEffect, useState } from 'react';
import { getContentKey } from '../global-state/content-key';

interface StepProgressDetail {
  totalSteps?: number;
  completedCount?: number;
}

interface DocumentStepProgress {
  contentKey: string;
  total: number;
  completed: number;
}

export function useDocumentStepProgressFromEvents(hasActiveGuide: boolean): DocumentStepProgress | undefined {
  const [stepProgress, setStepProgress] = useState<DocumentStepProgress | undefined>();

  useLayoutEffect(() => {
    if (!hasActiveGuide) {
      return;
    }

    const handle = (e: Event) => {
      const detail = (e as CustomEvent<StepProgressDetail>).detail;
      const total = detail?.totalSteps ?? 0;
      const done = detail?.completedCount ?? 0;
      const completed = Number.isFinite(done) ? Math.min(total, Math.max(0, Math.floor(done))) : 0;
      setStepProgress(
        Number.isInteger(total) && total > 0 ? { contentKey: getContentKey(), total, completed } : undefined
      );
    };

    window.addEventListener('pathfinder-step-progress', handle);
    return () => {
      window.removeEventListener('pathfinder-step-progress', handle);
    };
  }, [hasActiveGuide]);

  return hasActiveGuide ? stepProgress : undefined;
}

export function useStepProgressFromEvents(hasActiveGuide: boolean): string | undefined {
  const stepProgress = useDocumentStepProgressFromEvents(hasActiveGuide);
  return stepProgress ? `${stepProgress.completed}/${stepProgress.total}` : undefined;
}
