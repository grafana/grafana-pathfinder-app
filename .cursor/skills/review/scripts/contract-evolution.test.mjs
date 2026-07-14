import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { computeGate } from './contract-evolution-gate.mjs';
import { buildFinding, decideDisposition } from './contract-evolution-policy.mjs';

const tempDirs = [];

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function write(repo, path, value) {
  const fullPath = join(repo, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value);
}

function commit(repo, subject, content) {
  write(repo, 'src/lib/telemetry.ts', content);
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', subject]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function createRepo(triggerPath = 'src/lib/telemetry.ts') {
  const repo = mkdtempSync(join(tmpdir(), 'contract-evolution-'));
  tempDirs.push(repo);
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'tests@example.com']);
  git(repo, ['config', 'user.name', 'Tests']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  write(
    repo,
    'docs/design/CONCERNS.md',
    `| id | cat | on | mode | min | max | trigger_paths | trigger_keywords |\n| -- | -- | -- | -- | -- | -- | -- | -- |\n| \`telemetry\` | sub | N | strong | 1 | 8 | \`${triggerPath}\` | \`telemetry\` |\n`
  );
  write(repo, triggerPath, 'initial\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'chore: initialize fixture (#1)']);
  return repo;
}

function packet(overrides = {}) {
  return {
    concern_id: 'telemetry',
    origin_or_contract_anchor: 'none',
    recent_semantic_changes: [{ pr: 10, sha: 'abcdef0', timestamp: 1_700_000_000, summary: 'Adds telemetry' }],
    current_contract_owner: 'none',
    new_contract_delta: 'Adds another raw event vocabulary',
    competing_owners_or_representations: ['event payload'],
    verdict: 'contract_branching',
    history_status: 'complete',
    use_ordinal: 'second',
    same_bug_count: 0,
    has_recorded_anchor: false,
    branching_conditions: ['new_event_vocabulary'],
    sources: [{ kind: 'pr', id: 10, sha: 'abcdef0', selection_reason: 'Most recent semantic PR' }],
    finding: {
      finding_id: 'CE-1',
      title: 'Event vocabulary branches',
      evidence: ['A second event name is defined locally'],
      why_it_matters: 'Consumers can disagree about the payload',
      suggested_action: 'Centralize the event type',
      reversibility: 'reversible',
      applies_to_files: ['src/lib/telemetry.ts'],
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('gate counts distinct prior PRs and excludes current branch commits', () => {
  const repo = createRepo();
  commit(repo, 'feat(telemetry): add facade (#10)', 'feature\n');
  commit(repo, 'fix(telemetry): repair facade (#11)', 'fix one\n');
  const base = commit(repo, 'fix(telemetry): follow-up in the same PR (#11)', 'fix two\n');
  git(repo, ['switch', '-q', '-c', 'feature']);
  commit(repo, 'feat(telemetry): current PR part one (#12)', 'current one\n');
  const head = commit(repo, 'feat(telemetry): current PR part two (#12)', 'current two\n');

  const result = computeGate({ base, head, concern: 'telemetry', cwd: repo });

  assert.equal(result.prior_semantic_pr_count, 2);
  assert.deepEqual(
    result.recent_semantic_changes.map((entry) => entry.pr),
    [11, 10]
  );
  assert.equal(
    result.recent_semantic_changes.some((entry) => entry.pr === 12),
    false
  );
  assert.equal(result.triggered, true);
});

test('gate passes metacharacter paths to Git without shell execution', () => {
  const triggerPath = 'src/lib/safe;touch pwned';
  const repo = createRepo(triggerPath);
  const base = git(repo, ['rev-parse', 'HEAD']);

  const result = computeGate({ base, head: base, concern: 'telemetry', cwd: repo });

  assert.deepEqual(result.paths, [triggerPath]);
  assert.equal(readFileSync(join(repo, triggerPath), 'utf8'), 'initial\n');
  assert.throws(() => readFileSync(join(repo, 'pwned')));
});

test('#1297-style second unanchored branch is advisory and schema-compatible', () => {
  const value = packet();
  assert.deepEqual(decideDisposition(value), {
    effective_verdict: 'contract_branching',
    disposition: 'advisory',
    severity: 'medium',
    requires_finding: true,
  });
  assert.deepEqual(buildFinding(value), {
    concern_id: 'telemetry',
    finding_id: 'CE-1',
    severity: 'medium',
    confidence: 'high',
    title: 'Event vocabulary branches',
    evidence: ['A second event name is defined locally'],
    why_it_matters: 'Consumers can disagree about the payload',
    suggested_action: 'Centralize the event type',
    reversibility: 'reversible',
    applies_to_files: ['src/lib/telemetry.ts'],
    disposition: 'advisory',
  });
});

test('anchored or mature branching is blocking', () => {
  assert.equal(decideDisposition(packet({ has_recorded_anchor: true })).disposition, 'blocking');
  assert.equal(decideDisposition(packet({ use_ordinal: 'third_or_later' })).disposition, 'blocking');
  assert.equal(decideDisposition(packet({ same_bug_count: 2 })).disposition, 'blocking');
});

test('#1334-style third vendor consumer is blocking', () => {
  const value = packet({
    use_ordinal: 'third_or_later',
    branching_conditions: ['additional_vendor_consumer'],
    new_contract_delta: 'Adds another product-tier pushFaro consumer',
  });
  assert.deepEqual(decideDisposition(value), {
    effective_verdict: 'contract_branching',
    disposition: 'blocking',
    severity: 'high',
    requires_finding: true,
  });
});

test('missing history cannot block without an anchor', () => {
  const value = packet({ history_status: 'partial' });
  assert.deepEqual(decideDisposition(value), {
    effective_verdict: 'insufficient_history',
    disposition: 'advisory',
    severity: 'low',
    requires_finding: true,
  });
  assert.equal(buildFinding(value).confidence, 'low');
});

test('stable-surface coherent extensions stay silent', () => {
  const value = packet({ verdict: 'coherent_extension', branching_conditions: [] });
  assert.equal(decideDisposition(value).requires_finding, false);
  assert.equal(buildFinding(value), null);
});
