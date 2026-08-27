import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const DISPOSITIONS = new Set(['blocking', 'suggestion', 'nit']);
const REVIEW_MODES = new Set(['full', 'incremental']);
const EVALUATOR_SOURCES = new Set(['stable', 'head_smoke']);
const EVIDENCE_ORIGINS = new Set(['full_diff', 'incremental_diff', 'prior_blocker', 'unchanged']);
const IMPACTS = new Set(['direct', 'hypothetical_coverage_gap', 'documentation_drift', 'tech_debt']);

function suggestion(reason) {
  return { disposition: 'suggestion', blocking_eligible: false, reason };
}

function requireEnum(value, values, field) {
  if (!values.has(value)) {
    throw new Error(`${field} is invalid`);
  }
}

function validateInput({ finding, context } = {}) {
  if (!finding || !context) {
    throw new Error('finding and context are required');
  }
  requireEnum(finding.severity, SEVERITIES, 'severity');
  requireEnum(finding.recommended_disposition, DISPOSITIONS, 'recommended_disposition');
  requireEnum(context.review_mode, REVIEW_MODES, 'review_mode');
  requireEnum(context.evaluator_source, EVALUATOR_SOURCES, 'evaluator_source');
  requireEnum(context.evidence_origin, EVIDENCE_ORIGINS, 'evidence_origin');
  requireEnum(context.impact, IMPACTS, 'impact');
  for (const field of ['deterministic_reproduction', 'direct_material_impact', 'deferral_safe', 'finite_fix']) {
    if (typeof context[field] !== 'boolean') {
      throw new Error(`${field} is required and must be boolean`);
    }
  }
}

export function decideDisposition({ finding, context }) {
  validateInput({ finding, context });
  if (finding.recommended_disposition !== 'blocking') {
    return {
      disposition: finding.recommended_disposition,
      blocking_eligible: false,
      reason: 'reviewer_non_blocking',
    };
  }
  if (finding.severity === 'low') {
    return suggestion('severity_too_low');
  }
  if (context.impact !== 'direct') {
    return suggestion('non_blocking_impact');
  }
  if (context.evaluator_source === 'head_smoke' && !context.deterministic_reproduction) {
    return suggestion('unproved_self_smoke');
  }
  if (
    context.review_mode === 'incremental' &&
    context.evidence_origin === 'unchanged' &&
    !(finding.severity === 'critical' && context.deterministic_reproduction)
  ) {
    return suggestion('outside_incremental_merge_contract');
  }
  if (!context.direct_material_impact || context.deferral_safe || !context.finite_fix) {
    return suggestion('blocking_criteria_not_met');
  }
  return {
    disposition: 'blocking',
    blocking_eligible: true,
    reason: 'blocking_criteria_met',
  };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    throw new Error('Expected one path to a JSON file holding { finding, context }');
  }
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(decideDisposition(input), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
