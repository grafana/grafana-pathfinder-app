import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cli, readJson, REGISTRY_PATH, REPOSITORY_ROOT } from './helpers.mjs';
import { LEGACY_EXTRACTOR, runLegacy } from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);

function bytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

function markdownBytes() {
  return ['docs/design/CONCERNS.md', 'docs/design/CONCERN_DETAILS.md'].reduce(
    (total, path) => total + bytes(readFileSync(join(REPOSITORY_ROOT, path), 'utf8')),
    0
  );
}

const ROUTE_INPUT = join(tmpdir(), 'concerns-parity-budget.json');
writeFileSync(
  ROUTE_INPUT,
  JSON.stringify({
    schema_version: 1,
    paths: ['src/context-engine/recommender.ts', 'pkg/plugin/resources.go'],
    diff: 'diff --git a/src/context-engine/recommender.ts b/src/context-engine/recommender.ts\n--- a/src/context-engine/recommender.ts\n+++ b/src/context-engine/recommender.ts\n@@ -1,1 +1,1 @@\n+await fetchRecommendations();\n',
  })
);

function elapsed(work) {
  const started = process.hrtime.bigint();
  const value = work();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

// The old flow has no router, so an agent had to read both Markdown registries
// to decide what applied and then extract a packet per concern. The new flow
// asks the CLI which concerns applied and pulls only their bounded packets.
// Comparing those two totals is the only comparison that reflects real cost.
test('the routed flow moves far fewer bytes than reading both registries', () => {
  const routed = cli(['route', '--input', ROUTE_INPUT, '--format', 'json']);
  assert.equal(routed.code, 0, routed.stderr);
  const activated = JSON.parse(routed.stdout).activated.map((entry) => entry.id);
  assert.ok(activated.length > 0);

  let current = bytes(routed.stdout);
  let legacy = markdownBytes();
  for (const id of activated) {
    current += bytes(cli(['show', id, '--view', 'worker', '--format', 'json']).stdout);
    legacy += bytes(runLegacy(LEGACY_EXTRACTOR, ['--worker', id]).stdout);
  }

  const reduction = 1 - current / legacy;
  assert.ok(
    reduction >= 0.5,
    `the routed flow must move at most half the bytes: legacy ${legacy}, current ${current}, reduction ${(reduction * 100).toFixed(1)}%`
  );
});

test('a bounded worker packet is never larger than the full packet it is cut from', () => {
  for (const id of ['security', 'go-backend', 'block-editor-authoring']) {
    const worker = bytes(cli(['show', id, '--view', 'worker', '--format', 'json']).stdout);
    const full = bytes(cli(['show', id, '--view', 'full', '--format', 'json']).stdout);
    assert.ok(worker < full, `${id}: worker ${worker} is not smaller than full ${full}`);
  }
});

// The registry models no per-concern character budget; what bounds a worker
// packet is the flat 30,000-character ceiling the Markdown-era extractor enforces
// on the packets it hands a review worker. This is that absolute ceiling, not a
// declared per-concern value.
const WORKER_PACKET_CEILING_CHARACTERS = 30_000;

test('no worker packet exceeds the flat worker-packet ceiling the legacy extractor enforces', () => {
  for (const concern of registry.concerns) {
    const packet = bytes(cli(['show', concern.id, '--view', 'worker', '--format', 'json']).stdout);
    assert.ok(
      packet <= WORKER_PACKET_CEILING_CHARACTERS,
      `${concern.id} worker packet is ${packet} bytes, over the flat ${WORKER_PACKET_CEILING_CHARACTERS}-character ceiling`
    );
  }
});

test('every concern declares the file budget the routing packet reports', () => {
  for (const concern of registry.concerns) {
    const routing = JSON.parse(cli(['show', concern.id, '--view', 'routing', '--format', 'json']).stdout).concern;
    assert.equal(
      routing.activation.max_context_files,
      concern.context_budget.max_context_files,
      `${concern.id} max_context_files`
    );
    assert.ok(routing.activation.max_context_files >= 1, `${concern.id} declares no file budget`);
  }
});

// Wall clock is where the new path is not the cheaper one. The CLI loads a
// larger module graph than the Markdown extractor — a JSON-Schema validator
// among it, even for read-only commands — and measures roughly three times the
// per-packet cost. The absolute figure is tens of milliseconds, so the budget
// below is an order-of-magnitude guard rather than a race against the extractor.
const PACKET_BUDGET_MS = 400;

test('per-packet cost stays within its absolute budget on both paths', () => {
  const ids = registry.concerns.map((concern) => concern.id);
  const legacy = elapsed(() => ids.map((id) => runLegacy(LEGACY_EXTRACTOR, ['--worker', id]).stdout));
  const current = elapsed(() => ids.map((id) => cli(['show', id, '--view', 'worker', '--format', 'json']).stdout));
  assert.equal(legacy.value.length, current.value.length);
  assert.ok(
    current.ms / ids.length <= PACKET_BUDGET_MS,
    `packet cost regressed: ${(current.ms / ids.length).toFixed(0)}ms each over ${ids.length} concerns`
  );
  assert.ok(legacy.ms > 0 && current.ms > 0);
});

test('the registry file itself never has to be read into a prompt', () => {
  const registryBytes = bytes(readFileSync(REGISTRY_PATH, 'utf8'));
  const routed = bytes(cli(['route', '--input', ROUTE_INPUT, '--format', 'json']).stdout);
  assert.ok(
    routed < registryBytes / 4,
    `routing output ${routed} must stay far below the registry's own ${registryBytes} bytes`
  );
});
