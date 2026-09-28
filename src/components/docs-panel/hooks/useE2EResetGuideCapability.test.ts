import { act, renderHook } from '@testing-library/react';

import { resetContentKeyForTests, setActiveTabUrl } from '../../../global-state/content-key';
import { resetGuideProgress } from './resetGuideProgress';
import {
  E2E_GUIDE_URL,
  PATHFINDER_E2E_CONTROL_VERSION,
  useE2EResetGuideCapability,
} from './useE2EResetGuideCapability';

jest.mock('./resetGuideProgress');

const mockResetGuideProgress = resetGuideProgress as jest.MockedFunction<typeof resetGuideProgress>;

describe('useE2EResetGuideCapability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetGuideProgress.mockResolvedValue(undefined);
    resetContentKeyForTests();
    delete window.__pathfinderE2E;
    delete window.__DocsPluginActiveTabUrl;
  });

  afterEach(() => {
    resetContentKeyForTests();
    delete window.__pathfinderE2E;
    delete window.__DocsPluginActiveTabUrl;
  });

  it('exposes version 1 only for the exact E2E guide URL', () => {
    setActiveTabUrl(E2E_GUIDE_URL);
    renderHook(() =>
      useE2EResetGuideCapability({
        activeTabCurrentUrl: E2E_GUIDE_URL,
        activeTabBaseUrl: E2E_GUIDE_URL,
      })
    );

    expect(window.__pathfinderE2E?.version).toBe(PATHFINDER_E2E_CONTROL_VERSION);
  });

  it.each(['bundled:e2e-test/', 'bundled:e2e-test?copy=1', 'bundled:other-guide', undefined])(
    'does not expose the control for %s',
    (activeTabCurrentUrl) => {
      renderHook(() =>
        useE2EResetGuideCapability({
          activeTabCurrentUrl,
          activeTabBaseUrl: activeTabCurrentUrl,
        })
      );

      expect(window.__pathfinderE2E).toBeUndefined();
    }
  );

  it('uses the parameterless reset operation without reloading content', async () => {
    setActiveTabUrl(E2E_GUIDE_URL);
    renderHook(() =>
      useE2EResetGuideCapability({
        activeTabCurrentUrl: E2E_GUIDE_URL,
        activeTabBaseUrl: E2E_GUIDE_URL,
      })
    );

    await act(() => window.__pathfinderE2E?.resetActiveGuide());

    expect(mockResetGuideProgress).toHaveBeenCalledWith(E2E_GUIDE_URL);
  });

  it('uses the production active-tab window global for the reset guard', async () => {
    window.__DocsPluginActiveTabUrl = E2E_GUIDE_URL;
    renderHook(() =>
      useE2EResetGuideCapability({
        activeTabCurrentUrl: E2E_GUIDE_URL,
        activeTabBaseUrl: E2E_GUIDE_URL,
      })
    );

    await act(() => window.__pathfinderE2E?.resetActiveGuide());

    expect(mockResetGuideProgress).toHaveBeenCalledWith(E2E_GUIDE_URL);
  });

  it('removes the control when another tab becomes active', () => {
    setActiveTabUrl(E2E_GUIDE_URL);
    const { rerender } = renderHook(
      (currentUrl?: string) => useE2EResetGuideCapability({ activeTabCurrentUrl: currentUrl }),
      { initialProps: E2E_GUIDE_URL }
    );

    setActiveTabUrl('bundled:other-guide');
    rerender('bundled:other-guide');

    expect(window.__pathfinderE2E).toBeUndefined();
  });

  it('removes the control when the panel unmounts', () => {
    setActiveTabUrl(E2E_GUIDE_URL);
    const { unmount } = renderHook(() =>
      useE2EResetGuideCapability({
        activeTabCurrentUrl: E2E_GUIDE_URL,
      })
    );

    unmount();

    expect(window.__pathfinderE2E).toBeUndefined();
  });

  it('rejects a retained control after the active guide changes', async () => {
    setActiveTabUrl(E2E_GUIDE_URL);
    const { rerender } = renderHook(
      (currentUrl?: string) => useE2EResetGuideCapability({ activeTabCurrentUrl: currentUrl }),
      { initialProps: E2E_GUIDE_URL }
    );
    const retainedControl = window.__pathfinderE2E;

    setActiveTabUrl('bundled:other-guide');
    rerender('bundled:other-guide');

    await expect(retainedControl?.resetActiveGuide()).rejects.toThrow('The E2E guide is no longer active');
    expect(mockResetGuideProgress).not.toHaveBeenCalled();
  });
});
