import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';
import { LEGACY_EXTRACTOR, runLegacy } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);
const SAMPLE_IDS = ['security', 'go-backend', 'completion-records', 'full-screen-sidebar-handoff'];

const ROUTE_INPUT = join(tmpdir(), 'concerns-parity-determinism.json');
writeFileSync(
  ROUTE_INPUT,
  JSON.stringify({
    schema_version: 1,
    paths: ['src/context-engine/recommender.ts', 'pkg/plugin/resources.go'],
    diff: 'diff --git a/pkg/plugin/resources.go b/pkg/plugin/resources.go\n--- a/pkg/plugin/resources.go\n+++ b/pkg/plugin/resources.go\n@@ -1,1 +1,2 @@\n+\tdefer body.Close()\n',
  })
);

const INVOCATIONS = [
  ['list'],
  ['validate'],
  ['coverage', '--tracked'],
  ['match', '--path', 'src/lib/faro.ts'],
  ['route', '--input', ROUTE_INPUT],
  ...SAMPLE_IDS.flatMap((id) => [
    ['show', id],
    ['show', id, '--view', 'routing'],
    ['show', id, '--view', 'review'],
    ['show', id, '--view', 'worker'],
    ['show', id, '--view', 'plan'],
  ]),
];

test('every command returns byte-identical output when run twice', () => {
  for (const args of INVOCATIONS) {
    const first = cli([...args, '--format', 'json']);
    const second = cli([...args, '--format', 'json']);
    assert.equal(first.code, second.code, args.join(' '));
    assert.equal(first.stdout, second.stdout, `${args.join(' ')} is not byte-stable`);
    assert.equal(first.stderr, second.stderr, args.join(' '));
  }
});

test('text output is byte-identical when run twice', () => {
  for (const args of INVOCATIONS) {
    assert.equal(cli(args).stdout, cli(args).stdout, `${args.join(' ')} text output is not byte-stable`);
  }
});

// A packet that changed with the working directory would make review results
// depend on where the agent happened to stand.
test('packets do not depend on the working directory', () => {
  for (const id of SAMPLE_IDS) {
    const fromRoot = cli(['show', id, '--format', 'json']);
    const fromElsewhere = cli(['show', id, '--format', 'json'], { cwd: tmpdir() });
    assert.equal(fromRoot.stdout, fromElsewhere.stdout, id);
  }
});

test('the Markdown extractor is equally stable, so parity is compared against a fixed target', () => {
  for (const id of SAMPLE_IDS) {
    const first = runLegacy(LEGACY_EXTRACTOR, [id], { cwd: REPOSITORY_ROOT });
    const second = runLegacy(LEGACY_EXTRACTOR, [id], { cwd: tmpdir() });
    assert.equal(first.stdout, second.stdout, id);
  }
});

test('concern order is stable across every command that lists concerns', () => {
  const listed = JSON.parse(cli(['list', '--format', 'json']).stdout).concerns.map((entry) => entry.id);
  assert.deepEqual(
    listed,
    registry.concerns.map((concern) => concern.id)
  );
  const routed = JSON.parse(cli(['route', '--input', ROUTE_INPUT, '--format', 'json']).stdout);
  for (const bucket of ['activated', 'withheld', 'considered']) {
    const bucketIds = routed[bucket].map((entry) => entry.id);
    assert.deepEqual(
      bucketIds,
      listed.filter((id) => bucketIds.includes(id)),
      `${bucket} is not in registry order`
    );
  }
});
