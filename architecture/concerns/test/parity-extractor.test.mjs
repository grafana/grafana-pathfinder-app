import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cliJson, readJson, REGISTRY_PATH } from './helpers.mjs';
import {
  legacyAnchorSeparator,
  legacyPacket,
  legacyUnquote,
  legacyWorkerPacket,
  projectPacketToLegacy,
  projectWorkerPacketToLegacy,
  rawLegacyPacket,
} from './legacy.mjs';

const registry = readJson(REGISTRY_PATH);

// Each packet costs two child processes, so the whole corpus is gathered once
// and every test reads from it.
const packets = registry.concerns.map((concern) => ({
  concern,
  full: cliJson(['show', concern.id, '--view', 'full']).payload.concern,
  worker: cliJson(['show', concern.id, '--view', 'worker']).payload.concern,
  legacyFull: legacyPacket(concern.id),
  legacyWorker: legacyWorkerPacket(concern.id),
}));

const divergences = readJson(fileURLToPath(new URL('./fixtures/parity/known-divergences.json', import.meta.url)));

function divergenceFor(concern, view, field, index) {
  return divergences.entries.find(
    (entry) => entry.concern === concern && entry.view === view && entry.field === field && entry.index === index
  );
}

function comparePacket(concern, view, legacy, projected, observed) {
  for (const field of Object.keys(legacy)) {
    const left = legacy[field];
    const right = projected[field];
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      assert.deepEqual(right, left, `${concern}/${view}/${field}`);
      continue;
    }
    for (const [index, value] of left.entries()) {
      if (JSON.stringify(value) === JSON.stringify(right[index])) {
        continue;
      }
      const known = divergenceFor(concern, view, field, index);
      assert.ok(known, `${concern}/${view}/${field}[${index}] diverges without a recorded reason: ${value}`);
      assert.equal(known.legacy_value, value);
      assert.equal(known.registry_value, right[index]);
      observed.push(known);
    }
  }
}

// The whole point of this file: for every concern, the CLI packet and the
// Markdown-era packet are the same document once the legacy backtick artifact is
// replayed. Anything left over has to be in the fixture, with a reason.
test('every concern packet matches the Markdown extractor exactly under the legacy projection', () => {
  const observed = [];
  assert.equal(packets.length, 27);
  for (const { concern, full, worker, legacyFull, legacyWorker } of packets) {
    assert.ok(legacyFull && legacyWorker, `${concern.id} must be extractable from the Markdown registries`);
    comparePacket(concern.id, 'full', legacyFull, projectPacketToLegacy(full), observed);
    comparePacket(concern.id, 'worker', legacyWorker, projectWorkerPacketToLegacy(worker), observed);
  }
  assert.deepEqual(
    observed,
    divergences.entries,
    'the recorded divergences must be exactly the ones the comparison still finds'
  );
});

test('the legacy packet field set is reproduced with no field added or dropped', () => {
  for (const { concern, full, worker, legacyFull, legacyWorker } of packets) {
    assert.deepEqual(Object.keys(projectPacketToLegacy(full)).sort(), Object.keys(legacyFull).sort(), concern.id);
    assert.deepEqual(
      Object.keys(projectWorkerPacketToLegacy(worker)).sort(),
      Object.keys(legacyWorker).sort(),
      concern.id
    );
  }
});

// If this stopped being a real transformation the parity test above would pass
// vacuously, so the projection itself is pinned to the artifact it replays.
test('the legacy projection replays the backtick artifact rather than passing values through', () => {
  assert.equal(legacyUnquote('`continue` token'), 'continue` token');
  assert.equal(
    legacyUnquote('Storage key names in `terminal-storage.ts`'),
    'Storage key names in `terminal-storage.ts'
  );
  assert.equal(legacyUnquote('`data-test-*` renames'), 'data-test-*` renames');
  assert.equal(legacyUnquote('src/security/**'), 'src/security/**');
});

// The contract string the CLI emits is the value the comparison above pins, so
// the separator replay has to be a real transformation of a real <br>-joined cell
// rather than a no-op that would let the CLI drop statements unnoticed.
test('the contract anchor the CLI emits is what the comparison pins, statement for statement', () => {
  const multiStatement = packets.filter(
    ({ concern }) =>
      (concern.contract_records.find((record) => record.kind === 'established')?.statements.length ?? 0) > 1
  );
  assert.ok(multiStatement.length >= 1, 'a multi-statement contract is what makes the separator observable');
  for (const { concern, full, worker } of multiStatement) {
    const raw = rawLegacyPacket(concern.id).contract_anchor;
    assert.ok(raw.contract.includes('<br>'), `${concern.id} legacy contract must carry the separator`);
    assert.equal(full.contract_anchor.contract, legacyAnchorSeparator(raw).contract, `${concern.id} full contract`);
    assert.equal(worker.contract_anchor.contract, legacyAnchorSeparator(raw).contract, `${concern.id} worker contract`);
    for (const statement of concern.contract_records.find((record) => record.kind === 'established').statements) {
      assert.ok(full.contract_anchor.contract.includes(statement), `${concern.id} dropped a contract statement`);
    }
  }
});

test('the projection is load-bearing for concerns whose cells open or close with inline code', () => {
  const mangled = [];
  for (const { concern, full } of packets) {
    for (const field of ['one_way_doors', 'verification', 'trigger_keywords', 'load_code']) {
      if (full[field].some((value) => legacyUnquote(value) !== value)) {
        mangled.push(`${concern.id}/${field}`);
      }
    }
  }
  assert.ok(mangled.length >= 10, `the artifact must still be widespread, found ${mangled.length}`);
});
