import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useCompletionCoordinator } from './context';
import type { ObservationReason, ObservedAction, ObservationStep } from './coordinator';
import { markStepCompleted, useStepCompletion, readStepCompletion } from '../completion-store';
import { getContentKey } from '../content-key';
import type { ProgressOrigin } from '../progress-events';
import type { ConditionInput } from '../../types/requirements.types';
import {
  buildInteractiveStepProperties,
  reportAppInteraction,
  UserInteraction,
  type StepContext,
} from '../../lib/analytics';

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
  analytics: { location: string; targetAction: string; refTarget?: string; stepMeta: StepContext };
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
    (reason: ObservationReason, origin: ProgressOrigin) => {
      markStepCompleted(stepId, sectionId, reason, contentKey, origin);
      latest.current.onStepComplete?.(stepId);
      latest.current.onComplete?.();
      if (reason === 'observed') {
        const { analytics, actions } = latest.current;
        reportAppInteraction(
          UserInteraction.StepAutoCompleted,
          buildInteractiveStepProperties(
            {
              target_action: analytics.targetAction,
              ref_target: analytics.refTarget ?? stepId,
              interaction_location: analytics.location,
              completion_method: 'auto_detected',
              ...(actions.length > 1 && { internal_actions_count: actions.length }),
            },
            analytics.stepMeta
          )
        );
      }
    },
    [contentKey, stepId, sectionId]
  );
  const registration: ObservationStep = {
    ...options,
    id,
    guideKey: contentKey,
    order: options.analytics.stepMeta.stepIndex,
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
    (reason: ObservationReason = 'manual', skipVerify = false) => {
      if (coordinator) {
        coordinator.request(id, reason, skipVerify);
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
    unmet: coordinator?.unmet(id),
    complete,
    onStepComplete,
    onComplete,
  };
}
