/**
 * Pure utility for computing which tabs are visible vs overflowed
 * based on container width and active tab. Used by the tab bar to
 * drive visible tabs and overflow dropdown.
 */

import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { GUIDE_STRIP_EXCLUDED_TAB_IDS, RECOMMENDATIONS_TAB_ID } from './tab-kinds';

const TAB_SPACING = 4;
const MIN_TAB_WIDTH = 80;
const RESERVED_WIDTH = 130;

export interface TabVisibilityResult {
  visibleTabs: LearningJourneyTab[];
  overflowedTabs: LearningJourneyTab[];
}

/**
 * Computes which tabs fit in the visible area and which move to overflow.
 * Strip-excluded chrome stays out of the guide-tab competition; remaining
 * tabs share available width. Recommendations is prefixed into visibleTabs
 * for the rail (Dev Tools is strip-excluded and not shown there either).
 */
export function computeTabVisibility(
  tabs: LearningJourneyTab[],
  containerWidth: number,
  activeTabId: string
): TabVisibilityResult {
  const guideTabs = tabs.filter((t) => !GUIDE_STRIP_EXCLUDED_TAB_IDS.has(t.id));
  const homeTabs = tabs.filter((t) => t.id === RECOMMENDATIONS_TAB_ID);

  if (guideTabs.length === 0) {
    return { visibleTabs: tabs, overflowedTabs: [] };
  }

  if (containerWidth <= 0) {
    return { visibleTabs: tabs, overflowedTabs: [] };
  }

  const availableWidth = Math.max(0, containerWidth - RESERVED_WIDTH);

  let maxVisibleGuideTabs = 0;
  let widthUsed = 0;
  const tabWidth = MIN_TAB_WIDTH + TAB_SPACING;

  for (let i = 0; i < guideTabs.length; i++) {
    const spaceNeeded = widthUsed + tabWidth;
    if (spaceNeeded <= availableWidth) {
      maxVisibleGuideTabs++;
      widthUsed += tabWidth;
    } else {
      break;
    }
  }

  maxVisibleGuideTabs = Math.max(maxVisibleGuideTabs, Math.min(1, guideTabs.length));

  const activeGuideTabIndex = guideTabs.findIndex((t) => t.id === activeTabId);

  if (activeGuideTabIndex >= maxVisibleGuideTabs) {
    const visibleGuideTabsArray = [...guideTabs.slice(0, maxVisibleGuideTabs - 1), guideTabs[activeGuideTabIndex]!];
    const overflowGuideTabsArray = [
      ...guideTabs.slice(maxVisibleGuideTabs - 1, activeGuideTabIndex),
      ...guideTabs.slice(activeGuideTabIndex + 1),
    ];
    return {
      visibleTabs: [...homeTabs, ...visibleGuideTabsArray],
      overflowedTabs: overflowGuideTabsArray,
    };
  }

  return {
    visibleTabs: [...homeTabs, ...guideTabs.slice(0, maxVisibleGuideTabs)],
    overflowedTabs: guideTabs.slice(maxVisibleGuideTabs),
  };
}
