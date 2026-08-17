import { useCallback, useEffect, useMemo, useState } from 'react';

import { NavigationManager } from '../../interactive-engine';
import { resolveWithRetry } from '../../lib/dom';
import { safeEventHandler } from '../../utils/safe-event-handler.util';

const MISSING_TARGET_NOTE = "This part of the interface isn't on screen right now.";

export interface BubbleTourStep {
  target: string;
  title: string;
  content: string;
}

export interface BubbleTourProps {
  steps: BubbleTourStep[];
  onClose: () => void;
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

  const totalSteps = steps.length;
  const step = steps[currentStep];

  const close = useCallback(() => {
    navigationManager.clearAllHighlights();
    onClose();
  }, [navigationManager, onClose]);

  const goToNext = useCallback(() => {
    setStepsReached((prev) => Math.max(prev, currentStep + 1));

    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
      return;
    }

    close();
  }, [currentStep, totalSteps, close]);

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
    const onPrevious = currentStep > 0 ? goToPrevious : undefined;
    const isLastStep = currentStep === totalSteps - 1;
    const options = {
      showKeyboardHint: true,
      skipAnimations: currentStep > 0,
      stepTitle: step.title,
      nextLabel: isLastStep ? finalStepLabel : undefined,
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
          close,
          goToNext,
          onPrevious,
          options
        );
        return;
      }

      navigationManager.showCenteredComment(
        `${step.content}<br><br><em>${MISSING_TARGET_NOTE}</em>`,
        stepInfo,
        close,
        goToNext,
        onPrevious,
        options
      );
    });

    return () => {
      cancelled = true;
    };
  }, [step, currentStep, totalSteps, stepsReached, finalStepLabel, navigationManager, close, goToNext, goToPrevious]);

  useEffect(() => () => navigationManager.clearAllHighlights(), [navigationManager]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEditable(e.target)) {
        return;
      }

      if (e.key === 'Escape') {
        // FloatingPanel also minimizes on Escape unless the event is already defaultPrevented.
        safeEventHandler(e, { preventDefault: true });
        close();
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
  }, [currentStep, close, goToNext, goToPrevious]);

  return null;
}
