import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';

import {
  RUNNER_DEADLINE_CLEANUP_GRACE_MS,
  RUNNER_DEADLINE_POLL_MS,
  RUNNER_DISCOVERY_WATCHDOG_MS,
  RUNNER_FORCE_KILL_GRACE_MS,
  isRunnerDeadlineFile,
} from './e2e-runner-contract';

export interface ProcessWatchdog {
  didExpire(): boolean;
  stop(): void;
}

export interface ProcessWatchdogOptions {
  deadlineFilePath: string;
  onExpire(): void;
  onForceKill(): void;
  discoveryTimeoutMs?: number;
  cleanupGraceMs?: number;
  forceKillGraceMs?: number;
  pollMs?: number;
}

export function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when a process group is not available.
    }
  }
  child.kill(signal);
}

export function createProcessWatchdog(child: ChildProcess, options: ProcessWatchdogOptions): ProcessWatchdog {
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? RUNNER_DISCOVERY_WATCHDOG_MS;
  const cleanupGraceMs = options.cleanupGraceMs ?? RUNNER_DEADLINE_CLEANUP_GRACE_MS;
  const forceKillGraceMs = options.forceKillGraceMs ?? RUNNER_FORCE_KILL_GRACE_MS;
  const pollMs = options.pollMs ?? RUNNER_DEADLINE_POLL_MS;
  let expired = false;
  let stopped = false;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
    child.off('close', stop);
    child.off('error', stop);
  };

  const expire = () => {
    if (stopped || expired) {
      return;
    }
    expired = true;
    options.onExpire();
    signalChildProcess(child, 'SIGTERM');
    forceKillTimer = setTimeout(() => {
      if (stopped) {
        return;
      }
      signalChildProcess(child, 'SIGKILL');
      options.onForceKill();
    }, forceKillGraceMs);
  };

  const armDeadline = (deadlineEpochMs: number) => {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
    deadlineTimer = setTimeout(expire, Math.max(0, deadlineEpochMs - Date.now()));
  };

  armDeadline(Date.now() + discoveryTimeoutMs);
  pollTimer = setInterval(() => {
    try {
      const parsed = JSON.parse(readFileSync(options.deadlineFilePath, 'utf8')) as unknown;
      if (!isRunnerDeadlineFile(parsed)) {
        return;
      }
      if (parsed.deadlineEpochMs <= Date.now()) {
        return;
      }
      armDeadline(parsed.deadlineEpochMs + cleanupGraceMs);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    } catch {
      return;
    }
  }, pollMs);

  child.once('close', stop);
  child.once('error', stop);

  return {
    didExpire: () => expired,
    stop,
  };
}
