/**
 * Shared utility for generating and validating selectors from DOM events
 *
 * This utility extracts the common selector generation logic used by
 * the useActionRecorder hook and block editor components.
 */

import { generateBestSelector, getSelectorInfo, validateAndCleanSelector } from '../../lib/dom';
import { detectActionType, type DetectedAction } from '../../lib/dom/action-detector';
import type { SelectorInfo } from './dev-tools.types';

export interface SelectorGenerationResult {
  selector: string;
  action: DetectedAction;
  selectorInfo: SelectorInfo;
  warnings: string[];
  wasModified: boolean;
}

/**
 * Generate and validate a selector from a DOM event.
 *
 * Pipeline:
 * 1. generateBestSelector (retarget → candidates → rank)
 * 2. detectActionType
 * 3. validateAndCleanSelector (safety net)
 * 4. Action normalization (plain-text → button, CSS → highlight)
 */
export function generateSelectorFromEvent(
  target: HTMLElement,
  event: MouseEvent | Event,
  _hoveredElement?: HTMLElement
): SelectorGenerationResult {
  let selector = generateBestSelector(target);

  let action = detectActionType(target, event);

  const validated = validateAndCleanSelector(selector, action);
  selector = validated.selector;

  if (selector.includes(':nth-match') || selector.includes(':nth-of-type')) {
    validated.warnings.push(
      'Generated selector is fragile (depends on order). Try adding stable attributes to the component.'
    );
  }

  const isPlainText =
    !selector.includes('[') && !selector.includes('.') && !selector.includes('#') && !selector.includes(':');
  if (isPlainText) {
    action = 'button';
  } else if (validated.action === 'button') {
    action = 'highlight';
  } else {
    const validDetectedActions: DetectedAction[] = ['highlight', 'button', 'formfill', 'navigate', 'hover'];
    if (validDetectedActions.includes(validated.action as DetectedAction)) {
      action = validated.action as DetectedAction;
    }
  }

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
