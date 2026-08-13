import type { Locator, Page } from '@playwright/test';

jest.mock('@playwright/test', () => ({
  Page: jest.fn(),
  Locator: jest.fn(),
  expect: jest.fn(),
  test: jest.fn(),
}));

import { testIds } from '../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from './badge-celebrations';
import { runGuidedSubstepLoop } from './execution';
import { clickFixButton } from './requirements';
import type { TestableStep } from './types';

interface BadgeHarnessOptions {
  clickError?: Error;
  remainsVisible?: boolean;
}

function createBadgeHarness(titles: string[], options: BadgeHarnessOptions = {}) {
  let currentIndex = 0;
  const events: string[] = [];
  const toast = {} as Locator;
  const dismissButton = {} as Locator;
  const waitForTimeout = jest.fn().mockResolvedValue(undefined);

  toast.first = jest.fn(() => toast);
  toast.count = jest.fn(async () => (currentIndex < titles.length ? 1 : 0));
  toast.isVisible = jest.fn(async () => currentIndex < titles.length);
  toast.textContent = jest.fn(async () => {
    if (currentIndex >= titles.length) {
      return null;
    }
    const queueCount = titles.length - currentIndex - 1;
    const queueText = queueCount > 0 ? ` (+${queueCount} more)` : '';
    return `Badge unlocked!${queueText} ${titles[currentIndex]} Nice!`;
  });

  dismissButton.click = jest.fn(async () => {
    events.push('dismiss');
    if (options.clickError) {
      throw options.clickError;
    }
    if (!options.remainsVisible) {
      currentIndex++;
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
    waitForTimeout,
  };
}

describe('dismissBadgeCelebrations', () => {
  it('returns without waiting when no toast is present', async () => {
    const { page, dismissClick, waitForTimeout } = createBadgeHarness([]);

    await dismissBadgeCelebrations(page);

    expect(dismissClick).not.toHaveBeenCalled();
    expect(waitForTimeout).not.toHaveBeenCalled();
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

  it('throws a bounded error when the toast remains visible', async () => {
    const { page, dismissClick, waitForTimeout } = createBadgeHarness(['First badge'], {
      remainsVisible: true,
    });

    await expect(dismissBadgeCelebrations(page)).rejects.toThrow(
      'Badge celebration remained visible after attempt 1 of 3 (1000ms timeout)'
    );
    expect(dismissClick).toHaveBeenCalledTimes(1);
    expect(waitForTimeout).toHaveBeenCalledTimes(20);
  });

  it('includes the dismiss control error in the diagnostic', async () => {
    const { page } = createBadgeHarness(['First badge'], {
      clickError: new Error('Dismiss button was detached'),
    });

    await expect(dismissBadgeCelebrations(page)).rejects.toThrow(
      'Badge celebration dismissal failed on attempt 1 of 3: Dismiss button was detached'
    );
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

  it('dismisses the toast before a guided hover', async () => {
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
    const target = {
      first: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(true),
      scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
      hover: jest.fn(async () => {
        events.push('hover');
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

    expect(events).toEqual(['dismiss', 'hover']);
  });
});
