/**
 * Tab taxonomy: singleton IDs and kind predicates for the docs panel.
 * Separate from `tab-visibility.ts` (layout/overflow math).
 */

import type { LearningJourneyTab, LearningJourneyTabType } from '../../../types/content-panel.types';

/** Recommendations home (left-rail icon). Contract surface — do not rename. */
export const RECOMMENDATIONS_TAB_ID = 'recommendations';

/** Dev Tools singleton tab id (overflow menu → one closable strip tab). Contract surface. */
export const DEVTOOLS_TAB_ID = 'devtools';

/** Guide editor singleton (strip-included, no URL fetch). Contract surface. */
export const EDITOR_TAB_ID = 'editor';

/** Kinds with no content URL to fetch: panel chrome, the editor, and Dev Tools. */
export const NON_CONTENT_TAB_TYPES = new Set<LearningJourneyTabType>(['recommendations', 'devtools', 'editor']);

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
  return NON_CONTENT_TAB_TYPES.has(tab.type);
}

/**
 * True when tabStorage restore won't clobber in-memory content tabs.
 * Not the same as an empty strip: the editor (and Dev Tools) are strip tabs
 * but still permit restore (they hold no fetched content).
 */
export function hasOnlyNonContentTabs(tabs: Array<Pick<LearningJourneyTab, 'type'>>): boolean {
  return tabs.every((t) => isNonContentTab(t));
}
