/**
 * Tests for sidebar-auto-open — the config-driven auto-open extracted from the
 * retired experiment orchestrator. Covers setupConfigAutoOpen: opt-in gating,
 * sidebar-in-use guard, and the onboarding-flow deferral.
 */

jest.mock('../plugin.json', () => ({
  id: 'grafana-pathfinder-app',
}));

const mockPublish = jest.fn();
const mockGetLocation = jest.fn().mockReturnValue({ pathname: '/dashboards' });
const mockUnlisten = jest.fn();
const mockHistoryListen = jest.fn((_handler: () => void) => mockUnlisten);

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: mockPublish }),
  locationService: {
    getLocation: () => mockGetLocation(),
    getHistory: () => ({ listen: mockHistoryListen }),
  },
}));

const mockSetPendingOpenSource = jest.fn();
jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: (source: string, action: string) => mockSetPendingOpenSource(source, action),
  },
}));

const mockIsExtensionSidebarInUse = jest.fn().mockReturnValue(false);
jest.mock('../lib/storage/extension-sidebar', () => ({
  isExtensionSidebarInUse: () => mockIsExtensionSidebarInUse(),
}));

jest.mock('./openfeature', () => ({
  getFeatureFlagValue: jest.fn().mockReturnValue(false),
}));

import { setupConfigAutoOpen } from './sidebar-auto-open';

const ONBOARDING_PATH = '/a/grafana-setupguide-app/onboarding-flow';

describe('setupConfigAutoOpen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsExtensionSidebarInUse.mockReturnValue(false);
    mockGetLocation.mockReturnValue({ pathname: '/dashboards' });
    mockHistoryListen.mockReturnValue(mockUnlisten);
    delete (window as any).__pathfinderAutoOpenUnlisten;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens the sidebar when openPanelOnLaunch is set', () => {
    setupConfigAutoOpen({
      currentPath: '/dashboards',
      featureFlagEnabled: false,
      pluginConfig: { openPanelOnLaunch: true },
    });

    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('auto_open', 'auto-open');
    jest.runAllTimers();
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-extension-sidebar' }));
  });

  it('opens the sidebar when the auto-open feature flag is enabled', () => {
    setupConfigAutoOpen({ currentPath: '/dashboards', featureFlagEnabled: true, pluginConfig: {} });

    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('auto_open', 'auto-open');
    jest.runAllTimers();
    expect(mockPublish).toHaveBeenCalled();
  });

  it('is a no-op when neither the flag nor the config opt in', () => {
    setupConfigAutoOpen({
      currentPath: '/dashboards',
      featureFlagEnabled: false,
      pluginConfig: { openPanelOnLaunch: false },
    });

    jest.runAllTimers();
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not steal the sidebar when another plugin owns it', () => {
    mockIsExtensionSidebarInUse.mockReturnValue(true);

    setupConfigAutoOpen({ currentPath: '/dashboards', featureFlagEnabled: true, pluginConfig: {} });

    jest.runAllTimers();
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('defers on the onboarding flow and opens after navigating away', () => {
    setupConfigAutoOpen({ currentPath: ONBOARDING_PATH, featureFlagEnabled: true, pluginConfig: {} });

    // No immediate open; a nav listener is armed instead.
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
    expect(mockHistoryListen).toHaveBeenCalledTimes(1);

    // Simulate SPA navigation away from the onboarding flow.
    const handler = mockHistoryListen.mock.calls[0]![0];
    mockGetLocation.mockReturnValue({ pathname: '/dashboards' });
    handler();

    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('auto_open', 'auto-open');
    jest.runAllTimers();
    expect(mockPublish).toHaveBeenCalled();
  });
});
