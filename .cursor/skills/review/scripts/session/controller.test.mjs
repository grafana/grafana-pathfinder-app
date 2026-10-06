import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceReviewPolicy } from '../review-policy.mjs';
import { renderReviewReport } from '../review-report.mjs';
import { recordResult, recordWaiver } from './controller.mjs';
import { deriveStageLedger, obligations, renderSession, sessionStatus } from './finalize.mjs';
import {
  ALWAYS_ON,
  applyDrafts,
  block,
  cleanPacket,
  completeCommand,
  drive,
  EVIDENCE_PLAN,
  fakeContext,
  HEAD,
  observation,
  PRIOR_HEAD,
  ready,
  routeResult,
  startSession,
  submit,
  waive,
} from './testing.mjs';

const BASELINE_CLAIM = {
  resolution: 'baseline_failure',
  reason: 'fails on main too',
  signature: 'keeps both writes',
  preserve_paths: ['src/a.test.ts'],
  preserve_reason: 'the test was added by this PR and must exist at base',
};

function stages(state) {
  return obligations(state).map(({ stage }) => stage);
}

function widePlanConcerns() {
  return ALWAYS_ON.map((id, index) => ({
    id,
    context: Array.from({ length: 5 }, (_, file) => ({ path: `src/${index}-${file}.ts`, excerpt: 'x' })),
  }));
}

test('a fully driven session renders a complete review with a derived ledger', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { additions: [observation()] });
  const { rendered, open } = renderSession(state);
  assert.deepEqual(open, []);
  assert.match(rendered, /Verdict: Request Changes/);
  assert.match(
    rendered,
    /Coverage: full review · workers 1\/1 · skeptic batches 2\/2 · observations through policy 1\/1/
  );
});

test('the ledger counts come from task records, never from supplied numbers', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { routeOverrides: { concerns: widePlanConcerns() } });
  const ledger = deriveStageLedger(state);
  const observerTasks = state.order.filter((id) => state.tasks[id].role === 'observer');
  assert.equal(ledger.workers.planned, state.plan.plan.workers.length);
  assert.equal(ledger.workers.run, observerTasks.length);
  assert.ok(state.plan.plan.root.concern_ids.length > 0, 'the wide plan overflows to root');
  assert.equal(ledger.security.gate_triggered, false);
});

test('a blocked observer leaves the review incomplete instead of degrading it', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { observer: (current, task) => block(current, task, ctx) });
  assert.ok(stages(state).includes('observe'));
  const { rendered } = renderSession(state);
  assert.match(rendered, /## Review incomplete/);
  assert.match(rendered, /Verdict: Review Incomplete/);
  assert.doesNotMatch(rendered, /pathfinder-review-state/);
});

test('root overflow is an explicit obligation, not an implied one', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, {
    routeOverrides: { concerns: widePlanConcerns() },
    root_overflow: 'stop',
  });
  assert.equal(ready(state, 'root_overflow').length, 1);
  assert.ok(stages(state).includes('observe'));
  assert.equal(ready(state, 'synthesis').length, 0, 'synthesis waits for root overflow');
});

test('root synthesis cannot be skipped by returning every worker', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { synthesis: 'stop' });
  assert.equal(ready(state, 'synthesis').length, 1);
  assert.ok(stages(state).includes('synthesis'));
  assert.throws(
    () => applyDrafts(state, [recordWaiver(state, { stage: 'synthesis', reason: 'x', user_consent: 'y' })], ctx),
    /only these stages can be waived/
  );
});

test('a triggered security gate makes the specialist mandatory and controller-owned', () => {
  const ctx = fakeContext({ security: true });
  let state = startSession(ctx);
  const route = ready(state, 'route')[0];
  assert.deepEqual(route.spec.required_concerns, ['security']);
  state = drive(state, ctx, { security_specialist: (current, task) => block(current, task, ctx) });
  const specialist = state.order.map((id) => state.tasks[id]).find((task) => task.role === 'security_specialist');
  assert.equal(specialist.status, 'blocked');
  assert.ok(stages(state).includes('observe'));
  assert.equal(deriveStageLedger(state).security.gate_triggered, true);
  assert.equal(deriveStageLedger(state).security.specialist_ran, false);
});

test('a route result cannot flip the security trigger or omit an always-on concern', () => {
  const ctx = fakeContext({ security: true });
  const state = startSession(ctx);
  const route = ready(state, 'route')[0];
  const withoutSecurity = routeResult(state, { concerns: ALWAYS_ON.slice(1).map((id) => ({ id, context: [] })) });
  assert.throws(() => submit(state, route, withoutSecurity, ctx), /always-on concern security must be routed/);
  const withSpecialistFlag = routeResult(state);
  withSpecialistFlag.concerns[0].specialist = 'none';
  assert.throws(() => submit(state, route, withSpecialistFlag, ctx), /unknown field specialist/);
});

