import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStageLedger, renderCoverageLines } from './review-ledger.mjs';

function ledger(overrides = {}) {
  return {
    mode: 'full',
    change_class: 'product-runtime',
    surfaces: { go: false },
    workers: { planned: 1, run: 1 },
    skeptic_batches: { required: 0, run: 0 },
    observations: { total: 2, through_policy: 2 },
    security: { gate_triggered: false, specialist_ran: false },
    checks: [
      { name: 'unit_tests', status: 'pass', command: 'npx jest src/lib --coverage=false' },
      { name: 'typecheck', status: 'pass', command: 'npm run typecheck' },
      { name: 'lint', status: 'pass', command: 'npx eslint src/lib/a.ts' },
    ],
    efficacy: [
      {
        behavior: 'keeps both writes',
        test: 'a.test.ts',
        result: 'fails_on_behavior',
        evidence: 'expect(received).toEqual(expected)',
      },
    ],
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
    change_class: 'tests-only',
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
      {
        behavior: 'wiring',
        test: 'a.test.ts',
        result: 'passes_without_fix',
        evidence: 'Tests: 3 passed, 3 total',
        disposition_note: 'finding wiring-untested',
      },
      { behavior: 'untested mutator', result: 'no_test_exists', disposition_note: 'covered by the e2e suite' },
    ],
  });
  const normalized = normalizeStageLedger(survivors);
  assert.deepEqual(
    normalized.efficacy.map(({ test }) => test),
    ['a.test.ts', null]
  );
  assert.match(
    renderCoverageLines(survivors)[1],
    /revert checks: 0 of 2 fail on behavior · 0 inconclusive \(setup\) · 0 inconclusive \(error\) · 1 pass without fix · 1 no test$/
  );
  assert.throws(
    () => normalizeStageLedger(ledger({ efficacy: [{ behavior: 'wiring', result: 'passes_without_fix' }] })),
    /efficacy test/
  );
});

test('the legacy fails_without_fix result is rejected with a request to classify it', () => {
  const legacy = ledger({ efficacy: [{ behavior: 'x', test: 'a.test.ts', result: 'fails_without_fix' }] });
  assert.throws(() => normalizeStageLedger(legacy), /fails_without_fix is retired\. Classify the reverted run/);
});

test('inconclusive reverts are counted apart from behavioral failures', () => {
  const entry = (result, evidence) => ({ behavior: result, test: 'a.test.ts', result, evidence });
  const mixed = ledger({
    efficacy: [
      entry('fails_on_behavior', 'Expected: 3'),
      entry('inconclusive_setup', 'Cannot find module ./gone'),
      entry('inconclusive_setup', 'pkg/plugin/app.go:12:3: undefined: proxy'),
      entry('inconclusive_error', 'TypeError: x is not a function'),
    ],
  });
  assert.match(
    renderCoverageLines(mixed)[1],
    /revert checks: 1 of 4 fail on behavior · 2 inconclusive \(setup\) · 1 inconclusive \(error\) · 0 pass without fix · 0 no test$/
  );
});

test('every run revert carries evidence, and every untested or surviving behavior a disposition note', () => {
  const run = { behavior: 'x', test: 'a.test.ts' };
  assert.throws(
    () => normalizeStageLedger(ledger({ efficacy: [{ ...run, result: 'fails_on_behavior' }] })),
    /efficacy fails_on_behavior evidence/
  );
  assert.throws(
    () => normalizeStageLedger(ledger({ efficacy: [{ ...run, result: 'passes_without_fix', evidence: 'exit 0' }] })),
    /efficacy passes_without_fix disposition_note/
  );
  assert.throws(
    () => normalizeStageLedger(ledger({ efficacy: [{ behavior: 'y', result: 'no_test_exists' }] })),
    /efficacy no_test_exists disposition_note/
  );
  const noted = normalizeStageLedger(
    ledger({ efficacy: [{ behavior: 'y', result: 'no_test_exists', disposition_note: 'finding y-untested' }] })
  );
  assert.deepEqual(noted.efficacy[0], {
    behavior: 'y',
    test: null,
    result: 'no_test_exists',
    evidence: null,
    disposition_note: 'finding y-untested',
  });
});

const GO = [
  { name: 'go_build', status: 'pass', command: 'go build ./...' },
  { name: 'go_lint', status: 'pass', command: 'npm run lint:go' },
  { name: 'go_test', status: 'pass', command: 'go test ./pkg/...' },
];

