import type { ChildProcess } from 'child_process';
import { readFileSync } from 'fs';

import {
  RUNNER_DEADLINE_CLEANUP_GRACE_MS,
  RUNNER_DEADLINE_POLL_MS,
  RUNNER_DEATH_VERIFICATION_MS,
  RUNNER_DISCOVERY_WATCHDOG_MS,
  RUNNER_FORCE_KILL_GRACE_MS,
  isRunnerDeadlineFile,
} from './e2e-runner-contract';

export interface ProcessWatchdog {
  didExpire(): boolean;
  stop(): void;
}

export interface ProcessSignalResult {
  sent: boolean;
  target: 'group' | 'child';
  error?: string;
}

export interface ProcessWatchdogOptions {
  deadlineFilePath: string;
  onExpire(): void;
  onForceKill?(): void;
  onContained(): void;
  onContainmentFailure(message: string): void;
  discoveryTimeoutMs?: number;
  cleanupGraceMs?: number;
  forceKillGraceMs?: number;
  deathVerificationMs?: number;
  pollMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function signalChildProcess(child: ChildProcess, signal: NodeJS.Signals): ProcessSignalResult {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return { sent: true, target: 'group' };
    } catch {
      // Fall back to the direct child when a process group is not available.
    }
  }
  try {
    const sent = child.kill(signal);
    return { sent, target: 'child', ...(sent ? {} : { error: `Direct child rejected ${signal}` }) };
  } catch (error) {
    return { sent: false, target: 'child', error: errorMessage(error) };
  }
}

export function isProcessGroupGone(child: ChildProcess): boolean {
  if (process.platform === 'win32' || !child.pid) {
    return true;
  }
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
  }
}

export function createProcessWatchdog(child: ChildProcess, options: ProcessWatchdogOptions): ProcessWatchdog {
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? RUNNER_DISCOVERY_WATCHDOG_MS;
  const cleanupGraceMs = options.cleanupGraceMs ?? RUNNER_DEADLINE_CLEANUP_GRACE_MS;
  const forceKillGraceMs = options.forceKillGraceMs ?? RUNNER_FORCE_KILL_GRACE_MS;
  const deathVerificationMs = options.deathVerificationMs ?? RUNNER_DEATH_VERIFICATION_MS;
  const pollMs = options.pollMs ?? RUNNER_DEADLINE_POLL_MS;
  let expired = false;
  let stopped = false;
  let childClosed = false;
  let lastSignalFailure: string | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlinePollTimer: ReturnType<typeof setInterval> | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  let verificationTimer: ReturnType<typeof setInterval> | undefined;
  let verificationDeadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
    if (deadlinePollTimer) {
      clearInterval(deadlinePollTimer);
    }
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
    }
    if (verificationTimer) {
      clearInterval(verificationTimer);
    }
    if (verificationDeadlineTimer) {
      clearTimeout(verificationDeadlineTimer);
    }
    child.off('close', onClose);
    child.off('error', onError);
  };

  const verifyContainment = () => {
    if (stopped || !expired || !childClosed || !isProcessGroupGone(child)) {
      return;
    }
    options.onContained();
    stop();
  };

  const failContainment = () => {
    if (stopped) {
      return;
    }
    const details = lastSignalFailure ? ` ${lastSignalFailure}.` : '';
    options.onContainmentFailure(`Could not prove Playwright process-tree termination.${details}`);
    stop();
  };

  const expire = () => {
    if (stopped || expired) {
      return;
    }
    expired = true;
    options.onExpire();
    const graceful = signalChildProcess(child, 'SIGTERM');
    if (!graceful.sent) {
      lastSignalFailure = graceful.error ?? 'SIGTERM was not sent';
    }
    verificationTimer = setInterval(verifyContainment, pollMs);
    verifyContainment();
    forceKillTimer = setTimeout(() => {
      if (stopped) {
        return;
      }
      const forced = signalChildProcess(child, 'SIGKILL');
      if (!forced.sent) {
        lastSignalFailure = forced.error ?? 'SIGKILL was not sent';
      }
      options.onForceKill?.();
      verifyContainment();
      verificationDeadlineTimer = setTimeout(() => {
        verifyContainment();
        if (!stopped) {
          failContainment();
        }
      }, deathVerificationMs);
    }, forceKillGraceMs);
  };

  const armDeadline = (deadlineEpochMs: number) => {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
    deadlineTimer = setTimeout(expire, deadlineEpochMs - Date.now());
  };

  function onClose() {
    childClosed = true;
    if (!expired) {
      stop();
      return;
    }
    verifyContainment();
  }

  function onError() {
    if (!expired) {
      stop();
    }
  }

  armDeadline(Date.now() + discoveryTimeoutMs);
  deadlinePollTimer = setInterval(() => {
    try {
      const parsed = JSON.parse(readFileSync(options.deadlineFilePath, 'utf8')) as unknown;
      if (!isRunnerDeadlineFile(parsed)) {
        return;
      }
      armDeadline(parsed.deadlineEpochMs + cleanupGraceMs);
      if (deadlinePollTimer) {
        clearInterval(deadlinePollTimer);
        deadlinePollTimer = undefined;
      }
    } catch {
      return;
    }
  }, pollMs);

  child.once('close', onClose);
  child.once('error', onError);

  return {
    didExpire: () => expired,
    stop,
  };
}
