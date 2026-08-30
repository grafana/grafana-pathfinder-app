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
  assert.ok(result.disclosures.some((entry) => entry.kind === 'coverage_condition_not_evaluated'));
});

test('a single changed file in an unowned directory is not reported as a cluster', () => {
  const result = route({ schema_version: 1, paths: ['src/hooks/one.ts'] });
  assert.ok(!result.coverage_gaps.some((entry) => entry.kind === 'unowned_directory_cluster'));
  assert.ok(result.coverage_gaps.some((entry) => entry.kind === 'only_always_on_coverage'));
});

test('routing is deterministic for the same input', () => {
  const request = {
    schema_version: 1,
    paths: ['src/context-engine/recommender.ts'],
    diff: ['diff --git a/a.ts b/a.ts', '+++ b/a.ts', '@@ -1,1 +1,1 @@', '+fetchRecommendations();'].join('\n'),
  };
  assert.deepEqual(route(request), route(request));
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
