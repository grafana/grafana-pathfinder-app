import type { StepInfo } from '../../types/component-props.types';

export interface ResumeInfo {
  nextStepIndex: number;
  remainingSteps: number;
  isResume: boolean;
}

/**
 * Computes resume button state for an interactive section.
 *
 * Noop steps are excluded from `remainingSteps` because they are informational
 * markers, not interactive actions. This prevents the button from showing an
 * inflated count like "Resume (5 steps)" when only 3 are real.
 */
export function getResumeInfo(stepComponents: StepInfo[], currentStepIndex: number): ResumeInfo {
  if (stepComponents.length === 0) {
    return { nextStepIndex: 0, remainingSteps: 0, isResume: false };
  }

  const allCompleted = currentStepIndex >= stepComponents.length;
  const remainingSteps = allCompleted
    ? 0
    : stepComponents.slice(currentStepIndex).filter((s) => s.targetAction !== 'noop').length;

  return {
    nextStepIndex: currentStepIndex,
    remainingSteps,
    isResume: !allCompleted && currentStepIndex > 0,
  };
}

/**
 * Computes per-step eligibility for a sequential interactive section.
 *
 * The first step is always eligible. Subsequent steps are eligible only when
 * every preceding step is either completed or a noop (informational) step.
 */
export function computeStepEligibility(stepComponents: StepInfo[], completedSteps: Set<string>): boolean[] {
  return stepComponents.map((_, index) => {
    if (index === 0) {
      return true;
    }
    return stepComponents
      .slice(0, index)
      .every((prevStep) => prevStep.targetAction === 'noop' || completedSteps.has(prevStep.stepId));
  });
}
