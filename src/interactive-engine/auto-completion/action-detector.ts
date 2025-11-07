/**
 * Detect the most appropriate interactive action type for a DOM element
 *
 * This utility is generic and can be used to automatically categorize
 * DOM elements into interactive action types for test automation,
 * recording user workflows, or building interactive tutorials.
 *
 * Supported action types:
 * - 'formfill': Input fields, textareas, selects
 * - 'button': Buttons with unique text
 * - 'highlight': Clickable elements (links, generic buttons)
 * - 'navigate': External links
 * - 'hover': Elements that reveal content on hover
 *
 * @module action-detector
 */

import { findButtonByText, isElementVisible } from '../../lib/dom';

export type DetectedAction = 'highlight' | 'button' | 'formfill' | 'navigate' | 'hover';

/**
 * Detect the best action type for an element based on its tag and attributes - SIMPLIFIED
 *
 * Core principle: Keep it simple - use the element's natural behavior
 * - Form elements → 'formfill' (except radio/checkbox which are 'highlight')
 * - Buttons with unique text and no testid → 'button' (text matching)
 * - Buttons with testid → 'highlight' (CSS selector)
 * - External links → 'navigate'
 * - Everything else → 'highlight'
 *
 * @param element - The DOM element to analyze
 * @param event - Optional event for additional context
 * @returns The detected action type
 *
 * @example
 * ```typescript
 * const input = document.querySelector('input[name="query"]');
 * const action = detectActionType(input);
 * // Returns: 'formfill'
 *
 * const link = document.querySelector('a[href="https://external.com"]');
 * const action = detectActionType(link);
 * // Returns: 'navigate'
 * ```
 */
export function detectActionType(element: HTMLElement, event?: Event): DetectedAction {
  const tag = element.tagName.toLowerCase();
  const eventType = event?.type;

  // Hover events
  if (eventType === 'mouseenter') {
    return 'hover';
  }

  // Form elements - radio/checkbox are clicked (highlight), others are filled (formfill)
  if (tag === 'input') {
    const inputType = (element as HTMLInputElement).type?.toLowerCase();
    if (inputType === 'radio' || inputType === 'checkbox') {
      return 'highlight';
    }
    return 'formfill';
  }
  if (tag === 'textarea' || tag === 'select') {
    return 'formfill';
  }

  // Buttons: Use 'button' action ONLY if unique text and no testid
  if (tag === 'button' || element.getAttribute('role') === 'button') {
    // If button has testid, use highlight (CSS selector is better)
    const hasTestId =
      element.hasAttribute('data-testid') ||
      element.hasAttribute('data-cy') ||
      element.hasAttribute('aria-label') ||
      (element.id && element.id.length > 0);

    if (hasTestId) {
      return 'highlight';
    }

    // Only use button action if text is unique
    const text = element.textContent?.trim();
    if (text) {
      const buttons = findButtonByText(text);
      if (buttons.length === 1) {
        return 'button'; // Unique text, use text matching
      }
    }

    return 'highlight'; // Default to highlight
  }

  // Links: External → navigate, Internal → highlight
  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      return 'navigate';
    }
    return 'highlight';
  }

  // Everything else → highlight
  return 'highlight';
}

/**
 * Get a human-readable description of the detected action
 *
 * Generates user-friendly text describing what the action will do.
 * Useful for displaying recorded steps or generating documentation.
 *
 * @param action - The detected action type
 * @param element - The element being acted upon
 * @returns Human-readable description string
 *
 * @example
 * ```typescript
 * const desc = getActionDescription('formfill', inputElement);
 * // Returns: "Fill text \"username\""
 * ```
 */
export function getActionDescription(action: DetectedAction, element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const text = element.textContent?.trim().substring(0, 30);

  switch (action) {
    case 'button':
      return `Click button: "${text}"`;
    case 'formfill':
      const inputType = element.getAttribute('type') || tag;
      const name = element.getAttribute('name') || 'field';
      return `Fill ${inputType} "${name}"`;
    case 'navigate':
      const href = element.getAttribute('href');
      return `Navigate to: ${href}`;
    case 'hover':
      return `Hover over: ${text || tag}`;
    case 'highlight':
    default:
      return `Click: ${text || tag}`;
  }
}

/**
 * Check if an element should be captured during recording
 *
 * Filters out non-interactive elements and elements that shouldn't be recorded
 * (like debug panels, modal backdrops, etc.). This function is customizable
 * and can be extended to filter additional elements as needed.
 *
 * Walks up the DOM hierarchy to find interactive parents (like selector generation does)
 * so clicking an icon inside a button will correctly identify the button as interactive.
 *
 * @param element - The element to check
 * @returns true if element should be captured, false otherwise
 *
 * @example
 * ```typescript
 * if (shouldCaptureElement(clickedElement)) {
 *   // Record this interaction
 * }
 * ```
 */
