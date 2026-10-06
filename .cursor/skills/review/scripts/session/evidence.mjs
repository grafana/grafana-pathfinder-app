import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { sha256, validateArgv, validateRepoPath } from './model.mjs';

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_OUTPUT = 32 * 1024 * 1024;
const SETUP_FAILURE =
  /Test suite failed to run|Cannot find module|SyntaxError|error TS\d+|Jest encountered an unexpected token|ERR_MODULE_NOT_FOUND|\[build failed\]|\[setup failed\]/;
const ASSERTION_FAILURE = /Tests:\s+\d+ failed|✕|AssertionError|Expected:|# fail [1-9]|--- FAIL:/;

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
  }
  return result.stdout.trim();
}

function lockfileIdentity(dir) {
  const path = join(dir, 'package-lock.json');
  return existsSync(path) ? sha256(readFileSync(path, 'utf8')) : null;
}

function nodeModulesIdentity(dir) {
  const path = join(dir, 'node_modules');
  return existsSync(path) ? realpathSync(path) : null;
}

export function classifyFailure(output) {
  if (ASSERTION_FAILURE.test(output)) {
    return 'assertion';
  }
  return SETUP_FAILURE.test(output) ? 'setup' : 'unknown';
}

function commandEnvironment() {
  const { NODE_TEST_CONTEXT: _testRunner, ...inherited } = process.env;
  return { ...inherited, CI: inherited.CI ?? 'true', FORCE_COLOR: '0' };
}

export function runArgv({ argv, cwd, timeoutMs = DEFAULT_TIMEOUT_MS, store }) {
  validateArgv(argv, 'argv');
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT,
    timeout: timeoutMs,
    env: commandEnvironment(),
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    argv,
    cwd,
    code_head: git(cwd, ['rev-parse', 'HEAD']),
    exit_status: result.status,
    signal: result.signal,
    spawn_error: result.error ? result.error.message : null,
    duration_ms: Date.now() - started,
    stdout_ref: store(stdout).ref,
    stderr_ref: store(stderr).ref,
    failure_kind: result.status === 0 ? null : classifyFailure(`${stdout}\n${stderr}`),
    environment: {
      node: process.version,
      platform: process.platform,
      lockfile_sha256: lockfileIdentity(cwd),
      node_modules: nodeModulesIdentity(cwd),
    },
  };
}

function addWorktree(repoDir, path, sha) {
  git(repoDir, ['worktree', 'add', '--detach', path, sha]);
  const modules = join(repoDir, 'node_modules');
  if (existsSync(modules)) {
    symlinkSync(realpathSync(modules), join(path, 'node_modules'));
  }
}

function removeWorktree(repoDir, path) {
  const result = spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: repoDir, encoding: 'utf8' });
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], { cwd: repoDir });
  }
  return { removed: !existsSync(path), git_status: result.status, path };
}

function revertToBase(worktree, base, paths) {
  const reverted = [];
  for (const path of paths) {
    validateRepoPath(path, 'revert path');
    const atBase = spawnSync('git', ['cat-file', '-e', `${base}:${path}`], { cwd: worktree }).status === 0;
    if (atBase) {
      git(worktree, ['checkout', base, '--', path]);
      reverted.push({ path, action: 'restored_from_base' });
    } else {
      git(worktree, ['rm', '-q', '--', path]);
      reverted.push({ path, action: 'removed_added_file' });
    }
  }
  return reverted;
}

function assertReviewHead(repoDir, head) {
  const actual = git(repoDir, ['rev-parse', 'HEAD']);
  if (actual !== head) {
    throw new Error(
      `the review checkout is at ${actual}, not the session head ${head}; commands run only at the pinned head`
    );
  }
}

export function executeCommandTask({ task, identity, sessionDir, store }) {
  const repoDir = identity.repo_dir;
  const kind = task.spec.kind;
  if (kind === 'check') {
    assertReviewHead(repoDir, identity.head_sha);
    return runArgv({ argv: task.spec.argv, cwd: repoDir, store });
  }
  const sha = task.spec.at === 'base' ? identity.base_sha : identity.head_sha;
  const worktree = join(sessionDir, 'work', task.id);
  let evidence;
  let cleanup = null;
  try {
    addWorktree(repoDir, worktree, sha);
    const reverted = kind === 'efficacy' ? revertToBase(worktree, identity.base_sha, task.spec.revert_paths) : [];
    evidence = { ...runArgv({ argv: task.spec.argv, cwd: worktree, store }), worktree_sha: sha, reverted };
  } catch (error) {
    evidence = { error: error.message, worktree_sha: sha };
  } finally {
    if (existsSync(worktree)) {
      cleanup = removeWorktree(repoDir, worktree);
    }
  }
  return { ...evidence, cleanup: cleanup ?? { removed: true, git_status: null, path: worktree } };
}
