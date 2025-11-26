/**
 * Hook for testing CSS selectors with "Show me" and "Do it" functionality
 */

import { useState, useCallback } from 'react';
import { querySelectorAllEnhanced } from '../../lib/dom';
import { extractSelector } from './step-parser.util';
import type { TestResult } from './dev-tools.types';

export interface UseSelectorTesterOptions {
  executeInteractiveAction: (action: string, selector: string, value?: string, mode?: 'show' | 'do') => Promise<void>;
}

export interface UseSelectorTesterReturn {
  testSelector: (selector: string, mode: 'show' | 'do') => Promise<TestResult>;
  isTesting: boolean;
  result: TestResult | null;
  wasStepFormatExtracted: boolean;
  extractedSelector: string | null;
}

/**
 * Hook for testing CSS selectors
 *
 * @param options - Configuration options
 * @param options.executeInteractiveAction - Function to execute interactive actions
 * @returns Object with testSelector function, isTesting state, and result
 *
 * @example
 * ```typescript
 * const { executeInteractiveAction } = useInteractiveElements();
 * const { testSelector, isTesting, result } = useSelectorTester({ executeInteractiveAction });
 *
 * // Test a selector
 * await testSelector('button[data-testid="save"]', 'show');
 * ```
 */
export function useSelectorTester({ executeInteractiveAction }: UseSelectorTesterOptions): UseSelectorTesterReturn {
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [wasStepFormatExtracted, setWasStepFormatExtracted] = useState(false);
  const [extractedSelector, setExtractedSelector] = useState<string | null>(null);

  const testSelector = useCallback(
    async (selector: string, mode: 'show' | 'do'): Promise<TestResult> => {
      // Detect if input is in step format (contains pipe character)
      const isStepFormat = selector.trim().includes('|');
      
      // Extract selector from step format (action|selector|value) or use as-is
      const cleanSelector = extractSelector(selector);

      // Track if we extracted from step format and store the extracted selector
      const wasExtracted = isStepFormat && cleanSelector !== selector.trim();
      setWasStepFormatExtracted(wasExtracted);
      setExtractedSelector(wasExtracted ? cleanSelector : null);

      if (!cleanSelector) {
        const errorResult: TestResult = {
          success: false,
          message: 'Please enter a selector',
        };
        setResult(errorResult);
        return errorResult;
      }

      setIsTesting(true);
      setResult(null);

      try {
        const queryResult = querySelectorAllEnhanced(cleanSelector);
        const matchCount = queryResult.elements.length;

        if (matchCount === 0) {
          const errorResult: TestResult = {
            success: false,
            message: 'No elements found',
            matchCount: 0,
          };
          setResult(errorResult);
          return errorResult;
        }

        // Execute the action based on mode
        if (mode === 'show') {
          await executeInteractiveAction('highlight', cleanSelector, undefined, 'show');
        } else {
          await executeInteractiveAction('highlight', cleanSelector, undefined, 'do');
        }

        const successResult: TestResult = {
          success: true,
          message: `Found ${matchCount} element${matchCount !== 1 ? 's' : ''}${queryResult.usedFallback ? ' (using fallback)' : ''}`,
          matchCount,
        };
        setResult(successResult);
        return successResult;
      } catch (error) {
        const errorResult: TestResult = {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : mode === 'show'
                ? 'Selector test failed'
                : 'Selector action failed',
        };
        setResult(errorResult);
        return errorResult;
      } finally {
        setIsTesting(false);
      }
    },
    [executeInteractiveAction]
  );

  return {
    testSelector,
    isTesting,
    result,
    wasStepFormatExtracted,
    extractedSelector,
  };
}
