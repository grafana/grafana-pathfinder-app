import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { emptyState, foldEvents, sealEvents } from './model.mjs';
import {
  acquireLock,
  appendEvents,
  createSessionDir,
  loadSession,
  readEvents,
  storeArtifact,
  withSession,
} from './store.mjs';

const identity = { session_id: 's', head_sha: 'b'.repeat(40) };

function withDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'review-store-'));
  try {
    createSessionDir(dir);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function started(dir) {
  return withSession(dir, (state) => ({
    events: sealEvents(state, [{ type: 'session_started', data: { identity } }]),
  })).state;
}

test('events are hash chained, and a tampered event refuses to load', () =>
  withDir((dir) => {
    started(dir);
    const [event] = readEvents(dir);
    assert.equal(foldEvents([event]).identity.session_id, 's');
    const tampered = { ...event, data: { identity: { ...identity, head_sha: 'c'.repeat(40) } } };
    writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify(tampered)}\n`);
    assert.throws(() => loadSession(dir), /hash chain/);
  }));

test('events must arrive in order', () => {
  const [first, second] = sealEvents(emptyState(), [
    { type: 'session_started', data: { identity } },
    { type: 'scope_recorded', data: { range: {}, files: [] } },
  ]);
  assert.throws(() => foldEvents([second, first]), /out of order/);
});

test('a torn trailing write is ignored on read and repaired on the next append', () =>
  withDir((dir) => {
    const state = started(dir);
    appendFileSync(join(dir, 'events.jsonl'), '{"seq":2,"type":"sco');
    assert.equal(readEvents(dir).length, 1);
    appendEvents(dir, 1, sealEvents(state, [{ type: 'scope_recorded', data: { range: {}, files: ['a'] } }]));
    assert.deepEqual(loadSession(dir).scope.files, ['a']);
    assert.ok(readFileSync(join(dir, 'events.jsonl'), 'utf8').endsWith('}\n'));
  }));

test('an append against a stale revision is rejected', () =>
  withDir((dir) => {
    const state = started(dir);
    const stale = sealEvents(emptyState(), [{ type: 'session_started', data: { identity } }]);
    assert.throws(() => appendEvents(dir, 0, stale), /revision moved from 0 to 1/);
    assert.equal(loadSession(dir).revision, state.revision);
  }));

test('one writer holds the lock; a second live writer is refused', () =>
  withDir((dir) => {
    const release = acquireLock(dir);
    try {
      assert.throws(() => acquireLock(dir), /live writer/);
    } finally {
      release();
    }
    acquireLock(dir)();
  }));

test('artifacts are content addressed and written once', () =>
  withDir((dir) => {
    const first = storeArtifact(dir, 'stdout');
    const second = storeArtifact(dir, 'stdout');
    assert.deepEqual(first, second);
    assert.equal(readFileSync(join(dir, first.ref), 'utf8'), 'stdout');
  }));

test('the snapshot is rewritten from the event log after every write', () =>
  withDir((dir) => {
    started(dir);
    const snapshot = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.identity.session_id, 's');
  }));
