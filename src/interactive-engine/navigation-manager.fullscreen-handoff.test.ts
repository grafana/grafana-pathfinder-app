const mockLocationPush = jest.fn();
const mockRequestSidebarHandoffAndWait = jest.fn().mockResolvedValue(undefined);
const mockIsGrafanaDrivingHandoffNeeded = jest.fn().mockReturnValue(false);

jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: { user: { orgRole: 'Viewer', isGrafanaAdmin: false } },
  },
  locationService: {
    push: (...args: unknown[]) => mockLocationPush(...args),
  },
}));

jest.mock('../global-state/panel-mode', () => ({
  isGrafanaDrivingHandoffNeeded: (...args: unknown[]) => mockIsGrafanaDrivingHandoffNeeded(...args),
  requestSidebarHandoffAndWait: (...args: unknown[]) => mockRequestSidebarHandoffAndWait(...args),
}));

import { NavigationManager } from './navigation-manager';

describe('NavigationManager.fixLocationRequirement full-screen handoff', () => {
  let navigationManager: NavigationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsGrafanaDrivingHandoffNeeded.mockReturnValue(false);
    mockRequestSidebarHandoffAndWait.mockResolvedValue(undefined);
    navigationManager = new NavigationManager();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pushes directly when the requirement fix is outside full screen', async () => {
    const result = navigationManager.fixLocationRequirement('/explore?orgId=1#queries');
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe(true);

    expect(mockIsGrafanaDrivingHandoffNeeded).toHaveBeenCalledWith('navigate');
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
    expect(mockLocationPush).toHaveBeenCalledWith('/explore?orgId=1#queries');
  });

  it('hands off with the target path instead of pushing directly from full screen', async () => {
    mockIsGrafanaDrivingHandoffNeeded.mockReturnValue(true);

    const result = navigationManager.fixLocationRequirement('/explore?orgId=1#queries');
    await jest.runAllTimersAsync();
    await expect(result).resolves.toBe(true);

    expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledWith({ targetPath: '/explore?orgId=1#queries' });
    expect(mockLocationPush).not.toHaveBeenCalled();
  });

  it.each(['relative/path', '/admin/users', '/logout'])(
    'refuses %s before choosing a navigation branch',
    async (path) => {
      await expect(navigationManager.fixLocationRequirement(path)).resolves.toBe(false);

      expect(mockIsGrafanaDrivingHandoffNeeded).not.toHaveBeenCalled();
      expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
      expect(mockLocationPush).not.toHaveBeenCalled();
    }
  );
});
