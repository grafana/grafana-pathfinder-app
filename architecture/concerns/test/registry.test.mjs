import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const concernsDir = join(here, '..');
const invalidDir = join(here, 'fixtures', 'invalid-registries');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const schema = readJson(join(concernsDir, 'registry.schema.json'));
const registry = readJson(join(concernsDir, 'registry.json'));

// The published review-state contract. A rename breaks every serialized
// `concern_id` in prior reviews, so this list is pinned rather than derived.
const STABLE_CONCERN_IDS = [
  'security',
  'correctness-and-reliability',
  'testing-and-verification',
  'reversibility-and-one-way-door',
  'cross-cutting-architecture',
  'context-engine',
  'docs-retrieval-and-rendering',
  'interactive-engine',
  'requirements-manager',
  'guide-schema-and-contracts',
  'build-and-ci',
  'cli-and-e2e-runner',
  'ai-subsystem',
  'go-backend',
  'coda-terminal',
  'mcp-authoring-server',
  'package-engine',
  'assistant-integration',
  'workshop-collaboration',
  'cross-tab-controller',
  'block-editor-authoring',
  'data-check',
  'floating-panel',
  'completion-records',
  'full-screen-sidebar-handoff',
  'analytics-and-telemetry',
  'performance-and-bundle',
];

// The legacy validator hard-codes these bounds, so raising one in the registry
// must fail here rather than silently retire a rule the Markdown registry keeps.
const PINNED_CONTRACT_LIMITS = {
  maximum_established_records_per_concern: 1,
  maximum_candidate_records_per_concern: 1,
};
const PINNED_INVARIANT_NAMES_GLOBALLY_UNIQUE = true;

function compile() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  return ajv.compile(schema);
}

const validate = compile();

