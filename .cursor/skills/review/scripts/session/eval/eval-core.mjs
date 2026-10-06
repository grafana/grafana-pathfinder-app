import { createHash } from 'node:crypto';

import { parseRenderedReview } from '../rendered.mjs';

export const ARMS = ['review', 'review-session'];
export const CASE_CATEGORIES = [
  'known-defect',
  'clean-change',
  'architectural',
  'multi-round',
  'security',
  'contract-evolution',
  'controller-fixture',
  'reported-reversal',
  'comparison',
];
export const ADJUDICATION_STATUSES = ['unadjudicated', 'in_progress', 'adjudicated'];
const SHA = /^[0-9a-f]{40}$/;
const CASE_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
function fail(message) {
  throw new Error(message);
}

function isoTime(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !/Z$|[+-]\d\d:\d\d$/.test(value)) {
    fail(`${label} must be an ISO 8601 timestamp with a zone`);
  }
  return value;
}

export function validateCase(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    fail('a case manifest must be an object');
  }
  const allowed = [
    'case_id',
    'repo',
    'pr',
    'category',
    'base_sha',
    'head_sha',
    'evidence_cutoff',
    'prior_review',
    'environment',
    'adjudication_status',
    'candidate_reason',
    'rounds',
  ];
  const unknown = Object.keys(manifest).find((key) => !allowed.includes(key));
  if (unknown) {
    fail(`case manifest has unknown field ${unknown}; answer-key material belongs outside the repository`);
  }
  if (!CASE_ID.test(manifest.case_id ?? '')) {
    fail('case_id must be lowercase letters, digits, and dashes');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repo ?? '') || !Number.isInteger(manifest.pr)) {
    fail('repo must be owner/name and pr an integer');
  }
  if (!CASE_CATEGORIES.includes(manifest.category)) {
    fail(`category must be one of ${CASE_CATEGORIES.join(', ')}`);
  }
  for (const field of ['base_sha', 'head_sha']) {
    if (!SHA.test(manifest[field] ?? '')) {
      fail(`${field} must be a full commit SHA`);
    }
  }
  isoTime(manifest.evidence_cutoff, 'evidence_cutoff');
  if (manifest.prior_review !== null) {
    const prior = manifest.prior_review ?? {};
    if (!SHA.test(prior.reviewed_head ?? '') || typeof prior.author !== 'string') {
      fail('prior_review must be null or { reviewed_head, author, submitted_at, body_path? }');
    }
    isoTime(prior.submitted_at, 'prior_review.submitted_at');
    if (Date.parse(prior.submitted_at) > Date.parse(manifest.evidence_cutoff)) {
      fail('prior_review was submitted after the evidence cutoff');
    }
  }
  const env = manifest.environment ?? {};
  if (typeof env.node !== 'string' || !Array.isArray(env.setup) || !env.setup.every(Array.isArray)) {
    fail('environment must state node and setup as argument arrays');
  }
  if (!ADJUDICATION_STATUSES.includes(manifest.adjudication_status)) {
    fail(`adjudication_status must be one of ${ADJUDICATION_STATUSES.join(', ')}`);
  }
  return manifest;
}

export function validateCaseAgainstHistory(manifest, { headCommittedAt, baseIsAncestor }) {
  validateCase(manifest);
  const problems = [];
  if (!baseIsAncestor) {
    problems.push('base_sha is not an ancestor of head_sha');
  }
  if (Date.parse(headCommittedAt) > Date.parse(manifest.evidence_cutoff)) {
    problems.push(`head_sha was committed at ${headCommittedAt}, after the evidence cutoff`);
  }
  return problems;
}

