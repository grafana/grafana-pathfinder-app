import type { LearningJourneyTab, LearningJourneyTabType } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';
export const BROWSE_TAB_ID = 'browse';

export function createBrowseTab(): LearningJourneyTab {
  return {
    id: BROWSE_TAB_ID,
    type: 'browse',
    title: 'Browse',
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
  };
}

/** Dev Tools singleton tab id (overflow menu → one closable strip tab). Contract surface. */
export const DEVTOOLS_TAB_ID = 'devtools';

/** Guide editor singleton (strip-included, no URL fetch). Contract surface. */
export const EDITOR_TAB_ID = 'editor';

/** Kinds with no content URL to fetch: panel chrome, the editor, and Dev Tools. */
export const NON_CONTENT_TAB_TYPES = new Set<LearningJourneyTabType>([
  'recommendations',
  'browse',
  'devtools',
  'editor',
]);

// Permanent navigation stays outside the closable guide strip.
export function getGuideStripTabs<T extends Pick<LearningJourneyTab, 'type'>>(tabs: T[]): T[] {
  return tabs.filter((tab) => tab.type !== 'recommendations' && tab.type !== 'browse');
}

export function isNonContentTab(tab: Pick<LearningJourneyTab, 'type'>): boolean {
  return NON_CONTENT_TAB_TYPES.has(tab.type);
}
