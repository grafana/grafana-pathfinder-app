/**
 * Tab taxonomy: singleton IDs and kind predicates for the docs panel.
 * Separate from `tab-visibility.ts` (layout/overflow math).
 */

import type { LearningJourneyTab, LearningJourneyTabType } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';

/** Dev Tools singleton (overflow menu; strip-excluded). Contract surface. */
export const DEVTOOLS_TAB_ID = 'devtools';

/**
 * IDs that carry singleton identity. Only these are reserved: every other kind
 * (editor included) is identified by `type` and may hold any unique ID.
 */
export const SINGLETON_TAB_IDS = new Set([RECOMMENDATIONS_TAB_ID, DEVTOOLS_TAB_ID]);

/** Strip-excluded chrome: recommendations (left rail) and Dev Tools (overflow). */
export const GUIDE_STRIP_EXCLUDED_TAB_TYPES = new Set<LearningJourneyTabType>(['recommendations', 'devtools']);

/**
 * Tabs that claim a guide-strip slot (rendered, closable, focusable).
 *
 * Raw `tabs` is wider than the strip: excluded chrome stays in state for
 * routing/content. Close adjacency, strip rendering, and overflow math must
 * use this projection — otherwise focus can land on a tab with no active marker.
 */
export function getGuideStripTabs<T extends Pick<LearningJourneyTab, 'type'>>(tabs: T[]): T[] {
  return tabs.filter((tab) => !GUIDE_STRIP_EXCLUDED_TAB_TYPES.has(tab.type));
}

/** Panel chrome / editor: no content URL to fetch. */
export function isNonContentTab(tab: Pick<LearningJourneyTab, 'type'>): boolean {
  return GUIDE_STRIP_EXCLUDED_TAB_TYPES.has(tab.type) || tab.type === 'editor';
}

/**
 * True when tabStorage restore won't clobber in-memory content tabs.
 * Not the same as an empty strip: the editor is a strip tab but still
 * permits restore (it holds no fetched content).
 */
export function hasOnlyNonContentTabs(tabs: Array<Pick<LearningJourneyTab, 'type'>>): boolean {
  return tabs.every((t) => isNonContentTab(t));
}
