const mockGetIsSidebarMounted = jest.fn();
jest.mock('../../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: () => mockGetIsSidebarMounted() },
}));

import { autoLaunchChannel } from '../../../global-state/auto-launch';
import { installAutoLaunchOnMount } from './auto-launch';

const DOC_PAGE = { url: 'bundled:onboarding', title: 'Onboarding', type: 'docs-page' as const };

describe('installAutoLaunchOnMount', () => {
  const unsubscribers: Array<() => void> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    // Drain mount listeners and latched values left by earlier tests.
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    document.dispatchEvent(new Event('pathfinder-panel-mounted'));
    jest.runAllTimers();
    autoLaunchChannel.subscribe(() => {})();
    mockGetIsSidebarMounted.mockReturnValue(false);
  });

  afterEach(() => {
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    jest.useRealTimers();
  });

  function capture(): jest.Mock {
    const handler = jest.fn();
    unsubscribers.push(autoLaunchChannel.subscribe(handler));
    return handler;
  }

  function mount(event: 'sidebar' | 'panel') {
    mockGetIsSidebarMounted.mockReturnValue(true);
    if (event === 'sidebar') {
      window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    } else {
      document.dispatchEvent(new Event('pathfinder-panel-mounted'));
    }
  }

  it.each(['sidebar', 'panel'] as const)('emits the guide once the %s mounts', (surface) => {
    const handler = capture();
    installAutoLaunchOnMount(DOC_PAGE);
    mount(surface);
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ ...DOC_PAGE, source: 'auto_open_guide_experiment' });
  });

  it('dispatches immediately when a surface is already mounted', () => {
    mockGetIsSidebarMounted.mockReturnValue(true);
    const handler = capture();
    installAutoLaunchOnMount(DOC_PAGE);
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits once when both surfaces mount', () => {
    const handler = capture();
    installAutoLaunchOnMount(DOC_PAGE);
    mount('sidebar');
    mount('panel');
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips the emit when the surface unmounts before the delay ends', () => {
    const handler = capture();
    installAutoLaunchOnMount(DOC_PAGE);
    mount('sidebar');
    mockGetIsSidebarMounted.mockReturnValue(false);
    jest.advanceTimersByTime(500);

    expect(handler).not.toHaveBeenCalled();
  });

  it('signals a pending auto-launch synchronously on mount', () => {
    const pending = jest.fn();
    document.addEventListener('pathfinder-auto-launch-pending', pending);
    installAutoLaunchOnMount(DOC_PAGE);
    mount('sidebar');
    document.removeEventListener('pathfinder-auto-launch-pending', pending);

    expect(pending).toHaveBeenCalledTimes(1);
  });
});
