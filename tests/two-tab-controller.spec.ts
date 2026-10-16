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
 * They run against the default-on `enableTwoTabController` setting.
 */

const SENTINEL_PATH = '/a/grafana-pathfinder-app/__forged_nav__';
const GUIDE_URL = 'https://interactive-learning.grafana.net/packages/two-tab-adversarial-test/content.json';
const NAVIGATE_STEP = 'open-explore';
const WAITING_SECTION = 'waiting';

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

async function routeGuide(page: Page): Promise<void> {
  const context = page.context();
  await context.route(GUIDE_URL.replace('content.json', 'manifest.json'), (route) =>
    route.fulfill({ json: { id: 'two-tab-adversarial-test', type: 'guide', repository: 'interactive-tutorials' } })
  );
  await context.route(GUIDE_URL, (route) =>
    route.fulfill({
      json: {
        id: 'two-tab-adversarial-test',
        title: 'Two-tab adversarial',
        blocks: [
          {
            type: 'interactive',
            id: NAVIGATE_STEP,
            action: 'navigate',
            reftarget: '/explore',
            content: 'Open Explore.',
          },
          {
            type: 'section',
            id: WAITING_SECTION,
            title: 'Create a dashboard',
            autoCollapse: false,
            blocks: [
              {
                type: 'interactive',
                id: 'open-dashboard',
                action: 'button',
                reftarget: 'New',
                content: 'Open a new dashboard.',
                objectives: ['on-page:/dashboard/new'],
              },
            ],
          },
        ],
      },
    })
  );
}

async function gotoLiveTab(page: Page): Promise<void> {
  await routeGuide(page);
  await page.goto(`/dashboards?doc=${encodeURIComponent(GUIDE_URL)}`);
  await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(testIds.interactive.step(NAVIGATE_STEP))).toBeVisible();
}

async function openController(liveTab: Page): Promise<Page> {
  const openButton = liveTab.getByTestId(testIds.docsPanel.openControllerTabButton);
  await expect(openButton).toBeVisible();

  const controllerPromise = liveTab.context().waitForEvent('page');
  await openButton.click();
  const controller = await controllerPromise;
  await expect(controller.getByTestId(testIds.guideReader.overlay)).toBeVisible({ timeout: 30_000 });
  return controller;
}

async function acceptPairing(liveTab: Page, controller: Page): Promise<void> {
  await liveTab.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(controller.getByTestId(testIds.guideReader.controllerStatus)).toContainText(/connected/i);
}

function reader(controller: Page) {
  return controller.getByTestId(testIds.guideReader.overlay);
}

function doIt(controller: Page) {
  return reader(controller).getByTestId(testIds.interactive.doItButton(NAVIGATE_STEP));
}

test.describe('two-tab controller — real-browser adversarial', () => {
  test('a forged, unsigned step-command does not drive the paired live tab', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA, controller);
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
    await acceptPairing(liveA, controller);

    const liveB = await context.newPage();
    await liveB.goto('/');
    await liveB.waitForLoadState('networkidle');

    const liveAUrlBefore = liveA.url();
    const liveBUrlBefore = liveB.url();

    await doIt(controller).click();

    // The command drives the paired tab (A) away from its own baseline; the
    // unpaired tab (B) never moves from its own baseline.
    await expect.poll(() => liveA.url()).not.toBe(liveAUrlBefore);
    expect(liveB.url()).toBe(liveBUrlBefore);
  });

  test('a stale step-complete from a cancelled run does not settle the retried run', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA, controller);

    const composite = reader(controller).getByTestId(testIds.interactive.doSectionButton(`section-${WAITING_SECTION}`));
    await composite.click();
    await reader(controller)
      .getByRole('button', { name: /cancel/i })
      .first()
      .click();

    await postRawCrossTabMessage(liveA, {
      source: 'pathfinder',
      senderId: 'attacker-tab',
      timestamp: Date.now(),
      kind: 'step-complete',
      stepId: 'open-dashboard',
      runId: 'stale-run',
      ok: true,
    });

    await composite.click();
    await expect(
      reader(controller)
        .getByRole('button', { name: /cancel/i })
        .first()
    ).toBeVisible();
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
    await acceptPairing(liveA, controller);
  });

  test('a replayed genuine step-command is ignored by the live tab', async ({ page }) => {
    const liveA = page;
    await gotoLiveTab(liveA);
    // Record the first genuine, signed step-command the controller emits so we can
    // re-post it verbatim — same {sessionId, sigNonce}, the pair the replay ledger
    // (seenSignedMessages in pairing-manager) keys on.
    await startCapturingSignedStepCommand(liveA);
    const controller = await openController(liveA);
    await acceptPairing(liveA, controller);

    let navigations = 0;
    liveA.on('framenavigated', (frame) => {
      if (frame === liveA.mainFrame()) {
        navigations += 1;
      }
    });

    await doIt(controller).click();
    await expect.poll(() => readCapturedStepCommand(liveA)).not.toBeNull();
    const genuine = await readCapturedStepCommand(liveA);
    await expect(liveA).toHaveURL(/\/explore/);
    await liveA.waitForTimeout(1000);
    const navigationsAfterGenuine = navigations;

    // Re-deliver the once-accepted command. The nonce ledger rejects the second
    // delivery, so the executor never dispatches it again — no further navigation.
    await postRawCrossTabMessage(liveA, genuine as Record<string, unknown>);
    await liveA.waitForTimeout(500);
    expect(navigations).toBe(navigationsAfterGenuine);
  });
});
