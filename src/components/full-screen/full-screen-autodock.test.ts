/**
 * Tests for `dockOnLeavingFullScreen` — the auto-dock decision that fires
 * when something navigates the user off `/a/<plugin>/fullscreen` while
 * panel mode is still `'fullscreen'`.
 */

import { dockOnLeavingFullScreen } from './full-screen-autodock';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../utils/experiments/experiment-utils';
import { reportAppInteraction } from '../../lib/analytics';

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: {
    getMode: jest.fn(),
    setMode: jest.fn(),
    setPendingGuide: jest.fn(),
  },
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));

jest.mock('../../utils/experiments/experiment-utils', () => ({
  isExtensionSidebarOwnedByOther: jest.fn(),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { FullScreenExit: 'full_screen_exit' },
}));

const FULL_SCREEN_PATHNAME = '/a/grafana-pathfinder-app/fullscreen';
const PLUGIN_ID = 'grafana-pathfinder-app';

const baseTab = {
  baseUrl: 'https://raw.githubusercontent.com/x/y/z/cover/content.json',
  title: 'My journey',
};

function defaultInputs(overrides: Partial<Parameters<typeof dockOnLeavingFullScreen>[0]> = {}) {
  return {
    pathname: '/dashboards',
    fullScreenPathname: FULL_SCREEN_PATHNAME,
    myPluginId: PLUGIN_ID,
    guideUrl: baseTab.baseUrl,
    title: baseTab.title,
    ...overrides,
  };
}

describe('dockOnLeavingFullScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Auto-dock now defers `setMode` and friends via `setTimeout(0)` so the
    // navigate handler's `markAsCompleted` chain can settle before the
    // fullscreen tree unmounts. Use fake timers so we can assert both the
    // synchronous decisions (analytics, pending-guide) and the deferred
    // side effects in the same test.
    jest.useFakeTimers();
    (panelModeManager.getMode as jest.Mock).mockReturnValue('fullscreen');
    (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('guards', () => {
    it('no-ops when panel mode is no longer fullscreen (explicit Exit ran first)', () => {
      (panelModeManager.getMode as jest.Mock).mockReturnValue('sidebar');

      const outcome = dockOnLeavingFullScreen(defaultInputs());
      jest.runAllTimers();

      expect(outcome).toBe('noop');
      expect(panelModeManager.setMode).not.toHaveBeenCalled();
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      expect(reportAppInteraction).not.toHaveBeenCalled();
    });

    it('no-ops when only search/hash changed (pathname still on fullscreen route)', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs({ pathname: FULL_SCREEN_PATHNAME }));
      jest.runAllTimers();

      expect(outcome).toBe('noop');
      expect(panelModeManager.setMode).not.toHaveBeenCalled();
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    });
  });

  describe('sidebar branch (sidebar free or owned by us)', () => {
    it('switches to sidebar mode and opens the extension sidebar (deferred to next macrotask)', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs());

      // Side effects are deferred — nothing should have happened yet.
      expect(panelModeManager.setMode).not.toHaveBeenCalled();
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();

      jest.runAllTimers();

      expect(outcome).toBe('sidebar');
      expect(panelModeManager.setMode).toHaveBeenCalledWith('sidebar');
      expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('fullscreen_handoff', 'open');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
      // No floating-handoff side effects.
      expect(panelModeManager.setPendingGuide).not.toHaveBeenCalled();
    });

    it('reports analytics with destination=sidebar and reason=navigation_away', () => {
      dockOnLeavingFullScreen(defaultInputs());

      // Analytics fires synchronously, before the deferred side effects.
      expect(reportAppInteraction).toHaveBeenCalledWith('full_screen_exit', {
        destination: 'sidebar',
        guide_url: baseTab.baseUrl,
        guide_title: baseTab.title,
        reason: 'navigation_away',
      });
    });

    it('uses an empty guide_url when none is available (e.g. recommendations tab)', () => {
      dockOnLeavingFullScreen(defaultInputs({ guideUrl: undefined }));

      expect(reportAppInteraction).toHaveBeenCalledWith('full_screen_exit', expect.objectContaining({ guide_url: '' }));
    });
  });

  describe('floating branch (sidebar owned by another plugin)', () => {
    beforeEach(() => {
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);
    });

    it('switches to floating mode without opening the sidebar (deferred)', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs());

      // Mode change is deferred so navigate-handler can settle.
      expect(panelModeManager.setMode).not.toHaveBeenCalled();

      jest.runAllTimers();

      expect(outcome).toBe('floating');
      expect(panelModeManager.setMode).toHaveBeenCalledWith('floating');
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    });

    it('does not set a pending guide — the floating panel restores from tabStorage', () => {
      dockOnLeavingFullScreen(defaultInputs());
      jest.runAllTimers();

      expect(panelModeManager.setPendingGuide).not.toHaveBeenCalled();
    });

    it('reports analytics with destination=floating and reason=navigation_away_sidebar_occupied', () => {
      dockOnLeavingFullScreen(defaultInputs());

      expect(reportAppInteraction).toHaveBeenCalledWith('full_screen_exit', {
        destination: 'floating',
        guide_url: baseTab.baseUrl,
        guide_title: baseTab.title,
        reason: 'navigation_away_sidebar_occupied',
      });
    });
  });
});
