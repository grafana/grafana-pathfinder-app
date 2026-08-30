import { normalizeRepositoryPath } from './selectors.mjs';

const DIFF_GIT = /^diff --git /;
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

function stripPrefix(value) {
  if (value === '/dev/null') {
    return null;
  }
  const withoutQuotes = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return withoutQuotes.replace(/^[ab]\//, '');
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
