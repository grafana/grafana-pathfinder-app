const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export function normalizeRepositoryPath(value) {
  if (typeof value !== 'string') {
    return { ok: false, value: String(value), reason: 'not_a_string' };
  }
  if (value.length === 0) {
    return { ok: false, value, reason: 'empty' };
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, value, reason: 'control_character' };
  }
  if (value.startsWith('/')) {
    return { ok: false, value, reason: 'absolute_path' };
  }
  const segments = [];
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return { ok: false, value, reason: 'parent_traversal' };
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    return { ok: false, value, reason: 'empty' };
  }
  return { ok: true, value, path: segments.join('/') };
}

export function normalizeRepositoryPaths(values) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const value of values) {
    const result = normalizeRepositoryPath(value);
    if (!result.ok) {
      rejected.push({ value: result.value, reason: result.reason });
      continue;
    }
    if (seen.has(result.path)) {
      continue;
    }
    seen.add(result.path);
    accepted.push(result.path);
  }
  return { accepted, rejected };
}

function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function segmentPattern(segment) {
  let out = '';
  for (const character of segment) {
    if (character === '*') {
      out += '[^/]*';
    } else if (character === '?') {
      out += '[^/]';
    } else {
      out += escapeLiteral(character);
    }
  }
  return out;
}

// `a/**` matches everything below `a` but not `a` itself, and `a/**/b` matches
// `a/b` as well as `a/x/y/b` — the same zero-or-more-directories reading Git
// gives `:(glob)` pathspecs, which is where these patterns came from.
export function globToRegExp(pattern) {
  const segments = pattern.split('/');
  let source = '^';
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]*/)*';
      continue;
    }
    source += segmentPattern(segment);
    if (!last) {
      source += '/';
    }
  }
  return new RegExp(`${source}$`);
}

const globCache = new Map();

function compiledGlob(pattern) {
  let compiled = globCache.get(pattern);
  if (compiled === undefined) {
    compiled = globToRegExp(pattern);
    globCache.set(pattern, compiled);
  }
  return compiled;
}

export function pathSelectorDisplay(selector) {
  if (selector.kind === 'glob') {
    return selector.pattern;
  }
  if (selector.kind === 'literal_path') {
    return selector.path;
  }
  return selector.source_text;
}

export function semanticSelectorDisplay(selector) {
  return selector.kind === 'substring' ? selector.value : selector.source_text;
}

export function pathSelectorMatches(selector, path) {
  if (selector.kind === 'glob') {
    return compiledGlob(selector.pattern).test(path);
  }
  if (selector.kind === 'literal_path') {
    return selector.path === path;
  }
  return selector.kind === 'all_changed_files';
}

// An unresolved selector has no single agreed value, so every candidate reading
// counts as a hit. Narrowing it here would resolve a discrepancy Phase 1
// deliberately left open.
export function semanticSelectorValues(selector) {
  return selector.kind === 'substring' ? [selector.value] : selector.candidate_values;
}

export function selectorSetOf(concern) {
  return concern.activation.kind === 'always' ? concern.activation.context_selectors : concern.activation.selectors;
}

export function directoryOf(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '.' : path.slice(0, index);
}

// Routing's cluster gap and coverage's unmapped classification ask the same
// question, so both read ownership from here: whether they agree is a contract,
// not a coincidence. Always-on concerns claim every path and so own none.
export function conditionalOwnersOf(registry, path) {
  const strong = [];
  const weak = [];
  for (const concern of registry.concerns) {
    if (concern.activation.kind !== 'signals') {
      continue;
    }
    if (!selectorSetOf(concern).paths.some((selector) => pathSelectorMatches(selector, path))) {
      continue;
    }
    (concern.activation.mode === 'weak' ? weak : strong).push(concern.id);
  }
  return { strong, weak };
}
