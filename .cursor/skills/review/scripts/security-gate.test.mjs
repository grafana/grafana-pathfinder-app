import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { addedLinesByFile, computeSecurityGate } from './security-gate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'security-gate.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repoWith(base, head) {
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-'));
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
  const baseSha = commit(base, 'base');
  const headSha = commit(head, 'head');
  return { dir, baseSha, headSha };
}

function gateFor(base, head) {
  const { dir, baseSha, headSha } = repoWith(base, head);
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

test('removed lines and markdown prose do not trigger the gate', () => {
  const removed = gateFor(
    { 'src/a.ts': 'const t = window.location.search;\nexport const a = 1;\n' },
    { 'src/a.ts': 'export const a = 1;\n' }
  );
  assert.equal(removed.triggered, false);
  const prose = gateFor({ 'docs/a.md': 'x\n' }, { 'docs/a.md': 'Mentions a token and an Authorization header.\n' });
  assert.equal(prose.triggered, false);
});

test('added lines are collected per file from a unified diff', () => {
  const diff = [
    '+++ b/src/a.ts',
    '+one',
    ' context',
    '-gone',
    '+++ b/src/b.ts',
    '+two',
    '+++ /dev/null',
    '+ignored',
  ].join('\n');
  assert.deepEqual(
    [...addedLinesByFile(diff)],
    [
      ['src/a.ts', ['one']],
      ['src/b.ts', ['two']],
    ]
  );
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
