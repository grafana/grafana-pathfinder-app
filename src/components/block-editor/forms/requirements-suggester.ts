/**
 * Requirements Suggester
 *
 * Utility functions for auto-suggesting default requirements based on
 * action types and selector patterns in the block builder.
 *
 * This module can be expanded to support additional patterns and rules.
 */

/**
 * Suggests default requirements based on action type and selector pattern.
 * Returns an array of requirement strings to ADD (caller merges with existing).
 *
 * Current rules:
 * - Highlight actions → exists-reftarget (element must exist to highlight)
 * - Nav menu selectors → navmenu-open (menu must be open to find items)
 */
export function suggestDefaultRequirements(action: string, reftarget: string): string[] {
  const suggestions: string[] = [];

  // Highlight actions should verify element exists before attempting to highlight
  if (action === 'highlight') {
    suggestions.push('exists-reftarget');
  }

  // Nav menu selectors need menu to be open to find the target element
  if (isNavMenuSelector(reftarget)) {
    suggestions.push('navmenu-open');
  }

  return suggestions;
}

/**
 * Checks if a selector targets navigation menu elements.
 * Detects common Grafana navigation patterns.
 */
function isNavMenuSelector(selector: string): boolean {
  if (!selector) {
    return false;
  }

  // Standard Grafana nav menu item selector
  if (selector.includes('data-testid Nav menu item')) {
    return true;
  }

  // Navigation mega-menu container
  if (selector.includes('navigation mega-menu')) {
    return true;
  }

  return false;
}

/**
 * Merges suggested requirements into an existing requirements string.
 * Avoids duplicates and preserves existing requirements.
 *
 * @param existing - Current requirements string (comma-separated)
 * @param suggestions - Array of requirements to add
 * @returns Updated requirements string with suggestions merged in
 */
export function mergeRequirements(existing: string, suggestions: string[]): string {
  const current = existing
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  const toAdd = suggestions.filter((s) => !current.includes(s));

  if (toAdd.length === 0) {
    return existing;
  }

  return [...current, ...toAdd].join(', ');
}
