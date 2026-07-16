import type { SequenceRunResult, UserActionOutcome } from '../lib/telemetry';

export type CompletionResult = 'completed' | 'timeout' | 'cancelled' | 'skipped' | 'error';

export type LoopExitReason = 'ok' | 'cancelled' | 'requirements_exhausted' | 'action_error';

const COMPLETION_RESULT_OUTCOMES: Record<CompletionResult, UserActionOutcome> = {
  completed: 'ok',
  timeout: 'timeout',
  cancelled: 'cancelled',
  skipped: 'skipped',
  error: 'action_error',
};

const LOOP_EXIT_OUTCOMES: Record<LoopExitReason, UserActionOutcome> = {
  ok: 'ok',
  cancelled: 'cancelled',
  requirements_exhausted: 'requirements_exhausted',
  action_error: 'action_error',
};

export function outcomeFromCompletionResult(result: CompletionResult): UserActionOutcome {
  return COMPLETION_RESULT_OUTCOMES[result];
}

export function outcomeFromSequenceRun(result: SequenceRunResult | undefined): UserActionOutcome {
  if (result === undefined || result === 'completed') {
    return 'ok';
  }
  return result;
}

export function outcomeFromLoopExit(reason: LoopExitReason): UserActionOutcome {
  return LOOP_EXIT_OUTCOMES[reason];
}
