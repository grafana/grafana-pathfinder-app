import { InteractiveElementData } from '../../types/interactive.types';
import { querySelectorAllEnhanced } from './enhanced-selector';
import { resolveSelector } from './selector-resolver';
import { isCssSelector } from './selector-detector';

/**
 * Recursively get all text content from an element and its descendants
 * Internal helper - not part of public API (exported for testing only)
 */
export function getAllTextContent(element: Element): string {
  let text = '';

  // Process all child nodes
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Add text node content
      text += (node.textContent || '').trim() + ' ';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recursively get text from child elements
      text += getAllTextContent(node as Element) + ' ';
    }
  }

  return text.trim();
}

/**
 * Extract interactive data from a DOM element
 */
export function extractInteractiveDataFromElement(element: HTMLElement): InteractiveElementData {
  const customData: Record<string, string> = {};

  // Extract all data-* attributes except the core ones
  Array.from(element.attributes).forEach((attr) => {
    if (
      attr.name.startsWith('data-') &&
      ![
        'data-reftarget',
        'data-targetaction',
        'data-targetvalue',
        'data-requirements',
        'data-objectives',
        'data-skippable',
        'data-lazyrender',
        'data-scrollcontainer',
      ].includes(attr.name)
    ) {
      const key = attr.name.substring(5); // Remove 'data-' prefix
      customData[key] = attr.value;
    }
  });

  // Extract core attributes with validation
  const reftarget = element.getAttribute('data-reftarget') || '';
  const targetaction = element.getAttribute('data-targetaction') || '';
  const targetvalue = element.getAttribute('data-targetvalue') || undefined;
  const requirements = element.getAttribute('data-requirements') || undefined;
  const objectives = element.getAttribute('data-objectives') || undefined;
  const skippable = element.getAttribute('data-skippable') === 'true'; // Default to false, only true if explicitly set
  const lazyRender = element.getAttribute('data-lazyrender') === 'true'; // Default to false
  const scrollContainer = element.getAttribute('data-scrollcontainer') || undefined;
  const textContent = element.textContent?.trim() || undefined;

  // Basic validation: Check if reftarget looks suspicious (only warn on obvious issues)
  if (reftarget && textContent && reftarget === textContent && reftarget.length > 5) {
    console.warn(`reftarget "${reftarget}" matches element text - check data-reftarget attribute`);
  }

  return {
    reftarget: reftarget,
    targetaction: targetaction,
    targetvalue: targetvalue,
    requirements: requirements,
    objectives: objectives,
    skippable: skippable,
    lazyRender: lazyRender || undefined,
    scrollContainer: scrollContainer,
    tagName: element.tagName.toLowerCase(),
    className: element.className || undefined,
    id: element.id || undefined,
    textContent: textContent,
    parentTagName: element.parentElement?.tagName.toLowerCase() || undefined,
    timestamp: Date.now(),
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  };
}

/**
 * Find button elements that contain the specified text (case-insensitive)
 * Prioritizes exact matches over partial matches
 */
export function findButtonByText(targetText: string): HTMLButtonElement[] {
  if (!targetText || typeof targetText !== 'string') {
    return [];
  }

  // In this special case we want to look through the entire document, since for finding
  // buttons we want to click, we have to look outside the docs plugin frame.
  const buttons = document.querySelectorAll('button');
  const searchText = targetText.toLowerCase().trim();

  const exactMatches: HTMLButtonElement[] = [];
  const partialMatches: HTMLButtonElement[] = [];

  Array.from(buttons).forEach((button) => {
    // Get all text content from the button and its descendants
    const allText = getAllTextContent(button).toLowerCase().trim();

    if (!allText) {
      return;
    }

    if (allText === searchText) {
      // Exact match
      exactMatches.push(button as HTMLButtonElement);
    } else if (allText.includes(searchText)) {
      // Partial match
      partialMatches.push(button as HTMLButtonElement);
    }
  });

  // Return exact matches if any exist, otherwise return partial matches
  if (exactMatches.length > 0) {
    return exactMatches;
  } else if (partialMatches.length > 0) {
    return partialMatches;
  }

  return [];
}

/**
 * Reset React's value tracker if present (must be done after setting value)
 */
export function resetValueTracker(targetElement: HTMLElement): void {
  if ((targetElement as any)._valueTracker) {
    (targetElement as any)._valueTracker.setValue('');
  }
}

/**
 * Options for lazy render support in reftargetExistsCheck
 */
export interface ReftargetExistsOptions {
  /** Enable progressive scroll discovery for virtualized containers */
  lazyRender?: boolean;
  /** CSS selector for scroll container when lazyRender is enabled */
  scrollContainer?: string;
}

