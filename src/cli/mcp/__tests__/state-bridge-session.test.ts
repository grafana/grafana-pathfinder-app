/**
 * @jest-environment node
 *
 * Tests for `withSession` and `withFreshSession` — the P7 storage seam.
 *
 * No public tool surface change yet; these tests exercise the seam
 * directly against the in-memory store, with fake runners that mutate
 * the on-disk artifact the same way the real CLI commands do.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ContentJson } from '../../../types/package.types';
import { SESSION_GENERATION_ABSENT, InMemorySessionStore, SessionPreconditionFailedError } from '../lib/session-store';
import { SESSION_NOT_FOUND, withFreshSession, withSession, type SessionNotFound } from '../tools/state-bridge';
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
    if (isNotFound(result)) {
      throw new Error('expected SessionOutcome');
    }

    expect(result.outcome.status).toBe('ok');
    expect(result.generation).toBe(2);
    expect(result.artifact.content.title).toBe('v2');

    // Store state matches the returned outcome.
    const reloaded = await store.load(TOKEN);
    expect(reloaded?.generation).toBe(2);
    expect(reloaded?.artifact.content.title).toBe('v2');
  });

  it('does NOT write to the store when the runner returns an error outcome', async () => {
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);

    const result = await withSession(TOKEN, store, failingRunner());
    if (isNotFound(result)) {
      throw new Error('expected SessionOutcome');
    }

    expect(result.outcome.status).toBe('error');
    expect(result.generation).toBeUndefined();

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
    if (isNotFound(result)) {
      throw new Error('expected SessionOutcome');
    }
    expect(result.outcome.status).toBe('error');

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
});

describe('withFreshSession', () => {
  it('mints a new session at generation 1 from an empty seed', async () => {
    const store = new InMemorySessionStore();
    expect(await store.load(TOKEN)).toBeNull();

    const result = await withFreshSession(TOKEN, store, freshArtifact('initial'), setTitleRunner('after-create'));
    expect(result.outcome.status).toBe('ok');
    expect(result.generation).toBe(1);
    expect(result.artifact.content.title).toBe('after-create');

    const reloaded = await store.load(TOKEN);
    expect(reloaded?.generation).toBe(1);
    expect(reloaded?.artifact.content.title).toBe('after-create');
  });

  it('does NOT write on runner failure (no half-minted sessions)', async () => {
    const store = new InMemorySessionStore();
    const result = await withFreshSession(TOKEN, store, freshArtifact('seed'), failingRunner());
    expect(result.outcome.status).toBe('error');
    expect(result.generation).toBeUndefined();
    expect(await store.load(TOKEN)).toBeNull();
  });

  it('rejects mint-over-existing with SessionPreconditionFailedError', async () => {
    const store = new InMemorySessionStore();
    await store.save(TOKEN, freshArtifact('v1'), SESSION_GENERATION_ABSENT);

    await expect(
      withFreshSession(TOKEN, store, freshArtifact('seed'), setTitleRunner('shadow'))
    ).rejects.toBeInstanceOf(SessionPreconditionFailedError);

    // Existing session untouched.
    const reloaded = await store.load(TOKEN);
    expect(reloaded?.artifact.content.title).toBe('v1');
    expect(reloaded?.generation).toBe(1);
  });
});
