import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function normalizePurpose(title) {
  const purpose = title
    .replace(/^[a-z-]+(?:\([^)]+\))?!?:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return purpose.length <= 120 ? purpose : `${purpose.slice(0, 119).trimEnd()}…`;
}

const DISPOSITIONS = ['blocking', 'suggestion', 'nit'];
const SEVERITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3],
]);

export function parseReviewState(output) {
  const encoded = output.match(/<!-- pathfinder-review-state:(\{[^\n]+\}) -->/)?.[1];
  if (!encoded) {
    return null;
  }
  try {
    const state = JSON.parse(encoded);
    if (
      state.version !== 1 ||
      !/^[0-9a-f]{40}$/i.test(state.reviewed_head ?? '') ||
      !Array.isArray(state.blocking_findings) ||
      state.blocking_findings.some(
        (finding) =>
          !finding ||
          typeof finding !== 'object' ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(finding.id ?? '') ||
          !/^[a-z0-9-]+$/.test(finding.concern_id ?? '')
      )
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderFinding(finding, index) {
  const actionLabel = finding.disposition === 'blocking' ? 'Required' : 'Suggested';
  return [
    `${index + 1}. [${finding.disposition}] **${finding.id} — ${finding.title}**`,
    `   ${finding.problem.replace(/\s+/g, ' ').trim()}`,
    `   ${actionLabel}: ${finding.suggested_action.replace(/\s+/g, ' ').trim()}`,
  ].join('\n');
}

function validateReport(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Review report must be an object');
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(report.pr_url ?? '')) {
    throw new Error('pr_url must be a full GitHub pull request URL');
  }
  if (typeof report.pr_title !== 'string' || normalizePurpose(report.pr_title).length === 0) {
    throw new Error('pr_title must produce a non-empty purpose');
  }
  if (!/^[0-9a-f]{40}$/i.test(report.reviewed_head ?? '')) {
    throw new Error('reviewed_head must be a full commit SHA');
  }
  if (!Array.isArray(report.findings)) {
    throw new Error('findings must be an array');
  }
  for (const finding of report.findings) {
    if (!DISPOSITIONS.includes(finding.disposition)) {
      throw new Error('finding disposition must be blocking, suggestion, or nit');
    }
    if (!SEVERITY_RANK.has(finding.severity)) {
      throw new Error('finding severity must be critical, high, medium, or low');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(finding.id ?? '')) {
      throw new Error('finding id must be a stable identifier');
    }
    if (!/^[a-z0-9-]+$/.test(finding.concern_id ?? '')) {
      throw new Error('finding concern_id must be a concern identifier');
    }
    for (const field of ['title', 'problem', 'suggested_action']) {
      if (typeof finding[field] !== 'string' || finding[field].trim().length === 0) {
        throw new Error(`finding ${field} must be a non-empty string`);
      }
    }
  }
}

export function renderReviewReport(report) {
  validateReport(report);
  const purpose = normalizePurpose(report.pr_title);
  const grouped = Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, []]));
  for (const finding of report.findings) {
    grouped[finding.disposition].push(finding);
  }
  for (const disposition of DISPOSITIONS) {
    grouped[disposition].sort(
      (left, right) => (SEVERITY_RANK.get(left.severity) ?? 99) - (SEVERITY_RANK.get(right.severity) ?? 99)
    );
  }

  const sections = [];
  if (grouped.blocking.length > 0) {
    sections.push(
      '## Merge contract',
      '',
      `Fix ${grouped.blocking.length === 1 ? 'this item' : 'these items'} and this PR is mergeable.`,
      '',
      grouped.blocking.map(renderFinding).join('\n\n')
    );
  } else {
    sections.push('No blocking issues. This PR is mergeable.');
  }
  for (const [disposition, heading] of [
    ['suggestion', 'Suggestions'],
    ['nit', 'Nits'],
  ]) {
    if (grouped[disposition].length > 0) {
      sections.push('', `## ${heading}`, '', grouped[disposition].map(renderFinding).join('\n\n'));
    }
  }

  const counts = [
    countLabel(grouped.blocking.length, 'blocking', 'blocking'),
    countLabel(grouped.suggestion.length, 'suggestion'),
    countLabel(grouped.nit.length, 'nit'),
  ].join(', ');
  const verdict =
    grouped.blocking.length > 0
      ? 'Request Changes'
      : grouped.suggestion.length > 0 || grouped.nit.length > 0
        ? 'Approve with Minor'
        : 'Approve';
  const state = JSON.stringify({
    version: 1,
    reviewed_head: report.reviewed_head,
    blocking_findings: grouped.blocking.map(({ id, concern_id }) => ({ id, concern_id })),
  });

  sections.push(
    '',
    `<!-- pathfinder-review-state:${state} -->`,
    '',
    `PR Review: ${report.pr_url}`,
    `Purpose: ${purpose}`,
    `Verdict: ${verdict}`,
    counts
  );
  return sections.join('\n');
}

function main() {
  if (process.argv[2] === '--parse-state' && process.argv.length === 4) {
    const state = parseReviewState(readFileSync(process.argv[3], 'utf8'));
    if (!state) {
      throw new Error('No valid Pathfinder review state found');
    }
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  if (process.argv.length !== 3) {
    throw new Error('Expected a review report JSON file or --parse-state <review-body-file>');
  }
  const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(`${renderReviewReport(report)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
