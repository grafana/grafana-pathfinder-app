/**
 * Tests for HomePanelRenderer (composition root).
 * Verifies that MyLearningTab is rendered and guide-open callbacks work correctly.
 * MyLearningTab internals are tested separately in the LearningPaths domain.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { HomePanelRenderer } from './HomePanel';
import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @grafana/scenes to avoid transitive @grafana/runtime dependency
jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class SceneObjectBase {},
}));

// Mock @grafana/ui - provide simple stand-ins
jest.mock('@grafana/ui', () => ({
  useStyles2: (fn: any) => fn(mockTheme),
}));

// Minimal GrafanaTheme2-shaped object for style functions
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

// Capture onOpenGuide prop passed to MyLearningTab
let capturedOnOpenGuide: ((url: string, title: string) => void) | undefined;

jest.mock('../LearningPaths', () => ({
  MyLearningTab: ({ onOpenGuide }: { onOpenGuide: (url: string, title: string) => void }) => {
    capturedOnOpenGuide = onOpenGuide;
    return <div data-testid="my-learning-tab">MyLearningTab</div>;
  },
}));

jest.mock('../docs-panel/components', () => ({
  MyLearningErrorBoundary: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock global state
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePanelRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnOpenGuide = undefined;
  });

  // ---------- Composition ---------------------------------------------------

  describe('composition', () => {
    it('renders MyLearningTab', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByTestId('my-learning-tab')).toBeInTheDocument();
    });

    it('renders home-page container', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
    });
  });

  // ---------- Guide opening -----------------------------------------------

  describe('opening a guide', () => {
    it('dispatches pathfinder-auto-open-docs when sidebar is mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

      render(<HomePanelRenderer />);
      expect(capturedOnOpenGuide).toBeDefined();
      capturedOnOpenGuide!('bundled:first-dashboard', 'Create your first dashboard');

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pathfinder-auto-open-docs',
          detail: { url: 'bundled:first-dashboard', title: 'Create your first dashboard' },
        })
      );

      dispatchSpy.mockRestore();
    });

    it('opens sidebar and queues link when sidebar is NOT mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      render(<HomePanelRenderer />);
      expect(capturedOnOpenGuide).toBeDefined();
      capturedOnOpenGuide!('bundled:first-dashboard', 'Create your first dashboard');

      expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('home_page');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith(
        'Interactive learning',
        expect.objectContaining({ url: 'bundled:first-dashboard', title: 'Create your first dashboard' })
      );
      expect(linkInterceptionState.addToQueue).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', title: 'Create your first dashboard' })
      );
    });

    it('supports URL-based (remote) guides', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

      render(<HomePanelRenderer />);
      expect(capturedOnOpenGuide).toBeDefined();

      const remoteUrl = 'https://interactive-learning.grafana.net/guides/prometheus-lj/add-data-source/content.json';
      capturedOnOpenGuide!(remoteUrl, 'Add the Prometheus data source');

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pathfinder-auto-open-docs',
          detail: { url: remoteUrl, title: 'Add the Prometheus data source' },
        })
      );

      dispatchSpy.mockRestore();
    });
  });
});