function runProvenance(caseManifest, parsed) {
  const expectedUrl = `https://github.com/${caseManifest.repo}/pull/${caseManifest.pr}`;
  if (parsed.pr_url !== expectedUrl) {
    fail(`the report reviews ${parsed.pr_url ?? 'no PR'}, not ${expectedUrl}`);
  }
  if (!parsed.state) {
    return {
      status: 'unverified',
      reason: parsed.complete
        ? 'the report has no valid review state marker'
        : 'an incomplete report carries no state marker, so its head cannot be verified',
    };
  }
  if (parsed.state.reviewed_head !== caseManifest.head_sha) {
    fail(`the report reviews head ${parsed.state.reviewed_head}, not the case head ${caseManifest.head_sha}`);
  }
  if (caseManifest.prior_review === null && parsed.state.round !== 1) {
    fail(`the case has no prior review, but the report is round ${parsed.state.round}`);
  }
  if (caseManifest.prior_review !== null && parsed.state.round < 2) {
    fail('the case has a prior review, but the report is round 1; the arm ran without its prior state');
  }
  return { status: 'verified', reason: null };
}

function readCost(meta) {
  const parts = ['subagent_tokens', 'root_tokens'];
  const known = parts.filter((field) => Number.isFinite(meta[field]));
  for (const field of parts) {
    if (meta[field] !== undefined && meta[field] !== null && !Number.isFinite(meta[field])) {
      fail(`run meta ${field} must be a number or null`);
    }
  }
  return {
    subagent_tokens: meta.subagent_tokens ?? null,
    root_tokens: meta.root_tokens ?? null,
    tokens: known.length === parts.length ? meta.subagent_tokens + meta.root_tokens : null,
    complete: known.length === parts.length,
    evidence_ms: meta.evidence_ms ?? null,
    wall_ms: Date.parse(meta.ended_at) - Date.parse(meta.started_at),
    retries: meta.retries ?? 0,
    round_executions: meta.round_executions ?? 1,
  };
}

export function buildRunRecord({ caseManifest, arm, runIndex, rendered, meta }) {
  if (!ARMS.includes(arm)) {
    fail(`arm must be one of ${ARMS.join(', ')}`);
  }
  if (!Number.isInteger(runIndex) || runIndex < 1) {
    fail('run index must be a positive integer');
  }
  for (const field of ['model', 'reasoning', 'tool_revision', 'started_at', 'ended_at']) {
    if (typeof meta[field] !== 'string' || meta[field].length === 0) {
      fail(`run meta must state ${field}`);
    }
  }
  const parsed = parseRenderedReview(rendered);
  const provenance = runProvenance(caseManifest, parsed);
  return {
    case_id: caseManifest.case_id,
    arm,
    run_index: runIndex,
    reviewed_head: provenance.status === 'verified' ? parsed.state.reviewed_head : null,
    round: parsed.state?.round ?? null,
    provenance,
    rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
    verdict: parsed.verdict,
    complete: parsed.complete,
    findings: parsed.findings,
    cost: readCost(meta),
    capability_failures: meta.capability_failures ?? [],
    environment: {
      model: meta.model,
      reasoning: meta.reasoning,
      tool_revision: meta.tool_revision,
      tools: meta.tools ?? [],
    },
  };
}

function stableHash(...parts) {
  return createHash('sha256').update(parts.join('\x1f')).digest('hex');
}

export function maskRuns(runs, seed) {
  if (typeof seed !== 'string' || seed.length < 8) {
    fail('masking needs a private seed of at least 8 characters');
  }
  const entries = runs.flatMap((run) =>
    run.findings.map((finding) => {
      const blind_id = `f-${stableHash(seed, run.case_id, run.arm, String(run.run_index), finding.id).slice(0, 12)}`;
      return {
        blind: {
          blind_id,
          case_id: run.case_id,
          disposition: finding.disposition,
          severity: finding.severity,
          concern_id: finding.concern_id,
          title: finding.title,
          problem: finding.problem,
        },
        mapping: { blind_id, case_id: run.case_id, arm: run.arm, run_index: run.run_index, finding_id: finding.id },
      };
    })
  );
  entries.sort((left, right) => (left.blind.blind_id < right.blind.blind_id ? -1 : 1));
  return { blinded: entries.map(({ blind }) => blind), mapping: entries.map(({ mapping }) => mapping) };
}

const LABELS = ['real', 'pr_attributable', 'necessary_before_merge'];

