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
 * SKIPPED (`test.describe.fixme`): this branch is standalone on `main`, where the
 * controller overlay, the live-tab executor, and the "open in interactive window"
 * affordance are gated behind the compile-time `TWOTAB_CONTROLLER_ENABLED` const
 * (`src/constants/interactive-config.ts`), currently `false` with no runtime
 * override — so none of this is reachable on any instance this build can produce.
 * Enabling it needs #1174's `enableTwoTabController` admin toggle, which is not in
 * this branch. Per the re-enable gate these specs stay registered-but-skipped until
 * the flag flips; at that point, seed `jsonData.enableTwoTabController = true` (via
 * `gotoAppConfigPage`, already wired in `tests/fixtures.ts`) and remove the `.fixme`.
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

async function startCapturingSignedStepCommand(page: Page): Promise<void> {
  await page.evaluate((channel) => {
    const w = window as unknown as { __pfCapturedStepCommand?: Record<string, unknown> };
    const ch = new BroadcastChannel(channel);
    ch.onmessage = (event) => {
      const data = event.data as { kind?: string; sig?: string };
      if (data?.kind === 'step-command' && typeof data.sig === 'string') {
        w.__pfCapturedStepCommand = data as unknown as Record<string, unknown>;
        ch.close();
      }
    };
  }, CROSS_TAB_CHANNEL);
}

async function readCapturedStepCommand(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __pfCapturedStepCommand?: Record<string, unknown> };
    return w.__pfCapturedStepCommand ?? null;
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

test.describe.fixme('two-tab controller — real-browser adversarial (pending TWOTAB_CONTROLLER_ENABLED)', () => {
  test('a forged, unsigned step-command does not drive the paired live tab', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    await openController(liveA);
    await acceptPairing(liveA);
    const urlBefore = liveA.url();

    await postRawCrossTabMessage(liveA, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'step-command',
      phase: 'do',
      stepId: 'forged',
      runId: 'forged-run',
      action: { targetAction: 'navigate', refTarget: SENTINEL_PATH },
    });

    // The tab is paired and the live-tab executor is installed and listening, so a
    // stalled URL means the signature gate rejected the unsigned command — not that
    // nothing was listening.
    await liveA.waitForTimeout(500);
    expect(liveA.url()).toBe(urlBefore);
  });

  test('only the paired live tab executes a controller command', async ({ page, context }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA);

    const liveB = await context.newPage();
    await liveB.goto('/');
    await liveB.waitForLoadState('networkidle');

    const liveAUrlBefore = liveA.url();
    const liveBUrlBefore = liveB.url();

    await controller.getByRole('button', { name: /do it/i }).first().click();

    // The command drives the paired tab (A) away from its own baseline; the
    // unpaired tab (B) never moves from its own baseline.
    await expect.poll(() => liveA.url()).not.toBe(liveAUrlBefore);
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
    // acceptProof (the HMAC field #1158 adds to pairing-accept), then answers
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

  test('a replayed genuine step-command is ignored by the live tab', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    // Record the first genuine, signed step-command the controller emits so we can
    // re-post it verbatim — same {sessionId, sigNonce}, the pair the replay ledger
    // (seenSignedMessages in pairing-manager) keys on.
    await startCapturingSignedStepCommand(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA);

    let navigations = 0;
    liveA.on('framenavigated', (frame) => {
      if (frame === liveA.mainFrame()) {
        navigations += 1;
      }
    });

    await controller.getByRole('button', { name: /do it/i }).first().click();
    await expect.poll(() => readCapturedStepCommand(liveA)).not.toBeNull();
    const genuine = await readCapturedStepCommand(liveA);
    const navigationsAfterGenuine = navigations;

    // Re-deliver the once-accepted command. The nonce ledger rejects the second
    // delivery, so the executor never dispatches it again — no further navigation.
    await postRawCrossTabMessage(liveA, genuine as Record<string, unknown>);
    await liveA.waitForTimeout(500);
    expect(navigations).toBe(navigationsAfterGenuine);
  });
});
