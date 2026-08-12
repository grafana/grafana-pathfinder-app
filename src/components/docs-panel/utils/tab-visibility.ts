/**
 * Pure utility for computing which tabs are visible vs overflowed
 * based on container width and active tab. Used by the tab bar to
 * drive visible tabs and overflow dropdown.
 */

import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { getGuideStripTabs } from './tab-kinds';

const TAB_SPACING = 4;
const MIN_TAB_WIDTH = 80;
const RESERVED_WIDTH = 130;

export interface TabVisibilityResult {
  visibleTabs: LearningJourneyTab[];
  overflowedTabs: LearningJourneyTab[];
}

/**
 * Computes which tabs fit in the visible area and which move to overflow.
 * Recommendations stays out of the guide-tab competition (left-rail icon);
 * remaining strip tabs share available width.
 */
export function computeTabVisibility(
  tabs: LearningJourneyTab[],
  containerWidth: number,
  activeTabId: string
): TabVisibilityResult {
  const guideTabs = getGuideStripTabs(tabs);
  const homeTabs = tabs.filter((tab) => tab.type === 'recommendations');

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
