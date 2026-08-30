import { usageError } from './errors.mjs';
import { describeInput, matchConcerns } from './matching.mjs';
import { ENVELOPE_SCHEMA_VERSION } from './registry.mjs';
import { pathSelectorMatches, selectorSetOf } from './selectors.mjs';

const HIGH_VALUE_CONDITION = 'repeated high-value symbols appear with no concern trigger';

export const ROUTE_INPUT_KEYS = ['schema_version', 'paths', 'diff', 'change_class'];

export const ROUTE_INPUT_DESCRIPTION = [
  'The --input document is a JSON object:',
  '  schema_version  required integer, must be 1',
  '  paths           optional array of repository-relative changed paths',
  '  diff            optional unified-diff string for semantic evidence',
  '  change_class    optional change-class id; an unknown id fails open',
].join('\n');

export function normalizeRouteInput(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw usageError('The --input document must be a JSON object.');
  }
  const unknown = Object.keys(raw).filter((key) => !ROUTE_INPUT_KEYS.includes(key));
  if (unknown.length > 0) {
    throw usageError(`The --input document has unknown key(s): ${unknown.sort().join(', ')}.`);
  }
  if (raw.schema_version !== ENVELOPE_SCHEMA_VERSION) {
    throw usageError(`The --input document must declare "schema_version": ${ENVELOPE_SCHEMA_VERSION}.`);
  }
  if (raw.paths !== undefined && (!Array.isArray(raw.paths) || raw.paths.some((path) => typeof path !== 'string'))) {
    throw usageError('The --input document\'s "paths" must be an array of strings.');
  }
  if (raw.diff !== undefined && typeof raw.diff !== 'string') {
    throw usageError('The --input document\'s "diff" must be a string.');
  }
  if (raw.change_class !== undefined && typeof raw.change_class !== 'string') {
    throw usageError('The --input document\'s "change_class" must be a string.');
  }
  return {
    paths: raw.paths ?? [],
    text: raw.diff ?? null,
    changeClass: raw.change_class ?? null,
  };
}

function resolveChangeClass(registry, requested) {
  const fallback = registry.classification_policy.uncertain_class;
  if (requested === null || requested === undefined) {
    return {
      value: fallback,
      requested: null,
      source: 'unspecified_fail_open',
      disclosure: {
        kind: 'change_class_not_supplied',
        message: `no change class was supplied, so routing reports the registry's uncertain class (${fallback})`,
      },
    };
  }
  if (registry.change_classes.some((entry) => entry.id === requested)) {
    return { value: requested, requested, source: 'explicit', disclosure: null };
  }
  return {
    value: fallback,
    requested,
    source: 'unknown_class_fail_open',
    disclosure: {
      kind: 'unknown_change_class',
      message: `change class ${requested} is not declared in the registry, so routing failed open to ${fallback}`,
    },
  };
}

function directoryOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '.' : path.slice(0, index);
}

function conditionalPathOwners(registry, path) {
  const owners = [];
  for (const concern of registry.concerns) {
    if (concern.activation.kind !== 'signals') {
      continue;
    }
    if (selectorSetOf(concern).paths.some((selector) => pathSelectorMatches(selector, path))) {
      owners.push(concern.id);
    }
  }
  return owners;
}

function coverageGaps(registry, input, activatedConditional) {
  const conditions = registry.coverage_gap_policy.conditions;
  const gaps = [];

  const clusters = new Map();
  for (const path of input.paths) {
    const directory = directoryOf(path);
    if (!clusters.has(directory)) {
      clusters.set(directory, []);
    }
    clusters.get(directory).push(path);
  }
  const clusterCondition = conditions.find((text) => text.includes('directory with multiple changed files'));
  for (const [directory, paths] of [...clusters].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (paths.length < 2) {
      continue;
    }
    if (paths.some((path) => conditionalPathOwners(registry, path).length > 0)) {
      continue;
    }
    gaps.push({
      kind: 'unowned_directory_cluster',
      condition: clusterCondition ?? null,
      directory,
      paths: [...paths].sort(),
    });
  }

  const onlyAlwaysOnCondition = conditions.find((text) => text.includes('always-on'));
  if (activatedConditional === 0 && (input.paths.length > 0 || input.semantics.hunks.length > 0)) {
    gaps.push({
      kind: 'only_always_on_coverage',
      condition: onlyAlwaysOnCondition ?? null,
      detail: 'no conditional concern activated, so every changed file is covered only by always-on concerns',
    });
  }

  return gaps;
}

