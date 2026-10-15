import type { RecoveryAction, RecoveryCheck, RecoveryCondition } from './section-recovery-plan';

export type RecoveryFailure = 'repair_failed' | 'drifted';

export interface RecoveryResult {
  passed: boolean;
  canRestore: boolean;
  checkIndex?: number;
  gaveUp?: boolean;
  failure?: RecoveryFailure;
}

export interface RecoveryAdapter {
  check: (condition: RecoveryCondition) => Promise<RecoveryResult>;
  restore: (condition: RecoveryCondition) => Promise<boolean>;
  replay: (action: RecoveryAction) => Promise<boolean>;
  canReplay: (action: RecoveryAction) => Promise<boolean>;
}

const cancelled = (): RecoveryResult => ({ passed: false, canRestore: false });

async function conditionsHold(
  conditions: readonly RecoveryCondition[],
  adapter: RecoveryAdapter,
  signal?: AbortSignal
): Promise<boolean> {
  for (const condition of conditions) {
    if (signal?.aborted || !(await adapter.check(condition)).passed) {
      return false;
    }
  }
  return true;
}

async function recipeRestorable(
  recipe: readonly RecoveryAction[],
  adapter: RecoveryAdapter,
  signal?: AbortSignal
): Promise<boolean> {
  for (const action of recipe) {
    if (await conditionsHold(action.objectives, adapter, signal)) {
      continue;
    }
    return !signal?.aborted && (await adapter.canReplay(action));
  }
  return false;
}

export async function inspectRecovery(
  checks: readonly RecoveryCheck[],
  adapter: RecoveryAdapter,
  signal?: AbortSignal
): Promise<RecoveryResult> {
  for (const [checkIndex, check] of checks.entries()) {
    if (signal?.aborted) {
      return cancelled();
    }
    const result = await adapter.check(check);
    if (signal?.aborted) {
      return cancelled();
    }
    if (!result.passed) {
      const viaRecipe = !!check.recover?.length && (await recipeRestorable(check.recover, adapter, signal));
      return { passed: false, canRestore: result.canRestore || viaRecipe, checkIndex };
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

async function replayRecipe(
  checks: readonly RecoveryCheck[],
  checkIndex: number,
  adapter: RecoveryAdapter,
  signal: AbortSignal
): Promise<boolean> {
  const check = checks[checkIndex]!;
  for (const action of check.recover ?? []) {
    if (signal.aborted) {
      return false;
    }
    // An open final view makes transient setup (such as its now-closed menu) unnecessary.
    if ((await adapter.check(check)).passed) {
      return true;
    }
    if (!(await conditionsHold(checks.slice(0, checkIndex), adapter, signal))) {
      return false;
    }
    if (await conditionsHold(action.objectives, adapter, signal)) {
      continue;
    }
    const mountDeadline = Date.now() + 5000;
    let replayed = false;
    while (!signal.aborted && !(replayed = await adapter.replay(action)) && Date.now() < mountDeadline) {
      await waitForRender(signal);
      if (await conditionsHold(action.objectives, adapter, signal)) {
        break;
      }
    }
    if (signal.aborted) {
      return false;
    }
    if (!replayed && !(await conditionsHold(action.objectives, adapter, signal))) {
      return false;
    }
    let satisfied = false;
    const deadline = Date.now() + 5000;
    while (!signal.aborted) {
      if ((await adapter.check(check)).passed) {
        return true;
      }
      satisfied = await conditionsHold(action.objectives, adapter, signal);
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

export async function restoreRecovery(
  checks: readonly RecoveryCheck[],
  adapter: RecoveryAdapter,
  signal: AbortSignal
): Promise<RecoveryResult> {
  const attempted = new Set<number>();
  let settlingDeadline: number | undefined;
  while (!signal.aborted) {
    const result = await inspectRecovery(checks, adapter, signal);
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
      return { ...result, canRestore: false, gaveUp: true, failure: 'drifted' };
    }
    attempted.add(result.checkIndex);
    const check = checks[result.checkIndex]!;
    const restored = check.recover?.length
      ? await replayRecipe(checks, result.checkIndex, adapter, signal)
      : await adapter.restore(check);
    if (!restored) {
      return { ...result, canRestore: false, gaveUp: true, failure: 'repair_failed' };
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
