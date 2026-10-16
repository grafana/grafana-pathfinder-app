import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { panelModeManager } from '../../global-state/panel-mode';
import { FloatingPanel } from './FloatingPanel';

const frames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

describe('floating panel navigation layout bounds', () => {
  const preferred = { x: 50, y: 50, width: 400, height: 400 };
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  let obstacle: HTMLDivElement;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    jest.spyOn(panelModeManager, 'getPanelGeometry').mockReturnValue(preferred);
    jest.spyOn(panelModeManager, 'setPanelGeometry').mockImplementation(() => {});
    obstacle = document.createElement('div');
    obstacle.setAttribute('role', 'dialog');
    obstacle.style.opacity = '1';
    obstacle.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800 }) as DOMRect;
  });

  afterEach(() => {
    obstacle.remove();
    jest.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });

  function mountPanel() {
    return render(
      <FloatingPanel title="Guide" hasActiveGuide={false} onSwitchToSidebar={() => {}} onClose={() => {}}>
        <div data-testid="long-guide" style={{ height: 4000 }}>
          Long guide
        </div>
      </FloatingPanel>
    );
  }

  it('contains long content and keeps resizing available when navigation introduces an overlapping side panel', async () => {
    const mounted = mountPanel();
    await act(async () => {
      document.body.appendChild(obstacle);
      document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed'));
      await frames();
    });
    const panel = screen.getByLabelText('Interactive learning floating panel');
    expect(panel).toHaveAttribute('data-panel-state', 'compact');
    expect(panel).toHaveStyle({ maxHeight: 'min(400px, calc(100dvh - 50px))' });
    expect(screen.getByTestId('long-guide').parentElement).toHaveStyle({ overflow: 'auto', minHeight: '0' });
    expect(panel.querySelector('[data-testid="floating-panel-resize"]')).not.toBeNull();

    await act(async () => {
      obstacle.remove();
      document.dispatchEvent(new CustomEvent('pathfinder-modal-state-changed'));
      await frames();
    });
    expect(panel).toHaveAttribute('data-panel-state', 'full');
    expect(panel).toHaveStyle({ height: '400px' });

    act(() => document.dispatchEvent(new CustomEvent('pathfinder-floating-compact')));
    mounted.unmount();
    mountPanel();
    expect(screen.getByLabelText('Interactive learning floating panel')).toHaveAttribute('data-panel-state', 'full');
    expect(screen.getByLabelText('Interactive learning floating panel')).toHaveStyle({ height: '400px' });
  });

  it('fits below minimum viewport dimensions without persisting automatic shrink', () => {
    mountPanel();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
      fireEvent(window, new Event('resize'));
    });
    expect(screen.getByLabelText('Interactive learning floating panel')).toHaveStyle({
      left: '0px',
      top: '0px',
      width: '300px',
      height: '240px',
    });
    expect(panelModeManager.setPanelGeometry).not.toHaveBeenCalled();
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      fireEvent(window, new Event('resize'));
    });
    expect(screen.getByLabelText('Interactive learning floating panel')).toHaveStyle({ height: '400px', top: '50px' });
  });
});