test('every changed file must be mapped or carry an explicit gap', () => {
  const ctx = fakeContext({ files: ['src/a.ts', 'src/b.ts'] });
  const state = startSession(ctx);
  const route = ready(state, 'route')[0];
  const partial = routeResult(state, {
    file_coverage: [{ path: 'src/a.ts', concern_ids: ['security'], reason: 'changed code' }],
  });
  assert.throws(() => submit(state, route, partial, ctx), /does not account for 1 changed file\(s\): src\/b\.ts/);
  const gap = routeResult(state, {
    file_coverage: [
      { path: 'src/a.ts', concern_ids: ['security'], reason: 'changed code' },
      { path: 'src/b.ts', gap: 'generated file' },
    ],
  });
  assert.equal(submit(state, route, gap, ctx).tasks[route.id].status, 'completed');
});

test('contract gates run in the controller and unselected gates become root obligations', () => {
  const ctx = fakeContext({ contract: { 'context-engine': true, 'interactive-engine': true } });
  const concerns = [...ALWAYS_ON, 'context-engine', 'interactive-engine'].map((id) => ({
    id,
    context: [{ path: 'src/a.ts', excerpt: 'x' }],
  }));
  let state = drive(startSession(ctx), ctx, { routeOverrides: { concerns }, contract_scan: 'stop' });
  const scan = ready(state, 'contract_scan')[0];
  assert.deepEqual(
    scan.spec.concerns.map(({ concern_id }) => concern_id),
    ['context-engine', 'interactive-engine']
  );
  assert.equal(state.plan, null, 'the planner waits for the contract scan');
  state = drive(state, ctx, { root_overflow: 'stop', contract_specialist: 'stop' });
  const specialist = ready(state, 'contract_specialist')[0];
  const overflow = ready(state, 'root_overflow')[0];
  assert.deepEqual(specialist.concern_ids, ['contract-evolution:context-engine']);
  assert.ok(overflow.concern_ids.includes('contract-evolution:interactive-engine'));
  assert.throws(
    () => submit(state, overflow, { no_findings: [] }, ctx),
    /does not account for contract-evolution:interactive-engine/
  );
  const answered = submit(
    state,
    overflow,
    {
      no_findings: overflow.concern_ids
        .filter((id) => !id.startsWith('contract-evolution:'))
        .map((concern_id) => ({ concern_id, status: 'no_findings', reason: 'reviewed_clean' })),
      contract_packets: [cleanPacket('interactive-engine')],
    },
    ctx
  );
  assert.equal(answered.tasks[overflow.id].status, 'completed');
});

test('a contract anchor claim needs anchor evidence and two consumers', () => {
  const ctx = fakeContext();
  const concerns = [...ALWAYS_ON, 'context-engine'].map((id) => ({ id, context: [] }));
  const state = drive(startSession(ctx), ctx, { routeOverrides: { concerns }, contract_scan: 'stop' });
  const scan = ready(state, 'contract_scan')[0];
  const claim = { concern_id: 'context-engine', touches_anchor_with_consumers: true, consumers: ['one'], context: [] };
  assert.throws(() => submit(state, scan, { gates: [claim] }, ctx), /at least two current consumers/);
  const supported = {
    ...claim,
    consumers: ['src/x.ts', 'src/y.ts'],
    anchor_evidence: ['CONCERN_DETAILS anchor'],
    context: [{ path: 'src/context-engine/a.ts', excerpt: 'x' }],
  };
  const next = submit(state, scan, { gates: [supported] }, ctx);
  assert.equal(
    next.plan.plan.workers.find(({ kind }) => kind === 'contract_evolution')?.concern_ids[0],
    'context-engine'
  );
});

test('a high defect needs two skeptics on distinct agents and a tiebreaker on disagreement', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { additions: [observation()], skeptic: 'stop' });
  const [first, second] = ready(state, 'skeptic');
  assert.deepEqual([first.spec.independent_role, second.spec.independent_role], [1, 2]);
  const verdict = (value) => ({ verdicts: [{ finding_id: 'lost-write', verdict: value, reason: 'checked' }] });
  state = submit(state, first, verdict('confirmed'), ctx, { agent_id: 'agent-a' });
  assert.throws(() => submit(state, second, verdict('refuted'), ctx, { agent_id: 'agent-a' }), /different agents/);
  state = submit(state, second, verdict('refuted'), ctx, { agent_id: 'agent-b' });
  const [tiebreaker] = ready(state, 'skeptic');
  assert.equal(tiebreaker.spec.verification_role, 'tiebreaker');
  assert.ok(stages(state).includes('verify'));
  assert.throws(() => submit(state, tiebreaker, verdict('refuted'), ctx, { agent_id: 'agent-b' }), /different agents/);
  state = submit(state, tiebreaker, verdict('refuted'), ctx, { agent_id: 'agent-c' });
  assert.equal(state.policy['lost-write'].status, 'dropped');
  assert.deepEqual(obligations(state), []);
});

