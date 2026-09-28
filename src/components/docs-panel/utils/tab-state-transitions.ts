import type { LearningJourneyTab, PersistedTabData } from '../../../types/content-panel.types';
import type { TabGates } from './tab-gates';
import { getGuideStripTabs, RECOMMENDATIONS_TAB_ID } from './tab-kinds';

export interface TabStateSnapshot {
  tabs: LearningJourneyTab[];
  activeTabId: string;
}

export interface TabStateResult extends TabStateSnapshot {
  changed: boolean;
}

/**
 * Remove a tab and decide which tab takes focus.
 *
 * Unclosable chrome is a kind rule (type), not an identity check. Closing a
 * background tab must not move focus — the user may be sitting on another tab
 * and closing a guide from the overflow menu.
 *
 * Adjacency walks the rendered strip, not raw tab state: the recommendations
 * rail holds no strip slot, so handing it focus would leave no visible tab
 * marked active. A tab outside the strip closed via Ctrl+W has no neighbours
 * of its own, so it inherits the last strip tab instead of sending the user
 * home. Recommendations is the empty-strip fallback.
 */
export function closeTabState(state: TabStateSnapshot, tabId: string): TabStateResult {
  const closing = state.tabs.find((tab) => tab.id === tabId);
  if (!closing || closing.type === 'recommendations') {
    return { ...state, changed: false };
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);
  if (state.activeTabId !== tabId) {
    return { tabs, activeTabId: state.activeTabId, changed: true };
  }

  const stripTabs = getGuideStripTabs(state.tabs);
  const closedIndex = stripTabs.findIndex((tab) => tab.id === tabId);
  const replacement =
    closedIndex === -1 ? stripTabs[stripTabs.length - 1] : (stripTabs[closedIndex + 1] ?? stripTabs[closedIndex - 1]);

  return {
    tabs,
    activeTabId: replacement?.id ?? RECOMMENDATIONS_TAB_ID,
    changed: true,
  };
}

export function pruneGatedTabState(
  state: TabStateSnapshot,
  gates: Pick<TabGates, 'allowEditor' | 'allowDevTools'>
): TabStateResult {
  const tabs = state.tabs.filter((tab) => {
    if (tab.type === 'editor' && !gates.allowEditor) {
      return false;
    }
    if (tab.type === 'devtools' && !gates.allowDevTools) {
      return false;
    }
    return true;
  });

  if (tabs.length === state.tabs.length) {
    return { ...state, changed: false };
  }

  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : RECOMMENDATIONS_TAB_ID;
  return { tabs, activeTabId, changed: true };
}

/** Recommendations home is always present, so it is never persisted. */
export function projectPersistedTabs(tabs: LearningJourneyTab[]): PersistedTabData[] {
  return tabs
    .filter((tab) => tab.type !== 'recommendations')
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      baseUrl: tab.baseUrl,
      currentUrl: tab.currentUrl,
      type: tab.type,
      packageInfo: tab.packageInfo,
    }));
}
