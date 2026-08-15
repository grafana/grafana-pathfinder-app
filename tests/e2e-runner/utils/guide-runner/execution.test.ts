/**
 * Unit tests for the runner lifecycle fixes in execution.ts:
 * 1. Skip sync (clickSkipButtonAndSync) — only records a skip after the
 *    plugin reaches an explicit terminal state (completed or a successful
 *    detach), supporting either Skip control the plugin renders.
 * 2. Guided readiness (waitForGuidedCommentBoxReady) — bounds every read by
 *    the remaining deadline and distinguishes ready/completed/detached.
 * 3. Reload/detached-step handling (runGuidedSubstepLoop) — re-resolves the
 *    step locator after a detected reload, but propagates genuine query and
 *    navigation-sync failures instead of reporting false completion.
 * 4. Late completion/detachment precheck (executeStep) — bounded, error
 *    propagating, and classified as 'passed' consistently with the
 *    pre-click objective check (never a differently-labeled 'skipped').
 *
 * @see tests/e2e-runner/utils/guide-runner/execution.ts
 */

jest.mock('@playwright/test', () => {
  return {
    Page: jest.fn(),
    Locator: jest.fn(),
    test: jest.fn(),
    expect: (locator: { getAttribute: (name: string, opts?: { timeout?: number }) => Promise<string | null> }) => {
      const poll = async (attr: string, matches: (value: string | null) => boolean, opts?: { timeout?: number }) => {
        const timeout = opts?.timeout ?? 5000;
        const deadline = Date.now() + timeout;
        for (;;) {
          const value = await locator.getAttribute(attr);
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
        toHaveAttribute: (attr: string, value: string, opts?: { timeout?: number }) =>
          poll(attr, (current) => current === value, opts),
        not: {
          toHaveAttribute: (attr: string, value: string, opts?: { timeout?: number }) =>
            poll(attr, (current) => current !== value, opts),
        },
      };
    },
  };
});
jest.mock('./requirements', () => ({
  handleRequirementsWithFix: jest.fn(),
  validateSession: jest.fn().mockResolvedValue(true),
}));
jest.mock('./badge-celebrations', () => ({
  dismissBadgeCelebrations: jest.fn().mockResolvedValue(undefined),
}));

import type { Locator, Page } from '@playwright/test';

import {
  scrollStepIntoView,
  clickSkipButtonAndSync,
  waitForGuidedCommentBoxReady,
  runGuidedSubstepLoop,
  executeStep,
  executeAllSteps,
  summarizeResults,
} from './execution';
import { handleRequirementsWithFix } from './requirements';
import { dismissBadgeCelebrations } from './badge-celebrations';
import {
  SCROLL_INTO_VIEW_TIMEOUT_MS,
  GUIDED_RELOAD_LOAD_TIMEOUT_MS,
  LATE_COMPLETION_CHECK_TIMEOUT_MS,
} from './constants';
import type { StepTestResult, TestableStep } from './types';

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

/** Routes getByTestId to distinct locators for the two Skip control shapes and the step itself. */
function createSkipRoutedPage(routes: {
  stepSkipButton?: Locator;
  requirementSkipButton?: Locator;
  stepLocator?: Locator;
  extra?: Record<string, unknown>;
}): Page {
  const stepSkipButton = routes.stepSkipButton ?? createLocator({ count: jest.fn().mockResolvedValue(0) });
  const requirementSkipButton =
    routes.requirementSkipButton ?? createLocator({ count: jest.fn().mockResolvedValue(0) });
  const stepLocator = routes.stepLocator ?? createLocator();
  return {
    getByTestId: jest.fn().mockImplementation((testId: string) => {
      if (testId.startsWith('interactive-requirement-skip-')) {
        return requirementSkipButton;
      }
      if (testId.startsWith('interactive-skip-')) {
        return stepSkipButton;
      }
      return stepLocator;
    }),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    ...routes.extra,
  } as unknown as Page;
}

function createDeadlinePage(closeOverride?: jest.Mock): Page {
  let rejectCount!: (error: Error) => void;
  const locator = createLocator({
    count: jest.fn(
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectCount = reject;
        })
    ),
  });
  const close =
    closeOverride ??
    jest.fn(async () => {
      rejectCount(new Error('Target page has been closed'));
    });
  return {
    getByTestId: jest.fn(() => locator),
    on: jest.fn(),
    off: jest.fn(),
    url: jest.fn(() => 'http://localhost:3000/'),
    close,
    isClosed: jest.fn(() => true),
  } as unknown as Page;
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

