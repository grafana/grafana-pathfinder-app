import { findButtonByText, querySelectorAllEnhanced } from '../../lib/dom';
import { logger } from '../../lib/logging';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { isCssSelector } from '../../lib/dom/selector-detector';

export function resolveTargetElement(action: { targetAction: string; refTarget: string }): HTMLElement | null {
  const { targetAction, refTarget } = action;

  if (!refTarget) {
    return null;
  }

  // Resolve grafana: prefixed selectors to CSS selectors
  const resolvedSelector = resolveSelector(refTarget);

  try {
    if (targetAction === 'button') {
      // Try CSS selector first if it looks like one
      if (isCssSelector(resolvedSelector)) {
        const result = querySelectorAllEnhanced(resolvedSelector);
        const buttons = result.elements.filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
        if (buttons[0]) {
          return buttons[0];
        }
      }

      // Fall back to text matching (use original refTarget for text matching)
      const buttons = findButtonByText(refTarget);
      return buttons[0] || null;
    } else if (targetAction === 'highlight' || targetAction === 'hover') {
      const result = querySelectorAllEnhanced(resolvedSelector);
      return result.elements[0] || null;
    } else if (targetAction === 'formfill') {
      // Also resolve formfill selectors for element matching
      const result = querySelectorAllEnhanced(resolvedSelector);
      return result.elements[0] || null;
    }
  } catch (error) {
    logger.warn('Failed to resolve target element for coordinate matching', { error });
  }

  return null;
}
