/**
 * Shared utility for generating and validating selectors from DOM events
 *
 * This utility extracts the common selector generation logic used by both
 * useSelectorCapture and useActionRecorder hooks, reducing code duplication.
 */

import { generateBestSelector, getSelectorInfo, validateAndCleanSelector } from '../../lib/dom';
import { detectActionType, type DetectedAction } from '../../interactive-engine/auto-completion/action-detector';
import type { SelectorInfo } from './dev-tools.types';

export interface SelectorGenerationResult {
  selector: string;
  action: DetectedAction;
  selectorInfo: SelectorInfo;
  warnings: string[];
  wasModified: boolean;
}

/**
 * Generate and validate a selector from a DOM event
 *
 * This function handles:
 * - Coordinate-aware selector generation (for click events)
 * - Action type detection and normalization
 * - Selector validation and cleaning
 * - Selector info extraction
 *
 * @param target - The DOM element that triggered the event
 * @param event - The event that triggered the selector generation (MouseEvent, Event, etc.)
 * @returns Structured result with selector, action, info, and warnings
 *
 * @example
 * ```typescript
 * const handleClick = (event: MouseEvent) => {
 *   const result = generateSelectorFromEvent(event.target as HTMLElement, event);
 *   console.log('Selector:', result.selector);
 *   console.log('Action:', result.action);
 * }
 * ```
 */
export function generateSelectorFromEvent(target: HTMLElement, event: MouseEvent | Event): SelectorGenerationResult {
  // Extract click coordinates if available (for coordinate-aware selector generation)
  const clickX = 'clientX' in event ? event.clientX : undefined;
  const clickY = 'clientY' in event ? event.clientY : undefined;

  // Generate selector with coordinates if available
  let selector = generateBestSelector(
    target,
    clickX !== undefined && clickY !== undefined ? { clickX, clickY } : undefined
  );

  // Detect action type
  let action = detectActionType(target, event);

  // FINAL VALIDATION: Apply all quality rules as a safety net
  const validated = validateAndCleanSelector(selector, action);
  selector = validated.selector;

  // Apply action type normalization AFTER validation (using cleaned selector)
  // This ensures we normalize based on the final cleaned selector, not the original
  // If selector is plain text (no CSS syntax), force button action for text-based matching
  // Otherwise, use highlight with the CSS selector
  const isPlainText =
    !selector.includes('[') && !selector.includes('.') && !selector.includes('#') && !selector.includes(':');
  if (isPlainText) {
    // Plain text selector - use button action for text matching
    action = 'button';
  } else if (validated.action === 'button') {
    // Has CSS selector - use highlight instead of button
    action = 'highlight';
  } else {
    // Use validated action for other cases
    const validDetectedActions: DetectedAction[] = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
    if (validDetectedActions.includes(validated.action as DetectedAction)) {
      action = validated.action as DetectedAction;
    }
  }

  // Get selector metadata
  const info = getSelectorInfo(target);
  const selectorInfo: SelectorInfo = {
    method: info.method,
    isUnique: info.isUnique,
    matchCount: info.matchCount,
    contextStrategy: info.contextStrategy,
  };

  return {
    selector,
    action,
    selectorInfo,
    warnings: validated.warnings,
    wasModified: validated.wasModified,
  };
}
