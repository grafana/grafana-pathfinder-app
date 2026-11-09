import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addContext,
  finish,
  fullReadLines,
  prepare,
  readPinnedFile,
  TEST_LINE_BUDGET,
  validateState,
} from './review-lite.mjs';

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

function prepared({ repo, base, head, prior, key = 'org/repo#1', knowledge, round = 1 }) {
  const out = freshDir('run');
  prepare({ repo, base, head, 'review-key': key, out, prior, knowledge, round });
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
    checks: readJson(join(runDir, 'obligations.json')).map(({ id, concern_id, obligation }) => ({
      id,
      status: concern_id || ['governing_input', 'risk_verification'].includes(obligation) ? 'irrelevant' : 'checked',
      evidence: 'Fixture inspection found no affected contract or behavior.',
    })),
    findings: [],
    prior_decisions: [],
    clearances: [],
    ...overrides,
  };
}

function finishWith(runDir, value) {
  if (!value.no_read_receipts) {
    for (const entry of value.tests ?? []) {
      if (!entry.read) {
        continue;
      }
      let range;
      do {
        const read = readPinnedFile({ run: runDir, path: entry.path, scope: entry.scope, range });
        range = read.next;
      } while (range);
    }
  }
  delete value.no_read_receipts;
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
const separateWork = {
  id: 'step-index-test',
  concern_id: 'testing-and-verification',
  disposition: 'separate_work',
  attribution: 'pre_existing',
  deferral_basis: 'pre_existing',
  deferral_reason:
    'The PR does not worsen this pre-existing test gap; the maintainer may track a runner test separately.',
  title: 'No test pins the runner and index helper together',
  location: 'src/interactive-engine/runner.ts',
  evidence: 'Only the helper has a unit test.',
  consequence: 'A future base change could regress silently.',
  base_comparison: 'Base had the same gap at src/interactive-engine/runner.ts:40; the PR does not touch stored state.',
  next_action: 'Maintainer: add a runner test that executes the first step.',
};
const clearance = {
  id: 'runner-cancel',
  concern_id: 'interactive-engine',
  claim: 'The runner remains cancellable.',
  evidence: 'AbortSignal is still checked before each step in runner.ts.',
};

describe('prepare', () => {
  test('requires a valid round even without prior state', () => {
    const { repo, base } = makeRepo({ 'README.md': 'base\n' });
    for (const round of [undefined, 0, -1, 1.5, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => prepare({ repo, base, head: base, round, out: freshDir('invalid') }), /--round/);
    }
    const runDir = prepared({ repo, base, head: base, round: 3 });
    assert.equal(readJson(join(runDir, 'manifest.json')).mode, 'full');
    const outcome = finishWith(runDir, result(runDir));
    assert.equal(outcome.state.round, 3);
    assert.match(outcome.report, /Round: 3/);
    const legacy = { ...outcome.state };
    delete legacy.round;
    assert.deepEqual(validateState(legacy), []);
    writeFileSync(join(runDir, 'state.json'), JSON.stringify(legacy));
    const next = prepared({ repo, base, head: base, prior: join(runDir, 'state.json'), round: 4 });
    assert.equal(readJson(join(next, 'manifest.json')).prior_status, 'trusted');
    assert.equal(finishWith(next, result(next)).state.round, 4);
    assert.match(validateState({ ...legacy, round: 0 }).join(), /state.round/);
  });

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
    assert.throws(() => prepare({ repo, base, head: base, 'review-key': 'k', round: 1, out }), /not empty/);
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

  test('turns reviewer-discovered governing inputs into normalized required obligations', () => {
    const { repo, base } = makeRepo({ 'src/engine.ts': 'export const v = 1;\n', 'contracts/api.md': 'version one\n' });
    const head = commit(repo, { 'src/engine.ts': 'export const v = 2;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const input = join(runDir, 'governing.json');
    writeFileSync(
      input,
      JSON.stringify([
        {
          id: 'api-contract',
          obligation: 'risk_verification',
          kind: 'normative_spec',
          source: 'head:contracts/api.md',
          reason: 'The PR description cites this unchanged compatibility contract.',
        },
      ])
    );
    addContext({ run: runDir, concerns: 'security', governing: input });
    const obligation = readJson(join(runDir, 'obligations.json')).find(({ id }) => id === 'governing:api-contract');
    assert.deepEqual(obligation, {
      id: 'governing:api-contract',
      obligation: 'governing_input',
      kind: 'normative_spec',
      source: 'head:contracts/api.md',
      reason: 'The PR description cites this unchanged compatibility contract.',
    });
    const checks = result(runDir).checks.map((check) =>
      check.id === obligation.id
        ? { ...check, status: 'unresolved', evidence: 'The contract host was unavailable.' }
        : check
    );
    assert.throws(
      () => finishWith(runDir, result(runDir, { checks })),
      /cannot leave governing:api-contract unresolved/
    );
  });

  test('turns a reviewer-discovered risk into a required verification obligation', () => {
    const { repo, base } = makeRepo({ 'src/engine.ts': 'export const v = 1;\n' });
    const head = commit(repo, { 'src/engine.ts': 'export const v = 2;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const input = join(runDir, 'risk.json');
    writeFileSync(
      input,
      JSON.stringify([
        { id: 'reload', category: 'compatibility retry', reason: 'The PR description names a reload path.' },
      ])
    );
    addContext({ run: runDir, concerns: 'security', risk: input });
    const obligation = readJson(join(runDir, 'obligations.json')).find(({ id }) => id === 'risk:reload');
    assert.deepEqual(obligation, {
      id: 'risk:reload',
      obligation: 'risk_verification',
      category: 'compatibility retry',
      reason: 'The PR description names a reload path.',
    });
    assert.throws(
      () =>
        finishWith(runDir, result(runDir, { checks: result(runDir).checks.filter(({ id }) => id !== obligation.id) })),
      /missing inspection decision: risk:reload/
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
    assert.equal(finishWith(runDir, result(runDir)).headline, 'Approve');
    assert.equal(finishWith(runDir, result(runDir, { findings: [separateWork] })).headline, 'Approve');
    const blocked = finishWith(runDir, result(runDir, { findings: [blocker, separateWork] }));
    assert.equal(blocked.headline, 'Changes requested');
    assert.doesNotMatch(blocked.report, /Separate work|Maintainer next action/);
    assert.match(readFileSync(join(runDir, 'maintainer-queue.md'), 'utf8'), /outside the author approval report/);
    assert.deepEqual(
      blocked.state.findings.map(({ id, disposition }) => [id, disposition]),
      [
        ['step-index-base', 'blocker'],
        ['step-index-test', 'separate_work'],
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
      [
        result(runDir, { findings: [{ ...separateWork, next_action: '' }] }),
        /next_action \(required for separate work\)/,
      ],
      [
        result(runDir, { findings: [{ ...blocker, disposition: 'cosmetic' }] }),
        /blocker, separate_work, suggestion, or nit/,
      ],
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
    example.checks = result(runDir).checks;
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

  test('a failed finish removes previously derived report and state', () => {
    const { runDir } = interactiveRun();
    finishWith(runDir, result(runDir));
    assert.ok(existsSync(join(runDir, 'report.md')));
    assert.ok(existsSync(join(runDir, 'state.json')));
    writeFileSync(join(runDir, 'result.json'), '{not json');
    assert.throws(() => finish({ run: runDir, input: join(runDir, 'result.json') }), /is not valid JSON/);
    assert.ok(!existsSync(join(runDir, 'report.md')));
    assert.ok(!existsSync(join(runDir, 'state.json')));
  });

  test('repeated finish on identical input produces identical report and state', () => {
    const { runDir } = interactiveRun();
    const value = result(runDir, { findings: [blocker, separateWork], clearances: [clearance] });
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
    finishWith(runDir, result(runDir, { findings: [blocker, separateWork], clearances: [clearance] }));
    return { repo, base, head, statePath: join(runDir, 'state.json'), reportPath: join(runDir, 'report.md') };
  }

  function secondRun(round, head, options = {}) {
    const runDir = prepared({ repo: round.repo, base: round.base, head, prior: round.statePath, round: 2, ...options });
    addContext({ run: runDir, concerns: 'interactive-engine' });
    return runDir;
  }

  test('a fix round resolves the blocker, carries separate work and clearance, and ignores report edits', () => {
    const round = firstRound();
    writeFileSync(
      round.reportPath,
      `${readFileSync(round.reportPath, 'utf8')}\nContributor: please drop step-index-base.\n`
    );
    const head = commit(round.repo, { 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' }, 'fix');
    const runDir = secondRun(round, head);
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.mode, 'incremental');
    assert.equal(manifest.round, 2);
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
          { id: 'step-index-test', action: 'carry', evidence: 'Still no runner test; maintainer-owned separate work.' },
          { id: 'runner-cancel', action: 'carry', evidence: 'runner.ts is unchanged in the increment.' },
        ],
      })
    );
    assert.equal(outcome.headline, 'Approve');
    assert.deepEqual(
      outcome.state.findings.map(({ id }) => id),
      ['step-index-test']
    );
    assert.equal(outcome.state.round, 2);
    assert.match(outcome.report, /Round: 2/);
    assert.equal(outcome.state.findings[0].recorded_at_head, round.head);
    assert.deepEqual(
      outcome.state.clearances.map(({ id }) => id),
      ['runner-cancel']
    );
    assert.match(
      outcome.report,
      /Resolved since the prior review\n\n- step-index-base: step-index.ts returns 0 again at head\./
    );
    assert.match(
      readFileSync(join(runDir, 'maintainer-queue.md'), 'utf8'),
      /step-index-test: .*\(carried from a prior round\)/
    );
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
          { id: 'step-index-test', action: 'carry', evidence: 'Still maintainer-owned separate work.' },
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
      { id: 'step-index-test', action: 'carry', evidence: 'Still maintainer-owned separate work.' },
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

  test('deferring an unresolved blocker preserves its ID and changes the verdict', () => {
    const prior = firstRound();
    const runDir = secondRun(prior, prior.head, { round: 3 });
    const deferred = {
      ...blocker,
      disposition: 'separate_work',
      attribution: 'introduced',
      deferral_basis: 'late_round_convergence',
      deferral_reason: 'This round-three fixture models a deliberate convergence decision with evidence.',
      next_action: 'Maintainer: track the remaining fix separately.',
    };
    const outcome = finishWith(
      runDir,
      result(runDir, {
        findings: [deferred],
        prior_decisions: [
          { id: blocker.id, action: 'reopen', evidence: 'Unfixed; explicitly deferred.' },
          { id: separateWork.id, action: 'carry', evidence: 'Still maintainer-owned separate work.' },
          { id: clearance.id, action: 'carry', evidence: 'Unchanged and rechecked.' },
        ],
      })
    );
    assert.equal(outcome.headline, 'Approve');
    assert.equal(outcome.state.round, 3);
    assert.equal(outcome.state.findings.find(({ id }) => id === blocker.id).disposition, 'separate_work');
  });

  test('rewritten history falls back to a full review that still requires reconciliation', () => {
    const round = firstRound();
    git(round.repo, 'reset', '-q', '--hard', round.base);
    const head = commit(round.repo, { 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' }, 'rewritten');
    const runDir = secondRun(round, head);
    const manifest = readJson(join(runDir, 'manifest.json'));
    assert.equal(manifest.mode, 'full');
    assert.match(manifest.fallback_reason, /not an ancestor/);
    assert.equal(manifest.round, 2);
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

  test('a trusted legacy follow-up carries visibly without being silently reclassified', () => {
    const round = firstRound();
    const legacy = readJson(round.statePath);
    const finding = legacy.findings.find(({ id }) => id === separateWork.id);
    finding.disposition = 'follow_up';
    finding.why_not_blocker = 'Legacy review deferred this pre-existing test gap.';
    delete finding.deferral_basis;
    delete finding.deferral_reason;
    const legacyPath = freshDir('legacy-follow-up.json');
    writeFileSync(legacyPath, JSON.stringify(legacy));
    const head = commit(round.repo, { 'README.md': 'docs\n' }, 'unrelated');
    const runDir = prepared({ repo: round.repo, base: round.base, head, prior: legacyPath, round: 2 });
    addContext({ run: runDir, concerns: 'interactive-engine' });
    const outcome = finishWith(
      runDir,
      result(runDir, {
        prior_decisions: [
          { id: blocker.id, action: 'carry', evidence: 'The required fix is unchanged.' },
          { id: separateWork.id, action: 'carry', evidence: 'The legacy deferral remains unchanged.' },
          { id: clearance.id, action: 'carry', evidence: 'The cancellation check is unchanged.' },
        ],
      })
    );
    assert.equal(outcome.state.findings.find(({ id }) => id === separateWork.id).disposition, 'follow_up');
    assert.match(
      readFileSync(join(runDir, 'maintainer-queue.md'), 'utf8'),
      /Legacy follow-up retained without a new deferral basis/
    );
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

describe('optional suggestions and separate-work attribution', () => {
  function interactiveRun() {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    return { runDir };
  }

  test('optional suggestions render separately, never change the headline, and are not carried in state', () => {
    const { runDir } = interactiveRun();
    const outcome = finishWith(runDir, result(runDir, { findings: [nit] }));
    assert.equal(outcome.headline, 'Approve');
    assert.match(outcome.report, /## Optional suggestions\n\nThese are optional and do not change the merge decision/);
    assert.match(outcome.report, /step-index-name/);
    assert.deepEqual(outcome.state.findings, []);
  });

  test('a nit needs only a title, location, evidence, and suggested change, and at most five are allowed', () => {
    const { runDir } = interactiveRun();
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...nit, next_action: '' }] })),
      /next_action \(the suggested change, required for a nit\)/
    );
    const many = Array.from({ length: 6 }, (_, index) => ({
      ...nit,
      id: `nit-${index}`,
      disposition: index % 2 ? 'suggestion' : 'nit',
    }));
    assert.throws(() => finishWith(runDir, result(runDir, { findings: many })), /at most 5 optional suggestions/);
  });

  test('separate work must say whether the PR introduced, newly exposed, or inherited the gap', () => {
    const { runDir } = interactiveRun();
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...separateWork, attribution: undefined }] })),
      /attribution must be one of introduced, newly_exposed, pre_existing/
    );
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...separateWork, attribution: 'introduced' }] })),
      /deferral_basis pre_existing requires attribution pre_existing/
    );
  });
});

describe('separate-work calibration and test scope', () => {
  test('separate work must have an explicit allowed basis and stays maintainer-owned', () => {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [{ ...separateWork, deferral_reason: undefined }] })),
      /deferral_reason/
    );
    const outcome = finishWith(runDir, result(runDir, { findings: [separateWork] }));
    assert.doesNotMatch(outcome.report, /Separate work|Maintainer next action/);
    assert.match(readFileSync(join(runDir, 'maintainer-queue.md'), 'utf8'), /Maintainer next action/);
    assert.equal(outcome.state.findings[0].deferral_basis, 'pre_existing');
  });

  test('pre_existing separate work must cite the base code as path:line, not just say same as base', () => {
    const { repo, base } = makeRepo({ 'src/interactive-engine/step-index.ts': 'export const i = 0;\n' });
    const head = commit(repo, { 'src/interactive-engine/step-index.ts': 'export const i = 1;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    for (const bare of ['Same as base.', 'Base had the same gap.', 'See file.ts for details.']) {
      assert.throws(
        () => finishWith(runDir, result(runDir, { findings: [{ ...separateWork, base_comparison: bare }] })),
        /base_comparison must cite the base code as path:line/
      );
    }
    finishWith(runDir, result(runDir, { findings: [separateWork] }));
    const inScope = { ...separateWork, attribution: 'introduced', deferral_basis: 'pre_existing' };
    assert.throws(
      () => finishWith(runDir, result(runDir, { findings: [inScope] })),
      /requires attribution pre_existing/
    );
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

describe('run-level test budget', () => {
  const body = (lines, tag) =>
    `${Array.from({ length: lines }, (_, i) => `test('${tag}${i}', () => {});`).join('\n')}\n`;
  const entry = (path) => ({ path, read: true, scope: 'changed_hunks', assertions_checked: 'Every new test asserts.' });

  function suite(fileCount, linesEach) {
    const names = Array.from({ length: fileCount }, (_, i) => `src/interactive-engine/t${i}.test.ts`);
    const { repo, base } = makeRepo(Object.fromEntries(names.map((name) => [name, "test('a', () => {});\n"])));
    const head = commit(repo, Object.fromEntries(names.map((name, i) => [name, body(linesEach, `t${i}-`)])), 'head');
    return { names, runDir: prepared({ repo, base, head }) };
  }

  test('allows changed_hunks on any test file once the files read in full pass the budget', () => {
    const { names, runDir } = suite(4, Math.ceil(TEST_LINE_BUDGET / 4) + 20);
    assert.ok(fullReadLines(readJson(join(runDir, 'inventory.json'))) > TEST_LINE_BUDGET);
    const outcome = finishWith(runDir, result(runDir, { tests: names.map(entry) }));
    assert.match(outcome.report, /Test files read: 4 of 4 \(4 by changed hunks/);
  });

  test('keeps the per-file rule below the budget', () => {
    const { names, runDir } = suite(3, 100);
    assert.ok(fullReadLines(readJson(join(runDir, 'inventory.json'))) <= TEST_LINE_BUDGET);
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests: names.map(entry) })),
      /changed_hunks is only allowed for a test file with more than 400 changed lines/
    );
  });

  test('files already over 400 lines do not count toward the budget', () => {
    const { runDir } = suite(2, 900);
    assert.equal(fullReadLines(readJson(join(runDir, 'inventory.json'))), 0);
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
      /not a changed, readable test file in this run/
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

  test('a wholly added test file cannot be completed from a partial or absent pinned read', () => {
    const body = `${Array.from({ length: 450 }, (_, index) => `test('case-${index}', () => expect(${index}).toBe(${index}));`).join('\n')}\n`;
    const { repo, base } = makeRepo({ 'src/engine.ts': 'export const v = 1;\n' });
    const head = commit(repo, { 'src/engine.ts': 'export const v = 2;\n', 'src/engine.test.ts': body }, 'head');
    const runDir = prepared({ repo, base, head });
    const tests = [
      {
        path: 'src/engine.test.ts',
        read: true,
        scope: 'changed_hunks',
        assertions_checked: 'Each assertion would fail if its matching value changed.',
      },
    ];
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests, no_read_receipts: true })),
      /needs pinned read receipts covering every changed head range/
    );
    const first = readPinnedFile({ run: runDir, path: 'src/engine.test.ts', scope: 'changed_hunks' });
    assert.match(first.next, /^\d+:\d+$/);
    assert.throws(
      () => finishWith(runDir, result(runDir, { tests, no_read_receipts: true })),
      /needs pinned read receipts covering every changed head range/
    );
    assert.equal(finishWith(runDir, result(runDir, { tests })).headline, 'Approve');
  });
  test('a large test file whose pages hit the byte cap can be completed by following next', () => {
    const filler = 'x'.repeat(180);
    const body = `${Array.from({ length: 450 }, (_, index) => `test('case-${index}', () => expect('${filler}').toBe('${filler}'));`).join('\n')}\n`;
    const { repo, base } = makeRepo({ 'src/engine.ts': 'export const v = 1;\n' });
    const head = commit(repo, { 'src/engine.ts': 'export const v = 2;\n', 'src/engine.test.ts': body }, 'head');
    const runDir = prepared({ repo, base, head });
    const first = readPinnedFile({ run: runDir, path: 'src/engine.test.ts', scope: 'changed_hunks' });
    assert.equal(first.receipt.truncated, true);
    const tests = [
      {
        path: 'src/engine.test.ts',
        read: true,
        scope: 'changed_hunks',
        assertions_checked: 'Each assertion would fail if its matching value changed.',
      },
    ];
    assert.equal(finishWith(runDir, result(runDir, { tests })).headline, 'Approve');
  });

  test('following next on changed hunks skips the unchanged lines between hunks', () => {
    const line = (index, value) => `test('case-${index}', () => expect(${value}).toBe(${value}));`;
    const lines = (value) => Array.from({ length: 3000 }, (_, index) => line(index, index < 410 || index === 2900 ? value : 0));
    const { repo, base } = makeRepo({ 'src/engine.test.ts': `${lines(0).join('\n')}\n` });
    const head = commit(repo, { 'src/engine.test.ts': `${lines(1).join('\n')}\n` }, 'head');
    const runDir = prepared({ repo, base, head });
    const starts = [];
    let range;
    do {
      const read = readPinnedFile({ run: runDir, path: 'src/engine.test.ts', scope: 'changed_hunks', range });
      starts.push(read.receipt.ranges[0].start);
      range = read.next;
    } while (range);
    assert.deepEqual(starts, [1, 201, 401, 2901]);
    const tests = [
      {
        path: 'src/engine.test.ts',
        read: true,
        scope: 'changed_hunks',
        assertions_checked: 'Each assertion would fail if its matching value changed.',
      },
    ];
    assert.equal(finishWith(runDir, result(runDir, { tests, no_read_receipts: true })).headline, 'Approve');
  });

  test('a renamed test file with no content hunks can be completed with changed_hunks scope', () => {
    const body = (name) =>
      `${Array.from({ length: 350 }, (_, index) => `test('${name}-${index}', () => expect(${index}).toBe(${index}));`).join('\n')}\n`;
    const { repo, base } = makeRepo({ 'src/old.test.ts': body('old') });
    const added = Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [`src/${name}.test.ts`, body(name)]));
    const head = commit(repo, { 'src/old.test.ts': null, 'src/renamed.test.ts': body('old'), ...added }, 'head');
    const runDir = prepared({ repo, base, head });
    const tests = [
      ...Object.keys(added).map((path) => ({ path, read: false, reason_kind: 'generated', reason: 'Generated fixture.' })),
      {
        path: 'src/renamed.test.ts',
        read: true,
        scope: 'changed_hunks',
        assertions_checked: 'The rename changes no assertion.',
      },
    ];
    assert.equal(finishWith(runDir, result(runDir, { tests })).headline, 'Approve');
  });
});

