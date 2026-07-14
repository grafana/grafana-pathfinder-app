#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseCliArgs } from 'node:util';

const DEFAULT_WINDOW_DAYS = 30;
const SEMANTIC_TYPES = new Set([
  'feat',
  'fix',
  'refactor',
  'perf',
  'revert',
  'review',
  'security',
  'skill',
  'hardening',
  'improve',
  'enhance',
]);
const AI_SEMANTIC_TYPES = new Set([...SEMANTIC_TYPES, 'chore', 'docs']);
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const CONCERN_PATTERN = /^[a-z0-9-]+$/;

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

export function parseArgs(argv) {
  try {
    return parseCliArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        concern: { type: 'string' },
        'window-days': { type: 'string' },
      },
    }).values;
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}. Expected --base, --head, --concern, and optional --window-days.`
    );
  }
}

function assertInputs({ base, head, concern, windowDays }) {
  if (!SHA_PATTERN.test(base ?? '') || !SHA_PATTERN.test(head ?? '')) {
    throw new Error('Base and head must be literal Git commit SHAs');
  }
  if (!CONCERN_PATTERN.test(concern ?? '')) {
    throw new Error('Concern must be a concern id containing lowercase letters, digits, and hyphens');
  }
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    throw new Error('Window days must be an integer between 1 and 365');
  }
}

function splitTableRow(row) {
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

export function extractConcernPaths(markdown, concern) {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith('|')) {
      return false;
    }
    const cells = splitTableRow(line).map((cell) => cell.toLowerCase());
    return cells.includes('id') && cells.includes('trigger_paths');
  });
  if (headerIndex === -1) {
    throw new Error('Routing table header with id and trigger_paths columns not found in CONCERNS.md');
  }

  const header = splitTableRow(lines[headerIndex]).map((cell) => cell.toLowerCase());
  const idColumn = header.indexOf('id');
  const pathsColumn = header.indexOf('trigger_paths');

  let row = null;
  for (let index = headerIndex + 1; index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = splitTableRow(lines[index]);
    if (cells[idColumn] === `\`${concern}\``) {
      row = cells;
      break;
    }
  }
  if (!row) {
    throw new Error(`Concern ${concern} is not present in the routing table`);
  }
  if (row.length !== header.length) {
    throw new Error(`Concern ${concern} has an invalid routing row`);
  }

  const paths = [...row[pathsColumn].matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path) => path.includes('/') || /\.[a-z]+$/i.test(path))
    .map((path) => (path.includes('*') ? `:(glob)${path}` : path));

  if (paths.length === 0) {
    throw new Error(`Concern ${concern} has no concrete trigger paths`);
  }
  return paths;
}

export function conventionalType(subject) {
  const type = subject.match(/^([a-z-]+)(?:\([^)]+\))?[!:]/i)?.[1].toLowerCase();
  if (type) {
    return type === 'feature' ? 'feat' : type;
  }
  if (/^revert\b/i.test(subject)) {
    return 'revert';
  }
  if (/^fix(e[sd])?\b/i.test(subject)) {
    return 'fix';
  }
  return 'other';
}

export function pullRequestNumber(subject) {
  const value = [...subject.matchAll(/\(#(\d+)\)/g)].at(-1)?.[1];
  return value ? Number(value) : null;
}

function parseHistory(output, concern) {
  const allowedTypes = concern === 'ai-subsystem' ? AI_SEMANTIC_TYPES : SEMANTIC_TYPES;
  const records = output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, timestamp, ...subjectParts] = record.split('\x1f');
      const subject = subjectParts.join('\x1f');
      return {
        sha,
        timestamp: Number(timestamp),
        subject,
        type: conventionalType(subject),
        pr: pullRequestNumber(subject),
      };
    });

  const unique = new Map();
  const unmapped = [];
  const unclassified = [];
  for (const record of records) {
    if (record.type === 'other') {
      unclassified.push(record);
      continue;
    }
    if (!allowedTypes.has(record.type)) {
      continue;
    }
    if (!record.pr) {
      unmapped.push(record);
      continue;
    }
    if (!unique.has(record.pr)) {
      unique.set(record.pr, record);
    }
  }

  return { pullRequests: [...unique.values()], unmapped, unclassified };
}

function isAncestor(base, head, cwd) {
  return spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd }).status === 0;
}

export function computeGate({ base, head, concern, windowDays = DEFAULT_WINDOW_DAYS, cwd = process.cwd() }) {
  assertInputs({ base, head, concern, windowDays });
  if (!isAncestor(base, head, cwd)) {
    throw new Error('Base must be an ancestor of head');
  }

  const inStackOutput = git(['rev-list', head, `^${base}`], cwd);
  const inStackShas = inStackOutput ? inStackOutput.split('\n').filter(Boolean) : [];

  const concerns = git(['show', `${base}:docs/design/CONCERNS.md`], cwd);
  const paths = extractConcernPaths(concerns, concern);
  const baseTimestamp = Number(git(['show', '-s', '--format=%ct', base], cwd));
  const cutoffTimestamp = baseTimestamp - windowDays * 24 * 60 * 60;
  const historyOutput = git(
    [
      'log',
      base,
      '--first-parent',
      `--since=${new Date(cutoffTimestamp * 1000).toISOString()}`,
      '--format=%H%x1f%ct%x1f%s%x1e',
      '--',
      ...paths,
    ],
    cwd
  );
  const history = parseHistory(historyOutput, concern);
  const fixes = history.pullRequests.filter((entry) => entry.type === 'fix').length;
  const features = history.pullRequests.filter((entry) => entry.type === 'feat').length;
  const fixHeavy = fixes >= 2 && (features === 0 || fixes / features >= 2);
  const signals = {
    at_least_two_prior_semantic_prs: history.pullRequests.length >= 2,
    fix_heavy_history: fixHeavy,
  };

  return {
    version: 1,
    base,
    head,
    in_stack_shas: inStackShas,
    concern,
    window_days: windowDays,
    base_timestamp: baseTimestamp,
    cutoff_timestamp: cutoffTimestamp,
    paths,
    history_status: history.unmapped.length === 0 && history.unclassified.length === 0 ? 'complete' : 'partial',
    prior_semantic_pr_count: history.pullRequests.length,
    fix_count: fixes,
    feat_count: features,
    signals,
    triggered: Object.values(signals).some(Boolean),
    recent_semantic_changes: history.pullRequests.slice(0, 3),
    unmapped_semantic_commits: history.unmapped,
    unclassified_commits: history.unclassified,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = computeGate({
    base: args.base,
    head: args.head,
    concern: args.concern,
    windowDays: args['window-days'] ? Number(args['window-days']) : DEFAULT_WINDOW_DAYS,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