describe('hard step deadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the page and returns a non-skippable failure', async () => {
    jest.useFakeTimers();
    const onDeadline = jest.fn();
    const page = createDeadlinePage();
    const result = executeStep(page, createTestableStep({ skippable: true }), { timeout: 100, onDeadline });

    await jest.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toMatchObject({
      status: 'failed',
      deadlineExceeded: true,
      skippable: false,
      classification: 'unknown',
    });
    expect(onDeadline).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledWith({ runBeforeUnload: false });
    expect(page.off).toHaveBeenCalledWith('console', expect.any(Function));
  });

  it('stops the guide when a skippable step exceeds its deadline', async () => {
    jest.useFakeTimers();
    const page = createDeadlinePage();
    const result = executeAllSteps(page, [createTestableStep({ skippable: true })], { timeout: 100 });

    await jest.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toMatchObject({
      aborted: true,
      abortReason: 'MANDATORY_FAILURE',
      results: [{ status: 'failed', deadlineExceeded: true, skippable: false }],
    });
  });

  it('returns after the page-close grace period when close does not settle', async () => {
    jest.useFakeTimers();
    const page = createDeadlinePage(jest.fn(() => new Promise<void>(() => undefined)));
    const result = executeStep(page, createTestableStep(), { timeout: 100 });
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toMatchObject({ deadlineExceeded: true });
  });

  it('clears the deadline when the step finishes', async () => {
    jest.useFakeTimers();
    const page = createDeadlinePage();
    const result = executeStep(page, createTestableStep({ isPreCompleted: true }), { timeout: 100 });

    await expect(result).resolves.toMatchObject({ status: 'skipped' });
    await jest.advanceTimersByTimeAsync(100);
    expect(page.close).not.toHaveBeenCalled();
  });
});

describe('clickSkipButtonAndSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dismissBadgeCelebrations as jest.Mock).mockResolvedValue(undefined);
  });
  it('throws when neither Skip control is rendered', async () => {
    const page = createSkipRoutedPage({});

    await expect(clickSkipButtonAndSync(page, 'step-1', 100)).rejects.toThrow('no Skip control available');
  });

  it('prefers the step-level Skip control when both are rendered', async () => {
    const stepSkipButton = createLocator();
    const requirementSkipButton = createLocator();
    const stepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) }); // detach = terminal
    const page = createSkipRoutedPage({ stepSkipButton, requirementSkipButton, stepLocator });

    await expect(clickSkipButtonAndSync(page, 'step-1', 200)).resolves.toBeUndefined();
    expect(dismissBadgeCelebrations).toHaveBeenCalledWith(page);

    expect(stepSkipButton.click).toHaveBeenCalledWith({ timeout: 200 });
    expect((dismissBadgeCelebrations as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (stepSkipButton.click as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(requirementSkipButton.click).not.toHaveBeenCalled();
  });

  it('falls back to the requirement-scoped Skip control when the step-level one is not rendered', async () => {
    // detectRequirements().hasSkipButton reflects this narrower control
    // (interactive-requirement-skip-*); support it too instead of assuming
    // the always-available step-level control is the only shape.
    const requirementSkipButton = createLocator();
    const stepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = createSkipRoutedPage({ requirementSkipButton, stepLocator });

    await expect(clickSkipButtonAndSync(page, 'step-1', 200)).resolves.toBeUndefined();

    expect(requirementSkipButton.click).toHaveBeenCalledWith({ timeout: 200 });
  });

  it('throws when the Skip button click itself fails', async () => {
    const clickError = new Error('Element is not clickable');
    const stepSkipButton = createLocator({ click: jest.fn().mockRejectedValue(clickError) });
    const page = createSkipRoutedPage({ stepSkipButton });

    await expect(clickSkipButtonAndSync(page, 'step-1', 100)).rejects.toBe(clickError);
  });

  it('resolves once the step reaches the completed terminal state', async () => {
    const stepSkipButton = createLocator();
    const stepLocator = createLocator({
      getAttribute: jest
        .fn()
        .mockResolvedValueOnce('checking')
        .mockResolvedValueOnce('requirements-unmet')
        .mockResolvedValue('completed'),
    });
    const page = createSkipRoutedPage({ stepSkipButton, stepLocator });

    await expect(clickSkipButtonAndSync(page, 'step-1', 500)).resolves.toBeUndefined();
  });

  it('resolves once the step is successfully detached, not merely absent from requirements-unmet', async () => {
    let calls = 0;
    const stepSkipButton = createLocator();
    const stepLocator = createLocator({
      count: jest.fn().mockImplementation(() => Promise.resolve(calls++ === 0 ? 1 : 0)),
      getAttribute: jest.fn().mockResolvedValue('requirements-unmet'),
    });
    const page = createSkipRoutedPage({ stepSkipButton, stepLocator });

    await expect(clickSkipButtonAndSync(page, 'step-1', 500)).resolves.toBeUndefined();
  });

  it('does not mistake a transient checking state for synchronized completion, and times out with a clear error', async () => {
    const stepSkipButton = createLocator();
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('checking') });
    const page = createSkipRoutedPage({ stepSkipButton, stepLocator });

    await expect(clickSkipButtonAndSync(page, 'step-1', 20)).rejects.toThrow('did not reach a terminal state');
  });
});

