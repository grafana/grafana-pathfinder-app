import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { classifyFailure, compareBaselineFailure, executeCommandTask } from './evidence.mjs';
import { storeArtifact } from './store.mjs';

const ADD_TEST =
  "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from './add.mjs';\ntest('adds two numbers', () => assert.equal(add(1, 2), 3));\n";

function fixture(baseFiles, headFiles) {
  const repo = mkdtempSync(join(tmpdir(), 'evidence-repo-'));
  const session = mkdtempSync(join(tmpdir(), 'evidence-session-'));
  mkdirSync(join(session, 'artifacts'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  const commit = (files) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'c');
    return git('rev-parse', 'HEAD');
  };
  const base = commit(baseFiles);
  const head = commit(headFiles);
  const identity = { repo_dir: repo, base_sha: base, head_sha: head };
  const store = (content) => storeArtifact(session, content);
  const readArtifact = (ref) => readFileSync(join(session, ref), 'utf8');
  const run = (spec, headEvidence = null) =>
    executeCommandTask({
      task: { id: `t-${spec.kind}`, spec },
      identity,
      sessionDir: session,
      store,
      readArtifact,
      headEvidence,
    });
  return { run, cleanup: () => [repo, session].forEach((dir) => rmSync(dir, { recursive: true, force: true })) };
}

const ARGV = ['node', '--test', 'src/add.test.mjs'];

test('a test missing at the base cannot verify a baseline failure', () => {
  const { run, cleanup } = fixture(
    { 'src/add.mjs': 'export const add = (a, b) => a + b;\n' },
    { 'src/add.mjs': 'export const add = (a, b) => a - b;\n', 'src/add.test.mjs': ADD_TEST }
  );
  try {
    const head = run({ kind: 'check', argv: ARGV });
    assert.equal(head.failure_kind, 'assertion');
    const baseline = run(
      { kind: 'baseline', argv: ARGV, at: 'base', signature: 'adds two numbers', preserve_paths: [] },
      head
    );
    assert.notEqual(baseline.exit_status, 0);
    assert.equal(baseline.match.matched, false);
    assert.equal(baseline.cleanup.removed, true);
  } finally {
    cleanup();
  }
});

test('keeping the head test at base separates a PR regression from a pre-existing failure', () => {
  const regression = fixture(
    { 'src/add.mjs': 'export const add = (a, b) => a + b;\n' },
    { 'src/add.mjs': 'export const add = (a, b) => a - b;\n', 'src/add.test.mjs': ADD_TEST }
  );
  try {
    const head = regression.run({ kind: 'check', argv: ARGV });
    const baseline = regression.run(
      { kind: 'baseline', argv: ARGV, at: 'base', signature: 'adds two numbers', preserve_paths: ['src/add.test.mjs'] },
      head
    );
    assert.equal(baseline.exit_status, 0, 'the kept test passes at base, so the PR caused the failure');
    assert.deepEqual(baseline.kept, [{ path: 'src/add.test.mjs', action: 'kept_from_head' }]);
    assert.equal(baseline.match.matched, false);
  } finally {
    regression.cleanup();
  }
  const preexisting = fixture(
    { 'src/add.mjs': 'export const add = (a, b) => a - b;\n', 'src/add.test.mjs': ADD_TEST },
    { 'src/add.mjs': 'export const add = (a, b) => a - b;\n// unrelated\n' }
  );
  try {
    const head = preexisting.run({ kind: 'check', argv: ARGV });
    const baseline = preexisting.run(
      { kind: 'baseline', argv: ARGV, at: 'base', signature: 'adds two numbers', preserve_paths: [] },
      head
    );
    assert.deepEqual(
      { matched: baseline.match.matched, head: baseline.match.head_kind, base: baseline.match.base_kind },
      { matched: true, head: 'assertion', base: 'assertion' }
    );
  } finally {
    preexisting.cleanup();
  }
});

const TWO_TESTS =
  "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add, ordered } from './add.mjs';\ntest('adds two numbers', () => assert.equal(add(1, 2), 3));\ntest('preserves ordering', () => assert.deepEqual(ordered([2, 1]), [1, 2]));\n";

test('a baseline that fails a different test does not match, even when the signature appears in its output', () => {
  const { run, cleanup } = fixture(
    {
      'src/add.mjs': 'export const add = (a, b) => a + b;\nexport const ordered = (xs) => xs;\n',
      'src/add.test.mjs': TWO_TESTS,
    },
    {
      'src/add.mjs': 'export const add = (a, b) => a - b;\nexport const ordered = (xs) => [...xs].sort();\n',
      'src/add.test.mjs': TWO_TESTS,
    }
  );
  try {
    const head = run({ kind: 'check', argv: ARGV });
    assert.equal(head.failure_kind, 'assertion');
    const baseline = run(
      { kind: 'baseline', argv: ARGV, at: 'base', signature: 'adds two numbers', preserve_paths: [] },
      head
    );
    assert.equal(baseline.failure_kind, 'assertion', 'both commits fail an assertion');
    assert.deepEqual(
      { matched: baseline.match.matched, reason: baseline.match.reason },
      {
        matched: false,
        reason: 'the signature names no failing result in the baseline output; base may fail for a different reason',
      }
    );
  } finally {
    cleanup();
  }
});

test('baseline comparison refuses unrelated or uncertain failures', () => {
  const head = { exit_status: 1, failure_kind: 'assertion' };
  const compare = (base, headOutput = '✖ adds two numbers (1ms)', baseOutput = '✖ adds two numbers (2ms)') =>
    compareBaselineFailure({ head, base, signature: 'adds two numbers', headOutput, baseOutput }).reason;
  assert.match(
    compare({ exit_status: 1, failure_kind: 'setup' }),
    /assertion failure but the base with a setup failure/
  );
  assert.match(compare({ exit_status: 0 }), /passes at the base/);
  assert.match(compare({ error: 'worktree failed' }), /could not run/);
  assert.match(
    compare({ exit_status: 1, failure_kind: 'assertion' }, '✔ adds two numbers'),
    /no failing result in the head/
  );
  assert.match(
    compare({ exit_status: 1, failure_kind: 'assertion' }, '✖ failing tests:\nadds two numbers'),
    /no failing result in the head/
  );
  assert.match(
    compare({ exit_status: 1, failure_kind: 'assertion' }, undefined, '✔ adds two numbers\n✖ preserves ordering'),
    /no failing result in the baseline output/
  );
  assert.equal(compare({ exit_status: 1, failure_kind: 'assertion' }), null);
  assert.equal(
    compareBaselineFailure({
      head: { failure_kind: 'unknown' },
      base: { exit_status: 1, failure_kind: 'unknown' },
      signature: 'adds two numbers',
      headOutput: '✖ adds two numbers',
      baseOutput: '✖ adds two numbers',
    }).matched,
    false
  );
});

test('failure classification separates assertions from build and setup failures', () => {
  assert.equal(classifyFailure('--- FAIL: TestRetried (0.00s)'), 'assertion');
  assert.equal(classifyFailure('FAIL\tgithub.com/x/pkg [build failed]'), 'setup');
  assert.equal(classifyFailure('Test suite failed to run\nCannot find module'), 'setup');
  assert.equal(classifyFailure('No tests found, exiting with code 1'), 'unknown');
});
