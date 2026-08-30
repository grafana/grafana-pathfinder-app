import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSemanticInput, parseUnifiedDiff } from '../lib/diff.mjs';
import { analyzeInput, matchConcerns } from '../lib/matching.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { globToRegExp, normalizeRepositoryPath } from '../lib/selectors.mjs';
import { REGISTRY_PATH, SCHEMA_PATH } from './helpers.mjs';

const { registry } = loadRegistry({ registryPath: REGISTRY_PATH, schemaPath: SCHEMA_PATH });

const NORMALIZATION = [
  ['src/a.ts', 'src/a.ts'],
  ['./src/a.ts', 'src/a.ts'],
  ['src//a.ts', 'src/a.ts'],
  ['src/./a.ts', 'src/a.ts'],
  ['src/a.ts/', 'src/a.ts'],
];

const REJECTED = [
  ['', 'empty'],
  ['/etc/passwd', 'absolute_path'],
  ['src/../../etc/passwd', 'parent_traversal'],
  ['../outside.ts', 'parent_traversal'],
  ['src/a\nb.ts', 'control_character'],
  ['.', 'empty'],
];

// A path that looks like a shell fragment is still a legal POSIX filename. It is
// normalised and matched like any other, because nothing here ever reaches a shell.
const HOSTILE_BUT_LEGAL = ['$(whoami)/a.ts', 'src/a;rm -rf .ts', 'src/--upload-pack=x.ts', 'src/`id`.ts', 'src/*.ts'];

test('repository paths normalise deterministically', () => {
  for (const [input, expected] of NORMALIZATION) {
    const result = normalizeRepositoryPath(input);
    assert.equal(result.ok, true, `${input} should normalise`);
    assert.equal(result.path, expected);
  }
});

test('unusable paths are rejected with a stable reason', () => {
  for (const [input, reason] of REJECTED) {
    const result = normalizeRepositoryPath(input);
    assert.equal(result.ok, false, `${input} should be rejected`);
    assert.equal(result.reason, reason);
  }
});

test('shell-looking but legal paths are accepted and never executed', () => {
  for (const input of HOSTILE_BUT_LEGAL) {
    const result = normalizeRepositoryPath(input);
    assert.equal(result.ok, true, `${input} should be accepted as an ordinary path`);
  }
  const input = analyzeInput({ paths: HOSTILE_BUT_LEGAL });
  assert.equal(input.paths.length, HOSTILE_BUT_LEGAL.length);
  assert.doesNotThrow(() => matchConcerns({ registry, input }));
});

test('glob selectors follow zero-or-more-directory semantics', () => {
  const cases = [
    ['src/**', 'src/a.ts', true],
    ['src/**', 'src/a/b/c.ts', true],
    ['src/**', 'src', false],
    ['src/**', 'srcx/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/a/b.ts', true],
    ['src/**/*.ts', 'src/a/b.tsx', false],
    ['.cursor/skills/**/SKILL.md', '.cursor/skills/review/SKILL.md', true],
    ['pkg/plugin/completion_records*.go', 'pkg/plugin/completion_records_write.go', true],
    ['pkg/plugin/completion_records*.go', 'pkg/plugin/nested/completion_records.go', false],
    ['scripts/upsert-*.sh', 'scripts/upsert-one.sh', true],
  ];
  for (const [pattern, path, expected] of cases) {
    assert.equal(globToRegExp(pattern).test(path), expected, `${pattern} against ${path}`);
  }
});

test('a glob pattern is matched literally rather than interpolated', () => {
  assert.equal(globToRegExp('src/a.ts').test('src/aXts'), false);
  assert.equal(globToRegExp('src/(a|b).ts').test('src/a.ts'), false);
  assert.equal(globToRegExp('src/(a|b).ts').test('src/(a|b).ts'), true);
});

test('a unified diff yields one hunk per header with its changed lines', () => {
  const diff = [
    'diff --git a/src/one.ts b/src/one.ts',
    '--- a/src/one.ts',
    '+++ b/src/one.ts',
    '@@ -1,2 +1,2 @@',
    ' unchanged',
    '-old',
    '+new',
    '@@ -10,1 +10,1 @@',
    '+second',
    'diff --git a/src/two.ts b/src/two.ts',
    '--- a/src/two.ts',
    '+++ b/src/two.ts',
    '@@ -1,1 +1,1 @@',
    '+other',
  ].join('\n');
  const parsed = parseUnifiedDiff(diff);
  assert.deepEqual(
    parsed.hunks.map((hunk) => [hunk.path, hunk.lines]),
    [
      ['src/one.ts', ['old', 'new']],
      ['src/one.ts', ['second']],
      ['src/two.ts', ['other']],
    ]
  );
  assert.deepEqual(parsed.paths, ['src/one.ts', 'src/two.ts']);
});