test('the surfaces field is required and comes from changed-surface.mjs', () => {
  const { surfaces: _omitted, ...withoutSurfaces } = ledger();
  assert.throws(() => normalizeStageLedger(withoutSurfaces), /stage_ledger surfaces must be an object/);
  assert.throws(() => normalizeStageLedger(ledger({ surfaces: { go: 'yes' } })), /surfaces\.go must be the boolean/);
  assert.throws(
    () => normalizeStageLedger(ledger({ surfaces: { go: false, frontend: true } })),
    /unknown stage_ledger surfaces field: frontend/
  );
});

test('a legacy ledger names both upgrades at once: surfaces from changed-surface.mjs and classified reverts', () => {
  const { surfaces: _omitted, ...legacy } = ledger({
    efficacy: [{ behavior: 'x', test: 'a.test.ts', result: 'fails_without_fix' }],
  });
  assert.throws(
    () => normalizeStageLedger(legacy),
    (error) =>
      /surfaces must be an object/.test(error.message) &&
      /changed-surface\.mjs --base <base-sha> --head <head-sha>/.test(error.message) &&
      /fails_without_fix is retired\. Classify the reverted run/.test(error.message)
  );
});

test('a Go change requires go_build, go_lint, and go_test, shown on the Checks line', () => {
  assert.throws(() => normalizeStageLedger(ledger({ surfaces: { go: true } })), /missing go_build, go_lint, go_test/);
  const withGo = ledger({ surfaces: { go: true }, checks: [...ledger().checks, ...GO] });
  assert.match(
    renderCoverageLines(withGo)[1],
    /^Checks: unit_tests pass, typecheck pass, lint pass, go_build pass, go_lint pass, go_test pass · /
  );
  const docsOnlyGo = ledger({
    change_class: 'docs-only',
    surfaces: { go: true },
    efficacy: [],
    checks: [{ name: 'lint', status: 'pass', command: 'npx prettier --check docs' }],
  });
  assert.throws(() => normalizeStageLedger(docsOnlyGo), /missing go_build, go_lint, go_test/);
});

test('a Go check cannot be not_applicable when Go changed, even with consent; a consented skip omits it', () => {
  const notApplicable = { name: 'go_lint', status: 'not_applicable', reason: 'no golangci-lint here' };
  const checks = [...ledger().checks, GO[0], notApplicable, GO[2]];
  assert.throws(
    () => normalizeStageLedger(ledger({ surfaces: { go: true }, checks })),
    /go_lint cannot be not_applicable when Go changed/
  );
  assert.throws(
    () => normalizeStageLedger(ledger({ surfaces: { go: true }, checks, skipped: [consent('go_lint')] })),
    (error) =>
      /go_lint cannot be not_applicable when Go changed/.test(error.message) &&
      /already has a consented skip, so remove its check entry/.test(error.message) &&
      !/quote the user's consent/.test(error.message)
  );
  const skipped = normalizeStageLedger(
    ledger({ surfaces: { go: true }, checks: [...ledger().checks, GO[0], GO[2]], skipped: [consent('go_lint')] })
  );
  assert.deepEqual(skipped.checks.at(-1), { name: 'go_lint', status: 'skipped' });
});

test('without a Go change the Go checks may be omitted or recorded', () => {
  assert.equal(normalizeStageLedger(ledger()).checks.length, 3);
  const recorded = normalizeStageLedger(
    ledger({ checks: [...ledger().checks, { name: 'go_lint', status: 'not_applicable', reason: 'no Go changed' }] })
  );
  assert.equal(recorded.checks.at(-1).status, 'not_applicable');
});

function consent(stage) {
  return { stage, reason: 'no budget this round', user_consent: `skip ${stage} this once` };
}

