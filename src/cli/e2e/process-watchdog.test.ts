/** @jest-environment node */

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createProcessWatchdog, isProcessGroupGone, signalChildProcess } from './process-watchdog';
import {
  GUIDE_INITIAL_TIMEOUT_MS,
  RUNNER_DISCOVERY_WATCHDOG_MS,
  RUNNER_MAX_GUIDE_TIMEOUT_MS,
  isRunnerDeadlineFile,
} from './e2e-runner-contract';

function createChild() {
  const child = new EventEmitter() as EventEmitter & { kill: jest.Mock; pid?: number };
  child.kill = jest.fn(() => true);
  return child;
}

function callbacks() {
  return {
    onExpire: jest.fn(),
    onForceKill: jest.fn(),
    onContained: jest.fn(),
    onContainmentFailure: jest.fn(),
  };
}

describe('process watchdog', () => {
  let tempDir: string;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    tempDir = mkdtempSync(join(tmpdir(), 'runner-watchdog-'));
  });

  afterEach(() => {
    jest.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('requires child close after SIGTERM and SIGKILL before containment succeeds', async () => {
    const child = createChild();
    const events = callbacks();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 50,
      deathVerificationMs: 50,
      pollMs: 10,
      ...events,
    });

    await jest.advanceTimersByTimeAsync(150);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(events.onContained).not.toHaveBeenCalled();

    child.emit('close', 1);
    await jest.advanceTimersByTimeAsync(10);

    expect(events.onContained).toHaveBeenCalledTimes(1);
    expect(events.onContainmentFailure).not.toHaveBeenCalled();
  });

  (process.platform === 'win32' ? it.skip : it)(
    'requires POSIX process-group disappearance after direct child close',
    async () => {
      const child = createChild();
      child.pid = 4321;
      let groupGone = false;
      const processKill = jest.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 0 && groupGone) {
          throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        }
        return true;
      });
      const events = callbacks();
      try {
        createProcessWatchdog(child as unknown as ChildProcess, {
          deadlineFilePath: join(tempDir, 'deadline.json'),
          discoveryTimeoutMs: 100,
          forceKillGraceMs: 50,
          deathVerificationMs: 100,
          pollMs: 10,
          ...events,
        });

        await jest.advanceTimersByTimeAsync(150);
        child.emit('close', 1);
        await jest.advanceTimersByTimeAsync(10);
        expect(events.onContained).not.toHaveBeenCalled();

        groupGone = true;
        await jest.advanceTimersByTimeAsync(10);

        expect(processKill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([
          [-4321, 'SIGTERM'],
          [-4321, 'SIGKILL'],
        ]);
        expect(events.onContained).toHaveBeenCalledTimes(1);
      } finally {
        processKill.mockRestore();
      }
    }
  );

  it('reports containment failure when death cannot be proved', async () => {
    const child = createChild();
    const events = callbacks();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 50,
      deathVerificationMs: 50,
      pollMs: 10,
      ...events,
    });

    await jest.advanceTimersByTimeAsync(200);

    expect(events.onContained).not.toHaveBeenCalled();
    expect(events.onContainmentFailure).toHaveBeenCalledWith(
      expect.stringContaining('Could not prove Playwright process-tree termination')
    );
  });

  it('records direct-child signal rejection', () => {
    const child = createChild();
    child.kill.mockReturnValue(false);

    expect(signalChildProcess(child as unknown as ChildProcess, 'SIGTERM')).toEqual({
      sent: false,
      target: 'child',
      error: 'Direct child rejected SIGTERM',
    });
  });

  it('keeps a scheduling margin after the setup policy edge', async () => {
    expect(RUNNER_DISCOVERY_WATCHDOG_MS).toBeGreaterThan(GUIDE_INITIAL_TIMEOUT_MS);
    const child = createChild();
    const events = callbacks();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      ...events,
    });

    await jest.advanceTimersByTimeAsync(GUIDE_INITIAL_TIMEOUT_MS);

    expect(child.kill).not.toHaveBeenCalled();
    child.emit('close', 0);
  });

  it('adopts a valid deadline written after discovery', async () => {
    const child = createChild();
    const events = callbacks();
    const deadlineFilePath = join(tempDir, 'deadline.json');
    const watchdog = createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath,
      discoveryTimeoutMs: 100,
      cleanupGraceMs: 20,
      forceKillGraceMs: 10,
      deathVerificationMs: 10,
      pollMs: 5,
      ...events,
    });
    writeFileSync(deadlineFilePath, JSON.stringify({ deadlineEpochMs: Date.now() + 500 }));

    await jest.advanceTimersByTimeAsync(100);
    expect(events.onExpire).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(420);
    expect(events.onExpire).toHaveBeenCalledTimes(1);
    watchdog.stop();
  });

  it('accepts the exact maximum and a legitimate deadline above 30 minutes', () => {
    const now = Date.now();
    expect(isRunnerDeadlineFile({ deadlineEpochMs: now + 31 * 60 * 1000 }, now)).toBe(true);
    expect(isRunnerDeadlineFile({ deadlineEpochMs: now + RUNNER_MAX_GUIDE_TIMEOUT_MS }, now)).toBe(true);
  });

  it.each([
    ['maximum plus one', (now: number) => now + RUNNER_MAX_GUIDE_TIMEOUT_MS + 1],
    ['timer overflow', (now: number) => now + 2 ** 31],
    ['non-finite', () => Number.POSITIVE_INFINITY],
  ])('rejects a %s deadline', (_name, deadline) => {
    const now = Date.now();
    expect(isRunnerDeadlineFile({ deadlineEpochMs: deadline(now) }, now)).toBe(false);
  });

  it.each([
    ['malformed', '{bad-json'],
    ['stale', JSON.stringify({ deadlineEpochMs: Date.parse('2025-12-31T23:59:59.000Z') })],
    ['far future', JSON.stringify({ deadlineEpochMs: Date.parse('2026-01-01T03:00:00.000Z') })],
  ])('keeps the fallback deadline after a %s update', async (_name, content) => {
    const child = createChild();
    const events = callbacks();
    const deadlineFilePath = join(tempDir, 'deadline.json');
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath,
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 10,
      deathVerificationMs: 10,
      pollMs: 5,
      ...events,
    });
    writeFileSync(deadlineFilePath, content);

    await jest.advanceTimersByTimeAsync(100);

    expect(events.onExpire).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
  });

  it('cancels force kill when death is proved during the grace period', async () => {
    const child = createChild();
    const events = callbacks();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 50,
      deathVerificationMs: 50,
      pollMs: 5,
      ...events,
    });

    await jest.advanceTimersByTimeAsync(100);
    child.emit('close', 1);
    await jest.advanceTimersByTimeAsync(50);

    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(events.onContained).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'error'])('clears timers and listeners on child %s before expiry', async (event) => {
    const child = createChild();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 10,
      deathVerificationMs: 10,
      pollMs: 5,
      ...callbacks(),
    });

    child.emit(event, event === 'error' ? new Error('spawn failed') : 0);
    await jest.advanceTimersByTimeAsync(200);

    expect(child.kill).not.toHaveBeenCalled();
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('reports a POSIX group as gone only for ESRCH', () => {
    if (process.platform === 'win32') {
      return;
    }
    const child = createChild();
    child.pid = 4321;
    const processKill = jest.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    });
    try {
      expect(isProcessGroupGone(child as unknown as ChildProcess)).toBe(true);
    } finally {
      processKill.mockRestore();
    }
  });
});
