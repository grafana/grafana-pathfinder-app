/**
 * Tab storage restore module
 *
 * Extracts the logic of restoring tabs from storage with security validation.
 * This module handles URL validation to prevent XSS attacks via storage injection.
 *
 * SECURITY: All URLs are validated against allowed hosts before restoration.
 * Dev mode allows localhost and GitHub raw URLs for development/testing.
 */

import { LearningJourneyTab, PersistedTabData } from '../../../types/content-panel.types';
import { isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from '../../../security';

/**
 * Tab storage interface for dependency injection
 * Matches the interface of the tabStorage object from user-storage.ts
 */
export interface TabStorage {
  getTabs<T>(): Promise<T[]>;
  setTabs<T>(tabs: T[]): Promise<void>;
  getActiveTab(): Promise<string | null>;
  setActiveTab(tabId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * URL validator function type
 * Used for dependency injection to make the module testable
 */
export type UrlValidator = (url: string) => boolean;

/**
 * Options for tab restoration
 */
export interface TabRestoreOptions {
  /** Enable dev mode URL validation (allows localhost and GitHub raw URLs) */
  isDevMode: boolean;
}

/**
 * Create a URL validator function based on dev mode setting
 *
 * @param isDevMode - Whether dev mode is enabled
 * @returns URL validator function
 */
export function createUrlValidator(isDevMode: boolean): UrlValidator {
  return (url: string): boolean => {
    return isAllowedContentUrl(url) || (isDevMode && isLocalhostUrl(url)) || (isDevMode && isGitHubRawUrl(url));
  };
}

/**
 * Restore tabs from storage with security validation
 *
 * SECURITY: All URLs are validated before restoration to prevent XSS via storage injection
 *
 * @param tabStorage - Storage interface for persisted tabs
 * @param options - Restore options including dev mode flag
 * @returns Promise resolving to array of restored tabs (always includes recommendations tab)
 */
export async function restoreTabsFromStorage(
  tabStorage: TabStorage,
  options: TabRestoreOptions
): Promise<LearningJourneyTab[]> {
  try {
    const parsedData = await tabStorage.getTabs<PersistedTabData>();

    if (!parsedData || parsedData.length === 0) {
      // Return default tabs if no stored data
      return [
        {
          id: 'recommendations',
          title: 'Recommendations',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
        },
      ];
    }

    const tabs: LearningJourneyTab[] = [
      {
        id: 'recommendations',
        title: 'Recommendations', // Will be translated in renderer
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
      },
    ];

    const validateUrl = createUrlValidator(options.isDevMode);

    parsedData.forEach((data: PersistedTabData) => {
      // Handle devtools tab specially - it has no URLs to validate
      if (data.type === 'devtools') {
        tabs.push({
          id: 'devtools',
          title: 'Dev Tools',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: 'devtools',
        });
        return;
      }

      // SECURITY: Validate URLs before restoring from storage
      // This prevents XSS attacks via storage injection
      const isValidBase = validateUrl(data.baseUrl);
      const isValidCurrent = !data.currentUrl || validateUrl(data.currentUrl);

      if (!isValidBase || !isValidCurrent) {
        console.warn('Rejected potentially unsafe URL from storage:', {
          baseUrl: data.baseUrl,
          currentUrl: data.currentUrl,
          isValidBase,
          isValidCurrent,
        });
        return; // Skip this tab
      }

      tabs.push({
        id: data.id,
        title: data.title,
        baseUrl: data.baseUrl,
        currentUrl: data.currentUrl || data.baseUrl,
        content: null, // Will be loaded when tab becomes active
        isLoading: false,
        error: null,
        type: data.type || 'learning-journey',
      });
    });

    return tabs;
  } catch (error) {
    console.error('Failed to restore tabs from storage:', error);
    return [
      {
        id: 'recommendations',
        title: 'Recommendations',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
      },
    ];
  }
}

/**
 * Restore active tab ID from storage
 *
 * @param tabStorage - Storage interface for persisted tabs
 * @param tabs - Array of restored tabs to validate against
 * @returns Promise resolving to active tab ID (defaults to 'recommendations' if not found)
 */
export async function restoreActiveTabFromStorage(tabStorage: TabStorage, tabs: LearningJourneyTab[]): Promise<string> {
  try {
    const activeTabId = await tabStorage.getActiveTab();

    if (activeTabId) {
      const tabExists = tabs.some((t) => t.id === activeTabId);

      // Restore the stored tab if it exists (including devtools - it should persist like normal tabs)
      // The closeTab method ensures that when all tabs are closed, 'recommendations' is saved to storage
      // So if storage has 'devtools', it means the user was legitimately on devtools when they refreshed
      return tabExists ? activeTabId : 'recommendations';
    }
  } catch (error) {
    console.error('Failed to restore active tab from storage:', error);
  }

  return 'recommendations';
}
