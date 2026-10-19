const DOC_PATH = /\.(md|mdx)$|^docs\//;
const SKIP_PATH =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum)$|\.snap$|^src\/locales\/|(^|\/)node_modules\//;
const TEST_PATH = /\.(test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)(__tests__|tests?)\//;
const MAX_TERMS = 60;
const MAX_PER_TERM = 6;
const GENERIC_DOC_HITS = 8;
const GENERIC_PEER_HITS = 3;
const STYLE_PATH = /(^|[./-])styles?\.[cm]?[jt]sx?$|\.css$/;
const MAX_HITS = 40;
const MAX_PAIRS = 20;
const MAX_GAPS = 20;
const MAX_HIT_TEXT = 160;

const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n]){6,80}?)\1/g;
const IDENTIFIER = /\b[A-Za-z_$][\w$]{5,}\b/g;
const KEY_VALUE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b\s*[:=]\s*(['"])([^'"\n]{2,80})\2/g;
const MODULE_LINE = /^\s*(import|export)\b.*\bfrom\b|\brequire\(|^\s*import\s*['"]/;

export function isTestPath(path) {
  return TEST_PATH.test(path);
}

function isDocPath(path) {
  return DOC_PATH.test(path);
}

function clip(text) {
  return text.trim().slice(0, MAX_HIT_TEXT);
}

function usableLiteral(text) {
  const distinctive = /[_\-:/.\s]|\d|[a-z][A-Z]/.test(text);
  const pathLike = /^\.{0,2}\//.test(text) || (!/\s/.test(text) && /\/|\.(tsx?|jsx?|json|css|md|ya?ml)$/.test(text));
  return distinctive && !pathLike && !text.includes('${') && text.trim().length >= 5 && /[A-Za-z]{4}/.test(text);
}

function literalsOf(line, depth = 0) {
  const found = [];
  for (const [, , text] of line.matchAll(LITERAL)) {
    if (usableLiteral(text)) {
      found.push(text);
    }
    if (depth === 0) {
      found.push(...literalsOf(text, 1));
    }
  }
  return found;
}

function identifiersOf(line) {
  return [...line.matchAll(IDENTIFIER)].map(([name]) => name).filter((name) => /_|[a-z][A-Z]/.test(name));
}

function termsOf(lines) {
  const literals = new Set();
  const identifiers = new Set();
  for (const line of lines) {
    if (MODULE_LINE.test(line)) {
      continue;
    }
    literalsOf(line).forEach((value) => literals.add(value));
    identifiersOf(line).forEach((value) => identifiers.add(value));
  }
  return { literals, identifiers };
}

function pairsOf(lines) {
  const pairs = new Map();
  for (const line of lines) {
    for (const [, key, , value] of line.matchAll(KEY_VALUE)) {
      pairs.set(`${key}\0${value}`, { key, value });
    }
  }
  return [...pairs.values()];
}

function parseGrepOutput(output, head) {
  const prefix = `${head}:`;
  const hits = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith(prefix)) {
      continue;
    }
    const rest = line.slice(prefix.length);
    const first = rest.indexOf(':');
    const second = rest.indexOf(':', first + 1);
    if (first < 0 || second < 0) {
      continue;
    }
    hits.push({
      path: rest.slice(0, first),
      line: Number(rest.slice(first + 1, second)),
      text: clip(rest.slice(second + 1)),
    });
  }
  return hits;
}

const PRIORITY = [
  'stale-reference',
  'doc-line-in-changed-file',
  'untouched-doc',
  'config-line-in-changed-file',
  'untouched-peer',
];

function classify({ kind, hit, changedPaths, addedByPath }) {
  const doc = isDocPath(hit.path);
  const test = isTestPath(hit.path);
  if (kind === 'removed-identifier') {
    return doc ? 'stale-reference' : null;
  }
  if (kind === 'removed-literal') {
    return test ? null : 'stale-reference';
  }
  if (changedPaths.has(hit.path)) {
    if (addedByPath.get(hit.path)?.has(hit.text)) {
      return null;
    }
    if (doc) {
      return 'doc-line-in-changed-file';
    }
    return kind === 'literal' && !test ? 'config-line-in-changed-file' : null;
  }
  if (doc) {
    return 'untouched-doc';
  }
  return kind === 'literal' && !test ? 'untouched-peer' : null;
}

/**
 * Deterministic, model-free nominations for "this change left something else out of sync".
 * Terms come only from changed source files, never from docs or tests, whose fixtures are noise.
 * - a removed term that head still references: a doc for an identifier, anything non-test for a literal
 * - an unchanged line, in a doc or config the PR edited, that mentions a term the PR changed
 * - a doc the PR did not touch that mentions a changed term
 * - a changed literal that also appears in another file the PR did not touch
 * - a documented key whose doc does not list a value the PR newly emits (doc_gaps)
 * These are nominations. A hit is evidence to read, never a finding. A term with many hits is generic and dropped.
 */
export function scanSync({ git, repo, head, files, diffs }) {
  const changedPaths = new Set(files.map(({ path }) => path));
  const addedByPath = new Map();
  const addedLines = [];
  const removedLines = [];
  for (const [path, entries] of diffs) {
    const added = entries.filter(({ sign }) => sign === '+').map(({ text }) => text);
    addedByPath.set(path, new Set(added.map(clip)));
    if (!SKIP_PATH.test(path) && !isDocPath(path) && !isTestPath(path) && !STYLE_PATH.test(path)) {
      addedLines.push(...added);
      removedLines.push(...entries.filter(({ sign }) => sign === '-').map(({ text }) => text));
    }
  }

  const added = termsOf(addedLines);
  const removed = termsOf(removedLines);
  const ordered = [
    ...[...removed.literals]
      .filter((value) => !added.literals.has(value))
      .map((term) => ({ term, kind: 'removed-literal' })),
    ...[...removed.identifiers]
      .filter((value) => !added.identifiers.has(value))
      .map((term) => ({ term, kind: 'removed-identifier' })),
    ...[...added.literals].map((term) => ({ term, kind: 'literal' })),
    ...[...added.identifiers].map((term) => ({ term, kind: 'identifier' })),
  ].slice(0, MAX_TERMS);

  const hits = [];
  for (const { term, kind } of ordered) {
    const output = git(repo, ['grep', '-n', '-F', '-I', '--no-color', '-e', term, head], { allowFailure: true });
    if (!output) {
      continue;
    }
    const classified = [];
    for (const hit of parseGrepOutput(output, head)) {
      if (SKIP_PATH.test(hit.path)) {
        continue;
      }
      const classification = classify({ kind, hit, changedPaths, addedByPath });
      if (classification) {
        classified.push({ term, kind, classification, ...hit });
      }
    }
    const peers = classified.filter(({ classification }) => classification === 'untouched-peer').length;
    if (classified.length <= GENERIC_DOC_HITS && peers <= GENERIC_PEER_HITS) {
      hits.push(...classified.slice(0, MAX_PER_TERM));
    }
  }
  hits.sort((a, b) => PRIORITY.indexOf(a.classification) - PRIORITY.indexOf(b.classification));

  const gaps = new Map();
  for (const { key, value } of pairsOf(addedLines).slice(0, MAX_PAIRS)) {
    const mentions = git(repo, ['grep', '-l', '-F', '-I', '-e', key, head, '--', '*.md', '*.mdx'], {
      allowFailure: true,
    });
    for (const line of (mentions ?? '').split('\n').filter(Boolean)) {
      const path = line.slice(`${head}:`.length);
      const body = git(repo, ['show', `${head}:${path}`], { allowFailure: true }) ?? '';
      if (!body.includes(value)) {
        const gap = gaps.get(`${key}\0${value}`) ?? { key, missing_value: value, docs: [] };
        gap.docs.push(path);
        gaps.set(`${key}\0${value}`, gap);
      }
    }
  }

  return {
    note: 'Nominations only. A hit is a place to read, not a finding. A miss does not show the change is in sync.',
    terms_scanned: ordered.length,
    hits: hits.slice(0, MAX_HITS),
    doc_gaps: [...gaps.values()].slice(0, MAX_GAPS),
  };
}

const WORKFLOW_PATH = /^\.github\/workflows\/.+\.ya?ml$/;
const ORDERING_LINE = /^\s*(needs|if|concurrency|timeout-minutes|strategy)\s*:|\balways\(\)/;
const FLAG_LINE = /useBooleanFlag|getFeatureFlagValue|FEATURE_FLAGS|isFeatureEnabled/;
const VIEW_PATH = /\.(tsx|jsx)$/;
const NEW_VIEW_LINES = 40;

const ASKS = {
  'ordering-and-timing':
    'A workflow dependency, condition, timeout, or strategy changed. What waits on what now, compared with base, and how long can the slowest path take?',
  'flag-parity':
    'A feature-flag read changed or was added. With the flag off, does behavior match base? With it on, what does each existing consumer of the replaced path lose?',
  'render-states':
    'Substantial new view code. What does the user see when the data is empty, loading, errored, or partly present, and does base show something the new path drops?',
};

/**
 * Model-free triggers for the behavior-delta pass in SKILL.md: changes that alter ordering,
 * flag-gated branches, or rendered states without ever being a "failure".
 */
export function deltaTriggers({ files, diffs }) {
  const paths = { 'ordering-and-timing': [], 'flag-parity': [], 'render-states': [] };
  for (const file of files) {
    const added = (diffs.get(file.path) ?? []).filter(({ sign }) => sign === '+').map(({ text }) => text);
    const test = isTestPath(file.path);
    if (WORKFLOW_PATH.test(file.path) && added.some((text) => ORDERING_LINE.test(text))) {
      paths['ordering-and-timing'].push(file.path);
    }
    if (!test && added.some((text) => FLAG_LINE.test(text))) {
      paths['flag-parity'].push(file.path);
    }
    if (!test && VIEW_PATH.test(file.path) && added.length >= NEW_VIEW_LINES) {
      paths['render-states'].push(file.path);
    }
  }
  return {
    note: 'Triggers for the behavior-delta pass. Each ask must be answered with evidence or cleared explicitly.',
    triggers: Object.entries(paths)
      .filter(([, list]) => list.length > 0)
      .map(([id, list]) => ({ id, paths: list, ask: ASKS[id] })),
  };
}
