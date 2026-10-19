import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addContext, finish, prepare } from './review-lite.mjs';

const SCRIPT = fileURLToPath(new URL('./review-lite.mjs', import.meta.url));
const TOOLING_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ALWAYS_ON = [
  'security',
  'correctness-and-reliability',
  'testing-and-verification',
  'reversibility-and-one-way-door',
  'cross-cutting-architecture',
];
const scratch = mkdtempSync(join(tmpdir(), 'review-lite-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function freshDir(name) {
  counter += 1;
  return join(scratch, `${name}-${counter}`);
}

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function makeRepo(files) {
  const repo = freshDir('repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  return { repo, base: commit(repo, files, 'base') };
}

function commit(repo, files, message) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(repo, path);
    if (content === null) {
      rmSync(target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function prepared({ repo, base, head, prior, key = 'org/repo#1', knowledge }) {
  const out = freshDir('run');
  prepare({ repo, base, head, 'review-key': key, out, prior, knowledge });
  return out;
}

function coverageFor(runDir, status = 'checked') {
  return readJson(join(runDir, 'selected.json')).concerns.map((concern_id) => ({
    concern_id,
    status,
    evidence: `Traced the changed call path for ${concern_id}.`,
  }));
}

function result(runDir, overrides = {}) {
  return {
    assessment: 'complete',
    limitations: [],
    coverage: coverageFor(runDir),
    findings: [],
    prior_decisions: [],
    clearances: [],
    escalations: [],
    ...overrides,
  };
}

function finishWith(runDir, value) {
  const input = join(runDir, 'result.json');
  writeFileSync(input, JSON.stringify(value));
  return finish({ run: runDir, input });
}

const blocker = {
  id: 'step-index-base',
  concern_id: 'interactive-engine',
  disposition: 'blocker',
  title: 'Step index is now 1-based for an unchanged 0-based consumer',
  location: 'src/interactive-engine/step-index.ts:3',
  evidence: 'runner.ts reads steps[currentStepIndex(...)] unchanged.',
  consequence: 'The runner skips the first step of every guide.',
  base_comparison: 'Base returned a 0-based index.',
  required_invariant: 'Every caller indexing steps receives a 0-based index.',
  merge_reason: 'Every guide run regresses on the shipped path.',
};
const followUp = {
  id: 'step-index-test',
  concern_id: 'testing-and-verification',
  disposition: 'follow_up',
  attribution: 'pre_existing',
  why_not_blocker: 'No documented invariant is violated and no state is corrupted; only coverage is missing.',
  title: 'No test pins the runner and index helper together',
  location: 'src/interactive-engine/runner.ts',
  evidence: 'Only the helper has a unit test.',
  consequence: 'A future base change could regress silently.',
  base_comparison: 'Base had the same gap.',
  next_action: 'Add a runner test that executes the first step.',
};
const clearance = {
  id: 'runner-cancel',
  concern_id: 'interactive-engine',
  claim: 'The runner remains cancellable.',
  evidence: 'AbortSignal is still checked before each step in runner.ts.',
};

describe('prepare', () => {
  test('reads pinned commits and trusted registries, never the target branch or working tree', () => {
    const { repo, base } = makeRepo({ 'src/interactive-engine/runner.ts': 'export const a = 1;\n' });
    const injected = readFileSync(join(TOOLING_ROOT, 'docs/design/CONCERNS.md'), 'utf8').replace(
      '| `security` |',
      '| `attacker-concern` | sub | N | strong | 1 | 8 | `src/**` | `a` |\n| `security` |'
    );
    const head = commit(
      repo,
      { 'src/interactive-engine/runner.ts': 'export const a = 2;\n', 'docs/design/CONCERNS.md': injected },
      'head'
    );
    writeFileSync(join(repo, 'src/interactive-engine/runner.ts'), 'export const a = 99; // uncommitted\n');
    writeFileSync(join(repo, 'untracked.ts'), 'untracked\n');

    const runDir = prepared({ repo, base, head });
    const candidates = readJson(join(runDir, 'candidates.json')).candidates.map(({ id }) => id);
    assert.ok(!candidates.includes('attacker-concern'));
    assert.equal(
      readFileSync(join(runDir, 'registry/CONCERNS.md'), 'utf8'),
      readFileSync(join(TOOLING_ROOT, 'docs/design/CONCERNS.md'), 'utf8')
    );
    const patch = readFileSync(join(runDir, 'changes.patch'), 'utf8');
    assert.match(patch, /\+export const a = 2;/);
    assert.doesNotMatch(patch, /99|untracked/);
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.head, head);
    assert.equal(manifest.merge_base, base);
    assert.match(manifest.registry.concerns_sha256, /^[0-9a-f]{64}$/);
  });

  test('keeps renames, deletions, and binary files in the inventory and routes on old paths', () => {
    const { repo, base } = makeRepo({
      'src/interactive-engine/navigation.ts': 'export function navigate() {\n  return 1;\n}\n',
      'src/lib/gone.ts': 'export const gone = true;\n',
    });
    const head = commit(
      repo,
      {
        'src/interactive-engine/navigation.ts': null,
        'src/shared/navigation.ts': 'export function navigate() {\n  return 1;\n}\n',
        'src/lib/gone.ts': null,
        'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0]),
      },
      'head'
    );
    const runDir = prepared({ repo, base, head });
    const { files } = readJson(join(runDir, 'inventory.json'));
    const rename = files.find((file) => file.status === 'R');
    assert.equal(rename.old_path, 'src/interactive-engine/navigation.ts');
    assert.equal(rename.path, 'src/shared/navigation.ts');
    assert.ok(files.some((file) => file.status === 'D' && file.path === 'src/lib/gone.ts'));
    const binary = files.find((file) => file.path === 'assets/logo.png');
    assert.equal(binary.binary, true);
    assert.equal(binary.targeted_inspection.length, 1);

    const routing = readJson(join(runDir, 'candidates.json'));
    const interactive = routing.candidates.find(({ id }) => id === 'interactive-engine');
    assert.deepEqual(interactive.path_files, ['src/shared/navigation.ts']);
    assert.ok(routing.unrouted_files.includes('assets/logo.png'));
  });

  test('matches keywords literally in added and deleted lines and labels them as candidates only', () => {
    const { repo, base } = makeRepo({ 'tools/a.ts': 'const options = parser.choices([1]);\n' });
    const head = commit(repo, { 'tools/a.ts': 'const lazyLoad = true;\n', 'notes.txt': 'plain prose\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const routing = readJson(join(runDir, 'candidates.json'));
    const cli = routing.candidates.find(({ id }) => id === 'cli-and-e2e-runner');
    assert.deepEqual(cli.keyword_hits, [{ keyword: '.choices([', files: ['tools/a.ts'] }]);
    assert.equal(cli.lexical_evidence, 'keyword');
    assert.ok(!routing.candidates.some(({ id }) => id === 'performance-and-bundle'), 'lazy( must not match lazyLoad');
    assert.ok(routing.unrouted_files.includes('notes.txt'));
    assert.match(routing.note, /does not show the concern applies/);
  });

  test('selects the five always-on concerns as one checklist without a synthetic id', () => {
    const { repo, base } = makeRepo({ 'a.txt': 'a\n' });
    const head = commit(repo, { 'a.txt': 'b\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const selected = readJson(join(runDir, 'selected.json'));
    assert.deepEqual(selected.concerns, ALWAYS_ON);
    const checklist = readFileSync(join(runDir, 'context/always-on.md'), 'utf8');
    for (const id of ALWAYS_ON) {
      assert.ok(checklist.includes(`## ${id}`));
    }
  });

  test('refuses unresolvable or option-like revisions and a non-empty run directory', () => {
    const { repo, base } = makeRepo({ 'a.txt': 'a\n' });
    assert.throws(() => prepared({ repo, base, head: 'does-not-exist' }), /Cannot resolve --head/);
    assert.throws(() => prepared({ repo, base, head: '--output=/tmp/x' }), /not an option/);
    const out = freshDir('run');
    mkdirSync(out);
    writeFileSync(join(out, 'leftover'), '');
    assert.throws(() => prepare({ repo, base, head: base, 'review-key': 'k', out }), /not empty/);
  });
});

describe('context', () => {
  test('adds an indirect concern that routing did not nominate, with its contract and invariants', () => {
    const { repo, base } = makeRepo({ 'a.txt': 'a\n' });
    const head = commit(repo, { 'a.txt': 'b\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    assert.ok(!readJson(join(runDir, 'candidates.json')).candidates.some(({ id }) => id === 'completion-records'));

    const summary = addContext({ run: runDir, concerns: 'completion-records,security' });
    assert.ok(summary.selected.includes('completion-records'));
    assert.ok(summary.notes.some((note) => note.startsWith('security is always-on')));
    const packet = readFileSync(join(runDir, 'context/completion-records.md'), 'utf8');
    assert.match(packet, /Contract:/);
    assert.match(packet, /Named invariants:/);
    assert.match(packet, /Context pointers:/);
    assert.doesNotMatch(packet, /<br>/);
    assert.ok(summary.total > 0);
  });

  test('rejects unknown concern ids with the valid list', () => {
    const { repo, base } = makeRepo({ 'a.txt': 'a\n' });
    const runDir = prepared({ repo, base, head: base });
    assert.throws(
      () => addContext({ run: runDir, concerns: 'not-a-concern' }),
      /Unknown concern ID\(s\): not-a-concern\. Valid IDs: security/
    );
  });
});

describe('finish', () => {
  function interactiveRun() {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    addContext({ run: runDir, concerns: 'interactive-engine' });
    return { repo, base, head, runDir };
  }

  test('derives the headline from assessment and blocker count without changing findings', () => {
    const { runDir } = interactiveRun();
    assert.equal(finishWith(runDir, result(runDir)).headline, 'No blocking findings');
    assert.equal(finishWith(runDir, result(runDir, { findings: [followUp] })).headline, 'No blocking findings');
    const blocked = finishWith(runDir, result(runDir, { findings: [blocker, followUp] }));
    assert.equal(blocked.headline, 'Changes requested');
    assert.match(blocked.report, /outside the merge requirements/);
    assert.deepEqual(
      blocked.state.findings.map(({ id, disposition }) => [id, disposition]),
      [
        ['step-index-base', 'blocker'],
        ['step-index-test', 'follow_up'],
      ]
    );
  });

  test('rejects incomplete coverage, unknown or unselected concerns, duplicates, and missing reasons', () => {
    const { runDir } = interactiveRun();
    const cases = [
      [result(runDir, { coverage: coverageFor(runDir).slice(1) }), /missing: security/],
      [
        result(runDir, {
          coverage: [...coverageFor(runDir), { concern_id: 'nope', status: 'checked', evidence: 'x' }],
        }),
        /not a known concern/,
      ],
      [
        result(runDir, {
          coverage: [...coverageFor(runDir), { concern_id: 'go-backend', status: 'checked', evidence: 'x' }],
        }),
        /never selected/,
      ],
      [result(runDir, { findings: [blocker, blocker] }), /used more than once/],
      [
        result(runDir, { findings: [{ ...blocker, merge_reason: undefined }] }),
        /merge_reason \(required for a blocker\)/,
      ],
      [result(runDir, { findings: [{ ...followUp, next_action: '' }] }), /next_action \(required for a follow-up\)/],
      [result(runDir, { findings: [{ ...blocker, disposition: 'cosmetic' }] }), /blocker, follow_up, or nit/],
      [
        result(runDir, {
          coverage: coverageFor(runDir).map((entry) =>
            entry.concern_id === 'interactive-engine' ? { ...entry, status: 'not_applicable', evidence: 'N/A' } : entry
          ),
        }),
        /without a concrete reason/,
      ],
      [
        result(runDir, {
          coverage: coverageFor(runDir).map((entry) =>
            entry.concern_id === 'security' ? { ...entry, status: 'unresolved' } : entry
          ),
        }),
        /cannot leave coverage unresolved: security/,
      ],
      [
        result(runDir, { prior_decisions: [{ id: 'ghost', action: 'carry', evidence: 'x' }] }),
        /not an item in the trusted prior state/,
      ],
    ];
    for (const [value, pattern] of cases) {
      assert.throws(() => finishWith(runDir, value), pattern);
      assert.ok(!existsSync(join(runDir, 'report.md')), 'an invalid result leaves no derived output');
    }
  });

  test('the documented example in references/result-format.md is a valid result', () => {
    const { runDir } = interactiveRun();
    addContext({ run: runDir, concerns: 'context-engine' });
    const reference = readFileSync(fileURLToPath(new URL('../references/result-format.md', import.meta.url)), 'utf8');
    const example = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/)[1]);
    example.coverage.push({
      concern_id: 'interactive-engine',
      status: 'not_applicable',
      evidence: 'Fixture-only selection.',
    });
    const outcome = finishWith(runDir, example);
    assert.equal(outcome.headline, 'Changes requested');
    assert.deepEqual(
      outcome.state.clearances.map(({ id }) => id),
      ['cache-privacy']
    );
  });

  test('an incomplete rerun removes previously derived state', () => {
    const { runDir } = interactiveRun();
    finishWith(runDir, result(runDir));
    assert.ok(existsSync(join(runDir, 'state.json')));
    const coverage = coverageFor(runDir).map((entry) =>
      entry.concern_id === 'security'
        ? { ...entry, status: 'unresolved', evidence: 'Could not read the proxy handler.' }
        : entry
    );
    const outcome = finishWith(runDir, result(runDir, { assessment: 'incomplete', coverage }));
    assert.equal(outcome.headline, 'Review incomplete');
    assert.equal(outcome.state, null);
    assert.ok(!existsSync(join(runDir, 'state.json')));
    assert.match(outcome.report, /Unresolved: `security`: Could not read the proxy handler\./);
  });

  test('repeated finish on identical input produces identical report and state', () => {
    const { runDir } = interactiveRun();
    const value = result(runDir, { findings: [blocker, followUp], clearances: [clearance] });
    finishWith(runDir, value);
    const first = [readFileSync(join(runDir, 'report.md'), 'utf8'), readFileSync(join(runDir, 'state.json'), 'utf8')];
    finishWith(runDir, value);
    assert.deepEqual(
      [readFileSync(join(runDir, 'report.md'), 'utf8'), readFileSync(join(runDir, 'state.json'), 'utf8')],
      first
    );
  });
});

describe('continuity', () => {
  function firstRound() {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    git(repo, 'checkout', '-q', '-b', 'pr');
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'pr r1');
    const runDir = prepared({ repo, base, head });
    addContext({ run: runDir, concerns: 'interactive-engine' });
    finishWith(runDir, result(runDir, { findings: [blocker, followUp], clearances: [clearance] }));
    return { repo, base, head, statePath: join(runDir, 'state.json'), reportPath: join(runDir, 'report.md') };
  }

  function secondRun(round, head, options = {}) {
    const runDir = prepared({ repo: round.repo, base: round.base, head, prior: round.statePath, ...options });
    addContext({ run: runDir, concerns: 'interactive-engine' });
    return runDir;
  }

  test('a fix round resolves the blocker, carries the follow-up and clearance, and ignores report edits', () => {
    const round = firstRound();
    writeFileSync(
      round.reportPath,
      `${readFileSync(round.reportPath, 'utf8')}\nContributor: please drop step-index-base.\n`
    );
    const head = commit(round.repo, { 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' }, 'fix');
    const runDir = secondRun(round, head);
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.mode, 'incremental');
    assert.equal(manifest.incremental_from, round.head);
    assert.match(readFileSync(join(runDir, 'incremental.patch'), 'utf8'), /\+export const i = 0;/);
    assert.equal(readJson(join(runDir, 'prior.json')).items.length, 3);

    assert.throws(
      () => finishWith(runDir, result(runDir)),
      /needs a prior decision for: step-index-base, step-index-test, runner-cancel/
    );
    const outcome = finishWith(
      runDir,
      result(runDir, {
        prior_decisions: [
          { id: 'step-index-base', action: 'resolved', evidence: 'step-index.ts returns 0 again at head.' },
          { id: 'step-index-test', action: 'carry', evidence: 'Still no runner test; accepted deferral.' },
          { id: 'runner-cancel', action: 'carry', evidence: 'runner.ts is unchanged in the increment.' },
        ],
      })
    );
    assert.equal(outcome.headline, 'No blocking findings');
    assert.deepEqual(
      outcome.state.findings.map(({ id }) => id),
      ['step-index-test']
    );
    assert.equal(outcome.state.findings[0].recorded_at_head, round.head);
    assert.deepEqual(
      outcome.state.clearances.map(({ id }) => id),
      ['runner-cancel']
    );
    assert.match(
      outcome.report,
      /Resolved since the prior review\n\n- step-index-base: step-index.ts returns 0 again at head\./
    );
    assert.match(outcome.report, /step-index-test: .*\(carried from a prior round\)/);
    assert.match(
      outcome.report,
      /## Explicit clearances\n\n- runner-cancel \(`interactive-engine`, carried\): The runner remains cancellable\./
    );
  });

  test('a carried blocker keeps the review at changes requested', () => {
    const round = firstRound();
    const head = commit(round.repo, { 'README.md': 'docs\n' }, 'unrelated');
    const runDir = secondRun(round, head);
    const outcome = finishWith(
      runDir,
      result(runDir, {
        prior_decisions: [
          { id: 'step-index-base', action: 'carry', evidence: 'step-index.ts is unchanged.' },
          { id: 'step-index-test', action: 'carry', evidence: 'Still deferred.' },
          { id: 'runner-cancel', action: 'carry', evidence: 'runner.ts unchanged.' },
        ],
      })
    );
    assert.equal(outcome.headline, 'Changes requested');
  });

  test('a reopened clearance must reappear as an evidence-backed finding with the same id', () => {
    const round = firstRound();
    const head = commit(
      round.repo,
      { 'src/interactive-engine/runner.ts': 'export const ignoreSignal = true;\n' },
      'regress'
    );
    const runDir = secondRun(round, head);
    const decisions = [
      { id: 'step-index-base', action: 'carry', evidence: 'Unchanged.' },
      { id: 'step-index-test', action: 'carry', evidence: 'Still deferred.' },
      { id: 'runner-cancel', action: 'reopen', evidence: 'runner.ts now ignores the signal.' },
    ];
    assert.throws(
      () => finishWith(runDir, result(runDir, { prior_decisions: decisions })),
      /reopened, so findings must restate it/
    );
    const reopened = {
      ...blocker,
      id: 'runner-cancel',
      title: 'Runner ignores cancellation',
      evidence: 'runner.ts sets ignoreSignal.',
      required_invariant: 'An aborted run executes no further step.',
    };
    const outcome = finishWith(runDir, result(runDir, { prior_decisions: decisions, findings: [reopened] }));
    assert.deepEqual(outcome.state.clearances, []);
    assert.deepEqual(outcome.state.findings.map(({ id }) => id).sort(), [
      'runner-cancel',
      'step-index-base',
      'step-index-test',
    ]);
    assert.throws(
      () => finishWith(runDir, result(runDir, { prior_decisions: decisions.slice(0, 2), findings: [reopened] })),
      /belongs to a prior item; reuse it only with a reopen decision/
    );
  });

  test('rewritten history falls back to a full review that still requires reconciliation', () => {
    const round = firstRound();
    git(round.repo, 'reset', '-q', '--hard', round.base);
    const head = commit(round.repo, { 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' }, 'rewritten');
    const runDir = secondRun(round, head);
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.mode, 'full');
    assert.match(manifest.fallback_reason, /not an ancestor/);
    assert.ok(!existsSync(join(runDir, 'incremental.patch')));
    assert.throws(() => finishWith(runDir, result(runDir)), /needs a prior decision/);
  });

  test('a changed comparison base falls back to a full review', () => {
    const round = firstRound();
    git(round.repo, 'checkout', '-q', 'main');
    const newBase = commit(round.repo, { 'other.txt': 'main moved\n' }, 'main moves');
    git(round.repo, 'checkout', '-q', 'pr');
    git(round.repo, 'merge', '-q', '--no-edit', 'main');
    const head = git(round.repo, 'rev-parse', 'HEAD');
    const runDir = prepared({ repo: round.repo, base: newBase, head, prior: round.statePath });
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.mode, 'full');
    assert.match(manifest.fallback_reason, /comparison base changed/);
    assert.equal(manifest.prior_status, 'trusted');
  });

  test('a changed registry falls back to a full review', () => {
    const round = firstRound();
    const knowledge = freshDir('knowledge');
    cpSync(join(TOOLING_ROOT, 'docs/design/CONCERNS.md'), join(knowledge, 'docs/design/CONCERNS.md'));
    writeFileSync(
      join(knowledge, 'docs/design/CONCERN_DETAILS.md'),
      `${readFileSync(join(TOOLING_ROOT, 'docs/design/CONCERN_DETAILS.md'), 'utf8')}\nEdited.\n`
    );
    const head = commit(round.repo, { 'README.md': 'docs\n' }, 'unrelated');
    const runDir = prepared({ repo: round.repo, base: round.base, head, prior: round.statePath, knowledge });
    assert.match(readJson(join(runDir, 'manifest.json')).fallback_reason, /concern registry changed/);
  });

  test('state from another review key or an unsupported version supplies no decisions', () => {
    const round = firstRound();
    const head = commit(round.repo, { 'README.md': 'docs\n' }, 'unrelated');
    const otherKey = prepared({ repo: round.repo, base: round.base, head, prior: round.statePath, key: 'org/repo#2' });
    const prior = readJson(join(otherKey, 'prior.json'));
    assert.equal(prior.status, 'untrusted');
    assert.deepEqual(prior.items, []);
    assert.throws(
      () =>
        finishWith(
          otherKey,
          result(otherKey, { prior_decisions: [{ id: 'step-index-test', action: 'carry', evidence: 'x' }] })
        ),
      /supplied prior state was rejected/
    );

    const legacy = freshDir('legacy.json');
    writeFileSync(legacy, JSON.stringify({ ...readJson(round.statePath), version: 'pathfinder-review-state-v2' }));
    const legacyRun = prepared({ repo: round.repo, base: round.base, head, prior: legacy });
    assert.match(readJson(join(legacyRun, 'manifest.json')).fallback_reason, /state.version must be review-lite-v1/);
  });
});

const nit = {
  id: 'step-index-name',
  concern_id: 'testing-and-verification',
  disposition: 'nit',
  title: 'Test name overstates what it asserts',
  location: 'src/interactive-engine/step-index.test.ts:4',
  evidence: 'The name says Resume and Read but only Read is asserted.',
  next_action: 'Rename the test to say Read only.',
};

describe('nits and follow-up attribution', () => {
  function interactiveRun() {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    return { runDir };
  }

  test('nits render in their own section, never change the headline, and are not carried in state', () => {
    const { runDir } = interactiveRun();
    const outcome = finishWith(runDir, result(runDir, { findings: [nit] }));
    assert.equal(outcome.headline, 'No blocking findings');
    assert.match(outcome.report, /## Nits\n\nNits never block a merge/);
    assert.match(outcome.report, /step-index-name/);
    assert.deepEqual(outcome.state.findings, []);
  });

  test('a nit needs only a title, location, evidence, and suggested change, and at most five are allowed', () => {
    const { runDir } = interactiveRun();
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...nit, next_action: '' }] })),
      /next_action \(the suggested change, required for a nit\)/
    );
    const many = Array.from({ length: 6 }, (_, index) => ({ ...nit, id: `nit-${index}` }));
    assert.throws(() => finishWith(runDir, result(runDir, { findings: many })), /at most 5 nits/);
  });

  test('a follow-up must say whether the PR introduced, newly exposed, or inherited the gap', () => {
    const { runDir } = interactiveRun();
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...followUp, attribution: undefined }] })),
      /attribution must be one of introduced, newly_exposed, pre_existing/
    );
    const outcome = finishWith(runDir, result(runDir, { findings: [{ ...followUp, attribution: 'introduced' }] }));
    assert.equal(outcome.state.findings[0].attribution, 'introduced');
  });
});

