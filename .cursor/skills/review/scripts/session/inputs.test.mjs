import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { realEffects } from './inputs.mjs';

const MAGIC_NAMES = [':(exclude)*', ':(glob)*', ':!other.txt'];

function repoWithMagicNames() {
  const repo = mkdtempSync(join(tmpdir(), 'inputs-pathspec-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README'), 'base\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const name of MAGIC_NAMES) {
    writeFileSync(join(repo, name), `content of ${name}\n`);
  }
  writeFileSync(join(repo, 'other.txt'), 'other content\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'head');
  return { repo, base, head: git('rev-parse', 'HEAD') };
}

test('a changed file whose name is pathspec magic diffs as exactly that file', () => {
  const { repo, base, head } = repoWithMagicNames();
  try {
    const effects = realEffects(repo);
    assert.deepEqual(effects.changedFiles(base, head).sort(), [...MAGIC_NAMES, 'other.txt'].sort());
    for (const name of MAGIC_NAMES) {
      const diff = effects.diff(base, head, [name]);
      assert.match(diff, new RegExp(`\\+content of ${name.replace(/[()*!]/g, '\\$&')}`), name);
      assert.doesNotMatch(diff, /other content/, name);
      assert.equal((diff.match(/^diff --git /gm) ?? []).length, 1, name);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
