import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderReviewReport } from '../review-report.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'session.mjs');
const ALWAYS_ON = [
  'security',
  'correctness-and-reliability',
  'testing-and-verification',
  'reversibility-and-one-way-door',
  'cross-cutting-architecture',
];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'review-session-repo-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const commit = (files, message) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
  };
  const base = commit({ 'src/add.mjs': 'export const add = (a, b) => a - b;\n' }, 'base');
  const head = commit(
    {
      'src/add.mjs': 'export const add = (a, b) => a + b;\n',
      'src/add.test.mjs':
        "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from './add.mjs';\ntest('adds', () => assert.equal(add(1, 2), 3));\n",
    },
    'fix: add numbers'
  );
  return { dir, base, head };
}

function cli(args, { expectFailure = false } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  if (expectFailure) {
    assert.notEqual(result.status, 0, `expected failure: ${result.stdout}`);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function writeResult(task, result) {
  writeFileSync(task.result, JSON.stringify(result));
}

function answerFor(task, view) {
  switch (task.role) {
    case 'route':
      return {
        change_class: 'product-runtime',
        concerns: ALWAYS_ON.map((id) => ({ id, context: [{ path: 'src/add.mjs', excerpt: 'add' }] })),
        file_coverage: [
          { path: 'src/add.mjs', concern_ids: ['correctness-and-reliability'], reason: 'fix' },
          { path: 'src/add.test.mjs', concern_ids: ['testing-and-verification'], reason: 'test' },
        ],
      };
    case 'evidence_plan':
      return {
        checks: [
          { name: 'unit_tests', argv: ['node', '--test', 'src/add.test.mjs'] },
          { name: 'typecheck', argv: ['node', '-e', '0'] },
          { name: 'lint', argv: ['node', '-e', '0'] },
        ],
        efficacy: [
          {
            behavior: 'add sums',
            test: 'src/add.test.mjs',
            argv: ['node', '--test', 'src/add.test.mjs'],
            revert_paths: ['src/add.mjs'],
          },
        ],
      };
    case 'observer':
      return {
        no_findings: task.concern_ids.map((concern_id) => ({
          concern_id,
          status: 'no_findings',
          reason: 'reviewed_clean',
        })),
      };
    case 'synthesis':
      return { merges: [], revisions: [], additions: [] };
    default:
      throw new Error(`unexpected ${task.role} in ${view.session_id}`);
  }
}

function recordTask(sessionDir, head, task, view) {
  writeResult(task, answerFor(task, view));
  const identity = task.executor === 'agent' ? ['--agent-id', `agent-${task.task_id}`] : [];
  return cli([
    'record',
    '--session',
    sessionDir,
    '--task',
    task.task_id,
    '--head',
    head,
    '--result',
    task.result,
    ...identity,
  ]);
}

function startArgs(repo, sessionsDir) {
  return [
    'start',
    '--repo',
    'grafana/grafana-pathfinder-app',
    '--pr',
    '7',
    '--base',
    repo.base,
    '--head',
    repo.head,
    '--reviewer',
    'reviewer-bot',
    '--title',
    'fix: add numbers',
    '--repo-dir',
    repo.dir,
    '--sessions-dir',
    sessionsDir,
  ];
}

function runToCompletion(repo, sessionsDir, { interrupt = false } = {}) {
  let view = cli(startArgs(repo, sessionsDir));
  const sessionDir = view.session_dir;
  for (let guard = 0; guard < 40 && view.ready.length > 0; guard += 1) {
    const [task] = view.ready;
    if (task.executor === 'controller') {
      view = cli(['exec', '--session', sessionDir, '--all-ready']);
      continue;
    }
    view = recordTask(sessionDir, repo.head, task, view);
    if (interrupt && task.role === 'route') {
      assert.equal(recordTask(sessionDir, repo.head, task, view).recorded.status, 'already_recorded');
      appendFileSync(join(sessionDir, 'events.jsonl'), '{"seq":999,"type":"torn');
      view = cli(startArgs(repo, sessionsDir));
      assert.equal(view.session_dir, sessionDir, 'restarting resumes the same session');
    }
  }
  return { sessionDir, final: cli(['finalize', '--session', sessionDir]) };
}

test('the CLI drives a real repository review to a complete report with controller-run evidence', () => {
  const repo = fixtureRepo();
  const sessions = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  try {
    const { sessionDir, final } = runToCompletion(repo, sessions);
    assert.equal(final.complete, true, JSON.stringify(final.obligations));
    const rendered = readFileSync(final.rendered_path, 'utf8');
    assert.match(rendered, /Verdict: Approve\n/);
    assert.match(
      rendered,
      /revert checks: 1 of 1 fail on behavior · 0 inconclusive \(setup\) · 0 inconclusive \(error\)/
    );
    const events = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const efficacy = events.find(
      ({ type, data }) => type === 'task_completed' && data.result?.reverted?.[0]?.path === 'src/add.mjs'
    );
    assert.equal(efficacy.data.result.exit_status, 1);
    assert.equal(efficacy.data.result.worktree_sha, repo.head);
    assert.equal(efficacy.data.result.cleanup.removed, true);
    assert.equal(efficacy.data.receipt.provenance, 'controller_observed');
    assert.ok(existsSync(join(sessionDir, efficacy.data.result.stdout_ref)));
    assert.equal(git(repo.dir, 'status', '--porcelain'), '', 'the review checkout is never mutated');
    assert.equal(git(repo.dir, 'worktree', 'list').split('\n').length, 1, 'disposable worktrees are removed');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test('an interrupted, replayed, and torn session resumes to the same review as an uninterrupted one', () => {
  const repo = fixtureRepo();
  const straight = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  const resumed = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  try {
    const a = runToCompletion(repo, straight);
    const b = runToCompletion(repo, resumed, { interrupt: true });
    assert.equal(readFileSync(a.final.rendered_path, 'utf8'), readFileSync(b.final.rendered_path, 'utf8'));
    assert.deepEqual(cli(['finalize', '--session', b.sessionDir]).already_finalized, true);
    const stderr = cli(
      [
        'record',
        '--session',
        b.sessionDir,
        '--task',
        't001-route',
        '--head',
        repo.head,
        '--result',
        join(b.sessionDir, 'tasks', 't001-route', 'result.json'),
      ],
      { expectFailure: true }
    );
    assert.match(stderr, /finalized as a complete review/);
  } finally {
    for (const dir of [repo.dir, straight, resumed]) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a second live writer is refused and a dead writer lock is reclaimed', () => {
  const repo = fixtureRepo();
  const sessions = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  try {
    const view = cli(startArgs(repo, sessions));
    const [route] = view.ready;
    writeResult(route, answerFor(route, view));
    const lock = join(view.session_dir, '.writer.lock');
    writeFileSync(lock, String(process.pid));
    const args = [
      'record',
      '--session',
      view.session_dir,
      '--task',
      route.task_id,
      '--head',
      repo.head,
      '--result',
      route.result,
    ];
    assert.match(cli(args, { expectFailure: true }), /live writer/);
    writeFileSync(lock, '999999');
    assert.equal(cli(args).recorded.status, 'recorded');
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test('starting requires the checkout at the pinned head', () => {
  const repo = fixtureRepo();
  const sessions = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  try {
    git(repo.dir, 'checkout', '-q', repo.base);
    assert.match(cli(startArgs(repo, sessions), { expectFailure: true }), /check out the PR head/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});

test('a fresh process resumes an incremental session with the original text of an opaque-ID prior blocker', () => {
  const repo = fixtureRepo();
  const sessions = mkdtempSync(join(tmpdir(), 'review-sessions-'));
  try {
    const invariant = 'Zebra-ledger invariant: every retried write keeps the caller-supplied idempotency key';
    const prior = renderReviewReport({
      pr_url: 'https://github.com/grafana/grafana-pathfinder-app/pull/7',
      pr_title: 'fix: add numbers',
      reviewed_head: repo.base,
      round: 1,
      findings: [
        {
          id: 'q7x',
          concern_id: 'correctness-and-reliability',
          disposition: 'blocking',
          severity: 'high',
          title: 'Opaque blocker',
          problem: invariant,
          suggested_action: 'Thread the key through the retry wrapper.',
        },
      ],
      deferred: [],
      cleared: [],
      stage_ledger: {
        mode: 'full',
        change_class: 'tests-only',
        surfaces: { go: false },
        workers: { planned: 1, run: 1 },
        skeptic_batches: { required: 0, run: 0 },
        observations: { total: 1, through_policy: 1 },
        security: { gate_triggered: false, specialist_ran: false },
        checks: ['unit_tests', 'typecheck', 'lint'].map((name) => ({ name, status: 'pass', command: 'x' })),
        efficacy: [],
        skipped: [],
      },
    });
    const priorPath = join(sessions, 'prior.md');
    writeFileSync(priorPath, prior);
    const started = cli([
      ...startArgs(repo, sessions),
      '--prior-review',
      priorPath,
      '--prior-review-author',
      'reviewer-bot',
      '--prior-review-count',
      '1',
    ]);
    assert.equal(started.mode, 'incremental');
    rmSync(priorPath);
    const resumed = cli(['next', '--session', started.session_dir]);
    const check = resumed.ready.find(({ role }) => role === 'prior_check');
    const input = JSON.parse(readFileSync(join(dirname(check.brief), 'input.json'), 'utf8'));
    assert.deepEqual(input.items[0].original, {
      title: 'Opaque blocker',
      problem: invariant,
      requested_action: 'Thread the key through the retry wrapper.',
      disposition: 'blocking',
      severity: 'high',
    });
    assert.equal(readFileSync(input.prior_review_path, 'utf8'), prior);
    rmSync(dirname(check.brief), { recursive: true });
    rmSync(input.prior_review_path);
    assert.match(
      cli(['next', '--session', started.session_dir], { expectFailure: true }),
      /cannot be reconstructed from IDs/
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
    rmSync(sessions, { recursive: true, force: true });
  }
});