export function validateAdjudications(entries, { mapping, keys }) {
  if (!Array.isArray(entries)) {
    fail('adjudications must be an array');
  }
  const mapped = new Map(mapping.map((entry) => [entry.blind_id, entry]));
  const seen = new Set();
  return entries.map((entry, index) => {
    const at = `adjudication ${entry?.blind_id ?? `#${index + 1}`}`;
    if (!entry || typeof entry !== 'object') {
      fail(`${at} must be an object`);
    }
    const target = mapped.get(entry.blind_id);
    if (!target) {
      fail(`${at} names no blinded finding`);
    }
    if (seen.has(entry.blind_id)) {
      fail(`${at} appears more than once`);
    }
    seen.add(entry.blind_id);
    for (const label of LABELS) {
      if (typeof entry[label] !== 'boolean') {
        fail(`${at} ${label} must be true or false, not ${JSON.stringify(entry[label])}`);
      }
    }
    for (const field of ['adjudicator', 'reason']) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        fail(`${at} must state ${field}`);
      }
    }
    if (!entry.real && (entry.pr_attributable || entry.necessary_before_merge)) {
      fail(`${at} is contradictory: a finding that is not real cannot be PR-attributable or necessary before merge`);
    }
    const matched = entry.matches_key_item ?? null;
    if (matched !== null) {
      if (typeof matched !== 'string') {
        fail(`${at} matches_key_item must be a key item id or null`);
      }
      if (!entry.real) {
        fail(`${at} is contradictory: a finding that is not real cannot match an answer-key item`);
      }
      const key = keys[target.case_id];
      if (key && !key.items.some((item) => item.id === matched)) {
        fail(`${at} matches ${matched}, which is not an item in the ${target.case_id} answer key`);
      }
    }
    return { ...entry, matches_key_item: matched };
  });
}

