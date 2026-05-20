/**
 * @jest-environment node
 *
 * Tests for `withSession` — the P7 storage seam.
 *
 * No public tool surface change yet; these tests exercise the seam
 * directly against the in-memory store, with fake runners that mutate
 * the on-disk artifact the same way the real CLI commands do.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ContentJson } from '../../../types/package.types';
import { SESSION_GENERATION_ABSENT, InMemorySessionStore, SessionPreconditionFailedError } from '../lib/session-store';
import {
  MAX_SESSION_ARTIFACT_BYTES,
  SESSION_NOT_FOUND,
  __resetSessionSaveCounts,
  isSessionHopLimit,
  isSessionTooLarge,
  withSession,
  type SessionNotFound,
  type SessionOutcome,
} from '../tools/state-bridge';
import type { CommandOutcome } from '../../utils/output';

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

function freshArtifact(title: string): { content: ContentJson } {
  return { content: { id: 'session-fixture', title, blocks: [] } };
}

/** Mutating runner that sets the title and returns a success outcome. */
function setTitleRunner(newTitle: string): (dir: string) => CommandOutcome {
  return (dir: string) => {
    const contentPath = path.join(dir, 'content.json');
    const existing = JSON.parse(fs.readFileSync(contentPath, 'utf8')) as ContentJson;
    existing.title = newTitle;
    fs.writeFileSync(contentPath, JSON.stringify(existing));
    return { status: 'ok', summary: `set title to ${newTitle}` };
  };
}

/** Runner that returns an error outcome without writing. */
function failingRunner(): (dir: string) => CommandOutcome {
  return () => ({ status: 'error', code: 'FAKE_ERROR', message: 'simulated failure' });
}

/** Runner that overwrites with a deliberately schema-violating artifact. */
function breakingRunner(): (dir: string) => CommandOutcome {
  return (dir: string) => {
    const contentPath = path.join(dir, 'content.json');
    fs.writeFileSync(contentPath, JSON.stringify({ id: 'broken', title: 'broken', blocks: [] }));
    return { status: 'error', code: 'VALIDATION', message: 'CLI flagged this as invalid' };
  };
}

function isNotFound(r: unknown): r is SessionNotFound {
  return typeof r === 'object' && r !== null && (r as SessionNotFound).code === 'SESSION_NOT_FOUND';
}

/**
 * Narrow a withSession result to the success branch. `withSession`
 * returns a wider union than the tests originally cared about
 * (SessionOutcome | SessionNotFound | SessionTooLarge | SessionHopLimit);
 * the helper centralizes the throw-if-not-success pattern so each test
 * stays focused on outcome assertions rather than narrowing scaffolding.
 */
function expectOutcome(r: Awaited<ReturnType<typeof withSession>>): SessionOutcome {
  if (isNotFound(r) || isSessionTooLarge(r) || isSessionHopLimit(r)) {
    throw new Error(`expected SessionOutcome, got ${r.code}`);
  }
  return r;
}

beforeEach(() => {
  // The per-token save counter is module-scoped to mirror production
  // behavior (one in-memory counter per replica). Tests share that
  // module, so reset between cases or later cases inherit the bumped
  // count and would eventually trip MAX_SESSION_SAVES.
  __resetSessionSaveCounts();
});

describe('withSession', () => {
  it('returns SESSION_NOT_FOUND when the token is unknown', async () => {
    const store = new InMemorySessionStore();
    const result = await withSession(TOKEN, store, setTitleRunner('whatever'));
    expect(result).toBe(SESSION_NOT_FOUND);
  });

  it('loads the artifact, runs the mutation, and writes it back at the next generation', async () => {
    const store = new InMemorySessionStore();
    const created = await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);
    expect(created.generation).toBe(1);

    const result = await withSession(TOKEN, store, setTitleRunner('v2'));
    const success = expectOutcome(result);

    expect(success.outcome.status).toBe('ok');
    expect(success.generation).toBe(2);
    expect(success.artifact.content.title).toBe('v2');

    // Store state matches the returned outcome.
    const reloaded = await store.load(TOKEN);
    expect(reloaded?.generation).toBe(2);
    expect(reloaded?.artifact.content.title).toBe('v2');
  });

  it('does NOT write to the store when the runner returns an error outcome', async () => {
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);

    const result = await withSession(TOKEN, store, failingRunner());
    const success = expectOutcome(result);

    expect(success.outcome.status).toBe('error');
    expect(success.generation).toBeUndefined();

    // The session is still at the prior generation with the prior title —
    // this is the P3 "MCP performs no schema validation" invariant: a failed
    // mutation cannot land.
    const reloaded = await store.load(TOKEN);
    expect(reloaded?.generation).toBe(1);
    expect(reloaded?.artifact.content.title).toBe('v1');
  });

  it('does NOT write to the store when the runner writes invalid output but reports failure', async () => {
    // Stronger version of the previous test: the runner mutates the tmpdir
    // contents but reports an error. The seam must skip the store write so
    // the in-tmpdir corruption is discarded with the tmpdir teardown.
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('original'), SESSION_GENERATION_ABSENT);

    const result = await withSession(TOKEN, store, breakingRunner());
    const success = expectOutcome(result);
    expect(success.outcome.status).toBe('error');

    const reloaded = await store.load(TOKEN);
    expect(reloaded?.artifact.content.title).toBe('original');
    expect(reloaded?.artifact.content.id).toBe('session-fixture');
  });

  it('propagates SessionPreconditionFailedError when a concurrent writer bumped the generation', async () => {
    // Two concurrent withSession calls against the same token will load
    // identical generations; the second to save throws PRECONDITION_FAILED.
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);

    const results = await Promise.allSettled([
      withSession(TOKEN, store, setTitleRunner('writer-A')),
      withSession(TOKEN, store, setTitleRunner('writer-B')),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SessionPreconditionFailedError);

    // Whichever winner landed, the session has exactly one bump.
    expect((await store.load(TOKEN))?.generation).toBe(2);
  });

  it('rejects with SESSION_TOO_LARGE when the post-mutation artifact exceeds the size cap', async () => {
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);

    // Runner that inflates the artifact beyond MAX_SESSION_ARTIFACT_BYTES.
    // The CLI reports `ok`, so size-gating is the only thing that can
    // stop the save — which is exactly what we want to verify.
    const bloatingRunner = (dir: string): CommandOutcome => {
      const contentPath = path.join(dir, 'content.json');
      const existing = JSON.parse(fs.readFileSync(contentPath, 'utf8')) as ContentJson;
      existing.title = 'x'.repeat(MAX_SESSION_ARTIFACT_BYTES + 1);
      fs.writeFileSync(contentPath, JSON.stringify(existing));
      return { status: 'ok', summary: 'bloated' };
    };

    const result = await withSession(TOKEN, store, bloatingRunner);
    expect(isSessionTooLarge(result)).toBe(true);
    if (!isSessionTooLarge(result)) {
      return;
    }
    expect(result.artifactBytes).toBeGreaterThan(MAX_SESSION_ARTIFACT_BYTES);
    expect(result.maxBytes).toBe(MAX_SESSION_ARTIFACT_BYTES);

    // The store is unchanged — the bloated artifact never landed.
    const reloaded = await store.load(TOKEN);
    expect(reloaded?.generation).toBe(1);
    expect(reloaded?.artifact.content.title).toBe('v1');
  });
});
