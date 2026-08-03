/**
 * Tab taxonomy: singleton IDs and kind predicates for the docs panel.
 * Separate from `tab-visibility.ts` (layout/overflow math).
 */

import type { LearningJourneyTab } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';

/** Dev Tools singleton tab id (overflow menu → one closable strip tab). Contract surface. */
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
 * math must use this projection.
 */
export function getGuideStripTabs<T extends Pick<LearningJourneyTab, 'type'>>(tabs: T[]): T[] {
  return tabs.filter((tab) => tab.type !== 'recommendations');
}

/** Panel chrome / editor / Dev Tools: no content URL to fetch. */
export function isNonContentTab(tab: Pick<LearningJourneyTab, 'type'>): boolean {
  return NON_CONTENT_TAB_KINDS.has(tab.type);
}

/**
 * True when tabStorage restore won't clobber in-memory content tabs.
 * Not the same as an empty strip: the editor (and Dev Tools) are strip tabs
 * but still permit restore (they hold no fetched content).
 */
export function hasOnlyNonContentTabs(tabs: Array<Pick<LearningJourneyTab, 'type'>>): boolean {
  return tabs.every((t) => isNonContentTab(t));
}