describe('follow-up calibration and test scope', () => {
  test('a follow-up must say which blocker trigger it checked', () => {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...followUp, why_not_blocker: undefined }] })),
      /why_not_blocker/
    );
    const outcome = finishWith(runDir, result(runDir, { findings: [followUp] }));
    assert.match(outcome.report, /Why not a blocker: No documented invariant is violated/);
    assert.equal(outcome.state.findings[0].why_not_blocker, followUp.why_not_blocker);
  });

  test('changed_hunks scope is only allowed for a test file over 400 changed lines', () => {
    const big = `${Array.from({ length: 450 }, (_, index) => `test('t${index}', () => {});`).join('\n')}\n`;
    const { repo, base } = makeRepo({
      'src/interactive-engine/small.test.ts': "test('a', () => {});\n",
      'src/interactive-engine/big.test.ts': "test('a', () => {});\n",
    });
    const head = commit(
      repo,
      { 'src/interactive-engine/small.test.ts': "test('b', () => {});\n", 'src/interactive-engine/big.test.ts': big },
      'head'
    );
    const runDir = prepared({ repo, base, head });
    const smallPath = 'src/interactive-engine/small.test.ts';
    const bigPath = 'src/interactive-engine/big.test.ts';
    const entry = (path, scope) => ({
      path,
      read: true,
      scope,
      assertions_checked: 'Every new test asserts something.',
    });
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests: [entry(smallPath, 'changed_hunks'), entry(bigPath, 'full')] })),
      /changed_hunks is only allowed for a test file with more than 400 changed lines/
    );
    assert.throws(
      () =>
        finishWith(
          runDir,
          result(runDir, { tests: [{ ...entry(smallPath, 'full'), scope: undefined }, entry(bigPath, 'full')] })
        ),
      /scope must be one of full, changed_hunks/
    );
    const outcome = finishWith(
      runDir,
      result(runDir, { tests: [entry(smallPath, 'full'), entry(bigPath, 'changed_hunks')] })
    );
    assert.match(outcome.report, /Test files read: 2 of 2 \(1 by changed hunks, large files\)/);
  });
});

