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
      'Completion records could not all be loaded. Completion totals may be incomplete. Refresh to retry; if this continues, contact your administrator.'
    );
  }
  if (assignmentsIncomplete) {
    notices.push(
      'Assignment records could not all be loaded. Some assignments may be missing from the summary and follow-up lists. Refresh to retry; if this continues, contact your administrator.'
    );
  }
  return { completionsIncomplete, assignmentsIncomplete, ambiguous, notices };
}
