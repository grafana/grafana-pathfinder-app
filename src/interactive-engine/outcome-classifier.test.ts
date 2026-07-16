import type { SequenceRunResult, UserActionOutcome } from '../lib/telemetry';
import {
  type CompletionResult,
  type LoopExitReason,
  outcomeFromCompletionResult,
  outcomeFromLoopExit,
  outcomeFromSequenceRun,
} from './outcome-classifier';

describe('outcome-classifier', () => {
  describe('outcomeFromCompletionResult', () => {
    const cases: Array<[CompletionResult, UserActionOutcome]> = [
      ['completed', 'ok'],
      ['timeout', 'timeout'],
      ['cancelled', 'cancelled'],
      ['skipped', 'skipped'],
      ['error', 'action_error'],
    ];

    it.each(cases)('maps %s -> %s', (result, expected) => {
      expect(outcomeFromCompletionResult(result)).toBe(expected);
    });
  });

  describe('outcomeFromSequenceRun', () => {
    const cases: Array<[SequenceRunResult | undefined, UserActionOutcome]> = [
      [undefined, 'ok'],
      ['completed', 'ok'],
      ['requirements_exhausted', 'requirements_exhausted'],
      ['action_error', 'action_error'],
    ];

    it.each(cases)('maps %s -> %s', (result, expected) => {
      expect(outcomeFromSequenceRun(result)).toBe(expected);
    });
  });

  describe('outcomeFromLoopExit', () => {
    const cases: Array<[LoopExitReason, UserActionOutcome]> = [
      ['ok', 'ok'],
      ['cancelled', 'cancelled'],
      ['requirements_exhausted', 'requirements_exhausted'],
      ['action_error', 'action_error'],
    ];

    it.each(cases)('maps %s -> %s', (reason, expected) => {
      expect(outcomeFromLoopExit(reason)).toBe(expected);
    });
  });
});