test('a skeptic without a host identity is recorded but surfaced as unverified', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { additions: [observation()], skeptic: 'stop' });
  const [first] = ready(state, 'skeptic');
  const verdict = { verdicts: [{ finding_id: 'lost-write', verdict: 'confirmed', reason: 'checked' }] };
  assert.throws(() => submit(state, first, verdict, ctx, { agent_id: null }), /--agent-id/);
  state = submit(state, first, verdict, ctx, { agent_id: null, host_capability: 'no_agent_identity' });
  assert.equal(state.tasks[first.id].receipt.provenance, 'unverified_identity');
});

test('a blocker cannot be omitted or downgraded by an author-facing field', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { synthesis: 'stop' });
  const synthesis = ready(state, 'synthesis')[0];
  assert.throws(
    () =>
      submit(
        state,
        synthesis,
        { merges: [], revisions: [], additions: [], dispositions: { 'lost-write': 'nit' } },
        ctx
      ),
    /unknown field dispositions/
  );
  assert.throws(
    () => submit(state, synthesis, { additions: [{ ...observation(), disposition: 'nit' }] }, ctx),
    /Unknown observation field: disposition/
  );
  state = drive(state, ctx, { additions: [observation()] });
  const { report } = renderSession(state);
  assert.deepEqual(
    report.findings.map(({ id, disposition }) => ({ id, disposition })),
    [{ id: 'lost-write', disposition: 'blocking' }]
  );
});

test('synthesis must account for duplicate finding ids', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, {
    observer: (current, task) =>
      submit(
        current,
        task,
        {
          observations: [observation(), observation({ concern_id: 'security', title: 'Same invariant, other worker' })],
          no_findings: task.concern_ids
            .filter((id) => !['correctness-and-reliability', 'security'].includes(id))
            .map((concern_id) => ({ concern_id, status: 'no_findings', reason: 'reviewed_clean' })),
        },
        ctx
      ),
    synthesis: 'stop',
  });
  const synthesis = ready(state, 'synthesis')[0];
  assert.deepEqual(synthesis.spec.refs, ['o001', 'o002']);
  assert.throws(
    () => submit(state, synthesis, { merges: [], revisions: [], additions: [] }, ctx),
    /finding_id lost-write/
  );
  const merged = submit(state, synthesis, { merges: [{ ref: 'o002', into: 'o001', reason: 'same invariant' }] }, ctx);
  assert.equal(merged.observations.o002.merged_into, 'o001');
  assert.equal(merged.admitted.length, 1);
});

test('an observer must account for each owned concern and may not claim others', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { observer: 'stop' });
  const [worker] = ready(state, 'observer');
  assert.throws(() => submit(state, worker, { no_findings: [] }, ctx), /does not account for/);
  assert.throws(
    () => submit(state, worker, { observations: [observation({ concern_id: 'context-engine' })] }, ctx),
    /does not own/
  );
});

test('wrong-head, unknown-task, and conflicting results are rejected; identical replay is idempotent', () => {
  const ctx = fakeContext();
  const state = startSession(ctx);
  const route = ready(state, 'route')[0];
  const result = routeResult(state);
  assert.throws(
    () => recordResult(state, { task_id: route.id, head: 'd'.repeat(40), result, receipt: {} }),
    /new head needs a new session/
  );
  assert.throws(
    () => recordResult(state, { task_id: 't999-route', head: HEAD, result, receipt: {} }),
    /does not exist/
  );
  const after = submit(state, route, result, ctx);
  assert.deepEqual(recordResult(after, { task_id: route.id, head: HEAD, result, receipt: {} }).output, {
    task_id: route.id,
    status: 'already_recorded',
  });
  assert.throws(
    () =>
      recordResult(after, { task_id: route.id, head: HEAD, result: { ...result, change_class: 'mixed' }, receipt: {} }),
    /--revise/
  );
  assert.throws(
    () =>
      recordResult(after, {
        task_id: route.id,
        head: HEAD,
        result: { ...result, change_class: 'mixed' },
        receipt: {},
        revise_reason: 'reclassified',
      }),
    /consumed downstream/
  );
});

