import type { Locator, Page } from '@playwright/test';

jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import { testIds } from '../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from './badge-celebrations';
import { runGuidedSubstepLoop, waitForFormfillSettle } from './execution';
import { clickFixButton } from './requirements';
import type { TestableStep } from './types';

interface BadgeHarnessOptions {
  clickError?: Error;
  remainsVisible?: boolean;
  initialDelayMs?: number;
  interToastDelayMs?: number;
  textReadFailure?: {
    call: number;
    mode: 'disappear' | 'visible';
    error: Error;
  };
}

function createBadgeHarness(titles: string[], options: BadgeHarnessOptions = {}) {
  let elapsedMs = 0;
  let currentIndex = titles.length > 0 && (options.initialDelayMs ?? 0) === 0 ? 0 : -1;
  let nextIndex = currentIndex === 0 ? 1 : 0;
  let nextVisibleAt =
    currentIndex === -1 && titles.length > 0 ? (options.initialDelayMs ?? 0) : Number.POSITIVE_INFINITY;
  let textReadCount = 0;
  const events: string[] = [];
  const toast = {} as Locator;
  const dismissButton = {} as Locator;
  const revealDueToast = () => {
    if (currentIndex === -1 && nextIndex < titles.length && elapsedMs >= nextVisibleAt) {
      currentIndex = nextIndex;
      nextIndex++;
      nextVisibleAt = Number.POSITIVE_INFINITY;
    }
  };
  const waitForTimeout = jest.fn(async (timeoutMs: number) => {
    elapsedMs += timeoutMs;
    revealDueToast();
  });

  toast.first = jest.fn(() => toast);
  toast.count = jest.fn(async () => (currentIndex >= 0 ? 1 : 0));
  toast.isVisible = jest.fn(async () => currentIndex >= 0);
  toast.textContent = jest.fn(async (textOptions?: { timeout?: number }) => {
    if (currentIndex < 0) {
      return null;
    }
    textReadCount++;
    if (options.textReadFailure?.call === textReadCount) {
      elapsedMs += textOptions?.timeout ?? 0;
      if (options.textReadFailure.mode === 'disappear') {
        currentIndex = -1;
        nextVisibleAt =
          nextIndex < titles.length ? elapsedMs + (options.interToastDelayMs ?? 0) : Number.POSITIVE_INFINITY;
      }
      throw options.textReadFailure.error;
    }
    const queueCount = titles.length - nextIndex;
    const queueText = queueCount > 0 ? ` (+${queueCount} more)` : '';
    return `Badge unlocked!${queueText} ${titles[currentIndex]} Nice!`;
  });

  dismissButton.click = jest.fn(async () => {
    events.push('dismiss');
    if (options.clickError) {
      throw options.clickError;
    }
    if (!options.remainsVisible) {
      currentIndex = -1;
      nextVisibleAt =
        nextIndex < titles.length ? elapsedMs + (options.interToastDelayMs ?? 0) : Number.POSITIVE_INFINITY;
    }
  });

  const page = {
    getByTestId: jest.fn((testId: string) => {
      if (testId === testIds.learningPaths.badgeToast) {
        return toast;
      }
      if (testId === testIds.learningPaths.badgeToastDismiss) {
        return dismissButton;
      }
      throw new Error(`Unexpected test ID: ${testId}`);
    }),
    waitForTimeout,
  } as unknown as Page;

  return {
    page,
    events,
    dismissClick: dismissButton.click as jest.Mock,
    textContent: toast.textContent as jest.Mock,
    waitForTimeout,
    getElapsedMs: () => elapsedMs,
  };
}

function expectBoundedTextReads(textContent: jest.Mock): void {
  expect(textContent).toHaveBeenCalled();
  for (const [options] of textContent.mock.calls) {
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(1000);
  }
}

