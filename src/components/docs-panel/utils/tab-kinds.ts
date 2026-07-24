/**
 * Tab taxonomy for the docs panel: singleton chrome ids, strip exclusion,
 * and “does this tab fetch URL content?” predicates.
 *
 * Kept separate from `tab-visibility.ts` (layout/overflow math) so callers
 * looking for “what kinds of tabs exist?” don’t land in width algorithms.
 */

import type { LearningJourneyTab } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';

/** Dev Tools singleton (overflow menu; strip-excluded). Contract surface. */
export const DEVTOOLS_TAB_ID = 'devtools';

/** Guide editor singleton (strip-included, no URL fetch). Contract surface. */
export const EDITOR_TAB_ID = 'editor';

/**
 * Panel views that stay out of the guide-tab strip: recommendations home
 * (left rail) and Dev Tools (overflow menu). They still exist in tab state
 * for routing/content; they just don't claim a strip slot.
 */
export const GUIDE_STRIP_EXCLUDED_TAB_IDS = new Set([RECOMMENDATIONS_TAB_ID, DEVTOOLS_TAB_ID]);

/**
 * True when the guide-tab strip has nothing open — only strip-excluded
 * chrome (recommendations home, optional Dev Tools) is present.
 */
export function hasNoGuideStripTabs(tabs: Array<{ id: string }>): boolean {
  return tabs.every((t) => GUIDE_STRIP_EXCLUDED_TAB_IDS.has(t.id));
}

/**
 * True when the tab renders panel chrome and has no content URL to fetch
 * (recommendations, Dev Tools, or the guide editor).
 */
export function isNonContentTab(tab: Pick<LearningJourneyTab, 'id' | 'type'>): boolean {
  return GUIDE_STRIP_EXCLUDED_TAB_IDS.has(tab.id) || tab.type === 'editor' || tab.id === EDITOR_TAB_ID;
}

/**
 * True when restoring from tabStorage won't clobber in-memory content tabs.
 * Editor may be open (navigable strip tab) and still allow restore — unlike
 * `hasNoGuideStripTabs`, which is for empty-strip UX (e.g. closeTab).
 */
export function hasOnlyNonContentTabs(tabs: Array<Pick<LearningJourneyTab, 'id' | 'type'>>): boolean {
  return tabs.every((t) => isNonContentTab(t));
}
