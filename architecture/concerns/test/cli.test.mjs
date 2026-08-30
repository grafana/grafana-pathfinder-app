import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { assertLiteralRevision, changedPathsArgs, trackedFilesArgs, unifiedDiffArgs } from '../lib/git.mjs';
import { cli, cliJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';

const COMMANDS = ['list', 'show', 'match', 'route', 'validate', 'coverage'];
const scratch = mkdtempSync(join(tmpdir(), 'concerns-cli-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

function scratchFile(name, contents) {
  const path = join(scratch, name);
  writeFileSync(path, contents);
  return path;
}

test('global help names every command, the registry, the semantics, and the exit codes', () => {
  const result = cli(['--help']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  for (const command of COMMANDS) {
    assert.match(result.stdout, new RegExp(`^  ${command}\\s`, 'm'), `help must list ${command}`);
  }
  assert.match(result.stdout, /architecture\/concerns\/registry\.json/);
  assert.match(result.stdout, /Exit codes:/);
  assert.match(result.stdout, /Semantics:/);
});

test('help does not restate any concern content', () => {
  const registry = JSON.parse(execFileSync('cat', [REGISTRY_PATH], { encoding: 'utf8' }));
  const help = [cli(['--help']).stdout, ...COMMANDS.map((command) => cli([command, '--help']).stdout)].join('\n');
  for (const concern of registry.concerns) {
    assert.ok(!help.includes(concern.id), `help must not name the concern ${concern.id}`);
  }
});

test('every command prints its own help without running', () => {
  for (const command of COMMANDS) {
    const result = cli([command, '--help']);
    assert.equal(result.code, 0, `${command} --help`);
    assert.match(result.stdout, new RegExp(`^concerns ${command} — `), command);
    assert.match(result.stdout, /^Usage: concerns /m, command);
  }
});

test('exit codes are stable across failure kinds', () => {
  assert.equal(cli(['list']).code, 0);
  assert.equal(cli(['validate', '--registry', scratchFile('invalid.json', '{"schema_version": 1}')]).code, 1);
  assert.equal(cli(['nonsense']).code, 2);
  assert.equal(cli(['show']).code, 2);
  assert.equal(cli(['show', 'not-a-concern']).code, 2);
  assert.equal(cli(['list', '--format', 'yaml']).code, 2);
  assert.equal(cli(['list', '--unknown-flag']).code, 2);
  assert.equal(cli(['validate', '--registry', join(scratch, 'absent.json')]).code, 3);
});

test('diagnostics go to stderr and leave stdout empty', () => {
  const result = cli(['show', 'not-a-concern']);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /is not in the registry/);
});

test('every JSON payload carries the versioned envelope', () => {
  const invocations = [
    ['--version'],
    ['list'],
    ['show', 'context-engine'],
    ['match', '--path', 'src/context-engine/a.ts'],
    ['route', '--input', scratchFile('input.json', JSON.stringify({ schema_version: 1, paths: ['README.md'] }))],
    ['validate'],
    ['coverage', '--path', 'src/hooks/a.ts'],
  ];
  for (const argv of invocations) {
    const { code, payload } = cliJson(argv);
    assert.equal(code, 0, argv.join(' '));
    assert.equal(payload.schema_version, 1, argv.join(' '));
    assert.equal(typeof payload.command, 'string', argv.join(' '));
    assert.deepEqual(Object.keys(payload).slice(0, 2), ['schema_version', 'command'], argv.join(' '));
  }
});

test('--version reports the registry format version, not a product version', () => {
  assert.equal(cli(['--version']).stdout.trim(), 'registry format version 1');
  const { payload } = cliJson(['--version']);
  assert.equal(payload.registry_format_version, 1);
  assert.equal(payload.registry_id, 'pathfinder-review-concerns');
});

test('list is deterministic and preserves registry order', () => {
  const first = cliJson(['list']).payload;
  const second = cliJson(['list']).payload;
  assert.deepEqual(first, second);
  assert.equal(first.concerns.length, 27);
  assert.equal(first.concerns[0].id, 'security');
  assert.equal(cli(['list']).stdout, cli(['list']).stdout);
  assert.equal(cli(['list']).stdout.trimEnd().split('\n').length, 27);
});

test('show produces the full packet by default', () => {
  const { payload } = cliJson(['show', 'completion-records']);
  assert.equal(payload.view, 'full');
  for (const field of [
    'id',
    'name',
    'category',
    'activation',
    'selectors',
    'trigger_paths',
    'trigger_keywords',
    'purpose',
    'load_docs',
    'load_code',
    'review_questions',
    'one_way_doors',
    'verification',
    'related',
    'contract_anchor',
    'named_invariants',
    'pre_contract_candidate',
    'dispatch',
    'plan',
  ]) {
    assert.ok(Object.hasOwn(payload.concern, field), `full packet is missing ${field}`);
  }
  assert.equal(payload.concern.contract_anchor.evidence, '#1411 → #1700');
  assert.equal(payload.concern.named_invariants.length, 7);
});

test('show --worker produces the bounded worker packet and nothing else', () => {
  const { payload } = cliJson(['show', 'completion-records', '--worker']);
  assert.equal(payload.view, 'worker');
  assert.deepEqual(Object.keys(payload.concern), [
    'id',
    'purpose',
    'review_questions',
    'one_way_doors',
    'verification',
    'contract_anchor',
    'named_invariants',
  ]);
});

test('show --plan produces the dispatch and budget facts a planner needs', () => {
  const security = cliJson(['show', 'security', '--plan']).payload;
  assert.equal(security.view, 'plan');
  assert.equal(security.concern.specialist, 'secure');
  assert.equal(security.concern.always_on, true);
  assert.equal(security.concern.contract_evolution_eligible, false);
  assert.equal(security.concern.max_context_files, 8);

  const subsystem = cliJson(['show', 'context-engine', '--plan']).payload;
  assert.equal(subsystem.concern.specialist, null);
  assert.equal(subsystem.concern.always_on, false);
  assert.equal(subsystem.concern.contract_evolution_eligible, true);

  const reversibility = cliJson(['show', 'reversibility-and-one-way-door', '--plan']).payload;
  assert.equal(reversibility.concern.never_suppressed, true);
});

test('show views are bounded slices and mutually exclusive', () => {
  const routing = cliJson(['show', 'context-engine', '--view', 'routing']).payload;
  assert.ok(Object.hasOwn(routing.concern, 'selectors'));
  assert.ok(!Object.hasOwn(routing.concern, 'review_questions'));

  const review = cliJson(['show', 'context-engine', '--view', 'review']).payload;
  assert.ok(Object.hasOwn(review.concern, 'review_questions'));
  assert.ok(!Object.hasOwn(review.concern, 'selectors'));

  assert.equal(cli(['show', 'context-engine', '--view', 'nonsense']).code, 2);
  assert.equal(cli(['show', 'context-engine', '--worker', '--plan']).code, 2);
  assert.equal(cli(['show', 'context-engine', '--worker', '--view', 'routing']).code, 2);
});

test('show text output stays deterministic', () => {
  assert.equal(cli(['show', 'data-check']).stdout, cli(['show', 'data-check']).stdout);
});

test('match reads diff text from a file and from standard input identically', () => {
  const diff = ['diff --git a/a.ts b/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '+fetchRecommendations();'].join('\n');
  const fromFile = cliJson(['match', '--text-file', scratchFile('diff.patch', diff)]).payload;
  const fromStdin = cliJson(['match', '--stdin'], { input: diff }).payload;
  assert.deepEqual(fromFile, fromStdin);
  assert.ok(fromFile.concerns.some((concern) => concern.id === 'context-engine'));
});

test('match refuses contradictory or empty input', () => {
  assert.equal(cli(['match']).code, 2);
  assert.equal(cli(['match', '--stdin', '--text-file', scratchFile('x.patch', 'x')]).code, 2);
});

test('coverage requires exactly one path source', () => {
  assert.equal(cli(['coverage']).code, 2);
  assert.equal(cli(['coverage', '--tracked', '--path', 'a.ts']).code, 2);
  const { payload } = cliJson(['coverage', '--paths', scratchFile('paths.txt', 'src/hooks/a.ts\nsrc/hooks/b.ts\n')]);
  assert.equal(payload.source, 'paths-file');
  assert.equal(payload.counts.unmapped, 2);
});

// `git ls-files` reports paths relative to the working directory and lists only
// what sits beneath it, so a cwd-sensitive read would silently score the wrong
// path universe against the registry's repository-rooted selectors.
test('coverage --tracked reads the whole repository whatever directory it runs from', () => {
  const fromRoot = cliJson(['coverage', '--tracked']);
  assert.equal(fromRoot.code, 0, fromRoot.stderr);
  const fromSubdirectory = cliJson(['coverage', '--tracked'], { cwd: join(REPOSITORY_ROOT, 'src') });
  assert.equal(fromSubdirectory.code, 0, fromSubdirectory.stderr);
  assert.deepEqual(fromRoot.payload, fromSubdirectory.payload);
  assert.ok(fromRoot.payload.counts.mapped > 0, 'the registry must claim some tracked path');
  assert.ok(
    fromRoot.payload.mapped.every((entry) => !entry.path.startsWith('../')),
    'every scored path must be repository-rooted'
  );
});

test('route rejects an --input document that breaks its contract', () => {
  assert.equal(cli(['route', '--input', scratchFile('bad.json', '{ not json')]).code, 2);
  assert.equal(cli(['route', '--input', scratchFile('v2.json', '{"schema_version":2}')]).code, 2);
  assert.equal(cli(['route']).code, 2);
  assert.equal(cli(['route', '--base', 'abcdef1']).code, 2);
});

test('route rejects revisions that are not literal object names', () => {
  for (const revision of ['HEAD', 'main', '$(id)', 'abcdef1;id', 'abc', 'g'.repeat(40)]) {
    const result = cli(['route', '--base', revision, '--head', 'abcdef1']);
    assert.equal(result.code, 2, revision);
    assert.match(result.stderr, /literal Git commit SHA/, revision);
  }
  // A revision starting with a dash never reaches the SHA check: the parser
  // refuses it first, so it can never be read as a Git flag.
  const dashed = cli(['route', '--base', '--upload-pack=x', '--head', 'abcdef1']);
  assert.equal(dashed.code, 2);
  assert.match(dashed.stderr, /argument is ambiguous/);
  assert.throws(() => assertLiteralRevision('HEAD', '--base'), /literal Git commit SHA/);
});

test('git argument builders emit literal arrays with the revision in its own slot', () => {
  const sha = 'a'.repeat(40);
  const other = 'b'.repeat(7);
  assert.deepEqual(changedPathsArgs(sha, other), ['diff', '--no-color', '--name-only', '-z', sha, other]);
  assert.deepEqual(unifiedDiffArgs(sha, other), ['diff', '--no-color', '--no-ext-diff', '--unified=3', sha, other]);
  assert.deepEqual(trackedFilesArgs(), ['ls-files', '-z']);
  for (const args of [changedPathsArgs(sha, other), unifiedDiffArgs(sha, other), trackedFilesArgs()]) {
    assert.ok(
      args.every((argument) => typeof argument === 'string' && !argument.includes(' ')),
      'no argument may carry an embedded space that a shell would resplit'
    );
  }
});

// A repository whose filenames contain shell metacharacters. If any of them ever
// reached a shell, this test would corrupt the scratch directory rather than pass.
test('route over real commits handles hostile filenames without a shell', () => {
  const repository = mkdtempSync(join(tmpdir(), 'concerns-git-'));
  const git = (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
  try {
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Concerns Test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repository, 'seed.txt'), 'seed\n');
    git(['add', '--', 'seed.txt']);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'seed']);
    const base = git(['rev-parse', 'HEAD']).trim();

    const hostile = '$(touch pwned);id.ts';
    writeFileSync(join(repository, hostile), 'export const fetchRecommendations = 1;\n');
    git(['add', '--', hostile]);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'hostile']);
    const head = git(['rev-parse', 'HEAD']).trim();

    const { code, payload } = cliJson(['route', '--base', base, '--head', head], { cwd: repository });
    assert.equal(code, 0);
    assert.deepEqual(payload.input.paths.accepted, 1);
    assert.equal(payload.activated.filter((entry) => entry.reason === 'always_on').length, 5);
    assert.ok(
      payload.activated.concat(payload.considered).some((entry) => entry.signals.semantic > 0),
      'the added line should contribute semantic evidence'
    );
    assert.throws(() => execFileSync('test', ['-e', join(repository, 'pwned')]), 'no filename was ever executed');
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

// The two input paths must not drift: a caller reading the git leg and a caller
// handing over the same diff document have to reach the same routing decision.
test('route from git and route from --input agree on the same change', () => {
  const repository = mkdtempSync(join(tmpdir(), 'concerns-agree-'));
  const git = (args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
  const file = 'src/context-engine/recommender.ts';
  try {
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Concerns Test']);
    git(['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(repository, 'src/context-engine'), { recursive: true });
    writeFileSync(join(repository, file), 'export const seed = 1;\n');
    writeFileSync(join(repository, 'src/context-engine/doomed.ts'), 'export const doomed = 1;\n');
    git(['add', '--all']);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'seed']);
    const base = git(['rev-parse', 'HEAD']).trim();

    writeFileSync(join(repository, file), 'export const seed = 1;\nawait fetchRecommendations();\n');
    rmSync(join(repository, 'src/context-engine/doomed.ts'));
    git(['add', '--all']);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'change']);
    const head = git(['rev-parse', 'HEAD']).trim();

    const viaGit = cliJson(['route', '--base', base, '--head', head], { cwd: repository });
    assert.equal(viaGit.code, 0, viaGit.stderr);

    const document = {
      schema_version: 1,
      paths: git(['diff', '--no-color', '--name-only', '-z', base, head]).split('\x00').filter(Boolean),
      diff: git(['diff', '--no-color', '--no-ext-diff', '--unified=3', base, head]),
    };
    const viaInput = cliJson(['route', '--input', scratchFile('agree.json', JSON.stringify(document))]);
    assert.equal(viaInput.code, 0, viaInput.stderr);

    assert.deepEqual(viaGit.payload, viaInput.payload);
    assert.ok(viaGit.payload.activated.some((entry) => entry.id === 'context-engine'));
    // The deleted file is one of the two, and both legs have to see it.
    assert.deepEqual(viaGit.payload.input.paths.accepted, 2);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('the --class flag overrides the change class named in an --input document', () => {
  const path = scratchFile(
    'classed.json',
    JSON.stringify({ schema_version: 1, paths: ['a.ts'], change_class: 'mixed' })
  );
  const { payload } = cliJson(['route', '--input', path, '--class', 'docs-only']);
  assert.equal(payload.change_class.value, 'docs-only');
  assert.equal(payload.change_class.source, 'explicit');
});

test('text output is concise and never emits JSON on stdout', () => {
  for (const argv of [
    ['list'],
    ['show', 'data-check'],
    ['match', '--path', 'src/a.ts'],
    ['coverage', '--path', 'src/a.ts'],
  ]) {
    const result = cli(argv);
    assert.equal(result.code, 0, argv.join(' '));
    assert.ok(!result.stdout.trimStart().startsWith('{'), `${argv.join(' ')} must not print JSON in text mode`);
  }
});
