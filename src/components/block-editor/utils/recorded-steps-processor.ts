/**
 * Recorded Steps Processor
 *
 * Pure utility functions for processing recorded user actions into guide blocks.
 * Extracts step-grouping logic from BlockEditor for testability and reuse.
 */

import type { JsonInteractiveBlock, JsonMultistepBlock, JsonStep } from '../../../types/json-guide.types';
import type { RecordedStep } from '../../../utils/devtools';

/**
 * Processed step - either a single step or a group of steps with same groupId
 */
export interface ProcessedStep {
  type: 'single' | 'group';
  steps: RecordedStep[];
}

/**
 * Groups recorded steps by their groupId.
 * Consecutive steps with the same groupId are grouped together.
 * Steps without groupId remain as singles.
 */
export function groupRecordedStepsByGroupId(steps: RecordedStep[]): ProcessedStep[] {
  const result: ProcessedStep[] = [];
  let currentGroup: RecordedStep[] = [];
  let currentGroupId: string | undefined;

  steps.forEach((step) => {
    if (step.groupId) {
      if (step.groupId === currentGroupId) {
        // Continue current group
        currentGroup.push(step);
      } else {
        // End previous group if exists
        if (currentGroup.length > 0) {
          result.push({ type: 'group', steps: currentGroup });
        }
        // Start new group
        currentGroupId = step.groupId;
        currentGroup = [step];
      }
    } else {
      // End current group if exists
      if (currentGroup.length > 0) {
        result.push({ type: 'group', steps: currentGroup });
        currentGroup = [];
        currentGroupId = undefined;
      }
      // Add single step
      result.push({ type: 'single', steps: [step] });
    }
  });

  // Don't forget the last group
  if (currentGroup.length > 0) {
    result.push({ type: 'group', steps: currentGroup });
  }

  return result;
}

/**
 * Converts a single recorded step to an interactive block.
 */
export function convertStepToInteractiveBlock(step: RecordedStep): JsonInteractiveBlock {
  return {
    type: 'interactive',
    action: step.action as JsonInteractiveBlock['action'],
    reftarget: step.selector,
    content: step.description || `${step.action} on element`,
    ...(step.value && { targetvalue: step.value }),
  };
}

/**
 * Converts a group of recorded steps to a multistep block.
 */
export function convertStepsToMultistepBlock(steps: RecordedStep[]): JsonMultistepBlock {
  const multistepSteps: JsonStep[] = steps.map((step) => ({
    action: step.action as JsonStep['action'],
    reftarget: step.selector,
    ...(step.value && { targetvalue: step.value }),
    tooltip: step.description || `${step.action} on element`,
  }));

  return {
    type: 'multistep',
    content: steps[0].description || 'Complete the following steps',
    steps: multistepSteps,
  };
}

/**
 * Converts processed steps to blocks (interactive or multistep).
 */
export function convertProcessedStepsToBlocks(
  processedSteps: ProcessedStep[]
): Array<JsonInteractiveBlock | JsonMultistepBlock> {
  return processedSteps.map((item) => {
    if (item.type === 'single') {
      return convertStepToInteractiveBlock(item.steps[0]);
    } else {
      return convertStepsToMultistepBlock(item.steps);
    }
  });
}
