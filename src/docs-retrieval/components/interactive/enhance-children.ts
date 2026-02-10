import React from 'react';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import type { InteractiveStepProps, StepInfo } from '../../../types/component-props.types';
import { getDocumentStepPosition } from './step-registry';

/**
 * Parameters for enhancing children with section coordination props
 */
export interface EnhanceChildrenParams {
  children: React.ReactNode;
  stepComponents: StepInfo[];
  stepEligibility: boolean[];
  completedSteps: Set<string>;
  currentlyExecutingStep: string | null;
  sectionId: string;
  title: string;
  disabled: boolean;
  isRunning: boolean;
  resetTrigger: number;
  sectionRequirementsPassed: boolean;
  // Callbacks
  handleStepComplete: (stepId: string) => void;
  handleStepReset: (stepId: string) => void;
  // Refs
  stepRefs: React.MutableRefObject<Map<string, any>>;
  multiStepRefs: React.MutableRefObject<Map<string, any>>;
}

/**
 * Enhance child step components with section coordination props
 *
 * This function iterates through React children and injects props into interactive step components:
 * - InteractiveStep
 * - InteractiveMultiStep
 * - InteractiveGuided
 * - InteractiveQuiz
 *
 * Each step receives:
 * - Unique stepId for tracking
 * - Eligibility status (based on sequential completion)
 * - Completion callbacks
 * - Document-wide step position
 * - Section context for analytics
 * - Ref callbacks for section-level coordination
 *
 * Non-step children are passed through unchanged.
 *
 * @param params - All parameters needed for child enhancement
 * @returns Enhanced React children with injected props
 */
export function enhanceChildren(params: EnhanceChildrenParams): React.ReactNode {
  const {
    children,
    stepComponents,
    stepEligibility,
    completedSteps,
    currentlyExecutingStep,
    sectionId,
    title,
    disabled,
    isRunning,
    resetTrigger,
    sectionRequirementsPassed,
    handleStepComplete,
    handleStepReset,
    stepRefs,
    multiStepRefs,
  } = params;

  // Track step index separately from child index to handle non-step children
  let stepIndex = 0;

  return React.Children.map(children, (child) => {
    if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
      const stepInfo = stepComponents[stepIndex];
      if (!stepInfo) {
        return child;
      }

      const isEligibleForChecking = stepEligibility[stepIndex];
      const isCompleted = completedSteps.has(stepInfo.stepId);
      const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

      // Get document-wide step position
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      // Increment step index for next step child
      stepIndex++;

      // Enhanced step props with section coordination

      return React.cloneElement(child as React.ReactElement<InteractiveStepProps>, {
        ...child.props,
        stepId: stepInfo.stepId,
        isEligibleForChecking,
        isCompleted,
        isCurrentlyExecuting,
        onStepComplete: handleStepComplete,
        stepIndex: documentStepIndex, // 0-indexed position in ENTIRE DOCUMENT
        totalSteps: documentTotalSteps, // Total steps in ENTIRE DOCUMENT
        sectionId: sectionId, // Section identifier for analytics
        sectionTitle: title, // Section title for analytics
        onStepReset: handleStepReset, // Add step reset callback
        disabled: disabled || !sectionRequirementsPassed || (isRunning && !isCurrentlyExecuting), // Don't disable currently executing step
        resetTrigger, // Pass reset signal to child steps
        key: stepInfo.stepId,
        ref: (ref: { executeStep: () => Promise<boolean>; markSkipped?: () => void } | null) => {
          if (ref) {
            stepRefs.current.set(stepInfo.stepId, ref);
          } else {
            stepRefs.current.delete(stepInfo.stepId);
          }
        },
      });
    } else if (React.isValidElement(child) && (child as any).type === InteractiveMultiStep) {
      const stepInfo = stepComponents[stepIndex];
      if (!stepInfo) {
        return child;
      }

      const isEligibleForChecking = stepEligibility[stepIndex];
      const isCompleted = completedSteps.has(stepInfo.stepId);
      const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

      // Get document-wide step position
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      // Increment step index for next step child
      stepIndex++;

      return React.cloneElement(child as React.ReactElement<any>, {
        ...(child.props as any),
        stepId: stepInfo.stepId,
        isEligibleForChecking,
        isCompleted,
        isCurrentlyExecuting,
        onStepComplete: handleStepComplete,
        onStepReset: handleStepReset, // Add step reset callback
        stepIndex: documentStepIndex,
        totalSteps: documentTotalSteps,
        sectionId: sectionId,
        sectionTitle: title,
        disabled: disabled || !sectionRequirementsPassed || (isRunning && !isCurrentlyExecuting), // Don't disable currently executing step
        resetTrigger, // Pass reset signal to child multi-steps
        key: stepInfo.stepId,
        ref: (
          ref: {
            executeStep: () => Promise<boolean>;
          } | null
        ) => {
          if (ref) {
            multiStepRefs.current.set(stepInfo.stepId, ref);
          } else {
            multiStepRefs.current.delete(stepInfo.stepId);
          }
        },
      });
    } else if (React.isValidElement(child) && (child as any).type === InteractiveGuided) {
      const stepInfo = stepComponents[stepIndex];
      if (!stepInfo) {
        return child;
      }

      const isEligibleForChecking = stepEligibility[stepIndex];
      const isCompleted = completedSteps.has(stepInfo.stepId);
      const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

      // Get document-wide step position
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      // Increment step index for next step child
      stepIndex++;

      return React.cloneElement(child as React.ReactElement<any>, {
        ...(child.props as any),
        stepId: stepInfo.stepId,
        isEligibleForChecking,
        isCompleted,
        isCurrentlyExecuting,
        onStepComplete: handleStepComplete,
        onStepReset: handleStepReset,
        stepIndex: documentStepIndex,
        totalSteps: documentTotalSteps,
        sectionId: sectionId,
        sectionTitle: title,
        disabled: disabled || !sectionRequirementsPassed || (isRunning && !isCurrentlyExecuting), // Don't disable during section run
        resetTrigger,
        key: stepInfo.stepId,
        ref: (
          ref: {
            executeStep: () => Promise<boolean>;
          } | null
        ) => {
          if (ref) {
            multiStepRefs.current.set(stepInfo.stepId, ref);
          } else {
            multiStepRefs.current.delete(stepInfo.stepId);
          }
        },
      });
    } else if (React.isValidElement(child) && (child as any).type === InteractiveQuiz) {
      const stepInfo = stepComponents[stepIndex];
      if (!stepInfo) {
        return child;
      }

      const isEligibleForChecking = stepEligibility[stepIndex];
      const isCompleted = completedSteps.has(stepInfo.stepId);

      // Get document-wide step position
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      // Increment step index for next step child
      stepIndex++;

      return React.cloneElement(child as React.ReactElement<any>, {
        ...(child.props as any),
        stepId: stepInfo.stepId,
        isEligibleForChecking,
        isCompleted,
        onStepComplete: handleStepComplete,
        stepIndex: documentStepIndex,
        totalSteps: documentTotalSteps,
        sectionId: sectionId,
        sectionTitle: title,
        disabled: disabled,
        resetTrigger,
        key: stepInfo.stepId,
      });
    }
    return child;
  });
}
