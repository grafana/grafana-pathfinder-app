import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyFinding, decideVerification, planFirstWave } from './adversarial-policy.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function verdict(value, reason = 'cites the changed hunk') {
  return { verdict: value, reason };
}

function reviewerFinding(overrides = {}) {
  return {
    concern_id: 'correctness-and-reliability',
    finding_id: 'CORRECTNESS-001',
    severity: 'medium',
    confidence: 'high',
    recommended_disposition: 'suggestion',
    title: 'Keep the verification contract aligned',
    evidence: ['The policy reads a shared reviewer finding.'],
    why_it_matters: 'A schema mismatch changes the verification lane.',
    suggested_action: 'Consume the canonical disposition field.',
    reversibility: 'reversible',
    applies_to_files: ['.cursor/skills/review/scripts/adversarial-policy.mjs'],
    ...overrides,
  };
}

function replay(finding, values) {
  const verdicts = [];
  const decisions = [decideVerification(finding, verdicts)];
  for (const value of values) {
    verdicts.push(verdict(value));
    decisions.push(decideVerification(finding, verdicts));
  }
  return decisions;
}

test('factual verification lanes depend on severity, not recommended disposition', () => {
  assert.equal(classifyFinding(reviewerFinding({ severity: 'critical' })), 'high_risk');
  assert.equal(classifyFinding(reviewerFinding({ severity: 'high' })), 'high_risk');
  assert.equal(classifyFinding(reviewerFinding({ recommended_disposition: 'blocking' })), 'advisory');
  assert.equal(
    classifyFinding(reviewerFinding({ severity: 'low', recommended_disposition: 'blocking' })),
    'unverified'
  );
  assert.equal(classifyFinding(reviewerFinding()), 'advisory');
  assert.equal(classifyFinding(reviewerFinding({ severity: 'low' })), 'unverified');
});

test('the first wave is two skeptics for high risk, one for a medium advisory, none for low', () => {
  assert.deepEqual(planFirstWave(reviewerFinding({ severity: 'high' })), { lane: 'high_risk', skeptics: 2 });
  assert.deepEqual(planFirstWave(reviewerFinding()), { lane: 'advisory', skeptics: 1 });
  assert.deepEqual(planFirstWave(reviewerFinding({ severity: 'low' })), { lane: 'unverified', skeptics: 0 });
});

test('a high-risk finding launches its two first-wave skeptics in parallel', () => {
  assert.deepEqual(decideVerification(reviewerFinding({ severity: 'critical' })), {
    lane: 'high_risk',
    dispatch: { role: 'skeptic', count: 2 },
    status: 'awaiting_verdicts',
    outcome: null,
  });
});

test('agreeing first-wave skeptics resolve a high-risk finding without a third call', () => {
  const dropped = replay(reviewerFinding({ severity: 'high' }), ['refuted', 'refuted']).at(-1);
  assert.deepEqual(dropped, {
    lane: 'high_risk',
    dispatch: { role: null, count: 0 },
    status: 'resolved',
    outcome: 'dropped',
  });
  const kept = replay(reviewerFinding({ severity: 'high' }), ['confirmed', 'confirmed']).at(-1);
  assert.equal(kept.outcome, 'kept');
  assert.equal(kept.dispatch.count, 0);
});

test('a split first wave escalates to exactly one tiebreaker', () => {
  for (const split of [
    ['refuted', 'confirmed'],
    ['confirmed', 'uncertain'],
    ['uncertain', 'uncertain'],
  ]) {
    assert.deepEqual(
      decideVerification(
        reviewerFinding({ severity: 'high' }),
        split.map((value) => verdict(value))
      ),
      {
        lane: 'high_risk',
        dispatch: { role: 'tiebreaker', count: 1 },
        status: 'awaiting_verdicts',
        outcome: null,
      },
      split.join('/')
    );
  }
});

test('a high-risk finding drops only on a two-of-three refutation majority', () => {
  const finding = reviewerFinding({ severity: 'high' });
  assert.equal(replay(finding, ['refuted', 'confirmed', 'refuted']).at(-1).outcome, 'dropped');
  assert.equal(replay(finding, ['refuted', 'confirmed', 'confirmed']).at(-1).outcome, 'kept');
  assert.equal(replay(finding, ['refuted', 'uncertain', 'uncertain']).at(-1).outcome, 'kept');
  assert.equal(replay(finding, ['uncertain', 'uncertain', 'uncertain']).at(-1).outcome, 'kept');
});

