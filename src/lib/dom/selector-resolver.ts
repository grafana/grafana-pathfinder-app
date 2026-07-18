import { config } from '@grafana/runtime';

import { logger } from '../logging';
import { resolveSelectorForVersion } from './selector-resolver-core';

/**
 * Resolve a selector string that may contain special prefixes
 *
 * Supported formats:
 * - `grafana:components.RefreshPicker.runButtonV2` - Grafana e2e selector path
 * - `grafana:components.NavMenu.item:Dashboards` - Grafana selector with parameter (split at the
 *   first colon after the prefix; the parameter itself may contain colons)
 * - `div[data-testid='panel'] {grafana:components.Select.input}` - CSS selector with embedded
 *   grafana tokens; each `{grafana:path[:param]}` resolves in place to its :is() form
 * - `button[data-testid="..."]` - Standard CSS selector (returned as-is)
 *
 * @param reftarget - The selector string from data-reftarget attribute
 * @returns Resolved CSS selector string
 *
 * @example
 * // Grafana selector — one value resolved for the running Grafana version,
 * // mirrored onto both attributes
 * resolveSelector('grafana:components.RefreshPicker.runButtonV2')
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
  return resolveSelectorForVersion(reftarget, config.buildInfo.version || 'latest', (message, error) =>
    logger.error(message, { error })
  );
}
