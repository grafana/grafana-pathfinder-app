import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';

// The runner opens one guide per browser context, and each guide-completed event awards at most three new badges.
const MAX_BADGE_CELEBRATIONS = 3;
const BADGE_TRANSITION_TIMEOUT_MS = 1000;
const BADGE_IDLE_TIMEOUT_MS = 100;
const BADGE_TRANSITION_POLL_MS = 25;

async function isVisible(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && (await locator.isVisible());
}

function hasQueuedCelebration(text: string): boolean {
  return /\(\+\d+ more\)/.test(text);
}

type ToastTextResult = { state: 'read'; text: string } | { state: 'gone' };

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readToastText(toast: Locator, timeout: number, context: string): Promise<ToastTextResult> {
  const boundedTimeout = Math.max(1, Math.min(timeout, BADGE_TRANSITION_TIMEOUT_MS));

  try {
    return {
      state: 'read',
      text: (await toast.textContent({ timeout: boundedTimeout })) ?? '',
    };
  } catch (readError) {
    const readReason = errorReason(readError);

    try {
      if (!(await isVisible(toast))) {
        return { state: 'gone' };
      }
    } catch (visibilityError) {
      throw new Error(
        `Badge celebration ${context} failed within ${boundedTimeout}ms: ${readReason}. Visibility recheck failed: ${errorReason(visibilityError)}`
      );
    }

    throw new Error(
      `Badge celebration ${context} failed within ${boundedTimeout}ms while the toast remained visible: ${readReason}`
    );
  }
}

async function waitForVisibleToast(page: Page, toast: Locator): Promise<boolean> {
  for (let elapsed = 0; elapsed < BADGE_IDLE_TIMEOUT_MS; elapsed += BADGE_TRANSITION_POLL_MS) {
    if (await isVisible(toast)) {
      return true;
    }
    await page.waitForTimeout(BADGE_TRANSITION_POLL_MS);
  }

  return isVisible(toast);
}

async function waitForToastTransition(page: Page, previousText: string, expectNextToast: boolean): Promise<boolean> {
  const toast = page.getByTestId(testIds.learningPaths.badgeToast).first();
  let elapsed = 0;

  while (elapsed < BADGE_TRANSITION_TIMEOUT_MS) {
    if (!(await isVisible(toast))) {
      if (!expectNextToast) {
        return true;
      }
    } else {
      const readStartedAt = Date.now();
      const textResult = await readToastText(toast, BADGE_TRANSITION_TIMEOUT_MS - elapsed, 'transition text read');
      elapsed = Math.min(BADGE_TRANSITION_TIMEOUT_MS, elapsed + Math.max(0, Date.now() - readStartedAt));
      if (textResult.state === 'gone' || textResult.text !== previousText) {
        return true;
      }
    }

    const pollDelay = Math.min(BADGE_TRANSITION_POLL_MS, BADGE_TRANSITION_TIMEOUT_MS - elapsed);
    if (pollDelay <= 0) {
      break;
    }
    await page.waitForTimeout(pollDelay);
    elapsed += pollDelay;
  }

  return !(await isVisible(toast));
}

export async function dismissBadgeCelebrations(page: Page): Promise<void> {
  const toast = page.getByTestId(testIds.learningPaths.badgeToast).first();

  for (let attempt = 1; attempt <= MAX_BADGE_CELEBRATIONS; attempt++) {
    if (!(await waitForVisibleToast(page, toast))) {
      return;
    }

    const textResult = await readToastText(
      toast,
      BADGE_TRANSITION_TIMEOUT_MS,
      `text read before attempt ${attempt} of ${MAX_BADGE_CELEBRATIONS}`
    );
    if (textResult.state === 'gone') {
      continue;
    }
    const previousText = textResult.text;
    const dismissButton = page.getByTestId(testIds.learningPaths.badgeToastDismiss).first();

    try {
      await dismissButton.click({ timeout: BADGE_TRANSITION_TIMEOUT_MS });
    } catch (error) {
      const reason = errorReason(error);
      throw new Error(
        `Badge celebration dismissal failed on attempt ${attempt} of ${MAX_BADGE_CELEBRATIONS}: ${reason}`
      );
    }

    if (!(await waitForToastTransition(page, previousText, hasQueuedCelebration(previousText)))) {
      throw new Error(
        `Badge celebration remained visible after attempt ${attempt} of ${MAX_BADGE_CELEBRATIONS} (${BADGE_TRANSITION_TIMEOUT_MS}ms timeout)`
      );
    }
  }

  if (await waitForVisibleToast(page, toast)) {
    throw new Error(`Badge celebration remained visible after ${MAX_BADGE_CELEBRATIONS} dismissal attempts`);
  }
}
