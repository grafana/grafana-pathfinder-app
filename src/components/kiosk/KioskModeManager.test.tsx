import React from 'react';
import { render, act } from '@testing-library/react';
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
  KioskOverlay: ({ onClose }: { onClose: () => void }) => <button data-testid="close-overlay" onClick={onClose} />,
}));

describe('KioskModeManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
