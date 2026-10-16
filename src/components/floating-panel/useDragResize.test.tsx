import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { panelModeManager } from '../../global-state/panel-mode';
import { useDragResize } from './useDragResize';

it('keeps the resize corner inside the usable viewport when browser scrollbars reduce it', () => {
  jest.spyOn(panelModeManager, 'getPanelGeometry').mockReturnValue({ x: 50, y: 50, width: 800, height: 800 });
  jest.spyOn(panelModeManager, 'setPanelGeometry').mockImplementation(() => {});
  const clientWidth = jest.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(485);
  const clientHeight = jest.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(685);
  try {
    const { result } = renderHook(() => useDragResize());
    expect(result.current.geometry.x + result.current.geometry.width).toBeLessThanOrEqual(485);
    expect(result.current.geometry.y + result.current.geometry.height).toBeLessThanOrEqual(685);
    clientWidth.mockReturnValue(385);
    clientHeight.mockReturnValue(485);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.geometry.x + result.current.geometry.width).toBeLessThanOrEqual(385);
    expect(result.current.geometry.y + result.current.geometry.height).toBeLessThanOrEqual(485);
    expect(panelModeManager.setPanelGeometry).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
  }
});

it('keeps a bottom-right resize inside the remaining viewport and persists the bounded size', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
  jest.spyOn(panelModeManager, 'getPanelGeometry').mockReturnValue({ x: 300, y: 200, width: 400, height: 400 });
  const persist = jest.spyOn(panelModeManager, 'setPanelGeometry').mockImplementation(() => {});
  try {
    const { result } = renderHook(() => useDragResize());
    const pointer = (clientX: number, clientY: number) =>
      ({
        button: 0,
        clientX,
        clientY,
        pointerId: 1,
        target: { setPointerCapture: () => {} },
        preventDefault: () => {},
        stopPropagation: () => {},
      }) as unknown as React.PointerEvent;
    act(() => result.current.resize.onPointerDown(pointer(700, 600)));
    act(() => result.current.resize.onPointerMove(pointer(2000, 2000)));
    expect(result.current.geometry).toEqual({ x: 300, y: 200, width: 700, height: 500 });
    act(() => result.current.resize.onPointerUp());
    expect(persist).toHaveBeenLastCalledWith({ x: 300, y: 200, width: 700, height: 500 });
  } finally {
    jest.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }
});
