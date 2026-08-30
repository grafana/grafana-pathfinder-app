import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeInput } from '../lib/matching.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { normalizeRouteInput, routeConcerns } from '../lib/routing.mjs';
import { readJson, REGISTRY_PATH, SCHEMA_PATH } from './helpers.mjs';

const { registry } = loadRegistry({ registryPath: REGISTRY_PATH, schemaPath: SCHEMA_PATH });
const fixtures = readJson(fileURLToPath(new URL('./fixtures/route-cases.json', import.meta.url)));

function route(raw) {
  const normalized = normalizeRouteInput(raw);
  return routeConcerns({
    registry,
    input: analyzeInput({ paths: normalized.paths, text: normalized.text }),
    changeClass: normalized.changeClass,
  });
}

function ids(entries) {
  return entries.map((entry) => entry.id);
}

// The corpus is the primary evidence for routing semantics, so a mistyped or
// emptied expectation has to fail rather than pass vacuously.
const ASSERTING_EXPECT_KEYS = [
  'activated_includes',
  'activated_excludes',
  'withheld_includes',
  'signals',
  'change_class',
  'coverage_gap_kinds',
  'unowned_directories',
  'input_semantics_source',
  'disclosure_kinds',
];
const MODIFIER_EXPECT_KEYS = ['withheld_reason'];

test('every curated fixture states its expectations in the vocabulary the suite checks', () => {
  assert.ok(fixtures.cases.length >= 10, 'the fixture corpus must cover each routing rule');
  const known = new Set([...ASSERTING_EXPECT_KEYS, ...MODIFIER_EXPECT_KEYS]);
  const names = new Set();
  for (const fixture of fixtures.cases) {
    assert.ok(typeof fixture.name === 'string' && fixture.name.length > 0, 'every fixture must be named');
    assert.ok(!names.has(fixture.name), `duplicate fixture name: ${fixture.name}`);
    names.add(fixture.name);
    const keys = Object.keys(fixture.expect ?? {});
    for (const key of keys) {
      assert.ok(known.has(key), `${fixture.name}: unknown expectation key ${key}`);
    }
    assert.ok(
      keys.some((key) => ASSERTING_EXPECT_KEYS.includes(key)),
      `${fixture.name}: the fixture asserts nothing`
    );
    if (keys.includes('withheld_includes')) {
      assert.ok(fixture.expect.withheld_reason, `${fixture.name}: withheld_includes needs a withheld_reason`);
    }
  }
});

test('every curated routing fixture behaves as it records', () => {
  assert.ok(fixtures.cases.length >= 10, 'the fixture corpus must cover each routing rule');
  for (const fixture of fixtures.cases) {
    const result = route(fixture.input);
    const expected = fixture.expect;
    const activated = ids(result.activated);
    const withheld = ids(result.withheld);
    const considered = ids(result.considered);

    for (const id of expected.activated_includes ?? []) {
      assert.ok(activated.includes(id), `${fixture.name}: expected ${id} to activate`);
    }
    for (const id of expected.activated_excludes ?? []) {
      assert.ok(!activated.includes(id), `${fixture.name}: expected ${id} not to activate`);
    }
    for (const id of expected.withheld_includes ?? []) {
      assert.ok(withheld.includes(id), `${fixture.name}: expected ${id} to be withheld`);
      assert.equal(result.withheld.find((entry) => entry.id === id).reason, expected.withheld_reason);
    }
    for (const [id, signals] of Object.entries(expected.signals ?? {})) {
      const entry = [...result.activated, ...result.withheld, ...result.considered].find((item) => item.id === id);
      assert.ok(entry, `${fixture.name}: expected signals recorded for ${id}, saw ${considered.join(',')}`);
      assert.equal(entry.signals.path, signals.path, `${fixture.name}: ${id} path signals`);
      assert.equal(entry.signals.semantic, signals.semantic, `${fixture.name}: ${id} semantic signals`);
      assert.equal(entry.signals.total, signals.total, `${fixture.name}: ${id} total signals`);
    }
    if (expected.change_class) {
      assert.equal(result.change_class.value, expected.change_class.value, fixture.name);
      assert.equal(result.change_class.source, expected.change_class.source, fixture.name);
    }
    for (const kind of expected.coverage_gap_kinds ?? []) {
      assert.ok(
        result.coverage_gaps.some((gap) => gap.kind === kind),
        `${fixture.name}: expected a ${kind} coverage gap`
      );
    }
    for (const directory of expected.unowned_directories ?? []) {
      assert.ok(
        result.coverage_gaps.some((gap) => gap.directory === directory),
        `${fixture.name}: expected ${directory} to be disclosed as unowned`
      );
    }
    if (expected.input_semantics_source) {
      assert.equal(result.input.semantics.source, expected.input_semantics_source, fixture.name);
    }
    for (const kind of expected.disclosure_kinds ?? []) {
      assert.ok(
        result.disclosures.some((entry) => entry.kind === kind),
        `${fixture.name}: expected a ${kind} disclosure`
      );
    }
  }
});

