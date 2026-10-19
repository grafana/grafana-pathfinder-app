#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseReviewState } from './review-report.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_ROUND = 100;

function isAncestor(ancestor, head) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, head], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide full versus incremental mode and the review round.
 * `priorState` is the output of `parseReviewState`, or null when no valid marker exists.
 * `ancestorCheck(reviewedHead, head)` is injectable so the rules can be tested without git.
 */
export function resolveReviewState({ head, priorState, priorReviewCount, ancestorCheck = isAncestor }) {
  if (!SHA_PATTERN.test(head)) {
    throw new Error('head must be a full 40-character commit SHA');
  }
  if (!Number.isInteger(priorReviewCount) || priorReviewCount < 0) {
    throw new Error('prior-review-count must be a non-negative integer');
  }
  const v2Round = priorState?.version === 2 ? priorState.round + 1 : null;
  const round = Math.min(v2Round ?? priorReviewCount + 1, MAX_ROUND);

  let mode = 'full';
  let reason = priorState ? null : 'no valid prior review marker';
  if (priorState?.truncated) {
    reason = 'prior marker is truncated';
  } else if (priorState && !ancestorCheck(priorState.reviewed_head, head)) {
    reason = 'prior reviewed_head is not an ancestor of the current head';
  } else if (priorState) {
    mode = 'incremental';
  }

  return {
    mode,
    round,
    reason,
    diff_range: mode === 'incremental' ? `${priorState.reviewed_head}..${head}` : null,
    prior: mode === 'incremental' ? priorState : null,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      head: { type: 'string' },
      'prior-body': { type: 'string' },
      'prior-review-count': { type: 'string', default: '0' },
    },
  });
  if (!values.head) {
    throw new Error('Expected --head <sha> [--prior-body <review-body-file>] [--prior-review-count <n>]');
  }
  const priorState = values['prior-body'] ? parseReviewState(readFileSync(values['prior-body'], 'utf8')) : null;
  const result = resolveReviewState({
    head: values.head,
    priorState,
    priorReviewCount: Number(values['prior-review-count']),
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
