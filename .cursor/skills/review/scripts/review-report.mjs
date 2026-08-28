import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function normalizePurpose(title) {
  const purpose = title
    .replace(/^[a-z-]+(?:\([^)]+\))?!?:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return purpose.length <= 120 ? purpose : `${purpose.slice(0, 119).trimEnd()}…`;
}

const DISPOSITIONS = ['blocking', 'follow_up', 'suggestion', 'nit'];
const ACTION_LABELS = new Map([
  ['blocking', 'Required'],
  ['follow_up', 'Follow-up'],
  ['suggestion', 'Suggested'],
  ['nit', 'Suggested'],
]);
const SECTIONS = [
  ['follow_up', 'Follow-ups'],
  ['suggestion', 'Suggestions'],
  ['nit', 'Nits'],
];
const FOLLOW_UP_PREAMBLE = 'These are tracked separately and do not block merge.';
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
const REPORT_FIELDS = new Set([
  'pr_url',
  'pr_title',
  'reviewed_head',
  'findings',
  'round',
  'deferred',
  'cleared',
  'assessment',
]);
const FINDING_FIELDS = new Set([
  'id',
  'concern_id',
  'disposition',
  'severity',
  'title',
  'problem',
  'suggested_action',
  'reversibility',
]);
const MAX_INCOMPLETE_REASON = 240;
const MAX_ROUND = 100;
const MAX_CLEARED = 12;
const MAX_CLAIM = 200;
const MAX_CLEARED_REASON = 300;
const MAX_MARKER = 8192;
const STATE_MARKER_TOKEN = '<!-- pathfinder-review-state:';
const COMMENT_TERMINATOR = '-->';
const STATE_MARKER = /^<!-- pathfinder-review-state:(\{.+\}) -->$/;
const STATE_MARKER_PREFIX = /^<!-- pathfinder-review-state:/;
const RECAP_SHAPE = [
  /^PR Review: https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/,
  /^Purpose: \S.*$/,
  /^Verdict: (?:Approve|Approve with Minor|Request Changes|Review Incomplete)$/,
  /^\d+ blocking, (?:\d+ follow-ups?, )?\d+ suggestions?, \d+ nits?$/,
];
const RECAP_COUNTS = /^(\d+) blocking, (?:(\d+) follow-ups?, )?(\d+) suggestions?, (\d+) nits?$/;

function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function completeVerdict(blocking, followUps, suggestions, nits) {
  if (blocking > 0) {
    return 'Request Changes';
  }
  return followUps > 0 || suggestions > 0 || nits > 0 ? 'Approve with Minor' : 'Approve';
}

function embedsStateMarker(value) {
  return value.includes(STATE_MARKER_TOKEN) || oneLine(value).includes(STATE_MARKER_TOKEN);
}

function isCapped(value, max) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !value.includes(STATE_MARKER_TOKEN) &&
    !value.includes(COMMENT_TERMINATOR)
  );
}

function isRound(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ROUND;
}

function resolveRound(round) {
  if (round === undefined) {
    return 1;
  }
  if (!Number.isInteger(round) || round < 1) {
    throw new Error('round must be a positive integer');
  }
  return Math.min(round, MAX_ROUND);
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

function isFindingRef(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(entry.id ?? '') &&
    /^[a-z0-9-]+$/.test(entry.concern_id ?? '')
  );
}

function buildState(base, allDeferred, allCleared) {
  const complete = JSON.stringify({ ...base, deferred: allDeferred, cleared: allCleared });
  if (complete.length <= MAX_MARKER) {
    return complete;
  }
  return JSON.stringify({
    version: 2,
    round: base.round,
    reviewed_head: base.reviewed_head,
    blocking_findings: [],
    deferred: [],
    cleared: [],
    truncated: true,
  });
}

function isClearedEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    /^[a-z0-9-]+$/.test(entry.concern_id ?? '') &&
    isCapped(entry.claim, MAX_CLAIM) &&
    isCapped(entry.reason, MAX_CLEARED_REASON)
  );
}

function normalizeState(state) {
  if (state.version === 1) {
    return {
      version: 1,
      round: 1,
      reviewed_head: state.reviewed_head,
      blocking_findings: state.blocking_findings,
      deferred: [],
      cleared: [],
      truncated: false,
    };
  }
  if (!isRound(state.round) || !Array.isArray(state.deferred) || !Array.isArray(state.cleared)) {
    return null;
  }
  if (state.cleared.length > MAX_CLEARED) {
    return null;
  }
  if (state.truncated != null && state.truncated !== true) {
    return null;
  }
  if (!state.deferred.every(isFindingRef) || !state.cleared.every(isClearedEntry)) {
    return null;
  }
  if (
    state.truncated === true &&
    (state.blocking_findings.length > 0 || state.deferred.length > 0 || state.cleared.length > 0)
  ) {
    return null;
  }
  return {
    version: 2,
    round: state.round,
    reviewed_head: state.reviewed_head,
    blocking_findings: state.blocking_findings,
    deferred: state.deferred,
    cleared: state.cleared,
    truncated: state.truncated === true,
  };
}

