import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cliJson, readJson, REGISTRY_PATH } from './helpers.mjs';
import { legacyPacket } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);
const corpus = readJson(fileURLToPath(new URL('./fixtures/parity/routing-corpus.json', import.meta.url)));

const ASSERTING_KEYS = [
  'changed_paths_include',
  'activated_includes',
  'activated_excludes',
  'withheld_includes',
  'coverage_gap_directories',
  'change_class',
  'semantics_source',
  'semantic_signals_zero',
];
const MODIFIER_KEYS = ['withheld_reason', 'change_class_source'];

function routeFixture(input) {
  const file = join(tmpdir(), 'concerns-parity-route-input.json');
  writeFileSync(file, JSON.stringify(input));
  const result = cliJson(['route', '--input', file]);
  assert.equal(result.code, 0, result.stderr);
  return result.payload;
}

function ids(entries) {
  return entries.map((entry) => entry.id);
}

test('every corpus case asserts something in the vocabulary this suite checks', () => {
  const known = new Set([...ASSERTING_KEYS, ...MODIFIER_KEYS]);
  const names = new Set();
  assert.ok(corpus.cases.length >= 10);
  for (const fixture of corpus.cases) {
    assert.ok(!names.has(fixture.name), `duplicate case ${fixture.name}`);
    names.add(fixture.name);
    const keys = Object.keys(fixture.expect);
    for (const key of keys) {
      assert.ok(known.has(key), `${fixture.name}: unknown expectation ${key}`);
    }
    assert.ok(
      keys.some((key) => ASSERTING_KEYS.includes(key)),
      `${fixture.name} asserts nothing`
    );
  }
});

test('every routing corpus case decides as it records', () => {
  for (const fixture of corpus.cases) {
    const result = routeFixture(fixture.input);
    const expect = fixture.expect;
    const activated = ids(result.activated);
    const withheld = ids(result.withheld);
    for (const path of expect.changed_paths_include ?? []) {
      assert.ok(result.input.paths.accepted >= 1, `${fixture.name}: no accepted path`);
      const matched = [...result.activated, ...result.withheld, ...result.considered].some((entry) =>
        entry.evidence.paths.some((evidence) => evidence.paths.includes(path))
      );
      assert.ok(matched, `${fixture.name}: no concern saw ${path}`);
    }
    for (const id of expect.activated_includes ?? []) {
      assert.ok(activated.includes(id), `${fixture.name}: ${id} did not activate`);
    }
    for (const id of expect.activated_excludes ?? []) {
      assert.ok(!activated.includes(id), `${fixture.name}: ${id} activated unexpectedly`);
    }
    for (const id of expect.withheld_includes ?? []) {
      assert.ok(withheld.includes(id), `${fixture.name}: ${id} was not withheld`);
      const entry = result.withheld.find((candidate) => candidate.id === id);
      assert.equal(entry.reason, expect.withheld_reason, fixture.name);
    }
    for (const directory of expect.coverage_gap_directories ?? []) {
      assert.ok(
        result.coverage_gaps.some((gap) => gap.directory === directory),
        `${fixture.name}: ${directory} was not disclosed as a gap`
      );
    }
    if (expect.change_class) {
      assert.equal(result.change_class.value, expect.change_class, fixture.name);
      if (expect.change_class_source) {
        assert.equal(result.change_class.source, expect.change_class_source, fixture.name);
      }
    }
    if (expect.semantics_source) {
      assert.equal(result.input.semantics.source, expect.semantics_source, fixture.name);
    }
    if (expect.semantic_signals_zero) {
      for (const entry of result.activated) {
        assert.equal(entry.signals.semantic, 0, `${fixture.name}: ${entry.id} claimed semantic evidence`);
      }
    }
  }
});

// An independently written matcher over the Markdown-declared selectors. If the
// CLI ever saw evidence the Markdown does not declare, or missed evidence it
// does, these two sets would part company.
function globToRegExp(pattern) {
  const source = pattern
    .split('/')
    .map((segment, index, segments) =>
      segment === '**'
        ? index === segments.length - 1
          ? '.*'
          : '(?:[^/]*/)*'
        : segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    )
    .reduce(
      (accumulated, segment) => (segment === '(?:[^/]*/)*' ? accumulated + segment : `${accumulated}${segment}/`),
      ''
    )
    .replace(/\/$/, '');
  return new RegExp(`^${source}$`);
}

function markdownPathOwners(paths) {
  const owners = new Set();
  for (const concern of registry.concerns) {
    const packet = legacyPacket(concern.id);
    for (const trigger of packet.trigger_paths) {
      if (trigger === 'all changed files') {
        continue;
      }
      const matcher = trigger.includes('*') ? globToRegExp(trigger) : null;
      if (paths.some((path) => (matcher ? matcher.test(path) : path === trigger))) {
        owners.add(concern.id);
      }
    }
  }
  return owners;
}

test('the concerns that see a path are exactly the ones the Markdown selectors claim', () => {
  const paths = [
    'src/context-engine/recommender.ts',
    'pkg/plugin/resources.go',
    'src/components/block-editor/BlockEditor.tsx',
    'src/lib/faro.ts',
    '.github/workflows/ci.yml',
  ];
  const result = routeFixture({ schema_version: 1, paths });
  const seen = new Set();
  for (const entry of [...result.activated, ...result.withheld, ...result.considered]) {
    for (const evidence of entry.evidence.paths) {
      if (evidence.selector.kind !== 'all_changed_files') {
        seen.add(entry.id);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...markdownPathOwners(paths)].sort());
});

test('routing decisions do not depend on the order paths are supplied', () => {
  const paths = ['src/lib/faro.ts', 'pkg/plugin/resources.go', 'src/context-engine/recommender.ts'];
  const forward = routeFixture({ schema_version: 1, paths });
  const reversed = routeFixture({ schema_version: 1, paths: [...paths].reverse() });
  assert.deepEqual(ids(forward.activated), ids(reversed.activated));
  assert.deepEqual(ids(forward.withheld), ids(reversed.withheld));
  assert.deepEqual(forward.coverage_gaps, reversed.coverage_gaps);
});
