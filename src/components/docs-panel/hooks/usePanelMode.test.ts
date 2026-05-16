import { renderHook, act } from '@testing-library/react';
import { usePanelMode } from './usePanelMode';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';

describe('usePanelMode', () => {
  let setModeSpy: jest.SpyInstance;
  let originalPathname: string;

  beforeEach(() => {
    setModeSpy = jest.spyOn(panelModeManager, 'setMode').mockImplementation(() => {});
    jest.spyOn(panelModeManager, 'getMode').mockReturnValue('sidebar');
    originalPathname = window.location.pathname;
    setPathname('/grafana/some-other-page');
  });

  afterEach(() => {
    setModeSpy.mockRestore();
    jest.restoreAllMocks();
    setPathname(originalPathname);
  });

  function setPathname(pathname: string) {
    // JSDOM's Location properties are non-configurable; pushState is the
    // sanctioned way to update window.location.pathname.
    window.history.pushState({}, '', pathname);
  }

  function dispatchModeChange(mode: PanelMode) {
    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-panel-mode-change', { detail: { mode } }));
    });
  }

  it('initializes panelMode from panelModeManager.getMode()', () => {
    const { result } = renderHook(() => usePanelMode());
    expect(result.current.panelMode).toBe('sidebar');
    expect(result.current.isFullScreenActive).toBe(false);
  });

  it('updates panelMode when pathfinder-panel-mode-change fires', () => {
    const { result } = renderHook(() => usePanelMode());
    dispatchModeChange('floating');
    expect(result.current.panelMode).toBe('floating');
    expect(result.current.isFullScreenActive).toBe(false);
  });

  it('sets isFullScreenActive when mode becomes fullscreen and pathname is the full-screen route', () => {
    setPathname(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);

    const { result } = renderHook(() => usePanelMode());
    dispatchModeChange('fullscreen');
    expect(result.current.panelMode).toBe('fullscreen');
    expect(result.current.isFullScreenActive).toBe(true);
    expect(setModeSpy).not.toHaveBeenCalled();
  });

  it('self-heals stale fullscreen mode to sidebar when off-route', () => {
    setPathname('/grafana/dashboards');

    const { result } = renderHook(() => usePanelMode());
    dispatchModeChange('fullscreen');

    expect(result.current.panelMode).toBe('sidebar');
    expect(setModeSpy).toHaveBeenCalledWith('sidebar');
  });

  it('removes the listener on unmount', () => {
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => usePanelMode());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pathfinder-panel-mode-change', expect.any(Function));
  });
});
