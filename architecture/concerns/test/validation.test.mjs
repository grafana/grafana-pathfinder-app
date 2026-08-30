import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRegistry, validateRegistry } from '../lib/registry.mjs';
import { REGISTRY_PATH, SCHEMA_PATH } from './helpers.mjs';

const loaded = loadRegistry({ registryPath: REGISTRY_PATH, schemaPath: SCHEMA_PATH });

function mutate(change) {
  const registry = structuredClone(loaded.registry);
  change(registry);
  return validateRegistry({ registry, schema: loaded.schema });
}

test('loadRegistry returns the registry, its schema, and the paths it read', () => {
  assert.equal(loaded.registryPath, REGISTRY_PATH);
  assert.equal(loaded.schemaPath, SCHEMA_PATH);
  assert.equal(loaded.registry.schema_version, 1);
  assert.equal(loaded.registry.concerns.length, 27);
});

test('loadRegistry reports an unreadable registry as a runtime failure', () => {
  assert.throws(
    () => loadRegistry({ registryPath: `${REGISTRY_PATH}.missing` }),
    (error) => {
      assert.equal(error.exitCode, 3);
      assert.match(error.message, /Cannot read concern registry/);
      return true;
    }
  );
});

test('the canonical registry passes schema and semantic validation', () => {
  const result = validateRegistry(loaded);
  assert.deepEqual(result.schema_errors, []);
  assert.deepEqual(result.semantic_errors, []);
  assert.equal(result.valid, true);
});

test('schema violations are reported with their instance path', () => {
  const result = mutate((registry) => {
    registry.concerns[0].activation.minimum_signals = 99;
  });
  assert.equal(result.valid, false);
  assert.ok(result.schema_errors.some((error) => error.path.startsWith('/concerns/0/activation')));
});

// These mutations all satisfy the JSON Schema. Only the cross-record rules catch
// them, so each one proves semantic validation is doing work the schema cannot.
test('a related concern that does not exist is a semantic error', () => {
  const result = mutate((registry) => {
    registry.concerns[5].related = { kind: 'ids', ids: ['no-such-concern'] };
  });
  assert.deepEqual(result.schema_errors, []);
  assert.ok(result.semantic_errors.some((error) => /relates to unknown concern no-such-concern/.test(error.message)));
});

test('a concern relating to itself is a semantic error', () => {
  const result = mutate((registry) => {
    registry.concerns[5].related = { kind: 'ids', ids: [registry.concerns[5].id] };
  });
  assert.ok(result.semantic_errors.some((error) => /relates to itself/.test(error.message)));
});

test('a duplicate concern id is a semantic error', () => {
  const result = mutate((registry) => {
    registry.concerns[6].id = registry.concerns[5].id;
  });
  assert.ok(result.semantic_errors.some((error) => /duplicate concern id/.test(error.message)));
});

test('a named invariant claimed by two concerns is a semantic error', () => {
  const result = mutate((registry) => {
    const source = registry.concerns.find((concern) => concern.named_invariants.length > 0);
    const other = registry.concerns.find((concern) => concern.id !== source.id);
    other.named_invariants = [structuredClone(source.named_invariants[0])];
  });
  assert.ok(result.semantic_errors.some((error) => /claimed by more than one concern/.test(error.message)));
});

test('a never-suppressed concern that is not always-on is a semantic error', () => {
  const result = mutate((registry) => {
    registry.classification_policy.never_suppressed_concerns = ['context-engine'];
  });
  assert.ok(result.semantic_errors.some((error) => /must activate always/.test(error.message)));
});

test('an unknown discrepancy reference is a semantic error', () => {
  const result = mutate((registry) => {
    registry.category_defaults.discrepancy_id = 'not-recorded';
  });
  assert.ok(result.semantic_errors.some((error) => /unknown discrepancy reference not-recorded/.test(error.message)));
});

test('an uncertain class that is not a declared change class is a semantic error', () => {
  const result = mutate((registry) => {
    registry.classification_policy.uncertain_class = 'invented';
  });
  assert.ok(result.semantic_errors.some((error) => /not a declared change class/.test(error.message)));
});

test('a dispatch policy that names a different specialist skill is a semantic error', () => {
  const result = mutate((registry) => {
    registry.dispatch_policy.security_specialist.specialist_skill = 'other';
  });
  assert.ok(result.semantic_errors.some((error) => /disagree on the specialist skill/.test(error.message)));
});

test('an unresolved selector pointing at a resolved discrepancy is a semantic error', () => {
  const result = mutate((registry) => {
    const discrepancy = registry.migration_discrepancies.find((entry) => entry.id === 'go-backend-continue-selector');
    discrepancy.resolution = 'preserved_current_behavior';
  });
  assert.ok(
    result.semantic_errors.some((error) => /unresolved selector for a resolved discrepancy/.test(error.message))
  );
});

test('the Phase 1 migration discrepancies survive validation unresolved', () => {
  const unresolved = loaded.registry.migration_discrepancies.filter((entry) => entry.resolution === 'unresolved');
  assert.ok(unresolved.length > 0, 'Phase 2 must not resolve the recorded discrepancies');
  assert.equal(loaded.registry.signal_policy.semantic_evidence_requirement.status, 'unresolved');
  assert.equal(validateRegistry(loaded).valid, true);
});
