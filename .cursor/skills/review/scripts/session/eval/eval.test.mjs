import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderReviewReport } from '../../review-report.mjs';
import { parseRenderedReview } from '../rendered.mjs';
import { buildRunRecord, maskRuns, scoreRuns, validateCase } from './eval-core.mjs';
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

function renderFor({ head = SHA_B, pr = 1, round = 1, findings = FINDINGS, incomplete = false } = {}) {
  return renderReviewReport({
    pr_url: `https://github.com/grafana/grafana-pathfinder-app/pull/${pr}`,
    pr_title: 'fix: x',
    reviewed_head: head,
    round,
    findings,
    deferred: [],
    cleared: [],
    ...(incomplete
      ? { assessment: { status: 'incomplete', reason: 'route: blocked' } }
      : {
          stage_ledger: {
            mode: 'full',
            change_class: 'tests-only',
            workers: { planned: 1, run: 1 },
            skeptic_batches: { required: 0, run: 0 },
            observations: { total: 0, through_policy: 0 },
            security: { gate_triggered: false, specialist_ran: false },
            checks: ['unit_tests', 'typecheck', 'lint'].map((name) => ({ name, status: 'pass', command: 'x' })),
            efficacy: [],
            skipped: [],
          },
        }),
  });
}

const FINDINGS = [
  {
    id: 'lost-write',
    concern_id: 'correctness-and-reliability',
    disposition: 'blocking',
    severity: 'high',
    title: 'Concurrent removal drops a write',
    problem: 'Two tabs lose a completion.',
    suggested_action: 'Merge before writing.',
  },
  {
    id: 'naming',
    concern_id: 'cross-cutting-architecture',
    disposition: 'nit',
    severity: 'low',
    title: 'Rename the helper',
    problem: 'The name hides intent.',
    suggested_action: 'Rename it.',
  },
];
const RENDERED = renderFor();