test('every always-on concern activates on any change', () => {
  const alwaysOn = registry.concerns.filter((concern) => concern.activation.kind === 'always').map((c) => c.id);
  const result = route({ schema_version: 1, paths: ['README.md'] });
  for (const id of alwaysOn) {
    const entry = result.activated.find((item) => item.id === id);
    assert.ok(entry, `${id} must activate`);
    assert.equal(entry.reason, 'always_on');
  }
});

test('an always-on concern never appears as withheld or considered', () => {
  const result = route({ schema_version: 1, paths: ['src/types/context.types.ts'] });
  const alwaysOn = new Set(
    registry.concerns.filter((concern) => concern.activation.kind === 'always').map((concern) => concern.id)
  );
  for (const entry of [...result.withheld, ...result.considered]) {
    assert.ok(!alwaysOn.has(entry.id), `${entry.id} is always-on and must not be gated`);
  }
});

test('a conditional concern below its minimum is reported as considered, not activated', () => {
  const result = route({ schema_version: 1, paths: ['src/lib/faro.ts'] });
  const analytics = registry.concerns.find((concern) => concern.id === 'analytics-and-telemetry');
  assert.equal(analytics.activation.minimum_signals, 2);
  assert.ok(!ids(result.activated).includes('analytics-and-telemetry'));
  const considered = result.considered.find((entry) => entry.id === 'analytics-and-telemetry');
  assert.equal(considered.reason, 'below_minimum_signals');
  assert.equal(considered.signals.total, 1);
});

test('the semantic-evidence requirement withholds path-only activation and discloses the discrepancy', () => {
  const result = route({
    schema_version: 1,
    paths: ['src/context-engine/recommender.ts', 'src/types/context.types.ts'],
  });
  const withheld = result.withheld.find((entry) => entry.id === 'context-engine');
  assert.equal(withheld.reason, 'semantic_evidence_required');
  assert.equal(withheld.signals.total, 2);
  const disclosure = result.disclosures.find((entry) => entry.kind === 'semantic_evidence_requirement');
  assert.equal(disclosure.discrepancy_id, 'path-only-activation');
  assert.equal(disclosure.status, 'unresolved');
  assert.deepEqual(disclosure.path_only_candidates, ['context-engine']);
});

test('repeated hits inside one hunk collapse, and separate hunks do not', () => {
  const oneHunk = route({
    schema_version: 1,
    diff: [
      'diff --git a/a.ts b/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '+getContextData();',
      '+getContextData();',
    ].join('\n'),
  });
  const twoHunks = route({
    schema_version: 1,
    diff: [
      'diff --git a/a.ts b/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '+getContextData();',
      '@@ -9,1 +9,1 @@',
      '+getContextData();',
    ].join('\n'),
  });
  const signalsFor = (result) =>
    [...result.activated, ...result.withheld, ...result.considered].find((entry) => entry.id === 'context-engine')
      .signals.semantic;
  assert.equal(signalsFor(oneHunk), 1);
  assert.equal(signalsFor(twoHunks), 2);
});

test('two distinct selectors in one hunk each contribute a signal', () => {
  const result = route({
    schema_version: 1,
    diff: [
      'diff --git a/a.ts b/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      '+fetchRecommendations();',
      '+getContextData();',
    ].join('\n'),
  });
  const entry = result.activated.find((item) => item.id === 'context-engine');
  assert.equal(entry.signals.semantic, 2);
  assert.equal(entry.reason, 'signals');
});

test('an unknown change class fails open to the registry uncertain class and says so', () => {
  const result = route({ schema_version: 1, paths: ['README.md'], change_class: 'nope' });
  assert.equal(result.change_class.value, registry.classification_policy.uncertain_class);
  assert.equal(result.change_class.source, 'unknown_class_fail_open');
  assert.equal(result.change_class.requested, 'nope');
  assert.ok(result.disclosures.some((entry) => entry.kind === 'unknown_change_class'));
});

test('an omitted change class fails open rather than guessing', () => {
  const result = route({ schema_version: 1, paths: ['README.md'] });
  assert.equal(result.change_class.source, 'unspecified_fail_open');
  assert.ok(result.disclosures.some((entry) => entry.kind === 'change_class_not_supplied'));
  assert.ok(result.disclosures.some((entry) => entry.kind === 'change_class_not_applied'));
});

test('unparseable diff text is disclosed and still routes on the paths it was given', () => {
  const result = route({ schema_version: 1, paths: ['src/context-engine/recommender.ts'], diff: 'not a diff at all' });
  assert.equal(result.input.semantics.source, 'text');
  assert.ok(result.disclosures.some((entry) => entry.kind === 'unrecognised_diff'));
  assert.equal(result.activated.filter((entry) => entry.reason === 'always_on').length, 5);
});

test('coverage gaps are disclosed and never gate', () => {
  const result = route({ schema_version: 1, paths: ['src/hooks/one.ts', 'src/hooks/two.ts'] });
  const gap = result.coverage_gaps.find((entry) => entry.kind === 'unowned_directory_cluster');
  assert.equal(gap.directory, 'src/hooks');
  assert.deepEqual(gap.paths, ['src/hooks/one.ts', 'src/hooks/two.ts']);
  assert.equal(gap.condition, registry.coverage_gap_policy.conditions[0]);
  assert.equal(result.policy.coverage_gap_is_gate, false);
  assert.equal(result.policy.coverage_gap_disposition, 'disclose');
});

