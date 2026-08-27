import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { advanceReviewPolicy } from './review-policy.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

const oneWayDoorFollowUp = {
  concern_id: 'reversibility-and-one-way-door',
  finding_id: 'RWD-1',
  severity: 'medium',
  recommended_disposition: 'follow_up',
  reversibility: 'partially_reversible',
};

test('one-way-door follow-ups enter blocker-level verification', () => {
  assert.deepEqual(advanceReviewPolicy({ finding: oneWayDoorFollowUp, verdicts: [] }), {
    status: 'needs_verification',
    finding: { ...oneWayDoorFollowUp, recommended_disposition: 'blocking' },
    lane: 'high_risk',
    dispatch: { role: 'skeptic', count: 2 },
  });
});

test('the blocking gate makes the final disposition after verification', () => {
  const verdicts = [
    { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'The state change survives rollback.' },
    { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'Cleanup is required after revert.' },
  ];
  const gateAnswers = {
    round: 1,
    authorship: 'pre_existing',
    breaks_live_path: false,
    concrete_risk_now: false,
    boundable_by_followup: true,
    induced_by_prior_suggestion: false,
    precedent_count: 0,
  };

  assert.deepEqual(advanceReviewPolicy({ finding: oneWayDoorFollowUp, verdicts, gate_answers: gateAnswers }), {
    status: 'final',
    finding: { ...oneWayDoorFollowUp, recommended_disposition: 'blocking' },
    decision: {
      disposition: 'follow_up',
      reason: 'pre-existing',
      override: null,
      override_source: null,
      gate_failures: ['pre-existing'],
    },
  });
});

test('verification demotion finalizes as a follow-up without gate answers', () => {
  const finding = {
    ...oneWayDoorFollowUp,
    finding_id: 'RWD-2',
    recommended_disposition: 'blocking',
    reversibility: 'reversible',
  };
  const verdicts = [
    { verdict: 'confirmed', blocking_warranted: 'no', reason: 'The issue does not affect this merge.' },
    { verdict: 'confirmed', blocking_warranted: 'no', reason: 'The work can be tracked independently.' },
  ];

  assert.deepEqual(advanceReviewPolicy({ finding, verdicts }), {
    status: 'final',
    finding,
    decision: {
      disposition: 'follow_up',
      reason: 'verification-demoted',
      override: null,
      override_source: null,
      gate_failures: [],
    },
  });
});

test('a verified blocker requests gate answers before final disposition', () => {
  const finding = { ...oneWayDoorFollowUp, recommended_disposition: 'blocking', reversibility: 'reversible' };
  const verdicts = [
    { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'The changed path fails.' },
    { verdict: 'confirmed', blocking_warranted: 'yes', reason: 'The failure is attributable to this PR.' },
  ];

  assert.deepEqual(advanceReviewPolicy({ finding, verdicts }), {
    status: 'needs_gate_answers',
    finding,
  });
});

test('a verified non-blocking finding keeps its recommended disposition', () => {
  const finding = {
    ...oneWayDoorFollowUp,
    finding_id: 'TEST-1',
    recommended_disposition: 'suggestion',
    reversibility: 'reversible',
  };
  const verdicts = [{ verdict: 'confirmed', reason: 'The changed test misses the new branch.' }];

  assert.deepEqual(advanceReviewPolicy({ finding, verdicts }), {
    status: 'final',
    finding,
    decision: {
      disposition: 'suggestion',
      reason: 'verified',
      override: null,
      override_source: null,
      gate_failures: [],
    },
  });
});

test('a refuted finding leaves the policy pipeline', () => {
  const finding = { ...oneWayDoorFollowUp, recommended_disposition: 'blocking', reversibility: 'reversible' };
  const verdicts = [
    { verdict: 'refuted', blocking_warranted: 'no', reason: 'The base commit has the same behavior.' },
    { verdict: 'refuted', blocking_warranted: 'no', reason: 'The changed path is not reachable.' },
  ];

  assert.deepEqual(advanceReviewPolicy({ finding, verdicts }), {
    status: 'dropped',
    finding,
    reason: 'verification-refuted',
  });
});

test('the CLI emits the next policy action', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-policy-'));
  tempDirs.push(dir);
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify({ finding: oneWayDoorFollowUp, verdicts: [] }));

  const output = execFileSync('node', [join(scriptDir, 'review-policy.mjs'), inputPath], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), {
    status: 'needs_verification',
    finding: { ...oneWayDoorFollowUp, recommended_disposition: 'blocking' },
    lane: 'high_risk',
    dispatch: { role: 'skeptic', count: 2 },
  });
});

test('one-way-door promotion does not hide an invalid recommendation', () => {
  assert.throws(
    () => advanceReviewPolicy({ finding: { ...oneWayDoorFollowUp, recommended_disposition: 'unknown' } }),
    /Unknown recommended disposition/
  );
});