describe('dismissBadgeCelebrations', () => {
  it('returns after a bounded idle check when no toast is present', async () => {
    const { page, dismissClick, waitForTimeout } = createBadgeHarness([]);

    await dismissBadgeCelebrations(page);

    expect(dismissClick).not.toHaveBeenCalled();
    expect(waitForTimeout).toHaveBeenCalledTimes(4);
  });

  it('waits for a delayed first toast', async () => {
    const { page, dismissClick } = createBadgeHarness(['First badge'], {
      initialDelayMs: 50,
    });

    await dismissBadgeCelebrations(page);

    expect(dismissClick).toHaveBeenCalledTimes(1);
  });

  it('dismisses one toast', async () => {
    const { page, dismissClick } = createBadgeHarness(['First badge']);

    await dismissBadgeCelebrations(page);

    expect(dismissClick).toHaveBeenCalledTimes(1);
  });

  it('dismisses queued toasts in sequence', async () => {
    const { page, dismissClick } = createBadgeHarness(['First badge', 'Second badge', 'Third badge']);

    await dismissBadgeCelebrations(page);

    expect(dismissClick).toHaveBeenCalledTimes(3);
  });

  it('waits for the next queued toast across an inter-toast gap', async () => {
    const { page, dismissClick } = createBadgeHarness(['First badge', 'Second badge'], {
      interToastDelayMs: 75,
    });

    await dismissBadgeCelebrations(page);

    expect(dismissClick).toHaveBeenCalledTimes(2);
  });

  it('throws a bounded error when the toast remains visible', async () => {
    const { page, dismissClick, waitForTimeout } = createBadgeHarness(['First badge'], {
      remainsVisible: true,
    });

    await expect(dismissBadgeCelebrations(page)).rejects.toThrow(
      'Badge celebration remained visible after attempt 1 of 3 (1000ms timeout)'
    );
    expect(dismissClick).toHaveBeenCalledTimes(1);
    expect(waitForTimeout).toHaveBeenCalledTimes(40);
  });

  it('includes the dismiss control error in the diagnostic', async () => {
    const { page } = createBadgeHarness(['First badge'], {
      clickError: new Error('Dismiss button was detached'),
    });

    await expect(dismissBadgeCelebrations(page)).rejects.toThrow(
      'Badge celebration dismissal failed on attempt 1 of 3: Dismiss button was detached'
    );
  });

  it('does not click a stale dismiss control when the initial toast disappears during its text read', async () => {
    const { page, dismissClick, textContent, getElapsedMs } = createBadgeHarness(['First badge'], {
      textReadFailure: {
        call: 1,
        mode: 'disappear',
        error: new Error('Text read timed out'),
      },
    });
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(getElapsedMs);

    try {
      await expect(dismissBadgeCelebrations(page)).resolves.toBeUndefined();
    } finally {
      dateNow.mockRestore();
    }

    expect(dismissClick).not.toHaveBeenCalled();
    expectBoundedTextReads(textContent);
  });

  it('accepts a queued toast that disappears during its bounded transition text read', async () => {
    const { page, dismissClick, textContent, getElapsedMs } = createBadgeHarness(['First badge', 'Second badge'], {
      textReadFailure: {
        call: 2,
        mode: 'disappear',
        error: new Error('Transition text read timed out'),
      },
    });
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(getElapsedMs);

    try {
      await expect(dismissBadgeCelebrations(page)).resolves.toBeUndefined();
    } finally {
      dateNow.mockRestore();
    }

    expect(dismissClick).toHaveBeenCalledTimes(1);
    expectBoundedTextReads(textContent);
  });

  it('reports a bounded text-read error when the toast remains visible', async () => {
    const { page, dismissClick, textContent } = createBadgeHarness(['First badge'], {
      textReadFailure: {
        call: 1,
        mode: 'visible',
        error: new Error('Text read timed out'),
      },
    });

    await expect(dismissBadgeCelebrations(page)).rejects.toThrow(
      'Badge celebration text read before attempt 1 of 3 failed within 1000ms while the toast remained visible: Text read timed out'
    );

    expect(dismissClick).not.toHaveBeenCalled();
    expectBoundedTextReads(textContent);
  });

  it('dismisses the toast before a requirement Fix click', async () => {
    const { page: badgePage, events } = createBadgeHarness(['First badge']);
    const fixButton = {
      count: jest.fn().mockResolvedValue(1),
      click: jest.fn(async () => {
        events.push('fix');
      }),
    } as unknown as Locator;
    const requirementCheck = {
      count: jest.fn().mockResolvedValue(0),
    } as unknown as Locator;
    const getBadgeLocator = badgePage.getByTestId.bind(badgePage);
    const page = {
      getByTestId: jest.fn((testId: string) => {
        if (testId === testIds.interactive.requirementFixButton('test-step')) {
          return fixButton;
        }
        if (testId === testIds.interactive.requirementCheck('test-step')) {
          return requirementCheck;
        }
        return getBadgeLocator(testId);
      }),
      waitForTimeout: badgePage.waitForTimeout.bind(badgePage),
    } as unknown as Page;
    const step = {
      stepId: 'test-step',
    } as TestableStep;

    await clickFixButton(page, step, 'navigation');

    expect(events).toEqual(['dismiss', 'fix']);
  });

  it('dismisses the toast before a hidden target reveal hover', async () => {
    const { page: badgePage, events } = createBadgeHarness(['First badge']);
    const stepLocator = {
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      getAttribute: jest.fn(async (name: string) => {
        if (name === 'data-test-step-state') {
          return 'executing';
        }
        if (name === 'data-test-substep-index') {
          return '0';
        }
        return null;
      }),
    } as unknown as Locator;
    const commentBox = {
      waitFor: jest.fn().mockResolvedValue(undefined),
      getAttribute: jest.fn(async (name: string) => {
        if (name === 'data-test-action') {
          return 'hover';
        }
        if (name === 'data-test-reftarget') {
          return '#guided-target';
        }
        return null;
      }),
    } as unknown as Locator;
    const commentBoxLocator = {
      first: jest.fn(() => commentBox),
    } as unknown as Locator;
    let targetVisible = false;
    const panel = {
      count: jest.fn().mockResolvedValue(1),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
      hover: jest.fn(async () => {
        events.push('panel-hover');
        targetVisible = true;
      }),
      locator: jest.fn(),
    } as unknown as Locator;
    const target = {
      first: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      isVisible: jest.fn(async () => targetVisible),
      locator: jest.fn(() => panel),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
      hover: jest.fn(async () => {
        events.push('target-hover');
      }),
    } as unknown as Locator;
    target.first = jest.fn(() => target);
    const getBadgeLocator = badgePage.getByTestId.bind(badgePage);
    const page = {
      getByTestId: jest.fn((testId: string) => {
        if (testId === testIds.interactive.step('guided-step')) {
          return stepLocator;
        }
        return getBadgeLocator(testId);
      }),
      locator: jest.fn((selector: string) => {
        return selector === '.interactive-comment-box' ? commentBoxLocator : target;
      }),
      waitForTimeout: badgePage.waitForTimeout.bind(badgePage),
    } as unknown as Page;
    const step = {
      stepId: 'guided-step',
      guidedStepCount: 1,
    } as TestableStep;

    await expect(
      runGuidedSubstepLoop(page, step, {
        stepLocator,
        perSubstepTimeoutMs: 100,
      })
    ).resolves.toEqual({ completed: true });

    expect(events).toEqual(['dismiss', 'panel-hover', 'target-hover']);
  });

  it('dismisses a delayed toast before a form-fill retry', async () => {
    const { page, events, getElapsedMs } = createBadgeHarness(['First badge'], {
      initialDelayMs: 3000,
    });
    let retried = false;
    const stepLocator = {
      count: jest.fn().mockResolvedValue(1),
      getAttribute: jest.fn(async () => (retried ? 'valid' : 'invalid')),
    } as unknown as Locator;
    const target = {
      fill: jest.fn(async () => {
        events.push('retry-fill');
        retried = true;
      }),
    } as unknown as Locator;
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(getElapsedMs);

    try {
      await waitForFormfillSettle(page, stepLocator, target, 'value');
    } finally {
      dateNow.mockRestore();
    }

    expect(events).toEqual(['dismiss', 'retry-fill']);
  });
});
