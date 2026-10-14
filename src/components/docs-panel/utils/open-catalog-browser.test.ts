import { config } from '@grafana/runtime';
import { openCatalogBrowser } from './open-catalog-browser';
import { cancelCatalogActivation, getCatalogActivation } from '../../../global-state/package-browser';
import { panelModeManager } from '../../../global-state/panel-mode';
import { sidebarState } from '../../../global-state/sidebar';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { isExtensionSidebarOwnedByOther } from '../../../lib/storage/extension-sidebar';
import { getPathfinderSurface } from '../../../lib/telemetry/surface';
import { OPEN_CATALOG_BROWSER_EVENT } from '../../../lib/event-names';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'org-a', bootData: { user: { orgId: 1, id: 2 } } } }));
jest.mock('../../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: jest.fn(), setModeTransient: jest.fn(), setMode: jest.fn() },
}));
jest.mock('../../../global-state/sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(),
    setIsSidebarMounted: jest.fn(),
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));
jest.mock('../../../global-state/link-interception', () => ({ linkInterceptionState: { addToQueue: jest.fn() } }));
jest.mock('../../../lib/storage/extension-sidebar', () => ({ isExtensionSidebarOwnedByOther: jest.fn() }));
jest.mock('../../../lib/telemetry/surface', () => ({ getPathfinderSurface: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  cancelCatalogActivation();
  config.namespace = 'org-a';
  jest.mocked(panelModeManager.getMode).mockReturnValue('sidebar');
  jest.mocked(getPathfinderSurface).mockReturnValue('sidebar');
  jest.mocked(sidebarState.getIsSidebarMounted).mockReturnValue(true);
  jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(false);
});

it('activates the mounted sidebar without opening another surface or writing storage', () => {
  const listener = jest.fn();
  const write = jest.spyOn(Storage.prototype, 'setItem');
  document.addEventListener(OPEN_CATALOG_BROWSER_EVENT, listener);
  try {
    openCatalogBrowser();
    expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeNull();
    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    expect(linkInterceptionState.addToQueue).not.toHaveBeenCalled();
    expect(panelModeManager.setMode).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener(OPEN_CATALOG_BROWSER_EVENT, listener);
    write.mockRestore();
  }
});

it.each(['floating', 'fullscreen'] as const)('moves %s to the sidebar with a latched activation', (mode) => {
  jest.mocked(panelModeManager.getMode).mockReturnValue(mode);
  jest.mocked(getPathfinderSurface).mockReturnValue(mode);
  const listener = jest.fn();
  document.addEventListener(OPEN_CATALOG_BROWSER_EVENT, listener);
  try {
    openCatalogBrowser({ source: 'my_learning_discover_more' });
    expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
    expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('sidebar');
    expect(panelModeManager.setMode).not.toHaveBeenCalled();
    expect(sidebarState.setIsSidebarMounted).toHaveBeenCalledWith(false);
    expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('my_learning_discover_more');
    expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
    expect(listener).not.toHaveBeenCalled();
    expect(linkInterceptionState.addToQueue).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener(OPEN_CATALOG_BROWSER_EVENT, listener);
  }
});

it.each(['closed', 'other-owner'] as const)('opens a cold sidebar when the slot is %s', (condition) => {
  if (condition === 'closed') {
    jest.mocked(sidebarState.getIsSidebarMounted).mockReturnValue(false);
    jest.mocked(getPathfinderSurface).mockReturnValue('closed');
  } else {
    jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(true);
  }
  openCatalogBrowser();
  expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
  expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('package_browser');
  expect(getCatalogActivation('org-a:1:2')).not.toBeNull();
  expect(linkInterceptionState.addToQueue).not.toHaveBeenCalled();
});
