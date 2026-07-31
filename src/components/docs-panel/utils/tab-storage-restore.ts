/**
 * Tab storage restore module
 *
 * Extracts the logic of restoring tabs from storage with security validation.
 * This module handles URL validation to prevent XSS attacks via storage injection.
 *
 * SECURITY: All URLs are validated against allowed hosts before restoration.
 * Dev mode allows localhost and GitHub raw URLs for development/testing.
 */

import type { LearningJourneyTab, LearningJourneyTabType, PersistedTabData } from '../../../types/content-panel.types';
import { isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from '../../../security';
import { logger } from '../../../lib/logging';
import { DEVTOOLS_TAB_ID, RECOMMENDATIONS_TAB_ID, SINGLETON_TAB_IDS } from './tab-kinds';

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
 * Validate the persisted identity/kind pair before it enters runtime state.
 *
 * Runtime behavior dispatches on `type`; only the singleton chrome tabs also
 * pin an ID. Those ID/type pairs must agree in both directions so a malformed
 * record cannot acquire privileged singleton behavior. Every other kind —
 * editor included — is free to carry whatever unique ID it was persisted with.
 */
function getCanonicalPersistedTabType(data: PersistedTabData): LearningJourneyTabType | null {
  const type: unknown = data.type ?? 'learning-journey';

  if (type === 'recommendations') {
    return data.id === RECOMMENDATIONS_TAB_ID ? type : null;
  }
  if (type === 'devtools') {
    return data.id === DEVTOOLS_TAB_ID ? type : null;
  }
  if (SINGLETON_TAB_IDS.has(data.id)) {
    return null;
  }

  if (type === 'editor') {
    return type;
  }

  return type === 'learning-journey' || type === 'docs' || type === 'interactive' ? type : null;
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

    const recommendationsTab: LearningJourneyTab = {
      id: RECOMMENDATIONS_TAB_ID,
      type: 'recommendations',
      title: 'Recommendations', // Will be translated in renderer
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
    };

    if (!parsedData || parsedData.length === 0) {
      // Return recommendations home if no stored data
      return [recommendationsTab];
    }

    const tabs: LearningJourneyTab[] = [recommendationsTab];

    const validateUrl = createUrlValidator(options.isDevMode);

    parsedData.forEach((data: PersistedTabData) => {
      const type = getCanonicalPersistedTabType(data);
      if (!type) {
        logger.warn('Rejected tab with invalid persisted identity/type pairing', {
          id: data.id,
          type: data.type,
        });
        return;
      }

      // Recommendations is created canonically above and is never restored
      // from storage, avoiding duplicate home tabs.
      if (type === 'recommendations') {
        return;
      }

      // IDs are the panel's identity key: duplicates would collide on React
      // keys, and close-by-ID would remove more than one tab. Tampered or
      // legacy storage is the only way to get here, since saves map from state.
      if (tabs.some((t) => t.id === data.id)) {
        logger.warn('Rejected duplicate tab ID from storage', { id: data.id, type });
        return;
      }

      // Handle editor tabs specially - they have no URLs to validate.
      // Each editor tab keeps its persisted id so it re-attaches to its
      // per-tab draft in localStorage.
      if (type === 'editor') {
        tabs.push({
          id: data.id,
          title: data.title || 'New Guide',
          baseUrl: '',
          currentUrl: '',
          content: null,
          isLoading: false,
          error: null,
          type: 'editor',
        });
        return;
      }

      // Handle devtools tab specially - it has no URLs to validate
      if (type === 'devtools') {
        tabs.push({
          id: DEVTOOLS_TAB_ID,
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
        logger.warn('Rejected potentially unsafe URL from storage', {
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
        type,
        packageInfo: data.packageInfo,
      });
    });

    return tabs;
  } catch (error) {
    logger.error('Failed to restore tabs from storage', { error });
    return [
      {
        id: RECOMMENDATIONS_TAB_ID,
        type: 'recommendations',
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
 * @returns Promise resolving to active tab ID (defaults to recommendations if not found)
 */
export async function restoreActiveTabFromStorage(tabStorage: TabStorage, tabs: LearningJourneyTab[]): Promise<string> {
  try {
    const activeTabId = await tabStorage.getActiveTab();

    if (activeTabId) {
      const tabExists = tabs.some((t) => t.id === activeTabId);

      // Restore the stored tab if it exists (including Dev Tools — strip-excluded but persisted).
      // closeTab ensures recommendations is saved when the strip is empty.
      return tabExists ? activeTabId : RECOMMENDATIONS_TAB_ID;
    }
  } catch (error) {
    logger.error('Failed to restore active tab from storage', { error });
  }

  return RECOMMENDATIONS_TAB_ID;
}
