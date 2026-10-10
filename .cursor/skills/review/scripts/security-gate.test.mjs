import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { changedLinesByFile, computeSecurityGate } from './security-gate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'security-gate.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repoWith(base, head, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [key, value] of Object.entries(config)) {
    git(dir, 'config', key, value);
  }
  const commit = (files, message) => {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        rmSync(join(dir, path));
        continue;
      }
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
  };
  const baseSha = commit(base, 'base');
  const headSha = commit(head, 'head');
  return { dir, baseSha, headSha };
}

function gateFor(base, head, config) {
  const { dir, baseSha, headSha } = repoWith(base, head, config);
  try {
    return computeSecurityGate({ base: baseSha, head: headSha, cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a plain UI change does not trigger the gate', () => {
  const result = gateFor({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' });
  assert.deepEqual(result, { triggered: false, reasons: [], reason_count: 0 });
});

test('sensitive paths trigger the gate with the path as the reason', () => {
  for (const [file, signal] of [
    ['.github/workflows/ci.yml', 'workflow-permissions'],
    ['package.json', 'dependency-manifest'],
    ['go.sum', 'dependency-manifest'],
    ['src/security/url-guard.ts', 'security-module'],
    ['src/lib/auth-helpers.ts', 'auth-surface'],
  ]) {
    const result = gateFor({ 'README.txt': 'x\n' }, { [file]: 'changed\n' });
    assert.equal(result.triggered, true, file);
    assert.ok(
      result.reasons.some((reason) => reason.kind === 'path' && reason.signal === signal && reason.file === file),
      file
    );
  }
});

test('added lines that read the URL or touch a credential trigger the gate', () => {
  const urlRead = gateFor(
    { 'src/a.ts': 'export const a = 1;\n' },
    { 'src/a.ts': "export const a = new URLSearchParams(window.location.search).get('render') === '1';\n" }
  );
  assert.ok(urlRead.reasons.some(({ signal }) => signal === 'url-trust-boundary'));
  const writeKey = gateFor(
    { 'tests/f.ts': 'export {};\n' },
    { 'tests/f.ts': "window.grafanaBootData.settings.rudderstackWriteKey = '';\n" }
  );
  assert.ok(writeKey.reasons.some(({ signal }) => signal === 'credential'));
  const sink = gateFor(
    { 'src/a.tsx': 'export {};\n' },
    { 'src/a.tsx': 'const x = <div dangerouslySetInnerHTML={y} />;\n' }
  );
  assert.ok(sink.reasons.some(({ signal }) => signal === 'dom-sink'));
});

test('removed lines that touch a credential, URL, or DOM sink trigger the gate as removed', () => {
  const removedGuard = gateFor(
    { 'src/a.ts': 'if (!token) {\n  throw new Error();\n}\nexport const a = 1;\n' },
    { 'src/a.ts': 'export const a = 1;\n' }
  );
  assert.equal(removedGuard.triggered, true);
  assert.deepEqual(removedGuard.reasons, [{ kind: 'content', signal: 'credential', file: 'src/a.ts', removed: true }]);
  const removedUrlRead = gateFor(
    { 'src/a.ts': 'const t = window.location.search;\nexport const a = 1;\n' },
    { 'src/a.ts': 'export const a = 1;\n' }
  );
  assert.ok(removedUrlRead.reasons.some(({ signal, removed }) => signal === 'url-trust-boundary' && removed === true));
  const deletedFile = gateFor({ 'src/a.ts': 'export {};\n', 'src/b.ts': 'el.innerHTML = x;\n' }, { 'src/b.ts': null });
  assert.ok(
    deletedFile.reasons.some(({ signal, file, removed }) => signal === 'dom-sink' && file === 'src/b.ts' && removed)
  );
});

test('unchanged context lines and markdown prose do not trigger the gate', () => {
  const context = gateFor(
    { 'src/a.ts': 'const t = window.location.search;\nexport const a = 1;\n' },
    { 'src/a.ts': 'const t = window.location.search;\nexport const a = 2;\n' }
  );
  assert.equal(context.triggered, false);
  const prose = gateFor(
    { 'docs/a.md': 'Mentions a token and an Authorization header.\n' },
    { 'docs/a.md': 'Mentions a password and a bearer token.\n' }
  );
  assert.equal(prose.triggered, false);
});

test('added and removed lines are collected per file from a unified diff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    '+one',
    ' context',
    '-gone',
    '--- not a header',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- /dev/null',
    '+++ b/src/b.ts',
    '@@ -0,0 +1 @@',
    '+two',
    'diff --git a/src/c.ts b/src/c.ts',
    '--- a/src/c.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-deleted',
  ].join('\n');
  assert.deepEqual(
    [...changedLinesByFile(diff).files],
    [
      ['src/a.ts', { added: ['one'], removed: ['gone', '-- not a header'] }],
      ['src/b.ts', { added: ['two'], removed: [] }],
      ['src/c.ts', { added: [], removed: ['deleted'] }],
    ]
  );
  assert.equal(changedLinesByFile(diff).unattributed, 0);
});

test('hunk lines under a header the parser cannot read are counted, not dropped', () => {
  const diff = ['diff --git a/x b/x', '--- x', '+++ x', '@@ -1 +1 @@', '-old', '+new'].join('\n');
  assert.deepEqual(changedLinesByFile(diff), { files: new Map(), unattributed: 2 });
});

test("the reviewer's diff prefix settings cannot hide a content signal", () => {
  for (const config of [
    { 'diff.noprefix': 'true' },
    { 'diff.mnemonicPrefix': 'true' },
    { 'diff.srcPrefix': 'old/', 'diff.dstPrefix': 'new/' },
  ]) {
    const result = gateFor({ 'src/a.ts': 'export {};\n' }, { 'src/a.ts': 'el.innerHTML = x;\n' }, config);
    assert.deepEqual(
      result.reasons,
      [{ kind: 'content', signal: 'dom-sink', file: 'src/a.ts' }],
      Object.keys(config)[0]
    );
  }
});

test('content under a quoted file header fails closed', () => {
  const result = gateFor({ 'src/a.ts': 'export {};\n' }, { 'src/a"b.ts': 'export const b = 1;\n' });
  assert.equal(result.triggered, true);
  assert.deepEqual(result.reasons, [{ kind: 'diff', signal: 'unattributed-diff-content', count: 1 }]);
});

test('the command line refuses anything but literal commit SHAs', () => {
  for (const args of [
    ['--base', 'main', '--head', 'abc1234'],
    ['--base', 'abc1234'],
    ['--base', 'abc1234', '--head', 'abc1234;ls'],
  ]) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
});
