/**
 * Integration proof for #1448 — browser Back out of a transient prose
 * full-screen launch is a QUIET exit.
 *
 * Unlike `full-screen-autodock.test.ts`, this wires the REAL
 * `panelModeManager`, REAL `dockOnLeavingFullScreen`, and REAL `sidebarState`
 * together and observes the one side effect the end user actually feels: does
 * the plugin publish an `OpenExtensionSidebarEvent` (the extension sidebar
 * reopening with the prose squeezed in)? Only `@grafana/runtime`'s event bus,
 * telemetry, analytics, and the sidebar-ownership probe are stubbed at the
 * edges.
 */

const publishedEvents: Array<{ type: string }> = [];

jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => ({
    publish: (event: { type: string }) => {
      publishedEvents.push(event);
    },
  }),
}));

jest.mock('../../lib/telemetry/surface', () => ({
  reportPathfinderSurface: jest.fn(),
  reportPathfinderSurfaceClosed: jest.fn(),
}));

jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

jest.mock('../../lib/storage/extension-sidebar', () => ({
  isExtensionSidebarOwnedByOther: jest.fn().mockReturnValue(false),
}));

import { OpenExtensionSidebarEvent } from '../../global-state/sidebar';
import { StorageKeys } from '../../lib/storage-keys';

const FULL_SCREEN_PATHNAME = '/a/grafana-pathfinder-app/fullscreen';

interface Wired {
  panelModeManager: typeof import('../../global-state/panel-mode').panelModeManager;
  sidebarState: typeof import('../../global-state/sidebar').sidebarState;
  dockOnLeavingFullScreen: typeof import('./full-screen-autodock').dockOnLeavingFullScreen;
}

// Fresh singleton graph per test so `_transientMode` never leaks across cases.
function wireRealModules(): Wired {
  let wired!: Wired;
  jest.isolateModules(() => {
    wired = {
      panelModeManager: require('../../global-state/panel-mode').panelModeManager,
      sidebarState: require('../../global-state/sidebar').sidebarState,
      dockOnLeavingFullScreen: require('./full-screen-autodock').dockOnLeavingFullScreen,
    };
  });
  return wired;
}

function sidebarOpenRequests() {
  return publishedEvents.filter((e) => e.type === OpenExtensionSidebarEvent.type);
}

describe('#1448 quiet exit — real panel-mode + auto-dock + sidebar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    publishedEvents.length = 0;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('browser Back (POP) from a transient full-screen launch does NOT reopen the sidebar and reverts to the stored preference', () => {
    const { panelModeManager, dockOnLeavingFullScreen } = wireRealModules();

    // User's durable preference before the excursion.
    localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');
    // My Learning opens a prose guide that auto-picks full screen (transient).
    panelModeManager.setModeTransient('fullscreen');
    expect(panelModeManager.getMode()).toBe('fullscreen');
    publishedEvents.length = 0; // ignore the launch's close-sidebar event

    const outcome = dockOnLeavingFullScreen({
      pathname: '/a/grafana-pathfinder-app/journeys',
      fullScreenPathname: FULL_SCREEN_PATHNAME,
      myPluginId: 'grafana-pathfinder-app',
      guideUrl: 'https://example.com/guide.json',
      title: 'My journey',
      action: 'POP',
    });
    jest.runAllTimers();

    expect(outcome).toBe('transient_back');
    // The bug: sidebar reopened with prose squeezed in. The fix: it does not.
    expect(sidebarOpenRequests()).toHaveLength(0);
    // No dead-state stuck on 'fullscreen'; falls back to the stored preference.
    expect(panelModeManager.getMode()).toBe('sidebar');
    expect(panelModeManager.isTransient()).toBe(false);
    // Preference the launch never expressed is left untouched (no persist).
    expect(localStorage.getItem(StorageKeys.PANEL_MODE)).toBe('sidebar');
  });

  it('a PUSH mid-session (interactive navigate step) still docks and DOES reopen the sidebar', () => {
    const { panelModeManager, dockOnLeavingFullScreen } = wireRealModules();

    localStorage.setItem(StorageKeys.PANEL_MODE, 'sidebar');
    panelModeManager.setModeTransient('fullscreen');
    publishedEvents.length = 0;

    const outcome = dockOnLeavingFullScreen({
      pathname: '/a/grafana-pathfinder-app/journeys',
      fullScreenPathname: FULL_SCREEN_PATHNAME,
      myPluginId: 'grafana-pathfinder-app',
      guideUrl: 'https://example.com/guide.json',
      title: 'My journey',
      action: 'PUSH',
    });
    jest.runAllTimers();

    expect(outcome).toBe('sidebar');
    expect(sidebarOpenRequests()).toHaveLength(1);
  });
});
