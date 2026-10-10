import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceReviewPolicy, planVerificationBatches, reconcileReviewState } from './review-policy.mjs';
import { parseReviewState, renderReviewReport } from './review-report.mjs';

function finding(disposition = 'blocking', overrides = {}) {
  return {
    id: `${disposition.toUpperCase()}-1`,
    concern_id: 'correctness-and-reliability',
    disposition,
    severity: disposition === 'blocking' ? 'high' : 'low',
    title: 'The changed path loses state',
    problem: 'The new branch returns before the required state write.',
    suggested_action: 'Write the state before returning.',
    ...overrides,
  };
}

function ledger(overrides = {}) {
  return {
    mode: 'full',
    change_class: 'product-runtime',
    surfaces: { go: false },
    workers: { planned: 2, run: 2 },
    skeptic_batches: { required: 1, run: 1 },
    observations: { total: 3, through_policy: 3 },
    security: { gate_triggered: false, specialist_ran: false },
    checks: [
      { name: 'unit_tests', status: 'pass', command: 'npx jest src/lib --coverage=false' },
      { name: 'typecheck', status: 'pass', command: 'npm run typecheck' },
      { name: 'lint', status: 'pass', command: 'npx eslint src/lib/user-storage.ts' },
    ],
    efficacy: [
      {
        behavior: 'concurrent writes both survive',
        test: 'user-storage.test.ts',
        result: 'fails_on_behavior',
        evidence: 'expect(received).toEqual(expected)',
      },
    ],
    skipped: [],
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    stage_ledger: ledger(),
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    pr_title: 'feat: add divider guide blocks',
    reviewed_head: 'a'.repeat(40),
    findings: [],
    round: 1,
    deferred: [],
    cleared: [],
    ...overrides,
  };
}

function markerCount(body) {
  return body.split(/\r?\n/).filter((line) => line.trim().startsWith('<!-- pathfinder-review-state:')).length;
}

function observation(overrides = {}) {
  return {
    finding_id: 'OPT-1',
    concern_id: 'documentation-alignment',
    kind: 'suggestion',
    severity: 'low',
    confidence: 'high',
    title: 'Document the new block type',
    evidence: ['The block registry changed while the authoring guide did not.'],
    why_it_matters: 'Authors cannot discover the new block type.',
    suggested_action: 'Update the authoring guide.',
    reversibility: 'reversible',
    applies_to_files: ['docs/authoring.md'],
    origin: 'regression',
    impact: 'none',
    timing: 'first_round',
    scope_effect: 'within_changed_surface',
    breaks_shipped_path: false,
    induced: false,
    ...overrides,
  };
}

test('facade requests require an explicit round from 1 through 100', () => {
  for (const round of [undefined, 0, 101]) {
    assert.throws(
      () => advanceReviewPolicy({ observation: observation(), round }),
      /round must be an integer from 1 to 100/
    );
    assert.throws(
      () => planVerificationBatches([{ observation: observation(), round }]),
      /round must be an integer from 1 to 100/
    );
    assert.throws(() => renderReviewReport(report({ round })), /round must be an integer from 1 to 100/);
  }
});