test('an unconsumed observer result can be revised, superseding its observations', () => {
  const ctx = fakeContext({ files: ['src/a.ts'] });
  const concerns = widePlanConcerns();
  let state = drive(startSession(ctx), ctx, {
    routeOverrides: { concerns, file_coverage: [{ path: 'src/a.ts', concern_ids: ['security'], reason: 'x' }] },
    observer: 'stop',
  });
  const [worker] = ready(state, 'observer');
  const owned = (extra) => ({
    observations: [observation({ concern_id: worker.concern_ids[0], ...extra })],
    no_findings: worker.concern_ids
      .slice(1)
      .map((concern_id) => ({ concern_id, status: 'no_findings', reason: 'reviewed_clean' })),
  });
  state = submit(state, worker, owned({}), ctx);
  const revision = recordResult(state, {
    task_id: worker.id,
    head: HEAD,
    result: owned({ severity: 'medium' }),
    receipt: { agent_id: `agent-${worker.id}` },
    revise_reason: 'worker corrected severity',
  });
  state = applyDrafts(state, [revision.draft], ctx);
  const live = state.observation_order.filter((ref) => !state.observations[ref].superseded);
  assert.equal(live.length, 1);
  assert.equal(state.observations[live[0]].observation.severity, 'medium');
  assert.equal(state.tasks[worker.id].history.length, 1);
});

test('a failed check needs an evidence-backed resolution, and a passing baseline rejects the baseline claim', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  const unitTests = ready(state, 'command').find(({ spec }) => spec.name === 'unit_tests');
  state = completeCommand(state, unitTests, ctx, { exit_status: 1 });
  const [resolution] = ready(state, 'check_resolution');
  assert.deepEqual(resolution.spec.allowed, ['observation', 'baseline_failure', 'environment']);
  state = submit(state, resolution, BASELINE_CLAIM, ctx);
  const baseline = ready(state, 'command').find(({ spec }) => spec.kind === 'baseline');
  assert.equal(baseline.spec.at, 'base');
  assert.equal(baseline.spec.signature, BASELINE_CLAIM.signature);
  state = completeCommand(state, baseline, ctx, {
    exit_status: 0,
    match: { matched: false, reason: 'the same command passes at the base commit' },
  });
  const [retry] = ready(state, 'check_resolution');
  assert.deepEqual(retry.spec.allowed, ['observation', 'environment']);
  assert.throws(() => submit(state, retry, { resolution: 'baseline_failure', reason: 'again' }, ctx), /must be one of/);
  state = submit(state, retry, { resolution: 'environment', reason: 'flaky runner' }, ctx);
  state = drive(state, ctx);
  assert.ok(obligations(state).some(({ message }) => /attributed to the environment/.test(message)));
  assert.equal(deriveStageLedger(state).checks.find(({ name }) => name === 'unit_tests').status, 'fail');
});

test('a verified baseline failure resolves a failed check without inventing a PR defect', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  const lint = ready(state, 'command').find(({ spec }) => spec.name === 'lint');
  state = completeCommand(state, lint, ctx, { exit_status: 1 });
  state = submit(state, ready(state, 'check_resolution')[0], BASELINE_CLAIM, ctx);
  state = completeCommand(
    state,
    ready(state, 'command').find(({ spec }) => spec.kind === 'baseline'),
    ctx,
    {
      exit_status: 1,
      match: { matched: true, reason: null },
    }
  );
  state = drive(state, ctx);
  assert.deepEqual(obligations(state), []);
  assert.equal(renderSession(state).report.findings.length, 0);
});

test('a baseline that fails differently from the head never clears the check or approves the PR', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  const unitTests = ready(state, 'command').find(({ spec }) => spec.name === 'unit_tests');
  state = completeCommand(state, unitTests, ctx, { exit_status: 1, failure_kind: 'assertion' });
  state = submit(state, ready(state, 'check_resolution')[0], BASELINE_CLAIM, ctx);
  state = completeCommand(
    state,
    ready(state, 'command').find(({ spec }) => spec.kind === 'baseline'),
    ctx,
    {
      exit_status: 1,
      failure_kind: 'setup',
      match: { matched: false, reason: 'the head failed with a assertion failure but the base with a setup failure' },
    }
  );
  state = drive(state, ctx, { check_resolution: 'stop' });
  const [retry] = ready(state, 'check_resolution');
  assert.deepEqual(retry.spec.allowed, ['observation', 'environment']);
  assert.match(retry.spec.rejected_baseline.reason, /setup failure/);
  assert.ok(obligations(state).some(({ message }) => /t\d+-command-unit-tests failed/.test(message)));
  assert.doesNotMatch(renderSession(state).rendered, /Verdict: Approve/);
});

test('a baseline claim must name a failure signature and preserve only changed files', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  state = completeCommand(
    state,
    ready(state, 'command').find(({ spec }) => spec.name === 'lint'),
    ctx,
    { exit_status: 1 }
  );
  const [resolution] = ready(state, 'check_resolution');
  assert.throws(() => submit(state, resolution, { resolution: 'baseline_failure', reason: 'x' }, ctx), /signature/);
  assert.throws(() => submit(state, resolution, { ...BASELINE_CLAIM, signature: 'short' }, ctx), /at least 8/);
  assert.throws(
    () => submit(state, resolution, { ...BASELINE_CLAIM, preserve_paths: ['src/elsewhere.test.ts'] }, ctx),
    /is not a changed file/
  );
  assert.throws(
    () => submit(state, resolution, { ...BASELINE_CLAIM, preserve_paths: ['src/a.ts'] }, ctx),
    /not a test file or fixture; the baseline keeps the base implementation/
  );
  assert.throws(
    () => submit(state, resolution, { ...BASELINE_CLAIM, preserve_reason: undefined }, ctx),
    /preserve_reason/
  );
});

