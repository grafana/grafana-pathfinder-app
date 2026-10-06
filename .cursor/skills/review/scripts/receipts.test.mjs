import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseDerivedHeader } from './receipts.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'receipts.mjs');
const RAW = '{"observations":[{"title":"a &amp; b"}]}\n';

function receiptsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
  mkdirSync(join(dir, 'raw'));
  writeFileSync(join(dir, 'raw/observer-w1.json'), RAW);
  return dir;
}

function run(...args) {
  const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
}

function derive(dir, name, content = '{"observations":[{"title":"a & b"}]}\n') {
  const file = join(mkdtempSync(join(tmpdir(), 'derived-content-')), 'content');
  writeFileSync(file, content);
  return run(
    'derive',
    '--receipts',
    dir,
    '--source',
    join(dir, 'raw/observer-w1.json'),
    '--name',
    name,
    '--transformation',
    'decoded HTML entities in titles',
    '--command',
    'node decode.mjs raw/observer-w1.json',
    '--content',
    file
  );
}

test('a derived record leaves the raw result byte for byte and carries its source hash', () => {
  const dir = receiptsDir();
  assert.deepEqual(run('seal', '--receipts', dir).json, { sealed: ['raw/observer-w1.json'], unchanged: 0 });
  const result = derive(dir, 'observer-w1.decoded.json');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'raw/observer-w1.json'), 'utf8'), RAW);
  const text = readFileSync(join(dir, 'derived/observer-w1.decoded.json'), 'utf8');
  const header = parseDerivedHeader(text);
  assert.equal(header['derived-from'], 'raw/observer-w1.json');
  assert.equal(header['source-sha256'], createHash('sha256').update(RAW).digest('hex'));
  assert.equal(header.transformation, 'decoded HTML entities in titles');
  assert.equal(header.command, 'node decode.mjs raw/observer-w1.json');
  assert.ok(text.endsWith('{"observations":[{"title":"a & b"}]}\n'));
  assert.deepEqual(run('verify', '--receipts', dir).json.problems, []);
});

test('an edited raw result is detected, and nothing derives from it', () => {
  const dir = receiptsDir();
  run('seal', '--receipts', dir);
  writeFileSync(join(dir, 'raw/observer-w1.json'), '{"observations":[]}\n');
  const reseal = run('seal', '--receipts', dir);
  assert.equal(reseal.status, 2);
  assert.match(reseal.stderr, /raw\/observer-w1\.json changed after it was sealed/);
  assert.match(derive(dir, 'x.json').stderr, /changed after it was sealed/);
  const verify = run('verify', '--receipts', dir);
  assert.equal(verify.status, 2);
  assert.match(verify.stdout, /changed after it was sealed/);
});

test('a derived record built from an older raw version no longer verifies', () => {
  const dir = receiptsDir();
  run('seal', '--receipts', dir);
  derive(dir, 'observer-w1.decoded.json');
  writeFileSync(join(dir, 'raw.sha256'), '');
  writeFileSync(join(dir, 'raw/observer-w1.json'), '{}\n');
  run('seal', '--receipts', dir);
  assert.match(
    run('verify', '--receipts', dir).stdout,
    /derived\/observer-w1\.decoded\.json was derived from a different version of raw\/observer-w1\.json/
  );
});

test('corrections are new raw versions, and derive never writes into raw or rewrites a record', () => {
  const dir = receiptsDir();
  run('seal', '--receipts', dir);
  writeFileSync(join(dir, 'raw/observer-w1.v2.json'), '{"observations":[]}\n');
  assert.deepEqual(run('seal', '--receipts', dir).json, { sealed: ['raw/observer-w1.v2.json'], unchanged: 1 });
  assert.equal(readFileSync(join(dir, 'raw/observer-w1.json'), 'utf8'), RAW);
  assert.match(derive(dir, '../raw/observer-w1.json').stderr, /--name must be a file name/);
  assert.equal(derive(dir, 'once.json').status, 0);
  assert.match(derive(dir, 'once.json').stderr, /already exists; derived records are written once/);
  writeFileSync(join(dir, 'derived/hand-written.json'), '{}');
  assert.match(run('verify', '--receipts', dir).stdout, /derived\/hand-written\.json has no provenance header/);
  writeFileSync(join(dir, 'raw/observer-w2.json'), '{}');
  assert.match(run('verify', '--receipts', dir).stdout, /raw\/observer-w2\.json is not sealed/);
});
