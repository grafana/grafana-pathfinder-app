import { locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL } from '../../constants';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { StorageKeys } from '../../lib/storage-keys';
import { dockOnLeavingFullScreen, type HistoryAction } from './full-screen-autodock';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { navigateToCourseOverview } from './full-screen-course-navigation';

const mockPublish = jest.fn();

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getAppEvents: () => ({ publish: mockPublish }),
}));

const overviewUrl = 'backend-guide:foundations';
const moduleUrl = 'backend-guide:first-dashboard';
const entry = `${PLUGIN_BASE_URL}/fullscreen?doc=${encodeURIComponent(moduleUrl)}&type=docs&orgId=7`;
const catalog = `${PLUGIN_BASE_URL}/browse?topic=metrics&view=all`;
const moduleTab: LearningJourneyTab = {
  id: 'tab',
  title: 'Build a dashboard',
  baseUrl: moduleUrl,
  currentUrl: moduleUrl,
  type: 'docs',
  error: null,
  isLoading: false,
  content: {
    type: 'interactive',
    url: moduleUrl,
    content: '{}',
    lastFetched: '',
    metadata: { title: 'Build a dashboard', trackMemberBaseUrl: overviewUrl },
  },
};

beforeEach(() => {
  locationService.replace(entry);
  panelModeManager.consumePriorPath();
});

afterEach(() => {
  panelModeManager.consumePriorPath();
  panelModeManager.endTransientSession();
  localStorage.removeItem(StorageKeys.PANEL_MODE);
  sidebarState.setIsSidebarMounted(false);
});

it('keeps the overview URL in the same history entry after successfully loading it', async () => {
  const panel = {
    getActiveTab: jest.fn().mockReturnValue(moduleTab),
    loadTab: jest.fn(async () => {
      panel.getActiveTab.mockReturnValue({
        ...moduleTab,
        currentUrl: overviewUrl,
        content: {
          ...moduleTab.content,
          type: 'learning-journey',
          url: overviewUrl,
          metadata: {
            title: 'Grafana Foundations',
            learningJourney: { baseUrl: overviewUrl, currentMilestone: 0, totalMilestones: 1, milestones: [] },
          },
        },
      });
    }),
  };
  const history = locationService.getHistory();
  const initialLength = history.length;

  await navigateToCourseOverview(panel, moduleTab.id, overviewUrl);

  expect(panel.loadTab).toHaveBeenCalledWith(moduleTab.id, overviewUrl, { rejectOnError: true });
  expect(history.action).toBe('REPLACE');
  expect(history.length).toBe(initialLength);
  expect(locationService.getSearch().get('doc')).toBe(overviewUrl);
  expect(locationService.getSearch().get('type')).toBe('learning-journey');
  expect(locationService.getSearch().get('orgId')).toBe('7');
});

it('returns to Explore with its filters if the overview request fails', async () => {
  panelModeManager.capturePriorPath(catalog);
  const panel = {
    getActiveTab: () => moduleTab,
    loadTab: jest.fn().mockRejectedValue(new Error('Overview unavailable')),
  };

  await navigateToCourseOverview(panel, moduleTab.id, overviewUrl);

  const { pathname, search } = locationService.getLocation();
  expect(pathname + search).toBe(catalog);
});

it('returns a direct visitor to My Learning when no distinct overview is available', async () => {
  const panel = { getActiveTab: () => moduleTab, loadTab: jest.fn() };

  await navigateToCourseOverview(panel, moduleTab.id);

  expect(panel.loadTab).not.toHaveBeenCalled();
  expect(locationService.getLocation().pathname).toBe(PLUGIN_BASE_URL);
});

it('keeps the new location when an earlier overview request fails after leaving the reader', async () => {
  const panel = {
    getActiveTab: () => moduleTab,
    loadTab: jest.fn(async () => {
      locationService.push('/dashboards');
      throw new Error('Overview unavailable');
    }),
  };

  await navigateToCourseOverview(panel, moduleTab.id, overviewUrl);

  expect(locationService.getLocation().pathname).toBe('/dashboards');
});

it.each(
  [false, true].flatMap((automatic) => [PLUGIN_BASE_URL, catalog].map((returnPath) => ({ automatic, returnPath })))
)(
  'can open the sidebar after course Back to $returnPath with a fullscreen preference (automatic: $automatic)',
  async ({ automatic, returnPath }) => {
    jest.useFakeTimers();
    panelModeManager.setModePersisted('fullscreen');
    if (automatic) {
      panelModeManager.setModeTransient('fullscreen');
    }
    panelModeManager.capturePriorPath(returnPath);
    sidebarState.setIsSidebarMounted(true);
    mockPublish.mockClear();
    const stopListening = locationService
      .getHistory()
      .listen((location: { pathname: string }, action: HistoryAction) => {
        dockOnLeavingFullScreen({
          pathname: location.pathname,
          fullScreenPathname: `${PLUGIN_BASE_URL}/fullscreen`,
          myPluginId: 'grafana-pathfinder-app',
          guideUrl: moduleUrl,
          title: moduleTab.title,
          action,
        });
      });
    try {
      await navigateToCourseOverview({ getActiveTab: () => moduleTab, loadTab: jest.fn() }, moduleTab.id);
      jest.runOnlyPendingTimers();
      const location = locationService.getLocation();
      expect(location.pathname + location.search).toBe(returnPath);
      expect(panelModeManager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe(automatic ? 'fullscreen' : 'sidebar');
      expect(sidebarState.getIsSidebarMounted()).toBe(false);
      expect(mockPublish).not.toHaveBeenCalled();

      sidebarState.openSidebar('Interactive learning');
      expect(sidebarState.getIsSidebarMounted()).toBe(true);
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-extension-sidebar' }));
    } finally {
      stopListening();
      jest.useRealTimers();
    }
  }
);