test('a check failure attributed to the PR becomes a canonical observation through policy', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  const typecheck = ready(state, 'command').find(({ spec }) => spec.name === 'typecheck');
  state = completeCommand(state, typecheck, ctx, { exit_status: 2 });
  state = submit(
    state,
    ready(state, 'check_resolution')[0],
    { resolution: 'observation', observation: observation({ finding_id: 'typecheck-break', severity: 'low' }) },
    ctx
  );
  state = drive(state, ctx);
  assert.equal(state.policy['typecheck-break'].decision.disposition, 'blocking');
});

test('an efficacy worktree that is not cleaned up is an open obligation', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { command: 'stop' });
  for (const command of ready(state, 'command')) {
    const evidence =
      command.spec.kind === 'efficacy' ? { exit_status: 1, cleanup: { removed: false, path: '/tmp/x' } } : {};
    state = completeCommand(state, command, ctx, evidence);
  }
  state = drive(state, ctx);
  assert.ok(obligations(state).some(({ message }) => /left its disposable worktree/.test(message)));
});

test('a waiver covers only its named obligation and is recorded on the ledger', () => {
  const ctx = fakeContext();
  let state = drive(startSession(ctx), ctx, { observer: (current, task) => block(current, task, ctx) });
  assert.ok(stages(state).includes('observe'));
  state = waive(state, 'workers', ctx);
  state = drive(state, ctx);
  assert.deepEqual(obligations(state), []);
  const { rendered } = renderSession(state);
  assert.match(rendered, /Skipped with user consent: workers \(user asked\)/);
});

test('a skipped check with not_applicable needs consent for a behavior change', () => {
  const ctx = fakeContext();
  const plan = {
    ...EVIDENCE_PLAN,
    checks: [
      EVIDENCE_PLAN.checks[0],
      EVIDENCE_PLAN.checks[1],
      { name: 'lint', status: 'not_applicable', reason: 'no lint' },
    ],
  };
  let state = drive(startSession(ctx), ctx, { evidencePlan: plan });
  assert.ok(
    obligations(state).some(({ stage, message }) => stage === 'ledger' && /lint cannot be not_applicable/.test(message))
  );
  state = waive(state, 'lint', ctx);
  assert.deepEqual(obligations(state), []);
});

test('evidence commands accept only argument arrays for known executables', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx, { evidence_plan: 'stop' });
  const plan = ready(state, 'evidence_plan')[0];
  const shell = {
    ...EVIDENCE_PLAN,
    checks: [{ name: 'unit_tests', argv: ['bash', '-c', 'npm test'] }, ...EVIDENCE_PLAN.checks.slice(1)],
  };
  assert.throws(() => submit(state, plan, shell, ctx), /must be one of npm, npx, node, go, mage/);
  const escape = { ...EVIDENCE_PLAN, efficacy: [{ ...EVIDENCE_PLAN.efficacy[0], revert_paths: ['../etc/passwd'] }] };
  assert.throws(() => submit(state, plan, escape, ctx), /without \.\. segments/);
  const unrelated = { ...EVIDENCE_PLAN, efficacy: [{ ...EVIDENCE_PLAN.efficacy[0], revert_paths: ['src/other.ts'] }] };
  assert.throws(() => submit(state, plan, unrelated, ctx), /is not a changed file/);
});

function priorReview({ blocking = [], deferred = [], round = 1, head = PRIOR_HEAD, truncated = false } = {}) {
  const findings = [
    ...blocking.map((id) => ({
      id,
      concern_id: 'correctness-and-reliability',
      disposition: 'blocking',
      severity: 'high',
      title: 't',
      problem: 'p',
      suggested_action: 'a',
    })),
    ...deferred.map((id) => ({
      id,
      concern_id: 'testing-and-verification',
      disposition: 'follow_up',
      severity: 'low',
      title: 't',
      problem: 'p',
      suggested_action: 'a',
    })),
  ];
  const body = renderReviewReport({
    pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/42',
    pr_title: 'fix: x',
    reviewed_head: head,
    round,
    findings,
    deferred: deferred.map((id) => ({ id, concern_id: 'testing-and-verification' })),
    cleared: [],
    stage_ledger: {
      mode: 'full',
      change_class: 'tests-only',
      surfaces: { go: false },
      workers: { planned: 1, run: 1 },
      skeptic_batches: { required: 0, run: 0 },
      observations: { total: 0, through_policy: 0 },
      security: { gate_triggered: false, specialist_ran: false },
      checks: [
        { name: 'unit_tests', status: 'pass', command: 'x' },
        { name: 'typecheck', status: 'pass', command: 'x' },
        { name: 'lint', status: 'pass', command: 'x' },
      ],
      efficacy: [],
      skipped: [],
    },
  });
  if (!truncated) {
    return body;
  }
  return body.replace(
    /<!-- pathfinder-review-state:.*-->/,
    `<!-- pathfinder-review-state:${JSON.stringify({ version: 2, round, reviewed_head: head, blocking_findings: [], deferred: [], cleared: [], truncated: true })} -->`
  );
}

