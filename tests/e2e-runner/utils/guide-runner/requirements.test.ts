/**
 * Unit tests for guide-runner requirements handling.
 *
 * Covers the settle-window behavior in attemptToFixRequirements: when a fix
 * attempt finds no Fix button, the runner polls briefly for the DOM to
 * settle before it reports a terminal failure.
 */

jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import type { Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';
import { REQUIREMENTS_POLL_INTERVAL_MS } from './constants';
import { attemptToFixRequirements } from './requirements';
import type { TestableStep } from './types';

// ============================================
// Test Fixtures
// ============================================

const STEP_ID = 'test-step-1';

function createTestableStep(overrides: Partial<TestableStep> = {}): TestableStep {
  return {
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
  explanationText?: string;
  hasFixButton: boolean;
  hasRetryButton: boolean;
  hasSkipButton: boolean;
}

/**
 * Build a mock Page whose getByTestId() responses advance through a
 * sequence of DOM states, one state per detectRequirements() call.
 * The last state repeats for any calls beyond the sequence length.
 */
function createSequencedPage(states: DomState[]): { page: Page; waitForTimeout: jest.Mock } {
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
  const explanationLocator = {
    count: countFor((state) => state.hasExplanation),
    locator: jest.fn().mockReturnValue({ count: jest.fn().mockResolvedValue(0) }),
    textContent: jest.fn().mockImplementation(() => Promise.resolve(currentState().explanationText ?? '')),
  };
  const fixLocator = {
    count: countFor((state) => state.hasFixButton),
    click: jest.fn().mockResolvedValue(undefined),
  };
  const retryLocator = { count: countFor((state) => state.hasRetryButton) };
  const skipLocator = { count: countFor((state) => state.hasSkipButton) };

  const locatorsByTestId = new Map<string, unknown>([
    [testIds.interactive.doItButton(STEP_ID), doItLocator],
    [testIds.interactive.showMeButton(STEP_ID), showMeLocator],
    [testIds.interactive.requirementCheck(STEP_ID), explanationLocator],
    [testIds.interactive.requirementFixButton(STEP_ID), fixLocator],
    [testIds.interactive.requirementRetryButton(STEP_ID), retryLocator],
    [testIds.interactive.requirementSkipButton(STEP_ID), skipLocator],
  ]);

  const getByTestId = jest.fn().mockImplementation((testId: string) => {
    const locator = locatorsByTestId.get(testId);
    if (!locator) {
      throw new Error(`Unexpected testId requested: ${testId}`);
    }
    return locator;
  });
  const waitForTimeout = jest.fn().mockResolvedValue(undefined);

  const page = { getByTestId, waitForTimeout } as unknown as Page;

  return { page, waitForTimeout };
}

const UNMET_NO_FIX_BUTTON: DomState = {
  doItEnabled: false,
  hasExplanation: true,
  explanationText: 'Checking your setup',
  hasFixButton: false,
  hasRetryButton: false,
  hasSkipButton: false,
};

const MET: DomState = {
  doItEnabled: true,
  hasExplanation: false,
  hasFixButton: false,
  hasRetryButton: false,
  hasSkipButton: false,
};

describe('attemptToFixRequirements - no Fix button settle window', () => {
  it('reports success when requirements settle to met during the settle window', async () => {
    const { page, waitForTimeout } = createSequencedPage([
      UNMET_NO_FIX_BUTTON, // initial read in the attempt loop
      UNMET_NO_FIX_BUTTON, // initial read inside the settle poll
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
    const dateNowSpy = jest.spyOn(Date, 'now');
    let simulatedNow = 0;
    dateNowSpy.mockImplementation(() => {
      simulatedNow += 300;
      return simulatedNow;
    });

    try {
      const { page, waitForTimeout } = createSequencedPage([UNMET_NO_FIX_BUTTON]);
      const step = createTestableStep();

      const result = await attemptToFixRequirements(page, step);

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('No Fix button available');
      expect(result.totalAttempts).toBe(1);
      expect(result.attempts[0].error).toBe('No Fix button available');
      // It kept polling for the settle window rather than giving up on the
      // first sampled state.
      expect(waitForTimeout.mock.calls.length).toBeGreaterThan(1);
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
