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

import { findButtonByText } from './dom-utils';

export type DetectedAction = 'highlight' | 'button' | 'formfill' | 'navigate' | 'hover';

/**
 * Detect the best action type for an element based on its tag and attributes
 *
 * Analyzes the element to determine what type of interaction makes sense:
 * - Form elements → 'formfill' (captures values)
 * - Buttons with unique text → 'button' (uses text matching)
 * - External links → 'navigate' (opens new pages)
 * - Everything else → 'highlight' (generic click)
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

  // Form elements always use formfill
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return 'formfill';
  }

  // Buttons use button action if they have unique text, otherwise highlight
  if (tag === 'button' || element.getAttribute('role') === 'button') {
    const text = element.textContent?.trim();
    if (text) {
      const buttons = findButtonByText(text);
      if (buttons.length === 1) {
        return 'button'; // Unique text, use button action
      }
    }
    return 'highlight'; // Not unique, use highlight
  }

  // Links could be navigate, but typically we use highlight for internal navigation
  if (tag === 'a') {
    const href = element.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      return 'navigate'; // External link
    }
    return 'highlight'; // Internal link, use highlight to click
  }

  // Everything else defaults to highlight (most common action)
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
