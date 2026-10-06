import { createHash } from 'node:crypto';

import { parseReviewState } from '../../review-report.mjs';

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
const FINDING_LINE =
  /^\d+\. \[(blocking|follow_up|suggestion|nit)\] \*\*([A-Za-z0-9][A-Za-z0-9._-]{0,79}) — (.+)\*\* \(([^)]*)\)$/;

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

export function parseRenderedFindings(rendered) {
  const findings = [];
  const lines = rendered.split('\n');
  lines.forEach((line, index) => {
    const match = line.match(FINDING_LINE);
    if (!match) {
      return;
    }
    const [, disposition, id, title, meta] = match;
    const [severity, concernId] = meta.split(' · ');
    findings.push({
      id,
      disposition,
      severity,
      concern_id: concernId,
      title,
      problem: (lines[index + 1] ?? '').trim(),
    });
  });
  const verdict = rendered.match(/^Verdict: (.+)$/m)?.[1] ?? null;
  return {
    verdict,
    complete: verdict !== null && verdict !== 'Review Incomplete',
    state: parseReviewState(rendered),
    findings,
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
  const parsed = parseRenderedFindings(rendered);
  return {
    case_id: caseManifest.case_id,
    arm,
    run_index: runIndex,
    reviewed_head: caseManifest.head_sha,
    rendered_sha256: createHash('sha256').update(rendered).digest('hex'),
    verdict: parsed.verdict,
    complete: parsed.complete,
    findings: parsed.findings,
    cost: {
      tokens: meta.tokens ?? null,
      wall_ms: Date.parse(meta.ended_at) - Date.parse(meta.started_at),
      retries: meta.retries ?? 0,
      round_executions: meta.round_executions ?? 1,
    },
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

export function validateAdjudication(entry) {
  const fields = ['blind_id', 'real', 'pr_attributable', 'necessary_before_merge', 'adjudicator', 'reason'];
  for (const field of fields) {
    if (entry[field] === undefined) {
      fail(`adjudication ${entry.blind_id ?? '?'} must state ${field}`);
    }
  }
  if (
    entry.matches_key_item !== undefined &&
    entry.matches_key_item !== null &&
    typeof entry.matches_key_item !== 'string'
  ) {
    fail('matches_key_item must be a key item id or null');
  }
  return entry;
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

export function scoreRuns({ runs, mapping, adjudications, keys, cases }) {
  const byBlind = new Map(adjudications.map((entry) => [validateAdjudication(entry).blind_id, entry]));
  const blindFor = new Map(
    mapping.map((entry) => [
      `${entry.case_id}\x1f${entry.arm}\x1f${entry.run_index}\x1f${entry.finding_id}`,
      entry.blind_id,
    ])
  );
  const status = new Map(cases.map((manifest) => [manifest.case_id, manifest.adjudication_status]));
  const report = { arms: {}, excluded_unadjudicated: [], per_case: [] };
  for (const arm of ARMS) {
    const armRuns = runs.filter((run) => run.arm === arm);
    const scored = armRuns.filter((run) => status.get(run.case_id) === 'adjudicated');
    let blockers = 0;
    let validBlockers = 0;
    let unadjudicatedFindings = 0;
    const recalled = { known_defect: [0, 0], architectural: [0, 0] };
    for (const run of scored) {
      const key = validateAnswerKey(keys[run.case_id]);
      const matched = new Set();
      for (const finding of run.findings) {
        const verdict = byBlind.get(blindFor.get(`${run.case_id}\x1f${arm}\x1f${run.run_index}\x1f${finding.id}`));
        if (!verdict) {
          unadjudicatedFindings += 1;
          continue;
        }
        if (finding.disposition === 'blocking') {
          blockers += 1;
          if (verdict.real && verdict.pr_attributable && verdict.necessary_before_merge) {
            validBlockers += 1;
          }
        }
        if (verdict.matches_key_item) {
          matched.add(verdict.matches_key_item);
        }
      }
      for (const kind of Object.keys(recalled)) {
        const items = key.items.filter((item) => item.kind === kind);
        recalled[kind][0] += items.filter((item) => matched.has(item.id)).length;
        recalled[kind][1] += items.length;
      }
    }
    const incomplete = armRuns.filter((run) => !run.complete).length;
    report.arms[arm] = {
      runs: armRuns.length,
      scored_runs: scored.length,
      blocker_precision: ratio(validBlockers, blockers),
      known_defect_recall: ratio(...recalled.known_defect),
      architectural_recall: ratio(...recalled.architectural),
      incomplete_run_rate: ratio(incomplete, armRuns.length),
      unadjudicated_findings: unadjudicatedFindings,
      median_tokens: median(armRuns.map((run) => run.cost.tokens).filter((value) => Number.isFinite(value))),
      median_wall_ms: median(armRuns.map((run) => run.cost.wall_ms)),
      capability_failures: armRuns.flatMap((run) => run.capability_failures),
    };
  }
  for (const manifest of cases) {
    if (manifest.adjudication_status !== 'adjudicated') {
      report.excluded_unadjudicated.push(manifest.case_id);
      continue;
    }
    report.per_case.push({
      case_id: manifest.case_id,
      verdicts: Object.fromEntries(
        ARMS.map((arm) => [
          arm,
          runs.filter((run) => run.case_id === manifest.case_id && run.arm === arm).map((run) => run.verdict),
        ])
      ),
    });
  }
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
