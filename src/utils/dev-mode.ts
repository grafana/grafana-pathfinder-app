/**
 * Dev mode utility for per-user developer features
 *
 * TWO GATES, TWO STORES
 *
 * - Tenant gate (`devMode`): an admin-controlled flag in tenant settings — the
 *   `PathfinderSettings` App Platform resource, with the legacy plugin-jsonData
 *   value as a fallback. An admin can switch developer surfaces off for the whole
 *   stack.
 * - Per-user opt-in (`devModeOptIn`): this user's own choice, in Grafana per-user
 *   storage (see lib/dev-mode-opt-in.ts).
 *
 * Both must be true for a user to see developer features.
 *
 * WHY IT CHANGED
 *
 * This used to be `devMode` plus a `devModeUserIds` array, both in plugin
 * `jsonData`. That store is org-wide and provisioning-owned, and Grafana's write
 * replaces the whole document, so toggling dev mode rewrote every plugin setting
 * — which is how it once unpinned the plugin from the nav (`aa1c2efd`) — and a
 * Cloud instance restart reset the flag along with everything else. The opt-in
 * was already self-service (`enableDevMode` added the *calling* user), so moving
 * it to per-user storage changes no permission: it removes an org-wide write and
 * stops one user's preference being visible to every other user.
 *
 * The resolved config carries both flags, so every check here stays synchronous.
 */

import { config } from '@grafana/runtime';
import { PathfinderPluginConfig } from '../constants';
import { logger } from '../lib/logging';
import { readDevModeOptIn, writeDevModeOptIn } from '../lib/dev-mode-opt-in';

/**
 * Check if dev mode is enabled for the current user (synchronous)
 *
 * Requires both the tenant gate and this user's opt-in.
 *
 * @param pluginConfig - Resolved plugin configuration
 * @param _currentUserId - Unused. Kept so existing call sites compile; the
 *   per-user half of the decision is no longer keyed by user ID, because the
 *   opt-in now lives in that user's own storage rather than in a shared list.
 * @returns true if dev mode is enabled for this specific user
 */
export const isDevModeEnabled = (pluginConfig: PathfinderPluginConfig, _currentUserId?: number): boolean => {
  const tenantEnabled = pluginConfig.devMode ?? false;

  if (!tenantEnabled) {
    return false;
  }

  // Prefer the resolved value the config layer hydrated; fall back to a direct
  // read for callers holding a raw jsonData object that never went through it.
  return pluginConfig.devModeOptIn ?? readDevModeOptIn();
};

/**
 * Enable developer surfaces for the current user.
 *
 * Only records this user's opt-in — it cannot turn on the tenant gate, which is
 * an admin setting. If the gate is off, nothing becomes visible.
 */
export const enableDevMode = async (): Promise<void> => {
  try {
    await writeDevModeOptIn(true);
  } catch (e) {
    logger.error('Failed to enable dev mode', { error: e });
    throw new Error('Failed to enable dev mode.');
  }
};

/**
 * Disable developer surfaces for the current user.
 *
 * Affects only this user; other users keep their own opt-in, and the tenant gate
 * is untouched.
 */
export const disableDevMode = async (): Promise<void> => {
  try {
    await writeDevModeOptIn(false);
  } catch (e) {
    logger.error('Failed to disable dev mode', { error: e });
    throw new Error('Failed to disable dev mode.');
  }
};

/**
 * Toggle developer surfaces for the current user.
 *
 * @param currentState - Whether this user currently has dev mode on
 * @returns The new opt-in state for this user
 */
export const toggleDevMode = async (currentState: boolean): Promise<boolean> => {
  const newValue = !currentState;

  if (newValue) {
    await enableDevMode();
  } else {
    await disableDevMode();
  }

  return newValue;
};

/**
 * Simplified check for dev mode without needing to pass config/userId
 *
 * USAGE: For utility functions that need a quick check but don't have access to plugin context
 * This function attempts to read config from global state and check current user
 *
 * LIMITATION: May return false if called before plugin context is available
 * Prefer using isDevModeEnabled(config) in React components
 *
 * @returns true if dev mode is enabled for current user, false otherwise
 */
export const isDevModeEnabledGlobal = (): boolean => {
  try {
    // Try to get plugin config from global window (set by components)
    const globalConfig = (window as any).__pathfinderPluginConfig as PathfinderPluginConfig | undefined;

    if (!globalConfig) {
      // Plugin context not available yet - default to false (safest)
      return false;
    }

    return isDevModeEnabled(globalConfig);
  } catch (e) {
    return false;
  }
};

/**
 * Check if assistant dev mode is enabled for the current user
 *
 * This allows testing the assistant integration in OSS environments by mocking
 * the assistant availability and logging prompts instead of opening the real assistant.
 *
 * @param pluginConfig - Plugin configuration
 * @param currentUserId - Unused; see isDevModeEnabled
 * @returns true if assistant dev mode is enabled for this user
 */
export const isAssistantDevModeEnabled = (pluginConfig: PathfinderPluginConfig, currentUserId?: number): boolean => {
  // First check if regular dev mode is enabled for this user
  const devModeEnabled = isDevModeEnabled(pluginConfig, currentUserId);

  if (!devModeEnabled) {
    return false;
  }

  // Then check if assistant dev mode is specifically enabled
  return pluginConfig.enableAssistantDevMode ?? false;
};

/**
 * Global check for assistant dev mode (for use outside React components)
 *
 * @returns true if assistant dev mode is enabled for current user, false otherwise
 */
export const isAssistantDevModeEnabledGlobal = (): boolean => {
  try {
    const globalConfig = (window as any).__pathfinderPluginConfig as PathfinderPluginConfig | undefined;

    if (!globalConfig) {
      return false;
    }

    return isAssistantDevModeEnabled(globalConfig);
  } catch (e) {
    return false;
  }
};

/**
 * Resolve this user's dev-mode opt-in for the config layer to hydrate into the
 * published configuration, keeping every check above synchronous.
 */
export const resolveDevModeOptIn = (): boolean => readDevModeOptIn();

/**
 * Whether the signed-in user is the one a legacy `devModeUserIds` entry referred
 * to. Used once, at bootstrap, to carry a pre-migration opt-in forward so an
 * existing developer is not silently logged out of dev mode.
 */
export const hasLegacyDevModeOptIn = (pluginConfig: PathfinderPluginConfig): boolean => {
  const userId = config.bootData.user?.id;
  // The one intentional reader of the deprecated allow-list: this is the upgrade
  // path that retires it. Nothing writes it.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const legacyIds = pluginConfig.devModeUserIds;

  return Array.isArray(legacyIds) && userId !== undefined && legacyIds.includes(userId);
};
