/**
 * Action Type Configuration
 * DEPRECATED: Use actionRegistry.ts instead
 * Kept for backward compatibility - delegates to unified registry
 */

import type { BaseInteractiveFormConfig } from './BaseInteractiveForm';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { getActionFormConfig } from './actionRegistry';

/**
 * Lazy-initialized registry of all action configurations
 * Lazily initialized to avoid circular dependency with actionRegistry.ts
 * @deprecated Use getActionFormConfig() from actionRegistry.ts instead
 */
let _actionConfigsCache: Record<string, BaseInteractiveFormConfig> | null = null;

function getActionConfigs(): Record<string, BaseInteractiveFormConfig> {
  if (!_actionConfigsCache) {
    // Delegate to unified registry for backward compatibility
    _actionConfigsCache = {
      [ACTION_TYPES.BUTTON]: getActionFormConfig(ACTION_TYPES.BUTTON)!,
      [ACTION_TYPES.HIGHLIGHT]: getActionFormConfig(ACTION_TYPES.HIGHLIGHT)!,
      [ACTION_TYPES.FORM_FILL]: getActionFormConfig(ACTION_TYPES.FORM_FILL)!,
      [ACTION_TYPES.NAVIGATE]: getActionFormConfig(ACTION_TYPES.NAVIGATE)!,
      [ACTION_TYPES.HOVER]: getActionFormConfig(ACTION_TYPES.HOVER)!,
      [ACTION_TYPES.MULTISTEP]: getActionFormConfig(ACTION_TYPES.MULTISTEP)!,
      [ACTION_TYPES.SEQUENCE]: getActionFormConfig(ACTION_TYPES.SEQUENCE)!,
    };
  }
  return _actionConfigsCache;
}

/**
 * Complete registry of all action configurations
 * Lazily initialized getter to avoid circular dependency
 * @deprecated Use getActionFormConfig() from actionRegistry.ts instead
 */
export const ACTION_CONFIGS: Record<string, BaseInteractiveFormConfig> = new Proxy(
  {} as Record<string, BaseInteractiveFormConfig>,
  {
    get(_target, prop: string) {
      return getActionConfigs()[prop];
    },
    ownKeys() {
      return Object.keys(getActionConfigs());
    },
    has(_target, prop: string) {
      return prop in getActionConfigs();
    },
    getOwnPropertyDescriptor(_target, prop: string) {
      const configs = getActionConfigs();
      if (prop in configs) {
        return {
          enumerable: true,
          configurable: true,
          value: configs[prop],
        };
      }
      return undefined;
    },
  }
);

/**
 * Get action configuration by type
 * @deprecated Use getActionFormConfig() from actionRegistry.ts instead
 */
export function getActionConfig(actionType: string): BaseInteractiveFormConfig | undefined {
  return getActionFormConfig(actionType);
}
