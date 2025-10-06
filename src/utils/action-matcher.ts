/**
 * Action matching utilities for auto-detection of step completion
 *
 * Matches detected user actions against interactive step configurations
 * to determine if a step should be automatically marked as complete.
 *
 * @module action-matcher
 */

import type { DetectedAction } from './action-detector';
import { findButtonByText } from './dom-utils';

export interface StepActionConfig {
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'sequence' | 'hover';
  refTarget: string;
  targetValue?: string;
}

export interface DetectedActionEvent {
  actionType: DetectedAction;
  element: HTMLElement;
  value?: string;
  timestamp: number;
}

/**
 * Check if a detected action matches a step's configuration
 *
 * Compares the detected action (from user interaction) with the step's
 * expected action configuration to determine if they match.
 *
 * @param detected - The detected action event from user interaction
 * @param stepConfig - The step's action configuration
 * @returns true if the detected action matches the step's requirements
 *
 * @example
 * ```typescript
 * const detected = {
 *   actionType: 'button',
 *   element: buttonElement,
 *   timestamp: Date.now()
 * };
 *
 * const config = {
 *   targetAction: 'button',
 *   refTarget: 'Save dashboard',
 *   targetValue: undefined
 * };
 *
 * if (matchesStepAction(detected, config)) {
 *   // User clicked the Save button, mark step complete
 * }
 * ```
 */
export function matchesStepAction(detected: DetectedActionEvent, stepConfig: StepActionConfig): boolean {
  const { actionType, element, value } = detected;
  const { targetAction, refTarget, targetValue } = stepConfig;

  // Action type must match (or be compatible)
  if (!isCompatibleActionType(actionType, targetAction)) {
    return false;
  }

  // Dispatch to specific matching logic based on action type
  switch (targetAction) {
    case 'button':
      return matchesButtonAction(element, refTarget);

    case 'formfill':
      return matchesFormfillAction(element, refTarget, targetValue, value);

    case 'highlight':
      return matchesHighlightAction(element, refTarget);

    case 'navigate':
      return matchesNavigateAction(element, refTarget);

    case 'hover':
      return matchesHoverAction(element, refTarget);

    case 'sequence':
      // Sequence actions are handled at multi-step level, not here
      return false;

    default:
      return false;
  }
}

/**
 * Check if detected action type is compatible with target action type
 *
 * Some action types can satisfy multiple target actions (e.g., a button
 * can be detected as either 'button' or 'highlight' depending on uniqueness)
 */
function isCompatibleActionType(detected: DetectedAction, target: StepActionConfig['targetAction']): boolean {
  // Exact match always works
  if (detected === target) {
    return true;
  }

  // 'highlight' is compatible with 'button' (generic click)
  if (detected === 'highlight' && target === 'button') {
    return true;
  }

  // 'navigate' is compatible with 'highlight' (link click)
  if (detected === 'navigate' && target === 'highlight') {
    return true;
  }

  return false;
}

/**
 * Match button action by text content
 *
 * Buttons are identified by their visible text content. This matches
 * the same logic used by findButtonByText in dom-utils.
 */
function matchesButtonAction(element: HTMLElement, buttonText: string): boolean {
  // Check if the element itself matches the button text
  const elementText = element.textContent?.trim() || '';
  if (elementText === buttonText) {
    return true;
  }

  // Check if this element is within a button that matches
  // (e.g., user clicked an icon inside a button)
  const parentButton = element.closest('button, [role="button"]');
  if (parentButton) {
    const parentText = parentButton.textContent?.trim() || '';
    if (parentText === buttonText) {
      return true;
    }
  }

  // Use findButtonByText to check if this matches the expected button
  const matchingButtons = findButtonByText(buttonText);
  return matchingButtons.some((btn) => btn === element || btn.contains(element));
}

/**
 * Match form fill action by selector and optionally value
 *
 * Form fields are matched by their test ID, name, or other selector attributes.
 * Optionally validates that the filled value matches expectations.
 */
function matchesFormfillAction(
  element: HTMLElement,
  selector: string,
  expectedValue?: string,
  actualValue?: string
): boolean {
  // Element must be a form input
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    return false;
  }

  // Match by selector - try various methods
  if (!elementMatchesSelector(element, selector)) {
    return false;
  }

  // If target value specified, validate it matches
  if (expectedValue !== undefined && actualValue !== undefined) {
    return actualValue === expectedValue;
  }

  // No value validation needed, selector match is sufficient
  return true;
}

/**
 * Match highlight action by selector
 *
 * Highlight actions are generic clicks on elements identified by selector.
 */
function matchesHighlightAction(element: HTMLElement, selector: string): boolean {
  return elementMatchesSelector(element, selector);
}

/**
 * Match navigate action by href
 *
 * Navigation actions are clicks on links. Match by href attribute.
 */
function matchesNavigateAction(element: HTMLElement, href: string): boolean {
  // Element must be a link or within a link
  const link = element.tagName.toLowerCase() === 'a' ? element : element.closest('a');

  if (!link) {
    return false;
  }

  const actualHref = link.getAttribute('href');
  if (!actualHref) {
    return false;
  }

  // Match exact href or partial match for relative URLs
  return actualHref === href || actualHref.includes(href);
}

/**
 * Match hover action by selector
 *
 * Hover actions are mouseenter events on elements identified by selector.
 */
function matchesHoverAction(element: HTMLElement, selector: string): boolean {
  return elementMatchesSelector(element, selector);
}

/**
 * Check if an element matches a selector string
 *
 * Tries multiple matching strategies:
 * - data-testid attribute
 * - CSS selector (if valid)
 * - Partial text content match
 * - Aria label match
 */
function elementMatchesSelector(element: HTMLElement, selector: string): boolean {
  // Try data-testid match
  const testId = element.getAttribute('data-testid');
  if (testId && testId === selector) {
    return true;
  }

  // Try CSS selector match (if selector is valid CSS)
  try {
    if (element.matches(selector)) {
      return true;
    }

    // Also check if element is within a matching parent
    // (e.g., clicked icon inside a button with the selector)
    if (element.closest(selector)) {
      return true;
    }
  } catch {
    // Selector might not be valid CSS, continue with other methods
  }

  // Try aria-label match
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel === selector) {
    return true;
  }

  // Try partial text content match (for cases where selector is descriptive text)
  const textContent = element.textContent?.trim() || '';
  if (textContent === selector || textContent.includes(selector)) {
    return true;
  }

  return false;
}

/**
 * ActionMatcher class for managing multiple step configurations
 *
 * Use this when you need to track multiple steps and find which one
 * (if any) matches a detected action.
 */
export class ActionMatcher {
  private stepConfigs = new Map<string, StepActionConfig>();

  /**
   * Register a step's action configuration
   */
  registerStep(stepId: string, config: StepActionConfig): void {
    this.stepConfigs.set(stepId, config);
  }

  /**
   * Unregister a step (e.g., when component unmounts)
   */
  unregisterStep(stepId: string): void {
    this.stepConfigs.delete(stepId);
  }

  /**
   * Find which registered step (if any) matches the detected action
   *
   * Returns the stepId of the matching step, or null if no match found.
   */
  findMatchingStep(detected: DetectedActionEvent): string | null {
    for (const [stepId, config] of this.stepConfigs.entries()) {
      if (matchesStepAction(detected, config)) {
        return stepId;
      }
    }
    return null;
  }

  /**
   * Clear all registered steps
   */
  clear(): void {
    this.stepConfigs.clear();
  }

  /**
   * Get count of registered steps
   */
  get size(): number {
    return this.stepConfigs.size;
  }
}
