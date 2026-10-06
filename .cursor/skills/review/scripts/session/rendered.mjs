import { parseReviewState } from '../review-report.mjs';

const FINDING_LINE =
  /^\d+\. \[(blocking|follow_up|suggestion|nit)\] \*\*([A-Za-z0-9][A-Za-z0-9._-]{0,79}) — (.+)\*\* \(([^)]*)\)$/;
const ACTION_LINE = /^(?:Required|Follow-up|Suggested): /;

export function parseRenderedReview(rendered) {
  const findings = [];
  const lines = rendered.split('\n');
  lines.forEach((line, index) => {
    const match = line.match(FINDING_LINE);
    if (!match) {
      return;
    }
    const [, disposition, id, title, meta] = match;
    const [severity, concernId] = meta.split(' · ');
    const action = (lines[index + 2] ?? '').trim();
    findings.push({
      id,
      disposition,
      severity,
      concern_id: concernId,
      title,
      problem: (lines[index + 1] ?? '').trim(),
      requested_action: ACTION_LINE.test(action) ? action.replace(ACTION_LINE, '') : null,
    });
  });
  const verdict = rendered.match(/^Verdict: (.+)$/m)?.[1] ?? null;
  const prUrl = rendered.match(/^PR Review: (https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+)$/m)?.[1] ?? null;
  return {
    verdict,
    pr_url: prUrl,
    complete: verdict !== null && verdict !== 'Review Incomplete',
    state: parseReviewState(rendered),
    findings,
  };
}