describe('test review', () => {
  function testedRun() {
    const { repo, base } = makeRepo({
      'src/interactive-engine/step-index.ts': 'export const i = 0;\n',
      'src/interactive-engine/step-index.test.ts': "test('a', () => {});\n",
    });
    const head = commit(
      repo,
      {
        'src/interactive-engine/step-index.ts': 'export const i = 1;\n',
        'src/interactive-engine/step-index.test.ts': "test('a', () => { expect(1).toBe(1); });\n",
      },
      'head'
    );
    return { runDir: prepared({ repo, base, head }) };
  }

  test('a complete assessment must account for every changed test file', () => {
    const { runDir } = testedRun();
    assert.throws(
      () => finishWith(runDir, result(runDir)),
      /needs a tests entry for every changed test file.*step-index\.test\.ts/
    );
    const path = 'src/interactive-engine/step-index.test.ts';
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests: [{ path, read: true, scope: 'full' }] })),
      /assertions_checked/
    );
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests: [{ path, read: false, reason_kind: 'generated' }] })),
      /reason \(why this test file was not read in full\)/
    );
    assert.throws(
      () =>
        finishWith(
          runDir,
          result(runDir, { tests: [{ path: 'src/other.test.ts', read: true, scope: 'full', assertions_checked: 'x' }] })
        ),
      /not a changed test file in this run/
    );
  });

  test('an unread test file needs a closed reason_kind and may not cite effort, time, or size', () => {
    const { runDir } = testedRun();
    const path = 'src/interactive-engine/step-index.test.ts';
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests: [{ path, read: false, reason: 'Generated fixture.' }] })),
      /reason_kind must be one of binary, generated, not_in_head, tooling_blocked/
    );
    assert.throws(
      () =>
        finishWith(
          runDir,
          result(runDir, { tests: [{ path, read: false, reason_kind: 'effort', reason: 'Skipped to save effort.' }] })
        ),
      /reason_kind must be one of/
    );
    assert.throws(
      () =>
        finishWith(
          runDir,
          result(runDir, {
            tests: [{ path, read: false, reason_kind: 'generated', reason: 'Skipped to save time, file is large.' }],
          })
        ),
      /cites effort, time, or size/
    );
    for (const reason_kind of ['binary', 'generated', 'not_in_head', 'tooling_blocked']) {
      finishWith(runDir, result(runDir, { tests: [{ path, read: false, reason_kind, reason: 'Not readable here.' }] }));
    }
  });

  test('the report states how many test files were read and lists the unread ones as limitations', () => {
    const { runDir } = testedRun();
    const path = 'src/interactive-engine/step-index.test.ts';
    const read = finishWith(
      runDir,
      result(runDir, {
        tests: [
          { path, read: true, scope: 'full', assertions_checked: 'expect(1).toBe(1) cannot fail, so it pins nothing.' },
        ],
      })
    );
    assert.match(read.report, /Test files read: 1 of 1/);
    const unread = finishWith(
      runDir,
      result(runDir, { tests: [{ path, read: false, reason_kind: 'generated', reason: 'Generated fixture.' }] })
    );
    assert.match(unread.report, /Test files read: 0 of 1/);
    assert.match(
      unread.report,
      /Limitation: test file .*step-index\.test\.ts was not read in full: Generated fixture\./
    );
  });
});

