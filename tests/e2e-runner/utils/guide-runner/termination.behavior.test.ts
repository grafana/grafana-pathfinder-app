/** @jest-environment node */

import { spawn } from 'child_process';
import { chromium } from 'playwright';

import { createGuideTerminationController } from './termination';

const browserIt = process.env.PATHFINDER_RUN_BROWSER_BEHAVIOR_TESTS === 'true' ? it : it.skip;

describe('guide termination with Chromium', () => {
  browserIt('reports an unexpected page close', async () => {
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const page = await browser.newPage();
      const controller = createGuideTerminationController(page);

      await page.close();

      await expect(controller.termination).resolves.toMatchObject({
        code: 'PAGE_CLOSED',
        outcome: 'infrastructure_error',
      });
      controller.dispose();
    } finally {
      await browser.close();
    }
  });

  browserIt('reports context closure as infrastructure', async () => {
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const controller = createGuideTerminationController(page);

      await context.close();

      const termination = await controller.termination;
      expect(['PAGE_CLOSED', 'CONTEXT_CLOSED']).toContain(termination.code);
      expect(termination.outcome).toBe('infrastructure_error');
      controller.dispose();
    } finally {
      await browser.close();
    }
  });

  browserIt('reports browser shutdown as infrastructure', async () => {
    const browser = await chromium.launch({ channel: 'chromium', headless: true });
    const page = await browser.newPage();
    const controller = createGuideTerminationController(page);

    await browser.close();

    const termination = await controller.termination;
    expect(['PAGE_CLOSED', 'CONTEXT_CLOSED', 'BROWSER_DISCONNECTED']).toContain(termination.code);
    expect(termination.outcome).toBe('infrastructure_error');
    controller.dispose();
  });

  browserIt(
    'reports the Chromium Page.crash hook',
    async () => {
      const script = `
      const { chromium } = require('playwright');
      (async () => {
        const browser = await chromium.launch({ channel: 'chromium', headless: true });
        const page = await browser.newPage();
        page.once('crash', () => process.send && process.send({ event: 'crash' }));
        const session = await page.context().newCDPSession(page);
        void session.send('Page.crash').catch(() => {});
      })().catch((error) => process.send && process.send({ error: error.message }));
      setInterval(() => {}, 1000);
    `;
      const child = spawn(process.execPath, ['-e', script], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      try {
        await expect(
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Chromium crash event timed out')), 10000);
            child.once('message', (message: unknown) => {
              clearTimeout(timer);
              if (typeof message === 'object' && message !== null && 'event' in message && message.event === 'crash') {
                resolve(message.event);
                return;
              }
              reject(new Error(`Chromium crash subprocess failed: ${JSON.stringify(message)}`));
            });
          })
        ).resolves.toBe('crash');
      } finally {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // The crash subprocess is already gone.
          }
        } else {
          child.kill('SIGKILL');
        }
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('close', () => resolve());
        });
      }
    },
    15000
  );
});