export function parseReviewState(output) {
  const trailing = trailingStateMarker(output);
  if (!trailing || trailing.encoded.length > MAX_MARKER) {
    return null;
  }
  try {
    const state = JSON.parse(trailing.encoded);
    const allowedFields =
      state.version === 1
        ? new Set(['version', 'reviewed_head', 'blocking_findings'])
        : new Set(['version', 'round', 'reviewed_head', 'blocking_findings', 'deferred', 'cleared', 'truncated']);
    if (
      (state.version !== 1 && state.version !== 2) ||
      Object.keys(state).some((field) => !allowedFields.has(field)) ||
      !/^[0-9a-f]{40}$/i.test(state.reviewed_head ?? '') ||
      !Array.isArray(state.blocking_findings) ||
      !state.blocking_findings.every(isFindingRef)
    ) {
      return null;
    }
    const normalized = normalizeState(state);
    if (!normalized) {
      return null;
    }
    const verdict = trailing.recap[2].slice('Verdict: '.length);
    const [, blocking, followUps, suggestions, nits] = trailing.recap[3].match(RECAP_COUNTS) ?? [];
    const [blockingCount, followUpCount, suggestionCount, nitCount] = [blocking, followUps ?? 0, suggestions, nits].map(
      Number
    );
    if (
      verdict !== completeVerdict(blockingCount, followUpCount, suggestionCount, nitCount) ||
      (!normalized.truncated && normalized.blocking_findings.length !== blockingCount)
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderFinding(finding, index) {
  const meta = [finding.severity, finding.concern_id, REVERSIBILITY.get(finding.reversibility)].filter(Boolean);
  const marker = `${index + 1}. `;
  const indent = ' '.repeat(marker.length);
  const lines = [
    `${marker}[${finding.disposition}] **${finding.id} — ${oneLine(finding.title)}** (${meta.join(' · ')})`,
    `${indent}${oneLine(finding.problem)}`,
    `${indent}${ACTION_LABELS.get(finding.disposition)}: ${oneLine(finding.suggested_action)}`,
  ];
  return lines.join('\n');
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
  if (embedsStateMarker(reason)) {
    throw new Error('an incomplete assessment reason must not embed a review state marker');
  }
  if (reason.length === 0 || reason.length > MAX_INCOMPLETE_REASON) {
    throw new Error(`an incomplete assessment must state one reason of at most ${MAX_INCOMPLETE_REASON} characters`);
  }
  return { status: 'incomplete', reason };
}

function readCleared(report) {
  const cleared = report.cleared ?? [];
  if (!Array.isArray(cleared)) {
    throw new Error('cleared must be an array');
  }
  if (cleared.length > MAX_CLEARED) {
    throw new Error(`a review carries at most ${MAX_CLEARED} cleared claims; prune the least load-bearing ones`);
  }
  return cleared.map((entry) => {
    if (!entry || typeof entry !== 'object' || !/^[a-z0-9-]+$/.test(entry.concern_id ?? '')) {
      throw new Error('each cleared claim must name a concern_id');
    }
    const claim = typeof entry.claim === 'string' ? oneLine(entry.claim) : '';
    const reason = typeof entry.reason === 'string' ? oneLine(entry.reason) : '';
    if (!isCapped(claim, MAX_CLAIM)) {
      throw new Error(
        `a cleared claim must be one line of at most ${MAX_CLAIM} characters and must not embed an HTML comment boundary`
      );
    }
    if (!isCapped(reason, MAX_CLEARED_REASON)) {
      throw new Error(
        `a cleared reason must be one line of at most ${MAX_CLEARED_REASON} characters and must not embed an HTML comment boundary`
      );
    }
    return { claim, concern_id: entry.concern_id, reason };
  });
}

function readDeferred(report) {
  if (!Array.isArray(report.deferred)) {
    throw new Error('deferred must be the reconciled array from review-policy.mjs');
  }
  const seen = new Set();
  return report.deferred.map((entry) => {
    if (!isFindingRef(entry)) {
      throw new Error('each deferred entry must include a stable id and concern_id');
    }
    if (seen.has(entry.id)) {
      throw new Error(`deferred id ${entry.id} must be unique`);
    }
    seen.add(entry.id);
    return { id: entry.id, concern_id: entry.concern_id };
  });
}

function validateReport(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('Review report must be an object');
  }
  const unknownReportField = Object.keys(report).find((field) => !REPORT_FIELDS.has(field));
  if (unknownReportField) {
    throw new Error(`unknown review report field: ${unknownReportField}`);
  }
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(report.pr_url ?? '')) {
    throw new Error('pr_url must be a full GitHub pull request URL');
  }
  if (typeof report.pr_title !== 'string' || normalizePurpose(report.pr_title).length === 0) {
    throw new Error('pr_title must produce a non-empty purpose');
  }
  if (embedsStateMarker(report.pr_title)) {
    throw new Error('pr_title must not embed a review state marker');
  }
  if (!/^[0-9a-f]{40}$/i.test(report.reviewed_head ?? '')) {
    throw new Error('reviewed_head must be a full commit SHA');
  }
  if (!Array.isArray(report.findings)) {
    throw new Error('findings must be an array');
  }
  const seenIds = new Set();
  for (const finding of report.findings) {
    const unknownFindingField = Object.keys(finding).find((field) => !FINDING_FIELDS.has(field));
    if (unknownFindingField) {
      throw new Error(`unknown author-facing finding field: ${unknownFindingField}`);
    }
    if (!DISPOSITIONS.includes(finding.disposition)) {
      throw new Error('finding disposition must be blocking, follow_up, suggestion, or nit');
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
      if (embedsStateMarker(finding[field])) {
        throw new Error(`finding ${field} must not embed a review state marker`);
      }
    }
  }
}

function assembleBody(context) {
  const { assessment, grouped, deferred, cleared, purpose, round, report, counts, verdict } = context;
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
  for (const [disposition, heading] of SECTIONS) {
    const findings = grouped[disposition];
    if (findings.length === 0) {
      continue;
    }
    sections.push(
      '',
      `## ${heading}`,
      '',
      ...(disposition === 'follow_up' ? [FOLLOW_UP_PREAMBLE, ''] : []),
      findings.map(renderFinding).join('\n\n')
    );
  }
  if (assessment.status === 'complete') {
    const base = {
      version: 2,
      round,
      reviewed_head: report.reviewed_head,
      blocking_findings: grouped.blocking.map(({ id, concern_id }) => ({ id, concern_id })),
    };
    sections.push('', `<!-- pathfinder-review-state:${buildState(base, deferred, cleared)} -->`);
  }
  sections.push('', `PR Review: ${report.pr_url}`, `Purpose: ${purpose}`, `Verdict: ${verdict}`, counts);
  return sections.join('\n');
}

function markerLineCount(body) {
  return body.split(/\r?\n/).filter((line) => STATE_MARKER_PREFIX.test(line.trim())).length;
}

export function renderReviewReport(report) {
  validateReport(report);
  const round = resolveRound(report.round);
  const assessment = readAssessment(report);
  const deferred = readDeferred(report);
  const cleared = readCleared(report);
  const purpose = normalizePurpose(report.pr_title);
  const grouped = Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, []]));
  for (const finding of report.findings) {
    grouped[finding.disposition].push(finding);
  }
  const deferredById = new Map(deferred.map((entry) => [entry.id, entry]));
  for (const finding of grouped.follow_up) {
    const entry = deferredById.get(finding.id);
    if (!entry || entry.concern_id !== finding.concern_id) {
      throw new Error(`follow-up ${finding.id} must be present in reconciled deferred state`);
    }
  }
  const bySeverity = (left, right) =>
    (SEVERITY_RANK.get(left.severity) ?? 99) - (SEVERITY_RANK.get(right.severity) ?? 99);
  for (const disposition of DISPOSITIONS) {
    grouped[disposition].sort(bySeverity);
  }
  const counts = [
    countLabel(grouped.blocking.length, 'blocking', 'blocking'),
    countLabel(grouped.follow_up.length, 'follow-up'),
    countLabel(grouped.suggestion.length, 'suggestion'),
    countLabel(grouped.nit.length, 'nit'),
  ].join(', ');
  const verdict =
    assessment.status === 'incomplete'
      ? 'Review Incomplete'
      : completeVerdict(
          grouped.blocking.length,
          grouped.follow_up.length,
          grouped.suggestion.length,
          grouped.nit.length
        );
  const body = assembleBody({ assessment, grouped, deferred, cleared, purpose, round, report, counts, verdict });

  const expectedMarkers = assessment.status === 'complete' ? 1 : 0;
  if (markerLineCount(body) !== expectedMarkers) {
    throw new Error('a rendered review must contain exactly the state marker the renderer emits');
  }
  return body;
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
