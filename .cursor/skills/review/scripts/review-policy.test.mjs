import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  advanceReviewPolicy,
  deriveVerificationLane,
  disposeObservation,
  planVerificationBatches,
  reconcileReviewState,
  validateObservation,
} from './review-policy.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function observation(overrides = {}) {
  return {
    finding_id: 'OBS-1',
    concern_id: 'correctness-and-reliability',
    kind: 'defect',
    severity: 'medium',
    confidence: 'high',
    title: 'Changed behavior drops a required result',
    evidence: ['src/example.ts:12 returns before recording the result.'],
    why_it_matters: 'The shipped path reports success without saving the result.',
    suggested_action: 'Record the result before returning.',
    reversibility: 'reversible',
    applies_to_files: ['src/example.ts'],
    origin: 'regression',
    impact: 'ordinary',
    timing: 'first_round',
    scope_effect: 'within_changed_surface',
    breaks_shipped_path: false,
    induced: false,
    ...overrides,
  };
}

const confirmed = { verdict: 'confirmed', reason: 'The changed branch demonstrably drops the result.' };
const refuted = { verdict: 'refuted', reason: 'The base and head both record the result before returning.' };
const uncertain = { verdict: 'uncertain', reason: 'The reachable caller could not be established from the packet.' };

test('canonical observation validation rejects producer-owned policy fields', () => {
  for (const field of ['recommended_disposition', 'blocking_warranted', 'override', 'disposition', 'gate_answers']) {
    assert.throws(() => validateObservation(observation({ [field]: 'blocking' })), /Unknown observation field/);
  }
  assert.throws(
    () => advanceReviewPolicy({ observation: observation(), verdicts: [{ ...confirmed, blocking_warranted: 'yes' }] }),
    /only verdict and reason/
  );
});

test('truth adjudication preserves the bounded high-risk and medium lanes', () => {
  const high = observation({ severity: 'high' });
  assert.equal(deriveVerificationLane(high, false), 'high_risk');
  assert.deepEqual(advanceReviewPolicy({ observation: high }).dispatch, { role: 'skeptic', count: 2 });
  assert.equal(advanceReviewPolicy({ observation: high, verdicts: [confirmed] }).dispatch.count, 0);
  assert.equal(
    advanceReviewPolicy({ observation: high, verdicts: [confirmed, uncertain] }).dispatch.role,
    'tiebreaker'
  );
  assert.equal(advanceReviewPolicy({ observation: high, verdicts: [refuted, refuted] }).status, 'dropped');
  assert.equal(advanceReviewPolicy({ observation: high, verdicts: [refuted, confirmed, refuted] }).status, 'dropped');
  assert.equal(advanceReviewPolicy({ observation: high, verdicts: [refuted, confirmed, uncertain] }).status, 'final');

  const mediumNonBlocking = observation({ origin: 'pre_existing' });
  assert.equal(deriveVerificationLane(mediumNonBlocking, false), 'advisory');
  assert.deepEqual(advanceReviewPolicy({ observation: mediumNonBlocking }).dispatch, { role: 'skeptic', count: 1 });
  assert.equal(
    advanceReviewPolicy({ observation: mediumNonBlocking, verdicts: [uncertain] }).dispatch.role,
    'adjudicator'
  );
  assert.equal(
    advanceReviewPolicy({ observation: mediumNonBlocking, verdicts: [uncertain, refuted] }).status,
    'dropped'
  );
  assert.equal(advanceReviewPolicy({ observation: mediumNonBlocking, verdicts: [refuted, uncertain] }).status, 'final');

  const low = observation({ severity: 'low', origin: 'pre_existing' });
  assert.equal(advanceReviewPolicy({ observation: low }).status, 'final');
  assert.throws(() => advanceReviewPolicy({ observation: low, verdicts: [confirmed] }), /passes without skeptic/);
});

test('provisionally blocking medium defects receive high-risk verification', () => {
  assert.equal(advanceReviewPolicy({ observation: observation() }).lane, 'high_risk');
  assert.equal(advanceReviewPolicy({ observation: observation({ origin: 'pre_existing' }) }).lane, 'advisory');
});