// Routing computes exactly one of the registry's coverage-gap conditions. Every
// other one must be reported verbatim as unevaluated rather than narrowed into
// a claim the registry does not make.
test('every coverage-gap condition routing does not compute is disclosed verbatim', () => {
  const result = route({ schema_version: 1, paths: ['src/hooks/one.ts', 'src/hooks/two.ts'] });
  const evaluated = registry.coverage_gap_policy.conditions.filter((condition) =>
    condition.includes('directory with multiple changed files')
  );
  assert.equal(evaluated.length, 1, 'the directory-cluster condition is the one routing evaluates');
  const disclosed = result.disclosures
    .filter((entry) => entry.kind === 'coverage_condition_not_evaluated')
    .map((entry) => entry.condition);
  assert.deepEqual(
    disclosed,
    registry.coverage_gap_policy.conditions.filter((condition) => !evaluated.includes(condition))
  );
  for (const entry of result.coverage_gaps) {
    assert.ok(evaluated.includes(entry.condition), `${entry.kind} claims a condition routing does not evaluate`);
  }
});

test('a single changed file in an unowned directory is not reported as a cluster', () => {
  const result = route({ schema_version: 1, paths: ['src/hooks/one.ts'] });
  assert.deepEqual(result.coverage_gaps, []);
});

test('routing is deterministic for the same input', () => {
  const request = {
    schema_version: 1,
    paths: ['src/context-engine/recommender.ts'],
    diff: ['diff --git a/a.ts b/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '+fetchRecommendations();'].join('\n'),
  };
  assert.deepEqual(route(request), route(request));
});

test('deleting a subsystem file routes on the same signals as modifying it', () => {
  const path = 'src/context-engine/recommender.ts';
  const deletion = route({
    schema_version: 1,
    diff: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-await fetchRecommendations();',
    ].join('\n'),
  });
  const modification = route({
    schema_version: 1,
    diff: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,1 +1,1 @@',
      '-await fetchRecommendations();',
    ].join('\n'),
  });
  const entryFor = (result) => result.activated.find((item) => item.id === 'context-engine');
  assert.deepEqual(deletion.input.paths.accepted, 1);
  assert.ok(entryFor(deletion), 'the deleted subsystem file must still activate its concern');
  assert.deepEqual(entryFor(deletion).signals, entryFor(modification).signals);
});

// A removed line reading `-- x` is shaped like a `---` file header. Reading one
// as a header closes the hunk and drops every changed line after it.
test('a changed line shaped like a file header does not discard the rest of its hunk', () => {
  const path = 'src/context-engine/recommender.ts';
  const withLookalike = route({
    schema_version: 1,
    paths: [path],
    diff: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,4 +1,3 @@',
      '+const kept = 1;',
      '--- note removed from a comment',
      '-await fetchRecommendations();',
      '-getContextData();',
    ].join('\n'),
  });
  const entry = withLookalike.activated.find((item) => item.id === 'context-engine');
  assert.ok(entry, 'the evidence after the look-alike line must still count');
  assert.equal(entry.signals.semantic, 2);
  assert.deepEqual(withLookalike.input.paths.accepted, 1);
});

test('an added line shaped like a file header contributes no path of its own', () => {
  const result = route({
    schema_version: 1,
    diff: [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      '+getContextData();',
      '++ bumped counter',
    ].join('\n'),
  });
  assert.deepEqual(result.input.paths.accepted, 1);
  assert.deepEqual(result.input.semantics.hunk_count, 1);
  assert.ok(!result.disclosures.some((entry) => entry.kind === 'diff_without_hunks'));
});

test('the --input contract rejects documents it cannot trust', () => {
  const rejections = [
    [[], /must be a JSON object/],
    [{ schema_version: 2 }, /schema_version": 1/],
    [{ schema_version: 1, unexpected: true }, /unknown key/],
    [{ schema_version: 1, paths: 'src/a.ts' }, /"paths" must be an array of strings/],
    [{ schema_version: 1, paths: [1] }, /"paths" must be an array of strings/],
    [{ schema_version: 1, diff: 5 }, /"diff" must be a string/],
    [{ schema_version: 1, change_class: 5 }, /"change_class" must be a string/],
  ];
  for (const [raw, pattern] of rejections) {
    assert.throws(() => normalizeRouteInput(raw), pattern, JSON.stringify(raw));
  }
});

test('the --input contract accepts the documented shape', () => {
  assert.deepEqual(normalizeRouteInput({ schema_version: 1 }), { paths: [], text: null, changeClass: null });
  assert.deepEqual(normalizeRouteInput({ schema_version: 1, paths: ['a'], diff: 'd', change_class: 'mixed' }), {
    paths: ['a'],
    text: 'd',
    changeClass: 'mixed',
  });
});