describe('waitForGuidedCommentBoxReady', () => {
  it("resolves 'ready' immediately when the comment box is already visible", async () => {
    const stepLocator = createLocator();
    const commentBox = createLocator();
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 1000)).resolves.toBe('ready');
  });

  it("resolves 'completed' when the step reaches completed while waiting", async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('completed') });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 1000)).resolves.toBe('completed');
  });

  it("resolves 'detached' when the step's element is confirmed gone while waiting, without reading its attributes", async () => {
    // In real Playwright, getAttribute() on a missing element auto-waits up to
    // its own timeout instead of resolving instantly, so detachment must be
    // decided by count() alone, before any attribute read is attempted.
    const getAttribute = jest.fn().mockRejectedValue(new Error('must not be called: step is already detached'));
    const stepLocator = createLocator({
      getAttribute,
      count: jest.fn().mockResolvedValue(0),
    });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 1000)).resolves.toBe('detached');
    expect(getAttribute).not.toHaveBeenCalled();
  });

  it('fails fast on an error state instead of waiting out the full timeout', async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('error') });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 30000)).rejects.toThrow('error state');
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

  it('bounds every state read by the remaining budget, so a stuck locator cannot exceed the overall wait', async () => {
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    // A faithful stand-in for Playwright: honors the passed `timeout` by
    // rejecting once it elapses, instead of resolving instantly.
    const getAttribute = jest.fn().mockImplementation((_name: string, opts?: { timeout?: number }) => {
      const boundedTimeout = opts?.timeout ?? 30000;
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error(`Timeout ${boundedTimeout}ms exceeded`)), boundedTimeout);
      });
    });
    const stepLocator = createLocator({ getAttribute, count: jest.fn().mockResolvedValue(1) });
    const page = { waitForTimeout: jest.fn().mockResolvedValue(undefined) } as unknown as Page;

    const start = Date.now();
    await expect(waitForGuidedCommentBoxReady(page, stepLocator, commentBox, 40)).rejects.toThrow(
      'comment box not visible'
    );
    // Bounded to roughly the requested 40ms budget, not Playwright's much
    // larger default operation timeout (which the unbounded call used).
    expect(Date.now() - start).toBeLessThan(500);
    for (const call of getAttribute.mock.calls) {
      expect(call[1]?.timeout).toBeGreaterThan(0);
      expect(call[1]?.timeout).toBeLessThanOrEqual(40);
    }
  });
});

