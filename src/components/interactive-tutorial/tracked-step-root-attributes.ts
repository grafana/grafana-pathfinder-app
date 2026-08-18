import type { StepTypeKind } from './step-type-registry';

interface TrackedStepRootAttributes {
  'data-test-step-kind': StepTypeKind;
  'data-test-step-id': string;
}

export function getTrackedStepRootAttributes(kind: StepTypeKind, stepId: string): TrackedStepRootAttributes {
  return {
    'data-test-step-kind': kind,
    'data-test-step-id': stepId,
  };
}
