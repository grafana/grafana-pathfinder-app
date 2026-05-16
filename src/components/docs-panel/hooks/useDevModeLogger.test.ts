import { renderHook, act } from '@testing-library/react';
import { useDevModeLogger } from './useDevModeLogger';

describe('useDevModeLogger', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emits to console.log when isDevMode=true', () => {
    const { result } = renderHook(({ devMode }) => useDevModeLogger(devMode), {
      initialProps: { devMode: true },
    });

    act(() => {
      result.current('hello', 42);
    });

    expect(consoleSpy).toHaveBeenCalledWith('hello', 42);
  });

  it('does not emit when isDevMode=false', () => {
    const { result } = renderHook(({ devMode }) => useDevModeLogger(devMode), {
      initialProps: { devMode: false },
    });

    act(() => {
      result.current('hello');
    });

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('returns a referentially-stable callback across re-renders', () => {
    const { result, rerender } = renderHook(({ devMode }) => useDevModeLogger(devMode), {
      initialProps: { devMode: true },
    });
    const first = result.current;
    rerender({ devMode: true });
    rerender({ devMode: false });
    rerender({ devMode: true });
    expect(result.current).toBe(first);
  });

  it('picks up the latest isDevMode value without callback identity changing', () => {
    const { result, rerender } = renderHook(({ devMode }) => useDevModeLogger(devMode), {
      initialProps: { devMode: true },
    });
    const stableCallback = result.current;

    act(() => {
      stableCallback('one');
    });
    expect(consoleSpy).toHaveBeenCalledWith('one');

    rerender({ devMode: false });
    act(() => {
      stableCallback('two');
    });
    expect(consoleSpy).toHaveBeenCalledTimes(1); // still 1; 'two' was suppressed

    rerender({ devMode: true });
    act(() => {
      stableCallback('three');
    });
    expect(consoleSpy).toHaveBeenCalledWith('three');
  });
});
