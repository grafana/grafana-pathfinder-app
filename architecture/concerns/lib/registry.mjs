import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runtimeError } from './errors.mjs';
import { selectorSetOf } from './selectors.mjs';

export const ENVELOPE_SCHEMA_VERSION = 1;

export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DEFAULT_REGISTRY_PATH = fileURLToPath(new URL('../registry.json', import.meta.url));
export const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('../registry.schema.json', import.meta.url));

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw runtimeError(`Cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw runtimeError(
      `${label} at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function loadRegistry({ registryPath = DEFAULT_REGISTRY_PATH, schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
  return {
    registry: readJson(registryPath, 'concern registry'),
    schema: readJson(schemaPath, 'registry schema'),
    registryPath,
    schemaPath,
  };
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

function schemaErrors(registry, schema) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);
  if (validate(registry)) {
    return [];
  }
  return validate.errors.map((error) => ({
    path: error.instancePath === '' ? '<root>' : error.instancePath,
    message: `${error.keyword}: ${error.message}`,
  }));
}

function semanticErrors(registry) {
  const errors = [];
  const at = (path, message) => errors.push({ path, message });
  const concerns = Array.isArray(registry.concerns) ? registry.concerns : [];
  const byId = new Map(concerns.map((concern) => [concern.id, concern]));

  for (const id of duplicates(concerns.map((concern) => concern.id))) {
    at('/concerns', `duplicate concern id ${id}`);
  }

  for (const [index, concern] of concerns.entries()) {
    const base = `/concerns/${index}`;
    if (concern.related?.kind === 'ids') {
      for (const related of concern.related.ids) {
        if (!byId.has(related)) {
          at(`${base}/related`, `${concern.id} relates to unknown concern ${related}`);
        }
        if (related === concern.id) {
          at(`${base}/related`, `${concern.id} relates to itself`);
        }
      }
    }
    const category = registry.category_defaults?.categories?.find(
      (entry) => entry.category === concern.activation?.category
    );
    if (!category) {
      at(`${base}/activation`, `${concern.id} uses undeclared category ${concern.activation?.category}`);
    } else {
      if (concern.activation.mode !== category.mode) {
        at(`${base}/activation`, `${concern.id} mode ${concern.activation.mode} disagrees with its category`);
      }
      if (concern.activation.kind !== (category.conditional ? 'signals' : 'always')) {
        at(`${base}/activation`, `${concern.id} activation kind disagrees with its category`);
      }
    }
    const established = concern.contract_records?.filter((record) => record.kind === 'established').length ?? 0;
    const candidates = concern.contract_records?.filter((record) => record.kind === 'candidate').length ?? 0;
    if (established > (registry.contract_policy?.maximum_established_records_per_concern ?? 1)) {
      at(`${base}/contract_records`, `${concern.id} has ${established} established contract records`);
    }
    if (candidates > (registry.contract_policy?.maximum_candidate_records_per_concern ?? 1)) {
      at(`${base}/contract_records`, `${concern.id} has ${candidates} candidate contract records`);
    }
  }

  const invariantNames = concerns.flatMap((concern) =>
    (concern.named_invariants ?? []).map((invariant) => invariant.name)
  );
  for (const name of duplicates(invariantNames)) {
    at('/concerns', `named invariant ${name} is claimed by more than one concern`);
  }

  const changeClasses = new Set((registry.change_classes ?? []).map((entry) => entry.id));
  if (!changeClasses.has(registry.classification_policy?.uncertain_class)) {
    at('/classification_policy/uncertain_class', 'the uncertain class is not a declared change class');
  }
  for (const id of registry.classification_policy?.never_suppressed_concerns ?? []) {
    const concern = byId.get(id);
    if (!concern) {
      at('/classification_policy/never_suppressed_concerns', `unknown concern ${id}`);
    } else if (concern.activation.kind !== 'always') {
      at('/classification_policy/never_suppressed_concerns', `${id} must activate always`);
    }
  }

  const specialist = byId.get(registry.dispatch_policy?.security_specialist?.concern_id);
  if (!specialist) {
    at('/dispatch_policy/security_specialist', 'the security specialist concern is not in the registry');
  } else if (
    specialist.dispatch.kind !== 'specialist' ||
    specialist.dispatch.specialist_skill !== registry.dispatch_policy.security_specialist.specialist_skill
  ) {
    at('/dispatch_policy/security_specialist', 'concern dispatch and dispatch policy disagree on the specialist skill');
  }

  const knownDiscrepancies = new Set((registry.migration_discrepancies ?? []).map((entry) => entry.id));
  for (const id of duplicates([...(registry.migration_discrepancies ?? []).map((entry) => entry.id)])) {
    at('/migration_discrepancies', `duplicate discrepancy id ${id}`);
  }
  const references = [
    ['/category_defaults', registry.category_defaults?.discrepancy_id],
    ['/signal_policy', registry.signal_policy?.semantic_evidence_requirement?.discrepancy_id],
    ['/coverage_gap_policy', registry.coverage_gap_policy?.file_universe?.discrepancy_id],
    ['/dispatch_policy', registry.dispatch_policy?.discrepancy_id],
  ];
  for (const [index, concern] of concerns.entries()) {
    const base = `/concerns/${index}`;
    for (const selector of selectorSetOf(concern).semantics ?? []) {
      if (selector.kind !== 'unresolved_selector') {
        continue;
      }
      references.push([`${base}/activation`, selector.discrepancy_id]);
      const discrepancy = (registry.migration_discrepancies ?? []).find(
        (entry) => entry.id === selector.discrepancy_id
      );
      if (discrepancy && discrepancy.resolution !== 'unresolved') {
        at(`${base}/activation`, `${concern.id} keeps an unresolved selector for a resolved discrepancy`);
      }
    }
    if (concern.dispatch?.discrepancy_id) {
      references.push([`${base}/dispatch`, concern.dispatch.discrepancy_id]);
    }
    if (concern.output_policy?.discrepancy_id) {
      references.push([`${base}/output_policy`, concern.output_policy.discrepancy_id]);
    }
  }
  for (const [path, id] of references) {
    if (id !== undefined && !knownDiscrepancies.has(id)) {
      at(path, `unknown discrepancy reference ${id}`);
    }
  }

  const categories = new Set((registry.category_defaults?.categories ?? []).map((entry) => entry.category));
  for (const category of registry.dispatch_policy?.contract_evolution_gate?.applies_to_categories ?? []) {
    if (!categories.has(category)) {
      at('/dispatch_policy/contract_evolution_gate', `unknown category ${category}`);
    }
  }

  return errors;
}

export function validateRegistry({ registry, schema }) {
  const schema_errors = schemaErrors(registry, schema);
  const semantic_errors = schema_errors.length > 0 ? [] : semanticErrors(registry);
  return {
    valid: schema_errors.length === 0 && semantic_errors.length === 0,
    schema_errors,
    semantic_errors,
  };
}

export function findConcern(registry, id) {
  return registry.concerns.find((concern) => concern.id === id) ?? null;
}
