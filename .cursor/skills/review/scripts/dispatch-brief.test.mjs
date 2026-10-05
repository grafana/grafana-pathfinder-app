import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDispatchBrief } from './dispatch-brief.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dispatch-brief.mjs');
const input = { repo: 'grafana/grafana-pathfinder-app', pr: '2074', scratch: '/tmp/scratch/' };

test('the brief binds the PR, repository, and a per-PR scratch directory into its steps', () => {
  const brief = buildDispatchBrief(input);
  assert.match(brief, /https:\/\/github\.com\/grafana\/grafana-pathfinder-app\/pull\/2074 \(PR 2074\)/);
  assert.match(brief, /git fetch origin refs\/pull\/2074\/head:refs\/remotes\/origin\/pr-2074/);
  assert.match(brief, /gh pr view 2074 --repo grafana\/grafana-pathfinder-app --json headRefOid/);
  assert.match(brief, /`\/tmp\/scratch\/pr-2074\/`, every file prefixed `pr2074-`/);
  assert.ok(!brief.includes('//pr-2074'), 'a trailing slash on --scratch is normalized away');
});

test('the brief states the stop-and-report rule, the gates, and the evidence checks', () => {
  const brief = buildDispatchBrief(input);
  assert.match(brief, /STOP and return a report naming the blocked stage/);
  assert.match(brief, /allowed only with a quoted instruction from the user/);
  assert.match(brief, /security-gate\.mjs --base <base-sha> --head <head-sha>/);
  assert.match(brief, /Test efficacy: create a second disposable worktree/);
  assert.match(brief, /every observation through review-policy\.mjs, including low ones/);
  assert.match(brief, /--section "Stage ledger"/);
});

test('the command line prints the brief and rejects unsafe arguments', () => {
  const ok = spawnSync('node', [SCRIPT, '--repo', input.repo, '--pr', '2074', '--scratch', '/tmp/scratch'], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trimEnd(), buildDispatchBrief({ ...input, scratch: '/tmp/scratch' }));
  for (const args of [
    ['--repo', 'not a repo', '--pr', '1', '--scratch', '/tmp/s'],
    ['--repo', input.repo, '--pr', '1; rm -rf /', '--scratch', '/tmp/s'],
    ['--repo', input.repo, '--pr', '0', '--scratch', '/tmp/s'],
    ['--repo', input.repo, '--pr', '1', '--scratch', 'relative/dir'],
    ['--repo', input.repo, '--pr', '1', '--scratch', '/tmp/../etc'],
    ['--repo', input.repo, '--pr', '1', '--scratch', '/tmp/a b'],
  ]) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(result.stdout, '');
  }
});
