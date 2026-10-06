#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SEAL = 'raw.sha256';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const HEADER_END = '--- end of provenance header ---';
const HEADER_FIELDS = ['derived-from', 'source-sha256', 'transformation', 'command'];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readSeal(receipts) {
  const path = join(receipts, SEAL);
  if (!existsSync(path)) {
    return new Map();
  }
  return new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split('  ');
        return [name, sha];
      })
  );
}

function rawFiles(receipts) {
  const dir = join(receipts, 'raw');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => !name.startsWith('.'))
        .sort()
        .map((name) => `raw/${name}`)
    : [];
}

function sealProblems(receipts, sealed) {
  return [...sealed].flatMap(([name, sha]) => {
    const path = join(receipts, name);
    if (!existsSync(path)) {
      return [`${name} was sealed but is gone; raw results are never deleted`];
    }
    const now = digest(readFileSync(path));
    return now === sha
      ? []
      : [
          `${name} changed after it was sealed (sealed ${sha}, now ${now}). Raw results are append-only: restore it and write a correction as a new version`,
        ];
  });
}

export function sealRaw(receipts) {
  const sealed = readSeal(receipts);
  const problems = sealProblems(receipts, sealed);
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
  const added = rawFiles(receipts).filter((name) => !sealed.has(name));
  const odd = added.find((name) => !NAME_PATTERN.test(name.slice('raw/'.length)));
  if (odd) {
    throw new Error(
      `${JSON.stringify(odd)} is not a raw result name; raw names are letters, digits, dots, dashes, and underscores`
    );
  }
  if (added.length > 0) {
    const lines = added.map((name) => `${digest(readFileSync(join(receipts, name)))}  ${name}\n`).join('');
    writeFileSync(join(receipts, SEAL), lines, { flag: 'a' });
  }
  return { sealed: added, unchanged: sealed.size };
}

function insideRaw(receipts, source) {
  const path = relative(join(receipts, 'raw'), resolve(source));
  return path && !path.startsWith('..') && !path.includes('/') ? `raw/${path}` : null;
}

function oneLine(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value) || value.length > 1000) {
    throw new Error(`--${label} must be one non-empty line of at most 1000 characters`);
  }
  return value.trim();
}

export function deriveReceipt({ receipts, source, name, transformation, command, content }) {
  const sourceName = insideRaw(receipts, source ?? '');
  if (!sourceName) {
    throw new Error('--source must be a raw result file directly under <receipts>/raw/');
  }
  if (!NAME_PATTERN.test(name ?? '')) {
    throw new Error('--name must be a file name of letters, digits, dots, dashes, and underscores');
  }
  const sealed = readSeal(receipts).get(sourceName);
  if (!sealed) {
    throw new Error(`${sourceName} is not sealed; run receipts.mjs seal before deriving from it`);
  }
  const problems = sealProblems(receipts, new Map([[sourceName, sealed]]));
  if (problems.length > 0) {
    throw new Error(problems[0]);
  }
  const target = join(receipts, 'derived', name);
  if (existsSync(target)) {
    throw new Error(`derived/${name} already exists; derived records are written once, so pick a new name`);
  }
  const header = [
    `derived-from: ${sourceName}`,
    `source-sha256: ${sealed}`,
    `transformation: ${oneLine(transformation, 'transformation')}`,
    `command: ${oneLine(command, 'command')}`,
    HEADER_END,
    '',
  ].join('\n');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.concat([Buffer.from(header), content]), { flag: 'wx' });
  return { derived: `derived/${name}`, source: sourceName, source_sha256: sealed };
}

export function parseDerivedHeader(text) {
  const end = text.indexOf(`\n${HEADER_END}\n`);
  if (end < 0) {
    return null;
  }
  const fields = Object.fromEntries(
    text
      .slice(0, end)
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf(': ')), line.slice(line.indexOf(': ') + 2)])
  );
  return HEADER_FIELDS.every((field) => typeof fields[field] === 'string' && fields[field] !== '') ? fields : null;
}

export function verifyReceipts(receipts) {
  const sealed = readSeal(receipts);
  const problems = [
    ...sealProblems(receipts, sealed),
    ...rawFiles(receipts)
      .filter((name) => !sealed.has(name))
      .map((name) => `${name} is not sealed`),
  ];
  const derivedDir = join(receipts, 'derived');
  const derived = existsSync(derivedDir) ? readdirSync(derivedDir).sort() : [];
  for (const name of derived) {
    const header = parseDerivedHeader(readFileSync(join(derivedDir, name), 'utf8'));
    if (!header) {
      problems.push(`derived/${name} has no provenance header; write derived files only with receipts.mjs derive`);
      continue;
    }
    const source = join(receipts, header['derived-from']);
    if (!existsSync(source) || !header['derived-from'].startsWith('raw/')) {
      problems.push(`derived/${name} names a missing source ${header['derived-from']}`);
    } else if (digest(readFileSync(source)) !== header['source-sha256']) {
      problems.push(`derived/${name} was derived from a different version of ${header['derived-from']}`);
    }
  }
  return { ok: problems.length === 0, raw: sealed.size, derived: derived.length, problems };
}

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    strict: true,
    allowPositionals: false,
    options: Object.fromEntries(
      ['receipts', 'source', 'name', 'transformation', 'command', 'content'].map((name) => [name, { type: 'string' }])
    ),
  });
  if (!values.receipts?.startsWith('/')) {
    throw new Error('--receipts must be the absolute receipts directory');
  }
  const receipts = resolve(values.receipts);
  switch (command) {
    case 'seal':
      return sealRaw(receipts);
    case 'derive':
      if (!values.content?.startsWith('/')) {
        throw new Error('--content must be an absolute path to the derived content');
      }
      return deriveReceipt({ ...values, receipts, content: readFileSync(values.content) });
    case 'verify': {
      const result = verifyReceipts(receipts);
      if (!result.ok) {
        process.exitCode = 2;
      }
      return result;
    }
    default:
      throw new Error('Expected one of: seal, derive, verify');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
