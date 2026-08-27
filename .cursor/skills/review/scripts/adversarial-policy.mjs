#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const DISPOSITIONS = new Set(['blocking', 'suggestion', 'nit']);
const VERDICTS = new Set(['confirmed', 'refuted', 'uncertain']);
const FIRST_WAVE = new Map([
  ['high_risk', 2],
  ['advisory', 1],
  ['unverified', 0],
]);

function resolved(lane, outcome) {
  return { lane, dispatch: { role: null, count: 0 }, status: 'resolved', outcome };
}

function awaiting(lane, role, count) {
  return { lane, dispatch: { role, count }, status: 'awaiting_verdicts', outcome: null };
}

export function classifyFinding(finding) {
  if (!finding || typeof finding !== 'object') {
    throw new Error('finding must be an object');
  }
  if (!SEVERITIES.has(finding.severity)) {
    throw new Error(`Unknown severity: ${finding.severity}`);
  }
  if (!Object.hasOwn(finding, 'recommended_disposition')) {
    throw new Error('recommended_disposition is required');
  }
  const disposition = finding.recommended_disposition;
  if (!DISPOSITIONS.has(disposition)) {
    throw new Error(`Unknown recommended disposition: ${disposition}`);
  }
  if (finding.severity === 'critical' || finding.severity === 'high') {
    return 'high_risk';
  }
  return finding.severity === 'medium' ? 'advisory' : 'unverified';
}

export function planFirstWave(finding) {
  const lane = classifyFinding(finding);
  return { lane, skeptics: FIRST_WAVE.get(lane) };
}

function countVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) {
    throw new Error('verdicts must be an array');
  }
  let refuted = 0;
  let confirmed = 0;
  for (const verdict of verdicts) {
    if (!verdict || !VERDICTS.has(verdict.verdict)) {
      throw new Error(`Unknown verdict: ${verdict?.verdict}`);
    }
    if (typeof verdict.reason !== 'string' || verdict.reason.trim().length === 0) {
      throw new Error('Each verdict must cite a non-empty reason');
    }
    if (verdict.verdict === 'refuted') {
      refuted += 1;
    } else if (verdict.verdict === 'confirmed') {
      confirmed += 1;
    }
  }
  return { refuted, confirmed };
}

export function decideVerification(finding, verdicts = []) {
  const lane = classifyFinding(finding);
  const { refuted, confirmed } = countVerdicts(verdicts);
  const seen = verdicts.length;

  if (lane === 'unverified') {
    if (seen > 0) {
      throw new Error('A low non-blocking finding is passed through without verification');
    }
    return resolved(lane, 'kept');
  }

  if (lane === 'high_risk') {
    if (seen === 0) {
      return awaiting(lane, 'skeptic', 2);
    }
    if (seen === 1) {
      return awaiting(lane, null, 0);
    }
    if (seen === 2) {
      if (refuted === 2) {
        return resolved(lane, 'dropped');
      }
      if (confirmed === 2) {
        return resolved(lane, 'kept');
      }
      return awaiting(lane, 'tiebreaker', 1);
    }
    if (seen === 3) {
      return resolved(lane, refuted >= 2 ? 'dropped' : 'kept');
    }
    throw new Error('A high-risk finding takes at most three skeptic verdicts');
  }

  if (seen === 0) {
    return awaiting(lane, 'skeptic', 1);
  }
  if (seen === 1) {
    return confirmed === 1 ? resolved(lane, 'kept') : awaiting(lane, 'adjudicator', 1);
  }
  if (seen === 2) {
    return resolved(lane, verdicts[1].verdict === 'refuted' ? 'dropped' : 'kept');
  }
  throw new Error('A medium advisory finding takes at most one skeptic and one adjudicator');
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath || process.argv.length !== 3) {
    throw new Error('Expected one path to a JSON file holding { finding, verdicts }');
  }
  const { finding, verdicts } = JSON.parse(readFileSync(inputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(decideVerification(finding, verdicts), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
