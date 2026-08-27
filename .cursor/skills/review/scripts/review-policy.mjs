#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { classifyFinding, decideVerification } from './adversarial-policy.mjs';
import { decideBlocking } from './blocking-gate.mjs';

const ONE_WAY_DOORS = new Set(['partially_reversible', 'irreversible_without_cleanup']);

function normalizeRecommendation(finding) {
  if (!ONE_WAY_DOORS.has(finding.reversibility) || finding.recommended_disposition === 'blocking') {
    return finding;
  }
  return { ...finding, recommended_disposition: 'blocking' };
}

function finalDecision(finding, disposition, reason) {
  return {
    status: 'final',
    finding,
    decision: { disposition, reason, override: null, override_source: null, gate_failures: [] },
  };
}

export function advanceReviewPolicy({ finding, verdicts = [], gate_answers }) {
  classifyFinding(finding);
  const normalized = normalizeRecommendation(finding);
  const verification = decideVerification(normalized, verdicts);
  if (verification.status === 'awaiting_verdicts') {
    return {
      status: 'needs_verification',
      finding: normalized,
      lane: verification.lane,
      dispatch: verification.dispatch,
    };
  }
  if (verification.outcome === 'dropped') {
    return { status: 'dropped', finding: normalized, reason: 'verification-refuted' };
  }
  if (verification.outcome === 'demoted') {
    return finalDecision(normalized, 'follow_up', 'verification-demoted');
  }
  if (verification.outcome === 'kept' && normalized.recommended_disposition === 'blocking') {
    if (!gate_answers) {
      return { status: 'needs_gate_answers', finding: normalized };
    }
    return {
      status: 'final',
      finding: normalized,
      decision: decideBlocking({ finding: normalized, answers: gate_answers }),
    };
  }
  if (verification.outcome === 'kept') {
    return finalDecision(normalized, normalized.recommended_disposition, 'verified');
  }
  throw new Error(`Unknown verification outcome: ${verification.outcome}`);
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error('Expected one path to a JSON file holding { finding, verdicts, gate_answers? }');
  }
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(`${JSON.stringify(advanceReviewPolicy(input), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
