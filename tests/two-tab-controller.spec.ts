import { test, expect } from './fixtures';
import { testIds } from '../src/constants/testIds';
import { CROSS_TAB_CHANNEL } from '../src/types/cross-tab.types';
import type { Page } from '@playwright/test';

/**
 * Real-browser adversarial coverage for the two-tab controller (#1142).
 *
 * The security-critical cross-tab tests elsewhere run in jsdom, where
 * BroadcastChannel is mocked and message delivery is synchronous. These specs
 * exercise the same trust boundary across real, separate JS contexts where the
 * channel delivers asynchronously — the conditions the mock can't reproduce.
 *
 * SKIPPED (`test.describe.fixme`) until the `enableTwoTabController` admin
 * setting is turned on (plugin config → Interactive features): the controller
 * overlay, the live-tab executor, and the "open in interactive window"
 * affordance are all gated on that setting (default off), so none of this is
 * reachable on a default instance. To run these, enable the setting (or seed it
 * in the test instance's plugin jsonData) and remove the `.fixme`.
 */

const SENTINEL_PATH = '/a/grafana-pathfinder-app/__forged_nav__';

async function postRawCrossTabMessage(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ channel, msg }) => {
      const ch = new BroadcastChannel(channel);
      ch.postMessage(msg);
      ch.close();
    },
    { channel: CROSS_TAB_CHANNEL, msg: message }
  );
}

async function startCapturingSessionId(page: Page): Promise<void> {
  await page.evaluate((channel) => {
    const w = window as unknown as { __pfCapturedSessionId?: string };
    const ch = new BroadcastChannel(channel);
    ch.onmessage = (event) => {
      const data = event.data as { kind?: string; sessionId?: string };
      if (data?.kind === 'pairing-challenge' && typeof data.sessionId === 'string') {
        w.__pfCapturedSessionId = data.sessionId;
        ch.close();
      }
    };
  }, CROSS_TAB_CHANNEL);
}

async function readCapturedSessionId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __pfCapturedSessionId?: string };
    return w.__pfCapturedSessionId ?? '';
  });
}

async function gotoLiveTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

async function openController(liveTab: Page): Promise<Page> {
  await liveTab.locator('button[aria-label="Help"]').click();
  await expect(liveTab.getByTestId(testIds.docsPanel.container)).toBeVisible();

  const openButton = liveTab.getByTestId(testIds.docsPanel.openControllerTabButton);
  await expect(openButton).toBeVisible();

  const controllerPromise = liveTab.context().waitForEvent('page');
  await openButton.click();
  const controller = await controllerPromise;
  await controller.waitForLoadState('networkidle');
  return controller;
}

async function acceptPairing(liveTab: Page): Promise<void> {
  await liveTab.getByRole('button', { name: 'Accept' }).click();
}

test.describe.fixme('two-tab controller — real-browser adversarial (pending enableTwoTabController)', () => {
  test('a forged, unsigned step-command does not drive the live tab', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const urlBefore = page.url();

    await postRawCrossTabMessage(page, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'step-command',
      phase: 'do',
      stepId: 'forged',
      runId: 'forged-run',
      action: { targetAction: 'navigate', refTarget: SENTINEL_PATH },
    });

    await page.waitForTimeout(500);
    expect(page.url()).toBe(urlBefore);
  });

  test('only the paired live tab executes a controller command', async ({ page, context }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA);

    const liveB = await context.newPage();
    await liveB.goto('/');
    await liveB.waitForLoadState('networkidle');
    const liveBUrlBefore = liveB.url();

    await controller.getByRole('button', { name: /do it/i }).first().click();

    await expect.poll(() => liveA.url()).not.toBe(liveBUrlBefore);
    expect(liveB.url()).toBe(liveBUrlBefore);
  });

  test('a stale step-complete from a cancelled run does not settle the retried run', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA);

    const composite = controller.getByRole('button', { name: /do section|do it/i }).first();
    await composite.click();
    await controller
      .getByRole('button', { name: /cancel/i })
      .first()
      .click();

    await postRawCrossTabMessage(liveA, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'step-complete',
      stepId: 'composite-step',
      runId: 'stale-run',
      ok: true,
    });

    await composite.click();
    await expect(controller.getByRole('button', { name: /cancel/i }).first()).toBeVisible();
  });

  test('a forged pairing-accept cannot claim the controller pairing slot', async ({ page, context }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    await startCapturingSessionId(liveA);
    const controller = await openController(liveA);
    await expect.poll(() => readCapturedSessionId(liveA)).not.toBe('');
    const sessionId = await readCapturedSessionId(liveA);
    const status = controller.getByTestId(testIds.guideReader.controllerStatus);

    // Attacker reads sessionId off the wire and posts an accept with a bogus
    // acceptProof (the HMAC field added in #1158, stacked below), then answers
    // heartbeats as the paired tab. The controller must reject the unprovable
    // accept and refuse to bind to the attacker.
    const attacker = await context.newPage();
    await attacker.goto('/');
    await postRawCrossTabMessage(attacker, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'pairing-accept',
      sessionId,
      pairingId: 'guessed',
      acceptProof: 'forged',
    });
    await postRawCrossTabMessage(attacker, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'heartbeat',
      role: 'live',
    });

    // Forge rejected: the controller does not pair to the attacker.
    await expect(status).not.toContainText(/connected/i);

    // The genuine gesture-accept still pairs.
    await acceptPairing(liveA);
    await expect(status).toContainText(/connected/i);
  });
});
