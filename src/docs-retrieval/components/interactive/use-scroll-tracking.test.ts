import { renderHook } from '@testing-library/react';
import { useScrollTracking } from './use-scroll-tracking';

describe('useScrollTracking', () => {
  beforeEach(() => {
    // Mock document.getElementById
    jest.spyOn(document, 'getElementById').mockReturnValue(null);
    // Mock document.querySelector
    jest.spyOn(document, 'querySelector').mockReturnValue(null);
    // Suppress console.warn for cleaner test output
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should initialize refs to false', () => {
    const { result } = renderHook(() => useScrollTracking({ isRunning: false }));

    expect(result.current.userScrolledRef.current).toBe(false);
    expect(result.current.isProgrammaticScrollRef.current).toBe(false);
  });

  it('should provide a scrollToStep function', () => {
    const { result } = renderHook(() => useScrollTracking({ isRunning: false }));

    expect(typeof result.current.scrollToStep).toBe('function');
  });

  it('should not set up scroll listener when not running', () => {
    const addEventListenerSpy = jest.fn();
    const mockContainer = {
      addEventListener: addEventListenerSpy,
      removeEventListener: jest.fn(),
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    renderHook(() => useScrollTracking({ isRunning: false }));

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('should set up scroll listener when running', () => {
    const addEventListenerSpy = jest.fn();
    const mockContainer = {
      addEventListener: addEventListenerSpy,
      removeEventListener: jest.fn(),
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    renderHook(() => useScrollTracking({ isRunning: true }));

    expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
  });

  it('should not set up scroll listener when container not found', () => {
    const addEventListenerSpy = jest.fn();
    jest.spyOn(document, 'getElementById').mockReturnValue(null);

    renderHook(() => useScrollTracking({ isRunning: true }));

    // Verify no event listener was added when container not found
    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it('should clean up scroll listener on unmount', () => {
    const removeEventListenerSpy = jest.fn();
    const mockContainer = {
      addEventListener: jest.fn(),
      removeEventListener: removeEventListenerSpy,
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    const { unmount } = renderHook(() => useScrollTracking({ isRunning: true }));

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('scrollToStep should not scroll when user has scrolled', () => {
    const { result } = renderHook(() => useScrollTracking({ isRunning: false }));

    // Simulate user scroll
    result.current.userScrolledRef.current = true;

    const mockElement = {
      scrollIntoView: jest.fn(),
    };
    jest.spyOn(document, 'querySelector').mockReturnValue(mockElement as any);

    result.current.scrollToStep('section-1-step-0');

    expect(mockElement.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrollToStep should scroll to step element when found', () => {
    const { result } = renderHook(() => useScrollTracking({ isRunning: false }));

    const mockElement = {
      scrollIntoView: jest.fn(),
    };
    jest.spyOn(document, 'querySelector').mockReturnValue(mockElement as any);

    result.current.scrollToStep('section-1-step-0');

    expect(document.querySelector).toHaveBeenCalledWith('[data-step-id="section-1-step-0"]');
    expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('scrollToStep should handle step element not found', () => {
    const { result } = renderHook(() => useScrollTracking({ isRunning: false }));

    jest.spyOn(document, 'querySelector').mockReturnValue(null);

    // Should not throw
    expect(() => {
      result.current.scrollToStep('section-1-step-0');
    }).not.toThrow();
  });

  it('should update scroll listener when isRunning changes', () => {
    const addEventListenerSpy = jest.fn();
    const removeEventListenerSpy = jest.fn();
    const mockContainer = {
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    const { rerender } = renderHook((props: { isRunning: boolean }) => useScrollTracking(props), {
      initialProps: { isRunning: false },
    });

    expect(addEventListenerSpy).not.toHaveBeenCalled();

    // Start running
    rerender({ isRunning: true });
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

    // Stop running
    rerender({ isRunning: false });
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it('should set userScrolledRef to true when scroll event fires (non-programmatic)', () => {
    let scrollHandler: any;
    const addEventListenerSpy = jest.fn((event, handler) => {
      scrollHandler = handler;
    });
    const mockContainer = {
      addEventListener: addEventListenerSpy,
      removeEventListener: jest.fn(),
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    const { result } = renderHook(() => useScrollTracking({ isRunning: true }));

    expect(result.current.userScrolledRef.current).toBe(false);

    // Simulate scroll event (non-programmatic)
    scrollHandler();

    expect(result.current.userScrolledRef.current).toBe(true);
  });

  it('should not set userScrolledRef when scroll event is programmatic', () => {
    let scrollHandler: any;
    const addEventListenerSpy = jest.fn((event, handler) => {
      scrollHandler = handler;
    });
    const mockContainer = {
      addEventListener: addEventListenerSpy,
      removeEventListener: jest.fn(),
    };
    jest.spyOn(document, 'getElementById').mockReturnValue(mockContainer as any);

    const { result } = renderHook(() => useScrollTracking({ isRunning: true }));

    // Mark as programmatic scroll
    result.current.isProgrammaticScrollRef.current = true;

    // Simulate scroll event
    scrollHandler();

    // Should not have been marked as user scroll
    expect(result.current.userScrolledRef.current).toBe(false);
  });
});
