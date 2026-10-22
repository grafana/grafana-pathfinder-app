import { insightsQuality } from './insights-quality';
import type { LearningInsightsResponse } from '../../types/learning-insights';

const data = (
  warnings: string[],
  completeness: LearningInsightsResponse['completeness'] = 'partial'
): LearningInsightsResponse => ({
  asOf: '',
  from: '',
  to: '',
  capability: { available: true },
  completeness,
  warnings,
  people: [],
  completions: [],
  assignments: [],
});

test.each([
  [['journey-identity-ambiguous'], false, false],
  [['completions-page-limit'], true, false],
  [['invalid-completion-record'], true, false],
  [['assignments-fetch-failed'], false, true],
  [['assignments-namespace-mismatch'], false, true],
  [['invalid-assignment-record'], false, true],
  [['evaluation-deadline'], false, true],
  [['completions-fetch-failed', 'assignments-page-limit'], true, true],
  [['future-diagnostic'], true, true],
  [[], true, true],
])('scopes missing records for %j', (warnings, completionsIncomplete, assignmentsIncomplete) => {
  const quality = insightsQuality(data(warnings));
  expect(quality.completionsIncomplete).toBe(completionsIncomplete);
  expect(quality.assignmentsIncomplete).toBe(assignmentsIncomplete);
  expect(quality.notices.length > 0).toBe(completionsIncomplete || assignmentsIncomplete);
  for (const token of warnings) {
    expect(quality.notices.join(' ')).not.toContain(token);
  }
});

test('complete reads do not produce warnings', () => {
  expect(insightsQuality(data([], 'complete'))).toEqual({
    completionsIncomplete: false,
    assignmentsIncomplete: false,
    ambiguous: false,
    notices: [],
  });
});