const dispositionCases = [
  {
    name: 'pre-existing security',
    input: { origin: 'pre_existing', impact: 'security', severity: 'low' },
    disposition: 'follow_up',
    reason: 'pre-existing',
  },
  {
    name: 'unreachable data loss',
    input: { origin: 'latent_unreachable', impact: 'data_loss', severity: 'low' },
    disposition: 'follow_up',
    reason: 'latent-unreachable',
  },
  {
    name: 'late credential exposure',
    input: { impact: 'credential_exposure', timing: 'late' },
    disposition: 'blocking',
    reason: 'protected-harm',
  },
  {
    name: 'induced protected harm',
    input: { impact: 'security', induced: true },
    disposition: 'blocking',
    reason: 'protected-harm',
  },
  {
    name: 'PR-caused shipped-path breakage',
    input: { impact: 'none', breaks_shipped_path: true },
    disposition: 'blocking',
    reason: 'protected-harm',
  },
  {
    name: 'pre-existing shipped-path failure',
    input: { origin: 'pre_existing', breaks_shipped_path: true },
    disposition: 'follow_up',
    reason: 'pre-existing',
  },
  {
    name: 'ordinary one-way door with current harm',
    input: { reversibility: 'partially_reversible' },
    disposition: 'blocking',
    reason: 'one-way-door',
  },
  {
    name: 'ordinary one-way door without current harm',
    input: { reversibility: 'irreversible_without_cleanup', impact: 'none' },
    disposition: 'blocking',
    reason: 'one-way-door',
  },
  {
    name: 'late ordinary regression',
    input: { timing: 'late' },
    disposition: 'follow_up',
    reason: 'late',
  },
  {
    name: 'induced ordinary regression',
    input: { induced: true },
    disposition: 'follow_up',
    reason: 'induced-scope',
  },
  {
    name: 'reversible condition with no harm',
    input: { impact: 'none' },
    disposition: 'follow_up',
    reason: 'no-current-harm',
  },
  {
    name: 'newly reachable ordinary regression',
    input: { origin: 'latent_reachable' },
    disposition: 'blocking',
    reason: 'confirmed-regression',
  },
];

test('the closed disposition intersection table preserves protected-harm and authorship precedence', () => {
  for (const fixture of dispositionCases) {
    const decision = disposeObservation(observation(fixture.input));
    assert.equal(decision.disposition, fixture.disposition, fixture.name);
    assert.equal(decision.reason, fixture.reason, fixture.name);
  }
  for (const origin of ['regression', 'latent_reachable']) {
    for (const timing of ['first_round', 'prior_unresolved', 'since_prior_head', 'late']) {
      for (const impact of ['security', 'data_loss', 'credential_exposure']) {
        assert.equal(
          disposeObservation(observation({ origin, timing, impact })).disposition,
          'blocking',
          `${origin} ${timing} ${impact}`
        );
      }
      assert.equal(
        disposeObservation(observation({ origin, timing, impact: 'none', breaks_shipped_path: true })).disposition,
        'blocking',
        `${origin} ${timing} shipped path`
      );
    }
  }
});

test('optional work cannot widen later rounds', () => {
  const suggestion = observation({ kind: 'suggestion', impact: 'none', severity: 'low' });
  assert.deepEqual(disposeObservation(suggestion, 1), {
    status: 'final',
    disposition: 'suggestion',
    reason: 'within-surface-optional',
  });
  assert.equal(
    disposeObservation({ ...suggestion, scope_effect: 'widens_changed_surface' }, 1).disposition,
    'follow_up'
  );
  assert.deepEqual(disposeObservation(suggestion, 3), { status: 'dropped', reason: 'round-three-optional' });
  assert.equal(disposeObservation({ ...suggestion, timing: 'prior_unresolved' }, 3).disposition, 'follow_up');
});

