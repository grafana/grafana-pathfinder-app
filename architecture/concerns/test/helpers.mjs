import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/concerns.mjs', import.meta.url));
export const REGISTRY_PATH = fileURLToPath(new URL('../registry.json', import.meta.url));
export const SCHEMA_PATH = fileURLToPath(new URL('../registry.schema.json', import.meta.url));
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: options.cwd ?? REPOSITORY_ROOT,
    input: options.input,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function cliJson(args, options) {
  const result = cli([...args, '--format', 'json'], options);
  return { ...result, payload: result.code === 0 ? JSON.parse(result.stdout) : null };
}
