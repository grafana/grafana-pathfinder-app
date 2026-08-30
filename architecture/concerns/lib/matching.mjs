import { analyzeSemanticInput } from './diff.mjs';
import { ENVELOPE_SCHEMA_VERSION } from './registry.mjs';
import {
  normalizeRepositoryPaths,
  pathSelectorDisplay,
  pathSelectorMatches,
  selectorSetOf,
  semanticSelectorDisplay,
  semanticSelectorValues,
} from './selectors.mjs';

export function analyzeInput({ paths = [], text = null } = {}) {
  const normalized = normalizeRepositoryPaths(paths);
  const semantics = analyzeSemanticInput(text);
  const combined = [...normalized.accepted];
  for (const path of semantics.derived_paths) {
    if (!combined.includes(path)) {
      combined.push(path);
    }
  }
  combined.sort();
  return {
    paths: combined,
    rejected_paths: normalized.rejected,
    explicit_path_count: normalized.accepted.length,
    derived_path_count: semantics.derived_paths.length,
    semantics: { source: semantics.source, hunks: semantics.hunks },
    disclosures: semantics.disclosures,
  };
}

export function describeInput(input) {
  return {
    paths: {
      accepted: input.paths.length,
      explicit: input.explicit_path_count,
      derived_from_diff: input.derived_path_count,
      rejected: input.rejected_paths,
    },
    semantics: {
      source: input.semantics.source,
      hunk_count: input.semantics.hunks.length,
    },
    disclosures: input.disclosures,
  };
}

function occurrencesOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function pathEvidenceFor(concern, paths) {
  const evidence = [];
  for (const selector of selectorSetOf(concern).paths) {
    const matched = paths.filter((path) => pathSelectorMatches(selector, path));
    if (matched.length > 0) {
      evidence.push({
        selector: { kind: selector.kind, value: pathSelectorDisplay(selector) },
        paths: matched,
      });
    }
  }
  return evidence;
}

function semanticEvidenceFor(concern, hunkTexts) {
  const evidence = [];
  for (const selector of selectorSetOf(concern).semantics) {
    const hits = [];
    for (const value of semanticSelectorValues(selector)) {
      for (const { hunk, text } of hunkTexts) {
        const occurrences = occurrencesOf(text, value);
        if (occurrences > 0) {
          hits.push({ path: hunk.path, hunk: hunk.index, matched_value: value, occurrences });
        }
      }
    }
    if (hits.length > 0) {
      evidence.push({ selector: { kind: selector.kind, value: semanticSelectorDisplay(selector) }, hits });
    }
  }
  return evidence;
}

// Raw evidence only. Whether a concern activates is routeConcerns' decision; the
// counts here are the deduplicated facts that decision is made from.
export function matchConcerns({ registry, input }) {
  const hunkTexts = input.semantics.hunks.map((hunk) => ({ hunk, text: hunk.lines.join('\n') }));
  const concerns = [];
  for (const concern of registry.concerns) {
    const path_evidence = pathEvidenceFor(concern, input.paths);
    const semantic_evidence = semanticEvidenceFor(concern, hunkTexts);
    if (path_evidence.length === 0 && semantic_evidence.length === 0) {
      continue;
    }
    const gatingPaths = new Set();
    for (const entry of path_evidence) {
      if (entry.selector.kind === 'all_changed_files') {
        continue;
      }
      for (const path of entry.paths) {
        gatingPaths.add(path);
      }
    }
    const semanticKeys = new Set();
    for (const entry of semantic_evidence) {
      for (const hit of entry.hits) {
        semanticKeys.add([entry.selector.value, hit.path ?? '', hit.hunk].join(' '));
      }
    }
    concerns.push({
      id: concern.id,
      name: concern.name,
      category: concern.activation.category,
      activation_kind: concern.activation.kind,
      path_evidence,
      semantic_evidence,
      distinct_matched_paths: [...gatingPaths].sort(),
      distinct_semantic_hits: semanticKeys.size,
    });
  }
  return { schema_version: ENVELOPE_SCHEMA_VERSION, input: describeInput(input), concerns };
}
