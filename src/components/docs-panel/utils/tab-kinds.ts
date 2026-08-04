/**
 * Tab taxonomy: singleton IDs and kind predicates for the docs panel.
 * Separate from `tab-visibility.ts` (layout/overflow math).
 */

import type { LearningJourneyTab } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';

/** Dev Tools singleton (overflow menu). Contract surface. */
export const DEVTOOLS_TAB_ID = 'devtools';

/**
 * IDs that carry singleton identity. Only these are reserved: every other kind
 * (editor included) is identified by `type` and may hold any unique ID.
 */
export const SINGLETON_TAB_IDS = new Set([RECOMMENDATIONS_TAB_ID, DEVTOOLS_TAB_ID]);

export const NON_CONTENT_TAB_KINDS = new Set(['recommendations', 'devtools', 'editor']);

/**
 * Tabs that claim a guide-strip slot (rendered, closable, focusable).
 *
 * Recommendations stays in `tabs` for routing/content but uses the left-rail
 * icon instead of a strip slot. Close adjacency, strip rendering, and overflow
 * math must use this projection — otherwise focus can land on a tab with no
 * active marker.
 */
export function getGuideStripTabs<T extends Pick<LearningJourneyTab, 'type'>>(tabs: T[]): T[] {
  return tabs.filter((tab) => tab.type !== 'recommendations');
}

/** Panel chrome / editor / Dev Tools: no content URL to fetch. */
export function isNonContentTab(tab: Pick<LearningJourneyTab, 'type'>): boolean {
  return NON_CONTENT_TAB_KINDS.has(tab.type);
}
