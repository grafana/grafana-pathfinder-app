/**
 * Grafana E2E Selector utilities
 * Converts Grafana selector objects to CSS selector strings
 * Based on @grafana/plugin-e2e approach for cross-version compatibility
 */

import { selectors as grafanaSelectors } from '@grafana/e2e-selectors';
import { querySelectorAllEnhanced } from './enhanced-selector';

/**
 * Convert a Grafana selector path to a CSS selector string
 * Handles both aria-label and data-testid attributes based on the selector definition
 *
 * @param selectorPath - Dot-notation path to selector (e.g., 'components.RefreshPicker.runButton')
 * @returns CSS selector string that can be used with querySelector
 *
 * @example
 * // Simple selector
 * const selector = toGrafanaSelector('components.Select.input');
 * // Returns: '[data-testid="data-testid Select input"], [aria-label="Select input"]'
 *
 * @example
 * // Parameterized selector with ID
 * const selector = toGrafanaSelector('pages.AddDashboard.itemButton', 'Panel');
 * // Returns: 'button[aria-label="Add new panel Panel"]'
 */
export function toGrafanaSelector(selectorPath: string, selectorId?: string): string {
  if (!selectorPath) {
    throw new Error('Selector path is required');
  }

  // Navigate the selector object path
  const parts = selectorPath.split('.');
  let current: any = grafanaSelectors;

  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      throw new Error(`Invalid selector path: ${selectorPath} (failed at ${part})`);
    }
    current = current[part];
    if (current === undefined) {
      throw new Error(`Selector not found: ${selectorPath} (${part} is undefined)`);
    }
  }

  // Handle parameterized selectors (functions)
  let resolvedValue: string;
  if (typeof current === 'function') {
    if (!selectorId) {
      throw new Error(`Selector ${selectorPath} requires an ID parameter`);
    }
    resolvedValue = current(selectorId);
  } else if (typeof current === 'string') {
    resolvedValue = current;
  } else {
    throw new Error(`Invalid selector type at ${selectorPath}: ${typeof current}`);
  }

  // Most Grafana selectors use data-testid, but some older ones use aria-label
  // Return a compound selector that works with both
  const dataTestIdSelector = `[data-testid='${resolvedValue}']`;
  const ariaLabelSelector = `[aria-label='${resolvedValue}']`;

  return `${dataTestIdSelector}, ${ariaLabelSelector}`;
}

/**
 * Find elements using a Grafana selector path
 * This is the primary function you should use when selecting Grafana UI elements
 *
 * @param selectorPath - Dot-notation path to selector
 * @param selectorId - Optional ID for parameterized selectors
 * @returns Array of matching HTMLElements
 *
 * @example
 * // Find the query editor
 * const editors = findByGrafanaSelector('components.CodeEditor.container');
 *
 * @example
 * // Find a specific menu item
 * const menuItem = findByGrafanaSelector('components.NavMenu.item', 'Dashboards');
 */
export function findByGrafanaSelector(selectorPath: string, selectorId?: string): HTMLElement[] {
  const cssSelector = toGrafanaSelector(selectorPath, selectorId);
  const result = querySelectorAllEnhanced(cssSelector);
  return result.elements;
}

/**
 * Find a single element using a Grafana selector path
 * Returns the first matching element or null
 * Internal helper - not part of public API (exported for testing only)
 *
 * @param selectorPath - Dot-notation path to selector
 * @param selectorId - Optional ID for parameterized selectors
 * @returns First matching HTMLElement or null
 */
export function findOneByGrafanaSelector(selectorPath: string, selectorId?: string): HTMLElement | null {
  const elements = findByGrafanaSelector(selectorPath, selectorId);
  return elements.length > 0 ? elements[0] : null;
}

/**
 * Check if an element matching the Grafana selector exists
 * Useful for requirement checking in interactive guides
 * Internal helper - not part of public API (exported for testing only)
 *
 * @param selectorPath - Dot-notation path to selector
 * @param selectorId - Optional ID for parameterized selectors
 * @returns true if at least one matching element exists
 */
export function existsByGrafanaSelector(selectorPath: string, selectorId?: string): boolean {
  const elements = findByGrafanaSelector(selectorPath, selectorId);
  return elements.length > 0;
}

// Re-export grafanaSelectors for test compatibility (unused in production)
/** @deprecated Unused in production - kept for test compatibility only */
export const selectors = grafanaSelectors;

// Navigation selectors for test compatibility (unused in production)
/** @deprecated Unused in production - kept for test compatibility only */
export const navSelectors = {
  menuItemByHref: (href: string): string => {
    return `a[data-testid='data-testid Nav menu item'][href='${href}']`;
  },
  menuItemByText: (text: string): string => {
    return `a[data-testid='data-testid Nav menu item']:contains('${text}')`;
  },
};
