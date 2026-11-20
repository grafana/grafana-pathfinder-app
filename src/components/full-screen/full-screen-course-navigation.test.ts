import { locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL } from '../../constants';
import { panelModeManager } from '../../global-state/panel-mode';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { navigateToCourseOverview } from './full-screen-course-navigation';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getAppEvents: () => ({ publish: jest.fn() }),
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
