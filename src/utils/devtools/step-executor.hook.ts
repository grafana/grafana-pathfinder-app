/**
 * Hook for executing sequences of interactive steps
 */

import { useState, useCallback, useRef } from 'react';
import { executeStepSequence } from './step-executor.util';
import type { StepDefinition, ProgressInfo, TestResult } from './dev-tools.types';

export interface UseStepExecutorOptions {
  executeInteractiveAction: (action: string, selector: string, value?: string, mode?: 'show' | 'do') => Promise<void>;
}

export interface UseStepExecutorReturn {
  execute: (steps: StepDefinition[], mode: 'auto' | 'guided') => Promise<TestResult>;
  isExecuting: boolean;
  progress: ProgressInfo | null;
  result: TestResult | null;
  cancel: () => void;
}

/**
 * Hook for executing step sequences
 *
 * @param options - Configuration options
 * @param options.executeInteractiveAction - Function to execute interactive actions
 * @returns Object with execute function, execution state, progress, result, and cancel function
 *
 * @example
 * ```typescript
 * const { executeInteractiveAction } = useInteractiveElements();
 * const { execute, isExecuting, progress, result, cancel } = useStepExecutor({ executeInteractiveAction });
 *
 * // Execute steps
 * await execute(steps, 'auto');
 * ```
 */
export function useStepExecutor({ executeInteractiveAction }: UseStepExecutorOptions): UseStepExecutorReturn {
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async (steps: StepDefinition[], mode: 'auto' | 'guided'): Promise<TestResult> => {
      if (steps.length === 0) {
        const errorResult: TestResult = {
          success: false,
          message: mode === 'auto' ? 'Please enter steps' : 'Please enter guided steps',
        };
        setResult(errorResult);
        return errorResult;
      }

      setIsExecuting(true);
      setResult(null);
      setProgress(null);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      try {
        const executionResult = await executeStepSequence(steps, executeInteractiveAction, {
          mode,
          abortSignal: abortControllerRef.current.signal,
          onProgress: setProgress,
        });

        const testResult: TestResult = {
          success: executionResult.success,
          message: executionResult.message,
        };
        setResult(testResult);
        setProgress(null);
        return testResult;
      } catch (err) {
        const errorResult: TestResult = {
          success: false,
          message: err instanceof Error ? err.message : 'Step execution failed',
        };
        setResult(errorResult);
        setProgress(null);
        return errorResult;
      } finally {
        setIsExecuting(false);
        abortControllerRef.current = null;
      }
    },
    [executeInteractiveAction]
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    execute,
    isExecuting,
    progress,
    result,
    cancel,
  };
}
