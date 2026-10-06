import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRunRecord, maskRuns, parseRenderedFindings, scoreRuns, validateCase } from './eval-core.mjs';
import { main } from './eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function manifest(overrides = {}) {
  return {
    case_id: 'case-one',
    repo: 'grafana/grafana-pathfinder-app',
    pr: 1,
    category: 'known-defect',
    base_sha: SHA_A,
    head_sha: SHA_B,
    evidence_cutoff: '2026-10-01T00:00:00Z',
    prior_review: null,
    environment: { node: '24', setup: [['npm', 'ci']] },
    adjudication_status: 'adjudicated',
    ...overrides,
  };
}

const RENDERED = [
  'Blockers:',
  '',
  '1. [blocking] **lost-write — Concurrent removal drops a write** (high · correctness-and-reliability)',
  '   Two tabs lose a completion.',
  '   Required: Merge before writing.',
  '',
  'Suggestions & nits:',
  '',
  '1. [nit] **naming — Rename the helper** (low · cross-cutting-architecture)',
  '   The name hides intent.',
  '   Suggested: Rename it.',
  '',
  'PR Review: https://github.com/grafana/grafana-pathfinder-app/pull/1',
  'Summary: x',
  'Verdict: Request Changes',
  'Results: 1 blocker, 1 non-blocking finding, 0 follow-ups',
].join('\n');

const META = {
  model: 'claude-opus-5-5',
  reasoning: 'default',
  tool_revision: SHA_A,
  started_at: '2026-10-06T10:00:00Z',
  ended_at: '2026-10-06T10:10:00Z',
  tokens: 1000,
};

test('every shipped starter case manifest is valid and carries no answer-key material', () => {
  const cases = readdirSync(join(HERE, 'cases')).filter((name) => name.endsWith('.json'));
  assert.ok(cases.length >= 1);
  for (const name of cases) {
    const parsed = validateCase(JSON.parse(readFileSync(join(HERE, 'cases', name), 'utf8')));
    assert.equal(parsed.adjudication_status, 'unadjudicated', `${name} must not claim adjudication from the repo`);
  }
});

test('a manifest rejects answer-key fields and a prior review after the cutoff', () => {
  assert.throws(() => validateCase(manifest({ known_defects: ['x'] })), /answer-key material belongs outside/);
  assert.throws(
    () =>
      validateCase(
        manifest({ prior_review: { reviewed_head: SHA_A, author: 'r', submitted_at: '2026-10-02T00:00:00Z' } })
      ),
    /after the evidence cutoff/
  );
});

test('rendered findings and the verdict are parsed from renderer output', () => {
  const parsed = parseRenderedFindings(RENDERED);
  assert.equal(parsed.verdict, 'Request Changes');
  assert.deepEqual(
    parsed.findings.map(({ id, disposition, severity, concern_id }) => [id, disposition, severity, concern_id]),
    [
      ['lost-write', 'blocking', 'high', 'correctness-and-reliability'],
      ['naming', 'nit', 'low', 'cross-cutting-architecture'],
    ]
  );
});

test('masking strips the arm and is stable for a seed', () => {
  const run = buildRunRecord({
    caseManifest: manifest(),
    arm: 'review-session',
    runIndex: 1,
    rendered: RENDERED,
    meta: META,
  });
  const first = maskRuns([run], 'private-seed');
  assert.deepEqual(first, maskRuns([run], 'private-seed'));
  assert.ok(first.blinded.every((entry) => !('arm' in entry) && !('finding_id' in entry)));
  assert.equal(first.mapping[0].arm, 'review-session');
  assert.throws(() => maskRuns([run], 'short'), /private seed/);
});

test('scoring reports raw denominators, counts incomplete runs, and excludes unadjudicated cases', () => {
  const runs = [
    buildRunRecord({ caseManifest: manifest(), arm: 'review', runIndex: 1, rendered: RENDERED, meta: META }),
    buildRunRecord({
      caseManifest: manifest(),
      arm: 'review-session',
      runIndex: 1,
      rendered: RENDERED.replace('Verdict: Request Changes', 'Verdict: Review Incomplete'),
      meta: META,
    }),
    buildRunRecord({
      caseManifest: manifest({ case_id: 'case-two' }),
      arm: 'review',
      runIndex: 1,
      rendered: RENDERED,
      meta: META,
    }),
  ];
  const { mapping } = maskRuns(runs, 'private-seed');
  const blind = (arm, findingId) =>
    mapping.find((entry) => entry.case_id === 'case-one' && entry.arm === arm && entry.finding_id === findingId)
      .blind_id;
  const adjudications = [
    {
      blind_id: blind('review', 'lost-write'),
      real: true,
      pr_attributable: true,
      necessary_before_merge: true,
      matches_key_item: 'k1',
      adjudicator: 'm',
      reason: 'r',
    },
    {
      blind_id: blind('review-session', 'lost-write'),
      real: false,
      pr_attributable: false,
      necessary_before_merge: false,
      matches_key_item: null,
      adjudicator: 'm',
      reason: 'r',
    },
  ];
  const keys = {
    'case-one': { items: [{ id: 'k1', kind: 'known_defect', acceptable_dispositions: ['blocking'] }], revisions: [] },
  };
  const cases = [manifest(), manifest({ case_id: 'case-two', adjudication_status: 'unadjudicated' })];
  const report = scoreRuns({ runs, mapping, adjudications, keys, cases });
  assert.deepEqual(report.arms.review.blocker_precision, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms['review-session'].blocker_precision, { numerator: 0, denominator: 1, value: 0 });
  assert.deepEqual(report.arms.review.known_defect_recall, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms['review-session'].incomplete_run_rate, { numerator: 1, denominator: 1, value: 1 });
  assert.equal(report.arms.review.runs, 2, 'unadjudicated runs still count toward run totals');
  assert.equal(report.arms.review.scored_runs, 1);
  assert.deepEqual(report.excluded_unadjudicated, ['case-two']);
  assert.equal(report.arms.review.unadjudicated_findings, 1, 'the unadjudicated nit is visible, not silently scored');
});

test('prepare builds a checkout without refs or commits past the evidence cutoff', () => {
  const source = mkdtempSync(join(tmpdir(), 'eval-source-'));
  const work = mkdtempSync(join(tmpdir(), 'eval-work-'));
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
  const commit = (file, date) => {
    writeFileSync(join(source, file), file);
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', file], {
      cwd: source,
      env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
    });
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    git('config', 'commit.gpgsign', 'false');
    const base = commit('base.txt', '2026-09-01T00:00:00Z');
    const head = commit('head.txt', '2026-09-02T00:00:00Z');
    commit('later-fix.txt', '2026-09-20T00:00:00Z');
    const casePath = join(work, 'case.json');
    writeFileSync(
      casePath,
      JSON.stringify(manifest({ base_sha: base, head_sha: head, evidence_cutoff: '2026-09-10T00:00:00Z' }))
    );
    const out = join(work, 'checkout');
    const result = main(['prepare', '--case', casePath, '--repo-dir', source, '--out', out]);
    assert.equal(result.head, head);
    const log = execFileSync('git', ['log', '--all', '--format=%s'], { cwd: out, encoding: 'utf8' });
    assert.doesNotMatch(log, /later-fix/);
    assert.equal(execFileSync('git', ['for-each-ref'], { cwd: out, encoding: 'utf8' }), '');
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
});
