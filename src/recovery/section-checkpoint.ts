import type { JsonCheckpointCheck, JsonCheckpointRecoveryStep, JsonSectionCheckpoint } from '../types/json-guide.types';

export interface CheckpointResult {
  passed: boolean;
  canRestore: boolean;
  explanation?: string;
  checkIndex?: number;
}

export interface CheckpointAdapter {
  check: (check: JsonCheckpointCheck) => Promise<CheckpointResult>;
  restore: (check: JsonCheckpointCheck) => Promise<boolean>;
  replay?: (step: JsonCheckpointRecoveryStep) => Promise<boolean>;
}

const cancelled = (): CheckpointResult => ({
  passed: false,
  canRestore: false,
  explanation: 'Recovery stopped. Check the section again when you are ready.',
});

export async function inspectCheckpoint(
  checkpoint: JsonSectionCheckpoint,
  adapter: CheckpointAdapter,
  signal?: AbortSignal
): Promise<CheckpointResult> {
  for (const [checkIndex, check] of checkpoint.checks.entries()) {
    if (signal?.aborted) {
      return cancelled();
    }
    const result = await adapter.check(check);
    if (signal?.aborted) {
      return cancelled();
    }
    if (!result.passed) {
      const hasRecipe = !!(check.recover?.length && adapter.replay);
      return {
        ...result,
        canRestore: result.canRestore || hasRecipe,
        explanation: hasRecipe
          ? "Recovery can restore this state using the guide's saved actions."
          : result.explanation,
        checkIndex,
      };
    }
  }
  return { passed: true, canRestore: false };
}

function waitForRender(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      observer?.disconnect();
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(finish);
    const timer = setTimeout(finish, 50);
    observer?.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}

async function replayRecovery(
  checkpoint: JsonSectionCheckpoint,
  checkIndex: number,
  adapter: CheckpointAdapter,
  signal: AbortSignal
): Promise<boolean> {
  const check = checkpoint.checks[checkIndex]!;
  for (const step of check.recover ?? []) {
    if (signal.aborted) {
      return false;
    }
    // An open final view makes transient setup (such as its now-closed menu) unnecessary.
    if ((await adapter.check(check)).passed) {
      return true;
    }
    if (!(await inspectCheckpoint({ checks: checkpoint.checks.slice(0, checkIndex) }, adapter, signal)).passed) {
      return false;
    }
    if ((await inspectCheckpoint({ checks: step.objectives }, adapter, signal)).passed) {
      continue;
    }
    if (signal.aborted || !step.replaySafe || !(await adapter.replay?.(step))) {
      return false;
    }
    let satisfied = false;
    const deadline = Date.now() + 5000;
    while (!signal.aborted) {
      if ((await adapter.check(check)).passed) {
        return true;
      }
      satisfied = (await inspectCheckpoint({ checks: step.objectives }, adapter, signal)).passed;
      if (satisfied || Date.now() >= deadline) {
        break;
      }
      await waitForRender(signal);
    }
    if (!satisfied) {
      return false;
    }
  }
  return !signal.aborted && (await adapter.check(check)).passed;
}

export async function restoreCheckpoint(
  checkpoint: JsonSectionCheckpoint,
  adapter: CheckpointAdapter,
  signal: AbortSignal
): Promise<CheckpointResult> {
  const attempted = new Set<number>();
  let settlingDeadline: number | undefined;
  while (!signal.aborted) {
    const result = await inspectCheckpoint(checkpoint, adapter, signal);
    if (signal.aborted) {
      return cancelled();
    }
    if (!result.passed && !result.canRestore && settlingDeadline !== undefined && Date.now() < settlingDeadline) {
      await waitForRender(signal);
      continue;
    }
    if (result.passed || !result.canRestore || result.checkIndex === undefined) {
      return result;
    }
    if (attempted.has(result.checkIndex)) {
      return { ...result, explanation: 'The section changed again. Check it before trying recovery again.' };
    }
    attempted.add(result.checkIndex);
    const check = checkpoint.checks[result.checkIndex]!;
    const restored = check.recover?.length
      ? await replayRecovery(checkpoint, result.checkIndex, adapter, signal)
      : await adapter.restore(check);
    if (!restored) {
      return {
        ...result,
        explanation: 'This condition could not be restored. Follow the recovery instructions and check again.',
      };
    }
    settlingDeadline = Date.now() + 5000;
    // A dispatched action is not evidence that React has rendered the requested state.
    const verificationDeadline = Date.now() + 5000;
    while (!signal.aborted && Date.now() < verificationDeadline) {
      if ((await adapter.check(check)).passed) {
        break;
      }
      await waitForRender(signal);
    }
  }
  return cancelled();
}
