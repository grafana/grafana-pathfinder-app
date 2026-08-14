/** @jest-environment node */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createProcessWatchdog, isProcessGroupGone } from './process-watchdog';

const posixIt = process.platform === 'win32' ? it.skip : it;

describe('process watchdog subprocess containment', () => {
  posixIt('kills a SIGTERM-resistant child and its grandchild before success', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'watchdog-subprocess-'));
    const script = `
      const { spawn } = require('child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.on('SIGTERM', () => {});
      if (process.send) process.send({ grandchildPid: grandchild.pid });
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let grandchildPid: number | undefined;
    try {
      grandchildPid = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Grandchild startup timed out')), 2000);
        child.once('message', (message: unknown) => {
          clearTimeout(timer);
          const pid =
            typeof message === 'object' && message !== null && 'grandchildPid' in message
              ? message.grandchildPid
              : undefined;
          if (typeof pid !== 'number') {
            reject(new Error('Grandchild PID was not reported'));
            return;
          }
          resolve(pid);
        });
      });
      const events: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Watchdog containment timed out')), 5000);
        createProcessWatchdog(child, {
          deadlineFilePath: join(tempDir, 'deadline.json'),
          discoveryTimeoutMs: 50,
          forceKillGraceMs: 100,
          deathVerificationMs: 2000,
          pollMs: 20,
          onExpire: () => events.push('SIGTERM'),
          onForceKill: () => events.push('SIGKILL'),
          onContained: () => {
            clearTimeout(timeout);
            events.push('contained');
            resolve();
          },
          onContainmentFailure: (message) => {
            clearTimeout(timeout);
            reject(new Error(message));
          },
        });
      });

      expect(events).toEqual(['SIGTERM', 'SIGKILL', 'contained']);
      expect(child.signalCode).toBe('SIGKILL');
      expect(isProcessGroupGone(child)).toBe(true);
      expect(() => process.kill(grandchildPid!, 0)).toThrow();
    } finally {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The process group is already gone.
        }
      }
      if (grandchildPid) {
        try {
          process.kill(grandchildPid, 'SIGKILL');
        } catch {
          // The grandchild is already gone.
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
