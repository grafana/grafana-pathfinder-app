/**
 * Convenience utilities for extracting and manipulating recorded steps
 * 
 * These utilities make it easier to work with recorded steps from useActionRecorder,
 * providing common operations like extracting selectors, filtering by action type, etc.
 */

import type { RecordedStep } from './tutorial-exporter';
import type { ExtractedSelector } from './dev-tools.types';

/**
 * Extract structured selector information from recorded steps
 * 
 * Maps RecordedStep objects to a simplified ExtractedSelector structure
 * that contains all the essential selector information.
 * 
 * @param steps - Array of recorded steps
 * @returns Array of extracted selector information
 * 
 * @example
 * ```typescript
 * const { recordedSteps } = useActionRecorder();
 * const selectors = extractSelectors(recordedSteps);
 * // Returns: [{ selector: 'button[data-testid="save"]', action: 'highlight', ... }, ...]
 * ```
 */
export function extractSelectors(steps: RecordedStep[]): ExtractedSelector[] {
  return steps.map((step) => ({
    selector: step.selector,
    action: step.action,
    value: step.value,
    description: step.description,
    isUnique: step.isUnique,
    matchCount: step.matchCount,
    contextStrategy: step.contextStrategy,
  }));
}

/**
 * Extract just the selector strings from recorded steps
 * 
 * Returns a simple array of selector strings, useful when you only need
 * the CSS selectors without additional metadata.
 * 
 * @param steps - Array of recorded steps
 * @returns Array of selector strings
 * 
 * @example
 * ```typescript
 * const { recordedSteps } = useActionRecorder();
 * const selectorStrings = extractSelectorStrings(recordedSteps);
 * // Returns: ['button[data-testid="save"]', 'input[name="query"]', ...]
 * ```
 */
export function extractSelectorStrings(steps: RecordedStep[]): string[] {
  return steps.map((step) => step.selector);
}

/**
 * Filter recorded steps by action type
 * 
 * Returns only the steps that match the specified action type.
 * Useful for extracting specific types of interactions (e.g., only form fills).
 * 
 * @param steps - Array of recorded steps
 * @param action - Action type to filter by ('highlight', 'button', 'formfill', etc.)
 * @returns Filtered array of recorded steps
 * 
 * @example
 * ```typescript
 * const { recordedSteps } = useActionRecorder();
 * const formFills = filterStepsByAction(recordedSteps, 'formfill');
 * // Returns only steps with action === 'formfill'
 * ```
 */
export function filterStepsByAction(steps: RecordedStep[], action: string): RecordedStep[] {
  return steps.filter((step) => step.action === action);
}

