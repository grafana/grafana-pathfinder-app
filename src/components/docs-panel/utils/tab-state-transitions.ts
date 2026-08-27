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
