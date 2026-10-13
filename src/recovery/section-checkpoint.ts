import type { JsonCheckpointCheck, JsonSectionCheckpoint } from '../types/json-guide.types';

export interface CheckpointResult {
  passed: boolean;
  canRestore: boolean;
  explanation?: string;
  checkIndex?: number;
}

export interface CheckpointAdapter {
  check: (check: JsonCheckpointCheck) => Promise<CheckpointResult>;
  restore: (check: JsonCheckpointCheck) => Promise<boolean>;
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
      return { ...result, checkIndex };
    }
  }
  return { passed: true, canRestore: false };
}

function waitForRender(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, 100);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) {
      finish();
    }
  });
}

export async function restoreCheckpoint(
  checkpoint: JsonSectionCheckpoint,
  adapter: CheckpointAdapter,
  signal: AbortSignal
): Promise<CheckpointResult> {
  const attempted = new Set<number>();
  let settlingChecks = 0;
  while (!signal.aborted) {
    const result = await inspectCheckpoint(checkpoint, adapter, signal);
    if (signal.aborted) {
      return cancelled();
    }
    if (!result.passed && !result.canRestore && attempted.size > 0 && settlingChecks < 50) {
      settlingChecks++;
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
    if (!(await adapter.restore(check))) {
      return {
        ...result,
        explanation: 'This condition could not be restored. Follow the recovery instructions and check again.',
      };
    }
    // A dispatched action is not evidence that React has rendered the requested state.
    for (let attempt = 0; attempt < 20 && !signal.aborted; attempt++) {
      if ((await adapter.check(check)).passed) {
        break;
      }
      await waitForRender(signal);
    }
  }
  return cancelled();
}