describe('governing and risk obligations', () => {
  test('an external governing source must carry a revision pin as a whole URL segment', () => {
    const { repo, base } = makeRepo({ 'src/engine.ts': 'export const v = 1;\n' });
    const head = commit(repo, { 'src/engine.ts': 'export const v = 2;\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const input = join(runDir, 'governing.json');
    writeFileSync(
      input,
      JSON.stringify([
        { id: 'schema', kind: 'external_schema', source: 'https://schemas.example.invalid', reason: 'Cited schema.' },
      ])
    );
    addContext({ run: runDir, concerns: 'security', governing: input });
    const withSource = (source, pin) =>
      result(runDir).checks.map((check) =>
        check.id === 'governing:schema'
          ? {
              ...check,
              status: 'checked',
              governing: { kind: 'external_schema', source, pin, applicability: 'Defines the loaded shape.' },
            }
          : check
      );
    for (const [source, pin] of [
      ['https://schemas.example.invalid/packages/v2/latest', 'schemas'],
      ['https://schemas.example.invalid/packages/v2/latest', 'https:/'],
      ['https://schemas.example.invalid/packages/v2/9f4a3b7e', '9f4a3b7'],
      ['http://schemas.example.invalid/packages/9f4a3b7', '9f4a3b7'],
    ]) {
      assert.throws(
        () => finishWith(runDir, result(runDir, { checks: withSource(source, pin) })),
        /governing source and pin must resolve/,
        `${source} with pin ${pin}`
      );
    }
    for (const [source, pin] of [
      ['https://schemas.example.invalid/packages/v2/9f4a3b7', '9f4a3b7'],
      ['https://schemas.example.invalid/packages/schema.json?ref=v2.1.0', 'v2.1.0'],
    ]) {
      assert.equal(finishWith(runDir, result(runDir, { checks: withSource(source, pin) })).headline, 'Approve');
    }
  });

  test('a generated risk obligation cannot disappear and checked verification needs falsifying evidence', () => {
    const { repo, base } = makeRepo({ 'src/store.ts': 'export const current = 0;\n' });
    const head = commit(repo, { 'src/store.ts': 'export const saveProgress = () => write();\n' }, 'head');
    const runDir = prepared({ repo, base, head });
    const risk = readJson(join(runDir, 'obligations.json')).find(
      ({ obligation }) => obligation === 'risk_verification'
    );
    assert.ok(risk, 'persistence change should nominate a risk verification');
    const baseline = result(runDir).checks;
    assert.throws(
      () => finishWith(runDir, result(runDir, { checks: baseline.filter(({ id }) => id !== risk.id) })),
      new RegExp(`missing inspection decision: ${risk.id}`)
    );
    const checkedWithoutEvidence = baseline.map((check) =>
      check.id === risk.id ? { ...check, status: 'checked' } : check
    );
    assert.throws(
      () => finishWith(runDir, result(runDir, { checks: checkedWithoutEvidence })),
      /verification\.falsifying_scenario/
    );
    mkdirSync(join(runDir, 'evidence'));
    writeFileSync(join(runDir, 'evidence', 'save-progress.txt'), 'A malformed value is rejected before persistence.\n');
    const verified = baseline.map((check) =>
      check.id === risk.id
        ? {
            ...check,
            status: 'checked',
            evidence: 'Targeted persistence scenario was inspected.',
            verification: {
              invariant: 'Invalid progress is never persisted.',
              falsifying_scenario: 'Attempt to save malformed progress.',
              expected: 'The write is rejected.',
              observed: 'The recorded probe rejected the write.',
              method: 'probe',
              artifact: 'evidence/save-progress.txt',
            },
          }
        : check
    );
    assert.equal(finishWith(runDir, result(runDir, { checks: verified })).headline, 'Approve');
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

  test('prepare requires an explicit round on the command line', () => {
    const args = [
      'prepare',
      '--repo',
      '/abs/repo',
      '--base',
      'base',
      '--head',
      'head',
      '--review-key',
      'org/repo#1',
      '--out',
      '/abs/run',
    ];
    assert.match(run(args).stderr, /Missing --round/);
    const invalid = run([...args, '--round', '0']);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /--round must be a positive safe integer/);
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

describe('inspection accounting', () => {
  test('requires mandatory nominations and dismissals, allowing selected concerns instead', () => {
    const { repo, base } = makeRepo({
      'src/interactive-engine/runner.ts': "export const defaultMode = 'old-mode';\n",
      'docs/modes.md': 'The runner uses old-mode.\n',
    });
    const head = commit(
      repo,
      { 'src/interactive-engine/runner.ts': "export const defaultMode = 'new-mode';\n" },
      'head'
    );
    const runDir = prepared({ repo, base, head });
    const checks = result(runDir).checks;
    assert.ok(checks.some(({ id }) => id.startsWith('sync:')));
    assert.ok(checks.some(({ id }) => id.startsWith('delta:')));
    assert.ok(checks.some(({ id }) => id.startsWith('concern:')));
    for (const omitted of checks) {
      assert.throws(
        () =>
          finishWith(
            runDir,
            result(runDir, {
              checks: checks.filter(({ id }) => id !== omitted.id),
            })
          ),
        /missing inspection decision/
      );
    }
    const candidate = checks.find(({ id }) => id.startsWith('concern:'));
    addContext({ run: runDir, concerns: candidate.id.slice('concern:'.length) });
    assert.equal(
      finishWith(
        runDir,
        result(runDir, {
          checks: checks.filter(({ id }) => id !== candidate.id),
        })
      ).headline,
      'Approve'
    );
    for (const changes of [{ status: 'unresolved' }, { status: 'skipped' }, { evidence: 'N/A' }, { id: 'unknown' }]) {
      assert.throws(
        () =>
          finishWith(
            runDir,
            result(runDir, {
              checks: [{ ...checks[0], ...changes }, ...checks.slice(1)],
            })
          ),
        /Result is invalid/
      );
    }
    assert.throws(() => finishWith(runDir, result(runDir, { checks: [...checks, checks[0]] })), /duplicate/);
  });

  test('doc gaps require a decision even without a finding', () => {
    const { repo, base } = makeRepo({
      'src/lib/mode.ts': "export const config = { run_mode: 'old' };\n",
      'docs/mode.md': 'run_mode supports old.\n',
    });
    const head = commit(repo, { 'src/lib/mode.ts': "export const config = { run_mode: 'new' };\n" }, 'head');
    const runDir = prepared({ repo, base, head });
    assert.ok(result(runDir).checks.some(({ id }) => id.startsWith('doc-gap:')));
    assert.throws(
      () =>
        finishWith(
          runDir,
          result(runDir, {
            checks: result(runDir).checks.filter(({ id }) => !id.startsWith('doc-gap:')),
          })
        ),
      /missing inspection decision: doc-gap/
    );
  });

  test('incremental rounds nominate and require test reads only for the new diff', () => {
    const path = 'src/interactive-engine/runner.test.ts';
    const { repo, base } = makeRepo({ [path]: 'test("old", () => {});\n' });
    const head = commit(repo, { [path]: 'test("new", () => {});\n' }, 'round one');
    const first = prepared({ repo, base, head });
    finishWith(
      first,
      result(first, {
        tests: [{ path, read: true, scope: 'full', assertions_checked: 'No assertions in this fixture.' }],
      })
    );
    const secondHead = commit(repo, { 'docs/readme.md': 'A documentation correction.\n' }, 'round two');
    const second = prepared({ repo, base, head: secondHead, prior: join(first, 'state.json') });
    const inventory = readJson(join(second, 'inventory.json'));
    assert.ok(inventory.files.some((file) => file.path === path));
    assert.deepEqual(
      inventory.review_files.map((file) => file.path),
      ['docs/readme.md']
    );
    assert.equal(
      readJson(join(second, 'candidates.json')).candidates.some(({ path_files }) => path_files.includes(path)),
      false
    );
    assert.equal(finishWith(second, result(second)).headline, 'Approve');
    const third = prepared({ repo, base, head: secondHead, prior: join(second, 'state.json') });
    assert.deepEqual(readJson(join(third, 'obligations.json')), []);
    assert.deepEqual(readJson(join(third, 'inventory.json')).review_files, []);
    assert.equal(finishWith(third, result(third)).headline, 'Approve');
  });
});
