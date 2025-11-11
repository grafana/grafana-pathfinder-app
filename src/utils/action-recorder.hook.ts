/**
 * Hook for recording user interactions as tutorial steps (Record Mode)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { shouldCaptureElement, getActionDescription } from '../interactive-engine/auto-completion/action-detector';
import { generateSelectorFromEvent } from './selector-generator.util';
import { exportStepsToHTML, type RecordedStep, type ExportOptions } from './tutorial-exporter';
import { formatStepsToString } from './step-parser.util';

export interface UseActionRecorderOptions {
  excludeSelectors?: string[];
  onStepRecorded?: (step: RecordedStep) => void;
}

export interface UseActionRecorderReturn {
  isRecording: boolean;
  recordedSteps: RecordedStep[];
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  deleteStep: (index: number) => void;
  setRecordedSteps: (steps: RecordedStep[]) => void;
  exportSteps: (format: 'string' | 'html', options?: ExportOptions) => string;
}

/**
 * Hook for recording user interactions as tutorial steps
 *
 * @param options - Configuration options
 * @param options.excludeSelectors - CSS selectors for elements to ignore
 * @param options.onStepRecorded - Callback when a step is recorded
 * @returns Object with recording state and control functions
 *
 * @example
 * ```typescript
 * const { isRecording, recordedSteps, startRecording, stopRecording, exportSteps } = useActionRecorder({
 *   onStepRecorded: (step) => console.log('Recorded:', step)
 * });
 *
 * // Start recording
 * startRecording();
 *
 * // Export as string
 * const stepsString = exportSteps('string');
 * ```
 */
export function useActionRecorder(options: UseActionRecorderOptions = {}): UseActionRecorderReturn {
  const { excludeSelectors = [], onStepRecorded } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([]);
  const recordingElementsRef = useRef<Map<HTMLElement, { value: string; timestamp: number }>>(new Map());

  const startRecording = useCallback(() => {
    setIsRecording(true);
    recordingElementsRef.current.clear();
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    // Keep recorded steps when stopping
  }, []);

  const clearRecording = useCallback(() => {
    setRecordedSteps([]);
    recordingElementsRef.current.clear();
  }, []);

  const deleteStep = useCallback((index: number) => {
    setRecordedSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setRecordedStepsExternal = useCallback((steps: RecordedStep[]) => {
    setRecordedSteps(steps);
  }, []);

  const exportSteps = useCallback(
    (format: 'string' | 'html', exportOptions?: ExportOptions): string => {
      if (format === 'string') {
        return formatStepsToString(
          recordedSteps.map((step) => ({
            action: step.action,
            selector: step.selector,
            value: step.value,
          }))
        );
      } else {
        return exportStepsToHTML(recordedSteps, {
          includeComments: true,
          includeHints: true,
          wrapInSection: true,
          sectionId: 'tutorial-section',
          sectionTitle: 'Tutorial Section',
          ...exportOptions,
        });
      }
    },
    [recordedSteps]
  );

  // Record Mode event listeners
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      // DON'T preventDefault - let the click proceed normally!
      // Just record the action and let navigation/actions happen

      // Generate selector using shared utility
      const result = generateSelectorFromEvent(target, event);
      const selector = result.selector;
      const action = result.action;
      const selectorInfo = result.selectorInfo;

      // Log validation warnings for debugging
      if (result.warnings.length > 0) {
        console.warn('Selector validation warnings:', result.warnings);
      }

      const description = getActionDescription(action, target);

      // For text form elements, track them but don't record yet (wait for value)
      // Radio/checkbox use 'highlight' action and are recorded immediately, not tracked
      if (action === 'formfill') {
        recordingElementsRef.current.set(target, {
          value: (target as HTMLInputElement).value || '',
          timestamp: Date.now(),
        });
        return;
      }

      // Check for duplicate - don't record if last step has same selector and action
      setRecordedSteps((prev) => {
        const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
        if (lastStep && lastStep.selector === selector && lastStep.action === action) {
          console.warn('Skipping duplicate selector:', selector);
          return prev; // Skip duplicate
        }

        // For other actions, record immediately
        const newStep: RecordedStep = {
          action,
          selector,
          value: undefined,
          description: result.wasModified ? `${description} ⚠️ (cleaned)` : description,
          isUnique: selectorInfo.isUnique,
          matchCount: selectorInfo.matchCount,
          contextStrategy: selectorInfo.contextStrategy,
        };

        if (onStepRecorded) {
          onStepRecorded(newStep);
        }

        return [...prev, newStep];
      });
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      // Skip tracking radio/checkbox inputs - they're handled on click
      const inputElement = target as HTMLInputElement;
      if (inputElement.type === 'radio' || inputElement.type === 'checkbox') {
        return;
      }

      // Update the tracked value for text inputs
      recordingElementsRef.current.set(target, {
        value: inputElement.value || '',
        timestamp: Date.now(),
      });
    };

    const handleChange = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      const tracked = recordingElementsRef.current.get(target);
      if (tracked) {
        // Generate selector using shared utility
        const result = generateSelectorFromEvent(target, event);
        const selector = result.selector;
        const action = result.action;
        const selectorInfo = result.selectorInfo;

        // Skip recording radio/checkbox change events - they're already recorded on click
        if (action === 'highlight') {
          recordingElementsRef.current.delete(target);
          return;
        }

        // Log validation warnings for debugging
        if (result.warnings.length > 0) {
          console.warn('Selector validation warnings:', result.warnings);
        }

        const description = getActionDescription(action, target);

        // Check for duplicate - don't record if last step has same selector, action, and value
        setRecordedSteps((prev) => {
          const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
          if (
            lastStep &&
            lastStep.selector === selector &&
            lastStep.action === action &&
            lastStep.value === tracked.value
          ) {
            console.warn('Skipping duplicate formfill:', selector);
            recordingElementsRef.current.delete(target);
            return prev; // Skip duplicate
          }

          // Record the form fill action
          recordingElementsRef.current.delete(target);
          const newStep: RecordedStep = {
            action,
            selector,
            value: tracked.value,
            description: result.wasModified ? `${description} ⚠️ (cleaned)` : description,
            isUnique: selectorInfo.isUnique,
            matchCount: selectorInfo.matchCount,
            contextStrategy: selectorInfo.contextStrategy,
          };

          if (onStepRecorded) {
            onStepRecorded(newStep);
          }

          return [...prev, newStep];
        });
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleChange, true);
    };
  }, [isRecording, excludeSelectors, onStepRecorded]);

  return {
    isRecording,
    recordedSteps,
    startRecording,
    stopRecording,
    clearRecording,
    deleteStep,
    setRecordedSteps: setRecordedStepsExternal,
    exportSteps,
  };
}
