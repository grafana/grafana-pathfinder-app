#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRunRecord, maskRuns, scoreRuns, validateCase, validateCaseAgainstHistory } from './eval-core.mjs';

const OPTIONS = {
  case: { type: 'string' },
  'repo-dir': { type: 'string' },
  out: { type: 'string' },
  arm: { type: 'string' },
  run: { type: 'string' },
  rendered: { type: 'string' },
  meta: { type: 'string' },
  runs: { type: 'string' },
  seed: { type: 'string' },
  mapping: { type: 'string' },
  adjudications: { type: 'string' },
  keys: { type: 'string' },
  cases: { type: 'string' },
};

function absolute(value, label) {
  if (!value || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function validate(values) {
  const manifest = validateCase(readJson(absolute(values.case, '--case')));
  if (!values['repo-dir']) {
    return { case_id: manifest.case_id, schema: 'valid', history: 'not checked (pass --repo-dir)' };
  }
  const repo = absolute(values['repo-dir'], '--repo-dir');
  const problems = validateCaseAgainstHistory(manifest, {
    headCommittedAt: git(repo, ['show', '-s', '--format=%cI', manifest.head_sha]),
    baseIsAncestor:
      spawnSync('git', ['merge-base', '--is-ancestor', manifest.base_sha, manifest.head_sha], { cwd: repo }).status ===
      0,
  });
  return { case_id: manifest.case_id, schema: 'valid', history: problems.length === 0 ? 'verified' : problems };
}

function prepare(values) {
  const manifest = validateCase(readJson(absolute(values.case, '--case')));
  const source = absolute(values['repo-dir'], '--repo-dir');
  const out = absolute(values.out, '--out');
  if (existsSync(out)) {
    throw new Error(`${out} already exists; a case checkout is always fresh`);
  }
  mkdirSync(out, { recursive: true });
  git(out, ['init', '-q']);
  git(out, [
    '-c',
    'protocol.version=2',
    'fetch',
    '-q',
    '--no-tags',
    `file://${source}`,
    manifest.head_sha,
    manifest.base_sha,
  ]);
  git(out, ['checkout', '-q', '--detach', manifest.head_sha]);
  const refs = git(out, ['for-each-ref', '--format=%(refname)']);
  if (refs !== '') {
    throw new Error(`the case checkout exposes refs beyond the pinned commits: ${refs}`);
  }
  const late = git(out, ['rev-list', '--all', `--since=${manifest.evidence_cutoff}`]);
  if (late !== '') {
    throw new Error(
      `the case checkout contains commits after the evidence cutoff: ${late.split('\n').slice(0, 3).join(', ')}`
    );
  }
  writeFileSync(join(out, '.git', 'review-case.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    case_id: manifest.case_id,
    checkout: out,
    head: git(out, ['rev-parse', 'HEAD']),
    refs: 'none beyond the detached head',
    next: 'install dependencies with the manifest environment.setup commands, then run each arm in a fresh context',
  };
}

function capture(values) {
  const manifest = validateCase(readJson(absolute(values.case, '--case')));
  const record = buildRunRecord({
    caseManifest: manifest,
    arm: values.arm,
    runIndex: Number(values.run),
    rendered: readFileSync(absolute(values.rendered, '--rendered'), 'utf8'),
    meta: readJson(absolute(values.meta, '--meta')),
  });
  const dir = absolute(values.out, '--out');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${record.case_id}--${record.arm}--${record.run_index}.json`);
  if (existsSync(path)) {
    throw new Error(`${path} already exists; runs are append-only`);
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return { recorded: path, findings: record.findings.length, complete: record.complete };
}

function loadRuns(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(join(dir, name)));
}

function mask(values) {
  const { blinded, mapping } = maskRuns(loadRuns(absolute(values.runs, '--runs')), values.seed);
  const out = absolute(values.out, '--out');
  const mappingPath = absolute(values.mapping, '--mapping');
  writeFileSync(out, `${JSON.stringify(blinded, null, 2)}\n`);
  writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
  return {
    blinded: out,
    mapping: mappingPath,
    findings: blinded.length,
    note: 'give adjudicators only the blinded file',
  };
}

function compare(values) {
  const casesDir = absolute(values.cases, '--cases');
  const keysDir = absolute(values.keys, '--keys');
  const cases = readdirSync(casesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => validateCase(readJson(join(casesDir, name))));
  const keys = Object.fromEntries(
    cases
      .filter(({ adjudication_status }) => adjudication_status === 'adjudicated')
      .map(({ case_id }) => [case_id, readJson(join(keysDir, `${case_id}.json`))])
  );
  return scoreRuns({
    runs: loadRuns(absolute(values.runs, '--runs')),
    mapping: readJson(absolute(values.mapping, '--mapping')),
    adjudications: readJson(absolute(values.adjudications, '--adjudications')),
    keys,
    cases,
  });
}

export function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: OPTIONS, strict: true, allowPositionals: false });
  const commands = { validate, prepare, capture, mask, compare };
  if (!commands[command]) {
    throw new Error(`Expected one of: ${Object.keys(commands).join(', ')}`);
  }
  return commands[command](values);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