export function shouldCaptureElement(element: HTMLElement): boolean {
  // ONLY filter out clicks within the debug panel itself
  if (element.closest('[class*="debug"]') || element.closest('#CombinedLearningJourney')) {
    return false;
  }

  // ONLY filter out obvious non-interactive overlays/backdrops
  if (element.classList.contains('modal-backdrop') || element.id === 'interactive-blocking-overlay') {
    return false;
  }

  // ALWAYS CAPTURE EVERYTHING ELSE!
  // The selector generator will figure out the best way to reference it.
  // This is a debugging tool - we want to record all user interactions.
  return true;
}

/**
 * Extract the most useful selector for an element
 *
 * Attempts to find the most stable and useful selector for identifying an element,
 * useful for action matching and recording.
 *
 * Priority order:
 * 1. data-testid attribute (most stable)
 * 2. id attribute
 * 3. aria-label attribute
 * 4. Button text content (for buttons)
 * 5. Href attribute (for links)
 *
 * @param element - The element to extract selector from
 * @returns Best available selector string, or undefined if no good selector found
 *
 * @example
 * ```typescript
 * const selector = extractElementSelector(buttonElement);
 * // Returns: "data-testid-save-button" or "Save" or undefined
 * ```
 */
export function extractElementSelector(element: HTMLElement): string | undefined {
  // Try data-testid (most stable)
  const testId = element.getAttribute('data-testid');
  if (testId) {
    return testId;
  }

  // Try id attribute
  if (element.id) {
    return `#${element.id}`;
  }

  // Try aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel;
  }

  // For buttons, use text content
  const tag = element.tagName.toLowerCase();
  if (tag === 'button' || element.getAttribute('role') === 'button') {
    const text = element.textContent?.trim();
    if (text) {
      return text;
    }
  }

  // For links, use href
  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (href) {
      return href;
    }
  }

  // For form inputs, use name attribute
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const name = element.getAttribute('name');
    if (name) {
      return `[name="${name}"]`;
    }
  }

  return undefined;
}

/**
 * Find the interactive parent element if clicked element is a child
 *
 * When users click on icons or text within buttons/links, we want to identify
 * the actual interactive parent element (button, link, etc.) rather than the
 * child element.
 *
 * @param element - The clicked element
 * @returns The interactive parent element, or the original element if no parent found
 *
 * @example
 * ```typescript
 * // User clicks icon inside button
 * const icon = document.querySelector('.button-icon');
 * const button = findInteractiveParent(icon);
 * // Returns: the parent button element
 * ```
 */
export function findInteractiveParent(element: HTMLElement): HTMLElement {
  // Check if element itself is interactive
  const tag = element.tagName.toLowerCase();
  if (
    tag === 'button' ||
    tag === 'a' ||
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    element.getAttribute('role') === 'button'
  ) {
    return element;
  }

  // Look for interactive parents
  const button = element.closest('button, [role="button"]');
  if (button instanceof HTMLElement) {
    return button;
  }

  const link = element.closest('a');
  if (link instanceof HTMLElement) {
    return link;
  }

  // No interactive parent found, return original element
  return element;
}

/**
 * Check if an element can receive focus
 *
 * Validates that element is both focusable by nature (input, button, link, etc.)
 * and actually visible in the DOM.
 *
 * @param element - The element to check
 * @returns true if element can receive focus, false otherwise
 *
 * @example
 * ```typescript
 * const button = document.querySelector('button');
 * if (canHaveFocus(button)) {
 *   button.focus(); // Safe to focus
 * }
 * ```
 */
export function canHaveFocus(element: HTMLElement): boolean {
  const validTabNodes = /input|select|textarea|button|object/;
  const nodeName = element.nodeName.toLowerCase();

  const isValid =
    (validTabNodes.test(nodeName) && !element.getAttribute('disabled')) ||
    (nodeName === 'a' && !!element.getAttribute('href')) ||
    element.hasAttribute('tabindex');

  return isValid && isElementVisible(element);
}

/**
 * Check if an element can be tabbed to (part of tab order)
 *
 * More restrictive than canHaveFocus - element must have non-negative tabIndex
 * and be focusable. Elements with tabindex="-1" are focusable but not tabbable.
 *
 * @param element - The element to check
 * @returns true if element is in tab order, false otherwise
 *
 * @example
 * ```typescript
 * const input = document.querySelector('input');
 * if (canBeTabbed(input)) {
 *   // Element is part of keyboard navigation flow
 * }
 * ```
 */
export function canBeTabbed(element: HTMLElement): boolean {
  const tabIndex = element.tabIndex;

  if (tabIndex === null || tabIndex < 0) {
    return false;
  }

  return canHaveFocus(element);
}
