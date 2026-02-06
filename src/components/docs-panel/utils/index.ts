/**
 * Utility exports for docs-panel.
 */

export { isDocsLikeTab } from './tab-validation';
export { getTranslatedTitle } from './tab-translations';
export { computeTabVisibility } from './tab-visibility';
export type { TabVisibilityResult } from './tab-visibility';
export { restoreTabsFromStorage, restoreActiveTabFromStorage, createUrlValidator } from './tab-storage-restore';
export type { UrlValidator, TabRestoreOptions } from './tab-storage-restore';
