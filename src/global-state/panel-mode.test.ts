/**
 * Tests for panelModeManager.
 *
 * Covers the third "fullscreen" mode added alongside sidebar/floating: it must
 * persist, parse back from storage, fire the same close-extension-sidebar
 * event as floating, and round-trip pendingGuide / priorPath handoffs.
 */

import { panelModeManager, requestSidebarHandoffAndWait, isGrafanaDrivingHandoffNeeded } from './panel-mode';
import { StorageKeys } from '../lib/storage-keys';
import { REQUEST_SIDEBAR_HANDOFF_EVENT } from '../lib/event-names';

const publishMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: publishMock }),
}));

const mockPushFaroUserAction = jest.fn();
jest.mock('../lib/telemetry/bridge', () => ({
  pushFaroUserAction: (...args: unknown[]) => mockPushFaroUserAction(...args),
}));

describe('panelModeManager', () => {
  beforeEach(() => {
    localStorage.clear();
    publishMock.mockClear();
    mockPushFaroUserAction.mockClear();
    // Reset to default 'sidebar' for each test
    localStorage.removeItem(StorageKeys.PANEL_MODE);
  });

  describe('getMode', () => {
    it('defaults to sidebar when nothing is stored', () => {
      expect(panelModeManager.getMode()).toBe('sidebar');
    });

    it('returns floating when stored value is "floating"', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      expect(panelModeManager.getMode()).toBe('floating');
    });

    it('returns fullscreen when stored value is "fullscreen"', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'fullscreen');
      expect(panelModeManager.getMode()).toBe('fullscreen');
    });

    it('falls back to sidebar for any unknown stored value', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'something-else');
      expect(panelModeManager.getMode()).toBe('sidebar');
    });
  });

  describe('setMode', () => {
    it('persists fullscreen to storage', () => {
      panelModeManager.setMode('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('fullscreen');
    });

    it('publishes close-extension-sidebar when entering fullscreen', () => {
      panelModeManager.setMode('fullscreen');
      expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
    });

    it('publishes close-extension-sidebar when entering floating (regression)', () => {
      panelModeManager.setMode('floating');
      expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
    });

    it('does not publish close-extension-sidebar when returning to sidebar', () => {
      // Start in fullscreen so the transition to sidebar is a real change
      localStorage.setItem(StorageKeys.PANEL_MODE, 'fullscreen');
      panelModeManager.setMode('sidebar');
      expect(publishMock).not.toHaveBeenCalled();
    });

    it('is a no-op when target mode equals current mode', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'fullscreen');
      panelModeManager.setMode('fullscreen');
      expect(publishMock).not.toHaveBeenCalled();
      // commit() runs before the same-mode early return, so pin the stored
      // VALUE too (it is legitimately rewritten, but must not change).
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('fullscreen');
    });

    it('dispatches pathfinder-panel-mode-change with previous and next modes', () => {
      const handler = jest.fn();
      document.addEventListener('pathfinder-panel-mode-change', handler);
      try {
        panelModeManager.setMode('fullscreen');
        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0][0] as CustomEvent;
        expect(event.detail).toEqual({ mode: 'fullscreen', previous: 'sidebar' });
      } finally {
        document.removeEventListener('pathfinder-panel-mode-change', handler);
      }
    });
  });

  describe('pendingGuide handoff', () => {
    it('round-trips a pending guide once via consume', () => {
      panelModeManager.setPendingGuide({ url: 'bundled:foo', title: 'Foo' });
      expect(panelModeManager.consumePendingGuide()).toEqual({ url: 'bundled:foo', title: 'Foo' });
      expect(panelModeManager.consumePendingGuide()).toBeNull();
    });

    it('round-trips an editor handoff with no url', () => {
      // Editor handoffs let the BlockEditor toolbar's "Full screen" button
      // replace whatever's currently in fullscreen — even when setMode is
      // a no-op because mode is already 'fullscreen'.
      panelModeManager.setPendingGuide({ title: 'Guide editor', type: 'editor' });
      const consumed = panelModeManager.consumePendingGuide();
      expect(consumed).toEqual({ title: 'Guide editor', type: 'editor' });
      expect(consumed?.url).toBeUndefined();
      expect(panelModeManager.consumePendingGuide()).toBeNull();
    });

    it('preserves packageInfo across the handoff (synthetic PR-tester journeys)', () => {
      // PR-tester journeys ship raw GitHub URLs that are not recognised
      // package URLs, so the receiving surface must rebuild the milestone
      // toolbar from the manifest + pre-resolved milestones we passed.
      const packageInfo = {
        packageId: 'my-path',
        packageManifest: { id: 'my-path', type: 'path', milestones: ['m1', 'm2'] },
        resolvedMilestones: [
          {
            number: 1,
            title: 'm1',
            duration: '',
            url: 'https://raw.githubusercontent.com/x/y/z/m1/content.json',
            isActive: false,
          },
          {
            number: 2,
            title: 'm2',
            duration: '',
            url: 'https://raw.githubusercontent.com/x/y/z/m2/content.json',
            isActive: false,
          },
        ],
      };
      panelModeManager.setPendingGuide({
        url: 'https://raw.githubusercontent.com/x/y/z/my-path/content.json',
        title: 'my-path',
        type: 'learning-journey',
        packageInfo,
      });
      const consumed = panelModeManager.consumePendingGuide();
      expect(consumed?.packageInfo).toBe(packageInfo);
      expect(consumed?.packageInfo?.resolvedMilestones).toHaveLength(2);
    });
  });

  describe('priorPath capture', () => {
    it('round-trips a captured prior path once via consume', () => {
      panelModeManager.capturePriorPath('/dashboards?tab=foo');
      expect(panelModeManager.consumePriorPath()).toBe('/dashboards?tab=foo');
      // Cleared after consume so a future Exit doesn't replay a stale path.
      expect(panelModeManager.consumePriorPath()).toBeNull();
    });

    it('returns null when nothing was captured (cold-loaded /fullscreen URL)', () => {
      expect(panelModeManager.consumePriorPath()).toBeNull();
    });

    it('overwrites a previously captured path on second capture', () => {
      panelModeManager.capturePriorPath('/dashboards');
      panelModeManager.capturePriorPath('/connections');
      expect(panelModeManager.consumePriorPath()).toBe('/connections');
    });
  });

  describe('setModeTransient', () => {
    // The manager is a singleton: end any open round-trip (only the deliberate
    // setModePersisted does that) and clear the in-memory override so the next
    // test reads a clean localStorage state.
    afterEach(() => {
      panelModeManager.setModePersisted('sidebar');
      localStorage.clear();
    });

    it('does NOT persist the mode to localStorage (user preference untouched)', () => {
      panelModeManager.setModeTransient('fullscreen');
      expect(panelModeManager.getMode()).toBe('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBeNull();
    });

    it('preserves an existing persisted preference under the transient override', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      panelModeManager.setModeTransient('fullscreen');
      expect(panelModeManager.getMode()).toBe('fullscreen');
      // The stored preference is still 'floating' — only the in-memory override changed.
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    });

    it('runs the same side effects as setMode (close-extension-sidebar)', () => {
      panelModeManager.setModeTransient('fullscreen');
      expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'close-extension-sidebar' }));
    });

    it('does not persist the base sidebar teardown of a round-trip', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      panelModeManager.setModeTransient('fullscreen');
      panelModeManager.setMode('sidebar');
      expect(panelModeManager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    });
  });

  describe('transient-session persistence suppression (locked decision 2)', () => {
    // An auto-launch round-trip's automatic teardown never ends the session
    // (only a deliberate setModePersisted or a reload does), so the singleton
    // would leak its in-memory override across tests. Load a fresh instance per
    // test to simulate a clean page load.
    let manager!: typeof panelModeManager;
    beforeEach(() => {
      jest.isolateModules(() => {
        manager = jest.requireActual('./panel-mode').panelModeManager;
      });
    });

    // Each surface: stored pref = floating → auto-launch enter → teardown via the
    // persistence-agnostic setMode('sidebar') exit call (as every exit / close /
    // restoration site does) → stored pref STILL floating.
    it.each(['fullscreen', 'floating', 'sidebar'] as const)(
      'never overwrites a non-default preference across a transient %s launch round-trip',
      (surface) => {
        localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');

        manager.setModeTransient(surface);
        expect(manager.getMode()).toBe(surface);

        manager.setMode('sidebar');

        expect(manager.getMode()).toBe('sidebar');
        expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
      }
    );

    it('never persists an automatic auto-dock to FLOATING (full-screen → floating when sidebar occupied)', () => {
      // review-4: stored pref = sidebar; a reading-only guide auto-launches
      // full screen; navigating away auto-docks to FLOATING (another plugin owns
      // the extension sidebar). That automatic teardown must not overwrite the
      // stored 'sidebar' preference with 'floating'.
      localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');

      manager.setModeTransient('fullscreen');
      manager.setMode('floating');

      expect(manager.getMode()).toBe('floating');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });

    it('reloading a transient full-screen launch keeps the stored preference intact', () => {
      // A transient launch pushes a real, reloadable /fullscreen?doc=… URL but
      // transiency lives in memory only. After a reload (fresh manager,
      // preserved localStorage) FullScreenPanel's reconcile effect sees the
      // mode mismatch and re-aligns to the route — that write must be
      // transient, or the reload persists 'fullscreen' over the preference.
      localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');

      // FullScreenPanel reconcile on a cold /fullscreen load (see the
      // panel-mode-surface-toggles contract test pinning the call site).
      if (manager.getMode() !== 'fullscreen') {
        manager.setModeTransient('fullscreen');
      }

      expect(manager.getMode()).toBe('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });

    it('resumes persistence for a deliberate surface change after a round-trip', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');

      // Auto-launch a reading-only guide (transient) and exit to sidebar.
      manager.setModeTransient('fullscreen');
      manager.setMode('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');

      // A deliberate change goes through the persisting path and persists.
      manager.setModePersisted('fullscreen');
      expect(manager.getMode()).toBe('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('fullscreen');
    });

    it('setModePersisted persists, ends the session, and lets subsequent setMode persist', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');

      // Deliberate pop-out mid-round-trip persists and ends the session.
      manager.setModeTransient('fullscreen');
      manager.setModePersisted('floating');
      expect(manager.getMode()).toBe('floating');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');

      // Session ended → a plain setMode now persists as a normal user choice.
      manager.setMode('fullscreen');
      expect(manager.getMode()).toBe('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('fullscreen');
    });

    it('persists a manually entered surface on exit (no transient session)', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');

      manager.setMode('fullscreen');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('fullscreen');
      manager.setMode('sidebar');

      expect(manager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });
  });

  describe('deliberate dock to sidebar persists consistently (decision 3, #1449)', () => {
    // The floating dock-to-sidebar pill calls setModePersisted('sidebar')
    // (FloatingPanelManager.handleSwitchToSidebar). Its whole point is that the
    // outcome must NOT depend on invisible session history — the flow-1 bug was
    // that a guide auto-launched earlier in the session silently turned the
    // dock's persist into a no-op. Both paths below must land on 'sidebar'.
    let manager!: typeof panelModeManager;
    beforeEach(() => {
      jest.isolateModules(() => {
        manager = jest.requireActual('./panel-mode').panelModeManager;
      });
    });

    it('persists sidebar for a floating-preference user in a fresh session', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      manager.setModePersisted('sidebar');
      expect(manager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });

    it('persists sidebar even mid transient session (no invisible-history dependence)', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      // A guide was auto-launched earlier in the session (transient session open).
      manager.setModeTransient('floating');
      // The user then deliberately docks to the sidebar.
      manager.setModePersisted('sidebar');
      expect(manager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });

    it('contrasts with the conditional fullscreen return, which stays transient-safe', () => {
      // Same starting state, but the fullscreen back-arrow uses plain setMode:
      // leaving a transient launch must NOT overwrite the stored preference.
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      manager.setModeTransient('fullscreen');
      manager.setMode('sidebar');
      expect(manager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    });
  });

  describe('endTransientSession (browser Back quiet exit, #1448)', () => {
    // The manager is a singleton and only setModePersisted / endTransientSession
    // close a session, so load a fresh instance per test to avoid leaking the
    // in-memory override across cases.
    let manager!: typeof panelModeManager;
    beforeEach(() => {
      jest.isolateModules(() => {
        manager = jest.requireActual('./panel-mode').panelModeManager;
      });
    });

    it('isTransient tracks the session: false → true after a transient launch → false after end', () => {
      expect(manager.isTransient()).toBe(false);
      manager.setModeTransient('fullscreen');
      expect(manager.isTransient()).toBe(true);
      manager.endTransientSession();
      expect(manager.isTransient()).toBe(false);
    });

    it('drops the override so getMode reverts to the stored preference, without persisting', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');
      manager.setModeTransient('fullscreen');
      expect(manager.getMode()).toBe('fullscreen');

      manager.endTransientSession();

      // Reverts to the stored preference (not stuck on fullscreen — the dead-state
      // hazard) and leaves the preference untouched (no persisting write).
      expect(manager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });

    it('is a no-op when no transient session is active', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      manager.endTransientSession();
      expect(manager.isTransient()).toBe(false);
      expect(manager.getMode()).toBe('floating');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    });

    it('does not dispatch pathfinder-panel-mode-change (surface already unmounted)', () => {
      const handler = jest.fn();
      document.addEventListener('pathfinder-panel-mode-change', handler);
      try {
        manager.setModeTransient('fullscreen');
        handler.mockClear();
        manager.endTransientSession();
        expect(handler).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('pathfinder-panel-mode-change', handler);
      }
    });
  });

  describe('isGrafanaDrivingHandoffNeeded', () => {
    it('is true for a Grafana-driving action in full screen', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'fullscreen');
      expect(isGrafanaDrivingHandoffNeeded('button')).toBe(true);
      expect(isGrafanaDrivingHandoffNeeded('highlight')).toBe(true);
      expect(isGrafanaDrivingHandoffNeeded('formfill')).toBe(true);
      expect(isGrafanaDrivingHandoffNeeded('navigate')).toBe(true);
      expect(isGrafanaDrivingHandoffNeeded('hover')).toBe(true);
    });

    it('is false for a non-driving action in full screen (e.g. noop, sequence)', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'fullscreen');
      expect(isGrafanaDrivingHandoffNeeded('noop')).toBe(false);
      expect(isGrafanaDrivingHandoffNeeded('sequence')).toBe(false);
    });

    it('is false for a Grafana-driving action outside full screen (sidebar or floating)', () => {
      expect(isGrafanaDrivingHandoffNeeded('button')).toBe(false);
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');
      expect(isGrafanaDrivingHandoffNeeded('button')).toBe(false);
    });

    // "Show me" and "Do it" apply the same rule — neither has anything to
    // preview or act on until the live Grafana UI is docked into view.
    // isGrafanaDrivingHandoffNeeded takes no buttonType; this documents that
    // deliberately, so a future signature change doesn't quietly reintroduce
    // a show/do split.
    it('has no buttonType parameter — "Show me" and "Do it" share the exact same rule', () => {
      expect(isGrafanaDrivingHandoffNeeded.length).toBe(1);
    });
  });

  describe('requestSidebarHandoffAndWait', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('dispatches REQUEST_SIDEBAR_HANDOFF_EVENT on document with the given targetPath', () => {
      const handler = jest.fn();
      document.addEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handler);
      try {
        void requestSidebarHandoffAndWait({ targetPath: '/explore' });
        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0][0] as CustomEvent<{ targetPath?: string }>;
        expect(event.detail).toEqual({ targetPath: '/explore' });
      } finally {
        document.removeEventListener(REQUEST_SIDEBAR_HANDOFF_EVENT, handler);
      }
    });

    it('resolves once pathfinder-sidebar-mounted fires and the settle delay elapses', async () => {
      const promise = requestSidebarHandoffAndWait();
      window.dispatchEvent(new CustomEvent('pathfinder-sidebar-mounted'));
      jest.advanceTimersByTime(300);
      await expect(promise).resolves.toBeUndefined();
      // A real mount is a normal outcome, distinguishable from the safety-timeout
      // degradation below — otherwise both look identical in telemetry.
      expect(mockPushFaroUserAction).toHaveBeenCalledWith('pathfinder_fullscreen_handoff', { outcome: 'mounted' });
    });

    // Regression test: handleExitToSidebar can fall back to floating mode
    // (when another plugin owns the extension sidebar), which dispatches
    // 'pathfinder-panel-mounted' on `document`, never 'pathfinder-sidebar-mounted'
    // on `window`. Before this fix, that meant every floating fallback burned
    // the full 3s safety timeout instead of resolving on the real mount.
    it('resolves once pathfinder-panel-mounted fires (the floating-mode mount signal), without waiting for the safety timeout', async () => {
      const promise = requestSidebarHandoffAndWait();
      document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted'));
      jest.advanceTimersByTime(300);
      await expect(promise).resolves.toBeUndefined();
      // Confirms this resolved via the mount event, not the 3s safety timeout.
      expect(jest.getTimerCount()).toBe(0);
      expect(mockPushFaroUserAction).toHaveBeenCalledWith('pathfinder_fullscreen_handoff', { outcome: 'mounted' });
    });

    it('resolves via the safety timeout when pathfinder-sidebar-mounted never fires', async () => {
      const promise = requestSidebarHandoffAndWait();
      jest.advanceTimersByTime(3000);
      await expect(promise).resolves.toBeUndefined();
      // The safety timeout is a silent degradation (destination never
      // confirmed it mounted) — must be countable separately from a real mount.
      expect(mockPushFaroUserAction).toHaveBeenCalledWith('pathfinder_fullscreen_handoff', { outcome: 'timeout' });
    });

    it('does not publish a confirmation toast itself — dispatchEvent cannot tell it a listener actually reacted', () => {
      // A listener-free dispatch (nobody mounted to handle it) must not still
      // report success; only the real listener, once its handoff completes,
      // may do that. See FullScreenPanel.tsx's handleSidebarHandoffRequest.
      void requestSidebarHandoffAndWait();
      expect(publishMock).not.toHaveBeenCalled();
    });
  });
});
