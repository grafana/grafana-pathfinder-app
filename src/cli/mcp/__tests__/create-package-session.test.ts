/**
 * @jest-environment node
 *
 * Tests for the P7 session-minting branch of pathfinder_create_package
 * (and the same wiring on pathfinder_create_guide_template).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { InMemorySessionStore } from '../lib/session-store';
import { isValidSessionToken } from '../lib/session-token';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  code?: string;
  sessionToken?: string;
  generation?: number;
  artifact?: {
    content: { id: string; title: string; blocks: unknown[] };
    manifest?: Record<string, unknown>;
    __etag?: string;
  };
  summary?: Array<{ id: string; type: string }>;
  [key: string]: unknown;
}

async function withHarness<T>(
  fn: (call: (name: string, args: Record<string, unknown>) => Promise<ToolPayload>, store: InMemorySessionStore) => Promise<T>
): Promise<T> {
  const store = new InMemorySessionStore();
  const server = buildServer({ sessionStore: store });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'create-session-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  try {
    return await fn(async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text: string }>;
      const text = blocks.find((b) => b.type === 'text')?.text;
      if (!text) {
        throw new Error(`${name} returned no text block`);
      }
      return JSON.parse(text) as ToolPayload;
    }, store);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('pathfinder_create_package — session mint', () => {
  it('mints a session token at generation 1 and persists the seed artifact', async () => {
    await withHarness(async (call, store) => {
      const r = await call('pathfinder_create_package', { title: 'My Guide', description: 'A test' });
      expect(r.status).toBe('ok');
      expect(typeof r.sessionToken).toBe('string');
      expect(isValidSessionToken(r.sessionToken!)).toBe(true);
      expect(r.generation).toBe(1);

      // Artifact still returned (backward compat with stateless flow).
      expect(r.artifact?.content.title).toBe('My Guide');
      expect(r.artifact?.__etag).toBeDefined();

      // Bucket reflects the same artifact.
      const loaded = await store.load(r.sessionToken!);
      expect(loaded?.generation).toBe(1);
      expect(loaded?.artifact.content.title).toBe('My Guide');
    });
  });

  it('mints distinct tokens for two distinct calls', async () => {
    await withHarness(async (call, store) => {
      const a = await call('pathfinder_create_package', { title: 'A' });
      const b = await call('pathfinder_create_package', { title: 'B' });
      expect(a.sessionToken).toBeDefined();
      expect(b.sessionToken).toBeDefined();
      expect(a.sessionToken).not.toBe(b.sessionToken);
      // Both sessions persisted independently.
      expect((await store.load(a.sessionToken!))?.artifact.content.title).toBe('A');
      expect((await store.load(b.sessionToken!))?.artifact.content.title).toBe('B');
    });
  });

  it('the minted token works for subsequent session-mode add_block calls', async () => {
    await withHarness(async (call, store) => {
      const created = await call('pathfinder_create_package', { title: 'Chained' });
      expect(created.sessionToken).toBeDefined();

      const added = await call('pathfinder_add_block', {
        sessionToken: created.sessionToken,
        type: 'markdown',
        fields: { content: 'Hello' },
      });
      expect(added.status).toBe('ok');
      expect(added.sessionToken).toBe(created.sessionToken);
      expect(added.generation).toBe(2);
      // Session-mode mutations do not echo the artifact.
      expect(added.artifact).toBeUndefined();

      const loaded = await store.load(created.sessionToken!);
      expect(loaded?.generation).toBe(2);
      expect((loaded?.artifact.content.blocks as unknown[]).length).toBe(1);
    });
  });

  it('returns INVALID_TITLE when the title has no alphanumeric chars (regression — sessionToken branch must not mask this)', async () => {
    await withHarness(async (call) => {
      const r = await call('pathfinder_create_package', { title: '!!!' });
      expect(r.code).toBe('INVALID_TITLE');
      // No sessionToken on errors — sessionToken only appears on success.
      expect(r.sessionToken).toBeUndefined();
    });
  });
});

describe('pathfinder_create_guide_template — session mint', () => {
  it('mints a session containing the pre-populated template', async () => {
    await withHarness(async (call, store) => {
      const r = await call('pathfinder_create_guide_template', {
        id: 'starter-pack',
        title: 'Starter Pack',
      });
      expect(r.status).toBe('ok');
      expect(isValidSessionToken(r.sessionToken!)).toBe(true);
      expect(r.generation).toBe(1);
      expect(r.artifact?.content.blocks.length).toBeGreaterThan(0);
      const loaded = await store.load(r.sessionToken!);
      expect((loaded?.artifact.content.blocks as unknown[]).length).toBe((r.artifact?.content.blocks as unknown[]).length);
    });
  });
});
