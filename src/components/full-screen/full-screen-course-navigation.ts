import { locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { isJourneyCoverPage, resolveActiveMilestoneSequence } from '../../docs-retrieval';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import type { ReaderPosition } from '../../types/cross-tab.types';
import { findDocPage } from '../../utils/find-doc-page';
import { buildPathfinderShareUrl, parsePathfinderDeepLink } from '../../utils/pathfinder-search-params';
import type { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { resolveCourseReturnPath } from './resolve-safe-target-path';

function returnToLearning() {
  const returnPath = resolveCourseReturnPath(panelModeManager.consumePriorPath());
  panelModeManager.setMode('sidebar');
  sidebarState.setIsSidebarMounted(false);
  locationService.push(returnPath);
}

export function getCourseLessonPosition(tab: LearningJourneyTab, courseUrl: string): ReaderPosition | undefined {
  if (!tab.content) {
    return undefined;
  }
  const trackId = tab.activeTrackId ?? undefined;
  const sequence = resolveActiveMilestoneSequence(tab.content, trackId, tab.activeTrackMilestones);
  const lesson = sequence?.milestones.find((item) => item.number === sequence.currentMilestone && !item.isLocked);
  return lesson?.url ? { doc: courseUrl, milestoneUrl: lesson.url, trackId } : undefined;
}

export function getCourseOverviewUrl(tab?: LearningJourneyTab | null): string | undefined {
  const content = tab?.content;
  if (!content || isJourneyCoverPage(content)) {
    return undefined;
  }
  const overview = content.metadata.learningJourney?.baseUrl || content.metadata.trackMemberBaseUrl;
  return overview !== content.url && overview !== (tab.currentUrl || tab.baseUrl) ? overview : undefined;
}

export function syncFullScreenCourseLocation(tab: LearningJourneyTab | null): void {
  if (!tab?.content || tab.isLoading || tab.error) {
    return;
  }
  const isCoverPage = isJourneyCoverPage(tab.content);
  const courseUrl = isCoverPage ? tab.content.metadata.learningJourney?.baseUrl : getCourseOverviewUrl(tab);
  if (!courseUrl) {
    return;
  }

  const { doc, readerLesson } = parsePathfinderDeepLink(locationService.getLocation().search);
  if (!doc || (doc !== courseUrl && doc !== tab.currentUrl && findDocPage(doc)?.url !== courseUrl)) {
    return;
  }
  const position = isCoverPage ? undefined : getCourseLessonPosition(tab, courseUrl);
  if (position || (isCoverPage && readerLesson)) {
    replaceFullScreenCourseLocation(courseUrl, position);
  }
}

function replaceFullScreenCourseLocation(doc: string, position?: ReaderPosition): void {
  const location = locationService.getLocation();
  if (location.pathname !== `${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`) {
    return;
  }

  const current = parsePathfinderDeepLink(location.search);
  const lessonUrl = position?.milestoneUrl;
  const trackId = position?.trackId;
  if (
    current.doc === doc &&
    current.type === 'learning-journey' &&
    current.readerLesson === lessonUrl &&
    current.readerTrack === trackId
  ) {
    return;
  }

  const base = new URL(window.location.origin);
  base.search = location.search;
  const url = new URL(buildPathfinderShareUrl({ base, doc, guideType: 'learning-journey', lessonUrl, trackId }));
  locationService.replace({ ...location, search: url.search });
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

  replaceFullScreenCourseLocation(overviewUrl);
}
