import { ENVELOPE_SCHEMA_VERSION } from './registry.mjs';
import { conditionalOwnersOf, directoryOf, normalizeRepositoryPaths } from './selectors.mjs';

// Classification, not judgement: an unmapped path means no conditional concern
// claims it, which the registry's own policy says must be disclosed rather than
// treated as a defect. Always-on concerns cover every path and so never map one.
export function computeCoverage({ registry, paths }) {
  const { accepted, rejected } = normalizeRepositoryPaths(paths);
  const mapped = [];
  const weakly_mapped = [];
  const unmapped = [];

  for (const path of [...accepted].sort()) {
    const { strong, weak } = conditionalOwnersOf(registry, path);
    if (strong.length > 0) {
      mapped.push({ path, concern_ids: strong });
    } else if (weak.length > 0) {
      weakly_mapped.push({ path, concern_ids: weak });
    } else {
      unmapped.push(path);
    }
  }

  const clusters = new Map();
  for (const path of unmapped) {
    const directory = directoryOf(path);
    if (!clusters.has(directory)) {
      clusters.set(directory, []);
    }
    clusters.get(directory).push(path);
  }

  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    counts: {
      total: accepted.length,
      mapped: mapped.length,
      weakly_mapped: weakly_mapped.length,
      unmapped: unmapped.length,
      rejected: rejected.length,
    },
    mapped,
    weakly_mapped,
    unmapped,
    unmapped_clusters: [...clusters]
      .map(([directory, clusterPaths]) => ({ directory, count: clusterPaths.length, paths: clusterPaths }))
      .sort((left, right) => right.count - left.count || (left.directory < right.directory ? -1 : 1)),
    rejected,
    policy: {
      file_universe_status: registry.coverage_gap_policy.file_universe.status,
      file_universe_discrepancy_id: registry.coverage_gap_policy.file_universe.discrepancy_id,
      coverage_gap_is_gate: registry.coverage_gap_policy.is_gate,
      asserts_registry_completeness: false,
      weakly_mapped_definition: 'claimed only by a cross-cutting concern, whose activation mode is weak',
    },
  };
}