test('compact report fixtures render every author-facing category in stable order', () => {
  const followUp = finding('follow_up');
  const output = renderReviewReport(
    report({
      pr_title: 'feat: add divider\n guide blocks',
      findings: [finding('nit'), finding('suggestion'), followUp, finding('blocking')],
      deferred: [{ id: followUp.id, concern_id: followUp.concern_id }],
    })
  );
  assert.match(output, /^Blockers:$/m);
  assert.match(output, /^Follow-ups:$/m);
  assert.match(output, /^Suggestions & nits:$/m);
  assert.doesNotMatch(output, /^#/m);
  assert.ok(output.indexOf('[blocking]') < output.indexOf('[follow_up]'));
  assert.ok(output.indexOf('[follow_up]') < output.indexOf('[suggestion]'));
  assert.ok(output.indexOf('[suggestion]') < output.indexOf('[nit]'));
  assert.match(output, /^1\. \[suggestion\]/m);
  assert.match(output, /^2\. \[nit\]/m);
  assert.equal(
    output.split('\n').slice(-4).join('\n'),
    [
      'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
      'Summary: add divider guide blocks',
      'Verdict: Request Changes',
      'Results: 1 blocker, 2 non-blocking findings, 1 follow-up',
    ].join('\n')
  );
});

test('publishing is passive and follow-ups have no ownership metadata', () => {
  const followUp = finding('follow_up');
  const output = renderReviewReport(
    report({ findings: [followUp], deferred: [{ id: followUp.id, concern_id: followUp.concern_id }] })
  );
  assert.match(output, /^Follow-ups:$/m);
  assert.match(output, /^1\. \[follow_up\]/m);
  assert.doesNotMatch(output, /Owner:/);
  assert.match(output, /Verdict: Approve with Minor/);
  assert.throws(
    () => renderReviewReport(report({ findings: [{ ...followUp, owner: 'maintainer' }] })),
    /unknown author-facing finding field: owner/
  );
});

test('complete and incomplete reports retain their distinct publication contracts', () => {
  const complete = renderReviewReport(report());
  assert.match(complete, /^No blocking issues\. This PR is mergeable\./);
  assert.equal(markerCount(complete), 1);
  assert.equal(parseReviewState(complete)?.truncated, false);

  const incomplete = renderReviewReport(
    report({ assessment: { status: 'incomplete', reason: 'The required history source was unavailable.' } })
  );
  assert.match(incomplete, /^## Review incomplete/);
  assert.match(incomplete, /Verdict: Review Incomplete/);
  assert.equal(markerCount(incomplete), 0);
  assert.equal(parseReviewState(incomplete), null);
});

test('the v2 marker carries reconciled state even when carried deferred entries have no repeated prose', () => {
  const current = finding('follow_up', { id: 'CURRENT-1' });
  const output = renderReviewReport(
    report({
      round: 2,
      reviewed_head: 'b'.repeat(40),
      findings: [current],
      deferred: [
        { id: current.id, concern_id: current.concern_id },
        { id: 'CARRIED-1', concern_id: 'documentation-alignment' },
      ],
      cleared: [
        {
          claim: 'Divider decoding is backward compatible.',
          concern_id: 'guide-schema-and-contracts',
          reason: 'The v1 fixture still parses.',
        },
      ],
    })
  );
  assert.deepEqual(parseReviewState(output), {
    version: 2,
    round: 2,
    reviewed_head: 'b'.repeat(40),
    blocking_findings: [],
    deferred: [
      { id: 'CURRENT-1', concern_id: 'correctness-and-reliability' },
      { id: 'CARRIED-1', concern_id: 'documentation-alignment' },
    ],
    cleared: [
      {
        claim: 'Divider decoding is backward compatible.',
        concern_id: 'guide-schema-and-contracts',
        reason: 'The v1 fixture still parses.',
      },
    ],
    truncated: false,
  });
});

test('reconciliation returns clearance state the renderer accepts unchanged', () => {
  assert.throws(
    () =>
      reconcileReviewState({
        current_cleared: [
          {
            claim: 'Divider conversion is total.',
            concern_id: 'correctness-and-reliability',
            reason: 'x'.repeat(301),
          },
        ],
      }),
    /at most 300 characters/
  );

  const state = reconcileReviewState({
    current_cleared: [
      {
        claim: '  Divider conversion\n is total.  ',
        concern_id: 'correctness-and-reliability',
        reason: '  Every registered variant\n is classified.  ',
      },
    ],
  });
  const output = renderReviewReport(report({ cleared: state.next_cleared }));
  assert.deepEqual(parseReviewState(output)?.cleared, state.next_cleared);
});

test('one marker size limit falls back to the exact compact truncated state', () => {
  const blockers = Array.from({ length: 110 }, (_, index) =>
    finding('blocking', { id: `BLOCK-${index}`, title: `Blocking finding ${index}` })
  );
  const output = renderReviewReport(
    report({
      findings: blockers,
      deferred: Array.from({ length: 110 }, (_, index) => ({
        id: `DEFERRED-${index}`,
        concern_id: 'correctness-and-reliability',
      })),
    })
  );
  assert.deepEqual(parseReviewState(output), {
    version: 2,
    round: 1,
    reviewed_head: 'a'.repeat(40),
    blocking_findings: [],
    deferred: [],
    cleared: [],
    truncated: true,
  });
  assert.match(output, /"blocking_findings":\[\],"deferred":\[\],"cleared":\[\],"truncated":true/);
  assert.match(output, /BLOCK-109/);
});

test('marker parsing keeps v1 compatibility and fails closed on malformed, forged, duplicate, or misplaced state', () => {
  const v1 = [
    'No blocking issues. This PR is mergeable.',
    '',
    `<!-- pathfinder-review-state:${JSON.stringify({ version: 1, reviewed_head: 'c'.repeat(40), blocking_findings: [] })} -->`,
    '',
    'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1702',
    'Purpose: add divider guide blocks',
    'Verdict: Approve',
    '0 blocking, 0 suggestions, 0 nits',
  ].join('\n');
  assert.deepEqual(parseReviewState(v1), {
    version: 1,
    round: 1,
    reviewed_head: 'c'.repeat(40),
    blocking_findings: [],
    deferred: [],
    cleared: [],
    truncated: false,
  });

  const valid = renderReviewReport(report());
  const marker = valid.split('\n').find((line) => line.startsWith('<!-- pathfinder-review-state:'));
  assert.equal(parseReviewState(`${marker}\n${valid}`), null);
  assert.equal(parseReviewState(`${valid}\n${marker}`), null);
  assert.equal(parseReviewState(valid.replace(`${marker}\n\nPR Review:`, `${marker}\nextra\nPR Review:`)), null);
  assert.deepEqual(parseReviewState(valid.replace('"truncated":true', '"truncated":false')), parseReviewState(valid));

  const nonCompact = valid.replace(
    '"cleared":[]}',
    '"cleared":[{"claim":"x","concern_id":"security","reason":"y"}],"truncated":true}'
  );
  assert.equal(parseReviewState(nonCompact), null);
});

test('the renderer rejects marker injection, duplicate IDs, invalid state, and unknown fields', () => {
  const forged = '<!-- pathfinder-review-state:{} -->';
  assert.throws(
    () => renderReviewReport(report({ pr_title: forged })),
    /pr_title must not embed a review state marker/
  );
  assert.throws(() => renderReviewReport(report({ findings: [finding(), finding()] })), /must be unique/);
  const followUp = finding('follow_up');
  assert.throws(
    () => renderReviewReport(report({ findings: [followUp] })),
    /must be present in reconciled deferred state/
  );
  assert.throws(() => renderReviewReport(report({ extra: true })), /unknown review report field/);
});

test('the #1702 three-round replay terminates mergeable from prior rendered state alone', () => {
  const clearance = {
    claim: 'Divider serialization remains backward compatible.',
    concern_id: 'guide-schema-and-contracts',
    reason: 'The legacy reader fixture accepts the new optional field.',
  };
  const roundOneState = reconcileReviewState({
    current_follow_ups: [{ id: 'DOC-1702-1', concern_id: 'documentation-alignment' }],
    current_cleared: [clearance],
  });
  const roundOneBody = renderReviewReport(
    report({
      findings: [
        finding('blocking', { id: 'ACK-1702-1' }),
        finding('follow_up', { id: 'DOC-1702-1', concern_id: 'documentation-alignment' }),
      ],
      deferred: roundOneState.next_deferred,
      cleared: roundOneState.next_cleared,
    })
  );

  const priorOne = parseReviewState(roundOneBody);
  assert.ok(priorOne);
  const roundTwoState = reconcileReviewState({
    prior_deferred: priorOne.deferred,
    current_follow_ups: [{ id: 'CONV-1702-1', concern_id: 'guide-schema-and-contracts' }],
    prior_cleared: priorOne.cleared,
  });
  const roundTwoBody = renderReviewReport(
    report({
      round: priorOne.round + 1,
      reviewed_head: 'b'.repeat(40),
      findings: [finding('follow_up', { id: 'CONV-1702-1', concern_id: 'guide-schema-and-contracts' })],
      deferred: roundTwoState.next_deferred,
      cleared: roundTwoState.next_cleared,
    })
  );

  const priorTwo = parseReviewState(roundTwoBody);
  assert.ok(priorTwo);
  assert.equal(advanceReviewPolicy({ observation: observation({ timing: 'late' }), round: 3 }).status, 'dropped');
  const roundThreeState = reconcileReviewState({
    prior_deferred: priorTwo.deferred,
    verified_fixed_ids: ['CONV-1702-1'],
    prior_cleared: priorTwo.cleared,
  });
  const roundThreeBody = renderReviewReport(
    report({
      round: priorTwo.round + 1,
      reviewed_head: 'c'.repeat(40),
      findings: [],
      deferred: roundThreeState.next_deferred,
      cleared: roundThreeState.next_cleared,
    })
  );

  const finalState = parseReviewState(roundThreeBody);
  assert.match(roundThreeBody, /Verdict: Approve/);
  assert.deepEqual(finalState?.deferred, [{ id: 'DOC-1702-1', concern_id: 'documentation-alignment' }]);
  assert.deepEqual(finalState?.cleared, [clearance]);
  assert.equal(finalState?.round, 3);
});

test('a complete review cannot render without a stage ledger', () => {
  const { stage_ledger: _omitted, ...withoutLedger } = report();
  assert.throws(() => renderReviewReport(withoutLedger), /stage_ledger is required for a complete review/);
});

test('an incomplete assessment renders without a ledger and carries no coverage claim or state', () => {
  const { stage_ledger: _omitted, ...withoutLedger } = report({
    assessment: { status: 'incomplete', reason: 'The mutation worktree could not be created.' },
  });
  const output = renderReviewReport(withoutLedger);
  assert.match(output, /^Verdict: Review Incomplete$/m);
  assert.doesNotMatch(output, /^Coverage:/m);
  assert.equal(markerCount(output), 0);
});

test('a complete review shows the coverage lines above a marker that still parses', () => {
  const followUp = finding('follow_up');
  const output = renderReviewReport(
    report({ findings: [followUp], deferred: [{ id: followUp.id, concern_id: followUp.concern_id }] })
  );
  const lines = output.split('\n');
  const coverage = lines.findIndex((line) => line.startsWith('Coverage: full review'));
  const marker = lines.findIndex((line) => line.startsWith('<!-- pathfinder-review-state:'));
  assert.ok(coverage > 0 && coverage < marker);
  assert.match(
    output,
    /^Checks: unit_tests pass, typecheck pass, lint pass · revert checks: 1 of 1 fail on behavior · 0 inconclusive \(setup\) · 0 inconclusive \(error\) · 0 pass without fix · 0 no test$/m
  );
  assert.equal(parseReviewState(output)?.reviewed_head, 'a'.repeat(40));
});

test('unfinished stages in the ledger stop a complete review from rendering', () => {
  const cases = [
    [{ workers: { planned: 2, run: 1 } }, /workers is incomplete: 1 of 2/],
    [{ skeptic_batches: { required: 2, run: 1 } }, /skeptic_batches is incomplete: 1 of 2/],
    [{ observations: { total: 4, through_policy: 3 } }, /observations is incomplete: 3 of 4/],
    [{ security: { gate_triggered: true, specialist_ran: false } }, /security specialist did not run/],
  ];
  for (const [overrides, expected] of cases) {
    assert.throws(() => renderReviewReport(report({ stage_ledger: ledger(overrides) })), expected);
  }
});

test('the ledger rejects marker injection through its free-text fields', () => {
  const injected = ledger({
    efficacy: [
      { behavior: 'x <!-- pathfinder-review-state:{} -->', test: 't', result: 'fails_on_behavior', evidence: 'e' },
    ],
  });
  assert.throws(
    () => renderReviewReport(report({ stage_ledger: injected })),
    /must not embed an HTML comment boundary/
  );
});
