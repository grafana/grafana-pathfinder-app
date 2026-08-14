/** @jest-environment node */

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createProcessWatchdog } from './process-watchdog';
import { GUIDE_INITIAL_TIMEOUT_MS, RUNNER_DISCOVERY_WATCHDOG_MS } from './e2e-runner-contract';

function createChild() {
  const child = new EventEmitter() as EventEmitter & { kill: jest.Mock };
  child.kill = jest.fn(() => true);
  return child;
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

  it('requests graceful termination before force kill', async () => {
    const child = createChild();
    const onExpire = jest.fn();
    const onForceKill = jest.fn();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 50,
      pollMs: 10,
      onExpire,
      onForceKill,
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await jest.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(onForceKill).toHaveBeenCalledTimes(1);
  });

  (process.platform === 'win32' ? it.skip : it)('signals the POSIX process group in order', async () => {
    const child = createChild();
    Object.defineProperty(child, 'pid', { value: 4321 });
    const processKill = jest.spyOn(process, 'kill').mockReturnValue(true);
    try {
      createProcessWatchdog(child as unknown as ChildProcess, {
        deadlineFilePath: join(tempDir, 'deadline.json'),
        discoveryTimeoutMs: 100,
        forceKillGraceMs: 50,
        pollMs: 10,
        onExpire: jest.fn(),
        onForceKill: jest.fn(),
      });

      await jest.advanceTimersByTimeAsync(150);

      expect(processKill.mock.calls).toEqual([
        [-4321, 'SIGTERM'],
        [-4321, 'SIGKILL'],
      ]);
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      processKill.mockRestore();
      child.emit('close', 1);
    }
  });

  it('keeps a scheduling margin after the setup policy edge', async () => {
    expect(RUNNER_DISCOVERY_WATCHDOG_MS).toBeGreaterThan(GUIDE_INITIAL_TIMEOUT_MS);
    const child = createChild();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      onExpire: jest.fn(),
      onForceKill: jest.fn(),
    });

    await jest.advanceTimersByTimeAsync(GUIDE_INITIAL_TIMEOUT_MS);

    expect(child.kill).not.toHaveBeenCalled();
    child.emit('close', 0);
  });

  it('adopts the deadline written after discovery', async () => {
    const child = createChild();
    const onExpire = jest.fn();
    const deadlineFilePath = join(tempDir, 'deadline.json');
    const watchdog = createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath,
      discoveryTimeoutMs: 100,
      cleanupGraceMs: 20,
      forceKillGraceMs: 10,
      pollMs: 5,
      onExpire,
      onForceKill: jest.fn(),
    });
    writeFileSync(deadlineFilePath, JSON.stringify({ deadlineEpochMs: Date.now() + 500 }));

    await jest.advanceTimersByTimeAsync(100);
    expect(onExpire).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(420);
    expect(onExpire).toHaveBeenCalledTimes(1);
    watchdog.stop();
  });

  it.each([
    ['malformed', '{bad-json'],
    ['stale', JSON.stringify({ deadlineEpochMs: Date.parse('2025-12-31T23:59:59.000Z') })],
  ])('keeps the fallback deadline after a %s update', async (_name, content) => {
    const child = createChild();
    const onExpire = jest.fn();
    const deadlineFilePath = join(tempDir, 'deadline.json');
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath,
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 10,
      pollMs: 5,
      onExpire,
      onForceKill: jest.fn(),
    });
    writeFileSync(deadlineFilePath, content);

    await jest.advanceTimersByTimeAsync(100);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
  });

  it('cancels force kill when the child closes during the grace period', async () => {
    const child = createChild();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 50,
      pollMs: 5,
      onExpire: jest.fn(),
      onForceKill: jest.fn(),
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
    await jest.advanceTimersByTimeAsync(50);

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it.each(['close', 'error'])('clears timers and listeners on child %s', async (event) => {
    const child = createChild();
    createProcessWatchdog(child as unknown as ChildProcess, {
      deadlineFilePath: join(tempDir, 'deadline.json'),
      discoveryTimeoutMs: 100,
      forceKillGraceMs: 10,
      pollMs: 5,
      onExpire: jest.fn(),
      onForceKill: jest.fn(),
    });

    child.emit(event, event === 'error' ? new Error('spawn failed') : 0);
    await jest.advanceTimersByTimeAsync(200);

    expect(child.kill).not.toHaveBeenCalled();
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });
});
