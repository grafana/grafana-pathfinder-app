import { renderHook, act, waitFor } from '@testing-library/react';
import { useSectionRequirements } from './use-section-requirements';

describe('useSectionRequirements', () => {
  let mockCheckRequirementsFromData: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockCheckRequirementsFromData = jest.fn();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('should initialize with passed=true when no requirements', () => {
    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: undefined,
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    expect(result.current.sectionRequirementsStatus).toEqual({
      checking: false,
      passed: true,
    });
    expect(mockCheckRequirementsFromData).not.toHaveBeenCalled();
  });

  it('should initialize with checking=true when requirements are present', () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    expect(result.current.sectionRequirementsStatus.checking).toBe(true);
  });

  it('should check requirements on mount', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledWith({
        requirements: 'plugin:grafana',
        targetaction: 'section',
        reftarget: 'section-1',
        targetvalue: undefined,
        textContent: 'Test Section',
        tagName: 'section',
      });
    });

    await waitFor(() => {
      expect(result.current.sectionRequirementsStatus).toEqual({
        checking: false,
        passed: true,
      });
    });
  });

  it('should set error when requirements fail', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({
      pass: false,
      error: [{ error: 'Plugin not found' }],
    });

    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(result.current.sectionRequirementsStatus).toEqual({
        checking: false,
        passed: false,
        error: 'Plugin not found',
      });
    });
  });

  it('should use fallback error message when no error details provided', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({
      pass: false,
    });

    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(result.current.sectionRequirementsStatus).toEqual({
        checking: false,
        passed: false,
        error: 'Requirements not met',
      });
    });
  });

  it('should fail open (pass) on error', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockCheckRequirementsFromData.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(result.current.sectionRequirementsStatus).toEqual({
        checking: false,
        passed: true,
      });
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Section requirements check failed:', expect.any(Error));
    consoleWarnSpy.mockRestore();
  });

  it('should re-check requirements periodically (5 second interval)', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(1);
    });

    // Advance timer by 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
    });

    // Advance timer by another 5 seconds
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(3);
    });
  });

  it('should re-check on datasources-changed event', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(1);
    });

    // Dispatch event
    act(() => {
      window.dispatchEvent(new Event('datasources-changed'));
    });

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
    });
  });

  it('should re-check on plugins-changed event', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(1);
    });

    // Dispatch event
    act(() => {
      window.dispatchEvent(new Event('plugins-changed'));
    });

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
    });
  });

  it('should re-check on popstate event', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(1);
    });

    // Dispatch event
    act(() => {
      window.dispatchEvent(new Event('popstate'));
    });

    await waitFor(() => {
      expect(mockCheckRequirementsFromData).toHaveBeenCalledTimes(2);
    });
  });

  it('should clean up event listeners and interval on unmount', async () => {
    mockCheckRequirementsFromData.mockResolvedValue({ pass: true });

    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('datasources-changed', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('plugins-changed', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(clearIntervalSpy).toHaveBeenCalled();

    removeEventListenerSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('should not update state after unmount', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    let resolveCheck: (value: any) => void;
    const checkPromise = new Promise((resolve) => {
      resolveCheck = resolve;
    });
    mockCheckRequirementsFromData.mockReturnValue(checkPromise);

    const { unmount } = renderHook(() =>
      useSectionRequirements({
        requirements: 'plugin:grafana',
        sectionId: 'section-1',
        title: 'Test Section',
        checkRequirementsFromData: mockCheckRequirementsFromData,
      })
    );

    // Unmount before check completes
    unmount();

    // Complete the check after unmount
    await act(async () => {
      resolveCheck!({ pass: true });
      await checkPromise;
    });

    // Should not log React warnings about state updates after unmount
    const reactWarnings = consoleWarnSpy.mock.calls.filter((call) =>
      call[0]?.toString().includes('unmounted component')
    );
    expect(reactWarnings.length).toBe(0);

    consoleWarnSpy.mockRestore();
  });
});
