import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCoverage } from '../lib/coverage.mjs';
import { loadRegistry } from '../lib/registry.mjs';
import { REGISTRY_PATH, SCHEMA_PATH } from './helpers.mjs';

const { registry } = loadRegistry({ registryPath: REGISTRY_PATH, schemaPath: SCHEMA_PATH });

test('a path a subsystem concern claims is mapped to that concern', () => {
  const result = computeCoverage({ registry, paths: ['src/context-engine/recommender.ts'] });
  assert.equal(result.counts.mapped, 1);
  assert.equal(result.counts.weakly_mapped, 0);
  assert.equal(result.counts.unmapped, 0);
  assert.ok(result.mapped[0].concern_ids.includes('context-engine'));
});

test('a path only a cross-cutting concern claims is weakly mapped', () => {
  const crossCutting = registry.concerns.filter((concern) => concern.activation.mode === 'weak');
  assert.ok(crossCutting.length > 0);
  const result = computeCoverage({ registry, paths: ['src/lib/faro.ts'] });
  assert.equal(result.counts.weakly_mapped, 1);
  assert.ok(result.weakly_mapped[0].concern_ids.includes('analytics-and-telemetry'));
  assert.ok(result.weakly_mapped[0].concern_ids.every((id) => crossCutting.some((concern) => concern.id === id)));
  assert.match(result.policy.weakly_mapped_definition, /cross-cutting/);
});

test('a path no conditional concern claims is unmapped even when always-on concerns cover it', () => {
  const result = computeCoverage({ registry, paths: ['src/hooks/use-thing.ts'] });
  assert.equal(result.counts.unmapped, 1);
  assert.deepEqual(result.unmapped, ['src/hooks/use-thing.ts']);
});

test('unmapped paths are clustered by directory, largest cluster first', () => {
  const result = computeCoverage({
    registry,
    paths: ['src/hooks/a.ts', 'src/hooks/b.ts', 'src/hooks/c.ts', 'src/locales/x.json', 'src/locales/y.json'],
  });
  assert.deepEqual(
    result.unmapped_clusters.map((cluster) => [cluster.directory, cluster.count]),
    [
      ['src/hooks', 3],
      ['src/locales', 2],
    ]
  );
});

test('unusable paths are rejected rather than counted as unmapped', () => {
  const result = computeCoverage({ registry, paths: ['../escape.ts', '/etc/passwd', 'src/hooks/a.ts'] });
  assert.equal(result.counts.rejected, 2);
  assert.equal(result.counts.total, 1);
  assert.deepEqual(
    result.rejected.map((entry) => entry.reason),
    ['parent_traversal', 'absolute_path']
  );
});

test('coverage discloses the undefined file universe and claims no completeness', () => {
  const result = computeCoverage({ registry, paths: ['src/hooks/a.ts'] });
  assert.equal(result.policy.file_universe_status, 'undefined');
  assert.equal(result.policy.file_universe_discrepancy_id, 'coverage-universe-undefined');
  assert.equal(result.policy.asserts_registry_completeness, false);
  assert.equal(result.policy.coverage_gap_is_gate, false);
});

test('coverage output is sorted and deterministic', () => {
  const paths = ['src/hooks/z.ts', 'src/hooks/a.ts', 'src/context-engine/b.ts'];
  const first = computeCoverage({ registry, paths });
  assert.deepEqual(first, computeCoverage({ registry, paths: [...paths].reverse() }));
  assert.deepEqual(first.unmapped, ['src/hooks/a.ts', 'src/hooks/z.ts']);
});
