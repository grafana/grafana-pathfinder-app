import type { LearningJourneyTab, PackageOpenInfo, PersistedTabData } from '../../../types/content-panel.types';
import { getManifestTracks } from '../../../types/package.types';
import type { TabGates } from './tab-gates';
import { getGuideStripTabs, RECOMMENDATIONS_TAB_ID } from './tab-kinds';

export interface TabStateSnapshot {
  tabs: LearningJourneyTab[];
  activeTabId: string;
}

export interface TabStateResult extends TabStateSnapshot {
  changed: boolean;
}

// Close adjacency follows the guide strip rather than permanent navigation.
export function closeTabState(state: TabStateSnapshot, tabId: string): TabStateResult {
  const closing = state.tabs.find((tab) => tab.id === tabId);
  if (!closing || closing.type === 'recommendations' || closing.type === 'browse') {
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

export function pruneGatedTabState(state: TabStateSnapshot, gates: TabGates): TabStateResult {
  const tabs = state.tabs.filter((tab) => {
    if (tab.type === 'browse' && !gates.allowBrowse) {
      return false;
    }
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

/** A track's resolved guides are re-derived (see `restoredTrackGuideIds`), so they stay out of storage. */
function persistedPackageInfo(packageInfo: PackageOpenInfo | undefined): PackageOpenInfo | undefined {
  if (!packageInfo?.trackMilestones) {
    return packageInfo;
  }
  const { trackMilestones: _trackMilestones, ...persisted } = packageInfo;
  return persisted;
}

export function projectPersistedTabs(tabs: LearningJourneyTab[]): PersistedTabData[] {
  return tabs
    .filter((tab) => tab.type !== 'recommendations' && tab.type !== 'browse')
    .map((tab) => ({
      id: tab.id,
      title: tab.title,
      baseUrl: tab.baseUrl,
      currentUrl: tab.currentUrl,
      type: tab.type,
      packageInfo: persistedPackageInfo(tab.packageInfo),
      ...(tab.activeTrackId && { activeTrackId: tab.activeTrackId, activeTrackPathId: tab.activeTrackPathId }),
    }));
}

/**
 * The guide ids to resolve back into `activeTrackMilestones` for a restored tab, from the path manifest it was
 * opened with. Without them a track member reached without its cover, such as a hub jump, navigates Foundations.
 */
export function restoredTrackGuideIds(tab: LearningJourneyTab): string[] | undefined {
  if (!tab.activeTrackId || tab.activeTrackMilestones) {
    return undefined;
  }
  const manifest = tab.packageInfo?.packageManifest;
  const pathId = typeof manifest?.id === 'string' ? manifest.id : tab.packageInfo?.packageId;
  if (!pathId || tab.activeTrackPathId !== pathId) {
    return undefined;
  }
  return getManifestTracks(manifest).find((track) => track.trackId === tab.activeTrackId)?.guides;
}
