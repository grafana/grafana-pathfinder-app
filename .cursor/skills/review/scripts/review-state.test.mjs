import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReviewState } from './review-state.mjs';

const HEAD = 'b'.repeat(40);
const PRIOR_HEAD = 'a'.repeat(40);
const yes = () => true;
const no = () => false;

function v2(overrides = {}) {
  return {
    version: 2,
    round: 2,
    reviewed_head: PRIOR_HEAD,
    blocking_findings: [],
    deferred: [],
    cleared: [],
    truncated: false,
    ...overrides,
  };
}

test('no prior marker runs a full review and counts prior submissions', () => {
  const result = resolveReviewState({ head: HEAD, priorState: null, priorReviewCount: 2, ancestorCheck: yes });
  assert.equal(result.mode, 'full');
  assert.equal(result.round, 3);
  assert.equal(result.diff_range, null);
  assert.equal(result.prior, null);
});

test('valid v2 marker with an ancestor head is incremental and advances the round', () => {
  const result = resolveReviewState({ head: HEAD, priorState: v2(), priorReviewCount: 9, ancestorCheck: yes });
  assert.equal(result.mode, 'incremental');
  assert.equal(result.round, 3);
  assert.equal(result.diff_range, `${PRIOR_HEAD}..${HEAD}`);
});

test('a truncated marker forces a full review but still advances the round', () => {
  const result = resolveReviewState({
    head: HEAD,
    priorState: v2({ truncated: true }),
    priorReviewCount: 0,
    ancestorCheck: yes,
  });
  assert.equal(result.mode, 'full');
  assert.equal(result.round, 3);
  assert.match(result.reason, /truncated/);
});

test('a non-ancestor reviewed head forces a full review', () => {
  const result = resolveReviewState({ head: HEAD, priorState: v2(), priorReviewCount: 1, ancestorCheck: no });
  assert.equal(result.mode, 'full');
  assert.match(result.reason, /ancestor/);
});

test('a v1 marker is incremental but derives the round from the review count', () => {
  const result = resolveReviewState({
    head: HEAD,
    priorState: v2({ version: 1, round: 1 }),
    priorReviewCount: 3,
    ancestorCheck: yes,
  });
  assert.equal(result.mode, 'incremental');
  assert.equal(result.round, 4);
});

test('the round is capped at 100', () => {
  const result = resolveReviewState({
    head: HEAD,
    priorState: v2({ round: 100 }),
    priorReviewCount: 0,
    ancestorCheck: yes,
  });
  assert.equal(result.round, 100);
});

test('rejects a short head and a negative count', () => {
  assert.throws(() => resolveReviewState({ head: 'abc', priorState: null, priorReviewCount: 0 }), /40-character/);
  assert.throws(() => resolveReviewState({ head: HEAD, priorState: null, priorReviewCount: -1 }), /non-negative/);
});
