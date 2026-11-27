import { locationService } from '@grafana/runtime';
import { isJourneyCoverPage } from '../../docs-retrieval';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { parsePathfinderDeepLink } from '../../utils/pathfinder-search-params';
import type { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { resolveCourseReturnPath } from './resolve-safe-target-path';

function returnToLearning() {
  const returnPath = resolveCourseReturnPath(panelModeManager.consumePriorPath());
  panelModeManager.setMode('sidebar');
  sidebarState.setIsSidebarMounted(false);
  locationService.push(returnPath);
}

export async function navigateToCourseOverview(
  panel: Pick<CombinedLearningJourneyPanel, 'getActiveTab' | 'loadTab'>,
  tabId: string,
  overviewUrl?: string
): Promise<void> {
  if (!overviewUrl) {
    returnToLearning();
    return;
  }

  const startingLocation = locationService.getLocation();
  const previousContent = panel.getActiveTab()?.content;
  let loadFailed = false;
  try {
    await panel.loadTab(tabId, overviewUrl, { rejectOnError: true });
  } catch {
    loadFailed = true;
  }

  const activeTab = panel.getActiveTab();
  if (locationService.getLocation() !== startingLocation || activeTab?.id !== tabId) {
    return;
  }
  if (!loadFailed && activeTab.content === previousContent) {
    return;
  }
  if (loadFailed || !activeTab.content || !isJourneyCoverPage(activeTab.content)) {
    returnToLearning();
    return;
  }

  const { doc, type } = parsePathfinderDeepLink(startingLocation.search);
  if (doc !== overviewUrl || type !== 'learning-journey') {
    locationService.partial({ doc: overviewUrl, type: 'learning-journey' }, true);
  }
}
