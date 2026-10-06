import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

import { DIFF_SHARD_LIMIT, materializeTask } from './briefs.mjs';
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
      return read(state, ready(state, 'security_specialist')[0], ctx);
    };
    const withManifest = specialistBrief(['package.json', 'src/a.ts']);
    assert.match(
      withManifest.brief,
      /Dependency manifests changed, listed in `dependency_manifests` in the input\. Audit only the packages this PR adds/
    );
    assert.doesNotMatch(withManifest.brief, /package\.json/);
    assert.deepEqual(withManifest.input.dependency_manifests, ['package.json']);
    assert.match(
      withManifest.brief,
      /evidence cutoff is 2026-09-30; advisory data dated after it cannot support a finding/
    );
    assert.doesNotMatch(specialistBrief(['src/a.ts']).brief, /Dependency manifests changed/);
    assert.equal(specialistBrief(['src/a.ts']).input.dependency_manifests, undefined);
  });
});

test('the evidence-plan brief names the Go checks only when Go changed', () => {
  withBriefs((read) => {
    const planBrief = (files) => {
      const ctx = fakeContext({ files });
      const state = drive(startSession(ctx), ctx, { evidence_plan: 'stop' });
      return read(state, ready(state, 'evidence_plan')[0], ctx).brief;
    };
    const goBrief = planBrief(['pkg/plugin/app.go']);
    assert.match(
      goBrief,
      /Go changed \(the paths are `surfaces\.go_paths` in the input\): go_build, go_lint, and go_test/
    );
    assert.doesNotMatch(goBrief, /pkg\/plugin\/app\.go/);
    assert.doesNotMatch(planBrief(['src/a.ts']), /go_build/);
  });
});

test('observers carry the same conditional documentation-drift rule as the /review skill', () => {
  const skillRule = readFileSync(join(import.meta.dirname, '../../SKILL.md'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('- Documentation drift: '))
    .slice(2);
  withBriefs((read) => {
    const ctx = fakeContext();
    const state = drive(startSession(ctx), ctx, { additions: [observation()], skeptic: 'stop' });
    const observer = state.order.map((id) => state.tasks[id]).find((task) => task.role === 'observer');
    const text = read(state, observer, ctx).brief;
    assert.ok(text.includes(skillRule), text);
    assert.doesNotMatch(text, /describing the old behavior|Report other stale documentation/);
    const { ctx: gatedCtx, state: gated } = gatedSession();
    const specialist = read(gated, ready(gated, 'contract_specialist')[0], gatedCtx).brief;
    assert.doesNotMatch(specialist, /Report other stale documentation/);
  });
});

const INPUT_BOUND = 20000;

function hugeDiff(path, lines) {
  const body = Array.from({ length: lines }, (_, i) => `+  const value${i} = compute(${i}); // ${'x'.repeat(40)}\n`);
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${lines} @@ function build${lines}()\n${body.join('')}`;
}

function shardedObserver(files, diffs) {
  const dir = mkdtempSync(join(tmpdir(), 'session-shards-'));
  const ctx = fakeContext({ files });
  ctx.effects.diff = (_from, _to, paths) => paths.map((path) => diffs[path] ?? '').join('');
  const state = drive(startSession(ctx), ctx, { additions: [observation()], skeptic: 'stop' });
  const observer = state.order.map((id) => state.tasks[id]).find((task) => task.role === 'observer');
  const paths = materializeTask(state, observer, join(dir, 'session'), ctx);
  return { dir, paths, observer, state };
}

test('a large owned diff is written as bounded per-file shards with a manifest covering every changed file', () => {
  const diffs = {
    'src/big.ts': hugeDiff('src/big.ts', 1500),
    'src/small.ts': hugeDiff('src/small.ts', 20),
    'src/a.test.ts': hugeDiff('src/a.test.ts', 600),
    'src/a.ts': '',
  };
  const files = Object.keys(diffs);
  const { dir, paths } = shardedObserver(files, diffs);
  try {
    const raw = readFileSync(paths.input, 'utf8');
    assert.ok(raw.length < INPUT_BOUND, `input.json is ${raw.length} characters`);
    const input = JSON.parse(raw);
    assert.equal(input.diff, undefined);
    const manifest = input.diff_manifest;
    assert.deepEqual([...new Set(manifest.map(({ path }) => path))].sort(), [...input.changed_files].sort());
    assert.deepEqual([...input.changed_files].sort(), [...files].sort());
    assert.deepEqual(
      manifest.filter(({ path }) => path === 'src/a.ts'),
      [{ path: 'src/a.ts', shard: null, characters: 0, changed_functions: [] }]
    );
    for (const path of files.filter((path) => diffs[path])) {
      const entries = manifest.filter((entry) => entry.path === path);
      const contents = entries.map(({ shard }) => readFileSync(shard, 'utf8'));
      for (const [i, content] of contents.entries()) {
        assert.ok(content.length <= DIFF_SHARD_LIMIT, `${entries[i].shard} is ${content.length} characters`);
        assert.equal(entries[i].characters, content.length);
      }
      assert.equal(contents.join(''), diffs[path]);
    }
    const big = manifest.filter(({ path }) => path === 'src/big.ts');
    assert.ok(big.length > 1);
    assert.deepEqual(
      big.map(({ part, parts }) => [part, parts]),
      big.map((_, i) => [i + 1, big.length])
    );
    assert.deepEqual(big[0].changed_functions, ['function build1500()']);
    assert.match(readFileSync(paths.brief, 'utf8'), /Read every shard in full/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('contributor-controlled filenames cannot place a diff shard outside the task directory', () => {
  const files = [
    'src/a.ts',
    '../../escape.ts',
    '/etc/passwd',
    'src/../../../x.ts',
    '..',
    'a\nb $(rm -rf).ts',
    '.hidden',
  ];
  const diffs = Object.fromEntries(files.slice(1).map((path) => [path, `diff --git a/x b/x\n+${path}\n`]));
  const { dir, paths } = shardedObserver(files, diffs);
  try {
    const shardDir = join(paths.dir, 'diff');
    const written = readdirSync(shardDir);
    const { diff_manifest: manifest } = JSON.parse(readFileSync(paths.input, 'utf8'));
    assert.equal(manifest.length, files.length);
    for (const { path, shard } of manifest.filter(({ path }) => path !== 'src/a.ts')) {
      assert.equal(dirname(shard), shardDir);
      assert.match(basename(shard), /^\d{3}-[A-Za-z0-9._-]+\.diff$/);
      assert.ok(written.includes(basename(shard)));
      assert.equal(readFileSync(shard, 'utf8'), diffs[path]);
    }
    assert.equal(written.length, files.length - 1);
    assert.deepEqual(readdirSync(dir), ['session']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