/**
 * Check if a target element exists based on the action type
 * For button actions, checks if buttons with matching text exist
 * For other actions, checks if the CSS selector matches an element
 * Includes retry logic for elements that might not exist immediately
 * Enhanced with parent section expansion detection for navigation menu items
 * Supports lazy render fallback for virtualized containers (e.g., Grafana dashboards)
 */
export async function reftargetExistsCheck(
  reftarget: string,
  targetAction: string,
  options?: ReftargetExistsOptions
): Promise<{
  requirement: string;
  pass: boolean;
  error?: string;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
}> {
  // Resolve grafana: selectors first
  const resolvedSelector = resolveSelector(reftarget);

  // For button actions, determine if we should use text matching or selector matching
  if (targetAction === 'button') {
    // If reftarget looks like a CSS selector, use selector matching instead of text matching
    if (isCssSelector(reftarget) || reftarget.startsWith('grafana:')) {
      // Use selector-based matching (fall through to selector logic below)
      // Don't return early - let it use the enhanced selector matching
    } else {
      // Use text-based matching (original behavior)
      const buttons = findButtonByText(reftarget);

      if (buttons.length > 0) {
        return {
          requirement: 'exists-reftarget',
          pass: true,
        };
      } else {
        return {
          requirement: 'exists-reftarget',
          pass: false,
          error: `No buttons found containing text: "${reftarget}"`,
        };
      }
    }
  }

  // For other actions, check if the CSS selector matches an element
  // Use the resolved selector for checking
  // Fast-path check for navigation menu items
  if (resolvedSelector.includes('data-testid Nav menu item')) {
    // Most navigation menu items are immediately visible
    const targetElement = document.querySelector(resolvedSelector);
    if (targetElement) {
      return {
        requirement: 'exists-reftarget',
        pass: true,
      };
    }

    // If not found, it likely needs expansion - fail fast with fix suggestion
    const navigationMenuItemMatch = resolvedSelector.match(
      /a\[data-testid=['"]data-testid Nav menu item['"]\]\[href=['"]([^'"]+)['"]\]/
    );
    if (navigationMenuItemMatch) {
      const targetHref = navigationMenuItemMatch[1];
      return {
        requirement: 'exists-reftarget',
        pass: false,
        error: `Navigation menu item not found - may need section expansion`,
        canFix: true,
        fixType: 'expand-parent-navigation',
        targetHref: targetHref,
      };
    }
  }

  // Retry configuration for element detection
  const maxRetries = 2;
  const retryDelay = 200;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Use enhanced selector to support complex selectors like :has() and :contains()
    const enhancedResult = querySelectorAllEnhanced(resolvedSelector);
    const targetElement = enhancedResult.elements.length > 0 ? enhancedResult.elements[0] : null;

    if (targetElement) {
      return {
        requirement: 'exists-reftarget',
        pass: true,
      };
    }

    // If this isn't the last attempt, wait before retrying
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  // Element not found after retries - check for general navigation menu pattern
  if (
    resolvedSelector.includes('data-testid Nav menu item') &&
    !resolvedSelector.includes('/alerting/list') &&
    !resolvedSelector.includes('/plugins')
  ) {
    // For general navigation items that don't need expansion, return simple not found
    return {
      requirement: 'exists-reftarget',
      pass: false,
      error: `Navigation menu item not found`,
    };
  }

  // If lazyRender is enabled, return a fixable error that allows scroll discovery
  if (options?.lazyRender) {
    return {
      requirement: 'exists-reftarget',
      pass: false,
      error: 'Element not found - scroll dashboard to discover',
      canFix: true,
      fixType: 'lazy-scroll',
      scrollContainer: options.scrollContainer || DEFAULT_DASHBOARD_SCROLL_CONTAINER,
    };
  }

  return {
    requirement: 'exists-reftarget',
    pass: false,
    error: `Element not found: ${reftarget}`,
  };
}

/**
 * Default scroll container for Grafana dashboards
 */
const DEFAULT_DASHBOARD_SCROLL_CONTAINER = '.scrollbar-view';

/**
 * Progressive scroll discovery configuration
 */
export interface LazyScrollOptions {
  scrollContainerSelector?: string;
  maxScrollAttempts?: number;
  scrollIncrement?: number;
  waitTime?: number;
}

/**
 * Progressively scroll a container to discover lazy-loaded elements.
 * Useful for Grafana dashboards that virtualize panels off-screen.
 *
 * @param selector - CSS selector for the element to find
 * @param options - Configuration for scroll behavior
 * @returns Promise resolving to the element if found, null otherwise
 */
export async function scrollUntilElementFound(
  selector: string,
  options: LazyScrollOptions = {}
): Promise<HTMLElement | null> {
  const {
    scrollContainerSelector = DEFAULT_DASHBOARD_SCROLL_CONTAINER,
    maxScrollAttempts = 15, // More attempts since we scroll smaller increments
    scrollIncrement = 400, // Smaller increments for smoother scrolling
    waitTime = 350, // Longer wait to allow smooth scroll animation to complete
  } = options;

  // Find the scroll container
  const scrollContainer = document.querySelector(scrollContainerSelector);
  if (!scrollContainer || !(scrollContainer instanceof HTMLElement)) {
    console.warn(`[LazyScroll] Scroll container not found: ${scrollContainerSelector}`);
    return null;
  }

  // Resolve grafana: selectors
  const resolvedSelector = resolveSelector(selector);

  // First check if element already exists
  // Use querySelectorAllEnhanced to support custom selectors like :nth-match(), :contains(), etc.
  const existingResult = querySelectorAllEnhanced(resolvedSelector);
  if (existingResult.elements.length > 0 && existingResult.elements[0] instanceof HTMLElement) {
    return existingResult.elements[0];
  }

  for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
    // Scroll down with smooth animation for better UX
    scrollContainer.scrollBy({ top: scrollIncrement, behavior: 'smooth' });

    // Wait for smooth scroll animation + lazy render to kick in
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Check if element now exists using enhanced selector
    const result = querySelectorAllEnhanced(resolvedSelector);
    if (result.elements.length > 0 && result.elements[0] instanceof HTMLElement) {
      console.log(`[LazyScroll] Found element after ${attempt + 1} scroll(s): ${selector}`);
      return result.elements[0];
    }

    // Check if we've reached the bottom
    const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 10;

    if (atBottom) {
      console.log(`[LazyScroll] Reached bottom without finding element: ${selector}`);
      break;
    }
  }

  return null;
}

/**
 * Debug flag for getVisibleHighlightTarget logging
 * Enable via browser console: window.DEBUG_HIGHLIGHT_TARGET = true
 */
const isDebugEnabled = () => (window as any).DEBUG_HIGHLIGHT_TARGET === true;

/**
 * Find the best element to highlight for visual feedback
 *
 * Specifically handles React Select / Grafana dropdowns where the selector targets
 * a hidden grid-overlaid input instead of the visible wrapper.
 *
 * @param element - The initially selected element
 * @returns The element that should be highlighted (may be the original or input-wrapper parent)
 *
 * @example
 * ```typescript
 * // Selector targets: div[data-testid='collector-os-selection'] input
 * // Input has grid-area positioning and empty value
 * // Returns: The parent div with class containing '-input-wrapper'
 * const input = document.querySelector('div[data-testid="collector-os-selection"] input');
 * const highlightTarget = getVisibleHighlightTarget(input);
 * ```
 *
 * @debug Enable debug logging via browser console:
 * ```javascript
 * window.DEBUG_HIGHLIGHT_TARGET = true
 * ```
 */
export function getVisibleHighlightTarget(element: HTMLElement): HTMLElement {
  const tagName = element.tagName.toLowerCase();

  // Only apply to input elements
  if (tagName !== 'input') {
    return element;
  }

  // Check for grid overlay pattern (React Select, Grafana dropdowns)
  const computedStyle = window.getComputedStyle(element);
  const usesGridOverlay = computedStyle.gridArea !== 'auto' && computedStyle.gridArea.includes(' / ');
  const hasEmptyValue = (element as HTMLInputElement).value === '';
  const isHiddenViaGrid = usesGridOverlay && hasEmptyValue;

  if (isDebugEnabled()) {
    console.log('[VisibleHighlight] Checking input element:', {
      element,
      gridArea: computedStyle.gridArea,
      usesGridOverlay,
      hasEmptyValue,
      isHiddenViaGrid,
    });
  }

  // If not using grid overlay pattern, use element as-is.
  if (!isHiddenViaGrid) {
    if (isDebugEnabled()) {
      console.log('[VisibleHighlight] Not hidden via grid, using element as-is');
    }
    return element;
  }

  // Look for parent with class ending in -input-wrapper.
  let current: HTMLElement | null = element.parentElement;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    const hasInputWrapperClass = Array.from(current.classList).some((cls) => cls.endsWith('-input-wrapper'));

    if (isDebugEnabled()) {
      console.log(`[VisibleHighlight] Level ${depth + 1}:`, {
        element: current,
        classList: Array.from(current.classList),
        hasInputWrapperClass,
      });
    }

    if (hasInputWrapperClass) {
      if (isDebugEnabled()) {
        console.log('[VisibleHighlight] ✓ Found input-wrapper parent:', current);
      }
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  // No input-wrapper found, use original element
  if (isDebugEnabled()) {
    console.log('[VisibleHighlight] No input-wrapper found, using original element');
  }
  return element;
}

/**
 * Check if the navigation menu is open by trying various selectors
 * Based on Grafana's HTML structure, tries selectors in order of preference
 */
export async function navmenuOpenCheck(): Promise<{
  requirement: string;
  pass: boolean;
  error?: string;
  canFix?: boolean;
  fixType?: string;
}> {
  // Based on your HTML structure, try these selectors in order of preference
  const selectorsToTry = [
    // Most specific to your Grafana version
    'div[data-testid="data-testid navigation mega-menu"]',
    'ul[aria-label="Navigation"]',
    'div[data-testid*="navigation"]',
    'nav[aria-label="Navigation"]',
    'ul[aria-label="Main navigation"]',
  ];

  for (const selector of selectorsToTry) {
    const element = document.querySelector(selector);
    if (element) {
      return {
        requirement: 'navmenu-open',
        pass: true,
      };
    }
  }

  return {
    requirement: 'navmenu-open',
    pass: false,
    error: 'Navigation menu not detected - menu may be closed or selector mismatch',
    canFix: true,
    fixType: 'navigation',
  };
}

/**
 * Section completion checking - verifies that a previous tutorial section was completed
 *
 * Use cases:
 * - Sequential tutorials: ensure users complete steps in order
 * - Prerequisites: verify setup steps before advanced features
 * - Learning paths: enforce completion of foundational concepts
 *
 * How it works:
 * - Looks for DOM element with specified ID
 * - Checks if element has 'completed' CSS class
 * - Used to enforce step dependencies in multi-part tutorials
 */
export async function sectionCompletedCheck(check: string): Promise<{
  requirement: string;
  pass: boolean;
  error?: string;
  context?: Record<string, unknown> | null;
}> {
  try {
    const sectionId = check.replace('section-completed:', '');

    // Check if the section exists in DOM and has completed class
    const sectionElement = document.getElementById(sectionId);
    const isCompleted = sectionElement?.classList.contains('completed') || false;

    return {
      requirement: check,
      pass: isCompleted,
      error: isCompleted ? undefined : `Section '${sectionId}' must be completed first`,
      context: { sectionId, found: !!sectionElement, hasCompletedClass: isCompleted },
    };
  } catch (error) {
    console.error('Section completion check error:', error);
    return {
      requirement: check,
      pass: false,
      error: `Section completion check failed: ${error}`,
      context: { error },
    };
  }
}

/**
 * Form validation checking - verifies that all forms on the page are in a valid state
 *
 * Use cases:
 * - Before submitting a form: ensure all required fields are filled and valid
 * - Multi-step forms: verify current step is complete before proceeding
 * - Data source configuration: check connection form is properly filled
 * - Dashboard settings: ensure all form inputs are valid before saving
 *
 * What it checks:
 * - No forms have .error, .invalid, [aria-invalid="true"], .has-error, or .field-error classes
 * - No required fields are empty or invalid
 * - At least one form exists on the page
 */
export async function formValidCheck(check: string): Promise<{
  requirement: string;
  pass: boolean;
  error?: string;
  context?: Record<string, unknown> | null;
}> {
  try {
    // Look for common form validation indicators in the DOM
    const forms = document.querySelectorAll('form');

    if (forms.length === 0) {
      return {
        requirement: check,
        pass: false,
        error: 'No forms found on the page',
        context: { formCount: 0 },
      };
    }

    let hasValidForms = true;
    const validationErrors: string[] = [];

    // Check each form for validation state
    forms.forEach((form, index) => {
      // Look for common validation error indicators
      const errorElements = form.querySelectorAll('.error, .invalid, [aria-invalid="true"], .has-error, .field-error');
      const requiredEmptyFields = form.querySelectorAll(
        'input[required]:invalid, select[required]:invalid, textarea[required]:invalid'
      );

      if (errorElements.length > 0) {
        hasValidForms = false;
        validationErrors.push(`Form ${index + 1}: Has ${errorElements.length} validation errors`);
      }

      if (requiredEmptyFields.length > 0) {
        hasValidForms = false;
        validationErrors.push(`Form ${index + 1}: Has ${requiredEmptyFields.length} required empty fields`);
      }
    });

    return {
      requirement: check,
      pass: hasValidForms,
      error: hasValidForms ? undefined : `Form validation failed: ${validationErrors.join(', ')}`,
      context: {
        formCount: forms.length,
        validationErrors,
        hasValidForms,
      },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Form validation check failed: ${error}`,
      context: { error },
    };
  }
}
