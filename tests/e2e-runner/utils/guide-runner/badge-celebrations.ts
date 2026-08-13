import type { Locator, Page } from '@playwright/test';

import { testIds } from '../../../../src/constants/testIds';

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

  for (let elapsed = 0; elapsed < BADGE_TRANSITION_TIMEOUT_MS; elapsed += BADGE_TRANSITION_POLL_MS) {
    if (!(await isVisible(toast))) {
      if (!expectNextToast) {
        return true;
      }
    } else if ((await toast.textContent()) !== previousText) {
      return true;
    }

    await page.waitForTimeout(BADGE_TRANSITION_POLL_MS);
  }

  return !(await isVisible(toast));
}

export async function dismissBadgeCelebrations(page: Page): Promise<void> {
  const toast = page.getByTestId(testIds.learningPaths.badgeToast).first();

  for (let attempt = 1; attempt <= MAX_BADGE_CELEBRATIONS; attempt++) {
    if (!(await waitForVisibleToast(page, toast))) {
      return;
    }

    const previousText = (await toast.textContent()) ?? '';
    const dismissButton = page.getByTestId(testIds.learningPaths.badgeToastDismiss);

    try {
      await dismissButton.click({ timeout: BADGE_TRANSITION_TIMEOUT_MS });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
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
