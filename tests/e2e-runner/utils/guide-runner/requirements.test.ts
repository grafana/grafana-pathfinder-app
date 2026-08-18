/**
 * Unit tests for guide-runner requirements handling.
 *
 * Covers the settle-window behavior in attemptToFixRequirements: an unmet
 * read (with or without a Fix button) gets a short poll to settle before
 * the runner reports a terminal failure, both on the initial read of an
 * attempt and on the read taken right after a Fix button click. Also
 * covers the bounded per-read timeout that keeps a detached element from
 * hanging past the settle window.
 */

jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { POST_FIX_SETTLE_DELAY_MS, REQUIREMENTS_POLL_INTERVAL_MS, REQUIREMENTS_SETTLE_TIMEOUT_MS } from './constants';
import { attemptToFixRequirements, detectRequirements } from './requirements';
import type { TestableStep } from './types';

afterEach(() => {
  jest.restoreAllMocks();
});

// ============================================
// Test Fixtures
// ============================================

const STEP_ID = 'test-step-1';

/** Badge dismissal polls at 25ms; every requirement wait is longer. */
const BADGE_POLL_MS = 25;

function requirementWaits(waitForTimeout: jest.Mock): number[] {
  return waitForTimeout.mock.calls.map(([ms]) => ms as number).filter((ms) => ms !== BADGE_POLL_MS);
}

function createTestableStep(overrides: Partial<TestableStep> = {}): TestableStep {
  return {
    stepKind: 'plain',
    stepId: STEP_ID,
    index: 0,
    skippable: false,
    hasDoItButton: true,
    hasShowMeButton: false,
    isPreCompleted: false,
    isMultistep: false,
    internalActionCount: 0,
    isGuided: false,
    locator: {} as unknown as TestableStep['locator'],
    ...overrides,
  };
}

/**
 * A snapshot of the DOM state that detectRequirements() would observe.
 * Only the fields relevant to the settle-window behavior are modeled.
 */
interface DomState {
  doItEnabled: boolean;
  hasExplanation: boolean;
  isChecking: boolean;
  explanationText?: string;
  hasFixButton: boolean;
  hasRetryButton: boolean;
  hasSkipButton: boolean;
}

interface SequencedPageHandles {
  page: Page;
  waitForTimeout: jest.Mock;
  waitForLoadState: jest.Mock;
  fixButtonClick: jest.Mock;
  explanationTextContent: jest.Mock;
}

/**
 * Build a mock Page whose getByTestId() responses advance through a
 * sequence of DOM states, one state per detectRequirements() call. The
 * last state repeats for any calls beyond the sequence length.
 *
 * Installs a fake clock that only advances when page.waitForTimeout() is
 * called, and mocks Date.now() to read from it, so tests cannot
 * accidentally depend on real wall-clock time.
 */
function createSequencedPage(states: DomState[]): SequencedPageHandles {
  const clock = { now: 0 };
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

  let callIndex = -1;
  const currentState = () => states[Math.min(callIndex, states.length - 1)];
  const countFor = (pick: (state: DomState) => boolean) =>
    jest.fn().mockImplementation(() => Promise.resolve(pick(currentState()) ? 1 : 0));

  const doItLocator = {
    count: jest.fn().mockImplementation(() => {
      callIndex += 1;
      return Promise.resolve(currentState().doItEnabled ? 1 : 0);
    }),
    isEnabled: jest.fn().mockImplementation(() => Promise.resolve(currentState().doItEnabled)),
  };
  const showMeLocator = {
    count: jest.fn().mockResolvedValue(0),
    isEnabled: jest.fn().mockResolvedValue(false),
  };
  const explanationTextContent = jest
    .fn()
    .mockImplementation(() => Promise.resolve(currentState().explanationText ?? ''));
  const explanationLocator = {
    count: countFor((state) => state.hasExplanation),
    locator: jest.fn().mockReturnValue({
      count: jest.fn().mockImplementation(() => Promise.resolve(currentState().isChecking ? 1 : 0)),
    }),
    textContent: explanationTextContent,
  };
  const fixLocator = {
    count: countFor((state) => state.hasFixButton),
    click: jest.fn().mockResolvedValue(undefined),
  };
  const retryLocator = { count: countFor((state) => state.hasRetryButton) };
  const skipLocator = { count: countFor((state) => state.hasSkipButton) };

  // `clickFixButton` dismisses badge celebrations first (#1617). These tests are
  // about the settle window, so the toast is always absent — but the locator has
  // to exist, or the fix click throws before it ever reaches the code under test.
  const badgeToastLocator: Record<string, unknown> = {
    count: jest.fn().mockResolvedValue(0),
    isVisible: jest.fn().mockResolvedValue(false),
    textContent: jest.fn().mockResolvedValue(''),
  };
  badgeToastLocator.first = jest.fn().mockReturnValue(badgeToastLocator);

  const locatorsByTestId = new Map<string, unknown>([
    [testIds.interactive.doItButton(STEP_ID), doItLocator],
    [testIds.interactive.showMeButton(STEP_ID), showMeLocator],
    [testIds.interactive.requirementCheck(STEP_ID), explanationLocator],
    [testIds.interactive.requirementFixButton(STEP_ID), fixLocator],
    [testIds.interactive.requirementRetryButton(STEP_ID), retryLocator],
    [testIds.interactive.requirementSkipButton(STEP_ID), skipLocator],
    [testIds.learningPaths.badgeToast, badgeToastLocator],
  ]);

  const getByTestId = jest.fn().mockImplementation((testId: string) => {
    const locator = locatorsByTestId.get(testId);
    if (!locator) {
      throw new Error(`Unexpected testId requested: ${testId}`);
    }
    return locator;
  });
  const waitForTimeout = jest.fn().mockImplementation((ms: number) => {
    clock.now += ms;
    return Promise.resolve(undefined);
  });
  const waitForLoadState = jest.fn().mockResolvedValue(undefined);

  const page = { getByTestId, waitForTimeout, waitForLoadState } as unknown as Page;

  return { page, waitForTimeout, waitForLoadState, fixButtonClick: fixLocator.click, explanationTextContent };
}

