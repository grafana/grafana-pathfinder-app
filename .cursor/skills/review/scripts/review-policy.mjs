#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decideVerification, deriveVerificationLane } from './adversarial-policy.mjs';

const KINDS = new Set(['defect', 'suggestion', 'nit']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);
const REVERSIBILITIES = new Set(['reversible', 'partially_reversible', 'irreversible_without_cleanup', 'unknown']);
const ORIGINS = new Set(['regression', 'pre_existing', 'latent_reachable', 'latent_unreachable']);
const IMPACTS = new Set(['none', 'ordinary', 'security', 'data_loss', 'credential_exposure']);
const TIMINGS = new Set(['first_round', 'prior_unresolved', 'since_prior_head', 'late']);
const SCOPE_EFFECTS = new Set(['within_changed_surface', 'widens_changed_surface']);
const ONE_WAY_DOORS = new Set(['partially_reversible', 'irreversible_without_cleanup']);
const PROTECTED_IMPACTS = new Set(['security', 'data_loss', 'credential_exposure']);
const PR_CAUSED = new Set(['regression', 'latent_reachable']);
const MAX_ROUND = 100;
const MAX_BATCH = 4;
const MAX_CLEARED = 12;
const OBSERVATION_FIELDS = new Set([
  'finding_id',
  'concern_id',
  'kind',
  'severity',
  'confidence',
  'title',
  'evidence',
  'why_it_matters',
  'suggested_action',
  'reversibility',
  'applies_to_files',
  'origin',
  'impact',
  'timing',
  'scope_effect',
  'breaks_shipped_path',
  'induced',
  'clearance_contradiction',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRound(round = 1) {
  if (!Number.isInteger(round) || round < 1) {
    throw new Error('round must be a positive integer');
  }
  return Math.min(round, MAX_ROUND);
}

function validateStringArray(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every(nonEmpty)) {
    throw new Error(`${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array of non-empty strings`);
  }
}

function validateClearanceContradiction(contradiction) {
  if (contradiction === undefined) {
    return;
  }
  if (
    !contradiction ||
    typeof contradiction !== 'object' ||
    Object.keys(contradiction).sort().join(',') !== 'claim,new_evidence,prior_reason' ||
    !nonEmpty(contradiction.claim) ||
    !nonEmpty(contradiction.prior_reason) ||
    !nonEmpty(contradiction.new_evidence)
  ) {
    throw new Error('clearance_contradiction must include claim, prior_reason, and checked new_evidence');
  }
}

export function validateObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error('observation must be an object');
  }
  const unknown = Object.keys(observation).filter((field) => !OBSERVATION_FIELDS.has(field));
  if (unknown.length > 0) {
    throw new Error(`Unknown observation field: ${unknown[0]}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(observation.finding_id ?? '')) {
    throw new Error('finding_id must be a stable identifier');
  }
  if (!/^[a-z0-9-]+$/.test(observation.concern_id ?? '')) {
    throw new Error('concern_id must be a concern identifier');
  }
  for (const [field, values] of [
    ['kind', KINDS],
    ['severity', SEVERITIES],
    ['confidence', CONFIDENCES],
    ['reversibility', REVERSIBILITIES],
    ['origin', ORIGINS],
    ['impact', IMPACTS],
    ['timing', TIMINGS],
    ['scope_effect', SCOPE_EFFECTS],
  ]) {
    if (!values.has(observation[field])) {
      throw new Error(`Unknown ${field}: ${observation[field]}`);
    }
  }
  for (const field of ['title', 'why_it_matters', 'suggested_action']) {
    if (!nonEmpty(observation[field])) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
  validateStringArray(observation.evidence, 'evidence', { allowEmpty: false });
  validateStringArray(observation.applies_to_files, 'applies_to_files');
  for (const field of ['breaks_shipped_path', 'induced']) {
    if (typeof observation[field] !== 'boolean') {
      throw new Error(`${field} must be true or false`);
    }
  }
  validateClearanceContradiction(observation.clearance_contradiction);
  return observation;
}

function protectedHarm(observation) {
  return (
    PR_CAUSED.has(observation.origin) && (PROTECTED_IMPACTS.has(observation.impact) || observation.breaks_shipped_path)
  );
}

function prCausedOneWayDoor(observation) {
  return PR_CAUSED.has(observation.origin) && ONE_WAY_DOORS.has(observation.reversibility);
}

export function disposeObservation(observation, round = 1) {
  validateObservation(observation);
  const resolvedRound = normalizeRound(round);
  if (observation.kind !== 'defect') {
    if (resolvedRound >= 3 && observation.timing !== 'prior_unresolved') {
      return { status: 'dropped', reason: 'round-three-optional' };
    }
    if (observation.timing === 'prior_unresolved') {
      return { status: 'final', disposition: 'follow_up', reason: 'carried-optional' };
    }
    if (observation.scope_effect === 'widens_changed_surface') {
      return { status: 'final', disposition: 'follow_up', reason: 'scope-widening-optional' };
    }
    return { status: 'final', disposition: observation.kind, reason: 'within-surface-optional' };
  }
  if (protectedHarm(observation)) {
    return { status: 'final', disposition: 'blocking', reason: 'protected-harm' };
  }
  if (observation.origin === 'pre_existing') {
    return { status: 'final', disposition: 'follow_up', reason: 'pre-existing' };
  }
  if (observation.origin === 'latent_unreachable') {
    return { status: 'final', disposition: 'follow_up', reason: 'latent-unreachable' };
  }
  if (observation.induced) {
    return { status: 'final', disposition: 'follow_up', reason: 'induced-scope' };
  }
  if (observation.timing === 'late') {
    return { status: 'final', disposition: 'follow_up', reason: 'late' };
  }
  if (prCausedOneWayDoor(observation)) {
    return { status: 'final', disposition: 'blocking', reason: 'one-way-door' };
  }
  if (observation.impact === 'none') {
    return { status: 'final', disposition: 'follow_up', reason: 'no-current-harm' };
  }
  return { status: 'final', disposition: 'blocking', reason: 'confirmed-regression' };
}

function validateClearedEntry(entry) {
  if (
    !entry ||
    typeof entry !== 'object' ||
    !/^[a-z0-9-]+$/.test(entry.concern_id ?? '') ||
    !nonEmpty(entry.claim) ||
    !nonEmpty(entry.reason)
  ) {
    throw new Error('each cleared entry must include concern_id, claim, and reason');
  }
  return { concern_id: entry.concern_id, claim: entry.claim.trim(), reason: entry.reason.trim() };
}

function validateContradictionAgainstState(observation, priorCleared) {
  if (!Array.isArray(priorCleared)) {
    throw new Error('prior_cleared must be an array');
  }
  const cleared = priorCleared.map(validateClearedEntry);
  const contradiction = observation.clearance_contradiction;
  if (!contradiction) {
    return;
  }
  const matches = cleared.some(
    (entry) =>
      entry.concern_id === observation.concern_id &&
      entry.claim === contradiction.claim.trim() &&
      entry.reason === contradiction.prior_reason.trim()
  );
  if (!matches) {
    throw new Error('clearance_contradiction must quote an exact prior cleared claim and reason');
  }
}

function provisionalBlocking(observation, round) {
  return observation.kind === 'defect' && disposeObservation(observation, round).disposition === 'blocking';
}

export function advanceReviewPolicy({ observation, verdicts = [], round = 1, prior_cleared = [] }) {
  validateObservation(observation);
  const resolvedRound = normalizeRound(round);
  if (observation.kind !== 'defect') {
    const optional = disposeObservation(observation, resolvedRound);
    if (optional.status === 'dropped') {
      return { status: 'dropped', observation, reason: optional.reason };
    }
    return { status: 'final', observation, decision: optional };
  }
  const verification = decideVerification(observation, verdicts, provisionalBlocking(observation, resolvedRound));
  if (verification.status === 'needs_verification') {
    return {
      status: 'needs_verification',
      observation,
      lane: verification.lane,
      dispatch: verification.dispatch,
    };
  }
  if (verification.status === 'dropped') {
    return { status: 'dropped', observation, reason: 'verification-refuted' };
  }
  validateContradictionAgainstState(observation, prior_cleared);
  return { status: 'final', observation, decision: disposeObservation(observation, resolvedRound) };
}

function evidenceSurface(observation) {
  return [...observation.applies_to_files].sort().join('\x00') || '<no-files>';
}

export function planVerificationBatches(requests) {
  if (!Array.isArray(requests)) {
    throw new Error('requests must be an array');
  }
  const groups = new Map();
  for (const request of requests) {
    const observation = request.observation ?? request;
    const verdicts = request.observation ? (request.verdicts ?? []) : [];
    validateObservation(observation);
    const round = normalizeRound(request.round ?? 1);
    const verification = decideVerification(observation, verdicts, provisionalBlocking(observation, round));
    if (verification.status !== 'needs_verification' || verification.dispatch.count === 0) {
      continue;
    }
    for (let independentRole = 1; independentRole <= verification.dispatch.count; independentRole += 1) {
      const key = [
        verification.dispatch.role,
        independentRole,
        observation.concern_id,
        evidenceSurface(observation),
      ].join('\x01');
      const group = groups.get(key) ?? {
        role: verification.dispatch.role,
        independent_role: independentRole,
        concern_id: observation.concern_id,
        evidence_surface: [...observation.applies_to_files].sort(),
        finding_ids: [],
      };
      group.finding_ids.push(observation.finding_id);
      groups.set(key, group);
    }
  }
  return [...groups.values()].flatMap((group) => {
    const batches = [];
    for (let index = 0; index < group.finding_ids.length; index += MAX_BATCH) {
      batches.push({ ...group, finding_ids: group.finding_ids.slice(index, index + MAX_BATCH) });
    }
    return batches;
  });
}

function validateFindingRef(entry) {
  if (
    !entry ||
    typeof entry !== 'object' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(entry.id ?? '') ||
    !/^[a-z0-9-]+$/.test(entry.concern_id ?? '')
  ) {
    throw new Error('each deferred entry must include a stable id and concern_id');
  }
  return { id: entry.id, concern_id: entry.concern_id };
}

function dedupe(entries, key) {
  const seen = new Set();
  return entries.filter((entry) => {
    const value = key(entry);
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

export function reconcileReviewState({
  prior_deferred = [],
  current_follow_ups = [],
  verified_fixed_ids = [],
  prior_cleared = [],
  current_cleared = [],
}) {
  if (!Array.isArray(prior_deferred) || !Array.isArray(current_follow_ups) || !Array.isArray(verified_fixed_ids)) {
    throw new Error('deferred state and verified_fixed_ids must be arrays');
  }
  const priorDeferred = prior_deferred.map(validateFindingRef);
  const currentFollowUps = current_follow_ups.map(validateFindingRef);
  if (!verified_fixed_ids.every(nonEmpty)) {
    throw new Error('verified_fixed_ids must contain stable ids');
  }
  const priorIds = new Set(priorDeferred.map(({ id }) => id));
  for (const id of verified_fixed_ids) {
    if (!priorIds.has(id)) {
      throw new Error(`verified fixed id ${id} is not present in prior_deferred`);
    }
  }
  const fixed = new Set(verified_fixed_ids);
  const unresolvedPrior = priorDeferred.filter(({ id }) => !fixed.has(id));
  const nextDeferred = dedupe([...currentFollowUps, ...unresolvedPrior], ({ id }) => id);
  const nextCleared = dedupe(
    [...current_cleared.map(validateClearedEntry), ...prior_cleared.map(validateClearedEntry)],
    ({ claim }) => claim
  ).slice(0, MAX_CLEARED);
  return { next_deferred: nextDeferred, next_cleared: nextCleared };
}

export { deriveVerificationLane };

function main() {
  if (process.argv.length !== 3) {
    throw new Error('Expected one path to a review policy JSON input');
  }
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  let output;
  if (input.operation === 'plan_verification_batches') {
    output = { batches: planVerificationBatches(input.requests) };
  } else if (input.operation === 'reconcile') {
    output = reconcileReviewState(input);
  } else {
    output = advanceReviewPolicy(input);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
