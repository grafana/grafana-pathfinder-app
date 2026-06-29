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
  return elements.length > 0 ? elements[0]! : null;
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

// ============================================================================
// Reverse lookup: element → grafana: selector path
// ============================================================================

type SelectorNode = { [key: string]: SelectorNode | string | ((...args: never[]) => unknown) };

interface ReverseIndex {
  exact: Map<string, string>;
  templates: Array<{ regex: RegExp; path: string }>;
}

// A control character that never appears in a real selector value, used to
// locate the parameter position inside a parameterized selector's output.
const TEMPLATE_SENTINEL = 'PARAM';
const TESTID_PREFIX = /^data-testid\s*/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turn a parameterized selector function into a matcher. Returns null when the
 * function ignores its argument, takes several, or is so generic that its only
 * literal text is the shared `data-testid` prefix (which would match almost any
 * element — `pages.AddDashboard.itemButton` is the canonical offender).
 */
function buildTemplate(fn: (...args: never[]) => unknown): { regex: RegExp; weight: number } | null {
  let resolved: unknown;
  try {
    resolved = (fn as (id: string) => unknown)(TEMPLATE_SENTINEL);
  } catch {
    return null;
  }
  if (typeof resolved !== 'string') {
    return null;
  }
  const first = resolved.indexOf(TEMPLATE_SENTINEL);
  if (first === -1 || first !== resolved.lastIndexOf(TEMPLATE_SENTINEL) || resolved.includes('undefined')) {
    return null;
  }
  const prefix = resolved.slice(0, first);
  const suffix = resolved.slice(first + TEMPLATE_SENTINEL.length);
  const discriminator = (prefix.replace(TESTID_PREFIX, '') + suffix).trim();
  if (discriminator.length < 3) {
    return null;
  }
  return { regex: new RegExp(`^${escapeRegExp(prefix)}(.+)${escapeRegExp(suffix)}$`), weight: discriminator.length };
}

let reverseIndex: ReverseIndex | null = null;

function getReverseIndex(): ReverseIndex {
  if (reverseIndex) {
    return reverseIndex;
  }
  const exact = new Map<string, string>();
  const templates: Array<{ regex: RegExp; path: string; weight: number }> = [];

  const walk = (node: SelectorNode, path: string): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const childPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string') {
        if (!exact.has(value)) {
          exact.set(value, childPath);
        }
      } else if (typeof value === 'function') {
        const template = buildTemplate(value);
        if (template) {
          templates.push({ regex: template.regex, path: childPath, weight: template.weight });
        }
      } else if (value && typeof value === 'object') {
        walk(value, childPath);
      }
    }
  };

  const root = grafanaSelectors as unknown as SelectorNode;
  walk(root.components as SelectorNode, 'components');
  walk(root.pages as SelectorNode, 'pages');

  // Most specific templates first, so a generic pattern never shadows a precise one.
  templates.sort((a, b) => b.weight - a.weight);
  reverseIndex = { exact, templates: templates.map(({ regex, path }) => ({ regex, path })) };
  return reverseIndex;
}

/**
 * Reverse of {@link toGrafanaSelector}: given a DOM element, return the
 * version-stable `grafana:` selector path that targets it, or null when the
 * element carries no recognized Grafana selector value.
 *
 * Covers both `components.*` and `pages.*`, matching on `data-testid` first and
 * `aria-label` second, and extracts the parameter for parameterized selectors
 * (e.g. `grafana:components.Breadcrumbs.breadcrumb:Home`).
 */
export function findGrafanaSelectorPath(element: HTMLElement): string | null {
  const index = getReverseIndex();
  const values = [element.getAttribute('data-testid'), element.getAttribute('aria-label')].filter(
    (value): value is string => Boolean(value)
  );

  for (const value of values) {
    const exactPath = index.exact.get(value);
    if (exactPath) {
      return `grafana:${exactPath}`;
    }
  }

  for (const value of values) {
    for (const template of index.templates) {
      const match = template.regex.exec(value);
      if (match && match[1]) {
        return `grafana:${template.path}:${match[1]}`;
      }
    }
  }

  return null;
}
