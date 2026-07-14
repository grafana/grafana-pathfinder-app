#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WINDOW_DAYS = 30;
const SEMANTIC_TYPES = new Set(['feat', 'fix', 'refactor', 'perf', 'revert', 'review', 'security', 'skill']);
const AI_SEMANTIC_TYPES = new Set([...SEMANTIC_TYPES, 'chore', 'docs']);
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const CONCERN_PATTERN = /^[a-z0-9-]+$/;

function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Expected --base, --head, --concern, and optional --window-days arguments');
    }
    values[key.slice(2)] = value;
  }
  return values;
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
  const row = markdown
    .split('\n')
    .find((line) => line.startsWith(`| \`${concern}\``) || line.startsWith(`|\`${concern}\``));
  if (!row) {
    throw new Error(`Concern ${concern} is not present in the routing table`);
  }

  const cells = splitTableRow(row);
  if (cells.length < 8) {
    throw new Error(`Concern ${concern} has an invalid routing row`);
  }

  const paths = [...cells[6].matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path) => path.includes('/') || /\.[a-z]+$/i.test(path))
    .map((path) => (path.includes('*') ? `:(glob)${path}` : path));

  if (paths.length === 0) {
    throw new Error(`Concern ${concern} has no concrete trigger paths`);
  }
  return paths;
}

export function conventionalType(subject) {
  return subject.match(/^([a-z-]+)(?:\([^)]+\))?[!:]/i)?.[1].toLowerCase() ?? 'other';
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
    })
    .filter((record) => allowedTypes.has(record.type));

  const unique = new Map();
  const unmapped = [];
  for (const record of records) {
    if (!record.pr) {
      unmapped.push(record);
      continue;
    }
    if (!unique.has(record.pr)) {
      unique.set(record.pr, record);
    }
  }

  return { pullRequests: [...unique.values()], unmapped };
}

function isAncestor(base, head, cwd) {
  return spawnSync('git', ['merge-base', '--is-ancestor', base, head], { cwd }).status === 0;
}

export function computeGate({ base, head, concern, windowDays = DEFAULT_WINDOW_DAYS, cwd = process.cwd() }) {
  assertInputs({ base, head, concern, windowDays });
  if (!isAncestor(base, head, cwd)) {
    throw new Error('Base must be an ancestor of head');
  }

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
    concern,
    window_days: windowDays,
    base_timestamp: baseTimestamp,
    cutoff_timestamp: cutoffTimestamp,
    paths,
    history_status: history.unmapped.length === 0 ? 'complete' : 'partial',
    prior_semantic_pr_count: history.pullRequests.length,
    fix_count: fixes,
    feat_count: features,
    fix_to_feat_ratio: features === 0 ? null : fixes / features,
    signals,
    triggered: Object.values(signals).some(Boolean),
    recent_semantic_changes: history.pullRequests.slice(0, 3),
    unmapped_semantic_commits: history.unmapped,
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
