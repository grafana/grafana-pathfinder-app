import {
  beginInteractiveNavigation,
  endInteractiveNavigation,
  isInteractiveNavigationInProgress,
  __resetInteractiveNavigationForTesting,
} from './interactive-navigation';

beforeEach(() => {
  __resetInteractiveNavigationForTesting();
});

describe('interactive-navigation flag', () => {
  it('starts inactive', () => {
    expect(isInteractiveNavigationInProgress()).toBe(false);
  });

  it('flips active during a begin/end pair', () => {
    beginInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(true);
    endInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(false);
  });

  it('stays active across nested begin/end pairs', () => {
    beginInteractiveNavigation();
    beginInteractiveNavigation();
    endInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(true);
    endInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(false);
  });

  it('does not underflow if endInteractiveNavigation is called without begin', () => {
    endInteractiveNavigation();
    endInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(false);

    beginInteractiveNavigation();
    expect(isInteractiveNavigationInProgress()).toBe(true);
  });
});
