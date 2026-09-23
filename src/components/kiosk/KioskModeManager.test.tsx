import React from 'react';
import { locationService } from '@grafana/runtime';
import { render, act } from '@testing-library/react';
import { kioskState } from '../../global-state/kiosk';
import { KioskModeManager } from './KioskModeManager';
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from '../../lib/telemetry/surface';
import { sidebarState } from '../../global-state/sidebar';

jest.mock('../../lib/telemetry/surface', () => ({
  reportPathfinderSurface: jest.fn(),
  reportPathfinderSurfaceClosed: jest.fn(),
}));

jest.mock('../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: jest.fn(() => false) },
}));

jest.mock('./KioskOverlay', () => ({
  KioskOverlay: ({
    onClose,
    overrideUrl,
    rulesUrl,
  }: {
    onClose: () => void;
    overrideUrl?: string;
    rulesUrl: string;
  }) => (
    <button data-testid="close-overlay" onClick={onClose}>
      {overrideUrl || rulesUrl}
    </button>
  ),
}));

describe('KioskModeManager', () => {
  beforeEach(() => {
    kioskState.set(null);
    window.history.replaceState({}, '', '/');
    jest.clearAllMocks();
    (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);
  });

  it('does not report the kiosk surface merely by mounting', () => {
    render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);
    expect(reportPathfinderSurface).not.toHaveBeenCalled();
  });

  it('reports the kiosk surface only when the overlay is actually opened', () => {
    render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });

    expect(reportPathfinderSurface).toHaveBeenCalledWith('kiosk');
  });

  it('reports the surface closed when the overlay closes', () => {
    const { getByTestId } = render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });

    act(() => {
      getByTestId('close-overlay').click();
    });

    expect(reportPathfinderSurfaceClosed).toHaveBeenCalledWith('kiosk');
  });

  it('returns to the sidebar surface when the sidebar remains mounted', () => {
    (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
    const { getByTestId } = render(<KioskModeManager rulesUrl="https://example.com/rules.json" />);

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
    });
    act(() => {
      getByTestId('close-overlay').click();
    });

    expect(reportPathfinderSurface).toHaveBeenLastCalledWith('sidebar');
    expect(reportPathfinderSurfaceClosed).not.toHaveBeenCalled();
  });
  it('opens a URL request received before mounting and clears it on close', () => {
    window.history.replaceState(
      { retained: true },
      '',
      '/?pathfinderKiosk=1&kioskRulesUrl=override&kiosk=tv&orgId=1#anchor'
    );
    locationService.replace({
      pathname: '/',
      search: window.location.search,
      hash: window.location.hash,
      state: { retained: true },
    });
    kioskState.set({ source: 'url', rulesUrl: 'override' });
    const { getByTestId, queryByTestId } = render(<KioskModeManager rulesUrl="default" />);
    expect(getByTestId('close-overlay')).toHaveTextContent('override');
    act(() => getByTestId('close-overlay').click());
    expect(queryByTestId('close-overlay')).toBeNull();
    expect(locationService.getLocation().search).toBe('?kiosk=tv&orgId=1');
    expect(locationService.getLocation().hash).toBe('#anchor');
    expect(locationService.getLocation().state).toEqual({ retained: true });
    act(() => document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk')));
    expect(getByTestId('close-overlay')).toHaveTextContent('default');
  });

  it('switches selection without reporting another surface open', () => {
    kioskState.set({ source: 'url', rulesUrl: 'first' });
    const { getByTestId } = render(<KioskModeManager rulesUrl="default" />);
    act(() => kioskState.set({ source: 'url', rulesUrl: 'second' }));
    expect(getByTestId('close-overlay')).toHaveTextContent('second');
    expect(reportPathfinderSurface).toHaveBeenCalledTimes(1);
  });
});
