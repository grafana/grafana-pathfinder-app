/**
 * Unit tests for the runner lifecycle fixes in execution.ts:
 * 1. Skip sync (clickSkipButtonAndSync)
 * 2. Guided readiness (waitForGuidedCommentBoxReady)
 * 3. Reload/detached-step handling (runGuidedSubstepLoop)
 * 4. Late no-op completion / bounded scroll (scrollStepIntoView)
 *
 * @see tests/e2e-runner/utils/guide-runner/execution.ts
 */

jest.mock('@playwright/test', () => {
  const readState = async (locator: { getAttribute: (name: string) => Promise<string | null> }) =>
    locator.getAttribute('data-test-step-state');

  return {
    Page: jest.fn(),
    Locator: jest.fn(),
    test: jest.fn(),
    expect: (locator: { getAttribute: (name: string) => Promise<string | null> }) => {
      const poll = async (matches: (value: string | null) => boolean, opts?: { timeout?: number }) => {
        const timeout = opts?.timeout ?? 5000;
        const deadline = Date.now() + timeout;
        for (;;) {
          const value = await readState(locator);
          if (matches(value)) {
            return;
          }
          if (Date.now() >= deadline) {
            throw new Error('Timed out waiting for attribute');
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      };
      return {
        toHaveAttribute: (_attr: string, value: string, opts?: { timeout?: number }) =>
          poll((current) => current === value, opts),
        not: {
          toHaveAttribute: (_attr: string, value: string, opts?: { timeout?: number }) =>
            poll((current) => current !== value, opts),
        },
      };
    },
  };
});

import type { Locator, Page } from '@playwright/test';

import {
  scrollStepIntoView,
  clickSkipButtonAndSync,
  waitForGuidedCommentBoxReady,
  runGuidedSubstepLoop,
} from './execution';
import { SCROLL_INTO_VIEW_TIMEOUT_MS, GUIDED_RELOAD_LOAD_TIMEOUT_MS } from './constants';
import type { TestableStep } from './types';

function createTestableStep(overrides: Partial<TestableStep> = {}): TestableStep {
  return {
    stepId: 'test-step-1',
    index: 0,
    skippable: false,
    hasDoItButton: true,
    hasShowMeButton: false,
    isPreCompleted: false,
    isMultistep: false,
    internalActionCount: 0,
    isGuided: true,
    guidedStepCount: 1,
    locator: {} as unknown as TestableStep['locator'],
    ...overrides,
  };
}

function createLocator(overrides: Partial<Record<string, jest.Mock>> = {}): Locator {
  return {
    count: jest.fn().mockResolvedValue(1),
    isVisible: jest.fn().mockResolvedValue(true),
    getAttribute: jest.fn().mockResolvedValue(null),
    click: jest.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    hover: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    first: jest.fn(),
    filter: jest.fn(),
    locator: jest.fn(),
    getByRole: jest.fn(),
    waitFor: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Locator;
}

describe('scrollStepIntoView', () => {
  it('bounds scrollIntoViewIfNeeded with the scroll timeout', async () => {
    const stepElement = createLocator();
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepElement),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    await scrollStepIntoView(page, 'step-1', 0);

    expect(stepElement.scrollIntoViewIfNeeded).toHaveBeenCalledWith({ timeout: SCROLL_INTO_VIEW_TIMEOUT_MS });
  });

  it('accepts an explicit scroll timeout override', async () => {
    const stepElement = createLocator();
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepElement),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    await scrollStepIntoView(page, 'step-1', 0, 1234);

    expect(stepElement.scrollIntoViewIfNeeded).toHaveBeenCalledWith({ timeout: 1234 });
  });
});

describe('clickSkipButtonAndSync', () => {
  it('does nothing when no Skip control is present', async () => {
    const skipButton = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = {
      getByTestId: jest.fn().mockReturnValue(skipButton),
    } as unknown as Page;

    await clickSkipButtonAndSync(page, 'step-1', 100);

    expect(skipButton.click).not.toHaveBeenCalled();
  });

  it('clicks the Skip control and resolves once the step leaves requirements-unmet', async () => {
    const stepLocator = createLocator({
      getAttribute: jest.fn().mockResolvedValueOnce('requirements-unmet').mockResolvedValue('completed'),
    });
    const skipButton = createLocator();
    const page = {
      getByTestId: jest.fn().mockImplementation((testId: string) =>
        testId.startsWith('interactive-skip-') ? skipButton : stepLocator
      ),
    } as unknown as Page;

    await clickSkipButtonAndSync(page, 'step-1', 200);

    expect(skipButton.click).toHaveBeenCalledWith({ timeout: 200 });
  });

  it('does not throw when the step never leaves requirements-unmet', async () => {
    const stepLocator = createLocator({
      getAttribute: jest.fn().mockResolvedValue('requirements-unmet'),
    });
    const skipButton = createLocator();
    const page = {
      getByTestId: jest.fn().mockImplementation((testId: string) =>
        testId.startsWith('interactive-skip-') ? skipButton : stepLocator
      ),
    } as unknown as Page;

    await expect(clickSkipButtonAndSync(page, 'step-1', 20)).resolves.toBeUndefined();
  });
});

describe('waitForGuidedCommentBoxReady', () => {
  it('resolves immediately when the comment box is already visible', async () => {
    const stepLocator = createLocator();
    const commentBox = createLocator();
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 1000)).resolves.toBeUndefined();
  });

  it('fails fast on an error state instead of waiting out the full timeout', async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('error') });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 30000)).rejects.toThrow(
      'error state'
    );
    // Only one poll iteration should have happened before the fast failure.
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it('fails fast on a cancelled state', async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('cancelled') });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 30000)).rejects.toThrow('cancelled');
  });

  it('times out with a clear error when the comment box never appears', async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('executing') });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 1)).rejects.toThrow(
      'comment box not visible'
    );
  });
});

