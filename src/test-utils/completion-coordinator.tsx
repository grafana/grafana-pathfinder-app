import React, { useEffect, useState, type PropsWithChildren } from 'react';
import { render, type RenderOptions } from '@testing-library/react';

import {
  CompletionCoordinator,
  resetHeldRequestsForTests,
  type ObservationCheck,
} from '../global-state/observation/coordinator';
import { CompletionObservationContext } from '../global-state/observation/context';
import { useGuideRequirements } from '../requirements-manager/guide-requirements-context';
import {
  matchesFormfillState,
  matchesPassiveAction,
  observePassiveActions,
} from '../interactive-engine/auto-completion/passive-action';

function checkAsTheSidebarDoes(
  checkPostconditions: ReturnType<typeof useGuideRequirements>['checkPostconditions']
): ObservationCheck {
  return async (conditions, step) => {
    const action = step.actions[0];
    const result = await checkPostconditions({
      requirements: conditions,
      stepId: step.stepId,
      targetAction: action?.targetAction,
      refTarget: action?.refTarget,
      targetValue: action?.targetValue,
      lazyRender: false,
      maxRetries: 0,
    });
    return result.verdict === 'satisfied';
  };
}

export function createCoordinatorWrapper(check?: ObservationCheck) {
  return function CoordinatorWrapper({ children }: PropsWithChildren) {
    const { checkPostconditions } = useGuideRequirements();
    const [coordinator] = useState(
      () => new CompletionCoordinator(check ?? checkAsTheSidebarDoes(checkPostconditions))
    );
    useEffect(() => {
      coordinator.start();
      const stopObserving = observePassiveActions(
        (event) => coordinator.observe((action) => matchesPassiveAction(action, event)),
        (touched) => coordinator.observe((action) => matchesFormfillState(action, touched))
      );
      return () => {
        stopObserving();
        coordinator.stop();
      };
    }, [coordinator]);
    return (
      <CompletionObservationContext.Provider value={coordinator}>{children}</CompletionObservationContext.Provider>
    );
  };
}

export function renderWithCoordinator(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: createCoordinatorWrapper(), ...options });
}

export function clearHeldCompletionRequests() {
  resetHeldRequestsForTests();
}
