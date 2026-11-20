import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReviewGate } from './review-gate.mjs';

const options = { repo: '/trusted', 'review-key': 'o/r#7', base: 'b'.repeat(40), head: 'a'.repeat(40) };
const cleared = {
  repository: 'o/r',
  pr_number: 7,
  base_sha: options.base,
  head_sha: options.head,
  scanner: { status: 'passed' },
  status: 'ready_for_triage',
};

test('direct preparation uses the shared gate before returning source authority', () => {
  let calls = 0;
  const result = assertReviewGate(options, (number, repo) => {
    assert.equal(number, '7');
    assert.equal(repo, '/trusted');
    calls++;
    return cleared;
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ready_for_triage');
});
test('unresolved contributor and scanner gates refuse review', () => {
  for (const status of ['scanner_blocked', 'contributor_blocked', 'awaiting_cla', 'indeterminate']) {
    assert.throws(() => assertReviewGate(options, () => ({ ...cleared, status })), /stopped/);
  }
  assert.throws(() => assertReviewGate(options, () => ({ ...cleared, scanner: { status: 'blocked' } })), /stopped/);
});
test('a former handle exemption cannot bypass the gate', () => {
  assert.throws(
    () => assertReviewGate(options, () => ({ ...cleared, status: 'internal', internal_basis: 'explicit_handle' })),
    /write access/
  );
  assert.equal(
    assertReviewGate(options, () => ({ ...cleared, status: 'internal', internal_basis: 'write_access' })).status,
    'internal'
  );
});
test('a moved head or another repository cannot reuse clearance', () => {
  for (const changed of [
    { head_sha: 'c'.repeat(40) },
    { base_sha: 'd'.repeat(40) },
    { repository: 'other/r' },
    { pr_number: 8 },
  ]) {
    assert.throws(() => assertReviewGate(options, () => ({ ...cleared, ...changed })), /does not match/);
  }
});
test('malformed review identities stop before querying GitHub', () => {
  assert.throws(
    () => assertReviewGate({ ...options, 'review-key': 'shell $(payload)' }, () => assert.fail('must not query')),
    /review key/
  );
});
