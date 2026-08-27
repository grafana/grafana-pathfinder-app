#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const OVERRIDES = new Set(['security', 'data_loss', 'credential_exposure', 'shipped_path_breakage']);
const AUTHORSHIP = new Set(['regression', 'pre_existing', 'latent_exposed']);
const ATTRIBUTIONS = new Set(['prior_unresolved', 'since_prior_head', 'late']);
const REQUIRED_BOOLEANS = [
  'breaks_live_path',
  'concrete_risk_now',
  'boundable_by_followup',
  'induced_by_prior_suggestion',
];
const MAX_ROUND = 100;

const DEMOTIONS = [
  { reason: 'late-peripheral', holds: (answers) => answers.attribution === 'late' },
  { reason: 'policy-change', holds: (answers) => answers.precedent_count >= 2 },
  { reason: 'induced-scope', holds: (answers) => answers.induced_by_prior_suggestion },
  { reason: 'pre-existing', holds: (answers) => answers.authorship === 'pre_existing' },
  {
    reason: 'latent-unreachable',
    holds: (answers) => answers.authorship === 'latent_exposed' && answers.latent_reachable === false,
  },
  { reason: 'no-live-impact', holds: (answers) => !answers.breaks_live_path && !answers.concrete_risk_now },
  { reason: 'safely-bounded', holds: (answers) => answers.boundable_by_followup },
];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function derivedOverride(answers) {
  const thisPrBreaksIt =
    answers.authorship === 'regression' || (answers.authorship === 'latent_exposed' && answers.latent_reachable);
  return answers.breaks_live_path && thisPrBreaksIt ? 'shipped_path_breakage' : null;
}

function validateFinding(finding) {
  if (!finding || typeof finding !== 'object') {
    throw new Error('finding must be an object');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(finding.finding_id ?? '')) {
    throw new Error('finding_id must be a stable identifier');
  }
  if (!/^[a-z0-9-]+$/.test(finding.concern_id ?? '')) {
    throw new Error('concern_id must be a concern identifier');
  }
  if (!SEVERITIES.has(finding.severity)) {
    throw new Error(`Unknown severity: ${finding.severity}`);
  }
  if (finding.recommended_disposition !== 'blocking') {
    throw new Error('The blocking gate runs only on a finding recommended as blocking');
  }
}

function validateAnswers(answers) {
  if (!answers || typeof answers !== 'object') {
    throw new Error('answers must be an object');
  }
  if (!Number.isInteger(answers.round) || answers.round < 1 || answers.round > MAX_ROUND) {
    throw new Error(`round must be an integer between 1 and ${MAX_ROUND}`);
  }
  const suppliedOverride = answers.override ?? null;
  if (suppliedOverride !== null && !OVERRIDES.has(suppliedOverride)) {
    throw new Error(`Unknown override: ${suppliedOverride}`);
  }
  if (!AUTHORSHIP.has(answers.authorship)) {
    throw new Error(`Unknown authorship: ${answers.authorship}`);
  }
  if (answers.authorship === 'latent_exposed' && typeof answers.latent_reachable !== 'boolean') {
    throw new Error('latent_reachable is required when authorship is latent_exposed');
  }
  for (const field of REQUIRED_BOOLEANS) {
    if (typeof answers[field] !== 'boolean') {
      throw new Error(`${field} must be true or false`);
    }
  }
  if (answers.prior_contract_satisfied != null && typeof answers.prior_contract_satisfied !== 'boolean') {
    throw new Error('prior_contract_satisfied must be true or false');
  }
  if (!Number.isInteger(answers.precedent_count) || answers.precedent_count < 0) {
    throw new Error('precedent_count must be a non-negative integer');
  }
  const attribution = answers.attribution ?? null;
  if (attribution !== null && !ATTRIBUTIONS.has(attribution)) {
    throw new Error(`Unknown attribution: ${attribution}`);
  }
  if (answers.round >= 2 && attribution === null) {
    throw new Error('attribution is required from round 2 onward');
  }
  if (attribution === 'late' && !nonEmpty(answers.late_blocker_reason)) {
    throw new Error('a late blocker must record a late_blocker_reason');
  }
  const contradicts = answers.contradicts_cleared;
  if (contradicts != null) {
    if (typeof contradicts !== 'object' || !nonEmpty(contradicts.claim) || !nonEmpty(contradicts.reason)) {
      throw new Error('contradicts_cleared must quote the cleared claim and the reason it was cleared');
    }
    if (!nonEmpty(contradicts.new_evidence)) {
      throw new Error('contradicting a cleared claim requires non-empty new_evidence');
    }
  }
  const override = suppliedOverride ?? derivedOverride(answers);
  const overrideSource = override === null ? null : suppliedOverride === null ? 'derived' : 'supplied';
  return { ...answers, override, override_source: overrideSource, attribution };
}

export function decideBlocking(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Expected an object holding { finding, answers }');
  }
  validateFinding(input.finding);
  const answers = validateAnswers(input.answers);
  const gateFailures = DEMOTIONS.filter((rule) => rule.holds(answers)).map((rule) => rule.reason);
  const override = { override: answers.override, override_source: answers.override_source };
  if (answers.override !== null) {
    return { disposition: 'blocking', reason: 'unconditional-override', ...override, gate_failures: gateFailures };
  }
  if (gateFailures.length > 0) {
    return { disposition: 'follow_up', reason: gateFailures[0], ...override, gate_failures: gateFailures };
  }
  return { disposition: 'blocking', reason: 'warranted', ...override, gate_failures: [] };
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error('Expected one path to a JSON file holding { finding, answers }');
  }
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(`${JSON.stringify(decideBlocking(input), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