test('a valid same-reviewer prior state starts an incremental round that verifies prior work first', () => {
  const ctx = fakeContext();
  const prior = {
    body: priorReview({ blocking: ['lost-write'], deferred: ['add-test'], round: 2 }),
    author: 'reviewer-bot',
    count: 2,
  };
  let state = startSession(ctx, { prior });
  assert.equal(state.identity.mode, 'incremental');
  assert.equal(state.identity.round, 3);
  assert.deepEqual(state.scope.range, { from: PRIOR_HEAD, to: HEAD });
  assert.equal(ready(state, 'route').length, 0, 'routing waits for the prior check');
  const check = ready(state, 'prior_check')[0];
  const unresolved = {
    items: [
      {
        id: 'lost-write',
        concern_id: 'correctness-and-reliability',
        kind: 'blocking',
        status: 'unresolved',
        evidence: ['still overwrites'],
      },
      {
        id: 'add-test',
        concern_id: 'testing-and-verification',
        kind: 'deferred',
        status: 'fixed',
        evidence: ['test added'],
      },
    ],
  };
  assert.throws(() => submit(state, check, unresolved, ctx), /must be restated as a canonical observation/);
  state = submit(state, check, { ...unresolved, observations: [observation({ timing: 'prior_unresolved' })] }, ctx);
  const route = ready(state, 'route')[0];
  assert.deepEqual(route.spec.required_concerns, ['correctness-and-reliability']);
  state = drive(state, ctx, {
    routeOverrides: {
      concerns: [{ id: 'correctness-and-reliability', context: [{ path: 'src/a.ts', excerpt: 'x' }] }],
      concern_gaps: ALWAYS_ON.filter((id) => id !== 'correctness-and-reliability').map((id) => ({
        id,
        reason: 'untouched',
      })),
    },
  });
  assert.deepEqual(obligations(state), []);
  assert.deepEqual(state.reconciliation.input.verified_fixed_ids, ['add-test']);
  assert.equal(state.policy['lost-write'].decision.disposition, 'blocking');
  assert.match(renderSession(state).rendered, /"round":3/);
  assert.deepEqual(sessionStatus(state).convergence, []);
});

test('invalid, truncated, foreign, and non-ancestor prior state each fall back to a full review', () => {
  const ctx = fakeContext();
  const cases = [
    [{ body: 'no marker here', author: 'reviewer-bot', count: 1 }, 'no valid trailing state marker', 2],
    [{ body: priorReview({ round: 4, truncated: true }), author: 'reviewer-bot', count: 4 }, 'truncated', 5],
    [{ body: priorReview({ round: 2 }), author: 'someone-else', count: 3 }, 'another reviewer', 4],
  ];
  for (const [prior, reason, round] of cases) {
    const state = startSession(ctx, { prior });
    assert.equal(state.identity.mode, 'full');
    assert.match(state.identity.prior.fallback_reason, new RegExp(reason));
    assert.equal(state.identity.round, round);
    assert.equal(state.identity.prior.state, null, 'a full fallback carries no suppressive state');
  }
  const detached = startSession(fakeContext({ ancestor: false }), {
    prior: { body: priorReview({ round: 1 }), author: 'reviewer-bot', count: 1 },
  });
  assert.equal(detached.identity.mode, 'full');
  assert.match(detached.identity.prior.fallback_reason, /not an ancestor/);
});

const POLICY_CASES = [
  ['two confirmations of a high defect', observation(), [['confirmed', 'confirmed']]],
  [
    'uncertain plus confirmed needs a tiebreaker that stays established',
    observation(),
    [['uncertain', 'confirmed'], ['uncertain']],
  ],
  ['two uncertain votes keep the defect', observation(), [['uncertain', 'uncertain'], ['refuted']]],
  [
    'late timing outranks a one-way door',
    observation({ timing: 'late', reversibility: 'irreversible_without_cleanup', severity: 'medium' }),
    [['refuted'], ['uncertain']],
  ],
  [
    'a medium defect adjudicated as refuted drops',
    observation({ severity: 'medium', impact: 'none' }),
    [['uncertain'], ['refuted']],
  ],
  [
    'an optional suggestion passes without verification',
    observation({ kind: 'suggestion', severity: 'low', impact: 'none' }),
    [],
  ],
];