test('a deletion diff attributes its hunk to no file rather than dropping it', () => {
  const parsed = analyzeSemanticInput(
    ['diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-removed'].join('\n')
  );
  assert.equal(parsed.hunks.length, 1);
  assert.equal(parsed.hunks[0].path, null);
  assert.ok(parsed.disclosures.some((entry) => entry.kind === 'hunk_without_file_header'));
});

test('input that is not a diff is scanned as text and disclosed', () => {
  const analysis = analyzeSemanticInput('fetchRecommendations lives here');
  assert.equal(analysis.source, 'text');
  assert.equal(analysis.hunks.length, 1);
  assert.ok(analysis.disclosures.some((entry) => entry.kind === 'unrecognised_diff'));
});

test('empty semantic input is disclosed rather than silently ignored', () => {
  const analysis = analyzeSemanticInput('   ');
  assert.equal(analysis.source, 'none');
  assert.ok(analysis.disclosures.some((entry) => entry.kind === 'empty_semantic_input'));
});

test('match reports path and semantic evidence without deciding activation', () => {
  const input = analyzeInput({
    paths: ['src/context-engine/recommender.ts'],
    text: [
      'diff --git a/src/context-engine/recommender.ts b/src/context-engine/recommender.ts',
      '--- a/src/context-engine/recommender.ts',
      '+++ b/src/context-engine/recommender.ts',
      '@@ -1,1 +1,1 @@',
      '+await fetchRecommendations();',
    ].join('\n'),
  });
  const result = matchConcerns({ registry, input });
  assert.equal(result.schema_version, 1);
  const contextEngine = result.concerns.find((concern) => concern.id === 'context-engine');
  assert.deepEqual(contextEngine.distinct_matched_paths, ['src/context-engine/recommender.ts']);
  assert.equal(contextEngine.distinct_semantic_hits, 1);
  assert.deepEqual(contextEngine.path_evidence[0].selector, { kind: 'glob', value: 'src/context-engine/**' });
  assert.deepEqual(contextEngine.semantic_evidence[0].selector, { kind: 'substring', value: 'fetchRecommendations' });
  assert.ok(!Object.hasOwn(contextEngine, 'activated'), 'match must not decide activation');
});

test('an always-on all-changed-files selector matches every path but gates nothing', () => {
  const input = analyzeInput({ paths: ['README.md', 'LICENSE'] });
  const result = matchConcerns({ registry, input });
  const testing = result.concerns.find((concern) => concern.id === 'testing-and-verification');
  assert.deepEqual(testing.path_evidence[0].selector.kind, 'all_changed_files');
  assert.deepEqual(testing.path_evidence[0].paths, ['LICENSE', 'README.md']);
  assert.deepEqual(testing.distinct_matched_paths, []);
});

test('an unresolved selector matches every candidate reading it records', () => {
  const concern = registry.concerns.find((entry) =>
    (entry.activation.selectors?.semantics ?? []).some((selector) => selector.kind === 'unresolved_selector')
  );
  const selector = concern.activation.selectors.semantics.find((entry) => entry.kind === 'unresolved_selector');
  for (const value of selector.candidate_values) {
    const input = analyzeInput({ text: `changed line with ${value} in it` });
    const result = matchConcerns({ registry, input });
    const matched = result.concerns.find((entry) => entry.id === concern.id);
    assert.ok(matched, `${value} should be evidence for ${concern.id}`);
  }
});

test('duplicate supplied paths collapse before matching', () => {
  const input = analyzeInput({ paths: ['src/a.ts', './src/a.ts', 'src//a.ts'] });
  assert.deepEqual(input.paths, ['src/a.ts']);
});

test('paths named only by the diff are picked up as changed paths', () => {
  const input = analyzeInput({
    text: ['diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1,1 +1,1 @@', '+a'].join('\n'),
  });
  assert.deepEqual(input.paths, ['src/x.ts']);
  assert.equal(input.derived_path_count, 1);
});