const UNMET_NO_FIX_BUTTON: DomState = {
  doItEnabled: false,
  hasExplanation: true,
  isChecking: false,
  explanationText: 'Checking your setup',
  hasFixButton: false,
  hasRetryButton: false,
  hasSkipButton: false,
};

const CHECKING: DomState = {
  doItEnabled: false,
  hasExplanation: true,
  isChecking: true,
  explanationText: 'Checking your setup',
  hasFixButton: false,
  hasRetryButton: false,
  hasSkipButton: false,
};

const UNMET_HAS_FIX_BUTTON: DomState = {
  doItEnabled: false,
  hasExplanation: true,
  isChecking: false,
  explanationText: 'Fix available',
  hasFixButton: true,
  hasRetryButton: false,
  hasSkipButton: false,
};

const UNMET_HAS_FIX_BUTTON_LOCATION: DomState = {
  doItEnabled: false,
  hasExplanation: true,
  isChecking: false,
  explanationText: 'Navigate to the settings page to continue.',
  hasFixButton: true,
  hasRetryButton: false,
  hasSkipButton: false,
};

const MET: DomState = {
  doItEnabled: true,
  hasExplanation: false,
  isChecking: false,
  hasFixButton: false,
  hasRetryButton: false,
  hasSkipButton: false,
};

