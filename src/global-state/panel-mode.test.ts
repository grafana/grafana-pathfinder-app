/**
 * Tests for panelModeManager.
 *
 * Covers the third "fullscreen" mode added alongside sidebar/floating: it must
 * persist, parse back from storage, fire the same close-extension-sidebar
 * event as floating, and round-trip pendingGuide / priorPath handoffs.
 */

import { panelModeManager } from './panel-mode';
import { StorageKeys } from '../lib/storage-keys';

const publishMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({ publish: publishMock }),
}));

describe('panelModeManager', () => {
  beforeEach(() => {
    localStorage.clear();
    publishMock.mockClear();
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
    // Clear any in-memory transient override left by a test (the manager is a
    // singleton) so the next test reads its persisted preference.
    afterEach(() => {
      panelModeManager.setMode('sidebar');
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

    it('is cleared by a subsequent explicit setMode, which then persists', () => {
      panelModeManager.setModeTransient('fullscreen');
      panelModeManager.setMode('sidebar');
      expect(panelModeManager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });
  });

  describe('isTransientMode', () => {
    afterEach(() => {
      panelModeManager.setMode('sidebar');
      localStorage.clear();
    });

    it('is false with no override active', () => {
      expect(panelModeManager.isTransientMode()).toBe(false);
    });

    it('is true after a transient launch and false after an explicit setMode', () => {
      panelModeManager.setModeTransient('fullscreen');
      expect(panelModeManager.isTransientMode()).toBe(true);
      panelModeManager.setMode('sidebar');
      expect(panelModeManager.isTransientMode()).toBe(false);
    });
  });

  describe('auto-launch round-trip (entry + transient exit)', () => {
    afterEach(() => {
      panelModeManager.setMode('sidebar');
      localStorage.clear();
    });

    it('never overwrites a non-default persisted preference across a transient full-screen round-trip', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');

      // Entry: My Learning auto-launches a reading-only guide full screen.
      panelModeManager.setModeTransient('fullscreen');
      expect(panelModeManager.getMode()).toBe('fullscreen');

      // Exit: a transient full screen must dock via the non-persisting path.
      expect(panelModeManager.isTransientMode()).toBe(true);
      panelModeManager.setModeTransient('sidebar');

      expect(panelModeManager.getMode()).toBe('sidebar');
      // The user's durable preference is still 'floating' — never rewritten.
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('floating');
    });

    it('a manually entered full screen still persists sidebar on exit (fix stays scoped)', () => {
      localStorage.setItem(StorageKeys.PANEL_MODE, 'floating');

      panelModeManager.setMode('fullscreen');
      expect(panelModeManager.isTransientMode()).toBe(false);
      panelModeManager.setMode('sidebar');

      expect(panelModeManager.getMode()).toBe('sidebar');
      expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
    });
  });
});