for (const [name, observed, rounds] of POLICY_CASES) {
  test(`shared-policy parity: ${name}`, () => {
    const ctx = fakeContext();
    let state = drive(startSession(ctx), ctx, { additions: [observed], skeptic: 'stop' });
    const direct = [];
    for (const votes of rounds) {
      const batch = ready(state, 'skeptic');
      assert.equal(batch.length, votes.length, `${name}: the controller asks for exactly the facade's verdict count`);
      batch.forEach((task, index) => {
        state = submit(
          state,
          task,
          { verdicts: [{ finding_id: observed.finding_id, verdict: votes[index], reason: 'checked evidence' }] },
          ctx
        );
        direct.push({ verdict: votes[index], reason: 'checked evidence' });
      });
    }
    state = drive(state, ctx);
    const expected = advanceReviewPolicy({ observation: observed, verdicts: direct, round: 1 });
    const { observation: _ignored, ...expectedResult } = expected;
    assert.deepEqual(state.policy[observed.finding_id], expectedResult);
    assert.deepEqual(obligations(state), []);
  });
}

test('round three drops new optional work exactly as the facade does', () => {
  const ctx = fakeContext();
  const prior = { body: priorReview({ round: 2 }), author: 'reviewer-bot', count: 2 };
  const optional = observation({ kind: 'nit', severity: 'low', impact: 'none' });
  const state = drive(startSession(ctx, { prior }), ctx, {
    routeOverrides: {
      concerns: [{ id: 'correctness-and-reliability', context: [] }],
      concern_gaps: ALWAYS_ON.filter((id) => id !== 'correctness-and-reliability').map((id) => ({
        id,
        reason: 'untouched',
      })),
    },
    additions: [optional],
  });
  assert.equal(state.identity.round, 3);
  assert.deepEqual(state.policy[optional.finding_id], { status: 'dropped', reason: 'round-three-optional' });
});

test('a prior blocker restated without a verified fix but disposed as non-blocking is flagged', () => {
  const ctx = fakeContext();
  const prior = { body: priorReview({ blocking: ['lost-write'], round: 1 }), author: 'reviewer-bot', count: 1 };
  let state = startSession(ctx, { prior });
  const check = ready(state, 'prior_check')[0];
  state = submit(
    state,
    check,
    {
      items: [
        {
          id: 'lost-write',
          concern_id: 'correctness-and-reliability',
          kind: 'blocking',
          status: 'unresolved',
          evidence: ['unchanged'],
        },
      ],
      observations: [observation({ timing: 'prior_unresolved', severity: 'low', impact: 'none' })],
    },
    ctx
  );
  state = drive(state, ctx, {
    routeOverrides: {
      concerns: [{ id: 'correctness-and-reliability', context: [] }],
      concern_gaps: ALWAYS_ON.filter((id) => id !== 'correctness-and-reliability').map((id) => ({
        id,
        reason: 'untouched',
      })),
    },
  });
  assert.equal(state.policy['lost-write'].decision.disposition, 'follow_up');
  assert.match(
    sessionStatus(state).convergence[0],
    /prior blocker lost-write .* was not verified fixed but is now follow_up \(no-current-harm\)/
  );
});

const GO_FILES = ['pkg/plugin/app.go', 'pkg/plugin/app_test.go', 'src/a.ts'];

function commandArgv(state, name) {
  return state.order
    .map((id) => state.tasks[id])
    .filter((task) => task.role === 'command' && task.spec.kind === 'check' && task.spec.name === name)
    .map((task) => task.spec.argv);
}

test('a Go change adds go build, Go lint, and Go tests to the controller-run evidence plan', () => {
  const ctx = fakeContext({ files: GO_FILES });
  const state = drive(startSession(ctx), ctx);
  assert.deepEqual(state.scope.surfaces.go_paths, ['pkg/plugin/app.go', 'pkg/plugin/app_test.go']);
  assert.equal(state.tasks[state.order.find((id) => state.tasks[id].role === 'evidence_plan')].spec.surfaces.go, true);
  assert.deepEqual(commandArgv(state, 'go_build'), [['go', 'build', './...']]);
  assert.deepEqual(commandArgv(state, 'go_lint'), [['npm', 'run', 'lint:go']]);
  assert.deepEqual(commandArgv(state, 'go_test'), [['go', 'test', './pkg/...']]);
  assert.deepEqual(obligations(state), []);
  assert.deepEqual(deriveStageLedger(state).surfaces, { go: true });
  assert.match(
    renderSession(state).rendered,
    /^Checks: unit_tests pass, typecheck pass, lint pass, go_build pass, go_lint pass, go_test pass · /m
  );
});

