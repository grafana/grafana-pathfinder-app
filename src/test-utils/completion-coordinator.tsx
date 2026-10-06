import React, { useEffect, useState, type PropsWithChildren } from 'react';
import { render, type RenderOptions } from '@testing-library/react';

import { CompletionCoordinator, type ObservationCheck } from '../global-state/observation/coordinator';
import { CompletionObservationContext } from '../global-state/observation/context';
import { checkPostconditions } from '../requirements-manager/requirements-checker.utils';
import { matchesPassiveAction, observePassiveActions } from '../interactive-engine/auto-completion/passive-action';

const checkAsTheSidebarDoes: ObservationCheck = async (conditions, step) => {
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

export function createCoordinatorWrapper(check: ObservationCheck = checkAsTheSidebarDoes) {
  return function CoordinatorWrapper({ children }: PropsWithChildren) {
    const [coordinator] = useState(() => new CompletionCoordinator(check));
    useEffect(() => {
      coordinator.start();
      const stopObserving = observePassiveActions((event) =>
        coordinator.observe((action) => matchesPassiveAction(action, event))
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
  new CompletionCoordinator(async () => false).reset();
}
