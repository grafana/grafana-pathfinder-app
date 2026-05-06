/**
 * Tests for panelModeManager.
 *
 * Covers the third "fullscreen" mode added alongside sidebar/floating: it must
 * persist, parse back from storage, fire the same close-extension-sidebar
 * event as floating, and not interfere with the existing snapshot/handoff
 * helpers.
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

  describe('snapshot/restore handoff', () => {
    it('snapshots sidebar tabs and restores them after a fullscreen round trip', () => {
      const tabsSnapshot = JSON.stringify([{ id: 'tab-1', title: 'Original' }]);
      localStorage.setItem(StorageKeys.TABS, tabsSnapshot);
      localStorage.setItem(StorageKeys.ACTIVE_TAB, 'tab-1');

      panelModeManager.snapshotSidebarTabs();

      // Simulate the fullscreen panel writing different tabs
      localStorage.setItem(StorageKeys.TABS, JSON.stringify([{ id: 'tab-2', title: 'Other' }]));
      localStorage.setItem(StorageKeys.ACTIVE_TAB, 'tab-2');

      panelModeManager.restoreSidebarTabSnapshot();

      expect(localStorage.getItem(StorageKeys.TABS)).toBe(tabsSnapshot);
      expect(localStorage.getItem(StorageKeys.ACTIVE_TAB)).toBe('tab-1');
    });
  });

  describe('pendingGuide handoff', () => {
    it('round-trips a pending guide once via consume', () => {
      panelModeManager.setPendingGuide({ url: 'bundled:foo', title: 'Foo' });
      expect(panelModeManager.consumePendingGuide()).toEqual({ url: 'bundled:foo', title: 'Foo' });
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
});
