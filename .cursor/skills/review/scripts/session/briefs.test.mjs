import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { materializeTask } from './briefs.mjs';
import {
  ALWAYS_ON,
  cleanPacket,
  drive,
  fakeContext,
  identityFor,
  observation,
  ready,
  startSession,
  submit,
} from './testing.mjs';

const INTENT = {
  title: 'fix(context-engine): rank by recency',
  body: 'Replaces the scoring contract: recommendations now rank by recency.',
};

function withBriefs(run) {
  const dir = mkdtempSync(join(tmpdir(), 'session-briefs-'));
  try {
    let count = 0;
    return run((state, task, ctx) => {
      count += 1;
      const paths = materializeTask(state, task, join(dir, String(count)), ctx);
      return {
        brief: readFileSync(paths.brief, 'utf8'),
        input: JSON.parse(readFileSync(paths.input, 'utf8')),
        schema: JSON.parse(readFileSync(paths.schema, 'utf8')),
      };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GATED_ROUTE = {
  concerns: [...ALWAYS_ON, 'context-engine'].map((id) => ({ id, context: [{ path: 'src/a.ts', excerpt: 'x' }] })),
};

function gatedSession(intent = INTENT) {
  const ctx = fakeContext({ contract: { 'context-engine': true } });
  const state = drive(startSession(ctx, { intent }), ctx, {
    routeOverrides: GATED_ROUTE,
    contract_specialist: 'stop',
  });
  return { ctx, state };
}

test('the PR intent reaches the route, observer, contract-specialist, and synthesis briefs', () => {
  withBriefs((read) => {
    const ctx = fakeContext();
    const routeState = startSession(ctx, { intent: INTENT });
    assert.deepEqual(routeState.identity.intent, { ...INTENT, evidence_cutoff: null });
    assert.equal(read(routeState, ready(routeState, 'route')[0], ctx).input.pr_intent.body, INTENT.body);
    const { ctx: gatedCtx, state } = gatedSession();
    const specialist = read(state, ready(state, 'contract_specialist')[0], gatedCtx);
    assert.equal(specialist.input.pr_intent.body, INTENT.body);
    assert.match(specialist.brief, /follows, extends, or replaces the established contract/);
    assert.match(specialist.brief, /documentation-drift observation/);
    assert.ok(Array.isArray(specialist.schema.observations));
    const observer = state.order.map((id) => state.tasks[id]).find((task) => task.role === 'observer');
    assert.equal(read(state, observer, gatedCtx).input.pr_intent.title, INTENT.title);
    const atSynthesis = drive(state, gatedCtx, { synthesis: 'stop' });
    const synthesis = read(atSynthesis, ready(atSynthesis, 'synthesis')[0], gatedCtx);
    assert.equal(synthesis.input.pr_intent.body, INTENT.body);
    assert.deepEqual(synthesis.input.efficacy_gaps, []);
    assert.match(synthesis.brief, /Dispose every entry in `efficacy_gaps`/);
  });
});

test('without an intent file the briefs say no PR description was supplied', () => {
  withBriefs((read) => {
    const ctx = fakeContext();
    const state = startSession(ctx);
    const { input } = read(state, ready(state, 'route')[0], ctx);
    assert.equal(input.pr_intent.body, null);
    assert.match(input.pr_intent.note, /No PR description/);
  });
});

test('the contract specialist can return a documentation-drift observation alongside its packet', () => {
  const { ctx, state } = gatedSession();
  const specialist = ready(state, 'contract_specialist')[0];
  const drift = observation({
    finding_id: 'scoring-contract-anchor-stale',
    concern_id: 'context-engine',
    kind: 'defect',
    severity: 'medium',
    title: 'Documentation drift: the scoring contract anchor still describes relevance ranking',
    evidence: ['docs/design/CONCERN_DETAILS.md:120 still names relevance scoring as the contract'],
    impact: 'none',
    applies_to_files: ['docs/design/CONCERN_DETAILS.md'],
  });
  const next = submit(state, specialist, { packet: cleanPacket('context-engine'), observations: [drift] }, ctx);
  const recorded = next.observation_order.map((ref) => next.observations[ref]);
  assert.ok(
    recorded.some(
      ({ source_task, observation: o }) =>
        source_task === specialist.id && o.finding_id === 'scoring-contract-anchor-stale'
    )
  );
});

test('an invalid intent file is rejected at start', () => {
  const ctx = fakeContext();
  assert.throws(
    () => identityFor(ctx, { intent: { title: 'x', body: 'y', labels: [] } }),
    /intent has unknown field labels/
  );
  assert.throws(() => identityFor(ctx, { intent: { title: '', body: '' } }), /intent title/);
  assert.throws(
    () => identityFor(ctx, { intent: { title: 'x', body: '', evidence_cutoff: 'soon' } }),
    /evidence_cutoff must be an ISO date/
  );
});

test('observer and skeptic briefs ask for evidence that fits the claim', () => {
  withBriefs((read) => {
    const ctx = fakeContext();
    const state = drive(startSession(ctx), ctx, { additions: [observation()], skeptic: 'stop' });
    const observer = state.order.map((id) => state.tasks[id]).find((task) => task.role === 'observer');
    const observerBrief = read(state, observer, ctx).brief;
    assert.match(observerBrief, /runtime-dependent or contested claim .* needs executable verification where feasible/);
    assert.match(observerBrief, /file:line from the entry point to the failure/);
    assert.match(observerBrief, /a missing test is not by itself a finding/);
    const skeptic = read(state, ready(state, 'skeptic')[0], ctx).brief;
    assert.match(skeptic, /runtime-dependent or contested claim needs executable verification where feasible/);
    assert.match(skeptic, /scratch/);
    assert.doesNotMatch(skeptic, /refute if/i);
  });
});

test('the dependency audit is asked for only when a dependency manifest changed', () => {
  withBriefs((read) => {
    const specialistBrief = (files) => {
      const ctx = fakeContext({ files, security: true });
      const state = drive(startSession(ctx, { intent: { ...INTENT, evidence_cutoff: '2026-09-30' } }), ctx, {
        security_specialist: 'stop',
      });
      return read(state, ready(state, 'security_specialist')[0], ctx).brief;
    };
    const withManifest = specialistBrief(['package.json', 'src/a.ts']);
    assert.match(withManifest, /Dependency manifests changed: package\.json\. Audit only the packages this PR adds/);
    assert.match(withManifest, /evidence cutoff is 2026-09-30; advisory data dated after it cannot support a finding/);
    assert.doesNotMatch(specialistBrief(['src/a.ts']), /Dependency manifests changed/);
  });
});

test('the evidence-plan brief names the Go checks only when Go changed', () => {
  withBriefs((read) => {
    const planBrief = (files) => {
      const ctx = fakeContext({ files });
      const state = drive(startSession(ctx), ctx, { evidence_plan: 'stop' });
      return read(state, ready(state, 'evidence_plan')[0], ctx).brief;
    };
    assert.match(
      planBrief(['pkg/plugin/app.go']),
      /Go changed \(pkg\/plugin\/app\.go\): go_build, go_lint, and go_test/
    );
    assert.doesNotMatch(planBrief(['src/a.ts']), /go_build/);
  });
});
