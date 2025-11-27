/**
 * Dev mode utility for per-user developer features
 *
 * SECURITY: Hybrid approach for maximum security with per-user scoping
 *
 * Storage: Plugin jsonData (server-side, admin-controlled, cannot be manipulated via browser)
 * Scoping: User ID check (only the user who enabled it sees dev features)
 *
 * Benefits:
 * - Server-side storage in Grafana's database (tamper-proof)
 * - Only admins can modify plugin settings
 * - Per-user functionality (other users don't see dev mode even if enabled)
 * - Synchronous checks (no async complexity)
 * - Persists across sessions and page reloads
 *
 * Architecture:
 * - devMode: boolean - Whether dev mode is enabled for the instance
 * - devModeUserId: number - User ID who enabled it (only they see dev features)
 *
 * USAGE:
 * - isDevModeEnabled(config, currentUserId) - Check if dev mode enabled for this user
 * - enableDevMode(currentUserId) - Enable dev mode for a specific user
 * - disableDevMode() - Disable dev mode entirely
 */

import { config } from '@grafana/runtime';
import { DocsPluginConfig } from '../../constants';
import { updatePluginSettings } from '../../utils/utils.plugin';
import pluginJson from '../../plugin.json';

/**
 * Check if dev mode is enabled for the current user (synchronous)
 *
 * SECURITY: Checks both that dev mode is enabled AND user ID is in the allowed list
 * This allows multiple developers to have access while preventing unauthorized users
 *
 * @param config - Plugin configuration from jsonData
 * @param currentUserId - Current user's ID (optional, will auto-detect if not provided)
 * @returns true if dev mode is enabled for this specific user
 */
export const isDevModeEnabled = (pluginConfig: DocsPluginConfig, currentUserId?: number): boolean => {
  // Auto-detect current user if not provided
  const userId = currentUserId ?? config.bootData.user?.id;

  const devMode = pluginConfig.devMode ?? false;
  const devModeUserIds = pluginConfig.devModeUserIds ?? [];

  // Dev mode must be enabled AND user ID must be in the allowed list
  const result = devMode && userId !== undefined && devModeUserIds.includes(userId);

  return result;
};

/**
 * Enable dev mode for the current user
 *
 * SECURITY: Writes to plugin jsonData (server-side, requires admin permissions)
 * Adds user to the allowed list (doesn't remove other users)
 *
 * @param currentUserId - User ID to add to dev mode access list
 * @param currentUserIds - Current list of user IDs (to preserve existing users)
 */
export const enableDevMode = async (currentUserId: number, currentUserIds: number[] = []): Promise<void> => {
  try {
    // Add user to list if not already present
    const updatedUserIds = currentUserIds.includes(currentUserId) ? currentUserIds : [...currentUserIds, currentUserId];

    // Update plugin settings with dev mode enabled and updated user list
    await updatePluginSettings(pluginJson.id, {
      enabled: true,
      jsonData: {
        devMode: true,
        devModeUserIds: updatedUserIds,
      },
    });
  } catch (e: any) {
    console.error('Failed to enable dev mode:', e);
    throw new Error('Failed to enable dev mode. You may need admin permissions to modify plugin settings.');
  }
};

/**
 * Disable dev mode for a specific user
 *
 * SECURITY: Removes user from access list, disables entirely if last user
 *
 * @param userId - User ID to remove from dev mode access
 * @param currentUserIds - Current list of user IDs
 */
export const disableDevModeForUser = async (userId: number, currentUserIds: number[] = []): Promise<void> => {
  try {
    // Remove user from list
    const updatedUserIds = currentUserIds.filter((id) => id !== userId);

    // If no users left, disable dev mode entirely
    const devMode = updatedUserIds.length > 0;

    await updatePluginSettings(pluginJson.id, {
      enabled: true,
      jsonData: {
        devMode,
        devModeUserIds: updatedUserIds,
      },
    });
  } catch (e: any) {
    console.error('Failed to disable dev mode for user:', e);
    throw new Error('Failed to disable dev mode. You may need admin permissions to modify plugin settings.');
  }
};

/**
 * Disable dev mode for all users
 *
 * SECURITY: Clears both flag and entire user list from server
 */
export const disableDevMode = async (): Promise<void> => {
  try {
    // Update plugin settings to disable dev mode entirely
    await updatePluginSettings(pluginJson.id, {
      enabled: true,
      jsonData: {
        devMode: false,
        devModeUserIds: [],
      },
    });
  } catch (e: any) {
    console.error('Failed to disable dev mode:', e);
    throw new Error('Failed to disable dev mode. You may need admin permissions to modify plugin settings.');
  }
};

/**
 * Toggle dev mode for the current user
 *
 * @param currentUserId - User ID to toggle dev mode for
 * @param currentState - Whether THIS user currently has dev mode enabled
 * @param currentUserIds - Current list of all users with dev mode access
 * @returns The new state of dev mode for THIS user
 */
export const toggleDevMode = async (
  currentUserId: number,
  currentState: boolean,
  currentUserIds: number[] = []
): Promise<boolean> => {
  const newValue = !currentState;

  if (newValue) {
    // Add user to the list
    await enableDevMode(currentUserId, currentUserIds);
  } else {
    // Remove user from the list
    await disableDevModeForUser(currentUserId, currentUserIds);
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
 * Prefer using isDevModeEnabled(config, userId) in React components
 *
 * @returns true if dev mode is enabled for current user, false otherwise
 */
export const isDevModeEnabledGlobal = (): boolean => {
  try {
    // Try to get plugin config from global window (set by components)
    const globalConfig = (window as any).__pathfinderPluginConfig as DocsPluginConfig | undefined;
    const userId = config.bootData.user?.id;

    if (!globalConfig) {
      // Plugin context not available yet - default to false (safest)
      return false;
    }

    return isDevModeEnabled(globalConfig, userId);
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
 * @param pluginConfig - Plugin configuration from jsonData
 * @param currentUserId - Current user's ID (optional, will auto-detect if not provided)
 * @returns true if assistant dev mode is enabled for this user
 */
export const isAssistantDevModeEnabled = (pluginConfig: DocsPluginConfig, currentUserId?: number): boolean => {
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
    const globalConfig = (window as any).__pathfinderPluginConfig as DocsPluginConfig | undefined;
    const userId = config.bootData.user?.id;

    if (!globalConfig) {
      return false;
    }

    return isAssistantDevModeEnabled(globalConfig, userId);
  } catch (e) {
    return false;
  }
};
