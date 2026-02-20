/**
 * Extracts StepInfo[] from React children of an InteractiveSection.
 *
 * Pure function — iterates children and classifies each interactive step
 * component type (Step, MultiStep, Guided, Quiz) into a flat StepInfo array
 * with section-prefixed IDs.
 *
 * Non-step children are silently ignored.
 */

import React from 'react';

import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import type { InteractiveStepProps, StepInfo } from '../../../types/component-props.types';

/**
 * Build an array of StepInfo from React children.
 *
 * @param children - React children from InteractiveSection
 * @param sectionId - The parent section's identifier (used as prefix for step IDs)
 * @returns Array of StepInfo in render order
 */
export function buildStepInfo(children: React.ReactNode, sectionId: string): StepInfo[] {
  const steps: StepInfo[] = [];
  let stepIndex = 0;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
      const props = child.props as InteractiveStepProps;
      const stepId = `${sectionId}-step-${stepIndex + 1}`;

      steps.push({
        stepId,
        element: child as React.ReactElement<InteractiveStepProps>,
        index: stepIndex,
        targetAction: props.targetAction,
        refTarget: props.refTarget,
        targetValue: props.targetValue,
        targetComment: props.targetComment,
        requirements: props.requirements,
        postVerify: props.postVerify,
        skippable: props.skippable,
        showMe: props.showMe,
        isMultiStep: false,
        isGuided: false,
      });
      stepIndex++;
    } else if (React.isValidElement(child) && (child as any).type === InteractiveMultiStep) {
      const props = child.props as any; // InteractiveMultiStepProps
      const stepId = `${sectionId}-multistep-${stepIndex + 1}`;

      steps.push({
        stepId,
        element: child as React.ReactElement<any>,
        index: stepIndex,
        targetAction: undefined, // Multi-step handles internally
        refTarget: undefined,
        targetValue: undefined,
        requirements: props.requirements,
        skippable: props.skippable,
        isMultiStep: true,
        isGuided: false,
      });
      stepIndex++;
    } else if (React.isValidElement(child) && (child as any).type === InteractiveGuided) {
      const props = child.props as any; // InteractiveGuidedProps
      const stepId = `${sectionId}-guided-${stepIndex + 1}`;

      steps.push({
        stepId,
        element: child as React.ReactElement<any>,
        index: stepIndex,
        targetAction: undefined, // Guided handles internally
        refTarget: undefined,
        targetValue: undefined,
        requirements: props.requirements,
        skippable: props.skippable,
        isMultiStep: false,
        isGuided: true,
      });
      stepIndex++;
    } else if (React.isValidElement(child) && (child as any).type === InteractiveQuiz) {
      const props = child.props as any; // InteractiveQuizProps
      const stepId = `${sectionId}-quiz-${stepIndex + 1}`;

      steps.push({
        stepId,
        element: child as React.ReactElement<any>,
        index: stepIndex,
        targetAction: undefined, // Quiz handles internally
        refTarget: undefined,
        targetValue: undefined,
        requirements: props.requirements,
        skippable: props.skippable,
        isMultiStep: false,
        isGuided: false,
        isQuiz: true,
      });
      stepIndex++;
    }
  });

  return steps;
}