describe('test file classification', () => {
  test('treats an e2e directory under src as production code, and a tests directory as tests', () => {
    const { repo, base } = makeRepo({
      'src/cli/e2e/a.ts': 'export const a = 1;\n',
      'tests/e2e-runner/b.ts': 'export const b = 1;\n',
    });
    const head = commit(
      repo,
      { 'src/cli/e2e/a.ts': 'export const a = 2;\n', 'tests/e2e-runner/b.ts': 'export const b = 2;\n' },
      'head'
    );
    const runDir = prepared({ repo, base, head });
    addContext({ run: runDir, concerns: 'cli-and-e2e-runner' });
    assert.throws(
      () => finishWith(runDir, result(runDir)),
      (error) => /tests\/e2e-runner\/b\.ts/.test(error.message) && !/src\/cli\/e2e\/a\.ts/.test(error.message)
    );
  });
});

describe('sync scan and delta triggers', () => {
  function syncRun(baseFiles, headFiles) {
    const { repo, base } = makeRepo(baseFiles);
    const head = commit(repo, headFiles, 'head');
    const runDir = prepared({ repo, base, head });
    return {
      sync: readJson(join(runDir, 'sync-hits.json')),
      delta: readJson(join(runDir, 'delta-triggers.json')),
      manifest: readJson(join(runDir, 'manifest.json')),
    };
  }

  test('nominates a doc line in a changed doc that contradicts the change', () => {
    const { sync, manifest } = syncRun(
      {
        'docs/telemetry.md': 'path_id is sent for public paths.\nOther text.\n',
        'src/analytics.ts': 'export const props = { path_id: 1 };\n',
      },
      {
        'docs/telemetry.md': 'path_id is sent for public paths.\nMore text.\nMilestones send path_id for every path.\n',
        'src/analytics.ts': 'export const props = { path_id: 1, other_thing: 2 };\n',
      }
    );
    const hit = sync.hits.find(
      (entry) => entry.term === 'path_id' && entry.classification === 'doc-line-in-changed-file'
    );
    assert.ok(hit, JSON.stringify(sync.hits));
    assert.equal(hit.path, 'docs/telemetry.md');
    assert.equal(hit.line, 1);
    assert.equal(manifest.artifacts.sync_hits, 'sync-hits.json');
  });

  test('nominates a removed term that head still references', () => {
    const { sync } = syncRun(
      { 'src/flags.ts': "export const OLD_FLAG_NAME = 'a';\n", 'docs/flags.md': 'Set OLD_FLAG_NAME to enable.\n' },
      { 'src/flags.ts': "export const NEW_FLAG_NAME = 'a';\n", 'docs/flags.md': 'Set OLD_FLAG_NAME to enable.\n' }
    );
    assert.ok(
      sync.hits.some((entry) => entry.classification === 'stale-reference' && entry.path === 'docs/flags.md'),
      JSON.stringify(sync.hits)
    );
  });

  test('nominates an unchanged line that shares a new literal in another place of the same changed file', () => {
    const { sync } = syncRun(
      { '.github/workflows/ci.yml': 'name: ci\njobs:\n  e2e:\n    name: e2e test x\n' },
      {
        '.github/workflows/ci.yml':
          'name: ci\njobs:\n  e2e:\n    name: e2e test x\n  notify:\n    run: jq \'startswith("e2e test ")\'\n',
      }
    );
    assert.ok(
      sync.hits.some(
        (entry) => entry.classification === 'config-line-in-changed-file' && entry.text.includes('name: e2e test x')
      ),
      JSON.stringify(sync.hits)
    );
  });

  test('flags a doc that lists a key but not the value the change newly emits', () => {
    const { sync } = syncRun(
      {
        'docs/telemetry.md': 'interaction_location is one of `card` or `header`.\n',
        'src/panel.ts': "report({ interaction_location: 'card' });\n",
      },
      {
        'docs/telemetry.md': 'interaction_location is one of `card` or `header`.\n',
        'src/panel.ts':
          "report({ interaction_location: 'card' });\nreport({ interaction_location: 'hub_resume_card' });\n",
      }
    );
    assert.deepEqual(sync.doc_gaps, [
      { key: 'interaction_location', missing_value: 'hub_resume_card', docs: ['docs/telemetry.md'] },
    ]);
  });

  test('stays quiet when nothing else mentions the change', () => {
    const { sync } = syncRun({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' });
    assert.deepEqual(sync.hits, []);
    assert.deepEqual(sync.doc_gaps, []);
  });

  test('raises behavior-delta triggers for workflow ordering, flag reads, and substantial new views', () => {
    const view = `${Array.from({ length: 45 }, (_, index) => `const a${index} = ${index};`).join('\n')}\n`;
    const { delta } = syncRun(
      {
        '.github/workflows/ci.yml': 'jobs:\n  notify:\n    needs: [a]\n',
        'src/panel.tsx': 'export const A = 1;\n',
      },
      {
        '.github/workflows/ci.yml': 'jobs:\n  notify:\n    needs: [a, b]\n',
        'src/panel.tsx': `import { useBooleanFlag } from './flags';\n${view}`,
      }
    );
    assert.deepEqual(delta.triggers.map(({ id, paths }) => [id, paths]).sort(), [
      ['flag-parity', ['src/panel.tsx']],
      ['ordering-and-timing', ['.github/workflows/ci.yml']],
      ['render-states', ['src/panel.tsx']],
    ]);
  });
});

describe('default and lifecycle triggers', () => {
  function triggersFor(baseFiles, headFiles) {
    const { repo, base } = makeRepo(baseFiles);
    const head = commit(repo, headFiles, 'head');
    const runDir = prepared({ repo, base, head });
    return readJson(join(runDir, 'delta-triggers.json')).triggers.map(({ id, paths }) => [id, paths]);
  }

  test('flags a changed default and a new lease with release paths, and ignores tests and docs', () => {
    const triggers = triggersFor(
      { 'src/a.ts': 'export const a = 1;\n', 'src/a.test.ts': 'test("x", () => {});\n', 'docs/a.md': 'a\n' },
      {
        'src/a.ts':
          "export const DEFAULT_KIOSK_URL = 'x';\nexport function run() { const lease = acquireLease(); return () => releaseLease(lease); }\n",
        'src/a.test.ts': "const DEFAULT_URL = 'x'; acquireLease(); releaseLease();\n",
        'docs/a.md': 'DEFAULT_KIOSK_URL acquireLease releaseLease\n',
      }
    );
    assert.deepEqual(triggers.sort(), [
      ['default-behavior', ['src/a.ts']],
      ['lifecycle-ownership', ['src/a.ts']],
    ]);
  });

  test('one ownership word alone does not raise a lifecycle trigger', () => {
    assert.deepEqual(
      triggersFor({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const lock = 1;\n' }),
      []
    );
  });
});

describe('command line', () => {
  test('every subcommand prints help with a runnable example', () => {
    for (const command of ['prepare', 'context', 'finish']) {
      const output = run([command, '--help']);
      assert.equal(output.status, 0);
      assert.match(output.stdout, new RegExp(`Example:\\n  node .*review-lite\\.mjs ${command}`));
    }
  });

  test('reports usage errors clearly with exit code 2', () => {
    const missing = run(['finish', '--run', '/abs/run']);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Missing --input/);
    const relative = run(['context', '--run', 'relative', '--concerns', 'security']);
    assert.equal(relative.status, 2);
    assert.match(relative.stderr, /must be an absolute path/);
    assert.equal(run(['publish']).status, 2);
  });
});
