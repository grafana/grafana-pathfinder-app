import { NavigationManager } from './navigation-manager';
import { waitForReactUpdates } from '../lib/async-utils';

jest.mock('../lib/async-utils', () => ({ waitForReactUpdates: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../lib/dom', () => ({
  ...jest.requireActual('../lib/dom'),
  isElementVisible: () => true,
  getStickyHeaderOffset: () => 0,
  getScrollParent: () => document.documentElement,
  getVisibleHighlightTarget: (element: HTMLElement) => element,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('NavigationManager cancellation', () => {
  let navigation: NavigationManager;
  let target: HTMLButtonElement;
  let controller: AbortController;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    document.body.replaceChildren();
    navigation = new NavigationManager();
    controller = new AbortController();
    target = document.createElement('button');
    target.scrollIntoView = jest.fn();
    target.getBoundingClientRect = jest.fn(() => ({
      top: 2000,
      left: 100,
      bottom: 2100,
      right: 200,
      width: 100,
      height: 100,
      x: 100,
      y: 2000,
      toJSON: () => ({}),
    }));
    document.body.appendChild(target);
    jest.mocked(waitForReactUpdates).mockResolvedValue(undefined);
  });

  afterEach(() => {
    controller.abort();
    navigation.clearAllHighlights();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not scroll or open navigation with an aborted signal', async () => {
    const openNavigation = jest.spyOn(navigation, 'openAndDockNavigation');
    controller.abort();
    await navigation.ensureElementVisible(target, controller.signal);
    await navigation.ensureNavigationOpen(target, controller.signal);
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    expect(openNavigation).toHaveBeenCalledWith(target, expect.objectContaining({ signal: controller.signal }));
  });

  it('releases a pending scroll wait on cancellation', async () => {
    const result = navigation.ensureElementVisible(target, controller.signal);
    document.documentElement.dispatchEvent(new Event('scroll'));
    await jest.advanceTimersByTimeAsync(500);
    controller.abort();
    await expect(result).resolves.toBeUndefined();
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['navigation', 'visibility'] as const)(
    'does not create overlays after pending %s is cancelled',
    async (phase) => {
      const wait = deferred();
      const openNavigation = jest.spyOn(navigation, 'ensureNavigationOpen').mockResolvedValue(undefined);
      const makeVisible = jest.spyOn(navigation, 'ensureElementVisible').mockResolvedValue(undefined);
      if (phase === 'navigation') {
        openNavigation.mockReturnValue(wait.promise);
      } else {
        makeVisible.mockReturnValue(wait.promise);
      }
      const result = navigation.highlightWithComment(
        target,
        'Click the button.',
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { signal: controller.signal }
      );
      await jest.advanceTimersByTimeAsync(0);
      controller.abort();
      wait.resolve();
      await expect(result).resolves.toBe(target);
      expect(document.querySelector('.interactive-comment-box')).toBeNull();
      expect(document.querySelector('.interactive-highlight-outline')).toBeNull();
      if (phase === 'navigation') {
        expect(makeVisible).not.toHaveBeenCalled();
      }
    }
  );

  it('does not expand a parent after cancelled target polling', async () => {
    const parent = document.createElement('a');
    parent.setAttribute('data-testid', 'data-testid Nav menu item');
    parent.setAttribute('href', '/alerting');
    const expand = document.createElement('button');
    expand.setAttribute('aria-label', 'Expand section: Alerting');
    expand.setAttribute('aria-expanded', 'false');
    expand.click = jest.fn();
    document.body.append(parent, expand);
    const result = navigation.expandParentNavigationSection('/alerting/list', controller.signal);
    await jest.advanceTimersByTimeAsync(300);
    controller.abort();
    await expect(result).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(expand.click).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not dock after a cancelled React update wait', async () => {
    const wait = deferred();
    jest.mocked(waitForReactUpdates).mockReturnValue(wait.promise);
    const toggle = document.createElement('button');
    toggle.id = 'mega-menu-toggle';
    const dock = document.createElement('button');
    dock.id = 'dock-menu-button';
    dock.setAttribute('aria-label', 'Dock menu');
    dock.click = jest.fn();
    document.body.append(toggle, dock);
    const result = navigation.openAndDockNavigation(undefined, { signal: controller.signal });
    controller.abort();
    wait.resolve();
    await expect(result).resolves.toBeUndefined();
    expect(dock.click).not.toHaveBeenCalled();
  });

  it('does not dock a button that appears after cancelled polling', async () => {
    const toggle = document.createElement('button');
    toggle.id = 'mega-menu-toggle';
    document.body.appendChild(toggle);
    const result = navigation.openAndDockNavigation(undefined, { signal: controller.signal });
    await jest.advanceTimersByTimeAsync(300);
    controller.abort();
    const dock = document.createElement('button');
    dock.id = 'dock-menu-button';
    dock.click = jest.fn();
    document.body.appendChild(dock);
    await expect(result).resolves.toBeUndefined();
    await jest.advanceTimersByTimeAsync(5000);
    expect(dock.click).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops expansion before the next button after cancellation', async () => {
    const first = document.createElement('button');
    const second = document.createElement('button');
    for (const button of [first, second]) {
      button.setAttribute('aria-label', 'Expand section: Alerting');
      button.setAttribute('aria-expanded', 'false');
      document.body.appendChild(button);
    }
    first.click = jest.fn(() => controller.abort());
    second.click = jest.fn();
    await expect(navigation.expandAllNavigationSections(controller.signal)).resolves.toBe(false);
    expect(first.click).toHaveBeenCalledTimes(1);
    expect(second.click).not.toHaveBeenCalled();
  });
});