describe('runGuidedSubstepLoop', () => {
  it('treats a detached step as completion (e.g. after a completeEarly navigation)', async () => {
    const stepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
    } as unknown as Page;
    const step = createTestableStep();

    const result = await runGuidedSubstepLoop(page, step, {
      stepLocator,
      perSubstepTimeoutMs: 1000,
    });

    expect(result).toEqual({ completed: true });
  });

  it('treats a query failure against a mid-navigation document as detachment rather than throwing', async () => {
    const stepLocator = createLocator({
      count: jest.fn().mockRejectedValue(new Error('Execution context was destroyed')),
    });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
    } as unknown as Page;
    const step = createTestableStep();

    await expect(
      runGuidedSubstepLoop(page, step, {
        stepLocator,
        perSubstepTimeoutMs: 1000,
      })
    ).resolves.toEqual({ completed: true });
  });

  it('re-resolves the step locator after a button action triggers a same-URL reload', async () => {
    // First pass: step is present and executing with a button substep; the click
    // triggers a `framenavigated` event without changing the URL. After the
    // reload settles, the step locator is re-queried and found detached
    // (section gone / navigated away), which is treated as completion.
    const freshStepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) });
    let getByTestIdCalls = 0;
    const listeners = new Map<string, Array<() => void>>();

    const initialStepLocator = createLocator({
      count: jest.fn().mockResolvedValue(1),
      getAttribute: jest
        .fn()
        .mockResolvedValueOnce('executing') // state check
        .mockResolvedValueOnce('0'), // substep index
    });

    const commentBox = createLocator({
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn().mockResolvedValue(true),
      getAttribute: jest
        .fn()
        .mockImplementation((name: string) =>
          Promise.resolve(
            name === 'data-test-action' ? 'button' : name === 'data-test-reftarget' ? 'Install' : null
          )
        ),
    });

    const buttonTarget = createLocator();
    const roleLocator = createLocator({
      count: jest.fn().mockResolvedValue(1),
      first: jest.fn().mockReturnValue(buttonTarget),
    });

    const page = {
      getByTestId: jest.fn().mockImplementation(() => {
        getByTestIdCalls += 1;
        // First call resolves the initial step locator; every subsequent
        // call (post-navigation re-resolution) returns the fresh, detached one.
        return getByTestIdCalls === 1 ? initialStepLocator : freshStepLocator;
      }),
      locator: jest.fn().mockReturnValue({ first: jest.fn().mockReturnValue(commentBox) }),
      getByRole: jest.fn().mockReturnValue(roleLocator),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockImplementation((event: string, handler: () => void) => {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler);
        listeners.set(event, handlers);
      }),
      off: jest.fn(),
    } as unknown as Page;

    // Simulate the plugin firing a `framenavigated` event as soon as the
    // target is clicked, standing in for a same-URL page reload.
    (buttonTarget.click as jest.Mock).mockImplementation(async () => {
      for (const handler of listeners.get('framenavigated') ?? []) {
        handler();
      }
    });

    const step = createTestableStep();

    const result = await runGuidedSubstepLoop(page, step, {
      stepLocator: initialStepLocator,
      perSubstepTimeoutMs: 1000,
    });

    expect(result).toEqual({ completed: true });
    expect(page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', {
      timeout: GUIDED_RELOAD_LOAD_TIMEOUT_MS,
    });
    // getByTestId was called again after the reload to fetch a fresh locator.
    expect(getByTestIdCalls).toBeGreaterThan(1);
  });
});
