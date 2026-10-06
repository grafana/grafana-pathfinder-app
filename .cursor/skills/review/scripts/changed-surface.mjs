#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseCliArgs } from 'node:util';

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const GO_PATH = /^(?:pkg\/.+\.go|go\.mod|go\.sum|Magefile\.go)$/;
const DEPENDENCY_MANIFEST = /(?:^|\/)(?:package\.json|package-lock\.json|go\.mod|go\.sum)$/;
const FRONTEND_PATH = /^src\//;

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

export function computeChangedSurface({ files }) {
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) {
    throw new Error('files must be an array of repository-relative paths');
  }
  const goPaths = files.filter((file) => GO_PATH.test(file));
  return {
    go: goPaths.length > 0,
    go_paths: goPaths,
    dependency_manifests: files.filter((file) => DEPENDENCY_MANIFEST.test(file)),
    frontend: files.some((file) => FRONTEND_PATH.test(file)),
  };
}

export function changedFiles({ base, head, cwd = process.cwd() }) {
  if (!SHA_PATTERN.test(base ?? '') || !SHA_PATTERN.test(head ?? '')) {
    throw new Error('Base and head must be literal Git commit SHAs');
  }
  return execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-color',
      '--no-renames',
      '--no-relative',
      '--name-only',
      `${base}...${head}`,
    ],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .split('\n')
    .filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const surface = computeChangedSurface({ files: changedFiles({ base: args.base, head: args.head }) });
  process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