function selectorsOf(concern) {
  return concern.activation.kind === 'always' ? concern.activation.context_selectors : concern.activation.selectors;
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

test('the canonical registry validates against the schema', () => {
  assert.equal(validate(registry), true, JSON.stringify(validate.errors, null, 2));
});

// A fixture is one mutation of the canonical registry, so the corpus stays a set
// of malformed cases rather than a second copy of the registry.
function applyFixture(fixture) {
  const instance = structuredClone(registry);
  const base = fixture.concern_id
    ? instance.concerns[registry.concerns.findIndex((concern) => concern.id === fixture.concern_id)]
    : instance;
  assert.ok(base, `fixture names an unknown concern ${fixture.concern_id}`);

  const steps = fixture.pointer.split('/').slice(1).map(unescapePointer);
  const leaf = steps.pop();
  const parent = steps.reduce((node, step) => node[step], base);
  if (fixture.operation === 'remove') {
    delete parent[leaf];
  } else {
    parent[leaf] = fixture.value;
  }

  assert.notDeepEqual(instance, registry, 'the fixture left the registry unchanged');

  const prefix = fixture.concern_id
    ? `/concerns/${registry.concerns.findIndex((concern) => concern.id === fixture.concern_id)}`
    : '';
  return { instance, expected: `${prefix}${fixture.expect_error_at}` };
}

function unescapePointer(step) {
  return step.replaceAll('~1', '/').replaceAll('~0', '~');
}

test('every malformed fixture is rejected for the reason it names', () => {
  const fixtures = readdirSync(invalidDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.ok(fixtures.length > 0, 'expected at least one invalid-registry fixture');
  for (const fixture of fixtures) {
    const spec = readJson(join(invalidDir, fixture));
    const { instance, expected } = applyFixture(spec);
    assert.equal(validate(instance), false, `${fixture} should not validate: ${spec.description}`);
    const paths = validate.errors.map((error) => error.instancePath);
    assert.ok(
      paths.some((path) => path === expected || (expected !== '' && path.startsWith(`${expected}/`))),
      `${fixture} failed, but not at ${expected || '<root>'}; errors at ${JSON.stringify(paths)}`
    );
  }
});

test('the 27 stable concern ids are preserved in order', () => {
  assert.deepEqual(
    registry.concerns.map((concern) => concern.id),
    STABLE_CONCERN_IDS
  );
});

test('concern ids are unique', () => {
  assert.deepEqual(duplicates(registry.concerns.map((concern) => concern.id)), []);
});

test('related concerns reference concerns that exist', () => {
  const known = new Set(registry.concerns.map((concern) => concern.id));
  for (const concern of registry.concerns) {
    if (concern.related.kind !== 'ids') {
      continue;
    }
    for (const id of concern.related.ids) {
      assert.ok(known.has(id), `${concern.id} relates to unknown concern ${id}`);
      assert.notEqual(id, concern.id, `${concern.id} relates to itself`);
    }
  }
});

test('policy concern references resolve, and always-run concerns activate always', () => {
  const byId = new Map(registry.concerns.map((concern) => [concern.id, concern]));
  for (const id of registry.classification_policy.never_suppressed_concerns) {
    const concern = byId.get(id);
    assert.ok(concern, `never-suppressed concern ${id} is not in the registry`);
    assert.equal(concern.activation.kind, 'always', `${id} must activate always`);
  }
  const specialist = byId.get(registry.dispatch_policy.security_specialist.concern_id);
  assert.ok(specialist, 'the security specialist concern is not in the registry');
  assert.equal(specialist.dispatch.kind, 'specialist');
  assert.equal(
    specialist.dispatch.specialist_skill,
    registry.dispatch_policy.security_specialist.specialist_skill,
    'concern dispatch and dispatch policy name different specialist skills'
  );
});

test('named invariant names are globally unique and belong to their concern', () => {
  const names = registry.concerns.flatMap((concern) => concern.named_invariants.map((invariant) => invariant.name));
  assert.deepEqual(duplicates(names), []);
  assert.equal(registry.invariant_policy.names_globally_unique, PINNED_INVARIANT_NAMES_GLOBALLY_UNIQUE);
});

test('contract records stay within the per-concern limits', () => {
  const {
    maximum_established_records_per_concern: maxEstablished,
    maximum_candidate_records_per_concern: maxCandidate,
  } = PINNED_CONTRACT_LIMITS;
  assert.equal(registry.contract_policy.maximum_established_records_per_concern, maxEstablished);
  assert.equal(registry.contract_policy.maximum_candidate_records_per_concern, maxCandidate);
  for (const concern of registry.concerns) {
    const established = concern.contract_records.filter((record) => record.kind === 'established').length;
    const candidates = concern.contract_records.filter((record) => record.kind === 'candidate').length;
    assert.ok(established <= maxEstablished, `${concern.id} has ${established} established contract records`);
    assert.ok(candidates <= maxCandidate, `${concern.id} has ${candidates} candidate records`);
  }
});

test('every discrepancy reference resolves to a recorded discrepancy', () => {
  const known = new Set(registry.migration_discrepancies.map((entry) => entry.id));
  assert.deepEqual(duplicates([...registry.migration_discrepancies.map((entry) => entry.id)]), []);

  const referenced = [
    registry.category_defaults.discrepancy_id,
    registry.signal_policy.semantic_evidence_requirement.discrepancy_id,
    registry.coverage_gap_policy.file_universe.discrepancy_id,
    registry.dispatch_policy.discrepancy_id,
  ];
  for (const concern of registry.concerns) {
    for (const selector of selectorsOf(concern).semantics) {
      if (selector.kind === 'unresolved_selector') {
        referenced.push(selector.discrepancy_id);
      }
    }
    if (concern.dispatch.kind === 'specialist' && concern.dispatch.discrepancy_id) {
      referenced.push(concern.dispatch.discrepancy_id);
    }
  }
  for (const id of referenced) {
    assert.ok(known.has(id), `unknown discrepancy reference ${id}`);
  }
});

test('the known activation conflict is recorded rather than resolved', () => {
  const conflict = registry.migration_discrepancies.find((entry) => entry.id === 'path-only-activation');
  assert.ok(conflict, 'the path-only versus semantic-signal conflict must stay visible');
  assert.equal(conflict.resolution, 'unresolved');
  assert.ok(conflict.candidate_readings.length >= 2, 'an unresolved conflict must record competing readings');
  assert.equal(registry.signal_policy.semantic_evidence_requirement.status, 'unresolved');
});

test('every unresolved selector records competing readings instead of choosing one', () => {
  for (const concern of registry.concerns) {
    for (const selector of selectorsOf(concern).semantics) {
      if (selector.kind !== 'unresolved_selector') {
        continue;
      }
      const discrepancy = registry.migration_discrepancies.find((entry) => entry.id === selector.discrepancy_id);
      assert.equal(discrepancy.resolution, 'unresolved', `${concern.id} selector claims a resolved discrepancy`);
      assert.deepEqual(discrepancy.candidate_readings, selector.candidate_values);
    }
  }
});

test('activation mode and category agree with the declared category defaults', () => {
  const defaults = new Map(registry.category_defaults.categories.map((entry) => [entry.category, entry]));
  for (const concern of registry.concerns) {
    const categoryDefault = defaults.get(concern.activation.category);
    assert.ok(categoryDefault, `${concern.id} uses an undeclared category`);
    assert.equal(concern.activation.mode, categoryDefault.mode, `${concern.id} mode disagrees with its category`);
    assert.equal(
      concern.activation.kind,
      categoryDefault.conditional ? 'signals' : 'always',
      `${concern.id} activation kind disagrees with its category`
    );
    assert.equal(
      concern.activation.rationale,
      expectedRationale(concern, categoryDefault),
      `${concern.id} rationale states a threshold its numbers do not`
    );
  }
});

function expectedRationale(concern, categoryDefault) {
  const { category, minimum_signals: minimum } = concern.activation;
  const declared = categoryDefault.default_minimum_signals;
  if (!categoryDefault.conditional) {
    return `Always-on: runs on every review, so its selectors choose context rather than decide whether ${concern.id} activates.`;
  }
  return minimum === declared
    ? `Conditional ${category} concern at the category default of ${declared} minimum signals.`
    : `Conditional ${category} concern overriding the category default of ${declared} minimum signals with ${minimum}.`;
}

test('change class references resolve', () => {
  const classes = new Set(registry.change_classes.map((entry) => entry.id));
  assert.ok(classes.has(registry.classification_policy.uncertain_class));
});
