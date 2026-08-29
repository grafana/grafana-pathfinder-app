import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NavigationManager } from '../../interactive-engine';
import { resolveWithRetry } from '../../lib/dom';
import { logger } from '../../lib/logging';
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
  const paintQueue = useRef<Promise<unknown>>(Promise.resolve());

  const totalSteps = steps.length;
  const step = steps[currentStep];

  const close = useCallback(() => {
    navigationManager.clearAllHighlights();
    onClose();
  }, [navigationManager, onClose]);

  const goToNext = useCallback(() => {
    setStepsReached((prev) => Math.max(prev, currentStep + 1));

    if (currentStep < totalSteps - 1) {
      // A bubble outlives its step while the next target resolves, so a click on that
      // stale bubble must not advance past the step already loading.
      setCurrentStep((prev) => (prev === currentStep ? prev + 1 : prev));
      return;
    }

    close();
  }, [currentStep, totalSteps, close]);

  const goToPrevious = useCallback(
    () => setCurrentStep((prev) => (prev === currentStep ? Math.max(0, prev - 1) : prev)),
    [currentStep]
  );

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

    void resolveWithRetry(step.target, 'highlight').then((resolved) => {
      const paint = () => {
        if (cancelled) {
          return;
        }

        if (resolved) {
          // highlightWithComment awaits navigation/scroll before it paints. If the tour is
          // torn down mid-await, `cancelled` is already true by the time it resolves — clear
          // what it just painted so it doesn't outlive its own component and key listener.
          return navigationManager
            .highlightWithComment(
              resolved.element,
              step.content,
              false,
              stepInfo,
              undefined,
              close,
              goToNext,
              onPrevious,
              options
            )
            .then(() => {
              if (cancelled) {
                navigationManager.clearAllHighlights();
              }
            });
        }

        navigationManager.showCenteredComment(
          `${step.content}<br><br><em>${MISSING_TARGET_NOTE}</em>`,
          stepInfo,
          close,
          goToNext,
          onPrevious,
          options
        );
        return;
      };

      // highlightWithComment awaits a scroll before it paints, so concurrent paints can
      // finish out of order and leave an earlier step's bubble on top of a later one.
      paintQueue.current = paintQueue.current.then(paint).catch((error) => {
        logger.warn('BubbleTour failed to paint a step', { error });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [step, currentStep, totalSteps, stepsReached, finalStepLabel, navigationManager, close, goToNext, goToPrevious]);

  useEffect(() => () => navigationManager.clearAllHighlights(), [navigationManager]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape is handled ahead of the text-field guard: FloatingPanel minimizes on Escape
      // unless the event is already defaultPrevented, so bailing out here would minimize
      // the panel and leave the tour running.
      if (e.key === 'Escape') {
        safeEventHandler(e, { preventDefault: true });
        close();
        return;
      }

      if (isTextEditable(e.target)) {
        return;
      }

      if (e.key === 'ArrowRight') {
        safeEventHandler(e, { preventDefault: true });
        goToNext();
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        safeEventHandler(e, { preventDefault: true });
        goToPrevious();
      }
    };

    // Capture phase: FloatingPanel's own Escape listener is bubble-phase on document and
    // registered first, so on bubble order alone it would see defaultPrevented as false and
    // minimize before this handler runs. Capture always runs first regardless of mount order.
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [currentStep, close, goToNext, goToPrevious]);

  return null;
}
