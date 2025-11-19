/**
 * Selector Resolver
 * Central resolver for handling different selector formats including Grafana e2e selectors
 */

import { toGrafanaSelector } from './grafana-selector';

/**
 * Resolve a selector string that may contain special prefixes
 *
 * Supported formats:
 * - `grafana:components.RefreshPicker.runButton` - Grafana e2e selector path
 * - `grafana:components.NavMenu.item:Dashboards` - Grafana selector with parameter (colon-separated)
 * - `button[data-testid="..."]` - Standard CSS selector (returned as-is)
 *
 * @param reftarget - The selector string from data-reftarget attribute
 * @returns Resolved CSS selector string
 *
 * @example
 * // Grafana selector
 * resolveSelector('grafana:components.RefreshPicker.runButton')
 * // Returns: '[data-testid="data-testid RefreshPicker run button"], [aria-label="RefreshPicker run button"]'
 *
 * @example
 * // Standard CSS selector
 * resolveSelector('button.primary')
 * // Returns: 'button.primary'
 *
 * @example
 * // Grafana selector with parameter
 * resolveSelector('grafana:pages.AddDashboard.itemButton:Panel')
 * // Returns: 'button[aria-label="Add new panel Panel"]'
 */
export function resolveSelector(reftarget: string): string {
  if (!reftarget) {
    return reftarget;
  }

  // Check for grafana: prefix
  if (reftarget.startsWith('grafana:')) {
    // Remove prefix
    const pathWithParam = reftarget.substring(8); // Remove 'grafana:'

    // Check if there's a parameter (separated by colon)
    const colonIndex = pathWithParam.lastIndexOf(':');
    let selectorPath: string;
    let selectorId: string | undefined;

    if (colonIndex !== -1 && colonIndex < pathWithParam.length - 1) {
      // Split path and parameter
      selectorPath = pathWithParam.substring(0, colonIndex);
      selectorId = pathWithParam.substring(colonIndex + 1);
    } else {
      selectorPath = pathWithParam;
    }

    try {
      return toGrafanaSelector(selectorPath, selectorId);
    } catch (error) {
      console.error(`Failed to resolve Grafana selector: ${reftarget}`, error);
      // Return original selector as fallback
      return reftarget;
    }
  }

  // Return as-is if it's a regular CSS selector
  return reftarget;
}
