import type { CheckResultError, CheckVerdict } from '../types/requirements.types';

export function checkVerdict(result: Pick<CheckResultError, 'pass' | 'verdict'>): CheckVerdict {
  return result.verdict ?? (result.pass ? 'satisfied' : 'unsatisfied');
}

export function combineCheckVerdicts(results: Array<Pick<CheckResultError, 'pass' | 'verdict'>>): CheckVerdict {
  const verdicts = results.map(checkVerdict);
  for (const verdict of ['invalid', 'unavailable', 'unsatisfied'] as const) {
    if (verdicts.includes(verdict)) {
      return verdict;
    }
  }
  return 'satisfied';
}
