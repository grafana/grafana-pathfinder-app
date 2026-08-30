import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, cliJson } from './helpers.mjs';
import { LEGACY_EXTRACTOR, runLegacy } from './legacy.mjs';

// Both programs are expected to fail the same way, not merely to fail: a usage
// mistake exits 2, says why on stderr, and leaves stdout empty so a caller that
// pipes stdout into a parser gets nothing rather than half a packet.
const USAGE_EXIT = 2;

test('an unknown concern id is a usage error in both programs, with an empty stdout', () => {
  const legacy = runLegacy(LEGACY_EXTRACTOR, ['no-such-concern']);
  const current = cli(['show', 'no-such-concern']);
  assert.equal(legacy.code, USAGE_EXIT);
  assert.equal(current.code, USAGE_EXIT);
  assert.equal(legacy.stdout, '');
  assert.equal(current.stdout, '');
  assert.ok(legacy.stderr.trim().length > 0);
  assert.ok(current.stderr.trim().length > 0);
});

test('a missing argument is a usage error in both programs', () => {
  const legacy = runLegacy(LEGACY_EXTRACTOR, []);
  const current = cli(['show']);
  assert.equal(legacy.code, USAGE_EXIT);
  assert.equal(current.code, USAGE_EXIT);
  assert.equal(legacy.stdout, '');
  assert.equal(current.stdout, '');
});

test('too many arguments are refused rather than silently ignored', () => {
  assert.equal(runLegacy(LEGACY_EXTRACTOR, ['security', 'extra']).code, USAGE_EXIT);
  assert.equal(cli(['show', 'security', 'extra']).code, USAGE_EXIT);
});

test('an unreadable registry is a distinct failure from a usage mistake', () => {
  const missing = cli(['validate', '--registry', join(tmpdir(), 'concerns-does-not-exist.json')]);
  assert.equal(missing.code, 3);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /Cannot read concern registry/);
});

test('a malformed registry is reported as unreadable rather than crashing', () => {
  const broken = join(tmpdir(), 'concerns-malformed-registry.json');
  writeFileSync(broken, '{ not json');
  const result = cli(['validate', '--registry', broken]);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /not valid JSON/);
});

// Fail open means the change still routes and the caller is told confidence
// dropped — never that routing silently returns nothing.
test('input that is not a diff still routes on its paths and discloses the degradation', () => {
  const file = join(tmpdir(), 'concerns-parity-not-a-diff.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, paths: ['src/lib/faro.ts'], diff: 'this is prose' }));
  const result = cliJson(['route', '--input', file]);
  assert.equal(result.code, 0);
  assert.ok(
    result.payload.disclosures.some((entry) => entry.kind === 'unrecognised_diff'),
    'prose must be disclosed as an unrecognised diff'
  );
  assert.equal(result.payload.input.semantics.source, 'text');
  assert.equal(result.payload.input.paths.derived_from_diff, 0);
  const sawPath = [...result.payload.activated, ...result.payload.withheld, ...result.payload.considered].some(
    (entry) => entry.evidence.paths.some((evidence) => evidence.paths.includes('src/lib/faro.ts'))
  );
  assert.ok(sawPath, 'the supplied path must still reach the concerns that own it');
});

test('an unknown change class fails open to the uncertain class instead of refusing', () => {
  const file = join(tmpdir(), 'concerns-parity-unknown-class.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, paths: ['src/lib/faro.ts'], change_class: 'invented' }));
  const result = cliJson(['route', '--input', file]);
  assert.equal(result.code, 0);
  assert.equal(result.payload.change_class.value, 'mixed');
  assert.equal(result.payload.change_class.source, 'unknown_class_fail_open');
  assert.ok(result.payload.disclosures.some((entry) => entry.kind === 'unknown_change_class'));
});

test('an input document that breaks its contract is refused rather than half-read', () => {
  const file = join(tmpdir(), 'concerns-parity-bad-input.json');
  writeFileSync(file, JSON.stringify({ schema_version: 99, paths: ['a.ts'] }));
  const result = cli(['route', '--input', file]);
  assert.equal(result.code, USAGE_EXIT);
  assert.equal(result.stdout, '');
});

test('an empty change is not an error and still activates the always-on concerns', () => {
  const file = join(tmpdir(), 'concerns-parity-empty.json');
  writeFileSync(file, JSON.stringify({ schema_version: 1, paths: [] }));
  const result = cliJson(['route', '--input', file]);
  assert.equal(result.code, 0);
  assert.equal(result.payload.activated.length, 5, 'the five always-on concerns must survive an empty change');
});
