/**
 * Step execution utility for running sequences of interactive actions
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import type { StepDefinition, ProgressInfo } from './dev-tools.types';

export interface ExecutionOptions {
  onProgress?: (progress: ProgressInfo) => void;
  mode: 'auto' | 'guided';
  abortSignal?: AbortSignal;
  stepTimeout?: number; // For guided mode, timeout per step in ms (default: 30000)
}

export interface ExecutionResult {
  success: boolean;
  message: string;
  stepsCompleted: number;
}

type ExecuteActionFunction = (action: string, selector: string, value?: string, mode?: 'show' | 'do') => Promise<void>;

/**
 * Execute a sequence of steps with show→delay→do pattern
 * 
 * @param steps - Array of step definitions to execute
 * @param executeAction - Function to execute interactive actions
 * @param options - Execution options (mode, progress callback, abort signal)
 * @returns Promise resolving to execution result
 * 
 * @example
 * ```typescript
 * const result = await executeStepSequence(
 *   [{ action: 'highlight', selector: 'button[data-testid="save"]' }],
 *   executeInteractiveAction,
 *   { mode: 'auto', onProgress: (p) => console.log(p) }
 * );
 * ```
 */
export async function executeStepSequence(
  steps: StepDefinition[],
  executeAction: ExecuteActionFunction,
  options: ExecutionOptions
): Promise<ExecutionResult> {
  const { onProgress, mode, abortSignal, stepTimeout = 30000 } = options;

  if (steps.length === 0) {
    return {
      success: false,
      message: 'No valid steps found',
      stepsCompleted: 0,
    };
  }

  try {
    if (mode === 'auto') {
      // Auto mode: show→delay→do for each step
      for (let i = 0; i < steps.length; i++) {
        if (abortSignal?.aborted) {
          return {
            success: false,
            message: 'Execution cancelled',
            stepsCompleted: i,
          };
        }

        const step = steps[i];
        onProgress?.({ current: i + 1, total: steps.length });

        // Show phase
        await executeAction(step.action, step.selector, step.value, 'show');

        // Delay between show and do
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            INTERACTIVE_CONFIG.delays.multiStep.showToDoIterations * INTERACTIVE_CONFIG.delays.multiStep.baseInterval
          )
        );

        // Do phase
        await executeAction(step.action, step.selector, step.value, 'do');

        // Delay between steps (except after last step)
        if (i < steps.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.multiStep.defaultStepDelay));
        }
      }

      return {
        success: true,
        message: `Successfully executed ${steps.length} step${steps.length !== 1 ? 's' : ''}`,
        stepsCompleted: steps.length,
      };
    } else {
      // Guided mode: show, then wait for user click
      for (let i = 0; i < steps.length; i++) {
        if (abortSignal?.aborted) {
          return {
            success: false,
            message: 'Execution cancelled',
            stepsCompleted: i,
          };
        }

        const step = steps[i];
        onProgress?.({ current: i + 1, total: steps.length });

        // Highlight the element and wait for user to perform the action
        await executeAction(step.action, step.selector, step.value, 'show');

        // Wait for user to complete the action
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve();
          }, stepTimeout);

          if (abortSignal) {
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timeout);
              reject(new Error('Cancelled'));
            });
          }

          // Listen for completion (simplified - just wait for any click)
          const handleCompletion = () => {
            clearTimeout(timeout);
            document.removeEventListener('click', handleCompletion);
            resolve();
          };

          // Wait a bit before adding listener to avoid immediate trigger
          setTimeout(() => {
            document.addEventListener('click', handleCompletion, { once: true });
          }, 500);
        });
      }

      return {
        success: true,
        message: `Completed ${steps.length} guided step${steps.length !== 1 ? 's' : ''}`,
        stepsCompleted: steps.length,
      };
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Cancelled') {
      return {
        success: false,
        message: 'Guided sequence cancelled',
        stepsCompleted: 0,
      };
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Step execution failed',
      stepsCompleted: 0,
    };
  }
}