describe('attemptToFixRequirements - settle window', () => {
  it('reports success when requirements settle to met before a Fix button ever appears', async () => {
    const { page, waitForTimeout } = createSequencedPage([
      UNMET_NO_FIX_BUTTON, // initial read in the attempt loop
      MET, // settles to met after one poll
    ]);
    const step = createTestableStep();

    const result = await attemptToFixRequirements(page, step);

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe('met');
    expect(result.failureReason).toBeUndefined();
    expect(result.totalAttempts).toBe(1);
    // It polled once before concluding the state had settled, instead of
    // failing on the first sampled state.
    expect(waitForTimeout).toHaveBeenCalledTimes(1);
    expect(waitForTimeout).toHaveBeenCalledWith(REQUIREMENTS_POLL_INTERVAL_MS);
  });

  it('reports "No Fix button available" when requirements stay unmet for the whole window', async () => {
    const { page, waitForTimeout, explanationTextContent } = createSequencedPage([UNMET_NO_FIX_BUTTON]);
    const step = createTestableStep();

    const result = await attemptToFixRequirements(page, step);

    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('No Fix button available');
    expect(result.totalAttempts).toBe(1);
    expect(result.attempts[0].error).toBe('No Fix button available');
    // The fake clock only advances via waitForTimeout(), so exactly
    // REQUIREMENTS_SETTLE_TIMEOUT_MS / REQUIREMENTS_POLL_INTERVAL_MS polls
    // fit in the settle budget.
    expect(waitForTimeout.mock.calls.length).toBe(REQUIREMENTS_SETTLE_TIMEOUT_MS / REQUIREMENTS_POLL_INTERVAL_MS);
    for (const call of waitForTimeout.mock.calls) {
      expect(call[0]).toBe(REQUIREMENTS_POLL_INTERVAL_MS);
    }
    // The very first read (outside the settle poll) is unbounded; every
    // read taken during the settle poll is bounded by the remaining budget.
    const readTimeouts = explanationTextContent.mock.calls.map((call) => call[0]);
    expect(readTimeouts[0]).toBeUndefined();
    for (const readOptions of readTimeouts.slice(1)) {
      expect(readOptions).toEqual({ timeout: expect.any(Number) });
    }
  });

  it('settles to met after a Fix click even on the final allowed attempt', async () => {
    const { page, waitForTimeout, fixButtonClick } = createSequencedPage([
      UNMET_HAS_FIX_BUTTON, // initial read: Fix button present
      UNMET_NO_FIX_BUTTON, // immediate post-click read: still unmet, no Fix button
      MET, // settles to met after one poll
    ]);
    const step = createTestableStep();

    const result = await attemptToFixRequirements(page, step, { maxAttempts: 1 });

    expect(result.success).toBe(true);
    expect(result.finalStatus).toBe('met');
    expect(result.totalAttempts).toBe(1);
    // The settle poll re-detected requirements; it did not click Fix again
    // to get there.
    expect(fixButtonClick).toHaveBeenCalledTimes(1);
    // Counting the requirement waits only. Badge dismissal polls on its own
    // cadence before every fix click, and this assertion is about the settle
    // window, not about how long looking for an absent toast takes.
    expect(requirementWaits(waitForTimeout)).toEqual([POST_FIX_SETTLE_DELAY_MS, REQUIREMENTS_POLL_INTERVAL_MS]);
  });

  it('preserves fixType when a Fix button reappears during the initial settle poll', async () => {
    const { page, waitForLoadState } = createSequencedPage([
      UNMET_NO_FIX_BUTTON, // initial read: no Fix button yet
      UNMET_HAS_FIX_BUTTON_LOCATION, // settles to a Fix button with a "location" fixType
      MET,
    ]);
    const step = createTestableStep();

    const result = await attemptToFixRequirements(page, step, { maxAttempts: 1 });

    expect(result.success).toBe(true);
    // Only a "location" fixType triggers a networkidle wait; observing it
    // proves the settled fixType (not a default) reached clickFixButton.
    expect(waitForLoadState).toHaveBeenCalledWith('networkidle', expect.anything());
  });

  it('records finalStatus from the settled post-fix state, across a multi-attempt failing flow', async () => {
    const { page } = createSequencedPage([
      UNMET_HAS_FIX_BUTTON, // attempt 1 initial read: Fix button present
      CHECKING, // attempt 1 immediate post-click read: checking, not settled
      UNMET_NO_FIX_BUTTON, // attempt 1 settle poll: unmet, no Fix button (repeats until window expires)
    ]);
    const step = createTestableStep();

    const result = await attemptToFixRequirements(page, step, { maxAttempts: 2 });

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(2);
    expect(result.attempts[0].error).toBe('Requirements still not met after fix');
    expect(result.attempts[1].error).toBe('No Fix button available');
    expect(result.failureReason).toBe('No Fix button available');
    // finalStatus reflects the settled read ('unmet'), not the immediate
    // post-click read ('checking').
    expect(result.finalStatus).toBe('unmet');
  });
});

describe('detectRequirements - bounded reads', () => {
  it('treats a bounded isEnabled timeout as disabled instead of throwing', async () => {
    const doItLocator: Pick<Locator, 'count' | 'isEnabled'> = {
      count: jest.fn().mockResolvedValue(1),
      isEnabled: jest.fn().mockImplementation((options?: { timeout?: number }) => {
        if (options?.timeout !== undefined) {
          return Promise.reject(new Error(`Locator.isEnabled: Timeout ${options.timeout}ms exceeded.`));
        }
        return Promise.resolve(true);
      }),
    };
    const zeroCountLocator = { count: jest.fn().mockResolvedValue(0) };
    const locatorsByTestId = new Map<string, unknown>([
      [testIds.interactive.doItButton(STEP_ID), doItLocator],
      [testIds.interactive.showMeButton(STEP_ID), zeroCountLocator],
      [testIds.interactive.requirementCheck(STEP_ID), zeroCountLocator],
      [testIds.interactive.requirementFixButton(STEP_ID), zeroCountLocator],
      [testIds.interactive.requirementRetryButton(STEP_ID), zeroCountLocator],
      [testIds.interactive.requirementSkipButton(STEP_ID), zeroCountLocator],
    ]);
    const page = {
      getByTestId: jest.fn().mockImplementation((testId: string) => locatorsByTestId.get(testId)),
    } as unknown as Page;
    const step = createTestableStep();

    const result = await detectRequirements(page, step, 50);

    // A present-but-unreadable "Do it" button, with no other signal, reads
    // as an inconclusive unmet state rather than throwing.
    expect(result.requirementsMet).toBe(false);
    expect(result.status).toBe('unknown');
    expect(doItLocator.isEnabled).toHaveBeenCalledWith({ timeout: 50 });
  });
});
