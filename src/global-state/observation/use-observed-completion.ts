import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useCompletionCoordinator } from './context';
import type { ObservationReason, ObservedAction, ObservationStep } from './coordinator';
import { markStepCompleted, useStepCompletion, readStepCompletion } from '../completion-store';
import { getContentKey } from '../content-key';
import type { ConditionInput } from '../../types/requirements.types';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

interface Options {
  stepId: string;
  sectionId?: string;
  objectives?: ConditionInput;
  verify?: ConditionInput;
  actions: ObservedAction[];
  eligible: boolean;
  executing: boolean;
  resetTrigger?: number;
  onStepComplete?: (id: string) => void;
  onComplete?: () => void;
}
const noopSubscribe = () => () => {};
const zero = () => 0;

export function useObservedCompletion(options: Options) {
  const coordinator = useCompletionCoordinator();
  const { stepId, sectionId, resetTrigger } = options;
  const contentKey = getContentKey();
  const id = JSON.stringify([contentKey, sectionId, stepId]);
  const completion = useStepCompletion(stepId, sectionId);
  const { completed } = completion;
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const commit = useCallback(
    (reason: ObservationReason) => {
      markStepCompleted(stepId, sectionId, reason, contentKey);
      latest.current.onStepComplete?.(stepId);
      latest.current.onComplete?.();
      if (reason !== 'skipped') {
        reportAppInteraction(UserInteraction.StepAutoCompleted, {
          completion_method: reason === 'observed' ? 'auto_detected' : reason === 'manual' ? 'assisted' : 'objectives',
          interaction_location: 'guide_completion_observer',
        });
      }
    },
    [contentKey, stepId, sectionId]
  );
  const registration: ObservationStep = {
    ...options,
    id,
    completed,
    commit,
    readCompleted: () => readStepCompletion(stepId, sectionId, contentKey),
  };
  const registrationRef = useRef(registration);
  useLayoutEffect(() => {
    registrationRef.current = registration;
  });
  useLayoutEffect(() => coordinator?.register(registrationRef.current), [coordinator, id]);
  useLayoutEffect(() => {
    coordinator?.update(id, registrationRef.current);
  });
  useLayoutEffect(() => {
    if (resetTrigger) {
      coordinator?.reset(id);
    }
  }, [coordinator, id, resetTrigger]);
  useSyncExternalStore(coordinator?.subscribe ?? noopSubscribe, coordinator?.snapshot ?? zero, zero);
  const complete = useCallback(
    (reason: ObservationReason = 'manual') => {
      if (coordinator) {
        coordinator.request(id, reason);
      } else if (!latest.current.onStepComplete) {
        markStepCompleted(stepId, sectionId, reason, contentKey);
      }
    },
    [coordinator, id, contentKey, sectionId, stepId]
  );
  const onStepComplete = useCallback(
    (step: string) => {
      if (coordinator) {
        complete();
      } else {
        latest.current.onStepComplete?.(step);
      }
    },
    [coordinator, complete]
  );
  const onComplete = useCallback(() => {
    if (coordinator) {
      complete();
    } else {
      latest.current.onComplete?.();
    }
  }, [coordinator, complete]);
  const retry = useCallback(() => coordinator?.retry(id), [coordinator, id]);
  return {
    completion: coordinator ? completion : undefined,
    retry,
    managed: coordinator !== null,
    waiting: coordinator?.waiting(id) ?? false,
    complete,
    onStepComplete,
    onComplete,
  };
}
