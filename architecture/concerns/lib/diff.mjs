import { Buffer } from 'node:buffer';
import { normalizeRepositoryPath } from './selectors.mjs';

const DIFF_GIT = /^diff --git /;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

const C_ESCAPES = new Map([
  ['\\', 0x5c],
  ['"', 0x22],
  ['a', 0x07],
  ['b', 0x08],
  ['f', 0x0c],
  ['n', 0x0a],
  ['r', 0x0d],
  ['t', 0x09],
  ['v', 0x0b],
]);

// With core.quotePath on — the default — git wraps a header path in quotes and
// writes every non-ASCII byte as an octal escape. Decoding it back to bytes and
// then to UTF-8 is what makes a derived path equal the same file's path from
// `--name-only -z`, which is never quoted.
function decodeCStyle(value) {
  const bytes = [];
  let index = 0;
  while (index < value.length) {
    const escape = value.indexOf('\\', index);
    if (escape === -1) {
      bytes.push(...Buffer.from(value.slice(index), 'utf8'));
      break;
    }
    bytes.push(...Buffer.from(value.slice(index, escape), 'utf8'));
    const octal = /^[0-7]{1,3}/.exec(value.slice(escape + 1, escape + 4));
    if (octal !== null) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      index = escape + 1 + octal[0].length;
      continue;
    }
    const simple = C_ESCAPES.get(value[escape + 1]);
    if (simple !== undefined) {
      bytes.push(simple);
      index = escape + 2;
      continue;
    }
    bytes.push(0x5c);
    index = escape + 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(value) {
  if (value === '/dev/null') {
    return null;
  }
  const quoted = value.length > 1 && value.startsWith('"') && value.endsWith('"');
  const unquoted = quoted ? decodeCStyle(value.slice(1, -1)) : value;
  return unquoted.replace(/^[ab]\//, '');
}

function declaredCount(value) {
  return value === undefined ? 1 : Number(value);
}

// `diff --git a/X b/Y` is the only line a rename or a binary-only entry carries,
// and a path may hold spaces, so the ` b/` that opens the second side is the
// split point rather than whitespace.
function entryHeaderPaths(line) {
  const rest = line.slice('diff --git '.length).trim();
  const quoted = rest.lastIndexOf(' "b/');
  const index = quoted === -1 ? rest.lastIndexOf(' b/') : quoted;
  if (index === -1) {
    return { old: null, new: null };
  }
  return {
    old: stripPrefix(rest.slice(0, index).trim()),
    new: stripPrefix(rest.slice(index + 1).trim()),
  };
}

// Parses only what routing needs: which file each hunk belongs to and the text
// of the lines that changed. Anything it cannot attribute to a file is reported
// as a disclosure rather than dropped, because a silently skipped hunk would
// silently drop the semantic evidence that gates conditional activation.
export function parseUnifiedDiff(text) {
  const hunks = [];
  const paths = [];
  const disclosures = [];
  let currentPath = null;
  let oldPath = null;
  let entry = null;
  let hunk = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let looksLikeDiff = false;

  const closeHunk = () => {
    if (hunk && hunk.lines.length > 0) {
      hunks.push(hunk);
    }
    hunk = null;
    remainingOld = 0;
    remainingNew = 0;
  };

  const claimPath = (value) => {
    currentPath = value;
    if (currentPath !== null) {
      paths.push(currentPath);
    }
  };

  // A rename or a binary change carries no `---`/`+++` pair, so the entry header
  // is the only place its path is stated. Those headers stay authoritative when
  // present; this runs once the entry is over and none of them named a path.
  const closeEntry = () => {
    if (entry === null) {
      return;
    }
    if (currentPath === null) {
      const fallback = entry.new ?? entry.old;
      if (fallback === null) {
        disclosures.push({
          kind: 'diff_entry_without_path',
          message: 'a diff entry named no path this tool could read, so it contributes no path',
        });
      } else {
        claimPath(fallback);
      }
    }
    entry = null;
  };

  // A changed line is its content behind a single `-` or `+`, so a removed
  // `-- x` arrives as `--- x` and an added `++ x` as `+++ x` — indistinguishable
  // from a file header by shape alone. The hunk's declared line counts are the
  // only disambiguator: while a hunk still owes lines, those are content.
  const insideHunk = () => hunk !== null && (remainingOld > 0 || remainingNew > 0);

  for (const line of text.split('\n')) {
    if (DIFF_GIT.test(line)) {
      closeHunk();
      closeEntry();
      looksLikeDiff = true;
      currentPath = null;
      oldPath = null;
      entry = entryHeaderPaths(line);
      continue;
    }
    if (!insideHunk() && line.startsWith('--- ')) {
      closeHunk();
      oldPath = stripPrefix(line.slice(4).trim());
      continue;
    }
    if (!insideHunk() && line.startsWith('+++ ')) {
      closeHunk();
      looksLikeDiff = true;
      // A deletion names /dev/null on the new side; the old side still carries
      // the path whose removal routing has to see.
      claimPath(stripPrefix(line.slice(4).trim()) ?? oldPath);
      continue;
    }
    const header = HUNK_HEADER.exec(line);
    if (header) {
      closeHunk();
      looksLikeDiff = true;
      const stated = oldPath ?? entry?.new ?? entry?.old ?? null;
      if (currentPath === null && stated !== null) {
        claimPath(stated);
      }
      if (currentPath === null) {
        disclosures.push({
          kind: 'hunk_without_file_header',
          message: 'a hunk header appeared before any file header named a path; its evidence is attributed to no path',
        });
      }
      remainingOld = declaredCount(header[1]);
      remainingNew = declaredCount(header[2]);
      hunk = { path: currentPath, index: hunks.length, lines: [] };
      continue;
    }
    if (hunk === null) {
      continue;
    }
    if (line.startsWith('+')) {
      hunk.lines.push(line.slice(1));
      remainingNew -= 1;
      continue;
    }
    if (line.startsWith('-')) {
      hunk.lines.push(line.slice(1));
      remainingOld -= 1;
      continue;
    }
    if (line.startsWith('\\')) {
      continue;
    }
    remainingOld -= 1;
    remainingNew -= 1;
  }
  closeHunk();
  closeEntry();

  return { hunks, paths, disclosures, looksLikeDiff };
}

function textAsSingleHunk(text) {
  const lines = text.split('\n').filter((line) => line.length > 0);
  return lines.length === 0 ? [] : [{ path: null, index: 0, lines }];
}

export function analyzeSemanticInput(text) {
  if (text === null || text === undefined) {
    return { source: 'none', hunks: [], derived_paths: [], disclosures: [] };
  }
  if (text.trim() === '') {
    return {
      source: 'none',
      hunks: [],
      derived_paths: [],
      disclosures: [{ kind: 'empty_semantic_input', message: 'the supplied semantic input was empty' }],
    };
  }
  const parsed = parseUnifiedDiff(text);
  if (!parsed.looksLikeDiff) {
    return {
      source: 'text',
      hunks: textAsSingleHunk(text),
      derived_paths: [],
      disclosures: [
        {
          kind: 'unrecognised_diff',
          message:
            'the input carries no unified-diff headers, so it is scanned as one block of text and contributes no paths',
        },
      ],
    };
  }
  if (parsed.hunks.length === 0) {
    return {
      source: 'diff',
      hunks: [],
      derived_paths: normalizeDerivedPaths(parsed.paths).accepted,
      disclosures: [
        ...parsed.disclosures,
        {
          kind: 'diff_without_hunks',
          message: 'the diff declared files but carried no readable hunks, so it contributes no semantic evidence',
        },
      ],
    };
  }
  const derived = normalizeDerivedPaths(parsed.paths);
  return {
    source: 'diff',
    hunks: parsed.hunks,
    derived_paths: derived.accepted,
    disclosures: [
      ...parsed.disclosures,
      ...derived.rejected.map((entry) => ({
        kind: 'unusable_diff_path',
        message: `the diff named a path this tool will not normalise (${entry.reason})`,
      })),
    ],
  };
}

function normalizeDerivedPaths(values) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const value of values) {
    const result = normalizeRepositoryPath(value);
    if (!result.ok) {
      rejected.push(result);
      continue;
    }
    if (!seen.has(result.path)) {
      seen.add(result.path);
      accepted.push(result.path);
    }
  }
  return { accepted, rejected };
}
