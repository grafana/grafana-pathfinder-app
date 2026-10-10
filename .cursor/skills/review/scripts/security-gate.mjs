#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseCliArgs } from 'node:util';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const MAX_REASONS = 20;
const DIFF_ARGS = [
  'diff',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

const PATH_SIGNALS = [
  ['workflow-permissions', /^\.github\/(?:workflows|actions)\//],
  ['dependency-manifest', /(?:^|\/)(?:package\.json|package-lock\.json|go\.mod|go\.sum)$/],
  ['container-publishing', /(?:^|\/)Dockerfile[^/]*$/],
  ['security-module', /^src\/security\//],
  ['auth-surface', /(?:^|\/)(?:auth|oauth|token|secret|credential|permission)[^/]*\.(?:ts|tsx|js|mjs|go)$/i],
];

const CONTENT_SIGNALS = [
  [
    'credential',
    /\b(?:authorization|bearer|token|secret|password|credential)s?\b|[a-z](?:Token|Secret|Password|Credential)s?\b|(?:api|write|access|secret|private)[-_ ]?key/i,
  ],
  [
    'url-trust-boundary',
    /location\.(?:search|href|hash|pathname)|URLSearchParams|new URL\(|window\.open|document\.referrer|\bredirect/,
  ],
  [
    'cross-origin-transport',
    /postMessage|sendBeacon|XMLHttpRequest|Access-Control|crossOrigin|credentials:\s*['"]include/,
  ],
  ['dom-sink', /innerHTML|dangerouslySetInnerHTML|\beval\(|new Function\(/],
];

export function parseArgs(argv) {
  try {
    return parseCliArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { base: { type: 'string' }, head: { type: 'string' } },
    }).values;
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. Expected --base and --head.`);
  }
}

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function changedLinesByFile(diff) {
  const changed = new Map();
  const linesFor = (file) => {
    if (!changed.has(file)) {
      changed.set(file, { added: [], removed: [] });
    }
    return changed.get(file);
  };
  let file = null;
  let oldFile = null;
  let inHunk = false;
  let unattributed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      oldFile = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith('--- ')) {
      oldFile = line.startsWith('--- a/') ? line.slice(6) : null;
    } else if (!inHunk && line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : oldFile;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      if (file === null) {
        unattributed += 1;
      } else if (line.startsWith('+')) {
        linesFor(file).added.push(line.slice(1));
      } else {
        linesFor(file).removed.push(line.slice(1));
      }
    }
  }
  return { files: changed, unattributed };
}

export function computeSecurityGate({ base, head, cwd = process.cwd() }) {
  if (!SHA_PATTERN.test(base ?? '') || !SHA_PATTERN.test(head ?? '')) {
    throw new Error('Base and head must be literal Git commit SHAs');
  }
  const range = `${base}...${head}`;
  const files = git([...DIFF_ARGS, '--name-only', range], cwd)
    .split('\n')
    .filter(Boolean);
  const reasons = [];
  for (const file of files) {
    for (const [signal, pattern] of PATH_SIGNALS) {
      if (pattern.test(file)) {
        reasons.push({ kind: 'path', signal, file });
      }
    }
  }
  const { files: changed, unattributed } = changedLinesByFile(git([...DIFF_ARGS, '--unified=0', range], cwd));
  if (unattributed > 0) {
    reasons.push({ kind: 'diff', signal: 'unattributed-diff-content', count: unattributed });
  }
  for (const [file, { added, removed }] of changed) {
    if (file.endsWith('.md')) {
      continue;
    }
    for (const [signal, pattern] of CONTENT_SIGNALS) {
      if (added.some((line) => pattern.test(line))) {
        reasons.push({ kind: 'content', signal, file });
      }
      if (removed.some((line) => pattern.test(line))) {
        reasons.push({ kind: 'content', signal, file, removed: true });
      }
    }
  }
  return { triggered: reasons.length > 0, reasons: reasons.slice(0, MAX_REASONS), reason_count: reasons.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(computeSecurityGate({ base: args.base, head: args.head }), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
