import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { computeChangedSurface } from './changed-surface.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'changed-surface.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('Go sources, module files, and the Magefile mark the Go surface', () => {
  const surface = computeChangedSurface({
    files: ['pkg/plugin/app.go', 'go.mod', 'go.sum', 'Magefile.go', 'src/a.ts', 'docs/x.md'],
  });
  assert.deepEqual(surface, {
    go: true,
    go_paths: ['pkg/plugin/app.go', 'go.mod', 'go.sum', 'Magefile.go'],
    dependency_manifests: ['go.mod', 'go.sum'],
    frontend: true,
  });
});

test('a frontend-only change has no Go surface, and Go files outside pkg do not count', () => {
  assert.deepEqual(computeChangedSurface({ files: ['src/a.ts', 'tools/gen.go', 'docs/pkg.go.md'] }), {
    go: false,
    go_paths: [],
    dependency_manifests: [],
    frontend: true,
  });
});

test('npm manifests are dependency manifests wherever they live', () => {
  const surface = computeChangedSurface({ files: ['package.json', 'package-lock.json', 'tests/e2e/package.json'] });
  assert.deepEqual(surface.dependency_manifests, ['package.json', 'package-lock.json', 'tests/e2e/package.json']);
  assert.equal(surface.go, false);
  assert.equal(surface.frontend, false);
});

test('the CLI reads the changed files of a literal SHA range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changed-surface-'));
  try {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'README.md'), 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    const base = git(dir, 'rev-parse', 'HEAD');
    mkdirSync(join(dir, 'pkg', 'plugin'), { recursive: true });
    writeFileSync(join(dir, 'pkg', 'plugin', 'app.go'), 'package plugin\n');
    writeFileSync(join(dir, 'package.json'), '{}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'head');
    const head = git(dir, 'rev-parse', 'HEAD');
    const result = spawnSync(process.execPath, [SCRIPT, '--base', base, '--head', head], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      go: true,
      go_paths: ['pkg/plugin/app.go'],
      dependency_manifests: ['package.json'],
      frontend: false,
    });
    const refused = spawnSync(process.execPath, [SCRIPT, '--base', 'main', '--head', head], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /literal Git commit SHAs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