describe('runGuidedSubstepLoop', () => {
  it('treats a successfully-confirmed detached step as completion (e.g. after a completeEarly navigation)', async () => {
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

  it('propagates a genuine query failure instead of reporting false completion', async () => {
    const stepLocator = createLocator({
      count: jest.fn().mockRejectedValue(new Error('Target closed')),
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
    ).rejects.toThrow('Target closed');
  });

  function createButtonSubstepHarness() {
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
          Promise.resolve(name === 'data-test-action' ? 'button' : name === 'data-test-reftarget' ? 'Install' : null)
        ),
    });

    const buttonTarget = createLocator();
    (buttonTarget.click as jest.Mock).mockImplementation(async () => {
      for (const handler of listeners.get('framenavigated') ?? []) {
        handler();
      }
    });
    const roleLocator = createLocator({
      count: jest.fn().mockResolvedValue(1),
      first: jest.fn().mockReturnValue(buttonTarget),
    });

    return { listeners, initialStepLocator, commentBox, buttonTarget, roleLocator };
  }

  it('re-resolves the step locator after a button action triggers a same-URL reload', async () => {
    // The step is present and executing with a button substep; the click
    // triggers a `framenavigated` event without changing the URL. After the
    // reload settles successfully, the step locator is re-queried and found
    // detached (section gone / navigated away), which is a legitimate
    // completion signal because the fresh query itself succeeded.
    const { listeners, initialStepLocator, commentBox, roleLocator } = createButtonSubstepHarness();
    const freshStepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) });
    let getByTestIdCalls = 0;

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

  it('propagates a failed reload sync instead of treating it as completion', async () => {
    const { listeners, initialStepLocator, commentBox, roleLocator } = createButtonSubstepHarness();
    const reloadError = new Error('Navigation timeout of 15000ms exceeded');

    const page = {
      getByTestId: jest.fn().mockReturnValue(initialStepLocator),
      locator: jest.fn().mockReturnValue({ first: jest.fn().mockReturnValue(commentBox) }),
      getByRole: jest.fn().mockReturnValue(roleLocator),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockRejectedValue(reloadError),
      on: jest.fn().mockImplementation((event: string, handler: () => void) => {
        const handlers = listeners.get(event) ?? [];
        handlers.push(handler);
        listeners.set(event, handlers);
      }),
      off: jest.fn(),
    } as unknown as Page;

    const step = createTestableStep();

    await expect(
      runGuidedSubstepLoop(page, step, {
        stepLocator: initialStepLocator,
        perSubstepTimeoutMs: 1000,
      })
    ).rejects.toBe(reloadError);
  });

  it('completes without reading the substep contract when the step finishes while waiting for the comment box', async () => {
    // The step transitions straight to `completed` before the comment box for
    // the next substep ever renders (e.g. the final substep auto-completed).
    const stepLocator = createLocator({
      count: jest.fn().mockResolvedValue(1),
      getAttribute: jest
        .fn()
        .mockResolvedValueOnce('executing') // top-of-loop state check
        .mockResolvedValueOnce('0') // substep index
        .mockResolvedValue('completed'), // comment-box wait's own state polls
    });
    const commentBox = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      locator: jest.fn().mockReturnValue({ first: jest.fn().mockReturnValue(commentBox) }),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const step = createTestableStep();

    const result = await runGuidedSubstepLoop(page, step, {
      stepLocator,
      perSubstepTimeoutMs: 1000,
    });

    expect(result).toEqual({ completed: true });
    expect(commentBox.getAttribute).not.toHaveBeenCalled();
  });
});

