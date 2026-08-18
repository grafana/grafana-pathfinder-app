/**
 * Utility exports for docs-panel.
 */

export { isDocsLikeTab, shouldUseDocsLoader } from './tab-validation';
export { getTranslatedTitle } from './tab-translations';
export { computeTabVisibility } from './tab-visibility';
export type { TabVisibilityResult } from './tab-visibility';
export {
  RECOMMENDATIONS_TAB_ID,
  DEVTOOLS_TAB_ID,
  EDITOR_TAB_ID,
  getGuideStripTabs,
  isNonContentTab,
} from './tab-kinds';
export { isCurrentUserEditor, resolveTabGates, didGateClose } from './tab-gates';
export type { TabGates } from './tab-gates';
export {
  restoreTabsFromStorage,
  restoreActiveTabFromStorage,
  mergeRestoredTabsWithExisting,
  createUrlValidator,
} from './tab-storage-restore';
export type { UrlValidator, TabRestoreOptions } from './tab-storage-restore';
export { isGrafanaDocsUrl, cleanDocsUrl, isLearningJourneyUrl } from './url-validation';
export { loadDocsTabContentResult, UNRESOLVED_PACKAGE_ERROR } from './docs-tab-loader';
export { findCurrentMilestoneIndex } from './milestone-index';
export { pickGrafanaDocsOpenAction } from './grafana-docs-open-action';
export type { GrafanaDocsOpenAction } from './grafana-docs-open-action';
export { pickControllerTabOpenAction } from './controller-tab-open-action';
export type { ControllerTabOpenAction } from './controller-tab-open-action';
