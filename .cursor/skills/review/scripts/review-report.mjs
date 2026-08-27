import { createHash } from 'node:crypto';
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
const REVERSIBILITY = new Map([
  ['reversible', null],
  ['unknown', null],
  ['partially_reversible', 'partially reversible'],
  ['irreversible_without_cleanup', 'irreversible without cleanup'],
]);
const ASSESSMENT_STATUSES = ['complete', 'incomplete'];
const EVALUATOR_SOURCES = ['stable', 'head_smoke'];
const REVIEW_MODES = ['full', 'incremental'];
const LEDGER_OUTCOMES = ['blocking', 'suggestion', 'nit', 'dropped', 'resolved'];
const MAX_INCOMPLETE_REASON = 240;
const STATE_MARKER = /^<!-- pathfinder-review-state:(\{.+\}) -->$/;
const STATE_MARKER_PREFIX = /^<!-- pathfinder-review-state:/;
const RECAP_SHAPE = [
  /^PR Review: https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/,
  /^Purpose: \S.*$/,
  /^Verdict: (?:Approve|Approve with Minor|Request Changes|Review Incomplete)$/,
  /^\d+ blocking, \d+ suggestions?, \d+ nits?$/,
];

function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function neutralizeMarkdown(value) {
  return oneLine(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\b(https?):\/\//gi, '$1:\u200B//')
    .replace(/\bwww\./gi, 'www.\u200B')
    .replace(/@/g, '@\u200B')
    .replace(/([\\`*_{}\[\]()#+!|])/g, '\\$1');
}

function completeVerdict(blocking, suggestions, nits) {
  return blocking > 0 ? 'Request Changes' : suggestions > 0 || nits > 0 ? 'Approve with Minor' : 'Approve';
}

function trailingStateMarker(output) {
  const lines = output.split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1).trim() === '') {
    lines.pop();
  }
  const markerIndexes = lines.flatMap((line, index) => (STATE_MARKER_PREFIX.test(line.trim()) ? [index] : []));
  if (markerIndexes.length !== 1) {
    return null;
  }
  const recap = lines.slice(-RECAP_SHAPE.length);
  if (recap.length !== RECAP_SHAPE.length || !RECAP_SHAPE.every((shape, index) => shape.test(recap[index]))) {
    return null;
  }
  let index = lines.length - RECAP_SHAPE.length - 1;
  while (index >= 0 && lines[index].trim() === '') {
    index -= 1;
  }
  if (index !== markerIndexes[0]) {
    return null;
  }
  const encoded = lines[index].match(STATE_MARKER)?.[1];
  return encoded ? { encoded, recap } : null;
}

export function parseReviewState(output) {
  const trailing = trailingStateMarker(output);
  if (!trailing) {
    return null;
  }
  try {
    const state = JSON.parse(trailing.encoded);
    const validFindingRef = (finding) =>
      finding &&
      typeof finding === 'object' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(finding.id ?? '') &&
      /^[a-z0-9-]+$/.test(finding.concern_id ?? '');
    if (
      ![1, 2].includes(state.version) ||
      !/^[0-9a-f]{40}$/i.test(state.reviewed_head ?? '') ||
      !Array.isArray(state.blocking_findings) ||
      state.blocking_findings.some((finding) => !validFindingRef(finding))
    ) {
      return null;
    }
    if (
      state.version === 2 &&
      (!EVALUATOR_SOURCES.includes(state.evaluator_source) ||
        !REVIEW_MODES.includes(state.review_mode) ||
        !Array.isArray(state.candidate_ledger) ||
        state.candidate_ledger.length > 100 ||
        state.candidate_ledger.some(
          (finding) =>
            !validFindingRef(finding) ||
            !LEDGER_OUTCOMES.includes(finding.outcome) ||
            !/^[0-9a-f]{64}$/i.test(finding.fingerprint ?? '')
        ) ||
        new Set(state.candidate_ledger.map((finding) => finding.id)).size !== state.candidate_ledger.length ||
        !Array.isArray(state.inspected_scopes) ||
        state.inspected_scopes.length > 50 ||
        state.inspected_scopes.some(
          (scope) =>
            !scope || !/^[a-z0-9-]+$/.test(scope.concern_id ?? '') || !/^[0-9a-f]{64}$/i.test(scope.fingerprint ?? '')
        ) ||
        new Set(state.inspected_scopes.map((scope) => scope.concern_id)).size !== state.inspected_scopes.length)
    ) {
      return null;
    }
    const verdict = trailing.recap[2].slice('Verdict: '.length);
    const [, blocking, suggestions, nits] =
      trailing.recap[3].match(/^(\d+) blocking, (\d+) suggestions?, (\d+) nits?$/) ?? [];
    const [blockingCount, suggestionCount, nitCount] = [blocking, suggestions, nits].map(Number);
    const ledgerCounts =
      state.version === 2
        ? ['blocking', 'suggestion', 'nit'].map(
            (outcome) => state.candidate_ledger.filter((candidate) => candidate.outcome === outcome).length
          )
        : null;
    const ledgerBlockersMatch =
      state.version !== 2 ||
      state.blocking_findings.every((blockingFinding) =>
        state.candidate_ledger.some(
          (candidate) =>
            candidate.id === blockingFinding.id &&
            candidate.concern_id === blockingFinding.concern_id &&
            candidate.outcome === 'blocking'
        )
      );
    if (
      verdict !== completeVerdict(blockingCount, suggestionCount, nitCount) ||
      state.blocking_findings.length !== blockingCount ||
      (ledgerCounts &&
        (ledgerCounts[0] !== blockingCount || ledgerCounts[1] !== suggestionCount || ledgerCounts[2] !== nitCount)) ||
      !ledgerBlockersMatch
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
  const meta = [finding.severity, finding.concern_id, REVERSIBILITY.get(finding.reversibility)].filter(Boolean);
  return [
    `${index + 1}. [${finding.disposition}] **${finding.id} — ${neutralizeMarkdown(finding.title)}** (${meta.join(' · ')})`,
    `   ${neutralizeMarkdown(finding.problem)}`,
    `   ${actionLabel}: ${neutralizeMarkdown(finding.suggested_action)}`,
  ].join('\n');
}

function findingFingerprint(finding) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        finding.id,
        finding.concern_id,
        finding.disposition,
        finding.severity,
        finding.title,
        finding.problem,
        finding.suggested_action,
      ])
    )
    .digest('hex');
}

function readAssessment(report) {
  const assessment = report.assessment;
  if (assessment === undefined || assessment === null) {
    return { status: 'complete', reason: null };
  }
  if (typeof assessment !== 'object' || !ASSESSMENT_STATUSES.includes(assessment.status)) {
    throw new Error('assessment status must be complete or incomplete');
  }
  if (assessment.status === 'complete') {
    return { status: 'complete', reason: null };
  }
  const reason = typeof assessment.reason === 'string' ? oneLine(assessment.reason) : '';
  if (reason.length === 0 || reason.length > MAX_INCOMPLETE_REASON) {
    throw new Error(`an incomplete assessment must state one reason of at most ${MAX_INCOMPLETE_REASON} characters`);
  }
  return { status: 'incomplete', reason };
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
  if (report.evaluator_source != null && !EVALUATOR_SOURCES.includes(report.evaluator_source)) {
    throw new Error('evaluator_source must be stable or head_smoke');
  }
  if (report.review_mode != null && !REVIEW_MODES.includes(report.review_mode)) {
    throw new Error('review_mode must be full or incremental');
  }
  const seenIds = new Set();
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
    if (seenIds.has(finding.id)) {
      throw new Error(`finding id ${finding.id} must be unique across the report`);
    }
    seenIds.add(finding.id);
    if (!/^[a-z0-9-]+$/.test(finding.concern_id ?? '')) {
      throw new Error('finding concern_id must be a concern identifier');
    }
    if (finding.reversibility != null && !REVERSIBILITY.has(finding.reversibility)) {
      throw new Error('finding reversibility must be a documented reversibility value');
    }
    for (const field of ['title', 'problem', 'suggested_action']) {
      if (typeof finding[field] !== 'string' || finding[field].trim().length === 0) {
        throw new Error(`finding ${field} must be a non-empty string`);
      }
    }
  }
  const candidateLedger = report.candidate_ledger ?? [];
  if (!Array.isArray(candidateLedger) || candidateLedger.length > 100) {
    throw new Error('candidate_ledger must be an array with at most 100 entries');
  }
  for (const candidate of candidateLedger) {
    if (!candidate || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(candidate.id ?? '')) {
      throw new Error('candidate id must be stable');
    }
    if (seenIds.has(candidate.id)) {
      throw new Error(`candidate id ${candidate.id} must be unique across the report`);
    }
    seenIds.add(candidate.id);
    if (!/^[a-z0-9-]+$/.test(candidate.concern_id ?? '')) {
      throw new Error('candidate concern_id must be a concern identifier');
    }
    if (!['dropped', 'resolved'].includes(candidate.outcome)) {
      throw new Error('supplied candidate outcome must be dropped or resolved');
    }
    if (!/^[0-9a-f]{64}$/i.test(candidate.fingerprint ?? '')) {
      throw new Error('candidate fingerprint must be a SHA-256 value');
    }
  }
  const inspectedScopes = report.inspected_scopes ?? [];
  if (!Array.isArray(inspectedScopes) || inspectedScopes.length > 50) {
    throw new Error('inspected_scopes must be an array with at most 50 entries');
  }
  const seenScopes = new Set();
  for (const scope of inspectedScopes) {
    if (!scope || !/^[a-z0-9-]+$/.test(scope.concern_id ?? '')) {
      throw new Error('inspected scope concern_id must be a concern identifier');
    }
    if (seenScopes.has(scope.concern_id)) {
      throw new Error(`inspected scope ${scope.concern_id} must be unique`);
    }
    seenScopes.add(scope.concern_id);
    if (!/^[0-9a-f]{64}$/i.test(scope.fingerprint ?? '')) {
      throw new Error('inspected scope fingerprint must be a SHA-256 value');
    }
  }
}

export function renderReviewReport(report) {
  validateReport(report);
  const assessment = readAssessment(report);
  const purpose = neutralizeMarkdown(normalizePurpose(report.pr_title));
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
  if (assessment.status === 'incomplete') {
    sections.push(
      '## Review incomplete',
      '',
      `Reason: ${assessment.reason}`,
      '',
      'This review states no merge contract; treat merge readiness as unknown.'
    );
    if (grouped.blocking.length > 0) {
      sections.push('', '## Blocking findings so far', '', grouped.blocking.map(renderFinding).join('\n\n'));
    }
  } else if (grouped.blocking.length > 0) {
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
    assessment.status === 'incomplete'
      ? 'Review Incomplete'
      : completeVerdict(grouped.blocking.length, grouped.suggestion.length, grouped.nit.length);
  if (assessment.status === 'complete') {
    const candidateLedger = [
      ...report.findings.map((finding) => ({
        id: finding.id,
        concern_id: finding.concern_id,
        outcome: finding.disposition,
        fingerprint: findingFingerprint(finding),
      })),
      ...(report.candidate_ledger ?? []),
    ];
    const state = JSON.stringify({
      version: 2,
      reviewed_head: report.reviewed_head,
      evaluator_source: report.evaluator_source ?? 'stable',
      review_mode: report.review_mode ?? 'full',
      blocking_findings: grouped.blocking.map(({ id, concern_id }) => ({ id, concern_id })),
      candidate_ledger: candidateLedger,
      inspected_scopes: report.inspected_scopes ?? [],
    });
    sections.push('', `<!-- pathfinder-review-state:${state} -->`);
  }

  sections.push('', `PR Review: ${report.pr_url}`, `Purpose: ${purpose}`, `Verdict: ${verdict}`, counts);
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