describe('executeStep - skip sync sequential-flow regression', () => {
  beforeEach(() => {
    (handleRequirementsWithFix as jest.Mock).mockReset();
  });

  it('only reports skipped once the plugin confirms a terminal state, unblocking the next step', async () => {
    (handleRequirementsWithFix as jest.Mock).mockResolvedValue({
      requirements: {
        requirementsMet: false,
        status: 'unmet',
        skippable: true,
        hasFixButton: false,
        isChecking: false,
        hasSkipButton: true,
        hasRetryButton: false,
      },
    });
    const stepSkipButton = createLocator();
    const stepLocator = createLocator({
      getAttribute: jest
        .fn()
        .mockResolvedValueOnce(null) // pre-scroll late-completion check
        .mockResolvedValueOnce('requirements-unmet') // skip-sync poll #1
        .mockResolvedValue('completed'), // skip-sync poll #2 — reached the terminal state
    });
    const page = createSkipRoutedPage({
      stepSkipButton,
      stepLocator,
      extra: { on: jest.fn(), off: jest.fn(), url: jest.fn().mockReturnValue('http://localhost:3000/') },
    });
    const step = createTestableStep({ skippable: true, isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('skipped');
    expect(stepSkipButton.click).toHaveBeenCalled();
  });

  it('returns a failed result — never a false skip — when Skip sync cannot confirm the transition', async () => {
    (handleRequirementsWithFix as jest.Mock).mockResolvedValue({
      requirements: {
        requirementsMet: false,
        status: 'unmet',
        skippable: true,
        hasFixButton: false,
        isChecking: false,
        hasSkipButton: false,
        hasRetryButton: false,
      },
    });
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue(null) });
    const page = createSkipRoutedPage({
      stepLocator,
      extra: { on: jest.fn(), off: jest.fn(), url: jest.fn().mockReturnValue('http://localhost:3000/') },
    });
    const step = createTestableStep({ skippable: true, isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('failed');
    expect(result.skippable).toBe(true);
    expect(result.error).toMatch(/skip sync/i);
  });
});

describe('executeStep - late completion/detachment precheck', () => {
  it('propagates a genuine query failure instead of treating it as pre-completion', async () => {
    const stepLocator = createLocator({ count: jest.fn().mockRejectedValue(new Error('Target closed')) });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Target closed');
  });

  it("returns 'passed' (not 'skipped') when the step is already completed while still attached", async () => {
    // Same DOM state the pre-click objective check reports as 'passed'; the
    // late precheck must classify it the same way, not as a differently
    // labeled 'skipped'/pre_completed result.
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('completed') });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('passed');
    expect(result.skipReason).toBeUndefined();
  });

  it("returns 'passed' (not 'skipped') when the step's element is already detached", async () => {
    const stepLocator = createLocator({ count: jest.fn().mockResolvedValue(0) });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('passed');
  });

  it('demonstrates the summary impact: a late-completed step now counts as a verified pass', async () => {
    const stepLocator = createLocator({ getAttribute: jest.fn().mockResolvedValue('completed') });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const lateResult = await executeStep(page, step, {});
    const otherSkippableFailure: StepTestResult = {
      stepId: 'other-step',
      status: 'failed',
      durationMs: 10,
      currentUrl: 'http://localhost:3000/',
      consoleErrors: [],
      skippable: true,
    };

    const summary = summarizeResults([lateResult, otherSkippableFailure]);

    // Before this fix, the late-completed step was reported as 'skipped', so
    // a run with zero verified passes and a skippable failure was reported
    // as a failure. It's now a verified 'passed', so the run succeeds.
    expect(summary.success).toBe(true);
  });

  it('bounds the completion read and treats a successful re-count of zero as late detachment', async () => {
    // getAttribute never resolves in time (simulating a mid-read detach); the
    // precheck must re-count rather than trust a stale "attached" result.
    let countCalls = 0;
    const getAttribute = jest.fn().mockRejectedValue(new Error('Element not attached'));
    const count = jest.fn().mockImplementation(() => {
      countCalls += 1;
      return Promise.resolve(countCalls === 1 ? 1 : 0); // attached, then gone mid-read
    });
    const stepLocator = createLocator({ count, getAttribute });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('passed');
    expect(getAttribute).toHaveBeenCalledWith('data-test-step-state', { timeout: LATE_COMPLETION_CHECK_TIMEOUT_MS });
    expect(countCalls).toBe(2);
  });

  it('propagates the original read error when the element is still attached after a failed bounded read', async () => {
    const readError = new Error('Some other read failure');
    let countCalls = 0;
    const getAttribute = jest.fn().mockRejectedValue(readError);
    const count = jest.fn().mockImplementation(() => {
      countCalls += 1;
      return Promise.resolve(1); // always attached
    });
    const stepLocator = createLocator({ count, getAttribute });
    const page = {
      getByTestId: jest.fn().mockReturnValue(stepLocator),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      off: jest.fn(),
      url: jest.fn().mockReturnValue('http://localhost:3000/'),
    } as unknown as Page;
    const step = createTestableStep({ isGuided: false, guidedStepCount: undefined });

    const result = await executeStep(page, step, {});

    expect(result.status).toBe('failed');
    expect(result.error).toBe(readError.message);
    expect(countCalls).toBe(2);
  });
});