const META = {
  model: 'claude-opus-5-5',
  reasoning: 'default',
  tool_revision: SHA_A,
  started_at: '2026-10-06T10:00:00Z',
  ended_at: '2026-10-06T10:10:00Z',
  subagent_tokens: 1000,
  root_tokens: 500,
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
  const parsed = parseRenderedReview(RENDERED);
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

function scenario({ sessionRendered = RENDERED, labels } = {}) {
  const runs = [
    buildRunRecord({ caseManifest: manifest(), arm: 'review', runIndex: 1, rendered: RENDERED, meta: META }),
    buildRunRecord({
      caseManifest: manifest(),
      arm: 'review-session',
      runIndex: 1,
      rendered: sessionRendered,
      meta: META,
    }),
  ];
  const { mapping } = maskRuns(runs, 'private-seed');
  const blind = (arm, findingId) =>
    mapping.find((entry) => entry.arm === arm && entry.finding_id === findingId)?.blind_id;
  const keys = {
    'case-one': { items: [{ id: 'k1', kind: 'known_defect', acceptable_dispositions: ['blocking'] }], revisions: [] },
  };
  const adjudications = labels ?? [
    {
      blind_id: blind('review', 'lost-write'),
      real: true,
      pr_attributable: true,
      necessary_before_merge: true,
      matches_key_item: 'k1',
      adjudicator: 'm',
      reason: 'r',
    },
  ];
  return { runs, mapping, keys, blind, adjudications, cases: [manifest()] };
}

test('scoring reports raw denominators and credits recall only for an acceptable disposition', () => {
  const nitOnly = renderFor({ findings: [{ ...FINDINGS[0], disposition: 'nit' }] });
  const base = scenario({ sessionRendered: nitOnly });
  const adjudications = [
    ...base.adjudications,
    {
      blind_id: base.blind('review-session', 'lost-write'),
      real: true,
      pr_attributable: true,
      necessary_before_merge: true,
      matches_key_item: 'k1',
      adjudicator: 'm',
      reason: 'r',
    },
  ];
  const report = scoreRuns({ ...base, adjudications });
  assert.deepEqual(report.arms.review.blocker_precision, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms.review.known_defect_disposition_recall, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms['review-session'].known_defect_recall, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms['review-session'].known_defect_disposition_recall, {
    numerator: 0,
    denominator: 1,
    value: 0,
  });
  assert.equal(report.arms.review.unadjudicated_findings, 1, 'the unadjudicated nit is visible, not silently scored');
  assert.equal(report.arms.review.median_total_tokens, 1500);
});

test('actual false labels count zero valid blockers', () => {
  const base = scenario();
  const adjudications = [
    {
      blind_id: base.blind('review', 'lost-write'),
      real: false,
      pr_attributable: false,
      necessary_before_merge: false,
      matches_key_item: null,
      adjudicator: 'm',
      reason: 'r',
    },
  ];
  assert.deepEqual(scoreRuns({ ...base, adjudications }).arms.review.blocker_precision, {
    numerator: 0,
    denominator: 1,
    value: 0,
  });
});

test('malformed, duplicate, contradictory, and dangling adjudications fail visibly', () => {
  const base = scenario();
  const id = base.blind('review', 'lost-write');
  const label = (overrides) => ({
    blind_id: id,
    real: true,
    pr_attributable: true,
    necessary_before_merge: true,
    adjudicator: 'm',
    reason: 'r',
    ...overrides,
  });
  const cases = [
    [
      [label({ real: 'false', pr_attributable: 'false', necessary_before_merge: 'false' })],
      /real must be true or false, not "false"/,
    ],
    [[label({ necessary_before_merge: null })], /necessary_before_merge must be true or false, not null/],
    [[label({}), label({})], /appears more than once/],
    [[label({ real: false })], /contradictory/],
    [
      [label({ real: false, pr_attributable: false, necessary_before_merge: false, matches_key_item: 'k1' })],
      /cannot match an answer-key item/,
    ],
    [[label({ matches_key_item: 'k9' })], /not an item in the case-one answer key/],
    [[label({ blind_id: 'f-nothing' })], /names no blinded finding/],
  ];
  for (const [adjudications, pattern] of cases) {
    assert.throws(() => scoreRuns({ ...base, adjudications }), pattern);
  }
});

test('capture rejects a report for another head, PR, or round shape', () => {
  const capture = (rendered, overrides = {}) =>
    buildRunRecord({ caseManifest: manifest(overrides), arm: 'review', runIndex: 1, rendered, meta: META });
  assert.throws(() => capture(renderFor({ head: 'd'.repeat(40) })), /reviews head d{40}, not the case head b{40}/);
  assert.throws(
    () => capture(renderFor({ pr: 2 })),
    /reviews https:\/\/github\.com\/grafana\/grafana-pathfinder-app\/pull\/2, not/
  );
  assert.throws(() => capture(renderFor({ round: 2 })), /no prior review, but the report is round 2/);
  const prior = { prior_review: { reviewed_head: SHA_A, author: 'r', submitted_at: '2026-09-01T00:00:00Z' } };
  assert.throws(() => capture(RENDERED, prior), /ran without its prior state/);
  assert.equal(capture(renderFor({ round: 2 }), prior).provenance.status, 'verified');
});

test('a report without state is recorded as unverified and never scored', () => {
  const base = scenario({ sessionRendered: renderFor({ incomplete: true }) });
  const session = base.runs[1];
  assert.equal(session.provenance.status, 'unverified');
  assert.equal(session.reviewed_head, null);
  const report = scoreRuns(base);
  assert.deepEqual(
    report.unverified_runs.map(({ arm }) => arm),
    ['review-session']
  );
  assert.equal(report.arms['review-session'].scored_runs, 0);
  assert.deepEqual(report.arms['review-session'].incomplete_run_rate, { numerator: 1, denominator: 1, value: 1 });
});

test('a complete-looking report without provenance counts as an incomplete run', () => {
  const stripped = RENDERED.replace(/\n<!-- pathfinder-review-state:.*-->\n/, '\n');
  assert.doesNotMatch(stripped, /pathfinder-review-state/);
  const base = scenario({ sessionRendered: stripped });
  const run = base.runs[1];
  assert.equal(run.complete, true, 'the rendered verdict alone looks complete');
  assert.equal(run.provenance.status, 'unverified');
  const report = scoreRuns(base);
  assert.deepEqual(report.arms['review-session'].incomplete_run_rate, { numerator: 1, denominator: 1, value: 1 });
  assert.deepEqual(report.arms['review-session'].incomplete_runs, { rendered_incomplete: 0, unverified_provenance: 1 });
  assert.equal(report.arms['review-session'].scored_runs, 0);
  assert.deepEqual(report.arms.review.incomplete_run_rate, { numerator: 0, denominator: 1, value: 0 });
});

test('unpaired cases are reported separately and excluded from the comparison', () => {
  const base = scenario();
  const extra = buildRunRecord({
    caseManifest: manifest(),
    arm: 'review',
    runIndex: 2,
    rendered: RENDERED,
    meta: { ...META, model: 'other-model' },
  });
  const report = scoreRuns({
    ...base,
    runs: [...base.runs, extra],
    cases: [manifest(), manifest({ case_id: 'case-two', adjudication_status: 'unadjudicated' })],
  });
  assert.equal(report.unpaired_cases[0].case_id, 'case-one');
  assert.match(report.unpaired_cases[0].issues.join('; '), /run counts differ.*model differs/);
  assert.equal(report.arms.review.scored_runs, 0);
  assert.deepEqual(report.excluded_unadjudicated, ['case-two']);
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