export function validateAnswerKey(key) {
  if (!key || !Array.isArray(key.items) || !Array.isArray(key.revisions)) {
    fail('an answer key needs items and revisions arrays');
  }
  for (const item of key.items) {
    if (!['known_defect', 'architectural', 'non_blocking_adjacent', 'invariant'].includes(item.kind)) {
      fail(`answer key item ${item.id} has an unknown kind`);
    }
    if (!Array.isArray(item.acceptable_dispositions) || item.acceptable_dispositions.length === 0) {
      fail(`answer key item ${item.id} needs acceptable_dispositions`);
    }
  }
  for (const revision of key.revisions) {
    if (!revision.reason || !revision.adjudicator || !revision.item_id) {
      fail('every answer key revision records item_id, adjudicator, and reason');
    }
  }
  return key;
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function pairingIssues(runs, manifest) {
  const issues = [];
  const byArm = Object.fromEntries(ARMS.map((arm) => [arm, runs.filter((run) => run.arm === arm)]));
  if (byArm.review.length !== byArm['review-session'].length) {
    issues.push(`run counts differ: ${ARMS.map((arm) => `${arm} ${byArm[arm].length}`).join(', ')}`);
  }
  for (const field of ['model', 'reasoning', 'tool_revision']) {
    const values = new Set(runs.map((run) => run.environment[field]));
    if (values.size > 1) {
      issues.push(`${field} differs across runs: ${[...values].join(', ')}`);
    }
  }
  if (runs.length === 0) {
    issues.push(`no runs for ${manifest.case_id}`);
  }
  return issues;
}

export function scoreRuns({ runs, mapping, adjudications, keys, cases }) {
  const checked = validateAdjudications(adjudications, { mapping, keys });
  const byBlind = new Map(checked.map((entry) => [entry.blind_id, entry]));
  const blindFor = new Map(
    mapping.map((entry) => [
      `${entry.case_id}\x1f${entry.arm}\x1f${entry.run_index}\x1f${entry.finding_id}`,
      entry.blind_id,
    ])
  );
  const report = { arms: {}, excluded_unadjudicated: [], unpaired_cases: [], unverified_runs: [], per_case: [] };
  const scoredCases = new Set();
  for (const manifest of cases) {
    if (manifest.adjudication_status !== 'adjudicated') {
      report.excluded_unadjudicated.push(manifest.case_id);
      continue;
    }
    const caseRuns = runs.filter((run) => run.case_id === manifest.case_id);
    const issues = pairingIssues(caseRuns, manifest);
    if (issues.length > 0) {
      report.unpaired_cases.push({ case_id: manifest.case_id, issues });
      continue;
    }
    scoredCases.add(manifest.case_id);
    report.per_case.push({
      case_id: manifest.case_id,
      verdicts: Object.fromEntries(
        ARMS.map((arm) => [arm, caseRuns.filter((run) => run.arm === arm).map((run) => run.verdict)])
      ),
    });
  }
  for (const run of runs.filter((candidate) => candidate.provenance?.status !== 'verified')) {
    report.unverified_runs.push({
      case_id: run.case_id,
      arm: run.arm,
      run_index: run.run_index,
      reason: run.provenance?.reason ?? 'no provenance',
    });
  }
  for (const arm of ARMS) {
    const armRuns = runs.filter((run) => run.arm === arm);
    const pairedRuns = armRuns.filter((run) => scoredCases.has(run.case_id));
    const scored = pairedRuns.filter((run) => run.provenance?.status === 'verified');
    let blockers = 0;
    let validBlockers = 0;
    let unadjudicatedFindings = 0;
    const recall = {
      known_defect: { detected: 0, correct_disposition: 0, total: 0 },
      architectural: { detected: 0, correct_disposition: 0, total: 0 },
    };
    for (const run of scored) {
      const key = validateAnswerKey(keys[run.case_id]);
      const detected = new Map();
      for (const finding of run.findings) {
        const verdict = byBlind.get(blindFor.get(`${run.case_id}\x1f${arm}\x1f${run.run_index}\x1f${finding.id}`));
        if (!verdict) {
          unadjudicatedFindings += 1;
          continue;
        }
        if (finding.disposition === 'blocking') {
          blockers += 1;
          if (verdict.real === true && verdict.pr_attributable === true && verdict.necessary_before_merge === true) {
            validBlockers += 1;
          }
        }
        if (verdict.matches_key_item !== null) {
          detected.set(verdict.matches_key_item, [
            ...(detected.get(verdict.matches_key_item) ?? []),
            finding.disposition,
          ]);
        }
      }
      for (const [kind, tally] of Object.entries(recall)) {
        for (const item of key.items.filter((candidate) => candidate.kind === kind)) {
          tally.total += 1;
          const dispositions = detected.get(item.id) ?? [];
          if (dispositions.length > 0) {
            tally.detected += 1;
          }
          if (dispositions.some((disposition) => item.acceptable_dispositions.includes(disposition))) {
            tally.correct_disposition += 1;
          }
        }
      }
    }
    const incomplete = pairedRuns.filter((run) => !run.complete).length;
    const costed = pairedRuns.filter((run) => run.cost.complete);
    report.arms[arm] = {
      runs: armRuns.length,
      paired_runs: pairedRuns.length,
      scored_runs: scored.length,
      blocker_precision: ratio(validBlockers, blockers),
      known_defect_recall: ratio(recall.known_defect.detected, recall.known_defect.total),
      known_defect_disposition_recall: ratio(recall.known_defect.correct_disposition, recall.known_defect.total),
      architectural_recall: ratio(recall.architectural.detected, recall.architectural.total),
      architectural_disposition_recall: ratio(recall.architectural.correct_disposition, recall.architectural.total),
      incomplete_run_rate: ratio(incomplete, pairedRuns.length),
      unadjudicated_findings: unadjudicatedFindings,
      median_total_tokens: median(costed.map((run) => run.cost.tokens)),
      runs_missing_cost: pairedRuns.length - costed.length,
      median_wall_ms: median(pairedRuns.map((run) => run.cost.wall_ms)),
      capability_failures: armRuns.flatMap((run) => run.capability_failures),
    };
  }
  report.not_scored = [
    'convergence across rounds: reopened findings, new regressions, unnecessary new blockers, and adjacent-work demands',
  ];
  return report;
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