test('clearance contradictions must quote checked prior state exactly', () => {
  const prior = {
    concern_id: 'correctness-and-reliability',
    claim: 'Divider conversion is total.',
    reason: 'All variants are classified.',
  };
  const candidate = observation({
    severity: 'low',
    origin: 'pre_existing',
    clearance_contradiction: {
      claim: prior.claim,
      prior_reason: prior.reason,
      new_evidence: 'The new separator variant reaches the default branch.',
    },
  });
  assert.equal(advanceReviewPolicy({ observation: candidate, prior_cleared: [prior] }).status, 'final');
  assert.throws(
    () => advanceReviewPolicy({ observation: candidate, prior_cleared: [{ ...prior, reason: 'Different reason.' }] }),
    /exact prior cleared claim and reason/
  );
  assert.throws(
    () =>
      validateObservation({
        ...candidate,
        clearance_contradiction: { ...candidate.clearance_contradiction, new_evidence: '' },
      }),
    /checked new_evidence/
  );
});

test('related verification work batches by concern and evidence surface without merging independent skeptics', () => {
  const requests = Array.from({ length: 5 }, (_, index) =>
    observation({ finding_id: `OBS-${index + 1}`, severity: 'high' })
  );
  const batches = planVerificationBatches(requests);
  assert.equal(batches.length, 4);
  assert.deepEqual(
    batches.map(({ independent_role }) => independent_role),
    [1, 1, 2, 2]
  );
  assert.ok(batches.every(({ finding_ids }) => finding_ids.length <= 4));
  assert.deepEqual(
    batches.map(({ finding_ids }) => finding_ids.length),
    [4, 1, 4, 1]
  );
});

test('reconciliation carries unresolved deferred work, removes only verified fixes, and accumulates clearances', () => {
  const first = reconcileReviewState({
    current_follow_ups: [{ id: 'DOC-1', concern_id: 'documentation-alignment' }],
    current_cleared: [
      {
        claim: 'Divider classification is total.',
        concern_id: 'testing-and-verification',
        reason: 'The exhaustive fixture passes.',
      },
    ],
  });
  const second = reconcileReviewState({
    prior_deferred: first.next_deferred,
    current_follow_ups: [{ id: 'CONTRACT-1', concern_id: 'ai-subsystem' }],
    prior_cleared: first.next_cleared,
  });
  assert.deepEqual(
    second.next_deferred.map(({ id }) => id),
    ['CONTRACT-1', 'DOC-1']
  );
  const third = reconcileReviewState({
    prior_deferred: second.next_deferred,
    verified_fixed_ids: ['CONTRACT-1'],
    prior_cleared: second.next_cleared,
    current_cleared: [
      { claim: 'The review terminates.', concern_id: 'ai-subsystem', reason: 'Round three adds no optional work.' },
    ],
  });
  assert.deepEqual(
    third.next_deferred.map(({ id }) => id),
    ['DOC-1']
  );
  assert.equal(third.next_cleared.length, 2);
  const pruned = reconcileReviewState({
    current_cleared: Array.from({ length: 14 }, (_, index) => ({
      claim: `Claim ${index}`,
      concern_id: 'ai-subsystem',
      reason: `Checked reason ${index}`,
    })),
  });
  assert.equal(pruned.next_cleared.length, 12);
  assert.equal(pruned.next_cleared.at(-1).claim, 'Claim 11');
  assert.throws(
    () => reconcileReviewState({ prior_deferred: second.next_deferred, verified_fixed_ids: ['UNKNOWN'] }),
    /not present in prior_deferred/
  );
});

test('the facade CLI exposes advance, batching, and reconciliation without another policy command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-policy-'));
  const inputPath = join(dir, 'input.json');
  writeFileSync(
    inputPath,
    JSON.stringify({ observation: observation({ kind: 'nit', impact: 'none', severity: 'low' }) })
  );
  const output = JSON.parse(
    execFileSync('node', [join(scriptDir, 'review-policy.mjs'), inputPath], { encoding: 'utf8' })
  );
  assert.equal(output.status, 'final');
  assert.equal(output.decision.disposition, 'nit');
});
