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

function replay(finding, values) {
  const verdicts = [];
  const decisions = [decideVerification(finding, verdicts)];
  for (const value of values) {
    verdicts.push(verdict(value));
    decisions.push(decideVerification(finding, verdicts));
  }
  return decisions;
}

test('critical, high, and any proposed blocker share the high-risk lane', () => {
  assert.equal(classifyFinding({ severity: 'critical' }), 'high_risk');
  assert.equal(classifyFinding({ severity: 'high' }), 'high_risk');
  assert.equal(classifyFinding({ severity: 'medium', proposed_disposition: 'blocking' }), 'high_risk');
  assert.equal(classifyFinding({ severity: 'low', proposed_disposition: 'blocking' }), 'high_risk');
  assert.equal(classifyFinding({ severity: 'medium' }), 'advisory');
  assert.equal(classifyFinding({ severity: 'low' }), 'unverified');
});

test('the first wave is two skeptics for high risk, one for a medium advisory, none for low', () => {
  assert.deepEqual(planFirstWave({ severity: 'high' }), { lane: 'high_risk', skeptics: 2 });
  assert.deepEqual(planFirstWave({ severity: 'medium' }), { lane: 'advisory', skeptics: 1 });
  assert.deepEqual(planFirstWave({ severity: 'low' }), { lane: 'unverified', skeptics: 0 });
});

test('a high-risk finding launches its two first-wave skeptics in parallel', () => {
  assert.deepEqual(decideVerification({ severity: 'critical' }), {
    lane: 'high_risk',
    dispatch: { role: 'skeptic', count: 2 },
    status: 'awaiting_verdicts',
    outcome: null,
  });
});

test('agreeing first-wave skeptics resolve a high-risk finding without a third call', () => {
  const dropped = replay({ severity: 'high' }, ['refuted', 'refuted']).at(-1);
  assert.deepEqual(dropped, {
    lane: 'high_risk',
    dispatch: { role: null, count: 0 },
    status: 'resolved',
    outcome: 'dropped',
  });
  const kept = replay({ severity: 'high' }, ['confirmed', 'confirmed']).at(-1);
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
      decideVerification({ severity: 'high' }, split.map((value) => verdict(value))),
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
  assert.equal(replay({ severity: 'high' }, ['refuted', 'confirmed', 'refuted']).at(-1).outcome, 'dropped');
  assert.equal(replay({ severity: 'high' }, ['refuted', 'confirmed', 'confirmed']).at(-1).outcome, 'kept');
  assert.equal(replay({ severity: 'high' }, ['refuted', 'uncertain', 'uncertain']).at(-1).outcome, 'kept');
  assert.equal(replay({ severity: 'high' }, ['uncertain', 'uncertain', 'uncertain']).at(-1).outcome, 'kept');
});

test('a proposed blocker keeps the majority rule even at medium severity', () => {
  const finding = { severity: 'medium', proposed_disposition: 'blocking' };
  assert.equal(decideVerification(finding).dispatch.count, 2);
  assert.equal(replay(finding, ['refuted', 'uncertain']).at(-1).dispatch.role, 'tiebreaker');
  assert.equal(replay(finding, ['refuted', 'uncertain', 'confirmed']).at(-1).outcome, 'kept');
});

test('a confirmed medium advisory is kept without an adjudicator', () => {
  const decision = replay({ severity: 'medium' }, ['confirmed']).at(-1);
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
      replay({ severity: 'medium' }, [value]).at(-1),
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
  assert.equal(replay({ severity: 'medium' }, ['refuted', 'refuted']).at(-1).outcome, 'dropped');
  assert.equal(replay({ severity: 'medium' }, ['refuted', 'confirmed']).at(-1).outcome, 'kept');
  assert.equal(replay({ severity: 'medium' }, ['refuted', 'uncertain']).at(-1).outcome, 'kept');
  assert.equal(replay({ severity: 'medium' }, ['uncertain', 'refuted']).at(-1).outcome, 'dropped');
});

test('a low non-blocking finding passes through unverified', () => {
  assert.deepEqual(decideVerification({ severity: 'low' }), {
    lane: 'unverified',
    dispatch: { role: null, count: 0 },
    status: 'resolved',
    outcome: 'kept',
  });
  assert.throws(() => decideVerification({ severity: 'low' }, [verdict('refuted')]), /without verification/);
});

test('an incomplete high-risk first wave waits rather than resolving', () => {
  assert.deepEqual(decideVerification({ severity: 'high' }, [verdict('refuted')]), {
    lane: 'high_risk',
    dispatch: { role: null, count: 0 },
    status: 'awaiting_verdicts',
    outcome: null,
  });
});

test('verification never exceeds three high-risk or two advisory calls', () => {
  const four = Array.from({ length: 4 }, () => verdict('refuted'));
  assert.throws(() => decideVerification({ severity: 'high' }, four), /at most three/);
  assert.throws(() => decideVerification({ severity: 'medium' }, four.slice(0, 3)), /at most one skeptic/);
});

test('rejects an unknown severity, disposition, or verdict, and an uncited verdict', () => {
  assert.throws(() => decideVerification({ severity: 'blocker' }), /Unknown severity/);
  assert.throws(() => decideVerification({ severity: 'high', proposed_disposition: 'veto' }), /Unknown proposed/);
  assert.throws(() => decideVerification({ severity: 'medium' }, [verdict('maybe')]), /Unknown verdict/);
  assert.throws(() => decideVerification({ severity: 'medium' }, [verdict('refuted', '')]), /non-empty reason/);
});

test('the CLI emits the decision for a serialized finding and verdict trail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adversarial-policy-'));
  tempDirs.push(dir);
  const inputPath = join(dir, 'input.json');
  writeFileSync(
    inputPath,
    JSON.stringify({ finding: { severity: 'medium' }, verdicts: [verdict('refuted')] })
  );
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