test('a planned Go check keeps its argv, and a Go check cannot be not_applicable when Go changed', () => {
  const ctx = fakeContext({ files: GO_FILES });
  const state = drive(startSession(ctx), ctx, { evidence_plan: 'stop' });
  const plan = ready(state, 'evidence_plan')[0];
  const skipLint = {
    ...EVIDENCE_PLAN,
    checks: [...EVIDENCE_PLAN.checks, { name: 'go_lint', status: 'not_applicable', reason: 'no linter' }],
  };
  assert.throws(() => submit(state, plan, skipLint, ctx), /go_lint cannot be not_applicable when Go changed/);
  const custom = {
    ...EVIDENCE_PLAN,
    checks: [...EVIDENCE_PLAN.checks, { name: 'go_test', argv: ['npm', 'run', 'test:go'] }],
  };
  const next = submit(state, plan, custom, ctx);
  assert.deepEqual(commandArgv(next, 'go_test'), [['npm', 'run', 'test:go']]);
});

test('without a Go change no Go check runs and the ledger records go false', () => {
  const ctx = fakeContext();
  const state = drive(startSession(ctx), ctx);
  assert.deepEqual(commandArgv(state, 'go_build'), []);
  assert.deepEqual(deriveStageLedger(state).surfaces, { go: false });
});

function withEfficacy(ctx, evidence, answers = {}) {
  let state = drive(startSession(ctx), ctx, { command: 'stop', ...answers });
  for (const command of ready(state, 'command')) {
    state = completeCommand(state, command, ctx, command.spec.kind === 'efficacy' ? evidence : {});
  }
  return drive(state, ctx, answers);
}

test('a setup failure on revert is never rendered as a test that detects the regression', () => {
  const ctx = fakeContext();
  const state = withEfficacy(ctx, {
    exit_status: 1,
    failure_kind: 'setup',
    revert: { result: 'inconclusive_setup', evidence: "Cannot find module './guide-health'" },
  });
  assert.deepEqual(obligations(state), []);
  const [entry] = deriveStageLedger(state).efficacy;
  assert.equal(entry.result, 'inconclusive_setup');
  assert.equal(entry.evidence, "Cannot find module './guide-health'");
  assert.match(
    renderSession(state).rendered,
    /revert checks: 0 of 1 fail on behavior · 1 inconclusive \(setup\) · 0 inconclusive \(error\) · 0 pass without fix · 0 no test/
  );
  assert.match(sessionStatus(state).evidence_quality[0], /is inconclusive_setup, so it does not show/);
});

test('a revert run with no recorded classification is inconclusive, not a behavioral failure', () => {
  const ctx = fakeContext();
  const state = withEfficacy(ctx, { exit_status: 1, failure_kind: 'assertion' });
  assert.equal(deriveStageLedger(state).efficacy[0].result, 'inconclusive_error');
});

const GAP_PLAN = {
  ...EVIDENCE_PLAN,
  efficacy: [
    ...EVIDENCE_PLAN.efficacy,
    { behavior: 'pins the cache key', result: 'no_test_exists', reason: 'no unit covers the key' },
  ],
};

test('root synthesis must dispose every missing or surviving test, by finding ID or reason', () => {
  const ctx = fakeContext();
  const state = withEfficacy(
    ctx,
    { exit_status: 0, revert: { result: 'passes_without_fix', evidence: 'the test passed with the fix reverted' } },
    { evidencePlan: GAP_PLAN, synthesis: 'stop' }
  );
  const synthesis = ready(state, 'synthesis')[0];
  assert.deepEqual(
    synthesis.spec.efficacy_gaps.map(({ behavior, result }) => [behavior, result]),
    [
      ['keeps both writes', 'passes_without_fix'],
      ['pins the cache key', 'no_test_exists'],
    ]
  );
  const base = { merges: [], revisions: [], additions: [observation()] };
  assert.throws(() => submit(state, synthesis, base, ctx), /must dispose every no_test_exists and passes_without_fix/);
  const unknown = {
    ...base,
    efficacy_dispositions: [
      { behavior: 'keeps both writes', finding_id: 'not-a-finding' },
      { behavior: 'pins the cache key', reason: 'pinned by the e2e cache test' },
    ],
  };
  assert.throws(() => submit(state, synthesis, unknown, ctx), /names finding not-a-finding, which synthesis does not/);
  const both = { ...base, efficacy_dispositions: [{ behavior: 'keeps both writes', finding_id: 'x', reason: 'y' }] };
  assert.throws(() => submit(state, synthesis, both, ctx), /exactly one of finding_id/);
  const disposed = drive(
    submit(
      state,
      synthesis,
      {
        ...unknown,
        efficacy_dispositions: [
          { ...unknown.efficacy_dispositions[0], finding_id: 'lost-write' },
          unknown.efficacy_dispositions[1],
        ],
      },
      ctx
    ),
    ctx
  );
  assert.deepEqual(obligations(disposed), []);
  assert.deepEqual(
    deriveStageLedger(disposed).efficacy.map(({ disposition_note: note }) => note),
    ['finding lost-write', 'pinned by the e2e cache test']
  );
});