test('a skipped stage needs the user consent quoted, and is shown when present', () => {
  const skipped = { stage: 'test_efficacy', reason: 'no worktree budget' };
  assert.throws(() => normalizeStageLedger(ledger({ efficacy: [], skipped: [skipped] })), /without the user's consent/);
  const consented = ledger({
    efficacy: [],
    skipped: [{ ...skipped, user_consent: 'skip the revert checks this once' }],
  });
  assert.equal(normalizeStageLedger(consented).efficacy.length, 0);
  assert.match(
    renderCoverageLines(consented).at(-1),
    /^Skipped with user consent: test_efficacy \(no worktree budget\)$/
  );
});

test('skipped stages come from a closed set and appear once', () => {
  assert.throws(
    () => normalizeStageLedger(ledger({ skipped: [consent('test efficacy')] })),
    /skipped stage must be one of workers, skeptic_batches/
  );
  assert.throws(
    () => normalizeStageLedger(ledger({ skipped: [consent('lint'), consent('lint')] })),
    /skipped stage lint must appear once/
  );
});

test('each consented skip waives exactly its matching stage', () => {
  const cases = [
    ['workers', { workers: { planned: 2, run: 1 } }, /workers is incomplete/],
    ['skeptic_batches', { skeptic_batches: { required: 2, run: 0 } }, /skeptic_batches is incomplete/],
    ['observations', { observations: { total: 3, through_policy: 1 } }, /observations is incomplete/],
    ['security_specialist', { security: { gate_triggered: true, specialist_ran: false } }, /specialist did not run/],
    ['unit_tests', { checks: ledger().checks.filter(({ name }) => name !== 'unit_tests') }, /missing unit_tests/],
    ['typecheck', { checks: ledger().checks.filter(({ name }) => name !== 'typecheck') }, /missing typecheck/],
    ['lint', { checks: ledger().checks.filter(({ name }) => name !== 'lint') }, /missing lint/],
    ...['go_build', 'go_lint', 'go_test'].map((name) => [
      name,
      { surfaces: { go: true }, checks: [...ledger().checks, ...GO.filter((check) => check.name !== name)] },
      new RegExp(`missing ${name}`),
    ]),
    ['test_efficacy', { efficacy: [] }, /efficacy is empty/],
  ];
  for (const [stage, gap, expected] of cases) {
    assert.throws(() => normalizeStageLedger(ledger(gap)), expected, stage);
    assert.doesNotThrow(() => normalizeStageLedger(ledger({ ...gap, skipped: [consent(stage)] })), stage);
    const other = stage === 'lint' ? 'typecheck' : 'lint';
    assert.throws(() => normalizeStageLedger(ledger({ ...gap, skipped: [consent(other)] })), expected, stage);
  }
});

test('a waiver does not excuse more work than was planned', () => {
  assert.throws(
    () => normalizeStageLedger(ledger({ workers: { planned: 1, run: 2 }, skipped: [consent('workers')] })),
    /workers is incomplete: 2 of 1/
  );
});

test('a skipped specialist and a skipped check are named in the coverage lines', () => {
  const lines = renderCoverageLines(
    ledger({
      security: { gate_triggered: true, specialist_ran: false },
      checks: ledger().checks.filter(({ name }) => name !== 'typecheck'),
      skipped: [consent('security_specialist'), consent('typecheck')],
    })
  );
  assert.match(lines[0], /security specialist skipped$/);
  assert.match(lines[1], /^Checks: unit_tests pass, lint pass, typecheck skipped · /);
  assert.match(lines[2], /^Skipped with user consent: security_specialist .*; typecheck /);
});

test('a behavior change cannot mark a required check not applicable without consent', () => {
  const notApplicable = { name: 'unit_tests', status: 'not_applicable', reason: 'trivial change' };
  for (const change_class of ['product-runtime', 'contracts-and-schemas', 'mixed']) {
    const gap = ledger({ change_class, checks: [notApplicable, ...ledger().checks.slice(1)] });
    assert.throws(() => normalizeStageLedger(gap), /unit_tests cannot be not_applicable/, change_class);
    assert.equal(
      normalizeStageLedger({ ...gap, skipped: [consent('unit_tests')] }).checks[0].status,
      'not_applicable',
      change_class
    );
  }
  for (const change_class of ['tests-only', 'infra-build-ci']) {
    const allowed = ledger({ change_class, checks: [notApplicable, ...ledger().checks.slice(1)] });
    assert.equal(normalizeStageLedger(allowed).checks[0].status, 'not_applicable', change_class);
  }
  const docsOnly = ledger({
    change_class: 'docs-only',
    efficacy: [],
    checks: [{ name: 'lint', status: 'not_applicable', reason: 'no linter covers this file' }],
  });
  assert.equal(normalizeStageLedger(docsOnly).checks[0].status, 'not_applicable');
});

test('unknown ledger fields and unknown change classes are rejected', () => {
  assert.throws(() => normalizeStageLedger(ledger({ confidence: 'high' })), /unknown stage_ledger field: confidence/);
  assert.throws(() => normalizeStageLedger(ledger({ change_class: 'big' })), /change_class must be one of/);
  assert.throws(() => normalizeStageLedger(ledger({ mode: 'quick' })), /mode must be full or incremental/);
});
