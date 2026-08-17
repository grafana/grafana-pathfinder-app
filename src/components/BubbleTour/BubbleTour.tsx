import { useCallback, useEffect, useMemo, useState } from 'react';

import { NavigationManager } from '../../interactive-engine';
import { resolveWithRetry } from '../../lib/dom';
import { safeEventHandler } from '../../utils/safe-event-handler.util';

const MISSING_TARGET_NOTE = "This part of the interface isn't on screen right now.";

export interface BubbleTourStep {
  target: string;
  title: string;
  content: string;
  nextLabel?: string;
  onAdvance?: () => void;
  optional?: boolean;
  disableBack?: boolean;
}

export interface BubbleTourOutcome {
  reason: 'completed' | 'dismissed';
  stepIndex: number;
  stepTotal: number;
}

export interface BubbleTourProps {
  steps: BubbleTourStep[];
  onClose: (outcome: BubbleTourOutcome) => void;
  finalStepLabel?: string;
}

function isTextEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
  );
}

export function BubbleTour({ steps, onClose, finalStepLabel }: BubbleTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepsReached, setStepsReached] = useState(0);

  const navigationManager = useMemo(() => new NavigationManager(), []);

  // Optional steps whose target is absent are dropped once, so step numbering stays truthful.
  const effectiveSteps = useMemo(
    () => steps.filter((step) => !step.optional || document.querySelector(step.target)),
    [steps]
  );

  const totalSteps = effectiveSteps.length;
  const step = effectiveSteps[currentStep];

  const finish = useCallback(
    (reason: BubbleTourOutcome['reason']) => {
      navigationManager.clearAllHighlights();
      onClose({ reason, stepIndex: currentStep, stepTotal: totalSteps });
    },
    [navigationManager, onClose, currentStep, totalSteps]
  );

  const dismiss = useCallback(() => finish('dismissed'), [finish]);

  const goToNext = useCallback(() => {
    step?.onAdvance?.();
    setStepsReached((prev) => Math.max(prev, currentStep + 1));

    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
      return;
    }

    finish('completed');
  }, [step, currentStep, totalSteps, finish]);

  const goToPrevious = useCallback(() => setCurrentStep((prev) => Math.max(0, prev - 1)), []);

  useEffect(() => {
    if (!step) {
      return;
    }

    let cancelled = false;

    const stepInfo = {
      current: currentStep,
      total: totalSteps,
      completedSteps: Array.from({ length: stepsReached }, (_, i) => i),
    };
    const onPrevious = currentStep > 0 && !step.disableBack ? goToPrevious : undefined;
    const isLastStep = currentStep === totalSteps - 1;
    const options = {
      showKeyboardHint: true,
      skipAnimations: currentStep > 0,
      stepTitle: step.title,
      nextLabel: step.nextLabel ?? (isLastStep ? finalStepLabel : undefined),
    };

    resolveWithRetry(step.target, 'highlight').then((resolved) => {
      if (cancelled) {
        return;
      }

      if (resolved) {
        void navigationManager.highlightWithComment(
          resolved.element,
          step.content,
          false,
          stepInfo,
          undefined,
          dismiss,
          goToNext,
          onPrevious,
          options
        );
        return;
      }

      navigationManager.showCenteredComment(
        `${step.content}<br><br><em>${MISSING_TARGET_NOTE}</em>`,
        stepInfo,
        dismiss,
        goToNext,
        onPrevious,
        options
      );
    });

    return () => {
      cancelled = true;
    };
  }, [step, currentStep, totalSteps, stepsReached, finalStepLabel, navigationManager, dismiss, goToNext, goToPrevious]);

  useEffect(() => () => navigationManager.clearAllHighlights(), [navigationManager]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEditable(e.target)) {
        return;
      }

      if (e.key === 'Escape') {
        // FloatingPanel also minimizes on Escape unless the event is already defaultPrevented.
        safeEventHandler(e, { preventDefault: true });
        dismiss();
      } else if (e.key === 'ArrowRight') {
        safeEventHandler(e, { preventDefault: true });
        goToNext();
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        safeEventHandler(e, { preventDefault: true });
        goToPrevious();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, dismiss, goToNext, goToPrevious]);

  return null;
}
