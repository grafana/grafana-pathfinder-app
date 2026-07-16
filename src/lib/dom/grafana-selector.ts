/**
 * Grafana E2E Selector utilities
 * Converts Grafana selector objects to CSS selector strings
 * Based on @grafana/plugin-e2e approach for cross-version compatibility
 */

import { resolveSelectors, versionedComponents, versionedPages } from '@grafana/e2e-selectors';
import { config } from '@grafana/runtime';
import { toCssAttributeString } from './css-escape';
import { querySelectorAllEnhanced } from './enhanced-selector';

type SelectorNode = { [key: string]: SelectorNode | string | ((...args: never[]) => unknown) };

let resolvedSelectors: { version: string; tree: SelectorNode } | null = null;

/**
 * The selector tree resolved for the running Grafana version, so both forward
 * resolution and reverse lookup use the values this instance actually renders,
 * not the newest values in the bundled package.
 */
function getResolvedSelectors(): SelectorNode {
  const version = config.buildInfo.version || 'latest';
  if (resolvedSelectors?.version !== version) {
    const tree = resolveSelectors({ components: versionedComponents, pages: versionedPages }, version);
    resolvedSelectors = { version, tree: tree as unknown as SelectorNode };
  }
  return resolvedSelectors.tree;
}

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
  let current: SelectorNode[string] | undefined = getResolvedSelectors();

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
    const result = (current as (id: string) => unknown)(selectorId);
    if (typeof result !== 'string') {
      throw new Error(`Invalid selector type at ${selectorPath}: ${typeof result}`);
    }
    resolvedValue = result;
  } else if (typeof current === 'string') {
    resolvedValue = current;
  } else {
    throw new Error(`Invalid selector type at ${selectorPath}: ${typeof current}`);
  }

  // Most Grafana selectors use data-testid, but some older ones use aria-label.
  // :is() keeps both alternatives in ONE compound selector, so the result can be
  // scoped, prefixed, or embedded inside :has(...) — a bare top-level comma list
  // cannot (`scope A, B` scopes only A).
  const cssValue = toCssAttributeString(resolvedValue);
  const dataTestIdSelector = `[data-testid=${cssValue}]`;
  const ariaLabelSelector = `[aria-label=${cssValue}]`;

  return `:is(${dataTestIdSelector}, ${ariaLabelSelector})`;
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

interface ReverseIndex {
  exact: Map<string, string>;
  templates: Array<{ regex: RegExp; path: string }>;
}

// Delimited by U+E000 private-use characters that never appear in a real
// selector value, used to locate the parameter position inside a
// parameterized selector's output.
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

let reverseIndex: { source: SelectorNode; index: ReverseIndex } | null = null;

function getReverseIndex(): ReverseIndex {
  const root = getResolvedSelectors();
  if (reverseIndex?.source === root) {
    return reverseIndex.index;
  }
  const exact = new Map<string, string>();
  const ambiguous = new Set<string>();
  const templates: Array<{ regex: RegExp; path: string; weight: number }> = [];

  const walk = (node: SelectorNode, path: string): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const childPath = path ? `${path}.${key}` : key;
      if (typeof value === 'string') {
        if (ambiguous.has(value)) {
          continue;
        }
        if (exact.has(value)) {
          exact.delete(value);
          ambiguous.add(value);
        } else {
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

  walk(root.components as SelectorNode, 'components');
  walk(root.pages as SelectorNode, 'pages');

  // Most specific templates first, so a generic pattern never shadows a precise one.
  templates.sort((a, b) => b.weight - a.weight);
  reverseIndex = { source: root, index: { exact, templates: templates.map(({ regex, path }) => ({ regex, path })) } };
  return reverseIndex.index;
}

/**
 * Reverse of {@link toGrafanaSelector}: given a DOM element, return the
 * version-stable `grafana:` selector path that targets it, or null when the
 * element carries no recognized Grafana selector value.
 *
 * Covers both `components.*` and `pages.*`, matching on `data-testid` first and
 * `aria-label` second, and extracts the parameter for parameterized selectors
 * (e.g. `grafana:components.Breadcrumbs.breadcrumb:Home`).
 *
 * Lookups are resolved against the running Grafana version, and any ambiguous
 * value — one claimed by several selector paths, or matching several templates —
 * returns null so the picker degrades to its own CSS strategies rather than
 * emitting a confidently wrong path.
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
    let matched: string | null = null;
    for (const template of index.templates) {
      const match = template.regex.exec(value);
      if (!match || !match[1]) {
        continue;
      }
      if (matched) {
        matched = null;
        break;
      }
      matched = `grafana:${template.path}:${match[1]}`;
    }
    if (matched) {
      return matched;
    }
  }

  return null;
}
