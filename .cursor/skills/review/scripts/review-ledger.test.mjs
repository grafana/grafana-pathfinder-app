import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStageLedger, renderCoverageLines } from './review-ledger.mjs';

function ledger(overrides = {}) {
  return {
    mode: 'full',
    change_class: 'product-runtime',
    workers: { planned: 1, run: 1 },
    skeptic_batches: { required: 0, run: 0 },
    observations: { total: 2, through_policy: 2 },
    security: { gate_triggered: false, specialist_ran: false },
    checks: [
      { name: 'unit_tests', status: 'pass', command: 'npx jest src/lib --coverage=false' },
      { name: 'typecheck', status: 'pass', command: 'npm run typecheck' },
      { name: 'lint', status: 'pass', command: 'npx eslint src/lib/a.ts' },
    ],
    efficacy: [{ behavior: 'keeps both writes', test: 'a.test.ts', result: 'fails_without_fix' }],
    skipped: [],
    ...overrides,
  };
}

test('a fully finished ledger normalizes and renders both coverage lines', () => {
  const lines = renderCoverageLines(ledger());
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /^Coverage: full review · workers 1\/1 · skeptic batches 0\/0 · observations through policy 2\/2 · security gate not triggered$/
  );
  assert.equal(normalizeStageLedger(ledger()).security.specialist_ran, false);
});

test('a specialist that ran without the gate triggering is reported as ran', () => {
  const lines = renderCoverageLines(ledger({ security: { gate_triggered: false, specialist_ran: true } }));
  assert.match(lines[0], /security specialist ran$/);
});

test('every required check must be present, and docs-only needs only lint', () => {
  const withoutTests = ledger({ checks: ledger().checks.filter(({ name }) => name !== 'unit_tests') });
  assert.throws(() => normalizeStageLedger(withoutTests), /checks are missing unit_tests/);
  const docsOnly = ledger({
    change_class: 'docs-only',
    efficacy: [],
    checks: [{ name: 'lint', status: 'pass', command: 'npx prettier --check docs' }],
  });
  assert.equal(normalizeStageLedger(docsOnly).checks.length, 1);
});

test('a check needs its command, or a reason when it does not apply', () => {
  const noCommand = ledger({ checks: [{ name: 'unit_tests', status: 'pass' }, ...ledger().checks.slice(1)] });
  assert.throws(() => normalizeStageLedger(noCommand), /check unit_tests command/);
  const noReason = ledger({
    checks: [{ name: 'unit_tests', status: 'not_applicable' }, ...ledger().checks.slice(1)],
  });
  assert.throws(() => normalizeStageLedger(noReason), /check unit_tests reason/);
  const duplicated = ledger({ checks: [...ledger().checks, ledger().checks[0]] });
  assert.throws(() => normalizeStageLedger(duplicated), /must appear once/);
});

test('a full review of changed behavior must record test efficacy, an incremental one need not', () => {
  assert.throws(() => normalizeStageLedger(ledger({ efficacy: [] })), /efficacy is empty/);
  assert.equal(normalizeStageLedger(ledger({ mode: 'incremental', efficacy: [] })).efficacy.length, 0);
  assert.equal(normalizeStageLedger(ledger({ change_class: 'tests-only', efficacy: [] })).efficacy.length, 0);
});

test('efficacy records survivors honestly and a missing test needs no test name', () => {
  const survivors = ledger({
    efficacy: [
      { behavior: 'wiring', test: 'a.test.ts', result: 'passes_without_fix' },
      { behavior: 'untested mutator', result: 'no_test_exists' },
    ],
  });
  const normalized = normalizeStageLedger(survivors);
  assert.deepEqual(
    normalized.efficacy.map(({ test }) => test),
    ['a.test.ts', null]
  );
  assert.match(renderCoverageLines(survivors)[1], /0 of 2 tests fail without their fix/);
  assert.throws(
    () => normalizeStageLedger(ledger({ efficacy: [{ behavior: 'wiring', result: 'passes_without_fix' }] })),
    /efficacy test/
  );
});

test('a skipped stage needs the user consent quoted, and is shown when present', () => {
  const skipped = { stage: 'test efficacy', reason: 'no worktree budget' };
  assert.throws(() => normalizeStageLedger(ledger({ skipped: [skipped] })), /without the user's consent/);
  const consented = ledger({ skipped: [{ ...skipped, user_consent: 'skip the revert checks this once' }] });
  assert.match(
    renderCoverageLines(consented).at(-1),
    /^Skipped with user consent: test efficacy \(no worktree budget\)$/
  );
});

test('unknown ledger fields and unknown change classes are rejected', () => {
  assert.throws(() => normalizeStageLedger(ledger({ confidence: 'high' })), /unknown stage_ledger field: confidence/);
  assert.throws(() => normalizeStageLedger(ledger({ change_class: 'big' })), /change_class must be one of/);
  assert.throws(() => normalizeStageLedger(ledger({ mode: 'quick' })), /mode must be full or incremental/);
});
