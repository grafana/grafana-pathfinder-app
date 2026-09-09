import { GuidedHandler } from './guided-handler';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { applyE2ECommentBoxAttributes } from '../e2e-attributes';
import * as dom from '../../lib/dom';
import type { GuidedAction, GuidedRequirementsCheck, GuidedSubstepResult } from '../../types/interactive-actions.types';

jest.mock('../interactive-state-manager');
jest.mock('../navigation-manager');
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
}));
jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../lib/dom', () => {
  const actual = jest.requireActual('../../lib/dom');
  return {
    ...actual,
    querySelectorAllEnhanced: jest.fn(actual.querySelectorAllEnhanced),
    scrollUntilElementFound: jest.fn(actual.scrollUntilElementFound),
  };
});

const actions: Array<GuidedAction['targetAction']> = ['noop', 'formfill', 'hover', 'button', 'highlight'];
const budgets = [30_000, 45_000, 60_000, undefined];
const passed = { pass: true, error: [] };
const unmet = { pass: false, error: [{ requirement: 'has-datasource:prometheus', pass: false }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function addTarget(actionType: GuidedAction['targetAction'] = 'button'): HTMLElement {
  const element = document.createElement(actionType === 'formfill' ? 'input' : 'button');
  element.id = 'target';
  element.textContent = 'Target';
  document.body.appendChild(element);
  return element;
}

async function completeAction(actionType: GuidedAction['targetAction'], element: HTMLElement) {
  if (actionType === 'noop') {
    document.dispatchEvent(new CustomEvent('guided-noop-continue', { detail: { stepIndex: 0 } }));
  } else if (actionType === 'hover') {
    element.dispatchEvent(new MouseEvent('mouseenter'));
    await jest.advanceTimersByTimeAsync(500);
  } else if (actionType === 'formfill') {
    (element as HTMLInputElement).value = 'Grafana';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await jest.advanceTimersByTimeAsync(2800);
  } else {
    element.click();
  }
}

describe('GuidedHandler substep contract', () => {
  let handler: GuidedHandler;
  let navigation: jest.Mocked<NavigationManager>;
  const findTargets = jest.mocked(dom.querySelectorAllEnhanced);
  const lazyScroll = jest.mocked(dom.scrollUntilElementFound);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    jest.clearAllMocks();
    document.body.replaceChildren();
    navigation = new NavigationManager() as jest.Mocked<NavigationManager>;
    navigation.expandParentNavigationSection = jest.fn().mockResolvedValue(true);
    navigation.ensureNavigationOpen = jest.fn().mockResolvedValue(undefined);
    navigation.ensureElementVisible = jest.fn().mockResolvedValue(undefined);
    navigation.clearAllHighlights = jest.fn(() => {
      document.querySelectorAll('.interactive-comment-box').forEach((box) => box.remove());
      document.querySelectorAll('.interactive-guided-active').forEach((element) => {
        element.classList.remove('interactive-guided-active');
      });
    });
    navigation.highlightWithComment = jest.fn(
      async (element, _comment, _cleanup, _steps, _skip, _cancel, _next, _previous, options) => {
        const box = document.createElement('div');
        box.className = 'interactive-comment-box';
        const buttons = document.createElement('div');
        buttons.className = 'interactive-comment-buttons';
        box.appendChild(buttons);
        applyE2ECommentBoxAttributes(box, options);
        document.body.appendChild(box);
        return element;
      }
    );
    handler = new GuidedHandler(new InteractiveStateManager(), navigation, async () => {});
  });

  afterEach(() => {
    handler.cancel();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe.each(actions)('%s', (targetAction) => {
    it.each(budgets)('uses the single %s millisecond budget', async (timeout) => {
      addTarget(targetAction);
      const onSettled = jest.fn();
      const result = handler.executeGuidedStep({ targetAction, refTarget: '#target' }, 0, 1, timeout, undefined, {
        onSettled,
      });
      const effectiveTimeout = timeout ?? 120_000;
      await jest.advanceTimersByTimeAsync(effectiveTimeout - 1);
      expect(onSettled).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe('timeout');
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith({
        index: 0,
        action: targetAction,
        status: 'timeout',
        durationMs: effectiveTimeout,
      });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('rejects authored requirements without an injected checker', async () => {
      const target = addTarget(targetAction);
      const focus = jest.spyOn(target, 'focus');
      const onSettled = jest.fn();
      const result = await handler.executeGuidedStep(
        { targetAction, refTarget: '#target', requirements: ['has-datasource:prometheus'] },
        0,
        1,
        30_000,
        undefined,
        { onSettled }
      );
      expect(result).toBe('error');
      expect(onSettled).toHaveBeenCalledWith({
        index: 0,
        action: targetAction,
        status: 'error',
        durationMs: 0,
      });
      expect(findTargets).not.toHaveBeenCalled();
      expect(navigation.ensureNavigationOpen).not.toHaveBeenCalled();
      expect(navigation.highlightWithComment).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
      expect(document.querySelector('.interactive-comment-box')).toBeNull();
    });

    it('publishes completion before the callback detaches the root', async () => {
      const target = addTarget(targetAction);
      const root = document.createElement('section');
      document.body.appendChild(root);
      const onSettled = jest.fn((record: GuidedSubstepResult) => {
        root.setAttribute('data-test-substep-results', JSON.stringify([record]));
      });
      const onCompleted = jest.fn(() => {
        expect(JSON.parse(root.getAttribute('data-test-substep-results')!)[0].status).toBe('completed');
        root.remove();
      });
      const result = handler.executeGuidedStep({ targetAction, refTarget: '#target' }, 0, 1, 30_000, onCompleted, {
        onSettled,
      });
      await jest.advanceTimersByTimeAsync(0);
      await completeAction(targetAction, target);
      await expect(result).resolves.toBe('completed');
      expect(onCompleted).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(root.isConnected).toBe(false);
      expect(JSON.parse(root.getAttribute('data-test-substep-results')!)).toEqual([
        { index: 0, action: targetAction, status: 'completed', durationMs: expect.any(Number) },
      ]);
    });

    it('corrects the same record when the completion callback throws', async () => {
      const target = addTarget(targetAction);
      const root = document.createElement('section');
      document.body.appendChild(root);
      const order: string[] = [];
      const onSettled = jest.fn((record: GuidedSubstepResult) => {
        order.push(record.status);
        root.setAttribute('data-test-substep-results', JSON.stringify([record]));
      });
      const result = handler.executeGuidedStep(
        { targetAction, refTarget: '#target' },
        0,
        1,
        30_000,
        () => {
          order.push('callback');
          root.remove();
          throw new Error('Completion failed');
        },
        { onSettled }
      );
      await jest.advanceTimersByTimeAsync(0);
      await completeAction(targetAction, target);
      await expect(result).resolves.toBe('error');
      expect(order).toEqual(['completed', 'callback', 'error']);
      expect(JSON.parse(root.getAttribute('data-test-substep-results')!)).toEqual([
        { index: 0, action: targetAction, status: 'error', durationMs: expect.any(Number) },
      ]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('checks requirements before navigation expansion or target resolution', async () => {
    const check = deferred<typeof passed>();
    const checkRequirements = jest.fn(() => check.promise);
    const target = document.createElement('a');
    target.setAttribute('data-testid', 'data-testid Nav menu item');
    target.setAttribute('href', '/alerting/list');
    target.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(target);
    const action: GuidedAction = {
      targetAction: 'highlight',
      refTarget: 'a[data-testid="data-testid Nav menu item"][href="/alerting/list"]',
      requirements: ['has-datasource:prometheus'],
      targetState: 'aria-expanded:true',
      lazyRender: true,
      scrollContainer: '#dashboard',
    };
    const result = handler.executeGuidedStep(action, 0, 1, 45_000, undefined, { checkRequirements });
    await jest.advanceTimersByTimeAsync(0);
    expect(checkRequirements).toHaveBeenCalledWith(action);
    expect(navigation.expandParentNavigationSection).not.toHaveBeenCalled();
    expect(findTargets).not.toHaveBeenCalled();
    check.resolve(passed);
    await jest.advanceTimersByTimeAsync(0);
    expect(navigation.expandParentNavigationSection).toHaveBeenCalledWith('/alerting/list', expect.any(AbortSignal));
    expect(findTargets).toHaveBeenCalled();
    target.click();
    await expect(result).resolves.toBe('completed');
  });

  it('waits for a dynamic mandatory requirement before resolving the target', async () => {
    const target = addTarget();
    const checkRequirements = jest.fn().mockResolvedValueOnce(unmet).mockResolvedValue(passed);
    const onSettled = jest.fn();
    const result = handler.executeGuidedStep(
      { targetAction: 'button', refTarget: '#target', requirements: ['has-datasource:prometheus'] },
      0,
      1,
      30_000,
      undefined,
      { checkRequirements, onSettled }
    );
    await jest.advanceTimersByTimeAsync(1999);
    expect(findTargets).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(checkRequirements).toHaveBeenCalledTimes(2);
    expect(navigation.highlightWithComment).toHaveBeenCalled();
    target.click();
    await expect(result).resolves.toBe('completed');
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 2000 }));
  });

  it('times out unmet mandatory requirements without target side effects', async () => {
    addTarget();
    const checkRequirements = jest.fn().mockResolvedValue(unmet);
    const onSettled = jest.fn();
    const result = handler.executeGuidedStep(
      { targetAction: 'button', refTarget: '#target', requirements: 'has-datasource:prometheus', lazyRender: true },
      0,
      1,
      60_000,
      undefined,
      { checkRequirements, onSettled }
    );
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBe('timeout');
    expect(checkRequirements.mock.calls.length).toBeGreaterThan(1);
    expect(findTargets).not.toHaveBeenCalled();
    expect(lazyScroll).not.toHaveBeenCalled();
    expect(navigation.ensureNavigationOpen).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ status: 'timeout', durationMs: 60_000 }));
  });

  it('keeps an unmet optional precheck as a fast skip', async () => {
    addTarget();
    const checkRequirements = jest.fn().mockResolvedValue(unmet);
    const onSettled = jest.fn();
    const onCompleted = jest.fn();
    await expect(
      handler.executeGuidedStep(
        {
          targetAction: 'button',
          refTarget: '#target',
          requirements: ['has-datasource:prometheus'],
          isSkippable: true,
        },
        0,
        1,
        30_000,
        onCompleted,
        { checkRequirements, onSettled }
      )
    ).resolves.toBe('skipped');
    expect(checkRequirements).toHaveBeenCalledTimes(1);
    expect(findTargets).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'button', status: 'skipped', durationMs: 0 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves the injected checker policy for unknown requirements', async () => {
    const target = addTarget();
    const checkRequirements = jest.fn().mockResolvedValue(passed);
    const result = handler.executeGuidedStep(
      { targetAction: 'button', refTarget: '#target', requirements: 'unknown-author-token' },
      0,
      1,
      30_000,
      undefined,
      { checkRequirements }
    );
    await jest.advanceTimersByTimeAsync(0);
    target.click();
    await expect(result).resolves.toBe('completed');
    expect(checkRequirements).toHaveBeenCalledTimes(1);
  });

  it('shares the deadline across prechecks, resolution, preparation, and interaction', async () => {
    const checkRequirements = jest.fn(
      () => new Promise<typeof passed>((resolve) => setTimeout(() => resolve(passed), 8000))
    );
    setTimeout(() => addTarget(), 18_000);
    navigation.ensureNavigationOpen.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 3000)));
    navigation.ensureElementVisible.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 2000)));
    const onSettled = jest.fn();
    const result = handler.executeGuidedStep(
      { targetAction: 'button', refTarget: '#target', requirements: 'has-datasource:prometheus' },
      0,
      1,
      30_000,
      undefined,
      { checkRequirements, onSettled }
    );
    await jest.advanceTimersByTimeAsync(7999);
    expect(findTargets).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(15_001);
    expect(navigation.highlightWithComment).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(6999);
    expect(onSettled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('timeout');
    expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'button', status: 'timeout', durationMs: 30_000 });
  });

  it.each(['requirements', 'expansion', 'resolution', 'navigation', 'visibility', 'highlight'] as const)(
    'cancels during %s without later target effects',
    async (phase) => {
      const wait = deferred<void>();
      const target = phase === 'resolution' ? document.createElement('button') : addTarget('formfill');
      target.setAttribute('data-testid', 'data-testid Nav menu item');
      target.setAttribute('href', '/alerting/list');
      const refTarget =
        phase === 'expansion' ? '[data-testid="data-testid Nav menu item"][href="/alerting/list"]' : '#target';
      if (phase === 'expansion') {
        target.replaceWith(Object.assign(document.createElement('a'), { id: 'target' }));
        navigation.expandParentNavigationSection.mockImplementation(async () => {
          await wait.promise;
          return true;
        });
      } else if (phase === 'navigation') {
        navigation.ensureNavigationOpen.mockReturnValue(wait.promise);
      } else if (phase === 'visibility') {
        navigation.ensureElementVisible.mockReturnValue(wait.promise);
      } else if (phase === 'highlight') {
        navigation.highlightWithComment.mockImplementation(async () => {
          await wait.promise;
          return target;
        });
      }
      const checkRequirements = jest.fn(async () => {
        if (phase === 'requirements') {
          await wait.promise;
        }
        return passed;
      });
      const onSettled = jest.fn();
      const onCompleted = jest.fn();
      const focus = jest.spyOn(target, 'focus');
      const result = handler.executeGuidedStep(
        {
          targetAction: 'formfill',
          refTarget: phase === 'expansion' ? `a${refTarget}` : refTarget,
          requirements: 'has-datasource:prometheus',
        },
        0,
        1,
        30_000,
        onCompleted,
        { checkRequirements, onSettled }
      );
      await jest.advanceTimersByTimeAsync(500);
      handler.cancel();
      await expect(result).resolves.toBe('cancelled');
      const highlightCalls = navigation.highlightWithComment.mock.calls.length;
      const focusCalls = focus.mock.calls.length;
      wait.resolve();
      await jest.advanceTimersByTimeAsync(60_000);
      expect(navigation.highlightWithComment).toHaveBeenCalledTimes(highlightCalls);
      expect(focus).toHaveBeenCalledTimes(focusCalls);
      expect(target).not.toHaveClass('interactive-guided-active');
      expect(onCompleted).not.toHaveBeenCalled();
      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'formfill', status: 'cancelled', durationMs: 500 });
    }
  );

  it.each(['event', 'escape'] as const)('accepts %s cancellation during a pending checker', async (method) => {
    const onSettled = jest.fn();
    const result = handler.executeGuidedStep(
      { targetAction: 'noop', requirements: ['has-datasource:prometheus'] },
      0,
      1,
      30_000,
      undefined,
      { checkRequirements: () => new Promise(() => {}), onSettled }
    );
    await jest.advanceTimersByTimeAsync(500);
    if (method === 'event') {
      document.dispatchEvent(new CustomEvent('guided-step-cancelled', { detail: { stepIndex: 0 } }));
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
    await expect(result).resolves.toBe('cancelled');
    expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'noop', status: 'cancelled', durationMs: 500 });
    expect(document.querySelector('.interactive-comment-box')).toBeNull();
  });

  it('ignores a late checker result after its deadline', async () => {
    const check = deferred<typeof passed>();
    const onSettled = jest.fn();
    const result = handler.executeGuidedStep(
      { targetAction: 'button', refTarget: '#target', requirements: 'has-datasource:prometheus' },
      0,
      1,
      30_000,
      undefined,
      { checkRequirements: () => check.promise, onSettled }
    );
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toBe('timeout');
    addTarget();
    check.resolve(passed);
    await jest.advanceTimersByTimeAsync(0);
    expect(findTargets).not.toHaveBeenCalled();
    expect(navigation.ensureNavigationOpen).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('emits each consecutive fast skip without a comment box', async () => {
    const onSettled = jest.fn();
    for (let index = 0; index < 2; index++) {
      await expect(
        handler.executeGuidedStep(
          { targetAction: 'highlight', refTarget: '#missing', isSkippable: true },
          index,
          2,
          30_000,
          undefined,
          { onSettled }
        )
      ).resolves.toBe('skipped');
    }
    expect(onSettled.mock.calls.map(([record]) => record)).toEqual([
      { index: 0, action: 'highlight', status: 'skipped', durationMs: 0 },
      { index: 1, action: 'highlight', status: 'skipped', durationMs: 0 },
    ]);
    expect(navigation.highlightWithComment).not.toHaveBeenCalled();
  });

  it.each([true, false])('exposes authored noop skippability %s and index zero', async (isSkippable) => {
    const result = handler.executeGuidedStep({ targetAction: 'noop', isSkippable }, 0, 1, 30_000);
    await jest.advanceTimersByTimeAsync(0);
    const box = document.querySelector('.interactive-comment-box');
    expect(box).toHaveAttribute('data-test-substep-index', '0');
    expect(box).toHaveAttribute('data-test-substep-skippable', String(isSkippable));
    expect(box).toHaveAttribute('data-test-action', 'noop');
    handler.cancel();
    await expect(result).resolves.toBe('cancelled');
  });

  describe('lazy target discovery', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.id = 'dashboard';
      Object.defineProperties(container, {
        clientHeight: { value: 500 },
        scrollHeight: { value: 500 },
      });
      container.scrollBy = jest.fn();
      document.body.appendChild(container);
    });

    const action: GuidedAction = {
      targetAction: 'button',
      refTarget: '#target',
      requirements: 'exists-reftarget',
      lazyRender: true,
      scrollContainer: '#dashboard',
    };
    const checkTarget: GuidedRequirementsCheck = async (step) => {
      const check = await dom.reftargetExistsCheck(step.refTarget!, step.targetAction, step);
      return { pass: check.pass, error: [check] };
    };

    it('uses the checker lazy-scroll hint once and then rechecks the target', async () => {
      container.scrollBy = jest.fn(() => {
        addTarget();
      });
      const checkRequirements = jest.fn(checkTarget);
      const result = handler.executeGuidedStep(action, 0, 1, 30_000, undefined, { checkRequirements });
      await jest.advanceTimersByTimeAsync(350);
      expect(checkRequirements).toHaveBeenCalledTimes(2);
      expect(lazyScroll).toHaveBeenCalledTimes(1);
      expect(lazyScroll).toHaveBeenCalledWith('#target', {
        scrollContainerSelector: '#dashboard',
        signal: expect.any(AbortSignal),
        deadline: 31_000,
      });
      expect(container.scrollBy).toHaveBeenCalledTimes(1);
      document.querySelector<HTMLButtonElement>('#target')!.click();
      await expect(result).resolves.toBe('completed');
    });

    it('does not scroll while another mandatory requirement remains unmet', async () => {
      let ready = false;
      const checkRequirements = jest.fn(async (step: GuidedAction) => {
        const target = await checkTarget(step);
        return ready ? target : { pass: false, error: [...target.error, ...unmet.error] };
      });
      container.scrollBy = jest.fn(() => {
        addTarget();
      });
      const result = handler.executeGuidedStep(action, 0, 1, 30_000, undefined, { checkRequirements });
      await jest.advanceTimersByTimeAsync(1999);
      expect(lazyScroll).not.toHaveBeenCalled();
      ready = true;
      await jest.advanceTimersByTimeAsync(351);
      expect(lazyScroll).toHaveBeenCalledTimes(1);
      document.querySelector<HTMLButtonElement>('#target')!.click();
      await expect(result).resolves.toBe('completed');
    });

    it.each([true, false])('does not repeat lazy discovery with requirements %s', async (withRequirements) => {
      const result = handler.executeGuidedStep(
        { ...action, requirements: withRequirements ? action.requirements : undefined },
        0,
        1,
        30_000,
        undefined,
        { checkRequirements: checkTarget }
      );
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(result).resolves.toBe('timeout');
      expect(lazyScroll).toHaveBeenCalledTimes(1);
      expect(container.scrollBy).toHaveBeenCalledTimes(1);
      expect(navigation.highlightWithComment).not.toHaveBeenCalled();
    });

    it('skips an optional missing lazy target after its one discovery pass', async () => {
      const onSettled = jest.fn();
      const result = handler.executeGuidedStep({ ...action, isSkippable: true }, 0, 1, 30_000, undefined, {
        checkRequirements: checkTarget,
        onSettled,
      });
      await jest.advanceTimersByTimeAsync(350);
      await expect(result).resolves.toBe('skipped');
      expect(lazyScroll).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'button', status: 'skipped', durationMs: 350 });
    });

    it('cancels lazy discovery during the render wait', async () => {
      const result = handler.executeGuidedStep(action, 0, 1, 30_000, undefined, {
        checkRequirements: checkTarget,
      });
      await jest.advanceTimersByTimeAsync(100);
      handler.cancel();
      await expect(result).resolves.toBe('cancelled');
      await jest.advanceTimersByTimeAsync(5000);
      expect(container.scrollBy).toHaveBeenCalledTimes(1);
      expect(lazyScroll.mock.calls[0]![1]!.signal!.aborted).toBe(true);
      expect(navigation.ensureNavigationOpen).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('spends only the remaining deadline on lazy discovery', async () => {
      const checkRequirements: GuidedRequirementsCheck = async (step) => {
        await new Promise((resolve) => setTimeout(resolve, 29_900));
        return checkTarget(step);
      };
      const onSettled = jest.fn();
      const result = handler.executeGuidedStep(action, 0, 1, 30_000, undefined, { checkRequirements, onSettled });
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(result).resolves.toBe('timeout');
      expect(lazyScroll).toHaveBeenCalledTimes(1);
      expect(container.scrollBy).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith({ index: 0, action: 'button', status: 'timeout', durationMs: 30_000 });
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
