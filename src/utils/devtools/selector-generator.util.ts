/**
 * Shared utility for generating and validating selectors from DOM events
 *
 * This utility extracts the common selector generation logic used by
 * the useActionRecorder hook and block editor components.
 */

import { getSelectorInfo, selectorMatchesOnly, validateAndCleanSelector, type ValidatedSelector } from '../../lib/dom';
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
 * 1. getSelectorInfo (retarget → candidates → rank)
 * 2. detectActionType
 * 3. validateAndCleanSelector (safety net), kept only if the cleaned selector
 *    still matches the element alone
 * 4. Action normalization (plain-text → button, CSS → highlight)
 */
export function generateSelectorFromEvent(target: HTMLElement, event: MouseEvent | Event): SelectorGenerationResult {
  const info = getSelectorInfo(target);

  let action = detectActionType(target, event);

  const validated = cleanProvenSelector(target, info, action);
  const selector = validated.selector;

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

/**
 * The selector {@link generateSelectorFromEvent} records for `target`, for
 * showing on hover before any event exists.
 */
export function generateSelectorForElement(target: HTMLElement): string {
  return cleanProvenSelector(target, getSelectorInfo(target), 'highlight').selector;
}

// Cleaning runs after the generator's uniqueness check, so it can make a proven selector match another element (#404).
function cleanProvenSelector(
  target: HTMLElement,
  info: ReturnType<typeof getSelectorInfo>,
  action: Parameters<typeof validateAndCleanSelector>[1]
): ValidatedSelector {
  const validated = validateAndCleanSelector(info.selector, action);
  if (
    validated.selector === info.selector ||
    selectorMatchesOnly(validated.selector, target, info.method) ||
    !selectorMatchesOnly(info.selector, target, info.method)
  ) {
    return validated;
  }
  return {
    ...validated,
    selector: info.selector,
    warnings: [
      ...validated.warnings,
      `Kept "${info.selector}": cleaning it to "${validated.selector}" matched a different element.`,
    ],
  };
}
