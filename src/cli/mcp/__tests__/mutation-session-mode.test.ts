/**
 * @jest-environment node
 *
 * Integration tests for the P7 session-mode dispatch on mutation tools.
 * Boots a real MCP server pair with an explicit InMemorySessionStore,
 * pre-seeds a session, and exercises each mutation tool through the
 * MCP client.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { runCreate } from '../../commands/create';
import { readPackage } from '../../utils/package-io';
import { InMemorySessionStore, SESSION_GENERATION_ABSENT, type SessionStore } from '../lib/session-store';
import { buildServer } from '../server';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ToolPayload {
  status?: string;
  code?: string;
  sessionToken?: string;
  generation?: number;
  summary?: Array<{ id: string; type: string }>;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown>; __etag?: string };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

interface Harness {
  call: (name: string, args: Record<string, unknown>) => Promise<ToolPayload>;
  store: InMemorySessionStore;
  close: () => Promise<void>;
}

async function newHarness(): Promise<Harness> {
  const store = new InMemorySessionStore();
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'mut-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);

  return {
    store,
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text: string }>;
      const text = blocks.find((b) => b.type === 'text')?.text;
      if (!text) {
        throw new Error(`${name} returned no text block`);
      }
      return JSON.parse(text) as ToolPayload;
    },
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Seed a session token with an initial valid artifact by running the
 * `create` CLI runner against a tmpdir, reading the package, and
 * stashing it in the store.
 */
async function seedSession(store: SessionStore, token: string, title = 'Fixture'): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-cli-mut-seed-'));
  try {
    const pkgDir = path.join(dir, 'pkg');
    const outcome = await runCreate({ dir: pkgDir, id: 'fixture-pkg', title, type: 'guide' });
    if (outcome.status !== 'ok') {
      throw new Error(`seedSession: runCreate failed: ${JSON.stringify(outcome)}`);
    }
    const state = readPackage(pkgDir);
    await store.save(token, { content: state.content, manifest: state.manifest }, SESSION_GENERATION_ABSENT);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('mutation tools — session-mode dispatch', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await newHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  describe('input mode validation', () => {
    it('errors INPUT_MODE_MISSING when neither artifact nor sessionToken is provided', async () => {
      const r = await h.call('pathfinder_add_block', {
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.code).toBe('INPUT_MODE_MISSING');
    });

    it('errors INPUT_MODE_AMBIGUOUS when both are provided', async () => {
      await seedSession(h.store, TOKEN);
      const r = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        artifact: { content: { id: 'x', title: 'x', blocks: [] } },
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.code).toBe('INPUT_MODE_AMBIGUOUS');
    });

    it('errors INVALID_SESSION_TOKEN when sessionToken is malformed', async () => {
      const r = await h.call('pathfinder_add_block', {
        sessionToken: 'not-a-token',
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.code).toBe('INVALID_SESSION_TOKEN');
    });
  });

  describe('session-mode happy path', () => {
    it('add_block: appends, returns ack with sessionToken + generation, no artifact echo', async () => {
      await seedSession(h.store, TOKEN);
      const r = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        type: 'markdown',
        fields: { content: 'Hello' },
      });
      expect(r.status).toBe('ok');
      expect(r.sessionToken).toBe(TOKEN);
      expect(r.generation).toBe(2); // seeded at 1, this is the first mutation
      expect(r.artifact).toBeUndefined();
      expect(Array.isArray(r.summary)).toBe(true);

      // Bucket state reflects the mutation.
      const loaded = await h.store.load(TOKEN);
      expect(loaded?.generation).toBe(2);
      expect((loaded?.artifact.content.blocks as unknown[]).length).toBe(1);
    });

    it('add_block: returns SESSION_NOT_FOUND for an unknown token', async () => {
      const r = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.code).toBe('SESSION_NOT_FOUND');
    });

    it('set_manifest: updates manifest under session-mode', async () => {
      await seedSession(h.store, TOKEN);
      const r = await h.call('pathfinder_set_manifest', {
        sessionToken: TOKEN,
        fields: { description: 'updated description' },
      });
      expect(r.status).toBe('ok');
      expect(r.generation).toBe(2);
      const loaded = await h.store.load(TOKEN);
      expect((loaded?.artifact.manifest as Record<string, unknown>)?.description).toBe('updated description');
    });

    it('edit_block + remove_block: full mutation arc through the session', async () => {
      await seedSession(h.store, TOKEN);
      // Add
      const added = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        type: 'markdown',
        explicitId: 'md-1',
        fields: { content: 'original' },
      });
      expect(added.status).toBe('ok');
      expect(added.generation).toBe(2);

      // Edit
      const edited = await h.call('pathfinder_edit_block', {
        sessionToken: TOKEN,
        id: 'md-1',
        fields: { content: 'rewritten' },
      });
      expect(edited.status).toBe('ok');
      expect(edited.generation).toBe(3);

      const afterEdit = await h.store.load(TOKEN);
      const blocks = afterEdit?.artifact.content.blocks as Array<Record<string, unknown>>;
      expect(blocks[0]?.content).toBe('rewritten');

      // Remove
      const removed = await h.call('pathfinder_remove_block', {
        sessionToken: TOKEN,
        id: 'md-1',
      });
      expect(removed.status).toBe('ok');
      expect(removed.generation).toBe(4);
      const afterRemove = await h.store.load(TOKEN);
      expect((afterRemove?.artifact.content.blocks as unknown[]).length).toBe(0);
    });
  });

  describe('expectedGeneration', () => {
    it('proceeds when expectedGeneration matches', async () => {
      await seedSession(h.store, TOKEN);
      const r = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        expectedGeneration: 1,
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.status).toBe('ok');
      expect(r.generation).toBe(2);
    });

    it('returns CONCURRENT_MODIFICATION when expectedGeneration is stale', async () => {
      await seedSession(h.store, TOKEN);
      // Bump the session out of band.
      const cur = await h.store.load(TOKEN);
      if (!cur) {
        throw new Error('seed failed');
      }
      await h.store.save(TOKEN, cur.artifact, cur.generation); // -> gen=2

      const r = await h.call('pathfinder_add_block', {
        sessionToken: TOKEN,
        expectedGeneration: 1, // stale
        type: 'markdown',
        fields: { content: 'x' },
      });
      expect(r.code).toBe('CONCURRENT_MODIFICATION');
      expect(r.data).toEqual({ expected: 1, actual: 2 });
    });
  });

  describe('stateless mode preserved', () => {
    it('add_block still works with {artifact} and does NOT touch the session store', async () => {
      // Seed an unrelated session so we can verify the store stays untouched.
      await seedSession(h.store, TOKEN);
      const r = await h.call('pathfinder_add_block', {
        artifact: { content: { id: 'inline', title: 'Inline', blocks: [] } },
        type: 'markdown',
        fields: { content: 'inline-mode' },
      });
      expect(r.status).toBe('ok');
      expect(r.artifact).toBeDefined();
      expect(r.sessionToken).toBeUndefined();

      // The seeded session is unchanged.
      const loaded = await h.store.load(TOKEN);
      expect(loaded?.generation).toBe(1);
      expect((loaded?.artifact.content.blocks as unknown[]).length).toBe(0);
    });
  });
});
