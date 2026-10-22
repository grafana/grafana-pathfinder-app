import type { LearningInsightsResponse } from '../../types/learning-insights';

export function insightsQuality(data: LearningInsightsResponse) {
  const completionWarnings = data.warnings.filter(
    (value) => value.startsWith('completions-') || value === 'invalid-completion-record'
  );
  const assignmentWarnings = data.warnings.filter(
    (value) =>
      value.startsWith('assignments-') || value === 'invalid-assignment-record' || value === 'evaluation-deadline'
  );
  const ambiguous = data.warnings.includes('journey-identity-ambiguous');
  const known = new Set([
    ...completionWarnings,
    ...assignmentWarnings,
    ...(ambiguous ? ['journey-identity-ambiguous'] : []),
  ]);
  const unclassified =
    data.warnings.some((value) => !known.has(value)) || (data.completeness === 'partial' && !data.warnings.length);
  const completionsIncomplete = completionWarnings.length > 0 || unclassified;
  const assignmentsIncomplete = assignmentWarnings.length > 0 || unclassified;
  const notices: string[] = [];
  if (completionsIncomplete) {
    notices.push(
      'Completion records could not all be loaded. Counts, rankings and the chart cover available records only; missing records may change totals and dates. Refresh to retry. If this continues, ask your administrator to check reporting access and read limits.'
    );
  }
  if (ambiguous) {
    notices.push(
      'Some journey records cannot be identified as individual guides. They are excluded from completion counts, people completing, rankings and the chart, and from recent completions. Counts cover identifiable guides only. If guide credit is missing, ask your administrator to check the original records; refreshing cannot repair older records.'
    );
  }
  if (assignmentsIncomplete) {
    notices.push(
      'Assignment records could not all be loaded. Counts and follow-up lists cover available records only, so an empty list is not an all-clear. Refresh to retry. If this continues, ask your administrator to check reporting access and read limits.'
    );
  }
  return { completionsIncomplete, assignmentsIncomplete, ambiguous, notices };
}
