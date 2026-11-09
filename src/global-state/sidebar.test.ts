import { sidebarState } from './sidebar';
import { EXTENSION_SIDEBAR_DOCKED_KEY } from '../lib/storage/extension-sidebar';
import { reportAppInteraction } from '../lib/analytics';
import { panelModeManager } from './panel-mode';
import { getPanelSessionId, getPathfinderSurface, reportPathfinderSurface } from '../lib/telemetry/surface';

const mockPublish = jest.fn();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => ({ publish: mockPublish }) }));
jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DocsPanelInteraction: 'docs_panel_interaction' },
}));
jest.mock('./panel-mode', () => ({ panelModeManager: { getMode: jest.fn(() => 'sidebar') } }));
jest.mock('./auto-launch', () => ({ autoLaunchChannel: {} }));

afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  mockPublish.mockReset();
});

it('clears persisted docking after requesting close so reload cannot restore the panel', () => {
  mockPublish.mockImplementation(() => {
    localStorage.setItem(EXTENSION_SIDEBAR_DOCKED_KEY, 'docked');
  });
  localStorage.setItem('unrelated', 'keep');
  sidebarState.requestCloseSidebar();
  expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
  expect(localStorage.getItem(EXTENSION_SIDEBAR_DOCKED_KEY)).toBeNull();
  expect(localStorage.getItem('unrelated')).toBe('keep');
});

it('still requests close when storage is unavailable', () => {
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  expect(() => sidebarState.requestCloseSidebar()).not.toThrow();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('openSidebar reports the sidebar right away so a dock keeps the session', async () => {
  reportPathfinderSurface('floating');
  const sessionId = getPanelSessionId();
  reportPathfinderSurface('closed');

  sidebarState.openSidebar('Interactive learning');
  await Promise.resolve();

  expect(getPathfinderSurface()).toBe('sidebar');
  expect(getPanelSessionId()).toBe(sessionId);
});

describe('closeSidebar', () => {
  const mockReportAppInteraction = reportAppInteraction as jest.Mock;
  const mockGetMode = panelModeManager.getMode as jest.Mock;

  beforeEach(() => {
    mockReportAppInteraction.mockReset();
    mockGetMode.mockReturnValue('sidebar');
    reportPathfinderSurface('closed');
  });

  it('emits the close event inside the session it ends, then closes the session', () => {
    reportPathfinderSurface('sidebar');
    const sessionId = getPanelSessionId();
    let idAtCloseEvent: string | null = null;
    mockReportAppInteraction.mockImplementation(() => {
      idAtCloseEvent = getPanelSessionId();
    });
    sidebarState.setIsSidebarMounted(true);

    sidebarState.closeSidebar();

    expect(mockReportAppInteraction).toHaveBeenCalledWith('docs_panel_interaction', {
      action: 'close',
      source: 'sidebar_toggle',
    });
    expect(idAtCloseEvent).toBe(sessionId);
    expect(sessionId).not.toBeNull();
    expect(getPathfinderSurface()).toBe('closed');
    expect(getPanelSessionId()).toBeNull();
    expect(sidebarState.getIsSidebarMounted()).toBe(false);
  });

  it('leaves the incoming surface and its session alone during a handoff', () => {
    reportPathfinderSurface('sidebar');
    const sessionId = getPanelSessionId();
    mockGetMode.mockReturnValue('floating');
    reportPathfinderSurface('floating');
    sidebarState.setIsSidebarMounted(true);

    sidebarState.closeSidebar();

    expect(getPathfinderSurface()).toBe('floating');
    expect(getPanelSessionId()).toBe(sessionId);
    expect(sidebarState.getIsSidebarMounted()).toBe(true);
  });
});