test('a recommended blocker does not change a medium finding verification lane', () => {
  const finding = reviewerFinding({ recommended_disposition: 'blocking' });
  assert.equal(decideVerification(finding).dispatch.count, 1);
  assert.equal(replay(finding, ['refuted']).at(-1).dispatch.role, 'adjudicator');
  assert.equal(replay(finding, ['refuted', 'confirmed']).at(-1).outcome, 'kept');
});

test('a confirmed medium advisory is kept without an adjudicator', () => {
  const decision = replay(reviewerFinding(), ['confirmed']).at(-1);
  assert.deepEqual(decision, {
    lane: 'advisory',
    dispatch: { role: null, count: 0 },
    status: 'resolved',
    outcome: 'kept',
  });
});

test('a refuted or uncertain medium advisory escalates to one adjudicator', () => {
  for (const value of ['refuted', 'uncertain']) {
    assert.deepEqual(
      replay(reviewerFinding(), [value]).at(-1),
      {
        lane: 'advisory',
        dispatch: { role: 'adjudicator', count: 1 },
        status: 'awaiting_verdicts',
        outcome: null,
      },
      value
    );
  }
});

test('a medium advisory drops only when the adjudicator also refutes', () => {
  const finding = reviewerFinding();
  assert.equal(replay(finding, ['refuted', 'refuted']).at(-1).outcome, 'dropped');
  assert.equal(replay(finding, ['refuted', 'confirmed']).at(-1).outcome, 'kept');
  assert.equal(replay(finding, ['refuted', 'uncertain']).at(-1).outcome, 'kept');
  assert.equal(replay(finding, ['uncertain', 'refuted']).at(-1).outcome, 'dropped');
});

test('a low non-blocking finding passes through unverified', () => {
  const finding = reviewerFinding({ severity: 'low' });
  assert.deepEqual(decideVerification(finding), {
    lane: 'unverified',
    dispatch: { role: null, count: 0 },
    status: 'resolved',
    outcome: 'kept',
  });
  assert.throws(() => decideVerification(finding, [verdict('refuted')]), /without verification/);
});

test('an incomplete high-risk first wave waits rather than resolving', () => {
  assert.deepEqual(decideVerification(reviewerFinding({ severity: 'high' }), [verdict('refuted')]), {
    lane: 'high_risk',
    dispatch: { role: null, count: 0 },
    status: 'awaiting_verdicts',
    outcome: null,
  });
});

test('verification never exceeds three high-risk or two advisory calls', () => {
  const four = Array.from({ length: 4 }, () => verdict('refuted'));
  assert.throws(() => decideVerification(reviewerFinding({ severity: 'high' }), four), /at most three/);
  assert.throws(() => decideVerification(reviewerFinding(), four.slice(0, 3)), /at most one skeptic/);
});

test('rejects an unknown severity, disposition, or verdict, and an uncited verdict', () => {
  assert.throws(() => decideVerification(reviewerFinding({ severity: 'blocker' })), /Unknown severity/);
  assert.throws(() => decideVerification(reviewerFinding({ recommended_disposition: 'veto' })), /Unknown recommended/);
  assert.throws(() => decideVerification(reviewerFinding(), [verdict('maybe')]), /Unknown verdict/);
  assert.throws(() => decideVerification(reviewerFinding(), [verdict('refuted', '')]), /non-empty reason/);
  assert.throws(() => decideVerification(reviewerFinding(), [verdict('refuted', '   ')]), /non-empty reason/);
});

test('rejects a finding without a recommended disposition before selecting a lane', () => {
  for (const severity of ['medium', 'low']) {
    const finding = reviewerFinding({ severity });
    delete finding.recommended_disposition;

    assert.throws(() => classifyFinding(finding), /recommended_disposition is required/);
  }
});

test('the CLI emits the decision for a serialized finding and verdict trail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adversarial-policy-'));
  tempDirs.push(dir);
  const inputPath = join(dir, 'input.json');
  writeFileSync(inputPath, JSON.stringify({ finding: reviewerFinding(), verdicts: [verdict('refuted')] }));
  const output = execFileSync('node', [join(scriptDir, 'adversarial-policy.mjs'), inputPath], {
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), {
    lane: 'advisory',
    dispatch: { role: 'adjudicator', count: 1 },
    status: 'awaiting_verdicts',
    outcome: null,
  });
});
