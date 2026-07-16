/**
 * Selector Resolver
 * Central resolver for handling different selector formats including Grafana e2e selectors
 */

import { logger } from '../logging';
import { escapeCssAttributeValue } from './css-escape';
import { toGrafanaSelector } from './grafana-selector';

/**
 * Resolve a selector string that may contain special prefixes
 *
 * Supported formats:
 * - `grafana:components.RefreshPicker.runButton` - Grafana e2e selector path
 * - `grafana:components.NavMenu.item:Dashboards` - Grafana selector with parameter (split at the
 *   first colon after the prefix; the parameter itself may contain colons)
 * - `button[data-testid="..."]` - Standard CSS selector (returned as-is)
 *
 * @param reftarget - The selector string from data-reftarget attribute
 * @returns Resolved CSS selector string
 *
 * @example
 * // Grafana selector — one value resolved for the running Grafana version,
 * // mirrored onto both attributes
 * resolveSelector('grafana:components.RefreshPicker.runButton')
 * // Returns: ":is([data-testid='data-testid RefreshPicker run button'], [aria-label='data-testid RefreshPicker run button'])"
 *
 * @example
 * // Standard CSS selector
 * resolveSelector('button.primary')
 * // Returns: 'button.primary'
 *
 * @example
 * // Grafana selector with parameter
 * resolveSelector('grafana:components.Panels.Panel.title:CPU Usage')
 * // Returns: ":is([data-testid='data-testid Panel header CPU Usage'], [aria-label='data-testid Panel header CPU Usage'])"
 */
export function resolveSelector(reftarget: string): string {
  if (!reftarget) {
    return reftarget;
  }

  // Check for grafana: prefix
  if (reftarget.startsWith('grafana:')) {
    // Remove prefix
    const pathWithParam = reftarget.substring(8); // Remove 'grafana:'

    // Selector paths are dot-separated and never contain colons, so the first
    // colon unambiguously separates path from parameter (which may itself contain colons)
    const colonIndex = pathWithParam.indexOf(':');
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
      logger.error(`Failed to resolve Grafana selector: ${reftarget}`, { error });
      // Return original selector as fallback
      return reftarget;
    }
  }

  // panel: prefix - resolves to panel container by title
  if (reftarget.startsWith('panel:')) {
    return resolvePanelSelector(reftarget);
  }

  // Return as-is if it's a regular CSS selector
  return reftarget;
}

/**
 * Resolve a panel: prefix selector to a CSS selector targeting a Grafana panel by title.
 * Format: "panel:Panel Title" or "panel:Panel Title > child-selector"
 */
function resolvePanelSelector(reftarget: string): string {
  const panelPart = reftarget.substring(6); // Remove 'panel:'
  const childSeparator = panelPart.indexOf(' > ');

  let panelTitle: string;
  let childSelector: string | null = null;

  if (childSeparator !== -1) {
    panelTitle = panelPart.substring(0, childSeparator);
    childSelector = panelPart.substring(childSeparator + 3);
  } else {
    panelTitle = panelPart;
  }

  // Grafana panels use [data-viz-panel-key] and have title in header
  const baseSelector = `[data-viz-panel-key]:has([data-testid*="Panel header ${escapeCssAttributeValue(panelTitle, '"')}"])`;
  return childSelector ? `${baseSelector} ${childSelector}` : baseSelector;
}
