/**
 * Action matching utilities for auto-detection of step completion
 *
 * Matches detected user actions against interactive step configurations
 * to determine if a step should be automatically marked as complete.
 *
 * @module action-matcher
 */

import type { DetectedAction } from './action-detector';
import { findButtonByText } from '../../lib/dom';

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
  // Coordinates for spatial matching (similar to guided-handler.ts)
  clientX?: number;
  clientY?: number;
}

/**
 * Check if detected action coordinates fall within element's bounding box
 * Uses padding similar to guided-handler.ts for forgiveness
 *
 * @param detectedAction - The detected action with coordinates
 * @param targetElement - The target element to check against
 * @param padding - Padding around element bounds (default: 16px)
 * @returns true if coordinates fall within padded bounds
 *
 * @example
 * ```typescript
 * const detected = { clientX: 100, clientY: 200, ... };
 * const element = document.querySelector('button');
 * if (matchesElementBounds(detected, element)) {
 *   // Click was within button bounds
 * }
 * ```
 */
export function matchesElementBounds(
  detectedAction: DetectedActionEvent,
  targetElement: HTMLElement,
  padding = 16
): boolean {
  // Extract coordinates from detected action
  const { clientX, clientY } = detectedAction;

  if (clientX === undefined || clientY === undefined) {
    return false; // No coordinates available
  }

  // Get element bounds
  const rect = targetElement.getBoundingClientRect();

  // Check if click is within expanded bounds (with padding for forgiveness)
  return (
    clientX >= rect.left - padding &&
    clientX <= rect.right + padding &&
    clientY >= rect.top - padding &&
    clientY <= rect.bottom + padding
  );
}

/**
 * Check if a detected action matches a step's configuration
 *
 * Compares the detected action (from user interaction) with the step's
 * expected action configuration to determine if they match.
 *
 * Uses coordinate-based matching as primary check when target element is provided,
 * falling back to selector-based matching if coordinates unavailable.
 *
 * @param detected - The detected action event from user interaction
 * @param stepConfig - The step's action configuration
 * @param targetElement - Optional resolved target element for coordinate matching
 * @returns true if the detected action matches the step's requirements
 *
 * @example
 * ```typescript
 * const detected = {
 *   actionType: 'button',
 *   element: buttonElement,
 *   clientX: 100,
 *   clientY: 200,
 *   timestamp: Date.now()
 * };
 *
 * const config = {
 *   targetAction: 'button',
 *   refTarget: 'Save dashboard',
 *   targetValue: undefined
 * };
 *
 * const targetElement = document.querySelector('[data-testid="save-button"]');
 *
 * if (matchesStepAction(detected, config, targetElement)) {
 *   // User clicked the Save button, mark step complete
 * }
 * ```
 */
export function matchesStepAction(
  detected: DetectedActionEvent,
  stepConfig: StepActionConfig,
  targetElement?: HTMLElement | null
): boolean {
  const { actionType, element, value } = detected;
  const { targetAction, refTarget, targetValue } = stepConfig;

  // Action type must match (or be compatible)
  if (!isCompatibleActionType(actionType, targetAction)) {
    return false;
  }

  // Try coordinate-based matching first if target element and coordinates available
  if (targetElement && detected.clientX !== undefined && detected.clientY !== undefined) {
    // For click-based actions (button, highlight, navigate), use coordinate matching
    if (targetAction === 'button' || targetAction === 'highlight' || targetAction === 'navigate') {
      const coordMatch = matchesElementBounds(detected, targetElement);
      if (coordMatch) {
        return true; // Coordinate match is authoritative
      }
      // If coordinate match fails, fall through to selector-based matching
    }

    // For hover actions, also use coordinate matching
    if (targetAction === 'hover' && actionType === 'hover') {
      const coordMatch = matchesElementBounds(detected, targetElement);
      if (coordMatch) {
        return true;
      }
    }
  }

  // Fall back to selector-based matching (original behavior)
  // This handles cases where:
  // - No target element provided
  // - No coordinates available
  // - Coordinate match failed but might still match via selector
  switch (targetAction) {
    case 'button':
      return matchesButtonAction(element, refTarget, targetElement);

    case 'formfill':
      return matchesFormfillAction(element, refTarget, targetValue, value);

    case 'highlight':
      return matchesHighlightAction(element, refTarget, targetElement);

    case 'navigate':
      return matchesNavigateAction(element, refTarget);

    case 'hover':
      return matchesHoverAction(element, refTarget, targetElement);

    case 'sequence':
      // Sequence actions are handled at multi-step level, not here
      return false;

    default:
      return false;
  }
}

