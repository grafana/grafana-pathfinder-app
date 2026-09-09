const mockLocationPush = jest.fn();
const mockRequestSidebarHandoffAndWait = jest.fn().mockResolvedValue(undefined);
const mockIsGrafanaDrivingHandoffNeeded = jest.fn().mockReturnValue(false);

jest.mock('@grafana/runtime', () => ({
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
    const result = navigationManager.fixLocationRequirement('/explore');
    await jest.runAllTimersAsync();
    await result;

    expect(mockIsGrafanaDrivingHandoffNeeded).toHaveBeenCalledWith('navigate');
    expect(mockRequestSidebarHandoffAndWait).not.toHaveBeenCalled();
    expect(mockLocationPush).toHaveBeenCalledWith('/explore');
  });

  it('hands off with the target path instead of pushing directly from full screen', async () => {
    mockIsGrafanaDrivingHandoffNeeded.mockReturnValue(true);

    const result = navigationManager.fixLocationRequirement('/explore');
    await jest.runAllTimersAsync();
    await result;

    expect(mockRequestSidebarHandoffAndWait).toHaveBeenCalledWith({ targetPath: '/explore' });
    expect(mockLocationPush).not.toHaveBeenCalled();
  });
});
