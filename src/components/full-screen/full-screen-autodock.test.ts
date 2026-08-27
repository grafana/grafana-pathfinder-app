/**
 * Tests for `dockOnLeavingFullScreen` — the auto-dock decision that fires
 * when something navigates the user off `/a/<plugin>/fullscreen` while
 * panel mode is still `'fullscreen'`.
 */

import { dockOnLeavingFullScreen } from './full-screen-autodock';
import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import { reportAppInteraction } from '../../lib/analytics';

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: {
    getMode: jest.fn(),
    setMode: jest.fn(),
    setPendingGuide: jest.fn(),
    isTransient: jest.fn(),
    endTransientSession: jest.fn(),
  },
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));

jest.mock('../../lib/storage/extension-sidebar', () => {
  const actual = jest.requireActual('../../lib/storage/extension-sidebar');
  return { ...actual, isExtensionSidebarOwnedByOther: jest.fn() };
});

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
    // Default to PUSH (an interactive `navigate` step): exercises the dock
    // branches. The transient-Back branch is opted into per-test.
    action: 'PUSH' as const,
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
    (panelModeManager.isTransient as jest.Mock).mockReturnValue(false);
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

  describe('transient Back branch (browser Back out of a transient prose launch)', () => {
    beforeEach(() => {
      (panelModeManager.isTransient as jest.Mock).mockReturnValue(true);
    });

    it('quietly ends the transient session without opening the sidebar (deferred)', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs({ action: 'POP' }));

      // Session end is deferred so FullScreenPanel's unmount cleanup runs first
      // (while mode is still fullscreen) and clears isSidebarMounted.
      expect(panelModeManager.endTransientSession).not.toHaveBeenCalled();

      jest.runAllTimers();

      expect(outcome).toBe('transient_back');
      expect(panelModeManager.endTransientSession).toHaveBeenCalledTimes(1);
      // Never forces a surface open and never docks.
      expect(panelModeManager.setMode).not.toHaveBeenCalled();
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      expect(sidebarState.setPendingOpenSource).not.toHaveBeenCalled();
    });

    it('reports analytics with destination=none and reason=transient_back', () => {
      dockOnLeavingFullScreen(defaultInputs({ action: 'POP' }));

      expect(reportAppInteraction).toHaveBeenCalledWith('full_screen_exit', {
        destination: 'none',
        guide_url: baseTab.baseUrl,
        guide_title: baseTab.title,
        reason: 'transient_back',
      });
    });

    it('leaves PUSH (interactive navigate step) on the docking path even mid-session', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs({ action: 'PUSH' }));
      jest.runAllTimers();

      expect(outcome).toBe('sidebar');
      expect(panelModeManager.endTransientSession).not.toHaveBeenCalled();
      expect(panelModeManager.setMode).toHaveBeenCalledWith('sidebar');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
    });

    it('leaves REPLACE on the docking path (POP-only rule)', () => {
      const outcome = dockOnLeavingFullScreen(defaultInputs({ action: 'REPLACE' }));
      jest.runAllTimers();

      expect(outcome).toBe('sidebar');
      expect(panelModeManager.endTransientSession).not.toHaveBeenCalled();
    });
  });

  describe('Back branch does not fire for a deliberate (non-transient) full screen', () => {
    it('a POP with no transient session docks as today (deliberate adoption exit)', () => {
      // isTransient() defaults to false in beforeEach.
      const outcome = dockOnLeavingFullScreen(defaultInputs({ action: 'POP' }));
      jest.runAllTimers();

      expect(outcome).toBe('sidebar');
      expect(panelModeManager.endTransientSession).not.toHaveBeenCalled();
      expect(panelModeManager.setMode).toHaveBeenCalledWith('sidebar');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
    });
  });
});