export function routeConcerns({ registry, input, changeClass = null }) {
  const matched = matchConcerns({ registry, input });
  const evidenceById = new Map(matched.concerns.map((entry) => [entry.id, entry]));
  const changeClassResult = resolveChangeClass(registry, changeClass);
  const requirement = registry.signal_policy.semantic_evidence_requirement;
  const semanticRequired = requirement.applies_to_activation_kinds.includes('signals');

  const activated = [];
  const withheld = [];
  const considered = [];
  const pathOnlyCandidates = [];

  for (const concern of registry.concerns) {
    const evidence = evidenceById.get(concern.id) ?? null;
    const pathSignals = evidence ? evidence.distinct_matched_paths.length : 0;
    const semanticSignals = evidence ? evidence.distinct_semantic_hits : 0;
    const signals = {
      path: pathSignals,
      semantic: semanticSignals,
      total: pathSignals + semanticSignals,
      minimum_required: concern.activation.minimum_signals,
    };
    const record = {
      id: concern.id,
      name: concern.name,
      category: concern.activation.category,
      mode: concern.activation.mode,
      signals,
      dispatch: concern.dispatch,
      specialist: concern.dispatch.kind === 'specialist' ? concern.dispatch.specialist_skill : null,
      max_context_files: concern.context_budget.max_context_files,
      evidence: evidence
        ? { paths: evidence.path_evidence, semantics: evidence.semantic_evidence }
        : { paths: [], semantics: [] },
    };

    if (concern.activation.kind === 'always') {
      activated.push({ ...record, reason: 'always_on' });
      continue;
    }

    const meetsThreshold = signals.total >= concern.activation.minimum_signals;
    if (meetsThreshold && semanticRequired && semanticSignals === 0) {
      pathOnlyCandidates.push(concern.id);
      withheld.push({ ...record, reason: 'semantic_evidence_required' });
      continue;
    }
    if (meetsThreshold) {
      activated.push({ ...record, reason: 'signals' });
      continue;
    }
    if (signals.total > 0) {
      considered.push({ ...record, reason: 'below_minimum_signals' });
    }
  }

  const activatedConditional = activated.filter((entry) => entry.reason === 'signals').length;
  const disclosures = [...input.disclosures];
  if (changeClassResult.disclosure) {
    disclosures.push(changeClassResult.disclosure);
  }
  disclosures.push({
    kind: 'change_class_not_applied',
    message:
      'the registry declares no per-concern change-class filter, so the change class is reported for the caller rather than applied to activation',
  });
  disclosures.push({
    kind: 'semantic_evidence_requirement',
    discrepancy_id: requirement.discrepancy_id,
    status: requirement.status,
    message: `${requirement.statement} This requirement is recorded as ${requirement.status} in the registry; ${pathOnlyCandidates.length} concern(s) reached the signal threshold on paths alone and were withheld under it.`,
    path_only_candidates: pathOnlyCandidates,
  });
  disclosures.push({
    kind: 'signal_value_not_machine_decidable',
    message: `${registry.signal_policy.statement} The registry does not mark which semantic selectors are high value, so every distinct selector/path/hunk hit counts as one signal.`,
  });
  disclosures.push({
    kind: 'coverage_condition_not_evaluated',
    condition: HIGH_VALUE_CONDITION,
    message: 'this coverage-gap condition needs a high-value-symbol classification the registry does not carry',
  });

  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    change_class: {
      value: changeClassResult.value,
      requested: changeClassResult.requested,
      source: changeClassResult.source,
    },
    input: describeInput(input),
    activated,
    withheld,
    considered,
    coverage_gaps: coverageGaps(registry, input, activatedConditional),
    disclosures,
    policy: {
      coverage_gap_disposition: registry.coverage_gap_policy.disposition,
      coverage_gap_is_gate: registry.coverage_gap_policy.is_gate,
      file_universe_status: registry.coverage_gap_policy.file_universe.status,
      semantic_evidence_requirement_status: requirement.status,
      never_suppressed_concerns: registry.classification_policy.never_suppressed_concerns,
      final_cross_cutting_synthesis_always_runs:
        registry.classification_policy.final_cross_cutting_synthesis_always_runs,
    },
  };
}
