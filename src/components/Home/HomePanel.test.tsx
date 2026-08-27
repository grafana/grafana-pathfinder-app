/**
 * Tests for HomePanelRenderer (composition root + launch-surface selection).
 * Verifies that MyLearningTab is rendered and that a prepared guide launch is
 * routed to the right surface (full screen for reading-only content, sidebar /
 * floating for content that drives the Grafana UI) without a second fetch.
 * MyLearningTab internals are tested separately in the LearningPaths domain.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { HomePanelRenderer } from './HomePanel';
import { sidebarState } from '../../global-state/sidebar';
import { guideLaunchStore } from '../../global-state/guide-launch';
import { linkInterceptionState } from '../../global-state/link-interception';
import { panelModeManager } from '../../global-state/panel-mode';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import { REQUEST_FLOATING_GUIDE_EVENT, REQUEST_FULLSCREEN_GUIDE_EVENT } from '../../lib/event-names';
import { locationService } from '@grafana/runtime';
import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import type { RawContent } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import { testIds } from '../../constants/testIds';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class SceneObjectBase {},
}));

jest.mock('@grafana/runtime', () => ({
  locationService: { push: jest.fn() },
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) => fn(mockTheme),
}));

const mockTheme = {
  isDark: false,
  spacing: (n: number) => `${n * 8}px`,
  shape: { radius: { default: '4px', pill: '9999px' } },
  colors: {
    text: { primary: '#000', secondary: '#666', disabled: '#aaa' },
    background: { primary: '#fff', secondary: '#f5f5f5' },
    border: { weak: '#ddd' },
    action: { hover: '#eee' },
    primary: { shade: '#333' },
    error: { text: '#f00' },
  },
  typography: {
    h3: { fontSize: '24px' },
    h5: { fontSize: '16px' },
    body: { fontSize: '14px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
  zIndex: { modal: 1000 },
};

let capturedOnOpenGuide: ((launch: PreparedGuideLaunch) => void) | undefined;

jest.mock('../LearningPaths', () => ({
  MyLearningTab: ({ onOpenGuide }: { onOpenGuide: (launch: PreparedGuideLaunch) => void }) => {
    capturedOnOpenGuide = onOpenGuide;
    return <div data-testid="my-learning-tab">MyLearningTab</div>;
  },
}));

jest.mock('../docs-panel/components', () => ({
  MyLearningErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(),
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));

jest.mock('../../global-state/link-interception', () => ({
  linkInterceptionState: {
    addToQueue: jest.fn(),
  },
}));

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: {
    getMode: jest.fn(() => 'sidebar'),
    setPendingGuide: jest.fn(),
    setModeTransient: jest.fn(),
    capturePriorPath: jest.fn(),
  },
}));

jest.mock('../../lib/storage/extension-sidebar', () => ({
  isExtensionSidebarOwnedByOther: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const rawContent: RawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  metadata: { title: 'g' },
  type: 'interactive',
  url: 'bundled:first-dashboard',
  lastFetched: '2026-07-28T00:00:00.000Z',
};

function preparedLaunch(overrides: Partial<PreparedGuideLaunch> = {}): PreparedGuideLaunch {
  return {
    url: 'bundled:first-dashboard',
    title: 'Create your first dashboard',
    type: 'docs',
    source: 'home_page',
    preparedContent: rawContent,
    requiresGrafanaUi: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePanelRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnOpenGuide = undefined;
    (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
    (panelModeManager.getMode as jest.Mock).mockReturnValue('sidebar');
  });

  describe('composition', () => {
    it('renders MyLearningTab', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
    });

    it('renders home-page container', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByTestId(testIds.homePage.container)).toBeInTheDocument();
    });
  });

  describe('reading-only content opens full screen', () => {
    it('carries the prepared content into a pending guide and enters full screen transiently', () => {
      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: false }));

      expect(panelModeManager.setPendingGuide).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', preparedContent: rawContent })
      );
      expect(panelModeManager.capturePriorPath).toHaveBeenCalled();
      expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('fullscreen');
      expect(locationService.push).toHaveBeenCalledWith(expect.stringContaining('doc=bundled'));
    });

    it('signals an already-mounted full-screen surface to consume, once per launch, after staging', () => {
      // @grafana/scenes caches the full-screen SceneAppPage by pathname only
      // (it ignores the ?doc= query string), so the full-screen surface's
      // mount effect — which consumes the pending guide — fires once per
      // session, not once per launch. Without this signal, every launch
      // after the first stages a pending guide that nobody is listening
      // for anymore (mirrors the floating case above, which has the same
      // shape for a different reason: no mode-change event on a same-mode
      // relaunch).
      const stagedWhenHeard: number[] = [];
      const listener = () => {
        stagedWhenHeard.push((panelModeManager.setPendingGuide as jest.Mock).mock.calls.length);
      };
      document.addEventListener(REQUEST_FULLSCREEN_GUIDE_EVENT, listener);

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: false }));
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: false }));

      document.removeEventListener(REQUEST_FULLSCREEN_GUIDE_EVENT, listener);
      expect(stagedWhenHeard).toEqual([1, 2]);
    });
  });

  describe('content that drives the Grafana UI opens beside Grafana', () => {
    it('dispatches pathfinder-auto-open-docs with a redeemable launch key (payload stays off the event) when the sidebar is mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pathfinder-auto-open-docs',
          detail: expect.objectContaining({
            url: 'bundled:first-dashboard',
            title: 'Create your first dashboard',
            source: 'home_page',
            launchKey: expect.any(String),
          }),
        })
      );
      // The forgeable event never carries the payload itself…
      const detail = (
        dispatchSpy.mock.calls.find(
          (c) => (c[0] as CustomEvent).type === 'pathfinder-auto-open-docs'
        )![0] as CustomEvent
      ).detail;
      expect(detail.preparedContent).toBeUndefined();
      expect(detail.packageInfo).toBeUndefined();
      // …but the key redeems it from the module-owned store.
      expect(guideLaunchStore.consume(detail.launchKey, 'bundled:first-dashboard')).toEqual(
        expect.objectContaining({ preparedContent: rawContent })
      );
      expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('sidebar');
      expect(panelModeManager.setModeTransient).not.toHaveBeenCalledWith('fullscreen');
      dispatchSpy.mockRestore();
    });

    it('opens the sidebar and queues a redeemable launch key when the sidebar is NOT mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));

      expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('home_page');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith(
        'Interactive learning',
        expect.objectContaining({ url: 'bundled:first-dashboard', title: 'Create your first dashboard' })
      );
      expect(linkInterceptionState.addToQueue).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', launchKey: expect.any(String) })
      );
      const queued = (linkInterceptionState.addToQueue as jest.Mock).mock.calls[0][0];
      expect(queued.preparedContent).toBeUndefined();
      expect(guideLaunchStore.consume(queued.launchKey, 'bundled:first-dashboard')).toEqual(
        expect.objectContaining({ preparedContent: rawContent })
      );
    });

    it('falls back to a floating overlay when another plugin owns the sidebar', () => {
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));

      expect(panelModeManager.setPendingGuide).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', preparedContent: rawContent })
      );
      expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('floating');
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    });

    it('delivers to the floating panel when it is the current surface, instead of tearing it down', () => {
      // Nothing is docked in floating mode (module.tsx clears the key), so the
      // owned-by-other check alone would force 'sidebar' — unmounting the
      // floating panel while `isSidebarMounted` stays true, dropping the guide.
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
      (panelModeManager.getMode as jest.Mock).mockReturnValue('floating');
      const requestGuideListener = jest.fn();
      document.addEventListener(REQUEST_FLOATING_GUIDE_EVENT, requestGuideListener);

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));

      document.removeEventListener(REQUEST_FLOATING_GUIDE_EVENT, requestGuideListener);
      expect(panelModeManager.setPendingGuide).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', preparedContent: rawContent })
      );
      expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('floating');
      expect(panelModeManager.setModeTransient).not.toHaveBeenCalledWith('sidebar');
      expect(requestGuideListener).toHaveBeenCalledTimes(1);
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    });

    it('signals an already-mounted floating panel to consume, once per launch, after staging', () => {
      // A repeat launch leaves the mode at 'floating', so no mode-change event
      // fires and the panel never remounts — without this signal the second
      // guide would be staged but never consumed (silently dropped).
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(true);
      const stagedWhenHeard: number[] = [];
      const listener = () => {
        stagedWhenHeard.push((panelModeManager.setPendingGuide as jest.Mock).mock.calls.length);
      };
      document.addEventListener(REQUEST_FLOATING_GUIDE_EVENT, listener);

      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));

      document.removeEventListener(REQUEST_FLOATING_GUIDE_EVENT, listener);
      expect(stagedWhenHeard).toEqual([1, 2]);
    });

    it('carries packageInfo through the staged payload on both the event and the queued-link paths', () => {
      const packageInfo: PackageOpenInfo = { packageId: 'pkg-1', packageManifest: { kind: 'package' } };

      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true, packageInfo }));

      const detail = (
        dispatchSpy.mock.calls.find(
          (c) => (c[0] as CustomEvent).type === 'pathfinder-auto-open-docs'
        )![0] as CustomEvent
      ).detail;
      expect(detail.packageInfo).toBeUndefined();
      expect(guideLaunchStore.consume(detail.launchKey, 'bundled:first-dashboard')).toEqual(
        expect.objectContaining({ packageInfo })
      );
      dispatchSpy.mockRestore();

      jest.clearAllMocks();
      (isExtensionSidebarOwnedByOther as jest.Mock).mockReturnValue(false);
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);
      render(<HomePanelRenderer />);
      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true, packageInfo }));

      const queued = (linkInterceptionState.addToQueue as jest.Mock).mock.calls[0][0];
      expect(queued.packageInfo).toBeUndefined();
      expect(guideLaunchStore.consume(queued.launchKey, 'bundled:first-dashboard')).toEqual(
        expect.objectContaining({ packageInfo })
      );
    });
  });

  describe('launches are independent — no cross-launch surface leakage', () => {
    it('reading-only then interactive: the interactive launch resets the surface to sidebar (A→B)', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      render(<HomePanelRenderer />);

      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: false }));
      expect(panelModeManager.setModeTransient).toHaveBeenLastCalledWith('fullscreen');

      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));
      expect(panelModeManager.setModeTransient).toHaveBeenLastCalledWith('sidebar');
    });

    it('interactive then reading-only: the reading-only launch still enters full screen (B→A)', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      render(<HomePanelRenderer />);

      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: true }));
      expect(panelModeManager.setModeTransient).toHaveBeenLastCalledWith('sidebar');

      capturedOnOpenGuide!(preparedLaunch({ requiresGrafanaUi: false }));
      expect(panelModeManager.setModeTransient).toHaveBeenLastCalledWith('fullscreen');
    });
  });
});