/**
 * Check if element is non-focusable but still interactive
 *
 * Some elements don't receive focus but are legitimately interactive
 * (e.g., divs with click handlers, elements with ARIA button role).
 * Uses permissive matching to avoid filtering out valid interactive elements.
 *
 * @param element - The element to check
 * @returns true if element is interactive despite not being focusable
 *
 * @example
 * ```typescript
 * if (isNonFocusableInteractive(divElement)) {
 *   // Element is clickable even though it can't receive keyboard focus
 * }
 * ```
 */
export function isNonFocusableInteractive(element: HTMLElement): boolean {
  const role = element.getAttribute('role');

  return (
    role === 'button' ||
    role === 'link' ||
    role === 'tab' ||
    role === 'menuitem' ||
    role === 'checkbox' ||
    role === 'radio' ||
    element.onclick !== null ||
    element.classList.contains('clickable') ||
    element.hasAttribute('data-testid') || // Test IDs often indicate interactive elements
    element.hasAttribute('aria-label') // Labeled elements are usually interactive
  );
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
 *
 * @param element - The clicked element
 * @param buttonText - The button text to match
 * @param targetElement - Optional target element (already matched via coordinates)
 */
function matchesButtonAction(element: HTMLElement, buttonText: string, targetElement?: HTMLElement | null): boolean {
  // If we already have a target element from coordinate matching,
  // just verify the clicked element is within it
  if (targetElement) {
    return targetElement === element || targetElement.contains(element);
  }
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
 *
 * @param element - The clicked element
 * @param selector - The CSS selector or identifier
 * @param targetElement - Optional target element (already matched via coordinates)
 */
function matchesHighlightAction(element: HTMLElement, selector: string, targetElement?: HTMLElement | null): boolean {
  // If we already have a target element from coordinate matching,
  // just verify the clicked element is within it
  if (targetElement) {
    return targetElement === element || targetElement.contains(element);
  }

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
 *
 * @param element - The hovered element
 * @param selector - The CSS selector or identifier
 * @param targetElement - Optional target element (already matched via coordinates)
 */
function matchesHoverAction(element: HTMLElement, selector: string, targetElement?: HTMLElement | null): boolean {
  // If we already have a target element from coordinate matching,
  // just verify the hovered element is within it
  if (targetElement) {
    return targetElement === element || targetElement.contains(element);
  }

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
  private stepConfigs = new Map<
    string,
    {
      config: StepActionConfig;
      elementResolver?: () => HTMLElement | null;
    }
  >();

  /**
   * Register a step's action configuration
   *
   * @param stepId - Unique identifier for the step
   * @param config - Step action configuration
   * @param elementResolver - Optional function to resolve target element for coordinate matching
   */
  registerStep(stepId: string, config: StepActionConfig, elementResolver?: () => HTMLElement | null): void {
    this.stepConfigs.set(stepId, { config, elementResolver });
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
   * Uses coordinate-based matching when element resolver is provided.
   */
  findMatchingStep(detected: DetectedActionEvent): string | null {
    for (const [stepId, { config, elementResolver }] of this.stepConfigs.entries()) {
      // Try to resolve target element for coordinate matching
      let targetElement: HTMLElement | null = null;
      if (elementResolver) {
        try {
          targetElement = elementResolver();
        } catch (error) {
          // Element resolution failed, fall back to selector-based matching
          console.warn(`Element resolver failed for step ${stepId}:`, error);
        }
      }

      // Check if action matches (with optional coordinate support)
      if (matchesStepAction(detected, config, targetElement)) {
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
